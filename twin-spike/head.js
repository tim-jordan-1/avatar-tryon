// MakeHuman head shaped and textured from the photos (no hair). Browser only (three.js).
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { similarity, apply, unapply } from './fuse.js';
import { fitWarp } from './rbf.js';
import { FACE_SKIN } from './hair.js';
import { parseObj, compact, applyTarget } from './mhavatar.js';

// MakeHuman base mesh (CC0 asset), pinned to a commit.
const MH = 'https://cdn.jsdelivr.net/gh/makehumancommunity/makehuman@a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/3dobjs/base.obj';
const BODY_SKIN = 2;
const NECK_CUT = 0.85; // keep the mesh above this fraction of body height: head and neck, no shoulders

const v3 = (a, i) => [a[i * 3], a[i * 3 + 1], a[i * 3 + 2]];

const TARGETS = 'https://cdn.jsdelivr.net/gh/makehumancommunity/makehuman@a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/targets/macrodetails/';
// MakeHuman's default young adult of one sex: the three ethnic young targets at 1/3 each, plus the universal one.
const SEX_TARGETS = (sex) => [...['african', 'asian', 'caucasian'].map((e) => [`${e}-${sex}-young.target`, 1 / 3]), [`universal-${sex}-young-averagemuscle-averageweight.target`, 1]];

let objText = null;
// Load the base mesh (with a sex's shape targets applied) and cut out the head and neck; eyes as separate meshes.
export async function loadHead(sex = null) {
  objText ??= await (await fetch(MH)).text();
  const { v, groups } = parseObj(objText);
  if (sex) {
    for (const [file, w] of SEX_TARGETS(sex)) applyTarget(v, await (await fetch(TARGETS + file)).text(), w);
  }
  const body = compact(v, groups.body), bp = body.pos, bi = body.idx;
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < bp.length; i += 3) { lo = Math.min(lo, bp[i]); hi = Math.max(hi, bp[i]); }
  const cut = lo + NECK_CUT * (hi - lo), map = new Map(), pos = [], idx = [], toBody = [], restIdx = [], restVerts = new Set();
  for (let t = 0; t < bi.length; t += 3) {
    const tri = [bi[t], bi[t + 1], bi[t + 2]];
    if (!tri.every((i) => bp[i * 3 + 1] > cut)) { restIdx.push(...tri); tri.forEach((i) => restVerts.add(i)); continue; }
    for (const i of tri) {
      if (!map.has(i)) { map.set(i, pos.length / 3); toBody.push(i); pos.push(...v3(bp, i)); }
      idx.push(map.get(i));
    }
  }
  // Head vertices also used by the rest of the body: they must land exactly where the body puts them.
  const seam = new Set(toBody.flatMap((b, h) => (restVerts.has(b) ? [h] : [])));
  const eyes = ['helper-r-eye', 'helper-l-eye'].map((n) => { const e = compact(v, groups[n]); return { pos: e.pos, idx: e.idx }; });
  // objToBody: original base.obj vertex number -> body vertex index (for hair proxies fitted to the body).
  return { pos, idx, eyes, height: hi - lo, neckY: cut, body: { pos: bp, idx: bi, restIdx, objToBody: body.map }, toBody, seam, sex, objV: v };
}

function normals(pos, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.attributes.normal.array;
}

// A plain painted eye (pupil, brown iris, white) on a MakeHuman eye mesh facing +z. pos: flat array.
export function eyeMesh(pos, idx) {
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  g.computeBoundingBox();
  const c = g.boundingBox.getCenter(new THREE.Vector3()), r = g.boundingBox.max.z - c.z, col = [];
  for (let i = 0; i < pos.length; i += 3) {
    const k = pos[i + 2] > c.z ? Math.hypot(pos[i] - c.x, pos[i + 1] - c.y) / r : 9;
    col.push(...(k < 0.2 ? [0.02, 0.02, 0.02] : k < 0.45 ? [0.25, 0.15, 0.08] : [0.92, 0.9, 0.87]));
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2 }));
}

