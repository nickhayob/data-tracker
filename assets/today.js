/* Today page: last run, source status, counts, charts, biggest moves, latest values with changes. */
(async function () {
  AT.init("today");
  const content = document.getElementById("content");
  const e = AT.esc;
  AT.hero("Today", "Loading…");
  let data;
  try { data = await AT.loadData(); } catch (error) { AT.hero("Today", ""); return AT.showError(content, error); }

  const { status, latestDate, prevDate, rowsOn } = data;
  const latest = rowsOn(latestDate);
  const previous = prevDate ? rowsOn(prevDate) : [];
  const prevById = new Map(previous.map((r) => [r.item_id, r]));
  const name = (id) => { const r = latest.find((x) => x.item_id === id) || previous.find((x) => x.item_id === id); return r ? `${r.item} (${id})` : id; };

  const runTime = new Date(status.run_time);
  AT.hero("Today", `Last run: <strong>${e(status.run_time.replace("T", " ").replace("Z", " UTC"))}</strong>
    <span style="opacity:.85">(${e(runTime.toLocaleString())} your time)</span><br>Live weather at ${status.items} airports, updated every day.`);

  const runDate = status.run_time.slice(0, 10);
  const staleNote = latestDate && latestDate !== runDate
    ? `<div class="banner">No airport data was collected on ${e(runDate)}; showing the latest data, from ${e(latestDate)}.</div>` : "";

  const sourcesRows = status.sources.map((s) =>
    `<tr><td>${e(s.name)}</td><td><span class="badge ${s.ok ? "ok" : "fail"}">${s.ok ? "✓ OK" : "✕ Failed"}</span></td><td class="num">${s.count}</td></tr>`).join("");

  // biggest moves, with a color and icon for the value that moved most
  const { moves } = prevDate ? AT.compare(previous, latest) : { moves: [] };
  const legend = `<div class="legend">${AT.NUM.map((n) => `<span style="--c:var(${AT.METRIC[n.key].color})">${AT.METRIC[n.key].icon} ${e(n.label)}</span>`).join("")}</div>`;
  let movesHtml;
  if (!prevDate) {
    movesHtml = `<p class="muted">There is only one day of data so far, so there is nothing to compare yet. Moves appear after the next run.</p>`;
  } else if (!moves.length) {
    movesHtml = `<p class="muted">No airport changed since the previous run (${e(prevDate)}).</p>`;
  } else {
    const top = moves[0].score;
    movesHtml = `<p class="muted small">Compared with the previous run (${e(prevDate)}). Score = the largest of |change| ÷ scale over temperature (5 °C), wind (10 kt), visibility (5 km) and pressure (5 hPa). The color shows which value moved most.</p>${legend}
    <ol class="moves">` + moves.map((m, i) => {
      const n = AT.NUM.find((x) => x.key === m.key), c = `var(${AT.METRIC[m.key].color})`;
      return `<li style="--c:${c}"><span class="rank">${i + 1}</span>
        <div>${AT.condIcon(m.row)}<strong>${e(m.row.item)}</strong> <span class="muted">${e(m.id)} · ${e(m.row.city)}</span>
        <div class="bar" style="width:${Math.max(4, (m.score / top) * 100).toFixed(0)}%" aria-hidden="true"></div></div>
        <div class="change"><strong>${AT.METRIC[m.key].icon} ${e(n.label)}</strong>: ${AT.fmt(m.old[m.key])} → ${AT.fmt(m.row[m.key])} ${e(n.unit)}<br><span class="muted small">score ${m.score.toFixed(2)}</span></div></li>`;
    }).join("") + `</ol>`;
  }

  const listOf = (ids) => ids.length ? ids.map((id) => e(name(id))).join(", ") : "none";
  const header = AT.NUM.map((n) => `<th class="num">${AT.METRIC[n.key].icon} ${e(n.short)} (${e(n.unit)})</th>`).join("");
  const body = latest.slice().sort((a, b) => (a.item < b.item ? -1 : 1)).map((r) => {
    const p = prevById.get(r.item_id);
    const cells = AT.NUM.map((n) => {
      const d = p && r[n.key] !== null && p[n.key] !== null ? r[n.key] - p[n.key] : null;
      const small = d === null || Math.abs(d) < 0.05;
      const arrow = small ? "" : d > 0 ? "▲ " : "▼ ";
      const value = n.key === "temp_c" ? AT.tempChip(r[n.key]) : AT.fmt(r[n.key]);
      return `<td class="num">${value}<span class="delta${small ? "" : d > 0 ? " up" : " down"}">${d === null ? "" : arrow + AT.fmtSigned(d)}</span></td>`;
    }).join("");
    return `<tr><td>${AT.condIcon(r)}<strong>${e(r.item)}</strong> <span class="muted">${e(r.item_id)}</span></td>
      <td><span class="dot" style="background:${AT.regionColor(r.region)}"></span>${e(r.city)}, ${e(r.country)}</td>${cells}</tr>`;
  }).join("");

  const tile = (num, label, icon, color, small) => `<div class="tile" data-icon="${icon}" style="--c:var(${color})"><div class="num${small ? " sm" : ""}">${num}</div><div class="label">${label}</div></div>`;
  content.innerHTML = `${staleNote}
  <div class="tiles">
    ${tile(status.items, "airports in latest run", "🛫", "--s1")}
    ${tile(status.days_with_success, "days with data", "📅", "--s3")}
    ${tile(e(status.first_run_date || "–"), "first run date", "🚩", "--s7", true)}
    ${tile(status.new_today.length, "appeared today", "🆕", "--s4")}
    ${tile(status.gone_today.length, "disappeared today", "👋", "--s8")}
  </div>
  <section class="block"><h2>Right now</h2>
    <div class="grid2">
      <div class="card" style="--c:var(--s2)"><h3>🌡️ Temperature at every airport (°C)</h3><div class="chart-box"><canvas id="c-temps" role="img" aria-label="Bar chart of the temperature at every airport, coldest to warmest"></canvas></div></div>
      <div class="card" style="--c:var(--s3)"><h3>🌍 Average temperature by region (°C)</h3><div class="chart-box"><canvas id="c-regions" role="img" aria-label="Bar chart of the average temperature in each region"></canvas></div></div>
    </div>
  </section>
  <section class="block"><h2>Sources</h2>
    <div class="table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th class="num">Airports</th></tr></thead><tbody>${sourcesRows}</tbody></table></div>
    <p class="muted small" style="margin-top:.5rem"><strong>Appeared:</strong> ${listOf(status.new_today)}. <strong>Disappeared:</strong> ${listOf(status.gone_today)}.</p>
  </section>
  <section class="block"><h2>Biggest moves since the previous run</h2>${movesHtml}</section>
  <section class="block"><h2>Latest values</h2>
    <p class="muted small">Data for ${e(latestDate || "–")}. The small line under each value is the change since the previous run${prevDate ? ` (${e(prevDate)})` : ""}. Hover an icon to see what it means; the dot shows the region.</p>
    <div class="table-wrap"><table><thead><tr><th>Airport</th><th>Location</th>${header}</tr></thead><tbody>${body}</tbody></table></div>
  </section>`;

  // charts (rebuilt when the light/dark setting changes so the text stays readable)
  let charts = [];
  function buildCharts() {
    charts.forEach((c) => c.destroy());
    charts = [];
    AT.chartDefaults();
    const withTemp = latest.filter((r) => r.temp_c !== null).sort((a, b) => a.temp_c - b.temp_c);
    charts.push(new Chart(document.getElementById("c-temps"), {
      type: "bar",
      data: { labels: withTemp.map((r) => r.iata), datasets: [{ data: withTemp.map((r) => r.temp_c), backgroundColor: withTemp.map((r) => AT.tempColor(r.temp_c).bg), borderRadius: 4, borderSkipped: "bottom" }] },
      options: { responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { title: (items) => withTemp[items[0].dataIndex].item, label: (c) => `${AT.fmt(c.parsed.y)} °C` } } },
        scales: { x: { grid: { display: false }, ticks: { maxRotation: 90, minRotation: 90, font: { size: 10 } } }, y: { title: { display: true, text: "°C" } } } },
    }));
    const regions = [...new Set(latest.map((r) => r.region))].map((region) => {
      const v = latest.filter((r) => r.region === region && r.temp_c !== null).map((r) => r.temp_c);
      return { region, n: v.length, avg: v.length ? v.reduce((s, x) => s + x, 0) / v.length : null };
    }).filter((x) => x.avg !== null).sort((a, b) => b.avg - a.avg);
    charts.push(new Chart(document.getElementById("c-regions"), {
      type: "bar",
      data: { labels: regions.map((x) => x.region), datasets: [{ data: regions.map((x) => x.avg), backgroundColor: regions.map((x) => AT.cssVar(AT.regionColor(x.region).slice(4, -1))), borderRadius: 6, borderSkipped: "start", maxBarThickness: 34 }] },
      options: { indexAxis: "y", responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => `${AT.fmt(c.parsed.x)} °C average of ${regions[c.dataIndex].n} airports` } } },
        scales: { y: { grid: { display: false } }, x: { title: { display: true, text: "°C" } } } },
    }));
  }
  buildCharts();
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", buildCharts);
})();
