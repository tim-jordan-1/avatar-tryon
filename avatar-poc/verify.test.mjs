// Run: node --test avatar-poc/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBody, validate } from './body.js';
import { measureBody, unionVolumeLitres as volumeLitres, volumeLitres as sumLitres } from './measure.js';

const PROFILES = {
  'average man': { height: 178, chest: 100, waist: 86, hip: 100, shoulder: 46 },
  'average woman': { height: 163, chest: 92, waist: 74, hip: 100, shoulder: 39 },
  'tall slim': { height: 198, chest: 92, waist: 76, hip: 92, shoulder: 47, inseam: 95 },
  'short broad': { height: 152, chest: 118, waist: 108, hip: 116, shoulder: 44, thigh: 66 },
};
const TOL_CM = 0.5;

for (const [name, input] of Object.entries(PROFILES)) {
  test(`${name}: tape on the mesh matches the input within ${TOL_CM} cm`, () => {
    assert.deepEqual(validate(input), []);
    const body = buildBody(input);
    const got = measureBody(body);
    for (const k of ['height', 'chest', 'waist', 'hip', 'shoulder', 'inseam', 'neck', 'thigh', 'calf']) {
      const want = body.measurements[k];
      assert.ok(Math.abs(got[k] - want) <= TOL_CM, `${k}: mesh ${got[k]} cm, input ${want} cm`);
    }
  });

  test(`${name}: mesh is well-formed and skinned`, () => {
    const body = buildBody(input);
    const nv = body.positions.length / 3;
    assert.ok(body.indices.every((i) => i < nv), 'index out of range');
    assert.ok(body.positions.every(Number.isFinite), 'non-finite vertex');
    for (let v = 0; v < nv; v++) {
      const w = body.skinWeight.slice(v * 4, v * 4 + 4).reduce((a, b) => a + b, 0);
      assert.ok(Math.abs(w - 1) < 1e-4, `vertex ${v} weights sum to ${w}`);
    }
    assert.ok(body.skinIndex.every((b) => b < body.bones.length), 'bad bone index');
  });

  test(`${name}: body volume is plausible`, () => {
    // Sanity check on the parts nobody measured (limbs, head): human body density is ~1 kg/L and
    // adult BMI rarely leaves 15–45. Overlapping parts inflate volume a little, so the band is wide:
    // it catches gross errors (limbs twice too thick), not a few kilograms.
    const body = buildBody(input);
    const kg = volumeLitres(body), bmi = kg / (input.height / 100) ** 2;
    assert.ok(bmi > 15 && bmi < 45,`implied BMI ${bmi.toFixed(1)} (${kg.toFixed(1)} kg) is implausible`);
  });
}

test('union volume counts overlaps once and matches a single closed part', () => {
  const body = buildBody(PROFILES['average man']);
  assert.ok(volumeLitres(body) < sumLitres(body), 'union must be smaller than the sum of overlapping parts');
  const { start, count } = body.parts.head;
  const head = { ...body, indices: body.indices.subarray(start, start + count), parts: { head: { start: 0, count } } };
  const exact = sumLitres(head), union = volumeLitres(head);
  assert.ok(Math.abs(union - exact) / exact < 0.01, `head: union ${union} L vs exact ${exact} L`);
});

test('validate rejects missing and impossible inputs', () => {
  assert.ok(validate({ height: 178, chest: 100, waist: 86, hip: 100 }).length > 0);
  assert.ok(validate({ height: 178, chest: 100, waist: 86, hip: 100, shoulder: 46, inseam: 120 }).length > 0);
});
