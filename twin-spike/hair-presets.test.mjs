// Run: node --test twin-spike/hair-presets.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PRESETS, LENGTH_CLASSES, defaultPresetFor, parseMhclo, parseObj, fitProxy } from './hair-presets.js';

const fixture = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const BASE_OBJ = 'https://cdn.jsdelivr.net/gh/makehumancommunity/makehuman@a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/3dobjs/base.obj';
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} vs ${b}`);

test('fitProxy moves a proxy vertex with its reference triangle and scales offsets per axis', () => {
  const mhclo = parseMhclo(`# comment
name test
obj_file test.obj
x_scale 0 1 1.0
y_scale 0 2 1.0
z_scale 0 3 1.0
verts 0
0 1 2 0.2 0.3 0.5 0.1 0.2 0.3
1 2 3 0.5 0.25 0.25
  3
delete_verts
5 8 - 10
`);
  assert.equal(mhclo.count, 3);
  assert.deepEqual(mhclo.deleteVerts, [5, 8, 9, 10]);
  assert.deepEqual(mhclo.scale, { x: [0, 1, 1], y: [0, 2, 1], z: [0, 3, 1] });
  const rest = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const S = [2, 3, 4], t = [5, -1, 7]; // stretch the base mesh per axis, then shift it
  const moved = rest.map((p) => p.map((x, k) => x * S[k] + t[k]));
  const got = fitProxy(mhclo, (i) => moved[i]);
  const expect = [
    [0, 1, 2].reduce((acc, r, n) => acc.map((x, k) => x + [0.2, 0.3, 0.5][n] * moved[r][k]), [0, 0, 0]).map((x, k) => x + S[k] * [0.1, 0.2, 0.3][k]),
    [1, 2, 3].reduce((acc, r, n) => acc.map((x, k) => x + [0.5, 0.25, 0.25][n] * moved[r][k]), [0, 0, 0]),
    moved[3],
  ];
  expect.flat().forEach((x, i) => near(got[i], x, 1e-6, `coord ${i}`));
});

test('parseMhclo rejects offsets it cannot reproduce', () => {
  assert.throws(() => parseMhclo('shear_x 1 2 0.1 0.2\nverts 0\n1\n'), /shear/);
  assert.throws(() => parseMhclo('x_scale 1 2 0.5\nverts 0\n1\n'), /x_scale/);
});

test('parseObj fans polygons into triangles and splits vertices at UV seams', () => {
  const o = parseObj('v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nvt 0.5 0.5\nf 1/1 2/2 3/3 4/4\nf 1/5 3/3 4/4\n');
  assert.equal(o.positions.length, 12);
  assert.deepEqual([...o.indices], [0, 1, 2, 0, 2, 3, 4, 2, 3]);
  assert.deepEqual([...o.vIndex], [0, 1, 2, 3, 0]); // v1 appears twice, with two UVs
  assert.deepEqual([...o.uvs.slice(8)], [0.5, 0.5]);
});

test('real short04.mhclo has one reference per proxy .obj vertex', () => {
  const m = parseMhclo(fixture('short04.mhclo')), o = parseObj(fixture('short04.obj'));
  assert.equal(m.count, 865);
  assert.equal(m.count, o.positions.length / 3);
  assert.equal(m.objFile, 'short04.obj');
  assert.equal(m.material, 'short04.mhmat');
  assert.ok(m.refs.every((r) => r >= 0 && r < 19158), 'refs index base.obj v lines');
  for (let p = 0; p < m.count; p++) near(m.weights[p * 3] + m.weights[p * 3 + 1] + m.weights[p * 3 + 2], 1, 0.02, `weights ${p}`);
  assert.ok(o.indices.length > 0 && o.indices.every((i) => i < o.vIndex.length));
});

test('fitProxy on the undeformed base.obj reproduces short04.obj', async (t) => {
  let text;
  try { text = await (await fetch(BASE_OBJ)).text(); } catch { return t.skip('offline: cannot fetch base.obj'); }
  const base = parseObj(text).positions;
  assert.equal(base.length / 3, 19158);
  const m = parseMhclo(fixture('short04.mhclo')), o = parseObj(fixture('short04.obj'));
  const got = fitProxy(m, (i) => [base[i * 3], base[i * 3 + 1], base[i * 3 + 2]]);
  let max = 0;
  for (let i = 0; i < got.length; i++) max = Math.max(max, Math.abs(got[i] - o.positions[i]));
  assert.ok(max < 1e-3, `max error ${max} dm`);
});

test('every length class has a preset with pinned URLs', () => {
  for (const c of LENGTH_CLASSES) assert.equal(defaultPresetFor(c).lengthClass, c);
  assert.equal(defaultPresetFor('nonsense').id, 'short02');
  for (const p of PRESETS) {
    for (const u of [p.objUrl, p.mhcloUrl, p.textureUrl]) assert.match(u, /@?[0-9a-f]{40}\//, `${p.id} pinned`);
    assert.match(p.licence, /CC0/);
  }
});
