"""The move rule: how far did an airport's conditions move since the previous run?

Each numeric value is divided by a fixed scale so that different units can be compared:

    scaled change = |new - old| / scale        scales: temp 5 C, wind 10 kt, visibility 5 km, pressure 5 hPa
    move score    = the largest scaled change among the values that exist in both runs

A score of 1.0 means "at least one value changed by one full scale step". The issue and the Today
page list the 10 airports with the highest score (score above 0). site/common.js uses the same rule.
"""

SCALES = {"temp_c": 5.0, "wind_kt": 10.0, "visibility_km": 5.0, "pressure_hpa": 5.0}
TOP_N = 10


def _num(value):
    if value in (None, ""):
        return None
    return float(value)


def move_score(old: dict, new: dict) -> tuple[float, str | None]:
    """Return (score, column that moved most). Values missing on either day are skipped."""
    best, best_col = 0.0, None
    for col, scale in SCALES.items():
        a, b = _num(old.get(col)), _num(new.get(col))
        if a is None or b is None:
            continue
        scaled = abs(b - a) / scale
        if scaled > best:
            best, best_col = scaled, col
    return best, best_col


def compare(previous_rows: list[dict], current_rows: list[dict], top_n: int = TOP_N) -> dict:
    """Compare two days of rows.

    Returns {"new": [item_id...], "gone": [item_id...], "moves": [...]} where moves are sorted
    by score, highest first (ties by item_id), limited to top_n, and contain only score > 0.
    """
    prev = {r["item_id"]: r for r in previous_rows}
    cur = {r["item_id"]: r for r in current_rows}
    moves = []
    for item_id in sorted(set(prev) & set(cur)):
        score, column = move_score(prev[item_id], cur[item_id])
        if score > 0:
            moves.append({
                "item_id": item_id,
                "item": cur[item_id]["item"],
                "score": score,
                "column": column,
                "old": {c: prev[item_id].get(c) for c in SCALES},
                "new": {c: cur[item_id].get(c) for c in SCALES},
            })
    moves.sort(key=lambda m: (-m["score"], m["item_id"]))
    return {
        "new": sorted(set(cur) - set(prev)),
        "gone": sorted(set(prev) - set(cur)),
        "moves": moves[:top_n],
    }
