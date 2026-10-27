// T-shirt generator. Pure JS, runs in the browser and in Node.
// Builds one closed-seam t-shirt mesh around a body from ../avatar-poc/body.js, in the body's bind pose:
// a torso tube from the hem to the armpit, front and back yoke panels joined at the shoulder seam,
// a neck opening, and two short sleeves whose top ring is the armhole. Units: metres.

const NS = 48; // vertices around the torso, 12 per quarter
const K = 3; // armhole half-width in torso columns
const SLEEVE_RINGS = 5;
// Body parts the shirt can touch. Legs, hands and head are left out.
export const SHIRT_PARTS = ['torso', 'neck', 'armL', 'armR', 'shoulderL', 'shoulderR'];

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (x) => Math.min(1, Math.max(0, x));

// Torso rings straight from the body mesh: the torso tube is the first part, ring by ring. Each ring: {y, pts: [[x, z]...]}.
// A body that is not built from rings (the MakeHuman body) brings its own.
export function torsoRings(body) {
  if (body.rings) return body.rings;
  const p = body.positions;
  let n = 0;
  while (Math.abs(p[n * 3 + 1] - p[1]) < 1e-9) n++;
  const count = body.parts.torso.count / (6 * n); // tube: 2n triangles per ring gap + 2 caps of n
  const rings = [];
  for (let j = 0; j < count; j++) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([p[(j * n + i) * 3], p[(j * n + i) * 3 + 2]]);
    rings.push({ y: p[j * n * 3 + 1], pts });
  }
  return rings;
}

function ringAt(rings, y) {
  let j = 0;
  while (j < rings.length - 2 && y > rings[j + 1].y) j++;
  const a = rings[j], b = rings[j + 1], t = clamp01((y - a.y) / (b.y - a.y));
  return a.pts.map((p, i) => [lerp(p[0], b.pts[i][0], t), lerp(p[1], b.pts[i][1], t)]);
}

// Resample a ring to NS points, uniform by arc length inside each quarter, so index NS/4 is the front centre.
function resample(pts) {
  const n = pts.length, q = n / 4, out = [];
  for (let s = 0; s < 4; s++) {
    const seg = [];
    for (let i = 0; i <= q; i++) seg.push(pts[(s * q + i) % n]);
    const cum = [0];
    for (let i = 1; i < seg.length; i++) cum.push(cum[i - 1] + Math.hypot(seg[i][0] - seg[i - 1][0], seg[i][1] - seg[i - 1][1]));
    for (let m = 0; m < NS / 4; m++) {
      const L = (cum[q] * m) / (NS / 4);
      let i = 0;
      while (i < q - 1 && cum[i + 1] < L) i++;
      const t = (L - cum[i]) / (cum[i + 1] - cum[i] || 1);
      out.push([lerp(seg[i][0], seg[i + 1][0], t), lerp(seg[i][1], seg[i + 1][1], t)]);
    }
  }
  return out;
}

const perimeter = (pts) => pts.reduce((s, p, i) => s + Math.hypot(pts[(i + 1) % pts.length][0] - p[0], pts[(i + 1) % pts.length][1] - p[1]), 0);

