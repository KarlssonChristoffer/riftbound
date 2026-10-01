// Assets: glTF character models, Mixamo animations and the bone-direction retargeting that drives them.
import {THREE, SkeletonUtils, V, UP, TAU, rand, std, glow, add, glowSprite, parts, C} from './core.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {FBXLoader} from 'three/addons/loaders/FBXLoader.js';
import {TOYS, toyRig, toyDriver} from './toys.js';

const A = '../../assets/';
// Heroes are humanoids so they can all share one animation set:
//  - warden / pyromancer: Mixamo characters (Paladin J Nordstrom, Knight D Pelegrini), Mixamo skeleton
//  - ranger / voidblade: Quaternius Universal Base Character head + Modular Fantasy Ranger outfit (CC0), Unreal-mannequin skeleton
const MODEL_FILES = {
  warden: 'heroes/paladin.fbx', pyromancer: 'heroes/pelegrini.fbx',
  qMale: 'q/Superhero_Male_FullBody.gltf', qFemale: 'q/Superhero_Female_FullBody.gltf', qRangerM: 'q/Male_Ranger.gltf', qRangerF: 'q/Female_Ranger.gltf',
  lizardfolk: 'enemy-lizardfolk.glb', werewolf: 'enemy-werewolf.glb', myconid: 'enemy-myconid.glb',
};
const ANIM_FILES = {
  idle: 'Breathing_Idle', run: 'Standard_Run', cast1: 'Standing_1H_Magic_Attack_01', area: 'Standing_2H_Magic_Area_Attack_01',
  cast2: 'Standing_2H_Magic_Attack_01', slash: 'Sword_And_Shield_Slash', shieldatk: 'Sword_And_Shield_Attack', jump: 'Jump_Attack',
  bow: 'Standing_Draw_Arrow', dagger: 'Double_Dagger_Stab', spin: 'Standing_Melee_Attack_360_High',
  e_idle: 'Mutant_Breathing_Idle', e_walk: 'Mutant_Walking', e_atk1: 'Mutant_Swiping', e_atk2: 'Zombie_Attack', e_hit: 'Hit_Reaction', e_die: 'Mutant_Dying',
};
export const MODELS = {}, ANIMS = {};

// want: model keys to load even when a toy covers them (the character lab uses this)
export async function loadAssets(onProgress, want = []) {
  const gl = new GLTFLoader(), fl = new FBXLoader();
  // characters with a toy (toys.js) are built in code: skip their files, and skip the animations when nothing needs them
  const used = k => want.includes(k) || (!TOYS[k] && !Object.entries(COMPOSE).some(([h, c]) => TOYS[h] && (c.body === k || c.outfit === k)));
  const models = Object.entries(MODEL_FILES).filter(([k]) => used(k));
  for (const k in ANIM_FILES) ANIMS[k] = null; // clip names stay listed (heroes.html builds its buttons from them)
  const jobs = [
    ...models.map(([k, f]) => () => (f.endsWith('.fbx') ? fl.loadAsync(A + f).then(o => ({scene: o})) : gl.loadAsync(A + f)).then(g => { MODELS[k] = g; })),
    ...(models.length ? Object.entries(ANIM_FILES) : []).map(([k, f]) => () => fl.loadAsync(A + 'anims/' + f + '.fbx').then(o => { ANIMS[k] = o; })),
  ];
  if (!jobs.length) { onProgress && onProgress(1); return; }
  let done = 0;
  await Promise.all(jobs.map(j => j().catch(e => console.warn('asset failed', e)).finally(() => onProgress && onProgress(++done / jobs.length))));
}

// ---------- rig: a character model normalised to face +z with its feet at y=0 ----------
// Bones are looked up by our CC_Base names; Mixamo and Unreal-mannequin (Quaternius) names are aliased onto them.
const ALIAS = {Hips: 'Hip', Spine: 'Waist', Spine1: 'Spine01', Spine2: 'Spine02', Neck: 'NeckTwist01',
  pelvis: 'Hip', spine_01: 'Waist', spine_02: 'Spine01', spine_03: 'Spine02', neck_01: 'NeckTwist01'};
