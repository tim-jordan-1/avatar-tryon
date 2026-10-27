// Hair and skin from a segmentation mask plus face landmarks. Pure JS: runs in the browser and in Node.
// Mask classes follow MediaPipe selfie_multiclass_256x256: 0 background, 1 hair, 2 body skin, 3 face skin, 4 clothes, 5 other.
export const HAIR = 1, FACE_SKIN = 3;

// Landmark indices (MediaPipe face mesh).
const TOP = 10, CHIN = 152, NOSE = 1, EAR_R = 234, EAR_L = 454, EYE_R = 159, EYE_L = 386;

export const PALETTE = [
  ['Black', '#1c1714'], ['Dark brown', '#3b2a20'], ['Brown', '#6b4a32'], ['Light brown', '#9a7451'],
  ['Auburn', '#7a3b22'], ['Red', '#a5482a'], ['Blonde', '#c9a46a'], ['Light blonde', '#e2cb9a'],
  ['Grey', '#9a9894'], ['White', '#dedcd8'],
];

const hex2rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
export const rgb2hex = (c) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export function srgbToLab([r, g, b]) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const X = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047), Y = f(0.2126 * R + 0.7152 * G + 0.0722 * B), Z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
}

export function nameColour(rgb) {
  const lab = srgbToLab(rgb);
  let best = null, bd = Infinity;
  for (const [name, hex] of PALETTE) {
    const l = srgbToLab(hex2rgb(hex)), d = Math.hypot(lab[0] - l[0], lab[1] - l[1], lab[2] - l[2]);
    if (d < bd) { bd = d; best = { name, hex, deltaE: d }; }
  }
  return best;
}

// Per-channel median of the pixels where keep(i) is true (every `step`-th pixel).
function medianRGB(rgba, n, keep, step = 2) {
  const ch = [[], [], []];
  for (let i = 0; i < n; i += step) if (keep(i)) for (let c = 0; c < 3; c++) ch[c].push(rgba[i * 4 + c]);
  if (!ch[0].length) return null;
  return ch.map((a) => a.sort((x, y) => x - y)[a.length >> 1]);
}

// One photo. lm: landmarks in pixels ({x, y}, y down). Lengths are in face heights (forehead top to chin).
export function hairMetrics({ mask, rgba, w, h, lm }) {
  const top = lm[TOP].y, chin = lm[CHIN].y, faceH = chin - top;
  const xs = lm.map((p) => p.x), fx0 = Math.min(...xs), fx1 = Math.max(...xs), faceW = Math.abs(lm[EAR_L].x - lm[EAR_R].x) || fx1 - fx0;
  const eyeY = (lm[EYE_R].y + lm[EYE_L].y) / 2;
  const x0 = Math.max(0, fx0 - 0.8 * faceW), x1 = Math.min(w - 1, fx1 + 0.8 * faceW);
  // Ignore hair class inside the face below the eyes: that is a beard or moustache, not head hair.
  const isHair = (i) => {
    if (mask[i] !== HAIR) return false;
    const x = i % w, y = (i / w) | 0;
    return x >= x0 && x <= x1 && !(y > eyeY && x > fx0 && x < fx1);
  };
  let count = 0, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < w * h; i++) if (isHair(i)) { count++; const y = (i / w) | 0; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const hair = count ? medianRGB(rgba, w * h, isHair) : null;
  const skin = medianRGB(rgba, w * h, (i) => mask[i] === FACE_SKIN);
  // The visible ear is the one farther from the nose tip; hair hanging below it is the length cue.
  const ear = Math.abs(lm[EAR_L].x - lm[NOSE].x) > Math.abs(lm[EAR_R].x - lm[NOSE].x) ? lm[EAR_L] : lm[EAR_R];
  return {
    areaRatio: count / (faceW * faceH),
    belowEar: count ? (maxY - ear.y) / faceH : null, // hair end below the ear (tragion), in face heights
    bottom: count ? (maxY - chin) / faceH : null, // >0: hair ends below the chin
    topThickness: count ? (top - minY) / faceH : null, // hair height above the forehead landmark
    hair, skin,
  };
}

// Combine the three photos into one estimate. Length is the median of "hair end below the ear" over the photos,
// so one photo with a dark shadow read as hair cannot decide it. Thresholds are first guesses from one real person.
export function classifyHair(metrics) {
  const withHair = metrics.filter((m) => m.belowEar !== null);
  const area = Math.max(0, ...metrics.map((m) => m.areaRatio));
  if (area < 0.06 || !withHair.length) return { length: 'None or shaved', area };
  const below = withHair.map((m) => m.belowEar).sort((x, y) => x - y)[withHair.length >> 1];
  const thick = metrics[0].topThickness ?? Math.max(...withHair.map((m) => m.topThickness));
  const length = below < 0.15 ? (thick < 0.1 ? 'Buzz cut' : 'Short') : below < 0.6 ? 'Medium (neck length)' : below < 1.1 ? 'Shoulder length' : 'Long';
  // Colour: median over the photos' hair medians, each channel.
  const cols = withHair.map((m) => m.hair).filter(Boolean);
  const rgb = [0, 1, 2].map((c) => cols.map((x) => x[c]).sort((a, b) => a - b)[cols.length >> 1]);
  return { length, below, thick, area, rgb, hex: rgb2hex(rgb), colour: nameColour(rgb) };
}
