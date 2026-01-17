# config/urls.py  （或你的项目根 urls.py）
from __future__ import annotations

from django.contrib import admin
from django.urls import path, include
from django.conf import settings
from django.conf.urls.static import static

urlpatterns = [
    # ✅ Django Admin 后台入口
    path("admin/", admin.site.urls),
    # ✅ 你的 API v2
    path("api/v2/", include("apps.accounts.urls")),
    path("api/v2/", include("apps.devices.urls")),
    path("api/v2/", include("apps.runs.urls")),
    path("api/v2/", include("apps.telemetry.urls")),
    path("api/v2/announcements/", include("apps.announcements.urls")),
]

# 静态文件服务（生产环境由 whitenoise 处理，这里仅用于开发）
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
    # 媒体文件服务（用于上传的文件）
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
else:
    # 生产环境：使用 Django 直接服务媒体文件（简单方案）
    # 在生产环境中，建议使用 Nginx 或其他 Web 服务器来服务静态文件和媒体文件
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
