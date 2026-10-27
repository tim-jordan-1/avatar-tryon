// Run: node --test avatar-poc/
// The try-on sequence must stay slow enough for the cloth: Jolt has no continuous collision, so a fast arm can
// carry a sleeve vertex through its collider. At this limit the cloth-spike page measured at most 0.02% of the
// cloth inside the body over the sequence. The hand speed is a rough upper bound: arm and forearm speeds added.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { animate, TRYON_SECONDS } from './anim.js';

const NAMES = ['hips', 'spine', 'chest', 'neck', 'head', 'upperArmL', 'upperArmR', 'foreArmL', 'foreArmR', 'handL', 'handR',
  'thighL', 'thighR', 'shinL', 'shinR', 'footL', 'footR'];
const vec = () => ({ x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
const rig = Object.fromEntries(NAMES.map((n) => [n, { rotation: vec(), position: vec() }]));
const avatar = { rotation: vec() };
const HIPS_Y = 1;
const pose = (u, mode) => {
  animate(rig, avatar, HIPS_Y, 100 + u, mode, 100);
  return { hipsY: rig.hips.position.y, ...Object.fromEntries(NAMES.flatMap((n) => ['x', 'y', 'z'].map((a) => [`${n}.${a}`, rig[n].rotation[a]]))) };
};

for (const mode of ['tryon', 'tryonCalm']) {
  test(`${mode}: arms move under 2.5 m/s at the hand and the hop stays under 4 cm`, () => {
    const DT = 1 / 60, ARM = 0.6; // shoulder to hand, m
    let prev = pose(0, mode), maxHand = 0, maxHop = 0;
    for (let u = DT; u <= TRYON_SECONDS; u += DT) {
      const p = pose(u, mode);
      for (const s of ['L', 'R']) {
        // Upper arm swings the whole arm; the forearm swings about half of it.
        const w = (n, r) => Math.hypot(...['x', 'y', 'z'].map((a) => p[`${n}.${a}`] - prev[`${n}.${a}`])) / DT * r;
        maxHand = Math.max(maxHand, w(`upperArm${s}`, ARM) + w(`foreArm${s}`, ARM / 2));
      }
      maxHop = Math.max(maxHop, p.hipsY - HIPS_Y);
      prev = p;
    }
    assert.ok(maxHand < 2.5, `hand speed ${maxHand.toFixed(2)} m/s`);
    assert.ok(maxHop < 0.04, `hop ${(maxHop * 100).toFixed(1)} cm`);
  });

  test(`${mode}: starts and ends in the rest pose of the arms, with no jump`, () => {
    const a = pose(0, mode), b = pose(TRYON_SECONDS, mode);
    for (const k of ['upperArmL.z', 'upperArmR.z', 'upperArmR.x', 'foreArmR.x', 'head.x', 'chest.y']) {
      assert.ok(Math.abs(a[k] - b[k]) < 1e-6, `${k}: ${a[k]} -> ${b[k]}`);
    }
    assert.ok(Math.abs(a['upperArmL.z']) < 1e-6 && Math.abs(a['upperArmR.z']) < 1e-6, 'arms start in the rest pose');
  });
}
