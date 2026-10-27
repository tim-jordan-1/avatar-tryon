import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { rgb2hex } from './hair.js';
import { loadFaceModels, toCanvas, analyseViews, VIEW_NAMES } from './analyse.js';
import { loadHead, correspond, buildTwin } from './head.js';
import { findLandmarks, fitBody } from './mhbody.js';
import { parseSizeChart } from '../fit-map/sizechart.js';
import { fitReport, recommendSize } from '../fit-map/fit.js';
import { PRESETS, defaultPresetFor, parseMhclo, parseObj as parseProxyObj, fitProxy, expand } from './hair-presets.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const NAMES = VIEW_NAMES;

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
const photos = [null, null, null]; // canvases at analysis size

// --- models ---
let landmarker, segmenter, mhHead, mhCorr, mhLm;
(async () => {
  try {
    ({ landmarker, segmenter } = await loadFaceModels({ wasm: WASM, faceModel: FACE_MODEL, segModel: SEG_MODEL }));
    status('Loading the MakeHuman head…');
    await loadBodyModel($('b-sex').value);
    status(`Models ready (${mhCorr.size} face points matched on the MakeHuman head). Add three photos or load a sample.`);
    refresh();
  } catch (e) { status(`Could not load the models: ${e.message}`); }
})();

// --- photo input ---
function preview(slot, overlay) {
  const out = $(`c${slot}`), g = out.getContext('2d'), src = photos[slot];
  g.clearRect(0, 0, out.width, out.height);
  if (!src) return;
  const k = Math.max(out.width / src.width, out.height / src.height), w = src.width * k, h = src.height * k;
  g.drawImage(overlay || src, (out.width - w) / 2, (out.height - h) / 2, w, h);
}
const refresh = () => { $('run').disabled = !(mhCorr && photos.every(Boolean)); };

document.querySelectorAll('input[type=file]').forEach((inp) => inp.addEventListener('change', async () => {
  const f = inp.files[0];
  if (!f) return;
  photos[+inp.dataset.slot] = toCanvas(await createImageBitmap(f, { imageOrientation: 'from-image' }));
  preview(+inp.dataset.slot);
  refresh();
}));
document.querySelectorAll('[data-sample]').forEach((b) => b.addEventListener('click', async () => {
  const set = b.dataset.sample;
  await Promise.all(['front', 'left', 'right'].map(async (v, i) => {
    const img = new Image();
    img.src = `./samples/${set}-${v}.png`;
    await img.decode();
    photos[i] = toCanvas(img);
    preview(i);
  }));
  refresh();
}));

// --- analysis ---
function overlay(c, a) {
  const o = Object.assign(document.createElement('canvas'), { width: c.width, height: c.height }), g = o.getContext('2d');
  g.drawImage(c, 0, 0);
  if (!a.face) return o;
  const img = g.getImageData(0, 0, o.width, o.height);
  for (let i = 0; i < a.mask.length; i++) if (a.mask[i] === 1) { img.data[i * 4] = img.data[i * 4] * 0.4 + 255 * 0.6; img.data[i * 4 + 1] *= 0.6; }
  g.putImageData(img, 0, 0);
  g.fillStyle = '#8fd1a8';
  for (const p of a.lmPx) g.fillRect(p.x - 1, p.y - 1, 2, 2);
  return o;
}

$('run').addEventListener('click', async () => {
  $('run').disabled = true;
  status('Analysing…');
  await new Promise((r) => setTimeout(r, 30));
  const out = analyseViews({ landmarker, segmenter }, photos), res = out.res;
  res.forEach((a, i) => preview(i, overlay(photos[i], a)));
  if (!out.ok) {
    status(`No face found in: ${out.missing.join(', ')}. Retake with the face fully in view.`);
    showChecks(res, null, 0);
    refresh();
    return;
  }
  const { fused, mmPerPx, hair, skin } = out;
  showChecks(res, fused, mmPerPx);
  showEstimates(hair, skin, fused, mmPerPx);
  const stats = buildHead(res, fused, mmPerPx, hair, skin);
  status(`Done: ${Math.round((100 * stats.photoTris) / stats.tris)}% of the head textured from photos. Drag to orbit; scroll to zoom.`);
  window.__twin = { fused, hair, skin, mmPerPx, stats, yaws: fused.views.map((v) => v.yaw), metrics: res.map((a) => a.metrics) }; // for inspection in devtools
  refresh();
});

