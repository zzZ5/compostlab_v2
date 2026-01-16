# apps/runs/api.py
# -*- coding: utf-8 -*-
"""
Runs / RunWindows / Telemetry API

本文件提供：
- Run CRUD
- RunWindow CRUD
- RunTelemetry（按 run + windows 范围查询遥测数据，支持 raw / bucket 聚合）
- RunSummary（统计范围内数据概览）
- RunExport / RunExportWide（CSV 导出）

⚠️ 时间格式与时区（按你的要求统一）：
- Django/DB 内部通常存 UTC（USE_TZ=True）
- 对外输出（JSON / CSV）统一转为 settings.TIME_ZONE（Asia/Shanghai）
- 并格式化为："YYYY-MM-DD HH:MM:SS"
  例如： "2026-01-05 11:37:51"
"""

from __future__ import annotations

import csv
import os
import re
import mimetypes
from typing import List, Tuple, Optional

from django.db import connection
from django.db.models import Q, Min, Max
from django.http import JsonResponse, StreamingHttpResponse, FileResponse, Http404
from django.utils import timezone
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.conf import settings

from apps.api.mixins import BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin
from apps.api.utils import parse_dt, parse_bucket
from apps.runs.models import Run, RunWindow, RunAttachment
from apps.telemetry.models import TelemetryKV
from apps.devices.models import Device
from apps.permissions.mixins import ReadOrWritePermissionMixin, ResourceType
from apps.permissions.config import ActionType

# 用于类型提示
from django.http import HttpRequest


# -------------------------
# helpers
# -------------------------
def _dt_local_str(dt) -> Optional[str]:
    """
    将 datetime 转成本地时区并输出为 "YYYY-MM-DD HH:MM:SS" 字符串。
    - dt 为 None -> None
    """
    if not dt:
        return None
    dt_local = timezone.localtime(dt)
    return dt_local.strftime("%Y-%m-%d %H:%M:%S")


def _parse_channels_param(request) -> List[str]:
    """
    兼容参数名 channels=TEMP_C,O2_VOL_PCT
    对外仍叫 channels，内部会映射成 TelemetryKV.code
    """
    ch = (request.GET.get("channels") or "").strip()
    if not ch:
        return []
    return [x.strip().upper() for x in ch.split(",") if x.strip()]


def _safe_code(code: str) -> bool:
    """允许 A-Z 0-9 _，长度 1-64（与模型 max_length 对齐）"""
    return bool(re.fullmatch(r"[A-Z0-9_]{1,64}", code or ""))


def _run_to_dict(run: Run, include_stats: bool = False) -> dict:
    """
    Run -> dict（对外输出）
    时间字段统一输出为："YYYY-MM-DD HH:MM:SS"
    """
    out = {
        "run_id": run.id,
        "name": getattr(run, "name", "") or "",
        "start_at": _dt_local_str(getattr(run, "start_at", None)),
        "end_at": _dt_local_str(getattr(run, "end_at", None)),
        "recipe": getattr(run, "recipe", None) if hasattr(run, "recipe") else None,
        "settings": getattr(run, "settings", None)
        if hasattr(run, "settings")
        else None,
        "created_at": _dt_local_str(getattr(run, "created_at", None)),
        "updated_at": _dt_local_str(getattr(run, "updated_at", None)),
        "note": getattr(run, "note", "") or "",
    }
    if include_stats:
        # 计算 Windows 统计
        windows = RunWindow.objects.filter(run=run)
        window_count = windows.count()
        device_ids = list(set(
            did
            for w in windows
            for did in w.devices.values_list("id", flat=True)
        ))
        device_count = len(device_ids)
        out["window_count"] = window_count
        out["device_count"] = device_count
        if device_ids:
            devices = Device.objects.filter(id__in=device_ids)
            out["device_list"] = [d.code for d in devices]
    # 只过滤真正为 None 的值，保留空字符串
    return {k: v for k, v in out.items() if v is not None}


def _window_effective_start(run: Run, w: RunWindow):
    """window.start_at 为空则继承 run.start_at"""
    return w.start_at or run.start_at


def _window_effective_end(run: Run, w: RunWindow):
    """window.end_at 为空则继承 run.end_at"""
    return w.end_at or run.end_at


def _window_to_dict(run: Run, w: RunWindow) -> dict:
    """
    RunWindow -> dict（对外输出）
    时间字段统一输出为："YYYY-MM-DD HH:MM:SS"
    """
    eff_s = _window_effective_start(run, w)
    eff_e = _window_effective_end(run, w)

    # ✅ 支持多设备：返回设备 ID 列表
    device_ids = list(w.devices.values_list("id", flat=True))

    out = {
        "window_id": w.id,
        "run_id": run.id,
        "device_ids": device_ids,
        "group": getattr(w, "group", None),
        "treatment": getattr(w, "treatment", None),
        "follow_run": getattr(w, "follow_run", None),
        "start_at": _dt_local_str(w.start_at) if w.start_at else None,
        "end_at": _dt_local_str(w.end_at) if w.end_at else None,
        "effective_start_at": _dt_local_str(eff_s) if eff_s else None,
        "effective_end_at": _dt_local_str(eff_e) if eff_e else None,
        "settings": getattr(w, "settings", None) if hasattr(w, "settings") else None,
        "meta": getattr(w, "meta", None) if hasattr(w, "meta") else None,
        "note": getattr(w, "note", "") or "",
    }
    return {k: v for k, v in out.items() if v is not None}


