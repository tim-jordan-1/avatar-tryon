// Try-on viewer: the measured avatar (the rigged MakeHuman body from twin-spike/mhavatar.js, optionally with the
// photo face) in a three.js scene, wearing one t-shirt simulated as a JoltPhysics.js soft body.
// Used by the cloth-spike page and by the Chrome extension's side panel.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import initJolt from 'https://cdn.jsdelivr.net/npm/jolt-physics@1.1.0/dist/jolt-physics.wasm.js';
import { loadRig, buildMHBody, ARM_POSE } from '../twin-spike/mhavatar.js';
import { loadHead, correspond, buildTwin, eyeMesh } from '../twin-spike/head.js';
import { animate as animateRig, TRYON_SECONDS } from '../avatar-poc/anim.js';
import { fabricParams } from './fabric.js';
import { buildShirt, bodyTester, bodyInside, torsoRings, openEdges } from './shirt.js';

const LAYER_COLLIDER = 0, LAYER_CLOTH = 1;
const NECK_DRIFT = 0.002, THICKNESS = 0.003; // metres
const DT = 1 / 60; // fixed physics step
let joltModule = null;

// host: an element to fill. measurements: avatar-poc inputs in cm. sex: 'male' | 'female' (MakeHuman shape).
// face: optional result of twin-spike/analyse.js analyseViews() plus { photos: [3 canvases], landmarker }.
export async function createTryOn(host, { measurements, sex = 'male', face = null, skin = '#c68e6a' }) {
  joltModule ??= initJolt();
  const [Jolt, head, mhRig] = await Promise.all([joltModule, loadHead(sex), loadRig()]);

  // --- scene (same look as avatar-poc) ---
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 50);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  scene.add(new THREE.HemisphereLight(0xffffff, 0x8a7f72, 1.4));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1.5, 3, 2.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.2 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 1.0);
  rim.position.set(-2, 2, -2.5);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.ShadowMaterial({ opacity: 0.25 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const resize = () => {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // --- avatar ---
  const body = buildMHBody(measurements, head, mhRig, { armPose: ARM_POSE });
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(body.positions, 3));
  bodyGeo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(body.skinIndex, 4));
  bodyGeo.setAttribute('skinWeight', new THREE.BufferAttribute(body.skinWeight, 4));
  bodyGeo.setIndex(new THREE.BufferAttribute(body.indices, 1));
  bodyGeo.computeVertexNormals();
  // Plain grey briefs: the MakeHuman body is anatomically complete. By position: hips to upper thigh. The hands now hang
  // in that band, so vertices skinned mostly to an arm bone (found again by position in the twin) stay skin.
  const H = body.measurements.height / 100, BRIEFS = new THREE.Color('#4a4d52'), skinColour = new THREE.Color(skin);
  const isArmBone = body.bones.map((b) => /^(upperArm|foreArm|hand)/.test(b.name)), armKeys = new Set();
  for (let i = 0; i < body.positions.length / 3; i++) {
    let w = 0;
    for (let k = 0; k < 4; k++) if (isArmBone[body.skinIndex[i * 4 + k]]) w += body.skinWeight[i * 4 + k];
    if (w > 0.5) armKeys.add(body.positions.subarray(i * 3, i * 3 + 3).join());
  }
  const inBriefs = (p) => p[1] > body.landmarks.crotchY - 0.06 * H && p[1] < body.landmarks.crotchY + 0.08 * H && Math.abs(p[0]) < 0.17 * H && !armKeys.has(`${p[0]},${p[1]},${p[2]}`);
  const colours = new Float32Array(body.positions.length);
  for (let i = 0; i < colours.length; i += 3) (inBriefs(body.positions.subarray(i, i + 3)) ? BRIEFS : skinColour).toArray(colours, i);
  bodyGeo.setAttribute('color', new THREE.BufferAttribute(colours, 3));
  const byName = Object.fromEntries(body.bones.map((b, i) => [b.name, i]));
  const bonePos = (name) => new THREE.Vector3().fromArray(body.bones[byName[name]].pos);
  const bones = body.bones.map((b) => Object.assign(new THREE.Bone(), { name: b.name }));
  body.bones.forEach((b, i) => {
    const parent = b.parent === -1 ? null : body.bones[byName[b.parent]];
    bones[i].position.fromArray(b.pos.map((v, k) => v - (parent ? parent.pos[k] : 0)));
    if (parent) bones[byName[b.parent]].add(bones[i]);
  });
  const avatar = new THREE.SkinnedMesh(bodyGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }));
  avatar.castShadow = true;
  avatar.frustumCulled = false;
  avatar.add(bones[0]);
  avatar.bind(new THREE.Skeleton(bones));
  scene.add(avatar);
  const rig = Object.fromEntries(bones.map((b) => [b.name, b]));
  // A body vertex keeps its posed place (the arms hang); a head vertex has no arm weight and takes the fit alone.
  const toBodyFrame = (p, vi) => (vi === undefined ? body.place(body.deform(p)) : [...body.positions.subarray(vi * 3, vi * 3 + 3)]), headPos = bonePos('head');
  // Children of the head bone are placed relative to its bind position.
  const onHead = (mesh) => { mesh.position.set(-headPos.x, -headPos.y, -headPos.z); mesh.castShadow = true; rig.head.add(mesh); };
  if (face) {
    // Photo twin: the head textured from the photos and the body in the measured skin tone, skinned with the body's
    // weights. The plain body stays as the hidden reference the cloth tests read.
    const twin = buildTwin({ head, corr: correspond(head, face.landmarker), res: face.res, fused: face.fused, skinHex: skin,
      mmPerPx: face.mmPerPx, photos: face.photos, deform: toBodyFrame,
      tint: (p) => (inBriefs(p) ? [0, 1, 2].map((k) => BRIEFS.toArray()[k] / Math.max(0.01, skinColour.toArray()[k])) : null) });
    const [skinMesh, ...eyes] = twin.group.children, g = skinMesh.geometry, n = twin.bodyIndex.length;
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    twin.bodyIndex.forEach((b, i) => { si.set(body.skinIndex.subarray(b * 4, b * 4 + 4), i * 4); sw.set(body.skinWeight.subarray(b * 4, b * 4 + 4), i * 4); });
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    const twinMesh = new THREE.SkinnedMesh(g, skinMesh.material);
    twinMesh.castShadow = true;
    twinMesh.frustumCulled = false;
    avatar.add(twinMesh);
    twinMesh.bind(avatar.skeleton, avatar.bindMatrix);
    avatar.material.visible = false;
    eyes.forEach(onHead);
  } else {
    for (const e of head.eyes) {
      const p = [];
      for (let i = 0; i < e.pos.length; i += 3) p.push(...toBodyFrame([e.pos[i], e.pos[i + 1], e.pos[i + 2]]));
      onHead(eyeMesh(p, e.idx));
    }
  }
  const bindHipsY = bones[0].position.y;
  const VIEWS = { front: [0, 0.68, 1.9], side: [1.9, 0.68, 0], back: [0, 0.68, -1.9], three: [1.3, 0.75, 1.5] };
  const view = (name) => { camera.position.fromArray(VIEWS[name].map((v) => v * H)); controls.target.set(0, 0.66 * H, 0); };
  view('three');
  let mode = 'idle', clock = 0, t0 = 0; // t0: when the try-on sequence started
  const isTryon = (m) => m === 'tryon' || m === 'tryonCalm';
  const animate = (t) => { animateRig(rig, avatar, bindHipsY, t, mode, t0); avatar.updateMatrixWorld(true); };

  // --- Jolt world ---
  const settings = new Jolt.JoltSettings();
  const objectFilter = new Jolt.ObjectLayerPairFilterTable(2);
  objectFilter.EnableCollision(LAYER_COLLIDER, LAYER_CLOTH);
  const bpInterface = new Jolt.BroadPhaseLayerInterfaceTable(2, 2);
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_COLLIDER, new Jolt.BroadPhaseLayer(0));
  bpInterface.MapObjectToBroadPhaseLayer(LAYER_CLOTH, new Jolt.BroadPhaseLayer(1));
  settings.mObjectLayerPairFilter = objectFilter;
  settings.mBroadPhaseLayerInterface = bpInterface;
  settings.mObjectVsBroadPhaseLayerFilter = new Jolt.ObjectVsBroadPhaseLayerFilterTable(bpInterface, 2, objectFilter, 2);
  const jolt = new Jolt.JoltInterface(settings);
  Jolt.destroy(settings);
  const bodyInterface = jolt.GetPhysicsSystem().GetBodyInterface();
  const tmpR = new Jolt.RVec3(), tmpQ = new Jolt.Quat();

  // Kinematic colliders that follow the bones: convex hulls of the torso rings, capsules on the arms,
  // a sphere on each deltoid, a capsule on the neck. Shapes are in bone space; `offset` places them on the bone.
  const colliders = [];
  const addCollider = (boneName, shape, offset = new THREE.Matrix4()) => {
    const cs = new Jolt.BodyCreationSettings(shape, new Jolt.RVec3(0, 0, 0), new Jolt.Quat(0, 0, 0, 1), Jolt.EMotionType_Kinematic, LAYER_COLLIDER);
    const b = bodyInterface.CreateBody(cs);
    Jolt.destroy(cs);
    bodyInterface.AddBody(b.GetID(), Jolt.EActivation_Activate);
    colliders.push({ id: b.GetID(), bone: rig[boneName], offset });
  };
  {
    // Convex hulls over the torso rings between landmarks, on the skin (smaller colliders let cloth settle inside).
    // The shoulder ring is left out of the top hull: it is the full shoulder width, wider than the body under the arm.
    const rings = torsoRings(body), L = body.landmarks, eps = 1e-6;
    const between = (y0, y1, skip = []) => rings.filter((r) => r.y >= y0 - eps && r.y <= y1 + eps && !skip.some((y) => Math.abs(r.y - y) < eps));
    // A convex hull bridges any hollow. Over the 24 cm from the armpit to the neck, the hull stood 4 to 6 cm in front
    // of the collarbone hollow and 2 cm behind the curve of the nape, and the cloth rested on it: an invisible wall.
    // So the top hull drops its front points above `cutF` and its back points above `cutB` (within `arc` of the
    // centre line), and thin plates of the front and back arcs follow the hollows instead (a plate is `plateH` tall
    // and has some depth, so the hull has volume). The sides and shoulders keep the full hull, which also guards
    // the shoulder when the arms rise.
    const cutF = L.armpitY + 0.07, cutB = L.shoulderY - 0.01, arc = 0.1;
    const upper = between(L.armpitY, L.neckY, [L.shoulderY]);
    const arcPts = (r, sign) => r.pts.filter(([x, z]) => z * sign > 0 && Math.abs(x) < arc);
    const plateRings = (from, plateH) => {
      const out = [];
      for (let i = upper.findIndex((r) => r.y >= from); i >= 0 && i < upper.length - 1;) {
        let j = i + 1;
        while (j < upper.length - 1 && upper[j + 1].y - upper[i].y <= plateH) j++;
        out.push(upper.slice(i, j + 1));
        i = j;
      }
      return out;
    };
    const plate = (sign) => (r) => arcPts(r, sign).flatMap(([x, z]) => [[x, z], [x, z - sign * 0.03]]);
    const dropArcs = (r) => (r.pts.filter((p) => !(r.y > cutF && arcPts(r, 1).includes(p)) && !(r.y > cutB && arcPts(r, -1).includes(p))));
    const segments = [['hips', between(L.crotchY, L.waistY)], ['spine', between(L.waistY, L.chestY)], ['chest', between(L.chestY, L.armpitY)],
      ['chest', upper, dropArcs],
      ...plateRings(cutF, 0.055).map((rs) => ['chest', rs, plate(1)]),
      ...plateRings(cutB, 0.055).map((rs) => ['chest', rs, plate(-1)])];
    for (const seg of segments) {
      const [boneName, rs, pick = (r) => r.pts] = seg;
      const hs = new Jolt.ConvexHullShapeSettings(), o = bonePos(boneName);
      // Every second ring point for the hips and waist hulls (a 24-gon is within 1.4 mm of the ring): each point costs step time.
      const step2 = segments.indexOf(seg) < 2 ? 2 : 1;
      for (const r of rs) pick(r).forEach(([x, z], k) => { if (k % step2 === 0) hs.mPoints.push_back(new Jolt.Vec3(x - o.x, r.y - o.y, z - o.z)); });
      hs.mMaxConvexRadius = 0.01;
      addCollider(boneName, hs.Create().Get());
    }
    const m = body.measurements;
    const capsule = (boneName, toName, radius) => {
      const a = bonePos(boneName), b = bonePos(toName), d = b.clone().sub(a), len = d.length();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      addCollider(boneName, new Jolt.CapsuleShape(len / 2, radius), new THREE.Matrix4().compose(d.multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
    };
    for (const s of ['L', 'R']) {
      capsule(`upperArm${s}`, `foreArm${s}`, (m.upperArm / 100 / (2 * Math.PI)) * 1.05); // the arm tube is 1.1x girth at the top
      capsule(`foreArm${s}`, `hand${s}`, (m.forearm / 100 / (2 * Math.PI)) * 1.0);
      // Deltoid cap from body.js: centre on the arm joint x, radius 1.12 * upper arm radius.
      const r = (m.upperArm / 100 / (2 * Math.PI)) * 1.12, j = bonePos(`upperArm${s}`);
      addCollider(`upperArm${s}`, new Jolt.SphereShape(r), new THREE.Matrix4().makeTranslation(0, body.landmarks.shoulderY - r * 0.95 - j.y, 0));
    }
    const neckR = (m.neck / 100 / (2 * Math.PI)) * 1.0, neckLen = body.landmarks.neckMidY - body.landmarks.neckY;
    addCollider('neck', new Jolt.CapsuleShape(neckLen / 2, neckR), new THREE.Matrix4().makeTranslation(0, body.landmarks.neckY + neckLen / 2 - bonePos('neck').y, 0));
  }
  const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3();
  const moveColliders = (dt, teleport) => {
    for (const c of colliders) {
      _m.multiplyMatrices(c.bone.matrixWorld, c.offset).decompose(_p, _q, _s);
      tmpR.Set(_p.x, _p.y, _p.z);
      tmpQ.Set(_q.x, _q.y, _q.z, _q.w);
      if (teleport) bodyInterface.SetPositionAndRotation(c.id, tmpR, tmpQ, Jolt.EActivation_Activate);
      else bodyInterface.MoveKinematic(c.id, tmpR, tmpQ, dt);
    }
  };

  // --- the shirt as a Jolt soft body ---
  const jointMats = new Jolt.ArrayMat44();
  jointMats.resize(bones.length);
  const writeJointMatrices = () => {
    // Jolt Mat44 and three.js Matrix4 are both 16 floats, column-major. The soft body sits at the origin.
    const base = Jolt.getPointer(jointMats.data()) >> 2;
    bones.forEach((b, i) => Jolt.HEAPF32.set(b.matrixWorld.elements, base + i * 16));
  };
  let cloth = null;
  // The physics mesh is one layer. It is drawn as a thin shell: an outer face and a darker inner face, THICKNESS apart,
  // and a rim along the hem, the sleeve ends and the neck, so the cut edges show a fabric thickness.
  const outerMat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
  const innerMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  const rimMat = new THREE.MeshStandardMaterial({ roughness: 1, side: THREE.DoubleSide });

  // fabric: { composition, gsm, construction }; garmentChest in cm; color: any CSS colour. Returns the fabric parameters.
  function setGarment({ fabric, garmentChest, color = '#5b7fa6' }) {
    if (cloth) {
      bodyInterface.RemoveBody(cloth.body.GetID());
      bodyInterface.DestroyBody(cloth.body.GetID());
      scene.remove(cloth.mesh);
      cloth.mesh.children.forEach((m) => m.geometry.dispose());
    }
    const fp = fabricParams(fabric);
    const shirt = buildShirt(body, { garmentChest });
    const nv = shirt.positions.length / 3, P = shirt.positions, I = shirt.indices;

    // Vertex mass = mass per area x one third of the area of the triangles around it.
    const area = new Float32Array(nv);
    for (let t3 = 0; t3 < I.length; t3 += 3) {
      const [a, b, c] = [I[t3], I[t3 + 1], I[t3 + 2]].map((i) => new THREE.Vector3().fromArray(P, i * 3));
      const A = b.clone().sub(a).cross(c.clone().sub(a)).length() / 2;
      for (const i of [I[t3], I[t3 + 1], I[t3 + 2]]) area[i] += A / 3;
    }
    const ss = new Jolt.SoftBodySharedSettings();
    const v = new Jolt.SoftBodySharedSettingsVertex();
    for (let i = 0; i < nv; i++) {
      v.mPosition.x = P[i * 3]; v.mPosition.y = P[i * 3 + 1]; v.mPosition.z = P[i * 3 + 2];
      v.mInvMass = 1 / (fp.massPerArea * area[i]);
      ss.mVertices.push_back(v);
    }
    Jolt.destroy(v);
    const f = new Jolt.SoftBodySharedSettingsFace(0, 0, 0, 0);
    for (let t3 = 0; t3 < I.length; t3 += 3) {
      f.set_mVertex(0, I[t3]); f.set_mVertex(1, I[t3 + 1]); f.set_mVertex(2, I[t3 + 2]);
      ss.AddFace(f);
    }
    Jolt.destroy(f);
    const va = new Jolt.SoftBodySharedSettingsVertexAttributes();
    va.mCompliance = fp.stretchCompliance;
    va.mShearCompliance = fp.shearCompliance;
    va.mBendCompliance = fp.bendCompliance;
    va.mLRAType = Jolt.SoftBodySharedSettings_ELRAType_GeodesicDistance;
    va.mLRAMaxDistanceMultiplier = fp.maxStretch;
    ss.CreateConstraints(va, 1, Jolt.SoftBodySharedSettings_EBendType_Dihedral);
    Jolt.destroy(va);

    // Skinned constraints: every vertex follows its skinned rest position and may drift up to maxDistance (more
    // towards the hem). A back stop keeps it from going deeper than the body surface along the skinned normal.
    const invBinds = ss.mInvBindMatrices;
    invBinds.resize(bones.length);
    body.bones.forEach((b, i) => {
      const ib = invBinds.at(i);
      ib.mJointIndex = i;
      ib.set_mInvBind(Jolt.Mat44.prototype.sTranslation(new Jolt.Vec3(-b.pos[0], -b.pos[1], -b.pos[2])));
    });
    const skinned = ss.mSkinnedConstraints;
    skinned.resize(nv);
    for (let i = 0; i < nv; i++) {
      const s = skinned.at(i);
      s.mVertex = i;
      for (let k = 0; k < 4; k++) {
        const w = s.get_mWeights(k);
        w.mInvBindIndex = shirt.skinIndex[i * 4 + k];
        w.mWeight = shirt.skinWeight[i * 4 + k];
        s.set_mWeights(k, w);
      }
      // The neckline follows the neck base within 2 mm: it is no longer a rigid ring, and a collar that rides on the
      // neck still cannot float off it. Elsewhere 1 cm at the shoulder to 4 cm at the hem, times the fabric's drift: enough
      // to swing, too little to sag out of the fitted shape.
      s.mMaxDistance = shirt.pinned[i] === 1 ? NECK_DRIFT : fp.drift * Math.min(0.04, 0.01 + 0.08 * Math.max(0, shirt.seamY - P[i * 3 + 1]));
      s.mBackStopDistance = shirt.gap[i]; // no 4 mm cut: with the arms hanging it pinched the underarm cloth between arm and torso
      s.mBackStopRadius = 0.5;
    }
    ss.CalculateSkinnedConstraintNormals();
    ss.Optimize();

    const cs = new Jolt.SoftBodyCreationSettings(ss, new Jolt.RVec3(0, 0, 0), Jolt.Quat.prototype.sIdentity(), LAYER_CLOTH);
    cs.mUpdatePosition = false;
    cs.mNumIterations = 10;
    cs.mVertexRadius = 0.002; // the cloth rests 2 mm off a collider: a snug wrap
    cs.mFriction = 0.6;
    cs.mLinearDamping = fp.damping;
    cs.mAllowSleeping = false;
    const sb = bodyInterface.CreateSoftBody(cs);
    Jolt.destroy(cs);
    bodyInterface.AddBody(sb.GetID(), Jolt.EActivation_Activate);
    const mp = Jolt.castObject(sb.GetMotionProperties(), Jolt.SoftBodyMotionProperties);

    // Direct view of the simulated vertex positions in wasm memory.
    const verts = mp.GetVertices();
    const vbase = Jolt.getPointer(verts.at(0)), stride = Jolt.getPointer(verts.at(1)) - vbase;
    const off = Jolt.SoftBodyVertexTraits.prototype.mPositionOffset;
    const geo = new THREE.BufferGeometry(); // the physics layer; only its normals are used
    const out = new Float32Array(nv * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
    geo.setIndex(new THREE.BufferAttribute(I, 1));
    const h = THICKNESS / 2, edges = openEdges(I);
    const shellGeo = new THREE.BufferGeometry(), sp = new Float32Array(nv * 6), sn = new Float32Array(nv * 6);
    shellGeo.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    shellGeo.setAttribute('normal', new THREE.BufferAttribute(sn, 3));
    const shellIdx = new Uint32Array(I.length * 2);
    shellIdx.set(I);
    for (let t3 = 0; t3 < I.length; t3 += 3) { // inner face: same triangles on the inner copy, turned to face inwards
      shellIdx[I.length + t3] = I[t3] + nv; shellIdx[I.length + t3 + 1] = I[t3 + 2] + nv; shellIdx[I.length + t3 + 2] = I[t3 + 1] + nv;
    }
    shellGeo.setIndex(new THREE.BufferAttribute(shellIdx, 1));
    shellGeo.addGroup(0, I.length, 0);
    shellGeo.addGroup(I.length, I.length, 1);
    const rimGeo = new THREE.BufferGeometry(), rp = new Float32Array(edges.length * 12), rn = new Float32Array(edges.length * 12);
    rimGeo.setAttribute('position', new THREE.BufferAttribute(rp, 3));
    rimGeo.setAttribute('normal', new THREE.BufferAttribute(rn, 3));
    const rimIdx = new Uint32Array(edges.length * 6);
    edges.forEach((_, e) => rimIdx.set([e * 4, e * 4 + 1, e * 4 + 2, e * 4, e * 4 + 2, e * 4 + 3], e * 6)); // a_out, a_in, b_in, b_out
    rimGeo.setIndex(new THREE.BufferAttribute(rimIdx, 1));
    const read = () => {
      const heap = Jolt.HEAPF32;
      for (let i = 0; i < nv; i++) {
        const a = (vbase + i * stride + off) >> 2;
        out[i * 3] = heap[a]; out[i * 3 + 1] = heap[a + 1]; out[i * 3 + 2] = heap[a + 2];
      }
      geo.attributes.position.needsUpdate = true;
      geo.computeVertexNormals();
      const n = geo.attributes.normal.array;
      for (let i = 0; i < nv * 3; i++) {
        sp[i] = out[i] + n[i] * h; sp[nv * 3 + i] = out[i] - n[i] * h;
        sn[i] = n[i]; sn[nv * 3 + i] = -n[i];
      }
      edges.forEach(([a, b], e) => {
        for (const [k, v, sign] of [[0, a, 1], [1, a, -1], [2, b, -1], [3, b, 1]]) for (let c = 0; c < 3; c++) {
          rp[(e * 4 + k) * 3 + c] = out[v * 3 + c] + n[v * 3 + c] * h * sign;
        }
      });
      shellGeo.attributes.position.needsUpdate = true;
      shellGeo.attributes.normal.needsUpdate = true;
      rimGeo.attributes.position.needsUpdate = true;
      rimGeo.computeVertexNormals(); // the rim quads share no vertices with the faces: flat shading
    };
    const base = new THREE.Color(color);
    outerMat.color.copy(base);
    innerMat.color.copy(base).multiplyScalar(0.62);
    rimMat.color.copy(base).multiplyScalar(0.85);
    const mesh = new THREE.Group();
    const shell = new THREE.Mesh(shellGeo, [outerMat, innerMat]), rim = new THREE.Mesh(rimGeo, rimMat);
    for (const m of [shell, rim]) { m.castShadow = true; m.frustumCulled = false; mesh.add(m); }
    scene.add(mesh);
    const sleeveV = new Uint8Array(nv).fill(1);
    for (let t3 = 0; t3 < shirt.parts.torso.count; t3++) sleeveV[I[t3]] = 0;
    cloth = { body: sb, mp, mesh, shirt, read, nv, out, sleeveV };

    // Start from the current pose with every vertex on its skinned position.
    animate(clock);
    moveColliders(0, true);
    writeJointMatrices();
    mp.SkinVertices(sb.GetCenterOfMassTransform(), jointMats.data(), bones.length, true, jolt.GetTempAllocator());
    read();
    return fp;
  }

  // --- penetration: cloth vertices inside the skinned body, by the exact ray-parity test per body part ---
  const bodyVerts = [...bodyTester(body).used];
  const skinnedPos = new Float32Array(body.positions.length);
  const _v = new THREE.Vector3();
  const countInside = (list = null) => { // list: an array that receives the inside vertex indices
    if (!cloth) return { inside: 0, sleeve: 0 };
    for (const i of bodyVerts) {
      avatar.getVertexPosition(i, _v).applyMatrix4(avatar.matrixWorld);
      skinnedPos[i * 3] = _v.x; skinnedPos[i * 3 + 1] = _v.y; skinnedPos[i * 3 + 2] = _v.z;
    }
    const inside = bodyInside(body, skinnedPos);
    let n = 0, sleeve = 0;
    for (let i = 0; i < cloth.nv; i++) if (inside(cloth.out[i * 3], cloth.out[i * 3 + 1], cloth.out[i * 3 + 2])) { n++; if (cloth.sleeveV[i]) sleeve++; list?.push(i); }
    return { inside: n, sleeve };
  };

  // --- motion: how far each cloth vertex sits from its skinned place, and how fast that offset changes ---
  // The offset is what you see as cloth moving on the body. Mean over the vertices that are free to move.
  let prevOff = null, mAcc = null, hist = [];
  const motionReset = () => { prevOff = null; hist = []; mAcc = { n: 0, disp: 0, speed: 0, slow: 0, ns: 0, series: [], pv: new Float64Array(cloth?.nv ?? 0), pd: new Float64Array(cloth?.nv ?? 0) }; };
  const skinnedRest = (i, out) => { // rest position of vertex i carried by the current bones
    out.set(0, 0, 0);
    for (let k = 0; k < 4; k++) {
      const w = cloth.shirt.skinWeight[i * 4 + k];
      if (!w) continue;
      const bi = cloth.shirt.skinIndex[i * 4 + k], bp = body.bones[bi].pos, P = cloth.shirt.positions;
      _v.set(P[i * 3] - bp[0], P[i * 3 + 1] - bp[1], P[i * 3 + 2] - bp[2]).applyMatrix4(bones[bi].matrixWorld);
      out.addScaledVector(_v, w);
    }
    return out;
  };
  const _o = new THREE.Vector3();
  const motionSample = () => {
    if (!cloth) return;
    const off = new Float32Array(cloth.nv * 3);
    let d = 0, sp = 0, n = 0, sl = 0;
    const old = hist.length === 6 ? hist.shift() : null;
    for (let i = 0; i < cloth.nv; i++) {
      if (cloth.shirt.pinned[i] === 1) continue;
      skinnedRest(i, _o);
      const a = cloth.out[i * 3] - _o.x, b = cloth.out[i * 3 + 1] - _o.y, c = cloth.out[i * 3 + 2] - _o.z;
      off[i * 3] = a; off[i * 3 + 1] = b; off[i * 3 + 2] = c;
      d += Math.hypot(a, b, c);
      if (prevOff) sp += Math.hypot(a - prevOff[i * 3], b - prevOff[i * 3 + 1], c - prevOff[i * 3 + 2]) / DT;
      if (old) { const q = Math.hypot(a - old[i * 3], b - old[i * 3 + 1], c - old[i * 3 + 2]) / (6 * DT); sl += q; mAcc.pv[i] += q; }
      mAcc.pd[i] += Math.hypot(a, b, c);
      n++;
    }
    if (prevOff) { mAcc.n++; mAcc.disp += d / n; mAcc.speed += sp / n; mAcc.series.push(sp / n); }
    if (old) { mAcc.ns++; mAcc.slow += sl / n; }
    hist.push(off);
    prevOff = off;
  };
  // Mean offset from the skinned place (mm), mean speed of that offset (mm/s), and the speed per 0.5 s bin.
  const motionReport = () => {
    const bin = 30, bins = [];
    for (let i = 0; i + bin <= mAcc.series.length; i += bin) bins.push(+(mAcc.series.slice(i, i + bin).reduce((a, b) => a + b, 0) / bin * 1000).toFixed(1));
    return { perVertexSpeed: Array.from(mAcc.pv, (x) => x / Math.max(1, mAcc.ns)), perVertexDisp: Array.from(mAcc.pd, (x) => x / Math.max(1, mAcc.n + 1)), dispMm: +(mAcc.disp / mAcc.n * 1000).toFixed(2), speedMmS: +(mAcc.speed / mAcc.n * 1000).toFixed(1), slowMmS: +(mAcc.slow / mAcc.ns * 1000).toFixed(1), speedBins: bins };
  };

  let stepMs = 0, fps = 0, frames = 0, fpsT = performance.now(), pen = { inside: 0, sleeve: 0 }, penT = 0;
  // Fixed 1/60 s physics step; the animation clock advances with the simulation, so the cloth never lags the body.
  const step = () => {
    clock += DT;
    if (isTryon(mode) && clock - t0 > TRYON_SECONDS) mode = 'idle';
    animate(clock);
    if (!cloth) return;
    moveColliders(DT, false);
    writeJointMatrices();
    cloth.mp.SkinVertices(cloth.body.GetCenterOfMassTransform(), jointMats.data(), bones.length, false, jolt.GetTempAllocator());
    const tStep = performance.now();
    jolt.Step(DT, 1);
    stepMs = stepMs * 0.9 + (performance.now() - tStep) * 0.1;
    cloth.read();
  };

  let lastT = performance.now(), acc = 0;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    // A 120 Hz screen calls this twice as often as a 60 Hz one; real elapsed time decides how many steps run.
    acc += Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    let n = 0;
    while (acc >= DT && n < 3) { step(); acc -= DT; n++; }
    if (n === 3) acc = 0; // too slow to keep up: drop the backlog instead of spiralling
    frames++;
    if (now - fpsT >= 1000) { fps = (frames * 1000) / (now - fpsT); frames = 0; fpsT = now; }
    if (now - penT > 250) { pen = countInside(); penT = now; }
    controls.update();
    renderer.render(scene, camera);
  });

  return {
    body, setGarment, view, camera, controls,
    setMode: (m) => { mode = m; if (isTryon(m)) t0 = clock; },
    // The try-on sequence; it returns to idle by itself. calm: the reduced-motion version. Returns its length in ms.
    celebrate({ calm = false } = {}) { mode = calm ? 'tryonCalm' : 'tryon'; t0 = clock; return TRYON_SECONDS * 1000; },
    // A brighter, coloured rim light for the try-on moment.
    setRim(on) { rim.color.set(on ? 0xa99bff : 0xbfd4ff); rim.intensity = on ? 2.6 : 1.0; },
    stats: () => ({ fps, stepMs, vertices: cloth?.nv ?? 0, triangles: cloth ? cloth.shirt.indices.length / 3 : 0, ...pen }),
    // Where the cloth is inside the body now: each inside vertex with its rest position, for debugging.
    insideNow() { const list = []; countInside(list); return list.map((i) => ({ i, rest: [...cloth.shirt.positions.slice(i * 3, i * 3 + 3)], pinned: cloth.shirt.pinned[i], sleeve: cloth.sleeveV[i] })); },
    // For measurements: cloth positions now, rest positions, pinned flags, and the skinned body positions now.
    probe() {
      for (const i of bodyVerts) {
        avatar.getVertexPosition(i, _v).applyMatrix4(avatar.matrixWorld);
        skinnedPos[i * 3] = _v.x; skinnedPos[i * 3 + 1] = _v.y; skinnedPos[i * 3 + 2] = _v.z;
      }
      return { cloth: cloth.out.slice(), rest: cloth.shirt.positions.slice(), pinned: cloth.shirt.pinned.slice(), skin: Float32Array.from({ length: cloth.nv * 3 }, (_, k) => skinnedRest(Math.floor(k / 3), _o).getComponent(k % 3)), body: skinnedPos.slice(), sleeve: cloth.sleeveV.slice() };
    },
    // Steps without measuring, to settle or to change the motion.
    run(seconds, m) { if (m) { mode = m; t0 = clock; } for (let k = 0; k < Math.round(seconds / DT); k++) step(); },
    // Steps the simulation directly (no rendering, so it works in a hidden tab) for `seconds` of simulated time,
    // sampling penetration every 0.1 s. msPerStep includes the inside test; physicsMs is the Jolt step alone.
    test(seconds = 10, testMode = 'walk', garment) {
      mode = testMode;
      t0 = clock;
      if (garment) setGarment(garment);
      const samples = [], steps = Math.round(seconds / DT), tStart = performance.now();
      motionReset();
      for (let k = 1; k <= steps; k++) { step(); motionSample(); if (k % 6 === 0) samples.push(countInside()); }
      const ms = (performance.now() - tStart) / steps, n = samples.map((x) => x.inside), mean = n.reduce((a, b) => a + b, 0) / n.length;
      const sl = samples.reduce((a, x) => a + x.sleeve, 0) / samples.length;
      return { vertices: cloth.nv, motion: motionReport(), samples: n.length, meanInside: +mean.toFixed(1), maxInside: Math.max(...n), meanPct: +((mean / cloth.nv) * 100).toFixed(2),
        meanInSleeves: +sl.toFixed(1), msPerStep: +ms.toFixed(2), physicsMs: +stepMs.toFixed(2) };
    },
    dispose() {
      renderer.setAnimationLoop(null);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      Jolt.destroy(jolt);
    },
  };
}
