// Measurement-driven parametric body. Pure JS, no dependencies: runs in the browser and in Node.
// Inputs are centimetres; the mesh is in metres, feet on y = 0, facing +z, avatar's left on +x.

const N = 48; // vertices per cross-section ring

// Required inputs, then optional ones with defaults as a ratio of the closest required measurement,
// so a slim tall person does not get thick default thighs. Ratios are ANSUR II medians (6,068 adults);
// arm girths are lowered a little because ANSUR measures them flexed. Ankle has no ANSUR column.
export const REQUIRED = ['height', 'chest', 'waist', 'hip', 'shoulder'];
export const OPTIONAL_RATIOS = {
  inseam: ['height', 0.481], neck: ['chest', 0.369], thigh: ['hip', 0.61], knee: ['hip', 0.38],
  calf: ['hip', 0.379], ankle: ['height', 0.13], upperArm: ['chest', 0.32], forearm: ['chest', 0.28],
  wrist: ['height', 0.098], armLength: ['height', 0.342],
};
const RANGES = {
  height: [120, 230], chest: [60, 180], waist: [45, 180], hip: [60, 180], shoulder: [28, 65],
};

export function resolveMeasurements(input) {
  const m = { ...input };
  for (const [k, [base, r]] of Object.entries(OPTIONAL_RATIOS)) if (!(m[k] > 0)) m[k] = +(m[base] * r).toFixed(1);
  return m;
}

export function validate(input) {
  const errors = [];
  for (const k of REQUIRED) {
    const v = input[k], [lo, hi] = RANGES[k];
    if (!(v >= lo && v <= hi)) errors.push(`${k} must be between ${lo} and ${hi} cm`);
  }
  if (!errors.length) {
    const m = resolveMeasurements(input);
    // ANSUR II extremes: inseam/height 0.42–0.54, thigh/hip 0.53–0.69. Bounds leave a margin.
    if (m.inseam < m.height * 0.4 || m.inseam > m.height * 0.56) errors.push('inseam must be 40–56% of height');
    if (m.thigh > m.hip * 0.75) errors.push('thigh must be under 75% of the hip');
  }
  return errors;
}

// Superellipse ring with half-width 1, front half-depth f, back half-depth b, exponent n.
function unitRing(n, f, b) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / N, c = Math.cos(t), s = Math.sin(t);
    pts.push([Math.sign(c) * Math.abs(c) ** (2 / n), Math.sign(s) * Math.abs(s) ** (2 / n) * (s > 0 ? f : b)]);
  }
  return pts;
}
const perimeter = (pts) => pts.reduce((sum, p, i) => {
  const q = pts[(i + 1) % pts.length];
  return sum + Math.hypot(q[0] - p[0], q[1] - p[1]);
}, 0);
// Scale a unit ring so its tape-measure perimeter equals P (metres). The ring is convex, so tape = polygon.
function ringP(P, [n, f, b]) {
  const u = unitRing(n, f, b), k = P / perimeter(u);
  return u.map(([x, z]) => [x * k, z * k]);
}
const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

const SHAPE = { shoulder: [3, 0.52, 0.5], neck: [2, 0.9, 0.9], limb: [2, 0.95, 0.95] };

// Torso cross-sections: [breadth, depth] as a fraction of girth, ANSUR II medians by sex.
// FRONT is the share of the depth in front of the centre line (the seat sits behind).
const SECTION = {
  male: { chest: [0.274, 0.24], waist: [0.348, 0.252], hip: [0.339, 0.241] },
  female: { chest: [0.285, 0.261], waist: [0.349, 0.246], hip: [0.347, 0.227] },
};
const FRONT = { chest: 0.55, waist: 0.52, hip: 0.42 };
// Ring proportions [n, f, b] whose breadth and depth match the table for this girth.
// The exponent n (roundness) is solved so that perimeter / half-width = 2 / breadth.
function sectionShape(sex, name) {
  const [br, dp] = SECTION[sex]?.[name] ?? SECTION.male[name].map((v, i) => (v + SECTION.female[name][i]) / 2);
  const fb = (2 * dp) / br, f = fb * FRONT[name], b = fb - f;
  let lo = 1.6, hi = 4; // cap: a rounder chest than ANSUR breadth implies, but not a box
  for (let i = 0; i < 40; i++) {
    const n = (lo + hi) / 2;
    if (perimeter(unitRing(n, f, b)) < 2 / br) lo = n; else hi = n;
  }
  return [(lo + hi) / 2, f, b];
}

