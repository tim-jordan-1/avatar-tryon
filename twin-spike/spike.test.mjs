// Run: node --test twin-spike/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fuseViews, similarity, apply, yawDegrees } from './fuse.js';
import { hairMetrics, classifyHair, nameColour } from './hair.js';

// Synthetic "face": 478 points on the front half of an ellipsoid head (pixels).
function rng(seed) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
const rand = rng(7);
const TRUTH = Array.from({ length: 478 }, () => {
  const th = (rand() - 0.5) * Math.PI * 0.95, ph = (rand() - 0.5) * Math.PI * 0.9;
  return [80 * Math.sin(th) * Math.cos(ph), 110 * Math.sin(ph), 90 * Math.cos(th) * Math.cos(ph)];
});
const rotY = (deg) => { const a = (deg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a); return [[c, 0, s], [0, 1, 0], [-s, 0, c]]; };
const view = (deg, scale, t, noise) => TRUTH.map((p) => {
  const R = rotY(deg), q = [0, 1, 2].map((r) => R[r][0] * p[0] + R[r][1] * p[1] + R[r][2] * p[2]);
  return q.map((v, k) => v * scale + t[k] + (rand() - 0.5) * noise);
});

test('similarity recovers a known rotation, scale and shift', () => {
  const src = TRUTH, dst = view(-55, 1.3, [40, -20, 5], 0);
  const T = similarity(src, dst);
  assert.ok(Math.abs(T.s - 1.3) < 1e-6, `scale ${T.s}`);
  assert.ok(Math.abs(yawDegrees(T) + 55) < 1e-6, `yaw ${yawDegrees(T)}`);
  const err = Math.max(...src.map((p, i) => Math.hypot(...apply(T, p).map((v, k) => v - dst[i][k]))));
  assert.ok(err < 1e-6, `max error ${err}`);
});

test('fusion recovers head turns of about 55 degrees and averages out noise', () => {
  const front = view(0, 1, [300, -400, 0], 2), left = view(55, 0.9, [280, -390, 0], 2), right = view(-55, 1.1, [320, -410, 0], 2);
  const { points, views } = fuseViews([front, left, right]);
  assert.ok(Math.abs(views[1].yaw + 55) < 1.5, `left yaw ${views[1].yaw}`);
  assert.ok(Math.abs(views[2].yaw - 55) < 1.5, `right yaw ${views[2].yaw}`);
  // The fused shape matches the truth (up to a similarity) better than the noise in one photo.
  const T = similarity(points, TRUTH), err = Math.sqrt(points.reduce((s, p, i) => s + apply(T, p).reduce((a, v, k) => a + (v - TRUTH[i][k]) ** 2, 0), 0) / points.length);
  assert.ok(err < 1.2, `fused RMS error ${err.toFixed(2)} px (photo noise RMS ~1.0 px)`);
});

// Synthetic photo: 200x260, face landmarks only at the indices hair.js reads, a mask painted in bands.
function photo({ hairTo, hairColour }) {
  const w = 200, h = 260, mask = new Uint8Array(w * h), rgba = new Uint8ClampedArray(w * h * 4);
  const lm = Array.from({ length: 478 }, () => ({ x: 100, y: 130 }));
  Object.assign(lm, { 10: { x: 100, y: 70 }, 152: { x: 100, y: 170 }, 234: { x: 60, y: 120 }, 454: { x: 140, y: 120 }, 159: { x: 85, y: 105 }, 386: { x: 115, y: 105 } });
  lm[0] = { x: 62, y: 120 }; lm[1] = { x: 138, y: 120 };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, inFace = x > 62 && x < 138 && y > 70 && y < 170, inHair = x > 45 && x < 155 && y > 55 && y < hairTo && !inFace;
    mask[i] = inFace ? 3 : inHair ? 1 : 0;
    const c = inFace ? [198, 150, 120] : inHair ? hairColour : [40, 40, 45];
    rgba.set([...c, 255], i * 4);
  }
  return { mask, rgba, w, h, lm };
}

test('hair: short dark brown, neck-length black, long blonde, and none', () => {
  // The synthetic ear (tragion) is at y = 120 and the face is 100 px tall.
  const short = classifyHair([photo({ hairTo: 125, hairColour: [59, 42, 32] })].map(hairMetrics));
  assert.equal(short.length, 'Short');
  assert.equal(short.colour.name, 'Dark brown');
  const medium = classifyHair([photo({ hairTo: 170, hairColour: [28, 23, 20] })].map(hairMetrics));
  assert.equal(medium.length, 'Medium (neck length)');
  assert.equal(medium.colour.name, 'Black');
  const long = classifyHair([photo({ hairTo: 258, hairColour: [205, 168, 110] })].map(hairMetrics));
  assert.equal(long.length, 'Long');
  assert.equal(long.colour.name, 'Blonde');
  const none = classifyHair([photo({ hairTo: 56, hairColour: [0, 0, 0] })].map(hairMetrics));
  assert.equal(none.length, 'None or shaved');
});

test('one outlier photo cannot decide the length', () => {
  const ok = photo({ hairTo: 125, hairColour: [59, 42, 32] }), shadow = photo({ hairTo: 200, hairColour: [59, 42, 32] });
  assert.equal(classifyHair([ok, shadow, ok].map(hairMetrics)).length, 'Short');
});

test('colour names', () => {
  assert.equal(nameColour([28, 23, 20]).name, 'Black');
  assert.equal(nameColour([150, 150, 148]).name, 'Grey');
});
