from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone


class UserRole(models.TextChoices):
    """用户角色"""
    READONLY = "readonly", "只读用户"
    OPERATOR = "operator", "操作员"
    ADMIN = "admin", "管理员"


class UserProfile(models.Model):
    """用户扩展信息"""
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name="profile")
    role = models.CharField(
        max_length=20,
        choices=UserRole.choices,
        default=UserRole.READONLY,
        db_index=True,
        help_text="用户角色：readonly（只读）、operator（操作员）、admin（管理员）",
    )
    
    # 个人信息
    real_name = models.CharField(max_length=100, blank=True, help_text="真实姓名")
    department = models.CharField(max_length=100, blank=True, help_text="部门/实验室")
    phone = models.CharField(max_length=20, blank=True, help_text="联系电话")
    
    # 状态
    is_active = models.BooleanField(default=True, help_text="是否启用")
    last_login_at = models.DateTimeField(null=True, blank=True, help_text="最后登录时间")
    last_login_ip = models.GenericIPAddressField(null=True, blank=True, help_text="最后登录 IP")
    
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = "accounts_userprofile"
        verbose_name = "用户资料"
        verbose_name_plural = "用户资料"
        indexes = [
            models.Index(fields=["role"], name="idx_userprofile_role"),
            models.Index(fields=["is_active"], name="idx_userprofile_active"),
        ]
    
    def __str__(self):
        return f"{self.user.username} ({self.get_role_display()})"


class AuditLog(models.Model):
    """操作审计日志"""
    
    class Action(models.TextChoices):
        # 认证相关
        LOGIN = "login", "登录"
        LOGOUT = "logout", "登出"
        
        # 设备相关
        DEVICE_CREATE = "device_create", "创建设备"
        DEVICE_UPDATE = "device_update", "更新设备"
        DEVICE_DELETE = "device_delete", "删除设备"
        
        # 通道相关
        CHANNEL_CREATE = "channel_create", "创建通道"
        CHANNEL_UPDATE = "channel_update", "更新通道"
        CHANNEL_DELETE = "channel_delete", "删除通道"
        
        # 运行批次相关
        RUN_CREATE = "run_create", "创建运行批次"
        RUN_UPDATE = "run_update", "更新运行批次"
        RUN_DELETE = "run_delete", "删除运行批次"
        
        # 命令相关
        COMMAND_SEND = "command_send", "发送命令"
        
        # 用户管理
        USER_CREATE = "user_create", "创建用户"
        USER_UPDATE = "user_update", "更新用户"
        USER_DELETE = "user_delete", "删除用户"
        USER_ENABLE = "user_enable", "启用用户"
        USER_DISABLE = "user_disable", "禁用用户"
    
    # 操作者
    user = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_logs",
        help_text="操作用户（删除后保留日志）",
    )
    username = models.CharField(max_length=150, db_index=True, help_text="用户名（冗余存储）")
    
    # 操作信息
    action = models.CharField(
        max_length=50,
        choices=Action.choices,
        db_index=True,
        help_text="操作类型",
    )
    resource_type = models.CharField(max_length=50, blank=True, help_text="资源类型（如 device/channel）")
    resource_id = models.CharField(max_length=100, blank=True, db_index=True, help_text="资源 ID")
    
    # 详细信息
    description = models.TextField(blank=True, help_text="操作描述")
    changes = models.JSONField(null=True, blank=True, help_text="变更内容（JSON）")
    
    # 请求信息
    ip_address = models.GenericIPAddressField(null=True, blank=True, help_text="请求 IP")
    user_agent = models.TextField(blank=True, help_text="User Agent")
    
    # 结果
    success = models.BooleanField(default=True, help_text="操作是否成功")
    error_message = models.TextField(blank=True, help_text="错误信息（如果失败）")
    
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    
    class Meta:
        db_table = "accounts_auditlog"
        verbose_name = "操作日志"
        verbose_name_plural = "操作日志"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["action", "-created_at"], name="idx_auditlog_action_time"),
            models.Index(fields=["username", "-created_at"], name="idx_auditlog_user_time"),
            models.Index(fields=["resource_type", "resource_id"], name="idx_auditlog_resource"),
        ]
    
    def __str__(self):
        return f"{self.username} - {self.get_action_display()} - {self.created_at}"
