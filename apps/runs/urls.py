# apps/runs/urls.py
from __future__ import annotations

from django.http import HttpResponseNotAllowed
from django.urls import path
from django.views.decorators.csrf import csrf_exempt

from apps.runs import api as views


def method_router(method_to_viewcls: dict):
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
    # -------- Runs CRUD --------
    # GET  /api/v2/runs
    # POST /api/v2/runs
    path(
        "runs",
        method_router(
            {
                "GET": views.RunListView,
                "POST": views.RunCreateView,
            }
        ),
        name="run_list_create",
    ),
    # GET/PATCH/PUT/DELETE /api/v2/runs/<run_id>
    path(
        "runs/<int:run_id>",
        method_router(
            {
                "GET": views.RunDetailView,
                "PATCH": views.RunUpdateView,
                "PUT": views.RunUpdateView,
                "DELETE": views.RunDeleteView,
            }
        ),
        name="run_detail_update_delete",
    ),
    # -------- RunWindows CRUD --------
    # GET  /api/v2/runs/<run_id>/windows
    # POST /api/v2/runs/<run_id>/windows
    path(
        "runs/<int:run_id>/windows",
        method_router(
            {
                "GET": views.RunWindowListView,
                "POST": views.RunWindowCreateView,
            }
        ),
        name="run_windows_list_create",
    ),
    # PATCH/PUT/DELETE /api/v2/runs/<run_id>/windows/<window_id>
    path(
        "runs/<int:run_id>/windows/<int:window_id>",
        method_router(
            {
                "PATCH": views.RunWindowUpdateView,
                "PUT": views.RunWindowUpdateView,
                "DELETE": views.RunWindowDeleteView,
            }
        ),
        name="run_window_update_delete",
    ),
    # -------- Run Data --------
    # GET /api/v2/runs/<run_id>/telemetry
    path(
        "runs/<int:run_id>/telemetry",
        views.RunTelemetryView.as_view(),
        name="run_telemetry",
    ),
    # GET /api/v2/runs/<run_id>/summary
    path(
        "runs/<int:run_id>/summary",
        views.RunSummaryView.as_view(),
        name="run_summary",
    ),
    # GET /api/v2/runs/<run_id>/export
    path(
        "runs/<int:run_id>/export",
        views.RunExportView.as_view(),
        name="run_export",
    ),
    # GET /api/v2/runs/<run_id>/export_wide
    path(
        "runs/<int:run_id>/export_wide",
        views.RunExportWideView.as_view(),
        name="run_export_wide",
    ),
    # -------- Run Attachments --------
    # GET  /api/v2/runs/<run_id>/attachments
    # POST /api/v2/runs/<run_id>/attachments
    path(
        "runs/<int:run_id>/attachments",
        method_router(
            {
                "GET": views.RunAttachmentsView,
                "POST": views.RunAttachmentsView,
            }
        ),
        name="run_attachments_list_create",
    ),
    # GET/PATCH/DELETE /api/v2/runs/<run_id>/attachments/<attachment_id>
    path(
        "runs/<int:run_id>/attachments/<int:attachment_id>",
        method_router(
            {
                "GET": views.RunAttachmentDetailView,
                "PATCH": views.RunAttachmentDetailView,
                "DELETE": views.RunAttachmentDetailView,
            }
        ),
        name="run_attachment_detail_delete",
    ),
]
