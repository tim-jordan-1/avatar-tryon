import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildBody, validate } from './body.js';
import { measureBody, unionVolumeLitres as volumeLitres } from './measure.js';
import { animate } from './anim.js';

const KG_PER_LITRE = 1.0;

const DEFAULT = { height: 178, shoulder: 46, chest: 100, waist: 86, hip: 100 };
const SKINS = ['#f3d5c0', '#e8b998', '#c68e6a', '#a86b48', '#7a4a2e', '#4a2c1c'];
const STORE = 'avatar-poc-measurements';

// --- scene ---
const host = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.3;
controls.maxDistance = 8;

scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f72, 1.4));
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(1.5, 3, 2.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.2 });
scene.add(key);
const rim = new THREE.DirectionalLight(0xbfd4ff, 1.0);
rim.position.set(-2, 2, -2.5);
scene.add(rim);
const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.ShadowMaterial({ opacity: 0.25 }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);
const grid = new THREE.PolarGridHelper(1.6, 8, 6, 64, 0x999999, 0xcccccc);
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

function resize() {
  const { clientWidth: w, clientHeight: h } = host;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);

// --- skin + face texture ---
const skinMat = new THREE.MeshStandardMaterial({ color: '#c68e6a', roughness: 0.6 });
const faceCanvas = Object.assign(document.createElement('canvas'), { width: 512, height: 512 });
const faceTex = new THREE.CanvasTexture(faceCanvas);
faceTex.colorSpace = THREE.SRGBColorSpace;
const headMat = new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.6 });
let photo = null;

function paintFace() {
  const g = faceCanvas.getContext('2d'), S = 512, skin = document.getElementById('skin').value;
  g.globalCompositeOperation = 'source-over';
  g.fillStyle = skin;
  g.fillRect(0, 0, S, S);
  if (photo) {
    // Centre-crop the photo, then fade it into the skin with a soft oval mask.
    const zoom = +document.getElementById('faceZoom').value, dy = +document.getElementById('faceY').value;
    const side = Math.min(photo.width, photo.height), d = S * 0.62 * zoom;
    const tmp = Object.assign(document.createElement('canvas'), { width: S, height: S }), t = tmp.getContext('2d');
    t.drawImage(photo, (photo.width - side) / 2, (photo.height - side) / 2, side, side, S / 2 - d / 2, S * (0.56 + dy) - d / 2, d, d);
    const mask = t.createRadialGradient(S / 2, S * 0.56, S * 0.16, S / 2, S * 0.56, S * 0.36);
    mask.addColorStop(0, 'rgba(0,0,0,1)');
    mask.addColorStop(1, 'rgba(0,0,0,0)');
    t.globalCompositeOperation = 'destination-in';
    t.fillStyle = mask;
    t.fillRect(0, 0, S, S);
    g.drawImage(tmp, 0, 0);
  }
  faceTex.needsUpdate = true;
}

function setSkin(hex) {
  document.getElementById('skin').value = hex;
  skinMat.color.set(hex);
  paintFace();
}