// Render the bare head from the front and run the face landmarker on it: landmark index -> head vertex index.
export function correspond(head, landmarker) {
  const W = 512, H = 640, renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#202226');
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(head.pos, 3));
  geo.setIndex(head.idx);
  geo.computeVertexNormals();
  scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#c99677', roughness: 0.6 })));
  for (const e of head.eyes) scene.add(eyeMesh(e.pos, e.idx));
  scene.add(new THREE.HemisphereLight(0xffffff, 0x665544, 1.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4); key.position.set(0.3, 0.5, 1); scene.add(key);
  geo.computeBoundingBox();
  const b = geo.boundingBox, cx = (b.min.x + b.max.x) / 2, cy = (b.min.y + b.max.y) / 2, half = (b.max.y - b.min.y) * 0.62;
  const cam = new THREE.OrthographicCamera(cx - half * W / H, cx + half * W / H, cy + half, cy - half, -100, 100);
  cam.position.set(0, 0, 50);
  renderer.render(scene, cam);
  const lm = landmarker.detect(renderer.domElement).faceLandmarks[0];
  renderer.dispose();
  if (!lm) throw new Error('No face found on the MakeHuman head render');

  const n = normals(head.pos, head.idx), nv = head.pos.length / 3, used = new Set(), out = new Map();
  const radius = (b.max.x - b.min.x) * 0.012;
  for (let i = 0; i < 468; i++) { // 468-477 are the irises: they sit on the eye meshes, not the head
    const x = cam.left + lm[i].x * (cam.right - cam.left), y = cam.top - lm[i].y * (cam.top - cam.bottom);
    let best = -1, bestZ = -Infinity, near = -1, nd = Infinity;
    for (let v = 0; v < nv; v++) {
      if (n[v * 3 + 2] < 0.05) continue;
      const d = Math.hypot(head.pos[v * 3] - x, head.pos[v * 3 + 1] - y);
      if (d < nd) { nd = d; near = v; }
      if (d < radius && head.pos[v * 3 + 2] > bestZ) { bestZ = head.pos[v * 3 + 2]; best = v; }
    }
    const v = best >= 0 ? best : near;
    if (v >= 0 && !used.has(v)) { used.add(v); out.set(i, v); }
  }
  return out;
}

const MAX_BLEND = 16; // photos the blend shader takes

// Box blur of a w x h float image, in place, radius r, three passes (close to a Gaussian).
function boxBlur(a, w, h, r) {
  const tmp = new Float32Array(Math.max(w, h)), k = 1 / (2 * r + 1);
  const pass = (n, len, at) => {
    for (let line = 0; line < n; line++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += a[at(line, Math.min(len - 1, Math.max(0, j)))];
      for (let j = 0; j < len; j++) {
        tmp[j] = s * k;
        s += a[at(line, Math.min(len - 1, j + r + 1))] - a[at(line, Math.max(0, j - r))];
      }
      for (let j = 0; j < len; j++) a[at(line, j)] = tmp[j];
    }
  };
  for (let i = 0; i < 3; i++) { pass(h, w, (y, x) => y * w + x); pass(w, h, (x, y) => y * w + x); }
}

const DETAIL_MAX = 2; // the atlas stores detail / DETAIL_MAX in 8 bits

