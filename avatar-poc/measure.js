// Virtual tape measure. Knows nothing about how body.js builds rings: it slices the triangle mesh
// with a horizontal plane and wraps a tape (convex hull) around the cut, like a real tape measure.

function cut(positions, indices, part, y) {
  const pts = [];
  for (let t = part.start; t < part.start + part.count; t += 3) {
    const v = [0, 1, 2].map((k) => indices[t + k] * 3);
    for (let e = 0; e < 3; e++) {
      const a = v[e], b = v[(e + 1) % 3], ya = positions[a + 1], yb = positions[b + 1];
      if ((ya >= y) === (yb >= y)) continue;
      const s = (y - ya) / (yb - ya);
      pts.push([positions[a] + s * (positions[b] - positions[a]), positions[a + 2] + s * (positions[b + 2] - positions[a + 2])]);
    }
  }
  return pts;
}

function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (arr) => {
    const h = [];
    for (const q of arr) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return [...half(p), ...half(p.reverse())];
}

export function sliceAt(body, partName, y) {
  const pts = cut(body.positions, body.indices, body.parts[partName], y);
  if (pts.length < 3) return { girth: 0, width: 0 };
  const h = hull(pts);
  const girth = h.reduce((s, p, i) => s + Math.hypot(h[(i + 1) % h.length][0] - p[0], h[(i + 1) % h.length][1] - p[1]), 0);
  const xs = pts.map((p) => p[0]);
  return { girth, width: Math.max(...xs) - Math.min(...xs) };
}

function yRange(body, partName) {
  const { start, count } = body.parts[partName];
  let lo = Infinity, hi = -Infinity;
  for (let t = start; t < start + count; t++) {
    const y = body.positions[body.indices[t] * 3 + 1];
    if (y < lo) lo = y;
    if (y > hi) hi = y;
  }
  return [lo, hi];
}

// All values in cm, taken from the mesh at the standard landmark heights.
export function measureBody(body) {
  const L = body.landmarks, cm = (v) => +(v * 100).toFixed(2);
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < body.positions.length; i += 3) { lo = Math.min(lo, body.positions[i]); hi = Math.max(hi, body.positions[i]); }
  return {
    height: cm(hi - lo),
    chest: cm(sliceAt(body, 'torso', L.chestY).girth),
    waist: cm(sliceAt(body, 'torso', L.waistY).girth),
    hip: cm(sliceAt(body, 'torso', L.hipY).girth),
    shoulder: cm(sliceAt(body, 'torso', L.shoulderY).width),
    inseam: cm(yRange(body, 'torso')[0] - lo),
    neck: cm(sliceAt(body, 'neck', L.neckMidY).girth),
    thigh: cm(sliceAt(body, 'legL', L.thighY).girth),
    calf: cm(sliceAt(body, 'legL', L.calfY).girth),
  };
}

// Volume of the union of all parts, in litres: overlaps (thigh tops inside the torso, shoulder caps)
// count once. Slices the body every dy metres; every part's cross-section is convex, so a scanline
// row (step dz) crosses each one in a single interval, and the row's covered length is the union.
export function unionVolumeLitres(body, dy = 0.01, dz = 0.002) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < body.positions.length; i += 3) { lo = Math.min(lo, body.positions[i]); hi = Math.max(hi, body.positions[i]); }
  let vol = 0;
  for (let y = lo + dy / 2; y < hi; y += dy) {
    const hulls = [];
    for (const part of Object.values(body.parts)) {
      const pts = cut(body.positions, body.indices, part, y);
      if (pts.length >= 3) hulls.push(hull(pts));
    }
    if (!hulls.length) continue;
    const zs = hulls.flat().map((p) => p[1]), z0 = Math.min(...zs), z1 = Math.max(...zs);
    let area = 0;
    for (let z = z0 + dz / 2; z < z1; z += dz) {
      const spans = [];
      for (const h of hulls) {
        let a = Infinity, b = -Infinity;
        for (let i = 0; i < h.length; i++) {
          const p = h[i], q = h[(i + 1) % h.length];
          if ((p[1] - z) * (q[1] - z) > 0 || p[1] === q[1]) continue;
          const x = p[0] + ((z - p[1]) / (q[1] - p[1])) * (q[0] - p[0]);
          a = Math.min(a, x); b = Math.max(b, x);
        }
        if (a < b) spans.push([a, b]);
      }
      spans.sort((s, t) => s[0] - t[0]);
      let end = -Infinity;
      for (const [a, b] of spans) {
        if (b <= end) continue;
        area += (b - Math.max(a, end)) * dz;
        end = b;
      }
    }
    vol += area * dy;
  }
  return vol * 1000;
}

// Sum of each closed part's volume (signed tetrahedra), in litres. Overlaps count twice.
export function volumeLitres(body) {
  const P = body.positions, I = body.indices;
  let v = 0;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t] * 3, I[t + 1] * 3, I[t + 2] * 3];
    v += (P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c])) / 6;
  }
  return v * 1000;
}
