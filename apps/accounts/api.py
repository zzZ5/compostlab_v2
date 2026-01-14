import json
import logging
from django.contrib.auth import authenticate
from django.contrib.auth.models import User
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError
from django.http import JsonResponse
from django.utils import timezone
from django.views import View
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.db.models import Q
from rest_framework_simplejwt.tokens import RefreshToken

from .models import UserProfile, AuditLog, UserRole
from .mixins import JWTAuthMixin, AdminRequiredMixin
from .utils import log_audit, get_or_create_profile, get_client_ip
from .token_blacklist import TokenBlacklist

logger = logging.getLogger(__name__)


# ==================== 认证相关 ====================

@method_decorator(csrf_exempt, name='dispatch')
class LoginView(View):
    """
    POST /api/v2/auth/login
    Body: {"username": "...", "password": "..."}
    Returns: {"access": "...", "refresh": "...", "user": {...}}
    """
    
    def post(self, request):
        try:
            body = json.loads(request.body.decode("utf-8"))
        except Exception:
            return JsonResponse({"detail": "Invalid JSON body."}, status=400)

        username = body.get("username", "").strip()
        password = body.get("password", "")

        if not username or not password:
            return JsonResponse({"detail": "Username and password required."}, status=400)

        # 支持多种登录方式：用户名、邮箱、手机号
        user = None
        try:
            # 1. 先尝试用户名登录
            user = authenticate(username=username, password=password)
        except:
            pass

        # 2. 如果用户名登录失败，尝试用邮箱或手机号查找用户
        if not user:
            try:
                profile_user = User.objects.filter(
                    Q(email__iexact=username) | Q(profile__phone__iexact=username)
                ).first()

                if profile_user:
                    # 用找到的用户名重新认证
                    user = authenticate(username=profile_user.username, password=password)
            except:
                pass

        if not user:
            log_audit(
                None,
                AuditLog.Action.LOGIN,
                description=f"登录失败：{username}",
                success=False,
                error_message="Invalid credentials",
                request=request,
            )
            return JsonResponse({"detail": "Invalid username or password."}, status=401)
        
        # 检查用户是否启用
        profile = get_or_create_profile(user)
        if not profile.is_active:
            return JsonResponse({"detail": "Account disabled."}, status=403)
        
        # 更新登录信息
        profile.last_login_at = timezone.now()
        profile.last_login_ip = get_client_ip(request)
        profile.save()
        
        # 生成 JWT Token
        refresh = RefreshToken.for_user(user)
        
        # 记录登录日志
        log_audit(
            user,
            AuditLog.Action.LOGIN,
            description=f"用户登录：{username}",
            request=request,
        )
        
        return JsonResponse(
            {
                "access": str(refresh.access_token),
                "refresh": str(refresh),
                "user": {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "role": profile.role,
                    "role_display": profile.get_role_display(),
                    "real_name": profile.real_name,
                    "department": profile.department,
                    "is_staff": user.is_staff,
                    "is_superuser": user.is_superuser,
                },
            },
            status=200,
        )


@method_decorator(csrf_exempt, name='dispatch')
class RefreshTokenView(View):
    """
    POST /api/v2/auth/refresh
    Body: {"refresh": "..."}
    Returns: {"access": "..."}
    """
    
    def post(self, request):
        try:
            body = json.loads(request.body.decode("utf-8"))
        except Exception:
            return JsonResponse({"detail": "Invalid JSON body."}, status=400)
        
        refresh_token = body.get("refresh", "").strip()
        if not refresh_token:
            return JsonResponse({"detail": "Refresh token required."}, status=400)
        
        try:
            refresh = RefreshToken(refresh_token)
            return JsonResponse({"access": str(refresh.access_token)}, status=200)
        except Exception as e:
            return JsonResponse({"detail": f"Invalid refresh token: {str(e)}"}, status=401)