// The photo's skin detail with its colour and shading removed: each skin pixel divided by the mean skin colour around it
// (linear RGB, about 1/14 of the face height wide). Brows, lips, lids and pores stay; the photo's skin tone, light and
// shadows go. Returns RGBA bytes: detail / DETAIL_MAX, and the skin mask in alpha.
function skinDetail({ w, h, mask, lmPx }, rgba) {
  const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lut = Float32Array.from({ length: 256 }, (_, v) => lin(v)), n = w * h;
  const ys = lmPx.map((p) => p.y), r = Math.max(2, Math.round((Math.max(...ys) - Math.min(...ys)) / 14));
  const m = new Float32Array(n), ch = [0, 1, 2].map(() => new Float32Array(n));
  for (let p = 0; p < n; p++) {
    if (mask[p] !== FACE_SKIN && mask[p] !== BODY_SKIN) continue;
    m[p] = 1;
    for (let c = 0; c < 3; c++) ch[c][p] = lut[rgba[p * 4 + c]];
  }
  const out = new Uint8ClampedArray(n * 4), mb = m.slice();
  boxBlur(mb, w, h, r);
  for (let c = 0; c < 3; c++) {
    const b = ch[c].slice();
    boxBlur(b, w, h, r);
    for (let p = 0; p < n; p++) if (m[p]) out[p * 4 + c] = (255 * ch[c][p] * mb[p]) / Math.max(1e-6, b[p]) / DETAIL_MAX;
  }
  for (let p = 0; p < n; p++) out[p * 4 + 3] = m[p] * 255;
  return out;
}

// A lit skin material for the face: the measured skin colour (skinHex, the same as the body) everywhere, times the
// photos' skin detail (skinDetail). The detail of every photo is mixed by how directly the photo sees the spot (the
// cosine to the 4th power). Below the chin the detail fades out, so the neck meets the body with no seam. Reads the
// fusedPos and fusedNrm attributes. The mixing comes from sweep-spike, where it gave
// about 20% less colour error than one photo per triangle, and no seams.
function blendMaterial({ views, points: F }, res, skinHex, k = 4) {
  const chinY = F[152][1], faceH = F[10][1] - F[152][1]; // landmarks 10 and 152: top of the forehead and the chin
  const n = Math.min(views.length, MAX_BLEND), cols = 4, rows = Math.ceil(n / cols);
  const cw = Math.max(...res.slice(0, n).map((r) => r.w)), ch = Math.max(...res.slice(0, n).map((r) => r.h));
  const atlas = Object.assign(document.createElement('canvas'), { width: cols * cw, height: rows * ch }), g = atlas.getContext('2d');
  for (let i = 0; i < n; i++) { // each photo's detail fills its cell
    const { w, h, rgba } = res[i]; // the pixels analyse.js already read: a second read of the canvas is slow
    const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
    c.getContext('2d').putImageData(new ImageData(skinDetail(res[i], rgba), w, h), 0, 0);
    g.drawImage(c, (i % cols) * cw, Math.floor(i / cols) * ch, cw, ch);
  }
  const tex = new THREE.CanvasTexture(atlas); // raw values, no colour space
  // Fused frame -> normalised photo coordinates (y down): the inverse of each view's similarity transform.
  const mats = views.slice(0, n).map(({ T }, i) => {
    const r0 = [0, 1, 2].map((j) => T.R[j][0] / (T.s * res[i].w)), r1 = [0, 1, 2].map((j) => -T.R[j][1] / (T.s * res[i].h));
    const o = (r) => -(r[0] * T.t[0] + r[1] * T.t[1] + r[2] * T.t[2]);
    return new THREE.Matrix4().set(...r0, o(r0), ...r1, o(r1), 0, 0, 0, 0, 0, 0, 0, 1);
  });
  const cams = views.slice(0, n).map((v) => new THREE.Vector3(...v.camDir));
  while (mats.length < MAX_BLEND) mats.push(new THREE.Matrix4());
  while (cams.length < MAX_BLEND) cams.push(new THREE.Vector3());
  const m = new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.65 });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, { uAtlas: { value: tex }, uV: { value: mats }, uC: { value: cams }, uChin: { value: new THREE.Vector2(chinY - 0.2 * faceH, chinY) }, uN: { value: n }, uCols: { value: cols }, uRows: { value: rows }, uK: { value: k } });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 fusedPos; attribute vec3 fusedNrm; varying vec3 vFP; varying vec3 vFN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFP = fusedPos; vFN = fusedNrm;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform sampler2D uAtlas; uniform mat4 uV[${MAX_BLEND}]; uniform vec3 uC[${MAX_BLEND}]; uniform vec2 uChin; uniform int uN; uniform float uCols, uRows, uK;
