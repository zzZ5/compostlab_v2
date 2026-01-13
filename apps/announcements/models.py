from django.db import models
from django.contrib.auth import get_user_model

User = get_user_model()


class Announcement(models.Model):
    """公告模型"""

    class Category(models.TextChoices):
        SYSTEM = "system", "系统通知"
        MAINTENANCE = "maintenance", "维护通知"
        FEATURE = "feature", "功能更新"
        ANNOUNCEMENT = "announcement", "公告"

    class Priority(models.TextChoices):
        LOW = "low", "低"
        MEDIUM = "medium", "中"
        HIGH = "high", "高"
        URGENT = "urgent", "紧急"

    class TargetRole(models.TextChoices):
        ALL = "all", "所有用户"
        ADMIN = "admin", "管理员"
        OPERATOR = "operator", "操作员"
        READONLY = "readonly", "只读用户"

    title = models.CharField("标题", max_length=200)
    content = models.TextField("内容")
    category = models.CharField(
        "分类",
        max_length=50,
        choices=Category.choices,
        default=Category.ANNOUNCEMENT,
        db_index=True,
    )
    priority = models.CharField(
        "优先级",
        max_length=20,
        choices=Priority.choices,
        default=Priority.MEDIUM,
        db_index=True,
    )
    target_role = models.CharField(
        "目标角色",
        max_length=20,
        choices=TargetRole.choices,
        default=TargetRole.ALL,
        db_index=True,
    )

    is_active = models.BooleanField("是否启用", default=True, db_index=True)
    is_pinned = models.BooleanField("是否置顶", default=False, db_index=True)
    expiry_at = models.DateTimeField("过期时间", null=True, blank=True, db_index=True)

    created_by = models.ForeignKey(
        User,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="创建人",
        related_name="created_announcements",
    )
    created_at = models.DateTimeField("创建时间", auto_now_add=True, db_index=True)
    updated_at = models.DateTimeField("更新时间", auto_now=True)

    class Meta:
        ordering = ["-is_pinned", "-priority", "-created_at"]
        indexes = [
            models.Index(fields=["-is_pinned", "-priority", "-created_at"]),
        ]

    def __str__(self):
        return self.title

    def is_expired(self):
        """是否已过期"""
        from django.utils import timezone

        if not self.expiry_at:
            return False
        return timezone.now() > self.expiry_at

    def is_visible_for_role(self, role):
        """是否对指定角色可见"""
        return self.target_role == self.TargetRole.ALL or self.target_role == role


class AnnouncementRead(models.Model):
    """公告已读记录"""

    announcement = models.ForeignKey(
        Announcement,
        on_delete=models.CASCADE,
        verbose_name="公告",
        related_name="read_records",
    )
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        verbose_name="用户",
        related_name="read_announcements",
    )
    read_at = models.DateTimeField("阅读时间", auto_now=True, db_index=True)

    class Meta:
        unique_together = [["announcement", "user"]]
        ordering = ["-read_at"]
        verbose_name = "公告已读记录"
        verbose_name_plural = "公告已读记录"

    def __str__(self):
        return f"{self.user.username} - {self.announcement.title}"
