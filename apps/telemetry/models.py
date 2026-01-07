# apps/telemetry/models.py
from django.db import models
from apps.devices.models import Device


class TelemetryRaw(models.Model):
    device = models.ForeignKey(
        Device, on_delete=models.CASCADE, related_name="raw_packets"
    )
    topic = models.CharField(max_length=256, blank=True, default="")
    ts_received = models.DateTimeField(auto_now_add=True)

    payload = models.JSONField()
    payload_hash = models.CharField(max_length=64, db_index=True)

    source = models.CharField(max_length=16, default="mqtt")  # mqtt/http/import

    class Meta:
        indexes = [
            models.Index(fields=["device", "ts_received"]),
            models.Index(fields=["device", "payload_hash"]),
        ]

    def __str__(self) -> str:
        return f"raw:{self.device.code}@{self.ts_received}"


class TelemetryKV(models.Model):
    device = models.ForeignKey(Device, on_delete=models.CASCADE)

    code = models.CharField(max_length=64, db_index=True)  # ✅ 通道 code（TEMP_C）
    ts = models.DateTimeField(db_index=True)

    value = models.FloatField()
    unit = models.CharField(max_length=16, blank=True, default="")
    quality_flag = models.CharField(max_length=16, default="OK")
    source = models.CharField(max_length=16, default="mqtt")

    meta = models.JSONField(default=dict, blank=True)

    class Meta:
        db_table = "telemetry_telemetrykv"
        indexes = [
            models.Index(fields=["device", "code", "ts"]),
            models.Index(fields=["code", "ts"]),
            models.Index(fields=["device", "ts"]),
        ]
