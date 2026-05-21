"""
Label diarization clusters as `parent` / `child` using median F0 (fundamental frequency).

Heuristic:
    Adult voice F0 median ~100-220 Hz
    Child voice F0 median ~250-400 Hz
    The cluster with higher median F0 is `child`, the other is `parent`.
    The margin (high - low) is reported so the caller can flag low-confidence cases.

Public API:
    label_clusters(wav_path, cluster_segments, sr=16000) -> dict with:
        {
            "labels": {"SPEAKER_00": "child", "SPEAKER_01": "parent"},
            "f0_medians": {"SPEAKER_00": 312.4, "SPEAKER_01": 175.1},
            "f0_margin_hz": 137.3,
            "needs_review": False,   # True if margin < MIN_MARGIN_HZ
        }
"""

from __future__ import annotations

import logging
from typing import Iterable

import librosa
import numpy as np
import soundfile as sf

log = logging.getLogger("speaker_label")

MIN_MARGIN_HZ = 60.0          # cluster F0 difference below this → needs review
F0_FMIN = 75.0                 # below adult voice range floor
F0_FMAX = 500.0                # above child voice range ceiling
MIN_SEG_SEC = 0.4              # ignore very short segments (often false detections)


def _load_audio(wav_path: str, sr: int) -> np.ndarray:
    audio, file_sr = sf.read(wav_path, always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    if file_sr != sr:
        audio = librosa.resample(audio.astype(np.float32), orig_sr=file_sr, target_sr=sr)
    return audio.astype(np.float32)


def _segment_audio(audio: np.ndarray, sr: int, segments: Iterable[tuple[float, float]]) -> np.ndarray:
    """Concatenate audio slices for the cluster (skipping too-short segments)."""
    chunks = []
    for t_start, t_end in segments:
        if t_end - t_start < MIN_SEG_SEC:
            continue
        i0 = max(0, int(t_start * sr))
        i1 = min(len(audio), int(t_end * sr))
        if i1 > i0:
            chunks.append(audio[i0:i1])
    if not chunks:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(chunks)


def _median_f0(audio: np.ndarray, sr: int) -> float | None:
    """Estimate median F0 over voiced frames; returns None if no voiced frames found."""
    if len(audio) < sr * 0.1:
        return None
    try:
        f0, voiced_flag, _ = librosa.pyin(
            audio,
            fmin=F0_FMIN,
            fmax=F0_FMAX,
            sr=sr,
            frame_length=2048,
        )
    except Exception as e:
        log.warning(f"pyin failed: {e}")
        return None
    voiced = f0[voiced_flag]
    if len(voiced) == 0:
        return None
    return float(np.nanmedian(voiced))


def label_clusters(
    wav_path: str,
    cluster_segments: dict[str, list[tuple[float, float]]],
    sr: int = 16000,
) -> dict:
    """
    cluster_segments: {"SPEAKER_00": [(t_start, t_end), ...], "SPEAKER_01": [...]}
    Returns labels dict mapping cluster IDs to "parent" / "child".
    """
    if len(cluster_segments) == 0:
        return {"labels": {}, "f0_medians": {}, "f0_margin_hz": 0.0, "needs_review": False}

    audio = _load_audio(wav_path, sr)
    f0_medians: dict[str, float | None] = {}
    for cluster_id, segs in cluster_segments.items():
        chunk = _segment_audio(audio, sr, segs)
        f0_medians[cluster_id] = _median_f0(chunk, sr)

    # If only 1 cluster present, label it parent if F0 < 220 else child (best guess).
    if len(cluster_segments) == 1:
        cluster_id = next(iter(cluster_segments))
        f0 = f0_medians[cluster_id]
        label = "child" if (f0 is not None and f0 >= 220) else "parent"
        return {
            "labels": {cluster_id: label},
            "f0_medians": {cluster_id: f0},
            "f0_margin_hz": 0.0,
            "needs_review": f0 is None,
        }

    # 2-cluster case
    items = list(f0_medians.items())
    # Handle None F0: cluster without voiced frames is hard to label; fall back to first=parent
    if any(v is None for _, v in items):
        log.warning(f"Could not estimate F0 for some clusters: {f0_medians}")
        labels = {}
        with_f0 = [(k, v) for k, v in items if v is not None]
        without_f0 = [k for k, v in items if v is None]
        if len(with_f0) == 1:
            # Label the one we have, assume the other is the opposite role
            cluster_id, f0 = with_f0[0]
            this_label = "child" if f0 >= 220 else "parent"
            labels[cluster_id] = this_label
            labels[without_f0[0]] = "parent" if this_label == "child" else "child"
        else:
            # Neither has F0 — give arbitrary labels and flag review
            labels[items[0][0]] = "parent"
            labels[items[1][0]] = "child"
        return {
            "labels": labels,
            "f0_medians": f0_medians,
            "f0_margin_hz": 0.0,
            "needs_review": True,
        }

    # Both clusters have F0 — sort by F0 ascending: lower = parent, higher = child
    items_sorted = sorted(items, key=lambda kv: kv[1])
    parent_id, parent_f0 = items_sorted[0]
    child_id, child_f0 = items_sorted[1]
    margin = float(child_f0 - parent_f0)
    return {
        "labels": {parent_id: "parent", child_id: "child"},
        "f0_medians": f0_medians,
        "f0_margin_hz": margin,
        "needs_review": margin < MIN_MARGIN_HZ,
    }
