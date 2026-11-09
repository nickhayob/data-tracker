import gzip
import json
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def metar_bytes() -> bytes:
    return (FIXTURES / "metar_sample.json").read_bytes()


@pytest.fixture
def openmeteo_bytes() -> bytes:
    return (FIXTURES / "openmeteo_sample.json").read_bytes()


def write_raw(raw_dir: Path, date: str, source: str, body: bytes) -> Path:
    """Save a raw file the way the pipeline does."""
    path = raw_dir / date / f"{source}.json.gz"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(body, mtime=0))
    return path


def metar_json(stations: dict) -> bytes:
    """Build a METAR response. stations = {icao: {field overrides}}."""
    template = {"obsTime": 1000, "temp": 10.0, "wspd": 5, "visib": "10+", "slp": 1015.0, "altim": 1016.0}
    return json.dumps([{**template, "icaoId": icao, **fields} for icao, fields in stations.items()]).encode()
