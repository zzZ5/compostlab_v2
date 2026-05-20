from django.urls import path

from .api import LiteratureDigestDetailView, LiteratureDigestListView


urlpatterns = [
    path("digests", LiteratureDigestListView.as_view(), name="literature-digest-list"),
    path("digests/<slug:slug>", LiteratureDigestDetailView.as_view(), name="literature-digest-detail"),
]
