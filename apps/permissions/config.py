"""
权限配置中心 - 定义统一的角色权限矩阵
"""

from enum import Enum
from typing import Dict, List, Optional
from apps.accounts.models import UserRole


class ResourceType(str, Enum):
    """资源类型枚举"""
    # 设备相关
    DEVICE = "device"
    DEVICE_COMMAND = "device_command"

    # 通道相关
    CHANNEL = "channel"

    # 运行批次相关
    RUN = "run"

    # 遥测数据相关
    TELEMETRY = "telemetry"

    # 脚本相关
    SCRIPT = "script"
    SCRIPT_EXECUTE = "script_execute"

    # 公告相关
    ANNOUNCEMENT = "announcement"
    ANNOUNCEMENT_CREATE = "announcement_create"
    ANNOUNCEMENT_UPDATE = "announcement_update"
    ANNOUNCEMENT_DELETE = "announcement_delete"
    ANNOUNCEMENT_READ_ALL = "announcement_read_all"

    # 用户管理
    USER = "user"
    USER_CREATE = "user_create"
    USER_UPDATE = "user_update"
    USER_DELETE = "user_delete"
    USER_ENABLE = "user_enable"
    USER_DISABLE = "user_disable"

    # 审计日志
    AUDIT_LOG = "audit_log"

    # 配置相关
    CONFIG = "config"


class ActionType(str, Enum):
    """操作类型枚举"""
    READ = "read"          # 读取
    WRITE = "write"        # 写入/修改
    DELETE = "delete"      # 删除
    CREATE = "create"      # 创建
    EXECUTE = "execute"    # 执行
    MANAGE = "manage"      # 管理


