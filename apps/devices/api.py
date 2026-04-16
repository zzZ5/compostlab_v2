# apps/devices/api.py
# -*- coding: utf-8 -*-
"""
Device / Channel API

本文件提供：
- Device CRUD（设备增删改查）
- Channel CRUD（设备下通道增删改查）
- DeviceTree（devices + channels 的树形返回，便于前端一次性初始化）
- with_latest=1：为每个通道附带最新遥测值 latest（来自 telemetry_telemetrykv）
- ✅ Device Commands（后端下发命令到设备 response_topic，并落库记录）

⚠️ 时间格式与时区（按你的要求统一）：
- 数据库/ORM 内部通常用 UTC（USE_TZ=True 时）
- 对外输出全部统一转为本地时区（TIME_ZONE=Asia/Shanghai）
- 并格式化为： "YYYY-MM-DD HH:MM:SS"（不带 +08:00）
  例如： "2026-01-05 11:37:51"

✅ 本次改动（按你的新需求）：
- Channel 增加“语义层字段”支持：metric / role / display_name
  （不需要 is_primary）
- API：Channel 返回与写入时支持上述字段
- latest_map：自动兼容 telemetry 表字段名可能是 code 或 channel_code
- 统一 404 返回（避免未捕获 DoesNotExist）
"""

from __future__ import annotations

import time
import re
from typing import Dict, Optional
from copy import deepcopy

from django.db import connection
from django.http import JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.utils.decorators import method_decorator
from django.db.models import F, Q

from apps.api.mixins import BasicAuthMixin, JsonBodyMixin, DeviceJWTAuthMixin
from apps.api.pagination import OffsetPaginator
from apps.devices.models import Device, Channel, DeviceCommand, ControlTemplate, ScriptTemplate, ScriptExecution
from apps.devices.services.mqtt_pub import publish_json
from apps.devices.services.script_executor import ScriptExecutor, ThresholdMonitor
from apps.permissions.mixins import ResourcePermissionMixin, ReadOrWritePermissionMixin
from apps.permissions.config import ResourceType, ActionType


# -------------------------
# helpers
# -------------------------
def _field_names(model) -> set[str]:
    """获取模型所有字段名（用于自动兼容不同字段命名）"""
    return {f.name for f in model._meta.fields}


DEVICE_FIELDS = _field_names(Device)
CHANNEL_FIELDS = _field_names(Channel)


def _device_code_field_name() -> str:
    """
    设备唯一编码字段（你希望统一叫 code）
    若你的 Device 仍是 key/device_code/device_uid，也能自动适配。
    """
    for cand in ("code", "device_code", "key", "device_uid", "uid"):
        if cand in DEVICE_FIELDS:
            return cand
    return "code"


DEVICE_CODE_FIELD = _device_code_field_name()


def _channel_code_field_name() -> str:
    """
    通道唯一编码字段（你希望统一叫 code）
    若你的 Channel 仍是 var_code/channel_code，也能自动适配。
    """
    for cand in ("code", "var_code", "channel_code"):
        if cand in CHANNEL_FIELDS:
            return cand
    return "code"


CHANNEL_CODE_FIELD = _channel_code_field_name()


def _set_if_exists(obj, field: str, value):
    """仅当对象存在该字段时才赋值（兼容不同模型字段）"""
    if hasattr(obj, field):
        setattr(obj, field, value)


def _parse_bool(s: Optional[str]) -> bool:
    """
    query 参数 bool 解析：
    - 1/true/yes/y/on -> True
    - 其他 -> False
    """
    if s is None:
        return False
    return str(s).strip().lower() in ("1", "true", "yes", "y", "on")


def _dt_local_str(dt) -> Optional[str]:
    """
    将 datetime 转成本地时区并输出为 "YYYY-MM-DD HH:MM:SS" 字符串。
    - 当 dt 为 None 返回 None
    """
    if not dt:
        return None
    dt_local = timezone.localtime(dt)
    return dt_local.strftime("%Y-%m-%d %H:%M:%S")


def _get_device_code(d: Device) -> str:
    """读取设备唯一编码（自动适配实际字段名）"""
    return (getattr(d, DEVICE_CODE_FIELD, "") or "").strip()


def _get_channel_code(c: Channel) -> str:
    """读取通道唯一编码（自动适配实际字段名）"""
    return (getattr(c, CHANNEL_CODE_FIELD, "") or "").strip()


def _json_404(detail: str = "not found") -> JsonResponse:
    return JsonResponse({"detail": detail}, status=404)


def _json_400(detail: str) -> JsonResponse:
    return JsonResponse({"detail": detail}, status=400)


def _merge_config_patch(base: Optional[dict], patch: Optional[dict]):
    """
    Merge partial configuration updates.
    - nested dict: recursive merge
    - value is None: delete the key
    - other values: replace
    """
    if patch is None:
        return {}

    if not isinstance(base, dict):
        base = {}

    result = deepcopy(base)
    for key, value in patch.items():
        if value is None:
            result.pop(key, None)
            continue
        if isinstance(value, dict) and isinstance(result.get(key), dict):
            result[key] = _merge_config_patch(result.get(key), value)
            continue
        result[key] = deepcopy(value)
    return result


def _device_to_dict(d: Device) -> dict:
    """
    Device -> dict
    对外不返回任何 secret/token/device_key 等敏感信息。
    时间字段统一输出为："YYYY-MM-DD HH:MM:SS"
    """
    out = {
        "device_id": d.id,
        "code": _get_device_code(d) or None,
        "name": getattr(d, "name", "") or "",
        "last_seen_at": _dt_local_str(getattr(d, "last_seen_at", None)),
        "meta": getattr(d, "meta", None) if hasattr(d, "meta") else None,
        "created_at": _dt_local_str(getattr(d, "created_at", None)),
        "updated_at": _dt_local_str(getattr(d, "updated_at", None)),
    }

    if hasattr(d, "is_active"):
        out["is_active"] = bool(getattr(d, "is_active"))

    # ✅ 兼容：如果模型有这些字段就返回
    if hasattr(d, "post_topic"):
        out["post_topic"] = getattr(d, "post_topic") or ""
    if hasattr(d, "response_topic"):
        out["response_topic"] = getattr(d, "response_topic") or ""
    if hasattr(d, "note"):
        out["note"] = getattr(d, "note") or ""
    if hasattr(d, "ip_address"):
        out["ip_address"] = getattr(d, "ip_address") or ""
    if hasattr(d, "register_at"):
        out["register_at"] = _dt_local_str(getattr(d, "register_at", None))
    if hasattr(d, "configuration"):
        out["configuration"] = getattr(d, "configuration", {}) or {}

    return {k: v for k, v in out.items() if v is not None}