def _get_windows(run: Run, group: str = "", treatment: str = "") -> List[RunWindow]:
    """按 group/treatment 过滤 run 下的 windows"""
    qs = RunWindow.objects.filter(run=run).order_by("id")
    if group:
        qs = qs.filter(group=group)
    if treatment:
        qs = qs.filter(treatment=treatment)
    return list(qs)


def _compute_default_range_from_windows(
    run: Run, windows: List[RunWindow]
) -> Tuple[timezone.datetime, timezone.datetime]:
    """
    默认时间范围：取 windows 的 effective_start 最小值 和 effective_end 最大值
    如果 end 缺失，用 run.end_at 或 now
    """
    if not windows:
        start = getattr(run, "start_at", None) or timezone.now()
        end = getattr(run, "end_at", None) or timezone.now()
        return start, end

    starts = []
    ends = []
    for w in windows:
        s = _window_effective_start(run, w)
        e = _window_effective_end(run, w)
        if s:
            starts.append(s)
        if e:
            ends.append(e)

    start = min(starts) if starts else (run.start_at or timezone.now())
    end = max(ends) if ends else (run.end_at or timezone.now())
    return start, end


def _overlapped_predicates(
    run: Run,
    windows: List[RunWindow],
    dt_from: timezone.datetime,
    dt_to: timezone.datetime,
) -> Tuple[List[Tuple[int, timezone.datetime, timezone.datetime]], List[int]]:
    """
    把 windows 与 [dt_from, dt_to) 求交集，输出 predicates：
      [(device_id, start, end), ...]
    ✅ 支持多设备：每个窗口可以包含多个设备
    同时返回 matched_device_ids 去重列表
    """
    preds: List[Tuple[int, timezone.datetime, timezone.datetime]] = []
    matched: List[int] = []

    for w in windows:
        w_start = _window_effective_start(run, w)
        w_end = _window_effective_end(run, w) or dt_to
        if not w_start:
            continue

        start = max(w_start, dt_from)
        end = min(w_end, dt_to) if w_end else dt_to
        if start >= end:
            continue

        # ✅ 支持多设备：为每个设备添加一个 predicate
        for device in w.devices.all():
            preds.append((device.id, start, end))
            matched.append(device.id)

    return preds, sorted(list(set(matched)))


class Echo:
    """用于 StreamingHttpResponse 的伪 buffer（csv.writer 需要 write()）"""

    def write(self, value):
        return value


# -------------------------
# Runs CRUD
# -------------------------
@method_decorator(csrf_exempt, name="dispatch")
class RunListView(BasicAuthMixin, View):
    """GET /api/v2/runs"""

    def get(self, request):
        qs = Run.objects.all().order_by("-id")
        # 列表页需要统计信息
        data = [_run_to_dict(r, include_stats=True) for r in qs]
        return JsonResponse({"count": len(data), "data": data}, status=200)


@method_decorator(csrf_exempt, name="dispatch")
class RunDetailView(BasicAuthMixin, View):
    """GET /api/v2/runs/<run_id>"""

    def get(self, request, run_id: int):
        run = Run.objects.get(id=run_id)
        return JsonResponse(_run_to_dict(run), status=200)


@method_decorator(csrf_exempt, name="dispatch")
@method_decorator(csrf_exempt, name="dispatch")
class RunCreateView(BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View):
    """POST /api/v2/runs"""

    def post(self, request):
        body = self.json_body(request)

        run = Run()
        if hasattr(run, "name"):
            run.name = (body.get("name") or "").strip()

        # 可选字段
        if hasattr(run, "recipe") and isinstance(body.get("recipe"), dict):
            run.recipe = body.get("recipe")
        if hasattr(run, "settings") and isinstance(body.get("settings"), dict):
            run.settings = body.get("settings")
        if hasattr(run, "note"):
            run.note = (body.get("note") or "").strip()

        s = parse_dt(body.get("start_at"))
        e = parse_dt(body.get("end_at"))

        run.start_at = s or timezone.now()
        run.end_at = e

        if run.end_at and run.start_at and run.end_at <= run.start_at:
            return JsonResponse(
                {"detail": "end_at must be greater than start_at."}, status=400
            )

        run.save()
        return JsonResponse(_run_to_dict(run), status=201)


