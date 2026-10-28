// Sweep spike. Renders a known head (a 3D scan) turning left and right like a webcam would see it, picks photos with
// sweep.js, builds the twin from 3, 7 and 15 of them, and scores each twin against the real head at angles that no
// photo saw. Browser only.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadFaceModels, toCanvas, analyseViews } from '../twin-spike/analyse.js';
import { loadHead, correspond, buildTwin } from '../twin-spike/head.js';
import { FACE_SKIN, rgb2hex } from '../twin-spike/hair.js';
import { yawFromMatrix, jitter, createCapture } from '../extension/capture-core.js';
import { createSweep, pitchFromMatrix, sharpness } from './sweep.js';

const WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm';
const FACE_MODEL = 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
const SEG_MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
// Lee Perry-Smith head scan (CC BY 3.0), from the three.js examples, pinned to a release.
const SCAN = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/LeePerrySmith/';
const W = 640, H = 480, FPS = 30, SUBFRAMES = 4, SHUTTER = 0.5; // shutter open for half of each frame
const BODY_SKIN = 2;
const D = Math.PI / 180;
const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
const HELD_OUT_GAP = 4; // degrees of true yaw a test angle keeps from every photo taken
let HELD_OUT;
const SETS = { few: [0, -50, 50], some: [0, -30, -50, 30, 50], all: null }; // bin centres; all = every filled bin

const $ = (id) => document.getElementById(id);
const status = (t) => { $('status').textContent = t; };
const tick = () => new Promise((r) => setTimeout(r, 0));

// The head turn: hold, turn left to 72, turn right to 72, back to the front. Eased like a person turning.
const KEYS = [[0, 0], [0.5, 0], [2.9, -72], [3.2, -72], [8.0, 72], [8.3, 72], [10.7, 0], [11, 0]];
function yawAt(t) {
  for (let i = 1; i < KEYS.length; i++) {
    const [t1, v1] = KEYS[i], [t0, v0] = KEYS[i - 1];
    if (t <= t1) { const u = (t - t0) / (t1 - t0); return v0 + (v1 - v0) * u * u * (3 - 2 * u); }
  }
  return 0;
}
const pitchAt = (t) => 3 * Math.sin((2 * Math.PI * t) / 2.7);
const rollAt = (t) => 1.5 * Math.sin((2 * Math.PI * t) / 3.3);

// --- the real head ---
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setSize(W, H, false);
const BG = new THREE.Color('#5b6068');
const gtScene = new THREE.Scene(), pivot = new THREE.Group();
gtScene.background = BG;
gtScene.add(pivot);
gtScene.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.1));
const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(0.5, 0.6, 1); gtScene.add(key); // fixed room light
let gtCam, baseYaw = 0;

async function loadScan() {
  const [gltf, map] = await Promise.all([new GLTFLoader().loadAsync(SCAN + 'LeePerrySmith.glb'), new THREE.TextureLoader().loadAsync(SCAN + 'Map-COL.jpg')]);
  map.colorSpace = THREE.SRGBColorSpace;
  const geo = gltf.scene.children[0].geometry.clone();
  geo.computeBoundingBox();
  const b = geo.boundingBox, c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
  geo.translate(-c.x, -c.y, -c.z);
  pivot.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: 0.6 })));
  pivot.rotation.order = 'YXZ';
  const fov = 14, dist = (size.y / 0.75) / 2 / Math.tan((fov / 2) * D); // the head fills about 3/4 of the frame height
  gtCam = new THREE.PerspectiveCamera(fov, W / H, dist / 10, dist * 10);
  gtCam.position.set(0, 0, dist);
}

function renderGT(yaw, pitch = 0, roll = 0) {
  pivot.rotation.set(pitch * D, baseYaw + yaw * D, roll * D);
  renderer.render(gtScene, gtCam);
  return toCanvas(renderer.domElement, W);
}

// One video frame: the average of a few renders across the open shutter, so a fast turn blurs like a webcam.
function renderFrame(t) {
  const out = Object.assign(document.createElement('canvas'), { width: W, height: H }), g = out.getContext('2d');
  for (let k = 0; k < SUBFRAMES; k++) {
    const ts = t + (k / SUBFRAMES - 0.5) * (SHUTTER / FPS);
    g.globalAlpha = 1 / (k + 1);
    g.drawImage(renderGT(yawAt(ts), pitchAt(ts), rollAt(ts)), 0, 0);
  }
  return out;
}