for (const [s, m, u] of [['L', 'Left', 'l'], ['R', 'Right', 'r']]) Object.assign(ALIAS, {
  [m + 'Shoulder']: s + '_Clavicle', [m + 'Arm']: s + '_Upperarm', [m + 'ForeArm']: s + '_Forearm', [m + 'Hand']: s + '_Hand',
  [m + 'UpLeg']: s + '_Thigh', [m + 'Leg']: s + '_Calf', [m + 'Foot']: s + '_Foot', [m + 'ToeBase']: s + '_ToeBase',
  ['clavicle_' + u]: s + '_Clavicle', ['upperarm_' + u]: s + '_Upperarm', ['lowerarm_' + u]: s + '_Forearm', ['hand_' + u]: s + '_Hand',
  ['thigh_' + u]: s + '_Thigh', ['calf_' + u]: s + '_Calf', ['foot_' + u]: s + '_Foot', ['ball_' + u]: s + '_ToeBase'});
const BN = n => { const k = n.replace(/^mixamorig:?/, '').replace('CC_Base_', ''); return ALIAS[k] || k.replace(/_\d+$/, ''); };
// Quaternius heroes: the base character's head + an outfit, bound to one skeleton
const COMPOSE = {ranger: {body: 'qMale', outfit: 'qRangerM'}, voidblade: {body: 'qFemale', outfit: 'qRangerF', tint: 0x7a62a8, skinTint: 0xd8c4d0}};
const BRIGHT = {warden: 2.2, pyromancer: 1.15}; // lift dark source textures so heroes read in the dungeon lighting
function trimToHead(mesh) { // keep only the triangles skinned to the head and neck; the outfit covers the rest
  const g = mesh.geometry = mesh.geometry.clone(), si = g.attributes.skinIndex, sw = g.attributes.skinWeight, idx = g.index;
  const keep = new Set(mesh.skeleton.bones.map((b, i) => /^(Head|neck_01)$/.test(b.name) ? i : -1).filter(i => i >= 0));
  const hw = v => { let w = 0; for (let c = 0; c < 4; c++) if (keep.has(si.getComponent(v, c))) w += sw.getComponent(v, c); return w; };
  const out = []; for (let t = 0; t < idx.count; t += 3) { const a = idx.getX(t), b = idx.getX(t + 1), c = idx.getX(t + 2); if (hw(a) > .5 && hw(b) > .5 && hw(c) > .5) out.push(a, b, c); }
  g.setIndex(out);
}
function composeHero(spec) {
  const body = SkeletonUtils.clone(MODELS[spec.body].scene), bones = {};
  body.traverse(o => { if (o.isBone && !bones[o.name]) bones[o.name] = o; });
  body.traverse(o => { if (!o.isSkinnedMesh) return; const mn = o.material.name || '';
    if (/Hair/i.test(mn)) o.visible = false; // the hood covers it
    else if (/Superhero|Regular/i.test(mn)) trimToHead(o); });
  const outfit = SkeletonUtils.clone(MODELS[spec.outfit].scene), meshes = [];
  outfit.traverse(o => { if (o.isSkinnedMesh) meshes.push(o); });
  for (const m of meshes) { const sk = new THREE.Skeleton(m.skeleton.bones.map(b => bones[b.name] || b), m.skeleton.boneInverses); m.bind(sk, m.bindMatrix); body.add(m);
    if (spec.tint && !/Regular/i.test(m.material.name)) { m.material = m.material.clone(); m.material.color.multiply(new THREE.Color(spec.tint)); }
    if (spec.skinTint && /Regular/i.test(m.material.name)) { m.material = m.material.clone(); m.material.color.multiply(new THREE.Color(spec.skinTint)); } }
  if (spec.skinTint) body.traverse(o => { if (o.isSkinnedMesh && /Superhero/i.test(o.material.name)) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(spec.skinTint)); } });
  return body;
}
// FBX (Mixamo) materials are Phong; convert to standard PBR so they sit in the same lighting as everything else
function toStandard(m) {
  if (m.isMeshStandardMaterial) return m;
  return new THREE.MeshStandardMaterial({name: m.name, map: m.map, normalMap: m.normalMap, color: m.map ? 0xffffff : m.color, emissive: m.emissive, emissiveMap: m.emissiveMap, roughness: .7, metalness: .15, transparent: m.transparent, alphaTest: m.alphaTest, opacity: m.opacity, side: m.side});
}
const MAP = [ // [our bone, its child, mixamo bone, its child]
  ['Waist', 'Spine01', 'Spine', 'Spine1'], ['Spine01', 'Spine02', 'Spine1', 'Spine2'], ['Spine02', 'NeckTwist01', 'Spine2', 'Neck'], ['NeckTwist01', 'Head', 'Neck', 'Head'],
  ['L_Clavicle', 'L_Upperarm', 'LeftShoulder', 'LeftArm'], ['L_Upperarm', 'L_Forearm', 'LeftArm', 'LeftForeArm'], ['L_Forearm', 'L_Hand', 'LeftForeArm', 'LeftHand'],
  ['R_Clavicle', 'R_Upperarm', 'RightShoulder', 'RightArm'], ['R_Upperarm', 'R_Forearm', 'RightArm', 'RightForeArm'], ['R_Forearm', 'R_Hand', 'RightForeArm', 'RightHand'],
  ['L_Thigh', 'L_Calf', 'LeftUpLeg', 'LeftLeg'], ['L_Calf', 'L_Foot', 'LeftLeg', 'LeftFoot'], ['L_Foot', 'L_ToeBase', 'LeftFoot', 'LeftToeBase'],
  ['R_Thigh', 'R_Calf', 'RightUpLeg', 'RightLeg'], ['R_Calf', 'R_Foot', 'RightLeg', 'RightFoot'], ['R_Foot', 'R_ToeBase', 'RightFoot', 'RightToeBase'],
];
export function modelRig(name, height = 1.85, real = false) {
  if (TOYS[name] && !real) return toyRig(name, height);
  const model = COMPOSE[name] ? composeHero(COMPOSE[name]) : SkeletonUtils.clone(MODELS[name].scene); const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner); inner.add(model);
  model.traverse(o => {
    if (!o.isMesh) return;
    o.castShadow = o.receiveShadow = true; o.frustumCulled = false;
    if (Array.isArray(o.material)) o.material = o.material[0];
    const m = o.material = toStandard(o.material).clone(); if (m.map && !COMPOSE[name]) m.map.magFilter = THREE.NearestFilter;
    m.metalness = Math.min(m.metalness ?? 0, .2); m.roughness = Math.max(m.roughness ?? 1, .65); if (BRIGHT[name]) m.color.multiplyScalar(BRIGHT[name]);
  });
  root.updateMatrixWorld(true); let box = new THREE.Box3().setFromObject(model, true); model.scale.multiplyScalar(height / (box.max.y - box.min.y));
  root.updateMatrixWorld(true); box = new THREE.Box3().setFromObject(model, true); const c = box.getCenter(V());
  model.position.x -= c.x; model.position.z -= c.z; model.position.y -= box.min.y;
  const B = {}; model.traverse(o => { if (o.isBone) { const k = BN(o.name); if (!B[k]) B[k] = o; } }); root.updateMatrixWorld(true);
  const wp = b => b.getWorldPosition(V());
  if (wp(B.L_ToeBase).sub(wp(B.L_Foot)).z < 0) { inner.rotation.y = Math.PI; root.updateMatrixWorld(true); }
  const rig = {B, rest: {}, side: Math.sign(wp(B.L_Upperarm).x) || 1, inner};
  for (const [a, b] of MAP) if (B[a] && B[b]) rig.rest[a] = {q: B[a].getWorldQuaternion(new THREE.Quaternion()), d: wp(B[b]).sub(wp(B[a])).normalize()};
  rig.hipQ = B.Hip.getWorldQuaternion(new THREE.Quaternion()); rig.hipY = wp(B.Hip).y;
  const mats = []; model.traverse(o => { if (o.isMesh) mats.push(o.material); });
  return {root, rig, mats, local: b => root.worldToLocal(wp(B[b])), hand: b => wp(B[b])};
}

