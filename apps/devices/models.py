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
