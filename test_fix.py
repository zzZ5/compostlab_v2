#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""快速测试 UserRole 导入是否正常"""

import os
import sys

# 添加项目根目录到 Python 路径
project_root = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, project_root)

# 设置 Django 环境
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'compostlab_v2.settings')

import django
django.setup()

# 测试导入
print("测试导入 UserRole...")
try:
    from apps.accounts.models import UserRole
    print(f"✓ UserRole 导入成功: {UserRole}")
    print(f"  - READONLY: {UserRole.READONLY}")
    print(f"  - OPERATOR: {UserRole.OPERATOR}")
    print(f"  - ADMIN: {UserRole.ADMIN}")
except Exception as e:
    print(f"✗ UserRole 导入失败: {e}")
    sys.exit(1)

# 测试导入 has_permission
print("\n测试导入 has_permission...")
try:
    from apps.accounts.utils import has_permission
    print("✓ has_permission 导入成功")
except Exception as e:
    print(f"✗ has_permission 导入失败: {e}")
    sys.exit(1)

# 测试导入权限模块
print("\n测试导入权限模块...")
try:
    from apps.permissions import (
        PermissionMatrix,
        ResourceType,
        ActionType,
        get_required_role_for_action,
        has_permission as new_has_permission,
    )
    print("✓ 权限模块导入成功")
    print(f"  - PermissionMatrix: {PermissionMatrix}")
    print(f"  - ResourceType.DEVICE: {ResourceType.DEVICE}")
    print(f"  - ActionType.READ: {ActionType.READ}")
except Exception as e:
    print(f"✗ 权限模块导入失败: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

print("\n" + "=" * 70)
print("所有导入测试通过！ [OK]")
print("=" * 70)