@method_decorator(csrf_exempt, name="dispatch")
@method_decorator(csrf_exempt, name="dispatch")
class RunUpdateView(BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View):
    """PATCH/PUT /api/v2/runs/<run_id>"""

    def patch(self, request, run_id: int):
        body = self.json_body(request)
        run = Run.objects.get(id=run_id)

        if "name" in body and hasattr(run, "name"):
            run.name = (body.get("name") or "").strip()

        if "note" in body and hasattr(run, "note"):
            run.note = (body.get("note") or "").strip()

        if "recipe" in body and hasattr(run, "recipe"):
            recipe = body.get("recipe")
            if recipe is None:
                run.recipe = {}
            elif isinstance(recipe, dict):
                run.recipe = recipe
            else:
                return JsonResponse({"detail": "recipe must be an object."}, status=400)

        if "settings" in body and hasattr(run, "settings"):
            settings = body.get("settings")
            if settings is None:
                run.settings = {}
            elif isinstance(settings, dict):
                run.settings = settings
            else:
                return JsonResponse(
                    {"detail": "settings must be an object."}, status=400
                )

        if "start_at" in body:
            s = parse_dt(body.get("start_at"))
            if s:
                run.start_at = s

        if "end_at" in body:
            if body.get("end_at") in (None, "", "null"):
                run.end_at = None
            else:
                e = parse_dt(body.get("end_at"))
                if e:
                    run.end_at = e

        if run.end_at and run.start_at and run.end_at <= run.start_at:
            return JsonResponse(
                {"detail": "end_at must be greater than start_at."}, status=400
            )

        run.save()
        return JsonResponse(_run_to_dict(run), status=200)

    def put(self, request, run_id: int):
        return self.patch(request, run_id)


@method_decorator(csrf_exempt, name="dispatch")
class RunDeleteView(BasicAuthMixin, View):
    """DELETE /api/v2/runs/<run_id>"""

    def delete(self, request, run_id: int):
        # BasicAuthMixin.dispatch 已经认证了用户并设置了 request.user
        # 直接检查权限
        from apps.permissions import check_permission, ResourceType, ActionType

        user = getattr(request, "user", None)
        if not check_permission(user, ResourceType.RUN, ActionType.DELETE):
            return JsonResponse(
                {"detail": "Permission denied. Admin role required for run deletion."},
                status=403,
            )

        run = Run.objects.get(id=run_id)
        run.delete()
        return JsonResponse({"detail": "deleted", "run_id": run_id}, status=200)


# -------------------------
# RunWindows CRUD
# -------------------------
@method_decorator(csrf_exempt, name="dispatch")
class RunWindowListView(BasicAuthMixin, View):
    """GET /api/v2/runs/<run_id>/windows"""

    def get(self, request, run_id: int):
        run = Run.objects.get(id=run_id)
        group = (request.GET.get("group") or "").strip()
        treatment = (request.GET.get("treatment") or "").strip()

        windows = _get_windows(run, group, treatment)
        data = [_window_to_dict(run, w) for w in windows]
        return JsonResponse(
            {
                "run_id": run_id,
                "filters": {"group": group or None, "treatment": treatment or None},
                "count": len(data),
                "data": data,
            },
            status=200,
        )


@method_decorator(csrf_exempt, name="dispatch")
@method_decorator(csrf_exempt, name="dispatch")
class RunWindowCreateView(BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View):
    """POST /api/v2/runs/<run_id>/windows"""

    def post(self, request, run_id: int):
        run = Run.objects.get(id=run_id)
        body = self.json_body(request)

        # ✅ 支持多设备：device_ids 数组
        device_ids = body.get("device_ids")
        if not isinstance(device_ids, list) or len(device_ids) == 0:
            return JsonResponse({"detail": "device_ids is required (non-empty array)."}, status=400)

        # 验证所有设备存在
        valid_devices = Device.objects.filter(id__in=device_ids)
        if valid_devices.count() != len(device_ids):
            return JsonResponse({"detail": "one or more devices not found."}, status=404)

        w = RunWindow(run=run)
        w.save()

        # 设置设备关联
        w.devices.set(device_ids)

        if hasattr(w, "group") and "group" in body:
            w.group = (body.get("group") or "").strip() or "CK"

        if hasattr(w, "treatment") and "treatment" in body:
            w.treatment = (body.get("treatment") or "").strip()

        if hasattr(w, "follow_run") and "follow_run" in body:
            w.follow_run = bool(body.get("follow_run"))

        if hasattr(w, "settings") and isinstance(body.get("settings"), dict):
            w.settings = body.get("settings")

        if hasattr(w, "meta") and isinstance(body.get("meta"), dict):
            w.meta = body.get("meta")

        # ✅ 新增：note 写入
        if hasattr(w, "note"):
            w.note = (body.get("note") or "").strip()

        # 允许 start/end 为 null -> 继承逻辑由 window_effective_* 实现
        if "start_at" in body:
            if body.get("start_at") in (None, "", "null"):
                w.start_at = None
            else:
                w.start_at = parse_dt(body.get("start_at"))

        if "end_at" in body:
            if body.get("end_at") in (None, "", "null"):
                w.end_at = None
            else:
                w.end_at = parse_dt(body.get("end_at"))

        eff_s = _window_effective_start(run, w)
        eff_e = _window_effective_end(run, w) or timezone.now()
        if eff_s and eff_e and eff_e <= eff_s:
            return JsonResponse(
                {"detail": "window end must be greater than start (effective)."},
                status=400,
            )

        w.save()
        return JsonResponse(_window_to_dict(run, w), status=201)