function showChecks(res, fused, mmPerPx) {
  const target = [[-12, 12], [35, 80], [-80, -35]];
  $('checks').querySelector('tbody').innerHTML = res.map((a, i) => {
    if (!a.face) return `<tr><td>${NAMES[i]}</td><td class="bad">Not found</td><td></td><td></td></tr>`;
    const v = fused.views[i], [lo, hi] = target[i], ok = v.yaw >= lo && v.yaw <= hi;
    const hint = ok ? '' : i === 0 ? ' (face the camera)' : Math.sign(v.yaw) !== Math.sign(lo) && Math.abs(v.yaw) > 25 ? ' (left and right swapped?)' : ' (turn further)';
    return `<tr><td>${NAMES[i]}</td><td class="ok">Found</td><td class="${ok ? 'ok' : 'bad'}">${v.yaw.toFixed(0)}°${hint}</td><td>${(v.rms * mmPerPx).toFixed(1)} mm</td></tr>`;
  }).join('');
}

function showEstimates(hair, skin, fused, mmPerPx) {
  const P = fused.points, d = (a, b) => Math.hypot(...[0, 1, 2].map((k) => P[a][k] - P[b][k])) * mmPerPx;
  const rows = [
    ['Hair length', hair.length + (hair.below != null ? ` <span style="color:var(--muted)">(ends ${hair.below.toFixed(2)} face heights below the ear)</span>` : '')],
    ['Hair colour', hair.hex ? `<span class="swatch" style="background:${hair.hex}"></span>${hair.colour.name} · ${hair.hex}` : 'None found'],
    ['Skin tone', `<span class="swatch" style="background:${rgb2hex(skin)}"></span>${rgb2hex(skin)}`],
    ['Face width (cheekbones)', `${d(234, 454).toFixed(0)} mm`],
    ['Face height (forehead to chin)', `${d(10, 152).toFixed(0)} mm`],
    ['Head depth, nose tip to ear', `${(Math.abs(P[1][2] - (P[234][2] + P[454][2]) / 2) * mmPerPx).toFixed(0)} mm`],
  ];
  $('est').querySelector('tbody').innerHTML = rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join('');
}

// --- 3D head ---
const host = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.localClippingEnabled = true;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
camera.position.set(0.3, 0.06, 0.75);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f72, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(0.5, 0.6, 1);
scene.add(key);
const head = new THREE.Group();
scene.add(head);
new ResizeObserver(() => {
  renderer.setSize(host.clientWidth, host.clientHeight);
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
}).observe(host);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// Body targets in metres from the form (cm). Thigh and calf default to ANSUR II median ratios of the hip.
function bodyTargets() {
  const v = (id) => +$(id).value / 100;
  const hip = v('b-hip');
  return { height: v('b-height'), chest: v('b-chest'), waist: v('b-waist'), hip, shoulder: v('b-shoulder'), inseam: v('b-inseam'), thigh: hip * 0.61, calf: hip * 0.379 };
}

// Load (or reload, when the sex changes) the MakeHuman body, its face-point matches and its landmarks.
async function loadBodyModel(sex) {
  mhHead = await loadHead(sex || null);
  mhCorr = correspond(mhHead, landmarker);
  mhLm = findLandmarks(mhHead.body.pos, mhHead.body.idx);
}
$('b-sex').addEventListener('change', async () => {
  status('Loading the body shape…');
  await loadBodyModel($('b-sex').value);
  if (last) buildHead(last.res, last.fused, last.mmPerPx, last.hair, last.skin);
  status('Body shape updated.');
});