def _channel_to_dict(c: Channel) -> dict:
    """
    Channel -> dict
    时间字段统一输出为："YYYY-MM-DD HH:MM:SS"

    ✅ 语义层字段：
    - metric / role / display_name（若模型无该字段则自动忽略）
    """
    out = {
        "channel_id": c.id,
        "device_id": c.device_id,
        "code": _get_channel_code(c) or None,
        "name": getattr(c, "name", "") or getattr(c, "channel_name", "") or "",
        "unit": getattr(c, "unit", "") or "",
        "meta": getattr(c, "meta", None) if hasattr(c, "meta") else None,
        "created_at": _dt_local_str(getattr(c, "created_at", None)),
        "updated_at": _dt_local_str(getattr(c, "updated_at", None)),
    }

    if hasattr(c, "is_active"):
        out["is_active"] = bool(getattr(c, "is_active"))

    # ✅ 新增：语义层字段（不依赖 code 判断类型）
    if hasattr(c, "metric"):
        out["metric"] = (getattr(c, "metric") or "").strip()
    if hasattr(c, "role"):
        out["role"] = (getattr(c, "role") or "").strip()
    if hasattr(c, "display_name"):
        out["display_name"] = (getattr(c, "display_name") or "").strip()

    return {k: v for k, v in out.items() if v is not None}


def _telemetry_code_field_name() -> str:
    """
    兼容 telemetry_telemetrykv 表里通道字段名可能是 code 或 channel_code。

    优先：
    - code
    - channel_code
    """
    sql = """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'telemetry_telemetrykv'
    """
    with connection.cursor() as cur:
        cur.execute(sql)
        cols = {r[0] for r in cur.fetchall()}
    if "code" in cols:
        return "code"
    if "channel_code" in cols:
        return "channel_code"
    # 兜底（你未来若改名，这里仍可继续扩展）
    return "code"


def _latest_map_for_device(device_id: int) -> Dict[str, dict]:
    """
    返回 {code: latest_row_dict}

    说明：
    - 自动兼容 telemetry_telemetrykv 的通道字段名：code 或 channel_code
    - ts 对外输出为 "YYYY-MM-DD HH:MM:SS"
    """
    ch_field = _telemetry_code_field_name()

    sql = f"""
        SELECT DISTINCT ON ({ch_field})
            {ch_field} AS ch_code, ts, value,
            COALESCE(NULLIF(unit,''),'') AS unit,
            quality_flag, source
        FROM telemetry_telemetrykv
        WHERE device_id = %s
        ORDER BY {ch_field}, ts DESC;
    """
    out: Dict[str, dict] = {}
    with connection.cursor() as cur:
        cur.execute(sql, [device_id])
        rows = cur.fetchall()

    for ch_code, ts, val, unit, qf, src in rows:
        code = str(ch_code)
        # NOTE: value 可能是 Decimal / str / float
        try:
            fval = float(val)
        except Exception:
            fval = None
        out[code] = {
            "code": code,
            "ts": _dt_local_str(ts),
            "value": fval,
            "unit": unit or "",
            "quality": qf,
            "source": src,
        }
    return out


def _apply_channel_semantic_fields(c: Channel, body: dict) -> Optional[JsonResponse]:
    """
    写入 channel 的语义层字段：metric/role/display_name
    - 不强制必填
    - 若模型无该字段（还没迁移）则自动忽略
    - ✅ 如果未提供 metric，根据 unit 自动推断
    - 返回 JsonResponse 表示错误；None 表示 ok
    """
    # 单位到 metric 的映射（用于自动推断）
    UNIT_TO_METRIC = {
        "℃": "temperature",
        "°c": "temperature",
        "°c": "temperature",
        "c": "temperature",
        "%": "o2",  # 默认氧气百分比
        "vol%": "o2",
        "v/v": "o2",
        "ppm": "co2",  # 默认二氧化碳
        "mg/l": "ch4",  # 默认甲烷
        "mg/m3": "ch4",
        "rh": "humidity",
        "%rh": "humidity",
        "ph": "ph",
        "pa": "pressure",
        "kpa": "pressure",
        "mpa": "pressure",
        "bar": "pressure",
        "l/min": "flow",
        "l/h": "flow",
        "m3/h": "flow",
        "rpm": "speed",
        "v": "voltage",
        "kv": "voltage",
        "mv": "voltage",
        "a": "current",
        "ma": "current",
        "w": "power",
        "kw": "power",
        "%": "moisture",  # 含水量百分比
    }

    # 处理 metric：优先使用请求中的 metric，否则根据 unit 自动推断
    if "metric" in body and body.get("metric"):
        _set_if_exists(c, "metric", (body.get("metric") or "").strip())
    elif "unit" in body and hasattr(c, "metric"):
        unit = (body.get("unit") or "").strip().lower()
        # 尝试精确匹配单位
        auto_metric = None
        if unit in UNIT_TO_METRIC:
            auto_metric = UNIT_TO_METRIC[unit]
        else:
            # 尝试模糊匹配（如包含 ℃）
            for unit_key, metric in UNIT_TO_METRIC.items():
                if unit_key in unit or unit in unit_key:
                    auto_metric = metric
                    break
        if auto_metric:
            c.metric = auto_metric

    if "role" in body:
        _set_if_exists(c, "role", (body.get("role") or "").strip())
    if "display_name" in body:
        _set_if_exists(c, "display_name", (body.get("display_name") or "").strip())
    return None


