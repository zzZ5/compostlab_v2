# apps/runs/admin.py
from __future__ import annotations

from django.contrib import admin

from apps.runs.models import Run, RunWindow


def _field_names(model) -> set[str]:
    return {f.name for f in model._meta.fields}


RUN_FIELDS = _field_names(Run)
WINDOW_FIELDS = _field_names(RunWindow)


@admin.register(Run)
class RunAdmin(admin.ModelAdmin):
    # ✅ 加 note（如果存在），方便后台一眼看到备注
    list_display = tuple(
        f
        for f in (
            "id",
            "name",
            "start_at",
            "end_at",
            "note",
            "created_at",
            "updated_at",
        )
        if f in RUN_FIELDS or f in ("id",)  # id 不在 _meta.fields 里
    )

    search_fields = ("name", "note") if "note" in RUN_FIELDS else ("name",)
    ordering = ("-id",)

    readonly_fields = tuple(f for f in ("created_at", "updated_at") if f in RUN_FIELDS)

    # 可选：给 Run 加时间过滤（有时很方便）
    list_filter = tuple(f for f in ("start_at", "end_at") if f in RUN_FIELDS)

    def created_at(self, obj: Run):
        return getattr(obj, "created_at", None)

    def updated_at(self, obj: Run):
        return getattr(obj, "updated_at", None)


@admin.register(RunWindow)
class RunWindowAdmin(admin.ModelAdmin):
    # ✅ 后台更直观：显示 devices（会显示 __str__，通常含 code/name）
    # 使用 ManyToManyField 后需要用 filter_horizontal 或 filter_vertical 提供多选界面
    filter_horizontal = ("devices",)

    base_list_display = (
        "id",
        "run",
        "devices_display",
        "group",
        "treatment",
        "follow_run",
        "start_at",
        "end_at",
    )

    # ✅ 如果存在 note，就展示 note
    if "note" in WINDOW_FIELDS:
        list_display = base_list_display + ("note",)
    else:
        list_display = base_list_display

    ordering = ("-id",)

    list_filter = tuple(
        f for f in ("run", "group", "treatment", "follow_run") if f in WINDOW_FIELDS
    )

    # ✅ 搜索：run 名称、device code、group/treatment、note（如果存在）
    search_fields = (
        ("run__name", "devices__code")
        + (("group",) if "group" in WINDOW_FIELDS else ())
        + (("treatment",) if "treatment" in WINDOW_FIELDS else ())
        + (("note",) if "note" in WINDOW_FIELDS else ())
    )

    def follow_run(self, obj: RunWindow):
        return getattr(obj, "follow_run", None)

    follow_run.boolean = True
    follow_run.short_description = "follow_run"

    def devices_display(self, obj: RunWindow):
        """在列表中显示所有设备的 code"""
        return ", ".join(d.code for d in obj.devices.all())

    devices_display.short_description = "devices"
