# apps/devices/models.py
from __future__ import annotations

import secrets
from django.db import models
from django.utils import timezone
from django.conf import settings


class Device(models.Model):
    """
    采集节点/监测站
    - code: 设备公开标识（topic: compostlab/v2/{code}/telemetry）
    """

    code = models.CharField(max_length=64, unique=True, db_index=True)
    name = models.CharField(max_length=128, blank=True, default="")

    api_token = models.CharField(
        max_length=128, unique=True, editable=False, blank=True, default=""
    )

    is_active = models.BooleanField(default=True, db_index=True)
    post_topic = models.CharField(max_length=256, blank=True, default="")
    response_topic = models.CharField(max_length=256, blank=True, default="")

    note = models.TextField(blank=True, default="")
    meta = models.JSONField(default=dict, blank=True)

    last_seen_at = models.DateTimeField(null=True, blank=True, db_index=True)
    ip_address = models.CharField(max_length=64, blank=True, default="", help_text="设备上线时的 IP 地址")
    register_at = models.DateTimeField(null=True, blank=True, help_text="设备首次注册时间")
    configuration = models.JSONField(default=dict, blank=True, help_text="设备配置信息")

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["id"]
        indexes = [
            models.Index(fields=["code"]),
            models.Index(fields=["is_active", "last_seen_at"]),
        ]

    def save(self, *args, **kwargs):
        if not self.api_token:
            self.api_token = secrets.token_urlsafe(32)
        super().save(*args, **kwargs)

    def touch(self):
        self.last_seen_at = timezone.now()
        self.save(update_fields=["last_seen_at"])

    def __str__(self) -> str:
        return f"{self.code} ({self.name})" if self.name else self.code


class Channel(models.Model):
    """
    设备通道字典
    """

    device = models.ForeignKey(
        Device, on_delete=models.CASCADE, related_name="channels"
    )

    code = models.CharField(max_length=64)  # ✅ 通道标识（TEMP_C/O2_VOL_PCT/...）
    name = models.CharField(max_length=128, blank=True, default="")
    unit = models.CharField(max_length=32, blank=True, default="")
    is_active = models.BooleanField(default=True, db_index=True)

    # ✅ 新增：语义层字段（不再靠 code 判断类型）
    metric = models.CharField(max_length=32, blank=True, default="", db_index=True)
    role = models.CharField(max_length=32, blank=True, default="", db_index=True)
    display_name = models.CharField(max_length=128, blank=True, default="")

    meta = models.JSONField(default=dict, blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["device", "code"], name="uq_channel_device_code"
            ),
        ]
        indexes = [
            models.Index(fields=["device", "code"]),
            models.Index(fields=["code"]),
            models.Index(fields=["device", "is_active"]),
        ]
        ordering = ["device_id", "code"]

    def __str__(self) -> str:
        label = self.name or self.code
        return f"{self.device.code}:{label}"


class DeviceCommand(models.Model):
    """
    设备下发命令记录（可追踪）
    - payload: 下发给设备的原始 JSON（你的 ESP32 结构化 commands）
    - status: queued/sent/acked/failed
    """

    STATUS_QUEUED = "queued"
    STATUS_SENT = "sent"
    STATUS_ACKED = "acked"
    STATUS_FAILED = "failed"

    STATUS_CHOICES = (
        (STATUS_QUEUED, "Queued"),
        (STATUS_SENT, "Sent"),
        (STATUS_ACKED, "Acked"),
        (STATUS_FAILED, "Failed"),
    )

    device = models.ForeignKey(
        Device, on_delete=models.CASCADE, related_name="commands"
    )

    # 可选：你也可以把 command 从 payload 里提取出来存一份方便筛选
    command = models.CharField(max_length=64, blank=True, default="")
    payload = models.JSONField(default=dict)

    status = models.CharField(
        max_length=16, choices=STATUS_CHOICES, default=STATUS_QUEUED, db_index=True
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="device_commands",
    )

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    sent_at = models.DateTimeField(null=True, blank=True, db_index=True)
    acked_at = models.DateTimeField(null=True, blank=True, db_index=True)

    # 设备回执/错误信息
    result = models.JSONField(default=dict, blank=True)

    class Meta:
        ordering = ["-id"]
        indexes = [
            models.Index(fields=["device", "status", "created_at"]),
        ]

    def __str__(self) -> str:
        return (
            f"{self.device.code}:{self.command or 'command'}#{self.id}({self.status})"
        )


