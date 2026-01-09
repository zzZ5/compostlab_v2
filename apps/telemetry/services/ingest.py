# apps/telemetry/services/ingest.py
from __future__ import annotations

import json
import hashlib
from dataclasses import dataclass
from datetime import datetime
from typing import Any, List, Optional, Tuple

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.devices.models import Device, Channel
from apps.runs.models import RunWindow
from apps.telemetry.models import TelemetryRaw, TelemetryKV


# -------------------------
# small utils
# -------------------------
def _sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _parse_ts(ts_value) -> datetime:
    """
    解析时间戳（优先你要求的格式：'YYYY-MM-DD HH:MM:SS'）
    也兼容 ISO8601 / datetime / None
    """
    if not ts_value:
        return timezone.now()

    if isinstance(ts_value, datetime):
        return (
            ts_value if timezone.is_aware(ts_value) else timezone.make_aware(ts_value)
        )

    if isinstance(ts_value, str):
        s = ts_value.strip()

        # 1) 你的默认格式：2025-12-19 17:08:45
        try:
            dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
            tz = timezone.get_current_timezone()
            return timezone.make_aware(dt, tz)
        except Exception:
            pass

        # 2) ISO8601：2025-12-19T17:08:45+08:00 / Z
        try:
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
            return dt if timezone.is_aware(dt) else timezone.make_aware(dt)
        except Exception:
            pass

    return timezone.now()


def _match_run(device: Device, ts: datetime):
    """
    根据 RunWindow 给数据匹配 run（可能匹配不到，允许 None）
    start_at <= ts < end_at；若 end_at 为空表示进行中
    """
    window = (
        RunWindow.objects.filter(device=device)
        .filter(start_at__lte=ts)
        .filter(Q(end_at__gt=ts) | Q(end_at__isnull=True))
        .order_by("-start_at")
        .first()
    )
    return window.run if window else None


# -------------------------
# field introspection (robust to evolving models)
# -------------------------
def _field_names(model) -> set[str]:
    return {f.name for f in model._meta.fields}


DEVICE_FIELDS = _field_names(Device)
CHANNEL_FIELDS = _field_names(Channel)
KV_FIELDS = _field_names(TelemetryKV)


def _device_code_field() -> str:
    # 你最终推荐是 Device.code
    for cand in ("code", "device_code", "key", "device_id", "uid", "device_uid"):
        if cand in DEVICE_FIELDS:
            return cand
    return "code"


def _channel_code_field() -> str:
    # 你最终推荐是 Channel.code
    for cand in ("code", "channel_code", "var_code"):
        if cand in CHANNEL_FIELDS:
            return cand
    return "code"


def _kv_code_field() -> str:
    # 你最终推荐是 TelemetryKV.code
    for cand in ("code", "channel_code", "var_code"):
        if cand in KV_FIELDS:
            return cand
    return "code"


DEVICE_CODE_FIELD = _device_code_field()
CHANNEL_CODE_FIELD = _channel_code_field()
KV_CODE_FIELD = _kv_code_field()


def _set_if_exists(obj, field: str, value):
    if hasattr(obj, field):
        setattr(obj, field, value)


# -------------------------
# V2 topic + payload parsing
# -------------------------
def _extract_device_code_from_topic(topic: str) -> Optional[str]:
    """
    Only accept:
      compostlab/v2/{device_code}/telemetry
    """
    if not isinstance(topic, str) or not topic.strip():
        return None
    parts = [p for p in topic.strip().split("/") if p]
    if len(parts) != 4:
        return None
    if parts[0].lower() != "compostlab":
        return None
    if parts[1].lower() != "v2":
        return None
    if parts[3].lower() != "telemetry":
        return None
    dc = parts[2].strip()
    return dc or None


