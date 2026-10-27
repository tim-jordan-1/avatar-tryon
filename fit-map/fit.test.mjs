// Run: node --test fit-map/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMarkdownTables, parseSizeChart, parseRange } from './sizechart.js';
import { fitReport, recommendSize, LEGEND } from './fit.js';

const fixture = (name) => readFileSync(new URL(`./fixtures/${name}.md`, import.meta.url), 'utf8');
const ranges = (chart, label) => chart.sizes.find((s) => s.label === label).ranges;

const CHARTS = {
  nikeTops: parseSizeChart(fixture('nike-tops'), { brand: 'Nike', garment: 'tops' }),
  nikeBottoms: parseSizeChart(fixture('nike-bottoms'), { brand: 'Nike', garment: 'bottoms' }),
  asosTops: parseSizeChart(fixture('asos'), { brand: 'ASOS', garment: 'tops', table: 'Tops' }),
  asosJeans: parseSizeChart(fixture('asos'), { brand: 'ASOS', garment: 'jeans', table: 1 }),
  asosLeg: parseSizeChart(fixture('asos'), { brand: 'ASOS', garment: 'trousers', table: 'smart trousers' }),
  luluTops: parseSizeChart(fixture('lululemon'), { brand: 'Lululemon', garment: 'tops', table: 'tops' }),
  luluBottoms: parseSizeChart(fixture('lululemon'), { brand: 'Lululemon', garment: 'bottoms', table: 'bottoms' }),
};

test('markdown tables: separator rows dropped, headings picked up', () => {
  const t = parseMarkdownTables(fixture('asos'));
  assert.deepEqual(t.map((x) => x.heading), [
    'Tops, Knitwear, Casual Jackets and Shirts', 'Jeans, Casual Trousers and Shorts', 'Jeans and Casual Smart Trousers',
  ]);
  assert.deepEqual(t[0].rows[0], ['UK/European/USA Size', 'Inches (Chest)', 'CM (Chest)']);
  assert.deepEqual(parseMarkdownTables(fixture('lululemon')).map((x) => x.heading), ['Bottoms Size Chart', 'Tops Size Chart']);
});

