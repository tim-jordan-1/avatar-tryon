// Builds the loadable extension in extension/build/: copies the extension files and the shared modules, downloads
// three.js, Jolt, MediaPipe (code, wasm and the two models) and the MakeHuman data (extension pages may not load
// scripts from a CDN, and the face analysis must work offline), and points the imports and data URLs at the local copies.
// Run: node extension/build.mjs
// With --release it also drops the devtools hooks and the localhost access, and zips build/ into dist/ for the Chrome Web Store.
import { mkdir, readFile, writeFile, copyFile, cp, rm, readdir, stat, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url)), outputs = join(here, '..'), build = join(here, 'build');
const OWN = ['manifest.json', 'background.js', 'panel.html', 'panel.js', 'extract.js', 'colour.js', 'capture.html', 'capture.js', 'capture-core.js', 'photo-store.js'];
const SHARED = ['avatar-poc/body.js', 'avatar-poc/anim.js', 'cloth-spike/tryon.js', 'cloth-spike/fabric.js', 'cloth-spike/shirt.js', 'fit-map/sizechart.js', 'fit-map/fit.js',
  'twin-spike/fuse.js', 'twin-spike/hair.js', 'twin-spike/rbf.js', 'twin-spike/head.js', 'twin-spike/mhbody.js', 'twin-spike/analyse.js', 'twin-spike/mhavatar.js', 'sweep-spike/sweep.js'];
const NPM = 'https://cdn.jsdelivr.net/npm/';
const MP = `${NPM}@mediapipe/tasks-vision@1.1.1/`;
const THREE = `${NPM}three@0.170.0/`;
const MH_DATA = 'https://cdn.jsdelivr.net/gh/makehumancommunity/makehuman@a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/';
const MH_FILES = ['3dobjs/base.obj', 'rigs/default.mhskel', 'rigs/default_weights.mhw',
  ...['male', 'female'].flatMap((sex) => [...['african', 'asian', 'caucasian'].map((e) => `${e}-${sex}-young.target`), `universal-${sex}-young-averagemuscle-averageweight.target`].map((t) => `targets/macrodetails/${t}`))];
const VENDOR = {
  'three.module.min.js': `${THREE}build/three.module.min.js`,
  'OrbitControls.js': `${THREE}examples/jsm/controls/OrbitControls.js`,
  'BufferGeometryUtils.js': `${THREE}examples/jsm/utils/BufferGeometryUtils.js`,
  'jolt-physics.wasm.js': `${NPM}jolt-physics@1.1.0/dist/jolt-physics.wasm.js`,
  'jolt-physics.wasm.wasm': `${NPM}jolt-physics@1.1.0/dist/jolt-physics.wasm.wasm`,
  // Only the SIMD wasm build: forVisionTasks picks the no-SIMD one only in browsers without SIMD, and Chrome has had it since 2021.
  'mediapipe/vision_bundle.mjs': `${MP}vision_bundle.mjs`,
  'mediapipe/wasm/vision_wasm_internal.js': `${MP}wasm/vision_wasm_internal.js`,
  'mediapipe/wasm/vision_wasm_internal.wasm': `${MP}wasm/vision_wasm_internal.wasm`,
  'mediapipe/face_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
  'mediapipe/selfie_multiclass_256x256.tflite': 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite',
  ...Object.fromEntries(MH_FILES.map((f) => [`mh/${f}`, MH_DATA + f])),
};
const JOLT_URL = VENDOR['jolt-physics.wasm.js'];

// Downloads are kept in the OS temp folder so a rebuild does not fetch 30 MB again.
const cacheDir = join(tmpdir(), 'avatar-tryon-vendor-cache');
await mkdir(cacheDir, { recursive: true });
async function download(url) {
  const file = join(cacheDir, createHash('sha1').update(url).digest('hex'));
  try { return await readFile(file); } catch { /* not cached yet */ }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  await writeFile(file, data);
  return data;
}

await rm(build, { recursive: true, force: true });
await mkdir(join(build, 'vendor'), { recursive: true });
for (const f of OWN) await copyFile(join(here, f), join(build, f));
await cp(join(here, 'icons'), join(build, 'icons'), { recursive: true });
await copyFile(join(here, 'NOTICES.md'), join(build, 'NOTICES.md'));

