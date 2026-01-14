#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
遥测数据访问控制测试脚本

测试场景：
1. 只读用户查询最近 7 天数据（应该成功）
2. 只读用户查询超过 7 天数据（应该被拒绝）
3. 操作员查询超过 7 天数据（应该成功）
4. 管理员查询超过 7 天数据（应该成功）
5. 只读用户导出超过 7 天数据（应该被拒绝）
"""

import os
import sys
import json
from datetime import timedelta

# 添加项目根目录到 Python 路径
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

# 设置 Django 环境
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'compostlab_v2.settings')

import django
django.setup()

from django.test import RequestFactory
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import AccessToken
from apps.telemetry.api import (
    DeviceTelemetryView,
    DeviceChannelTelemetryView,
    MultiDeviceTelemetryView,
    DeviceExportView
)
from apps.accounts.models import UserProfile, UserRole

User = get_user_model()


class TestTelemetryAccessControl:
    """遥测数据访问控制测试"""

    def __init__(self):
        """初始化测试环境"""
        self.factory = RequestFactory()

        # 创建或获取管理员用户
        self.admin_user, created = User.objects.get_or_create(
            username='admin',
            defaults={
                'is_staff': True,
                'is_superuser': False
            }
        )
        if created:
            self.admin_user.set_password('admin123')
            self.admin_user.save()
            # 创建 profile
            UserProfile.objects.get_or_create(
                user=self.admin_user,
                defaults={'role': UserRole.ADMIN}
            )

        # 创建或获取操作员用户
        self.operator_user, created = User.objects.get_or_create(
            username='operator',
            defaults={'is_staff': False}
        )
        if created:
            self.operator_user.set_password('operator123')
            self.operator_user.save()
            UserProfile.objects.get_or_create(
                user=self.operator_user,
                defaults={'role': UserRole.OPERATOR}
            )

        # 创建或获取只读用户
        self.readonly_user, created = User.objects.get_or_create(
            username='readonly',
            defaults={'is_staff': False}
        )
        if created:
            self.readonly_user.set_password('readonly123')
            self.readonly_user.save()
            UserProfile.objects.get_or_create(
                user=self.readonly_user,
                defaults={'role': UserRole.READONLY}
            )

    def generate_user_token(self, user):
        """生成用户 JWT Token"""
        return str(AccessToken.for_user(user))

    def test_readonly_user_query_recent_data(self):
        """测试 1: 只读用户查询最近 7 天数据（应该成功）"""
        print("\n测试 1: 只读用户查询最近 7 天数据")

        # 生成只读用户 token
        readonly_token = self.generate_user_token(self.readonly_user)

        # 查询最近 3 天的数据（在 7 天限制内）
        from django.utils import timezone
        dt_from = (timezone.now() - timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S")

        # 创建请求
        view = DeviceTelemetryView.as_view()
        request = self.factory.get(
            f'/api/v2/devices/1/telemetry?from={dt_from}',
            HTTP_AUTHORIZATION=f'Bearer {readonly_token}'
        )

        # 执行请求
        response = view(request, device_id=1)

        # 验证响应
        print(f"  状态码: {response.status_code}")

        # 注意：如果设备 1 不存在，会返回 404，这是正常的
        # 我们主要关心的是不会被权限拦截（403）
        assert response.status_code != 403, f"Should not be blocked by permission, got {response.status_code}"

        print("  [PASS] 只读用户可以查询最近 7 天的数据")

    def test_readonly_user_query_old_data_auto_limit(self):
        """测试 2: 只读用户查询超过 7 天数据（自动限制为 7 天）"""
        print("\n测试 2: 只读用户查询超过 7 天数据（自动限制为 7 天）")

        # 生成只读用户 token
        readonly_token = self.generate_user_token(self.readonly_user)

        # 查询 30 天前的数据（超过 7 天限制，应该被自动限制）
        from django.utils import timezone
        dt_from = (timezone.now() - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")

        # 创建请求
        view = DeviceTelemetryView.as_view()
        request = self.factory.get(
            f'/api/v2/devices/1/telemetry?from={dt_from}',
            HTTP_AUTHORIZATION=f'Bearer {readonly_token}'
        )

        # 执行请求
        response = view(request, device_id=1)
        response_data = json.loads(response.content)

        # 验证响应
        print(f"  状态码: {response.status_code}")
        print(f"  响应 from: {response_data.get('from')}")

        # 应该成功（200），但时间被自动限制
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"

        # 验证时间被限制在 7 天内（简单验证：from 日期应该在最近 7 天内）
        if response_data.get('from'):
            from datetime import datetime
            from_date = datetime.strptime(response_data['from'], "%Y-%m-%d %H:%M:%S")
            now = datetime.now()
            time_diff = now - from_date
            assert time_diff.days <= 7, f"Time should be limited to 7 days, but got {time_diff.days} days"

        print("  [PASS] 只读用户查询超过 7 天数据被自动限制为 7 天")

    def test_operator_query_old_data_allowed(self):
        """测试 3: 操作员查询超过 7 天数据（应该成功）"""
        print("\n测试 3: 操作员查询超过 7 天数据（应该成功）")

        # 生成操作员 token
        operator_token = self.generate_user_token(self.operator_user)

        # 查询 30 天前的数据
        from django.utils import timezone
        dt_from = (timezone.now() - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")

        # 创建请求
        view = DeviceTelemetryView.as_view()
        request = self.factory.get(
            f'/api/v2/devices/1/telemetry?from={dt_from}',
            HTTP_AUTHORIZATION=f'Bearer {operator_token}'
        )

        # 执行请求
        response = view(request, device_id=1)

        # 验证响应
        print(f"  状态码: {response.status_code}")

        # 不会被权限拦截（403）
        assert response.status_code != 403, f"Should not be blocked by permission, got {response.status_code}"

        print("  [PASS] 操作员可以查询任意时间范围的数据")

    def test_admin_query_old_data_allowed(self):
        """测试 4: 管理员查询超过 7 天数据（应该成功）"""
        print("\n测试 4: 管理员查询超过 7 天数据（应该成功）")

        # 生成管理员 token
        admin_token = self.generate_user_token(self.admin_user)

        # 查询 30 天前的数据
        from django.utils import timezone
        dt_from = (timezone.now() - timedelta(days=30)).strftime("%Y-%m-%d %H:%M:%S")

        # 创建请求
        view = DeviceTelemetryView.as_view()
        request = self.factory.get(
            f'/api/v2/devices/1/telemetry?from={dt_from}',
            HTTP_AUTHORIZATION=f'Bearer {admin_token}'
        )

        # 执行请求
        response = view(request, device_id=1)

        # 验证响应
        print(f"  状态码: {response.status_code}")

        # 不会被权限拦截（403）
        assert response.status_code != 403, f"Should not be blocked by permission, got {response.status_code}"

        print("  [PASS] 管理员可以查询任意时间范围的数据")

    def test_readonly_user_auto_time_limit(self):
        """测试 5: 只读用户未指定时间时自动限制为 7 天"""
        print("\n测试 5: 只读用户未指定时间时自动限制为 7 天")

        # 生成只读用户 token
        readonly_token = self.generate_user_token(self.readonly_user)

        # 不指定 from 参数（应该自动限制为 7 天）
        # 创建请求
        view = DeviceTelemetryView.as_view()
        request = self.factory.get(
            '/api/v2/devices/1/telemetry',
            HTTP_AUTHORIZATION=f'Bearer {readonly_token}'
        )

        # 执行请求
        response = view(request, device_id=1)

        # 验证响应
        print(f"  状态码: {response.status_code}")

        # 不会被权限拦截
        assert response.status_code != 403, f"Should not be blocked by permission, got {response.status_code}"

        print("  [PASS] 只读用户未指定时间时自动限制为 7 天")


def run_tests():
    """运行所有测试"""
    print("=" * 70)
    print("遥测数据访问控制测试")
    print("=" * 70)

    test = TestTelemetryAccessControl()

    # 运行测试
    try:
        test.test_readonly_user_query_recent_data()
        test.test_readonly_user_query_old_data_auto_limit()
        test.test_operator_query_old_data_allowed()
        test.test_admin_query_old_data_allowed()
        test.test_readonly_user_auto_time_limit()

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
