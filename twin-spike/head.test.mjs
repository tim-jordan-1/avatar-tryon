// Run: node --test twin-spike/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitWarp } from './rbf.js';

function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }

test('RBF warp hits every centre exactly and stays still at zero anchors', () => {
  const rand = rng(3);
  const centres = Array.from({ length: 60 }, () => [rand() * 10, rand() * 10, rand() * 10]);
  const disp = centres.map((c, i) => (i < 40 ? [Math.sin(c[0]), Math.cos(c[1]), 0.3 * c[2]] : [0, 0, 0]));
  const warp = fitWarp(centres, disp);
  centres.forEach((c, i) => warp(c).forEach((v, k) => assert.ok(Math.abs(v - disp[i][k]) < 1e-6, `centre ${i}`)));
});

test('RBF warp of a pure shift is that shift everywhere', () => {
  const rand = rng(5);
  const centres = Array.from({ length: 30 }, () => [rand(), rand(), rand()]);
  const warp = fitWarp(centres, centres.map(() => [0.5, -1, 2]));
  const v = warp([3, 3, 3]);
  [0.5, -1, 2].forEach((x, k) => assert.ok(Math.abs(v[k] - x) < 1e-6));
});
