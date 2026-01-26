"""
权限验证 Mixins

提供基于角色的权限控制 Mixins，用于 Django CBV
"""

from django.http import JsonResponse
from django.views import View

from apps.accounts.models import UserRole
from .config import ResourceType, ActionType, get_required_role_for_action
from .checks import has_permission, get_user_role_level


class RoleRequiredMixin:
    """
    基于角色的权限检查 Mixin

    用法：
        class MyView(JWTAuthMixin, RoleRequiredMixin, View):
            required_role = "operator"  # 或 UserRole.OPERATOR
    """
    required_role = UserRole.READONLY  # 默认只读

    def dispatch(self, request, *args, **kwargs):
        user = getattr(request, "user", None)

        if not has_permission(user, self.required_role):
            return JsonResponse(
                {
                    "detail": f"Permission denied. Required role: {self.required_role.value}",
                    "required_role": self.required_role.value,
                },
                status=403,
            )

        return super().dispatch(request, *args, **kwargs)


class OperatorRequiredMixin(RoleRequiredMixin):
    """操作员权限（快捷方式）"""
    required_role = UserRole.OPERATOR


class AdminRequiredMixin(RoleRequiredMixin):
    """管理员权限（快捷方式）"""
    required_role = UserRole.ADMIN


class ResourcePermissionMixin:
    """
    基于资源和操作的权限检查 Mixin

    用法：
        class DeviceUpdateView(JWTAuthMixin, ResourcePermissionMixin, View):
            resource_type = ResourceType.DEVICE
            action_type = ActionType.WRITE
    """
    resource_type: ResourceType = None
    action_type: ActionType = None

    def dispatch(self, request, *args, **kwargs):
        user = getattr(request, "user", None)

        if not self.resource_type or not self.action_type:
            raise ValueError(
                "ResourcePermissionMixin requires resource_type and action_type to be set"
            )

        from .checks import check_permission

        if not check_permission(user, self.resource_type, self.action_type):
            required_role = get_required_role_for_action(
                self.resource_type,
                self.action_type
            )
            return JsonResponse(
                {
                    "detail": f"Permission denied for {self.resource_type.value}.{self.action_type.value}",
                    "required_role": required_role.value,
                    "resource": self.resource_type.value,
                    "action": self.action_type.value,
                },
                status=403,
            )

        return super().dispatch(request, *args, **kwargs)


class ReadOrWritePermissionMixin:
    """
    根据请求方法自动判断读/写权限的 Mixin

    - GET, HEAD, OPTIONS: READ 权限
    - POST, PUT, PATCH, DELETE: WRITE 权限

    用法：
        class DeviceListView(JWTAuthMixin, ReadOrWritePermissionMixin, View):
            resource_type = ResourceType.DEVICE
    """
    resource_type: ResourceType = None

    def dispatch(self, request, *args, **kwargs):
        user = getattr(request, "user", None)

        if not self.resource_type:
            raise ValueError(
                "ReadOrWritePermissionMixin requires resource_type to be set"
            )

        from .checks import check_permission

        # 根据请求方法确定操作类型
        method = request.method.upper()
        if method in ("GET", "HEAD", "OPTIONS"):
            action = ActionType.READ
        elif method == "DELETE":
            action = ActionType.DELETE
        else:
            # POST, PUT, PATCH 视为写操作
            action = ActionType.WRITE

        if not check_permission(user, self.resource_type, action):
            required_role = get_required_role_for_action(
                self.resource_type,
                action
            )
            return JsonResponse(
                {
                    "detail": f"Permission denied for {self.resource_type.value}.{action.value}",
                    "required_role": required_role.value,
                    "resource": self.resource_type.value,
                    "action": action.value,
                },
                status=403,
            )

        return super().dispatch(request, *args, **kwargs)
