"""Write assets/airports.json (airport coordinates for the website globe) from tracker/airports.py.

Run from the repository root:  uv run python tools/make_airports_json.py
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from tracker.airports import AIRPORTS  # noqa: E402


def airports_payload() -> list[dict]:
    return [{"item_id": a.icao, "iata": a.iata, "lat": a.lat, "lon": a.lon} for a in sorted(AIRPORTS, key=lambda a: a.icao)]


if __name__ == "__main__":
    out = ROOT / "assets" / "airports.json"
    out.write_text(json.dumps(airports_payload(), indent=1) + "\n")
    print(f"wrote {out} ({len(AIRPORTS)} airports)")
