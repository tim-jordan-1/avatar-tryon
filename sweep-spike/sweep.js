// Picks face photos from one continuous head turn (the "one-sweep scan"): the sharpest frame near the centre of each
// yaw bin. No browser APIs, so it can be tested in Node.

export const BIN_DEG = 10;   // one bin every 10 degrees of head turn
// Bins from -50 to +50: 11 photos. The pose matrix reads big turns low (a true 72 degrees reads about 50), so bins
// past 50 never fill.
export const YAW_MAX = 50;
export const NEAR_DEG = 3;   // a frame counts for a bin only within this many degrees of its centre
export const PITCH_MAX = 12; // degrees: a head tilted up or down more than this is not used
export const MIN_FACE = 0.25; // face height as a fraction of the frame height (same as extension/capture-core.js)

// Head pitch from the face pose matrix (column-major 4x4; the third column is the direction the face points).
// Only its size is used, so its sign does not matter.
export const pitchFromMatrix = (d) => (Math.asin(Math.max(-1, Math.min(1, d[9]))) * 180) / Math.PI;

// Sharpness of a grey image: the variance of its Laplacian. Motion blur lowers it.
export function sharpness(gray, w, h) {
  let s = 0, s2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x, l = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
    s += l; s2 += l * l; n++;
  }
  return n ? s2 / n - (s / n) ** 2 : 0;
}

// push(frame): frame is { yaw, pitch, faceFrac, sharp, data } or null when no face was found. data is kept with the
// photo and never read here. Returns { bin (index or -1), kept (true if this frame is now the bin's photo) }.
export function createSweep({ binDeg = BIN_DEG, yawMax = YAW_MAX, nearDeg = NEAR_DEG } = {}) {
  const centres = [];
  for (let c = -yawMax; c <= yawMax + 1e-9; c += binDeg) centres.push(c);
  const best = centres.map(() => null);
  const front = centres.indexOf(0);
  return {
    centres,
    best,
    push(f) {
      if (!f || f.faceFrac < MIN_FACE || Math.abs(f.pitch) > PITCH_MAX) return { bin: -1, kept: false };
      const bin = Math.round((f.yaw + yawMax) / binDeg);
      if (bin < 0 || bin >= centres.length || Math.abs(f.yaw - centres[bin]) > nearDeg) return { bin: -1, kept: false };
      if (best[bin] && best[bin].sharp >= f.sharp) return { bin, kept: false };
      best[bin] = f;
      return { bin, kept: true };
    },
    // Fraction of bins with a photo: drives the ring of ticks in the scan screen.
    progress: () => best.filter(Boolean).length / centres.length,
    // Enough for today's three-photo build: the front and one photo at 50 degrees or more on each side.
    ready: () => !!best[front] && best.some((f, i) => f && centres[i] <= -50) && best.some((f, i) => f && centres[i] >= 50),
    // The photos, front first (fuse.js aligns every view to views[0]), then by yaw.
    photos: () => [best[front], ...best.filter((f, i) => f && i !== front)].filter(Boolean),
  };
}
