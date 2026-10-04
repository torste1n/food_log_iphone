// History charts, drawn as inline SVG and HTML so they follow the page's light and dark
// colours. Tap (or hover) a column to see its values.

const SVG_NS = "http://www.w3.org/2000/svg";
const HEIGHT = 168;
const MARGIN = { top: 10, right: 4, bottom: 22, left: 26 };
const MAX_BAR = 24;     // a column never fills its slot
const GAP = 2;          // surface gap between stacked segments and neighbouring columns
const RADIUS = 4;       // rounded data end, square at the baseline
const LABEL_CHAR = 6.2; // approximate width of one axis-label character at 11px

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Whole-number axis: at most four steps, each a round count.
function axis(max) {
  const step = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].find((s) => max / s <= 4) ?? 1000;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, ticks };
}

// A column segment: square at the bottom, rounded at the top only when it is the cap.
function segmentPath(x, y, w, h, cap) {
  const r = cap ? Math.min(RADIUS, w / 2, h) : 0;
  return `M${x},${y + h}V${y + r}` + (r ? `Q${x},${y} ${x + r},${y}` : "") + `H${x + w - r}`
    + (r ? `Q${x + w},${y} ${x + w},${y + r}` : "") + `V${y + h}Z`;
}

// buckets: [{ label, showLabel, tip, values: { seriesKey: count } }]
// series:  [{ key, label, color }]  — color is a CSS custom property name such as "--series-1"
// unit:    [singular, plural] of what is being counted
export function columnChart(container, { buckets, series, unit = ["entry", "entries"] }) {
  const width = Math.max(240, container.clientWidth || 340);
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = HEIGHT - MARGIN.top - MARGIN.bottom;
  const totals = buckets.map((b) => series.reduce((sum, s) => sum + (b.values[s.key] || 0), 0));
  const { top, ticks } = axis(Math.max(...totals, 1));
  const band = plotW / buckets.length;
  const barW = Math.max(2, Math.min(MAX_BAR, band - GAP));
  const y = (v) => MARGIN.top + plotH - (v / top) * plotH;

  let svg = `<svg xmlns="${SVG_NS}" viewBox="0 0 ${width} ${HEIGHT}" width="${width}" height="${HEIGHT}" role="img" aria-label="Column chart of ${esc(unit[1])}">`;
  for (const t of ticks) {
    svg += `<line class="${t === 0 ? "axis" : "grid"}" x1="${MARGIN.left}" x2="${width - MARGIN.right}" y1="${y(t)}" y2="${y(t)}"/>`
      + `<text class="tick" x="${MARGIN.left - 6}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
  }
  svg += `<rect class="band-highlight" y="${MARGIN.top}" width="${band}" height="${plotH}" visibility="hidden"/>`;

  buckets.forEach((b, i) => {
    const x = MARGIN.left + i * band + (band - barW) / 2;
    const present = series.filter((s) => b.values[s.key] > 0);
    let acc = 0;
    present.forEach((s, k) => {
      const v = b.values[s.key];
      const yTop = y(acc + v);
      const full = y(acc) - yTop;
      // every segment above the first gives up GAP pixels at its base, so the surface shows through
      const h = k > 0 && full > GAP + 1 ? full - GAP : full;
      svg += `<path style="fill: var(${s.color})" d="${segmentPath(x, yTop, barW, h, k === present.length - 1)}"/>`;
      acc += v;
    });
    if (b.showLabel) {
      // centred under its column, but never past either edge of the chart
      const half = (String(b.label).length * LABEL_CHAR) / 2;
      const centre = MARGIN.left + i * band + band / 2;
      const lx = Math.min(Math.max(centre, MARGIN.left + half), width - MARGIN.right - half);
      svg += `<text class="tick" x="${lx}" y="${HEIGHT - 6}" text-anchor="middle">${esc(b.label)}</text>`;
    }
  });
  svg += "</svg>";

  const legend = series.length > 1
    ? `<div class="legend">${series.map((s) =>
        `<span><i style="background: var(${s.color})"></i>${esc(s.label)}</span>`).join("")}</div>`
    : "";
  const table = `<details class="chart-table"><summary>Show as table</summary><table><thead><tr><th></th>`
    + series.map((s) => `<th>${esc(s.label)}</th>`).join("") + (series.length > 1 ? "<th>Total</th>" : "")
    + `</tr></thead><tbody>`
    + buckets.map((b, i) => (totals[i] === 0 ? "" : `<tr><th>${esc(b.tip)}</th>`
        + series.map((s) => `<td>${b.values[s.key] || 0}</td>`).join("")
        + (series.length > 1 ? `<td>${totals[i]}</td>` : "") + "</tr>")).join("")
    + "</tbody></table></details>";

  container.innerHTML = `${legend}<div class="plot">${svg}<div class="tooltip" hidden></div></div>${table}`;

  // ---- tooltip: the whole band is the hit target, not just the thin column
  const plot = container.querySelector(".plot");
  const tooltip = container.querySelector(".tooltip");
  const highlight = container.querySelector(".band-highlight");
  const hide = () => {
    tooltip.hidden = true;
    highlight.setAttribute("visibility", "hidden");
  };
  const show = (clientX) => {
    const rect = plot.getBoundingClientRect();
    const i = Math.floor((clientX - rect.left - MARGIN.left) / band);
    if (i < 0 || i >= buckets.length) return hide();
    const b = buckets[i];
    const rows = series.length > 1
      ? series.filter((s) => b.values[s.key] > 0).map((s) =>
          `<div class="tip-row"><i style="background: var(${s.color})"></i>${esc(s.label)}<b>${b.values[s.key]}</b></div>`).join("")
      : "";
    tooltip.innerHTML = `<div class="tip-title">${esc(b.tip)}</div>`
      + `<div class="tip-total">${totals[i]} ${esc(unit[totals[i] === 1 ? 0 : 1])}</div>${rows}`;
    tooltip.hidden = false;
    highlight.setAttribute("x", MARGIN.left + i * band);
    highlight.setAttribute("visibility", "visible");
    const centre = MARGIN.left + i * band + band / 2;
    const half = tooltip.offsetWidth / 2;
    tooltip.style.left = `${Math.min(Math.max(centre, half), rect.width - half)}px`;
  };
  plot.addEventListener("pointerdown", (e) => show(e.clientX));
  plot.addEventListener("pointermove", (e) => { if (e.pointerType === "mouse") show(e.clientX); });
  plot.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
  document.addEventListener("pointerdown", (e) => { if (!plot.contains(e.target)) hide(); }, { passive: true });
}

// items: [{ name, count }], already sorted. Ranked bars with the value at the tip.
export function rankedBars(container, items, color = "--series-1") {
  const max = Math.max(...items.map((it) => it.count), 1);
  container.innerHTML = `<div class="hbars">${items.map((it) => `
    <div class="hbar-row">
      <div class="hbar-label">${esc(it.name)}</div>
      <div class="hbar-track">
        <div class="hbar" style="width: ${(it.count / max) * 100}%; background: var(${color})"></div>
        <span class="hbar-value">${it.count}</span>
      </div>
    </div>`).join("")}</div>`;
}