// Average two cheek patches of the photo (assumes a centred, front-facing face).
function skinFromPhoto() {
  const c = Object.assign(document.createElement('canvas'), { width: 100, height: 100 }), g = c.getContext('2d');
  const side = Math.min(photo.width, photo.height);
  g.drawImage(photo, (photo.width - side) / 2, (photo.height - side) / 2, side, side, 0, 0, 100, 100);
  let r = 0, gr = 0, b = 0, n = 0;
  for (const x0 of [34, 60]) {
    const d = g.getImageData(x0, 55, 6, 6).data;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gr += d[i + 1]; b += d[i + 2]; n++; }
  }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(gr)}${hex(b)}`;
}

// --- avatar ---
let avatar = null, rig = {}, bindHipsY = 0, body = null;

function makeAvatar(input) {
  body = buildBody(input);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(body.positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(body.uvs, 2));
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(body.skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(body.skinWeight, 4));
  geo.setIndex(new THREE.BufferAttribute(body.indices, 1));
  for (const g of body.groups) geo.addGroup(g.start, g.count, g.materialIndex);
  geo.computeVertexNormals();

  const byName = Object.fromEntries(body.bones.map((b, i) => [b.name, i]));
  const bones = body.bones.map((b) => Object.assign(new THREE.Bone(), { name: b.name }));
  body.bones.forEach((b, i) => {
    const parent = b.parent === -1 ? null : body.bones[byName[b.parent]];
    bones[i].position.fromArray(b.pos.map((v, k) => v - (parent ? parent.pos[k] : 0)));
    if (parent) bones[byName[b.parent]].add(bones[i]);
  });

  if (avatar) { scene.remove(avatar); avatar.geometry.dispose(); }
  avatar = new THREE.SkinnedMesh(geo, [skinMat, headMat]);
  avatar.castShadow = true;
  avatar.frustumCulled = false; // skinned bounds do not follow animation
  avatar.add(bones[0]);
  avatar.bind(new THREE.Skeleton(bones));
  scene.add(avatar);
  rig = Object.fromEntries(bones.map((b) => [b.name, b]));
  bindHipsY = bones[0].position.y;
}

// --- camera views ---
const VIEWS = {
  front: [0, 0.55, 3.2, 0.5], side: [3.2, 0.55, 0, 0.5], back: [0, 0.55, -3.2, 0.5],
  three: [2.2, 0.7, 2.4, 0.5], face: [0, 0.93, 0.9, 0.93], waist: [0.4, 0.62, 1.3, 0.62],
};
let flight = null;
function goTo(name) {
  const H = body.measurements.height / 100, [x, y, z, ty] = VIEWS[name];
  flight = { pos: new THREE.Vector3(x * H, y * H, z * H), target: new THREE.Vector3(0, ty * H, 0) };
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.view)));

// --- form ---
const form = document.getElementById('form');
const fields = [...form.querySelectorAll('input[type=number]')];
const sexField = form.querySelector('select[name=sex]');
function readForm() {
  const m = {};
  for (const f of fields) if (f.value !== '') m[f.name] = +f.value;
  if (sexField.value) m.sex = sexField.value;
  return m;
}

function showReadout() {
  const got = measureBody(body), m = body.measurements;
  const rows = [['Height', 'height'], ['Shoulder', 'shoulder'], ['Chest', 'chest'], ['Waist', 'waist'], ['Hip', 'hip'],
    ['Inseam', 'inseam'], ['Neck', 'neck'], ['Thigh', 'thigh'], ['Calf', 'calf']];
  document.querySelector('#readout tbody').innerHTML = rows.map(([label, k]) => {
    const d = got[k] - m[k];
    return `<tr><td>${label}</td><td>${m[k].toFixed(1)}</td><td>${got[k].toFixed(1)}</td><td class="${Math.abs(d) <= 0.5 ? 'ok' : 'off'}">${d >= 0 ? '+' : ''}${d.toFixed(1)}</td></tr>`;
  }).join('');
  implied = volumeLitres(body) * KG_PER_LITRE;
  document.getElementById('implied').textContent = `Avatar volume ${(implied / KG_PER_LITRE).toFixed(1)} L, which implies about ${implied.toFixed(1)} kg.`;
}
let implied = 0;

function build(first, input = readForm()) {
  const errors = validate(input);
  document.getElementById('errors').textContent = errors.join('. ');
  if (errors.length) return;
  makeAvatar(input);
  showReadout();
  try { localStorage.setItem(STORE, JSON.stringify(input)); } catch {}
  if (first) { goTo('three'); camera.position.copy(flight.pos); controls.target.copy(flight.target); flight = null; }
}

form.addEventListener('submit', (e) => { e.preventDefault(); build(false); document.getElementById('realInfo').textContent = ''; });

// --- real people from ANSUR II ---
let sample = null;
async function loadReal(gender) {
  sample ??= await (await fetch('./ansur-sample.json')).json();
  const people = sample.filter((p) => p.gender === gender), p = people[Math.floor(Math.random() * people.length)];
  for (const f of fields) f.value = p.m[f.name] ?? '';
  sexField.value = p.m.sex ?? '';
  form.querySelector('details').open = true;
  build(false, p.m);
  const d = implied - p.kg;
  document.getElementById('realInfo').textContent =
    `Subject ${p.id} (${gender.toLowerCase()}): scale weight ${p.kg.toFixed(1)} kg, avatar implies ${implied.toFixed(1)} kg (${d >= 0 ? '+' : ''}${d.toFixed(1)} kg, ${((d / p.kg) * 100).toFixed(0)}%).`;
}
document.querySelectorAll('[data-real]').forEach((b) => b.addEventListener('click', () => loadReal(b.dataset.real)));

let saved = DEFAULT;
try { saved = JSON.parse(localStorage.getItem(STORE)) || DEFAULT; } catch {}
for (const f of fields) if (saved[f.name] != null) f.value = saved[f.name];
sexField.value = saved.sex ?? '';

// --- skin + photo controls ---
const sw = document.getElementById('swatches');
for (const c of SKINS) {
  const b = Object.assign(document.createElement('button'), { type: 'button', className: 'swatch', title: c });
  b.style.background = c;
  b.setAttribute('aria-label', `Skin tone ${c}`);
  b.onclick = () => setSkin(c);
  sw.appendChild(b);
}
document.getElementById('skin').addEventListener('input', (e) => setSkin(e.target.value));
document.getElementById('faceZoom').addEventListener('input', paintFace);
document.getElementById('faceY').addEventListener('input', paintFace);
document.getElementById('matchSkin').addEventListener('click', () => setSkin(skinFromPhoto()));
document.getElementById('photo').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  photo = await createImageBitmap(file);
  document.getElementById('matchSkin').disabled = false;
  paintFace();
  goTo('face');
});

// --- loop ---
resize();
setSkin('#c68e6a');
build(true);
const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const t = clock.getElapsedTime();
  if (avatar) animate(rig, avatar, bindHipsY, t, document.getElementById('anim').value);
  if (flight) {
    camera.position.lerp(flight.pos, 0.12);
    controls.target.lerp(flight.target, 0.12);
    if (camera.position.distanceTo(flight.pos) < 0.005) flight = null;
  }
  controls.update();
  renderer.render(scene, camera);
});
controls.addEventListener('start', () => { flight = null; });
