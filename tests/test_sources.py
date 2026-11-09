import json

import pytest

from tracker.sources import SM_TO_KM, parse_metar, parse_openmeteo, to_number
from tests.conftest import metar_json


def by_id(rows):
    return {r["item_id"]: r for r in rows}


def test_metar_converts_to_common_columns(metar_bytes):
    rows = by_id(parse_metar(metar_bytes))
    assert set(rows) == {"KATL", "KJFK", "KXNA"}
    atl = rows["KATL"]
    assert atl["item"] == "Hartsfield-Jackson Atlanta Intl"
    assert atl["source"] == "metar"
    assert (atl["iata"], atl["city"], atl["country"], atl["region"]) == ("ATL", "Atlanta", "United States", "North America")
    assert atl["temp_c"] == 21.7
    assert atl["wind_kt"] == 11.0
    assert atl["visibility_km"] == pytest.approx(10 * SM_TO_KM)  # "10+" statute miles -> km
    assert atl["pressure_hpa"] == 1020.2  # sea-level pressure


def test_metar_falls_back_to_altimeter_when_no_sea_level_pressure():
    rows = parse_metar(metar_json({"KATL": {"slp": None, "altim": 1013.2}}))
    assert rows[0]["pressure_hpa"] == 1013.2


def test_metar_keeps_only_newest_report_per_airport():
    raw = metar_json({"KATL": {"obsTime": 100, "temp": 1.0}})
    older_and_newer = json.loads(raw) + [{**json.loads(raw)[0], "obsTime": 200, "temp": 2.0}]
    rows = parse_metar(json.dumps(older_and_newer).encode())
    assert len(rows) == 1 and rows[0]["temp_c"] == 2.0


def test_metar_ignores_airports_it_does_not_track():
    rows = parse_metar(metar_json({"KATL": {}, "KZZZ": {}, "EGLL": {}}))  # EGLL belongs to the other source
    assert [r["item_id"] for r in rows] == ["KATL"]


def test_metar_missing_values_are_none():
    rows = parse_metar(metar_json({"KATL": {"temp": None, "visib": None, "wspd": None}}))
    row = rows[0]
    assert row["temp_c"] is None and row["visibility_km"] is None and row["wind_kt"] is None


def test_metar_fractional_visibility():
    rows = parse_metar(metar_json({"KATL": {"visib": "1 1/2"}}))
    assert rows[0]["visibility_km"] == pytest.approx(1.5 * SM_TO_KM)


def test_metar_rejects_a_response_that_is_not_a_list():
    with pytest.raises(ValueError):
        parse_metar(b'{"error": "bad request"}')


def test_openmeteo_converts_to_common_columns(openmeteo_bytes):
    rows = by_id(parse_openmeteo(openmeteo_bytes))
    assert set(rows) == {"EGLL", "LFPG", "YSSY"}
    lhr = rows["EGLL"]
    assert lhr["source"] == "openmeteo"
    assert (lhr["iata"], lhr["country"], lhr["region"]) == ("LHR", "United Kingdom", "Europe")
    assert lhr["temp_c"] == 8.1
    assert lhr["wind_kt"] == 6.6
    assert lhr["visibility_km"] == pytest.approx(4.68)  # metres -> km
    assert lhr["pressure_hpa"] == 1014.8


def test_openmeteo_matches_airports_by_coordinates_not_by_order(openmeteo_bytes):
    reversed_rows = parse_openmeteo(json.dumps(json.loads(openmeteo_bytes)[::-1]).encode())
    assert by_id(reversed_rows) == by_id(parse_openmeteo(openmeteo_bytes))


def test_openmeteo_skips_locations_that_match_no_tracked_airport(openmeteo_bytes):
    data = json.loads(openmeteo_bytes)
    data[0]["latitude"], data[0]["longitude"] = 0.0, -150.0  # middle of the Pacific
    assert {r["item_id"] for r in parse_openmeteo(json.dumps(data).encode())} == {"LFPG", "YSSY"}


def test_openmeteo_null_values_are_none(openmeteo_bytes):
    data = json.loads(openmeteo_bytes)
    data[0]["current"]["visibility"] = None
    rows = by_id(parse_openmeteo(json.dumps(data).encode()))
    assert rows["EGLL"]["visibility_km"] is None and rows["EGLL"]["temp_c"] == 8.1


@pytest.mark.parametrize("value,expected", [
    (3, 3.0), (2.5, 2.5), ("10+", 10.0), ("1/2", 0.5), ("2 1/4", 2.25), ("", None), (None, None),
    ("n/a", None), (True, None), (float("nan"), None), ("1/0", None),
])
def test_to_number(value, expected):
    assert to_number(value) == expected
