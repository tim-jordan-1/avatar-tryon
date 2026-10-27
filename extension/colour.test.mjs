import test from 'node:test';
import assert from 'node:assert/strict';
import { colourFromName } from './colour.js';

test('known names map to a hex', () => {
  assert.equal(colourFromName('Black'), '#1c1c1e');
  assert.equal(colourFromName('Navy blue'), '#1f2a44');
  assert.equal(colourFromName('  CREAM '), '#f0e6cc');
});
test('light and dark shift the base colour', () => {
  assert.equal(colourFromName('Dark grey'), '#535557');
  assert.ok(parseInt(colourFromName('Light beige').slice(1, 3), 16) > parseInt('d6', 16));
  assert.ok(parseInt(colourFromName('Dark teal').slice(1, 3), 16) < parseInt('2a', 16));
});
test('the first colour of "Black/Striped" counts', () => {
  assert.equal(colourFromName('Black/Striped'), colourFromName('Black'));
  assert.equal(colourFromName('Light sage green'), colourFromName('Light sage green/Checked'));
});
test('unknown names give null, so the caller can try a CSS name', () => {
  assert.equal(colourFromName('Slate Blue'), null);
  assert.equal(colourFromName(''), null);
  assert.equal(colourFromName(undefined), null);
});
