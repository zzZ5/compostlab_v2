import base64
import json

from django.contrib.auth import authenticate
from django.http import JsonResponse
from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import InvalidToken, AuthenticationFailed
from rest_framework_simplejwt.tokens import AccessToken
from django.conf import settings


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


class DeviceJWTAuthMixin:
    """
    设备专用 JWT 认证 Mixin
    
    支持两种认证方式：
    1. JWT Bearer Token（用户认证）：管理员可以使用其用户 token 注册设备
    2. Device JWT Token（设备认证）：设备使用包含 device_code 的 token 自注册
    
    Token payload 要求（设备 token）：
    {
        "device_code": "device_001",
        "exp": 1234567890
    }
    
    用户 token（管理员）必须满足：
    - is_staff=True 或 UserProfile.role='admin'
    """
    
    def dispatch(self, request, *args, **kwargs):
        auth = request.META.get("HTTP_AUTHORIZATION", "")
        
        if not auth:
            return JsonResponse(
                {"detail": "Authentication required."},
                status=401,
                headers={"WWW-Authenticate": 'Bearer realm="CompostLab Device API"'},
            )
        
        # 尝试 JWT Bearer Token
        if auth.startswith("Bearer "):
            token_str = auth.split(" ", 1)[1].strip()
            
            try:
                # 尝试解析为标准 JWT（用户 token）
                jwt_auth = JWTAuthentication()
                validated = jwt_auth.authenticate(request)
                if validated:
                    user, token = validated
                    request.user = user
                    
                    # 检查是否为管理员
                    if not (user.is_staff or user.is_superuser):
                        try:
                            profile = user.profile
                            if profile.role != "admin":
                                return JsonResponse(
                                    {"detail": "Admin permission required for device registration."},
                                    status=403
                                )
                        except Exception:
                            return JsonResponse(
                                {"detail": "Admin permission required for device registration."},
                                status=403
                            )
                    
                    # 标记为用户注册（管理员代表设备注册）
                    request.device_registration_type = "admin"
                    return super().dispatch(request, *args, **kwargs)
                
            except (InvalidToken, AuthenticationFailed) as e:
                # 尝试解析为设备专用 token
                try:
                    access_token = AccessToken(token_str)
                    payload = access_token.payload
                    
                    # 检查是否为设备 token（包含 device_code）
                    device_code = payload.get("device_code")
                    if not device_code:
                        return JsonResponse(
                            {"detail": "Invalid device token: device_code claim missing."},
                            status=401
                        )
                    
                    # 可选：验证 token 的 issuer
                    issuer = payload.get("iss")
                    if issuer and hasattr(settings, "DEVICE_JWT_ISSUER"):
                        if issuer != settings.DEVICE_JWT_ISSUER:
                            return JsonResponse(
                                {"detail": "Invalid device token: issuer mismatch."},
                                status=401
                            )
                    
                    # 标记为设备自注册
                    request.device_code_from_token = device_code
                    request.device_registration_type = "self"
                    
                    # 设备注册不需要 user 对象
                    request.user = None
                    
                    return super().dispatch(request, *args, **kwargs)
                    
                except Exception as e:
                    return JsonResponse(
                        {"detail": f"Invalid token: {str(e)}"},
                        status=401
                    )
            
            return JsonResponse(
                {"detail": "Invalid or expired token."},
                status=401
            )
        
        return JsonResponse(
            {"detail": "Unsupported authentication method. Use Bearer token."},
            status=401
        )