@method_decorator(csrf_exempt, name='dispatch')
class LogoutView(JWTAuthMixin, View):
    """
    POST /api/v2/auth/logout
    将当前用户的 token 加入黑名单

    注意：需要使用有效的 JWT Token 调用此接口
    """

    def post(self, request):
        # JWTAuthMixin 已经验证了 token 并设置了 request.user

        # 获取认证头中的 token
        auth_header = request.META.get("HTTP_AUTHORIZATION", "")
        token_string = auth_header.split(" ", 1)[1].strip() if auth_header.startswith("Bearer ") else ""

        if token_string:
            try:
                # 解析 token
                from rest_framework_simplejwt.tokens import AccessToken
                access = AccessToken(token_string)

                # 将 access token 加入黑名单
                TokenBlacklist.revoke_access_token(access)
                jti = access.get('jti')
                logger.info(f"Access Token 已撤销: jti={jti}, user={request.user.username}")

                # 尝试解析为 Refresh Token（如果传入的是 refresh token）
                try:
                    refresh = RefreshToken(token_string)
                    TokenBlacklist.revoke_refresh_token(refresh)
                    logger.info(f"Refresh Token 已撤销: jti={refresh.get('jti')}, user={request.user.username}")
                except:
                    pass

            except Exception as e:
                logger.warning(f"撤销 token 失败: {e}")

        # 记录登出日志
        log_audit(
            request.user,
            AuditLog.Action.LOGOUT,
            description=f"用户登出：{request.user.username}",
            request=request,
        )

        return JsonResponse({"detail": "Logged out successfully."}, status=200)


@method_decorator(csrf_exempt, name='dispatch')
class MeView(JWTAuthMixin, View):
    """
    GET /api/v2/auth/me
    获取当前用户信息
    """
    
    def get(self, request):
        user = request.user
        profile = get_or_create_profile(user)
        
        return JsonResponse(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "role": profile.role,
                "role_display": profile.get_role_display(),
                "real_name": profile.real_name,
                "department": profile.department,
                "phone": profile.phone,
                "is_staff": user.is_staff,
                "is_superuser": user.is_superuser,
                "is_active": profile.is_active,
                "last_login_at": profile.last_login_at.isoformat() if profile.last_login_at else None,
                "date_joined": user.date_joined.isoformat(),
            },
            status=200,
        )


@method_decorator(csrf_exempt, name='dispatch')
class ChangePasswordView(JWTAuthMixin, View):
    """
    POST /api/v2/auth/change-password
    Body: {"old_password": "...", "new_password": "..."}
    修改密码后会撤销用户的所有 token
    """

    def post(self, request):
        try:
            body = json.loads(request.body.decode("utf-8"))
        except Exception:
            return JsonResponse({"detail": "Invalid JSON body."}, status=400)

        old_password = body.get("old_password", "")
        new_password = body.get("new_password", "")

        if not old_password or not new_password:
            return JsonResponse({"detail": "Old and new passwords required."}, status=400)

        user = request.user

        # 验证旧密码
        if not user.check_password(old_password):
            return JsonResponse({"detail": "Old password incorrect."}, status=400)

        # 验证新密码强度
        try:
            validate_password(new_password, user)
        except ValidationError as e:
            return JsonResponse({"detail": "Password validation failed.", "errors": e.messages}, status=400)

        # 修改密码
        user.set_password(new_password)
        user.save()

        # 撤销用户的所有 token
        # 注意：我们无法直接撤销所有已 issued 的 token
        # 但由于密码已更改，旧 token 将在验证时失效
        revoked_count = TokenBlacklist.revoke_all_user_tokens(user.id)
        logger.info(f"用户 {user.username} 修改密码，撤销 {revoked_count} 个 token")

        # 记录审计日志
        log_audit(
            user,
            AuditLog.Action.USER_UPDATE,
            resource_type="user",
            resource_id=user.id,
            description="修改密码（所有 token 已撤销）",
            request=request,
        )

        return JsonResponse({"detail": "Password changed successfully. All existing tokens have been revoked."}, status=200)


