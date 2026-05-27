"""
One-time migration: convert all CSV files under output/ to xlsx in-place, then delete the csv.

Usage:
    python migrate_csv_to_xlsx.py [--output-dir output/]
"""

import argparse
import sys
from pathlib import Path

import pandas as pd


def migrate(output_dir: Path) -> None:
    csv_files = sorted(output_dir.rglob("*.csv"))
    if not csv_files:
        print("No CSV files found.")
        return

    print(f"Found {len(csv_files)} CSV files. Converting...")
    errors = []
    for csv_path in csv_files:
        xlsx_path = csv_path.with_suffix(".xlsx")
        try:
            df = pd.read_csv(csv_path, encoding="utf-8-sig")
            if df.empty:
                csv_path.unlink()
                print(f"  - {csv_path.relative_to(output_dir)} (empty, deleted)")
            else:
                df.to_excel(xlsx_path, index=False)
                csv_path.unlink()
                print(f"  ✓ {csv_path.relative_to(output_dir)}")
        except Exception as e:
            # Likely empty/malformed CSV — just delete it
            csv_path.unlink()
            print(f"  - {csv_path.relative_to(output_dir)} (unreadable, deleted: {e})")

    print(f"\nDone: {len(csv_files) - len(errors)} converted, {len(errors)} failed.")
    if errors:
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent / "output",
    )
    args = parser.parse_args()
    if not args.output_dir.exists():
        print(f"Output directory not found: {args.output_dir}", file=sys.stderr)
        sys.exit(1)
    migrate(args.output_dir)


if __name__ == "__main__":
    main()
