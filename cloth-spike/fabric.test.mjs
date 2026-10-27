// Run: node --test cloth-spike/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fabricParams, parseComposition, ozToGsm } from './fabric.js';

const jersey = fabricParams({ composition: '100% cotton', gsm: 180, construction: 'jersey' });
const denim = fabricParams({ composition: '100% cotton', gsm: ozToGsm(12), construction: 'denim' });

test('denim is stiffer than jersey in stretch, shear and bend', () => {
  assert.ok(denim.stretchCompliance < jersey.stretchCompliance);
  assert.ok(denim.shearCompliance < jersey.shearCompliance);
  assert.ok(denim.bendCompliance < jersey.bendCompliance);
  assert.ok(denim.maxStretch < jersey.maxStretch);
});

test('stiffer fabric damps more and drifts less from the body', () => {
  const woven = fabricParams({ gsm: 150, construction: 'woven' });
  assert.ok(jersey.damping > 0 && jersey.damping < woven.damping && woven.damping < denim.damping);
  assert.ok(jersey.drift > woven.drift && woven.drift > denim.drift);
});

test('elastane lowers stretch stiffness and allows more stretch', () => {
  const stretchy = fabricParams({ composition: '95% cotton 5% elastane', gsm: 180, construction: 'jersey' });
  assert.ok(stretchy.stretchStiffness < jersey.stretchStiffness);
  assert.ok(stretchy.stretchCompliance > jersey.stretchCompliance);
  assert.ok(stretchy.maxStretch > jersey.maxStretch);
  assert.equal(stretchy.bendStiffness, jersey.bendStiffness);
  const spandex = fabricParams({ composition: '95% Cotton, 5% Spandex', gsm: 180, construction: 'jersey' });
  assert.equal(spandex.stretchStiffness, stretchy.stretchStiffness);
});

test('gsm scales mass per area linearly', () => {
  const heavy = fabricParams({ gsm: 360, construction: 'jersey' });
  assert.equal(jersey.massPerArea, 0.18);
  assert.equal(heavy.massPerArea, 2 * jersey.massPerArea);
  assert.ok(Math.abs(ozToGsm(12) - 406.9) < 0.1);
});

test('composition parser and input checks', () => {
  assert.deepEqual(parseComposition('60% cotton 40% polyester'), { cotton: 60, polyester: 40 });
  assert.deepEqual(parseComposition('Cotton 95%, Elastane 5%'), { cotton: 95, elastane: 5 }); // fibre first (H&M style)
  assert.deepEqual(parseComposition('93% organic cotton 7% recycled elastane'), { cotton: 93, elastane: 7 });
  assert.deepEqual(parseComposition('Shell: 95% Cotton, 5% Spandex'), { cotton: 95, spandex: 5 });
  assert.deepEqual(parseComposition('Main: 60% cotton, 40% polyester. Lining: 100% polyester'), { cotton: 60, polyester: 140 });
  assert.equal(fabricParams({ composition: 'Cotton 95%, Elastane 5%', gsm: 180, construction: 'jersey' }).elastane, 0.05);
  assert.throws(() => fabricParams({ gsm: 180, construction: 'felt' }));
  assert.throws(() => fabricParams({ gsm: 0, construction: 'jersey' }));
});