# ==================== 用户管理（管理员） ====================

@method_decorator(csrf_exempt, name='dispatch')
class UserListView(JWTAuthMixin, AdminRequiredMixin, View):
    """
    GET /api/v2/users?q=...&role=...&is_active=...
    管理员查看用户列表
    """
    
    def get(self, request):
        q = request.GET.get("q", "").strip()
        role = request.GET.get("role", "").strip()
        is_active = request.GET.get("is_active", "").strip()
        
        users = User.objects.all().select_related("profile").order_by("-date_joined")
        
        # 搜索
        if q:
            users = users.filter(
                Q(username__icontains=q)
                | Q(email__icontains=q)
                | Q(profile__real_name__icontains=q)
                | Q(profile__department__icontains=q)
            )
        
        # 按角色筛选
        if role:
            users = users.filter(profile__role=role)
        
        # 按状态筛选
        if is_active:
            active = is_active.lower() in ["true", "1", "yes"]
            users = users.filter(profile__is_active=active)
        
        data = []
        for user in users:
            profile = get_or_create_profile(user)
            data.append(
                {
                    "id": user.id,
                    "username": user.username,
                    "email": user.email,
                    "role": profile.role,
                    "role_display": profile.get_role_display(),
                    "real_name": profile.real_name,
                    "department": profile.department,
                    "phone": profile.phone,
                    "is_staff": user.is_staff,
                    "is_superuser": user.is_superuser,
                    "is_active": profile.is_active,
                    "last_login_at": profile.last_login_at.isoformat() if profile.last_login_at else None,
                    "date_joined": user.date_joined.isoformat(),
                }
            )
        
        return JsonResponse({"count": len(data), "data": data}, status=200)


@method_decorator(csrf_exempt, name='dispatch')
class UserDetailView(JWTAuthMixin, AdminRequiredMixin, View):
    """
    GET /api/v2/users/<user_id>
    """
    
    def get(self, request, user_id: int):
        try:
            user = User.objects.select_related("profile").get(id=user_id)
        except User.DoesNotExist:
            return JsonResponse({"detail": "User not found."}, status=404)
        
        profile = get_or_create_profile(user)
        
        return JsonResponse(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "role": profile.role,
                "role_display": profile.get_role_display(),
                "real_name": profile.real_name,
                "department": profile.department,
                "phone": profile.phone,
                "is_staff": user.is_staff,
                "is_superuser": user.is_superuser,
                "is_active": profile.is_active,
                "last_login_at": profile.last_login_at.isoformat() if profile.last_login_at else None,
                "last_login_ip": profile.last_login_ip,
                "date_joined": user.date_joined.isoformat(),
            },
            status=200,
        )


@method_decorator(csrf_exempt, name='dispatch')
class UserCreateView(JWTAuthMixin, AdminRequiredMixin, View):
    """
    POST /api/v2/users
    Body: {"username": "...", "password": "...", "email": "...", "role": "...", ...}
    """
    
    def post(self, request):
        try:
            body = json.loads(request.body.decode("utf-8"))
        except Exception:
            return JsonResponse({"detail": "Invalid JSON body."}, status=400)
        
        username = body.get("username", "").strip()
        password = body.get("password", "")
        email = body.get("email", "").strip()
        role = body.get("role", "readonly")
        real_name = body.get("real_name", "").strip()
        department = body.get("department", "").strip()
        phone = body.get("phone", "").strip()

        logger.info(f"创建用户请求: username={username}, role={role}, email={email}")

        if not username or not password:
            return JsonResponse({"detail": "Username and password required."}, status=400)

        if User.objects.filter(username=username).exists():
            return JsonResponse({"detail": "Username already exists."}, status=400)

        # 验证密码强度
        try:
            validate_password(password)
        except ValidationError as e:
            return JsonResponse({"detail": "Password validation failed.", "errors": e.messages}, status=400)

        # 验证角色值是否有效
        valid_roles = [choice[0] for choice in UserRole.choices]
        logger.info(f"有效角色列表: {valid_roles}")
        logger.info(f"请求角色: {role}, 是否有效: {role in valid_roles}")
        if role not in valid_roles:
            logger.warning(f"无效角色 {role}，回退到 readonly")
            role = "readonly"

        # 创建用户
        user = User.objects.create_user(username=username, password=password, email=email)

        # 创建 Profile
        profile = UserProfile.objects.create(
            user=user,
            role=role,
            real_name=real_name,
            department=department,
            phone=phone,
        )
        
        log_audit(
            request.user,
            AuditLog.Action.USER_CREATE,
            resource_type="user",
            resource_id=user.id,
            description=f"创建用户：{username}",
            changes={"username": username, "role": profile.role},
            request=request,
        )
        
        return JsonResponse(
            {
                "id": user.id,
                "username": user.username,
                "email": user.email,
                "role": profile.role,
                "detail": "User created successfully.",
            },
            status=201,
        )


