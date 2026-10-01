// Toys: our own low-poly characters for the pixel look, built from primitives and animated in code.
// A toy plugs into the same interface as a rigged model (see assets.js: modelRig / makeDriver / dplay / driveUpdate):
// it exposes the hand, elbow and spine points that PROPS attach to, and it turns the clip names the game plays
// ('run', 'cast1', 'slash', 'e_atk1', 'e_die'...) into procedural poses. Gameplay code needs no changes.
import {THREE, V, TAU} from './core.js';

// ---------- building blocks ----------
export const Bx = (w, h, d) => new THREE.BoxGeometry(w, h, d);
export const Sp = (r, a = 7, b = 5) => new THREE.SphereGeometry(r, a, b);
export const Cy = (a, b, h, n = 8) => new THREE.CylinderGeometry(a, b, h, n);
export const Co = (r, h, n = 6) => new THREE.ConeGeometry(r, h, n);
export const dome = (r, cut = .5) => new THREE.SphereGeometry(r, 8, 5, 0, TAU, 0, Math.PI * cut);
export function mesh(par, geo, m, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); o.castShadow = o.receiveShadow = true; par.add(o); return o;
}
export function piv(par, x = 0, y = 0, z = 0) { const g = new THREE.Group(); g.position.set(x, y, z); par.add(g); return g; }
// lit materials (flat shaded) go into mats, which the game tints and flashes; glowing bits stay unlit and bright
export function palette() {
  const mats = [];
  const M = c => { const m = new THREE.MeshStandardMaterial({color: c, roughness: .85, metalness: 0, flatShading: true}); mats.push(m); return m; };
  const S = c => { const m = new THREE.MeshStandardMaterial({color: c, roughness: .8, metalness: 0}); mats.push(m); return m; }; // smooth shaded (bodies, cloth)
  const L = (c, k = 2.5) => new THREE.MeshBasicMaterial({color: new THREE.Color(c).multiplyScalar(k)});
  return {mats, M, S, L};
}
const SKIN = '#f1c29a', EYE = '#2a1020';

// ---------- humanoid body (heroes, lizardfolk) ----------
// faces +z; the character's left hand is on +x
export function humanoid(P, o) {
  const model = new THREE.Group(), hipY = o.hipY ?? .42, legH = hipY - .06;
  const body = piv(model, 0, hipY, 0), legs = piv(body), torso = piv(body);
  const legM = P.M(o.leg), bootM = P.M(o.boot);
  const legL = piv(legs, .1, 0, 0), legR = piv(legs, -.1, 0, 0);
  const lw = o.legW ?? .13;
  for (const l of [legL, legR]) { mesh(l, Bx(lw, legH, lw + .02), legM, 0, -legH / 2, 0); mesh(l, Bx(lw + .02, .1, lw + .1), bootM, 0, -hipY + .05, .03); }
  const sy = o.shoulderY ?? .46, sx = o.shoulderX ?? .25, al = o.armLen ?? .4;
  const armM = P.M(o.arm), handM = P.M(o.hand ?? SKIN), aw = o.armW ?? .1;
  // elbows: true splits each arm into upper arm + forearm (arm.fore), so arms can bend and reach (see solveArm)
  const [armL, armR] = [1, -1].map(s => {
    const a = piv(torso, s * sx, sy, 0);
    if (!o.elbows) { mesh(a, Bx(aw, al, aw * 1.1), armM, 0, -al / 2, 0); mesh(a, Sp(.065, 5, 4), handM, 0, -al, 0); return a; }
    const u = al / 2; a.len1 = a.len2 = u;
    mesh(a, Bx(aw, u + .02, aw * 1.1), armM, 0, -u / 2, 0);
    a.fore = piv(a, 0, -u, 0); mesh(a.fore, Bx(aw * .95, u, aw * 1.05), o.fore ? P.M(o.fore) : armM, 0, -u / 2, 0); mesh(a.fore, Sp(o.handR ?? .07, 5, 4), handM, 0, -u, 0);
    return a;
  });
  const head = piv(torso, 0, o.headY ?? .7, 0);
  if (o.skin !== false) mesh(head, Sp(o.headR ?? .17), P.M(o.skin ?? SKIN));
  const hand = a => a.fore ? piv(a.fore, 0, -a.len2, 0) : piv(a, 0, -al, 0), elbow = a => a.fore || piv(a, 0, -al * .45, 0);
  const points = {L_Hand: hand(armL), L_Forearm: elbow(armL), R_Hand: hand(armR), R_Forearm: elbow(armR), Spine02: piv(torso, 0, sy - .06, -.12)};
  return {model, body, legs, legL, legR, torso, head, armL, armR, points, hipY, kind: 'human'};
}
export const eyes = (P, head, col, y = .01, z = .155, dx = .065, k = 1) => { const m = P.L(col, k); mesh(head, Bx(.045, .06, .02), m, -dx, y, z); mesh(head, Bx(.045, .06, .02), m, dx, y, z); };