test('Nike: sizes as columns, cm ranges, open height bound', () => {
  const { nikeTops, nikeBottoms } = CHARTS;
  assert.deepEqual(nikeTops.sizes.map((s) => s.label), ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL', '4XL']);
  assert.deepEqual(ranges(nikeTops, 'M'), { chest: [96, 104], waist: [81, 89], hip: [96, 104], height: [170, 183] });
  assert.deepEqual(ranges(nikeTops, 'XXS').height, [-Infinity, 170]);
  assert.deepEqual(ranges(nikeBottoms, '4XL'), { waist: [133, 145], hip: [136, 148], height: [170, 183] });
});

test('ASOS: sizes as rows, cm column preferred over "To Fit" inches, single values', () => {
  const { asosTops, asosJeans, asosLeg } = CHARTS;
  assert.deepEqual(ranges(asosTops, 'M'), { chest: [96, 101] });
  assert.deepEqual(asosJeans.sizes.map((s) => s.label), ['28', '30', '32', '34', '36', '38']);
  assert.deepEqual(ranges(asosJeans, '34'), { waist: [86, 86] });
  // The trailing one-cell note row has no values and is dropped.
  assert.deepEqual(asosLeg.sizes.map((s) => [s.label, s.ranges.inseam]), [['Short', [76, 76]], ['Regular', [81, 81]], ['Long', [86, 86]]]);
});

test('Lululemon: inches with fractions, alpha alias rows', () => {
  const { luluTops, luluBottoms } = CHARTS;
  assert.deepEqual(ranges(luluTops, 'M'), { chest: [99.1, 101.6] }); // 39"-40"
  assert.deepEqual(luluTops.sizes.find((s) => s.label === 'M').aliases, ['M/L']);
  assert.equal(luluTops.sizes.find((s) => s.label === '3XL').aliases, undefined); // "-" is not an alias
  assert.equal(luluBottoms.sizes.length, 20);
  const s32 = luluBottoms.sizes.find((s) => s.label === '32');
  assert.deepEqual(s32, { label: '32', aliases: ['M'], ranges: { waist: [83.8, 83.8], hip: [100.3, 100.3] } }); // 33", 39 1/2"
});

test('both orientations give the same chart; unknown rows are ignored', () => {
  const cols = '| Size | A | B |\n| Chest (cm) | 90-100 | 100-110 |\n| Waist (cm) | 80-84 | 84-88 |\n| Neck (cm) | 38 | 40 |';
  const rows = '| Size | Chest (cm) | Waist (cm) | Neck (cm) |\n|---|---|---|---|\n| A | 90-100 | 80-84 | 38 |\n| B | 100-110 | 84-88 | 40 |';
  const a = parseSizeChart(cols, { brand: 'X', garment: 'tee' }), b = parseSizeChart(rows, { brand: 'X', garment: 'tee' });
  assert.deepEqual(a, b);
  assert.deepEqual(a.sizes[0].ranges, { chest: [90, 100], waist: [80, 84] });
});

test('cell parsing: To Fit, inch header, fractions, open bounds, junk', () => {
  assert.deepEqual(parseRange('To Fit 38-40', true), [96.5, 101.6]);
  assert.deepEqual(parseRange('33 1/2"'), [85.1, 85.1]);
  assert.deepEqual(parseRange('> 190'), [190, Infinity]);
  assert.equal(parseRange('-'), null);
  assert.throws(() => parseSizeChart(fixture('asos'), { brand: 'ASOS', table: 'hats' }), /no table/);
});

test('fitReport: good, snug, tight, loose against Nike M chest 96-104', () => {
  const status = (chest) => fitReport({ chest }, CHARTS.nikeTops, 'M')[0];
  assert.deepEqual(status(100), { region: 'chest', body: 100, lo: 96, hi: 104, delta: 0, status: 'good' });
  assert.deepEqual([status(105).delta, status(105).status], [1, 'snug']);
  assert.deepEqual([status(106).delta, status(106).status], [2, 'snug']);
  assert.deepEqual([status(107).delta, status(107).status], [3, 'tight']);
  assert.deepEqual([status(95).delta, status(95).status], [-1, 'loose']);
  assert.deepEqual([status(90).delta, status(90).status], [-6, 'loose']);
  assert.equal(fitReport({ chest: 100 }, CHARTS.nikeTops, 'M').length, 1, 'missing regions are skipped');
  assert.deepEqual(LEGEND.map((l) => l.status), ['tight', 'snug', 'good', 'loose']);
});

test('recommendSize: 178 cm man, chest 100, waist 86, hip 100', () => {
  const man = { height: 178, chest: 100, waist: 86, hip: 100, inseam: 85.6 }; // inseam = 0.481 x height, the avatar default
  const picks = Object.fromEntries(Object.entries(CHARTS).map(([k, c]) => [k, recommendSize(man, c).label]));
  assert.deepEqual(picks, {
    nikeTops: 'M', nikeBottoms: 'M', asosTops: 'M', asosJeans: '34', asosLeg: 'Long', luluTops: 'M',
    // 32 (alpha M): his waist is 2.2 cm over 33", his hip 0.3 cm under 39 1/2". 33 is 2.9 cm off at the hip.
    luluBottoms: '32',
  });
  assert.match(recommendSize(man, CHARTS.nikeTops).reason, /inside/);
  assert.match(recommendSize(man, CHARTS.luluBottoms).reason, /2.2 cm at waist \(tight\)/);
});

test('recommendSize: priority region breaks a tie', () => {
  const md = '| Size | Chest (cm) | Waist (cm) |\n| A | 90-100 | 80-84 |\n| B | 100-110 | 84-88 |';
  const chart = parseSizeChart(md, { brand: 'X', garment: 'tee' });
  const body = { chest: 101, waist: 83 }; // A: chest +1, waist 0. B: chest 0, waist -1.
  assert.equal(recommendSize(body, chart).label, 'B'); // default priority: chest
  assert.equal(recommendSize(body, chart, { priority: 'waist' }).label, 'A');
  assert.match(recommendSize(body, chart).reason, /chest decides/);
  assert.throws(() => recommendSize({ inseam: 80 }, chart), /no body measurement/);
});
