"""
Audit S3 data: match each user's condition from tracker.csv (ground truth).

Usage:
    python audit_legacy_variants.py [--out audit.csv] [--prefix user-data/]

Reads AWS credentials from backend/app/.env (or environment).
Condition is read from tracker.csv (id → condition). variant_overrides.yaml
can override individual users when tracker.csv is wrong or missing.
Sessions not found in either source are written to unknown_condition.txt.
"""

from __future__ import annotations

import argparse
import logging
import os
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import boto3
import pandas as pd
from botocore.config import Config
from dotenv import load_dotenv

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("audit")

USERNAME_RE = re.compile(r"^\d{4}$")
PAGE_RE = re.compile(r"^page-(\d+)$")
WEBM_RE = re.compile(r"\.webm$")

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ENV = REPO_ROOT / "backend" / "app" / ".env"
DEFAULT_TRACKER = Path(__file__).resolve().parent / "tracker.csv"


@dataclass
class SessionStats:
    username: str
    book_id: str
    pages_seen: set = field(default_factory=set)
    webm_count_per_page: dict = field(default_factory=lambda: defaultdict(int))
    total_webm: int = 0

    @property
    def max_page_reached(self) -> Optional[int]:
        return max(self.pages_seen) if self.pages_seen else None

    @property
    def multi_webm_pages(self) -> list[int]:
        return sorted(p for p, c in self.webm_count_per_page.items() if c > 1)


def load_env(env_path: Path) -> None:
    if env_path.exists():
        load_dotenv(env_path, override=False)
        log.info(f"Loaded env from {env_path}")
    else:
        log.warning(f"No .env at {env_path}; relying on system environment")


def load_tracker(path: Path) -> dict[str, str]:
    """Load tracker.csv and return {username: condition} with underscores normalized."""
    if not path.exists():
        log.warning(f"tracker.csv not found at {path}")
        return {}
    df = pd.read_csv(path, dtype={"id": str})
    result = {}
    for _, row in df.iterrows():
        uid = str(row["id"]).strip()
        cond = str(row["condition"]).strip().replace("-", "_")
        if uid and cond:
            result[uid] = cond
    log.info(f"Loaded {len(result)} entries from tracker.csv")
    return result



def s3_client():
    region = os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION")
    return boto3.client(
        "s3",
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
        region_name=region,
        config=Config(signature_version="s3v4"),
    )


def iter_all_keys(client, bucket: str, prefix: str):
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
        for obj in page.get("Contents", []) or []:
            yield obj["Key"]


def parse_key(key: str) -> Optional[tuple[str, str, int, str, str]]:
    """
    Parse `user-data/{username}/{book_id}/page-{NN}/{subdir}/{filename}`.
    Returns (username, book_id, page_number, subdir, filename) or None if not matching.
    """
    parts = key.split("/")
    if len(parts) < 6 or parts[0] != "user-data":
        return None
    username, book_id, page_part = parts[1], parts[2], parts[3]
    m = PAGE_RE.match(page_part)
    if not m:
        return None
    page_num = int(m.group(1))
    subdir = parts[4]
    filename = parts[-1]
    return username, book_id, page_num, subdir, filename


def collect_sessions(client, bucket: str, prefix: str, skipped_usernames: set) -> dict:
    sessions: dict[tuple[str, str], SessionStats] = {}
    seen_count = 0

    for key in iter_all_keys(client, bucket, prefix):
        seen_count += 1
        if seen_count % 5000 == 0:
            log.info(f"Scanned {seen_count} keys...")

        parsed = parse_key(key)
        if parsed is None:
            continue
        username, book_id, page_num, subdir, filename = parsed

        if not USERNAME_RE.match(username):
            skipped_usernames.add(username)
            continue

        sess_key = (username, book_id)
        sess = sessions.setdefault(sess_key, SessionStats(username=username, book_id=book_id))
        sess.pages_seen.add(page_num)

        if subdir == "media" and WEBM_RE.search(filename):
            sess.webm_count_per_page[page_num] += 1
            sess.total_webm += 1

    log.info(f"Done scanning. Total keys: {seen_count}")
    log.info(f"Collected {len(sessions)} (username, book_id) sessions; "
             f"skipped {len(skipped_usernames)} non-4-digit usernames")
    return sessions


def detect_condition(sess: SessionStats, tracker: dict[str, str]) -> str:
    return tracker.get(sess.username, "unknown")


def build_rows(sessions: dict, tracker: dict[str, str]) -> list[dict]:
    rows = []
    for (username, book_id), sess in sorted(sessions.items()):
        condition = detect_condition(sess, tracker)
        rows.append({
            "username": username,
            "book_id": book_id,
            "condition": condition,
            "max_page_reached": sess.max_page_reached,
            "total_webm_count": sess.total_webm,
            "multi_webm_pages": str(sess.multi_webm_pages) if sess.multi_webm_pages else "",
        })
    return rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV,
                        help="Path to .env (default: backend/app/.env)")
    parser.add_argument("--prefix", default="user-data/",
                        help="S3 prefix to scan (default: user-data/)")
    parser.add_argument("--bucket", default=None,
                        help="S3 bucket (default: from S3_BUCKET_NAME env var)")
    parser.add_argument("--tracker", type=Path, default=DEFAULT_TRACKER,
                        help="Path to tracker.csv (ground-truth condition per username)")
    parser.add_argument("--out", type=Path,
                        default=Path(__file__).resolve().parent / "audit.csv",
                        help="Output CSV path")
    parser.add_argument("--unknown-out", type=Path,
                        default=Path(__file__).resolve().parent / "unknown_condition.txt",
                        help="Output txt file listing usernames with unknown condition")
    args = parser.parse_args()

    load_env(args.env)
    bucket = args.bucket or os.environ.get("S3_BUCKET_NAME")
    if not bucket:
        log.error("S3_BUCKET_NAME not set (env or --bucket)")
        sys.exit(1)
    log.info(f"Bucket: {bucket}  Prefix: {args.prefix}")

    tracker = load_tracker(args.tracker)

    client = s3_client()
    skipped_usernames: set = set()
    sessions = collect_sessions(client, bucket, args.prefix, skipped_usernames)

    rows = build_rows(sessions, tracker)
    df = pd.DataFrame(rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(args.out, index=False, encoding="utf-8-sig")
    log.info(f"Wrote {len(df)} rows to {args.out}")

    unknown_rows = df[df["condition"] == "unknown"]
    if len(unknown_rows):
        with open(args.unknown_out, "w") as f:
            f.write("# Sessions in S3 but not found in tracker.csv.\n")
            f.write("# Add these to tracker.csv or variant_overrides.yaml manually.\n\n")
            for _, r in unknown_rows.iterrows():
                f.write(f"{r['username']}  # book_id={r['book_id']}  max_page={r['max_page_reached']}\n")
        log.info(f"Wrote {len(unknown_rows)} unknown sessions to {args.unknown_out}")
    else:
        log.info("No unknown sessions")

    summary = df["condition"].value_counts().to_dict()
    log.info(f"Condition summary: {summary}")
    if skipped_usernames:
        log.info(f"Skipped non-4-digit usernames: {sorted(skipped_usernames)[:10]}"
                 f"{'...' if len(skipped_usernames) > 10 else ''}")


if __name__ == "__main__":
    main()
