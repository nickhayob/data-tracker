/* Trends page. Every number on this page is computed here, in the browser, from data/history.csv. */
(async function () {
  AT.init("trends");
  const content = document.getElementById("content");
  const e = AT.esc;
  let data;
  try { data = await AT.loadData(); } catch (error) { document.getElementById("meta").textContent = ""; return AT.showError(content, error); }
  const { rows, dates, latestDate } = data;
  if (!rows.length) { document.getElementById("meta").textContent = "The history file has no rows yet."; return; }
  document.getElementById("meta").textContent =
    `Computed from ${rows.length} rows in data/history.csv: ${dates.length} day${dates.length === 1 ? "" : "s"} (${dates[0]} to ${latestDate}).`;

  // ---------- helpers ----------
  const byDate = new Map(dates.map((d) => [d, rows.filter((r) => r.date === d)]));
  const items = [...new Map(rows.map((r) => [r.item_id, r])).values()].sort((a, b) => a.city.localeCompare(b.city) || a.item_id.localeCompare(b.item_id));
  const label = (r) => `${r.city} (${r.iata})`;
  const f1 = (v) => AT.fmt(v, 1), f2 = (v) => AT.fmt(v, 2);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const valid = (r, k) => r[k] !== null && r[k] !== undefined;

  // ---------- chart 1: each numeric value over the days, with an item picker ----------
  const MAX_SELECTED = 8;
  const DEFAULTS = ["KXNA", "KATL", "EGLL", "OMDB", "YSSY"].filter((id) => items.some((i) => i.item_id === id));
  const selected = DEFAULTS.length ? [...DEFAULTS] : items.slice(0, 5).map((i) => i.item_id);
  const slotOf = new Map(); // an airport keeps its color slot while it stays selected
  const takeSlot = (id) => { const used = new Set(slotOf.values()); for (let s = 1; s <= MAX_SELECTED; s++) if (!used.has(s)) { slotOf.set(id, s); return; } };
  selected.forEach(takeSlot);
  const seriesColor = (id) => AT.cssVar(`--s${slotOf.get(id)}`);

  // ---------- findings (each: heading that states the finding, explanation with numbers, chart) ----------
  const findings = [];

  // 1. how far apart the airports are on the latest day
  (function () {
    const day = byDate.get(latestDate).filter((r) => valid(r, "temp_c")).sort((a, b) => b.temp_c - a.temp_c);
    if (day.length < 2) return findings.push({ heading: "Not enough temperature readings to compare airports yet", para: "The latest day has fewer than two airports with a temperature.", chart: null });
    const warm = day[0], cold = day[day.length - 1], n = Math.min(5, Math.floor(day.length / 2));
    const shown = [...day.slice(0, n), ...day.slice(day.length - n)];
    findings.push({
      heading: `${label(warm)} is ${f1(warm.temp_c - cold.temp_c)} °C warmer than ${label(cold)}`,
      para: `On ${latestDate}, the history file has a temperature for ${day.length} airports. The warmest is ${label(warm)} at ${f1(warm.temp_c)} °C and the coldest is ${label(cold)} at ${f1(cold.temp_c)} °C. ` +
        `The gap is the maximum minus the minimum of the temp_c column on that date: ${f1(warm.temp_c)} − ${f1(cold.temp_c)} = ${f1(warm.temp_c - cold.temp_c)} °C. The chart shows the ${n} warmest and the ${n} coldest airports; the average of all ${day.length} is ${f1(mean(day.map((r) => r.temp_c)))} °C.`,
      chart: { kind: "bar", horizontal: true, labels: shown.map(label), values: shown.map((r) => r.temp_c), unit: "°C", name: "Temperature" },
    });
  })();

  // 2. who warmed / cooled most since the first run
  (function () {
    if (dates.length < 2) return findings.push({
      heading: "Changes since the first run will show up after the second day of data",
      para: `The history has one day so far (${dates[0]}). From the second day on, this section compares each airport's temp_c on the latest date with its value on the first date and ranks the differences.`, chart: null });
    const first = new Map(byDate.get(dates[0]).map((r) => [r.item_id, r]));
    const changes = byDate.get(latestDate).filter((r) => valid(r, "temp_c") && first.has(r.item_id) && valid(first.get(r.item_id), "temp_c"))
      .map((r) => ({ r, d: r.temp_c - first.get(r.item_id).temp_c })).sort((a, b) => b.d - a.d);
    if (changes.length < 2) return findings.push({ heading: "No airport has a temperature on both the first and the latest day", para: "There is nothing to compare yet.", chart: null });
    const up = changes[0], down = changes[changes.length - 1], n = Math.min(5, Math.floor(changes.length / 2));
    const shown = [...changes.slice(0, n), ...changes.slice(changes.length - n)];
    findings.push({
      heading: up.d > 0 ? `${label(up.r)} warmed the most since the first run: ${AT.fmtSigned(up.d)} °C` : `No airport is warmer than on the first run; ${label(up.r)} changed the least`,
      para: `For each of the ${changes.length} airports with a temperature on both ${dates[0]} (first run) and ${latestDate} (latest), the change is the latest temp_c minus the first-day temp_c. ` +
        `${label(up.r)} moved ${AT.fmtSigned(up.d)} °C (${f1(first.get(up.r.item_id).temp_c)} → ${f1(up.r.temp_c)}); ${label(down.r)} moved ${AT.fmtSigned(down.d)} °C (${f1(first.get(down.r.item_id).temp_c)} → ${f1(down.r.temp_c)}). ` +
        `The average change across all ${changes.length} airports is ${AT.fmtSigned(mean(changes.map((c) => c.d)))} °C. Orange bars warmed, blue bars cooled.`,
      chart: { kind: "bar", horizontal: true, labels: shown.map((c) => label(c.r)), values: shown.map((c) => c.d), unit: "°C", name: "Change in temperature", diverging: true },
    });
  })();

  // 3. day with the biggest move
  (function () {
    if (dates.length < 2) return findings.push({
      heading: "The day with the biggest move will show up after the second day of data",
      para: "For every pair of consecutive days in the history file, this section computes the average move score of all airports present on both days (the move rule in the README) and picks the day with the highest average.", chart: null });
    const perDay = [];
    for (let i = 1; i < dates.length; i++) {
      const prev = new Map(byDate.get(dates[i - 1]).map((r) => [r.item_id, r]));
      const scores = byDate.get(dates[i]).filter((r) => prev.has(r.item_id)).map((r) => ({ r, ...AT.moveScore(prev.get(r.item_id), r) }));
      if (scores.length) perDay.push({ date: dates[i], prev: dates[i - 1], avg: mean(scores.map((s) => s.score)), top: scores.sort((a, b) => b.score - a.score)[0], n: scores.length });
    }
    if (!perDay.length) return findings.push({ heading: "No two consecutive days share an airport", para: "There is nothing to compare yet.", chart: null });
    const best = perDay.reduce((a, b) => (b.avg > a.avg ? b : a));
    findings.push({
      heading: `${best.date} was the day of the biggest move: an average score of ${f2(best.avg)}`,
      para: `For each date after the first, every airport present on that date and the day before gets a move score: the largest of |change| ÷ scale across temperature (5 °C), wind (10 kt), visibility (5 km) and pressure (5 hPa). The chart plots the average score over all airports for each date. ` +
        `${best.date} (compared with ${best.prev}) was highest at ${f2(best.avg)} across ${best.n} airports; the single biggest mover was ${label(best.top.r)} with a score of ${f2(best.top.score)} (${best.top.key ? AT.labelOf(best.top.key).toLowerCase() : "no change"}).`,
      chart: { kind: "bar", horizontal: false, labels: perDay.map((p) => p.date), values: perDay.map((p) => p.avg), unit: "", name: "Average move score" },
    });
  })();

  // 4. windiest airport on average
  (function () {
    const perItem = items.map((it) => {
      const v = rows.filter((r) => r.item_id === it.item_id && valid(r, "wind_kt")).map((r) => r.wind_kt);
      return { it, avg: v.length ? mean(v) : null, n: v.length };
    }).filter((x) => x.avg !== null).sort((a, b) => b.avg - a.avg);
    if (!perItem.length) return findings.push({ heading: "No wind readings yet", para: "The history file has no wind_kt values.", chart: null });
    const top = perItem[0], calm = perItem[perItem.length - 1], shown = perItem.slice(0, 10);
    findings.push({
      heading: `${label(top.it)} is the windiest airport, averaging ${f1(top.avg)} kt`,
      para: `The average is the mean of the wind_kt column over every day the airport has a reading: ${label(top.it)} has ${plural(top.n, "day")} averaging ${f1(top.avg)} kt. ` +
        `The calmest is ${label(calm.it)} at ${f1(calm.avg)} kt over ${plural(calm.n, "day")}, so the windiest airport averages ${f1(top.avg / (calm.avg || NaN))} times the wind of the calmest. The chart shows the ten windiest of ${perItem.length} airports.`,
      chart: { kind: "bar", horizontal: true, labels: shown.map((x) => label(x.it)), values: shown.map((x) => x.avg), unit: "kt", name: "Average wind speed" },
    });
  })();

  // 5. pressure spread across airports, per day
  (function () {
    const perDay = dates.map((d) => {
      const v = byDate.get(d).filter((r) => valid(r, "pressure_hpa")).sort((a, b) => a.pressure_hpa - b.pressure_hpa);
      return v.length >= 2 ? { date: d, lo: v[0], hi: v[v.length - 1], spread: v[v.length - 1].pressure_hpa - v[0].pressure_hpa, n: v.length } : null;
    }).filter(Boolean);
    if (!perDay.length) return findings.push({ heading: "No pressure readings yet", para: "The history file has no pressure_hpa values.", chart: null });
    const last = perDay[perDay.length - 1], widest = perDay.reduce((a, b) => (b.spread > a.spread ? b : a));
    findings.push({
      heading: `Air pressure differs by ${f1(last.spread)} hPa between airports on ${last.date}`,
      para: `The spread is the highest minus the lowest pressure_hpa among the ${last.n} airports reporting on a date. On ${last.date} the highest is ${label(last.hi)} at ${f1(last.hi.pressure_hpa)} hPa and the lowest is ${label(last.lo)} at ${f1(last.lo.pressure_hpa)} hPa, a spread of ${f1(last.spread)} hPa. ` +
        `${perDay.length > 1 ? `Across the ${perDay.length} days the spread was widest on ${widest.date} (${f1(widest.spread)} hPa) and narrowest at ${f1(Math.min(...perDay.map((p) => p.spread)))} hPa.` : "Only one day is available so far, so the line is a single point."}`,
      chart: { kind: "line", labels: perDay.map((p) => p.date), values: perDay.map((p) => p.spread), unit: "hPa", name: "Pressure spread" },
    });
  })();

  // ---------- page skeleton ----------
  const swatches = (id) => `<span class="swatch" data-swatch="${e(id)}"></span>`;
  content.innerHTML = `
    <section class="block">
      <h2>Every value over the days</h2>
      <p class="muted small">Pick up to ${MAX_SELECTED} airports. The same airports are shown in all four charts, and each keeps its color while it stays selected.</p>
      <fieldset class="picker"><legend>Airports shown</legend>
        <div class="controls" style="margin:0">
          <button class="btn" type="button" id="p-default">Default five</button>
          <button class="btn" type="button" id="p-star">My shortlist</button>
          <button class="btn" type="button" id="p-clear">Clear</button>
          <span class="muted small" id="p-hint" aria-live="polite"></span>
        </div>
        <div class="items" id="p-items">${items.map((i) => `<label>${swatches(i.item_id)}<input type="checkbox" value="${e(i.item_id)}"> ${e(i.city)} (${e(i.iata)})</label>`).join("")}</div>
      </fieldset>
      <div class="grid2" id="line-grid">${AT.NUM.map((n) => `<div class="card"><h3>${e(n.label)} (${e(n.unit)})</h3><div class="chart-box"><canvas id="line-${n.key}" role="img" aria-label="${e(n.label)} over the days for the selected airports"></canvas></div></div>`).join("")}</div>
    </section>
    <section class="block"><h2 style="margin-bottom:1rem">What the history shows</h2>
    ${findings.map((f, i) => `<article class="finding card"><h2>${e(f.heading)}</h2><p>${e(f.para)}</p>${f.chart ? `<div class="chart-box${f.chart.horizontal ? " tall" : ""}"><canvas id="finding-${i}" role="img" aria-label="${e(f.heading)}"></canvas></div>` : ""}</article>`).join("")}
    </section>`;

  // ---------- charts ----------
  let charts = [];
  const lineCharts = new Map();
  function themeDefaults() {
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
    Chart.defaults.font.size = 12;
    Chart.defaults.color = AT.cssVar("--text-2");
    Chart.defaults.borderColor = AT.cssVar("--grid");
  }

  function lineDatasets(key) {
    return selected.map((id) => {
      const byD = new Map(rows.filter((r) => r.item_id === id).map((r) => [r.date, r[key]]));
      const it = items.find((i) => i.item_id === id);
      const color = seriesColor(id);
      return { label: `${it.city} (${it.iata})`, data: dates.map((d) => (byD.has(d) ? byD.get(d) : null)), borderColor: color, backgroundColor: color,
        borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: AT.cssVar("--surface"), pointBorderWidth: 1.5, tension: 0.2, spanGaps: false };
    });
  }

  function buildLineCharts() {
    for (const n of AT.NUM) {
      const chart = new Chart(document.getElementById(`line-${n.key}`), {
        type: "line",
        data: { labels: dates, datasets: lineDatasets(n.key) },
        options: {
          responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
          plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } },
            tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${AT.fmt(c.parsed.y, 1)} ${n.unit}` } } },
          scales: { y: { title: { display: true, text: n.unit }, grace: "5%" }, x: { grid: { display: false } } },
        },
      });
      charts.push(chart);
      lineCharts.set(n.key, chart);
    }
  }

  function buildFindingCharts() {
    findings.forEach((f, i) => {
      if (!f.chart) return;
      const c = f.chart, canvas = document.getElementById(`finding-${i}`);
      const blue = AT.cssVar("--s1"), orange = AT.cssVar("--s2");
      const colors = c.diverging ? c.values.map((v) => (v >= 0 ? orange : blue)) : AT.cssVar("--s1");
      const isLine = c.kind === "line";
      const dataset = isLine
        ? { label: c.name, data: c.values, borderColor: blue, backgroundColor: blue, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBorderColor: AT.cssVar("--surface"), pointBorderWidth: 1.5, tension: 0.2 }
        : { label: c.name, data: c.values, backgroundColor: colors, borderRadius: 4, borderSkipped: "start", maxBarThickness: 28 };
      const valueAxis = { title: { display: !!c.unit, text: c.unit }, grace: "5%" };
      charts.push(new Chart(canvas, {
        type: isLine ? "line" : "bar",
        data: { labels: c.labels, datasets: [dataset] },
        options: {
          indexAxis: c.horizontal ? "y" : "x", responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => {
            const v = ctx.parsed[c.horizontal ? "x" : "y"];
            return `${c.name}: ${c.diverging ? AT.fmtSigned(v, 1) : AT.fmt(v, c.unit ? 1 : 2)}${c.unit ? " " + c.unit : ""}`; } } } },
          scales: c.horizontal ? { x: valueAxis, y: { grid: { display: false } } } : { y: valueAxis, x: { grid: { display: false } } },
        },
      }));
    });
  }

  function renderAll() {
    charts.forEach((ch) => ch.destroy());
    charts = []; lineCharts.clear();
    themeDefaults();
    buildLineCharts();
    buildFindingCharts();
    paintSwatches();
  }

  function updateLines() {
    for (const n of AT.NUM) { const ch = lineCharts.get(n.key); ch.data.datasets = lineDatasets(n.key); ch.update(); }
    paintSwatches();
  }

  // ---------- the picker ----------
  const boxes = [...document.querySelectorAll("#p-items input")];
  function paintSwatches() {
    document.querySelectorAll("[data-swatch]").forEach((s) => { s.style.background = slotOf.has(s.dataset.swatch) ? seriesColor(s.dataset.swatch) : "transparent"; s.style.border = slotOf.has(s.dataset.swatch) ? "0" : "1px solid var(--border)"; });
  }
  function syncPicker() {
    boxes.forEach((b) => { b.checked = selected.includes(b.value); b.disabled = !b.checked && selected.length >= MAX_SELECTED; });
    document.getElementById("p-hint").textContent = `${selected.length} of ${MAX_SELECTED} selected` + (selected.length >= MAX_SELECTED ? " (clear one to add another)" : "");
  }
  function setSelected(ids) {
    const next = ids.filter((id) => items.some((i) => i.item_id === id)).slice(0, MAX_SELECTED);
    for (const id of [...slotOf.keys()]) if (!next.includes(id)) slotOf.delete(id);   // survivors keep their color
    selected.splice(0, selected.length, ...next);
    next.forEach((id) => { if (!slotOf.has(id)) takeSlot(id); });
    syncPicker(); updateLines();
  }
  boxes.forEach((b) => b.addEventListener("change", () => setSelected(b.checked ? [...selected, b.value] : selected.filter((id) => id !== b.value))));
  document.getElementById("p-default").addEventListener("click", () => setSelected(DEFAULTS));
  document.getElementById("p-clear").addEventListener("click", () => setSelected([]));
  document.getElementById("p-star").addEventListener("click", () => {
    let starred = [];
    try { starred = JSON.parse(localStorage.getItem("airport-tracker-shortlist") || "[]"); } catch (error) { /* none saved */ }
    setSelected(starred);
  });

  syncPicker();
  renderAll();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", renderAll);
})();
