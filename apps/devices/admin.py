# apps/devices/admin.py
from __future__ import annotations

from django.contrib import admin
from django.utils.html import format_html

from apps.devices.models import Device, Channel, DeviceCommand, ControlTemplate, ScriptTemplate, ScriptExecution


def _field_names(model) -> set[str]:
    return {f.name for f in model._meta.fields}


DEVICE_FIELDS = _field_names(Device)
CHANNEL_FIELDS = _field_names(Channel)
CMD_FIELDS = _field_names(DeviceCommand)


def _device_code_field() -> str:
    for cand in ("code", "device_code", "key", "device_id", "uid", "device_uid"):
        if cand in DEVICE_FIELDS:
            return cand
    return "code"


DEVICE_CODE_FIELD = _device_code_field()


def _channel_code_field() -> str:
    # 你希望统一成 code，但历史字段可能是 channel_code/var_code
    for cand in ("code", "channel_code", "var_code"):
        if cand in CHANNEL_FIELDS:
            return cand
    return "code"


CHANNEL_CODE_FIELD = _channel_code_field()


def _cmd_status_field() -> str:
    for cand in ("status", "state"):
        if cand in CMD_FIELDS:
            return cand
    return "status"


CMD_STATUS_FIELD = _cmd_status_field()


def _cmd_command_field() -> str:
    for cand in ("command", "cmd", "name"):
        if cand in CMD_FIELDS:
            return cand
    return "command"


CMD_COMMAND_FIELD = _cmd_command_field()


@admin.register(Device)
class DeviceAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "name",
        "device_code",
        "is_active",
        "last_seen_at",
        "post_topic",
        "response_topic",
        "command_count",
        "last_command_status",
        "created_at",
        "updated_at",
    )
    list_filter = ("is_active",) if "is_active" in DEVICE_FIELDS else ()
    search_fields = ("name", DEVICE_CODE_FIELD)
    ordering = ("-id",)
    readonly_fields = tuple(
        f for f in ("created_at", "updated_at", "last_seen_at") if f in DEVICE_FIELDS
    )

    def device_code(self, obj: Device) -> str:
        return getattr(obj, DEVICE_CODE_FIELD, "") or ""

    device_code.short_description = "code"

    def is_active(self, obj: Device):
        return getattr(obj, "is_active", None)

    def last_seen_at(self, obj: Device):
        return getattr(obj, "last_seen_at", None)

    def post_topic(self, obj: Device):
        return getattr(obj, "post_topic", None)

    def response_topic(self, obj: Device):
        return getattr(obj, "response_topic", None)

    def created_at(self, obj: Device):
        return getattr(obj, "created_at", None)

    def updated_at(self, obj: Device):
        return getattr(obj, "updated_at", None)

    # --- Commands overview ---
    def command_count(self, obj: Device) -> int:
        # related_name="commands"（推荐实现）
        rel = getattr(obj, "commands", None)
        return rel.count() if rel is not None else 0

    command_count.short_description = "commands"

    def last_command_status(self, obj: Device) -> str:
        rel = getattr(obj, "commands", None)
        if rel is None:
            return "-"
        last = rel.order_by("-id").first()
        if not last:
            return "-"

        status = getattr(last, CMD_STATUS_FIELD, "") or ""
        color = {
            "queued": "#888",
            "sent": "blue",
            "acked": "green",
            "failed": "red",
        }.get(status, "black")
        return format_html('<b style="color:{}">{}</b>', color, status or "-")

    last_command_status.short_description = "last cmd"


@admin.register(Channel)
class ChannelAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "device",
        "code",
        "channel_name",
        "metric",
        "role",
        "display_name",
        "unit",
        "is_active",
        "created_at",
        "updated_at",
    )

    list_filter = (
        ("device",)
        + (("is_active",) if "is_active" in CHANNEL_FIELDS else ())
        + ("metric", "role", "is_active")
    )
    search_fields = (
        "device__name",
        f"device__{DEVICE_CODE_FIELD}",
        CHANNEL_CODE_FIELD,
        "name",
        "display_name",
        "metric",
        "role",
    )
    ordering = ("device_id", "id")
    readonly_fields = tuple(
        f for f in ("created_at", "updated_at") if f in CHANNEL_FIELDS
    )

    def code(self, obj: Channel) -> str:
        return getattr(obj, CHANNEL_CODE_FIELD, "") or ""

    code.short_description = "code"

    def channel_name(self, obj: Channel) -> str:
        return getattr(obj, "name", "") or getattr(obj, "channel_name", "") or ""

    def unit(self, obj: Channel) -> str:
        return getattr(obj, "unit", "") or ""

    def is_active(self, obj: Channel):
        return getattr(obj, "is_active", None)

    def created_at(self, obj: Channel):
        return getattr(obj, "created_at", None)

    def updated_at(self, obj: Channel):
        return getattr(obj, "updated_at", None)


