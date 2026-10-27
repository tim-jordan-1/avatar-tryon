// Side panel: read the open product page, pick a size from its chart, and show the t-shirt on the avatar.
import { createTryOn } from './lib/cloth-spike/tryon.js';
import { validate } from './lib/avatar-poc/body.js';
import { parseSizeChart } from './lib/fit-map/sizechart.js';
import { fitReport, recommendSize } from './lib/fit-map/fit.js';
import { extractProduct } from './extract.js';
import { colourFromName } from './colour.js';
import { photoStore, toDataUrl } from './photo-store.js';
import { rgb2hex } from './lib/twin-spike/hair.js';

const $ = (id) => document.getElementById(id);
// The status pill on the stage. kind: 'busy' (work in progress), 'bad' (an error), or '' (done).
// Plain messages fade after a few seconds so the pill does not sit over the avatar's head; errors stay.
const status = (t, kind = '') => {
  $('status').textContent = t;
  $('status').className = `status glass ${kind}`;
  if (t && !kind) setTimeout(() => { if ($('status').textContent === t) status(''); }, 5000);
};
const DEFAULT = { height: 178, chest: 100, waist: 86, hip: 100, shoulder: 46, sex: 'male' };
const EASE_CM = 8; // a body-measurement chart gives the body a size fits; a regular-fit tee adds this much at the chest
const STATUS = { good: 'var(--good)', snug: 'var(--snug)', tight: 'var(--tight)', loose: 'var(--loose)' };
const inExtension = typeof chrome !== 'undefined' && !!chrome.scripting;

// --- storage: chrome.storage in the extension, localStorage when the panel runs as a plain page for testing ---
const store = {
  async get() {
    try { return inExtension ? (await chrome.storage.local.get('me')).me : JSON.parse(localStorage.getItem('tryon-me')); } catch { return null; }
  },
  async set(v) { try { if (inExtension) await chrome.storage.local.set({ me: v }); else localStorage.setItem('tryon-me', JSON.stringify(v)); } catch { /* not saved: still used for this session */ } },
};

// --- the product: from the active tab in the extension, or the bundled example page when testing as a plain page ---
async function readProduct() {
  if (inExtension) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const read = async () => (await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractProduct }))[0].result;
    try {
      return await read();
    } catch (e) {
      // No access: activeTab only covers a tab whose toolbar button was clicked, and it ends when the tab goes to
      // another site. Ask once for shop pages; Chrome keeps the answer.
      // shortcut: asks for all sites, because the tab URL is hidden until we have access; per-site needs the "tabs" permission
      if (!/permission|cannot access/i.test(e.message)) throw e;
      if (!(await chrome.permissions.request({ origins: ['https://*/*', 'http://*/*'] }))) {
        throw new Error('The extension needs your permission to read shop pages. Press Read page and choose Allow.');
      }
      return await read();
    }
  }
  const html = await (await fetch(new URL('../../example-shop/index.html', location))).text();
  return extractProduct(new DOMParser().parseFromString(html, 'text/html'));
}

// A colour for a product colour name: a fashion name ("Dark grey", "Navy blue"), else a CSS name ("Slate Blue" -> slateblue), or null.
function cssColour(name) {
  const fashion = colourFromName(name);
  if (fashion) return fashion;
  const g = document.createElement('canvas').getContext('2d');
  g.fillStyle = '#010203';
  g.fillStyle = String(name).toLowerCase().replace(/[^a-z]/g, '');
  return g.fillStyle === '#010203' ? null : g.fillStyle;
}

let tryon = null, me = null, product = null, chart = null, rec = null;
let mode = 'idle', view = 'three'; // the pressed motion and view buttons; a rebuilt avatar gets them again
let photos = null, face = null; // photos: three canvases [front, left, right]; face: the analysis plus the photos, or null