@method_decorator(csrf_exempt, name="dispatch")
@method_decorator(csrf_exempt, name="dispatch")
class RunWindowUpdateView(BasicAuthMixin, StaffRequiredMixin, JsonBodyMixin, View):
    """PATCH/PUT /api/v2/runs/<run_id>/windows/<window_id>"""

    def patch(self, request, run_id: int, window_id: int):
        run = Run.objects.get(id=run_id)
        w = RunWindow.objects.get(id=window_id, run=run)

        body = self.json_body(request)

        # ✅ 支持多设备：device_ids 数组
        if "device_ids" in body:
            device_ids = body.get("device_ids")
            if isinstance(device_ids, list) and len(device_ids) > 0:
                # 验证所有设备存在
                valid_devices = Device.objects.filter(id__in=device_ids)
                if valid_devices.count() == len(device_ids):
                    w.devices.set(device_ids)
                else:
                    return JsonResponse(
                        {"detail": "one or more devices not found."}, status=404
                    )

        if hasattr(w, "group") and "group" in body:
            w.group = (body.get("group") or "").strip() or "CK"

        if hasattr(w, "treatment") and "treatment" in body:
            w.treatment = (body.get("treatment") or "").strip()

        if hasattr(w, "follow_run") and "follow_run" in body:
            w.follow_run = bool(body.get("follow_run"))

        # ✅ 新增：note 更新
        if "note" in body and hasattr(w, "note"):
            w.note = (body.get("note") or "").strip()

        if "settings" in body and hasattr(w, "settings"):
            settings = body.get("settings")
            if settings is None:
                w.settings = {}
            elif isinstance(settings, dict):
                w.settings = settings
            else:
                return JsonResponse(
                    {"detail": "settings must be an object."}, status=400
                )

        if "meta" in body and hasattr(w, "meta"):
            meta = body.get("meta")
            if meta is None:
                w.meta = {}
            elif isinstance(meta, dict):
                w.meta = meta
            else:
                return JsonResponse({"detail": "meta must be an object."}, status=400)

        if "start_at" in body:
            if body.get("start_at") in (None, "", "null"):
                w.start_at = None
            else:
                s = parse_dt(body.get("start_at"))
                if s:
                    w.start_at = s

        if "end_at" in body:
            if body.get("end_at") in (None, "", "null"):
                w.end_at = None
            else:
                e = parse_dt(body.get("end_at"))
                if e:
                    w.end_at = e

        eff_s = _window_effective_start(run, w)
        eff_e = _window_effective_end(run, w) or timezone.now()
        if eff_s and eff_e and eff_e <= eff_s:
            return JsonResponse(
                {"detail": "window end must be greater than start (effective)."},
                status=400,
            )

        w.save()
        return JsonResponse(_window_to_dict(run, w), status=200)

    def put(self, request, run_id: int, window_id: int):
        return self.patch(request, run_id, window_id)


@method_decorator(csrf_exempt, name="dispatch")
class RunWindowDeleteView(BasicAuthMixin, View):
    """DELETE /api/v2/runs/<run_id>/windows/<window_id>"""

    def delete(self, request, run_id: int, window_id: int):
        # BasicAuthMixin.dispatch 已经认证了用户并设置了 request.user
        # 直接检查权限
        from apps.permissions import check_permission, ResourceType, ActionType

        user = getattr(request, "user", None)
        if not check_permission(user, ResourceType.RUN, ActionType.DELETE):
            return JsonResponse(
                {"detail": "Permission denied. Admin role required for run window deletion."},
                status=403,
            )
        run = Run.objects.get(id=run_id)
        w = RunWindow.objects.get(id=window_id, run=run)
        w.delete()
        return JsonResponse(
            {"detail": "deleted", "run_id": run_id, "window_id": window_id}, status=200
        )


