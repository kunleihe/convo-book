"""
Transcribe one page of one session from legacy data (no events.json, no AI in webm).

Flow:
    1. List S3 to find all webm + conversations for this (user, book, page)
    2. For each webm:
        a. Download + decode duration via ffprobe
        b. Compute recording_start ≈ filename_ts - webm_duration
        c. Convert webm → 16kHz mono wav (ffmpeg)
        d. Run pyannote diarization (num_speakers depends on condition)
        e. F0-label clusters as parent/child
        f. Extract each diarization segment (with overlap), transcribe via OpenAI
        g. For parent_ai: insert AI turns by timestamp from conversations/*.json
        h. Write JSON + CSV
Usage:
    python transcribe_legacy_page.py \
        --username 7102 --book-id speed-racer --page 2 \
        --condition parent_ai --engine openai-mini
"""

from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import logging
import os
import re
import subprocess
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import boto3
import pandas as pd
from botocore.config import Config
from dotenv import load_dotenv

from openai_transcribe import extract_segment, get_engine
from speaker_label import label_clusters

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("transcribe")

REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_ENV = REPO_ROOT / "backend" / "app" / ".env"
SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_OUT_DIR = SCRIPT_DIR / "output"
DEFAULT_CACHE_DIR = SCRIPT_DIR / ".cache"

WEBM_NAME_RE = re.compile(
    r"^(?P<ts>\d{8}-\d{6})-(?P<stage>[^-]+)-(?P<uid>[A-Fa-f0-9]+)\.webm$"
)
SEG_OVERLAP_SEC = 1.5
MIN_SEG_DURATION = 0.4
OPENAI_CONCURRENCY = 10   # parallel API calls per webm


@dataclass
class Turn:
    t_start: float
    t_end: float
    speaker: str          # "parent" | "child" | "ai"
    text: str
    source: str           # "openai-mini" | "conversations.json" | ...
    f0_median: Optional[float] = None
    realtime_transcript: Optional[str] = None
    ai_orphan_warning: bool = False
    ai_timing_approximate: bool = False


@dataclass
class AttemptResult:
    username: str
    book_id: str
    page_number: int
    condition: str
    video_index: int
    webm_file: str
    webm_duration_sec: float
    recording_start_iso: str
    recording_end_iso: str
    f0_margin_hz: float
    needs_review: bool
    legacy: bool = True
    turns: list[Turn] = field(default_factory=list)


# ---------- AWS / S3 helpers ---------- #

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


def download_to(client, bucket: str, key: str, local: Path) -> Path:
    local.parent.mkdir(parents=True, exist_ok=True)
    if local.exists() and local.stat().st_size > 0:
        return local
    log.debug(f"Downloading s3://{bucket}/{key} → {local}")
    client.download_file(bucket, key, str(local))
    return local


# ---------- Audio utilities ---------- #

def ffprobe_duration(path: Path) -> float:
    out = subprocess.check_output([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ])
    return float(out.decode().strip())


def webm_to_wav(webm: Path, wav: Path, sr: int = 16000) -> None:
    wav.parent.mkdir(parents=True, exist_ok=True)
    if wav.exists() and wav.stat().st_size > 0:
        return
    subprocess.check_call([
        "ffmpeg", "-y", "-i", str(webm), "-ac", "1", "-ar", str(sr),
        "-vn", "-c:a", "pcm_s16le", str(wav),
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def parse_filename_ts(name: str) -> dt.datetime:
    """Parse `20260324-204700` from the webm filename → naive datetime (UTC assumed)."""
    m = WEBM_NAME_RE.match(name)
    if not m:
        raise ValueError(f"Unrecognized webm filename: {name}")
    ts_str = m.group("ts")
    return dt.datetime.strptime(ts_str, "%Y%m%d-%H%M%S").replace(tzinfo=dt.timezone.utc)


# ---------- Diarization ---------- #

_DIARIZER = None


def get_diarizer():
    global _DIARIZER
    if _DIARIZER is None:
        from pyannote.audio import Pipeline
        import torch

        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
        if not token:
            raise RuntimeError(
                "Set HF_TOKEN env var to your HuggingFace access token. "
                "Also accept terms at https://hf.co/pyannote/speaker-diarization-3.1"
            )

        device_pref = os.environ.get("PYANNOTE_DEVICE", "auto").lower()
        if device_pref == "auto":
            if torch.cuda.is_available():
                device = torch.device("cuda")
            elif torch.backends.mps.is_available():
                # Allow unsupported MPS ops to fall back to CPU instead of crashing
                os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
                device = torch.device("mps")
            else:
                device = torch.device("cpu")
        else:
            device = torch.device(device_pref)

        log.info(f"Loading pyannote/speaker-diarization-3.1 on {device} ...")
        try:
            # pyannote.audio >= 3.3 uses `token`
            _DIARIZER = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=token)
        except TypeError:
            # older versions use `use_auth_token`
            _DIARIZER = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=token)
        try:
            _DIARIZER.to(device)
            log.info(f"Diarizer moved to {device}")
        except Exception as e:
            log.warning(f"Could not move diarizer to {device}: {e}; staying on CPU")
    return _DIARIZER


