// Procedural animation for the body.js skeleton: bone rotations set from scratch each frame.
// Shared by avatar-poc and cloth-spike. rig: bone name -> THREE.Bone; hipsY: the hips bone's bind height.

// The try-on sequence: wind up, look down at the shirt, twist to see each side, hop with a fist pump, settle.
// Keys are [seconds, value]; values ease between keys. Angles in radians, hop in metres.
// The cloth has no continuous collision, so arm moves stay slow: under 2.5 m/s at the hand (anim.test.mjs).
export const TRYON_SECONDS = 4;
const TRYON = {
  crouch: [[0, 0], [0.25, -0.018], [0.5, 0], [2.15, 0], [2.3, -0.015], [2.42, 0]],
  chestX: [[0, 0], [0.25, 0.1], [0.55, 0.16], [1.0, 0.12], [2.2, 0.06], [2.55, -0.08], [3.0, -0.03], [3.4, 0]],
  chestY: [[0, 0], [1.0, 0], [1.35, 0.32], [1.6, 0.32], [1.95, -0.32], [2.2, -0.32], [2.45, 0], [3.4, 0]],
  headX: [[0, 0], [0.3, 0.1], [0.6, 0.48], [1.0, 0.45], [1.35, 0.3], [2.2, 0.3], [2.5, -0.15], [3.0, -0.05], [3.4, 0]],
  headY: [[0, 0], [1.0, 0], [1.35, 0.42], [1.6, 0.42], [1.95, -0.42], [2.2, -0.42], [2.45, 0], [3.4, 0]],
  armLz: [[0, 0], [0.55, 0.08], [1.35, 0.32], [1.6, 0.32], [1.95, 0.2], [2.5, 0.25], [3.0, 0.05], [3.4, 0]],
  armRz: [[0, 0], [0.55, -0.08], [1.35, -0.15], [1.6, -0.15], [1.95, -0.32], [2.2, -0.32], [2.8, 0], [4.0, 0]],
  // Fist pump: upper arm forward (negative x swings a hanging limb forward), elbow bent up, a small double pump.
  armRx: [[0, 0], [2.2, 0], [2.8, -0.95], [3.0, -0.82], [3.3, -0.95], [4.0, 0]],
  foreRx: [[0, 0], [2.2, 0], [2.8, -1.25], [3.0, -1.45], [3.3, -1.3], [4.0, 0]],
  foreLz: [[0, 0], [2.3, 0], [2.6, 0.35], [3.0, 0.2], [3.4, 0]],
};
// 'tryonTight': the same looks, then a shrug instead of the hop and fist pump. Arms out a little, forearms up with the
// palms open, the head tilted and shaking a little: "bit snug".
const TIGHT = {
  armLz: [[0, 0], [0.55, 0.08], [1.35, 0.32], [1.6, 0.32], [1.95, 0.2], [2.5, 0.3], [3.3, 0.3], [3.85, 0]],
  armRz: [[0, 0], [0.55, -0.08], [1.35, -0.15], [1.6, -0.15], [1.95, -0.32], [2.2, -0.32], [2.5, -0.3], [3.3, -0.3], [3.85, 0]],
  foreX: [[0, 0], [2.2, 0], [2.6, -0.85], [3.3, -0.85], [3.9, 0]],
  headZ: [[0, 0], [2.3, 0], [2.6, 0.14], [3.3, 0.14], [3.8, 0]],
};
const HOP = [2.42, 2.78, 0.035]; // start s, end s, height m: inside the 4 cm the cloth may drift from its place
const ease = (x) => x * x * (3 - 2 * x);
function key(track, u) {
  if (u <= track[0][0]) return track[0][1];
  for (let i = 1; i < track.length; i++) {
    const [t1, v1] = track[i];
    if (u <= t1) { const [t0, v0] = track[i - 1]; return v0 + (v1 - v0) * ease((u - t0) / (t1 - t0)); }
  }
  return track[track.length - 1][1];
}