async function buildAvatar() {
  tryon?.dispose();
  tryon = null;
  $('motion').hidden = $('views').hidden = false;
  $('stage-msg').hidden = true;
  status('Building your avatar…', 'busy');
  // face: { ok, res, fused, mmPerPx, hair, skin, photos, landmarker (IMAGE mode) } or null. The measured skin colour replaces the default.
  try {
    tryon = await createTryOn($('view'), { measurements: me, sex: me.sex, face, ...(face && { skin: rgb2hex(face.skin) }) });
  } catch (e) { // a failed model or physics load must not leave an empty panel with no reason
    $('view').querySelector('canvas')?.remove();
    status(`Could not build the avatar: ${e.message}`, 'bad');
    $('stage-msg').hidden = false;
    $('motion').hidden = $('views').hidden = true; // nothing to move or turn
    return;
  }
  window.__tryon = tryon; // for checks from devtools
  tryon.setMode(mode);
  tryon.view(view);
  if (chart) applySize();
  status(product ? '' : 'Avatar ready.');
}

const bodyOf = (m) => ({ height: m.height, chest: m.chest, waist: m.waist, hip: m.hip, inseam: m.inseam });
const sentence = (t) => `${t[0].toUpperCase()}${t.slice(1)}.`;
const sizeChoice = () => document.querySelector('#chips input:checked')?.value;

// Size chips for the chart, with the recommended size marked. Keeps the shopper's pick if the chart still has it.
function renderSizes(keep) {
  rec = recommendSize(bodyOf(me), chart);
  const labels = chart.sizes.filter((s) => s.ranges.chest).map((s) => s.label);
  const pick = labels.includes(keep) ? keep : rec.label;
  $('chips').innerHTML = labels.map((l) => `<label class="chip${l === rec.label ? ' rec' : ''}"><input class="sr" type="radio" name="size" value="${l}"${l === pick ? ' checked' : ''}><span>${l}${l === rec.label ? '<span class="sr"> (recommended)</span>' : ''}</span></label>`).join('');
}