def diarize(wav: Path, num_speakers: int) -> dict[str, list[tuple[float, float]]]:
    """Return {speaker_label: [(t_start, t_end), ...]}."""
    pipeline = get_diarizer()
    result = pipeline(str(wav), num_speakers=num_speakers)
    # pyannote 4.x returns DiarizeOutput; older versions return an Annotation directly.
    if hasattr(result, "speaker_diarization"):
        annotation = result.speaker_diarization
    elif hasattr(result, "itertracks"):
        annotation = result
    else:
        raise RuntimeError(f"Unexpected pyannote output type: {type(result)} (attrs: {dir(result)})")

    clusters: dict[str, list[tuple[float, float]]] = {}
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        if turn.end - turn.start < MIN_SEG_DURATION:
            continue
        clusters.setdefault(speaker, []).append((float(turn.start), float(turn.end)))
    return clusters


# ---------- AI turns from conversations.json ---------- #

def load_ai_turns_from_conversations(
    client, bucket: str, page_prefix: str, cache_dir: Path,
) -> list[dict]:
    """Returns AI conversation entries with iso timestamps."""
    conv_prefix = page_prefix + "conversations/"
    keys = list_keys(client, bucket, conv_prefix)
    ai_keys = [k for k in keys if "-ai-" in Path(k).name]
    turns = []
    for k in ai_keys:
        local = cache_dir / "conversations" / Path(k).name
        download_to(client, bucket, k, local)
        with open(local) as f:
            data = json.load(f)
        if data.get("sender") != "ai":
            continue
        turns.append(data)
    return turns


def parse_iso_ts(ts: str) -> dt.datetime:
    # Accept formats like "2026-03-24T20:46:14.130792" (no tz) or with offset
    out = dt.datetime.fromisoformat(ts)
    if out.tzinfo is None:
        out = out.replace(tzinfo=dt.timezone.utc)
    return out


# ---------- Per-attempt pipeline ---------- #

