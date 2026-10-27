// Run: node --test cloth-spike/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBody } from '../avatar-poc/body.js';
import { sliceAt } from '../avatar-poc/measure.js';
import { buildShirt, bodyInside, openEdges } from './shirt.js';

const PROFILES = {
  'average man': { height: 178, chest: 100, waist: 86, hip: 100, shoulder: 46 },
  'average woman': { height: 163, chest: 92, waist: 74, hip: 100, shoulder: 39, sex: 'female' },
};

for (const [name, input] of Object.entries(PROFILES)) {
  const body = buildBody(input, { armAngle: 24 }); // the try-on pose cloth-spike/main.js uses
  const shirt = buildShirt(body, { garmentChest: input.chest + 10 });
  const nv = shirt.positions.length / 3;

  test(`${name}: shirt mesh is well-formed`, () => {
    assert.ok(shirt.indices.every((i) => i < nv), 'index out of range');
    assert.ok(shirt.positions.every(Number.isFinite), 'non-finite vertex');
    const edges = new Map();
    for (let t = 0; t < shirt.indices.length; t += 3) for (let k = 0; k < 3; k++) {
      const a = shirt.indices[t + k], b = shirt.indices[t + (k + 1) % 3];
      assert.notEqual(a, b, 'degenerate triangle');
      const key = Math.min(a, b) * nv + Math.max(a, b);
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
    assert.ok([...edges.values()].every((c) => c <= 2), 'an edge is shared by more than two triangles');
    assert.ok(shirt.pinned.some((p) => p) && !shirt.pinned.every((p) => p));
  });

  // The renderer closes these edges with a rim, so thickness shows at the hem, the sleeve ends and the neck.
  test(`${name}: open edges form closed loops that include the whole neckline and hem`, () => {
    const edges = openEdges(shirt.indices), deg = new Map();
    for (const [a, b] of edges) for (const v of [a, b]) deg.set(v, (deg.get(v) ?? 0) + 1);
    assert.ok(edges.length > 60);
    assert.ok([...deg.values()].every((d) => d === 2), 'every open-edge vertex is on exactly two open edges');
    for (let v = 0; v < nv; v++) if (shirt.pinned[v] === 1) assert.ok(deg.has(v), `neckline vertex ${v} is on an open edge`);
    const hemY = Math.min(...Array.from({ length: nv }, (_, v) => shirt.positions[v * 3 + 1]));
    for (let v = 0; v < nv; v++) if (shirt.positions[v * 3 + 1] < hemY + 1e-4) assert.ok(deg.has(v), 'hem vertex on an open edge');
  });

  test(`${name}: shirt chest girth matches the garment size`, () => {
    const got = sliceAt({ ...shirt, parts: shirt.parts }, 'torso', body.landmarks.chestY).girth * 100;
    assert.ok(Math.abs(got - (input.chest + 10)) < 1.5, `girth ${got.toFixed(1)} cm`);
  });

  // Exact test (ray parity per closed body part). The nearest-vertex test passed this while 152 sleeve and side
  // vertices sat inside the arms: where parts overlap, the nearest vertex can belong to the wrong part.
  test(`${name}: no shirt vertex is inside the body at rest`, () => {
    const inside = bodyInside(body);
    let n = 0;
    for (let v = 0; v < nv; v++) if (inside(shirt.positions[v * 3], shirt.positions[v * 3 + 1], shirt.positions[v * 3 + 2])) n++;
    assert.equal(n, 0);
  });
}
