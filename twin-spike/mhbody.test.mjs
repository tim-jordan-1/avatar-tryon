// Run: node --test twin-spike/
// The fit is checked with avatar-poc's virtual tape (measure.js), which shares no code with mhbody.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sliceLoops, torsoOf, legGirth, fitBody } from './mhbody.js';
import { buildBody } from '../avatar-poc/body.js';
import { measureBody } from '../avatar-poc/measure.js';

// A test body with known landmarks: the avatar PoC's parametric body for an average man (metres).
const src = buildBody({ height: 178, chest: 100, waist: 86, hip: 100, shoulder: 46 });
const pos = Array.from(src.positions), idx = Array.from(src.indices), B = src.landmarks;
const at = (y) => sliceLoops(pos, idx, y);
const L = {
  lo: 0, hi: 1.78, crotchY: B.crotchY + 0.001, hipY: B.hipY, waistY: B.waistY, chestY: B.chestY, armpitY: B.armpitY,
  shoulderY: B.shoulderY, neckY: B.neckY, thighY: B.thighY, calfY: B.calfY,
  girth: { hip: torsoOf(at(B.hipY)).girth, waist: torsoOf(at(B.waistY)).girth, chest: torsoOf(at(B.chestY)).girth, thigh: legGirth(at(B.thighY), 1), calf: legGirth(at(B.calfY), 1) },
  shoulderWidth: torsoOf(at(B.shoulderY)).width,
};

test('slices find the torso and a leg with the tape girths of the PoC body', () => {
  assert.ok(Math.abs(L.girth.chest - 1.0) < 0.005, `chest ${L.girth.chest}`);
  assert.ok(Math.abs(L.girth.hip - 1.0) < 0.005, `hip ${L.girth.hip}`);
  assert.ok(Math.abs(L.girth.thigh - src.measurements.thigh / 100) < 0.005, `thigh ${L.girth.thigh}`);
});

for (const target of [
  { height: 1.63, chest: 0.92, waist: 0.74, hip: 1.0, shoulder: 0.39, inseam: 0.78, thigh: 0.6, calf: 0.37 },
  { height: 1.95, chest: 1.12, waist: 1.0, hip: 1.06, shoulder: 0.5, inseam: 0.92, thigh: 0.64, calf: 0.4 },
]) {
  test(`fit to ${target.height} m: an independent tape on the deformed body reads the targets within 1 cm`, () => {
    const fit = fitBody(pos, idx, target, L);
    const out = new Float32Array(src.positions.length);
    for (let i = 0; i < pos.length; i += 3) out.set(fit.deform([pos[i], pos[i + 1], pos[i + 2]], i / 3), i);
    const lm = fit.landmarks;
    const got = measureBody({ ...src, positions: out, landmarks: { ...src.landmarks, chestY: lm.chestY, waistY: lm.waistY, hipY: lm.hipY, shoulderY: lm.shoulderY, thighY: lm.thighY, calfY: lm.calfY, neckMidY: lm.neckY + 0.02 } });
    for (const k of ['height', 'chest', 'waist', 'hip', 'shoulder', 'inseam', 'thigh', 'calf']) {
      assert.ok(Math.abs(got[k] - target[k] * 100) <= 1, `${k}: tape ${got[k]} cm, target ${target[k] * 100} cm`);
    }
  });
}
