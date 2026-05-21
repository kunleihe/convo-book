"""
Batch driver: read audit.csv, run transcribe_legacy_page.py for every (username, page) row.

Usage:
    # First run audit_legacy_variants.py to get audit.csv, then:
    python batch.py --audit audit.csv --engine openai-mini

    # Limit scope while evaluating:
    python batch.py --audit audit.csv --usernames 7102,8033 --pages 2,3
    python batch.py --audit audit.csv --conditions parent_ai
"""

from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

import boto3
import pandas as pd
from botocore.config import Config
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("batch")

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_ENV = REPO_ROOT / "backend" / "app" / ".env"
DEFAULT_OUT = SCRIPT_DIR / "output"


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


def page_already_done(out_dir: Path, username: str, page: int) -> bool:
    page_dir = out_dir / username / f"page-{page:02d}"
    if not page_dir.exists():
        return False
    return any(page_dir.glob("*video-*.json"))


def filter_set(csv_arg: Optional[str]) -> Optional[set[str]]:
    if csv_arg is None:
        return None
    return {s.strip() for s in csv_arg.split(",") if s.strip()}


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
    parser.add_argument("--usernames", default=None, help="Comma-separated allowlist")
    parser.add_argument("--pages", default=None, help="Comma-separated pages, e.g. 2,3,4")
    parser.add_argument("--conditions", default=None, help="parent_ai,parent_only,ai_only")
    parser.add_argument("--skip-done", action="store_true",
                        help="Skip pages that already have output files")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_env(args.env)
    bucket = args.bucket or os.environ.get("S3_BUCKET_NAME")
    if not bucket:
        log.error("S3_BUCKET_NAME not set")
        sys.exit(1)

    if not args.audit.exists():
        log.error(f"audit CSV not found: {args.audit}. Run audit_legacy_variants.py first.")
        sys.exit(1)

    df = pd.read_csv(args.audit, dtype={"username": str})
    user_filter = filter_set(args.usernames)
    cond_filter = filter_set(args.conditions)
    page_filter = (
        {int(p) for p in args.pages.split(",")} if args.pages else None
    )

    client = s3_client()
    total_calls = 0

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
                continue

            cmd = [
                sys.executable, str(SCRIPT_DIR / "transcribe_legacy_page.py"),
                "--username", username,
                "--book-id", book_id,
                "--page", str(page),
                "--condition", condition,
                "--engine", args.engine,
                "--bucket", bucket,
                "--out-dir", str(args.out_dir),
                "--cache-dir", str(args.cache_dir),
            ]
            if args.language:
                cmd += ["--language", args.language]

            total_calls += 1
            log.info(f"[{total_calls}] {username} page-{page} ({condition})")
            if args.dry_run:
                log.info(f"DRY-RUN  cmd={' '.join(cmd)}")
                continue
            try:
                subprocess.run(cmd, check=True)
            except subprocess.CalledProcessError as e:
                log.error(f"FAILED {username} page-{page}: {e}")

    log.info(f"Done. {total_calls} page invocations.")


if __name__ == "__main__":
    main()
