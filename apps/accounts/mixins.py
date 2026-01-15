"""
新的认证和权限 Mixin，支持 JWT Token
保留 BasicAuth 作为备选方案（向后兼容）

注意：权限相关的 Mixins 已迁移至 apps.permissions.mixins
建议在新代码中使用新的权限模块
"""
import base64
import logging
from django.contrib.auth import authenticate
from django.http import JsonResponse
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, TokenError
from rest_framework_simplejwt.tokens import AccessToken

from .utils import has_permission
from .token_blacklist import TokenBlacklist

logger = logging.getLogger(__name__)


class JWTAuthMixin:
    """
    JWT Token 认证 Mixin
    支持：
      1. Authorization: Bearer <token>
      2. 向后兼容 Basic Auth

    支持 Token 黑名单检查
    """

    def dispatch(self, request, *args, **kwargs):
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")

        # 优先尝试 JWT Token
        if auth_header.startswith("Bearer "):
            token_string = auth_header.split(" ", 1)[1].strip()
            jwt_auth = JWTAuthentication()

            try:
                validated_token = jwt_auth.get_validated_token(token_string)
                user = jwt_auth.get_user(validated_token)

                # 检查 token 是否在黑名单中
                jti = validated_token.get('jti')
                if TokenBlacklist.is_blacklisted(jti):
                    logger.warning(f"Token 已被撤销: jti={jti}, user={user.username}")
                    return JsonResponse(
                        {"detail": "Token has been revoked. Please login again."},
                        status=401,
                    )

                request.user = user
                return super().dispatch(request, *args, **kwargs)

            except (InvalidToken, TokenError) as e:
                return JsonResponse(
                    {"detail": f"Invalid token: {str(e)}"},
                    status=401,
                )

        # 向后兼容 Basic Auth
        elif auth_header.startswith("Basic "):
            try:
                b64 = auth_header.split(" ", 1)[1].strip()
                raw = base64.b64decode(b64).decode("utf-8")
                username, password = raw.split(":", 1)
            except Exception:
                return JsonResponse({"detail": "Invalid Authorization header."}, status=401)

            user = authenticate(username=username, password=password)
            if not user:
                return JsonResponse(
                    {"detail": "Invalid username or password."},
                    status=401,
                    headers={"WWW-Authenticate": 'Basic realm="CompostLab API"'},
                )

            request.user = user
            return super().dispatch(request, *args, **kwargs)

        # 无认证信息
        return JsonResponse(
            {"detail": "Authentication required (Bearer token or Basic auth)."},
            status=401,
            headers={"WWW-Authenticate": 'Bearer realm="CompostLab API"'},
        )


# 注意：以下是旧的权限 Mixins，保留用于向后兼容
# 新代码建议使用 apps.permissions.mixins 中的权限 Mixins

class RoleRequiredMixin:
    """
    角色权限检查 Mixin（向后兼容版本）

    注意：建议使用 apps.permissions.mixins.RoleRequiredMixin

    用法：
        class MyView(JWTAuthMixin, RoleRequiredMixin, View):
            required_role = "operator"  # 或 "admin" / "readonly" 或 UserRole.OPERATOR
    """
    required_role = "readonly"  # 默认只读

    def dispatch(self, request, *args, **kwargs):
        user = getattr(request, "user", None)

        # 将 required_role 转换为 UserRole 枚举
        from .models import UserRole
        if isinstance(self.required_role, str):
            role_map = {
                "readonly": UserRole.READONLY,
                "operator": UserRole.OPERATOR,
                "admin": UserRole.ADMIN,
            }
            required_role_enum = role_map.get(self.required_role.lower())
        else:
            required_role_enum = self.required_role

        if not has_permission(user, required_role_enum):
            return JsonResponse(
                {"detail": f"Permission denied. Required role: {self.required_role}"},
                status=403,
            )

        return super().dispatch(request, *args, **kwargs)


class OperatorRequiredMixin(RoleRequiredMixin):
    """操作员权限（快捷方式）- 向后兼容版本"""
    required_role = "operator"


class AdminRequiredMixin(RoleRequiredMixin):
    """管理员权限（快捷方式）- 向后兼容版本"""
    required_role = "admin"