varying vec3 vFP; varying vec3 vFN;`)
      .replace('#include <map_fragment>', `{
  vec3 fnrm = normalize(vFN), acc = vec3(0.0); float ws = 0.0;
  for (int i = 0; i < ${MAX_BLEND}; i++) {
    if (i >= uN) break;
    vec4 q = uV[i] * vec4(vFP, 1.0);
    float c = dot(fnrm, uC[i]);
    if (c < 0.2 || q.x < 0.0 || q.x > 1.0 || q.y < 0.0 || q.y > 1.0) continue;
    float w = pow(c, uK) * smoothstep(0.2, 0.4, c), col = mod(float(i), uCols), row = floor(float(i) / uCols);
    vec4 s = texture2D(uAtlas, vec2((col + q.x) / uCols, 1.0 - (row + q.y) / uRows));
    acc += w * s.rgb * ${DETAIL_MAX.toFixed(1)}; ws += w * s.a; // s.rgb is already scaled by s.a at mask edges
  }
  if (ws > 1e-4) diffuseColor.rgb *= mix(vec3(1.0), acc / ws, smoothstep(0.0, 0.05, ws) * smoothstep(uChin.x, uChin.y, vFP.y));
}`);
  };
  return m;
}

// Everything below is in the fused photo frame (pixels, y up, z toward the camera); the caller scales it.
// deform: optional (point in the MakeHuman frame) -> point in the output frame (the measured body). Without it,
// the head stays in the photo frame on its own; with it, the whole body is built and the head sits on it.
// tint: optional (output point) -> [r, g, b] factor for the skin colour, or null to leave the skin as it is (fit map).
// blend: mix every photo by how directly it sees each spot (see blendMaterial), instead of one photo per triangle.
export function buildTwin({ head, corr, res, fused, skinHex, mmPerPx, photos, deform, tint, blend = true }) {
  const F = fused.points, views = fused.views, mm = 1 / mmPerPx;
  const lmIdx = [...corr.keys()], src = lmIdx.map((i) => v3(head.pos, corr.get(i)));
  const T = similarity(src, lmIdx.map((i) => F[i]));
  let pos = [];
  for (let v = 0; v < head.pos.length / 3; v++) pos.push(...apply(T, v3(head.pos, v)));

  // Warp: landmark vertices move onto the fused face; the back of the head and the neck base stay put.
  const earZ = (F[234][2] + F[454][2]) / 2, nv = pos.length / 3;
  let minY = Infinity;
  for (let v = 0; v < nv; v++) minY = Math.min(minY, pos[v * 3 + 1]);
  const centres = [], disp = [];
  // Drop matches that would move a vertex far more than the rest: those are wrong matches, not face shape.
  const moves = lmIdx.map((i) => { const q = v3(pos, corr.get(i)); return { q, d: F[i].map((x, k) => x - q[k]) }; });
  const med = moves.map((m) => Math.hypot(...m.d)).sort((a, b) => a - b)[moves.length >> 1];
  const keep = moves.filter((m) => Math.hypot(...m.d) <= Math.max(3 * med, 6 * mm));
  for (const m of keep) { centres.push(m.q); disp.push(m.d); }
  for (let v = 0; v < nv; v += 9) {
    const q = v3(pos, v);
    // Anchors well behind the ears: closer ones crease the skull where the moving face meets them.
    if (q[2] < earZ - 55 * mm || q[1] < minY + 12 * mm) { centres.push(q); disp.push([0, 0, 0]); }
  }
  const warp = fitWarp(centres, disp);
  let maxMove = 0;
  for (let v = 0; v < nv; v++) {
    const q = v3(pos, v), d = warp(q);
    maxMove = Math.max(maxMove, Math.hypot(...d));
    pos[v * 3] += d[0]; pos[v * 3 + 1] += d[1]; pos[v * 3 + 2] += d[2];
  }
  const eyes = head.eyes.map((e) => {
    const p = [];
    for (let v = 0; v < e.pos.length / 3; v++) p.push(...apply(T, v3(e.pos, v)));
    const c = [0, 1, 2].map((k) => p.filter((_, i) => i % 3 === k).reduce((a, b) => a + b, 0) / (p.length / 3)), d = warp(c);
    return { pos: p.map((x, i) => x + d[i % 3]), idx: e.idx }; // move eyes rigidly with the warp at their centre
  });

  // Photo projection: a fused-frame point into view v's normalised image coordinates.
  const project = (v, q) => { const p = unapply(views[v].T, q); return [p[0] / res[v].w, -p[1] / res[v].h]; };
  const label = (v, [x, y]) => {
    const px = Math.min(res[v].w - 1, Math.max(0, Math.round(x * res[v].w))), py = Math.min(res[v].h - 1, Math.max(0, Math.round(y * res[v].h)));
    return res[v].mask[py * res[v].w + px];
  };
  const cams = views.map((v) => v.camDir);
  const bestView = (n) => { let b = 0, bd = -2; cams.forEach((c, v) => { const d = n[0] * c[0] + n[1] * c[1] + n[2] * c[2]; if (d > bd) { bd = d; b = v; } }); return [b, bd]; };

  // Output positions: the photo frame, or back to the MakeHuman frame and onto the measured body.
  const outHead = Array.from({ length: nv }, (_, v) => (!deform ? v3(pos, v)
    : head.seam.has(v) ? deform(v3(head.body.pos, head.toBody[v]), head.toBody[v]) : deform(unapply(T, v3(pos, v)))));
  const outOf = (p) => (deform ? deform(unapply(T, p)) : p);

  // Face texturing: each triangle from the photo that sees it best, where that photo shows skin there.
  // fromBody: the body vertex each output vertex comes from, so a caller can skin the twin with the body's weights.
  // One group per photo, then the last group (index np) for the plain skin tone.
  const np = views.length, mk = () => Array.from({ length: np + 1 }, () => []);
  // fp, fn: each output vertex in the fused frame, for the blend shader (the output frame may be the body's).
  const vn = normals(pos, head.idx), groups = mk(), uvs = mk(), fromBody = mk(), fp = mk(), fn = mk();
  let photoTris = 0;
  for (let t = 0; t < head.idx.length; t += 3) {
    const tri = [head.idx[t], head.idx[t + 1], head.idx[t + 2]];
    const nrm = [0, 1, 2].map((k) => tri.reduce((s, i) => s + vn[i * 3 + k], 0) / 3), [v, d] = bestView(nrm);
    const ctr = [0, 1, 2].map((k) => tri.reduce((s, i) => s + pos[i * 3 + k], 0) / 3), lab = label(v, project(v, ctr));
    const g = d > 0.2 && (lab === FACE_SKIN || lab === BODY_SKIN) ? v : np;
    if (g < np) photoTris++;
    for (const i of tri) {
      groups[g].push(...outHead[i]); fromBody[g].push(head.toBody[i]); fp[g].push(...v3(pos, i)); fn[g].push(...v3(vn, i));
      const uv = g < np ? project(g, v3(pos, i)) : [0, 0]; uvs[g].push(uv[0], 1 - uv[1]);
    }
  }
  if (deform) { // the rest of the body, in the skin tone
    const bp = head.body.pos, cache = new Map(), at = (i) => { if (!cache.has(i)) cache.set(i, deform(v3(bp, i), i)); return cache.get(i); };
    for (const i of head.body.restIdx) { groups[np].push(...at(i)); uvs[np].push(0, 0); fromBody[np].push(i); fp[np].push(0, 0, 0); fn[np].push(0, 0, 1); }
  }
  const skinGeo = new THREE.BufferGeometry(), allPos = groups.flat(), allUv = uvs.flat();
  skinGeo.setAttribute('position', new THREE.Float32BufferAttribute(allPos, 3));
  skinGeo.setAttribute('uv', new THREE.Float32BufferAttribute(allUv, 2));
  skinGeo.setAttribute('fusedPos', new THREE.Float32BufferAttribute(fp.flat(), 3));
  skinGeo.setAttribute('fusedNrm', new THREE.Float32BufferAttribute(fn.flat(), 3));
  let start = 0;
  groups.forEach((g, i) => { skinGeo.addGroup(start, g.length / 3, i); start += g.length / 3; });
  // Smooth shading across the per-view split: average normals by position.
  const smooth = mergeVertices(skinGeo.clone().deleteAttribute('uv'), 1e-6); smooth.computeVertexNormals();
  const nmap = new Map(), sp = smooth.attributes.position.array, sn = smooth.attributes.normal.array;
  for (let i = 0; i < sp.length; i += 3) nmap.set(`${sp[i]},${sp[i + 1]},${sp[i + 2]}`, [sn[i], sn[i + 1], sn[i + 2]]);
  skinGeo.setAttribute('normal', new THREE.Float32BufferAttribute(allPos.flatMap((_, i) => (i % 3 ? [] : nmap.get(`${Math.fround(allPos[i])},${Math.fround(allPos[i + 1])},${Math.fround(allPos[i + 2])}`) ?? [0, 0, 1])), 3));
  if (tint) {
    const col = new Float32Array(allPos.length);
    for (let i = 0; i < allPos.length; i += 3) col.set(tint([allPos[i], allPos[i + 1], allPos[i + 2]]) ?? [1, 1, 1], i);
    skinGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const tex = photos.map((p) => { const t = new THREE.CanvasTexture(p); t.colorSpace = THREE.SRGBColorSpace; return t; });
  const photoMats = blend ? Array(np).fill(blendMaterial(fused, res, skinHex)) : tex.map((t) => new THREE.MeshStandardMaterial({ map: t, roughness: 0.65 }));
  const mats = [...photoMats, new THREE.MeshStandardMaterial({ color: skinHex, roughness: 0.65, vertexColors: !!tint })];
  const group = new THREE.Group();
  group.add(new THREE.Mesh(skinGeo, mats));
  for (const e of eyes) { // eyes take the front photo
    const g = new THREE.BufferGeometry(), uv = [];
    for (let v = 0; v < e.pos.length / 3; v++) { const p = project(0, v3(e.pos, v)); uv.push(p[0], 1 - p[1]); }
    const ep = []; for (let v = 0; v < e.pos.length / 3; v++) ep.push(...outOf(v3(e.pos, v)));
    g.setAttribute('position', new THREE.Float32BufferAttribute(ep, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(e.idx);
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex[0], roughness: 0.2 })));
  }

  // For hair presets (MakeHuman proxies): a base.obj vertex's warped position in MakeHuman axes, and the map from
  // MakeHuman axes to this twin's output frame.
  const headOfBody = new Map(head.toBody.map((b, h) => [b, h]));
  const basePos = (i) => {
    const b = head.body.objToBody.get(i);
    if (b === undefined) return v3(head.objV, i); // helper vertices (long-hair guides) keep their base position
    const h = headOfBody.get(b);
    return h === undefined ? v3(head.body.pos, b) : unapply(T, v3(pos, h));
  };
  const fromMH = (p) => (deform ? deform(p) : apply(T, p));
  return { group, basePos, fromMH, bodyIndex: Int32Array.from(fromBody.flat()), stats: { landmarks: keep.length, dropped: moves.length - keep.length, medianMoveMm: med * mmPerPx, maxWarpMm: maxMove * mmPerPx, photoTris, tris: head.idx.length / 3 } };
}