def _apply_channel_semantic_fields(c: Channel, body: dict) -> Optional[JsonResponse]:
    def _tokens(value: str) -> list[str]:
        return [x for x in re.split(r"[^a-z0-9]+", (value or "").strip().lower()) if x]

    def _contains(text: str, patterns: list[str]) -> bool:
        if not text:
            return False
        return any(re.search(pattern, text) for pattern in patterns)

    def _infer_metric(code: str, name: str, display_name: str, unit: str) -> str:
        code_text = (code or "").strip().lower()
        compact_code = re.sub(r"[^a-z0-9]+", "", code_text)
        name_text = (name or "").strip().lower()
        display_text = (display_name or "").strip().lower()
        combined_text = " ".join(x for x in [display_text, name_text] if x)
        combined_tokens = set(_tokens(display_text) + _tokens(name_text))
        unit_text = (unit or "").strip().lower()

        exact_code_to_metric = {
            "co2": "co2",
            "co": "co",
            "h2s": "h2s",
            "o2": "o2",
            "ch4": "ch4",
            "heater": "switch",
            "pump": "switch",
            "aeration": "switch",
        }
        if compact_code in exact_code_to_metric:
            return exact_code_to_metric[compact_code]

        checks = [
            ("co2", [r"\bco2\b", r"carbon[_\s-]*dioxide"]),
            ("o2", [r"\bo2\b", r"\boxygen\b"]),
            ("temperature", [r"\btemp\b", r"\btemperature\b", r"\bt[1-9]\b"]),
            ("ch4", [r"\bch4\b", r"\bmethane\b"]),
            ("h2s", [r"\bh2s\b", r"\bsulfide\b", r"\bsulphide\b"]),
            ("nh3", [r"\bnh3\b", r"\bammonia\b"]),
            ("co", [r"\bco\b", r"carbon[_\s-]*monoxide"]),
            ("moisture", [r"\bmois\b", r"\bmoisture\b", r"water[_\s-]*content", r"\bmc\b"]),
            ("humidity", [r"\bhumid\b", r"\bhumidity\b", r"\brh\b"]),
            ("ph", [r"\bph\b"]),
            ("flow", [r"\bflow\b"]),
            ("switch", [r"\bswitch\b", r"\brelay\b", r"\bon[_\s-]*off\b"]),
        ]

        for metric, patterns in checks:
            if _contains(code_text, patterns) or _contains(combined_text, patterns):
                return metric
            if metric in combined_tokens:
                return metric

        unit_to_metric = {
            "°c": "temperature",
            "℃": "temperature",
            "c": "temperature",
            "rh": "humidity",
            "%rh": "humidity",
            "ph": "ph",
        }
        if unit_text in ("%vol", "vol%") and compact_code == "o2":
            return "o2"
        if unit_text == "ppm" and compact_code == "co2":
            return "co2"
        if unit_text == "ppm" and compact_code == "co":
            return "co"
        if unit_text == "ppm" and compact_code == "h2s":
            return "h2s"
        if unit_text in ("%lel", "lel%") and compact_code == "ch4":
            return "ch4"
        return unit_to_metric.get(unit_text, "")

    if "metric" in body and body.get("metric"):
        _set_if_exists(c, "metric", (body.get("metric") or "").strip())
    elif hasattr(c, "metric"):
        auto_metric = _infer_metric(
            str(body.get("code") or getattr(c, CHANNEL_CODE_FIELD, "") or ""),
            str(body.get("name") or getattr(c, "name", "") or ""),
            str(body.get("display_name") or getattr(c, "display_name", "") or ""),
            str(body.get("unit") or getattr(c, "unit", "") or ""),
        )
        if auto_metric:
            c.metric = auto_metric

    if "role" in body:
        _set_if_exists(c, "role", (body.get("role") or "").strip())
    if "display_name" in body:
        _set_if_exists(c, "display_name", (body.get("display_name") or "").strip())
    return None


# -------------------------
# Device CRUD
# -------------------------
@method_decorator(csrf_exempt, name="dispatch")
class DeviceListView(BasicAuthMixin, View):
    """GET /api/v2/devices"""

    def get(self, request):
        qs = Device.objects.all().order_by("id")
        page = request.GET.get("page")
        page_size = request.GET.get("page_size")

        if page or page_size:
            page_num = int(page or 1)
            size = int(page_size or 50)
            paginator = OffsetPaginator(qs, page=page_num, page_size=size, max_page_size=500)
            result = paginator.paginate(with_total=True)
            data = [_device_to_dict(d) for d in result["data"]]
            total = result["pagination"].get("total")
            return JsonResponse(
                {
                    "count": total if total is not None else len(data),
                    "data": data,
                    "pagination": result["pagination"],
                },
                status=200,
            )

        data = [_device_to_dict(d) for d in qs]
        return JsonResponse({"count": len(data), "data": data}, status=200)


@method_decorator(csrf_exempt, name="dispatch")
class DeviceDetailView(BasicAuthMixin, View):
    """GET /api/v2/devices/<device_id>"""

    def get(self, request, device_id: int):
        try:
            d = Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")
        return JsonResponse(_device_to_dict(d), status=200)


