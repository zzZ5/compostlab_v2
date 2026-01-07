# config/urls.py  （或你的项目根 urls.py）
from __future__ import annotations

from django.contrib import admin
from django.urls import path, include

urlpatterns = [
    # ✅ Django Admin 后台入口
    path("admin/", admin.site.urls),
    # ✅ 你的 API v2
    path("api/v2/", include("apps.devices.urls")),
    path("api/v2/", include("apps.runs.urls")),
    path("api/v2/", include("apps.telemetry.urls")),
]
