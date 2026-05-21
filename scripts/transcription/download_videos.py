"""
Download all participants' webm recordings from S3 to a local folder.

By default, reads audit.csv to know which 4-digit usernames to fetch.
You can also pass --usernames to override.

Usage:
    python download_videos.py                                # everyone in audit.csv
    python download_videos.py --usernames 7102,8033          # just these
    python download_videos.py --conditions parent_ai         # filter by condition
    python download_videos.py --pages 2,3                    # only certain pages
    python download_videos.py --out-dir ~/Desktop/videos     # different destination
    python download_videos.py --parallel 8                   # 8 concurrent downloads

Skips files that already exist (resumable).
"""

from __future__ import annotations

import argparse
import concurrent.futures
import logging
import os
import re
import sys
import threading
from pathlib import Path

import boto3
import pandas as pd
from botocore.config import Config
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("download")

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_ENV = REPO_ROOT / "backend" / "app" / ".env"
DEFAULT_AUDIT = SCRIPT_DIR / "audit.csv"
DEFAULT_OUT = SCRIPT_DIR / "videos"

USERNAME_RE = re.compile(r"^\d{4}$")
PAGE_RE = re.compile(r"page-(\d+)")


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


def list_keys(client, bucket: str, prefix: str) -> list[str]:
    paginator = client.get_paginator("list_objects_v2")
    keys = []
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            keys.append(obj["Key"])
    return keys


def filter_set(arg: str | None) -> set[str] | None:
    if arg is None:
        return None
    return {s.strip() for s in arg.split(",") if s.strip()}


def collect_targets(
    client, bucket: str, audit_df: pd.DataFrame,
    user_filter: set[str] | None,
    cond_filter: set[str] | None,
    page_filter: set[int] | None,
    include_unknown: bool,
) -> list[tuple[str, str, int, str]]:
    """Returns list of (username, book_id, page_number, s3_key) tuples to download."""
    targets = []
    for _, row in audit_df.iterrows():
        username = str(row["username"])
        if not USERNAME_RE.match(username):
            continue
        if user_filter and username not in user_filter:
            continue
        condition = str(row.get("condition", ""))
        if cond_filter and condition not in cond_filter:
            continue
        if not include_unknown and condition == "unknown":
            continue
        book_id = str(row["book_id"])

        # List all media/ keys under this session
        prefix = f"user-data/{username}/{book_id}/"
        keys = list_keys(client, bucket, prefix)
        for k in keys:
            if not k.endswith(".webm"):
                continue
            m = PAGE_RE.search(k)
            if not m:
                continue
            page = int(m.group(1))
            if page_filter and page not in page_filter:
                continue
            targets.append((username, book_id, page, k))
    return targets


def local_path_for(out_dir: Path, username: str, page: int, s3_key: str) -> Path:
    filename = Path(s3_key).name
    return out_dir / username / f"page-{page:02d}" / filename


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit", type=Path, default=DEFAULT_AUDIT,
                        help="audit.csv from audit_legacy_variants.py")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT,
                        help="Local destination directory (default: scripts/transcription/videos)")
    parser.add_argument("--usernames", default=None,
                        help="Comma-separated allowlist, e.g. 7102,8033")
    parser.add_argument("--conditions", default=None,
                        help="Comma-separated, e.g. parent_ai,parent_only")
    parser.add_argument("--pages", default=None,
                        help="Comma-separated pages, e.g. 2,3,4")
    parser.add_argument("--include-unknown", action="store_true",
                        help="Also download sessions with condition=unknown (skipped by default)")
    parser.add_argument("--parallel", type=int, default=4,
                        help="Concurrent downloads (default: 4)")
    parser.add_argument("--bucket", default=None,
                        help="S3 bucket (default: $S3_BUCKET_NAME)")
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
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

    audit_df = pd.read_csv(args.audit, dtype={"username": str})
    log.info(f"Read audit.csv: {len(audit_df)} sessions")

    client = s3_client()
    user_filter = filter_set(args.usernames)
    cond_filter = filter_set(args.conditions)
    page_filter = ({int(p) for p in args.pages.split(",")} if args.pages else None)

    log.info("Listing S3 keys ...")
    targets = collect_targets(
        client, bucket, audit_df,
        user_filter, cond_filter, page_filter, args.include_unknown,
    )
    log.info(f"Found {len(targets)} webm file(s) matching filters")

    # Plan downloads (skip already-existing)
    todo = []
    for username, book_id, page, key in targets:
        local = local_path_for(args.out_dir, username, page, key)
        if local.exists() and local.stat().st_size > 0:
            continue
        todo.append((key, local))
    skipped = len(targets) - len(todo)
    log.info(f"To download: {len(todo)}  Already present: {skipped}")

    if args.dry_run:
        for key, local in todo[:20]:
            log.info(f"DRY-RUN  s3://{bucket}/{key}  →  {local}")
        if len(todo) > 20:
            log.info(f"... and {len(todo) - 20} more")
        return

    if not todo:
        log.info("Nothing to do.")
        return

    counter_lock = threading.Lock()
    counter = {"done": 0, "fail": 0}
    total = len(todo)

    def _download_one(item):
        key, local = item
        local.parent.mkdir(parents=True, exist_ok=True)
        try:
            client.download_file(bucket, key, str(local))
            ok = True
        except Exception as e:
            log.warning(f"FAIL  {key}: {e}")
            ok = False
        with counter_lock:
            if ok:
                counter["done"] += 1
            else:
                counter["fail"] += 1
            done = counter["done"] + counter["fail"]
            if done % 10 == 0 or done == total:
                log.info(f"Progress: {done}/{total}  ok={counter['done']}  fail={counter['fail']}")
        return ok

    log.info(f"Downloading with {args.parallel} parallel workers ...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.parallel) as pool:
        list(pool.map(_download_one, todo))

    log.info(f"Done. ok={counter['done']}  fail={counter['fail']}  out_dir={args.out_dir}")


if __name__ == "__main__":
    main()