// Nearest-vertex surface test against selected parts of a triangle mesh. signed() > 0 means outside.
// shortcut: nearest vertex plus its normal, not nearest triangle; good to a few mm on this smooth mesh.
export function surfaceTester(positions, indices, ranges, cell = 0.04) {
  const normals = new Float32Array(positions.length), used = new Set();
  for (const { start, count } of ranges) {
    for (let t = start; t < start + count; t += 3) {
      const [a, b, c] = [indices[t] * 3, indices[t + 1] * 3, indices[t + 2] * 3];
      const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
      const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      for (const v of [a, b, c]) { normals[v] += nx; normals[v + 1] += ny; normals[v + 2] += nz; used.add(v / 3); }
    }
  }
  const key = (x, y, z) => ((Math.floor(x / cell) + 512) * 1024 + Math.floor(y / cell) + 512) * 1024 + Math.floor(z / cell) + 512;
  const grid = new Map();
  for (const v of used) {
    const l = Math.hypot(normals[v * 3], normals[v * 3 + 1], normals[v * 3 + 2]) || 1;
    for (let k = 0; k < 3; k++) normals[v * 3 + k] /= l;
    const kk = key(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
    if (!grid.has(kk)) grid.set(kk, []);
    grid.get(kk).push(v);
  }
  // Returns the nearest vertex within one cell and the signed distance along its normal, or null.
  function nearest(x, y, z) {
    let best = -1, bd = Infinity;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const list = grid.get(key(x + dx * cell, y + dy * cell, z + dz * cell));
      if (list) for (const v of list) {
        const d = (positions[v * 3] - x) ** 2 + (positions[v * 3 + 1] - y) ** 2 + (positions[v * 3 + 2] - z) ** 2;
        if (d < bd) { bd = d; best = v; }
      }
    }
    if (best < 0) return null;
    const n = [normals[best * 3], normals[best * 3 + 1], normals[best * 3 + 2]];
    const signed = (x - positions[best * 3]) * n[0] + (y - positions[best * 3 + 1]) * n[1] + (z - positions[best * 3 + 2]) * n[2];
    return { vertex: best, signed, normal: n };
  }
  return { nearest, used };
}

// The closed parts the shirt can touch: avatar-poc's overlapping parts, or one closed mesh (body.shirtParts).
const shirtParts = (body) => body.shirtParts ?? SHIRT_PARTS;
export const bodyTester = (body, positions = body.positions) =>
  surfaceTester(positions, body.indices, shirtParts(body).map((p) => body.parts[p]));

// Exact inside test: a point is inside the body if it is inside any closed part, by ray parity (a ray from the
// point crosses a closed surface an odd number of times when it starts inside). Unlike the nearest-vertex test,
// it cannot pick the wrong part where parts overlap (arm tops and deltoid caps sit inside the torso).
export function insideTester(positions, indices, ranges) {
  // Triangles binned by their y-z box in CELL cells: the ray runs along x, so it only meets the triangles of its cell.
  const CELL = 0.02, key = (y, z) => (Math.floor(y / CELL) + 4096) * 8192 + Math.floor(z / CELL) + 4096;
  const parts = ranges.map(({ start, count }) => {
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity], grid = new Map();
    for (let t = start; t < start + count; t += 3) {
      const tlo = [Infinity, Infinity, Infinity], thi = [-Infinity, -Infinity, -Infinity];
      for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
        const v = positions[indices[t + j] * 3 + k];
        tlo[k] = Math.min(tlo[k], v); thi[k] = Math.max(thi[k], v);
      }
      for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], tlo[k]); hi[k] = Math.max(hi[k], thi[k]); }
      const m = 0.001; // the ray drifts under 1 mm in y and z over the body
      for (let gy = Math.floor((tlo[1] - m) / CELL); gy <= Math.floor((thi[1] + m) / CELL); gy++) {
        for (let gz = Math.floor((tlo[2] - m) / CELL); gz <= Math.floor((thi[2] + m) / CELL); gz++) {
          const kk = (gy + 4096) * 8192 + gz + 4096;
          if (!grid.has(kk)) grid.set(kk, []);
          grid.get(kk).push(t);
        }
      }
    }
    return { lo, hi, grid };
  });
  const D = [1, 0.000123, 0.000457]; // slightly off-axis, so the ray does not run exactly along an edge
  return (x, y, z) => parts.some(({ lo, hi, grid }) => {
    if (x < lo[0] || y < lo[1] || z < lo[2] || x > hi[0] || y > hi[1] || z > hi[2]) return false;
    let hits = 0;
    for (const t of grid.get(key(y, z)) ?? []) {
      const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
      const e1 = [positions[b] - positions[a], positions[b + 1] - positions[a + 1], positions[b + 2] - positions[a + 2]];
      const e2 = [positions[c] - positions[a], positions[c + 1] - positions[a + 1], positions[c + 2] - positions[a + 2]];
      const p = [D[1] * e2[2] - D[2] * e2[1], D[2] * e2[0] - D[0] * e2[2], D[0] * e2[1] - D[1] * e2[0]]; // Möller-Trumbore
      const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
      if (Math.abs(det) < 1e-12) continue;
      const s = [x - positions[a], y - positions[a + 1], z - positions[a + 2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det;
      if (u < 0 || u > 1) continue;
      const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]];
      const v = (D[0] * q[0] + D[1] * q[1] + D[2] * q[2]) / det;
      if (v < 0 || u + v > 1) continue;
      if ((e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det > 0) hits++;
    }
    return hits % 2 === 1;
  });
}

