// Run: node --test twin-spike/
// Downloads the pinned MakeHuman files (about 3 MB) once into the system temp folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseObj, compact, applyTarget, buildMHBody, ARM_POSE } from './mhavatar.js';
import { measureFitted, sliceLoops, torsoOf } from './mhbody.js';
import { buildShirt, bodyInside } from '../cloth-spike/shirt.js';

const DATA = 'https://cdn.jsdelivr.net/gh/makehumancommunity/makehuman@a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/';
const cache = join(tmpdir(), 'avatar-tryon-mh');
async function get(path) {
  const file = join(cache, path.replaceAll('/', '_'));
  try { return await readFile(file, 'utf8'); } catch { /* not cached yet */ }
  const res = await fetch(DATA + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const text = await res.text();
  await mkdir(cache, { recursive: true });
  await writeFile(file, text);
  return text;
}
// The same load as head.js loadHead(sex), without three.js.
async function loadMH(sex) {
  const { v, groups } = parseObj(await get('3dobjs/base.obj'));
  for (const e of ['african', 'asian', 'caucasian']) applyTarget(v, await get(`targets/macrodetails/${e}-${sex}-young.target`), 1 / 3);
  applyTarget(v, await get(`targets/macrodetails/universal-${sex}-young-averagemuscle-averageweight.target`), 1);
  const body = compact(v, groups.body);
  return { objV: v, body: { pos: body.pos, idx: body.idx, objToBody: body.map } };
}
const rig = { skel: JSON.parse(await get('rigs/default.mhskel')), weights: JSON.parse(await get('rigs/default_weights.mhw')).weights };

const PROFILES = {
  'average man': [{ height: 178, chest: 100, waist: 86, hip: 100, shoulder: 46 }, 'male'],
  'average woman': [{ height: 163, chest: 92, waist: 74, hip: 100, shoulder: 39 }, 'female'],
  // The user: 175 cm and male, the rest set to an average 25-year-old man (the average man scaled to 175 cm).
  'user, 175 cm man': [{ height: 175, chest: 98, waist: 84, hip: 98, shoulder: 45 }, 'male'],
};

for (const [name, [input, sex]] of Object.entries(PROFILES)) {
  const body = buildMHBody(input, await loadMH(sex), rig, { armPose: ARM_POSE });
  const B = Object.fromEntries(body.bones.map((b) => [b.name, b.pos]));

  test(`${name}: the arms hang within a degree of ARM_POSE, hands below the elbows`, () => {
    const deg = (a, b) => (Math.atan2(Math.abs(b[0] - a[0]), a[1] - b[1]) * 180) / Math.PI;
    for (const s of ['L', 'R']) {
      assert.ok(Math.abs(deg(B[`upperArm${s}`], B[`foreArm${s}`]) - ARM_POSE.upper) < 1, `upper arm ${s}`);
      assert.ok(Math.abs(deg(B[`foreArm${s}`], B[`hand${s}`]) - ARM_POSE.fore) < 1.5, `forearm ${s}`);
      assert.ok(B[`hand${s}`][1] < B[`foreArm${s}`][1], `hand below elbow ${s}`);
    }
  });

  test(`${name}: the tape on the rigged MakeHuman body reads the inputs within 1.5 cm`, () => {
    const got = measureFitted(body.positions, body.indices, body.landmarks);
    for (const k of ['height', 'chest', 'waist', 'hip', 'shoulder']) {
      assert.ok(Math.abs(got[k] * 100 - input[k]) <= 1.5, `${k}: tape ${(got[k] * 100).toFixed(1)} cm, input ${input[k]} cm`);
    }
  });

  test(`${name}: skeleton is in place and every vertex is fully weighted`, () => {
    assert.ok(B.upperArmL[0] > 0.1 && B.upperArmR[0] < -0.1, 'left arm on +x');
    assert.ok(B.thighL[0] > 0 && B.thighR[0] < 0, 'left leg on +x');
    assert.ok(B.footL[1] < B.shinL[1] && B.shinL[1] < B.thighL[1] && B.thighL[1] < B.chest[1] && B.chest[1] < B.head[1], 'joint heights in order');
    for (let i = 0; i < body.skinWeight.length; i += 4) {
      const s = body.skinWeight[i] + body.skinWeight[i + 1] + body.skinWeight[i + 2] + body.skinWeight[i + 3];
      assert.ok(Math.abs(s - 1) < 1e-4, `vertex ${i / 4} weights sum to ${s}`);
    }
    assert.ok(body.parts.armL.count > 1000 && body.parts.armR.count > 1000, 'arm triangle ranges');
  });

  test(`${name}: every torso ring contains the axis and has 48 points`, () => {
    assert.ok(body.rings.length > 30);
    for (const r of body.rings) {
      assert.equal(r.pts.length, 48);
      assert.ok(r.pts.every(([x, z]) => Math.hypot(x, z) > 0.03), `ring at ${r.y.toFixed(3)} m reaches the axis`);
    }
  });

  const shirt = buildShirt(body, { garmentChest: input.chest + 8 });
  test(`${name}: shirt chest girth matches the garment and no shirt vertex is inside the body at rest`, () => {
    const loop = torsoOf(sliceLoops(Array.from(shirt.positions), Array.from(shirt.indices), body.landmarks.chestY));
    assert.ok(Math.abs(loop.girth * 100 - (input.chest + 8)) < 3, `shirt chest ${(loop.girth * 100).toFixed(1)} cm`);
    const inside = bodyInside(body), P = shirt.positions;
    let n = 0;
    for (let i = 0; i < P.length; i += 3) if (inside(P[i], P[i + 1], P[i + 2])) n++;
    assert.equal(n, 0, `${n} shirt vertices inside the body`);
  });
  // The shirt used to hang as a tube from the chest: 24 cm of ease at the waist against 8 at the chest.
  test(`${name}: shirt follows the waist instead of hanging as a box`, () => {
    const loop = torsoOf(sliceLoops(Array.from(shirt.positions), Array.from(shirt.indices), body.landmarks.waistY));
    const ease = loop.girth * 100 - input.waist;
    assert.ok(ease > 4 && ease < 15, `waist ease ${ease.toFixed(1)} cm`);
  });
}
