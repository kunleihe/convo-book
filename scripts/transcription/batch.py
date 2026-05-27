"""
Batch driver: read audit.csv, transcribe every (username, page) row in a SINGLE process.

Designed to:
- Load pyannote model ONCE for the whole batch (saves ~10-15s per page)
- Catch any exception from a page without crashing the whole batch
- Run safely in the background (writes its own log file, ignores SIGTTOU)

------------------------------------------------------------------------------
Setup (one time, from scripts/transcription/):
    python3 -m venv .venv
    source .venv/bin/activate
    pip install -r requirements.txt

Activate venv each new shell (from scripts/transcription/):
    source .venv/bin/activate
    # prompt should show (.venv)
    # confirm:  which python   →   .../scripts/transcription/.venv/bin/python

Or skip activation by using the absolute path: .venv/bin/python instead of python
------------------------------------------------------------------------------

Usage (after activating venv):
    python batch.py --skip-done
    python batch.py --usernames 7102,8033 --pages 2,3
    python batch.py --conditions parent_ai
    python batch.py --dry-run

Background launch (logs auto-written to batch.log, no shell redirect needed):
    caffeinate -i .venv/bin/python batch.py --skip-done &
    # or, to survive closing the terminal:
    nohup caffeinate -i .venv/bin/python batch.py --skip-done &
"""

from __future__ import annotations

import argparse
import logging
import os
import signal
import sys
from pathlib import Path
from typing import Optional

import boto3
import pandas as pd
from botocore.config import Config
from dotenv import load_dotenv

# Will import transcribe_legacy_page after we set up logging so its logger inherits config
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_ENV = REPO_ROOT / "backend" / "app" / ".env"
DEFAULT_OUT = SCRIPT_DIR / "output"
DEFAULT_LOG = SCRIPT_DIR / "batch.log"
DEFAULT_REVIEW_DIR = Path(
    "/Users/kunleihe/Library/CloudStorage/"
    "GoogleDrive-kunleih@uci.edu/Shared drives/"
    "Bilingual-Ebook-Study/convo-book/reading-transcript"
)
REVIEW_COLUMNS = ["t_start", "t_end", "speaker", "text"]


def _setup_logging(log_path: Path, level: int = logging.INFO) -> None:
    """Log to file + stdout. Avoids relying on shell-level redirect."""
    log_path.parent.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    root.setLevel(level)
    # Clear any pre-existing handlers (e.g. when batch.py is imported as a module)
    for h in list(root.handlers):
        root.removeHandler(h)
    fmt = logging.Formatter("%(asctime)s [%(levelname)s] %(message)s")
    fh = logging.FileHandler(log_path, mode="a", encoding="utf-8")
    fh.setFormatter(fmt)
    sh = logging.StreamHandler(sys.stdout)
    sh.setFormatter(fmt)
    root.addHandler(fh)
    root.addHandler(sh)
    # Quiet down noisy 3rd-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("boto3").setLevel(logging.WARNING)


def _ignore_tty_signals() -> None:
    """
    Prevent the process from getting suspended when a child / library writes to /dev/tty.
    pyannote's huggingface_hub progress bars sometimes touch the tty, and zsh's default
    SIGTTOU policy can suspend the whole process group even when launched via nohup.
    """
    for sig in (signal.SIGTTOU, signal.SIGTTIN, signal.SIGTSTP):
        try:
            signal.signal(sig, signal.SIG_IGN)
        except (OSError, ValueError):
            pass


def load_env(env_path: Path) -> None:
    if env_path.exists():
        load_dotenv(env_path, override=False)


def s3_client():
    return boto3.client(
        "s3",
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        region_name=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"),
        config=Config(signature_version="s3v4"),
    )


def list_pages_for_session(client, bucket: str, username: str, book_id: str) -> list[int]:
    """List the page numbers actually present under user-data/{u}/{b}/."""
    prefix = f"user-data/{username}/{book_id}/"
    paginator = client.get_paginator("list_objects_v2")
    pages: set[int] = set()
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix, Delimiter="/"):
        for cp in page.get("CommonPrefixes", []) or []:
            name = cp["Prefix"].rstrip("/").split("/")[-1]
            if name.startswith("page-"):
                try:
                    pages.add(int(name.split("-")[1]))
                except ValueError:
                    continue
    return sorted(pages)


def page_has_events(client, bucket: str, username: str, book_id: str, page: int) -> bool:
    """Return True if S3 has at least one events JSON for this page (new-data path)."""
    prefix = f"user-data/{username}/{book_id}/page-{page:02d}/events/"
    paginator = client.get_paginator("list_objects_v2")
    for result in paginator.paginate(Bucket=bucket, Prefix=prefix, MaxKeys=1):
        if result.get("Contents"):
            return True
    return False


def page_already_done(out_dir: Path, username: str, page: int) -> bool:
    user_dir = out_dir / username
    if not user_dir.exists():
        return False
    return any(user_dir.glob(f"*_page-{page:02d}_video-*.xlsx"))


def filter_set(csv_arg: Optional[str]) -> Optional[set[str]]:
    if csv_arg is None:
        return None
    return {s.strip() for s in csv_arg.split(",") if s.strip()}


