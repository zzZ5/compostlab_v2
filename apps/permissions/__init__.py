"""
统一权限配置模块

本模块提供：
1. 角色权限矩阵定义
2. 统一的权限检查工具
3. 权限验证 Mixins

角色定义：
- READONLY (只读): 只能查看数据，不能修改
- OPERATOR (操作员): 可以执行写操作，不能管理用户
- ADMIN (管理员): 完全控制，包括用户管理

权限等级：
- readonly (1): 基础只读权限
- operator (2): 写操作权限
- admin (3): 完全控制权限
"""

from .config import PermissionMatrix, get_required_role_for_action
from .mixins import RoleRequiredMixin, OperatorRequiredMixin, AdminRequiredMixin
from .checks import has_permission, check_permission, get_user_role_level

__all__ = [
    'PermissionMatrix',
    'get_required_role_for_action',
    'RoleRequiredMixin',
    'OperatorRequiredMixin',
    'AdminRequiredMixin',
    'has_permission',
    'check_permission',
    'get_user_role_level',
]