@method_decorator(csrf_exempt, name='dispatch')
class UserUpdateView(JWTAuthMixin, AdminRequiredMixin, View):
    """
    PUT /api/v2/users/<user_id>
    Body: {"email": "...", "role": "...", "real_name": "...", ...}
    """

    def put(self, request, user_id: int):
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return JsonResponse({"detail": "User not found."}, status=404)

        try:
            body = json.loads(request.body.decode("utf-8"))
        except Exception:
            return JsonResponse({"detail": "Invalid JSON body."}, status=400)

        profile = get_or_create_profile(user)
        changes = {}

        try:
            # 更新 User 字段
            if "email" in body:
                old_email = user.email
                email_value = body["email"]
                email_stripped = email_value.strip() if email_value else ""
                # 只有当 email 确实改变时才更新
                if email_stripped != old_email:
                    # 如果设置为空，检查其他用户是否有空邮箱
                    if email_stripped == "":
                        user.email = ""
                    else:
                        # 检查邮箱是否已被其他用户使用
                        existing = User.objects.filter(email=email_stripped).exclude(id=user.id).first()
                        if existing:
                            return JsonResponse({"detail": f"Email {email_stripped} is already in use by another user."}, status=400)
                        user.email = email_stripped
                    changes["email"] = {"old": old_email, "new": user.email}

            # 只有当有变化时才保存
            if changes or any(field in body for field in ["role", "real_name", "department", "phone"]):
                try:
                    user.save()
                except Exception as e:
                    logger.error(f"Failed to save user: {e}", exc_info=True)
                    return JsonResponse({"detail": f"Failed to update user: {str(e)}"}, status=400)

            # 更新 Profile 字段
            if "role" in body:
                role_value = body["role"]
                if role_value in [choice[0] for choice in UserRole.choices]:
                    old_role = profile.role
                    if role_value != old_role:
                        profile.role = role_value
                        changes["role"] = {"old": old_role, "new": profile.role}

            if "real_name" in body:
                real_name_value = body["real_name"]
                real_name_stripped = real_name_value.strip() if real_name_value else ""
                profile.real_name = real_name_stripped

            if "department" in body:
                department_value = body["department"]
                department_stripped = department_value.strip() if department_value else ""
                profile.department = department_stripped

            if "phone" in body:
                phone_value = body["phone"]
                phone_stripped = phone_value.strip() if phone_value else ""
                profile.phone = phone_stripped

            try:
                profile.save()
            except Exception as e:
                logger.error(f"Failed to save profile: {e}", exc_info=True)
                return JsonResponse({"detail": f"Failed to update profile: {str(e)}"}, status=400)

        except Exception as e:
            logger.error(f"Unexpected error updating user: {e}", exc_info=True)
            return JsonResponse({"detail": f"Unexpected error: {str(e)}"}, status=500)

        # 记录审计日志
        try:
            log_audit(
                request.user,
                AuditLog.Action.USER_UPDATE,
                resource_type="user",
                resource_id=user.id,
                description=f"更新用户：{user.username}",
                changes=changes,
                request=request,
            )
        except Exception as e:
            # 审计日志失败不影响主流程，只打印错误
            logger.error(f"Failed to log audit: {e}", exc_info=True)

        return JsonResponse({"detail": "User updated successfully."}, status=200)


