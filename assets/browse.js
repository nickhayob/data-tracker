/* Browse page: filters, search, sort by every numeric column, and a starred shortlist. */
(async function () {
  AT.init("browse");
  const content = document.getElementById("content");
  const e = AT.esc;
  AT.hero("Browse", "Loading…");
  let data;
  try { data = await AT.loadData(); } catch (error) { AT.hero("Browse", ""); return AT.showError(content, error); }
  const rows = data.rows.filter((r) => r.date === data.latestDate);
  AT.hero("Browse", `Latest values for <strong>${e(data.latestDate)}</strong>. Click a column heading to sort, and click the ☆ to save an airport to your shortlist.`);
  document.getElementById("controls").hidden = false;

  // temperature history per airport, for the little trend lines
  const tempHistory = new Map();
  for (const r of data.rows) {
    if (!tempHistory.has(r.item_id)) tempHistory.set(r.item_id, new Map());
    tempHistory.get(r.item_id).set(r.date, r.temp_c);
  }
  const sparkValues = (id) => data.dates.map((d) => (tempHistory.get(id).has(d) ? tempHistory.get(id).get(d) : null));

  // ranges used to draw the data bars
  const range = (key) => { const v = rows.map((r) => r[key]).filter((x) => x !== null); return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1]; };
  const ranges = Object.fromEntries(AT.NUM.map((n) => [n.key, range(n.key)]));
  const barCell = (key, value) => {
    if (value === null) return `<td class="num">–</td>`;
    const [lo, hi] = ranges[key];
    const w = key === "pressure_hpa" ? (hi === lo ? 50 : 8 + ((value - lo) / (hi - lo)) * 92) : (hi === 0 ? 0 : (value / hi) * 100);
    return `<td class="num databar" style="--bar:var(${AT.METRIC[key].color});--w:${w.toFixed(0)}%">${AT.fmt(value)}</td>`;
  };

  // shortlist is kept in the browser (localStorage) so it survives a reload
  const KEY = "airport-tracker-shortlist";
  let shortlist = new Set();
  try { shortlist = new Set(JSON.parse(localStorage.getItem(KEY) || "[]")); } catch (error) { /* storage unavailable: keep it in memory */ }
  const saveShortlist = () => { try { localStorage.setItem(KEY, JSON.stringify([...shortlist])); } catch (error) { /* ignore */ } };

  const state = { q: "", region: "", country: "", source: "", starOnly: false, sort: "item", dir: "asc" };
  const fill = (id, label, values) => {
    document.getElementById(id).innerHTML = `<option value="">All ${label}</option>` + [...new Set(values)].sort().map((v) => `<option>${e(v)}</option>`).join("");
  };
  fill("f-region", "regions", rows.map((r) => r.region));
  fill("f-country", "countries", rows.map((r) => r.country));
  fill("f-source", "sources", rows.map((r) => r.source));

  const columns = [
    { key: "star", label: "★", nosort: true },
    { key: "item", label: "Airport", text: true },
    ...AT.NUM.map((n) => ({ key: n.key, label: `${AT.METRIC[n.key].icon} ${n.short} (${n.unit})` })),
    { key: "trend", label: "Temp trend", nosort: true },
    { key: "city", label: "Location", text: true },
    { key: "region", label: "Region", text: true },
    { key: "source", label: "Source", text: true },
  ];

  function visibleRows() {
    const q = state.q.trim().toLowerCase();
    const out = rows.filter((r) =>
      (!q || [r.item, r.item_id, r.iata, r.city, r.country].some((t) => t.toLowerCase().includes(q))) &&
      (!state.region || r.region === state.region) &&
      (!state.country || r.country === state.country) &&
      (!state.source || r.source === state.source) &&
      (!state.starOnly || shortlist.has(r.item_id)));
    const dir = state.dir === "asc" ? 1 : -1;
    out.sort((a, b) => {
      const x = a[state.sort], y = b[state.sort];
      if (x === null && y === null) return 0;
      if (x === null) return 1;   // missing values always last
      if (y === null) return -1;
      return (typeof x === "string" ? x.localeCompare(y) : x - y) * dir || a.item_id.localeCompare(b.item_id);
    });
    return out;
  }

  function render() {
    const shown = visibleRows();
    document.getElementById("star-count").textContent = shortlist.size;
    document.getElementById("count").textContent = `Showing ${shown.length} of ${rows.length} airports.`;
    const head = columns.map((c) => {
      if (c.nosort) return `<th scope="col"${c.key === "star" ? ' aria-label="Shortlist"' : ""}>${c.label}</th>`;
      const active = state.sort === c.key;
      const arrow = active ? (state.dir === "asc" ? "▲" : "▼") : "↕";
      const aria = active ? (state.dir === "asc" ? "ascending" : "descending") : "none";
      return `<th scope="col" class="${c.text ? "" : "num"}" aria-sort="${aria}"><button class="sort" type="button" data-sort="${c.key}">${c.label} <span class="arrow" aria-hidden="true">${arrow}</span></button></th>`;
    }).join("");
    const body = shown.map((r) => {
      const on = shortlist.has(r.item_id);
      return `<tr><td><button class="star" type="button" data-star="${e(r.item_id)}" aria-pressed="${on}" aria-label="${on ? "Remove" : "Add"} ${e(r.item)} ${on ? "from" : "to"} shortlist">${on ? "★" : "☆"}</button></td>
        <td>${AT.condIcon(r)}<strong>${e(r.item)}</strong> <span class="muted">${e(r.item_id)}</span></td>
        <td class="num">${AT.tempChip(r.temp_c)}</td>${barCell("wind_kt", r.wind_kt)}${barCell("visibility_km", r.visibility_km)}${barCell("pressure_hpa", r.pressure_hpa)}
        <td>${AT.sparkline(sparkValues(r.item_id), AT.tempColor(r.temp_c) ? AT.tempColor(r.temp_c).bg : "var(--accent)")}</td>
        <td>${e(r.city)}, ${e(r.country)}</td><td><span class="dot" style="background:${AT.regionColor(r.region)}"></span>${e(r.region)}</td><td>${e(r.source)}</td></tr>`;
    }).join("") || `<tr><td colspan="${columns.length}" class="muted">No airports match.</td></tr>`;
    content.innerHTML = `<div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  document.getElementById("q").addEventListener("input", (ev) => { state.q = ev.target.value; render(); });
  for (const [id, key] of [["f-region", "region"], ["f-country", "country"], ["f-source", "source"]]) {
    document.getElementById(id).addEventListener("change", (ev) => { state[key] = ev.target.value; render(); });
  }
  document.getElementById("f-star").addEventListener("change", (ev) => { state.starOnly = ev.target.checked; render(); });
  document.getElementById("reset").addEventListener("click", () => {
    Object.assign(state, { q: "", region: "", country: "", source: "", starOnly: false, sort: "item", dir: "asc" });
    document.getElementById("q").value = "";
    for (const id of ["f-region", "f-country", "f-source"]) document.getElementById(id).value = "";
    document.getElementById("f-star").checked = false;
    render();
  });
  content.addEventListener("click", (ev) => {
    const sortBtn = ev.target.closest("[data-sort]");
    if (sortBtn) {
      const key = sortBtn.dataset.sort;
      state.dir = state.sort === key && state.dir === "asc" ? "desc" : "asc";
      state.sort = key;
      return render();
    }
    const starBtn = ev.target.closest("[data-star]");
    if (starBtn) {
      const id = starBtn.dataset.star;
      shortlist.has(id) ? shortlist.delete(id) : shortlist.add(id);
      saveShortlist();
      render();
      const again = content.querySelector(`[data-star="${CSS.escape(id)}"]`);
      if (again) again.focus();
    }
  });
  render();
})();
