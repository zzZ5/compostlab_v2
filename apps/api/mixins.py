import base64
import json

from django.contrib.auth import authenticate
from django.http import JsonResponse
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, AuthenticationFailed


class BasicAuthMixin:
    """
    支持两种认证方式：
    1. HTTP Basic Auth: Authorization: Basic base64(username:password)
    2. JWT Bearer Token: Authorization: Bearer <token>
    """

    def dispatch(self, request, *args, **kwargs):
        auth = request.META.get("HTTP_AUTHORIZATION", "")
        
        if not auth:
            return JsonResponse(
                {"detail": "Authentication required."},
                status=401,
                headers={"WWW-Authenticate": 'Bearer realm="CompostLab API"'},
            )
        
        # 尝试 JWT Bearer Token
        if auth.startswith("Bearer "):
            try:
                jwt_auth = JWTAuthentication()
                validated = jwt_auth.authenticate(request)
                if validated:
                    user, token = validated
                    request.user = user
                    return super().dispatch(request, *args, **kwargs)
            except (InvalidToken, AuthenticationFailed) as e:
                return JsonResponse(
                    {"detail": f"Invalid token: {str(e)}"},
                    status=401,
                )
            except Exception as e:
                return JsonResponse(
                    {"detail": f"Authentication failed: {str(e)}"},
                    status=401,
                )
        
        # 兼容 Basic Auth
        if auth.startswith("Basic "):
            try:
                b64 = auth.split(" ", 1)[1].strip()
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
        
        return JsonResponse(
            {"detail": "Unsupported authentication method."},
            status=401,
        )


class StaffRequiredMixin:
    """
    写接口只允许管理员。
    支持两种方式判断：
    1. Django is_staff / is_superuser
    2. UserProfile role (admin 或 operator)
    """

    def dispatch(self, request, *args, **kwargs):
        user = getattr(request, "user", None)
        if not user:
            return JsonResponse({"detail": "Admin permission required."}, status=403)
        
        # Django 原生权限
        if user.is_staff or user.is_superuser:
            return super().dispatch(request, *args, **kwargs)
        
        # UserProfile 角色检查
        try:
            profile = user.profile
            if profile.role in ["admin", "operator"]:
                return super().dispatch(request, *args, **kwargs)
        except Exception:
            pass
        
        return JsonResponse({"detail": "Admin or operator permission required."}, status=403)


class JsonBodyMixin:
    """
    解析 JSON body，失败返回 400
    """

    def json_body(self, request):
        if not request.body:
            return {}
        try:
            return json.loads(request.body.decode("utf-8"))
        except Exception:
            raise ValueError("Invalid JSON body.")
