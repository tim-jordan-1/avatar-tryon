// Preset hairstyles: MakeHuman system hair proxies (CC0), fitted to the deformed base mesh. No dependencies.
// A .mhclo file places each proxy vertex as a weighted sum of 3 base.obj vertices plus a scaled offset,
// so a hair fitted to the warped base mesh follows the user's head. Semantics follow makehuman/shared/proxy.py.

// The official system assets are not on GitHub under makehumancommunity (they ship as a zip). This is a
// full copy of the MakeHuman 1.x tree with the system assets; its hair files are byte-identical (same git
// blob SHAs) to the independent copy in vidya-hub/makehuman-core. Every asset file carries the CC0 header.
const SHA = 'cff238433c72de20c87686b6efd8f15e5bc48cc7';
const CDN = `https://cdn.jsdelivr.net/gh/MaximovIlya/makehuman@${SHA}/makehuman/data/hair`;
// shortcut: jsDelivr refuses some files of this 380 MB repo ("Package size exceeded ... 50 MB"); those use GitHub raw (CORS *). Move to a small asset repo before shipping.
const RAW = `https://raw.githubusercontent.com/MaximovIlya/makehuman/${SHA}/makehuman/data/hair`;
const SOURCE = `https://github.com/MaximovIlya/makehuman/tree/${SHA}/makehuman/data/hair`;

const preset = (id, name, lengthClass, texture = `${id}_diffuse.png`, texBase = CDN) => ({
  id, name, lengthClass,
  objUrl: `${CDN}/${id}/${id}.obj`,
  mhcloUrl: `${CDN}/${id}/${id}.mhclo`,
  textureUrl: `${texBase}/${id}/${texture}`,
  licence: 'CC0 1.0 (MakeHuman system assets, released September 2020)',
  source: `${SOURCE}/${id}`,
});

export const LENGTH_CLASSES = ['Buzz cut', 'Short', 'Medium (neck length)', 'Shoulder length', 'Long'];

export const PRESETS = [
  preset('short04', 'Buzz cut', 'Buzz cut'),
  preset('short02', 'Short crop', 'Short'),
  preset('short03', 'Pixie', 'Short'),
  preset('afro01', 'Afro', 'Short', 'afro_diffuse.png'),
  preset('bob02', 'Bob', 'Medium (neck length)'),
  preset('ponytail01', 'Ponytail', 'Shoulder length'),
  preset('braid01', 'Side braid', 'Shoulder length'),
  preset('long01', 'Long straight', 'Long', 'long01_diffuse.png', RAW),
];

export const defaultPresetFor = (lengthClass) =>
  PRESETS.find((p) => p.lengthClass === lengthClass) ?? PRESETS.find((p) => p.id === 'short02');

// .mhclo text -> reference vertices, weights, offsets and the offset scale references.
// Vertex indices are 0-based positions in base.obj's `v` lines, counted over all groups (body and helpers).
export function parseMhclo(text) {
  const refs = [], weights = [], offsets = [], deleteVerts = [], scale = {};
  let status = null, name = null, objFile = null, material = null;
  for (const line of text.split('\n')) {
    const w = line.trim().split(/\s+/);
    if (!w[0] || w[0].startsWith('#')) continue;
    if (/^[-\d]/.test(w[0])) { // data line for the current block
      if (status === 'verts') {
        if (w.length === 1) { refs.push(+w[0], 0, 1); weights.push(1, 0, 0); offsets.push(0, 0, 0); }
        else { refs.push(+w[0], +w[1], +w[2]); weights.push(+w[3], +w[4], +w[5]); offsets.push(+(w[6] ?? 0), +(w[7] ?? 0), +(w[8] ?? 0)); }
      } else if (status === 'delete_verts') {
        // "a - b" is an inclusive range
        for (let i = 0; i < w.length; i++) {
          if (w[i] === '-') { for (let v = +w[i - 1] + 1; v < +w[i + 1]; v++) deleteVerts.push(v); i++; deleteVerts.push(+w[i]); }
          else deleteVerts.push(+w[i]);
        }
      }
      continue;
    }
    const key = w[0];
    if (key === 'verts' || key === 'delete_verts' || key === 'weights') status = key;
    else if (key === 'name') name = w.slice(1).join(' ');
    else if (key === 'obj_file') objFile = w[1];
    else if (key === 'material') material = w[1];
    else if (/^[xyz]_scale$/.test(key)) scale[key[0]] = [+w[1], +w[2], +w[3]];
    else if (/shear_[xyz]$/.test(key)) throw new Error(`mhclo ${key} (shear offsets) is not supported`);
  }
  const axes = Object.keys(scale).length;
  if (axes !== 0 && axes !== 3) throw new Error('mhclo needs all of x_scale, y_scale, z_scale or none');
  return {
    name, objFile, material, deleteVerts,
    scale: axes ? scale : null,
    refs: Int32Array.from(refs), weights: Float32Array.from(weights), offsets: Float32Array.from(offsets),
    count: refs.length / 3,
  };
}

