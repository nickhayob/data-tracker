import dataclasses
import gzip

from tracker import build
from tracker.sources import COLUMNS, SOURCES_BY_NAME
from tests.conftest import metar_json, write_raw


def make_raw(tmp_path):
    raw = tmp_path / "raw"
    # written out of order on purpose
    write_raw(raw, "2026-11-10", "metar", metar_json({"KJFK": {"temp": 3.0}, "KATL": {"temp": 4.0}}))
    write_raw(raw, "2026-11-09", "metar", metar_json({"KLAX": {"temp": 20.0}, "KATL": {"temp": 21.0}}))
    return raw


def test_rows_are_sorted_by_date_then_item_id(tmp_path):
    rows = build.build_history(make_raw(tmp_path))
    assert [(r["date"], r["item_id"]) for r in rows] == [
        ("2026-11-09", "KATL"), ("2026-11-09", "KLAX"), ("2026-11-10", "KATL"), ("2026-11-10", "KJFK")]


def test_one_row_per_item_per_day(tmp_path, openmeteo_bytes):
    raw = make_raw(tmp_path)
    write_raw(raw, "2026-11-09", "openmeteo", openmeteo_bytes)
    rows = build.build_history(raw)
    keys = [(r["date"], r["item_id"]) for r in rows]
    assert len(keys) == len(set(keys))


def test_a_day_without_a_raw_file_for_a_source_has_no_rows_from_it(tmp_path, openmeteo_bytes):
    raw = make_raw(tmp_path)
    write_raw(raw, "2026-11-09", "openmeteo", openmeteo_bytes)  # day 2 has no openmeteo file
    rows = build.build_history(raw)
    assert {r["source"] for r in rows if r["date"] == "2026-11-09"} == {"metar", "openmeteo"}
    assert {r["source"] for r in rows if r["date"] == "2026-11-10"} == {"metar"}


def test_building_twice_gives_the_same_file(tmp_path):
    raw = make_raw(tmp_path)
    first, second = tmp_path / "a.csv", tmp_path / "b.csv"
    build.write_history(build.build_history(raw), first)
    build.write_history(build.build_history(raw), second)
    assert first.read_bytes() == second.read_bytes()


def test_csv_has_fixed_columns_first_and_empty_cells_for_missing_values(tmp_path):
    raw = tmp_path / "raw"
    write_raw(raw, "2026-11-09", "metar", metar_json({"KATL": {"temp": None}}))
    path = tmp_path / "history.csv"
    build.write_history(build.build_history(raw), path)
    lines = path.read_text().splitlines()
    assert lines[0].split(",")[:4] == ["date", "item_id", "item", "source"]
    assert lines[0].split(",") == COLUMNS
    record = dict(zip(COLUMNS, lines[1].split(",")))
    assert record["temp_c"] == "" and record["wind_kt"] == "5.0" and record["date"] == "2026-11-09"


def test_changing_a_conversion_rule_changes_every_day_of_the_history(tmp_path, monkeypatch):
    raw = make_raw(tmp_path)
    before = build.build_history(raw)
    original = SOURCES_BY_NAME["metar"]

    def doubled(body):
        return [{**r, "temp_c": r["temp_c"] * 2} for r in original.parse(body)]

    monkeypatch.setitem(SOURCES_BY_NAME, "metar", dataclasses.replace(original, parse=doubled))
    after = build.build_history(raw)
    assert [r["temp_c"] * 2 for r in before] == [r["temp_c"] for r in after]
    assert {r["date"] for r in after} == {"2026-11-09", "2026-11-10"}


def test_unreadable_and_unknown_files_do_not_stop_the_build(tmp_path):
    raw = make_raw(tmp_path)
    (raw / "2026-11-09" / "openmeteo.json.gz").write_bytes(b"not gzip at all")
    (raw / "2026-11-09" / "mystery.json.gz").write_bytes(gzip.compress(b"[]"))
    (raw / "notes").mkdir()
    assert len(build.build_history(raw)) == 4


def test_empty_raw_folder_gives_an_empty_history(tmp_path):
    assert build.build_history(tmp_path / "missing") == []
