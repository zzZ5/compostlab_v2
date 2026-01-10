# apps/api/pagination.py
"""
分页工具类
支持基于游标的分页（Cursor-based Pagination）
适用于大数据量查询，性能优于 OFFSET 分页
"""

from typing import Optional, Dict, Any, List
from django.db.models import QuerySet
from django.http import JsonResponse


class CursorPaginator:
    """
    基于游标的分页器
    
    优点：
    - 性能稳定，不受数据量影响（不使用 OFFSET）
    - 避免数据重复或遗漏（即使数据实时插入）
    - 支持时间序列数据的高效分页
    
    使用方式：
    1. 第一次请求：GET /api?limit=1000
    2. 后续请求：GET /api?limit=1000&cursor=<上次返回的 next_cursor>
    """
    
    def __init__(
        self,
        queryset: QuerySet,
        cursor_field: str = "id",
        page_size: int = 1000,
        max_page_size: int = 10000,
        ordering: str = "asc",
    ):
        """
        Args:
            queryset: Django QuerySet
            cursor_field: 游标字段（必须是唯一且有序的，如 id, ts）
            page_size: 每页数量
            max_page_size: 最大每页数量（防止滥用）
            ordering: 排序方向 "asc" 或 "desc"
        """
        self.queryset = queryset
        self.cursor_field = cursor_field
        self.page_size = min(page_size, max_page_size)
        self.ordering = ordering
        
    def paginate(self, cursor: Optional[str] = None) -> Dict[str, Any]:
        """
        执行分页
        
        Args:
            cursor: 游标值（上一页的最后一条记录的游标字段值）
        
        Returns:
            {
                "data": [...],
                "pagination": {
                    "page_size": 1000,
                    "has_next": true,
                    "next_cursor": "2026-01-10T10:30:00",
                    "total_returned": 1000
                }
            }
        """
        qs = self.queryset
        
        # 应用游标过滤
        if cursor:
            if self.ordering == "asc":
                qs = qs.filter(**{f"{self.cursor_field}__gt": cursor})
            else:
                qs = qs.filter(**{f"{self.cursor_field}__lt": cursor})
        
        # 应用排序
        order_prefix = "-" if self.ordering == "desc" else ""
        qs = qs.order_by(f"{order_prefix}{self.cursor_field}")
        
        # 多取一条判断是否有下一页
        items = list(qs[: self.page_size + 1])
        
        has_next = len(items) > self.page_size
        if has_next:
            items = items[: self.page_size]
        
        # 计算下一页游标
        next_cursor = None
        if has_next and items:
            last_item = items[-1]
            if isinstance(last_item, dict):
                next_cursor = last_item.get(self.cursor_field)
            else:
                next_cursor = getattr(last_item, self.cursor_field)
            
            # 如果是 datetime 对象，转换为 ISO 格式字符串
            if hasattr(next_cursor, "isoformat"):
                next_cursor = next_cursor.isoformat()
        
        return {
            "data": items,
            "pagination": {
                "page_size": self.page_size,
                "has_next": has_next,
                "next_cursor": str(next_cursor) if next_cursor else None,
                "total_returned": len(items),
            },
        }


class OffsetPaginator:
    """
    传统的 OFFSET 分页器
    
    缺点：
    - OFFSET 大时性能差（需要跳过前面所有行）
    - 可能出现数据重复或遗漏
    
    优点：
    - 支持跳转到任意页
    - 可以获取总数
    
    适用场景：数据量小（< 10万）或需要显示总页数的场景
    """
    
    def __init__(
        self,
        queryset: QuerySet,
        page: int = 1,
        page_size: int = 100,
        max_page_size: int = 1000,
    ):
        self.queryset = queryset
        self.page = max(1, page)
        self.page_size = min(max(1, page_size), max_page_size)
        
    def paginate(self, with_total: bool = False) -> Dict[str, Any]:
        """
        执行分页
        
        Args:
            with_total: 是否计算总数（性能开销大）
        
        Returns:
            {
                "data": [...],
                "pagination": {
                    "page": 1,
                    "page_size": 100,
                    "total": 1234,  # 仅当 with_total=True 时返回
                    "total_pages": 13,  # 仅当 with_total=True 时返回
                    "has_next": true,
                    "has_prev": false
                }
            }
        """
        offset = (self.page - 1) * self.page_size
        limit = self.page_size
        
        # 多取一条判断是否有下一页
        items = list(self.queryset[offset : offset + limit + 1])
        
        has_next = len(items) > self.page_size
        if has_next:
            items = items[: self.page_size]
        
        result = {
            "data": items,
            "pagination": {
                "page": self.page,
                "page_size": self.page_size,
                "has_next": has_next,
                "has_prev": self.page > 1,
                "total_returned": len(items),
            },
        }
        
        # 仅在请求时计算总数（性能开销大）
        if with_total:
            total = self.queryset.count()
            total_pages = (total + self.page_size - 1) // self.page_size
            result["pagination"]["total"] = total
            result["pagination"]["total_pages"] = total_pages
        
        return result


def paginated_response(
    data: List[Any],
    pagination: Dict[str, Any],
    extra: Optional[Dict[str, Any]] = None,
    status: int = 200,
) -> JsonResponse:
    """
    生成统一的分页响应格式
    
    Args:
        data: 数据列表
        pagination: 分页信息
        extra: 额外的响应字段
        status: HTTP 状态码
    
    Returns:
        JsonResponse
    """
    response = {
        "data": data,
        "pagination": pagination,
    }
    
    if extra:
        response.update(extra)
    
    return JsonResponse(response, status=status)
