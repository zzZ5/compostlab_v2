# apps/telemetry/admin.py
from __future__ import annotations

import json
from django.contrib import admin
from django.utils.html import format_html

from apps.telemetry.models import TelemetryRaw, TelemetryKV


def _field_names(model) -> set[str]:
    return {f.name for f in model._meta.fields}


RAW_FIELDS = _field_names(TelemetryRaw)
KV_FIELDS = _field_names(TelemetryKV)


def _kv_code_field() -> str:
    # 你现在希望统一成 code
    for cand in ("code", "channel_code", "var_code"):
        if cand in KV_FIELDS:
            return cand
    return "code"


KV_CODE_FIELD = _kv_code_field()


@admin.register(TelemetryRaw)
class TelemetryRawAdmin(admin.ModelAdmin):
    list_display = ("id", "device", "source", "topic", "payload_hash", "created_at")
    list_filter = ("source",) + (("device",) if "device" in RAW_FIELDS else ())
    search_fields = ("topic", "payload_hash", "device__name")
    ordering = ("-id",)
    readonly_fields = tuple(
        f
        for f in ("device", "topic", "payload", "payload_hash", "source", "created_at")
        if f in RAW_FIELDS
    )

    def created_at(self, obj: TelemetryRaw):
        return getattr(obj, "created_at", None)


@admin.register(TelemetryKV)
class TelemetryKVAdmin(admin.ModelAdmin):
    # 注意：这里把 channel_code 彻底换成 code
    list_display = (
        "id",
        "device",
        "code",
        "ts",
        "value",
        "unit",
        "quality_flag",
        "source",
        "raw_id_from_meta",
    )
    list_filter = tuple(
        f for f in ("device", "source", "quality_flag") if f in KV_FIELDS
    ) + (("unit",) if "unit" in KV_FIELDS else ())
    search_fields = (
        "device__name",
        "device__code",
        "device__device_code",
        "device__device_uid",
        KV_CODE_FIELD,
    )
    ordering = ("-ts", "-id") if "ts" in KV_FIELDS else ("-id",)
    date_hierarchy = "ts" if "ts" in KV_FIELDS else None

    readonly_fields = tuple(
        f
        for f in (
            "device",
            "ts",
            "value",
            "unit",
            "quality_flag",
            "source",
            "meta",
            "created_at",
        )
        if f in KV_FIELDS
    )

    def code(self, obj: TelemetryKV) -> str:
        return getattr(obj, KV_CODE_FIELD, "") or ""

    code.short_description = "code"

    def raw_id_from_meta(self, obj: TelemetryKV):
        meta = getattr(obj, "meta", None)
        if isinstance(meta, dict):
            rid = meta.get("raw_id")
            return rid
        return None

    raw_id_from_meta.short_description = "raw_id"

    def ts(self, obj: TelemetryKV):
        return getattr(obj, "ts", None)

    def value(self, obj: TelemetryKV):
        return getattr(obj, "value", None)

    def unit(self, obj: TelemetryKV):
        return getattr(obj, "unit", "") or ""

    def quality_flag(self, obj: TelemetryKV):
        return getattr(obj, "quality_flag", None)

    def source(self, obj: TelemetryKV):
        return getattr(obj, "source", None)
