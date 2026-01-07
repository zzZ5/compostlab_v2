from datetime import datetime
from typing import Optional
from django.utils import timezone
from dataclasses import dataclass


def iso_local(dt: datetime) -> str:
    """统一输出为本地时区（TIME_ZONE）"""
    return timezone.localtime(dt).isoformat()


def parse_dt(s: Optional[str]) -> Optional[datetime]:
    """
    兼容:
      - "YYYY-MM-DD HH:MM:SS"（按当前时区解释）
      - ISO8601
    """
    if not s:
        return None
    s = s.strip()

    try:
        dt = datetime.strptime(s, "%Y-%m-%d %H:%M:%S")
        tz = timezone.get_current_timezone()
        return timezone.make_aware(dt, tz)
    except Exception:
        pass

    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if timezone.is_aware(dt):
            return dt
        tz = timezone.get_current_timezone()
        return timezone.make_aware(dt, tz)
    except Exception:
        return None


# --------- bucket 解析：支持 10m / 1h / 1d / 600 ---------
@dataclass
class Bucket:
    seconds: int
    label: str


def parse_bucket(s: Optional[str]) -> Optional[Bucket]:
    if not s:
        return None
    s = s.strip().lower()

    # 允许 "600" 直接表示秒
    if s.isdigit():
        sec = int(s)
        return Bucket(seconds=sec, label=f"{sec}s")

    unit = s[-1]
    num = s[:-1]
    if not num.isdigit():
        return None
    n = int(num)

    if unit == "s":
        return Bucket(n, s)
    if unit == "m":
        return Bucket(n * 60, s)
    if unit == "h":
        return Bucket(n * 3600, s)
    if unit == "d":
        return Bucket(n * 86400, s)
    return None
