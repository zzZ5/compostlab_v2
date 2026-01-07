# apps/telemetry/api.py
# -*- coding: utf-8 -*-
"""
Telemetry API

提供设备维度的遥测查询 / 最新值 / 概览 / 导出

⚠️ 时间格式与时区（按你的要求统一）：
- Django/DB 内部一般存 UTC（USE_TZ=True）
- 对外输出统一转为 settings.TIME_ZONE（Asia/Shanghai）
- 输出格式统一为："YYYY-MM-DD HH:MM:SS"
  例如： "2026-01-05 11:37:51"

涉及范围：
- JSON 返回中的 ts / from / to / min_ts / max_ts
- CSV 导出中的 ts
"""

from __future__ import annotations

import csv
from typing import List, Optional

from django.db import connection
from django.db.models import Min, Max
from django.http import JsonResponse, StreamingHttpResponse
from django.utils import timezone
from django.views import View

from apps.api.mixins import BasicAuthMixin
from apps.api.utils import parse_dt, parse_bucket
from apps.devices.models import Device
from apps.telemetry.models import TelemetryKV


# -------------------------
# helpers
# -------------------------
def _dt_local_str(dt) -> Optional[str]:
    """
    将 datetime 转成本地时区并输出为 "YYYY-MM-DD HH:MM:SS" 字符串
    - dt 为 None -> None
    """
    if not dt:
        return None
    dt_local = timezone.localtime(dt)
    return dt_local.strftime("%Y-%m-%d %H:%M:%S")


def _parse_channels_param(request) -> List[str]:
    """
    query: ?channels=TEMP_C,O2_VOL_PCT
    returns: ["TEMP_C","O2_VOL_PCT"]
    """
    ch = (request.GET.get("channels") or "").strip()
    if not ch:
        return []
    return [x.strip().upper() for x in ch.split(",") if x.strip()]


class Echo:
    """用于 StreamingHttpResponse 的伪 buffer（csv.writer 需要 write()）"""

    def write(self, value):
        return value


