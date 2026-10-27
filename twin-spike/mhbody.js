// Fit an anatomical body mesh (the MakeHuman base mesh, A-pose) to tape measurements. Pure JS.
// pos: flat [x,y,z,...] (y up, feet at the bottom), idx: triangle indices. Units are the mesh's own.

// Horizontal slice at height y -> connected cross-sections ("loops"), each with its tape girth (convex hull), centre and width.
export function sliceLoops(pos, idx, y) {
  const pid = new Map(), pts = [], parent = [];
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  const point = (a, b) => {
    const key = a < b ? `${a},${b}` : `${b},${a}`;
    if (!pid.has(key)) {
      const ya = pos[a * 3 + 1], s = (y - ya) / (pos[b * 3 + 1] - ya);
      pid.set(key, pts.length); parent.push(pts.length);
      pts.push([pos[a * 3] + s * (pos[b * 3] - pos[a * 3]), pos[a * 3 + 2] + s * (pos[b * 3 + 2] - pos[a * 3 + 2])]);
    }
    return pid.get(key);
  };
  for (let t = 0; t < idx.length; t += 3) {
    const cross = [];
    for (let e = 0; e < 3; e++) {
      const a = idx[t + e], b = idx[t + (e + 1) % 3];
      if ((pos[a * 3 + 1] >= y) !== (pos[b * 3 + 1] >= y)) cross.push(point(a, b));
    }
    if (cross.length === 2) { const ra = find(cross[0]), rb = find(cross[1]); if (ra !== rb) parent[ra] = rb; }
  }
  const groups = new Map();
  pts.forEach((p, i) => { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); });
  return [...groups.values()].filter((g) => g.length >= 3).map((g) => {
    const h = hull(g), xs = g.map((p) => p[0]), zs = g.map((p) => p[1]);
    const girth = h.reduce((s, p, i) => s + Math.hypot(h[(i + 1) % h.length][0] - p[0], h[(i + 1) % h.length][1] - p[1]), 0);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), z0 = Math.min(...zs), z1 = Math.max(...zs);
    return { girth, x0, x1, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2, width: x1 - x0, n: g.length, pts: g };
  });
}

export function hull(pts) {
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (arr) => { const h = []; for (const q of arr) { while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } h.pop(); return h; };
  return [...half(p), ...half(p.reverse())];
}

// The torso is the cross-section that spans x = 0; legs are the two big ones either side below the crotch.
export const torsoOf = (loops) => loops.filter((l) => l.x0 < 0 && l.x1 > 0).sort((a, b) => b.n - a.n)[0] ?? null;
// A leg's centre is clearly off the mid-line, even when wide thighs overlap and their sections cross x = 0.
export const legOf = (loops, side) => loops.filter((l) => Math.sign(l.cx) === side && Math.abs(l.cx) > 0.25 * l.width).sort((a, b) => b.n - a.n)[0] ?? null;
// One thigh's girth even when the thighs touch: the side's own points of whatever cross-section holds them.
export function legGirth(loops, side) {
  const own = legOf(loops, side);
  if (own) return own.girth;
  const t = torsoOf(loops);
  if (!t) return null;
  const h = hull(t.pts.filter((p) => Math.sign(p[0]) === side));
  return h.length < 3 ? null : h.reduce((s, p, i) => s + Math.hypot(h[(i + 1) % h.length][0] - p[0], h[(i + 1) % h.length][1] - p[1]), 0);
}

function bounds(pos) {
  let lo = Infinity, hi = -Infinity;
  for (let i = 1; i < pos.length; i += 3) { lo = Math.min(lo, pos[i]); hi = Math.max(hi, pos[i]); }
  return [lo, hi];
}

