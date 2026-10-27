// Fuses face landmarks from several photos (front first) into one 3D point set.
// Pure JS: runs in the browser and in Node. Points are [x, y, z] with y up and z toward the camera.

// MediaPipe landmark (normalised x, y, z) -> pixels, y up, z toward the camera.
export const toPoints = (landmarks, w, h) => landmarks.map((l) => [l.x * w, -l.y * h, -l.z * w]);

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const rot = (R, p) => [dot(R[0], p), dot(R[1], p), dot(R[2], p)];

function wCentroid(pts, w) {
  let c = [0, 0, 0], s = 0;
  pts.forEach((p, i) => { c = add(c, mul(p, w[i])); s += w[i]; });
  return mul(c, 1 / s);
}

// Eigen-decomposition of a symmetric 4x4 matrix (cyclic Jacobi). Returns the eigenvector of the largest eigenvalue.
function topEigenvector(A) {
  const a = A.map((r) => r.slice()), V = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
      for (let k = 0; k < 4; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
      for (let k = 0; k < 4; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [V[0][best], V[1][best], V[2][best], V[3][best]];
}

// Weighted similarity transform (Horn 1987, unit quaternions) that maps src onto dst: dst ~ s * R * src + t.
export function similarity(src, dst, w = src.map(() => 1)) {
  const cs = wCentroid(src, w), cd = wCentroid(dst, w);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let ss = 0;
  src.forEach((p, i) => {
    const a = sub(p, cs), b = sub(dst[i], cd);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += w[i] * a[r] * b[c];
    ss += w[i] * dot(a, a);
  });
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const [qw, qx, qy, qz] = topEigenvector([
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ]);
  const R = [
    [1 - 2 * (qy * qy + qz * qz), 2 * (qx * qy - qw * qz), 2 * (qx * qz + qw * qy)],
    [2 * (qx * qy + qw * qz), 1 - 2 * (qx * qx + qz * qz), 2 * (qy * qz - qw * qx)],
    [2 * (qx * qz - qw * qy), 2 * (qy * qz + qw * qx), 1 - 2 * (qx * qx + qy * qy)],
  ];
  let num = 0;
  src.forEach((p, i) => { num += w[i] * dot(sub(dst[i], cd), rot(R, sub(p, cs))); });
  const s = num / ss;
  return { R, s, t: sub(cd, mul(rot(R, cs), s)) };
}

export const apply = (T, p) => add(mul(rot(T.R, p), T.s), T.t);
// Inverse: a point in the target frame back to the source frame (R is orthonormal, so R^-1 = R^T).
export const unapply = (T, q) => { const d = mul(sub(q, T.t), 1 / T.s); return [0, 1, 2].map((k) => T.R[0][k] * d[0] + T.R[1][k] * d[1] + T.R[2][k] * d[2]); };

// Head turn of a view relative to the front, in degrees (positive: the face points to the viewer's left).
export const yawDegrees = (T) => (Math.atan2(T.R[0][2], T.R[0][0]) * 180) / Math.PI;

// How directly a view sees each point: the cosine between the point's outward direction and the camera, squared.
function visibility(points, camDir) {
  const c = wCentroid(points, points.map(() => 1));
  const xs = points.map((p) => p[0]), width = Math.max(...xs) - Math.min(...xs);
  const headCentre = sub(c, [0, 0, 0.6 * width]); // the face sits in front of the head's centre
  return points.map((p) => {
    const d = sub(p, headCentre), k = Math.max(0, dot(d, camDir) / norm(d));
    return Math.max(1e-3, k * k);
  });
}

// views: arrays of points (same landmark order), views[0] = front. Returns the fused points (front-photo frame)
// and, per view, the head turn, the scale and the weighted RMS distance to the fused shape (same units as input).
export function fuseViews(views) {
  const n = views[0].length;
  let ref = views[0].map((p) => p.slice());
  let fits = views.map(() => ({ T: { R: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], s: 1, t: [0, 0, 0] }, w: Array(n).fill(1) }));
  for (let it = 0; it < 4; it++) {
    fits = views.map((pts, v) => {
      const T = similarity(pts, ref, fits[v].w);
      const aligned = pts.map((p) => apply(T, p));
      return { T, aligned, w: visibility(ref, rot(T.R, [0, 0, 1])) };
    });
    ref = Array.from({ length: n }, (_, i) => {
      let acc = [0, 0, 0], s = 0;
      for (const f of fits) { acc = add(acc, mul(f.aligned[i], f.w[i])); s += f.w[i]; }
      return mul(acc, 1 / s);
    });
  }
  return {
    points: ref,
    views: fits.map((f) => {
      let e = 0, s = 0;
      f.aligned.forEach((p, i) => { e += f.w[i] * dot(sub(p, ref[i]), sub(p, ref[i])); s += f.w[i]; });
      return { T: f.T, yaw: yawDegrees(f.T), scale: f.T.s, rms: Math.sqrt(e / s), weights: f.w, camDir: rot(f.T.R, [0, 0, 1]) };
    }),
  };
}
