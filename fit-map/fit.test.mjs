// Run: node --test fit-map/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMarkdownTables, parseSizeChart, parseRange } from './sizechart.js';
import { fitReport, recommendSize, widen, LEGEND } from './fit.js';

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

test('Cotton On: all measurements in one cell, "AU | UK" header, Seat, IN and (IN) headers', () => {
  // cottonon.md is what extension/extract.js makes of fixtures/cottonon.html in Chrome: the cm table, then the inch table.
  const cm = parseSizeChart(fixture('cottonon'), { brand: 'Cotton On', garment: 'tops' });
  const inch = parseSizeChart(fixture('cottonon'), { brand: 'Cotton On', garment: 'tops', table: 1 });
  assert.deepEqual(cm.sizes.map((s) => s.label), ['4XS', '3XS', '2XS', 'XS', 'S', 'M', 'L', 'XL', '2XL']);
  assert.deepEqual(ranges(cm, 'S'), { chest: [89, 89], waist: [72, 72], hip: [98, 98] }); // Thigh is no region
  assert.deepEqual(ranges(inch, 'S'), { chest: [88.9, 88.9], waist: [71.1, 71.1], hip: [97.8, 97.8] }); // 35, 28, 38.5 in
  const pp = parseSizeChart('| AU | BUST (IN) | WAIST (IN) | HIP (IN) |\n| 10 | 36 | 29 | 39 |', { brand: 'Princess Polly' });
  assert.deepEqual(ranges(pp, '10'), { chest: [91.4, 91.4], waist: [73.7, 73.7], hip: [99.1, 99.1] });
});

test('the AU size is an alias: "AU / UK" column (Cotton On), AU row (H&M), but not the label column', () => {
  const co = parseSizeChart(fixture('cottonon'), { brand: 'Cotton On', garment: 'tops' });
  assert.deepEqual(co.sizes.map((s) => s.aliases), [2, 4, 6, 8, 10, 12, 14, 16, 18].map((n) => [`AU ${n}`])); // US and EU are no aliases
  assert.deepEqual(widen(co).sizes.find((s) => s.label === 'S').aliases, ['AU 10']); // the panel widens every chart
  // Rows from the hm.com/en_au size guide of a women's tee: sizes as columns, with an AU row.
  const hm = parseSizeChart('| | XXS | S |\n| AU | 4 | 8-10 |\n| EUR | 32 | 36-38 |\n| Chest cm | 75-78 | 82-90 |', { brand: 'H&M' });
  assert.deepEqual(hm.sizes.map((s) => [s.label, s.aliases]), [['XXS', ['AU 4']], ['S', ['AU 8-10']]]);
  // Princess Polly: the AU column holds the size labels.
  assert.equal(parseSizeChart('| AU | BUST (CM) |\n| 10 | 91 |', { brand: 'Princess Polly' }).sizes[0].aliases, undefined);
});

test('table types: bra, kids and inch tables with no unit are not adult charts', () => {
  // Rows from cottonon.com/AU/size-guide.html, which has every chart of the shop on one page.
  const parse = (md) => parseSizeChart(md, { brand: 'Cotton On' });
  assert.throws(() => parse('| AU | US | EU | BR | UK | Bust |\n| 8A | 30A | 65A | 38A | 30A | 77-79 |\n| 8B | 30B | 65B | 38B | 30B | 79-81 |'), /bra or kids/);
  assert.throws(() => parse('| Age (years) | AU | US / UK | EU | CM |\n| 11-12 girls | 11-12 | 12 | 150 | Height: 150 Chest: 78 Waist: 65 Hip: 82 |\n| 11-12 boys | 11-12 | 12 | 150 | Height: 150 Chest: 76 Waist: 66 Hip: 78 |'), /bra or kids/);
  assert.throws(() => parse('| Size | AU | EU | cm kg |\n| TEENY | 00000 | 50 | Height: 50 Weight: 3 |\n| NEWBORN | 0000 | 56 | Height: 56 Weight: 4 |'), /height 50 cm/);
  assert.throws(() => parse('| Size | Waist (cm) | Height (cm) |\n| 1-2 | 52-54 | 84-92 |\n| 2-3 | 54-55 | 92-100 |'), /height 84 cm/);
  // The Princess Polly inch table without its "(IN)": a 31 cm bust.
  assert.throws(() => parse('| AU | BUST | WAIST | HIP |\n| 4 | 31 | 24 | 34 |\n| 6 | 32 | 25 | 35 |'), /chest 31 cm/);
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

test('widen: one value per size spreads to the midpoints with the next sizes', () => {
  const single = parseSizeChart(fixture('cottonon'), { brand: 'Cotton On', garment: 'tops' }), wide = widen(single);
  assert.deepEqual(ranges(wide, 'S'), { chest: [86.5, 91.5], waist: [70, 74.5], hip: [95.5, 100.5] });
  assert.deepEqual([ranges(wide, '4XS').chest, ranges(wide, '2XL').chest], [[72.5, 75.5], [109.5, 116.5]]); // ends: half a step out
  // Bust 91, waist 74, hip 100: 2 cm over each single S value is snug, and inside the widened S is good.
  const woman = { height: 168, chest: 91, waist: 74, hip: 100 };
  assert.deepEqual(fitReport(woman, single, 'S').map((r) => r.status), ['snug', 'snug', 'snug']);
  assert.deepEqual(fitReport(woman, wide, 'S').map((r) => r.status), ['good', 'good', 'good']);
  assert.equal(recommendSize(woman, wide).label, 'S');
  // Ranges, and values that fall or repeat, stay as they are.
  assert.deepEqual(widen(CHARTS.nikeTops), CHARTS.nikeTops);
  const odd = { sizes: [{ label: 'A', ranges: { waist: [90, 90], hip: [100, 100] } }, { label: 'B', ranges: { waist: [86, 86], hip: [100, 100] } }] };
  assert.deepEqual(widen(odd), odd);
  assert.deepEqual(ranges(single, 'S').chest, [89, 89], 'the input chart is not changed');
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
