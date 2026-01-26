from django.utils import timezone
from django.db.models import Q, Count, F
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.http import JsonResponse
from django.views import View

from apps.accounts.models import UserProfile, AuditLog
from apps.accounts.mixins import JWTAuthMixin
from apps.accounts.utils import log_audit, get_client_ip, get_user_timezone, format_datetime_for_user
from apps.api.mixins import JsonBodyMixin
from apps.api.pagination import OffsetPaginator
from apps.permissions.mixins import ResourcePermissionMixin
from apps.permissions.config import ResourceType, ActionType

from .models import Announcement, AnnouncementRead


@method_decorator(csrf_exempt, name="dispatch")
class AnnouncementListView(JWTAuthMixin, ResourcePermissionMixin, JsonBodyMixin, View):
    """
    公告列表（管理员和操作员）
    在 get 方法中手动检查权限，确保在 JWTAuthMixin 认证之后执行
    """
    resource_type = ResourceType.ANNOUNCEMENT_READ_ALL
    action_type = ActionType.READ

    def get(self, request):
        # 获取用户时区
        user_tz = get_user_timezone(request.user)

        # 获取查询参数
        page = int(request.GET.get("page", 1))
        page_size = int(request.GET.get("page_size", 20))
        search = request.GET.get("search", "")
        category = request.GET.get("category", "")
        priority = request.GET.get("priority", "")
        target_role = request.GET.get("target_role", "")
        is_active = request.GET.get("is_active", "")
        is_pinned = request.GET.get("is_pinned", "")
        is_expired = request.GET.get("is_expired", "")
        created_after = request.GET.get("created_after")
        created_before = request.GET.get("created_before")

        # 构建查询
        queryset = Announcement.objects.all()

        # 搜索
        if search:
            queryset = queryset.filter(
                Q(title__icontains=search) | Q(content__icontains=search)
            )

        # 筛选
        if category:
            queryset = queryset.filter(category=category)
        if priority:
            queryset = queryset.filter(priority=priority)
        if target_role:
            queryset = queryset.filter(target_role=target_role)
        if is_active:
            queryset = queryset.filter(is_active=is_active == "true")
        if is_pinned:
            queryset = queryset.filter(is_pinned=is_pinned == "true")
        if is_expired:
            # 过期状态筛选
            now = timezone.now()
            if is_expired == "true":
                # 只显示已过期的
                queryset = queryset.filter(expiry_at__lt=now, expiry_at__isnull=False)
            elif is_expired == "false":
                # 只显示未过期的
                queryset = queryset.filter(Q(expiry_at__gte=now) | Q(expiry_at__isnull=True))

        # 日期范围筛选
        if created_after:
            queryset = queryset.filter(created_at__gte=created_after)
        if created_before:
            queryset = queryset.filter(created_at__lte=created_before)

        # 排序：默认按创建时间倒序（最新的在前）
        queryset = queryset.order_by("-created_at")

        # 分页
        paginator = OffsetPaginator(queryset, page, page_size)
        result = paginator.paginate()

        # 序列化数据
        data = []
        for announcement in result["data"]:
            # 统计已读人数
            read_count = announcement.read_records.count()

            # 获取创建人名称
            created_by_name = (
                announcement.created_by.username if announcement.created_by else "系统"
            )

            data.append(
                {
                    "id": announcement.id,
                    "title": announcement.title,
                    "content": announcement.content,
                    "category": announcement.category,
                    "priority": announcement.priority,
                    "target_role": announcement.target_role,
                    "is_active": announcement.is_active,
                    "is_pinned": announcement.is_pinned,
                    "expiry_at": format_datetime_for_user(announcement.expiry_at, user_tz),
                    "is_expired": announcement.is_expired(),
                    "read_count": read_count,
                    "created_by": created_by_name,
                    "created_at": format_datetime_for_user(announcement.created_at, user_tz),
                    "updated_at": format_datetime_for_user(announcement.updated_at, user_tz),
                }
            )

        return JsonResponse(
            {
                "data": data,
                "pagination": result["pagination"],
            }
        )


