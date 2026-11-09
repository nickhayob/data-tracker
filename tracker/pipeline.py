"""The daily run:  uv run python -m tracker.pipeline

1. call every source and save its raw response (compressed) to data/raw/<date>/<source>.<format>.gz
2. build data/history.csv from the raw files
3. write data/status.json
4. open (or update) today's GitHub Issue and close the previous ones
The workflow then commits data/ to the repository.
"""

import gzip
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path

from . import build, issues
from .moves import compare
from .sources import SOURCES

ROOT = build.ROOT


def run(now: datetime | None = None, fetch=None, root: Path = ROOT, publish: bool = True, sources=SOURCES) -> dict:
    """Do one run and return the status dict. ``fetch(source) -> bytes`` can replace the network (tests)."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    date = now.strftime("%Y-%m-%d")  # every run uses the UTC date of the moment it runs
    fetch = fetch or (lambda source: source.fetch())
    data_dir = root / "data"
    raw_dir = data_dir / "raw"

    # 1. Call every source. A second run on the same day replaces that day's raw files.
    day_dir = raw_dir / date
    if day_dir.exists():
        shutil.rmtree(day_dir)
    results = []
    for source in sources:
        try:
            body = fetch(source)
            count = len(source.parse(body))  # make sure the response really holds data
            if count == 0:
                raise ValueError("response held no usable rows")
            day_dir.mkdir(parents=True, exist_ok=True)
            # mtime=0 keeps the bytes identical for identical responses
            (day_dir / f"{source.name}.{source.format}.gz").write_bytes(gzip.compress(body, mtime=0))
            results.append({"name": source.name, "ok": True, "count": count})
        except Exception as error:  # noqa: BLE001 - one failing source must not stop the run
            print(f"Source {source.name} FAILED: {error}")
            results.append({"name": source.name, "ok": False, "count": 0})  # no raw file is written

    # 2. Build the history from the raw files alone.
    rows = build.build_history(raw_dir)
    build.write_history(rows, data_dir / "history.csv")

    # 3. Status file.
    previous_dates = sorted({r["date"] for r in rows if r["date"] < date})
    previous_date = previous_dates[-1] if previous_dates else None
    today_rows = [r for r in rows if r["date"] == date]
    comparison = compare([r for r in rows if r["date"] == previous_date], today_rows) if previous_date else \
        {"new": [], "gone": [], "moves": []}
    raw_dates = sorted({d for d, _, _ in build.list_raw(raw_dir)})
    status = {
        "run_time": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "first_run_date": raw_dates[0] if raw_dates else None,
        "days_with_success": len(raw_dates),
        "items": len(today_rows),
        "new_today": comparison["new"],
        "gone_today": comparison["gone"],
        "sources": results,
    }
    (data_dir / "status.json").write_text(json.dumps(status, indent=2) + "\n", encoding="utf-8")

    # 4. Today's issue (every day, even a day with no changes).
    if publish:
        issues.publish_from_env(issues.issue_title(date), issues.issue_body(date, previous_date, comparison, status))
    return status


def main() -> None:
    status = run()
    print(json.dumps(status, indent=2))


if __name__ == "__main__":
    main()