function applySize() {
  const label = sizeChoice(), size = chart.sizes.find((s) => s.label === label);
  const body = bodyOf(me);
  const rows = fitReport(body, chart, label);
  // Each row: your measurement on a track that spans the size range plus one range width either side.
  $('fit').querySelector('tbody').innerHTML = rows.map((r) => {
    const span = r.hi - r.lo || 1, min = r.lo - span, pct = (v) => Math.max(0, Math.min(100, ((v - min) / (3 * span)) * 100));
    return `<tr><td class="region"><strong>${r.region}</strong><span class="state"><span class="dot" style="background:${STATUS[r.status]}"></span>${r.status}</span></td>
      <td><div class="track" aria-hidden="true"><span class="band" style="left:${pct(r.lo)}%;width:${pct(r.hi) - pct(r.lo)}%"></span><span class="you" style="left:${pct(r.body)}%;background:${STATUS[r.status]}"></span></div>
      <div class="range num"><span>You ${r.body}</span><span>${label} ${r.lo}–${r.hi} cm</span></div></td></tr>`;
  }).join('');
  // The verdict: the size large, one sentence, and a flag when the pick is not the recommendation.
  const picked = label === rec.label;
  $('big').textContent = label;
  $('verdict-title').textContent = picked ? 'Fits you best' : `You picked ${label}`;
  $('flag').textContent = picked ? '' : `We suggest ${rec.label}`;
  $('flag').hidden = picked;
  $('recommend').textContent = sentence(picked ? rec.reason : recommendSize(body, { ...chart, sizes: [size] }).reason);
  if (!tryon) return rows; // avatar failed to build: the fit table still works
  const fabric = { composition: product.material || '100% cotton', gsm: product.gsm || 180, construction: product.construction };
  const garmentChest = size.ranges.chest[1] + EASE_CM;
  const fp = tryon.setGarment({ fabric, garmentChest, color: cssColour(product.color) ?? '#7d8794' });
  $('fabric').querySelector('tbody').innerHTML = [
    ['Composition', fabric.composition], ['Construction', fabric.construction],
    ['Weight', `${fabric.gsm} g/m²${product.gsm ? '' : ' (not on the page; default)'}`], ['Garment chest', `${garmentChest} cm (size top ${size.ranges.chest[1]} + ${EASE_CM} ease)`],
    ['Stretch', `${Math.round(fp.stretchStiffness)} N/m`], ['Bend', `${fp.bendStiffness.toExponential(0)} N·m`],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
  return rows;
}

$('read').addEventListener('click', async () => {
  if ($('read').hasAttribute('aria-busy')) return; // a read is running: an auto re-read and a press can overlap
  try {
    status('Reading the page…', 'busy');
    $('read').setAttribute('aria-busy', 'true');
    product = await readProduct();
    $('product').textContent = product.name || 'Unnamed product';
    const swatch = product.color && cssColour(product.color);
    $('swatch').hidden = !swatch;
    if (swatch) $('swatch').style.background = swatch;
    $('meta-text').textContent = [product.color, product.material, product.gsm && `${product.gsm} gsm`, product.construction].filter(Boolean).join(' · ') || 'No colour or fabric details on this page';
    chart = null;
    for (const md of product.tables) {
      try {
        const c = parseSizeChart(md, { brand: new URL(product.url || location.href).hostname, garment: 'tops' });
        if (c.sizes.some((s) => s.ranges.chest)) { chart = c; break; }
      } catch { /* not a size chart */ }
    }
    if (!chart) {
      showFit(false, 'No size chart on this page', 'The try-on needs a size chart with body measurements and a chest row. It works with tops only for now. If the shop hides its size guide in a pop-up, open it first, then press Read page again.');
      status('No size chart found on this page.', 'bad');
      return;
    }
    renderSizes();
    showFit(true);
    equip(applySize());
    document.querySelector('#chips .chip.rec')?.classList.add('pulse');
    status('');
  } catch (e) {
    status(`Could not read this page: ${e.message}`, 'bad');
  } finally {
    $('read').removeAttribute('aria-busy');
  }
});

// A colour picked on the shop moves the tab to another address (H&M loads a new page for each colour): read the page
// again by itself once it has loaded. Only after a page was read, and only on the same site. changeInfo.url needs no
// "tabs" permission once the site is allowed.
if (inExtension) {
  let moved = false, again;
  chrome.tabs.onUpdated.addListener((_id, change, tab) => {
    if (change.url && tab.active && product?.url && new URL(change.url).origin === new URL(product.url).origin) moved = true;
    if (!moved || (change.status === 'loading') || !(change.status === 'complete' || change.url)) return;
    moved = false; // a page that changes its address without a reload (pushState) has no "loading" event: read it now
    clearTimeout(again);
    again = setTimeout(() => $('read').click(), 500);
  });
}

// The Fit tab shows the size verdict and table, or an empty state that says why there is none.
function showFit(on, title, text) {
  $('sizes').hidden = $('fit-section').hidden = !on;
  $('fit-empty').hidden = on;
  if (!on) { $('fit-empty-title').textContent = title; $('fit-empty-text').textContent = text; }
}
$('chips').addEventListener('change', () => equip(applySize()));
$('go-me').addEventListener('click', () => selectTab($('tab-me'), true));

// Motion and view buttons: one pressed button per group.
const press = (group, b) => group.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', x === b));
const pressGroup = (group, key, apply) => group.addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  press(group, b);
  apply(b.dataset[key]);
});
pressGroup($('motion'), 'motion', (m) => { mode = m; tryon?.setMode(m); });
pressGroup($('views'), 'view', (v) => { view = v; tryon?.view(v); });

// --- the equip moment: a short reward when the shopper puts a size on (Read page or a size chip), never on a rebuild ---
// Effects: the card animation, the sparkles, the rim light and the avatar's try-on sequence. Off by default for reduced motion.
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
let fx = !reduce.matches;
try { const v = localStorage.getItem('tryon-fx'); if (v !== null) fx = v === '1'; } catch { /* storage blocked: use the default */ }
let cardTimer = 0, rimTimer = 0;
function setFx(on) {
  fx = on;
  $('fx').setAttribute('aria-checked', on);
  document.documentElement.classList.toggle('fx-off', !on);
  if (!on) { clearTimeout(rimTimer); tryon?.setRim?.(false); tryon?.setMode(mode); } // setMode also ends a try-on sequence in progress
}
setFx(fx);
$('fx').addEventListener('click', () => {
  setFx(!fx);
  try { localStorage.setItem('tryon-fx', fx ? '1' : '0'); } catch { /* not saved: still used for this session */ }
});