@method_decorator(csrf_exempt, name="dispatch")
class DeviceCreateView(BasicAuthMixin, ResourcePermissionMixin, JsonBodyMixin, View):
    """
    POST /api/v2/devices
    body:
      {
        "code": "test1",
        "name": "CP500-01",
        "post_topic": "compostlab/v2/test1/telemetry",
        "response_topic": "compostlab/v2/test1/response",
        "note": "...",
        "meta": {...},
        "is_active": true
      }
    """
    resource_type = ResourceType.DEVICE
    action_type = ActionType.CREATE

    def post(self, request):
        body = self.json_body(request)

        code = (body.get("code") or "").strip()
        if not code:
            return _json_400("code is required.")

        d = Device()
        _set_if_exists(d, DEVICE_CODE_FIELD, code)
        _set_if_exists(d, "name", (body.get("name") or "").strip())

        # ✅ 保存 post_topic / response_topic，如果为空则使用默认格式
        if "post_topic" in body:
            post_topic = (body.get("post_topic") or "").strip() or None
            if post_topic is None:
                # 默认格式: compostlab/v2/{code}/telemetry
                post_topic = f"compostlab/v2/{code}/telemetry"
            _set_if_exists(d, "post_topic", post_topic)
        if "response_topic" in body:
            response_topic = (body.get("response_topic") or "").strip() or None
            if response_topic is None:
                # 默认格式: compostlab/v2/{code}/response
                response_topic = f"compostlab/v2/{code}/response"
            _set_if_exists(d, "response_topic", response_topic)
        if "note" in body:
            _set_if_exists(d, "note", (body.get("note") or "").strip())

        if "meta" in body and hasattr(d, "meta") and isinstance(body.get("meta"), dict):
            d.meta = body.get("meta")

        if "configuration" in body and hasattr(d, "configuration"):
            configuration = body.get("configuration")
            if configuration is None:
                d.configuration = {}
            elif isinstance(configuration, dict):
                # 检查是否是设备上传的配置（通过 source 标记）
                is_from_device = body.get("source") == "device"
                
                if is_from_device:
                    # 设备上传的配置：直接更新数据库
                    d.configuration = configuration
                else:
                    # 前端编辑的配置：异步流程
                    # 1. 先下发MQTT命令
                    expected_configuration = _merge_config_patch(getattr(d, "configuration", {}) or {}, configuration)
                    if not getattr(d, "response_topic", ""):
                        return _json_400("Device.response_topic is empty, cannot send config.")
                    
                    try:
                        payload = {
                            "device": _get_device_code(d),
                            "commands": [
                                {
                                    "config": configuration,
                                    "command": "config_update"
                                }
                            ],
                            "server_ts": timezone.now().strftime("%Y-%m-%d %H:%M:%S"),
                        }
                        publish_json(d.response_topic, payload, qos=1, retain=False)
                        # 创建命令记录
                        DeviceCommand.objects.create(
                            device=d,
                            command="config_update",
                            payload=payload,
                            status=DeviceCommand.STATUS_SENT,
                            sent_at=timezone.now(),
                            created_by=getattr(request, "user", None),
                            result={"mqtt": "published", "topic": d.response_topic}
                        )
                    except Exception as e:
                        return JsonResponse(
                            {"detail": f"Failed to send config via MQTT: {str(e)}"},
                            status=500
                        )
                    
                    # 2. 等待设备重新register（最多60秒）
                    # 通过比较 last_seen_at 来检测设备是否重新上线
                    last_seen_before = d.last_seen_at
                    max_wait_time = 60  # 60秒超时
                    check_interval = 1  # 每秒检查一次
                    
                    for _ in range(max_wait_time):
                        time.sleep(check_interval)
                        # 刷新设备状态
                        d.refresh_from_db(fields=["last_seen_at", "configuration"])
                        # 检查 last_seen_at 是否更新（设备重新注册）
                        if d.last_seen_at and d.last_seen_at != last_seen_before:
                            # 设备已重新注册，检查配置是否已更新
                            if d.configuration == expected_configuration:
                                # 配置已更新成功
                                return JsonResponse(
                                    {
                                        "detail": "Config updated successfully",
                                        "device": _device_to_dict(d)
                                    },
                                    status=200
                                )
                            # 配置不一致，继续等待
                    
                    # 3. 超时：设备未在1分钟内重新注册
                    return JsonResponse(
                        {
                            "detail": "Device offline: config sent but device did not re-register within 60 seconds",
                            "status": "timeout",
                            "command_sent": True
                        },
                        status=504  # Gateway Timeout
                    )
                # 如果是设备上传的配置，继续保存
            else:
                return _json_400("configuration must be an object.")

        if "is_active" in body and hasattr(d, "is_active"):
            d.is_active = bool(body.get("is_active"))

        try:
            d.save()
        except Exception as e:
            return _json_400(f"Create device failed: {e}")

        return JsonResponse(_device_to_dict(d), status=201)


@method_decorator(csrf_exempt, name="dispatch")
class DeviceUpdateView(BasicAuthMixin, ResourcePermissionMixin, JsonBodyMixin, View):
    """PATCH/PUT /api/v2/devices/<device_id>"""
    resource_type = ResourceType.DEVICE
    action_type = ActionType.WRITE

    def patch(self, request, device_id: int):
        body = self.json_body(request)
        try:
            d = Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")

        if "name" in body:
            _set_if_exists(d, "name", (body.get("name") or "").strip())

        if "code" in body:
            code = (body.get("code") or "").strip()
            if not code:
                return _json_400("code cannot be empty.")
            _set_if_exists(d, DEVICE_CODE_FIELD, code)

        # ✅ 支持更新 post_topic / response_topic，如果为空则使用默认格式
        if "post_topic" in body:
            post_topic = (body.get("post_topic") or "").strip() or None
            if post_topic is None:
                # 默认格式: compostlab/v2/{code}/telemetry
                code = getattr(d, DEVICE_CODE_FIELD, "")
                post_topic = f"compostlab/v2/{code}/telemetry"
            _set_if_exists(d, "post_topic", post_topic)
        if "response_topic" in body:
            response_topic = (body.get("response_topic") or "").strip() or None
            if response_topic is None:
                # 默认格式: compostlab/v2/{code}/response
                code = getattr(d, DEVICE_CODE_FIELD, "")
                response_topic = f"compostlab/v2/{code}/response"
            _set_if_exists(d, "response_topic", response_topic)
        if "note" in body:
            _set_if_exists(d, "note", (body.get("note") or "").strip())

        if "meta" in body and hasattr(d, "meta"):
            meta = body.get("meta")
            if meta is None:
                d.meta = {}
            elif isinstance(meta, dict):
                d.meta = meta
            else:
                return _json_400("meta must be an object.")

        if "configuration" in body and hasattr(d, "configuration"):
            configuration = body.get("configuration")
            if configuration is None:
                d.configuration = {}
            elif isinstance(configuration, dict):
                # 检查是否是设备上传的配置（通过 source 标记）
                is_from_device = body.get("source") == "device"
                
                if is_from_device:
                    # 设备上传的配置：直接更新数据库
                    d.configuration = configuration
                else:
                    # 前端编辑的配置：异步流程
                    # 1. 先下发MQTT命令
                    current_configuration = getattr(d, "configuration", {}) or {}
                    expected_configuration = _merge_config_patch(
                        current_configuration,
                        configuration,
                    )
                    if expected_configuration == current_configuration:
                        return JsonResponse(
                            {
                                "detail": "Configuration unchanged, skipped sending config command",
                                "status": "skipped",
                                "device": _device_to_dict(d),
                            },
                            status=200,
                        )
                    if not getattr(d, "response_topic", ""):
                        return _json_400("Device.response_topic is empty, cannot send config.")
                    
                    try:
                        payload = {
                            "device": _get_device_code(d),
                            "commands": [
                                {
                                    "config": configuration,
                                    "command": "config_update"
                                }
                            ],
                            "server_ts": timezone.now().strftime("%Y-%m-%d %H:%M:%S"),
                        }
                        publish_json(d.response_topic, payload, qos=1, retain=False)
                        # 创建命令记录
                        DeviceCommand.objects.create(
                            device=d,
                            command="config_update",
                            payload=payload,
                            status=DeviceCommand.STATUS_SENT,
                            sent_at=timezone.now(),
                            created_by=getattr(request, "user", None),
                            result={"mqtt": "published", "topic": d.response_topic}
                        )
                    except Exception as e:
                        return JsonResponse(
                            {"detail": f"Failed to send config via MQTT: {str(e)}"},
                            status=500
                        )
                    
                    # 2. 等待设备重新register（最多60秒）
                    # 通过比较 last_seen_at 来检测设备是否重新上线
                    last_seen_before = d.last_seen_at
                    max_wait_time = 60  # 60秒超时
                    check_interval = 1  # 每秒检查一次
                    
                    for _ in range(max_wait_time):
                        time.sleep(check_interval)
                        # 刷新设备状态
                        d.refresh_from_db(fields=["last_seen_at", "configuration"])
                        # 检查 last_seen_at 是否更新（设备重新注册）
                        if d.last_seen_at and d.last_seen_at != last_seen_before:
                            # 设备已重新注册，检查配置是否已更新
                            if d.configuration == expected_configuration:
                                # 配置已更新成功
                                return JsonResponse(
                                    {
                                        "detail": "Config updated successfully",
                                        "device": _device_to_dict(d)
                                    },
                                    status=200
                                )
                            # 配置不一致，继续等待
                    
                    # 3. 超时：设备未在1分钟内重新注册
                    return JsonResponse(
                        {
                            "detail": "Device offline: config sent but device did not re-register within 60 seconds",
                            "status": "timeout",
                            "command_sent": True
                        },
                        status=504  # Gateway Timeout
                    )
                # 如果是设备上传的配置，继续保存
            else:
                return _json_400("configuration must be an object.")

        if "is_active" in body and hasattr(d, "is_active"):
            d.is_active = bool(body.get("is_active"))

        try:
            d.save()
        except Exception as e:
            return _json_400(f"Update device failed: {e}")

        return JsonResponse(_device_to_dict(d), status=200)

    def put(self, request, device_id: int):
        return self.patch(request, device_id)