// --- fit map: a shop size chart against the body measurements, coloured by region on the body ---
const CHARTS = {
  'nike-tops': ['nike-tops', { brand: 'Nike', garment: 'tops' }], 'nike-bottoms': ['nike-bottoms', { brand: 'Nike', garment: 'bottoms' }],
  'asos-tops': ['asos', { brand: 'ASOS', garment: 'tops', table: 'Tops' }], 'asos-jeans': ['asos', { brand: 'ASOS', garment: 'jeans', table: 1 }],
  'lulu-tops': ['lululemon', { brand: 'Lululemon', garment: 'tops', table: 'tops' }], 'lulu-bottoms': ['lululemon', { brand: 'Lululemon', garment: 'bottoms', table: 'bottoms' }],
};
// Status colours differ in lightness as well as hue (blue/orange, not red/green alone).
const STATUS_RGB = { good: [0.3, 0.62, 0.48], snug: [0.93, 0.68, 0.24], tight: [0.83, 0.33, 0.16], loose: [0.29, 0.5, 0.86] };
const chartCache = new Map();
async function currentChart() {
  const id = $('chart').value;
  if (!id) return null;
  if (!chartCache.has(id)) {
    const [file, opts] = CHARTS[id];
    chartCache.set(id, parseSizeChart(await (await fetch(`../fit-map/fixtures/${file}.md`)).text(), opts));
  }
  return chartCache.get(id);
}
const bodyCm = () => { const t = bodyTargets(); return { height: t.height * 100, chest: t.chest * 100, waist: t.waist * 100, hip: t.hip * 100, inseam: t.inseam * 100 }; };
let fitRows = null;
async function updateFit() {
  const chart = await currentChart();
  fitRows = null;
  if (!chart) { $('fit').innerHTML = ''; return; }
  const body = bodyCm(), rec = recommendSize(body, chart);
  if (!$('size').dataset.chart || $('size').dataset.chart !== $('chart').value) {
    $('size').innerHTML = chart.sizes.map((s) => `<option value="${s.label}">${s.label}${s.label === rec.label ? ' (recommended)' : ''}</option>`).join('');
    $('size').value = rec.label; $('size').dataset.chart = $('chart').value;
  }
  fitRows = fitReport(body, chart, $('size').value);
  $('fit').innerHTML = `<p class="note">Recommended: ${rec.label}. ${rec.reason}.</p><table><tbody>${fitRows.map((r) =>
    `<tr><th>${r.region}</th><td><span class="swatch" style="background:rgb(${STATUS_RGB[r.status].map((x) => Math.round(x * 255)).join(',')})"></span>${r.status}</td><td>you ${r.body} cm, size ${r.lo}–${r.hi} cm</td></tr>`).join('')}</tbody></table>`;
}
// Bands on the body for each measured region, by height between the fitted landmarks; torso only.
function fitTint(lm, skin) {
  if (!fitRows) return null;
  const status = Object.fromEntries(fitRows.map((r) => [r.region, r.status])), t = bodyTargets();
  const bands = [
    ['chest', (lm.waistY + lm.chestY) / 2, lm.armpitY + 0.03, t.chest],
    ['waist', (lm.hipY + lm.waistY) / 2, (lm.waistY + lm.chestY) / 2, t.waist],
    ['hip', lm.crotchY, (lm.hipY + lm.waistY) / 2, t.hip],
  ].filter(([r]) => status[r]);
  const sk = skin.map((c) => c / 255);
  return ([x, y]) => {
    const b = bands.find(([, y0, y1, girth]) => y >= y0 && y < y1 && Math.abs(x) < 0.2 * girth);
    if (!b) return null;
    const c = STATUS_RGB[status[b[0]]];
    return c.map((v, i) => Math.min(2.5, v / Math.max(0.05, sk[i]))); // factor that turns the skin colour into the status colour
  };
}
$('chart').addEventListener('change', async () => { await updateFit(); rebuild(); });
$('size').addEventListener('change', async () => { await updateFit(); rebuild(); });
const rebuild = () => last && buildHead(last.res, last.fused, last.mmPerPx, last.hair, last.skin);

// --- hair presets (MakeHuman CC0 proxies), fitted to the warped head ---
let twin = null, hairPicked = false, hairMesh = null;
const proxyCache = new Map();
$('hair').innerHTML = ['<option value="">No hair</option>', ...PRESETS.map((p) => `<option value="${p.id}">${p.name} (${p.lengthClass})</option>`)].join('');
$('hair').addEventListener('change', () => { hairPicked = true; showHair(); });