class DeviceTelemetryView(BasicAuthMixin, View):
    """
    GET /api/v2/devices/<device_id>/telemetry?channels=TEMP_C,O2_VOL_PCT&from=...&to=...&bucket=10m
    - bucket 为空：raw 点数据（ORM）
    - bucket 非空：Timescale time_bucket 聚合（avg，SQL）
    """

    def get(self, request, device_id: int):
        Device.objects.get(id=device_id)

        codes = _parse_channels_param(request)

        dt_from = parse_dt(request.GET.get("from"))
        dt_to = parse_dt(request.GET.get("to")) or timezone.now()
        bucket = parse_bucket(request.GET.get("bucket"))

        limit = int(request.GET.get("limit") or "20000")
        limit = max(1, min(limit, 200000))

        # -------- bucket aggregation via SQL (Timescale) --------
        if bucket:
            params: list = [f"{bucket.seconds} seconds", device_id]
            where = ""

            if dt_from is not None:
                where += " AND ts >= %s"
                params.append(dt_from)

            where += " AND ts < %s"
            params.append(dt_to)

            if codes:
                where += " AND code = ANY(%s)"
                params.append(codes)

            sql = f"""
                SELECT
                    device_id,
                    code,
                    time_bucket(%s, ts) AS bts,
                    AVG(value) AS vavg,
                    COALESCE(NULLIF(unit,''),'') AS unit
                FROM telemetry_telemetrykv
                WHERE device_id = %s
                  {where}
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
                    }
                )

            return JsonResponse(
                {
                    "scope": "device",
                    "device_id": device_id,
                    "from": _dt_local_str(dt_from) if dt_from else None,
                    "to": _dt_local_str(dt_to),
                    "bucket": bucket.label,
                    "filters": {"channels": codes or None},
                    "count": len(out),
                    "data": out,
                },
                status=200,
            )

        # -------- raw points via ORM --------
        qs = TelemetryKV.objects.filter(device_id=device_id, ts__lt=dt_to)
        if dt_from is not None:
            qs = qs.filter(ts__gte=dt_from)
        if codes:
            qs = qs.filter(code__in=codes)

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
                "scope": "device",
                "device_id": device_id,
                "from": _dt_local_str(dt_from) if dt_from else None,
                "to": _dt_local_str(dt_to),
                "filters": {"channels": codes or None},
                "count": len(out),
                "data": out,
            },
            status=200,
        )


class DeviceChannelTelemetryView(BasicAuthMixin, View):
    """
    GET /api/v2/devices/<device_id>/channels/<code>/telemetry?from=...&to=...&bucket=10m
    """

    def get(self, request, device_id: int, code: str):
        Device.objects.get(id=device_id)

        code = (code or "").strip().upper()

        dt_from = parse_dt(request.GET.get("from"))
        dt_to = parse_dt(request.GET.get("to")) or timezone.now()
        bucket = parse_bucket(request.GET.get("bucket"))

        limit = int(request.GET.get("limit") or "20000")
        limit = max(1, min(limit, 200000))

        # --- bucket aggregation (SQL) ---
        if bucket:
            params: list = [f"{bucket.seconds} seconds", device_id, code]
            where = ""

            if dt_from is not None:
                where += " AND ts >= %s"
                params.append(dt_from)

            where += " AND ts < %s"
            params.append(dt_to)

            sql = f"""
                SELECT
                    device_id,
                    code,
                    time_bucket(%s, ts) AS bts,
                    AVG(value) AS vavg,
                    COALESCE(NULLIF(unit,''),'') AS unit
                FROM telemetry_telemetrykv
                WHERE device_id = %s
                  AND code = %s
                  {where}
                GROUP BY device_id, code, bts, unit
                ORDER BY bts
                LIMIT %s;
            """
            params.append(limit)

            with connection.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()

            out = []
            for did, ccode, bts, vavg, unit in rows:
                out.append(
                    {
                        "device_id": int(did),
                        "code": str(ccode),
                        "ts": _dt_local_str(bts),
                        "value": float(vavg),
                        "unit": unit or "",
                        "agg": "avg",
                        "bucket": bucket.label,
                    }
                )

            return JsonResponse(
                {
                    "scope": "channel",
                    "device_id": device_id,
                    "code": code,
                    "from": _dt_local_str(dt_from) if dt_from else None,
                    "to": _dt_local_str(dt_to),
                    "bucket": bucket.label,
                    "count": len(out),
                    "data": out,
                },
                status=200,
            )

        # --- raw points (ORM) ---
        qs = TelemetryKV.objects.filter(device_id=device_id, code=code, ts__lt=dt_to)
        if dt_from is not None:
            qs = qs.filter(ts__gte=dt_from)

        rows = qs.values(
            "device_id", "code", "ts", "value", "unit", "quality_flag", "source"
        ).order_by("ts")[:limit]

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
                "scope": "channel",
                "device_id": device_id,
                "code": code,
                "from": _dt_local_str(dt_from) if dt_from else None,
                "to": _dt_local_str(dt_to),
                "count": len(out),
                "data": out,
            },
            status=200,
        )


class DeviceLatestView(BasicAuthMixin, View):
    """
    GET /api/v2/devices/<device_id>/latest?channels=TEMP_C,O2_VOL_PCT
    - 每个 code 返回一条最新记录
    """

    def get(self, request, device_id: int):
        Device.objects.get(id=device_id)

        codes = _parse_channels_param(request)

        where = "WHERE device_id = %s"
        params: list = [device_id]

        if codes:
            where += " AND code = ANY(%s)"
            params.append(codes)

        sql = f"""
            SELECT DISTINCT ON (code)
                device_id, code, ts, value,
                COALESCE(NULLIF(unit,''),'') AS unit,
                quality_flag, source
            FROM telemetry_telemetrykv
            {where}
            ORDER BY code, ts DESC;
        """

        with connection.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        out = []
        for did, code, ts, val, unit, qf, src in rows:
            out.append(
                {
                    "device_id": int(did),
                    "code": str(code),
                    "ts": _dt_local_str(ts),
                    "value": float(val),
                    "unit": unit or "",
                    "quality": qf,
                    "source": src,
                }
            )

        return JsonResponse(
            {
                "scope": "device_latest",
                "device_id": device_id,
                "filters": {"channels": codes or None},
                "count": len(out),
                "data": out,
            },
            status=200,
        )


class DeviceChannelLatestView(BasicAuthMixin, View):
    """
    GET /api/v2/devices/<device_id>/channels/<code>/latest
    """

    def get(self, request, device_id: int, code: str):
        Device.objects.get(id=device_id)

        code = (code or "").strip().upper()

        row = (
            TelemetryKV.objects.filter(device_id=device_id, code=code)
            .order_by("-ts")
            .first()
        )

        if not row:
            return JsonResponse(
                {
                    "scope": "channel_latest",
                    "device_id": device_id,
                    "code": code,
                    "data": None,
                },
                status=200,
            )

        return JsonResponse(
            {
                "scope": "channel_latest",
                "device_id": device_id,
                "code": code,
                "data": {
                    "device_id": device_id,
                    "code": code,
                    "ts": _dt_local_str(row.ts),
                    "value": float(row.value),
                    "unit": row.unit or "",
                    "quality": row.quality_flag,
                    "source": row.source,
                },
            },
            status=200,
        )


class DeviceSummaryView(BasicAuthMixin, View):
    """
    GET /api/v2/devices/<device_id>/summary
    - 返回设备遥测数据量、最早/最晚时间、包含的 code 列表
    """

    def get(self, request, device_id: int):
        Device.objects.get(id=device_id)

        cnt = TelemetryKV.objects.filter(device_id=device_id).count()
        agg = TelemetryKV.objects.filter(device_id=device_id).aggregate(
            Min("ts"), Max("ts")
        )
        chs = list(
            TelemetryKV.objects.filter(device_id=device_id)
            .values_list("code", flat=True)
            .distinct()
            .order_by("code")
        )

        return JsonResponse(
            {
                "scope": "device_summary",
                "device_id": device_id,
                "count": cnt,
                "min_ts": _dt_local_str(agg["ts__min"]) if agg["ts__min"] else None,
                "max_ts": _dt_local_str(agg["ts__max"]) if agg["ts__max"] else None,
                "channels": chs,
            },
            status=200,
        )


class DeviceExportView(BasicAuthMixin, View):
    """
    GET /api/v2/devices/<device_id>/export?from=...&to=...&channels=...
    CSV Streaming（raw 点数据）
    - ts 输出统一为 "YYYY-MM-DD HH:MM:SS"
    """

    def get(self, request, device_id: int):
        Device.objects.get(id=device_id)

        codes = _parse_channels_param(request)
        dt_from = parse_dt(request.GET.get("from"))
        dt_to = parse_dt(request.GET.get("to")) or timezone.now()

        qs = TelemetryKV.objects.filter(device_id=device_id, ts__lt=dt_to)
        if dt_from is not None:
            qs = qs.filter(ts__gte=dt_from)
        if codes:
            qs = qs.filter(code__in=codes)

        qs = qs.order_by("ts", "code").values(
            "ts", "device_id", "code", "value", "unit", "quality_flag", "source"
        )

        pseudo_buffer = Echo()
        writer = csv.writer(pseudo_buffer)

        def row_iter():
            yield writer.writerow(
                [
                    "ts",
                    "device_id",
                    "code",
                    "value",
                    "unit",
                    "quality",
                    "source",
                ]
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

        filename = f"device_{device_id}_telemetry.csv"
        resp = StreamingHttpResponse(row_iter(), content_type="text/csv; charset=utf-8")
        resp["Content-Disposition"] = f'attachment; filename="{filename}"'
        return resp