@dataclass
class Point:
    code: str
    value: float
    unit: str
    quality: str
    # ✅ 可选语义字段：设备端如果能带，就自动补到 Channel（只在 Channel 对应字段为空时补齐）
    metric: str = ""
    role: str = ""
    display_name: str = ""


def _normalize_code(s: Any) -> str:
    """
    Normalize channel code to str.
    过滤 None，去除前后空白，转大写（避免大小写导致的重复 channel）。
    """
    return str(s or "").strip().upper()


def _extract_points_v2(payload: dict) -> List[Point]:
    """
    Support TWO V2 shapes:
      A) channels list (recommended)
         {
           "schema_version":2,
           "ts":"...",
           "channels":[{"code":"TEMP_C","value":..,"unit":"C","quality":"OK"}, ...]
         }

      B) values dict (+ optional units/quality)
         {
           "schema_version":2,
           "ts":"...",
           "values":{"TEMP_C":47.7},
           "units":{"TEMP_C":"C"},
           "quality":{"TEMP_C":"OK"}
         }

    ✅ 额外支持：channels[] 内携带 metric/role/display_name
       （仅用于自动补齐 Channel 语义字段，不影响 TelemetryKV 存储）
    """
    points: List[Point] = []

    # 可选：整体的 channel_meta 映射（key: code -> {metric,role,display_name}）
    channel_meta_map = payload.get("channel_meta")
    if not isinstance(channel_meta_map, dict):
        channel_meta_map = {}

    channels = payload.get("channels")
    if isinstance(channels, list):
        for ch in channels:
            if not isinstance(ch, dict):
                continue
            code = _normalize_code(ch.get("code") or ch.get("channel_code"))
            if not code:
                continue
            if "value" not in ch:
                continue
            try:
                v = float(ch.get("value"))
            except Exception:
                continue

            unit = str(ch.get("unit") or "").strip()
            quality = str(ch.get("quality") or "OK").strip() or "OK"

            # ✅ 从 channels[] 读取语义字段
            metric = str(ch.get("metric") or "").strip()
            role = str(ch.get("role") or "").strip()
            display_name = str(
                ch.get("display_name") or ch.get("displayName") or ""
            ).strip()

            # ✅ 如果 payload 顶层提供了 channel_meta，可作为兜底
            meta2 = (
                channel_meta_map.get(code)
                if isinstance(channel_meta_map.get(code), dict)
                else {}
            )
            if not metric:
                metric = str(meta2.get("metric") or "").strip()
            if not role:
                role = str(meta2.get("role") or "").strip()
            if not display_name:
                display_name = str(
                    meta2.get("display_name") or meta2.get("displayName") or ""
                ).strip()

            points.append(
                Point(
                    code=code,
                    value=v,
                    unit=unit,
                    quality=quality,
                    metric=metric,
                    role=role,
                    display_name=display_name,
                )
            )
        return points

    values = payload.get("values")
    if isinstance(values, dict):
        units_map = (
            payload.get("units") if isinstance(payload.get("units"), dict) else {}
        )
        quality_map = (
            payload.get("quality") if isinstance(payload.get("quality"), dict) else {}
        )

        for k, v in values.items():
            code = _normalize_code(k)
            if not code:
                continue
            try:
                fv = float(v)
            except Exception:
                continue

            unit = str(units_map.get(k, units_map.get(code, "")) or "").strip()
            quality = (
                str(quality_map.get(k, quality_map.get(code, "OK")) or "OK").strip()
                or "OK"
            )

            # ✅ values{} 模式也支持顶层 channel_meta
            meta2 = (
                channel_meta_map.get(code)
                if isinstance(channel_meta_map.get(code), dict)
                else {}
            )
            metric = str(meta2.get("metric") or "").strip()
            role = str(meta2.get("role") or "").strip()
            display_name = str(
                meta2.get("display_name") or meta2.get("displayName") or ""
            ).strip()

            points.append(
                Point(
                    code=code,
                    value=fv,
                    unit=unit,
                    quality=quality,
                    metric=metric,
                    role=role,
                    display_name=display_name,
                )
            )
        return points

    return points


