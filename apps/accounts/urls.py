from django.urls import path
from . import api

app_name = "accounts"

urlpatterns = [
    # 认证
    path("auth/login", api.LoginView.as_view(), name="login"),
    path("auth/refresh", api.RefreshTokenView.as_view(), name="refresh"),
    path("auth/logout", api.LogoutView.as_view(), name="logout"),
    path("auth/me", api.MeView.as_view(), name="me"),
    path("auth/change-password", api.ChangePasswordView.as_view(), name="change_password"),
    path("auth/my-logs", api.MyAuditLogListView.as_view(), name="my_logs"),
    
    # 用户管理（管理员）
    path("users", api.UserListView.as_view(), name="user_list"),
    path("users/<int:user_id>", api.UserDetailView.as_view(), name="user_detail"),
    path("users/create", api.UserCreateView.as_view(), name="user_create"),
    path("users/<int:user_id>/update", api.UserUpdateView.as_view(), name="user_update"),
    path("users/<int:user_id>/toggle-active", api.UserToggleActiveView.as_view(), name="user_toggle_active"),
    
    # 审计日志（管理员）
    path("audit-logs", api.AuditLogListView.as_view(), name="audit_logs"),
]