// t: the clock in seconds. t0: when the try-on sequence started (modes 'tryon', 'tryonTight' and 'tryonCalm').
// look: optional { yaw, pitch, w } in radians: in idle, the head turns that way with weight w (0..1), for example
// toward the pointer.
export function animate(rig, avatar, hipsY, t, mode, t0 = 0, look = null) {
  for (const b of Object.values(rig)) b.rotation.set(0, 0, 0);
  rig.hips.position.y = hipsY;
  avatar.rotation.y = mode === 'turn' ? t * 0.7 : 0;
  if (mode === 'apose') return;

  const breathe = Math.sin(t * 1.7);
  rig.chest.rotation.x = breathe * 0.012;
  rig.head.rotation.y = Math.sin(t * 0.4) * 0.12;

  if (mode === 'walk') {
    const p = t * 4.2, s = Math.sin(p);
    rig.thighL.rotation.x = -s * 0.45;
    rig.thighR.rotation.x = s * 0.45;
    rig.shinL.rotation.x = Math.max(0, Math.cos(p)) * 0.7;
    rig.shinR.rotation.x = Math.max(0, -Math.cos(p)) * 0.7;
    rig.upperArmL.rotation.x = s * 0.35;
    rig.upperArmR.rotation.x = -s * 0.35;
    rig.foreArmL.rotation.x = rig.foreArmR.rotation.x = -0.25;
    rig.hips.rotation.y = s * 0.08;
    rig.chest.rotation.y = -s * 0.1;
    rig.hips.position.y = hipsY + Math.abs(Math.cos(p)) * 0.012;
  } else if (mode === 'armsUp') {
    const up = (1 - Math.cos(t * 1.2)) / 2 * 2.5;
    rig.upperArmL.rotation.z = up;
    rig.upperArmR.rotation.z = -up;
    rig.foreArmL.rotation.z = up * 0.15;
    rig.foreArmR.rotation.z = -up * 0.15;
  } else if (mode === 'tryon' || mode === 'tryonTight' || mode === 'tryonCalm') {
    // Calm (reduced motion): the same looks at 40%, with no hop and no fist pump.
    const u = t - t0, k = mode === 'tryonCalm' ? 0.4 : 1, calm = mode === 'tryonCalm', tight = mode === 'tryonTight';
    rig.chest.rotation.x += key(TRYON.chestX, u) * k;
    rig.chest.rotation.y = key(TRYON.chestY, u) * k * 0.6;
    rig.head.rotation.x = key(TRYON.headX, u) * k;
    rig.head.rotation.y = key(TRYON.headY, u) * k;
    rig.upperArmL.rotation.z = calm ? 0 : key(TRYON.armLz, u);
    rig.upperArmR.rotation.z = calm ? 0 : key(TRYON.armRz, u);
    rig.foreArmL.rotation.z = calm ? 0 : key(TRYON.foreLz, u);
    rig.upperArmR.rotation.x = calm ? 0 : key(TRYON.armRx, u);
    rig.foreArmR.rotation.x = calm ? 0 : key(TRYON.foreRx, u);
    if (tight) {
      rig.upperArmL.rotation.z = key(TIGHT.armLz, u);
      rig.upperArmR.rotation.z = key(TIGHT.armRz, u);
      rig.foreArmL.rotation.z = 0;
      rig.upperArmR.rotation.x = 0;
      rig.foreArmL.rotation.x = rig.foreArmR.rotation.x = key(TIGHT.foreX, u);
      rig.head.rotation.z = key(TIGHT.headZ, u);
      rig.head.rotation.y += u > 2.6 && u < 3.3 ? Math.sin(((u - 2.6) / 0.7) * 2 * Math.PI) * 0.1 : 0;
    }
    const hop = calm || tight || u < HOP[0] || u > HOP[1] ? 0 : Math.sin(((u - HOP[0]) / (HOP[1] - HOP[0])) * Math.PI) * HOP[2];
    rig.hips.position.y = hipsY + key(TRYON.crouch, u) * (calm ? 0 : 1) + hop;
  } else {
    // A lively idle: a small bounce, weight shifting from hip to hip, and now and then a look around.
    rig.hips.rotation.y = Math.sin(t * 0.5) * 0.04;
    rig.hips.rotation.z = Math.sin(t * 0.9) * 0.025;
    rig.chest.rotation.z = -Math.sin(t * 0.9) * 0.02;
    rig.hips.position.y = hipsY + Math.sin(t * 2.6) * 0.003;
    rig.head.rotation.y += Math.sin(t * 0.23) ** 5 * 0.35;
    rig.head.rotation.x = Math.sin(t * 0.31) ** 3 * 0.08;
    if (look?.w) { // the head turns to the look; the chest helps a little with a big turn
      const w = look.w;
      rig.head.rotation.y += (look.yaw * 0.8 - rig.head.rotation.y) * w;
      rig.head.rotation.x += (look.pitch - rig.head.rotation.x) * w;
      rig.chest.rotation.y += look.yaw * 0.2 * w;
    }
  }
}
