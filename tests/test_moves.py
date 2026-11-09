import pytest

from tracker.moves import compare, move_score


def row(item_id, temp=10.0, wind=10.0, vis=10.0, pres=1000.0, item=None):
    return {"item_id": item_id, "item": item or item_id, "temp_c": temp, "wind_kt": wind,
            "visibility_km": vis, "pressure_hpa": pres}


def test_score_is_largest_scaled_change():
    score, column = move_score(row("A"), row("A", temp=15.0, wind=12.0))  # temp 5/5=1.0, wind 2/10=0.2
    assert score == pytest.approx(1.0) and column == "temp_c"


def test_score_uses_the_right_scale_for_each_column():
    assert move_score(row("A"), row("A", wind=15.0))[0] == pytest.approx(0.5)  # 5 kt / 10
    assert move_score(row("A"), row("A", pres=1010.0))[0] == pytest.approx(2.0)  # 10 hPa / 5
    assert move_score(row("A"), row("A", vis=7.5))[0] == pytest.approx(0.5)  # 2.5 km / 5


def test_score_is_zero_when_nothing_changed():
    assert move_score(row("A"), row("A")) == (0.0, None)


def test_score_ignores_values_missing_on_either_day():
    old, new = row("A", temp=None), row("A", temp=50.0, wind=20.0)
    score, column = move_score(old, new)
    assert column == "wind_kt" and score == pytest.approx(1.0)
    assert move_score({**row("A"), "temp_c": ""}, row("A", temp=50.0))[0] == 0.0  # empty string from the CSV


def test_score_accepts_text_values_from_the_csv():
    assert move_score({"temp_c": "10.0"}, {"temp_c": "12.5"})[0] == pytest.approx(0.5)


def test_compare_ranks_by_score_and_reports_old_and_new_values():
    prev = [row("A"), row("B"), row("C")]
    cur = [row("A", temp=11.0), row("B", temp=20.0), row("C")]
    result = compare(prev, cur)
    assert [m["item_id"] for m in result["moves"]] == ["B", "A"]  # C did not move, so it is not listed
    assert result["moves"][0]["old"]["temp_c"] == 10.0 and result["moves"][0]["new"]["temp_c"] == 20.0
    assert result["moves"][0]["column"] == "temp_c"


def test_compare_finds_new_and_gone_items():
    result = compare([row("A"), row("B")], [row("B"), row("C")])
    assert result["new"] == ["C"] and result["gone"] == ["A"]
    assert result["moves"] == []  # B is identical, C and A have nothing to compare against


def test_compare_limits_the_list_and_breaks_ties_by_item_id():
    prev = [row(f"I{i:02d}") for i in range(15)]
    cur = [row(f"I{i:02d}", temp=10.0 + 5) for i in range(15)]  # all tie with score 1.0
    result = compare(prev, cur)
    assert len(result["moves"]) == 10
    assert [m["item_id"] for m in result["moves"]] == [f"I{i:02d}" for i in range(10)]
    assert len(compare(prev, cur, top_n=3)["moves"]) == 3


def test_compare_with_nothing_on_either_side():
    assert compare([], []) == {"new": [], "gone": [], "moves": []}
    assert compare([], [row("A")])["new"] == ["A"]
