import { createTryOn } from './tryon.js';
import { ozToGsm } from './fabric.js';

const DEFAULT = { height: 178, shoulder: 46, chest: 100, waist: 86, hip: 100 };
// Other bodies come from the URL, for example ?height=175&chest=98&waist=84&hip=98&shoulder=45&sex=male.
const query = new URLSearchParams(location.search);
const sex = query.get('sex') === 'female' ? 'female' : 'male';
const measurements = { ...DEFAULT, ...Object.fromEntries([...query].filter(([k]) => k in DEFAULT).map(([k, v]) => [k, +v])) };
const FABRICS = {
  jersey: { composition: '100% cotton', gsm: 180, construction: 'jersey', color: '#5b7fa6' },
  rib: { composition: '95% cotton 5% elastane', gsm: 220, construction: 'rib', color: '#e9e4da' },
  denim: { composition: '100% cotton', gsm: ozToGsm(12), construction: 'denim', color: '#2f4466' },
};
const SIZES = { S: 96, M: 104, L: 112, XL: 120 };
const $ = (id) => document.getElementById(id);

const tryon = await createTryOn($('view'), { measurements, sex });
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => tryon.view(b.dataset.view)));

for (const [k, cm] of [['chest + 10 cm', tryon.body.measurements.chest + 10], ...Object.entries(SIZES)]) {
  $('size').append(new Option(`${k}${k.startsWith('chest') ? '' : ` (${cm} cm)`}`, cm));
}
const garment = () => { const { color, ...fabric } = FABRICS[$('fabric').value]; return { fabric, garmentChest: +$('size').value, color }; };
function rebuild() {
  const fp = tryon.setGarment(garment());
  $('params').querySelector('tbody').innerHTML = [
    ['Composition', garment().fabric.composition], ['Mass', `${Math.round(fp.massPerArea * 1000)} g/m²`],
    ['Stretch', `${Math.round(fp.stretchStiffness)} N/m`], ['Shear', `${Math.round(fp.shearStiffness)} N/m`],
    ['Bend', `${fp.bendStiffness.toExponential(0)} N·m`], ['Max stretch', `${Math.round((fp.maxStretch - 1) * 100)}%`],
  ].map(([k, val]) => `<tr><td>${k}</td><td>${val}</td></tr>`).join('');
}
$('fabric').addEventListener('change', rebuild);
$('size').addEventListener('change', rebuild);
$('reset').addEventListener('click', rebuild);
$('anim').addEventListener('change', () => tryon.setMode($('anim').value));
tryon.setMode($('anim').value);
rebuild();
$('status').textContent = `Jolt 1.1.0 ready. Avatar: ${query.size ? 'from the URL' : 'default man'}, ${sex}, height ${measurements.height} cm, chest ${tryon.body.measurements.chest} cm.`;

setInterval(() => {
  const s = tryon.stats();
  $('stats').querySelector('tbody').innerHTML = [
    ['Frames per second', s.fps.toFixed(0)], ['Physics step', `${s.stepMs.toFixed(1)} ms`],
    ['Cloth vertices', s.vertices], ['Cloth triangles', s.triangles],
    ['Inside body now', `${s.inside} (${((s.inside / Math.max(1, s.vertices)) * 100).toFixed(1)}%)`], ['of which in sleeves', s.sleeve],
  ].map(([k, val]) => `<tr><td>${k}</td><td>${val}</td></tr>`).join('');
}, 250);

// Verification hook: window.clothTest(seconds, mode) runs with the selected fabric and size.
window.__tryon = tryon; // for checks from devtools
window.clothTest = (seconds = 10, mode = 'walk') => ({ fabric: $('fabric').value, ...tryon.test(seconds, mode, garment()) });
