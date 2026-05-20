from __future__ import annotations

import re
import shutil
from pathlib import Path
from urllib.parse import unquote, urlparse

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


IMG_SRC_RE = re.compile(r'(<img\b[^>]*?\bsrc=)(["\'])(?P<src>.*?)(\2)', re.IGNORECASE | re.DOTALL)
DATE_RE = re.compile(r"^(?P<date>\d{4}-\d{2}-\d{2})_daily_digest\.html$")


def article_root() -> Path:
    return Path(getattr(settings, "LITERATURE_ARTICLE_ROOT", settings.MEDIA_ROOT / "literature" / "articles")).resolve()


def asset_root() -> Path:
    return Path(getattr(settings, "LITERATURE_ASSET_ROOT", settings.MEDIA_ROOT / "literature" / "assets")).resolve()


def media_url_for(path: Path) -> str:
    rel = path.resolve().relative_to(Path(settings.MEDIA_ROOT).resolve())
    return f"{settings.MEDIA_URL.rstrip('/')}/{rel.as_posix()}"


def file_url_to_path(src: str) -> Path | None:
    if not src.lower().startswith("file://"):
        return None
    parsed = urlparse(src)
    raw_path = unquote(parsed.path)
    if parsed.netloc and parsed.netloc not in ("", "localhost"):
        raw_path = f"//{parsed.netloc}{raw_path}"
    if re.match(r"^/[A-Za-z]:/", raw_path):
        raw_path = raw_path[1:]
    return Path(raw_path)


class Command(BaseCommand):
    help = "Copy literature images into MEDIA_ROOT and rewrite article img src to public media URLs."

    def add_arguments(self, parser):
        parser.add_argument("--date", help="Only process one article date, e.g. 2026-05-20.")
        parser.add_argument("--dry-run", action="store_true", help="Show planned changes without writing files.")

    def handle(self, *args, **options):
        root = article_root()
        if not root.exists():
            raise CommandError(f"Article root does not exist: {root}")

        dry_run = bool(options["dry_run"])
        date_filter = options.get("date")
        articles = sorted(root.glob("*_daily_digest.html"))
        copied = 0
        rewritten = 0
        missing: list[str] = []

        for article in articles:
            match = DATE_RE.match(article.name)
            if not match:
                continue
            date = match.group("date")
            if date_filter and date != date_filter:
                continue

            html = article.read_text(encoding="utf-8", errors="replace")
            changed = False

            def replace_src(match_obj: re.Match[str]) -> str:
                nonlocal copied, rewritten, changed
                src = match_obj.group("src")
                source_path = file_url_to_path(src)
                if source_path is None:
                    return match_obj.group(0)
                if not source_path.exists() or not source_path.is_file():
                    missing.append(f"{article.name}: {source_path}")
                    return match_obj.group(0)

                target_dir = asset_root() / date
                target_path = target_dir / source_path.name
                public_url = media_url_for(target_path)

                if not dry_run:
                    target_dir.mkdir(parents=True, exist_ok=True)
                    if not target_path.exists() or source_path.stat().st_size != target_path.stat().st_size:
                        shutil.copy2(source_path, target_path)
                        copied += 1
                else:
                    copied += 1

                rewritten += 1
                changed = True
                return f'{match_obj.group(1)}{match_obj.group(2)}{public_url}{match_obj.group(2)}'

            new_html = IMG_SRC_RE.sub(replace_src, html)
            if changed and not dry_run:
                article.write_text(new_html, encoding="utf-8")

        self.stdout.write(self.style.SUCCESS(f"Processed articles in {root}"))
        self.stdout.write(f"Images copied/planned: {copied}")
        self.stdout.write(f"Image src rewritten/planned: {rewritten}")

        if missing:
            self.stdout.write(self.style.WARNING("Missing source images:"))
            for item in missing:
                self.stdout.write(f"- {item}")