// ---------- driver: plays a Mixamo clip on a hidden skeleton, copies limb directions onto the rig ----------
// legs = true (heroes): a second hidden skeleton keeps playing idle/run for the legs, so attacks can play on the upper body while moving
export function makeDriver(rig, idleK = 'idle', runK = 'run', legs = false) {
  if (rig.toy) return toyDriver(rig, idleK, runK); // toys keep the legs running during attacks on their own
  const base = ANIMS[idleK] || ANIMS[runK]; if (!base) return null;
  const src = SkeletonUtils.clone(base); src.updateMatrixWorld(true);
  const B = {}; src.traverse(o => { if (o.isBone) B[o.name.replace(/^mixamorig:?/, '')] = o; }); if (!B.Hips) return null;
  const wp = b => b.getWorldPosition(V());
  const D = {src, B, mixer: new THREE.AnimationMixer(src), acts: {}, cur: null, once: 0, idleK, runK,
    hipQ: B.Hips.getWorldQuaternion(new THREE.Quaternion()), hipY: wp(B.Hips).y,
    flip: Math.sign(wp(B.LeftArm).x) !== rig.side, back: wp(B.LeftToeBase).sub(wp(B.LeftFoot)).z < 0};
  for (const k in ANIMS) {
    const clip = ANIMS[k] && ANIMS[k].animations[0]; if (!clip) continue;
    if (!clip.userData) clip.userData = {};
    if (!clip.userData.trimmed) { clip.tracks = clip.tracks.filter(t => !t.name.endsWith('.position') || /Hips\.position$/.test(t.name)); clip.userData.trimmed = true; }
    D.acts[k] = D.mixer.clipAction(clip);
  }
  if (legs && ANIMS[runK]) {
    const ls = SkeletonUtils.clone(base), LB = {}; ls.traverse(o => { if (o.isBone) LB[o.name.replace(/^mixamorig:?/, '')] = o; });
    D.legs = {src: ls, B: LB, mixer: new THREE.AnimationMixer(ls), acts: {}, cur: null};
    for (const k of [idleK, runK]) if (ANIMS[k]) D.legs.acts[k] = D.legs.mixer.clipAction(ANIMS[k].animations[0]);
  }
  dplay(D, D.acts[idleK] ? idleK : runK); return D;
}
const LEGS = new Set(['L_Thigh', 'L_Calf', 'L_Foot', 'R_Thigh', 'R_Calf', 'R_Foot']);
export function dplay(D, k, once = false, speed = 1) {
  if (D.toy) return D.play(k, once, speed);
  const a = D.acts[k]; if (!a) return false; const prev = D.acts[D.cur];
  a.reset(); a.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat); a.clampWhenFinished = true; a.timeScale = speed; a.setEffectiveWeight(1); a.play();
  if (prev && prev !== a) prev.crossFadeTo(a, .15, false);
  D.cur = k; D.once = once ? a.getClip().duration / speed - .15 : 0; return true;
}
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _pq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _hq = new THREE.Quaternion(), _t = new THREE.Quaternion(), _d = V(), _a = V(), _b = V();
function aimBone(rig, name, dir) {
  const bone = rig.B[name], r = rig.rest[name];
  _q.setFromUnitVectors(r.d, dir); _q2.copy(_rq).multiply(_q).multiply(r.q);
  bone.parent.getWorldQuaternion(_pq); bone.quaternion.copy(_pq.invert().multiply(_q2)); bone.updateMatrixWorld(true);
}
// ent needs: g (root group), rig, drv, moving
export function driveUpdate(ent, dt) {
  if (ent.drv.toy) return ent.drv.update(ent, dt);
  const D = ent.drv, R = ent.rig;
  if (D.once > 0) D.once -= dt;
  else {
    const want = ent.moving && D.acts[D.runK] ? D.runK : (D.acts[D.idleK] ? D.idleK : D.runK);
    if (D.cur !== want) dplay(D, want, false, want === 'run' ? (ent.runSpeed || 1) : 1);
  }
  D.mixer.update(dt); D.src.updateMatrixWorld(true);
  const L = D.legs, useLegs = !!L && ent.moving && D.once > 0; // attacking on the move: legs keep running
  if (L) {
    const want = ent.moving ? D.runK : D.idleK, a = L.acts[want];
    if (L.cur !== want && a) { a.reset().play(); if (L.acts[L.cur]) L.acts[L.cur].crossFadeTo(a, .15, false); L.cur = want; }
    if (L.acts[D.runK]) L.acts[D.runK].timeScale = (ent.runSpeed || 1) * (ent.backpedal ? -1 : 1);
    L.mixer.update(dt); L.src.updateMatrixWorld(true);
  }
  ent.g.updateMatrixWorld(true); ent.g.getWorldQuaternion(_rq);
  _hq.copy(D.B.Hips.getWorldQuaternion(_t)).multiply(_pq.copy(D.hipQ).invert());
  if (D.back) { _hq.x *= -1; _hq.z *= -1; } if (D.flip) { _hq.y *= -1; _hq.z *= -1; }
  const hip = R.B.Hip; _q2.copy(_rq).multiply(_hq).multiply(R.hipQ); hip.parent.getWorldQuaternion(_pq); hip.quaternion.copy(_pq.invert().multiply(_q2)); hip.updateMatrixWorld(true);
  R.inner.position.y = ((useLegs ? L.B : D.B).Hips.getWorldPosition(_d).y / D.hipY - 1) * R.hipY;
  for (const [a, , sa, sb] of MAP) {
    const SB = useLegs && LEGS.has(a) ? L.B : D.B;
    if (!R.rest[a] || !SB[sa] || !SB[sb]) continue;
    _d.copy(SB[sb].getWorldPosition(_a)).sub(SB[sa].getWorldPosition(_b)).normalize();
    if (D.back) { _d.x *= -1; _d.z *= -1; } if (D.flip) _d.x *= -1;
    if (ent.legYaw && LEGS.has(a)) _d.applyAxisAngle(UP, ent.legYaw);
    aimBone(R, a, _d);
  }
}