@method_decorator(csrf_exempt, name="dispatch")
class DeviceDeleteView(BasicAuthMixin, ResourcePermissionMixin, View):
    """DELETE /api/v2/devices/<device_id>"""
    resource_type = ResourceType.DEVICE
    action_type = ActionType.DELETE

    def delete(self, request, device_id: int):
        try:
            d = Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")
        d.delete()
        return JsonResponse({"detail": "deleted", "device_id": device_id}, status=200)


# -------------------------
# Channels under a device
# -------------------------
class DeviceChannelsView(BasicAuthMixin, View):
    """
    GET /api/v2/devices/<device_id>/channels
    可选：
      - with_latest=1: 同时返回每个 channel 的最新值 latest
    """

    def get(self, request, device_id: int):
        try:
            Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")

        with_latest = _parse_bool(request.GET.get("with_latest"))
        qs = Channel.objects.filter(device_id=device_id).order_by("id")
        channels = [_channel_to_dict(c) for c in qs]

        if not with_latest:
            return JsonResponse(
                {"device_id": device_id, "count": len(channels), "data": channels},
                status=200,
            )

        latest_map = _latest_map_for_device(device_id)
        for ch in channels:
            code = ch.get("code")
            ch["latest"] = latest_map.get(code) if code else None

        return JsonResponse(
            {"device_id": device_id, "count": len(channels), "data": channels},
            status=200,
        )


@method_decorator(csrf_exempt, name="dispatch")
class DeviceTreeView(BasicAuthMixin, View):
    """
    GET /api/v2/devices/tree?with_latest=1
    返回 devices + channels（前端初始化非常方便）
    """

    def get(self, request):
        with_latest = _parse_bool(request.GET.get("with_latest"))
        qs = Device.objects.all().order_by("id")
        q = (request.GET.get("q") or "").strip()
        if q:
            qs = qs.filter(Q(code__icontains=q) | Q(name__icontains=q))
        page = request.GET.get("page")
        page_size = request.GET.get("page_size")

        if page or page_size:
            page_num = int(page or 1)
            size = int(page_size or 50)
            paginator = OffsetPaginator(qs, page=page_num, page_size=size, max_page_size=500)
            result = paginator.paginate(with_total=True)
            devices = list(result["data"])
            pagination = result["pagination"]
            total = pagination.get("total")
        else:
            devices = list(qs)
            pagination = None
            total = None

        out = []
        for d in devices:
            item = _device_to_dict(d)
            qs = Channel.objects.filter(device_id=d.id).order_by("id")
            channels = [_channel_to_dict(c) for c in qs]

            if with_latest:
                latest_map = _latest_map_for_device(d.id)
                for ch in channels:
                    code = ch.get("code")
                    ch["latest"] = latest_map.get(code) if code else None

            item["channels"] = channels
            out.append(item)

        payload = {"count": total if total is not None else len(out), "data": out}
        if pagination:
            payload["pagination"] = pagination
        return JsonResponse(payload, status=200)


@method_decorator(csrf_exempt, name="dispatch")
class ChannelDetailView(BasicAuthMixin, View):
    """GET /api/v2/devices/<device_id>/channels/<channel_id>"""

    def get(self, request, device_id: int, channel_id: int):
        try:
            Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")
        try:
            c = Channel.objects.get(id=channel_id, device_id=device_id)
        except Channel.DoesNotExist:
            return _json_404("Channel not found.")
        return JsonResponse(_channel_to_dict(c), status=200)


@method_decorator(csrf_exempt, name="dispatch")
class ChannelByCodeView(BasicAuthMixin, View):
    """GET /api/v2/devices/<device_id>/channels/by-code/<code>"""

    def get(self, request, device_id: int, code: str):
        try:
            Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")

        # ✅ code 统一转大写（与前端和 ingest 服务保持一致）
        code = (code or "").strip().upper()
        if not code:
            return _json_400("code is required.")

        kwargs = {"device_id": device_id, CHANNEL_CODE_FIELD: code}
        try:
            c = Channel.objects.get(**kwargs)
        except Channel.DoesNotExist:
            return _json_404("Channel not found.")
        return JsonResponse(_channel_to_dict(c), status=200)


