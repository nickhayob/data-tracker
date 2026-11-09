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

  window.AT = { NUM, TOP_N, esc, parseCSV, loadData, moveScore, compare, fmt, fmtSigned, unitOf, labelOf, init, showError, cssVar };
})();
