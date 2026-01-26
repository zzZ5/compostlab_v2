from django.http import HttpResponseNotAllowed
from django.urls import path
from django.views.decorators.csrf import csrf_exempt
from .api import (
    AnnouncementListView,
    AnnouncementCreateView,
    AnnouncementDetailView,
    AnnouncementUpdateView,
    AnnouncementDeleteView,
    MyAnnouncementsView,
    MyHistoryView,
    MarkAsReadView,
    UnreadCountView,
)


def method_router(method_to_viewcls: dict):
    """
    把同一个 URL 的不同 HTTP method 分发到不同 View 类。
    用法：
      path("announcements/", method_router({"GET": A, "POST": B}))
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
    # 管理员 API
    path(
        "",
        method_router(
            {
                "GET": AnnouncementListView,
                "POST": AnnouncementCreateView,
            }
        ),
        name="announcement-list-create",
    ),
    # 兼容旧路径
    path("create", AnnouncementCreateView.as_view(), name="announcement-create"),
    path("unread-count", UnreadCountView.as_view(), name="unread-count"),

    # 用户 API
    path("my", MyAnnouncementsView.as_view(), name="my-announcements"),
    path("my/history", MyHistoryView.as_view(), name="my-history"),

    path(
        "<int:announcement_id>",
        method_router(
            {
                "GET": AnnouncementDetailView,
                "PUT": AnnouncementUpdateView,
                "PATCH": AnnouncementUpdateView,
                "DELETE": AnnouncementDeleteView,
            }
        ),
        name="announcement-detail-update-delete",
    ),
    path("<int:announcement_id>/update", AnnouncementUpdateView.as_view(), name="announcement-update"),
    path("<int:announcement_id>/delete", AnnouncementDeleteView.as_view(), name="announcement-delete"),
    path("<int:announcement_id>/read", MarkAsReadView.as_view(), name="mark-read"),
]
