/* Shared code for the three pages: navigation, data loading, the move rule, formatting. */
(function () {
  "use strict";

  // The four numeric columns of data/history.csv. `scale` is used by the move rule.
  const NUM = [
    { key: "temp_c", label: "Temperature", unit: "°C", short: "Temp", scale: 5 },
    { key: "wind_kt", label: "Wind speed", unit: "kt", short: "Wind", scale: 10 },
    { key: "visibility_km", label: "Visibility", unit: "km", short: "Visibility", scale: 5 },
    { key: "pressure_hpa", label: "Pressure", unit: "hPa", short: "Pressure", scale: 5 },
  ];
  const TOP_N = 10;

  function esc(text) {
    return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // --- CSV --------------------------------------------------------------------------------
  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); field = "";
        if (row.length > 1 || row[0] !== "") rows.push(row);
        row = [];
      } else field += c;
    }
    if (field !== "" || row.length) { row.push(field); rows.push(row); }
    if (!rows.length) return [];
    const header = rows[0];
    return rows.slice(1).map((cells) => {
      const obj = {};
      header.forEach((name, i) => { obj[name] = cells[i] === undefined ? "" : cells[i]; });
      for (const n of NUM) obj[n.key] = obj[n.key] === "" || obj[n.key] === undefined ? null : Number(obj[n.key]);
      return obj;
    });
  }

  // --- data -------------------------------------------------------------------------------
  async function fetchText(url) {
    const response = await fetch(url, { cache: "no-cache" });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.text();
  }

  /** Load data/history.csv and data/status.json (the site does every calculation from these). */
  async function loadData() {
    const [csv, statusText] = await Promise.all([fetchText("data/history.csv"), fetchText("data/status.json")]);
    const rows = parseCSV(csv);
    const status = JSON.parse(statusText);
    const dates = [...new Set(rows.map((r) => r.date))].sort();
    const latestDate = dates.length ? dates[dates.length - 1] : null;
    const prevDate = dates.length > 1 ? dates[dates.length - 2] : null;
    const rowsOn = (date) => rows.filter((r) => r.date === date);
    return { rows, status, dates, latestDate, prevDate, rowsOn };
  }

  // --- the move rule (same as tracker/moves.py and the README) ----------------------------
  function moveScore(oldRow, newRow) {
    let best = 0, bestKey = null;
    for (const n of NUM) {
      const a = oldRow[n.key], b = newRow[n.key];
      if (a === null || a === undefined || b === null || b === undefined) continue;
      const scaled = Math.abs(b - a) / n.scale;
      if (scaled > best) { best = scaled; bestKey = n.key; }
    }
    return { score: best, key: bestKey };
  }

  /** Compare two days. Returns { moves (top 10, score > 0), added, gone }. */
  function compare(prevRows, curRows, topN = TOP_N) {
    const prev = new Map(prevRows.map((r) => [r.item_id, r]));
    const cur = new Map(curRows.map((r) => [r.item_id, r]));
    const moves = [];
    for (const [id, row] of cur) {
      if (!prev.has(id)) continue;
      const { score, key } = moveScore(prev.get(id), row);
      if (score > 0) moves.push({ id, row, old: prev.get(id), score, key });
    }
    moves.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));
    return {
      moves: moves.slice(0, topN),
      added: [...cur.keys()].filter((id) => !prev.has(id)).sort(),
      gone: [...prev.keys()].filter((id) => !cur.has(id)).sort(),
    };
  }

  // --- formatting -------------------------------------------------------------------------
  function fmt(value, digits = 1) {
    return value === null || value === undefined || Number.isNaN(value) ? "–" : Number(value).toFixed(digits);
  }
  function fmtSigned(value, digits = 1) {
    if (value === null || value === undefined) return "–";
    const text = Math.abs(value).toFixed(digits);
    return (value > 0 && Number(text) !== 0 ? "+" : value < 0 && Number(text) !== 0 ? "−" : "") + text;
  }
  function unitOf(key) { return NUM.find((n) => n.key === key).unit; }
  function labelOf(key) { return NUM.find((n) => n.key === key).label; }

  // --- page chrome ------------------------------------------------------------------------
  function renderNav(active) {
    const links = [["index.html", "Today", "today"], ["browse.html", "Browse", "browse"], ["trends.html", "Trends", "trends"]];
    const el = document.getElementById("site-nav");
    if (!el) return;
    el.className = "topbar";
    el.innerHTML = `<div class="inner"><a class="brand" href="index.html">✈ Airport Weather Tracker</a><nav aria-label="Main">` +
      links.map(([href, text, id]) => `<a href="${href}"${id === active ? ' aria-current="page"' : ""}>${text}</a>`).join("") +
      `</nav></div>`;
  }

  function showError(el, error) {
    el.innerHTML = `<div class="banner error" role="alert"><strong>Could not load the data.</strong> ${esc(error.message || error)}.
      If you are offline and have never opened the site online, there is nothing saved yet.</div>`;
  }

  function offlineNotice() {
    const el = document.getElementById("offline");
    if (!el) return;
    const update = () => { el.hidden = navigator.onLine; };
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    update();
  }

  function init(active) {
    renderNav(active);
    offlineNotice();
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // --- color and graphics helpers ----------------------------------------------------------
  // Icon and color (a CSS variable) for each numeric column.
  const METRIC = {
    temp_c: { icon: "🌡️", color: "--s2" },
    wind_kt: { icon: "💨", color: "--s3" },
    visibility_km: { icon: "👁️", color: "--s7" },
    pressure_hpa: { icon: "⏲️", color: "--s1" },
  };
  const REGION_COLOR = { "North America": "--s1", "Europe": "--s7", "Asia": "--s2", "Middle East": "--s4", "Oceania": "--s3", "South America": "--s5", "Africa": "--s6" };
  const regionColor = (region) => `var(${REGION_COLOR[region] || "--s8"})`;

  // Temperature color scale: cold blue -> teal -> yellow -> orange -> hot red.
  const STOPS = [[-10, [43, 95, 196]], [0, [90, 169, 230]], [10, [143, 208, 192]], [20, [242, 211, 107]], [30, [240, 138, 60]], [38, [216, 67, 47]]];
  function tempColor(t) {
    if (t === null || t === undefined) return null;
    const x = Math.max(STOPS[0][0], Math.min(STOPS[STOPS.length - 1][0], t));
    let i = 0;
    while (i < STOPS.length - 2 && x > STOPS[i + 1][0]) i++;
    const [t0, c0] = STOPS[i], [t1, c1] = STOPS[i + 1];
    const k = (x - t0) / (t1 - t0);
    const rgb = c0.map((v, j) => Math.round(v + (c1[j] - v) * k));
    const light = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 150;
    return { bg: `rgb(${rgb.join(",")})`, fg: light ? "#0b0b0b" : "#ffffff" };
  }
  function tempChip(t, digits = 1) {
    const c = tempColor(t);
    return c ? `<span class="chip" style="background:${c.bg};color:${c.fg}">${fmt(t, digits)}</span>` : "–";
  }

  /** A weather-style icon worked out from the numbers only (there is no cloud data). */
  function condition(r) {
    if (r.visibility_km !== null && r.visibility_km < 5) return { icon: "🌫️", label: "Low visibility (under 5 km)" };
    if (r.wind_kt !== null && r.wind_kt >= 20) return { icon: "💨", label: "Windy (20 kt or more)" };
    if (r.temp_c !== null && r.temp_c <= 0) return { icon: "❄️", label: "Freezing (0 °C or below)" };
    if (r.temp_c !== null && r.temp_c >= 30) return { icon: "🔥", label: "Hot (30 °C or above)" };
    return { icon: "🌤️", label: "Mild, light wind, good visibility" };
  }
  const condIcon = (r) => { const c = condition(r); return `<span class="cond" title="${esc(c.label)}">${c.icon}</span>`; };

  /** Tiny inline line chart. `values` may contain nulls; fewer than 2 points draws nothing. */
  function sparkline(values, color, w = 84, h = 24) {
    const pts = values.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined);
    if (pts.length < 2) return `<span class="muted small">–</span>`;
    const min = Math.min(...pts.map((p) => p[1])), max = Math.max(...pts.map((p) => p[1]));
    const x = (i) => 2 + (i / (values.length - 1)) * (w - 4);
    const y = (v) => (max === min ? h / 2 : h - 3 - ((v - min) / (max - min)) * (h - 6));
    const path = pts.map(([i, v]) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const [li, lv] = pts[pts.length - 1];
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="trend over ${values.length} days"><polyline points="${path}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><circle cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="2.6" fill="${color}"/></svg>`;
  }

  /** Page banner: sky gradient with a plane illustration. */
  function hero(title, subHtml) {
    const el = document.getElementById("hero");
    if (!el) return;
    el.className = "hero";
    el.innerHTML = `<div class="inner"><div><h1>${esc(title)}</h1><p id="lastrun">${subHtml}</p></div>
      <svg class="hero-art" viewBox="0 0 420 170" aria-hidden="true">
        <circle cx="332" cy="50" r="46" fill="#ffd166" opacity=".25"/><circle cx="332" cy="50" r="30" fill="#ffd166"/>
        <g fill="#fff" opacity=".95"><ellipse cx="108" cy="126" rx="48" ry="16"/><circle cx="90" cy="113" r="21"/><circle cx="128" cy="108" r="25"/></g>
        <g fill="#fff" opacity=".7"><ellipse cx="300" cy="146" rx="40" ry="12"/><circle cx="286" cy="136" r="15"/><circle cx="314" cy="133" r="18"/></g>
        <path d="M20 152 Q200 22 380 72" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="1 9" stroke-linecap="round" opacity=".9"/>
        <g transform="translate(236 59) rotate(-7)"><polygon points="26,0 -16,-14 -8,0 -16,14" fill="#fff"/><polygon points="6,0 -8,-26 -2,0 -8,26" fill="#dcecff"/></g>
      </svg></div>`;
  }

  /** Chart.js defaults taken from the page colors (call before creating charts). */
  function chartDefaults() {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = cssVar("--text-2");
    Chart.defaults.borderColor = cssVar("--grid");
  }

  window.AT = { METRIC, regionColor, tempColor, tempChip, condition, condIcon, sparkline, hero, chartDefaults, NUM, TOP_N, esc, parseCSV, loadData, moveScore, compare, fmt, fmtSigned, unitOf, labelOf, init, showError, cssVar };
})();