# -------------------------
# Run Telemetry / Summary / Export / Export Wide
# -------------------------
@method_decorator(csrf_exempt, name="dispatch")
class RunTelemetryView(BasicAuthMixin, View):
    """
    GET /api/v2/runs/<run_id>/telemetry?channels=TEMP_C,O2_VOL_PCT&from=...&to=...&bucket=10m
    """

    def get(self, request, run_id: int):
        run = Run.objects.get(id=run_id)

        group = (request.GET.get("group") or "").strip()
        treatment = (request.GET.get("treatment") or "").strip()
        channels = _parse_channels_param(request)

        dt_from = parse_dt(request.GET.get("from"))
        dt_to = parse_dt(request.GET.get("to"))
        bucket = parse_bucket(request.GET.get("bucket"))

        limit = int(request.GET.get("limit") or "20000")
        limit = max(1, min(limit, 200000))

        windows = _get_windows(run, group, treatment)
        windows_payload = [_window_to_dict(run, w) for w in windows]

        if not windows:
            return JsonResponse(
                {
                    "run_id": run_id,
                    "from": None,
                    "to": None,
                    "count": 0,
                    "data": [],
                    "filters": {
                        "group": group or None,
                        "treatment": treatment or None,
                        "channels": channels or None,
                    },
                    "windows": [],
                    "matched_device_ids": [],
                    "note": "No RunWindow after filters.",
                },
                status=200,
            )

        w_start, w_end = _compute_default_range_from_windows(run, windows)
        if dt_from is None:
            dt_from = w_start
        if dt_to is None:
            dt_to = w_end or timezone.now()

        preds, matched_device_ids = _overlapped_predicates(run, windows, dt_from, dt_to)

        if not preds:
            return JsonResponse(
                {
                    "run_id": run_id,
                    "from": _dt_local_str(dt_from),
                    "to": _dt_local_str(dt_to),
                    "count": 0,
                    "data": [],
                    "filters": {
                        "group": group or None,
                        "treatment": treatment or None,
                        "channels": channels or None,
                    },
                    "windows": windows_payload,
                    "matched_device_ids": [],
                    "note": "No overlap after applying from/to and windows.",
                },
                status=200,
            )

        # ---- bucket 聚合（Timescale time_bucket）----
        if bucket:
            clauses = []
            params: list = [f"{bucket.seconds} seconds"]
            for device_id, start, end in preds:
                clauses.append("(device_id = %s AND ts >= %s AND ts < %s)")
                params.extend([device_id, start, end])
            where_or = " OR ".join(clauses)

            where_channels = ""
            if channels:
                where_channels = " AND code = ANY(%s)"
                params.append(channels)

            sql = f"""
                SELECT
                    device_id,
                    code,
                    time_bucket(%s, ts) AS bts,
                    AVG(value) AS vavg,
                    COALESCE(NULLIF(unit,''),'') AS unit
                FROM telemetry_telemetrykv
                WHERE ({where_or})
                {where_channels}
                GROUP BY device_id, code, bts, unit
                ORDER BY code, bts
                LIMIT %s;
            """
            params.append(limit)

            with connection.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()

            out = []
            for did, code, bts, vavg, unit in rows:
                out.append(
                    {
                        "device_id": int(did),
                        "code": str(code),
                        "ts": _dt_local_str(bts),
                        "value": float(vavg),
                        "unit": unit or "",
                        "agg": "avg",
                        "bucket": bucket.label,
                        "source": "timescale",
                    }
                )

            return JsonResponse(
                {
                    "run_id": run_id,
                    "from": _dt_local_str(dt_from),
                    "to": _dt_local_str(dt_to),
                    "bucket": bucket.label,
                    "count": len(out),
                    "data": out,
                    "filters": {
                        "group": group or None,
                        "treatment": treatment or None,
                        "channels": channels or None,
                    },
                    "windows": windows_payload,
                    "matched_device_ids": matched_device_ids,
                },
                status=200,
            )

        # ---- raw 点返回（ORM OR 条件）----
        or_q = Q()
        for device_id, start, end in preds:
            or_q |= Q(device_id=device_id) & Q(ts__gte=start) & Q(ts__lt=end)

        qs = TelemetryKV.objects.filter(or_q)
        if channels:
            qs = qs.filter(code__in=channels)

        rows = qs.values(
            "device_id", "code", "ts", "value", "unit", "quality_flag", "source"
        ).order_by("code", "ts")[:limit]

        out = []
        for r in rows:
            out.append(
                {
                    "device_id": r["device_id"],
                    "code": r["code"],
                    "ts": _dt_local_str(r["ts"]),
                    "value": float(r["value"]),
                    "unit": r["unit"] or "",
                    "quality": r["quality_flag"],
                    "source": r["source"],
                }
            )

        return JsonResponse(
            {
                "run_id": run_id,
                "from": _dt_local_str(dt_from),
                "to": _dt_local_str(dt_to),
                "count": len(out),
                "data": out,
                "filters": {
                    "group": group or None,
                    "treatment": treatment or None,
                    "channels": channels or None,
                },
                "windows": windows_payload,
                "matched_device_ids": matched_device_ids,
            },
            status=200,
        )


