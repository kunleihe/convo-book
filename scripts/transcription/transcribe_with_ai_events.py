"""
Transcribe one page of one session with AI events (has events.json + AI audio mixed in webm).

Flow:
    1. List S3 to find all webm + events.json for this (user, book, page)
    2. For each webm:
        a. Download + decode duration via ffprobe
        b. Convert webm → 16kHz mono wav (ffmpeg)
        c. Read events.json: extract ai_tts_start/end intervals + AI text
        d. Replace AI intervals with silence in wav → diarize only parent/child
        e. F0-label clusters as parent/child
        f. Transcribe each diarization segment via OpenAI
        g. Merge AI turns (from events.json text) back into timeline
        h. Write xlsx

Usage:
    python transcribe_page.py \
        --username 7102 --book-id speed-racer --page 2 \
        --condition parent_ai --engine openai-full
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
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

import boto3
import numpy as np
import pandas as pd
import soundfile as sf
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
SEG_OVERLAP_SEC = 0.3
MIN_SEG_DURATION = 0.4
MERGE_GAP_SEC = 1.0
OPENAI_CONCURRENCY = 10


@dataclass
class Turn:
    t_start: float
    t_end: float
    speaker: str          # "parent" | "child" | "ai"
    text: str
    source: str
    f0_median: Optional[float] = None
    realtime_transcript: Optional[str] = None
    ai_orphan_warning: bool = False


@dataclass
class AttemptResult:
    username: str
    book_id: str
    page_number: int
    condition: str
    video_index: int
    webm_file: str
    webm_duration_sec: float
    recording_started_at: Optional[str]
    f0_margin_hz: float
    needs_review: bool
    legacy: bool = False
    turns: list[Turn] = field(default_factory=list)


# ---------- AWS / S3 helpers (shared with transcribe_legacy_page) ---------- #

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


def silence_intervals(wav_path: Path, intervals: list[tuple[float, float]], sr: int = 16000) -> Path:
    """Return a new wav with the given time intervals replaced by silence."""
    audio, file_sr = sf.read(str(wav_path), dtype="int16")
    if file_sr != sr:
        raise ValueError(f"Expected {sr} Hz, got {file_sr} Hz")
    for t0, t1 in intervals:
        s0 = int(t0 * sr)
        s1 = min(int(t1 * sr), len(audio))
        if s0 < s1:
            audio[s0:s1] = 0
    out = wav_path.with_stem(wav_path.stem + "_no_ai")
    sf.write(str(out), audio, sr, subtype="PCM_16")
    return out


# ---------- Diarization (shared logic) ---------- #

_DIARIZER = None


def get_diarizer():
    global _DIARIZER
    if _DIARIZER is None:
        from pyannote.audio import Pipeline
        import torch

        token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_TOKEN")
        if not token:
            raise RuntimeError(
                "Set HF_TOKEN env var to your HuggingFace access token."
            )

        device_pref = os.environ.get("PYANNOTE_DEVICE", "auto").lower()
        if device_pref == "auto":
            if torch.cuda.is_available():
                device = torch.device("cuda")
            elif torch.backends.mps.is_available():
                os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
                device = torch.device("mps")
            else:
                device = torch.device("cpu")
        else:
            device = torch.device(device_pref)

        log.info(f"Loading pyannote/speaker-diarization-3.1 on {device} ...")
        try:
            _DIARIZER = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", token=token)
        except TypeError:
            _DIARIZER = Pipeline.from_pretrained("pyannote/speaker-diarization-3.1", use_auth_token=token)
        try:
            _DIARIZER.to(device)
        except Exception as e:
            log.warning(f"Could not move diarizer to {device}: {e}; staying on CPU")
    return _DIARIZER


def merge_adjacent_segments(
    clusters: dict[str, list[tuple[float, float]]],
    max_gap: float = MERGE_GAP_SEC,
) -> dict[str, list[tuple[float, float]]]:
    merged: dict[str, list[tuple[float, float]]] = {}
    for speaker, segs in clusters.items():
        sorted_segs = sorted(segs)
        out: list[tuple[float, float]] = []
        for t0, t1 in sorted_segs:
            if out and t0 - out[-1][1] <= max_gap:
                out[-1] = (out[-1][0], t1)
            else:
                out.append((t0, t1))
        merged[speaker] = out
    return merged


def diarize(wav: Path, min_speakers: int = 1, max_speakers: int = 2) -> dict[str, list[tuple[float, float]]]:
    pipeline = get_diarizer()
    result = pipeline(str(wav), min_speakers=min_speakers, max_speakers=max_speakers)
    if hasattr(result, "speaker_diarization"):
        annotation = result.speaker_diarization
    elif hasattr(result, "itertracks"):
        annotation = result
    else:
        raise RuntimeError(f"Unexpected pyannote output type: {type(result)}")

    clusters: dict[str, list[tuple[float, float]]] = {}
    for turn, _, speaker in annotation.itertracks(yield_label=True):
        if turn.end - turn.start < MIN_SEG_DURATION:
            continue
        clusters.setdefault(speaker, []).append((float(turn.start), float(turn.end)))
    return clusters


# ---------- events.json parsing ---------- #

def load_events(client, bucket: str, page_prefix: str, cache_dir: Path) -> list[dict]:
    """Load all events JSON files for this page, return merged event lists."""
    events_keys = list_keys(client, bucket, page_prefix + "events/")
    all_events = []
    for k in sorted(events_keys):
        local = cache_dir / "events" / Path(k).name
        download_to(client, bucket, k, local)
        with open(local) as f:
            data = json.load(f)
        all_events.append(data)
    return all_events


def extract_ai_intervals_from_events(
    events_list: list[dict],
) -> list[tuple[float, float, str]]:
    """
    From events data, return list of (t_start, t_end, text) for AI TTS intervals.
    Matches ai_tts_start with the next ai_tts_end.
    """
    intervals: list[tuple[float, float, str]] = []
    for events_data in events_list:
        evs = events_data.get("events", [])
        pending_start: Optional[tuple[float, str]] = None
        for ev in evs:
            if ev["type"] == "ai_tts_start":
                pending_start = (ev["t"], ev.get("text", ""))
            elif ev["type"] == "ai_tts_end" and pending_start is not None:
                intervals.append((pending_start[0], ev["t"], pending_start[1]))
                pending_start = None
    return intervals


# ---------- Per-attempt pipeline ---------- #

def transcribe_attempt(
    *, client, bucket: str, username: str, book_id: str, page: int,
    condition: str, video_index: int, webm_key: str,
    cache_dir: Path, engine_name: str, language: Optional[str],
    events_list: list[dict],
) -> AttemptResult:
    webm_filename = Path(webm_key).name
    webm_local = cache_dir / "webm" / webm_filename
    download_to(client, bucket, webm_key, webm_local)
    wav_local = cache_dir / "wav" / (webm_local.stem + ".wav")
    webm_to_wav(webm_local, wav_local)

    duration = ffprobe_duration(wav_local)
    log.info(f"[video {video_index}] {webm_filename}  duration={duration:.1f}s")

    # Recording start from events.json (exact wall-clock time)
    recording_started_at = None
    for ed in events_list:
        if ed.get("recording_started_at"):
            recording_started_at = ed["recording_started_at"]
            break

    # 1) Extract AI intervals from events.json
    ai_intervals = extract_ai_intervals_from_events(events_list)
    log.info(f"[video {video_index}] {len(ai_intervals)} AI TTS interval(s) from events.json")

    # 2) Replace AI intervals with silence → cleaner diarization
    wav_for_diarize = wav_local
    if ai_intervals and condition == "parent_ai":
        wav_for_diarize = silence_intervals(wav_local, [(t0, t1) for t0, t1, _ in ai_intervals])
        log.info(f"[video {video_index}] Silenced AI intervals in wav for diarization")

    # 3) Diarize on the silenced wav
    max_speakers = 2
    log.info(f"[video {video_index}] Diarizing (min_speakers=1, max_speakers={max_speakers}) ...")
    clusters = diarize(wav_for_diarize, min_speakers=1, max_speakers=max_speakers)
    pre_counts = {s: len(v) for s, v in clusters.items()}
    clusters = merge_adjacent_segments(clusters)
    post_counts = {s: len(v) for s, v in clusters.items()}
    if pre_counts != post_counts:
        log.info(f"[video {video_index}] Merged segments: {pre_counts} → {post_counts}")

    if not clusters:
        log.warning(f"[video {video_index}] No speech detected in {webm_filename}")
        return AttemptResult(
            username=username, book_id=book_id, page_number=page, condition=condition,
            video_index=video_index, webm_file=webm_filename,
            webm_duration_sec=duration,
            recording_started_at=recording_started_at,
            f0_margin_hz=0.0, needs_review=True,
        )

    # 4) F0-label clusters
    label_result = label_clusters(str(wav_local), clusters)
    cluster_to_role = label_result["labels"]
    f0_medians = label_result["f0_medians"]
    log.info(f"[video {video_index}] F0 labels: {cluster_to_role}  medians={f0_medians}")

    # 5) Transcribe each segment (parallel API calls)
    engine = get_engine(engine_name)
    seg_dir = cache_dir / "segments" / f"video-{video_index}"

    tasks = []
    for cluster_id, segs in clusters.items():
        role = cluster_to_role.get(cluster_id, "unknown")
        if role == "unknown":
            continue
        for i, (t0, t1) in enumerate(segs):
            seg_path = seg_dir / f"{cluster_id}_{i:03d}.wav"
            extract_segment(str(wav_local), str(seg_path), t0, t1, overlap_sec=SEG_OVERLAP_SEC)
            tasks.append({"cluster_id": cluster_id, "role": role, "t0": t0, "t1": t1, "seg_path": seg_path})

    def _transcribe_one(task):
        try:
            text = engine.transcribe_segment(str(task["seg_path"]), language=language)
        except Exception as e:
            log.warning(f"Transcribe failed for {task['seg_path']}: {e}")
            text = ""
        return task, text

    user_turns: list[Turn] = []
    log.info(f"[video {video_index}] Transcribing {len(tasks)} segments (concurrency={OPENAI_CONCURRENCY}) ...")
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

    # 6) Insert AI turns from events.json (precise timestamps, ground-truth text)
    all_turns: list[Turn] = list(user_turns)
    if condition == "parent_ai":
        for t0, t1, text in ai_intervals:
            if text:
                all_turns.append(Turn(
                    t_start=t0, t_end=t1,
                    speaker="ai", text=text,
                    source="events.json",
                ))

    all_turns.sort(key=lambda t: t.t_start)

    return AttemptResult(
        username=username, book_id=book_id, page_number=page, condition=condition,
        video_index=video_index, webm_file=webm_filename,
        webm_duration_sec=duration,
        recording_started_at=recording_started_at,
        f0_margin_hz=label_result["f0_margin_hz"],
        needs_review=label_result["needs_review"],
        turns=all_turns,
    )


# ---------- Output writer ---------- #

def write_attempt_outputs(result: AttemptResult, out_dir: Path) -> None:
    user_dir = out_dir / result.username
    user_dir.mkdir(parents=True, exist_ok=True)
    stem = Path(result.webm_file).stem
    base = (
        f"{result.username}_{result.condition}_page-{result.page_number:02d}"
        f"_video-{result.video_index}__{stem}"
    )
    xlsx_path = user_dir / f"{base}.xlsx"

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
            "ai_timing_approximate": False,
        })
    columns = [
        "username", "condition", "page_number", "video_index", "webm_file",
        "webm_duration_sec", "turn_index", "t_start", "t_end", "speaker",
        "text", "source", "f0_median", "needs_review", "realtime_transcript",
        "ai_orphan_warning", "ai_timing_approximate",
    ]
    pd.DataFrame(rows, columns=columns).to_excel(xlsx_path, index=False)
    log.info(f"Wrote {xlsx_path.name} ({len(result.turns)} turns)")


# ---------- Reusable per-page entry point ---------- #

def run_page(
    *, client, bucket: str, username: str, book_id: str, page: int,
    condition: str, engine_name: str = "openai-full",
    language: Optional[str] = None,
    out_dir: Path = DEFAULT_OUT_DIR,
    cache_dir_root: Path = DEFAULT_CACHE_DIR,
) -> int:
    page_prefix = f"user-data/{username}/{book_id}/page-{page:02d}/"
    cache_dir = cache_dir_root / username / book_id / f"page-{page:02d}"

    media_keys = list_keys(client, bucket, page_prefix + "media/")
    webm_keys = sorted([k for k in media_keys if k.endswith(".webm")],
                       key=lambda k: Path(k).name)
    if not webm_keys:
        log.warning(f"No webm files at {page_prefix}media/")
        return 0

    events_list = load_events(client, bucket, page_prefix, cache_dir)
    if not events_list:
        log.warning(f"No events.json found at {page_prefix}events/ — use transcribe_legacy_page.py instead")
        return 0

    log.info(f"Found {len(webm_keys)} webm + {len(events_list)} events file(s) for {username}/{book_id}/page-{page}")

    processed = 0
    for video_idx, webm_key in enumerate(webm_keys, start=1):
        try:
            result = transcribe_attempt(
                client=client, bucket=bucket,
                username=username, book_id=book_id, page=page,
                condition=condition, video_index=video_idx,
                webm_key=webm_key, cache_dir=cache_dir,
                engine_name=engine_name, language=language,
                events_list=events_list,
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
    parser.add_argument("--language", default=None)
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
