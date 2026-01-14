from django.contrib.auth.models import User
from django.utils import timezone as django_timezone
import pytz
from .models import UserProfile, AuditLog


def get_client_ip(request):
    """获取客户端 IP"""
    x_forwarded_for = request.META.get("HTTP_X_FORWARDED_FOR")
    if x_forwarded_for:
        ip = x_forwarded_for.split(",")[0].strip()
    else:
        ip = request.META.get("REMOTE_ADDR")
    return ip


def format_datetime_for_user(dt, user_timezone="Asia/Shanghai"):
    """
    将 UTC 时间格式化为用户所在时区的本地时间字符串

    Args:
        dt: UTC datetime 对象
        user_timezone: 用户时区字符串，如 "Asia/Shanghai"

    Returns:
        str: 格式化后的本地时间字符串，如 "2026-01-14 16:30:45"
    """
    if dt is None:
        return None

    try:
        tz = pytz.timezone(user_timezone)
        if dt.tzinfo is None:
            dt = django_timezone.make_aware(dt, pytz.UTC)
        local_dt = dt.astimezone(tz)
        return local_dt.strftime("%Y-%m-%d %H:%M:%S")
    except pytz.UnknownTimeZoneError:
        # 时区无效时使用系统默认时区
        tz = pytz.timezone("Asia/Shanghai")
        if dt.tzinfo is None:
            dt = django_timezone.make_aware(dt, pytz.UTC)
        local_dt = dt.astimezone(tz)
        return local_dt.strftime("%Y-%m-%d %H:%M:%S")


def get_user_timezone(user):
    """
    获取用户的时区设置

    Args:
        user: User 对象

    Returns:
        str: 时区字符串，默认为 "Asia/Shanghai"
    """
    try:
        profile = user.profile
        return profile.timezone or "Asia/Shanghai"
    except UserProfile.DoesNotExist:
        return "Asia/Shanghai"


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

    角色权限等级：
    - readonly (1): 只读权限
    - operator (2): 操作权限
    - admin (3): 管理权限

    权限规则：
    - is_superuser: 超级管理员，拥有所有权限
    - 其他用户: 完全依赖 UserProfile.role 判断权限
      - is_staff 不再自动赋予 admin 权限
      - is_staff 用户也必须有对应的 UserProfile.role
    """
    if not user or not user.is_authenticated:
        return False

    # 超级用户总是有权限
    if user.is_superuser:
        return True

    # 检查用户是否有 UserProfile
    try:
        profile = user.profile
    except UserProfile.DoesNotExist:
        # 没有 profile 的用户，默认被视为 readonly
        # is_staff 用户如果没有 profile，也没有角色信息，不能有高级权限
        return required_role == "readonly"

    # 检查用户是否启用
    if not profile.is_active:
        return False

    # 角色等级：readonly < operator < admin
    role_levels = {"readonly": 1, "operator": 2, "admin": 3}
    user_level = role_levels.get(profile.role, 0)
    required_level = role_levels.get(required_role, 999)

    return user_level >= required_level
