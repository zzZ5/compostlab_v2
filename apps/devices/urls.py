# apps/devices/urls.py
from __future__ import annotations

from django.http import HttpResponseNotAllowed
from django.urls import path
from django.views.decorators.csrf import csrf_exempt

from apps.devices import api as views


def method_router(method_to_viewcls: dict):
    """
    把同一个 URL 的不同 HTTP method 分发到不同 View 类。
    用法：
      path("devices", method_router({"GET": A, "POST": B}))
    """

    @csrf_exempt
    def _view(request, *args, **kwargs):
        m = request.method.upper()
        if m == "HEAD" and "GET" in method_to_viewcls:
            m = "GET"
        view_cls = method_to_viewcls.get(m)
        if not view_cls:
            return HttpResponseNotAllowed(list(method_to_viewcls.keys()))
        return view_cls.as_view()(request, *args, **kwargs)

    return _view


urlpatterns = [
    # -------- Devices --------
    # GET  /api/v2/devices
    # POST /api/v2/devices
    path(
        "devices",
        method_router(
            {
                "GET": views.DeviceListView,
                "POST": views.DeviceCreateView,
            }
        ),
        name="device_list_create",
    ),
    # GET /api/v2/devices/tree?with_latest=1
    path("devices/tree", views.DeviceTreeView.as_view(), name="device_tree"),
    # GET    /api/v2/devices/<device_id>
    # PATCH  /api/v2/devices/<device_id>
    # PUT    /api/v2/devices/<device_id>
    # DELETE /api/v2/devices/<device_id>
    path(
        "devices/<int:device_id>",
        method_router(
            {
                "GET": views.DeviceDetailView,
                "PATCH": views.DeviceUpdateView,
                "PUT": views.DeviceUpdateView,
                "DELETE": views.DeviceDeleteView,
            }
        ),
        name="device_detail_update_delete",
    ),
    # -------- Channels under Device --------
    # GET  /api/v2/devices/<device_id>/channels
    # POST /api/v2/devices/<device_id>/channels
    path(
        "devices/<int:device_id>/channels",
        method_router(
            {
                "GET": views.DeviceChannelsView,
                "POST": views.ChannelCreateView,
            }
        ),
        name="device_channels_list_create",
    ),
    # GET /api/v2/devices/<device_id>/channels/<channel_id>
    path(
        "devices/<int:device_id>/channels/<int:channel_id>",
        method_router(
            {
                "GET": views.ChannelDetailView,
                "PATCH": views.ChannelUpdateView,
                "PUT": views.ChannelUpdateView,
                "DELETE": views.ChannelDeleteView,
            }
        ),
        name="device_channel_detail_update_delete",
    ),
    # GET /api/v2/devices/<device_id>/channels/by-code/<code>
    path(
        "devices/<int:device_id>/channels/by-code/<str:code>",
        views.ChannelByCodeView.as_view(),
        name="device_channel_by_code",
    ),
    # PUT /api/v2/devices/<device_id>/channels/by-code/<code>
    # (Upsert：不存在就创建、存在就更新)
    path(
        "devices/<int:device_id>/channels/by-code/<str:code>/upsert",
        method_router({"PUT": views.ChannelUpsertView}),
        name="device_channel_upsert_by_code",
    ),
    # apps/devices/urls.py （urlpatterns 末尾追加）
    # -------- Device Commands --------
    path(
        "devices/<int:device_id>/commands",
        method_router(
            {
                "GET": views.DeviceCommandListCreateView,
                "POST": views.DeviceCommandListCreateView,
            }
        ),
        name="device_commands_list_create",
    ),
    path(
        "devices/<int:device_id>/commands/<int:command_id>",
        method_router({"GET": views.DeviceCommandDetailView}),
        name="device_command_detail",
    ),
    # -------- Control Templates --------
    # GET  /api/v2/control-templates?device_id=<id>&is_active=1
    # POST /api/v2/control-templates
    path(
        "control-templates",
        method_router(
            {
                "GET": views.ControlTemplateListView,
                "POST": views.ControlTemplateListView,
            }
        ),
        name="control_template_list_create",
    ),
    # GET    /api/v2/control-templates/<id>
    # PATCH  /api/v2/control-templates/<id>
    # PUT    /api/v2/control-templates/<id>
    # DELETE /api/v2/control-templates/<id>
    path(
        "control-templates/<int:template_id>",
        method_router(
            {
                "GET": views.ControlTemplateDetailView,
                "PATCH": views.ControlTemplateDetailView,
                "PUT": views.ControlTemplateDetailView,
                "DELETE": views.ControlTemplateDetailView,
            }
        ),
        name="control_template_detail_update_delete",
    ),
]
