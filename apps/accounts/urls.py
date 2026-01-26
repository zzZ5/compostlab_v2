from django.http import HttpResponseNotAllowed
from django.urls import path
from django.views.decorators.csrf import csrf_exempt
from . import api

app_name = "accounts"


def method_router(method_to_viewcls: dict):
    """
    把同一个 URL 的不同 HTTP method 分发到不同 View 类。
    用法：
      path("users", method_router({"GET": A, "POST": B}))
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
    # 认证
    path("auth/login", api.LoginView.as_view(), name="login"),
    path("auth/refresh", api.RefreshTokenView.as_view(), name="refresh"),
    path("auth/logout", api.LogoutView.as_view(), name="logout"),
    path("auth/me", api.MeView.as_view(), name="me"),
    path("auth/change-password", api.ChangePasswordView.as_view(), name="change_password"),
    path("auth/my-logs", api.MyAuditLogListView.as_view(), name="my_logs"),
    
    # 用户管理（管理员）
    path(
        "users",
        method_router(
            {
                "GET": api.UserListView,
                "POST": api.UserCreateView,
            }
        ),
        name="user_list_create",
    ),
    # 兼容旧路径
    path("users/create", api.UserCreateView.as_view(), name="user_create"),
    path(
        "users/<int:user_id>",
        method_router(
            {
                "GET": api.UserDetailView,
                "PUT": api.UserUpdateView,
                "PATCH": api.UserUpdateView,
            }
        ),
        name="user_detail_update",
    ),
    # 兼容旧路径
    path("users/<int:user_id>/update", api.UserUpdateView.as_view(), name="user_update"),
    path("users/<int:user_id>/toggle-active", api.UserToggleActiveView.as_view(), name="user_toggle_active"),
    
    # 审计日志（管理员）
    path("audit-logs", api.AuditLogListView.as_view(), name="audit_logs"),
]