def _ensure_device(device_code: str) -> Device:
    device_code = (device_code or "").strip()
    if not device_code:
        raise ValueError("device_code is empty")

    d = Device.objects.filter(**{DEVICE_CODE_FIELD: device_code}).first()
    if d:
        return d

    d = Device()
    _set_if_exists(d, DEVICE_CODE_FIELD, device_code)
    _set_if_exists(d, "name", device_code)
    d.save()
    return d


def _ensure_channel(device: Device, code: str, unit: str = "") -> Channel:
    """
    ✅ 自动注册 channel：仅确保 (device, code) 存在。
    ⚠️ 不在这里“猜测语义类型”。语义由 admin 或设备端显式提供（见 _apply_channel_semantics_if_empty）。
    """
    code = _normalize_code(code)
    unit = (unit or "").strip()

    if not code:
        raise ValueError("channel code is empty")

    defaults = {}

    if "unit" in CHANNEL_FIELDS:
        defaults["unit"] = unit
    if "name" in CHANNEL_FIELDS:
        defaults["name"] = ""
    if "meta" in CHANNEL_FIELDS:
        defaults["meta"] = {
            "auto_registered": True,
            "first_seen_at": timezone.now().isoformat(),
            "last_unit_seen": unit,
        }
    if "is_active" in CHANNEL_FIELDS:
        defaults["is_active"] = True

    lookup = {"device": device, CHANNEL_CODE_FIELD: code}
    ch, _created = Channel.objects.get_or_create(**lookup, defaults=defaults)

    # unit 补齐：不覆盖已有 unit
    if unit and ("unit" in CHANNEL_FIELDS) and (not getattr(ch, "unit", "")):
        ch.unit = unit
        # 同步 meta.last_unit_seen（如果有 meta）
        if "meta" in CHANNEL_FIELDS and isinstance(getattr(ch, "meta", None), dict):
            meta = dict(ch.meta)
            meta["last_unit_seen"] = unit
            ch.meta = meta
            ch.save(update_fields=["unit", "meta"])
        else:
            ch.save(update_fields=["unit"])
        return ch

    # 如果 unit 变化，也记录一下 last_unit_seen（不强制写 unit）
    if (
        unit
        and "meta" in CHANNEL_FIELDS
        and isinstance(getattr(ch, "meta", None), dict)
    ):
        meta = dict(ch.meta)
        if meta.get("last_unit_seen") != unit:
            meta["last_unit_seen"] = unit
            ch.meta = meta
            ch.save(update_fields=["meta"])

    return ch


def _apply_channel_semantics_if_empty(ch: Channel, p: Point) -> None:
    """
    ✅ 如果设备端在 payload 中携带了 metric/role/display_name，则自动补齐到 Channel。
    ✅ 只在 Channel 对应字段为空时写入；永不覆盖 admin 手动配置。
    """
    update_fields: List[str] = []

    if p.metric and "metric" in CHANNEL_FIELDS:
        cur = (getattr(ch, "metric", "") or "").strip()
        if not cur:
            ch.metric = p.metric.strip()
            update_fields.append("metric")

    if p.role and "role" in CHANNEL_FIELDS:
        cur = (getattr(ch, "role", "") or "").strip()
        if not cur:
            ch.role = p.role.strip()
            update_fields.append("role")

    if p.display_name and "display_name" in CHANNEL_FIELDS:
        cur = (getattr(ch, "display_name", "") or "").strip()
        if not cur:
            ch.display_name = p.display_name.strip()
            update_fields.append("display_name")

    if update_fields:
        ch.save(update_fields=update_fields)


def _touch_device(device: Device):
    if hasattr(device, "last_seen_at"):
        device.last_seen_at = timezone.now()
        device.save(update_fields=["last_seen_at"])


