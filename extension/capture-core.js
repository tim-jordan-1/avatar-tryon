// The logic of the guided camera capture, with no browser APIs so it can be tested in Node: head yaw from the face
// pose matrix, how much a face moved between frames, and the state machine that decides when a photo is taken.

export const FRONT_MAX = 8;       // degrees: the front photo needs |yaw| below this
// degrees: a side photo needs |yaw| inside this window. The pose matrix reads low on the samples (43 to 49 for true turns of
// 54 to 57), and fuse.js accepts 35 to 80, so the window starts at 35.
export const SIDE_MIN = 35, SIDE_MAX = 70;
export const HOLD_MS = 400;       // the pose must hold this long
export const STEADY_DEG = 6;      // ... and the yaw may not wander more than this while holding
export const MIN_FACE = 0.25;     // face height as a fraction of the frame height
export const MAX_JITTER = 0.01;   // mean landmark move between frames, as a fraction of face height (sharpness proxy; untuned on real video)

// Sign of the matrix yaw so that it matches fuse.js: positive when the face points to the viewer's left, which is the
// "Left side" photo (slot 1). Measured on the twin-spike samples (see the README).
const YAW_SIGN = -1;

// facialTransformationMatrixes[0].data: 4x4, column-major. The third column is the direction the face points.
export const yawFromMatrix = (d) => (YAW_SIGN * Math.atan2(d[8], d[10]) * 180) / Math.PI;

// Slot of a side photo by the sign of its yaw: 1 = left side, 2 = right side.
export const sideSlot = (yaw) => (yaw > 0 ? 1 : 2);

// Mean move of the landmarks between two frames, as a fraction of the face height. aspect = frame width / height.
export function jitter(prev, cur, aspect) {
  const ys = cur.map((p) => p.y), h = Math.max(...ys) - Math.min(...ys);
  let sum = 0;
  for (let i = 0; i < cur.length; i++) sum += Math.hypot((cur[i].x - prev[i].x) * aspect, cur[i].y - prev[i].y);
  return sum / cur.length / h;
}

// Photos are taken in this order: front first, then the two sides in either order. A frame is
// { yaw, faceFrac, jitter }, or null when no face was found. push() returns
// { hint, progress (0..1), captured (slot or null), done }.
export function createCapture() {
  const got = [false, false, false];
  let hold = null; // { t0, slot, lo, hi }
  const reset = (hint) => { hold = null; return { hint, progress: 0, captured: null, done: got.every(Boolean) }; };
  return {
    got,
    // Slots still to take, front first.
    wanted: () => [0, 1, 2].filter((s) => !got[s]),
    retake(slot) { got[slot] = false; hold = null; },
    push(t, f) {
      if (got.every(Boolean)) return reset('done');
      if (!f) return reset('noface');
      if (f.faceFrac < MIN_FACE) return reset('closer');
      const a = Math.abs(f.yaw);
      let slot;
      if (!got[0]) {
        if (a >= FRONT_MAX) return reset('front');
        slot = 0;
      } else {
        if (a < SIDE_MIN) return reset('more');
        if (a > SIDE_MAX) return reset('less');
        slot = sideSlot(f.yaw);
        if (got[slot]) return reset('other');
      }
      if (f.jitter > MAX_JITTER) return reset('still');
      if (!hold || hold.slot !== slot) hold = { t0: t, slot, lo: f.yaw, hi: f.yaw };
      hold.lo = Math.min(hold.lo, f.yaw); hold.hi = Math.max(hold.hi, f.yaw);
      if (hold.hi - hold.lo > STEADY_DEG) { hold = { t0: t, slot, lo: f.yaw, hi: f.yaw }; return { hint: 'hold', progress: 0, captured: null, done: false }; }
      const progress = Math.min(1, (t - hold.t0) / HOLD_MS);
      if (progress < 1) return { hint: 'hold', progress, captured: null, done: false };
      got[slot] = true;
      hold = null;
      return { hint: 'captured', progress: 1, captured: slot, done: got.every(Boolean) };
    },
  };
}