// armAngle: A-pose angle of the arms from vertical, degrees. Try-on uses a wider pose so clothes clear the arms.
export function buildBody(input, { armAngle = 12 } = {}) {
  const m = resolveMeasurements(input);
  const cm = (v) => v / 100;
  const H = cm(m.height);

  // Landmark heights (metres). Crotch height = inseam.
  const L = {
    crotchY: cm(m.inseam), hipY: cm(m.inseam) + 0.07 * H, waistY: 0.62 * H, chestY: 0.725 * H,
    armpitY: 0.755 * H, shoulderY: 0.818 * H, neckY: 0.845 * H, kneeY: 0.285 * H, ankleY: 0.045 * H,
  };
  L.waistY = Math.max(L.waistY, L.hipY + 0.04 * H); // long legs: keep waist above hip
  L.thighY = L.crotchY - 0.01 * H;
  L.calfY = lerp(L.ankleY, L.kneeY, 0.66);
  L.headCY = H - 0.066 * H;
  L.neckMidY = lerp(L.neckY, L.headCY - 0.03 * H, 0.5);

  const pos = [], uv = [], idx = [], sIdx = [], sW = [], parts = {};
  const B = {}; // bone name -> index
  const bones = [];
  const bone = (name, parent, p) => { B[name] = bones.length; bones.push({ name, parent, pos: p }); };

  // weights: array of [boneName, weight]; padded to 4 influences.
  function vertex(p, w, u = [0.02, 0.02]) {
    pos.push(...p); uv.push(...u);
    const ws = w.filter(([, x]) => x > 1e-4).slice(0, 4), tot = ws.reduce((s, [, x]) => s + x, 0);
    for (let i = 0; i < 4; i++) { sIdx.push(ws[i] ? B[ws[i][0]] : 0); sW.push(ws[i] ? ws[i][1] / tot : 0); }
    return pos.length / 3 - 1;
  }
  const part = (name, fn) => { const start = idx.length; fn(); parts[name] = { start, count: idx.length - start }; };

  // Tube through rings: each ring = { pts: [[x,y,z]...N], w: weights }. Caps close both ends.
  function tube(rings, capStart = true, capEnd = true) {
    const base = pos.length / 3;
    for (const r of rings) for (const p of r.pts) vertex(p, r.w);
    for (let j = 0; j < rings.length - 1; j++) for (let i = 0; i < N; i++) {
      const a = base + j * N + i, b = base + j * N + ((i + 1) % N), c = a + N, d = b + N;
      idx.push(a, c, b, b, c, d);
    }
    const cap = (r, ring, flip) => {
      const c = r.pts.reduce((s, p) => s.map((v, k) => v + p[k] / N), [0, 0, 0]);
      const ci = vertex(c, r.w), o = base + ring * N;
      for (let i = 0; i < N; i++) {
        const a = o + i, b = o + ((i + 1) % N);
        flip ? idx.push(ci, b, a) : idx.push(ci, a, b);
      }
    };
    if (capStart) cap(rings[0], 0, true);
    if (capEnd) cap(rings[rings.length - 1], rings.length - 1, false);
  }

  // Ellipsoid around center c with axis vectors ax (x), ay (y), az (z), each already scaled to the radius.
  function ellipsoid(c, ax, ay, az, w, uvFn) {
    const base = pos.length / 3, lat = 20, lon = 32;
    for (let i = 0; i <= lat; i++) {
      const th = (Math.PI * i) / lat, st = Math.sin(th), ct = Math.cos(th);
      for (let j = 0; j <= lon; j++) {
        const ph = (2 * Math.PI * j) / lon, x = st * Math.sin(ph), y = ct, z = st * Math.cos(ph);
        const p = [0, 1, 2].map((k) => c[k] + ax[k] * x + ay[k] * y + az[k] * z);
        vertex(p, typeof w === 'function' ? w(p) : w, uvFn ? uvFn(x, y, z) : undefined);
      }
    }
    for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
      const a = base + i * (lon + 1) + j, b = a + 1, c2 = a + lon + 1, d = c2 + 1;
      idx.push(a, c2, b, b, c2, d);
    }
  }

  const S = { chest: sectionShape(m.sex, 'chest'), waist: sectionShape(m.sex, 'waist'), hip: sectionShape(m.sex, 'hip') };

  // --- skeleton (bind pose, world positions) ---
  const hipRing = ringP(cm(m.hip), S.hip);
  const hipHalfW = Math.max(...hipRing.map((p) => p[0]));
  const rThigh = cm(m.thigh) / (2 * Math.PI);
  const legTopX = Math.max(rThigh * 0.95, hipHalfW * 0.42), legAnkleX = legTopX * 0.6;
  const legX = (y) => lerp(legAnkleX, legTopX, clamp01((y - L.ankleY) / (L.crotchY - L.ankleY)));
  const rUpper = cm(m.upperArm) / (2 * Math.PI);
  const alpha = (armAngle * Math.PI) / 180; // A-pose arm angle from vertical
  const armScale = cm(m.armLength) / (0.332 * H);
  const lenU = 0.186 * H * armScale, lenF = 0.146 * H * armScale, lenHand = 0.108 * H;

  bone('hips', -1, [0, L.hipY, 0]);
  bone('spine', 'hips', [0, L.waistY, 0]);
  bone('chest', 'spine', [0, L.chestY, 0]);
  bone('neck', 'chest', [0, L.neckY, 0]);
  bone('head', 'neck', [0, L.headCY - 0.03 * H, 0]);
  const arm = {};
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    bone(`thigh${side}`, 'hips', [sx * legTopX, L.crotchY + 0.03 * H, 0]);
    bone(`shin${side}`, `thigh${side}`, [sx * legX(L.kneeY), L.kneeY, 0]);
    bone(`foot${side}`, `shin${side}`, [sx * legAnkleX, L.ankleY, 0]);
    const j = [sx * (cm(m.shoulder) / 2 - rUpper * 0.9), L.shoulderY - rUpper * 0.6, 0];
    const d = [sx * Math.sin(alpha), -Math.cos(alpha), 0];
    const at = (s) => j.map((v, k) => v + d[k] * s);
    arm[side] = { j, d, u: [Math.cos(alpha), sx * Math.sin(alpha), 0], at };
    bone(`upperArm${side}`, 'chest', j);
    bone(`foreArm${side}`, `upperArm${side}`, at(lenU));
    bone(`hand${side}`, `foreArm${side}`, at(lenU + lenF));
  }

  // --- torso ---
  const torsoBones = [['hips', L.hipY], ['spine', L.waistY], ['chest', L.chestY], ['neck', L.neckY]];
  const torsoW = (y) => {
    if (y <= torsoBones[0][1]) return [['hips', 1]];
    for (let i = 0; i < torsoBones.length - 1; i++) {
      const [a, ya] = torsoBones[i], [b, yb] = torsoBones[i + 1];
      if (y <= yb) { const t = (y - ya) / (yb - ya); return [[a, 1 - t], [b, t]]; }
    }
    return [['neck', 1]];
  };
  const shoulderRing = (() => { const u = unitRing(...SHAPE.shoulder), k = cm(m.shoulder) / 2; return u.map(([x, z]) => [x * k, z * k]); })();
  const torsoSpec = [
    [L.crotchY, ringP(cm(m.hip) * 0.82, S.hip)],
    [L.hipY, hipRing],
    [lerp(L.hipY, L.waistY, 0.5), ringP(cm(lerp(m.hip, m.waist, 0.6)), S.waist)],
    [L.waistY, ringP(cm(m.waist), S.waist)],
    [lerp(L.waistY, L.chestY, 0.55), ringP(cm(lerp(m.waist, m.chest, 0.6)), S.chest)],
    [L.chestY, ringP(cm(m.chest), S.chest)],
    [L.armpitY, ringP(cm(m.chest) * 0.97, S.chest)],
    [L.shoulderY, shoulderRing],
    [L.shoulderY + 0.014 * H, shoulderRing.map(([x, z]) => [x * 0.6, z * 0.9])],
    [L.neckY, ringP(cm(m.neck) * 1.08, SHAPE.neck)],
  ];
  part('torso', () => tube(torsoSpec.map(([y, r]) => ({ pts: r.map(([x, z]) => [x, y, z]), w: torsoW(y) }))));

  part('neck', () => {
    const r = ringP(cm(m.neck), SHAPE.neck);
    const ys = [L.neckY - 0.01 * H, L.neckMidY, L.headCY - 0.03 * H];
    tube(ys.map((y, i) => ({ pts: r.map(([x, z]) => [x, y, z]), w: i === 2 ? [['head', 1]] : [['neck', 1]] })));
  });

  // --- legs ---
  for (const [side, sx] of [['L', 1], ['R', -1]]) {
    const legW = (y) => {
      const kneeT = clamp01((L.kneeY + 0.015 * H - y) / (0.03 * H));
      const ankleT = clamp01((L.ankleY + 0.01 * H - y) / (0.02 * H));
      const hipT = clamp01((y - L.crotchY) / (0.04 * H)) * 0.5;
      return [[`thigh${side}`, (1 - kneeT) * (1 - hipT)], [`hips`, hipT], [`shin${side}`, kneeT * (1 - ankleT)], [`foot${side}`, ankleT]];
    };
    const spec = [
      [L.crotchY + 0.04 * H, m.thigh], [L.thighY, m.thigh], [L.crotchY - 0.08 * H, m.thigh * 0.86],
      [L.kneeY + 0.05 * H, m.knee * 1.08], [L.kneeY, m.knee], [L.calfY, m.calf],
      [lerp(L.ankleY, L.calfY, 0.4), lerp(m.ankle, m.calf, 0.45)], [L.ankleY, m.ankle],
    ];
    part(`leg${side}`, () => tube(spec.map(([y, P]) => ({
      pts: ringP(cm(P), SHAPE.limb).map(([x, z]) => [sx * legX(y) + x, y, z]), w: legW(y),
    }))));
    part(`foot${side}`, () => ellipsoid([sx * legAnkleX, 0.025 * H, 0.03 * H], [0.028 * H, 0, 0], [0, 0.025 * H, 0], [0, 0, 0.078 * H], [[`foot${side}`, 1]]));
  }

  // --- arms ---
  for (const side of ['L', 'R']) {
    const { j, d, u, at } = arm[side];
    const armW = (s) => {
      const e = clamp01((s - (lenU - 0.012 * H)) / (0.024 * H)), wr = clamp01((s - (lenU + lenF - 0.008 * H)) / (0.016 * H));
      return [[`upperArm${side}`, 1 - e], [`foreArm${side}`, e * (1 - wr)], [`hand${side}`, wr]];
    };
    const spec = [
      [0, m.upperArm * 1.1], [lenU * 0.15, m.upperArm * 1.08], [lenU * 0.5, m.upperArm], [lenU, m.upperArm * 0.86],
      [lenU + lenF * 0.25, m.forearm], [lenU + lenF, m.wrist],
    ];
    part(`arm${side}`, () => tube(spec.map(([s, P]) => {
      const c = at(s);
      return { pts: ringP(cm(P), SHAPE.limb).map(([x, z]) => [0, 1, 2].map((k) => c[k] + u[k] * x + (k === 2 ? z : 0))), w: armW(s) };
    })));
    const hc = at(lenU + lenF + lenHand * 0.5);
    part(`hand${side}`, () => ellipsoid(hc, u.map((v) => v * 0.011 * H), d.map((v) => v * lenHand * 0.5), [0, 0, 0.025 * H], [[`hand${side}`, 1]]));
    // Deltoid cap hides the gap where the arm tube meets the torso.
    // Its top sits on the shoulder line so the shoulder-width measurement stays the torso's.
    const r = rUpper * 1.12, c = [j[0], L.shoulderY - r * 0.95, 0];
    part(`shoulder${side}`, () => ellipsoid(c, [r, 0, 0], [0, r, 0], [0, 0, r], [[`upperArm${side}`, 0.6], ['chest', 0.4]]));
  }

  // --- head (last, so it can carry its own material for the face texture) ---
  const headStart = idx.length;
  const hr = [0.045 * H, 0.066 * H, 0.056 * H];
  // Planar front projection for the face photo; the back of the head maps to a plain skin pixel.
  const faceUV = (x, y, z) => (z > 0 ? [0.5 + x * 0.5, 0.5 + y * 0.5] : [0.02, 0.02]);
  part('head', () => ellipsoid([0, L.headCY, 0.006 * H], [hr[0], 0, 0], [0, hr[1], 0], [0, 0, hr[2]], [['head', 1]], faceUV));

  return {
    measurements: m, landmarks: L, parts, bones,
    positions: new Float32Array(pos), uvs: new Float32Array(uv), indices: new Uint32Array(idx),
    skinIndex: new Uint16Array(sIdx), skinWeight: new Float32Array(sW),
    groups: [{ start: 0, count: headStart, materialIndex: 0 }, { start: headStart, count: idx.length - headStart, materialIndex: 1 }],
  };
}
