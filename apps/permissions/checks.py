"""
权限检查工具函数
"""

from typing import Optional
from django.contrib.auth.models import User

from apps.accounts.models import UserProfile, UserRole
from .config import PermissionMatrix, ResourceType, ActionType, get_required_role_for_action


def get_user_role(user: User) -> Optional[UserRole]:
    """
    获取用户的角色

    Args:
        user: User 对象

    Returns:
        UserRole: 用户角色，如果没有 profile 或未启用则返回 None
    """
    if not user or not user.is_authenticated:
        return None

    # 超级用户总是有 admin 权限
    if user.is_superuser:
        return UserRole.ADMIN

    # 检查用户是否有 UserProfile
    try:
        profile = user.profile
    except UserProfile.DoesNotExist:
        return None

    # 检查用户是否启用
    if not profile.is_active:
        return None

    return profile.role


def get_user_role_level(user: User) -> int:
    """
    获取用户的角色等级

    Args:
        user: User 对象

    Returns:
        int: 角色等级 (0=无权限, 1=readonly, 2=operator, 3=admin)
    """
    role = get_user_role(user)
    if role is None:
        return 0
    return PermissionMatrix.ROLE_LEVELS.get(role, 0)


def has_permission(
    user: Optional[User],
    required_role: UserRole
) -> bool:
    """
    检查用户是否有足够权限（基于角色）

    Args:
        user: User 对象
        required_role: 需要的最低角色

    Returns:
        bool: 是否有权限

    规则：
    - is_superuser: 超级管理员，拥有所有权限
    - 未启用的用户（is_active=False）：没有任何权限
    - 没有 profile 的用户：只有 readonly 权限（向后兼容）
    - 其他用户: 完全依赖 UserProfile.role 判断权限
      - is_staff 不再自动赋予 admin 权限
      - is_staff 用户也必须有对应的 UserProfile.role
    """
    if not user or not user.is_authenticated:
        return False

    # 超级用户总是有权限
    if user.is_superuser:
        return True

    # 检查用户是否有 UserProfile
    try:
        profile = user.profile
    except UserProfile.DoesNotExist:
        # 没有 profile 的用户，只有 readonly 权限
        return required_role == UserRole.READONLY

    # 检查用户是否启用
    if not profile.is_active:
        # 未启用的用户没有任何权限
        return False

    # 获取用户角色
    role = get_user_role(user)
    if role is None:
        # 这行理论上不会执行，因为前面已经检查了 profile 和 is_active
        return False

    # 检查角色等级
    user_level = PermissionMatrix.ROLE_LEVELS.get(role, 0)
    required_level = PermissionMatrix.ROLE_LEVELS.get(required_role, 999)

    return user_level >= required_level


def check_permission(
    user: Optional[User],
    resource: ResourceType,
    action: ActionType
) -> bool:
    """
    检查用户是否有权限对特定资源执行某个操作

    Args:
        user: User 对象
        resource: 资源类型
        action: 操作类型

    Returns:
        bool: 是否有权限
    """
    if not user or not user.is_authenticated:
        return False

    # 超级用户总是有权限
    if user.is_superuser:
        return True

    # 获取用户角色
    role = get_user_role(user)
    if role is None:
        return False

    # 检查权限矩阵
    return PermissionMatrix.can_access(role, resource, action)


def require_permission(
    user: Optional[User],
    required_role: UserRole
) -> None:
    """
    检查权限，如果不满足则抛出 PermissionDenied 异常

    Args:
        user: User 对象
        required_role: 需要的最低角色

    Raises:
        PermissionDenied: 权限不足
    """
    from django.core.exceptions import PermissionDenied

    if not has_permission(user, required_role):
        raise PermissionDenied(
            f"Permission denied. Required role: {required_role.value}"
        )


def require_resource_permission(
    user: Optional[User],
    resource: ResourceType,
    action: ActionType
) -> None:
    """
    检查资源操作权限，如果不满足则抛出 PermissionDenied 异常

    Args:
        user: User 对象
        resource: 资源类型
        action: 操作类型

    Raises:
        PermissionDenied: 权限不足
    """
    from django.core.exceptions import PermissionDenied

    required_role = get_required_role_for_action(resource, action)

    if not has_permission(user, required_role):
        raise PermissionDenied(
            f"Permission denied for {resource.value}.{action.value}. "
            f"Required role: {required_role.value}"
        )