export const bodyInside = (body, positions = body.positions) =>
  insideTester(positions, body.indices, shirtParts(body).map((p) => body.parts[p]));

// Open edges of the mesh (hem, sleeve ends, neck), each as [a, b] in the direction of its triangle, so the
// cloth's interior lies to the left of a -> b when seen from the outer side. The renderer closes them with a rim.
export function openEdges(indices) {
  const seen = new Map();
  for (let t = 0; t < indices.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = indices[t + k], b = indices[t + (k + 1) % 3], key = Math.min(a, b) * 65536 + Math.max(a, b);
    seen.set(key, seen.has(key) ? null : [a, b]);
  }
  return [...seen.values()].filter(Boolean);
}

// garmentChest in cm. offset: clearance over the body where the shirt follows it (shoulders), metres.
// Clearances in metres: `offset` is the least gap between cloth and skin anywhere (5 mm), `neckOffset` is the collar's
// gap (3 mm: it sits on the neck base), `snug` is the gap the yoke and upper chest settle to above the chest (7 mm), `extra` (1.3 cm) is added
// where the skin weights mix chest and arm (the shoulder cap), because blended skinning shrinks the gap there as the arm rises.
export function buildShirt(body, { garmentChest, offset = 0.005, rowStep = 0.025, extra = 0.013, snug = 0.007, neckOffset = 0.003 } = {}) {
  const m = body.measurements, L = body.landmarks, H = m.height / 100;
  const rings = torsoRings(body);
  // Hem 5% of height above the crotch: on the mannequin that is the old hip - 2%; MakeHuman's hip landmark sits near the crotch.
  const hemY = L.crotchY + 0.05 * H, aY = L.armpitY - 0.01 * H, sY = L.shoulderY;
  const chestRing = resample(ringAt(rings, L.chestY));
  const g = (garmentChest ?? m.chest + 10) / 100 / perimeter(chestRing);

  const pos = [], idx = [], pinned = [];
  const vert = (p, pin = 0) => { pos.push(...p); pinned.push(pin); return pos.length / 3 - 1; };

  // A shirt point on the ray through body ring point i at height y. The chest ease (garment minus body, per column)
  // is kept at every height, so the shirt follows the waist and hip instead of hanging as a tube from the chest;
  // DRAPE of the straight tube is mixed back in so the fabric still bridges hollows.
  const DRAPE = 0.2;
  function torsoPoint(y, i, rb) {
    const [x, z] = rb[i], rBody = Math.hypot(x, z), rc = Math.hypot(...chestRing[i]), rg = rc * g;
    const t = clamp01((y - L.chestY) / (sY - L.chestY));
    const fitted = lerp(rBody + Math.max(offset, rg - rc), rg, DRAPE);
    const r = Math.max(lerp(fitted, rBody + offset, t), rBody + offset);
    return [(x / rBody) * r, y, (z / rBody) * r];
  }

  // Rows: 0..nA full rings (hem to armhole), nA+1..nA+nR yoke rows without the armhole columns, then the seam row.
  const nA = Math.max(4, Math.round((aY - hemY) / rowStep)), nR = Math.max(2, Math.round((sY - aY) / rowStep));
  const inArm = (i) => (i <= K || i >= NS - K) ? 'L' : Math.abs(i - NS / 2) <= K ? 'R' : null;
  const vid = [];
  for (let r = 0; r <= nA + nR; r++) {
    const y = r <= nA ? lerp(hemY, aY, r / nA) : lerp(aY, sY, (r - nA) / nR);
    const rb = resample(ringAt(rings, y));
    vid.push([]);
    for (let i = 0; i < NS; i++) {
      // Above the armpit the armhole columns are open, but their edge columns (i = ±K) stay.
      const open = r > nA && inArm(i) && i !== K && i !== NS - K && i !== NS / 2 - K && i !== NS / 2 + K;
      if (!open) vid[r][i] = vert(torsoPoint(y, i, rb));
    }
  }
  // Seam row: front column i and back column NS - i share one vertex on top of the shoulder, found by stepping down
  // onto the body. At the neck a crew neckline runs round the neck base instead: level with the shoulder seam at the
  // sides, 3% of height lower at the front centre and 1.2% at the back. The old seam stopped at shoulder height,
  // so the neck opening was a wide flat hole 9 cm under the neck base.
  const top = nA + nR, M = 3, last = top + M, S = last + 1;
  const inside = bodyInside(body);
  const march = (from, dir, max, off = offset) => { // first point along dir that is `off` before the body surface
    for (let s = 0; s < max; s += 0.002) {
      const q = from.map((x, k) => x + dir[k] * s);
      if (inside(...q)) return q.map((x, k) => x - dir[k] * off);
    }
    return null;
  };
  const neckRing = ringAt(rings, L.neckY), zc = neckRing.reduce((s, p) => s + p[1], 0) / neckRing.length;
  const neckHalf = m.neck / 100 / (2 * Math.PI) + 0.01;
  const topAt = (x, z) => march([x, L.neckY + 0.04, z], [0, -1, 0], 0.3)?.[1] ?? sY + offset;
  const dropF = 0.03 * H, dropB = 0.012 * H;
  const P3 = (v) => pos.slice(v * 3, v * 3 + 3);
  const seam = {}, neckCols = []; // column -> target point; a shoulder column shares its point with its back column
  for (let i = K; i <= NS / 2 - K; i++) {
    const f = P3(vid[top][i]), b = P3(vid[top][NS - i]), x = (f[0] + b[0]) / 2, z = (f[2] + b[2]) / 2;
    if (Math.abs(x) < neckHalf) neckCols.push([i, x]);
    else seam[i] = seam[NS - i] = [x, Math.max(sY + offset, topAt(x, z)), z];
  }
  // The neckline starts at the innermost shoulder points (the high point of the shoulder), so it has no step there.
  const corner = neckCols.length ? [seam[neckCols[0][0] - 1], seam[neckCols.at(-1)[0] + 1]].filter(Boolean) : [];
  const yHPS = corner.length ? Math.min(...corner.map((p) => p[1])) : topAt(neckHalf, zc);
  const xc = corner.length ? Math.min(...corner.map((p) => Math.abs(p[0]))) : neckHalf;
  for (const [i, x] of neckCols) {
    const u = Math.max(0, 1 - (x / xc) ** 2), // a parabola: an ellipse drops steeply at the corner and leaves a peak
      yf = yHPS - dropF * u, yb = yHPS - dropB * u;
    seam[i] = march([x, yf, zc + 0.3], [0, 0, -1], 0.3, neckOffset) ?? [x, yf, zc];
    seam[NS - i] = march([x, yb, zc - 0.3], [0, 0, 1], 0.3, neckOffset) ?? [x, yb, zc];
  }
  // M rows between the top yoke row and the seam, so the panel can wrap over the trapezius (the push below lifts them).
  for (let j = 1; j <= M; j++) {
    vid.push([]);
    for (const c of Object.keys(seam)) vid[top + j][c] = vert(P3(vid[top][c]).map((q, k) => lerp(q, seam[c][k], j / (M + 1))));
  }
  vid.push([]);
  for (let i = K; i <= NS / 2 - K; i++) {
    // pinned 2: a shoulder-seam vertex. Fixed while the shirt is built, but the simulation lets it move a little,
    // so the shoulder can push it out when the arm rises. pinned 1 (the neckline) stays fixed.
    if (seam[i] === seam[NS - i]) vid[S][i] = vid[S][NS - i] = vert(seam[i], 2);
    else { vid[S][i] = vert(seam[i], 1); vid[S][NS - i] = vert(seam[NS - i], 1); }
  }
  for (let r = 0; r < S; r++) for (let i = 0; i < NS; i++) {
    const a = vid[r][i], b = vid[r][(i + 1) % NS], c = vid[r + 1][i], d = vid[r + 1][(i + 1) % NS];
    if (a !== undefined && b !== undefined && c !== undefined && d !== undefined) idx.push(a, c, b, b, c, d);
  }
  const torsoCount = idx.length;

  // Sleeves: the armhole loop is the first ring; later rings blend toward rings around the upper arm.
  const bone = Object.fromEntries(body.bones.map((b) => [b.name, b.pos]));
  const sleeveR = (m.upperArm * 1.08) / 100 / (2 * Math.PI) + 0.015;
  for (const [side, sx, c0] of [['L', 1, 0], ['R', -1, NS / 2]]) {
    const loop = [];
    for (let i = -K; i <= K; i++) loop.push(vid[nA][(c0 + sx * i + NS) % NS]);
    const front = (c0 + sx * K + NS) % NS, back = (c0 - sx * K + NS) % NS;
    for (let r = nA + 1; r <= last; r++) loop.push(vid[r][front]);
    loop.push(vid[S][front]);
    for (let r = last; r > nA; r--) loop.push(vid[r][back]);

    const P = (v) => pos.slice(v * 3, v * 3 + 3);
    const C = loop.reduce((s, v) => s.map((c, k) => c + P(v)[k] / loop.length), [0, 0, 0]);
    const phi = loop.map((v) => Math.atan2(P(v)[1] - C[1], P(v)[2] - C[2]));
    const j = bone[`upperArm${side}`], e = bone[`foreArm${side}`];
    const lenU = Math.hypot(e[0] - j[0], e[1] - j[1], e[2] - j[2]);
    const d = [0, 1, 2].map((k) => (e[k] - j[k]) / lenU);
    let u = [d[1], -d[0], 0]; // d x z
    if (u[0] * sx < 0) u = u.map((x) => -x);
    const ul = Math.hypot(...u);
    u = u.map((x) => x / ul);
    const ringPt = (s, k) => [0, 1, 2].map((a) => j[a] + d[a] * s + sleeveR * (Math.cos(phi[k]) * (a === 2 ? 1 : 0) + Math.sin(phi[k]) * u[a]));
    let prev = loop;
    const first = idx.length;
    for (let rI = 1; rI <= SLEEVE_RINGS; rI++) {
      const t = rI / SLEEVE_RINGS, w = t * t * (3 - 2 * t), s = lerp(0.1, 0.5, t) * lenU;
      const ring = loop.map((v, k) => vert(P(v).map((q, a) => lerp(q, ringPt(s, k)[a], w))));
      for (let k = 0; k < loop.length; k++) {
        const a = prev[k], b = prev[(k + 1) % loop.length], c = ring[k], dd = ring[(k + 1) % loop.length];
        idx.push(a, c, b, b, c, dd);
      }
      prev = ring;
    }
    // Make the sleeve's faces point away from the arm axis.
    const [a, c, b] = idx.slice(idx.length - 6, idx.length - 3).map(P);
    const n = [0, 1, 2].map((k) => (c[(k + 1) % 3] - a[(k + 1) % 3]) * (b[(k + 2) % 3] - a[(k + 2) % 3]) - (c[(k + 2) % 3] - a[(k + 2) % 3]) * (b[(k + 1) % 3] - a[(k + 1) % 3]));
    const out = [0, 1, 2].map((k) => a[k] - j[k]);
    const along = out.reduce((s, x, k) => s + x * d[k], 0);
    if (n.reduce((s, x, k) => s + x * (out[k] - along * d[k]), 0) < 0) {
      for (let t = first; t < idx.length; t += 3) [idx[t + 1], idx[t + 2]] = [idx[t + 2], idx[t + 1]];
    }
  }

  // Push every vertex at least `offset` outside the body (the neckline `neckOffset`), smooth the free ones once, push again.
  const nv = pos.length / 3, tester = bodyTester(body);
  const nbrs = Array.from({ length: nv }, () => new Set());
  for (let t = 0; t < idx.length; t += 3) for (let k = 0; k < 3; k++) {
    nbrs[idx[t + k]].add(idx[t + (k + 1) % 3]);
    nbrs[idx[t + k]].add(idx[t + (k + 2) % 3]);
  }
  const push = () => {
    for (let v = 0; v < nv; v++) {
      const h = tester.nearest(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      const least = pinned[v] === 1 ? neckOffset : offset; // the collar sits closer than the rest of the shirt
      if (h && h.signed < least) for (let k = 0; k < 3; k++) pos[v * 3 + k] += h.normal[k] * (least - h.signed);
    }
  };
  // Above the chest the rows between the yoke and the neckline are straight lines from a torso ring to the neck base.
  // Over the collarbone hollow and the nape that left the cloth 3 to 6 cm off the body, so each free torso vertex above
  // the chest is pulled along its nearest surface normal to `snug`, with a smooth blend that starts at the chest.
  {
    const torsoSet = new Set(idx.slice(0, torsoCount));
    for (let v = 0; v < nv; v++) {
      if (pinned[v] === 1 || !torsoSet.has(v) || pos[v * 3 + 1] <= L.chestY) continue;
      const h = tester.nearest(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
      if (!h || h.signed <= snug) continue;
      const u = clamp01((pos[v * 3 + 1] - L.chestY) / (sY - 0.03 - L.chestY)), w = u * u * (3 - 2 * u);
      for (let k = 0; k < 3; k++) pos[v * 3 + k] += h.normal[k] * (lerp(h.signed, snug, w) - h.signed);
    }
  }
  push();
  // Smooth the free vertices (Taubin: a pull towards the neighbours' mean, then a push back by a little more than
  // that, so the garment does not shrink and lose its chest ease).
  for (const f of [0.5, -0.53]) {
    const sm = pos.slice();
    for (let v = 0; v < nv; v++) if (!pinned[v]) {
      for (let k = 0; k < 3; k++) {
        let s = 0;
        for (const w of nbrs[v]) s += pos[w * 3 + k];
        sm[v * 3 + k] = pos[v * 3 + k] + f * (s / nbrs[v].size - pos[v * 3 + k]);
      }
    }
    pos.splice(0, pos.length, ...sm);
  }
  for (let k = 0; k < 6; k++) push(); // parts overlap at the shoulder, so one push can land inside a neighbour

  // The nearest-vertex push misses points inside a part whose nearest vertex belongs to another part (sleeves in
  // the upper arm). Exact pass: while a point is inside a part, move it away from that part's axis, then add the clearance.
  const B = Object.fromEntries(body.bones.map((b) => [b.name, b.pos]));
  const insideOf = shirtParts(body).map((name) => [name, insideTester(body.positions, body.indices, [body.parts[name]])]);
  const centreOf = (name) => { // bbox centre of a part, for the deltoid caps
    const { start, count } = body.parts[name], c = [0, 0, 0];
    for (let t = start; t < start + count; t++) for (let k = 0; k < 3; k++) c[k] += body.positions[body.indices[t] * 3 + k] / count;
    return c;
  };
  const caps = body.parts.shoulderL ? { shoulderL: centreOf('shoulderL'), shoulderR: centreOf('shoulderR') } : {};
  const awayFrom = (name, p) => {
    if (!SHIRT_PARTS.includes(name)) return tester.nearest(...p)?.normal ?? [p[0], 0, p[2]]; // one closed body: its surface normal
    if (name === 'torso' || name === 'neck') return [p[0], 0, p[2]];
    if (name.startsWith('shoulder')) return p.map((x, k) => x - caps[name][k]);
    const s = name.slice(-1), a = B[`upperArm${s}`], b = B[`hand${s}`], ab = b.map((x, k) => x - a[k]); // arm: from the bone line
    const t = clamp01(ab.reduce((acc, x, k) => acc + x * (p[k] - a[k]), 0) / ab.reduce((acc, x) => acc + x * x, 0));
    return p.map((x, k) => x - (a[k] + t * ab[k]));
  };
  const unit = (d) => { const l = Math.hypot(...d) || 1; return d.map((x) => x / l); };
  const insideName = (p) => insideOf.find(([, f]) => f(...p))?.[0];
  for (let v = 0; v < nv; v++) {
    for (let round = 0; round < 4; round++) {
      let p = P3(v), name = insideName(p);
      if (!name) break;
      const d = unit(awayFrom(name, p));
      for (let i = 0; i < 60 && insideName(p) === name; i++) p = p.map((x, k) => x + d[k] * 0.003);
      p = p.map((x, k) => x + d[k] * offset);
      pos.splice(v * 3, 3, ...p);
    }
    // Still inside: trapped where arm and torso touch (the underarm). Move it outward from the torso instead,
    // so the cloth goes over the arm there.
    let p = P3(v);
    if (insideName(p)) {
      const d = unit([p[0], 0, p[2]]);
      for (let i = 0; i < 80 && insideName(p); i++) p = p.map((x, k) => x + d[k] * 0.003);
      pos.splice(v * 3, 3, ...p.map((x, k) => x + d[k] * offset));
    }
  }

  // Skin weights from the nearest body vertex. Clearance (for Jolt's back stop) measured exactly: step toward the
  // body along the nearest normal until the exact test says inside.
  // Sleeve vertices take their weights from their own arm, so they turn with it; the nearest vertex is often torso.
  const torsoV = new Set(idx.slice(0, torsoCount));
  const armParts = (s) => (body.armParts?.[s] ?? [`arm${s}`, `shoulder${s}`]).map((p) => body.parts[p]);
  const armTester = { L: surfaceTester(body.positions, body.indices, armParts('L')), R: surfaceTester(body.positions, body.indices, armParts('R')) };
  const skinIndex = new Uint16Array(nv * 4), skinWeight = new Float32Array(nv * 4), gap = new Float32Array(nv);
  // Where a vertex is skinned half to the chest and half to the arm (the shoulder cap), blended skinning shrinks
  // its clearance as the arm rises (to about half at arms up), and the shoulder came through the cloth. Those
  // vertices get up to EXTRA more clearance, scaled by how mixed the weights are.
  const EXTRA = extra, isArm = body.bones.map((b) => b.name.startsWith('upperArm'));
  for (let v = 0; v < nv; v++) {
    let p = P3(v);
    const h = tester.nearest(...p);
    const hs = torsoV.has(v) ? null : armTester[p[0] > 0 ? 'L' : 'R'].nearest(...p);
    const src = hs ? hs.vertex : h ? h.vertex : 0;
    let wArm = 0;
    for (let k = 0; k < 4; k++) {
      skinIndex[v * 4 + k] = body.skinIndex[src * 4 + k]; skinWeight[v * 4 + k] = body.skinWeight[src * 4 + k];
      if (isArm[skinIndex[v * 4 + k]]) wArm += skinWeight[v * 4 + k];
    }
    // The sleeve cap is skinned to the arm only and swings over a shoulder skinned to the chest: it gets the same
    // extra clearance, growing from the armpit to the shoulder.
    const mix = torsoV.has(v) ? 4 * wArm * (1 - wArm) : clamp01((p[1] - L.armpitY) / (sY - L.armpitY));
    if (h && mix > 0 && p[1] > L.armpitY) { // above the armpit only: lower down it would loosen the chest
      const q = p.map((x, k) => x + h.normal[k] * EXTRA * mix);
      if (!insideName(q)) { p = q; pos.splice(v * 3, 3, ...p); } // overlapping parts: a push can land in a neighbour
    }
    let g = 0;
    if (h) while (g < 0.08 && !insideName(p.map((x, k) => x - h.normal[k] * (g + 0.004)))) g += 0.004;
    gap[v] = h ? g : offset;
  }
  return {
    positions: new Float32Array(pos), indices: new Uint32Array(idx), pinned: new Uint8Array(pinned),
    skinIndex, skinWeight, gap, parts: { torso: { start: 0, count: torsoCount }, all: { start: 0, count: idx.length } },
    seamY: sY,
  };
}