// ---------- heroes (weapons come from PROPS in assets.js, attached to the hand points) ----------
const HEROES = {
  pyromancer(P) {
    const B = humanoid(P, {leg: '#5a1a1f', boot: '#3a1216', arm: '#9b3a2a'});
    mesh(B.torso, Cy(.2, .33, .46), P.M('#d4623a'), 0, .02, 0);
    mesh(B.torso, Cy(.215, .215, .07), P.M('#ffd35c'), 0, .27, 0);
    mesh(B.torso, Cy(.17, .2, .32), P.M('#d4623a'), 0, .44, 0);
    mesh(B.torso, Bx(.3, .08, .2), P.M('#9b3a2a'), 0, .56, 0);
    eyes(P, B.head, EYE, .0, .155, .065, 1);
    mesh(B.head, Cy(.31, .31, .04, 10), P.M('#5a1a1f'), 0, .13, 0);
    mesh(B.head, Cy(.19, .19, .06, 7), P.M('#ffd35c'), 0, .18, -.01);
    mesh(B.head, Co(.18, .52, 7), P.M('#b83a2e'), 0, .42, -.05, -.3);
    mesh(B.head, Bx(.16, .1, .06), P.M('#e8e0d0'), 0, -.12, .12); // beard
    return B;
  },
  warden(P) {
    const B = humanoid(P, {leg: '#5d6f85', boot: '#3f4a5c', arm: '#9fb3c8', hand: '#5d6f85'});
    mesh(B.torso, Bx(.36, .36, .24), P.M('#9fb3c8'), 0, .3, 0);
    mesh(B.torso, Bx(.3, .3, .26), P.M('#3f6fa8'), 0, .02, 0); // tabard
    mesh(B.torso, Bx(.08, .3, .27), P.M('#e8eef5'), 0, .02, 0);
    mesh(B.torso, Bx(.4, .5, .04), P.M('#2b4c7a'), 0, .24, -.14); // cape
    for (const a of [B.armL, B.armR]) mesh(a, Sp(.12, 6, 4), P.M('#9fb3c8'), 0, 0, 0);
    mesh(B.head, dome(.2), P.M('#9fb3c8'), 0, .01, 0);
    mesh(B.head, Bx(.3, .05, .06), P.M('#1a1020'), 0, .02, .15);
    mesh(B.head, Bx(.04, .16, .26), P.M('#b83a2e'), 0, .24, -.02);
    return B;
  },
  ranger(P) {
    const B = humanoid(P, {leg: '#5a4a38', boot: '#233f1e', arm: '#2f5a28'});
    mesh(B.torso, Bx(.34, .5, .22), P.M('#85705a'), 0, .22, 0);
    mesh(B.torso, Bx(.36, .06, .24), P.M('#5a4a38'), 0, .05, 0);
    mesh(B.torso, Bx(.42, .66, .04), P.M('#2f5a28'), 0, .22, -.14); // cape
    mesh(B.torso, Bx(.12, .42, .12), P.M('#8a5a30'), .12, .42, -.18, .2); // quiver
    for (let i = 0; i < 3; i++) mesh(B.torso, Bx(.02, .12, .02), P.M('#e8eef5'), .08 + i * .04, .68, -.14, .2);
    eyes(P, B.head, EYE);
    mesh(B.head, dome(.2, .55), P.M('#4f8a3c'), 0, .02, -.01);
    mesh(B.head, Co(.1, .28, 5), P.M('#2f5a28'), 0, .05, -.2, -1.9);
    return B;
  },
  voidblade(P) {
    const B = humanoid(P, {leg: '#241536', boot: '#1d162c', arm: '#2f2445', hand: '#d8c4d0'});
    mesh(B.torso, Bx(.32, .5, .2), P.M('#2f2445'), 0, .22, 0);
    mesh(B.torso, Bx(.34, .06, .22), P.M('#6a3fa0'), 0, .06, 0);
    mesh(B.torso, Bx(.3, .3, .03), P.M('#40255f'), 0, -.05, .1, .15); // coat tails
    eyes(P, B.head, '#d68cff', .01, .155, .065, 3);
    mesh(B.head, dome(.2, .55), P.M('#6a3fa0'), 0, .02, -.01);
    mesh(B.head, Co(.11, .3, 5), P.M('#40255f'), 0, .05, -.2, -1.9);
    mesh(B.head, Bx(.3, .1, .2), P.M('#d68cff'), 0, -.1, .04); // scarf
    return B;
  },
};