// Fit tier from the fit report rows: all good, any tight, or in between.
const TIERS = { perfect: ['Perfect fit', 'good'], good: ['Good fit', ''], tight: ['Tight fit', 'tight'] };
const tierOf = (rows) => (rows.some((r) => r.status === 'tight') ? 'tight' : rows.every((r) => r.status === 'good') ? 'perfect' : 'good');

function hideCard() {
  clearTimeout(cardTimer);
  const card = $('equip-live').firstElementChild;
  if (!card) return;
  if (!fx) return card.remove();
  card.classList.add('out');
  setTimeout(() => card.remove(), 200);
}
function showCard(rows) {
  clearTimeout(cardTimer);
  $('equip-live').replaceChildren();
  const [label, tone] = TIERS[tierOf(rows)];
  const card = document.createElement('div');
  card.className = `equip glass ${tone}`;
  card.innerHTML = '<span class="equip-mark" aria-hidden="true"><svg class="i"><use href="#ic-check"/></svg></span><span class="equip-text"><strong>Outfit equipped</strong><span class="equip-sub"></span></span><span class="tier"></span>';
  card.querySelector('.equip-sub').textContent = `Size ${sizeChoice()} · ${product.name || 'This top'}`; // page text: never innerHTML
  card.querySelector('.tier').textContent = label;
  card.addEventListener('click', hideCard);
  $('equip-live').append(card);
  cardTimer = setTimeout(hideCard, 1600); // plus the 200 ms exit: about 1.8 s on screen
}
addEventListener('keydown', (e) => { if (e.key === 'Escape') hideCard(); });

// About 20 sparkles in the accent and shirt colours, drawn under the avatar for 1.2 s, then the canvas goes.
function sparkle(shirt) {
  const view = $('view'), r = view.getBoundingClientRect(), dpr = devicePixelRatio || 1, c = document.createElement('canvas');
  if (!r.width || !r.height) return;
  c.className = 'burst';
  c.width = r.width * dpr; c.height = r.height * dpr;
  view.before(c);
  const g = c.getContext('2d'), cols = [getComputedStyle(document.documentElement).getPropertyValue('--good').trim(), shirt];
  g.scale(dpr, dpr);
  const ox = r.width / 2, oy = r.height * 0.42, T = 1.2;
  const ps = Array.from({ length: 20 }, (_, i) => {
    const a = (i / 20) * Math.PI * 2 + Math.random() * 0.3, v = 110 + Math.random() * 110;
    return { vx: Math.cos(a) * v, vy: Math.sin(a) * v - 70, s: 4 + Math.random() * 5, c: cols[i % 2], rot: Math.random() * 3 };
  });
  const t0 = performance.now();
  const frame = (now) => {
    const t = (now - t0) / 1000;
    if (t > T || !c.isConnected) return c.remove();
    g.clearRect(0, 0, r.width, r.height);
    const k = 1 - Math.exp(-3 * t); // drag: fast out, then drifting
    for (const p of ps) {
      const x = ox + (p.vx * k) / 3, y = oy + (p.vy * k) / 3 + 60 * t * t, s = p.s * (1 - (t / T) ** 2);
      g.globalAlpha = Math.min(1, 4 * (1 - t / T));
      g.fillStyle = p.c;
      g.save(); g.translate(x, y); g.rotate(p.rot + t * 4);
      g.beginPath(); // a four-point star
      for (let j = 0; j < 8; j++) { const rr = j % 2 ? s * 0.35 : s, aa = (j * Math.PI) / 4; g.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr); }
      g.fill(); g.restore();
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

function equip(rows) {
  showCard(rows);
  if (!fx || !tryon) return;
  mode = 'idle';
  press($('motion'), $('motion').querySelector('[data-motion=idle]'));
  tryon.setMode('idle');
  const ms = tryon.celebrate?.({ calm: reduce.matches }) || 1800;
  tryon.setRim?.(true);
  clearTimeout(rimTimer);
  rimTimer = setTimeout(() => tryon?.setRim?.(false), ms);
  if (!reduce.matches) sparkle(cssColour(product.color) ?? '#7d8794');
}

// --- tabs (arrow keys move between them) ---
const tabs = [...document.querySelectorAll('[role=tab]')];
function selectTab(t, focus = false) {
  tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; $(x.getAttribute('aria-controls')).hidden = !on; });
  $('panes').scrollTop = 0; // each tab starts at its top
  if (focus) t.focus();
}
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', (e) => {
    const d = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (d) selectTab(tabs[(i + d + tabs.length) % tabs.length], true);
  });
});

