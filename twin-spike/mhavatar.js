// Rigged MakeHuman body fitted to tape measurements. Pure JS (browser and Node). MakeHuman mesh, skeleton and
// weights are CC0. The result has the shape of avatar-poc/body.js output (positions, indices, skin weights, bones,
// landmarks, parts), plus torso rings, so cloth-spike/tryon.js, shirt.js and avatar-poc/anim.js work on it.
// Units: metres, feet on y = 0, facing +z, avatar's left on +x.
import { resolveMeasurements } from '../avatar-poc/body.js';
import { findLandmarks, fitBody, sliceLoops, torsoOf, hull } from './mhbody.js';

const DATA = 'https://cdn.jsdelivr.net/gh/makehumancommunity/makehuman@a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/';
const N = 48; // points per torso ring, as in body.js

// Parse base.obj keeping its own vertex numbering (targets, joints and weights refer to it). Faces become triangles.
export function parseObj(text) {
  const v = [], groups = {};
  let g = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) { const p = line.split(/\s+/); v.push(+p[1], +p[2], +p[3]); }
    else if (line.startsWith('g ')) g = line.slice(2).trim();
    else if (line.startsWith('f ')) {
      const f = line.split(/\s+/).slice(1).filter(Boolean).map((t) => parseInt(t, 10) - 1);
      const out = (groups[g] ??= []);
      for (let i = 1; i + 1 < f.length; i++) out.push(f[0], f[i], f[i + 1]);
    }
  }
  return { v, groups };
}

// Add a MakeHuman .target file (lines "index dx dy dz") to the vertex array v, times weight w.
export function applyTarget(v, text, w) {
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const [i, dx, dy, dz] = line.trim().split(/\s+/).map(Number);
    v[i * 3] += w * dx; v[i * 3 + 1] += w * dy; v[i * 3 + 2] += w * dz;
  }
}

// Compact one group's faces into its own vertex list; objIndex -> local index in `map`.
export function compact(v, faces) {
  const map = new Map(), pos = [], idx = [];
  for (const i of faces) { if (!map.has(i)) { map.set(i, pos.length / 3); pos.push(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]); } idx.push(map.get(i)); }
  return { pos, idx, map };
}

let rigFiles = null;
// MakeHuman's default skeleton (joint positions as base.obj vertex lists) and its skin weights.
export const loadRig = () => (rigFiles ??= Promise.all(['rigs/default.mhskel', 'rigs/default_weights.mhw']
  .map((f) => fetch(DATA + f).then((r) => { if (!r.ok) throw new Error(`${f}: HTTP ${r.status}`); return r.json(); })))
  .then(([skel, w]) => ({ skel, weights: w.weights })));

// Our bones (the avatar-poc names anim.js drives) and the MakeHuman bone whose head is each joint.
const BONES = [['hips', -1, 'root'], ['spine', 'hips', 'spine03'], ['chest', 'spine', 'spine01'], ['neck', 'chest', 'neck01'], ['head', 'neck', 'head'],
  ...['L', 'R'].flatMap((s) => [[`upperArm${s}`, 'chest', `upperarm01.${s}`], [`foreArm${s}`, `upperArm${s}`, `lowerarm01.${s}`], [`hand${s}`, `foreArm${s}`, `wrist.${s}`],
    [`thigh${s}`, 'hips', `upperleg01.${s}`], [`shin${s}`, `thigh${s}`, `lowerleg01.${s}`], [`foot${s}`, `shin${s}`, `foot.${s}`]])];

