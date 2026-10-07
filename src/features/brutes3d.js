// BRUTES 3D feature: the brutes (a run's brute / elite / champion: game/enemies.js, the yard's sparring pair, the affixes'
// splits) as 3D figures (view/brute3d.js: built in code, drawn live through render/rigmesh.js by view/livebody.js) instead
// of the biome's painted card mirrored left / right (world/biomes.js brute(); ?brute3d=0 or Menu > Dev > Features > 3D
// brutes: the card). VIEW only: it reads combat's brutes (combat/core.js: position, hop, squash, wobble, flash, holds) and
// writes its own state; the card's item stays in the world (hidden: world.own) for the contact shadow and the hover.
//   facing   the brute's world facing (combat's faceW) in 16 steps relative to the camera, held within .6 of a step
//   pose     view/brute3d.js brutePose: idle, the crouch (the wind-up; an attack's fists overhead), the hop (one leg leading,
//            alternating), the landing (an attack's slam), the recoil from a blow (combat's wobble, away from where the hit
//            came), struggling held, curled up flung; in whole steps (the pose key), re-posed only when a step changes
//   flash    combat's white hit flash (and the aim's hover pulse), through rigmesh's flash
//   eyes     ember / rift / elites / champions: two emissive points on the drawn eyes (the aura's colour on an elite)
//   death    combat breaks it (prop.break): the drawn pose goes to a ragdoll (view/ragdoll.js, the shared rig) thrown by the
//            killing hit (combat.hit's point and way, arrow.hit's push), lies TUNE.lie s and fades
//   fog      a brute veiled by the fog (features/omens/fog.js: world.veil) isn't drawn
// OWNS: its rig, the models (per biome and variant), the bodies and their state, the ragdolls. READS: combat's core (brutes,
//   BS), host.player, host.world (itemOf, own, veiled), the biome's style, host.yaw. EMITS: nothing.
// BUDGET: view; frame ~.0025 ms a brute (its state, the facing, a pose on a step change, the draw: .145 ms for 62, no
//   allocation of its own); render: per model on screen A + S, one B (brute + elite + champion: 7 draws). Measured (60
//   brutes, tmp/pivot3d_chars ab): G.render 1.01 -> .92 ms against the cards. Test handles: F.S (the states), F.corpses, F.rag.
import {flags} from '../core/flags.js';
import {createRigMesh} from '../render/rigmesh.js';
import {liveModel, createLiveBody} from '../view/livebody.js';
import {createRagdolls} from '../view/ragdoll.js';
import {bruteModel, bruteKey, brutePose} from '../view/brute3d.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;
const wrap = a => a - TAU * Math.round(a / TAU), hyp = (x, y) => Math.sqrt(x * x + y * y);   // (not Math.hypot: it allocates in a per-frame loop)
const TUNE = {slots: 64, rag: 16, lie: 2.2, fade: .6, flash: 1.4, attackD: 1.7, mass: {brute: 1.5, elite: 1.9, champion: 2.8}, power: 22, eye: .5};

