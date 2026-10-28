// One-sweep camera capture: opens the camera, watches one slow head turn with MediaPipe, and keeps the sharpest frame
// near each 10-degree step of the turn (sweep-spike/sweep.js). Runs in its own tab (Chrome does not reliably show the
// camera prompt in a side panel).
import { yawFromMatrix } from './capture-core.js';
import { createSweep, pitchFromMatrix, sharpness, MIN_FACE, PITCH_MAX } from './lib/sweep-spike/sweep.js';
import { photoStore, toDataUrl } from './photo-store.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const TICKS_PER_BIN = 6, RING_DEG = 150; // the ring spans -150..150 degrees from the top for yaw -50..50
const HINTS = {
  noface: 'No face found. Face the camera in good light.', closer: 'Move a little closer.', level: 'Keep your chin level.',
  front: 'Look straight at the camera.', right: 'Slowly turn your head to your right.', left: 'Slowly turn your head to your left.',
};

const status = (t, bad = false) => { $('status').textContent = t; $('status').className = bad ? 'note bad' : 'note'; };
const video = $('video');
let stream = null, landmarker = null, toCanvas = null, sweep = null, raf = 0, lastT = -1, shown = '', ticks = [], thumbs = [];

function cameraError(e) {
  if (!navigator.mediaDevices?.getUserMedia) return 'This page cannot use the camera.';
  switch (e?.name) {
    case 'NotAllowedError': case 'SecurityError': return 'Camera access is blocked. Allow it at chrome://settings/content/camera (or click the camera icon in the address bar), then press Start camera again.';
    case 'NotFoundError': case 'OverconstrainedError': return 'No camera found. Connect one and press Start camera again, or go back and choose photo files instead.';
    case 'NotReadableError': return 'The camera is in use by another app. Close that app and press Start camera again.';
    default: return `Could not open the camera: ${e?.message ?? e}`;
  }
}

function prompt(text) { if (text !== shown) { shown = text; $('prompt').textContent = text; } }

// A point on the face oval at `deg` degrees clockwise from the top, pushed out by `out`.
const onRing = (deg, out = 0) => { const a = (deg * Math.PI) / 180; return [50 + (19 + out) * Math.sin(a), 37 - (27 + out) * Math.cos(a)]; };
// Positive yaw is a turn to the user's right, which the mirrored preview shows on the right of the oval.
const ringDeg = (yaw) => (yaw / sweep.centres.at(-1)) * RING_DEG;

function buildRing() {
  const g = $('ticks'), step = (2 * RING_DEG) / (sweep.centres.length * TICKS_PER_BIN);
  g.replaceChildren();
  ticks = sweep.centres.map((_, b) => Array.from({ length: TICKS_PER_BIN }, (_, k) => {
    const deg = -RING_DEG + (b * TICKS_PER_BIN + k + 0.5) * step, [x1, y1] = onRing(deg, 1.2), [x2, y2] = onRing(deg, 3.4);
    const l = document.createElementNS(SVG, 'line');
    Object.entries({ x1, y1, x2, y2 }).forEach(([k2, v]) => l.setAttribute(k2, v.toFixed(2)));
    g.append(l);
    return l;
  }));
  $('shots').replaceChildren(...sweep.centres.map((c) => {
    const box = Object.assign(document.createElement('div'), { className: 'shot' });
    const cv = Object.assign(document.createElement('canvas'), { width: 3, height: 4 });
    box.append(cv, Object.assign(document.createElement('span'), { textContent: `${c > 0 ? '+' : ''}${c}°` }));
    return box;
  }));
  thumbs = [...$('shots').children];
}

function showBin(b) {
  const f = sweep.best[b], box = thumbs[b], cv = box.firstChild, label = box.lastChild;
  ticks[b].forEach((l) => l.classList.add('on'));
  cv.width = 120; cv.height = Math.round((120 * f.data.height) / f.data.width);
  const g = cv.getContext('2d');
  g.setTransform(-1, 0, 0, 1, cv.width, 0); // mirrored, like the preview
  g.drawImage(f.data, 0, 0, cv.width, cv.height);
  label.textContent = `${sweep.centres[b] > 0 ? '+' : ''}${sweep.centres[b]}° · read ${f.yaw.toFixed(1)}° · sharp ${f.sharp.toFixed(0)}`;
  box.classList.add('filled');
}

// Variance of the Laplacian over the face box: lower when the turn blurs the frame.
function faceSharpness(c, lm) {
  const xs = lm.map((p) => p.x * c.width), ys = lm.map((p) => p.y * c.height);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const w = Math.min(c.width, Math.ceil(Math.max(...xs))) - x0, h = Math.min(c.height, Math.ceil(Math.max(...ys))) - y0;
  if (w < 3 || h < 3) return 0;
  const px = c.getContext('2d').getImageData(x0, y0, w, h).data, gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  return sharpness(gray, w, h);
}