// --- bottom sheet: snaps to peek or full; drag the grabber, or click it to toggle ---
const sheet = $('sheet'), grab = $('grab');
const SNAP = () => ({ peek: Math.round(Math.min(380, Math.max(300, innerHeight * 0.44))), full: innerHeight - 76 });
let sheetH = 0, drag = null, full = false;
function setH(h) { sheetH = h; sheet.style.height = `${h}px`; }
function snapTo(toFull) {
  const s = SNAP();
  full = toFull;
  document.documentElement.style.setProperty('--peek', `${s.peek}px`);
  setH(full ? s.full : s.peek);
  grab.setAttribute('aria-expanded', full);
  $('grab-label').textContent = full ? 'Collapse panel' : 'Expand panel';
  for (const c of [$('views'), $('motion'), $('fx'), $('view')]) c.inert = full; // covered by the sheet
}
grab.addEventListener('pointerdown', (e) => { drag = { y: e.clientY, h: sheetH, moved: false }; grab.setPointerCapture(e.pointerId); sheet.classList.add('dragging'); });
grab.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dy = drag.y - e.clientY, s = SNAP();
  if (Math.abs(dy) > 4) drag.moved = true;
  setH(Math.max(s.peek - 60, Math.min(s.full, drag.h + dy)));
});
grab.addEventListener('pointerup', () => {
  if (!drag) return;
  sheet.classList.remove('dragging');
  if (drag.moved) { const s = SNAP(); snapTo(Math.abs(s.full - sheetH) < Math.abs(s.peek - sheetH)); }
  setTimeout(() => (drag = null));
});
grab.addEventListener('click', () => { if (!drag?.moved) snapTo(!full); });
addEventListener('resize', () => snapTo(full));
snapTo(false);

const form = $('me'), fields = [...form.querySelectorAll('input')], sexField = form.elements.sex;
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const m = { ...Object.fromEntries(fields.filter((f) => f.value !== '').map((f) => [f.name, +f.value])), sex: sexField.value };
  const errors = validate(m);
  $('errors').textContent = errors.join('. ');
  if (errors.length) return;
  me = m;
  await store.set(me);
  // New measurements can change the recommendation. Follow it, unless the shopper had picked another size.
  if (chart) renderSizes(sizeChoice() === rec?.label ? null : sizeChoice());
  await buildAvatar();
});

// --- face photos: camera capture (capture.html) or three files, analysed with the same MediaPipe code as twin-spike ---
let analysis = null, storedKey = null, picked = [null, null, null], job = Promise.resolve();
const enqueue = (fn) => (job = job.then(fn, fn));
const photoStatus = (t, bad = false) => { $('photo-status').textContent = t; $('photo-status').className = bad ? 'note bad' : 'note'; };
const MODEL_URL = (p) => new URL(`./vendor/mediapipe/${p}`, import.meta.url).href;
let modelsP = null;

// The models (about 20 MB, bundled in the extension) load only when photos exist.
function loadModels() {
  return (modelsP ??= (async () => {
    analysis = await import('./lib/twin-spike/analyse.js');
    return analysis.loadFaceModels({ wasm: MODEL_URL('wasm'), faceModel: MODEL_URL('face_landmarker.task'), segModel: MODEL_URL('selfie_multiclass_256x256.tflite') });
  })().catch((e) => { modelsP = null; throw e; }));
}