@method_decorator(csrf_exempt, name="dispatch")
class AnnouncementCreateView(JWTAuthMixin, ResourcePermissionMixin, JsonBodyMixin, View):
    """
    创建公告（仅管理员）
    在 post 方法中手动检查权限，确保在 JWTAuthMixin 认证之后执行
    """
    resource_type = ResourceType.ANNOUNCEMENT_CREATE
    action_type = ActionType.CREATE

    def post(self, request):
        try:
            body = self.json_body(request)

            # 验证必填字段
            if not body.get("title"):
                return JsonResponse({"detail": "标题不能为空"}, status=400)
            if not body.get("content"):
                return JsonResponse({"detail": "内容不能为空"}, status=400)

            # 验证目标角色：管理员只能发布公告给自己角色或更低的角色
            target_role = body.get("target_role", Announcement.TargetRole.ALL)
            role_levels = {"all": 0, "readonly": 1, "operator": 2, "admin": 3}

            try:
                profile = request.user.profile
                user_level = role_levels.get(profile.role, 0)
            except UserProfile.DoesNotExist:
                user_level = 0

            target_level = role_levels.get(target_role, 0)

            # 非超级管理员不能发布给比自己角色高的用户
            if target_level > user_level and not request.user.is_superuser:
                return JsonResponse({"detail": "权限不足，不能发布给更高级别的用户"}, status=403)

            # 处理过期时间
            expiry_at_str = body.get("expiry_at")
            expiry_at = None
            if expiry_at_str:
                from django.utils import timezone
                from datetime import datetime

                try:
                    expiry_at = timezone.make_aware(datetime.fromisoformat(expiry_at_str))
                except ValueError:
                    return JsonResponse({"detail": "过期时间格式错误"}, status=400)

            # 创建公告
            announcement = Announcement.objects.create(
                title=body["title"],
                content=body["content"],
                category=body.get("category", Announcement.Category.ANNOUNCEMENT),
                priority=body.get("priority", Announcement.Priority.MEDIUM),
                target_role=target_role,
                is_active=body.get("is_active", True),
                is_pinned=body.get("is_pinned", False),
                expiry_at=expiry_at,
                created_by=request.user,
            )

            # 记录审计日志
            log_audit(
                user=request.user,
                action=AuditLog.Action.ANNOUNCEMENT_CREATE,
                resource_type="announcement",
                resource_id=str(announcement.id),
                description=f"创建公告: {announcement.title}",
                changes={"title": announcement.title, "content": announcement.content},
                request=request,
            )

            return JsonResponse(
                {
                    "id": announcement.id,
                    "title": announcement.title,
                    "message": "公告创建成功",
                },
                status=201,
            )

        except Exception as e:
            return JsonResponse({"detail": str(e)}, status=500)


@method_decorator(csrf_exempt, name="dispatch")
class AnnouncementDetailView(JWTAuthMixin, JsonBodyMixin, View):
    """公告详情"""

    def get(self, request, announcement_id):
        try:
            announcement = Announcement.objects.get(id=announcement_id)
        except Announcement.DoesNotExist:
            return JsonResponse({"detail": "公告不存在"}, status=404)

        # 权限检查：只允许查看针对自己角色或更低角色的公告
        try:
            profile = request.user.profile
        except UserProfile.DoesNotExist:
            return JsonResponse({"detail": "权限不足"}, status=403)

        role_levels = {"all": 0, "readonly": 1, "operator": 2, "admin": 3}
        user_level = role_levels.get(profile.role, 0)
        target_level = role_levels.get(announcement.target_role, 0)

        # 如果公告的目标角色比用户角色高，则不允许查看
        if target_level > user_level and not request.user.is_superuser:
            return JsonResponse({"detail": "权限不足，无权查看此公告"}, status=403)

        # 统计已读人数
        read_count = announcement.read_records.count()

        # 获取创建人名称
        created_by_name = (
            announcement.created_by.username if announcement.created_by else "系统"
        )

        return JsonResponse(
            {
                "id": announcement.id,
                "title": announcement.title,
                "content": announcement.content,
                "category": announcement.category,
                "priority": announcement.priority,
                "target_role": announcement.target_role,
                "is_active": announcement.is_active,
                "is_pinned": announcement.is_pinned,
                "expiry_at": (
                    announcement.expiry_at.strftime("%Y-%m-%d %H:%M:%S")
                    if announcement.expiry_at
                    else None
                ),
                "is_expired": announcement.is_expired(),
                "read_count": read_count,
                "created_by": created_by_name,
                "created_at": announcement.created_at.strftime("%Y-%m-%d %H:%M:%S"),
                "updated_at": announcement.updated_at.strftime("%Y-%m-%d %H:%M:%S"),
            }
        )