def transcribe_attempt(
    *, client, bucket: str, username: str, book_id: str, page: int,
    condition: str, video_index: int, webm_key: str,
    cache_dir: Path, engine_name: str, language: Optional[str],
    ai_turns_meta: list[dict],
) -> AttemptResult:
    webm_filename = Path(webm_key).name
    webm_ts = parse_filename_ts(webm_filename)

    webm_local = cache_dir / "webm" / webm_filename
    download_to(client, bucket, webm_key, webm_local)
    wav_local = cache_dir / "wav" / (webm_local.stem + ".wav")
    webm_to_wav(webm_local, wav_local)

    duration = ffprobe_duration(wav_local)
    recording_end = webm_ts                             # ≈ upload time
    recording_start = recording_end - dt.timedelta(seconds=duration)
    log.info(
        f"[video {video_index}] {webm_filename}  duration={duration:.1f}s  "
        f"start≈{recording_start.isoformat()}  end≈{recording_end.isoformat()}"
    )

    # 1) Diarize
    num_speakers = 1 if condition == "ai_only" else 2
    log.info(f"[video {video_index}] Diarizing (num_speakers={num_speakers}) ...")
    clusters = diarize(wav_local, num_speakers=num_speakers)
    if not clusters:
        log.warning(f"[video {video_index}] No speech detected in {webm_filename}")
        return AttemptResult(
            username=username, book_id=book_id, page_number=page, condition=condition,
            video_index=video_index, webm_file=webm_filename,
            webm_duration_sec=duration,
            recording_start_iso=recording_start.isoformat(),
            recording_end_iso=recording_end.isoformat(),
            f0_margin_hz=0.0, needs_review=True,
        )

    # 2) F0 label clusters
    label_result = label_clusters(str(wav_local), clusters)
    cluster_to_role = label_result["labels"]
    f0_medians = label_result["f0_medians"]
    log.info(f"[video {video_index}] F0 labels: {cluster_to_role}  medians={f0_medians}")

    # 3) Transcribe each segment (parallel API calls)
    engine = get_engine(engine_name)
    seg_dir = cache_dir / "segments" / f"video-{video_index}"

    # 3a) First extract all segment wav files (fast, sequential)
    tasks = []  # list of dicts: cluster_id, role, t0, t1, seg_path
    for cluster_id, segs in clusters.items():
        role = cluster_to_role.get(cluster_id, "unknown")
        if role == "unknown":
            continue
        for i, (t0, t1) in enumerate(segs):
            seg_path = seg_dir / f"{cluster_id}_{i:03d}.wav"
            extract_segment(str(wav_local), str(seg_path), t0, t1, overlap_sec=SEG_OVERLAP_SEC)
            tasks.append({
                "cluster_id": cluster_id, "role": role,
                "t0": t0, "t1": t1, "seg_path": seg_path,
            })

    # 3b) Transcribe in parallel
    def _transcribe_one(task):
        try:
            text = engine.transcribe_segment(str(task["seg_path"]), language=language)
        except Exception as e:
            log.warning(f"Transcribe failed for {task['seg_path']}: {e}")
            text = ""
        return task, text

    user_turns: list[Turn] = []
    log.info(f"[video {video_index}] Transcribing {len(tasks)} segments "
             f"(concurrency={OPENAI_CONCURRENCY}) ...")
    with concurrent.futures.ThreadPoolExecutor(max_workers=OPENAI_CONCURRENCY) as pool:
        for task, text in pool.map(_transcribe_one, tasks):
            if not text:
                continue
            user_turns.append(Turn(
                t_start=task["t0"], t_end=task["t1"],
                speaker=task["role"], text=text,
                source=engine.name,
                f0_median=f0_medians.get(task["cluster_id"]),
            ))

    # 4) Insert AI turns (parent_ai only; from conversations.json, timing approximate)
    ai_user_turns: list[Turn] = list(user_turns)
    if condition == "parent_ai":
        for ai_msg in ai_turns_meta:
            text = (ai_msg.get("text") or "").strip()
            if not text:
                continue
            ts_str = ai_msg.get("timestamp") or ai_msg.get("client_timestamp")
            if not ts_str:
                continue
            try:
                ai_ts = parse_iso_ts(ts_str)
            except Exception:
                continue
            # Check if AI msg falls within this attempt's recording window
            if ai_ts < recording_start or ai_ts > recording_end:
                continue
            offset = (ai_ts - recording_start).total_seconds()
            ai_user_turns.append(Turn(
                t_start=offset, t_end=offset + max(2.0, len(text) * 0.07),
                speaker="ai", text=text,
                source="conversations.json",
                ai_timing_approximate=True,
            ))

    ai_user_turns.sort(key=lambda t: t.t_start)

    return AttemptResult(
        username=username, book_id=book_id, page_number=page, condition=condition,
        video_index=video_index, webm_file=webm_filename,
        webm_duration_sec=duration,
        recording_start_iso=recording_start.isoformat(),
        recording_end_iso=recording_end.isoformat(),
        f0_margin_hz=label_result["f0_margin_hz"],
        needs_review=label_result["needs_review"],
        turns=ai_user_turns,
    )


# ---------- Output writers ---------- #