function showThumbs(urls) {
  for (let i = 0; i < 3; i++) {
    const t = $(`img${i}`);
    t.style.backgroundImage = urls?.[i] ? `url(${urls[i]})` : '';
    t.classList.toggle('filled', !!urls?.[i]);
  }
  $('remove-photos').disabled = !urls;
}

function showFace() {
  const table = $('face-table');
  table.hidden = !face;
  if (!face) return;
  const { hair, skin } = face, hex = rgb2hex(skin);
  const rows = [
    ['Hair length', hair.length ?? 'Not found'],
    ['Hair colour', hair.hex ? `<span class="swatch" style="background:${hair.hex}"></span>${hair.colour.name} · ${hair.hex}` : 'None found'],
    ['Skin', `<span class="swatch" style="background:${hex}"></span>${hex}`],
  ];
  table.querySelector('tbody').innerHTML = rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('');
}

// Decode the stored photos, run the analysis and set `face`. No photos: face is null and nothing loads.
async function applyStoredPhotos(urls) {
  storedKey = JSON.stringify(urls ?? null);
  photos = face = null;
  showThumbs(urls);
  if (urls?.length === 3) {
    try {
      photoStatus('Reading your photos…');
      const m = await loadModels();
      photos = await Promise.all(urls.map(async (u) => { const img = new Image(); img.src = u; await img.decode(); return analysis.toCanvas(img); }));
      await new Promise((r) => setTimeout(r, 30)); // let the status paint before the heavy step
      const out = analysis.analyseViews(m, photos);
      if (out.ok) { face = { ...out, photos, landmarker: m.landmarker }; photoStatus('Photos analysed. Everything ran in this browser.'); $('photo-status').className = 'note ok'; }
      else photoStatus(`No face found in: ${out.missing.join(', ')}. Retake with the face fully in view.`, true);
    } catch (e) { photoStatus(`Could not analyse the photos: ${e.message}`, true); }
  } else photoStatus('');
  showFace();
}

$('camera').addEventListener('click', () => {
  const url = inExtension ? chrome.runtime.getURL('capture.html') : new URL('capture.html', location).href;
  if (inExtension) chrome.tabs.create({ url }); else window.open(url, '_blank');
});
document.querySelectorAll('input[type=file]').forEach((inp) => inp.addEventListener('change', async () => {
  const f = inp.files[0], i = +inp.dataset.slot;
  if (!f) return;
  try {
    await loadModels(); // also loads toCanvas
    picked[i] = analysis.toCanvas(await createImageBitmap(f, { imageOrientation: 'from-image' }));
  } catch { photoStatus('Could not read that file. Use a JPEG or PNG photo.', true); return; }
  $(`img${i}`).style.backgroundImage = `url(${picked[i].toDataURL('image/jpeg', 0.5)})`;
  $(`img${i}`).classList.add('filled');
  $('use-photos').disabled = !picked.every(Boolean);
}));
$('use-photos').addEventListener('click', () => enqueue(async () => {
  const urls = picked.map(toDataUrl);
  picked = [null, null, null];
  $('use-photos').disabled = true;
  try { await photoStore.set(urls); } catch (e) { photoStatus(`Could not save the photos: ${e.message}`, true); return; }
  await applyStoredPhotos(urls);
  await buildAvatar();
}));
$('remove-photos').addEventListener('click', () => enqueue(async () => {
  picked = [null, null, null];
  $('use-photos').disabled = true;
  await photoStore.clear();
  await applyStoredPhotos(null);
  await buildAvatar();
}));
// Photos taken by the camera page arrive here.
photoStore.onChange((urls) => enqueue(async () => {
  if (JSON.stringify(urls ?? null) === storedKey) return;
  await applyStoredPhotos(urls);
  await buildAvatar();
}));

me = (await store.get()) ?? DEFAULT;
if (validate(me).length) me = DEFAULT;
me.sex ??= 'male';
for (const f of fields) if (me[f.name] != null) f.value = me[f.name];
sexField.value = me.sex;
await applyStoredPhotos(await photoStore.get());
await buildAvatar();
