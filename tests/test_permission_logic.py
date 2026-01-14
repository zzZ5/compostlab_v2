#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
用户权限检查逻辑测试脚本

测试场景：
1. 超级用户拥有所有权限
2. is_staff + role='admin' 的用户拥有 admin 权限
3. is_staff 但 role='operator' 的用户不应拥有 admin 权限（修复重点）
4. is_staff 但没有 profile 的用户没有权限
5. operator 用户可以访问 readonly 和 operator 级别资源
6. readonly 用户只能访问 readonly 级别资源
7. 非 is_staff 的 admin 用户拥有 admin 权限
"""

import os
import sys

# 添加项目根目录到 Python 路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

# 设置 Django 环境
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'compostlab_v2.settings')

import django
django.setup()

from django.contrib.auth import get_user_model
from apps.accounts.utils import has_permission
from apps.accounts.models import UserProfile, UserRole

User = get_user_model()


class TestPermissionLogic:
    """用户权限检查逻辑测试"""

    def __init__(self):
        """初始化测试环境"""
        # 清理测试用户
        User.objects.filter(username__in=[
            'superuser', 'staff_admin', 'staff_operator', 'staff_no_profile',
            'operator', 'readonly', 'normal_admin'
        ]).delete()

    def test_superuser_has_all_permissions(self):
        """测试 1: 超级用户拥有所有权限"""
        print("\n测试 1: 超级用户拥有所有权限")

        # 创建超级用户
        superuser = User.objects.create_superuser(
            username='superuser',
            email='super@example.com',
            password='super123'
        )

        # 测试所有角色级别
        for role in ['readonly', 'operator', 'admin']:
            result = has_permission(superuser, role)
            print(f"  has_permission(superuser, '{role}'): {result}")
            assert result == True, f"Superuser should have {role} permission"

        print("  [PASS] 超级用户拥有所有权限")

    def test_staff_with_admin_role_has_admin_permission(self):
        """测试 2: is_staff + role='admin' 的用户拥有 admin 权限"""
        print("\n测试 2: is_staff + role='admin' 的用户拥有 admin 权限")

        # 创建 is_staff + role='admin' 的用户
        user = User.objects.create_user(username='staff_admin', password='pass123')
        user.is_staff = True
        user.save()
        UserProfile.objects.create(
            user=user,
            role=UserRole.ADMIN
        )

        # 测试所有角色级别
        assert has_permission(user, 'readonly') == True, "Should have readonly permission"
        assert has_permission(user, 'operator') == True, "Should have operator permission"
        assert has_permission(user, 'admin') == True, "Should have admin permission"

        print("  [PASS] is_staff + role='admin' 的用户拥有 admin 权限")

    def test_staff_with_operator_role_no_admin_permission(self):
        """测试 3: is_staff 但 role='operator' 的用户不应拥有 admin 权限（修复重点）"""
        print("\n测试 3: is_staff 但 role='operator' 的用户不应拥有 admin 权限")

        # 创建 is_staff + role='operator' 的用户
        user = User.objects.create_user(username='staff_operator', password='pass123')
        user.is_staff = True
        user.save()
        UserProfile.objects.create(
            user=user,
            role=UserRole.OPERATOR
        )

        # 测试权限级别
        readonly_ok = has_permission(user, 'readonly')
        operator_ok = has_permission(user, 'operator')
        admin_ok = has_permission(user, 'admin')

        print(f"  has_permission(staff_operator, 'readonly'): {readonly_ok}")
        print(f"  has_permission(staff_operator, 'operator'): {operator_ok}")
        print(f"  has_permission(staff_operator, 'admin'): {admin_ok}")

        # 修复后的逻辑：is_staff 但 role='operator' 的用户不应有 admin 权限
        assert readonly_ok == True, "Should have readonly permission"
        assert operator_ok == True, "Should have operator permission"
        assert admin_ok == False, "Should NOT have admin permission (this is the fix!)"

        print("  [PASS] is_staff 但 role='operator' 的用户不应拥有 admin 权限（已修复）")

    def test_staff_without_profile_no_permission(self):
        """测试 4: is_staff 但没有 profile 的用户没有权限"""
        print("\n测试 4: is_staff 但没有 profile 的用户没有权限")

        # 创建 is_staff 但没有 profile 的用户
        user = User.objects.create_user(username='staff_no_profile', password='pass123')
        user.is_staff = True
        user.save()
        # 故意不创建 UserProfile

        # 测试权限
        readonly_ok = has_permission(user, 'readonly')
        operator_ok = has_permission(user, 'operator')
        admin_ok = has_permission(user, 'admin')

        print(f"  has_permission(staff_no_profile, 'readonly'): {readonly_ok}")
        print(f"  has_permission(staff_no_profile, 'operator'): {operator_ok}")
        print(f"  has_permission(staff_no_profile, 'admin'): {admin_ok}")

        # 没有 profile 的用户默认被视为 readonly
        assert readonly_ok == True, "Should have readonly permission"
        assert operator_ok == False, "Should NOT have operator permission without profile"
        assert admin_ok == False, "Should NOT have admin permission without profile"

        print("  [PASS] is_staff 但没有 profile 的用户没有高级权限")

    def test_operator_user_permissions(self):
        """测试 5: operator 用户可以访问 readonly 和 operator 级别资源"""
        print("\n测试 5: operator 用户可以访问 readonly 和 operator 级别资源")

        # 创建 operator 用户（非 is_staff）
        user = User.objects.create_user(username='operator', password='pass123')
        UserProfile.objects.create(
            user=user,
            role=UserRole.OPERATOR
        )

        # 测试权限
        assert has_permission(user, 'readonly') == True, "Should have readonly permission"
        assert has_permission(user, 'operator') == True, "Should have operator permission"
        assert has_permission(user, 'admin') == False, "Should NOT have admin permission"

        print("  [PASS] operator 用户可以访问 readonly 和 operator 级别资源")

    def test_readonly_user_permissions(self):
        """测试 6: readonly 用户只能访问 readonly 级别资源"""
        print("\n测试 6: readonly 用户只能访问 readonly 级别资源")

        # 创建 readonly 用户
        user = User.objects.create_user(username='readonly', password='pass123')
        UserProfile.objects.create(
            user=user,
            role=UserRole.READONLY
        )

        # 测试权限
        assert has_permission(user, 'readonly') == True, "Should have readonly permission"
        assert has_permission(user, 'operator') == False, "Should NOT have operator permission"
        assert has_permission(user, 'admin') == False, "Should NOT have admin permission"

        print("  [PASS] readonly 用户只能访问 readonly 级别资源")

    def test_normal_admin_user_permissions(self):
        """测试 7: 非 is_staff 的 admin 用户拥有 admin 权限"""
        print("\n测试 7: 非 is_staff 的 admin 用户拥有 admin 权限")

        # 创建 admin 用户（非 is_staff）
        user = User.objects.create_user(username='normal_admin', password='pass123')
        UserProfile.objects.create(
            user=user,
            role=UserRole.ADMIN
        )

        # 测试权限
        assert has_permission(user, 'readonly') == True, "Should have readonly permission"
        assert has_permission(user, 'operator') == True, "Should have operator permission"
        assert has_permission(user, 'admin') == True, "Should have admin permission"

        print("  [PASS] 非 is_staff 的 admin 用户拥有 admin 权限")

    def test_inactive_user_no_permission(self):
        """测试 8: 未启用的用户没有权限"""
        print("\n测试 8: 未启用的用户没有权限")

        # 创建未启用的用户
        user = User.objects.create_user(username='inactive', password='pass123')
        UserProfile.objects.create(
            user=user,
            role=UserRole.ADMIN,
            is_active=False
        )

        # 测试权限
        assert has_permission(user, 'readonly') == False, "Should NOT have permission when inactive"
        assert has_permission(user, 'operator') == False, "Should NOT have permission when inactive"
        assert has_permission(user, 'admin') == False, "Should NOT have permission when inactive"

        print("  [PASS] 未启用的用户没有权限")


def run_tests():
    """运行所有测试"""
    print("=" * 70)
    print("用户权限检查逻辑测试")
    print("=" * 70)

    test = TestPermissionLogic()

    # 运行测试
    try:
        test.test_superuser_has_all_permissions()
        test.test_staff_with_admin_role_has_admin_permission()
        test.test_staff_with_operator_role_no_admin_permission()
        test.test_staff_without_profile_no_permission()
        test.test_operator_user_permissions()
        test.test_readonly_user_permissions()
        test.test_normal_admin_user_permissions()
        test.test_inactive_user_no_permission()

        print("\n" + "=" * 70)
        print("所有测试通过！ [OK]")
        print("=" * 70)
    except AssertionError as e:
        print(f"\n[FAIL] 测试失败: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n[ERROR] 测试出错: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    run_tests()
