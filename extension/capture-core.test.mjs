// Run: node --test extension/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { yawFromMatrix, sideSlot, jitter, createCapture, HOLD_MS } from './capture-core.js';

// Column-major 4x4 for a head turned by `deg` about the vertical axis: third column = (sin, 0, cos).
const matrix = (deg) => { const a = (deg * Math.PI) / 180; return [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]; };
const OK = { faceFrac: 0.5, jitter: 0.002 };
// Feeds frames every 33 ms from t0; returns the last result and every capture.
function run(core, yaws, { t0 = 0, dt = 33, ...rest } = {}) {
  const caught = [];
  let r;
  yaws.forEach((yaw, i) => { r = core.push(t0 + i * dt, yaw === null ? null : { yaw, ...OK, ...rest }); if (r.captured !== null) caught.push(r.captured); });
  return { r, caught, end: t0 + yaws.length * dt };
}
const steady = (yaw, ms = HOLD_MS + 100) => Array(Math.ceil(ms / 33)).fill(yaw);

test('yaw from the pose matrix: magnitude and sign are symmetric', () => {
  assert.ok(Math.abs(Math.abs(yawFromMatrix(matrix(50))) - 50) < 1e-9);
  assert.ok(Math.abs(yawFromMatrix(matrix(0))) < 1e-9);
  assert.equal(Math.sign(yawFromMatrix(matrix(30))), -Math.sign(yawFromMatrix(matrix(-30))));
});

test('sides are labelled by the sign of the yaw, not the order', () => {
  assert.equal(sideSlot(50), 1);
  assert.equal(sideSlot(-50), 2);
});

test('front, then left, then right', () => {
  const c = createCapture();
  const a = run(c, [...steady(0), ...steady(50)]);
  assert.deepEqual(a.caught, [0, 1]);
  assert.deepEqual(c.wanted(), [2]);
  const b = run(c, [...steady(-50)], { t0: a.end });
  assert.deepEqual(b.caught, [2]);
  assert.ok(b.r.done);
});

test('wrong way first is accepted as that side, then the other side is asked for', () => {
  const c = createCapture();
  run(c, steady(0));
  const a = run(c, steady(-55), { t0: 5000 });
  assert.deepEqual(a.caught, [2]);
  assert.deepEqual(c.wanted(), [1]);
  assert.equal(run(c, [-55], { t0: 9000 }).r.hint, 'other'); // same side again: no capture
});

test('no capture before the pose has held long enough', () => {
  const c = createCapture();
  const { caught, r } = run(c, Array(Math.floor(HOLD_MS / 33) - 1).fill(0));
  assert.deepEqual(caught, []);
  assert.equal(r.hint, 'hold');
  assert.ok(r.progress > 0.8 && r.progress < 1);
});

test('a yaw that wanders more than 6 degrees restarts the hold', () => {
  const c = createCapture();
  const wander = Array.from({ length: 20 }, (_, i) => (i % 2 ? 7 : 0)).map((y) => y * 0.99); // |yaw| < 8, range 6.9
  assert.deepEqual(run(c, wander).caught, []);
});

test('hints: no face, too far, blurry, wrong yaw window', () => {
  assert.equal(run(createCapture(), [null]).r.hint, 'noface');
  assert.equal(createCapture().push(0, { yaw: 0, faceFrac: 0.2, jitter: 0 }).hint, 'closer');
  assert.equal(createCapture().push(0, { yaw: 0, faceFrac: 0.5, jitter: 0.05 }).hint, 'still');
  assert.equal(createCapture().push(0, { yaw: 20, ...OK }).hint, 'front');
  const c = createCapture();
  run(c, steady(0));
  assert.equal(c.push(9000, { yaw: 30, ...OK }).hint, 'more');
  assert.equal(c.push(9033, { yaw: 80, ...OK }).hint, 'less');
});

test('a blurry or lost frame resets the hold, so no capture', () => {
  const c = createCapture();
  const half = steady(0, HOLD_MS - 100);
  const a = run(c, half);
  const b = run(c, [0], { t0: a.end, jitter: 0.05 });
  const d = run(c, half, { t0: b.end });
  assert.deepEqual([...a.caught, ...b.caught, ...d.caught], []);
});

test('retake asks for that photo only', () => {
  const c = createCapture();
  run(c, [...steady(0)]);
  run(c, steady(50), { t0: 5000 });
  run(c, steady(-50), { t0: 9000 });
  c.retake(1);
  assert.deepEqual(c.wanted(), [1]);
  assert.deepEqual(run(c, steady(50), { t0: 20000 }).caught, [1]);
});

test('jitter: a still face reads 0, a shifted face reads its move over the face height', () => {
  const lm = Array.from({ length: 10 }, (_, i) => ({ x: 0.5, y: 0.3 + i * 0.02 })); // face height 0.18
  assert.equal(jitter(lm, lm, 16 / 9), 0);
  const moved = lm.map((p) => ({ x: p.x + 0.018, y: p.y }));
  assert.ok(Math.abs(jitter(lm, moved, 1) - 0.1) < 1e-9);
});