// ---------- enemies ----------
const ENEMIES = {
  lizardfolk(P) { // hunched lizard warrior with a tail
    const B = humanoid(P, {leg: '#8a4a2e', boot: '#5e2f22', arm: '#8a4a2e', hand: '#5e2f22', skin: false, headY: .66});
    mesh(B.torso, Cy(.19, .25, .5, 7), P.M('#8a4a2e'), 0, .24, 0);
    mesh(B.torso, Bx(.2, .36, .08), P.M('#d9a066'), 0, .24, .19);
    mesh(B.head, Sp(.17), P.M('#8a4a2e'));
    mesh(B.head, Bx(.19, .11, .26), P.M('#8a4a2e'), 0, -.04, .19);
    mesh(B.head, Bx(.2, .03, .22), P.M('#3a0f14'), 0, -.1, .18);
    mesh(B.head, Co(.06, .22, 4), P.M('#5e2f22'), 0, .2, -.04);
    eyes(P, B.head, '#ffe08a', .06, .14, .1, 2.5);
    for (const a of [B.armL, B.armR]) for (let i = -1; i <= 1; i++) mesh(a, Co(.02, .09, 4), P.M('#e8dcc0'), i * .03, -.46, .03, Math.PI);
    B.tail = piv(B.body, 0, -.05, -.18); mesh(B.tail, Co(.1, .6, 5), P.M('#5e2f22'), 0, 0, -.28, -Math.PI / 2 - .3);
    B.hunch = .18;
    return B;
  },
  werewolf(P) { // four-legged beast (tints make it a magma, frost or thorn variant)
    const model = new THREE.Group(), body = piv(model, 0, .5, 0);
    const F = P.M('#7a7890'), G = P.M('#4a4658'), S = P.M('#e8eef5');
    mesh(body, Bx(.42, .38, .8), F, 0, .08, 0);
    mesh(body, Bx(.5, .34, .34), G, 0, .16, .22); // mane
    mesh(body, Bx(.3, .1, .55), S, 0, -.12, .02);
    const head = piv(body, 0, .2, .42);
    mesh(head, Bx(.34, .3, .32), F, 0, .06, .1); mesh(head, Bx(.18, .13, .22), S, 0, -.01, .32); mesh(head, Bx(.07, .06, .05), P.M('#0e1224'), 0, .04, .43);
    for (const x of [-.1, .1]) { mesh(head, Co(.07, .18, 4), G, x, .28, .04); mesh(head, Bx(.05, .05, .03), P.L('#86d9ff', 2.5), x * .9, .1, .26); }
    const legs = [[.14, .28], [-.14, .28], [.14, -.28], [-.14, -.28]].map(([x, z]) => { const p = piv(body, x, -.02, z); mesh(p, Bx(.11, .46, .11), G, 0, -.23, 0); mesh(p, Bx(.13, .07, .16), F, 0, -.45, .03); return p; });
    const tail = piv(body, 0, .14, -.4); mesh(tail, Co(.07, .45, 4), F, 0, .1, -.18, -1.1);
    return {model, body, head, legs, tail, points: {Spine02: piv(body, 0, .3, 0), R_Hand: piv(head, 0, 0, .4), L_Hand: piv(head, 0, 0, .4)}, kind: 'beast'};
  },
  myconid(P) { // walking mushroom
    const model = new THREE.Group(), body = piv(model, 0, 0, 0);
    const legs = [.1, -.1].map(x => { const p = piv(body, x, .1, 0); mesh(p, Bx(.12, .1, .16), P.M('#b59f7e'), 0, -.05, .02); return p; });
    mesh(body, Cy(.17, .21, .5), P.M('#e3d5b8'), 0, .35, 0);
    const arms = [1, -1].map(s => { const a = piv(body, s * .2, .47, 0); mesh(a, Bx(.07, .22, .07), P.M('#e3d5b8'), 0, -.11, 0); return a; });
    const cap = piv(body, 0, .6, 0);
    mesh(cap, dome(.42), P.M('#b83a2e')); mesh(cap, Cy(.42, .36, .06, 9), P.M('#7a2324'), 0, -.02, 0);
    const spot = P.M('#fff4d6');
    [[.45, 0], [.95, 1.2], [.85, 2.6], [1.0, 3.9], [.7, 5.1], [.6, 2]].forEach(([ph, a]) => mesh(cap, Sp(.07, 5, 3), spot, Math.sin(ph) * Math.cos(a) * .41, Math.cos(ph) * .41, Math.sin(ph) * Math.sin(a) * .41));
    for (const x of [-.07, .07]) mesh(body, Bx(.045, .07, .02), P.L('#10160f', 1), x, .42, .2);
    return {model, body, legs, arms, cap, points: {Spine02: piv(body, 0, .5, 0), R_Hand: arms[1], L_Hand: arms[0]}, kind: 'shroom'};
  },
};
export const TOYS = {...Object.fromEntries(Object.keys(HEROES).map(k => [k, 'hero'])), ...Object.fromEntries(Object.keys(ENEMIES).map(k => [k, 'enemy']))};
// height each toy's nominal size refers to (heroes: top of the head, beasts: a bit above the shoulders)
const DESIGN_H = {pyromancer: 1.3, warden: 1.3, ranger: 1.3, voidblade: 1.3, lizardfolk: 1.25, werewolf: 1.45, myconid: 1.05};