for (const [name, url] of Object.entries(VENDOR)) {
  let data = await download(url);
  if (/^(OrbitControls|BufferGeometryUtils)\.js$/.test(name)) data = Buffer.from(data.toString().replaceAll("from 'three'", "from './three.module.min.js'"));
  await mkdir(dirname(join(build, 'vendor', name)), { recursive: true });
  await writeFile(join(build, 'vendor', name), data);
}

// Shared modules keep their folders under lib/, so their relative imports still work; bare and CDN imports are rewritten.
// Strings that start with the MakeHuman data URL become URLs of the local copy, resolved against the module.
const exists = (p) => access(p).then(() => true, () => false);
for (const f of SHARED) {
  if (!(await exists(join(outputs, f)))) { console.warn(`WARNING: ${f} does not exist yet; skipped.`); continue; }
  const dest = join(build, 'lib', f), vendor = relative(dirname(dest), join(build, 'vendor')).replaceAll('\\', '/');
  await mkdir(dirname(dest), { recursive: true });
  const src = (await readFile(join(outputs, f), 'utf8'))
    .replaceAll("from 'three/addons/controls/OrbitControls.js'", `from '${vendor}/OrbitControls.js'`)
    .replaceAll("from 'three/addons/utils/BufferGeometryUtils.js'", `from '${vendor}/BufferGeometryUtils.js'`)
    .replaceAll("from '@mediapipe/tasks-vision'", `from '${vendor}/mediapipe/vision_bundle.mjs'`)
    .replaceAll("from 'three'", `from '${vendor}/three.module.min.js'`)
    .replaceAll(`from '${JOLT_URL}'`, `from '${vendor}/jolt-physics.wasm.js'`)
    .replace(new RegExp(`(['"\`])${MH_DATA.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^'"\`]*)\\1`, 'g'), (_, q, rest) =>
      q === '`' ? `\`\${new URL('${vendor}/mh/', import.meta.url).href}${rest}\`` : `new URL('${vendor}/mh/${rest}', import.meta.url).href`);
  if (/from '(three|@|https?:)/.test(src)) throw new Error(`${f}: an import still points outside the extension`);
  if (src.includes(MH_DATA)) throw new Error(`${f}: a MakeHuman data URL is still remote`);
  for (const m of src.matchAll(/^(?!\s*\/\/).*['"`](https?:\/\/[^'"`]+)/gm)) console.warn(`WARNING: ${f} still has a remote URL: ${m[1]}`);
  await writeFile(dest, src);
}

async function size(dir) {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true })) n += e.isDirectory() ? await size(join(dir, e.name)) : (await stat(join(dir, e.name))).size;
  return n;
}
console.log(`Vendor size: ${((await size(join(build, 'vendor'))) / 1e6).toFixed(1)} MB (mediapipe ${((await size(join(build, 'vendor/mediapipe'))) / 1e6).toFixed(1)}, mh ${((await size(join(build, 'vendor/mh'))) / 1e6).toFixed(1)})`);
console.log(`Built ${relative(process.cwd(), build)}. Load it in chrome://extensions with "Load unpacked".`);

if (process.argv.includes('--release')) {
  for (const f of ['panel.js', 'capture.js']) {
    const src = await readFile(join(build, f), 'utf8'), out = src.replace(/^.*\/\/ for checks from devtools\n/gm, '');
    if (out === src) throw new Error(`${f}: no devtools hook found to remove`);
    await writeFile(join(build, f), out);
  }
  const manifest = JSON.parse(await readFile(join(build, 'manifest.json'), 'utf8'));
  delete manifest.host_permissions; // localhost is only for the example shop; the optional http://*/* still covers it
  await writeFile(join(build, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const zip = join(here, 'dist', `avatar-tryon-${manifest.version}.zip`);
  await mkdir(dirname(zip), { recursive: true });
  await rm(zip, { force: true });
  execFileSync('zip', ['-r', '-q', '-X', zip, '.'], { cwd: build });
  console.log(`Release zip: ${relative(process.cwd(), zip)} (${((await stat(zip)).size / 1e6).toFixed(1)} MB)`);
}
