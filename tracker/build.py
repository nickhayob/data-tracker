"""Build data/history.csv from the raw files alone.

Run it with:  uv run python -m tracker.build

The result depends only on the files in data/raw/, so running it again gives the same file,
and a change to a conversion rule applies to every day of the history.
"""

import csv
import gzip
import re
from pathlib import Path

from .sources import COLUMNS, NUMERIC, SOURCES_BY_NAME

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
HISTORY_PATH = DATA_DIR / "history.csv"

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def list_raw(raw_dir: Path = RAW_DIR) -> list[tuple[str, str, Path]]:
    """All raw files as (date, source name, path), sorted. Files of unknown sources are skipped."""
    found = []
    if not raw_dir.is_dir():
        return found
    for day_dir in sorted(p for p in raw_dir.iterdir() if p.is_dir() and DATE_RE.match(p.name)):
        for path in sorted(day_dir.glob("*.gz")):
            source = path.name.split(".")[0]
            if source in SOURCES_BY_NAME:
                found.append((day_dir.name, source, path))
    return found


def convert(source: str, raw: bytes, date: str) -> list[dict]:
    """Convert one raw file (already decompressed) to rows for that date."""
    rows = SOURCES_BY_NAME[source].parse(raw)
    return [{"date": date, **row} for row in rows]


def build_history(raw_dir: Path = RAW_DIR) -> list[dict]:
    """Convert every raw file and return all rows sorted by date, then item_id."""
    rows = []
    for date, source, path in list_raw(raw_dir):
        try:
            rows.extend(convert(source, gzip.decompress(path.read_bytes()), date))
        except Exception as error:  # noqa: BLE001 - one unreadable file must not stop the build
            print(f"WARNING: could not convert {path}: {error}")
    rows.sort(key=lambda r: (r["date"], r["item_id"]))
    return rows


def format_value(column: str, value) -> str:
    if value is None or value == "":
        return ""
    if column in NUMERIC:
        return f"{float(value):.{NUMERIC[column]}f}"
    return str(value)


def write_history(rows: list[dict], path: Path = HISTORY_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        writer.writerow(COLUMNS)
        for row in rows:
            writer.writerow([format_value(col, row.get(col)) for col in COLUMNS])


def read_history(path: Path = HISTORY_PATH) -> list[dict]:
    """Read history.csv back as row dicts (numbers stay as text; empty means missing)."""
    if not path.exists():
        return []
    with open(path, newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def main() -> None:
    rows = build_history()
    write_history(rows)
    print(f"Wrote {len(rows)} rows to {HISTORY_PATH.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