// ---------- class props attached to hand bones ----------
function follow(m, g, bone, dirFrom, offset) {
  const p = m.local(bone); if (offset) p.add(offset); g.position.copy(p);
  if (dirFrom) { const d = p.clone().sub(m.local(dirFrom)).normalize(); g.quaternion.setFromUnitVectors(UP, d); }
}
export const PROPS = {
  pyromancer(m) {
    const R = m.root, trim = std(0xd6a23e, {m: .9, r: .3}), wood = std(0x4b2e1c, {r: .8});
    const st = new THREE.Group(); R.add(st); add(st, new THREE.CylinderGeometry(.035, .045, 2.2, 8), wood, 0, .15, 0);
    for (let i = 0; i < 3; i++) { const a = i * TAU / 3; add(st, new THREE.ConeGeometry(.03, .3, 5), trim, Math.cos(a) * .1, 1.3, Math.sin(a) * .1, {rz: -Math.cos(a) * .5, rx: Math.sin(a) * .5}); }
    const cry = add(st, new THREE.OctahedronGeometry(.16), glow(0xff7a2a, 6), 0, 1.44, 0); cry.add(glowSprite(0xff6a20, 2.5, 1.2));
    const pf = glowSprite(0xff8a30, 4, .45); R.add(pf);
    return (h, t, dt) => {
      follow(m, st, 'L_Hand'); follow(m, pf, 'R_Hand'); cry.rotation.y += dt * 2; pf.scale.setScalar(.42 + Math.sin(t * 23) * .06);
      if (Math.random() < .5) { const p = cry.getWorldPosition(V()); parts.emit(p.x, p.y, p.z, rand(-.2, .2), rand(.4, 1), rand(-.2, .2), C.fire, 3, .6, .12, -.5, 1); }
    };
  },
  warden(m) {
    const R = m.root, gold = std(0xd4a640, {m: .9, r: .3}), cloth = std(0x1f4f8f, {r: .85}), steel = std(0xaeb8c2, {m: .85, r: .32});
    const sw = new THREE.Group(); R.add(sw); add(sw, new THREE.BoxGeometry(.09, 1.2, .025), glow(0x9fdcff, 1.6), 0, .72, 0);
    add(sw, new THREE.BoxGeometry(.36, .05, .08), gold, 0, .1, 0); add(sw, new THREE.SphereGeometry(.045, 8, 6), gold, 0, -.1, 0);
    const sh = new THREE.Group(); R.add(sh); add(sh, new THREE.CylinderGeometry(.4, .4, .06, 22), cloth, 0, 0, 0, {rx: Math.PI / 2});
    add(sh, new THREE.TorusGeometry(.4, .035, 6, 26), gold); add(sh, new THREE.SphereGeometry(.09, 10, 8), steel, 0, 0, .04);
    add(sh, new THREE.BoxGeometry(.06, .48, .02), glow(0x9fdcff, 2), 0, 0, .035); add(sh, new THREE.BoxGeometry(.38, .06, .02), glow(0x9fdcff, 2), 0, .06, .035);
    return () => { follow(m, sw, 'R_Hand', 'R_Forearm'); follow(m, sh, 'L_Hand', null, V(0, 0, .14)); };
  },
  ranger(m) {
    const R = m.root, wood = std(0x5a3a1e, {r: .6}); const bow = new THREE.Group(); R.add(bow);
    const bg = new THREE.TorusGeometry(.62, .028, 6, 28, 1.9); bg.rotateZ(-.95); bg.rotateY(-Math.PI / 2); bg.translate(0, 0, -.6);
    add(bow, bg, wood); add(bow, new THREE.CylinderGeometry(.006, .006, .98, 4), std(0xeeeeee), 0, 0, -.25); add(bow, new THREE.SphereGeometry(.05, 8, 6), glow(0x9aff6a, 4));
    return () => follow(m, bow, 'L_Hand');
  },
  voidblade(m) {
    const R = m.root, vg = glow(0xc070ff, 2.2);
    const ds = ['L', 'R'].map(() => { const g = new THREE.Group(); R.add(g); add(g, new THREE.ConeGeometry(.05, .6, 4), glow(0xd8a8ff, 3), 0, .35, 0); return g; });
    const wing = new THREE.Group(); R.add(wing); const shards = [];
    for (const s of [-1, 1]) for (let k = 0; k < 3; k++) {
      const x = add(wing, new THREE.OctahedronGeometry(.2), vg, s * (.25 + k * .17), .05 + k * .15, -.28 - k * .05, {s: [.22, 1.3, .08], rz: s * (.55 + k * .25)});
      x.userData = {k, y: x.position.y}; shards.push(x);
    }
    return (h, t) => {
      follow(m, ds[0], 'L_Hand', 'L_Forearm'); follow(m, ds[1], 'R_Hand', 'R_Forearm'); follow(m, wing, 'Spine02');
      shards.forEach(x => { x.position.y = x.userData.y + Math.sin(t * 2.2 + x.userData.k) * .05; });
    };
  },
};
