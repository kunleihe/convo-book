"""
One-time reorganization:
  - Move all xlsx from output/{user}/page-NN/ to output/{user}/
  - Create empty xlsx (with column headers) for sessions that only have a json (no turns)
  - Delete all json files
  - Remove now-empty page-NN directories
"""

import json
import shutil
import sys
from pathlib import Path

import pandas as pd

XLSX_COLUMNS = [
    "username", "condition", "page_number", "video_index", "webm_file",
    "webm_duration_sec", "turn_index", "t_start", "t_end", "speaker",
    "text", "source", "f0_median", "needs_review", "realtime_transcript",
    "ai_orphan_warning", "ai_timing_approximate",
]

OUTPUT_DIR = Path(__file__).resolve().parent / "output"


def reorganize():
    json_files = sorted(OUTPUT_DIR.rglob("*.json"))
    print(f"Found {len(json_files)} JSON files")

    moved, created, errors = 0, 0, []

    for json_path in json_files:
        user_dir = OUTPUT_DIR / json_path.parts[json_path.parts.index("output") + 1]
        dest_xlsx = user_dir / json_path.with_suffix(".xlsx").name
        src_xlsx = json_path.with_suffix(".xlsx")

        try:
            if src_xlsx.exists():
                # Move xlsx up one level (skip if already there)
                if src_xlsx != dest_xlsx:
                    shutil.move(str(src_xlsx), dest_xlsx)
                    moved += 1
            else:
                # Empty session — create xlsx with headers only
                pd.DataFrame(columns=XLSX_COLUMNS).to_excel(dest_xlsx, index=False)
                created += 1

            json_path.unlink()
        except Exception as e:
            errors.append((json_path, e))
            print(f"  ✗ {json_path}: {e}", file=sys.stderr)

    # Remove empty page-NN dirs
    removed_dirs = 0
    for d in sorted(OUTPUT_DIR.rglob("page-*"), reverse=True):
        if d.is_dir() and not any(d.iterdir()):
            d.rmdir()
            removed_dirs += 1

    print(f"Moved: {moved}  Created empty xlsx: {created}  "
          f"Removed dirs: {removed_dirs}  Errors: {len(errors)}")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    reorganize()