// Landmark heights found from the cross-sections alone (A-pose body, arms clear of the torso below the armpit).
export function findLandmarks(pos, idx) {
  const [lo, hi] = bounds(pos), H = hi - lo, at = (f) => lo + f * H;
  const scan = (f0, f1, step = 0.002) => { const out = []; for (let f = f0; f <= f1; f += step) out.push({ y: at(f), loops: sliceLoops(pos, idx, at(f)) }); return out; };
  const lower = scan(0.3, 0.6);
  const crotch = lower.find((s) => { const t = torsoOf(s.loops); return t && t.width > 0.12 * H; });
  if (!crotch) throw new Error('Could not find the crotch');
  const crotchY = crotch.y, cf = (crotchY - lo) / H;
  const torsoScan = scan(cf + 0.01, 0.9).map((s) => ({ ...s, torso: torsoOf(s.loops) })).filter((s) => s.torso);
  const pick = (f0, f1, better) => torsoScan.filter((s) => s.y >= at(f0) && s.y <= at(f1)).reduce((a, b) => (better(b.torso, a.torso) ? b : a));
  const hip = pick(cf + 0.025, cf + 0.12, (a, b) => a.girth > b.girth); // just above the crotch the section still holds the thighs
  const hf = (hip.y - lo) / H;
  const waist = pick(hf + 0.03, hf + 0.2, (a, b) => a.girth < b.girth);
  const wf = (waist.y - lo) / H;
  // Armpit: where the torso cross-section suddenly widens because the arms join it.
  let armpit = null;
  for (let i = 1; i < torsoScan.length; i++) {
    const s = torsoScan[i], p = torsoScan[i - 1];
    if (s.y > waist.y && s.torso.width > p.torso.width * 1.25) { armpit = p; break; }
  }
  if (!armpit) throw new Error('Could not find the armpit');
  const af = (armpit.y - lo) / H;
  // Chest: the widest girth below the armpit, at least 2.5% of height under it (the lats peak right at the armpit; the tape goes at nipple level).
  const chest = pick(wf + 0.02, af - 0.025, (a, b) => a.girth > b.girth);
  // Neck: the narrowest cross-section between the shoulders and the head.
  const neck = pick(af + 0.04, 0.9, (a, b) => a.width < b.width);
  const shoulderY = armpit.y + 0.55 * (neck.y - armpit.y);
  const leg = (y) => ({ girth: legGirth(sliceLoops(pos, idx, y), 1) });
  const thighY = crotchY - 0.015 * H;
  return { lo, hi, crotchY, hipY: hip.y, waistY: waist.y, chestY: chest.y, armpitY: armpit.y, shoulderY, neckY: neck.y, thighY, calfY: lo + 0.2 * H,
    girth: { hip: hip.torso.girth, waist: waist.torso.girth, chest: chest.torso.girth, thigh: leg(thighY)?.girth, calf: leg(lo + 0.2 * H)?.girth },
    shoulderWidth: torsoOf(sliceLoops(pos, idx, shoulderY))?.width };
}

const lerp = (a, b, t) => a + (b - a) * t;

// Centre of the torso (and of each leg) as a function of original height, for scaling about it. Cached per mesh.
const centreCache = new WeakMap();
function centres(pos, idx, L) {
  if (centreCache.has(pos)) return centreCache.get(pos);
  const torsoCentre = [], legCentre = [], H0 = L.hi - L.lo;
  for (let f = 0.02; f <= 0.98; f += 0.01) {
    const y = L.lo + f * H0, loops = sliceLoops(pos, idx, y), t = torsoOf(loops), lg = legOf(loops, 1);
    if (t && y > L.crotchY) torsoCentre.push([y, [t.cx, t.cz]]);
    if (lg && y < L.crotchY) legCentre.push([y, [Math.abs(lg.cx), lg.cz]]);
  }
  // Which leg each vertex below the crotch belongs to, by connectivity: a part that reaches the floor is a leg.
  // (Sign of x is not enough: wide thighs cross the mid-line.) 0 = not a leg, e.g. a hand hanging below the crotch.
  const n = pos.length / 3, parent = Int32Array.from({ length: n }, (_, i) => i), below = (i) => pos[i * 3 + 1] < L.crotchY;
  const find = (a) => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const a = idx[t + e], b = idx[t + (e + 1) % 3];
    if (below(a) && below(b)) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  }
  const comp = new Map();
  for (let i = 0; i < n; i++) if (below(i)) {
    const r = find(i), c = comp.get(r) ?? { sx: 0, k: 0, floor: false };
    c.sx += pos[i * 3]; c.k++; c.floor ||= pos[i * 3 + 1] < L.lo + 0.05 * H0; comp.set(r, c);
  }
  const side = new Int8Array(n);
  for (let i = 0; i < n; i++) if (below(i)) { const c = comp.get(find(i)); side[i] = c.floor ? Math.sign(c.sx) || 1 : 0; }
  const out = { torsoCentre, legCentre, side };
  centreCache.set(pos, out);
  return out;
}
// Piecewise-linear lookup over knots [[x, y], ...] sorted by x; clamps at the ends.
function pw(knots, x) {
  if (x <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) if (x <= knots[i][0]) return lerp(knots[i - 1][1], knots[i][1], (x - knots[i - 1][0]) / (knots[i][0] - knots[i - 1][0]));
  return knots[knots.length - 1][1];
}