@method_decorator(csrf_exempt, name="dispatch")
class AnnouncementUpdateView(JWTAuthMixin, ResourcePermissionMixin, JsonBodyMixin, View):
    """更新公告"""
    resource_type = ResourceType.ANNOUNCEMENT_UPDATE
    action_type = ActionType.WRITE

    def put(self, request, announcement_id):
        try:
            announcement = Announcement.objects.get(id=announcement_id)
        except Announcement.DoesNotExist:
            return JsonResponse({"detail": "公告不存在"}, status=404)

        try:
            body = self.json_body(request)

            # 记录变更
            changes = {}
            if "title" in body and announcement.title != body["title"]:
                changes["title"] = {"old": announcement.title, "new": body["title"]}
                announcement.title = body["title"]
            if "content" in body and announcement.content != body["content"]:
                changes["content"] = {
                    "old": announcement.content,
                    "new": body["content"],
                }
                announcement.content = body["content"]
            if "category" in body:
                changes["category"] = {"old": announcement.category, "new": body["category"]}
                announcement.category = body["category"]
            if "priority" in body:
                changes["priority"] = {"old": announcement.priority, "new": body["priority"]}
                announcement.priority = body["priority"]
            if "target_role" in body:
                changes["target_role"] = {
                    "old": announcement.target_role,
                    "new": body["target_role"],
                }
                announcement.target_role = body["target_role"]
            if "is_active" in body:
                changes["is_active"] = {
                    "old": announcement.is_active,
                    "new": body["is_active"],
                }
                announcement.is_active = body["is_active"]
            if "is_pinned" in body:
                changes["is_pinned"] = {
                    "old": announcement.is_pinned,
                    "new": body["is_pinned"],
                }
                announcement.is_pinned = body["is_pinned"]
            if "expiry_at" in body:
                old_expiry = announcement.expiry_at
                new_expiry = body["expiry_at"]
                if new_expiry:
                    from datetime import datetime
                    new_expiry = datetime.strptime(new_expiry, "%Y-%m-%d %H:%M:%S")
                changes["expiry_at"] = {
                    "old": old_expiry.strftime("%Y-%m-%d %H:%M:%S") if old_expiry else None,
                    "new": new_expiry.strftime("%Y-%m-%d %H:%M:%S") if new_expiry else None,
                }
                announcement.expiry_at = new_expiry

            announcement.save()

            # 记录审计日志
            log_audit(
                user=request.user,
                action=AuditLog.Action.ANNOUNCEMENT_UPDATE,
                resource_type="announcement",
                resource_id=str(announcement.id),
                description=f"更新公告: {announcement.title}",
                changes=changes,
                request=request,
            )

            return JsonResponse(
                {
                    "id": announcement.id,
                    "title": announcement.title,
                    "message": "公告更新成功",
                }
            )

        except Exception as e:
            return JsonResponse({"detail": str(e)}, status=500)


@method_decorator(csrf_exempt, name="dispatch")
class AnnouncementDeleteView(JWTAuthMixin, ResourcePermissionMixin, JsonBodyMixin, View):
    """删除公告"""
    resource_type = ResourceType.ANNOUNCEMENT_DELETE
    action_type = ActionType.DELETE

    def delete(self, request, announcement_id):
        try:
            announcement = Announcement.objects.get(id=announcement_id)
        except Announcement.DoesNotExist:
            return JsonResponse({"detail": "公告不存在"}, status=404)

        title = announcement.title
        announcement.delete()

        # 记录审计日志
        log_audit(
            user=request.user,
            action=AuditLog.Action.ANNOUNCEMENT_DELETE,
            resource_type="announcement",
            resource_id=str(announcement_id),
            description=f"删除公告: {title}",
            changes={"deleted": True},
            request=request,
        )

        return JsonResponse({"message": "公告删除成功"})


@method_decorator(csrf_exempt, name="dispatch")
class MyAnnouncementsView(JWTAuthMixin, View):
    """我的公告（当前用户可见的公告）"""

    def get(self, request):
        # 获取用户角色和时区
        user_tz = get_user_timezone(request.user)
        try:
            profile = UserProfile.objects.get(user=request.user)
            user_role = profile.role
        except UserProfile.DoesNotExist:
            user_role = UserProfile.Role.READONLY

        # 获取查询参数
        page = int(request.GET.get("page", 1))
        page_size = int(request.GET.get("page_size", 20))
        unread_only = request.GET.get("unread_only", "false") == "true"

        # 构建查询：可见且未过期的公告
        queryset = Announcement.objects.filter(
            is_active=True,
        ).filter(
            Q(target_role=Announcement.TargetRole.ALL) | Q(target_role=user_role),
        ).filter(
            Q(expiry_at__isnull=True) | Q(expiry_at__gt=timezone.now()),
        )

        # 获取用户已读的公告ID
        read_announcement_ids = set(
            AnnouncementRead.objects.filter(user=request.user).values_list(
                "announcement_id", flat=True
            )
        )

        # 只显示未读公告
        if unread_only:
            queryset = queryset.exclude(id__in=read_announcement_ids)

        # 排序：置顶优先，然后按优先级降序，最后按创建时间倒序
        queryset = queryset.order_by(
            "-is_pinned",
            "-priority",
            "-created_at"
        )

        # 分页
        paginator = OffsetPaginator(queryset, page, page_size)
        result = paginator.paginate()

        # 序列化数据
        data = []
        for announcement in result["data"]:
            is_read = announcement.id in read_announcement_ids

            data.append(
                {
                    "id": announcement.id,
                    "title": announcement.title,
                    "content": announcement.content,
                    "category": announcement.category,
                    "priority": announcement.priority,
                    "is_pinned": announcement.is_pinned,
                    "expiry_at": format_datetime_for_user(announcement.expiry_at, user_tz),
                    "created_at": format_datetime_for_user(announcement.created_at, user_tz),
                    "is_read": is_read,
                }
            )

        # 统计未读数量
        unread_count = queryset.exclude(id__in=read_announcement_ids).count()

        return JsonResponse(
            {
                "data": data,
                "pagination": result["pagination"],
                "unread_count": unread_count,
            }
        )


