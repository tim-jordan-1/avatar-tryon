// Per-region fit of a body (cm) against one size of a parsed body chart, and a size pick.

// Tape error and the 1 cm to 5 cm steps between sizes make a hard edge meaningless,
// so up to SNUG_CM over the range is still wearable.
export const SNUG_CM = 2;
export const LEGEND = [
  { status: 'tight', text: `more than ${SNUG_CM} cm over the size range` },
  { status: 'snug', text: `up to ${SNUG_CM} cm over the size range` },
  { status: 'good', text: 'inside the size range' },
  { status: 'loose', text: 'under the size range' },
];

const round = (v) => Math.round(v * 10) / 10;

// One value per size (Cotton On "Bust: 89", ASOS jeans "86") leaves no room inside a size: a body 1 cm off is snug or
// loose. Spread each value to the midpoints with the next sizes, and the end sizes by half a step. Only for a region
// where every size has one value, rising from size to size.
export function widen(chart) {
  const sizes = chart.sizes.map((s) => ({ ...s, ranges: { ...s.ranges } }));
  for (const r of new Set(sizes.flatMap((s) => Object.keys(s.ranges)))) {
    const has = sizes.filter((s) => s.ranges[r]), v = has.map((s) => s.ranges[r][0]);
    if (has.length < 2 || has.some((s, i) => s.ranges[r][1] !== v[i] || (i && v[i] <= v[i - 1]))) continue;
    has.forEach((s, i) => {
      s.ranges[r] = [round(i ? (v[i - 1] + v[i]) / 2 : v[0] - (v[1] - v[0]) / 2), round(i < v.length - 1 ? (v[i] + v[i + 1]) / 2 : v[i] + (v[i] - v[i - 1]) / 2)];
    });
  }
  return { ...chart, sizes };
}

export function fitReport(body, chart, sizeLabel) {
  const size = chart.sizes.find((s) => s.label === sizeLabel);
  if (!size) throw new Error(`no size ${sizeLabel} in ${chart.brand} ${chart.garment}`);
  return Object.entries(size.ranges).filter(([r]) => Number.isFinite(body[r])).map(([region, [lo, hi]]) => {
    const v = body[region];
    const delta = round(v > hi ? v - hi : v < lo ? v - lo : 0);
    const status = delta > SNUG_CM ? 'tight' : delta > 0 ? 'snug' : delta < 0 ? 'loose' : 'good';
    return { region, body: v, lo, hi, delta, status };
  });
}

// Smallest worst-case |delta| wins; on a tie, the smaller |delta| at the priority region
// (Nike: tops follow chest, bottoms follow hip), then chart order.
export function recommendSize(body, chart, { priority } = {}) {
  priority ??= ['chest', 'hip', 'waist', 'inseam', 'height'].find((r) => chart.sizes.some((s) => s.ranges[r]));
  const scored = chart.sizes.map((s) => {
    const rows = fitReport(body, chart, s.label);
    const worst = rows.reduce((w, r) => (Math.abs(r.delta) > Math.abs(w.delta) ? r : w), rows[0]);
    return { label: s.label, rows, worst, pri: Math.abs(rows.find((r) => r.region === priority)?.delta ?? 0) };
  }).filter((s) => s.rows.length);
  if (!scored.length) throw new Error(`no body measurement matches ${chart.brand} ${chart.garment}`);
  scored.sort((a, b) => Math.abs(a.worst.delta) - Math.abs(b.worst.delta) || a.pri - b.pri);

  const [best, next] = scored, w = best.worst;
  let reason = w.delta === 0 ? 'every measured region is inside the size range'
    : `largest deviation ${Math.abs(w.delta)} cm at ${w.region} (${w.status})`;
  if (next && Math.abs(next.worst.delta) === Math.abs(w.delta)) {
    reason += next.pri === best.pri ? `; tied with ${next.label}, first in chart order`
      : `; tied with ${next.label}, ${priority} decides`;
  }
  return { label: best.label, reason };
}
