"""The daily GitHub Issue: text of the report and publishing it through the GitHub REST API."""

import os

import requests

from .moves import SCALES
from .sources import USER_AGENT

LABEL = "daily-report"
COLUMN_LABELS = {"temp_c": "Temp (C)", "wind_kt": "Wind (kt)", "visibility_km": "Visibility (km)", "pressure_hpa": "Pressure (hPa)"}


def issue_title(date: str) -> str:
    return f"Daily report {date}"


def _cell(old, new, bold: bool) -> str:
    def fmt(v):
        return "–" if v in (None, "") else f"{float(v):g}"
    text = f"{fmt(old)} → {fmt(new)}"
    return f"**{text}**" if bold else text


def issue_body(date: str, previous_date: str | None, comparison: dict, status: dict) -> str:
    lines = [f"## Airport conditions, {date}", ""]
    ok = [s for s in status["sources"] if s["ok"]]
    lines.append(f"Sources working: {len(ok)} of {len(status['sources'])}. Airports in this run: {status['items']}.")
    for s in status["sources"]:
        lines.append(f"- `{s['name']}`: {'ok' if s['ok'] else 'FAILED'} ({s['count']} airports)")
    lines.append("")
    if previous_date is None:
        lines.append("This is the first day with data, so there is nothing to compare with yet.")
        return "\n".join(lines) + "\n"
    lines.append(f"Compared with the previous run ({previous_date}).")
    lines.append("")
    if comparison["new"]:
        lines.append("**Appeared:** " + ", ".join(comparison["new"]))
    if comparison["gone"]:
        lines.append("**Disappeared:** " + ", ".join(comparison["gone"]))
    if not comparison["new"] and not comparison["gone"]:
        lines.append("No airports appeared or disappeared.")
    lines.append("")
    if not comparison["moves"]:
        lines.append("No airport changed since the previous run.")
        return "\n".join(lines) + "\n"
    lines.append(f"### Biggest moves (top {len(comparison['moves'])})")
    lines.append("")
    lines.append("Move score = the largest of |change| / scale over the four values "
                 "(scales: " + ", ".join(f"{COLUMN_LABELS[c]} {s:g}" for c, s in SCALES.items()) + "). "
                 "Each cell is old → new; the value that moved most is bold.")
    lines.append("")
    lines.append("| Airport | Score | " + " | ".join(COLUMN_LABELS[c] for c in SCALES) + " |")
    lines.append("|---|---|" + "---|" * len(SCALES))
    for m in comparison["moves"]:
        cells = [_cell(m["old"][c], m["new"][c], c == m["column"]) for c in SCALES]
        lines.append(f"| {m['item']} ({m['item_id']}) | {m['score']:.2f} | " + " | ".join(cells) + " |")
    return "\n".join(lines) + "\n"


def publish_issue(title: str, body: str, token: str, repo: str, session=requests) -> str:
    """Create (or update, on a second run the same day) today's issue and close the other open ones.

    Returns the issue URL.
    """
    api = f"https://api.github.com/repos/{repo}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json", "User-Agent": USER_AGENT}

    def call(method, url, **kwargs):
        response = session.request(method, url, headers=headers, timeout=30, **kwargs)
        response.raise_for_status()
        return response.json()

    existing = call("GET", f"{api}/issues", params={"state": "all", "labels": LABEL, "per_page": 100})
    existing = [i for i in existing if "pull_request" not in i]
    same = next((i for i in existing if i["title"] == title), None)
    if same:  # second run on the same day: update that day's issue instead of opening another
        issue = call("PATCH", f"{api}/issues/{same['number']}", json={"body": body, "state": "open"})
    else:
        issue = call("POST", f"{api}/issues", json={"title": title, "body": body, "labels": [LABEL]})
    for other in existing:  # close the previous days' issues
        if other["state"] == "open" and other["title"] != title:
            call("PATCH", f"{api}/issues/{other['number']}", json={"state": "closed"})
    return issue.get("html_url", "")


def publish_from_env(title: str, body: str) -> None:
    token, repo = os.environ.get("GITHUB_TOKEN"), os.environ.get("GITHUB_REPOSITORY")
    if not token or not repo:
        print("No GITHUB_TOKEN/GITHUB_REPOSITORY: skipping the issue.")
        return
    try:
        print("Issue:", publish_issue(title, body, token, repo))
    except Exception as error:  # noqa: BLE001 - a failed issue must not fail the run
        print(f"WARNING: could not publish the issue: {error}")
