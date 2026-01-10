# apps/runs/models.py
from django.db import models
from apps.devices.models import Device


class Run(models.Model):
    """
    一个 Run = 一个堆肥批次（batch）
    """

    name = models.CharField(max_length=128)
    start_at = models.DateTimeField()
    end_at = models.DateTimeField(null=True, blank=True)

    recipe = models.JSONField(default=dict, blank=True)
    settings = models.JSONField(default=dict, blank=True)

    # ✅ 新增：备注（用于 Postman / 后台填写说明）
    note = models.TextField(blank=True, default="")

    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def save(self, *args, **kwargs):
        is_update = self.pk is not None

        old_start = old_end = None
        if is_update:
            old = Run.objects.filter(pk=self.pk).values("start_at", "end_at").first()
            if old:
                old_start, old_end = old["start_at"], old["end_at"]

        super().save(*args, **kwargs)

        if not is_update:
            return
        if old_start == self.start_at and old_end == self.end_at:
            return

        # avoid circular import
        from apps.runs.models import RunWindow

        # follow_run=True 的窗口跟随 run 时间变化
        RunWindow.objects.filter(run_id=self.pk, follow_run=True).update(
            start_at=self.start_at,
            end_at=self.end_at,
        )

    def __str__(self) -> str:
        return f"Run#{self.pk} {self.name} [{self.start_at} - {self.end_at or '...'}]"


class RunWindow(models.Model):
    """
    Run 下的窗口：把 device(s) 的数据在某段时间归入某个 group/treatment
    - 支持多设备：一个窗口可以包含多个监测设备
    """

    run = models.ForeignKey(Run, on_delete=models.CASCADE, related_name="windows")
    # ✅ 改为 ManyToMany，支持多设备
    devices = models.ManyToManyField(Device, related_name="run_windows", blank=True)

    # ✅ 真正可选填：不填则 follow_run=True 时继承 run 时间
    start_at = models.DateTimeField(null=True, blank=True)
    end_at = models.DateTimeField(null=True, blank=True)
    follow_run = models.BooleanField(default=True)

    # group：处理/组别（如 CK/T1/T2...）
    group = models.CharField(max_length=32, default="CK")
    treatment = models.CharField(max_length=64, blank=True, default="")

    settings = models.JSONField(default=dict, blank=True)
    meta = models.JSONField(default=dict, blank=True)

    # ✅ 新增：窗口备注
    note = models.TextField(blank=True, default="")

    def save(self, *args, **kwargs):
        # follow_run=True：未填写的时间继承 run 的时间
        if self.follow_run:
            if not self.start_at:
                self.start_at = self.run.start_at
            if self.end_at is None and self.run.end_at:
                self.end_at = self.run.end_at
        super().save(*args, **kwargs)

    class Meta:
        indexes = [
            models.Index(fields=["run", "start_at"]),
            models.Index(fields=["run", "group", "start_at"]),
        ]

    def __str__(self) -> str:
        device_codes = ", ".join([d.code for d in self.devices.all()])
        return (
            f"Run#{self.run_id} {self.group} [{device_codes}] "
            f"[{self.start_at} - {self.end_at or '...'}]"
        )
