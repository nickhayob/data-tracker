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
    el.innerHTML = `<div class="inner"><a class="brand" href="index.html"><span class="logo">${icon("plane", 18)}</span><span>Airport Weather Tracker</span></a><nav aria-label="Main">` +
      links.map(([href, text, id]) => `<a href="${href}"${id === active ? ' aria-current="page"' : ""}>${text}</a>`).join("") +
      `</nav></div>`;
  }

  function renderFooter() {
    if (document.getElementById("site-footer")) return;
    const el = document.createElement("footer");
    el.id = "site-footer";
    el.innerHTML = `<div class="inner"><span>Weather data: <a href="https://aviationweather.gov/data/api/">aviationweather.gov</a> (U.S. airports) and <a href="https://open-meteo.com/">Open-Meteo</a> (international airports, CC BY 4.0).</span>
      <a href="https://github.com/nickhayob/data-tracker">${icon("github", 16)} View on GitHub</a></div>`;
    document.body.appendChild(el);
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
    renderFooter();
    offlineNotice();
    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
    }
  }

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // --- color and graphics helpers ----------------------------------------------------------
  // One set of line icons (24x24, drawn with the current text color) used on every page.
  const ICONS = {
    thermometer: '<path d="M14 4v10.54a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
    wind: '<path d="M17.7 7.7a2.5 2.5 0 1 1 1.8 4.3H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
    eye: '<path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
    plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
    calendar: '<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
    plus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/>',
    minus: '<circle cx="12" cy="12" r="10"/><path d="M8 12h8"/>',
    globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    fog: '<path d="M4 14.9A7 7 0 1 1 15.7 8h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M16 17H7"/><path d="M17 21H9"/>',
    snow: '<line x1="2" x2="22" y1="12" y2="12"/><line x1="12" x2="12" y1="2" y2="22"/><path d="m20 16-4-4 4-4"/><path d="m4 8 4 4-4 4"/><path d="m16 4-4 4-4-4"/><path d="m8 20 4-4 4 4"/>',
    flame: '<path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    updown: '<path d="m7 15 5 5 5-5"/><path d="m7 9 5-5 5 5"/>',
    github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  };
  /** Inline SVG for an icon name. `fill` fills the shape (used for a saved star). */
  function icon(name, size = 18, fill = false) {
    return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
  }

  // Icon and color (a CSS variable) for each numeric column.
  const METRIC = {
    temp_c: { icon: icon("thermometer", 16), color: "--s2" },
    wind_kt: { icon: icon("wind", 16), color: "--s3" },
    visibility_km: { icon: icon("eye", 16), color: "--s7" },
    pressure_hpa: { icon: icon("gauge", 16), color: "--s1" },
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
    if (r.visibility_km !== null && r.visibility_km < 5) return { icon: "fog", color: "var(--text-2)", label: "Low visibility (under 5 km)" };
    if (r.wind_kt !== null && r.wind_kt >= 20) return { icon: "wind", color: "var(--s3)", label: "Windy (20 kt or more)" };
    if (r.temp_c !== null && r.temp_c <= 0) return { icon: "snow", color: "var(--s1)", label: "Freezing (0 °C or below)" };
    if (r.temp_c !== null && r.temp_c >= 30) return { icon: "flame", color: "var(--s2)", label: "Hot (30 °C or above)" };
    return { icon: "sun", color: "var(--s4)", label: "Mild, light wind, good visibility" };
  }
  const condIcon = (r) => { const c = condition(r); return `<span class="cond" style="color:${c.color}" title="${esc(c.label)}">${icon(c.icon, 18)}</span>`; };

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
        <g fill="none" stroke="#fff" opacity=".16"><circle cx="318" cy="156" r="56"/><circle cx="318" cy="156" r="98"/><circle cx="318" cy="156" r="140"/></g>
        <path d="M30 140 C 120 30, 280 20, 390 70" fill="none" stroke="#fff" stroke-width="2.5" stroke-dasharray="2 9" stroke-linecap="round" opacity=".85"/>
        <circle cx="30" cy="140" r="6" fill="#fff"/><circle cx="390" cy="70" r="6" fill="#fff"/><circle cx="390" cy="70" r="15" fill="none" stroke="#fff" opacity=".45"/>
        <g transform="translate(202 45) rotate(36) scale(2.3) translate(-12 -12)" fill="#fff" stroke="#fff" stroke-width="1" stroke-linejoin="round"><path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/></g>
      </svg></div>`;
  }

  /** Chart.js defaults taken from the page colors (call before creating charts). */
  function chartDefaults() {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = cssVar("--text-2");
    Chart.defaults.borderColor = cssVar("--grid");
  }

  window.AT = { icon, METRIC, regionColor, tempColor, tempChip, condition, condIcon, sparkline, hero, chartDefaults, NUM, TOP_N, esc, parseCSV, loadData, moveScore, compare, fmt, fmtSigned, unitOf, labelOf, init, showError, cssVar };
})();