function faceSharpness(canvas, lm) {
  const xs = lm.map((p) => p.x * W), ys = lm.map((p) => p.y * H);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.min(W, Math.ceil(Math.max(...xs))) - x0, h = Math.min(H, Math.ceil(Math.max(...ys))) - y0;
  const px = canvas.getContext('2d').getImageData(x0, y0, w, h).data, gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  return sharpness(gray, w, h);
}

// --- the twin ---
const twinScene = new THREE.Scene(), twinPivot = new THREE.Group();
twinScene.background = BG;
twinScene.add(twinPivot);
let twinCam;

const unlit = (m) => new THREE.MeshBasicMaterial(m.map ? { map: m.map } : { color: m.color });

// Every photo blended by how directly it sees the spot (cos^k), where its segmentation says skin.
function blendMaterial(views, res, canvases, skinHex, k = 4) {
  const n = views.length, cols = 4, rows = Math.ceil(n / cols), cw = canvases[0].width, ch = canvases[0].height;
  const atlas = Object.assign(document.createElement('canvas'), { width: cols * cw, height: rows * ch }), g = atlas.getContext('2d');
  canvases.forEach((c, i) => {
    const id = c.getContext('2d').getImageData(0, 0, cw, ch), m = res[i].mask;
    for (let p = 0; p < m.length; p++) id.data[p * 4 + 3] = m[p] === FACE_SKIN || m[p] === BODY_SKIN ? 255 : 0;
    g.putImageData(id, (i % cols) * cw, Math.floor(i / cols) * ch);
  });
  const tex = new THREE.CanvasTexture(atlas);
  tex.colorSpace = THREE.SRGBColorSpace;
  // Fused frame -> normalised photo coordinates (y down): the inverse of each view's similarity transform.
  const mats = views.map(({ T }) => {
    const r0 = [0, 1, 2].map((j) => T.R[j][0] / (T.s * res[0].w)), r1 = [0, 1, 2].map((j) => -T.R[j][1] / (T.s * res[0].h));
    const o = (r) => -(r[0] * T.t[0] + r[1] * T.t[1] + r[2] * T.t[2]);
    return new THREE.Matrix4().set(...r0, o(r0), ...r1, o(r1), 0, 0, 0, 0, 0, 0, 0, 1);
  });
  while (mats.length < 16) mats.push(new THREE.Matrix4());
  const cams = views.map((v) => new THREE.Vector3(...v.camDir));
  while (cams.length < 16) cams.push(new THREE.Vector3());
  return new THREE.ShaderMaterial({
    uniforms: { uAtlas: { value: tex }, uV: { value: mats }, uC: { value: cams }, uN: { value: n }, uCols: { value: cols }, uRows: { value: rows }, uK: { value: k }, uSkin: { value: new THREE.Color(skinHex) } },
    vertexShader: 'varying vec3 vP; varying vec3 vN; void main() { vP = position; vN = normal; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D uAtlas; uniform mat4 uV[16]; uniform vec3 uC[16]; uniform int uN; uniform float uCols, uRows, uK; uniform vec3 uSkin;
      varying vec3 vP; varying vec3 vN;
      void main() {
        vec3 n = normalize(vN), acc = vec3(0.0); float ws = 0.0;
        for (int i = 0; i < 16; i++) {
          if (i >= uN) break;
          vec4 q = uV[i] * vec4(vP, 1.0);
          float c = dot(n, uC[i]);
          if (c < 0.2 || q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) continue;
          float w = pow(c, uK), col = mod(float(i), uCols), row = floor(float(i) / uCols);
          vec4 s = texture2D(uAtlas, vec2((col + q.x) / uCols, 1.0 - (row + q.y) / uRows));
          acc += w * s.rgb; ws += w * s.a; // s.rgb is already scaled by s.a at mask edges
        }
        gl_FragColor = vec4(ws > 1e-4 ? acc / ws : uSkin, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

function setupTwin(group, fused, faceFrac) {
  twinPivot.clear();
  const P = fused.points, xs = P.map((p) => p[0]), ys = P.map((p) => p[1]);
  const width = Math.max(...xs) - Math.min(...xs), fh = Math.max(...ys) - Math.min(...ys);
  const c = [0, 1, 2].map((k) => P.reduce((s, p) => s + p[k], 0) / P.length);
  twinPivot.position.set(c[0], c[1], c[2] - 0.6 * width); // turn about the head's centre, behind the face
  group.position.set(-c[0], -c[1], -(c[2] - 0.6 * width));
  twinPivot.add(group);
  const half = fh / faceFrac / 2; // same face size in the frame as the real head
  twinCam = new THREE.OrthographicCamera(-half * W / H, half * W / H, half, -half, -1e5, 1e5);
  twinCam.position.set(c[0], c[1], c[2] + 1000);
}
function renderTwin(yaw) {
  twinPivot.rotation.y = yaw * D;
  renderer.render(twinScene, twinCam);
  return toCanvas(renderer.domElement, W);
}

// --- scoring ---
// 2D similarity that maps src points onto dst: x' = a x - b y + tx, y' = b x + a y + ty.
function sim2(src, dst) {
  const n = src.length, ms = [0, 0], md = [0, 0];
  for (let i = 0; i < n; i++) { ms[0] += src[i][0] / n; ms[1] += src[i][1] / n; md[0] += dst[i][0] / n; md[1] += dst[i][1] / n; }
  let sa = 0, sb = 0, ss = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - ms[0], sy = src[i][1] - ms[1], dx = dst[i][0] - md[0], dy = dst[i][1] - md[1];
    sa += sx * dx + sy * dy; sb += sx * dy - sy * dx; ss += sx * sx + sy * sy;
  }
  const a = sa / ss, b = sb / ss;
  return { a, b, tx: md[0] - (a * ms[0] - b * ms[1]), ty: md[1] - (b * ms[0] + a * ms[1]) };
}
const px = (lm) => lm.slice(0, 468).map((p) => [p.x * W, p.y * H]);

// Aligns the twin render onto the real one by the face points, then compares the pixels inside the face outline.
function score(gtCanvas, gtLm, twinCanvas, twinLm) {
  const g = px(gtLm), t = px(twinLm), S = sim2(t, g);
  const aligned = Object.assign(document.createElement('canvas'), { width: W, height: H }), ac = aligned.getContext('2d');
  ac.fillStyle = '#000'; ac.fillRect(0, 0, W, H);
  ac.setTransform(S.a, S.b, -S.b, S.a, S.tx, S.ty);
  ac.drawImage(twinCanvas, 0, 0);
  ac.setTransform(1, 0, 0, 1, 0, 0);
  const mask = Object.assign(document.createElement('canvas'), { width: W, height: H }), mc = mask.getContext('2d');
  mc.beginPath();
  FACE_OVAL.forEach((i, k) => (k ? mc.lineTo : mc.moveTo).call(mc, g[i][0], g[i][1]));
  mc.fill();
  const M = mc.getImageData(0, 0, W, H).data, A = ac.getImageData(0, 0, W, H).data, G = gtCanvas.getContext('2d').getImageData(0, 0, W, H).data;
  let l1 = 0, se = 0, n = 0;
  for (let p = 0; p < W * H; p++) {
    if (M[p * 4 + 3] < 128) continue;
    for (let k = 0; k < 3; k++) { const d = A[p * 4 + k] - G[p * 4 + k]; l1 += Math.abs(d); se += d * d; }
    n += 3;
  }
  const mmPerPx = 90 / Math.hypot(g[33][0] - g[263][0], g[33][1] - g[263][1]);
  let lmErr = 0;
  t.forEach(([x, y], i) => { lmErr += Math.hypot(S.a * x - S.b * y + S.tx - g[i][0], S.b * x + S.a * y + S.ty - g[i][1]); });
  return { l1: l1 / n, psnr: 10 * Math.log10((255 * 255) / (se / n)), lmMm: (lmErr / t.length) * mmPerPx, aligned };
}

function table(rows, cols) {
  const head = `<tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr>`;
  return `<table>${head}${rows.map((r) => `<tr>${r.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</table>`;
}

async function run() {
  status('Loading the face models, the head scan and the MakeHuman head…');
  const [img, vid, , mh] = await Promise.all([
    loadFaceModels({ wasm: WASM, faceModel: FACE_MODEL, segModel: SEG_MODEL, matrices: true }),
    loadFaceModels({ wasm: WASM, faceModel: FACE_MODEL, video: true }),
    loadScan(),
    loadHead(),
  ]);
  // The scan's facing direction is not documented: take the base turn where the face reads closest to straight on.
  let bestYaw = Infinity;
  for (const b of [0, Math.PI, Math.PI / 2, -Math.PI / 2]) {
    baseYaw = b;
    const r = img.landmarker.detect(renderGT(0));
    const y = r.faceLandmarks.length ? Math.abs(yawFromMatrix(r.facialTransformationMatrixes[0].data)) : Infinity;
    if (y < bestYaw) { bestYaw = y; var base = b; }
  }
  baseYaw = base;
  const corr = correspond(mh, img.landmarker);

  // 1. The sweep, frame by frame, through the video landmarker.
  const sweep = createSweep(), capture = createCapture(), dur = KEYS[KEYS.length - 1][0];
  let prev = null, frames = 0, faces = 0, detectMs = 0, firstReady = null, firstFull = null;
  for (let t = 0; t <= dur; t += 1 / FPS) {
    const frame = renderFrame(t), t0 = performance.now();
    const r = vid.landmarker.detectForVideo(frame, Math.round(t * 1000));
    detectMs += performance.now() - t0; frames++;
    if (!r.faceLandmarks.length) { sweep.push(null); capture.push(t * 1000, null); prev = null; continue; }
    faces++;
    const lm = r.faceLandmarks[0], d = r.facialTransformationMatrixes[0].data, ys = lm.map((p) => p.y);
    const yaw = yawFromMatrix(d), faceFrac = Math.max(...ys) - Math.min(...ys);
    sweep.push({ yaw, pitch: pitchFromMatrix(d), faceFrac, sharp: faceSharpness(frame, lm), data: { canvas: frame, gtYaw: yawAt(t), t } });
    capture.push(t * 1000, { yaw, faceFrac, jitter: prev ? jitter(prev, lm, W / H) : 1 });
    prev = lm;
    if (firstReady === null && sweep.ready()) firstReady = t;
    if (firstFull === null && sweep.progress() === 1) firstFull = t;
    if (frames % 15 === 0) { status(`Sweep: ${t.toFixed(1)} s of ${dur} s, ${Math.round(sweep.progress() * 100)}% of bins`); await tick(); }
  }
  const binRows = sweep.centres.map((c, i) => {
    const f = sweep.best[i];
    return [`${c}°`, f ? f.yaw.toFixed(1) : '—', f ? f.data.gtYaw.toFixed(1) : '—', f ? f.data.t.toFixed(2) : '—', f ? f.sharp.toFixed(0) : '—'];
  });
  $('sweep').innerHTML = `<p>${frames} frames at ${FPS} fps, a face in ${faces}. Face points: ${(detectMs / frames).toFixed(1)} ms a frame. `
    + `Enough for 3 photos after ${firstReady?.toFixed(1)} s, every bin after ${firstFull?.toFixed(1) ?? 'never'} s. `
    + `Today's hold-still capture (capture-core.js) took ${capture.got.filter(Boolean).length} of 3 photos from the same video.</p>`
    + table(binRows, ['Bin', 'Yaw read', 'True yaw', 'At (s)', 'Sharpness']);

  // The real head at test angles that no photo saw, with its face points.
  const taken = sweep.photos().map((f) => f.data.gtYaw);
  HELD_OUT = [];
  for (let y = -60; y <= 60; y += 2.5) if (taken.every((g) => Math.abs(g - y) >= HELD_OUT_GAP)) HELD_OUT.push(y);
  const gt = HELD_OUT.map((y) => { const c = renderGT(y); return { y, c, lm: img.landmarker.detect(c).faceLandmarks[0] }; });
  const front = sweep.photos()[0];
  const fys = img.landmarker.detect(front.data.canvas).faceLandmarks[0].map((p) => p.y), faceFrac = Math.max(...fys) - Math.min(...fys);

  // 2. One twin per photo set, two ways to texture it.
  const results = {}, sheetCols = [];
  for (const centres of Object.values(SETS)) {
    const chosen = centres ? centres.map((c) => sweep.best[sweep.centres.indexOf(c)]).filter(Boolean) : sweep.photos();
    const name = `${chosen.length} photos`;
    status(`Building the twin from ${name}…`); await tick();
    const canvases = chosen.map((f) => f.data.canvas);
    const out = analyseViews(img, canvases);
    if (!out.ok) { results[name] = { error: `no face in ${out.missing.length} photos` }; continue; }
    const skinHex = rgb2hex(out.skin);
    const twin = buildTwin({ head: mh, corr, res: out.res, fused: out.fused, skinHex, mmPerPx: out.mmPerPx, photos: canvases, blend: false });
    const meshes = []; twin.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
    meshes.forEach((m) => { m.material = Array.isArray(m.material) ? m.material.map(unlit) : unlit(m.material); });
    const skin = meshes[0], switchMat = skin.material, blendMat = blendMaterial(out.fused.views, out.res, canvases, skinHex);
    setupTwin(twin.group, out.fused, faceFrac);
    // Which way the twin turns for a positive true yaw: the sign that reads like the real head at 45 degrees.
    const gt45 = yawFromMatrix(img.landmarker.detect(renderGT(45)).facialTransformationMatrixes[0].data);
    const sign = [1, -1].map((s) => ({ s, e: Math.abs(yawFromMatrix(img.landmarker.detect(renderTwin(45 * s)).facialTransformationMatrixes[0].data) - gt45) })).sort((a, b) => a.e - b.e)[0].s;
    for (const [mode, mat] of [['switch', switchMat], ['blend', blendMat]]) {
      skin.material = mat;
      const per = gt.map(({ y, c, lm }) => {
        const tc = renderTwin(sign * y), tl = img.landmarker.detect(tc).faceLandmarks[0];
        return lm && tl ? { y, ...score(c, lm, tc, tl) } : { y, miss: true };
      });
      results[`${name}, ${mode}`] = { per, stats: twin.stats, rms: out.fused.views.map((v) => v.rms) };
      if (centres === SETS.few ? mode === 'switch' : centres === null) sheetCols.push({ name: `${name}, ${mode}`, per });
    }
  }

  // 3. Scores.
  const rows = Object.entries(results).map(([name, r]) => {
    if (r.error) return [name, r.error, '', '', '', ''];
    const ok = r.per.filter((p) => !p.miss), avg = (k) => ok.reduce((s, p) => s + p[k], 0) / ok.length;
    const worst = ok.reduce((a, p) => (p.l1 > a.l1 ? p : a));
    return [name, avg('l1').toFixed(2), avg('psnr').toFixed(2), avg('lmMm').toFixed(2), `${worst.l1.toFixed(1)} at ${worst.y}°`, `${r.per.length - ok.length}`];
  });
  const perAngle = HELD_OUT.map((y, i) => [`${y}°`, ...Object.values(results).map((r) => (r.per && !r.per[i].miss ? r.per[i].l1.toFixed(1) : '—'))]);
  $('score').innerHTML = table(rows, ['Twin', 'Colour error (0–255)', 'PSNR (dB)', 'Face point error (mm)', 'Worst angle', 'Angles missed'])
    + '<p>Colour error per angle:</p>' + table(perAngle, ['Angle', ...Object.keys(results)]);

  // 4. The side-by-side sheet at four angles.
  const near = (a) => HELD_OUT.reduce((b, y) => (Math.abs(y - a) < Math.abs(b - a) ? y : b)), show = [-45, -25, 25, 45].map(near), cell = 240, crop = (src, lm) => {
    const xs = lm.map((p) => p.x * W), ys = lm.map((p) => p.y * H), cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2, s = (Math.max(...ys) - Math.min(...ys)) * 1.15;
    return [src, cx - s / 2, cy - s / 2, s, s];
  };
  const sheet = $('sheet'); sheet.width = cell * (1 + sheetCols.length); sheet.height = cell * show.length;
  const sg = sheet.getContext('2d');
  show.forEach((y, r) => {
    const i = HELD_OUT.indexOf(y), g = gt[i];
    sg.drawImage(...crop(g.c, g.lm), 0, r * cell, cell, cell);
    sheetCols.forEach((col, k) => { if (!col.per[i].miss) sg.drawImage(...crop(col.per[i].aligned, g.lm), (k + 1) * cell, r * cell, cell, cell); });
  });
  window.__sweep = { results: Object.fromEntries(Object.entries(results).map(([k, r]) => [k, r.error ?? r.per.map(({ aligned, ...p }) => p)])), bins: binRows, frames, faces, firstReady, firstFull, captured: capture.got };
  status('Done.');
}

run().catch((e) => { status(`Failed: ${e.message}`); console.error(e); });
