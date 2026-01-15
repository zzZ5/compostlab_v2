"""
设备注册服务

处理设备上线注册逻辑：
- 自动创建设备（如果不存在）
- 更新 IP 地址
- 保存配置信息
- 更新注册时间
"""

import re
from datetime import datetime
from django.utils import timezone


def _parse_timestamp(ts_value) -> datetime | None:
    """解析多种时间戳格式"""
    if not ts_value:
        return None

    # 字符串时间戳（ISO 8601 格式）
    if isinstance(ts_value, str):
        for fmt in (
            "%Y-%m-%dT%H:%M:%S.%fZ",
            "%Y-%m-%dT%H:%M:%SZ",
            "%Y-%m-%dT%H:%M:%S%z",
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M:%S.%f",
        ):
            try:
                return datetime.strptime(ts_value, fmt)
            except ValueError:
                continue
        return None

    # 数字时间戳（秒或毫秒）
    try:
        ts_float = float(ts_value)
        if ts_float > 1e10:  # 毫秒时间戳
            ts_float = ts_float / 1000
        return datetime.fromtimestamp(ts_float, tz=timezone.utc)
    except (ValueError, OSError):
        return None


def _field_names(model) -> set[str]:
    """获取模型所有字段名"""
    return {f.name for f in model._meta.fields}


def _device_code_field() -> str:
    """获取设备编码字段名"""
    from apps.devices.models import Device
    for cand in ("code", "device_code", "key", "device_uid"):
        if cand in _field_names(Device):
            return cand
    return "code"


def _set_if_exists(obj, field: str, value):
    """仅当对象存在该字段时才赋值"""
    if hasattr(obj, field):
        setattr(obj, field, value)


def register_device_from_payload(
    *,
    device_code: str,
    payload: dict,
    topic: str = "",
    source: str = "mqtt"
) -> dict:
    """
    处理设备注册逻辑

    Args:
        device_code: 设备编码（从 MQTT topic 或 payload 提取）
        payload: 注册 payload
        topic: MQTT topic（可选）
        source: 数据来源（mqtt/http）

    Returns:
        dict: 包含设备信息和注册状态
    """
    from apps.devices.models import Device

    device_code = (device_code or "").strip()
    if not device_code:
        raise ValueError("device_code is required")

    DEVICE_CODE_FIELD = _device_code_field()

    # 查找或创建设备
    try:
        device = Device.objects.get(**{DEVICE_CODE_FIELD: device_code})
        is_new = False
    except Device.DoesNotExist:
        device = Device()
        _set_if_exists(device, DEVICE_CODE_FIELD, device_code)
        _set_if_exists(device, "name", device_code)
        device.is_active = True
        is_new = True

    # 更新 IP 地址
    ip_address = (payload.get("ip_address") or "").strip()
    if ip_address and hasattr(device, "ip_address"):
        device.ip_address = ip_address

    # 解析时间戳字段（支持 timestamp、ts、time、measured_time）
    timestamp_value = None
    for field in ("timestamp", "ts", "time", "measured_time"):
        if field in payload:
            ts_value = payload.get(field)
            timestamp_value = _parse_timestamp(ts_value)
            if timestamp_value:
                break

    # 更新注册时间（如果是新设备或首次注册）
    if is_new and hasattr(device, "register_at") and not device.register_at:
        device.register_at = timestamp_value if timestamp_value else timezone.now()

    # 更新配置信息（支持 config 和 configuration 两种字段名）
    config_data = payload.get("config") or payload.get("configuration")
    if config_data and isinstance(config_data, dict) and hasattr(device, "configuration"):
        device.configuration = config_data

    # 更新最后上线时间（优先使用 payload 中的时间戳）
    if hasattr(device, "last_seen_at"):
        device.last_seen_at = timestamp_value if timestamp_value else timezone.now()

    # 保存设备信息
    device.save()

    return {
        "device_id": device.id,
        "device_code": device_code,
        "is_new": is_new,
        "ip_address": getattr(device, "ip_address", ""),
        "register_at": getattr(device, "register_at", None),
        "configuration": getattr(device, "configuration", {}),
    }