class PermissionMatrix:
    """
    统一的权限矩阵

    规则说明：
    - READONLY: 只能执行 READ 操作
    - OPERATOR: 可以执行 READ, WRITE, CREATE, EXECUTE 操作
    - ADMIN: 可以执行所有操作
    - is_superuser: 拥有所有权限
    """

    # 资源权限矩阵
    # 格式: {ResourceType: {ActionType: minimal_required_role}}
    MATRIX: Dict[ResourceType, Dict[ActionType, UserRole]] = {
        # 设备相关
        ResourceType.DEVICE: {
            ActionType.READ: UserRole.READONLY,
            ActionType.WRITE: UserRole.OPERATOR,
            ActionType.CREATE: UserRole.OPERATOR,
            ActionType.DELETE: UserRole.ADMIN,
            ActionType.MANAGE: UserRole.ADMIN,
        },
        ResourceType.DEVICE_COMMAND: {
            ActionType.READ: UserRole.READONLY,
            ActionType.EXECUTE: UserRole.OPERATOR,
            ActionType.MANAGE: UserRole.ADMIN,
        },

        # 通道相关
        ResourceType.CHANNEL: {
            ActionType.READ: UserRole.READONLY,
            ActionType.WRITE: UserRole.OPERATOR,
            ActionType.CREATE: UserRole.OPERATOR,
            ActionType.DELETE: UserRole.ADMIN,
            ActionType.MANAGE: UserRole.ADMIN,
        },

        # 运行批次相关
        ResourceType.RUN: {
            ActionType.READ: UserRole.READONLY,
            ActionType.WRITE: UserRole.OPERATOR,
            ActionType.CREATE: UserRole.OPERATOR,
            ActionType.DELETE: UserRole.ADMIN,
            ActionType.MANAGE: UserRole.ADMIN,
        },

        # 遥测数据相关
        ResourceType.TELEMETRY: {
            ActionType.READ: UserRole.READONLY,
            # 注意：遥测数据通常只读，特殊写操作需要在业务层单独验证
        },

        # 脚本相关
        ResourceType.SCRIPT: {
            ActionType.READ: UserRole.READONLY,
            ActionType.WRITE: UserRole.OPERATOR,
            ActionType.CREATE: UserRole.OPERATOR,
            ActionType.DELETE: UserRole.ADMIN,
            ActionType.MANAGE: UserRole.ADMIN,
        },
        ResourceType.SCRIPT_EXECUTE: {
            ActionType.READ: UserRole.READONLY,
            ActionType.EXECUTE: UserRole.OPERATOR,
        },

        # 公告相关
        ResourceType.ANNOUNCEMENT_READ_ALL: {
            ActionType.READ: UserRole.OPERATOR,  # 查看所有公告需要 operator 及以上
        },
        ResourceType.ANNOUNCEMENT_CREATE: {
            ActionType.CREATE: UserRole.ADMIN,  # 创建公告需要 admin
        },
        ResourceType.ANNOUNCEMENT_UPDATE: {
            ActionType.WRITE: UserRole.ADMIN,  # 更新公告需要 admin
        },
        ResourceType.ANNOUNCEMENT_DELETE: {
            ActionType.DELETE: UserRole.ADMIN,  # 删除公告需要 admin
        },

        # 用户管理相关 - 仅管理员可以操作
        ResourceType.USER_CREATE: {
            ActionType.CREATE: UserRole.ADMIN,
        },
        ResourceType.USER_UPDATE: {
            ActionType.WRITE: UserRole.ADMIN,
        },
        ResourceType.USER_DELETE: {
            ActionType.DELETE: UserRole.ADMIN,
        },
        ResourceType.USER_ENABLE: {
            ActionType.MANAGE: UserRole.ADMIN,
        },
        ResourceType.USER_DISABLE: {
            ActionType.MANAGE: UserRole.ADMIN,
        },

        # 审计日志 - 仅管理员可以查看
        ResourceType.AUDIT_LOG: {
            ActionType.READ: UserRole.ADMIN,
        },

        # 配置相关 - 仅管理员可以修改
        ResourceType.CONFIG: {
            ActionType.READ: UserRole.READONLY,
            ActionType.WRITE: UserRole.ADMIN,
        },
    }

    # 角色等级映射
    ROLE_LEVELS = {
        UserRole.READONLY: 1,
        UserRole.OPERATOR: 2,
        UserRole.ADMIN: 3,
    }

    # 默认权限（未在矩阵中定义的资源）
    DEFAULT_PERMISSIONS = {
        ActionType.READ: UserRole.READONLY,
        ActionType.WRITE: UserRole.OPERATOR,
        ActionType.CREATE: UserRole.OPERATOR,
        ActionType.DELETE: UserRole.ADMIN,
        ActionType.EXECUTE: UserRole.OPERATOR,
        ActionType.MANAGE: UserRole.ADMIN,
    }

    @classmethod
    def get_required_role(
        cls,
        resource: ResourceType,
        action: ActionType
    ) -> Optional[UserRole]:
        """
        获取执行某个操作所需的角色

        Args:
            resource: 资源类型
            action: 操作类型

        Returns:
            UserRole: 所需的最低角色
        """
        if resource in cls.MATRIX and action in cls.MATRIX[resource]:
            return cls.MATRIX[resource][action]
        # 返回默认权限
        return cls.DEFAULT_PERMISSIONS.get(action)

    @classmethod
    def get_required_role_for_action(
        cls,
        resource: ResourceType,
        action: ActionType
    ) -> UserRole:
        """
        获取执行某个操作所需的角色（必须存在）
        如果资源类型不在矩阵中，使用默认权限

        Args:
            resource: 资源类型
            action: 操作类型

        Returns:
            UserRole: 所需的最低角色
        """
        required_role = cls.get_required_role(resource, action)
        if required_role is None:
            # 如果未定义，默认使用 READONLY（最宽松）
            required_role = UserRole.READONLY
        return required_role

    @classmethod
    def can_access(
        cls,
        user_role: UserRole,
        resource: ResourceType,
        action: ActionType
    ) -> bool:
        """
        检查指定角色是否有权限执行某个操作

        Args:
            user_role: 用户角色
            resource: 资源类型
            action: 操作类型

        Returns:
            bool: 是否有权限
        """
        required_role = cls.get_required_role_for_action(resource, action)
        user_level = cls.ROLE_LEVELS.get(user_role, 0)
        required_level = cls.ROLE_LEVELS.get(required_role, 999)
        return user_level >= required_level


def get_required_role_for_action(
    resource: ResourceType,
    action: ActionType
) -> UserRole:
    """快捷函数：获取执行某个操作所需的角色"""
    return PermissionMatrix.get_required_role_for_action(resource, action)