class ControlTemplate(models.Model):
    """
    控制模板
    用于保存常用的设备控制命令，方便快速下发
    """

    name = models.CharField(max_length=128, help_text="模板名称，如：曝气开启")
    description = models.CharField(
        max_length=256, blank=True, default="", help_text="模板描述"
    )
    # 存储完整的命令 JSON 结构: { "commands": [...] }
    payload = models.JSONField(default=dict, help_text="命令payload")

    # 可选：关联特定设备，为空则通用模板
    device = models.ForeignKey(
        Device,
        on_delete=models.CASCADE,
        related_name="control_templates",
        null=True,
        blank=True,
        help_text="关联设备（可选）",
    )

    is_active = models.BooleanField(default=True, help_text="是否启用")

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="control_templates",
    )

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["device", "is_active"]),
            models.Index(fields=["is_active"]),
        ]

    def __str__(self) -> str:
        device_prefix = f"{self.device.code}:" if self.device else "全局:"
        return f"{device_prefix}{self.name}"


class ScriptTemplate(models.Model):
    """
    控制脚本模板
    存储自动控制算法和脚本，后端根据脚本自动下发命令
    """

    class ScriptType(models.TextChoices):
        THRESHOLD = "threshold", "阈值触发"
        SCHEDULE = "schedule", "定时执行"
        HYBRID = "hybrid", "混合模式（阈值+定时）"
        PYTHON = "python", "Python脚本"

    name = models.CharField(max_length=128, help_text="脚本名称，如：高温自动降温")
    description = models.CharField(
        max_length=512, blank=True, default="", help_text="脚本描述"
    )
    script_type = models.CharField(
        max_length=20,
        choices=ScriptType.choices,
        default=ScriptType.THRESHOLD,
        help_text="脚本类型",
    )

    # 阈值配置（用于阈值触发类型）
    threshold_config = models.JSONField(
        default=dict,
        blank=True,
        help_text='阈值配置，例如: {"metric": "temperature", "operator": ">=", "value": 75, "action": "pump_off"}',
    )

    # 定时配置（用于定时执行类型）
    schedule_config = models.JSONField(
        default=dict,
        blank=True,
        help_text='定时配置，例如: {"cron": "0 9 * * *", "commands": [...]}',
    )

    # Python脚本代码
    python_code = models.TextField(
        blank=True, help_text="Python脚本代码（script_type=python时使用）"
    )

    # 默认命令模板（所有类型都可以使用）
    command_template = models.JSONField(
        default=dict,
        help_text='命令模板，例如: {"commands": [{"command": "pump", "action": "on"}]}',
    )

    # 关联的设备和批次
    devices = models.ManyToManyField(
        Device,
        blank=True,
        related_name="script_templates",
        help_text="应用到哪些设备",
    )
    run = models.ForeignKey(
        "runs.Run",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="script_templates",
        help_text="应用到哪个批次",
    )

    is_active = models.BooleanField(default=True, help_text="是否启用")
    priority = models.IntegerField(
        default=0, help_text="优先级，数字越大越优先执行"
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="script_templates",
    )

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        db_table = "devices_scripttemplate"
        ordering = ["-priority", "-created_at"]
        indexes = [
            models.Index(fields=["script_type", "is_active"]),
            models.Index(fields=["run", "is_active"]),
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.get_script_type_display()})"


class ScriptExecution(models.Model):
    """
    脚本执行记录
    记录每次脚本的执行情况和结果
    """

    class Status(models.TextChoices):
        PENDING = "pending", "待执行"
        RUNNING = "running", "执行中"
        SUCCESS = "success", "成功"
        FAILED = "failed", "失败"
        SKIPPED = "skipped", "跳过"

    script = models.ForeignKey(
        ScriptTemplate,
        on_delete=models.CASCADE,
        related_name="executions",
        help_text="执行的脚本模板",
    )

    device = models.ForeignKey(
        Device,
        on_delete=models.CASCADE,
        related_name="script_executions",
        help_text="目标设备",
    )

    status = models.CharField(
        max_length=16, choices=Status.choices, default=Status.PENDING, db_index=True
    )

    # 触发原因
    trigger_reason = models.CharField(
        max_length=64,
        blank=True,
        default="",
        help_text="触发原因，如：threshold_exceeded, schedule, manual",
    )

    # 执行的命令
    commands = models.JSONField(
        default=list, help_text="实际下发的命令列表"
    )

    # 执行结果
    result = models.JSONField(
        default=dict, blank=True, help_text="执行结果详情"
    )

    error_message = models.TextField(
        blank=True, default="", help_text="错误信息（如果失败）"
    )

    # 时间信息
    scheduled_at = models.DateTimeField(
        null=True,
        blank=True,
        db_index=True,
        help_text="计划执行时间",
    )
    started_at = models.DateTimeField(
        null=True, blank=True, help_text="实际开始时间"
    )
    completed_at = models.DateTimeField(
        null=True, blank=True, help_text="完成时间"
    )

    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="script_executions",
        help_text="手动执行的用户（null表示自动执行）",
    )

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        db_table = "devices_scriptexecution"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["script", "status"]),
            models.Index(fields=["device", "created_at"]),
            models.Index(fields=["status", "scheduled_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.script.name} -> {self.device.code} ({self.status})"
