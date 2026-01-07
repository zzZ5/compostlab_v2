# apps/telemetry/urls.py
from __future__ import annotations

from django.urls import path

from apps.telemetry import api as views


urlpatterns = [
    # 设备级 telemetry
    # GET /api/v2/devices/<device_id>/telemetry?channels=...&from=...&to=...&bucket=10m
    path(
        "devices/<int:device_id>/telemetry",
        views.DeviceTelemetryView.as_view(),
        name="device_telemetry",
    ),
    # 通道级 telemetry
    # GET /api/v2/devices/<device_id>/channels/<code>/telemetry?from=...&to=...&bucket=10m
    path(
        "devices/<int:device_id>/channels/<str:code>/telemetry",
        views.DeviceChannelTelemetryView.as_view(),
        name="device_channel_telemetry",
    ),
    # 最新值（device）
    # GET /api/v2/devices/<device_id>/latest?channels=...
    path(
        "devices/<int:device_id>/latest",
        views.DeviceLatestView.as_view(),
        name="device_latest",
    ),
    # 最新值（channel）
    # GET /api/v2/devices/<device_id>/channels/<code>/latest
    path(
        "devices/<int:device_id>/channels/<str:code>/latest",
        views.DeviceChannelLatestView.as_view(),
        name="device_channel_latest",
    ),
    # summary（device）
    # GET /api/v2/devices/<device_id>/summary
    path(
        "devices/<int:device_id>/summary",
        views.DeviceSummaryView.as_view(),
        name="device_summary",
    ),
    # 导出（device）
    # GET /api/v2/devices/<device_id>/export?from=...&to=...&channels=...
    path(
        "devices/<int:device_id>/export",
        views.DeviceExportView.as_view(),
        name="device_export",
    ),
]