@method_decorator(csrf_exempt, name="dispatch")
class ChannelCreateView(BasicAuthMixin, ResourcePermissionMixin, JsonBodyMixin, View):
    """
    resource_type = ResourceType.CHANNEL
    action_type = ActionType.CREATE
    POST /api/v2/devices/<device_id>/channels
    body:
      {
        "code": "TEMP_C",
        "name": "Temperature",
        "unit": "C",
        "metric": "temperature",
        "role": "pile_1",
        "display_name": "堆体温度T1",
        "meta": {...},
        "is_active": true
      }
    """

    def post(self, request, device_id: int):
        try:
            Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")

        body = self.json_body(request)

        # ✅ code 统一转大写（与前端和 ingest 服务保持一致）
        code = (body.get("code") or "").strip().upper()
        if not code:
            return _json_400("code is required.")

        c = Channel(device_id=device_id)
        _set_if_exists(c, CHANNEL_CODE_FIELD, code)

        if "name" in body:
            _set_if_exists(c, "name", (body.get("name") or "").strip())

        if "unit" in body:
            _set_if_exists(c, "unit", (body.get("unit") or "").strip())

        # ✅ 语义字段
        err = _apply_channel_semantic_fields(c, body)
        if err:
            return err

        if "meta" in body and hasattr(c, "meta"):
            meta = body.get("meta")
            if meta is None:
                c.meta = {}
            elif isinstance(meta, dict):
                c.meta = meta
            else:
                return _json_400("meta must be an object.")

        if "is_active" in body and hasattr(c, "is_active"):
            c.is_active = bool(body.get("is_active"))

        try:
            c.save()
        except Exception as e:
            return _json_400(f"Create channel failed: {e}")

        return JsonResponse(_channel_to_dict(c), status=201)


@method_decorator(csrf_exempt, name="dispatch")
class ChannelUpsertView(BasicAuthMixin, ResourcePermissionMixin, JsonBodyMixin, View):
    """
    resource_type = ResourceType.CHANNEL
    action_type = ActionType.WRITE
    PUT /api/v2/devices/<device_id>/channels/by-code/<code>
    幂等 upsert：不存在就创建，存在就更新
    """

    def put(self, request, device_id: int, code: str):
        try:
            Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")

        # ✅ code 统一转大写（与前端和 ingest 服务保持一致）
        code = (code or "").strip().upper()
        if not code:
            return _json_400("code is required.")

        body = self.json_body(request)

        kwargs = {"device_id": device_id, CHANNEL_CODE_FIELD: code}
        c = Channel.objects.filter(**kwargs).first()
        created = False
        if not c:
            c = Channel(device_id=device_id)
            _set_if_exists(c, CHANNEL_CODE_FIELD, code)
            created = True

        if "name" in body:
            _set_if_exists(c, "name", (body.get("name") or "").strip())

        if "unit" in body:
            _set_if_exists(c, "unit", (body.get("unit") or "").strip())

        # ✅ 语义字段
        err = _apply_channel_semantic_fields(c, body)
        if err:
            return err

        if "meta" in body and hasattr(c, "meta"):
            meta = body.get("meta")
            if meta is None:
                c.meta = {}
            elif isinstance(meta, dict):
                c.meta = meta
            else:
                return _json_400("meta must be an object.")

        if "is_active" in body and hasattr(c, "is_active"):
            c.is_active = bool(body.get("is_active"))

        try:
            c.save()
        except Exception as e:
            return _json_400(f"Upsert channel failed: {e}")

        payload = _channel_to_dict(c)
        payload["created"] = created
        return JsonResponse(payload, status=201 if created else 200)


@method_decorator(csrf_exempt, name="dispatch")
class ChannelUpdateView(BasicAuthMixin, ResourcePermissionMixin, JsonBodyMixin, View):
    """PATCH/PUT /api/v2/devices/<device_id>/channels/<channel_id>"""
    resource_type = ResourceType.CHANNEL
    action_type = ActionType.WRITE

    def patch(self, request, device_id: int, channel_id: int):
        try:
            Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")

        body = self.json_body(request)
        try:
            c = Channel.objects.get(id=channel_id, device_id=device_id)
        except Channel.DoesNotExist:
            return _json_404("Channel not found.")

        # ✅ code 统一转大写（与前端和 ingest 服务保持一致）
        if "code" in body:
            code = (body.get("code") or "").strip().upper()
            if not code:
                return _json_400("code cannot be empty.")
            _set_if_exists(c, CHANNEL_CODE_FIELD, code)

        if "name" in body:
            _set_if_exists(c, "name", (body.get("name") or "").strip())

        if "unit" in body:
            _set_if_exists(c, "unit", (body.get("unit") or "").strip())

        # ✅ 语义字段
        err = _apply_channel_semantic_fields(c, body)
        if err:
            return err

        if "meta" in body and hasattr(c, "meta"):
            meta = body.get("meta")
            if meta is None:
                c.meta = {}
            elif isinstance(meta, dict):
                c.meta = meta
            else:
                return _json_400("meta must be an object.")

        if "is_active" in body and hasattr(c, "is_active"):
            c.is_active = bool(body.get("is_active"))

        try:
            c.save()
        except Exception as e:
            return _json_400(f"Update channel failed: {e}")

        return JsonResponse(_channel_to_dict(c), status=200)

    def put(self, request, device_id: int, channel_id: int):
        return self.patch(request, device_id, channel_id)


@method_decorator(csrf_exempt, name="dispatch")
class ChannelDeleteView(BasicAuthMixin, ResourcePermissionMixin, View):
    """DELETE /api/v2/devices/<device_id>/channels/<channel_id>"""
    resource_type = ResourceType.CHANNEL
    action_type = ActionType.DELETE

    def delete(self, request, device_id: int, channel_id: int):
        try:
            Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")
        try:
            c = Channel.objects.get(id=channel_id, device_id=device_id)
        except Channel.DoesNotExist:
            return _json_404("Channel not found.")
        c.delete()
        return JsonResponse(
            {"detail": "deleted", "device_id": device_id, "channel_id": channel_id},
            status=200,
        )


# -------------------------
# Device Commands (Downlink)
# -------------------------
def _command_to_dict(cmd: DeviceCommand) -> dict:
    return {
        "command_id": cmd.id,
        "device_id": cmd.device_id,
        "status": cmd.status,
        "command": cmd.command,
        "payload": cmd.payload,
        "result": cmd.result,
        "created_at": _dt_local_str(cmd.created_at),
        "sent_at": _dt_local_str(cmd.sent_at),
        "acked_at": _dt_local_str(cmd.acked_at),
    }


