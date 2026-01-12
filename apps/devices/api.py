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

from typing import Dict, Optional

from django.db import connection
from django.http import JsonResponse
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils import timezone
from django.utils.decorators import method_decorator

from apps.api.mixins import BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin
from apps.devices.models import Device, Channel, DeviceCommand, ControlTemplate, ScriptTemplate, ScriptExecution
from apps.devices.services.mqtt_pub import publish_json
from apps.devices.services.script_executor import ScriptExecutor, ThresholdMonitor


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
    - 返回 JsonResponse 表示错误；None 表示 ok
    """
    if "metric" in body:
        _set_if_exists(c, "metric", (body.get("metric") or "").strip())
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
class DeviceCreateView(BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View):
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

        if "is_active" in body and hasattr(d, "is_active"):
            d.is_active = bool(body.get("is_active"))

        try:
            d.save()
        except Exception as e:
            return _json_400(f"Create device failed: {e}")

        return JsonResponse(_device_to_dict(d), status=201)


@method_decorator(csrf_exempt, name="dispatch")
class DeviceUpdateView(BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View):
    """PATCH/PUT /api/v2/devices/<device_id>"""

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
class DeviceDeleteView(BasicAuthMixin, StaffRequiredMixin, View):
    """DELETE /api/v2/devices/<device_id>"""

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
        devices = list(Device.objects.all().order_by("id"))

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

        return JsonResponse({"count": len(out), "data": out}, status=200)


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
class ChannelCreateView(BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View):
    """
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
class ChannelUpsertView(BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View):
    """
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
class ChannelUpdateView(BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View):
    """PATCH/PUT /api/v2/devices/<device_id>/channels/<channel_id>"""

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
class ChannelDeleteView(BasicAuthMixin, StaffRequiredMixin, View):
    """DELETE /api/v2/devices/<device_id>/channels/<channel_id>"""

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
    BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View
):
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
class DeviceCommandDetailView(BasicAuthMixin, StaffRequiredMixin, View):
    """GET /api/v2/devices/<device_id>/commands/<command_id>"""

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
    BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View
):
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
            qs = qs.filter(device_id=device_id)

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
    BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View
):
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
