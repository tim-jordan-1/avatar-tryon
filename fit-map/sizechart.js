// Shop size charts (markdown tables) to a normalised body-measurement chart in cm. Pure JS, no dependencies.

const REGIONS = [
  ['chest', /chest|bust/i], ['waist', /waist/i], ['hip', /hip/i],
  ['inseam', /inside leg|inseam/i], ['height', /height/i],
];
// "Waist Sizes" (Lululemon) names a size label row, not a measurement.
const regionOf = (text) => (/size/i.test(text) ? null : REGIONS.find(([, re]) => re.test(text))?.[0] ?? null);

// Tables in page order: [{heading, rows: [[cell, ...], ...]}]. heading is the last markdown heading
// above the table, or a one-cell title row at its top (ASOS puts the table name there).
export function parseMarkdownTables(md) {
  const tables = [];
  let heading = '', cur = null;
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('|')) {
      cur = null;
      const h = line.match(/^#+\s+(.*)/);
      if (h) heading = h[1];
      continue;
    }
    const cells = line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (!cur) tables.push((cur = { heading, rows: [] }));
    cur.rows.push(cells);
  }
  for (const t of tables) if (t.rows.length > 1 && t.rows[0].length === 1) t.heading = t.rows.shift()[0];
  return tables;
}

// "96 - 104", "To Fit 38-40", "33 1/2\"", "35\"-36\"", "< 170", "86" -> [lo, hi] in cm, or null.
export function parseRange(cell, inchColumn = false) {
  const nums = [...cell.matchAll(/(\d+(?:\.\d+)?)(?:\s+(\d+)\/(\d+))?/g)].map((m) => +m[1] + (m[2] ? m[2] / m[3] : 0));
  if (nums.length < 1 || nums.length > 2) return null;
  const k = inchColumn || cell.includes('"') ? 2.54 : 1;
  const [a, b = a] = nums.map((v) => Math.round(v * k * 10) / 10);
  if (cell.includes('<')) return [-Infinity, a];
  if (cell.includes('>')) return [a, Infinity];
  return [a, b];
}

const transpose = (rows) => rows[0].map((_, i) => rows.map((r) => r[i] ?? ''));

// options.table picks the table: an index, or a keyword found in its heading (default 0).
export function parseSizeChart(md, { brand, garment, table = 0 } = {}) {
  const tables = parseMarkdownTables(md);
  const t = typeof table === 'number' ? tables[table]
    : tables.find((x) => x.heading.toLowerCase().includes(table.toLowerCase()));
  if (!t) throw new Error(`no table "${table}" in the ${brand} page`);

  // No measurement name in the header row means sizes run across it: transpose so sizes are rows.
  // (Testing the first column instead trips on notes like ASOS's "These are inside leg measurements".)
  const sizesAreColumns = !t.rows[0].some(regionOf);
  const rows = sizesAreColumns ? transpose(t.rows) : t.rows;
  const h = rows.findIndex((r) => r.some(regionOf));
  if (h < 0) throw new Error(`table "${t.heading}" has no body measurements`);
  const [head, ...body] = rows.slice(h);

  const cols = head.map((text, i) => ({ i, key: regionOf(text), cm: /\bcm\b/i.test(text), inch: /inch/i.test(text) }));
  // ASOS gives each measurement in inches and in cm: keep the cm column.
  const cmKeys = new Set(cols.filter((c) => c.key && c.cm).map((c) => c.key));
  const measured = cols.filter((c) => c.key && (c.cm || !cmKeys.has(c.key)));
  const aliasCols = cols.filter((c) => c.i > 0 && !c.key && /size/i.test(head[c.i])).map((c) => c.i);

  const sizes = body.map((r) => {
    const ranges = {};
    for (const c of measured) {
      const v = parseRange(r[c.i] ?? '', c.inch);
      if (v) ranges[c.key] = v;
    }
    const aliases = aliasCols.map((i) => r[i]).filter((a) => a && a !== '-');
    return { label: r[0], ...(aliases.length && { aliases }), ranges };
  }).filter((s) => s.label && Object.keys(s.ranges).length);

  return { brand, garment, kind: 'body', unit: 'cm', sizes };
}
