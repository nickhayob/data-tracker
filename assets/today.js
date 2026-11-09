/* Today page: last run, source status, counts, biggest moves, latest values with changes. */
(async function () {
  AT.init("today");
  const content = document.getElementById("content");
  let data;
  try { data = await AT.loadData(); } catch (error) { document.getElementById("lastrun").textContent = ""; return AT.showError(content, error); }

  const { status, latestDate, prevDate, rowsOn } = data;
  const latest = rowsOn(latestDate);
  const previous = prevDate ? rowsOn(prevDate) : [];
  const prevById = new Map(previous.map((r) => [r.item_id, r]));
  const e = AT.esc;
  const name = (id) => { const r = latest.find((x) => x.item_id === id) || previous.find((x) => x.item_id === id); return r ? `${r.item} (${id})` : id; };

  const runTime = new Date(status.run_time);
  document.getElementById("lastrun").innerHTML =
    `Last run: <strong>${e(status.run_time.replace("T", " ").replace("Z", " UTC"))}</strong>` +
    ` <span class="muted">(${e(runTime.toLocaleString())} your time)</span>`;

  const runDate = status.run_time.slice(0, 10);
  const staleNote = latestDate && latestDate !== runDate
    ? `<div class="banner">No airport data was collected on ${e(runDate)}; showing the latest data, from ${e(latestDate)}.</div>` : "";

  const sourcesRows = status.sources.map((s) =>
    `<tr><td>${e(s.name)}</td><td><span class="badge ${s.ok ? "ok" : "fail"}">${s.ok ? "✓ OK" : "✕ Failed"}</span></td><td class="num">${s.count}</td></tr>`).join("");

  const { moves } = prevDate ? AT.compare(previous, latest) : { moves: [] };
  let movesHtml;
  if (!prevDate) {
    movesHtml = `<p class="muted">There is only one day of data so far, so there is nothing to compare yet. Moves appear after the next run.</p>`;
  } else if (!moves.length) {
    movesHtml = `<p class="muted">No airport changed since the previous run (${e(prevDate)}).</p>`;
  } else {
    const top = moves[0].score;
    movesHtml = `<p class="muted small">Compared with the previous run (${e(prevDate)}). Score = the largest of |change| ÷ scale over temperature (5 °C), wind (10 kt), visibility (5 km) and pressure (5 hPa).</p>
    <ol class="moves">` + moves.map((m, i) => {
      const n = AT.NUM.find((x) => x.key === m.key);
      return `<li><span class="rank">${i + 1}</span>
        <div><strong>${e(m.row.item)}</strong> <span class="muted">${e(m.id)} · ${e(m.row.city)}</span>
        <div class="bar" style="width:${Math.max(4, (m.score / top) * 100).toFixed(0)}%" aria-hidden="true"></div></div>
        <div class="change"><strong>${e(n.label)}</strong>: ${AT.fmt(m.old[m.key])} → ${AT.fmt(m.row[m.key])} ${e(n.unit)}<br><span class="muted small">score ${m.score.toFixed(2)}</span></div></li>`;
    }).join("") + `</ol>`;
  }

  const listOf = (ids) => ids.length ? ids.map((id) => e(name(id))).join(", ") : "none";
  const header = AT.NUM.map((n) => `<th class="num">${e(n.short)} (${e(n.unit)})</th>`).join("");
  const body = latest.slice().sort((a, b) => (a.item < b.item ? -1 : 1)).map((r) => {
    const p = prevById.get(r.item_id);
    const cells = AT.NUM.map((n) => {
      const d = p && r[n.key] !== null && p[n.key] !== null ? r[n.key] - p[n.key] : null;
      const arrow = d === null || Math.abs(d) < 0.05 ? "" : d > 0 ? "▲ " : "▼ ";
      return `<td class="num">${AT.fmt(r[n.key])}<span class="delta${d > 0 ? " up" : ""}">${d === null ? "" : arrow + AT.fmtSigned(d)}</span></td>`;
    }).join("");
    return `<tr><td><strong>${e(r.item)}</strong> <span class="muted">${e(r.item_id)}</span></td><td>${e(r.city)}, ${e(r.country)}</td>${cells}</tr>`;
  }).join("");

  content.innerHTML = `${staleNote}
  <div class="tiles">
    <div class="tile"><div class="num">${status.items}</div><div class="label">airports in latest run</div></div>
    <div class="tile"><div class="num">${status.days_with_success}</div><div class="label">days with data</div></div>
    <div class="tile"><div class="num">${e(status.first_run_date || "–")}</div><div class="label">first run date</div></div>
    <div class="tile"><div class="num">${status.new_today.length}</div><div class="label">appeared today</div></div>
    <div class="tile"><div class="num">${status.gone_today.length}</div><div class="label">disappeared today</div></div>
  </div>
  <section class="block"><h2>Sources</h2>
    <div class="table-wrap"><table><thead><tr><th>Source</th><th>Status</th><th class="num">Airports</th></tr></thead><tbody>${sourcesRows}</tbody></table></div>
    <p class="muted small" style="margin-top:.5rem"><strong>Appeared:</strong> ${listOf(status.new_today)}. <strong>Disappeared:</strong> ${listOf(status.gone_today)}.</p>
  </section>
  <section class="block"><h2>Biggest moves since the previous run</h2>${movesHtml}</section>
  <section class="block"><h2>Latest values</h2>
    <p class="muted small">Data for ${e(latestDate || "–")}. The small line under each value is the change since the previous run${prevDate ? ` (${e(prevDate)})` : ""}.</p>
    <div class="table-wrap"><table><thead><tr><th>Airport</th><th>Location</th>${header}</tr></thead><tbody>${body}</tbody></table></div>
  </section>`;
})();
