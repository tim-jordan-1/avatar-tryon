// Smooth 3D warp: radial basis functions with the biharmonic kernel phi(r) = r plus a linear term.
// Fitted to displacements at a few hundred points, it moves every other vertex smoothly. Pure JS.

// Solve A x = b in place (Gaussian elimination with partial pivoting). A is an array of rows.
export function solve(A, b) {
  const n = b.length;
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    const d = A[c][c];
    if (Math.abs(d) < 1e-12) throw new Error('RBF system is singular (duplicate centres?)');
    for (let r = c + 1; r < n; r++) {
      const f = A[r][c] / d;
      if (f === 0) continue;
      for (let k = c; k < n; k++) A[r][k] -= f * A[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

// centres: [[x,y,z]...], disp: [[dx,dy,dz]...]. Returns warp(p) -> displacement at p.
export function fitWarp(centres, disp) {
  const n = centres.length, m = n + 4;
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const build = () => {
    const A = Array.from({ length: m }, () => new Array(m).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) A[i][j] = dist(centres[i], centres[j]);
      const row = [1, ...centres[i]];
      for (let k = 0; k < 4; k++) { A[i][n + k] = row[k]; A[n + k][i] = row[k]; }
    }
    return A;
  };
  const coef = [0, 1, 2].map((axis) => solve(build(), [...disp.map((d) => d[axis]), 0, 0, 0, 0]));
  return (p) => coef.map((w) => {
    let s = w[n] + w[n + 1] * p[0] + w[n + 2] * p[1] + w[n + 3] * p[2];
    for (let i = 0; i < n; i++) s += w[i] * dist(p, centres[i]);
    return s;
  });
}