// target (metres): height, chest, waist, hip, shoulder, inseam, thigh, calf (girths are circumferences).
// Returns { deform(p) -> p', landmarks (in the fitted body), scale } where deform works on any point near the body.
export function fitBody(pos, idx, target, L = findLandmarks(pos, idx)) {
  const H0 = L.hi - L.lo, H = target.height, s = H / H0;
  const { torsoCentre, legCentre, side } = centres(pos, idx, L);
  const centreAt = (knots, y) => [pw(knots.map(([k, c]) => [k, c[0]]), y), pw(knots.map(([k, c]) => [k, c[1]]), y)];
  // Girth factor per original height; head and neck keep the uniform scale s.
  const k = (t, g) => (t && g ? t / g : s);
  const kTorso = [[L.crotchY, k(target.hip, L.girth.hip) * 0.97], [L.hipY, k(target.hip, L.girth.hip)], [L.waistY, k(target.waist, L.girth.waist)],
    [L.chestY, k(target.chest, L.girth.chest)], [L.armpitY, k(target.chest, L.girth.chest)], [L.neckY, s]];
  const kxShoulder = k(target.shoulder, L.shoulderWidth);
  const kLeg = [[L.lo, s], [L.calfY, k(target.calf, L.girth.calf)], [L.thighY, k(target.thigh, L.girth.thigh)], [L.crotchY, k(target.hip, L.girth.hip) * 0.97]];
  // Heights: feet to crotch -> inseam; crotch to neck -> the rest of the body below the head; the head keeps scale s.
  const headH = (L.hi - L.neckY) * s;
  const yMap = [[L.lo, 0], [L.crotchY, target.inseam], [L.neckY, H - headH], [L.hi, H]];
  // vi: the point's vertex index in this mesh, when it is one (lets legs be told apart by connectivity).
  const deform = ([x, y, z], vi) => {
    let cx, cz, kx, kz;
    const leg = y < L.crotchY ? (vi !== undefined ? side[vi] : Math.sign(x || 1)) : 0;
    if (leg) {
      const [lx, lz] = centreAt(legCentre, y); cx = leg * lx; cz = lz; kx = kz = pw(kLeg, y);
    } else {
      [cx, cz] = centreAt(torsoCentre, y); kz = pw(kTorso, y);
      // Shoulder width: extra x scale peaking at the shoulder line, fading to the chest below and the neck above.
      const sh = y < L.armpitY ? 0 : y < L.shoulderY ? (y - L.armpitY) / (L.shoulderY - L.armpitY) : y < L.neckY ? 1 - (y - L.shoulderY) / (L.neckY - L.shoulderY) : 0;
      kx = lerp(kz, kxShoulder, Math.max(0, sh));
    }
    return [(x - cx) * kx + cx * s, pw(yMap, y), (z - cz) * kz + cz * s];
  };
  const map = (y) => pw(yMap, y);
  return { deform, scale: s, landmarks: { crotchY: map(L.crotchY), hipY: map(L.hipY), waistY: map(L.waistY), chestY: map(L.chestY), armpitY: map(L.armpitY), shoulderY: map(L.shoulderY), neckY: map(L.neckY), thighY: map(L.thighY), calfY: map(L.calfY) } };
}

// Tape measurements of a fitted mesh at its landmark heights, from the cross-sections (same rules as fitting).
export function measureFitted(pos, idx, lm) {
  const [lo, hi] = bounds(pos), t = (y) => torsoOf(sliceLoops(pos, idx, y)), lg = (y) => ({ girth: legGirth(sliceLoops(pos, idx, y), 1) });
  return { height: hi - lo, inseam: lm.crotchY - lo, chest: t(lm.chestY)?.girth, waist: t(lm.waistY)?.girth, hip: t(lm.hipY)?.girth,
    shoulder: t(lm.shoulderY)?.width, thigh: lg(lm.thighY)?.girth, calf: lg(lm.calfY)?.girth };
}