# -------------------------
# main ingest entry
# -------------------------
def ingest_payload(
    *,
    device_code: Optional[str] = None,
    device_key: Optional[str] = None,  # 兼容旧调用，但不推荐
    topic: str,
    payload: dict,
    source: str = "mqtt",
    dedup_by_hash: bool = True,
) -> Tuple[int, int]:
    """
    ✅ Unified ingest entry for MQTT/HTTP.
    - Only accept V2 (schema_version>=2)
    - Topic recommended: compostlab/v2/{device_code}/telemetry
    - Payload points: channels[] OR values{}
    - Always store TelemetryRaw, KV 写入失败不影响 Raw

    ✅ 支持可选语义字段：metric/role/display_name（仅自动补齐 Channel 空字段）
    """

    if not isinstance(payload, dict):
        raise ValueError("payload must be dict")

    # ---- device_code: arg > payload.device_code > topic ----
    dc = (device_code or "").strip() or str(payload.get("device_code") or "").strip()
    if not dc:
        dc = _extract_device_code_from_topic(topic) or ""

    # fallback (legacy)
    if not dc and device_key:
        dc = str(device_key).strip()

    if not dc:
        raise ValueError("Missing device_code (arg or payload.device_code or v2 topic)")

    # ---- (recommended) strict topic match if topic matches v2 pattern ----
    if isinstance(topic, str) and topic.strip():
        extracted = _extract_device_code_from_topic(topic)
        if extracted and extracted != dc:
            raise ValueError(
                f"device_code mismatch: topic={extracted} payload/arg={dc}"
            )

    device = _ensure_device(dc)

    # ---- store raw first ----
    raw_text = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    payload_hash = _sha256(raw_text)

    if dedup_by_hash:
        existed = TelemetryRaw.objects.filter(
            device=device, payload_hash=payload_hash
        ).first()
        if existed:
            _touch_device(device)
            return existed.id, 0

    raw = TelemetryRaw.objects.create(
        device=device,
        topic=topic or "",
        payload=payload,
        payload_hash=payload_hash,
        source=source,
    )

    # ---- v2 gate ----
    schema_version = payload.get("schema_version")
    if not (isinstance(schema_version, int) and schema_version >= 2):
        _touch_device(device)
        return raw.id, 0

    # ---- timestamp ----
    ts = _parse_ts(
        payload.get("ts") or payload.get("measured_time") or payload.get("time")
    )

    # ---- extract points ----
    points = _extract_points_v2(payload)
    if not points:
        _touch_device(device)
        return raw.id, 0

    run = _match_run(device, ts)
    run_id = run.id if run else None

    meta_root = payload.get("meta") if isinstance(payload.get("meta"), dict) else {}
    seq = payload.get("seq")

    kv_rows: List[TelemetryKV] = []

    with transaction.atomic():
        for p in points:
            ch = _ensure_channel(device=device, code=p.code, unit=p.unit)
            # ✅ 自动补齐语义（只补空字段，永不覆盖）
            _apply_channel_semantics_if_empty(ch, p)

            kv_kwargs = dict(
                device=device,
                ts=ts,
                value=p.value,
                unit=p.unit,
                quality_flag=p.quality,
                source=source,
            )

            # meta 字段可能还没迁移到位：存在才写
            if "meta" in KV_FIELDS:
                kv_kwargs["meta"] = {
                    "raw_id": raw.id,
                    "schema_version": schema_version,
                    "seq": seq,
                    "run_id": run_id,
                    "meta": meta_root,
                }

            kv = TelemetryKV(**kv_kwargs)

            # set kv.code (or legacy field)
            _set_if_exists(kv, KV_CODE_FIELD, _normalize_code(p.code))
            kv_rows.append(kv)

        if kv_rows:
            TelemetryKV.objects.bulk_create(kv_rows, batch_size=1000)

    _touch_device(device)
    return raw.id, len(kv_rows)
