// Photo analysis shared by the twin-spike page and the extension panel: face landmarks and a hair/skin segmentation
// per photo, fused into one 3D face, with a hair class and a skin tone. Browser only (MediaPipe).
import { FilesetResolver, FaceLandmarker, ImageSegmenter } from '@mediapipe/tasks-vision';
import { toPoints, fuseViews } from './fuse.js';
import { hairMetrics, classifyHair } from './hair.js';

export const VIEW_NAMES = ['Front', 'Left side', 'Right side'];
const EYE_CORNERS_MM = 90; // shortcut: adult average outer eye-corner width sets the scale; upgrade to a card-in-photo or typed-in measurement

// Face landmarker and (when segModel is given) the selfie segmenter. video: a landmarker for live frames (detectForVideo)
// instead of photos (detect). matrices: also return the head pose matrix (on by default for video).
export async function loadFaceModels({ wasm, faceModel, segModel, video = false, matrices = video }) {
  quietMediaPipe();
  const vision = await FilesetResolver.forVisionTasks(wasm);
  const [landmarker, segmenter] = await Promise.all([
    FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: faceModel }, runningMode: video ? 'VIDEO' : 'IMAGE', numFaces: 1, ...(matrices && { outputFacialTransformationMatrixes: true }) }),
    segModel ? ImageSegmenter.createFromOptions(vision, { baseOptions: { modelAssetPath: segModel }, runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false }) : null,
  ]);
  return { landmarker, segmenter };
}

// MediaPipe's wasm prints its internal glog lines ("W1028 03:21:19.04 2191552 gl_context.cc:1135] ...") with
// console.warn and TensorFlow Lite's "INFO: Created TensorFlow Lite XNNPACK delegate for CPU." with console.error.
// They are normal start-up notes, but Chrome lists them as errors on the extension's card. Drop only those lines:
// MediaPipe's own errors (E and F lines) and every other message still pass.
const MP_NOTE = /^(?:[IW]\d{4} [\d:.]+ +\d+ [\w./-]+:\d+\] |INFO: Created TensorFlow Lite XNNPACK delegate)/;
let quiet = false;
function quietMediaPipe() {
  if (quiet) return;
  quiet = true;
  for (const level of ['warn', 'error']) {
    const orig = console[level];
    console[level] = (...args) => { if (!(typeof args[0] === 'string' && MP_NOTE.test(args[0]))) orig.apply(console, args); };
  }
}

// An image, bitmap or video frame drawn into a canvas of at most maxSide pixels on its long side.
export function toCanvas(src, maxSide = 768) {
  const w0 = src.videoWidth || src.width, h0 = src.videoHeight || src.height;
  const k = Math.min(1, maxSide / Math.max(w0, h0));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(w0 * k), height: Math.round(h0 * k) });
  c.getContext('2d').drawImage(src, 0, 0, c.width, c.height);
  return c;
}

function analyse({ landmarker, segmenter }, c) {
  const lmRes = landmarker.detect(c);
  if (!lmRes.faceLandmarks.length) return { face: false };
  const lmNorm = lmRes.faceLandmarks[0];
  const seg = segmenter.segment(c), m = seg.categoryMask;
  const raw = m.getAsUint8Array(), mw = m.width, mh = m.height;
  // Resample the mask to the photo size if the model returned it smaller.
  const mask = mw === c.width && mh === c.height ? raw.slice() : new Uint8Array(c.width * c.height).map((_, i) =>
    raw[Math.min(mh - 1, Math.floor(((i / c.width) | 0) * mh / c.height)) * mw + Math.min(mw - 1, Math.floor((i % c.width) * mw / c.width))]);
  m.close();
  const rgba = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  const lmPx = lmNorm.map((p) => ({ x: p.x * c.width, y: p.y * c.height }));
  return { face: true, lmNorm, lmPx, mask, rgba, w: c.width, h: c.height, metrics: hairMetrics({ mask, rgba, w: c.width, h: c.height, lm: lmPx }) };
}

// canvases: [front, left, right, then any more views]. res (per-view results) is returned either way, for drawing the landmarks.
export function analyseViews(models, canvases) {
  const res = canvases.map((c) => analyse(models, c));
  if (!res.every((a) => a.face)) return { ok: false, missing: res.flatMap((a, i) => (a.face ? [] : [VIEW_NAMES[i] ?? `photo ${i + 1}`])), res };
  const fused = fuseViews(res.map((a) => toPoints(a.lmNorm, a.w, a.h)));
  // Outer eye corners (33, 263), not the pupils: the iris points drift on closed or small eyes.
  const cornersPx = Math.hypot(...[0, 1, 2].map((k) => fused.points[33][k] - fused.points[263][k]));
  const mmPerPx = EYE_CORNERS_MM / cornersPx;
  const hair = classifyHair(res.map((a) => a.metrics));
  const skins = res.map((a) => a.metrics.skin).filter(Boolean);
  const skin = [0, 1, 2].map((k) => skins.map((s) => s[k]).sort((x, y) => x - y)[skins.length >> 1]);
  return { ok: true, res, fused, mmPerPx, hair, skin };
}
