from tracker import issues
from tracker.moves import compare

STATUS = {"items": 2, "sources": [{"name": "metar", "ok": True, "count": 2}, {"name": "openmeteo", "ok": False, "count": 0}]}


def row(item_id, temp, wind=5.0):
    return {"item_id": item_id, "item": f"Airport {item_id}", "temp_c": temp, "wind_kt": wind, "visibility_km": 10.0, "pressure_hpa": 1010.0}


def test_title_holds_the_date():
    assert "2026-11-09" in issues.issue_title("2026-11-09")


def test_body_lists_old_and_new_values_and_appeared_and_gone_items():
    comparison = compare([row("KATL", 10.0), row("KOLD", 1.0)], [row("KATL", 16.0), row("KNEW", 2.0)])
    body = issues.issue_body("2026-11-09", "2026-11-08", comparison, STATUS)
    assert "Airport KATL (KATL)" in body and "10 → 16" in body
    assert "Appeared:** KNEW" in body and "Disappeared:** KOLD" in body
    assert "`openmeteo`: FAILED" in body


def test_body_for_a_day_with_no_changes():
    comparison = compare([row("KATL", 10.0)], [row("KATL", 10.0)])
    body = issues.issue_body("2026-11-09", "2026-11-08", comparison, STATUS)
    assert "No airport changed" in body and "No airports appeared or disappeared" in body


def test_body_for_the_first_day():
    body = issues.issue_body("2026-11-09", None, {"new": [], "gone": [], "moves": []}, STATUS)
    assert "first day with data" in body


class FakeSession:
    """Stands in for `requests` and records the calls made to the GitHub API."""

    def __init__(self, issues_list):
        self.issues_list, self.calls = issues_list, []

    def request(self, method, url, **kwargs):
        self.calls.append((method, url.split("/repos/o/r")[1], kwargs.get("json")))
        payload = self.issues_list if method == "GET" else {"html_url": "https://example/1"}

        class Response:
            def raise_for_status(self): pass
            def json(self): return payload
        return Response()


def test_publish_opens_todays_issue_and_closes_the_previous_one():
    session = FakeSession([{"number": 5, "title": "Daily report 2026-11-08", "state": "open"},
                           {"number": 4, "title": "Daily report 2026-11-07", "state": "closed"}])
    url = issues.publish_issue("Daily report 2026-11-09", "body", "token", "o/r", session)
    assert url == "https://example/1"
    methods = [(m, p) for m, p, _ in session.calls]
    assert ("POST", "/issues") in methods
    assert ("PATCH", "/issues/5") in methods and ("PATCH", "/issues/4") not in methods
    assert [j for m, p, j in session.calls if p == "/issues/5"][0] == {"state": "closed"}


def test_second_run_on_the_same_day_updates_that_days_issue():
    session = FakeSession([{"number": 9, "title": "Daily report 2026-11-09", "state": "open"},
                           {"number": 8, "title": "Daily report 2026-11-08", "state": "open"}])
    issues.publish_issue("Daily report 2026-11-09", "new body", "token", "o/r", session)
    methods = [(m, p) for m, p, _ in session.calls]
    assert ("POST", "/issues") not in methods
    assert ("PATCH", "/issues/9") in methods and ("PATCH", "/issues/8") in methods
    assert [j for m, p, j in session.calls if p == "/issues/9"][0]["body"] == "new body"


def test_publish_skips_quietly_without_a_token(monkeypatch, capsys):
    monkeypatch.delenv("GITHUB_TOKEN", raising=False)
    issues.publish_from_env("t", "b")
    assert "skipping" in capsys.readouterr().out
