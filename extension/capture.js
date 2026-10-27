// Guided camera capture: opens the camera, watches the head turn with MediaPipe, and takes the front, left and right
// photos by itself when each pose holds. Runs in its own tab (Chrome does not reliably show the camera prompt in a side panel).
import { createCapture, yawFromMatrix, jitter } from './capture-core.js';
import { photoStore, toDataUrl } from './photo-store.js';

const $ = (id) => document.getElementById(id);
const NAMES = ['Front', 'Left side', 'Right side'];
const HINTS = {
  noface: 'No face found. Face the camera in good light.', closer: 'Move a little closer.', still: 'Hold still.', hold: 'Hold it there…',
  front: 'Look straight at the camera.', more: 'Turn a little further.', less: 'Not so far.', other: 'Now turn to the other side.',
};
const STEP_TEXT = { 0: 'Look straight at the camera.', 1: 'Slowly turn your head to your right.', 2: 'Slowly turn your head to your left.' }; // a right turn shows the left cheek

const status = (t, bad = false) => { $('status').textContent = t; $('status').className = bad ? 'note bad' : 'note'; };
const video = $('video');
let stream = null, landmarker = null, toCanvas = null, core = null, shots = [null, null, null], raf = 0, prevLm = null, lastT = -1, shown = '';

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
function setProgress(p) {
  const bar = $('bar'), len = bar.getTotalLength();
  bar.style.strokeDasharray = `${len * p} ${len}`;
}
function renderSteps() {
  const want = core.wanted();
  [...$('steps').children].forEach((li, i) => { li.className = !core.got[i] ? (i === want[0] ? 'now' : '') : 'done'; li.textContent = (core.got[i] ? '✓ ' : '') + NAMES[i]; });
}

function showShots() {
  $('shots').replaceChildren(...NAMES.map((n, i) => {
    const box = Object.assign(document.createElement('div'), { className: 'shot' });
    const cv = Object.assign(document.createElement('canvas'), { width: shots[i]?.width ?? 3, height: shots[i]?.height ?? 4 });
    if (shots[i]) cv.getContext('2d').drawImage(shots[i], 0, 0);
    const b = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Retake' });
    b.addEventListener('click', () => retake(i));
    box.append(cv, n, b);
    return box;
  }));
  $('review').hidden = !shots.some(Boolean);
  $('use').disabled = !shots.every(Boolean);
}

function flash() { const f = $('flash'); f.classList.add('on'); requestAnimationFrame(() => requestAnimationFrame(() => f.classList.remove('on'))); }

function tick(now) {
  raf = requestAnimationFrame(tick);
  if (!video.videoWidth || video.currentTime === lastT) return;
  lastT = video.currentTime;
  let frame = null;
  try {
    const r = landmarker.detectForVideo(video, now), lm = r.faceLandmarks[0], m = r.facialTransformationMatrixes?.[0];
    if (lm && m) {
      const ys = lm.map((p) => p.y);
      frame = { yaw: yawFromMatrix(m.data), faceFrac: Math.max(...ys) - Math.min(...ys), jitter: prevLm ? jitter(prevLm, lm, video.videoWidth / video.videoHeight) : 1 };
      prevLm = lm;
    } else prevLm = null;
  } catch (e) { status(`Face detection failed: ${e.message}`, true); return stopLoop(); }
  const out = core.push(now, frame);
  setProgress(out.progress);
  if (out.captured !== null) {
    shots[out.captured] = toCanvas(video); // the raw frame, not the mirrored preview
    flash();
    renderSteps();
    showShots();
  }
  if (out.done) { stopLoop(); prompt('All three photos taken. Check them below.'); return; }
  prompt(HINTS[out.hint] ?? STEP_TEXT[core.wanted()[0]]);
}
function startLoop() { cancelAnimationFrame(raf); prevLm = null; setProgress(0); raf = requestAnimationFrame(tick); }
function stopLoop() { cancelAnimationFrame(raf); setProgress(0); }
function retake(slot) {
  core.retake(slot);
  shots[slot] = null;
  renderSteps();
  showShots();
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
  $('steps').hidden = false;
  status('Loading face detection (offline, inside the extension)…');
  try {
    const a = await import('./lib/twin-spike/analyse.js');
    toCanvas = a.toCanvas;
    ({ landmarker } = await a.loadFaceModels({ wasm: new URL('./vendor/mediapipe/wasm', import.meta.url).href, faceModel: new URL('./vendor/mediapipe/face_landmarker.task', import.meta.url).href, video: true }));
  } catch (e) { status(`Could not load face detection: ${e.message}`, true); return; }
  status('');
  core = createCapture();
  shots = [null, null, null];
  renderSteps();
  prompt(STEP_TEXT[0]);
  startLoop();
}

function stopCamera() { stopLoop(); stream?.getTracks().forEach((t) => t.stop()); stream = null; }

$('start').addEventListener('click', start);
$('use').addEventListener('click', async () => {
  try { await photoStore.set(shots.map(toDataUrl)); } catch (e) { status(`Could not save the photos: ${e.message}`, true); return; }
  stopCamera();
  $('stage').hidden = true;
  $('use').disabled = true;
  status('Photos saved. Go back to the Avatar Try-On panel; this tab closes now.');
  try {
    if (typeof chrome !== 'undefined' && chrome.tabs?.getCurrent) { const tab = await chrome.tabs.getCurrent(); if (tab) return chrome.tabs.remove(tab.id); }
    window.close();
  } catch { /* the message above stays */ }
});
addEventListener('pagehide', stopCamera);
window.__capture = { get core() { return core; }, get shots() { return shots; } }; // for checks from devtools
