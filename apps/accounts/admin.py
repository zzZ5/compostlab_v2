from django.contrib import admin
from .models import UserProfile, AuditLog


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "role", "real_name", "department", "is_active", "last_login_at"]
    list_filter = ["role", "is_active", "created_at"]
    search_fields = ["user__username", "real_name", "department"]
    readonly_fields = ["created_at", "updated_at", "last_login_at", "last_login_ip"]


@admin.register(AuditLog)
class AuditLogAdmin(admin.ModelAdmin):
    list_display = ["username", "action", "resource_type", "resource_id", "success", "created_at"]
    list_filter = ["action", "success", "created_at"]
    search_fields = ["username", "resource_id", "description"]
    readonly_fields = ["created_at"]
    date_hierarchy = "created_at"
    
    def has_add_permission(self, request):
        return False
    
    def has_change_permission(self, request, obj=None):
        return False