def _write_review_copies(out_dir: Path, username: str, page: int, review_dir: Path) -> None:
    """Write slim 4-column copies to review_dir; skip files that already exist."""
    log = logging.getLogger("batch")
    src_files = list((out_dir / username).glob(f"*_page-{page:02d}_video-*.xlsx"))
    for src in src_files:
        dest = review_dir / username / src.name
        if dest.exists():
            log.info(f"REVIEW-SKIP {dest.name} (already exists)")
            continue
        try:
            df = pd.read_excel(src, engine="openpyxl")
            dest.parent.mkdir(parents=True, exist_ok=True)
            df[REVIEW_COLUMNS].to_excel(dest, index=False, engine="openpyxl")
            log.info(f"REVIEW-COPY → {dest.name}")
        except Exception as e:
            log.warning(f"REVIEW-COPY failed for {src.name}: {e}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit", type=Path, default=SCRIPT_DIR / "audit.csv")
    parser.add_argument("--engine", default="openai-full",
                        choices=["openai-mini", "openai-full", "whisper-1", "faster-whisper-local"])
    parser.add_argument("--language", default=None)
    parser.add_argument("--bucket", default=None)
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--cache-dir", type=Path, default=SCRIPT_DIR / ".cache")
    parser.add_argument("--log-file", type=Path, default=DEFAULT_LOG)
    parser.add_argument("--usernames", default=None, help="Comma-separated allowlist")
    parser.add_argument("--pages", default=None, help="Comma-separated pages, e.g. 2,3,4")
    parser.add_argument("--conditions", default=None, help="parent_ai,parent_only,ai_only")
    parser.add_argument("--skip-done", action="store_true",
                        help="Skip pages that already have output files")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--review-dir", type=Path, default=DEFAULT_REVIEW_DIR,
                        help="Target dir for slim 4-col review copies")
    parser.add_argument("--backfill-review", action="store_true",
                        help="Copy slim review xlsx from existing output/ without re-transcribing")
    args = parser.parse_args()

    _setup_logging(args.log_file)
    _ignore_tty_signals()
    log = logging.getLogger("batch")

    load_env(args.env)
    bucket = args.bucket or os.environ.get("S3_BUCKET_NAME")
    if not bucket:
        log.error("S3_BUCKET_NAME not set")
        sys.exit(1)

    if not args.audit.exists():
        log.error(f"audit CSV not found: {args.audit}. Run audit_legacy_variants.py first.")
        sys.exit(1)

    if args.backfill_review:
        log.info(f"Backfilling review copies from {args.out_dir} → {args.review_dir}")
        for user_dir in sorted(args.out_dir.iterdir()):
            if not user_dir.is_dir():
                continue
            for src in sorted(user_dir.glob("*.xlsx")):
                dest = args.review_dir / user_dir.name / src.name
                if dest.exists():
                    log.info(f"REVIEW-SKIP {src.name} (already exists)")
                    continue
                try:
                    df = pd.read_excel(src, engine="openpyxl")
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    df[REVIEW_COLUMNS].to_excel(dest, index=False, engine="openpyxl")
                    log.info(f"REVIEW-COPY → {user_dir.name}/{src.name}")
                except Exception as e:
                    log.warning(f"REVIEW-COPY failed for {src.name}: {e}")
        log.info("Backfill done.")
        return

    # Import both modules after logging is set up so they inherit config
    import transcribe_no_ai_events
    import transcribe_with_ai_events

    df = pd.read_csv(args.audit, dtype={"username": str})
    user_filter = filter_set(args.usernames)
    cond_filter = filter_set(args.conditions)
    page_filter = (
        {int(p) for p in args.pages.split(",")} if args.pages else None
    )

    client = s3_client()
    total_pages_attempted = 0
    total_pages_skipped = 0
    total_pages_failed = 0

    for _, row in df.iterrows():
        username = str(row["username"])
        book_id = str(row["book_id"])
        condition = str(row["condition"])

        if user_filter and username not in user_filter:
            continue
        if cond_filter and condition not in cond_filter:
            continue
        if condition == "unknown":
            log.info(f"Skipping {username}: condition unknown (add to variant_overrides.yaml)")
            continue

        pages = list_pages_for_session(client, bucket, username, book_id)
        if page_filter:
            pages = [p for p in pages if p in page_filter]
        if not pages:
            log.info(f"No pages found for {username}/{book_id}")
            continue

        for page in pages:
            if args.skip_done and page_already_done(args.out_dir, username, page):
                log.info(f"SKIP {username} page-{page} (already done)")
                total_pages_skipped += 1
                continue

            total_pages_attempted += 1
            log.info(f"[{total_pages_attempted}] {username} page-{page} ({condition})")
            if args.dry_run:
                log.info(f"DRY-RUN  would transcribe {username} page-{page}")
                continue
            try:
                mod = transcribe_with_ai_events if page_has_events(client, bucket, username, book_id, page) else transcribe_no_ai_events
                mod.run_page(
                    client=client, bucket=bucket,
                    username=username, book_id=book_id, page=page,
                    condition=condition, engine_name=args.engine,
                    language=args.language,
                    out_dir=args.out_dir, cache_dir_root=args.cache_dir,
                )
                _write_review_copies(args.out_dir, username, page, args.review_dir)
            except Exception as e:
                log.exception(f"FAILED {username} page-{page}: {e}")
                total_pages_failed += 1

    log.info(
        f"Done. attempted={total_pages_attempted}  "
        f"skipped={total_pages_skipped}  failed={total_pages_failed}"
    )


if __name__ == "__main__":
    main()