@method_decorator(csrf_exempt, name="dispatch")
class MarkAsReadView(JWTAuthMixin, View):
    """标记公告已读"""

    def post(self, request, announcement_id):
        try:
            announcement = Announcement.objects.get(id=announcement_id)
        except Announcement.DoesNotExist:
            return JsonResponse({"detail": "公告不存在"}, status=404)

        # 创建或更新已读记录
        AnnouncementRead.objects.get_or_create(
            announcement=announcement,
            user=request.user,
            defaults={"read_at": timezone.now()},
        )

        return JsonResponse({"message": "标记已读成功"})


@method_decorator(csrf_exempt, name="dispatch")
class UnreadCountView(JWTAuthMixin, View):
    """未读公告数量"""

    def get(self, request):
        # 获取用户角色
        try:
            profile = UserProfile.objects.get(user=request.user)
            user_role = profile.role
        except UserProfile.DoesNotExist:
            user_role = UserProfile.Role.READONLY

        # 获取用户已读的公告ID
        read_announcement_ids = set(
            AnnouncementRead.objects.filter(user=request.user).values_list(
                "announcement_id", flat=True
            )
        )

        # 构建查询：可见、未过期、未读的公告
        queryset = Announcement.objects.filter(
            is_active=True,
        ).filter(
            Q(target_role=Announcement.TargetRole.ALL) | Q(target_role=user_role),
        ).filter(
            Q(expiry_at__isnull=True) | Q(expiry_at__gt=timezone.now()),
        ).exclude(id__in=read_announcement_ids)

        count = queryset.count()

        return JsonResponse({"unread_count": count})


@method_decorator(csrf_exempt, name="dispatch")
class MyHistoryView(JWTAuthMixin, View):
    """我的公告历史（已读公告）"""

    def get(self, request):
        # 获取用户时区
        user_tz = get_user_timezone(request.user)

        # 获取查询参数
        page = int(request.GET.get("page", 1))
        page_size = int(request.GET.get("page_size", 20))
        category = request.GET.get("category", "")
        priority = request.GET.get("priority", "")
        show_expired = request.GET.get("show_expired", "true") == "true"

        # 获取用户已读的公告记录
        queryset = AnnouncementRead.objects.filter(user=request.user).select_related(
            "announcement"
        )

        # 根据公告属性筛选
        if category:
            queryset = queryset.filter(announcement__category=category)
        if priority:
            queryset = queryset.filter(announcement__priority=priority)

        # 排序：按阅读时间倒序（最近阅读的在前）
        # 对于同一天阅读的公告，按公告创建时间倒序
        queryset = queryset.order_by("-read_at", "-announcement__created_at")

        # 分页
        paginator = OffsetPaginator(queryset, page, page_size)
        result = paginator.paginate()

        # 序列化数据
        data = []
        for read_record in result["data"]:
            announcement = read_record.announcement

            # 计算是否过期
            is_expired = announcement.is_expired()

            data.append(
                {
                    "id": announcement.id,
                    "title": announcement.title,
                    "content": announcement.content,
                    "category": announcement.category,
                    "priority": announcement.priority,
                    "is_pinned": announcement.is_pinned,
                    "expiry_at": format_datetime_for_user(
                        announcement.expiry_at, user_tz
                    ),
                    "created_at": format_datetime_for_user(
                        announcement.created_at, user_tz
                    ),
                    "read_at": format_datetime_for_user(read_record.read_at, user_tz),
                    "is_read": True,
                    "is_expired": is_expired,
                }
            )

        # 统计总数（包括已过期的）
        total_count = queryset.count()

        return JsonResponse(
            {
                "data": data,
                "pagination": result["pagination"],
                "total_count": total_count,
            }
        )