// ORDER (core/features.js): after combat (its brutes' step, this step's hits and breaks)
export const order = {after: ['combat']};
export async function create(host) {
  const G = host.G;
  let rig = null, rag = null, warm = null, core = null, biomeId = '';
  const models = new Map();   // 'biome:variant' -> {M (rigkit), LM (livebody), key}
  const pool = new Map();     // model key -> [body by slot]
  const slotUsed = new Uint8Array(TUNE.rag + TUNE.slots);
  const S = new Map();        // brute -> its view state
  const corpses = []; for (let i = 0; i < TUNE.rag; i++) corpses.push({on: false, t: 0});
  let ci = 0, frameN = 0;
  function setup() {
    if (rig) return;
    rig = createRigMesh(G, {slots: TUNE.rag + TUNE.slots});
    rag = createRagdolls(host, {rig});
  }
  // a variant's model for this biome, built the first time it shows (and the ragdoll told of it)
  function modelOf(variant) {
    const id = host.biome.id, k = id + ':' + variant; let m = models.get(k);
    if (m) return m;
    const M = bruteModel(host.biome.style, variant), LM = liveModel(rig, M.J, M.bin);
    if (host.dev && LM.BN.join() !== M.names.join()) console.warn('brutes3d: the poser and the body disagree on the bones');
    rag.adopt(k, M.J, LM.model, {mass: TUNE.mass[variant]});
    m = {M, LM, key: k}; models.set(k, m); pool.set(k, []);
    if (!warm) warm = rig.warm().then(() => rag.warm(k));   // (the programs compiled off the frame)
    return m;
  }
  const variantOf = b => b.boss ? 'champion' : b.elite ? 'elite' : 'brute';
  const hash = b => { const v = Math.sin(b.x * 12.9898 + b.y * 78.233) * 43758.5453; return v - Math.floor(v); };
  function stateOf(b) {
    let s = S.get(b);
    if (!s) S.set(b, s = {m: null, body: null, W: null, T: null, key: -1, f: -999, lead: 1, hop: null, attack: false, hx: 0, hy: 0, power: 0, seen: 0, gone: null, down: null, x: 0, y: 0, z: 0, phi: 0, seed: hash(b),
      st: {mode: 'idle', c: 0, u: 0, lead: 1, attack: false, hit: 0, hitBack: false, t: 0, seed: 0}});
    return s;
  }
  function take(m) {
    for (let i = TUNE.rag; i < TUNE.rag + TUNE.slots; i++) if (!slotUsed[i]) {
      slotUsed[i] = 1; const P = pool.get(m.key), b = P[i] ??= createLiveBody(m.LM, rig, i, G); b.reset(); return b;
    }
    return null;
  }
  function drop(s) { if (s.body) { slotUsed[s.body.slot] = 0; s.body = null; } s.key = -1; }
  function release(b, s) { drop(s); host.world?.own?.(b, false); S.delete(b); }
  function clear() {   // (off, or out of the brutes' world): the cards back, the bodies and the bodies falling gone
    for (const [b, s] of S) release(b, s);
    for (let i = 0; i < corpses.length; i++) if (corpses[i].on) { corpses[i].on = false; rag?.free(i); }
  }

  // ---------------------------------------------------------------- the death: the drawn pose thrown by the killing hit
  const HIT = {x: 0, y: 0, h: 0, dx: 0, dy: 0, power: 0}, BMO = {}, SO = {x: 0, y: 0, z: 0, face: 0, mats: null, hit: null, flash: 0};
  function fell(b, s) {
    if (!s.body || !s.m || (s.gone ?? s.seen) < frameN - 120) { release(b, s); return; }   // (never drawn, or not lately: no body to throw)
    const i = ci; ci = (ci + 1) % corpses.length; if (corpses[i].on) rag.free(i);
    const l = Math.hypot(s.hx, s.hy) || 1;
    HIT.x = s.hitX ?? b.x; HIT.y = s.hitY ?? b.y; HIT.h = s.hitH ?? (b.z || 0) + 1; HIT.dx = s.hx / l; HIT.dy = s.hy / l; HIT.power = s.power || TUNE.power;
    SO.x = b.x; SO.y = b.y; SO.z = b.z || 0; SO.face = s.phi; SO.mats = s.body.boneMats(BMO); SO.hit = HIT; SO.flash = Math.min(1, (b.flash || 0) * TUNE.flash);
    if (rag.spawn(i, s.m.key, SO)) { corpses[i].on = true; corpses[i].t = 0; }
    release(b, s);
  }

  // ---------------------------------------------------------------- the frame's pose of one brute
  function pose(b, s, t, yaw) {
    const m = s.m, cs = core.BS.get(b), P = host.player, st = s.st, H = cs?.hop;
    // the hop: a new one flips the leading leg and says whether it's an attack (it lands in reach of you)
    if (H && H !== s.hop) { s.hop = H; s.lead = -s.lead; s.attack = !H.fling && hyp(H.x1 - P.x, H.y1 - P.y) < (b.reach ?? .95) + .5; }
    else if (!H && s.hop) s.hop = null;
    const near = hyp(P.x - b.x, P.y - b.y) < TUNE.attackD && cs?.mode === 'aggro';
    st.mode = H?.fling ? 'fling' : H ? 'air' : (cs?.held > 0 || b.rooted) ? 'held' : cs?.land > 0 ? 'land' : (b.squash || 0) > .05 ? 'crouch' : 'idle';
    st.c = b.squash || 0; st.u = H ? Math.min(1, H.t / H.dur) : 0; st.lead = s.lead; st.t = t; st.seed = s.seed;
    st.attack = st.mode === 'crouch' ? near : st.mode === 'land' ? s.attack : st.mode === 'air' ? s.attack : false;
    st.hit = b.wob || 0;
    // the facing: combat's world facing, 16 steps relative to the camera, held within .6 of a step
    const fw = b.faceW || null, a = fw ? Math.atan2(fw[0], fw[1]) : 0, step = TAU / 16;
    if (!(s.f > -999) || Math.abs(wrap(a - (s.f * step + yaw))) > .6 * step) s.f = Math.round(wrap(a - yaw) / step);
    s.phi = s.f * step + yaw;
    st.hitBack = (s.hx || s.hy) ? (s.hx * Math.sin(s.phi) + s.hy * Math.cos(s.phi)) > 0 : false;   // (the blow's way along his facing: from behind)
    const key = bruteKey(st);
    if (key !== s.key) { s.key = key; brutePose(m.M, st, s.W, s.T); }
  }

  // ---------------------------------------------------------------- the glowing eyes
  const EP = [0, 0, 0], EO = {size: 1, alpha: 1, emit: true}, RGB = new Map();
  const rgb = c => { let v = RGB.get(c); if (!v) RGB.set(c, v = host.rgb(c)); return v; };
  function eyes(b, s) {
    const M = s.m.M; if (!M.glow) return;
    const c = rgb((b.elite || b.boss) && b.aura ? b.aura : M.glow); EO.size = host.zoom;
    for (const e of M.eyes) { if (!e) continue; s.body.pointOn(e[0], e[1], e[2], e[3], EP); host.point(EP[0], EP[1], EP[2], c, EO); }
  }

  const DRAW = {w: null, key: 0, phi: 0, x: 0, y: 0, z: 0, sx: 0, sy: 0, sh: 0, aim: false, alpha: 1, flash: 0, lie: 0, type: 7};
  // the last frame's draw again (a body held through the kill's hitstop): the same pose, place and flash
  const HOLD = {w: null, key: 0, phi: 0, x: 0, y: 0, z: 0, sx: 0, sy: 0, sh: 0, aim: false, alpha: 1, flash: 1, lie: 0, type: 7};
  const DRAW_HOLD = s => { HOLD.w = s.W; HOLD.key = s.key; HOLD.phi = s.phi; HOLD.x = HOLD.sx = s.x; HOLD.y = HOLD.sy = s.y; HOLD.z = HOLD.sh = s.z; return HOLD; };
  const F = {
    name: 'brutes3d', label: '3D brutes', on: flags.get('brute3d') !== '0', ms: 0, TUNE,
    get rig() { return rig; }, get rag() { return rag; }, get count() { return S.size; }, models, corpses, S,
    toggle() { F.on = !F.on; if (!F.on) clear(); return F.on; },
    view(dt, evs) {
      if (!rig) return;
      for (const e of evs) {
        if (e.type === 'combat.hit' && e.who?.kind === 'brute') { const s = S.get(e.who); if (s) { if (e.dx || e.dy) { s.hx = e.dx; s.hy = e.dy; } s.hitX = e.hx; s.hitY = e.hy; s.hitH = e.hh; } }
        else if (e.type === 'arrow.hit' && e.prop?.kind === 'brute') { const s = S.get(e.prop); if (s) { s.power = Math.hypot(e.vx, e.vy); if (!s.hx && !s.hy) { s.hx = e.vx; s.hy = e.vy; } } }
      }
      for (const e of evs) if (e.type === 'prop.break' && e.kind === 'brute' && e.who) { const s = S.get(e.who); if (s) fell(e.who, s); }
      for (let i = 0; i < corpses.length; i++) {   // the bodies lie, then fade (the rig's ordered dither)
        const c = corpses[i]; if (!c.on) continue;
        c.t += dt;
        if (c.t > TUNE.lie + TUNE.fade) { c.on = false; rag.free(i); } else rag.alpha(i, c.t < TUNE.lie ? 1 : 1 - (c.t - TUNE.lie) / TUNE.fade);
      }
      rag.step(dt);
    },
    frame(f) {
      core ??= host.feature('combat')?.core; if (!core) return;
      if (host.biome.id !== biomeId) { if (biomeId) clear(); biomeId = host.biome.id; }   // (another biome: its colours)
      const brutes = core.brutes; if (!brutes.length && !S.size && !rig) return;
      setup(); frameN++;
      const yaw = host.yaw, t = f.t, W = host.world;
      for (const b of brutes) {
        const s = stateOf(b);
        if (b.broken || b.dead || b.gone) {   // (down: its body held as it was until the break reaches the view, after the kill's hitstop: the ragdoll takes over)
          s.down ??= frameN;
          if (s.body && frameN - s.down > 90) drop(s);
          else if (s.body && s.m) { s.seen = frameN; s.body.draw(DRAW_HOLD(s), t); }
          continue;
        }
        s.down = null;
        if (!W.own(b, true)) { continue; }   // (its item isn't there yet: the card would show under the body; next frame)
        if (W.veiled(b)) { s.seen = frameN; continue; }   // (lost in the fog: not drawn)
        const v = variantOf(b);
        if (!s.m || s.m.M.variant !== v || !models.has(s.m.key)) {
          drop(s);
          try { s.m = modelOf(v); } catch (e) { console.warn('brutes3d: a model failed (the cards instead)', e); F.on = false; clear(); return; }
          s.W = new Float64Array(s.m.LM.NB * 7); s.T = s.m.M.turns(); s.key = -1;
        }
        s.body ??= take(s.m); if (!s.body) continue;
        s.seen = frameN;
        pose(b, s, t, yaw);
        const it = host.itemOf(b);
        DRAW.w = s.W; DRAW.key = s.key; DRAW.phi = s.phi; DRAW.x = DRAW.sx = s.x = b.x; DRAW.y = DRAW.sy = s.y = b.y; DRAW.z = DRAW.sh = s.z = (b.z || 0) + (b.h || 0);
        DRAW.flash = Math.min(1, Math.max((b.flash || 0) * TUNE.flash, it?.hover || 0));
        s.body.draw(DRAW, t);
        eyes(b, s);
      }
      // gone from combat's list (dead: its break reaches the view after the kill's hitstop, so the state waits for it a while)
      if (S.size > brutes.length) for (const [b, s] of S) if (s.seen < frameN - 1 && !brutes.includes(b)) { s.gone ??= frameN; if (frameN - s.gone > 90) release(b, s); }
      rag.frame(f.dt);
      rig.render();
    },
    biomeChanged() { clear(); },
  };
  return F;
}
