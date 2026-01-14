from django.urls import path
from .api import (
    AnnouncementListView,
    AnnouncementCreateView,
    AnnouncementDetailView,
    AnnouncementUpdateView,
    AnnouncementDeleteView,
    MyAnnouncementsView,
    MarkAsReadView,
    UnreadCountView,
)

urlpatterns = [
    # 管理员 API
    path("", AnnouncementListView.as_view(), name="announcement-list"),
    path("create", AnnouncementCreateView.as_view(), name="announcement-create"),
    path("unread-count", UnreadCountView.as_view(), name="unread-count"),
    path("my", MyAnnouncementsView.as_view(), name="my-announcements"),
    path("<int:announcement_id>", AnnouncementDetailView.as_view(), name="announcement-detail"),
    path("<int:announcement_id>/update", AnnouncementUpdateView.as_view(), name="announcement-update"),
    path("<int:announcement_id>/delete", AnnouncementDeleteView.as_view(), name="announcement-delete"),
    path("<int:announcement_id>/read", MarkAsReadView.as_view(), name="mark-read"),
]