// Proxy .obj -> positions in `v` order (what the .mhclo indexes), plus render arrays split at UV seams:
// uvs and vIndex (render vertex -> `v` index) per render vertex, triangle indices (polygons fanned).
export function parseObj(text) {
  const v = [], vt = [], uvs = [], vIndex = [], indices = [], seen = new Map();
  for (const line of text.split('\n')) {
    const w = line.trim().split(/\s+/);
    if (w[0] === 'v') v.push(+w[1], +w[2], +w[3]);
    else if (w[0] === 'vt') vt.push(+w[1], +w[2]);
    else if (w[0] === 'f') {
      const corner = w.slice(1).map((c) => {
        if (!seen.has(c)) {
          const [a, b] = c.split('/').map(Number), pi = a < 0 ? v.length / 3 + a : a - 1, ti = b < 0 ? vt.length / 2 + b : b - 1;
          seen.set(c, vIndex.length);
          vIndex.push(pi);
          uvs.push(b ? vt[ti * 2] : 0, b ? vt[ti * 2 + 1] : 0);
        }
        return seen.get(c);
      });
      for (let k = 1; k + 1 < corner.length; k++) indices.push(corner[0], corner[k], corner[k + 1]);
    }
  }
  return { positions: Float32Array.from(v), uvs: Float32Array.from(uvs), vIndex: Uint32Array.from(vIndex), indices: Uint32Array.from(indices) };
}

// Proxy vertex positions (in `v` order) on the deformed base mesh, exactly as proxy.py getCoords:
// p = sum_k w_k * base[ref_k] + M * offset, M = diag(|base[i][a] - base[j][a]| / d) from the x/y/z_scale lines.
// basePos(i) -> [x, y, z] of base.obj vertex i after deformation, in MakeHuman axes (offsets are axis-aligned).
export function fitProxy(mhclo, basePos) {
  const { refs, weights, offsets, count, scale } = mhclo;
  const m = scale ? ['x', 'y', 'z'].map((a, k) => { const [i, j, d] = scale[a]; return Math.abs(basePos(i)[k] - basePos(j)[k]) / d; }) : [1, 1, 1];
  const out = new Float32Array(count * 3);
  for (let p = 0; p < count; p++) {
    for (let r = 0; r < 3; r++) {
      const w = weights[p * 3 + r];
      if (w === 0) continue; // single-index lines carry dummy refs 0 and 1
      const b = basePos(refs[p * 3 + r]);
      for (let k = 0; k < 3; k++) out[p * 3 + k] += w * b[k];
    }
    for (let k = 0; k < 3; k++) out[p * 3 + k] += m[k] * offsets[p * 3 + k];
  }
  return out;
}

// Fitted `v`-order positions -> one position per render vertex of parseObj's output.
export const expand = (fitted, vIndex) => {
  const out = new Float32Array(vIndex.length * 3);
  vIndex.forEach((i, r) => out.set(fitted.subarray(i * 3, i * 3 + 3), r * 3));
  return out;
};
