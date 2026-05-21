"""
Transcription engine abstraction.

All engines share the same interface:
    transcribe_segment(audio_path: str, language: str | None = None) -> str

Supported engines:
    - "openai-mini"  →  gpt-4o-mini-transcribe (cloud, cheap, recommended default)
    - "openai-full"  →  gpt-4o-transcribe (cloud, highest accuracy)
    - "whisper-1"    →  whisper-1 (cloud, older but supports more features)
    - "faster-whisper-local" → faster-whisper large-v3 (offline, free, requires local install)

The faster-whisper engine is lazily imported so users not using it don't need the dep.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Protocol

log = logging.getLogger("transcribe")


class TranscriptionEngine(Protocol):
    name: str
    def transcribe_segment(self, audio_path: str, language: str | None = None) -> str: ...


# ---------- OpenAI cloud engines ---------- #

class _OpenAIEngine:
    """Wraps OpenAI Audio Transcriptions API."""

    def __init__(self, model: str):
        from openai import OpenAI
        self.name = model
        self.model = model
        self.client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))

    def transcribe_segment(self, audio_path: str, language: str | None = None) -> str:
        # gpt-4o-(mini-)transcribe supports `language` (ISO 639-1) and `prompt` hints.
        # Don't force a language for mixed Chinese/English — let the model detect.
        with open(audio_path, "rb") as f:
            kwargs = {"model": self.model, "file": f, "response_format": "text"}
            if language:
                kwargs["language"] = language
            try:
                resp = self.client.audio.transcriptions.create(**kwargs)
            except Exception as e:
                log.warning(f"OpenAI transcribe failed for {audio_path}: {e}")
                return ""
        # response_format=text → resp is a string
        return str(resp).strip()


# ---------- Local faster-whisper engine ---------- #

class _FasterWhisperEngine:
    name = "faster-whisper-large-v3"
    _model = None

    def __init__(self, model_size: str = "large-v3", device: str = "auto", compute_type: str = "int8"):
        from faster_whisper import WhisperModel
        self.name = f"faster-whisper-{model_size}"
        if _FasterWhisperEngine._model is None:
            log.info(f"Loading faster-whisper model {model_size} (device={device}, compute_type={compute_type})")
            _FasterWhisperEngine._model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.model = _FasterWhisperEngine._model

    def transcribe_segment(self, audio_path: str, language: str | None = None) -> str:
        segments, _ = self.model.transcribe(audio_path, language=language, beam_size=5)
        return " ".join(seg.text.strip() for seg in segments).strip()


def get_engine(engine_name: str) -> TranscriptionEngine:
    if engine_name == "openai-mini":
        return _OpenAIEngine("gpt-4o-mini-transcribe")
    if engine_name == "openai-full":
        return _OpenAIEngine("gpt-4o-transcribe")
    if engine_name == "whisper-1":
        return _OpenAIEngine("whisper-1")
    if engine_name == "faster-whisper-local":
        return _FasterWhisperEngine()
    raise ValueError(f"Unknown engine: {engine_name}")


# ---------- Helper: extract a segment from a wav with overlap padding ---------- #

def extract_segment(
    wav_path: str,
    out_path: str,
    t_start: float,
    t_end: float,
    overlap_sec: float = 1.5,
) -> tuple[float, float]:
    """
    Cut [t_start - overlap, t_end + overlap] from wav_path, write to out_path.
    Returns the actual (cut_start, cut_end) in original wav coordinates so the caller
    knows the padding applied.
    """
    import soundfile as sf
    import numpy as np

    audio, sr = sf.read(wav_path, always_2d=False)
    if audio.ndim > 1:
        audio = audio.mean(axis=1)
    duration = len(audio) / sr
    cut_start = max(0.0, t_start - overlap_sec)
    cut_end = min(duration, t_end + overlap_sec)
    i0 = int(cut_start * sr)
    i1 = int(cut_end * sr)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    sf.write(out_path, audio[i0:i1].astype(np.float32), sr, subtype="PCM_16")
    return cut_start, cut_end