@admin.register(DeviceCommand)
class DeviceCommandAdmin(admin.ModelAdmin):
    """
    设备下发命令记录后台：强烈建议保留（运维/排错/审计核心）
    """

    list_display = (
        "id",
        "device",
        "device_code",
        "cmd",
        "status_colored",
        "created_at",
        "sent_at",
        "acked_at",
        "created_by",
    )

    list_filter = ("device", CMD_STATUS_FIELD, CMD_COMMAND_FIELD)
    search_fields = ("device__name", f"device__{DEVICE_CODE_FIELD}", CMD_COMMAND_FIELD)
    ordering = ("-id",)

    # 避免误删历史命令（你也可以按需打开）
    actions = None

    def has_delete_permission(self, request, obj=None):
        return False

    # readonly：命令记录通常不建议后台手动改（否则审计不可信）
    readonly_fields = tuple(
        f
        for f in (
            "device",
            CMD_COMMAND_FIELD,
            "payload",
            CMD_STATUS_FIELD,
            "created_by",
            "created_at",
            "sent_at",
            "acked_at",
            "result",
        )
        if f in CMD_FIELDS or f in ("device", "created_by")
    )

    def device_code(self, obj: DeviceCommand) -> str:
        d = getattr(obj, "device", None)
        if not d:
            return ""
        return getattr(d, DEVICE_CODE_FIELD, "") or ""

    device_code.short_description = "device_code"

    def cmd(self, obj: DeviceCommand) -> str:
        return getattr(obj, CMD_COMMAND_FIELD, "") or ""

    cmd.short_description = "command"

    def status_colored(self, obj: DeviceCommand) -> str:
        status = getattr(obj, CMD_STATUS_FIELD, "") or ""
        color = {
            "queued": "#888",
            "sent": "blue",
            "acked": "green",
            "failed": "red",
        }.get(status, "black")
        return format_html('<b style="color:{}">{}</b>', color, status or "-")

    status_colored.short_description = "status"


@admin.register(ControlTemplate)
class ControlTemplateAdmin(admin.ModelAdmin):
    """
    控制模板后台管理
    """

    list_display = (
        "id",
        "name",
        "device",
        "is_active",
        "created_at",
        "updated_at",
    )
    list_filter = ("device", "is_active")
    search_fields = ("name", "description")
    ordering = ("-id",)
    readonly_fields = ("created_at", "updated_at")

    def device(self, obj: ControlTemplate):
        return getattr(obj, "device", None)

    def is_active(self, obj: ControlTemplate):
        return getattr(obj, "is_active", None)

    def created_at(self, obj: ControlTemplate):
        return getattr(obj, "created_at", None)

    def updated_at(self, obj: ControlTemplate):
        return getattr(obj, "updated_at", None)


@admin.register(ScriptTemplate)
class ScriptTemplateAdmin(admin.ModelAdmin):
    """
    脚本模板后台管理
    """

    list_display = (
        "id",
        "name",
        "script_type_display",
        "is_active",
        "priority",
        "device_count",
        "created_at",
        "updated_at",
    )
    list_filter = ("script_type", "is_active")
    search_fields = ("name", "description")
    ordering = ("-id",)
    readonly_fields = ("created_at", "updated_at")

    fieldsets = (
        ("基本信息", {
            "fields": ("name", "description", "is_active", "priority", "device_ids")
        }),
        ("脚本配置", {
            "fields": (
                "script_type",
                "threshold_config",
                "schedule_config",
                "python_code",
            )
        }),
        ("命令模板", {
            "fields": ("command_template",)
        }),
        ("时间信息", {
            "fields": ("created_at", "updated_at"),
            "classes": ("collapse",)
        }),
    )

    def script_type_display(self, obj: ScriptTemplate) -> str:
        type_labels = {
            "threshold": "阈值触发",
            "schedule": "定时执行",
            "hybrid": "混合模式",
            "python": "Python脚本",
        }
        return type_labels.get(obj.script_type, obj.script_type)

    script_type_display.short_description = "类型"

    def is_active(self, obj: ScriptTemplate):
        return getattr(obj, "is_active", None)

    def device_count(self, obj: ScriptTemplate) -> int:
        """显示关联设备数量"""
        device_ids = obj.device_ids or []
        return len(device_ids)

    device_count.short_description = "设备数"

    def created_at(self, obj: ScriptTemplate):
        return getattr(obj, "created_at", None)

    def updated_at(self, obj: ScriptTemplate):
        return getattr(obj, "updated_at", None)


@admin.register(ScriptExecution)
class ScriptExecutionAdmin(admin.ModelAdmin):
    """
    脚本执行记录后台管理
    """

    list_display = (
        "id",
        "script_name",
        "status_colored",
        "trigger_reason",
        "started_at",
        "duration",
        "created_at",
    )
    list_filter = ("script", "status", "trigger_reason")
    search_fields = ("script__name", "result")
    ordering = ("-id", "-created_at")
    readonly_fields = (
        "script",
        "trigger_reason",
        "status",
        "started_at",
        "completed_at",
        "commands",
        "result",
        "error_message",
        "created_at",
    )

    # 避免误删执行记录（审计需要）
    actions = None

    def has_delete_permission(self, request, obj=None):
        return False

    def script_name(self, obj: ScriptExecution) -> str:
        return obj.script.name if obj.script else "-"

    script_name.short_description = "脚本名称"

    def status_colored(self, obj: ScriptExecution) -> str:
        status = obj.status or ""
        color = {
            "pending": "#888",
            "running": "blue",
            "success": "green",
            "failed": "red",
        }.get(status, "black")
        return format_html('<b style="color:{}">{}</b>', color, status or "-")

    status_colored.short_description = "状态"

    def duration(self, obj: ScriptExecution) -> str:
        if not obj.started_at or not obj.completed_at:
            return "-"
        delta = obj.completed_at - obj.started_at
        seconds = delta.total_seconds()
        if seconds < 1:
            return f"{seconds * 1000:.0f}ms"
        return f"{seconds:.2f}s"

    duration.short_description = "耗时"

    def created_at(self, obj: ScriptExecution):
        return getattr(obj, "created_at", None)
