"""Data sources: how to download each one and how to convert its raw file to the common columns.

``parse_*`` functions are pure: raw bytes in, a list of row dicts out. They do not touch the
network, so the history can always be rebuilt from the saved raw files alone.
"""

import json
import math
import time
from dataclasses import dataclass
from typing import Callable

import requests

from .airports import BY_ICAO, for_source

USER_AGENT = "airport-tracker-class-project"

# Common columns of every converted row (and of data/history.csv).
COLUMNS = [
    "date", "item_id", "item", "source", "iata", "city", "country", "region",
    "temp_c", "wind_kt", "visibility_km", "pressure_hpa",
]
# Numeric columns and how many decimals each is stored with.
NUMERIC = {"temp_c": 1, "wind_kt": 1, "visibility_km": 2, "pressure_hpa": 1}

SM_TO_KM = 1.609344


def to_number(value) -> float | None:
    """Convert a source value to a float, or None when it is missing or unusable."""
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return None if isinstance(value, float) and not math.isfinite(value) else float(value)
    text = str(value).strip().rstrip("+")  # METAR reports "10+" for "10 or more"
    if not text:
        return None
    try:
        if " " in text:  # mixed fraction such as "1 1/2"
            whole, frac = text.split(" ", 1)
            num, den = frac.split("/")
            return float(whole) + float(num) / float(den)
        if "/" in text:
            num, den = text.split("/")
            return float(num) / float(den)
        number = float(text)
    except (ValueError, ZeroDivisionError):
        return None
    return number if math.isfinite(number) else None


def _row(airport, source: str, temp_c, wind_kt, visibility_km, pressure_hpa) -> dict:
    return {
        "item_id": airport.icao,
        "item": airport.name,
        "source": source,
        "iata": airport.iata,
        "city": airport.city,
        "country": airport.country,
        "region": airport.region,
        "temp_c": temp_c,
        "wind_kt": wind_kt,
        "visibility_km": visibility_km,
        "pressure_hpa": pressure_hpa,
    }


# ---------------------------------------------------------------------------------------
# Source 1: aviationweather.gov METAR observations (JSON), U.S. airports
# ---------------------------------------------------------------------------------------
METAR_URL = "https://aviationweather.gov/api/data/metar"


def fetch_metar() -> bytes:
    ids = ",".join(a.icao for a in for_source("metar"))
    # hours=2 so a station with no report in the last hour still returns its latest one.
    return http_get(METAR_URL, {"ids": ids, "format": "json", "hours": 2})


def parse_metar(raw: bytes) -> list[dict]:
    """METAR JSON -> rows. Keeps only the tracked airports, and only each one's newest report."""
    data = json.loads(raw)
    if not isinstance(data, list):
        raise ValueError("METAR response is not a list")
    newest: dict[str, dict] = {}
    for obs in data:
        icao = obs.get("icaoId")
        if icao not in BY_ICAO or BY_ICAO[icao].source != "metar":
            continue  # the API returned something we do not track: ignore it
        if icao not in newest or (obs.get("obsTime") or 0) > (newest[icao].get("obsTime") or 0):
            newest[icao] = obs
    rows = []
    for icao, obs in newest.items():
        visibility_sm = to_number(obs.get("visib"))
        pressure = to_number(obs.get("slp"))  # sea-level pressure, same basis as Open-Meteo
        if pressure is None:
            pressure = to_number(obs.get("altim"))  # fall back to the altimeter setting
        rows.append(_row(
            BY_ICAO[icao], "metar",
            to_number(obs.get("temp")),
            to_number(obs.get("wspd")),  # already in knots
            None if visibility_sm is None else visibility_sm * SM_TO_KM,
            pressure,
        ))
    return rows


# ---------------------------------------------------------------------------------------
# Source 2: Open-Meteo current conditions (JSON), international airports
# ---------------------------------------------------------------------------------------
OPENMETEO_URL = "https://api.open-meteo.com/v1/forecast"
OPENMETEO_MAX_DEGREES_OFF = 0.5  # response grid point must be this close to the airport


def fetch_openmeteo() -> bytes:
    airports = for_source("openmeteo")
    params = {
        "latitude": ",".join(str(a.lat) for a in airports),
        "longitude": ",".join(str(a.lon) for a in airports),
        "current": "temperature_2m,wind_speed_10m,pressure_msl,visibility",
        "wind_speed_unit": "kn",
    }
    return http_get(OPENMETEO_URL, params)


def parse_openmeteo(raw: bytes) -> list[dict]:
    """Open-Meteo JSON -> rows. Each location is matched to its airport by coordinates."""
    data = json.loads(raw)
    if isinstance(data, dict):
        data = [data]
    airports = for_source("openmeteo")
    rows = []
    for loc in data:
        try:
            lat, lon = float(loc["latitude"]), float(loc["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        airport = min(airports, key=lambda a: abs(a.lat - lat) + abs(a.lon - lon))
        if abs(airport.lat - lat) > OPENMETEO_MAX_DEGREES_OFF or abs(airport.lon - lon) > OPENMETEO_MAX_DEGREES_OFF:
            continue
        current = loc.get("current") or {}
        visibility_m = to_number(current.get("visibility"))
        rows.append(_row(
            airport, "openmeteo",
            to_number(current.get("temperature_2m")),
            to_number(current.get("wind_speed_10m")),  # requested in knots
            None if visibility_m is None else visibility_m / 1000,
            to_number(current.get("pressure_msl")),
        ))
    return rows


# ---------------------------------------------------------------------------------------
@dataclass(frozen=True)
class Source:
    name: str  # used in raw file names and the history "source" column
    format: str  # raw file extension (the format the source returns)
    label: str
    fetch: Callable[[], bytes]
    parse: Callable[[bytes], list[dict]]


SOURCES = [
    Source("metar", "json", "aviationweather.gov METAR", fetch_metar, parse_metar),
    Source("openmeteo", "json", "Open-Meteo current conditions", fetch_openmeteo, parse_openmeteo),
]
SOURCES_BY_NAME = {s.name: s for s in SOURCES}


def http_get(url: str, params: dict | None = None, attempts: int = 3, timeout: int = 30) -> bytes:
    """GET with a few retries. Raises if every attempt fails."""
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            response = requests.get(url, params=params, timeout=timeout, headers={"User-Agent": USER_AGENT})
            response.raise_for_status()
            if not response.content:
                raise ValueError("empty response")
            return response.content
        except Exception as error:  # noqa: BLE001 - any failure means "try again, then give up"
            last_error = error
            if attempt < attempts - 1:
                time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"GET {url} failed after {attempts} attempts: {last_error}")
