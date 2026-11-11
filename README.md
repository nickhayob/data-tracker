# Airport Weather Tracker

![Tests](https://github.com/nickhayob/data-tracker/actions/workflows/tests.yml/badge.svg)

Every day, on its own, this tool downloads the current weather at **41 airports** (21 in the United States and 20 around the world), adds it to a history with one row per airport per day, reports what moved, and publishes the result as an installable website.

- Live site: https://nickhayob.github.io/data-tracker/
- Daily reports: see the [Issues](../../issues) tab (one issue per day; the previous day's issue is closed).

## What is tracked

Each airport is one item, identified by its **ICAO code** (`item_id`, for example `KATL`), which never changes. Four numeric values are tracked per airport: temperature, wind speed, visibility and sea-level pressure.

## Sources

| Source name | Format | What it is | Airports |
|---|---|---|---|
| `metar` | JSON | [aviationweather.gov METAR API](https://aviationweather.gov/data/api/) - the latest official airport observation | 21 U.S. airports |
| `openmeteo` | JSON | [Open-Meteo](https://open-meteo.com/en/docs) current conditions, looked up by the airport's coordinates | 20 international airports |

Neither needs a login or an API key, so no secrets are used.

**What is kept:** each request names only the airports above, so nothing else comes back. The METAR API can return several reports per airport (it is asked for the last 2 hours); only the newest report per airport is kept, and any airport that is not on the list is ignored. Open-Meteo returns many more fields than we ask for; only the four current values below are requested. The raw response is saved exactly as received.

The two sources cover different airports on purpose, so every `item_id` appears at most once per day. International airports use Open-Meteo because METAR reports in many countries cap visibility and omit sea-level pressure.

## How the pipeline works

`.github/workflows/daily.yml` runs `uv run python -m tracker.pipeline` once a day (06:17 UTC), then commits `data/`. Each run:

1. Calls every source and saves what it returns, compressed and in the format it came in, to `data/raw/<date>/<source>.<format>.gz` (for example `data/raw/2026-11-09/metar.json.gz`). A source that fails (error, timeout, or a response with no usable rows) writes no file that day and does not stop the run; its result, success or failure, is recorded in `data/status.json`. Each call is retried up to three times.
2. Builds `data/history.csv` from the raw files alone.
3. Writes `data/status.json`.
4. Opens a GitHub Issue titled `Daily report <date>` listing the biggest moves, new and missing airports, and the state of each source, and closes the previous day's issue. It is opened every day, even when nothing changed.
5. The workflow commits the raw files, history file and status file.

A run is successful when it finishes and commits, even if some sources failed. Dates are **UTC dates** of the moment the run starts. A second run on the same day replaces that day's raw files, rebuilds the history, and updates that day's issue, so each day counts once.

### Build the history from the raw files

```
uv run python -m tracker.build
```

The history depends on the raw files only. Running the command again produces an identical file, and changing a conversion rule in `tracker/sources.py` changes every day of the history.

## The move rule

How far did an airport move since the previous run (the previous date in the history)?

```
scaled change = |new − old| ÷ scale
move score    = the largest scaled change over the four values that exist on both days
scales        = temperature 5 °C, wind 10 kt, visibility 5 km, pressure 5 hPa
```

A score of 1.0 means at least one value changed by one full scale step. The issue and the Today page list the **10 airports with the highest score** (score above 0). Airports that appear or disappear since the previous run are listed separately (an airport whose source failed that day counts as disappeared). On the first day there is nothing to compare, so nothing is listed. The same rule is in `tracker/moves.py` (Python) and `assets/common.js` (website).

## `data/history.csv`

One row per airport per day, sorted by `date` and then `item_id`. A value a source does not report is left empty.

| Column | Meaning | Unit |
|---|---|---|
| `date` | UTC date of the run | `YYYY-MM-DD` |
| `item_id` | ICAO airport code (the key), e.g. `KATL` | text |
| `item` | Airport name | text |
| `source` | Source that reported the row: `metar` or `openmeteo` | text |
| `iata` | IATA airport code, e.g. `ATL` | text |
| `city` | City served | text |
| `country` | Country | text |
| `region` | Continent / area (North America, Europe, Asia, Middle East, Oceania, South America, Africa) | text |
| `temp_c` | Air temperature at the time of the run | °C |
| `wind_kt` | Wind speed | knots |
| `visibility_km` | Horizontal visibility. METAR reports "10+" statute miles for good visibility, stored as 16.09; Open-Meteo values are not capped at that | kilometres |
| `pressure_hpa` | Sea-level pressure (METAR: `slp`, falling back to the altimeter setting when missing; Open-Meteo: `pressure_msl`) | hectopascals |

## `data/status.json`

Describes the latest run: `run_time` (UTC), `first_run_date` (date of the earliest raw file), `days_with_success` (number of different dates with a raw file), `items` (airports in the latest run), `new_today` and `gone_today` (lists of `item_id` that appeared / disappeared since the previous run), and `sources` (one entry per source with `name`, `ok`, `count`).

## The website

Hosted with GitHub Pages from the repository root. All calculations happen in the browser from the two data files.

- **Today** (`index.html`): time of the last run, status of each source, counts, the latest values with the change since the previous run, and the biggest moves.
- **Browse** (`browse.html`): filters (region, country, source), search, sort by every numeric column, and a star on each airport that saves it to a shortlist (kept in the browser).
- **Trends** (`trends.html`): a chart of each numeric value over the days with a control that picks the airports, plus five findings whose numbers are computed from `history.csv`.

The site is installable (web app manifest + service worker). Data files are loaded from the network first; offline, the last data it loaded is shown.

## Files

| Path | What it does |
|---|---|
| `tracker/airports.py` | The list of airports (code, name, city, country, region, source, coordinates) |
| `tracker/sources.py` | Downloads each source and converts its raw file to the common columns |
| `tracker/build.py` | Builds `data/history.csv` from `data/raw/` |
| `tracker/moves.py` | The move rule and the comparison of two days |
| `tracker/issues.py` | Writes and publishes the daily GitHub Issue |
| `tracker/pipeline.py` | The daily run (steps 1-4 above) |
| `tests/` | pytest suite (source conversion, move rule, history build, same-day second run, failed sources, issues) and `tests/fixtures/` (real sample responses) |
| `.github/workflows/daily.yml` | Runs the pipeline daily and commits the data |
| `.github/workflows/tests.yml` | Runs the tests on every push |
| `data/raw/<date>/` | Raw responses, one compressed file per source per day |
| `data/history.csv` | The history (see above) |
| `data/status.json` | Status of the latest run |
| `index.html`, `browse.html`, `trends.html` | The three site pages |
| `assets/site.css` | Shared fonts and colors |
| `assets/common.js` | Shared navigation, data loading, move rule, formatting |
| `assets/today.js`, `assets/browse.js`, `assets/trends.js` | Page scripts |
| `assets/vendor/chart.umd.min.js` | Chart.js 4.4.1 (kept in the repository so the site works offline) |
| `assets/globe.js` | The interactive globe on the Today page (drag to rotate, click an airport, color by any value) |
| `assets/airports.json` | Airport coordinates for the globe, generated from `tracker/airports.py` by `tools/make_airports_json.py` (`tests/test_globe_data.py` checks they match) |
| `assets/vendor/d3-array.min.js`, `d3-geo.min.js`, `topojson-client.min.js` | d3-array 3.2.4, d3-geo 3.1.1 and topojson-client 3.1.0 (map projection; ISC license) |
| `assets/vendor/land-110m.json` | Land outlines from world-atlas 2.0.2 (Natural Earth, public domain) |
| `assets/icons/` | App icons (`tools/make_icons.py` draws them) |
| `manifest.webmanifest`, `sw.js` | Web app manifest and service worker |
| `pyproject.toml`, `uv.lock`, `.python-version` | Python 3.14 project managed with uv |

## Run it yourself

```
uv sync
uv run pytest                      # tests
uv run python -m tracker.pipeline  # one run (writes data/; skips the issue without GITHUB_TOKEN)
uv run python -m tracker.build     # rebuild data/history.csv from data/raw/
```