@method_decorator(csrf_exempt, name="dispatch")
class DeviceCommandListCreateView(
    BasicAuthMixin, ReadOrWritePermissionMixin, JsonBodyMixin, View
):
    resource_type = ResourceType.DEVICE_COMMAND
    """
    GET  /api/v2/devices/<device_id>/commands?status=sent&limit=50
    POST /api/v2/devices/<device_id>/commands

    POST body（贴合 ESP32 的结构化 commands）：
    {
      "commands": [
        {"command": "config_update", "config": {"post_interval": 600000}},
        {"command": "pump", "action": "on"}
      ]
    }

    服务器自动补全：
    - device: device.code
    - server_ts: 服务器时间
    并 publish 到 device.response_topic
    """

    def get(self, request, device_id: int):
        try:
            d = Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")

        status = (request.GET.get("status") or "").strip()
        limit = int((request.GET.get("limit") or "50").strip() or "50")
        limit = max(1, min(limit, 200))

        qs = DeviceCommand.objects.filter(device=d).order_by("-id")
        if status:
            qs = qs.filter(status=status)

        items = [_command_to_dict(x) for x in qs[:limit]]
        return JsonResponse({"count": len(items), "data": items}, status=200)

    def post(self, request, device_id: int):
        try:
            d = Device.objects.get(id=device_id)
        except Device.DoesNotExist:
            return _json_404("Device not found.")

        if not getattr(d, "response_topic", ""):
            return _json_400("Device.response_topic is empty.")

        body = self.json_body(request)
        commands = body.get("commands")

        if not isinstance(commands, list) or len(commands) == 0:
            return _json_400("commands must be a non-empty list.")

        # 组装下发 payload（与你手工下发一致）
        payload = {
            "device": _get_device_code(d),
            "commands": commands,
            "server_ts": timezone.now().strftime("%Y-%m-%d %H:%M:%S"),
        }

        # 尽量提取一个主 command 便于列表筛选
        cmd_name = ""
        if isinstance(commands[0], dict):
            cmd_name = (commands[0].get("command") or "").strip()

        rec = DeviceCommand.objects.create(
            device=d,
            command=cmd_name,
            payload=payload,
            status=DeviceCommand.STATUS_QUEUED,
            created_by=getattr(request, "user", None),
        )

        try:
            publish_json(d.response_topic, payload, qos=1, retain=False)
            rec.status = DeviceCommand.STATUS_SENT
            rec.sent_at = timezone.now()
            rec.result = {"mqtt": "published", "topic": d.response_topic}
            rec.save(update_fields=["status", "sent_at", "result"])
        except Exception as e:
            rec.status = DeviceCommand.STATUS_FAILED
            rec.result = {"mqtt": "failed", "error": str(e), "topic": d.response_topic}
            rec.save(update_fields=["status", "result"])
            return JsonResponse(
                {"detail": "publish failed", "command": _command_to_dict(rec)},
                status=500,
            )

        return JsonResponse(_command_to_dict(rec), status=201)


@method_decorator(csrf_exempt, name="dispatch")
class DeviceCommandDetailView(BasicAuthMixin, ResourcePermissionMixin, View):
    """GET /api/v2/devices/<device_id>/commands/<command_id>"""
    resource_type = ResourceType.DEVICE_COMMAND
    action_type = ActionType.READ

    def get(self, request, device_id: int, command_id: int):
        try:
            rec = DeviceCommand.objects.get(id=command_id, device_id=device_id)
        except DeviceCommand.DoesNotExist:
            return _json_404("Command not found.")
        return JsonResponse(_command_to_dict(rec), status=200)


# -------------------------
# Control Templates
# -------------------------
def _template_to_dict(tpl: ControlTemplate) -> dict:
    return {
        "id": tpl.id,
        "name": tpl.name,
        "description": tpl.description,
        "payload": tpl.payload,
        "is_active": tpl.is_active,
        "device_id": tpl.device_id,
        "created_at": _dt_local_str(tpl.created_at),
        "updated_at": _dt_local_str(tpl.updated_at),
    }


@method_decorator(csrf_exempt, name="dispatch")
class ControlTemplateListView(
    BasicAuthMixin, ReadOrWritePermissionMixin, JsonBodyMixin, View
):
    resource_type = ResourceType.SCRIPT
    """
    GET  /api/v2/control-templates?device_id=<id>&is_active=1
    POST /api/v2/control-templates

    POST body:
    {
      "name": "曝气开启",
      "description": "开启曝气泵60秒",
      "payload": { "commands": [...] },
      "is_active": true,
      "device_id": 123  // 可选，不填则为全局模板
    }
    """

    def get(self, request):
        qs = ControlTemplate.objects.all()

        # 筛选参数
        device_id = request.GET.get("device_id")
        if device_id:
            # 设备维度筛选时，默认包含全局模板（device_id 为 null）
            qs = qs.filter(Q(device_id=device_id) | Q(device_id__isnull=True))

        is_active = _parse_bool(request.GET.get("is_active"))
        if is_active is not None:
            qs = qs.filter(is_active=is_active)

        templates = [_template_to_dict(t) for t in qs.order_by("-created_at")]
        return JsonResponse(
            {"count": len(templates), "data": templates},
            status=200,
        )

    def post(self, request):
        data = self.json_body(request)

        name = data.get("name", "").strip()
        if not name:
            return JsonResponse(
                {"detail": "name is required"},
                status=400,
            )

        payload = data.get("payload", {})
        # 如果 payload 是字符串，尝试解析为 JSON 对象
        if isinstance(payload, str):
            try:
                import json
                payload = json.loads(payload)
            except (json.JSONDecodeError, ValueError):
                return JsonResponse(
                    {"detail": "payload must be valid JSON object"},
                    status=400,
                )

        if not isinstance(payload, dict):
            return JsonResponse(
                {"detail": "payload must be an object"},
                status=400,
            )

        # 可选：关联设备
        device_id = data.get("device_id")
        device = None
        if device_id:
            try:
                device = Device.objects.get(id=device_id)
            except Device.DoesNotExist:
                return _json_404("Device not found.")

        tpl = ControlTemplate.objects.create(
            name=name,
            description=data.get("description", "").strip() or "",
            payload=payload,
            is_active=data.get("is_active", True),
            device=device,
            created_by=request.user if request.user.is_authenticated else None,
        )

        return JsonResponse(_template_to_dict(tpl), status=201)