export const toyRig = (name, height) => toyFrom(HEROES[name] || ENEMIES[name], height, DESIGN_H[name]);
// build(P) returns the body parts; the character is scaled so designH (in build units) becomes height
export function toyFrom(build, height, designH) {
  const P = palette(), B = build(P);
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner); inner.add(B.model);
  inner.scale.setScalar(height / (designH || B.designH));
  const pt = b => B.points[b] || B.points.Spine02;
  Object.assign(B, B.points); // rig.B.L_Hand etc., like a real rig's bones
  const rig = {toy: true, B, inner, pose: POSES[B.kind], cur: {}};
  return {root, rig, mats: P.mats, local: b => root.worldToLocal(pt(b).getWorldPosition(V())), hand: b => pt(b).getWorldPosition(V())};
}

// ---------- driver: the same fields as the Mixamo driver, poses instead of clips ----------
const CLIPS = {idle: 1, run: 1, e_idle: 1, e_walk: 1, cast1: .7, cast2: .8, area: .9, slash: .6, shieldatk: .7, jump: 1, bow: .8, dagger: .55, spin: .8,
  e_atk1: .8, e_atk2: .9, e_hit: .4, e_die: 1.3};
const LOOP = new Set(['idle', 'run', 'e_idle', 'e_walk']);
export function toyDriver(rig, idleK = 'idle', runK = 'run') {
  const D = {toy: true, rig, idleK, runK, cur: idleK, once: 0, t: 0, speed: 1, phase: 0, clock: Math.random() * 10, acts: {}};
  for (const k in CLIPS) D.acts[k] = {timeScale: 1};
  D.play = (k, once = false, speed = 1) => { if (!(k in CLIPS)) return false; D.cur = k; D.t = 0; D.speed = speed; D.once = once ? CLIPS[k] / speed - .15 : 0; return true; };
  D.update = (ent, dt) => {
    if (D.once > 0) D.once -= dt;
    else if (D.cur !== 'e_die') { const want = ent.moving ? D.runK : D.idleK; if (D.cur !== want) { D.cur = want; D.t = 0; D.speed = 1; } }
    D.t += dt * D.speed; D.clock += dt;
    const rs = D.acts.run.timeScale || 1, hero = D.runK === 'run';
    if (ent.moving) D.phase += dt * (hero ? 10 * Math.abs(rs) * Math.sign(rs) : 7 * (ent.speed ? ent.speed / 2.5 : 1));
    rig.pose(rig, D, ent, dt);
    if (rig.B.tick) rig.B.tick(D, ent, dt); // per-character extras: bow string, pets, cloth
  };
  return D;
}

