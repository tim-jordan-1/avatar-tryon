import test from 'node:test';
import assert from 'node:assert/strict';
import { createSweep, sharpness } from './sweep.js';

// A head turn 0 -> -75 -> +75 -> 0 at 30 fps, with a little pitch wobble.
function turn(step = 0.9) {
  const out = [];
  for (let y = 0; y > -75; y -= step) out.push(y);
  for (let y = -75; y < 75; y += step) out.push(y);
  for (let y = 75; y > 0; y -= step) out.push(y);
  return out.map((yaw, i) => ({ yaw, pitch: 4 * Math.sin(i / 9), faceFrac: 0.4, sharp: 100 + (i % 7), data: i }));
}

test('one sweep fills every bin, front first, each photo near its bin centre', () => {
  const s = createSweep();
  for (const f of turn()) s.push(f);
  assert.equal(s.progress(), 1);
  assert.ok(s.ready());
  const photos = s.photos();
  assert.equal(photos.length, 11);
  assert.ok(Math.abs(photos[0].yaw) <= 3);
  s.best.forEach((f, i) => assert.ok(Math.abs(f.yaw - s.centres[i]) <= 3));
});

test('the sharper of two frames in a bin wins, and blurred, tilted or small faces are refused', () => {
  const s = createSweep();
  assert.equal(s.push({ yaw: 20.5, pitch: 0, faceFrac: 0.4, sharp: 50 }).kept, true);
  assert.equal(s.push({ yaw: 19, pitch: 0, faceFrac: 0.4, sharp: 40 }).kept, false);
  assert.equal(s.push({ yaw: 21, pitch: 0, faceFrac: 0.4, sharp: 80 }).kept, true);
  assert.equal(s.best[7].sharp, 80);
  assert.equal(s.push({ yaw: 25, pitch: 0, faceFrac: 0.4, sharp: 999 }).bin, -1); // between bins
  assert.equal(s.push({ yaw: 30, pitch: 20, faceFrac: 0.4, sharp: 999 }).bin, -1);
  assert.equal(s.push({ yaw: 30, pitch: 0, faceFrac: 0.1, sharp: 999 }).bin, -1);
  assert.equal(s.push(null).bin, -1);
  assert.equal(s.ready(), false);
});

test('sharpness drops when an image is blurred', () => {
  const w = 32, h = 32, sharp = new Float32Array(w * h), blur = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) sharp[i] = ((i % w) >> 2) % 2 ? 255 : 0; // vertical stripes
  for (let y = 0; y < h; y++) for (let x = 2; x < w - 2; x++) {
    let s = 0; for (let k = -2; k <= 2; k++) s += sharp[y * w + x + k];
    blur[y * w + x] = s / 5;
  }
  assert.ok(sharpness(sharp, w, h) > 3 * sharpness(blur, w, h));
});