@method_decorator(csrf_exempt, name="dispatch")
class ControlTemplateDetailView(
    BasicAuthMixin, ReadOrWritePermissionMixin, JsonBodyMixin, View
):
    resource_type = ResourceType.SCRIPT
    """
    GET    /api/v2/control-templates/<id>
    PATCH  /api/v2/control-templates/<id>
    PUT    /api/v2/control-templates/<id>
    DELETE /api/v2/control-templates/<id>
    """

    def get(self, request, template_id: int):
        try:
            tpl = ControlTemplate.objects.get(id=template_id)
        except ControlTemplate.DoesNotExist:
            return _json_404("Template not found.")
        return JsonResponse(_template_to_dict(tpl), status=200)

    def patch(self, request, template_id: int):
        try:
            tpl = ControlTemplate.objects.get(id=template_id)
        except ControlTemplate.DoesNotExist:
            return _json_404("Template not found.")

        data = self.json_body(request)

        if "name" in data:
            name = data["name"].strip()
            if not name:
                return JsonResponse({"detail": "name cannot be empty"}, status=400)
            tpl.name = name

        if "description" in data:
            tpl.description = data["description"].strip() or ""

        if "payload" in data:
            payload = data["payload"]
            # 如果 payload 是字符串，尝试解析为 JSON 对象
            if isinstance(payload, str):
                try:
                    import json
                    payload = json.loads(payload)
                except (json.JSONDecodeError, ValueError):
                    return JsonResponse(
                        {"detail": "payload must be valid JSON object"},
                        status=400,
                    )

            if not isinstance(payload, dict):
                return JsonResponse(
                    {"detail": "payload must be an object"},
                    status=400,
                )
            tpl.payload = payload

        if "is_active" in data:
            tpl.is_active = bool(data["is_active"])

        if "device_id" in data:
            device_id = data["device_id"]
            if device_id:
                try:
                    tpl.device = Device.objects.get(id=device_id)
                except Device.DoesNotExist:
                    return _json_404("Device not found.")
            else:
                tpl.device = None

        tpl.save()

        return JsonResponse(_template_to_dict(tpl), status=200)

    def put(self, request, template_id: int):
        return self.patch(request, template_id)

    def delete(self, request, template_id: int):
        try:
            tpl = ControlTemplate.objects.get(id=template_id)
        except ControlTemplate.DoesNotExist:
            return _json_404("Template not found.")

        tpl.delete()
        return JsonResponse({"detail": "deleted", "id": template_id}, status=200)


# -------------------------
# Device Registration (MQTT)
# -------------------------
@method_decorator(csrf_exempt, name="dispatch")
class DeviceRegisterView(DeviceJWTAuthMixin, JsonBodyMixin, View):
    """
    POST /api/v2/devices/register

    设备上线注册接口（可通过 MQTT 或 HTTP 调用）
    MQTT topic: compostlab/v2/{device_code}/register

    认证要求：
    1. 设备自注册：使用包含 device_code 的 JWT Bearer Token
       Token payload: {"device_code": "device_001", "exp": 1234567890}
    2. 管理员注册：使用管理员 JWT Bearer Token（is_staff 或 role='admin'）
       此时需要通过 body 或 topic 提供 device_code

    Request body:
    {
      "device_code": "device_001",  // 可选（从 token 或 topic 中提取）
      "schema_version": 2,
      "ip_address": "192.168.1.100",
      "timestamp": "2026-01-14T12:00:00Z",
      "configuration": {
        "sampling_interval": 5,
        "data_retention_days": 30,
        "firmware_version": "1.0.0",
        "hardware_version": "v1.2"
      }
    }

    注意：
    - device_code 优先级：JWT token > MQTT topic > request body
    - MQTT topic 格式: compostlab/v2/{device_code}/register
    - 如果设备不存在，会自动创建（需要管理员权限或设备自注册）
    """

    def post(self, request):
        body = self.json_body(request)

        # 提取 device_code
        device_code = None
        registration_type = getattr(request, "device_registration_type", None)

        # 对于设备自注册，需要验证 token 和请求中的 device_code 是否一致
        if registration_type == "self":
            token_device_code = getattr(request, "device_code_from_token", None)

            # 1. 优先从 body 中获取 device_code
            if "device_code" in body:
                device_code = (body.get("device_code") or "").strip()

            # 2. 如果 body 中没有，从 token 中获取
            elif token_device_code:
                device_code = token_device_code

            # 3. 尝试从 topic 中提取
            else:
                topic = getattr(request, "mqtt_topic", None) or request.GET.get("topic", "")
                if topic:
                    parts = [p for p in topic.strip().split("/") if p]
                    if len(parts) >= 4 and parts[0].lower() == "compostlab" and parts[1].lower() == "v2":
                        # compostlab/v2/{device_code}/register
                        if parts[3].lower() == "register":
                            device_code = parts[2].strip()

            # 验证 device_code 是否存在
            if not device_code:
                return _json_400("device_code is required (from request body, MQTT topic, or JWT token)")

            # 验证 token 中的 device_code 与请求中的 device_code 是否一致
            # 如果请求中提供了 device_code，必须与 token 中的一致
            if token_device_code and device_code != token_device_code:
                return _json_400("device_code in request does not match device_code in JWT token")

        # 对于管理员注册
        elif registration_type == "admin":
            # 1. 优先从 body 中获取 device_code
            if "device_code" in body:
                device_code = (body.get("device_code") or "").strip()

            # 2. 尝试从 topic 中提取
            topic = getattr(request, "mqtt_topic", None) or request.GET.get("topic", "")
            if topic and not device_code:
                parts = [p for p in topic.strip().split("/") if p]
                if len(parts) >= 4 and parts[0].lower() == "compostlab" and parts[1].lower() == "v2":
                    # compostlab/v2/{device_code}/register
                    if parts[3].lower() == "register":
                        device_code = parts[2].strip()

            if not device_code:
                return _json_400("device_code is required (from request body or MQTT topic)")

        # 查找或创建设备
        try:
            d = Device.objects.get(**{DEVICE_CODE_FIELD: device_code})
            is_new = False
        except Device.DoesNotExist:
            # 设备不存在时：
            # - 管理员可以创建新设备
            # - 设备自注册也可以创建新设备
            d = Device()
            _set_if_exists(d, DEVICE_CODE_FIELD, device_code)
            _set_if_exists(d, "name", device_code)
            d.is_active = True
            d.save()
            is_new = True

        # 更新 IP 地址
        ip_address = (body.get("ip_address") or "").strip()
        if ip_address and hasattr(d, "ip_address"):
            d.ip_address = ip_address

        # 更新注册时间（如果是新设备或首次注册）
        if is_new and hasattr(d, "register_at"):
            d.register_at = timezone.now()

        # 更新配置信息
        if "configuration" in body and isinstance(body.get("configuration"), dict) and hasattr(d, "configuration"):
            d.configuration = body.get("configuration")

        # 更新最后上线时间
        d.last_seen_at = timezone.now()

        d.save()

        # 返回设备信息
        response = _device_to_dict(d)
        response["registered"] = not is_new  # false 表示新创建，true 表示已存在并更新
        response["registration_type"] = registration_type  # 标识注册方式：'self' 或 'admin'

        return JsonResponse(response, status=201 if is_new else 200)