// The default MakeHuman pose holds the arms 43 degrees out with the forearms bent forward and the hands out in front,
// which reads as reaching. ARM_POSE hangs the arms in the rest pose, so the shirt is built around them and the idle
// animation needs no arm offset. Below about 14 degrees the arm skin overlaps the torso at the armpit.
// upper, fore: angle from vertical in degrees (the forearm hangs on from the upper arm, a little less out);
// fwd: how far the forearm points forward (z, as a share of its length).
export const ARM_POSE = { upper: 14, fore: 11, fwd: 0.08 };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a) => a.map((x) => x / Math.hypot(...a));
// Rotation matrix taking unit vector a onto unit vector b (Rodrigues).
function rotateTo(a, b) {
  const ax = cross(a, b), s = Math.hypot(...ax), c = dot(a, b);
  if (s < 1e-9) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const [x, y, z] = ax.map((v) => v / s), t = 1 - c;
  return [[t * x * x + c, t * x * y - s * z, t * x * z + s * y], [t * x * y + s * z, t * y * y + c, t * y * z - s * x], [t * x * z - s * y, t * y * z + s * x, t * z * z + c]];
}
// Moves the arm bones and the skinned vertices into the pose. Each arm turns as a chain: the upper arm about the
// shoulder, the forearm and hand about the elbow. P is rewritten in place; weights shared with the chest blend the shoulder.
function poseArms(P, bones, skinIndex, skinWeight, pose) {
  const rad = Math.PI / 180, at = (n) => bones.findIndex((b) => b.name === n), M = new Map();
  const sub = (a, b) => a.map((x, k) => x - b[k]), add = (a, b) => a.map((x, k) => x + b[k]), mul = (R, v) => R.map((r) => dot(r, v));
  for (const [s, sx] of [['L', 1], ['R', -1]]) {
    const [u, f, h] = ['upperArm', 'foreArm', 'hand'].map((n) => at(n + s)), [ju, je, jw] = [u, f, h].map((i) => bones[i].pos);
    const RU = rotateTo(unit(sub(je, ju)), [sx * Math.sin(pose.upper * rad), -Math.cos(pose.upper * rad), 0]);
    const RF = rotateTo(unit(sub(jw, je)), unit([sx * Math.sin(pose.fore * rad), -Math.cos(pose.fore * rad), pose.fwd]));
    const je2 = add(ju, mul(RU, sub(je, ju))), jw2 = add(je2, mul(RF, sub(jw, je)));
    M.set(u, { R: RU, from: ju, to: ju }); M.set(f, { R: RF, from: je, to: je2 }); M.set(h, { R: RF, from: jw, to: jw2 });
    bones[f].pos = je2; bones[h].pos = jw2;
  }
  for (let i = 0; i < P.length / 3; i++) {
    const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], out = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const w = skinWeight[i * 4 + k], m = M.get(skinIndex[i * 4 + k]);
      const q = m ? m.to.map((x, a) => x + dot(m.R[a], sub(p, m.from))) : p;
      for (let a = 0; a < 3; a++) out[a] += w * q[a];
    }
    P.set(out, i * 3);
  }
}

// mh: loadHead()'s result: objV (all base.obj vertices, sex targets applied) and body { pos, idx, objToBody }.
// rig: from loadRig(). input: avatar-poc measurements in cm. armPose: ARM_POSE to hang the arms, null for MakeHuman's own.
export function buildMHBody(input, mh, rig, { armPose = null } = {}) {
  const m = resolveMeasurements(input), bp = mh.body.pos, bi = mh.body.idx, nv = bp.length / 3;
  const L0 = findLandmarks(bp, bi);
  const fit = fitBody(bp, bi, { height: m.height / 100, chest: m.chest / 100, waist: m.waist / 100, hip: m.hip / 100,
    shoulder: m.shoulder / 100, inseam: m.inseam / 100, thigh: m.thigh / 100, calf: m.calf / 100 }, L0);
  const P = new Float32Array(nv * 3);
  for (let i = 0; i < nv; i++) P.set(fit.deform([bp[i * 3], bp[i * 3 + 1], bp[i * 3 + 2]], i), i * 3);
  const L = { ...fit.landmarks };

  // Put the y axis down the middle of the torso: the shirt's rings are rays from the axis. In z, the middle of the
  // depth range every torso section from the hip to the neck shares (a bust or a forward neck moves the section centres).
  let front = Infinity, back = -Infinity;
  for (let y = L.hipY; y <= L.neckY; y += 0.02) {
    const t = torsoOf(sliceLoops(P, bi, y));
    if (t) { front = Math.min(front, Math.max(...t.pts.map((p) => p[1]))); back = Math.max(back, Math.min(...t.pts.map((p) => p[1]))); }
  }
  const dx = -torsoOf(sliceLoops(P, bi, L.chestY)).cx, dz = -(front + back) / 2;
  for (let i = 0; i < nv; i++) { P[i * 3] += dx; P[i * 3 + 2] += dz; }
  const place = (p) => [p[0] + dx, p[1], p[2] + dz];

  // Joints: the centroid of each MakeHuman joint's helper vertices, moved by the same fit.
  const joint = (name) => {
    const vs = rig.skel.joints[`${name}____head`], c = [0, 0, 0];
    for (const i of vs) for (let k = 0; k < 3; k++) c[k] += mh.objV[i * 3 + k] / vs.length;
    return place(fit.deform(c));
  };
  const bones = BONES.map(([name, parent, mhName]) => ({ name, parent, pos: joint(mhName) }));
  const ours = Object.fromEntries(BONES.map(([name, , mhName], i) => [mhName, i]));
  // Every MakeHuman bone counts as the nearest of our bones up its parent chain (fingers -> hand, spine05 -> hips).
  const toOurs = (b) => { while (!(b in ours)) b = rig.skel.bones[b].parent; return ours[b]; };

  // Skin weights: MakeHuman's, summed onto our bones; the 4 largest kept and normalised.
  const acc = Array.from({ length: nv }, () => new Map());
  for (const [b, list] of Object.entries(rig.weights)) {
    if (!rig.skel.bones[b]) continue;
    const j = toOurs(b);
    for (const [oi, w] of list) {
      const i = mh.body.objToBody.get(oi);
      if (i !== undefined) acc[i].set(j, (acc[i].get(j) ?? 0) + w);
    }
  }
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4), dominant = new Uint8Array(nv);
  for (let i = 0; i < nv; i++) {
    const top = [...acc[i]].sort((a, b) => b[1] - a[1]).slice(0, 4), sum = top.reduce((s, [, w]) => s + w, 0) || 1;
    if (!top.length) top.push([0, 1]);
    top.forEach(([j, w], k) => { skinIndex[i * 4 + k] = j; skinWeight[i * 4 + k] = w / sum; });
    dominant[i] = top[0][0];
  }

  // Triangles reordered so each arm (upper arm, forearm, hand) is one contiguous range, for per-arm surface tests.
  const sideOf = Object.fromEntries(['L', 'R'].flatMap((s) => ['upperArm', 'foreArm', 'hand'].map((n) => [BONES.findIndex((b) => b[0] === n + s), s])));
  const tri = { L: [], R: [], rest: [] };
  for (let t = 0; t < bi.length; t += 3) {
    const s = [bi[t], bi[t + 1], bi[t + 2]].map((i) => sideOf[dominant[i]]);
    tri[s[0] && s[0] === s[1] && s[1] === s[2] ? s[0] : 'rest'].push(bi[t], bi[t + 1], bi[t + 2]);
  }
  const indices = new Uint32Array([...tri.L, ...tri.R, ...tri.rest]);
  const parts = { all: { start: 0, count: indices.length }, armL: { start: 0, count: tri.L.length }, armR: { start: tri.L.length, count: tri.R.length } };

  // Girths the cloth code reads from body.measurements, measured on this mesh (cm): mean distance from the bone line.
  const B = Object.fromEntries(bones.map((b) => [b.name, b.pos]));
  const limbGirth = (from, to) => {
    const a = B[from], ab = B[to].map((x, k) => x - a[k]), l2 = ab.reduce((s, x) => s + x * x, 0), j = bones.findIndex((b) => b.name === from);
    let s = 0, n = 0;
    for (let i = 0; i < nv; i++) if (dominant[i] === j) {
      const p = [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]], t = Math.min(1, Math.max(0, ab.reduce((acc2, x, k) => acc2 + x * (p[k] - a[k]), 0) / l2));
      s += Math.hypot(...p.map((x, k) => x - a[k] - t * ab[k])); n++;
    }
    return +((200 * Math.PI * s) / n).toFixed(1);
  };
  const neckLoop = torsoOf(sliceLoops(P, indices, L.neckY));
  const measurements = { ...m, upperArm: limbGirth('upperArmL', 'foreArmL'), forearm: limbGirth('foreArmL', 'handL'), neck: +(neckLoop.girth * 100).toFixed(1) };
  L.neckMidY = (L.neckY + B.head[1]) / 2;

  const rings = torsoRingsOf(P, indices, L, m.shoulder / 100); // from the torso alone, before the arms come down to it
  if (armPose) poseArms(P, bones, skinIndex, skinWeight, armPose);
  return { measurements, landmarks: L, bones, parts, positions: P, indices, skinIndex, skinWeight, rings,
    shirtParts: ['all'], armParts: { L: ['armL'], R: ['armR'] }, place, deform: fit.deform };
}

