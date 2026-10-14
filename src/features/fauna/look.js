// THE FOREST ANIMALS' LOOK (view; features/fauna.js has their behaviour): each animal is a few recipe parts (content/recipes.js:
// roe_body, roe_head, roe_leg ...) posed every frame from its state: legs swinging in a walk, a trot or a bounding gallop, a head
// that drops to graze and turns to watch you, a deer lying down in cover, a hare's hops, a squirrel flat against a trunk, wings
// folded or beating. Its meshes are made the first time it comes near and kept (hidden when away or off the screen).
//   const look = createFaunaLook(host, TUNE); look.frame(animals, env); look.seen(a); look.hideAll(animals); look.drop(animals)
// OWNS: the animals' meshes (a.rig). READS: the animals' state, FAUNA_RIG (content/recipes.js), host.env (winter coats).
// Their shadows are the sun's (moving casters: off the point lights' height map, so it isn't re-rendered every frame).
import * as THREE from 'three';
import {recipeGeo} from '../../world/recipe3d.js';
import {FAUNA_RIG} from '../../content/recipes.js';

const TAU = Math.PI * 2;
export function createFaunaLook(host, TUNE) {
  const G = host.G;
  const M = new THREE.Matrix4(), B = new THREE.Matrix4(), W = new THREE.Matrix4(), Q = new THREE.Quaternion(), E = new THREE.Euler();
  const V = new THREE.Vector3(), S = new THREE.Vector3(1, 1, 1), ONE = new THREE.Vector3(1, 1, 1);
  const X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
  const biome = () => host.biome?.id || 'ruins';
  let winter = false;
  const mk = (name, params) => {
    const g = recipeGeo(name, 0, params, biome()); if (!g) return null;
    const m = host.world.mesh(g.geo); m.sm.layers.disable(1); m.setVisible(false); return m;
  };
  // the parts of each kind: [recipe, params] (legs: one recipe, its length from the rig's pivot)
  function build(a) {
    const sp = a.sp, R = FAUNA_RIG[sp], d = a.d, w = winter ? 1 : 0, parts = {legs: [], wings: []};
    if (sp === 'roe' || sp === 'fox') {
      parts.body = mk(sp + '_body', sp === 'roe' ? {winter: w} : {}); parts.head = mk(sp + '_head', sp === 'roe' ? {buck: d.buck ? 1 : 0} : {});
      for (const l of R.legs) parts.legs.push(mk(sp + '_leg', {len: l[1]}));
    } else if (sp === 'hare') { parts.body = mk('hare_body', {winter: w}); parts.head = mk('hare_head', {winter: w}); }
    else if (sp === 'squirrel') { parts.body = mk('squirrel_body', {}); parts.tail = mk('squirrel_tail', {}); }
    else {
      const cap = sp === 'capercaillie';
      parts.body = mk(cap ? 'capercaillie_body' : 'raven_body', cap ? {hen: d.hen ? 1 : 0} : {});
      for (let i = 0; i < 2; i++) parts.wings.push(mk('raven_wing', {span: cap ? (d.hen ? .5 : .62) : .5, brown: cap && d.hen ? 1 : 0}));
    }
    parts.winter = w;
    parts.all = [parts.body, parts.head, parts.tail, ...parts.legs, ...parts.wings].filter(Boolean);
    return parts;
  }
  const show = (r, v) => { if (r.vis !== v) { r.vis = v; for (const m of r.all) m.setVisible(v); } };
  const put = (m, mat) => { if (m) m.setMatrix(mat); };
  // the body's frame: at (x, ground + lift, y), facing its heading, pitched (nose up +), scaled
  function body(a, lift, pitch, s, sx = 1, sy = 1) {
    Q.setFromEuler(E.set(0, -a.hd, pitch, 'YZX'));
    B.compose(V.set(a.x, a.z + a.h + lift, a.y), Q, S.set(s * sx, s * sy, s));
    return B;
  }
  // a part at a pivot on the body (rig metres), turned by (yaw about y, then roll about z), scaled along y
  function part(pv, yaw, rz, sy = 1, rx = 0) {
    Q.setFromEuler(E.set(rx, yaw, rz, 'YZX'));
    W.compose(V.set(pv[0], pv[1], pv[2]), Q, S.set(1, sy, 1));
    return M.multiplyMatrices(B, W);
  }
  const GAITS = {walk: [0, Math.PI, Math.PI * .5, Math.PI * 1.5], trot: [0, Math.PI, Math.PI, 0], gallop: [0, .35, Math.PI, Math.PI + .35]};   // FL FR HL HR
  function quad(a, r) {
    const sp = a.sp, R = FAUNA_RIG[sp], s = a.S.s, run = a.v > (sp === 'roe' ? 3 : 2.6), lie = a.lie, t = a.ph;
    // a bound: the deer sails, the fox lopes
    const bound = run ? Math.abs(Math.sin(t * Math.PI)) * (sp === 'roe' ? .32 : .1) : 0, rock = run ? Math.sin(t * TAU) * (sp === 'roe' ? .16 : .08) : 0;
    const sink = lie * (sp === 'roe' ? .44 : .2), leap = a.leap > 0 ? Math.sin(a.leap / .45 * Math.PI) * (sp === 'roe' ? .6 : .3) : 0;   // (startled: a leap straight up)
    put(r.body, body(a, bound - sink + leap, rock + (a.pitch < -.5 && !run ? -.06 : 0), s));
    const g = run ? GAITS.gallop : sp === 'fox' && a.v > .9 ? GAITS.trot : GAITS.walk, amp = run ? .75 : Math.min(.45, a.v * .5);
    for (let i = 0; i < 4; i++) {
      const front = i < 2, sw = Math.sin(t * TAU + g[i]) * amp;
      const fold = lie * (front ? -1.5 : 1.4), sy = 1 - lie * (sp === 'roe' ? .55 : .7);
      put(r.legs[i], part(R.legs[i], 0, sw * (front ? 1 : .9) + fold, sy));
    }
    const hp = a.pitch < 0 ? a.pitch * (sp === 'roe' ? 1.35 : 1) : a.pitch * .6;
    put(r.head, part(R.neck, a.turn, hp - (run ? .25 : 0) + (lie > .5 && sp === 'roe' ? .1 : 0)));
  }
  function hare(a, r) {
    const s = a.S.s, hop = a.v > .15 ? Math.abs(Math.sin(a.ph * Math.PI)) : 0, k = a.v > 3 ? 1 : .35, up = a.st === 'alert' || a.st === 'stare';
    const sx = 1 + hop * .3 * k, sy = 1 - hop * .12 * k + (up ? .12 : 0), leap = a.leap > 0 ? Math.sin(a.leap / .45 * Math.PI) * .35 : 0;
    body(a, hop * .3 * k + leap, up ? .25 : hop * .15 * k - (a.st === 'graze' ? .08 : 0), s, sx, sy);
    put(r.body, B);
    put(r.head, part(FAUNA_RIG.hare.neck, a.turn, a.pitch * .7 + (up ? -.2 : 0)));
  }
  function squirrel(a, r) {
    const s = a.S.s, tail = Math.sin(performance.now() * .03) * .5 * a.tail;
    if (a.tree && (a.st === 'climb' || a.st === 'cling' || a.st === 'down')) {
      // flat against the trunk: its forward up (down the trunk when climbing down), its back away from the trunk
      const out = X.set(Math.cos(a.ta), 0, Math.sin(a.ta)), fwd = Y.set(0, a.st === 'down' ? -1 : 1, 0), side = Z.crossVectors(fwd, out);
      B.makeBasis(fwd, out, side).scale(S.set(s, s, s)).setPosition(a.x + out.x * .02, a.z + a.h + .35, a.y + out.z * .02);
    } else body(a, a.v > .2 ? Math.abs(Math.sin(a.ph * Math.PI)) * .08 : 0, a.pitch * .25, s);
    put(r.body, B);
    put(r.tail, part(FAUNA_RIG.squirrel.tail, 0, tail - (a.v > 2 ? .9 : 0)));
  }
  function bird(a, r) {
    const R = FAUNA_RIG[a.sp], s = a.S.s * (a.sp === 'capercaillie' && a.d.hen ? .8 : 1), air = a.h > .05 || a.st === 'flush' || a.st === 'fly' || a.st === 'circle';
    const pitch = air ? Math.max(-.4, Math.min(.5, a.vz * .12)) : a.pitch < -.5 ? -.55 : a.st === 'alert' ? .15 : 0;
    const hop = !air && a.v > .2 ? Math.abs(Math.sin(a.ph * Math.PI)) * .04 : 0;
    body(a, R.stand * s * (air ? .3 : 1) + hop, pitch, s);
    put(r.body, B);
    const fold = air ? 0 : -1.45, f = air ? (a.glide ? .12 : Math.sin(a.flap) * .85) : .1;
    const PL = PV[0], PR = PV[1];
    PL[0] = PR[0] = R.wing[0]; PL[1] = PR[1] = R.wing[1]; PL[2] = R.wing[2]; PR[2] = -R.wing[2];
    put(r.wings[0], part(PL, fold, 0, 1, -f));
    // the right wing: the left one turned over (rx pi), so it folds and beats the same way
    Q.setFromEuler(E.set(Math.PI, 0, 0)); W.compose(V.set(PR[0], PR[1], PR[2]), Q, ONE);
    wing2.makeRotationY(fold); wingF.makeRotationX(f); W.multiply(wing2).multiply(wingF);
    put(r.wings[1], M.multiplyMatrices(B, W));
  }
  const wing2 = new THREE.Matrix4(), wingF = new THREE.Matrix4(), PV = [[0, 0, 0], [0, 0, 0]];
  // is it on the screen (drawn this frame)
  const seen = a => !!a.rig?.vis;
  function frame(list, env) {
    const P = host.player, w = !!env && (env.season === 'winter' || (env.snowCover || 0) > .5);
    if (w !== winter) { winter = w; for (const a of list) if (a.rig && (a.sp === 'hare' || a.sp === 'roe') && a.rig.winter !== (w ? 1 : 0)) { for (const m of a.rig.all) m.dispose?.(); a.rig = null; } }
    for (const a of list) {
      const near = !a.gone && Math.hypot(a.x - P.x, a.y - P.y) < TUNE.DRAW_R && G.onScreen(a.x, a.z + a.h + .4, a.y, 40);
      if (!near) { if (a.rig) show(a.rig, false); continue; }
      if (!a.rig) a.rig = build(a);
      const r = a.rig;
      if (a.sp === 'roe' || a.sp === 'fox') quad(a, r); else if (a.sp === 'hare') hare(a, r); else if (a.sp === 'squirrel') squirrel(a, r); else bird(a, r);
      show(r, true);
    }
  }
  return {
    frame, seen,
    hideAll(list) { for (const a of list) if (a.rig) show(a.rig, false); },
    drop(list) { for (const a of list) a.rig = null; },   // (the world's rebuild disposed the meshes)
  };
}
