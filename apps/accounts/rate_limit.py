# -*- coding: utf-8 -*-
"""
请求速率限制 Mixin

基于 Django Cache 实现的简单速率限制，无需额外依赖

用法：
    class LoginView(RateLimitedMixin, View):
        rate_limit = 5      # 允许请求数
        rate_period = 300    # 时间窗口（秒）
        rate_key = "login"   # 可选：自定义限流 key 前缀
"""

import time
from django.http import JsonResponse
from django.core.cache import cache


class RateLimitedMixin:
    """
    请求速率限制 Mixin

    特性：
    - 基于 IP + 用户 ID + 视图名称进行限流
    - 已认证用户：使用用户 ID 作为 key
    - 未认证用户：使用 IP 地址作为 key
    - 支持自定义限流参数
    """

    # 子类可以覆盖这些参数
    rate_limit = 100     # 默认：每个时间窗口允许 100 次请求
    rate_period = 60      # 默认：时间窗口为 60 秒
    rate_key = None       # 可选：自定义限流 key 前缀

    def dispatch(self, request, *args, **kwargs):
        """在请求处理前检查速率限制"""
        # 生成限流 key
        key = self._get_rate_limit_key(request)

        # 检查速率
        count = cache.get(key, 0)
        if count >= self.rate_limit:
            return JsonResponse(
                {
                    "detail": "Too many requests. Please try again later.",
                },
                status=429,
            )

        # 增加计数
        # 每次请求都重新设置过期时间，确保窗口正确
        cache.set(key, count + 1, self.rate_period)

        return super().dispatch(request, *args, **kwargs)

    def _get_rate_limit_key(self, request):
        """生成限流 key"""
        # 获取用户 ID 或 IP
        user_id = None
        if hasattr(request, 'user') and request.user:
            user_id = getattr(request.user, 'id', None)

        # 获取 IP 地址
        ip = self._get_client_ip(request)

        # 确定标识符：优先使用用户 ID，其次使用 IP
        identifier = str(user_id) if user_id else ip

        # 生成 key: rate_limit:{view_name}:{identifier}
        view_name = self.__class__.__name__
        prefix = self.rate_key if self.rate_key else "rate_limit"

        return f"{prefix}:{view_name}:{identifier}"

    def _get_client_ip(self, request):
        """获取客户端 IP 地址"""
        x_forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
        if x_forwarded_for:
            ip = x_forwarded_for.split(',')[0].strip()
        else:
            ip = request.META.get('REMOTE_ADDR', 'unknown')
        return ip


class LoginRateLimitedMixin(RateLimitedMixin):
    """
    登录接口专用限流 Mixin

    登录接口是暴力破解攻击的主要目标，需要更严格的限流
    """

    rate_limit = 5       # 5 分钟内最多 5 次登录尝试
    rate_period = 300    # 时间窗口：5 分钟
    rate_key = "login"


class AuthRateLimitedMixin(RateLimitedMixin):
    """
    认证相关接口限流 Mixin

    用于注册、修改密码等认证相关接口
    """

    rate_limit = 3       # 每小时最多 3 次
    rate_period = 3600   # 时间窗口：1 小时
    rate_key = "auth"


class APICreateRateLimitedMixin(RateLimitedMixin):
    """
    创建类 API 限流 Mixin

    用于创建资源、上传数据等接口
    """

    rate_limit = 30      # 每分钟最多 30 次
    rate_period = 60     # 时间窗口：1 分钟
    rate_key = "create"


class APIReadRateLimitedMixin(RateLimitedMixin):
    """
    查询类 API 限流 Mixin

    用于列表查询、数据读取等接口
    """

    rate_limit = 100     # 每分钟最多 100 次
    rate_period = 60     # 时间窗口：1 分钟
    rate_key = "read"
