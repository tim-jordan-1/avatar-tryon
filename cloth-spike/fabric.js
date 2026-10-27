// Material description -> cloth simulation parameters. Pure JS, runs in the browser and in Node.
//
// These are ESTIMATES for a visual spike, not measured values. They are order-of-magnitude figures for
// 100% cotton fabric in the low-strain range (per metre of fabric width), chosen so the fabrics rank
// correctly against each other. Real values vary by yarn, knit or weave density, and finish.
//
// | construction | stretch N/m | shear N/m | bend N·m | max stretch (LRA) | damping 1/s | drift |
// |--------------|-------------|-----------|----------|-------------------|-------------|-------|
// | jersey       | 300         | 30        | 2e-6     | 1.10              | 8           | 0.4   |
// | rib          | 150         | 20        | 3e-6     | 1.20              | 8           | 0.4   |
// | woven        | 3000        | 300       | 1e-5     | 1.02              | 9           | 0.35  |
// | denim        | 8000        | 1000      | 6e-5     | 1.01              | 11          | 0.3   |
//
// Damping is Jolt's linear damping: each step removes damping * dt of the vertex speed. Heavier, stiffer fabric
// damps more. Drift scales how far a vertex may sit from its place on the skinned body (1 cm at the shoulder to 4 cm
// at the hem, times drift): a stiff fabric stays closer to the body. The bend value is below the range where
// Jolt's dihedral constraint acts (see README), so damping and drift are what calm the cloth.
//
// Elastane (also spandex, Lycra) divides stretch and shear stiffness by (1 + 12 * fraction) and adds
// 2 * fraction to the max stretch: 5% elastane gives 0.63x the stiffness and +10% stretch.
// Mass per area comes from gsm. Denim weight in oz/yd² converts with 1 oz/yd² = 33.906 g/m².
// Jolt compliance is the inverse of stiffness (XPBD): stretch and shear in m/N, bend in 1/(N·m).

export const CONSTRUCTIONS = {
  jersey: { stretch: 300, shear: 30, bend: 2e-6, maxStretch: 1.1, damping: 8, drift: 0.4 },
  rib: { stretch: 150, shear: 20, bend: 3e-6, maxStretch: 1.2, damping: 8, drift: 0.4 },
  woven: { stretch: 3000, shear: 300, bend: 1e-5, maxStretch: 1.02, damping: 9, drift: 0.35 },
  denim: { stretch: 8000, shear: 1000, bend: 6e-5, maxStretch: 1.01, damping: 11, drift: 0.3 },
};

const ELASTANE = /^(elastane|spandex|lycra)$/;

export const ozToGsm = (oz) => oz * 33.906;

// '95% cotton 5% elastane' or 'Cotton 95%, Elastane 5%' -> { cotton: 95, elastane: 5 }.
// The first percentage decides the order: a word right after it means 'number then fibre'. The fibre is the
// last word of its segment, so an adjective before it is skipped: '7% recycled elastane' -> elastane.
export function parseComposition(text) {
  const s = String(text).toLowerCase(), out = {};
  const pcts = [...s.matchAll(/(\d+(?:\.\d+)?)\s*%/g)];
  const pctFirst = pcts.length > 0 && /^\s*[a-z]/.test(s.slice(pcts[0].index + pcts[0][0].length));
  pcts.forEach((m, i) => {
    const seg = pctFirst ? s.slice(m.index + m[0].length, pcts[i + 1]?.index ?? s.length)
      : s.slice(i ? pcts[i - 1].index + pcts[i - 1][0].length : 0, m.index);
    // Stop at punctuation, so 'polyester. Lining: 100% ...' does not read 'lining' as a fibre.
    const part = pctFirst ? seg.split(/[.,;:/()]/)[0] : seg.split(/[.,;:/()]/).pop();
    const words = part.match(/[a-z]+/g);
    if (words) { const fibre = words[words.length - 1]; out[fibre] = (out[fibre] ?? 0) + Number(m[1]); }
  });
  return out;
}

export function fabricParams({ composition = '100% cotton', gsm, construction }) {
  const base = CONSTRUCTIONS[construction];
  if (!base) throw new Error(`unknown construction: ${construction}`);
  if (!(gsm > 0)) throw new Error('gsm must be a positive number');
  const fibres = parseComposition(composition);
  const e = Object.entries(fibres).reduce((s, [k, v]) => s + (ELASTANE.test(k) ? v : 0), 0) / 100;
  const soften = 1 + 12 * e;
  const stretch = base.stretch / soften, shear = base.shear / soften;
  return {
    massPerArea: gsm / 1000, // kg/m²
    stretchStiffness: stretch, shearStiffness: shear, bendStiffness: base.bend,
    stretchCompliance: 1 / stretch, shearCompliance: 1 / shear, bendCompliance: 1 / base.bend,
    maxStretch: base.maxStretch + 2 * e,
    damping: base.damping, drift: base.drift,
    elastane: e,
  };
}
