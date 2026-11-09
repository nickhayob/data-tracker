import json
from datetime import datetime, timedelta, timezone

from tracker import build
from tracker.pipeline import run
from tests.conftest import metar_json

NOW = datetime(2026, 11, 9, 6, 0, tzinfo=timezone.utc)


def make_fetch(metar, openmeteo, fail=()):
    def fetch(source):
        if source.name in fail:
            raise RuntimeError("source is down")
        return {"metar": metar, "openmeteo": openmeteo}[source.name]
    return fetch


def read_status(root):
    return json.loads((root / "data" / "status.json").read_text())


def raw_files(root, date):
    return sorted(p.name for p in (root / "data" / "raw" / date).glob("*")) if (root / "data" / "raw" / date).exists() else []


def test_first_run_writes_raw_history_and_status(tmp_path, metar_bytes, openmeteo_bytes):
    status = run(NOW, make_fetch(metar_bytes, openmeteo_bytes), tmp_path, publish=False)
    assert raw_files(tmp_path, "2026-11-09") == ["metar.json.gz", "openmeteo.json.gz"]
    assert len(build.read_history(tmp_path / "data" / "history.csv")) == 6
    assert set(status) == {"run_time", "first_run_date", "days_with_success", "items", "new_today", "gone_today", "sources"}
    assert status == read_status(tmp_path)
    assert status["run_time"] == "2026-11-09T06:00:00Z"
    assert (status["first_run_date"], status["days_with_success"], status["items"]) == ("2026-11-09", 1, 6)
    assert status["sources"] == [{"name": "metar", "ok": True, "count": 3}, {"name": "openmeteo", "ok": True, "count": 3}]


def test_second_run_on_the_same_day_counts_once(tmp_path, metar_bytes, openmeteo_bytes):
    fetch = make_fetch(metar_bytes, openmeteo_bytes)
    run(NOW, fetch, tmp_path, publish=False)
    history_first = (tmp_path / "data" / "history.csv").read_bytes()
    raw_first = {p.name: p.read_bytes() for p in (tmp_path / "data" / "raw" / "2026-11-09").iterdir()}
    status = run(NOW + timedelta(hours=5), fetch, tmp_path, publish=False)
    assert (tmp_path / "data" / "history.csv").read_bytes() == history_first
    assert {p.name: p.read_bytes() for p in (tmp_path / "data" / "raw" / "2026-11-09").iterdir()} == raw_first
    assert status["days_with_success"] == 1 and status["items"] == 6
    assert status["run_time"] == "2026-11-09T11:00:00Z"


def test_second_run_replaces_the_days_raw_files_with_the_new_data(tmp_path, openmeteo_bytes):
    run(NOW, make_fetch(metar_json({"KATL": {"temp": 1.0}}), openmeteo_bytes), tmp_path, publish=False)
    run(NOW + timedelta(hours=1), make_fetch(metar_json({"KATL": {"temp": 2.0}}), openmeteo_bytes), tmp_path, publish=False)
    rows = [r for r in build.read_history(tmp_path / "data" / "history.csv") if r["item_id"] == "KATL"]
    assert [r["temp_c"] for r in rows] == ["2.0"]


def test_a_failed_source_writes_no_raw_file_and_does_not_stop_the_run(tmp_path, metar_bytes, openmeteo_bytes):
    status = run(NOW, make_fetch(metar_bytes, openmeteo_bytes, fail={"openmeteo"}), tmp_path, publish=False)
    assert raw_files(tmp_path, "2026-11-09") == ["metar.json.gz"]
    assert status["sources"] == [{"name": "metar", "ok": True, "count": 3}, {"name": "openmeteo", "ok": False, "count": 0}]
    assert {r["source"] for r in build.read_history(tmp_path / "data" / "history.csv")} == {"metar"}
    assert (tmp_path / "data" / "status.json").exists()


def test_garbage_or_empty_responses_count_as_failures(tmp_path, openmeteo_bytes):
    status = run(NOW, make_fetch(b"<html>502 Bad Gateway</html>", openmeteo_bytes), tmp_path, publish=False)
    assert [(s["name"], s["ok"]) for s in status["sources"]] == [("metar", False), ("openmeteo", True)]
    status = run(NOW, make_fetch(b"[]", openmeteo_bytes), tmp_path, publish=False)
    assert status["sources"][0]["ok"] is False
    assert raw_files(tmp_path, "2026-11-09") == ["openmeteo.json.gz"]


def test_a_run_where_every_source_fails_still_finishes(tmp_path):
    status = run(NOW, make_fetch(b"", b"", fail={"metar", "openmeteo"}), tmp_path, publish=False)
    assert status["items"] == 0 and status["days_with_success"] == 0 and status["first_run_date"] is None
    assert raw_files(tmp_path, "2026-11-09") == []
    assert (tmp_path / "data" / "history.csv").read_text().startswith("date,item_id,item,source")


def test_new_and_gone_items_compare_with_the_previous_run(tmp_path, openmeteo_bytes):
    run(NOW, make_fetch(metar_json({"KATL": {}, "KLAX": {}}), openmeteo_bytes), tmp_path, publish=False)
    status = run(NOW + timedelta(days=1), make_fetch(metar_json({"KATL": {}, "KJFK": {}}), openmeteo_bytes), tmp_path, publish=False)
    assert status["new_today"] == ["KJFK"] and status["gone_today"] == ["KLAX"]
    assert status["days_with_success"] == 2 and status["first_run_date"] == "2026-11-09"


def test_first_day_has_nothing_new_or_gone(tmp_path, metar_bytes, openmeteo_bytes):
    status = run(NOW, make_fetch(metar_bytes, openmeteo_bytes), tmp_path, publish=False)
    assert status["new_today"] == [] and status["gone_today"] == []


def test_a_failed_source_on_a_later_day_shows_its_items_as_gone(tmp_path, metar_bytes, openmeteo_bytes):
    run(NOW, make_fetch(metar_bytes, openmeteo_bytes), tmp_path, publish=False)
    status = run(NOW + timedelta(days=1), make_fetch(metar_bytes, openmeteo_bytes, fail={"openmeteo"}), tmp_path, publish=False)
    assert status["gone_today"] == ["EGLL", "LFPG", "YSSY"]


def test_the_date_is_the_utc_date(tmp_path, metar_bytes, openmeteo_bytes):
    late_evening_in_chicago = datetime(2026, 11, 9, 20, 0, tzinfo=timezone(timedelta(hours=-6)))  # 02:00 UTC on the 10th
    status = run(late_evening_in_chicago, make_fetch(metar_bytes, openmeteo_bytes), tmp_path, publish=False)
    assert status["first_run_date"] == "2026-11-10" and status["run_time"] == "2026-11-10T02:00:00Z"


def test_history_depends_on_the_raw_files_alone(tmp_path, metar_bytes, openmeteo_bytes):
    for day in range(3):
        run(NOW + timedelta(days=day), make_fetch(metar_json({"KATL": {"temp": float(day)}}), openmeteo_bytes), tmp_path, publish=False)
    path = tmp_path / "data" / "history.csv"
    expected = path.read_bytes()
    path.unlink()
    build.write_history(build.build_history(tmp_path / "data" / "raw"), path)
    assert path.read_bytes() == expected
    assert [r["date"] for r in build.read_history(path)][:2] == ["2026-11-09", "2026-11-09"]