// The next thing to ask for: a fix for this frame, else the front, else the side with the most empty bins.
function nextHint(frame) {
  if (!frame) return 'noface';
  if (frame.faceFrac < MIN_FACE) return 'closer';
  if (Math.abs(frame.pitch) > PITCH_MAX) return 'level';
  const empty = (sign) => sweep.centres.filter((c, i) => Math.sign(c) === sign && !sweep.best[i]).length;
  if (!sweep.best[sweep.centres.indexOf(0)]) return 'front';
  return empty(1) >= empty(-1) ? 'right' : 'left';
}

function tick(now) {
  raf = requestAnimationFrame(tick);
  if (!video.videoWidth || video.currentTime === lastT) return;
  lastT = video.currentTime;
  let frame = null;
  try {
    const r = landmarker.detectForVideo(video, now), lm = r.faceLandmarks[0], m = r.facialTransformationMatrixes?.[0];
    if (lm && m) {
      const ys = lm.map((p) => p.y), c = toCanvas(video); // the raw frame, not the mirrored preview
      frame = { yaw: yawFromMatrix(m.data), pitch: pitchFromMatrix(m.data), faceFrac: Math.max(...ys) - Math.min(...ys), sharp: faceSharpness(c, lm), data: c };
    }
  } catch (e) { status(`Face detection failed: ${e.message}`, true); return stopLoop(); }
  const out = sweep.push(frame);
  if (out.kept) showBin(out.bin);
  const dot = $('dot');
  dot.style.visibility = frame ? 'visible' : 'hidden';
  if (frame) { const [x, y] = onRing(ringDeg(Math.max(-55, Math.min(55, frame.yaw))), 2.3); dot.setAttribute('cx', x); dot.setAttribute('cy', y); }
  $('count').textContent = `${sweep.best.filter(Boolean).length} of ${sweep.centres.length} angles`;
  $('use').disabled = !sweep.ready();
  if (sweep.progress() === 1) { stopLoop(); prompt('Done. Check the photos below.'); return; }
  prompt(HINTS[nextHint(frame)]);
}
function startLoop() { cancelAnimationFrame(raf); raf = requestAnimationFrame(tick); }
function stopLoop() { cancelAnimationFrame(raf); $('dot').style.visibility = 'hidden'; }

function reset() {
  sweep = createSweep();
  buildRing();
  $('use').disabled = true;
  $('review').hidden = false;
  startLoop();
}

async function start() {
  $('start').disabled = true;
  status('Opening the camera… If Chrome asks, choose Allow.');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
  } catch (e) { status(cameraError(e), true); $('start').disabled = false; $('start').textContent = 'Try again'; return; }
  video.srcObject = stream;
  await video.play();
  $('start').hidden = true;
  $('stage').hidden = false;
  status('Loading face detection (offline, inside the extension)…');
  try {
    const a = await import('./lib/twin-spike/analyse.js');
    toCanvas = a.toCanvas;
    ({ landmarker } = await a.loadFaceModels({ wasm: new URL('./vendor/mediapipe/wasm', import.meta.url).href, faceModel: new URL('./vendor/mediapipe/face_landmarker.task', import.meta.url).href, video: true }));
  } catch (e) { status(`Could not load face detection: ${e.message}`, true); return; }
  status('');
  reset();
}

function stopCamera() { stopLoop(); stream?.getTracks().forEach((t) => t.stop()); stream = null; }

// Stored order: front, left side, right side (what the panel's three slots and the 3-photo analysis expect), then the rest.
function ordered() {
  const [front, ...rest] = sweep.photos();
  rest.sort((a, b) => b.yaw - a.yaw); // a positive yaw shows the left cheek
  return [front, rest[0], rest.at(-1), ...rest.slice(1, -1)];
}

$('start').addEventListener('click', start);
$('again').addEventListener('click', reset);
$('use').addEventListener('click', async () => {
  try { await photoStore.set(ordered().map((f) => toDataUrl(f.data))); } catch (e) { status(`Could not save the photos: ${e.message}`, true); return; }
  stopCamera();
  $('stage').hidden = true;
  $('use').disabled = $('again').disabled = true;
  status('Photos saved. Go back to the Avatar Try-On panel; this tab closes now.');
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.getCurrent) { const tab = await chrome.tabs.getCurrent(); if (tab) return chrome.tabs.remove(tab.id); }
    window.close();
  } catch { /* the message above stays */ }
});
addEventListener('pagehide', stopCamera);
window.__capture = { get sweep() { return sweep; } }; // for checks from devtools