// ---------- poses ----------
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const env = (p, a, b, c) => sm(a, b, p) * (1 - sm(c, 1, p)); // rise a->b, hold, fall c->1
function blend(rig, T, dt) { // ease every joint toward its target so clips flow into each other
  const k = 1 - Math.exp(-dt * 20), C = rig.cur;
  for (const n in T) C[n] = C[n] === undefined ? T[n] : C[n] + (T[n] - C[n]) * k;
  return C;
}
// two-bone arm reach in torso space: the hand goes to H, the elbow bends toward pole; w blends from the current pose
const DOWN = new THREE.Vector3(0, -1, 0), _d = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Vector3(), _f = new THREE.Vector3(), _qu = new THREE.Quaternion(), _qf = new THREE.Quaternion(), _qi = new THREE.Quaternion();
function solveArm(arm, H, pole, w) {
  const L1 = arm.len1, L2 = arm.len2, S = arm.position;
  _d.copy(H).sub(S); const len = Math.max(1e-3, Math.min(_d.length(), L1 + L2 - 1e-3)); _d.normalize();
  const a = (L1 * L1 - L2 * L2 + len * len) / (2 * len), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  _e.copy(S).addScaledVector(_d, a).addScaledVector(_p, h); // elbow
  _qu.setFromUnitVectors(DOWN, _f.copy(_e).sub(S).normalize());
  _f.copy(S).addScaledVector(_d, len).sub(_e).normalize().applyQuaternion(_qi.copy(_qu).invert());
  _qf.setFromUnitVectors(DOWN, _f);
  arm.quaternion.slerp(_qu, w); arm.fore.quaternion.slerp(_qf, w);
}
// full draw: bow arm straight at the target (model +z), draw hand back beside the face with the elbow out behind
const _aim = new THREE.Vector3(), _h = new THREE.Vector3(), _pole = new THREE.Vector3();
function archerArms(B, w) {
  _aim.set(0, 0, 1).applyQuaternion(_qi.copy(B.torso.quaternion).invert());
  const L = B.armL; _h.copy(L.position).addScaledVector(_aim, (L.len1 + L.len2) * .98); _h.y += .04; solveArm(L, _h, _pole.set(0, -1, 0), w);
  const R = B.armR; _h.copy(R.position).addScaledVector(_aim, .14); _h.y += .12; solveArm(R, _h, _pole.copy(_aim).multiplyScalar(-1).add(DOWN.clone().multiplyScalar(-.6)), w);
}
const POSES = {
  human(rig, D, ent, dt) {
    const B = rig.B, mv = ent.moving && D.cur !== 'e_die', sw = mv ? Math.sin(D.phase) : 0, p = LOOP.has(D.cur) ? 0 : Math.min(1, D.t / CLIPS[D.cur]);
    const T = {bY: mv ? Math.abs(Math.cos(D.phase)) * .05 : Math.sin(D.clock * 2.2) * .008, bX: (mv ? .12 : 0) + (B.hunch || 0) * .3, bZ: 0, bRY: 0, bRZ: 0, bZp: 0,
      tY: 0, tX: B.hunch || 0, hX: 0, hY: 0, lL: -sw * .75, lR: sw * .75, aLX: sw * .55, aLZ: .12, aRX: -sw * .55, aRZ: -.12, legsY: ent.legYaw || 0, tail: Math.sin(D.clock * (mv ? 9 : 3)) * .35,
      fL: mv ? -.9 : -.15, fR: mv ? -.9 : -.15, ik: 0,
      kL: mv ? .3 + .9 * Math.max(0, Math.sin(D.phase + 1.3)) : .06, kR: mv ? .3 + .9 * Math.max(0, Math.sin(D.phase + 1.3 + Math.PI)) : .06}; // knees (bodies that have them)
    switch (D.cur) {
      case 'cast1': { const e = env(p, 0, .25, .6); T.aRX = -1.5 * e + T.aRX * (1 - e); T.tY = -.3 * e; break; }
      case 'cast2': { const e = env(p, 0, .25, .6); T.aLX = T.aRX = -1.45 * e; T.aLZ = .3 * e; T.aRZ = -.3 * e; T.bX -= .1 * e; break; }
      case 'area': { const up = env(p, 0, .35, .45), dn = env(p, .4, .55, .8); T.aLX = T.aRX = -2.8 * up - 1 * dn; T.aLZ = .3; T.aRZ = -.3; T.bY -= .12 * dn; T.bX += .3 * dn; break; }
      case 'slash': case 'e_atk1': { const w = env(p, 0, .3, .35), s = env(p, .3, .45, .7); T.aRX = -2.3 * w - .9 * s; T.aRZ = -.9 * w + .5 * s; T.tY = .6 * w - .7 * s; T.bX += .15 * s; break; }
      case 'shieldatk': { const e = env(p, .1, .35, .6); T.aLX = -1.55 * e; T.aLZ = -.2 * e; T.bX += .3 * e; T.bZp = .15 * e; break; }
      case 'jump': { const air = Math.sin(Math.PI * Math.min(1, p / .7)) * (p < .7 ? 1 : 0), land = env(p, .65, .75, .9); T.bY += .8 * air - .12 * land; T.aLX = T.aRX = -2.6 * air - .8 * land; T.lL = T.lR = -.6 * air - .5 * land; T.kL = T.kR = 1.1 * air + .9 * land; break; }
      case 'bow': {
        if (B.armL.fore) { // side-on archer stance: chest turns away, head keeps the target, arms solved by archerArms
          const e = env(p, 0, .2, .82); T.tY = -1.2 * e; T.hY = 1.05 * e; T.legsY = T.legsY * (1 - e) - .5 * e; T.ik = e; T.bX -= .04 * e; break;
        }
        const e = env(p, 0, .3, .75); T.aLX = -1.55 * e; T.aLZ = -.1 * e; T.aRX = -1.4 * e; T.aRZ = .5 * e; T.tY = -.4 * e; break;
      }
      case 'dagger': { const a = env(p, 0, .2, .4), b = env(p, .35, .55, .75); T.aLX = -1.6 * a; T.aRX = -1.6 * b; T.tY = .25 * (a - b); T.bX += .15; break; }
      case 'spin': { const e = env(p, 0, .15, .85); T.bRY = TAU * sm(.05, .9, p); T.aLZ = 1.4 * e; T.aRZ = -1.4 * e; T.aLX = T.aRX = -.3 * e; break; }
      case 'e_atk2': { const up = env(p, 0, .4, .5), dn = env(p, .45, .6, .85); T.aLX = T.aRX = -2.7 * up - .9 * dn; T.bX += .35 * dn - .15 * up; T.bY -= .1 * dn; break; }
      case 'e_hit': { const e = 1 - sm(0, 1, p); T.bX -= .35 * e; T.hX = -.3 * e; T.aLZ += .4 * e; T.aRZ -= .4 * e; break; }
      case 'e_die': { const f = sm(0, .7, p); T.bX = -1.45 * f; T.bY = -rig.B.hipY * .72 * f; T.aLZ = .2 + .9 * f; T.aRZ = -.2 - .9 * f; T.aLX = T.aRX = -.4 * f; T.lL = -.3 * f; T.lR = -.1 * f; T.kL = .3 * f; T.kR = .1 * f; break; }
    }
    const C = blend(rig, T, dt), b = B.body;
    b.position.y = B.hipY + C.bY; b.position.z = C.bZp; b.rotation.set(C.bX, C.bRY, C.bRZ);
    B.torso.rotation.set(C.tX - (B.hunch || 0) * .3, C.tY, 0); B.head.rotation.set(C.hX - (B.hunch || 0) * .6, C.hY, 0); B.legs.rotation.y = C.legsY;
    B.legL.rotation.x = C.lL; B.legR.rotation.x = C.lR; B.armL.rotation.set(C.aLX, 0, C.aLZ); B.armR.rotation.set(C.aRX, 0, C.aRZ);
    if (B.legL.shin) for (const [l, k, t] of [[B.legL, C.kL, C.lL], [B.legR, C.kR, C.lR]]) { l.shin.rotation.x = k; l.foot.rotation.x = -(t + k) * .7; } // knee, then keep the foot near flat
    if (B.armL.fore) { B.armL.fore.rotation.set(C.fL, 0, 0); B.armR.fore.rotation.set(C.fR, 0, 0); if (C.ik > .01) archerArms(B, C.ik); }
    if (B.tail) B.tail.rotation.y = C.tail;
  },
  beast(rig, D, ent, dt) {
    const B = rig.B, mv = ent.moving && D.cur !== 'e_die', sw = mv ? Math.sin(D.phase) : 0, p = LOOP.has(D.cur) ? 0 : Math.min(1, D.t / CLIPS[D.cur]);
    const T = {bY: mv ? Math.abs(Math.cos(D.phase)) * .05 : Math.sin(D.clock * 2) * .01, bX: 0, bZ: 0, bRZ: 0, hX: mv ? sw * .06 : Math.sin(D.clock * 1.3) * .05,
      f: sw * .7, g: -sw * .7, tail: Math.sin(D.clock * (mv ? 12 : 3)) * (mv ? .5 : .25)};
    switch (D.cur) {
      case 'e_atk1': { const w = env(p, 0, .25, .3), s = env(p, .25, .4, .7); T.bZ = .45 * s - .1 * w; T.bX = .15 * w - .1 * s; T.hX = -.4 * w + .5 * s; T.f = -.8 * s; break; }
      case 'e_atk2': { const up = env(p, 0, .35, .5), dn = env(p, .45, .6, .85); T.bX = -.75 * up + .2 * dn; T.bY += .2 * up; T.f = -1.2 * up; T.hX = -.3 * up + .3 * dn; break; }
      case 'e_hit': { const e = 1 - sm(0, 1, p); T.bX = .25 * e; T.hX = -.4 * e; break; }
      case 'e_die': { const f = sm(0, .7, p); T.bRZ = 1.5 * f; T.bY = -.3 * f; T.f = .4 * f; T.g = .4 * f; T.tail = 0; break; }
    }
    const C = blend(rig, T, dt), b = B.body;
    b.position.set(0, .5 + C.bY, C.bZ); b.rotation.set(C.bX, 0, C.bRZ); B.head.rotation.x = C.hX; B.tail.rotation.y = C.tail;
    B.legs[0].rotation.x = B.legs[3].rotation.x = C.f; B.legs[1].rotation.x = B.legs[2].rotation.x = C.g;
  },
  shroom(rig, D, ent, dt) {
    const B = rig.B, mv = ent.moving && D.cur !== 'e_die', hop = mv ? Math.abs(Math.sin(D.phase)) : 0, sw = mv ? Math.sin(D.phase) : 0, p = LOOP.has(D.cur) ? 0 : Math.min(1, D.t / CLIPS[D.cur]);
    const T = {y: hop * .14, sq: mv ? (1 - hop) * .12 : Math.sin(D.clock * 2) * .02, bX: 0, bRZ: 0, cX: 0, aX: -sw * .6, fL: sw * .5};
    switch (D.cur) {
      case 'e_atk1': { const w = env(p, 0, .3, .35), s = env(p, .3, .45, .75); T.bX = -.2 * w + .55 * s; T.aX = -1.4 * s; break; }
      case 'e_atk2': { const up = env(p, 0, .35, .45), dn = env(p, .4, .55, .85); T.y = .35 * up; T.sq = .3 * dn; T.aX = -2.4 * up; break; }
      case 'e_hit': { const e = 1 - sm(0, 1, p); T.bX = -.3 * e; T.sq = -.1 * e; break; }
      case 'e_die': { const f = sm(0, .7, p); T.sq = .6 * f; T.bRZ = .4 * f; T.cX = .3 * f; break; }
    }
    const C = blend(rig, T, dt), b = B.body;
    b.position.y = C.y; b.rotation.set(C.bX, 0, C.bRZ); b.scale.set(1 + C.sq * .6, 1 - C.sq, 1 + C.sq * .6); B.cap.rotation.x = C.cX;
    B.arms[0].rotation.x = C.aX; B.arms[1].rotation.x = D.cur.startsWith('e_atk') ? C.aX : -C.aX;
    B.legs[0].rotation.x = C.fL; B.legs[1].rotation.x = -C.fL;
  },
};