// The preset texture, recoloured to the estimated hair colour: keep its light and dark pattern and its alpha.
function recolour(img, rgb) {
  const c = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height }), g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height), px = d.data;
  let sum = 0, n = 0;
  for (let i = 0; i < px.length; i += 4) if (px[i + 3] > 128) { sum += px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11; n++; }
  const mean = sum / Math.max(1, n);
  for (let i = 0; i < px.length; i += 4) {
    const k = (px[i] * 0.3 + px[i + 1] * 0.59 + px[i + 2] * 0.11) / mean;
    for (let ch = 0; ch < 3; ch++) px[i + ch] = Math.min(255, rgb[ch] * k);
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

async function showHair() {
  if (hairMesh) { hairMesh.parent?.remove(hairMesh); hairMesh = null; }
  const id = $('hair').value, p = PRESETS.find((x) => x.id === id);
  if (!twin || !p) return;
  if (!proxyCache.has(id)) {
    status(`Loading hair: ${p.name}…`);
    const [obj, mhclo, img] = await Promise.all([fetch(p.objUrl).then((r) => r.text()), fetch(p.mhcloUrl).then((r) => r.text()),
      new Promise((ok, fail) => { const im = new Image(); im.crossOrigin = 'anonymous'; im.onload = () => ok(im); im.onerror = fail; im.src = p.textureUrl; })]);
    proxyCache.set(id, { obj: parseProxyObj(obj), mhclo: parseMhclo(mhclo), img });
  }
  const { obj, mhclo, img } = proxyCache.get(id), fitted = fitProxy(mhclo, twin.basePos);
  for (let i = 0; i < fitted.length; i += 3) fitted.set(twin.fromMH([fitted[i], fitted[i + 1], fitted[i + 2]]), i);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(expand(fitted, obj.vIndex), 3));
  g.setAttribute('uv', new THREE.BufferAttribute(obj.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(obj.indices, 1));
  g.computeVertexNormals();
  hairMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: recolour(img, twin.hairRgb ?? [60, 45, 35]), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6 }));
  twin.group.add(hairMesh);
  status(`Hair: ${p.name}.`);
}

let last = null; // the last analysis, so the view can switch without re-analysing
function buildHead(res, fused, mmPerPx, hair, skin) {
  last = { res, fused, mmPerPx, hair, skin };
  head.clear();
  const onBody = $('view-mode').value === 'body';
  const fit = onBody ? fitBody(mhHead.body.pos, mhHead.body.idx, bodyTargets(), mhLm) : null;
  const tint = onBody ? fitTint(fit.landmarks, skin) : null;
  const { group, stats, basePos, fromMH } = buildTwin({ head: mhHead, corr: mhCorr, res, fused, skinHex: rgb2hex(skin), mmPerPx, photos, deform: fit?.deform, tint });
  twin = { group, basePos, fromMH, hairRgb: hair.rgb };
  if (!hairPicked && hair.length) $('hair').value = hair.hex ? defaultPresetFor(hair.length).id : '';
  showHair();
  if (onBody) {
    head.add(group); // already in metres, feet on the floor
    controls.target.set(0, 0.9, 0);
    camera.position.set(1.1, 1.15, 4.4);
  } else {
    // The head alone is built in photo pixels: scale to metres and centre it.
    const k = mmPerPx / 1000, P = fused.points, c = [0, 1, 2].map((ax) => (P[234][ax] + P[454][ax]) / 2);
    group.scale.setScalar(k);
    group.position.set(-c[0] * k, -c[1] * k, -c[2] * k);
    head.add(group);
    controls.target.set(0, 0.02, 0);
    camera.position.set(0.3, 0.06, 0.75);
  }
  return stats;
}
// Camera presets. On the body the face sits at the top of the fitted height.
document.querySelectorAll('[data-cam]').forEach((b) => b.addEventListener('click', () => {
  const onBody = $('view-mode').value === 'body', H = onBody ? bodyTargets().height : 0;
  if (b.dataset.cam === 'face') { const y = onBody ? H - 0.12 : 0.02; controls.target.set(0, y, 0); camera.position.set(0.18, y + 0.03, 0.75); }
  else if (onBody) { controls.target.set(0, 0.9, 0); camera.position.set(1.1, 1.15, 4.4); }
  else { controls.target.set(0, 0.02, 0); camera.position.set(0.3, 0.06, 0.75); }
}));
$('view-mode').addEventListener('change', () => last && buildHead(last.res, last.fused, last.mmPerPx, last.hair, last.skin));
$('rebuild').addEventListener('click', async () => { await updateFit(); rebuild(); });
