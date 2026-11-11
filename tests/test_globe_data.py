"""The website globe reads assets/airports.json; it must match the airport list."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "tools"))

from make_airports_json import airports_payload  # noqa: E402
from tracker.airports import AIRPORTS  # noqa: E402


def test_every_airport_has_valid_coordinates():
    for a in AIRPORTS:
        assert a.lat is not None and a.lon is not None, a.icao
        assert -90 <= a.lat <= 90 and -180 <= a.lon <= 180, a.icao


def test_airports_json_is_up_to_date():
    saved = json.loads((ROOT / "assets" / "airports.json").read_text())
    assert saved == airports_payload(), "run: uv run python tools/make_airports_json.py"