@method_decorator(csrf_exempt, name='dispatch')
class UserToggleActiveView(JWTAuthMixin, AdminRequiredMixin, View):
    """
    POST /api/v2/users/<user_id>/toggle-active
    启用/禁用用户
    禁用用户时会撤销其所有 token
    """

    def post(self, request, user_id: int):
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return JsonResponse({"detail": "User not found."}, status=404)

        # 不能禁用自己
        if user.id == request.user.id:
            return JsonResponse({"detail": "Cannot disable yourself."}, status=400)

        profile = get_or_create_profile(user)
        old_active = profile.is_active
        profile.is_active = not profile.is_active
        profile.save()

        # 如果是禁用用户，撤销其所有 token
        if not profile.is_active:
            revoked_count = TokenBlacklist.revoke_all_user_tokens(user.id)
            logger.info(f"用户 {user.username} 被禁用，撤销 {revoked_count} 个 token")

        action = AuditLog.Action.USER_ENABLE if profile.is_active else AuditLog.Action.USER_DISABLE
        log_audit(
            request.user,
            action,
            resource_type="user",
            resource_id=user.id,
            description=f"{'启用' if profile.is_active else '禁用'}用户：{user.username}" +
                      (f"，撤销 {revoked_count} 个 token" if not profile.is_active else ""),
            request=request,
        )

        return JsonResponse(
            {"detail": f"User {'enabled' if profile.is_active else 'disabled'}.", "is_active": profile.is_active},
            status=200,
        )


# ==================== 审计日志 ====================

@method_decorator(csrf_exempt, name='dispatch')
class AuditLogListView(JWTAuthMixin, AdminRequiredMixin, View):
    """
    GET /api/v2/audit-logs?username=...&action=...&from=...&to=...&limit=100
    管理员查看操作日志
    """
    
    def get(self, request):
        username = request.GET.get("username", "").strip()
        action = request.GET.get("action", "").strip()
        resource_type = request.GET.get("resource_type", "").strip()
        resource_id = request.GET.get("resource_id", "").strip()
        limit = int(request.GET.get("limit", "100"))
        limit = max(1, min(limit, 1000))
        
        logs = AuditLog.objects.all()
        
        if username:
            logs = logs.filter(username__icontains=username)
        
        if action:
            logs = logs.filter(action=action)
        
        if resource_type:
            logs = logs.filter(resource_type=resource_type)
        
        if resource_id:
            logs = logs.filter(resource_id=resource_id)
        
        logs = logs[:limit]
        
        data = [
            {
                "id": log.id,
                "username": log.username,
                "action": log.action,
                "action_display": log.get_action_display(),
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "description": log.description,
                "changes": log.changes,
                "ip_address": log.ip_address,
                "success": log.success,
                "error_message": log.error_message,
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ]
        
        return JsonResponse({"count": len(data), "data": data}, status=200)


@method_decorator(csrf_exempt, name='dispatch')
class MyAuditLogListView(JWTAuthMixin, View):
    """
    GET /api/v2/auth/my-logs?limit=50
    查看自己的操作日志
    """
    
    def get(self, request):
        limit = int(request.GET.get("limit", "50"))
        limit = max(1, min(limit, 500))
        
        logs = AuditLog.objects.filter(username=request.user.username)[:limit]
        
        data = [
            {
                "id": log.id,
                "action": log.action,
                "action_display": log.get_action_display(),
                "resource_type": log.resource_type,
                "resource_id": log.resource_id,
                "description": log.description,
                "ip_address": log.ip_address,
                "success": log.success,
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ]
        
        return JsonResponse({"count": len(data), "data": data}, status=200)