def write_attempt_outputs(result: AttemptResult, out_dir: Path) -> None:
    page_dir = out_dir / result.username / f"page-{result.page_number:02d}"
    page_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(result.webm_file).stem
    base = (
        f"{result.username}_{result.condition}_page-{result.page_number:02d}"
        f"_video-{result.video_index}__{stem}"
    )
    json_path = page_dir / f"{base}.json"
    csv_path = page_dir / f"{base}.csv"

    json_path.write_text(json.dumps({
        **{k: v for k, v in asdict(result).items() if k != "turns"},
        "turns": [asdict(t) for t in result.turns],
    }, indent=2, ensure_ascii=False))

    rows = []
    for idx, t in enumerate(result.turns):
        rows.append({
            "username": result.username,
            "condition": result.condition,
            "page_number": result.page_number,
            "video_index": result.video_index,
            "webm_file": result.webm_file,
            "webm_duration_sec": round(result.webm_duration_sec, 2),
            "turn_index": idx,
            "t_start": round(t.t_start, 2),
            "t_end": round(t.t_end, 2),
            "speaker": t.speaker,
            "text": t.text,
            "source": t.source,
            "f0_median": t.f0_median,
            "needs_review": result.needs_review,
            "realtime_transcript": t.realtime_transcript or "",
            "ai_orphan_warning": t.ai_orphan_warning,
            "ai_timing_approximate": t.ai_timing_approximate,
        })
    pd.DataFrame(rows).to_csv(csv_path, index=False, encoding="utf-8-sig")
    log.info(f"Wrote {json_path.name} ({len(result.turns)} turns)")


# ---------- Reusable per-page entry point ---------- #

def run_page(
    *, client, bucket: str, username: str, book_id: str, page: int,
    condition: str, engine_name: str = "openai-full",
    language: Optional[str] = None,
    out_dir: Path = DEFAULT_OUT_DIR,
    cache_dir_root: Path = DEFAULT_CACHE_DIR,
) -> int:
    """
    Transcribe one page. Returns number of attempts processed (>=0). Skips silently
    if there are no webm files. All exceptions per-attempt are caught and logged.
    """
    page_prefix = f"user-data/{username}/{book_id}/page-{page:02d}/"
    cache_dir = cache_dir_root / username / book_id / f"page-{page:02d}"

    media_keys = list_keys(client, bucket, page_prefix + "media/")
    webm_keys = sorted([k for k in media_keys if k.endswith(".webm")],
                       key=lambda k: Path(k).name)
    if not webm_keys:
        log.warning(f"No webm files at {page_prefix}media/")
        return 0
    log.info(f"Found {len(webm_keys)} webm file(s) for {username}/{book_id}/page-{page}")

    ai_turns_meta = []
    if condition == "parent_ai":
        ai_turns_meta = load_ai_turns_from_conversations(client, bucket, page_prefix, cache_dir)
        log.info(f"Found {len(ai_turns_meta)} AI conversation entries")

    processed = 0
    for video_idx, webm_key in enumerate(webm_keys, start=1):
        try:
            result = transcribe_attempt(
                client=client, bucket=bucket,
                username=username, book_id=book_id, page=page,
                condition=condition, video_index=video_idx,
                webm_key=webm_key, cache_dir=cache_dir,
                engine_name=engine_name, language=language,
                ai_turns_meta=ai_turns_meta,
            )
            write_attempt_outputs(result, out_dir)
            processed += 1
        except Exception as e:
            log.exception(f"Failed attempt {video_idx} ({Path(webm_key).name}): {e}")
    return processed


# ---------- CLI Main ---------- #

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--username", required=True)
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--condition", required=True,
                        choices=["parent_ai", "parent_only", "ai_only"])
    parser.add_argument("--engine", default="openai-full",
                        choices=["openai-mini", "openai-full", "whisper-1", "faster-whisper-local"])
    parser.add_argument("--language", default=None,
                        help="Language hint, e.g. 'zh' or 'en'. Leave unset for auto-detect.")
    parser.add_argument("--bucket", default=None)
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--cache-dir", type=Path, default=DEFAULT_CACHE_DIR)
    args = parser.parse_args()

    load_env(args.env)
    bucket = args.bucket or os.environ.get("S3_BUCKET_NAME")
    if not bucket:
        log.error("S3_BUCKET_NAME not set")
        sys.exit(1)

    client = s3_client()
    run_page(
        client=client, bucket=bucket,
        username=args.username, book_id=args.book_id, page=args.page,
        condition=args.condition, engine_name=args.engine,
        language=args.language, out_dir=args.out_dir, cache_dir_root=args.cache_dir,
    )


if __name__ == "__main__":
    main()