// Torso cross-sections from the hem to the neck as rings of N points, ray-cast from the y axis like body.js rings:
// index 0 on +x, N/4 at the front. Above the armpit the section takes in the arms, so it is cut at a half-width that
// widens from the armpit to half the shoulder width.
function torsoRingsOf(P, idx, L, shoulder) {
  const rings = [];
  let armpitHalf = null;
  for (let y = L.crotchY + 0.01; y <= L.neckY + 1e-9; y += 0.01) {
    const t = torsoOf(sliceLoops(P, idx, y));
    if (!t) continue;
    const h = hull(t.pts);
    if (y <= L.armpitY) armpitHalf = Math.max(...h.map((p) => Math.abs(p[0])));
    const xMax = y <= L.armpitY ? Infinity : armpitHalf + (shoulder / 2 - armpitHalf) * Math.min(1, (y - L.armpitY) / (L.shoulderY - L.armpitY));
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N, d = [Math.cos(a), Math.sin(a)];
      let r = 0;
      for (let e = 0; e < h.length; e++) { // ray from the origin against the hull edge p -> q
        const p = h[e], q = h[(e + 1) % h.length], ex = q[0] - p[0], ez = q[1] - p[1];
        const den = d[0] * ez - d[1] * ex;
        if (Math.abs(den) < 1e-12) continue;
        const s = (p[0] * ez - p[1] * ex) / den, u = (p[0] * d[1] - p[1] * d[0]) / den;
        if (s > 0 && u >= 0 && u <= 1) r = Math.max(r, s);
      }
      if (Math.abs(d[0] * r) > xMax) r = xMax / Math.abs(d[0]);
      pts.push([d[0] * r, d[1] * r]);
    }
    rings.push({ y, pts });
  }
  return rings;
}