@method_decorator(csrf_exempt, name="dispatch")
class RunSummaryView(BasicAuthMixin, View):
    """GET /api/v2/runs/<run_id>/summary"""

    def get(self, request, run_id: int):
        run = Run.objects.get(id=run_id)
        group = (request.GET.get("group") or "").strip()
        treatment = (request.GET.get("treatment") or "").strip()

        windows = _get_windows(run, group, treatment)
        windows_payload = [_window_to_dict(run, w) for w in windows]

        if not windows:
            return JsonResponse(
                {
                    "scope": "run_summary",
                    "run_id": run_id,
                    "filters": {"group": group or None, "treatment": treatment or None},
                    "windows": [],
                    "count": 0,
                    "min_ts": None,
                    "max_ts": None,
                    "codes": [],
                    "matched_device_ids": [],
                },
                status=200,
            )

        w_start, w_end = _compute_default_range_from_windows(run, windows)
        preds, matched_device_ids = _overlapped_predicates(run, windows, w_start, w_end)

        if not preds:
            return JsonResponse(
                {
                    "scope": "run_summary",
                    "run_id": run_id,
                    "filters": {"group": group or None, "treatment": treatment or None},
                    "windows": windows_payload,
                    "count": 0,
                    "min_ts": None,
                    "max_ts": None,
                    "codes": [],
                    "matched_device_ids": [],
                },
                status=200,
            )

        or_q = Q()
        for device_id, start, end in preds:
            or_q |= Q(device_id=device_id) & Q(ts__gte=start) & Q(ts__lt=end)

        qs = TelemetryKV.objects.filter(or_q)
        cnt = qs.count()
        agg = qs.aggregate(Min("ts"), Max("ts"))
        codes = list(qs.values_list("code", flat=True).distinct().order_by("code"))

        return JsonResponse(
            {
                "scope": "run_summary",
                "run_id": run_id,
                "filters": {"group": group or None, "treatment": treatment or None},
                "windows": windows_payload,
                "matched_device_ids": matched_device_ids,
                "count": cnt,
                "min_ts": _dt_local_str(agg["ts__min"]) if agg["ts__min"] else None,
                "max_ts": _dt_local_str(agg["ts__max"]) if agg["ts__max"] else None,
                "codes": codes,
            },
            status=200,
        )


