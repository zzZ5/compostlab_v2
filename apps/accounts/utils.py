from django.contrib.auth.models import User
from .models import UserProfile, AuditLog


def get_client_ip(request):
    """获取客户端 IP"""
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        ip = x_forwarded_for.split(",")[0].strip()
    else:
        ip = request.META.get("REMOTE_ADDR")
    return ip


def log_audit(
    user,
    action,
    resource_type="",
    resource_id="",
    description="",
    changes=None,
    success=True,
    error_message="",
    request=None,
):
    """
    记录操作日志
    
    Args:
        user: User 对象或 None
        action: AuditLog.Action 枚举值
        resource_type: 资源类型（device/channel/run 等）
        resource_id: 资源 ID
        description: 操作描述
        changes: 变更内容（dict）
        success: 是否成功
        error_message: 错误信息
        request: HttpRequest 对象（可选，用于获取 IP 和 User-Agent）
    """
    username = user.username if user else "anonymous"
    ip_address = None
    user_agent = ""
    
    if request:
        ip_address = get_client_ip(request)
        user_agent = request.META.get("HTTP_USER_AGENT", "")[:500]
    
    AuditLog.objects.create(
        user=user,
        username=username,
        action=action,
        resource_type=resource_type,
        resource_id=str(resource_id) if resource_id else "",
        description=description,
        changes=changes,
        ip_address=ip_address,
        user_agent=user_agent,
        success=success,
        error_message=error_message,
    )


def get_or_create_profile(user):
    """获取或创建用户 Profile"""
    profile, created = UserProfile.objects.get_or_create(user=user)
    return profile


def has_permission(user, required_role):
    """
    检查用户是否有足够权限
    
    Args:
        user: User 对象
        required_role: 需要的最低角色（readonly/operator/admin）
    
    Returns:
        bool: 是否有权限
    """
    if not user or not user.is_authenticated:
        return False
    
    # 超级用户总是有权限
    if user.is_superuser:
        return True
    
    # 管理员（Django staff）也算 admin 角色
    if user.is_staff and required_role in ["readonly", "operator", "admin"]:
        return True
    
    try:
        profile = user.profile
    except UserProfile.DoesNotExist:
        # 没有 profile 的视为 readonly
        return required_role == "readonly"
    
    if not profile.is_active:
        return False
    
    # 角色等级：readonly < operator < admin
    role_levels = {"readonly": 1, "operator": 2, "admin": 3}
    user_level = role_levels.get(profile.role, 0)
    required_level = role_levels.get(required_role, 999)
    
    return user_level >= required_level
