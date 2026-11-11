/* Interactive globe for the Today page: drag to rotate, click an airport, color it by any value.
   Uses d3-geo (orthographic projection), topojson-client and Natural Earth land outlines, all saved in assets/vendor/. */
(function () {
  "use strict";

  const hexToRgb = (h) => {
    h = h.trim().replace("#", "");
    if (h.length === 3) h = [...h].map((c) => c + c).join("");
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  };
  const mix = (a, b, t) => `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(",")})`;
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  async function getJSON(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  }

  async function globe(el, { rows, prevById }) {
    if (!window.d3 || !window.topojson) { el.innerHTML = `<p class="muted">The globe could not start because its map code did not load.</p>`; return; }
    let coords, topo;
    try {
      [coords, topo] = await Promise.all([getJSON("assets/airports.json"), getJSON("assets/vendor/land-110m.json")]);
    } catch (error) {
      el.innerHTML = `<p class="muted">The globe could not load its map data (${AT.esc(error.message)}).</p>`;
      return;
    }
    const e = AT.esc;
    const rowById = new Map(rows.map((r) => [r.item_id, r]));
    const items = coords.filter((c) => rowById.has(c.item_id) && c.lat !== null).map((c) => ({ ...c, row: rowById.get(c.item_id) }));
    const land = topojson.feature(topo, topo.objects.land);
    const graticule = d3.geoGraticule10();
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    el.innerHTML = `<div class="globe-wrap">
      <div class="globe-stage">
        <canvas tabindex="0" role="img" aria-label="Interactive globe showing ${items.length} airports. Drag or use the arrow keys to rotate, and click an airport for its weather."></canvas>
        <div class="globe-tools">
          <button class="btn" type="button" data-act="zoom-in" aria-label="Zoom in">+</button>
          <button class="btn" type="button" data-act="zoom-out" aria-label="Zoom out">&minus;</button>
          <button class="btn" type="button" data-act="spin" aria-pressed="false">Spin</button>
        </div>
      </div>
      <div class="globe-side">
        <div><div class="globe-label">Color airports by</div>
          <div class="seg" role="group" aria-label="Color airports by">${AT.NUM.map((n) => `<button type="button" data-m="${n.key}" aria-pressed="false">${AT.METRIC[n.key].icon}<span>${e(n.short)}</span></button>`).join("")}</div></div>
        <div class="globe-legend" id="globe-legend"></div>
        <div class="globe-info" id="globe-info" aria-live="polite"></div>
      </div></div>`;

    const canvas = el.querySelector("canvas");
    const ctx = canvas.getContext("2d");
    const projection = d3.geoOrthographic().clipAngle(90).precision(0.5);
    const path = d3.geoPath(projection, ctx);

    let size = 0, zoom = 1, metric = "temp_c", selected = null, hover = null;
    let rot = [95, -28];                 // rotation [lambda, phi]; the view is centered on [-lambda, -phi]
    let auto = !reduced, drag = null, tween = null, dirty = true, last = performance.now(), pal = {};

    function palette() {
      const v = AT.cssVar;
      pal = { ocean: v("--globe-ocean"), oceanHi: v("--globe-ocean-hi"), land: v("--globe-land"), landLine: v("--globe-land-line"),
        line: v("--globe-grid"), ring: v("--card"), accent: v("--accent"), text: v("--text"), lo: hexToRgb(v("--globe-ramp-lo")) };
      dirty = true;
    }

    function resize() {
      const w = Math.max(240, Math.min(el.querySelector(".globe-stage").clientWidth, 560));
      const dpr = window.devicePixelRatio || 1;
      size = w;
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(w * dpr);
      canvas.style.width = `${w}px`; canvas.style.height = `${w}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dirty = true;
    }

    // value -> color for the chosen metric
    function range(key) {
      const v = items.map((i) => i.row[key]).filter((x) => x !== null);
      return v.length ? [Math.min(...v), Math.max(...v)] : [0, 1];
    }
    function colorOf(row) {
      const value = row[metric];
      if (value === null) return "#9aa5b8";
      if (metric === "temp_c") return AT.tempColor(value).bg;
      const [lo, hi] = range(metric);
      const t = hi === lo ? 0.5 : (value - lo) / (hi - lo);
      return mix(pal.lo, hexToRgb(AT.cssVar(AT.METRIC[metric].color)), 0.2 + 0.8 * t);
    }

    function visible(item) {
      const center = [-rot[0], -rot[1]];
      return d3.geoDistance([item.lon, item.lat], center) < Math.PI / 2 - 0.03;
    }

    function draw() {
      const R = size / 2 * 0.94 * zoom;
      projection.translate([size / 2, size / 2]).scale(R).rotate([rot[0], rot[1]]);
      ctx.clearRect(0, 0, size, size);
      const g = ctx.createRadialGradient(size * 0.42, size * 0.36, R * 0.1, size / 2, size / 2, R);
      g.addColorStop(0, pal.oceanHi); g.addColorStop(1, pal.ocean);
      ctx.beginPath(); path({ type: "Sphere" }); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); path(graticule); ctx.strokeStyle = pal.line; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.beginPath(); path(land); ctx.fillStyle = pal.land; ctx.fill(); ctx.strokeStyle = pal.landLine; ctx.lineWidth = 0.6; ctx.stroke();
      ctx.beginPath(); path({ type: "Sphere" }); ctx.strokeStyle = pal.landLine; ctx.lineWidth = 1.2; ctx.stroke();

      const shown = items.filter(visible).map((i) => ({ i, p: projection([i.lon, i.lat]) }))
        .sort((a, b) => (a.i === selected) - (b.i === selected));
      for (const { i, p } of shown) {
        const on = i === selected, hot = i === hover;
        if (on) { ctx.beginPath(); ctx.arc(p[0], p[1], 12, 0, 7); ctx.strokeStyle = pal.accent; ctx.lineWidth = 2.5; ctx.stroke(); }
        ctx.beginPath(); ctx.arc(p[0], p[1], on || hot ? 7.5 : 6, 0, 7);
        ctx.fillStyle = colorOf(i.row); ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = pal.ring; ctx.stroke();
      }
      ctx.font = "600 12px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.lineJoin = "round";
      for (const { i, p } of shown) {
        if (i !== selected && i !== hover) continue;
        ctx.lineWidth = 4; ctx.strokeStyle = pal.ring; ctx.strokeText(i.iata, p[0], p[1] - 16);
        ctx.fillStyle = pal.text; ctx.fillText(i.iata, p[0], p[1] - 16);
      }
      dirty = false;
    }

    // --- side panel ----------------------------------------------------------------------------
    function legend() {
      const box = document.getElementById("globe-legend");
      const n = AT.NUM.find((x) => x.key === metric);
      let stops, lo, hi;
      if (metric === "temp_c") {
        stops = [-10, 0, 10, 20, 30, 38].map((t) => AT.tempColor(t).bg).join(",");
        lo = "-10"; hi = "38 or more";
      } else {
        const [a, b] = range(metric);
        stops = `${mix(pal.lo, hexToRgb(AT.cssVar(AT.METRIC[metric].color)), 0.2)},${mix(pal.lo, hexToRgb(AT.cssVar(AT.METRIC[metric].color)), 1)}`;
        lo = AT.fmt(a); hi = AT.fmt(b);
      }
      box.innerHTML = `<div class="ramp" style="background:linear-gradient(90deg,${stops})"></div><div class="ramp-labels"><span>${e(lo)}</span><span>${e(n.label)} (${e(n.unit)})</span><span>${e(hi)}</span></div>`;
    }

    function info() {
      const box = document.getElementById("globe-info");
      if (!selected) {
        const withT = items.filter((i) => i.row.temp_c !== null).sort((a, b) => a.row.temp_c - b.row.temp_c);
        const cold = withT[0], warm = withT[withT.length - 1];
        box.innerHTML = `<p class="muted small">Drag the globe to rotate it, or click an airport to see its weather.</p>` +
          (withT.length ? `<ul class="extremes"><li><span class="muted">Warmest</span> <button class="linkish" data-pick="${e(warm.item_id)}">${e(warm.row.item)}</button> <strong>${AT.fmt(warm.row.temp_c)} °C</strong></li>
          <li><span class="muted">Coldest</span> <button class="linkish" data-pick="${e(cold.item_id)}">${e(cold.row.item)}</button> <strong>${AT.fmt(cold.row.temp_c)} °C</strong></li></ul>` : "");
        return;
      }
      const r = selected.row, p = prevById.get(r.item_id);
      const lines = AT.NUM.map((n) => {
        const d = p && r[n.key] !== null && p[n.key] !== null ? r[n.key] - p[n.key] : null;
        const small = d === null || Math.abs(d) < 0.05;
        return `<tr><td>${AT.METRIC[n.key].icon} ${e(n.short)}</td><td class="num"><strong>${AT.fmt(r[n.key])}</strong> ${e(n.unit)}</td>
          <td class="num ${small ? "muted" : d > 0 ? "up" : "down"}">${d === null ? "" : small ? "no change" : AT.fmtSigned(d)}</td></tr>`;
      }).join("");
      box.innerHTML = `<div class="sel"><strong>${e(r.item)}</strong><div class="muted small">${e(r.item_id)} · ${e(r.iata)} · ${e(r.city)}, ${e(r.country)}</div>
        <table class="mini"><thead><tr><th></th><th class="num">Now</th><th class="num">Since previous run</th></tr></thead><tbody>${lines}</tbody></table>
        <button class="btn" type="button" data-pick="">Clear selection</button></div>`;
    }

    function setMetric(key) {
      metric = key;
      el.querySelectorAll("[data-m]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === key)));
      legend(); dirty = true;
    }

    function turnTo(item) {
      const to = [-item.lon, clamp(-item.lat, -60, 60)];
      const dl = ((to[0] - rot[0] + 540) % 360) - 180;
      tween = { from: [rot[0], rot[1]], dl, dp: to[1] - rot[1], t0: performance.now(), dur: 700 };
      auto = false; syncSpin();
    }
    function pick(id) {
      selected = id ? items.find((i) => i.item_id === id) || null : null;
      if (selected) turnTo(selected);
      info(); dirty = true;
    }
    function syncSpin() { el.querySelector('[data-act="spin"]').setAttribute("aria-pressed", String(auto)); }

    function hit(ev) {
      const rect = canvas.getBoundingClientRect();
      const x = ev.clientX - rect.left, y = ev.clientY - rect.top;
      let best = null, bestD = 14;
      for (const i of items) {
        if (!visible(i)) continue;
        const p = projection([i.lon, i.lat]);
        const d = Math.hypot(p[0] - x, p[1] - y);
        if (d < bestD) { best = i; bestD = d; }
      }
      return best;
    }

    // --- input ---------------------------------------------------------------------------------
    canvas.addEventListener("pointerdown", (ev) => { canvas.setPointerCapture(ev.pointerId); drag = { x: ev.clientX, y: ev.clientY, moved: 0 }; tween = null; });
    canvas.addEventListener("pointermove", (ev) => {
      if (drag) {
        const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
        drag.x = ev.clientX; drag.y = ev.clientY; drag.moved += Math.abs(dx) + Math.abs(dy);
        if (drag.moved > 4) { auto = false; syncSpin(); }
        const k = 0.28 / zoom;
        rot = [rot[0] + dx * k, clamp(rot[1] - dy * k, -90, 90)];
        dirty = true;
      } else {
        const h = hit(ev);
        if (h !== hover) { hover = h; canvas.style.cursor = h ? "pointer" : "grab"; dirty = true; }
      }
    });
    const endDrag = (ev) => {
      if (drag && drag.moved < 5) pick((hit(ev) || {}).item_id || null);
      drag = null;
    };
    canvas.addEventListener("pointerup", endDrag);
    canvas.addEventListener("pointercancel", () => { drag = null; });
    canvas.addEventListener("pointerleave", () => { if (hover) { hover = null; dirty = true; } });
    canvas.addEventListener("keydown", (ev) => {
      const step = 8 / zoom;
      const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
      if (!moves[ev.key]) return;
      ev.preventDefault();
      rot = [rot[0] + moves[ev.key][0], clamp(rot[1] + moves[ev.key][1], -90, 90)];
      auto = false; syncSpin(); dirty = true;
    });
    canvas.style.cursor = "grab";
    canvas.style.touchAction = "none";

    el.addEventListener("click", (ev) => {
      const m = ev.target.closest("[data-m]"); if (m) return setMetric(m.dataset.m);
      const p = ev.target.closest("[data-pick]"); if (p) return pick(p.dataset.pick);
      const a = ev.target.closest("[data-act]"); if (!a) return;
      if (a.dataset.act === "zoom-in") zoom = clamp(zoom * 1.25, 0.8, 2.6);
      if (a.dataset.act === "zoom-out") zoom = clamp(zoom / 1.25, 0.8, 2.6);
      if (a.dataset.act === "spin") { auto = !auto; syncSpin(); }
      dirty = true;
    });

    // --- loop ----------------------------------------------------------------------------------
    function frame(now) {
      const dt = Math.min(now - last, 50); last = now;
      if (tween) {
        const k = clamp((now - tween.t0) / tween.dur, 0, 1), s = 1 - Math.pow(1 - k, 3);
        rot = [tween.from[0] + tween.dl * s, tween.from[1] + tween.dp * s];
        if (k >= 1) tween = null;
        dirty = true;
      } else if (auto && !drag && !hover) { rot = [rot[0] + dt * 0.008, rot[1]]; dirty = true; }
      if (dirty) draw();
      requestAnimationFrame(frame);
    }

    palette();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { palette(); legend(); });
    new ResizeObserver(resize).observe(el.querySelector(".globe-stage"));
    resize(); setMetric("temp_c"); syncSpin(); info();
    requestAnimationFrame(frame);
  }

  window.AT.globe = globe;
})();
