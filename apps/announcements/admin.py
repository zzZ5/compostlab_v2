from django.contrib import admin
from .models import Announcement, AnnouncementRead


@admin.register(Announcement)
class AnnouncementAdmin(admin.ModelAdmin):
    list_display = [
        "title",
        "category",
        "priority",
        "target_role",
        "is_active",
        "is_pinned",
        "created_by",
        "created_at",
    ]
    list_filter = ["category", "priority", "target_role", "is_active", "is_pinned"]
    search_fields = ["title", "content"]
    ordering = ["-is_pinned", "-priority", "-created_at"]
    readonly_fields = ["created_by", "created_at", "updated_at"]

    def save_model(self, request, obj, form, change):
        if not change:  # 创建时
            obj.created_by = request.user
        super().save_model(request, obj, form, change)


@admin.register(AnnouncementRead)
class AnnouncementReadAdmin(admin.ModelAdmin):
    list_display = ["announcement", "user", "read_at"]
    list_filter = ["read_at"]
    ordering = ["-read_at"]
    readonly_fields = ["announcement", "user", "read_at"]