@method_decorator(csrf_exempt, name="dispatch")
class RunExportView(BasicAuthMixin, View):
    """
    CSV（raw 点数据）
    GET /api/v2/runs/<run_id>/export?channels=...&from=...&to=...&group=...&treatment=...
    """

    def get(self, request, run_id: int):
        run = Run.objects.get(id=run_id)

        group = (request.GET.get("group") or "").strip()
        treatment = (request.GET.get("treatment") or "").strip()
        channels = _parse_channels_param(request)

        dt_from = parse_dt(request.GET.get("from"))
        dt_to = parse_dt(request.GET.get("to"))

        windows = _get_windows(run, group, treatment)
        if not windows:
            return JsonResponse(
                {"run_id": run_id, "count": 0, "note": "No RunWindow after filters."},
                status=200,
            )

        w_start, w_end = _compute_default_range_from_windows(run, windows)
        if dt_from is None:
            dt_from = w_start
        if dt_to is None:
            dt_to = w_end or timezone.now()

        preds, _ = _overlapped_predicates(run, windows, dt_from, dt_to)
        if not preds:
            return JsonResponse(
                {"run_id": run_id, "count": 0, "note": "No overlap after from/to."},
                status=200,
            )

        or_q = Q()
        for device_id, start, end in preds:
            or_q |= Q(device_id=device_id) & Q(ts__gte=start) & Q(ts__lt=end)

        qs = TelemetryKV.objects.filter(or_q)
        if channels:
            qs = qs.filter(code__in=channels)

        qs = qs.order_by("ts", "code").values(
            "ts", "device_id", "code", "value", "unit", "quality_flag", "source"
        )

        pseudo_buffer = Echo()
        writer = csv.writer(pseudo_buffer)

        def row_iter():
            yield writer.writerow(
                ["ts", "device_id", "code", "value", "unit", "quality", "source"]
            )
            for r in qs.iterator(chunk_size=10000):
                yield writer.writerow(
                    [
                        _dt_local_str(r["ts"]),
                        r["device_id"],
                        r["code"],
                        float(r["value"]),
                        r["unit"] or "",
                        r["quality_flag"],
                        r["source"],
                    ]
                )

        name_parts = [f"run_{run_id}"]
        if group:
            name_parts.append(f"group_{group}")
        if treatment:
            name_parts.append(f"treatment_{treatment}")
        filename = "_".join(name_parts) + ".csv"

        resp = StreamingHttpResponse(row_iter(), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp


@method_decorator(csrf_exempt, name="dispatch")
class RunExportWideView(BasicAuthMixin, View):
    """
    宽表（每 bucket 一行，每 code 一个列）：必须 bucket + channels
    GET /api/v2/runs/<run_id>/export_wide?bucket=10m&channels=TEMP_C,O2_VOL_PCT
    """

    def get(self, request, run_id: int):
        run = Run.objects.get(id=run_id)

        group = (request.GET.get("group") or "").strip()
        treatment = (request.GET.get("treatment") or "").strip()
        channels = _parse_channels_param(request)
        bucket = parse_bucket(request.GET.get("bucket"))

        if not bucket:
            return JsonResponse(
                {"detail": "bucket is required for export_wide (e.g. 10m/1h)."},
                status=400,
            )
        if not channels:
            return JsonResponse(
                {"detail": "channels is required for export_wide."}, status=400
            )

        for c in channels:
            if not _safe_code(c):
                return JsonResponse({"detail": f"Invalid code: {c}"}, status=400)

        dt_from = parse_dt(request.GET.get("from"))
        dt_to = parse_dt(request.GET.get("to"))

        windows = _get_windows(run, group, treatment)
        if not windows:
            return JsonResponse(
                {"run_id": run_id, "count": 0, "note": "No RunWindow after filters."},
                status=200,
            )

        w_start, w_end = _compute_default_range_from_windows(run, windows)
        if dt_from is None:
            dt_from = w_start
        if dt_to is None:
            dt_to = w_end or timezone.now()

        preds, _ = _overlapped_predicates(run, windows, dt_from, dt_to)
        if not preds:
            return JsonResponse(
                {"run_id": run_id, "count": 0, "note": "No overlap after from/to."},
                status=200,
            )

        clauses = []
        where_params: list = []
        for device_id, start, end in preds:
            clauses.append("(device_id = %s AND ts >= %s AND ts < %s)")
            where_params.extend([device_id, start, end])
        where_or = " OR ".join(clauses)

        select_cols = []
        code_params: list = []
        for c in channels:
            alias = c.lower()
            select_cols.append(f"AVG(CASE WHEN code = %s THEN value END) AS {alias}")
            code_params.append(c)

        sql = f"""
            SELECT
                device_id,
                time_bucket(%s, ts) AS bts,
                {", ".join(select_cols)}
            FROM telemetry_telemetrykv
            WHERE ({where_or})
            GROUP BY device_id, bts
            ORDER BY device_id, bts;
        """

        # ✅ 注意：参数顺序必须与 SQL 中 %s 出现的顺序一致
        params: list = [f"{bucket.seconds} seconds"] + code_params + where_params

        pseudo_buffer = Echo()
        writer = csv.writer(pseudo_buffer)

        def row_iter():
            yield writer.writerow(["ts", "device_id"] + channels)
            with connection.cursor() as cur:
                cur.execute(sql, params)
                for row in cur.fetchall():
                    device_id = int(row[0])
                    bts = row[1]
                    vals = row[2:]
                    out_vals = [("" if v is None else float(v)) for v in vals]
                    yield writer.writerow([_dt_local_str(bts), device_id] + out_vals)

        filename = f"run_{run_id}_wide_{bucket.label}.csv"
        resp = StreamingHttpResponse(row_iter(), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp


# -------------------------
# Run Attachment APIs
# -------------------------
class RunAttachmentsView(BasicAuthMixin, ReadOrWritePermissionMixin, View):
    """Run 附件列表/上传"""
    resource_type = ResourceType.RUN_ATTACHMENT

    def get(self, request: HttpRequest, run_id: int) -> JsonResponse:
        """获取指定 Run 的所有附件"""
        try:
            run = Run.objects.get(id=run_id)
        except Run.DoesNotExist:
            return JsonResponse({"error": "Run not found"}, status=404)

        attachments = RunAttachment.objects.filter(run=run).select_related('uploaded_by')

        data = [
            {
                "id": att.id,
                "file": att.file.name,
                "filename": os.path.basename(att.file.name),
                "category": att.category,
                "category_display": att.get_category_display(),
                "description": att.description,
                "uploaded_by": att.uploaded_by.username if att.uploaded_by else None,
                "uploaded_at": att.uploaded_at.isoformat(),
                "file_size": att.file.size if att.file else 0,
                "file_url": att.file.url if att.file else None,
            }
            for att in attachments
        ]

        return JsonResponse({
            "count": len(data),
            "results": data,
        })

    def post(self, request: HttpRequest, run_id: int) -> JsonResponse:
        """上传附件到指定 Run"""
        try:
            run = Run.objects.get(id=run_id)
        except Run.DoesNotExist:
            return JsonResponse({"error": "Run not found"}, status=404)

        if 'file' not in request.FILES:
            return JsonResponse({"error": "No file provided"}, status=400)

        file = request.FILES['file']
        category = request.POST.get('category', 'other')
        description = request.POST.get('description', '')

        # 验证文件类型（可选）
        allowed_extensions = ['.csv', '.xls', '.xlsx', '.doc', '.docx', '.pdf', '.txt', '.zip', '.rar']
        file_ext = os.path.splitext(file.name)[1].lower()
        if file_ext not in allowed_extensions:
            return JsonResponse({"error": f"File type {file_ext} is not allowed"}, status=400)

        # 验证文件大小（限制为 50MB）
        max_size = 50 * 1024 * 1024
        if file.size > max_size:
            return JsonResponse({"error": "File size exceeds 50MB limit"}, status=400)

        # 创建附件记录
        attachment = RunAttachment.objects.create(
            run=run,
            file=file,
            category=category,
            description=description,
            uploaded_by=request.user,
        )

        return JsonResponse({
            "id": attachment.id,
            "file": attachment.file.name,
            "filename": os.path.basename(attachment.file.name),
            "category": attachment.category,
            "category_display": attachment.get_category_display(),
            "description": attachment.description,
            "uploaded_by": attachment.uploaded_by.username,
            "uploaded_at": attachment.uploaded_at.isoformat(),
            "file_size": attachment.file.size,
            "file_url": attachment.file.url,
        }, status=201)


class RunAttachmentDetailView(BasicAuthMixin, ReadOrWritePermissionMixin, View):
    """Run 附件详情/下载/删除/更新"""
    resource_type = ResourceType.RUN_ATTACHMENT

    def get(self, request: HttpRequest, run_id: int, attachment_id: int) -> JsonResponse | FileResponse:
        """获取附件详情或下载文件"""
        try:
            attachment = RunAttachment.objects.get(id=attachment_id, run_id=run_id)
        except RunAttachment.DoesNotExist:
            return JsonResponse({"error": "Attachment not found"}, status=404)

        # 如果查询参数中有 download=1，则返回文件下载
        if request.GET.get('download') == '1':
            try:
                file_path = attachment.file.path
                if not os.path.exists(file_path):
                    return JsonResponse({"error": "File not found on server"}, status=404)

                # 获取 MIME 类型
                content_type, _ = mimetypes.guess_type(file_path)
                if not content_type:
                    content_type = 'application/octet-stream'

                # 返回文件
                return FileResponse(
                    open(file_path, 'rb'),
                    content_type=content_type,
                    as_attachment=True,
                    filename=os.path.basename(file_path)
                )
            except Exception as e:
                return JsonResponse({"error": str(e)}, status=500)

        # 否则返回附件详情
        return JsonResponse({
            "id": attachment.id,
            "file": attachment.file.name,
            "filename": os.path.basename(attachment.file.name),
            "category": attachment.category,
            "category_display": attachment.get_category_display(),
            "description": attachment.description,
            "uploaded_by": attachment.uploaded_by.username if attachment.uploaded_by else None,
            "uploaded_at": attachment.uploaded_at.isoformat(),
            "file_size": attachment.file.size if attachment.file else 0,
            "file_url": attachment.file.url if attachment.file else None,
        })

    @method_decorator(csrf_exempt, name="dispatch")
    def patch(self, request: HttpRequest, run_id: int, attachment_id: int) -> JsonResponse:
        """更新附件的 category 和 description"""
        try:
            attachment = RunAttachment.objects.get(id=attachment_id, run_id=run_id)
        except RunAttachment.DoesNotExist:
            return JsonResponse({"error": "Attachment not found"}, status=404)

        # 解析请求体
        try:
            import json
            body = json.loads(request.body)
        except (json.JSONDecodeError, AttributeError):
            return JsonResponse({"error": "Invalid JSON"}, status=400)

        # 只允许更新 category 和 description
        if 'category' in body:
            valid_categories = ['data', 'protocol', 'report', 'other']
            category = body.get('category')
            if category not in valid_categories:
                return JsonResponse({"error": f"Invalid category. Must be one of: {', '.join(valid_categories)}"}, status=400)
            attachment.category = category

        if 'description' in body:
            description = body.get('description')
            if description is not None:
                attachment.description = str(description).strip()

        attachment.save()

        return JsonResponse({
            "id": attachment.id,
            "file": attachment.file.name,
            "filename": os.path.basename(attachment.file.name),
            "category": attachment.category,
            "category_display": attachment.get_category_display(),
            "description": attachment.description,
            "uploaded_by": attachment.uploaded_by.username if attachment.uploaded_by else None,
            "uploaded_at": attachment.uploaded_at.isoformat(),
            "file_size": attachment.file.size if attachment.file else 0,
            "file_url": attachment.file.url if attachment.file else None,
        })

    def delete(self, request: HttpRequest, run_id: int, attachment_id: int) -> JsonResponse:
        """删除附件"""
        try:
            attachment = RunAttachment.objects.get(id=attachment_id, run_id=run_id)
        except RunAttachment.DoesNotExist:
            return JsonResponse({"error": "Attachment not found"}, status=404)

        # 删除文件
        if attachment.file:
            file_path = attachment.file.path
            if os.path.exists(file_path):
                os.remove(file_path)

        # 删除数据库记录
        attachment.delete()

        return JsonResponse({"message": "Attachment deleted successfully"}, status=204)
