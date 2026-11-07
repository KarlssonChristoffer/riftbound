// TROLLS LOOK: the view of the forest's trolls (features/trolls/sim.js is the truth; content/trolls.js the numbers): their
// live 3D bodies (view/troll3d.js, built in code, drawn through render/rigmesh.js by view/livebody.js, as features/brutes3d.js
// draws the brutes), their deaths, the telegraphs of their blows, the boulders and pinecones in the air, the health bars.
// VIEW only: it reads the sim's records and shots and writes its own state.
//   bodies     every record within TUNE.SIM_R of you and on screen (the stone ones too: grey rock trolls standing in the
//              woods by day); a big one's look is stone while it is ('stone', or 'freezing' / 'waking' at stone >= .5)
//   facing     the record's world facing (r.face) in 16 steps relative to the camera, held within .6 of a step
//   pose       view/troll3d.js trollPose from the record's state (st, atk, at / dur, gait, stone, hold, the hit), in whole
//              steps (the pose key), re-posed only when a step changes; the prop (the lifted rock, a pinecone in hand) drawn
//              only when the key says (bit 0)
//   rider      a small one with r.mount sits on the big one's right shoulder: placed each frame on the big body's drawn seat
//              mark (body.pointOn), facing its way
//   flash      combat's white hit flash (r.p.flash) and the aim's hover, through rigmesh's flash; eyes: two emissive points
//   death      combat breaks it (prop.break, who.kind 'troll'): the drawn pose goes to a ragdoll (view/ragdoll.js, the shared
//              rig) thrown by the last hit (combat.hit's point and way, arrow.hit's push), the club (the pinecone) tossed loose,
//              the jaw and tail riding the head and the hips; it lies LT.lie s and fades
//   telegraph  while a blow winds up (st 'wind'), a pulsing ring of glowing pixels where it lands (TYPES[type].attacks[atk].r;
//              a sweep: the arc in front, its edges), an inner ring closing out to it as the blow comes, blinking faster;
//              a boulder's landing ring stays while the rock flies
//   shots      sim.shots: a boulder as a tumbling rock body (view/troll3d.js trollRock, 10 steps a turn), a pinecone as a few
//              brown pixels
//   hd         a health bar over a hurt troll (combat's look: the lagging white chip); the big one's name over its bar
// API: createTrollLook(host, sim) -> {view(dt, evs, on), frame(f, on), hd(q, sc), clear(), count, S, corpses, models, rig, rag}
// OWNS: its rig, the models, the bodies and their state, the ragdolls. READS: sim.list / shots / recOf, host.player, yaw,
//   zoom, G (onScreen, toScreenInto, hdShift), elev, point, rgb, itemOf; combat.hit / arrow.hit / prop.break. EMITS: nothing.
// BUDGET: view; frame ~.003 ms a troll (its state, the facing, a pose on a step change ~.003, the draw), a telegraph ~70
//   points; no allocation per frame of its own (a model's buffers on its first show, a state per record once).
import {createRigMesh} from '../../render/rigmesh.js';
import {liveModel, createLiveBody} from '../../view/livebody.js';
import {createRagdolls} from '../../view/ragdoll.js';
import {trollModel, trollKey, trollPose, trollRock, rockPose} from '../../view/troll3d.js';
import {TYPES, TUNE, PALETTE} from '../../content/trolls.js';

const TAU = Math.PI * 2, STEP = TAU / 16, ROCK_STEPS = 10;
const wrap = a => a - TAU * Math.round(a / TAU), hyp = (x, y) => Math.sqrt(x * x + y * y);   // (not Math.hypot: it allocates in a per-frame loop)
const c01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
export const LT = {slots: 44, rag: 16, lie: 3, fade: .7, flash: 1.4, power: 22, hitT: .35, margin: 120, ring: '#ff6a3a', headR: {big: .28, small: .12}};
const KNOWN = {idle: 1, walk: 1, run: 1, roar: 1, wind: 1, strike: 1, recover: 1, stagger: 1, flee: 1, peek: 1, hide: 1, laugh: 1, ride: 1, stone: 1, freezing: 1, waking: 1};

export function createTrollLook(host, sim) {
  const G = host.G;
  let rig = null, rag = null, warm = null, warned = false, ci = 0, frameN = 0;
  const models = new Map();   // 'big:flesh' | 'big:stone' | 'small:flesh' | 'rock' -> {M, LM, key, rk, drop} (null: it failed)
  const pool = new Map();     // model key -> [body by slot]
  const slotUsed = new Uint8Array(LT.rag + LT.slots);
  const S = new Map();        // record -> its view state
  const EREC = new Map();     // entity -> record (the break may reach the view after the sim let go of it)
  const corpses = []; for (let i = 0; i < LT.rag; i++) corpses.push({on: false, t: 0});
  const rocks = [];           // per shot index: {body, W, T, key, blink}
  const warn = (msg, e) => { if (!warned) { warned = true; console.warn('trolls look: ' + msg, e); } };
  function setup() {
    if (rig) return;
    rig = createRigMesh(G, {slots: LT.rag + LT.slots});
    rag = createRagdolls(host, {rig});
  }
  // a model, built the first time it shows (and the ragdoll told of it)
  function modelOf(k) {
    let m = models.get(k); if (m !== undefined) return m;
    try {
      const M = k === 'rock' ? trollRock() : trollModel(k.startsWith('big') ? 'big' : 'small', k.endsWith('stone') ? 'stone' : 'flesh');
      const LM = liveModel(rig, M.J, M.bin), rk = 'troll:' + k;
      if (host.dev && LM.BN.join() !== M.names.join()) console.warn('trolls look: the poser and the body disagree on the bones');
      if (k !== 'rock') rag.adopt(rk, M.J, LM.model, {mass: TYPES[M.type].mass});
      m = {M, LM, key: k, rk, drop: M.propSeg >= 0 ? [M.propSeg] : null};
      pool.set(k, []);
      warm = (warm ?? rig.warm()).then(() => k !== 'rock' && rag.warm(rk)).catch(() => {});   // (the programs compiled off the frame)
    } catch (e) { warn(`the ${k} model failed to build (not drawn)`, e); m = null; }
    models.set(k, m);
    return m;
  }
  function stateOf(r) {
    let s = S.get(r);
    if (!s) S.set(r, s = {m: null, body: null, W: null, T: null, key: -1, f: -999, phi: 0, x: 0, y: 0, z: 0, p: null, seen: 0, mark: 0, drawn: 0, down: null, gone: null,
      hx: 0, hy: 0, hitX: undefined, hitY: undefined, hitH: undefined, power: 0, hpShow: -1, blink: 0,
      st: {type: r.type, mode: 'idle', atk: '', u: 0, gait: 0, hit: 0, hitBack: false, stone: 0, hold: false, ride: false, seed: 0, t: 0}});
    return s;
  }
  function take(m) {
    for (let i = LT.rag; i < LT.rag + LT.slots; i++) if (!slotUsed[i]) {
      slotUsed[i] = 1; const P = pool.get(m.key), b = P[i] ??= createLiveBody(m.LM, rig, i, G); b.reset(); return b;
    }
    return null;
  }
  function drop(s) { if (s.body) { slotUsed[s.body.slot] = 0; s.body = null; } s.key = -1; }
  function release(r, s) { drop(s); if (s.p) EREC.delete(s.p); S.delete(r); }
  function clear() {   // (off): the bodies, the bodies falling, the rocks gone
    for (const [r, s] of S) release(r, s);
    EREC.clear();
    for (const rs of rocks) if (rs.body) { slotUsed[rs.body.slot] = 0; rs.body = null; rs.key = -1; }
    for (let i = 0; i < corpses.length; i++) if (corpses[i].on) { corpses[i].on = false; rag?.free(i); }
  }
  const lookOf = r => r.type !== 'big' ? 'small:flesh' : r.st === 'stone' || ((r.st === 'freezing' || r.st === 'waking') && r.stone >= .5) ? 'big:stone' : 'big:flesh';

  // ---------------------------------------------------------------- the death: the drawn pose thrown by the last hit
  const HIT = {x: 0, y: 0, h: 0, dx: 0, dy: 0, power: 0}, BMO = {};
  const SO = {x: 0, y: 0, z: 0, face: 0, mats: null, hit: null, flash: 0, attach: null, drop: null, headR: 0};
  function fell(r, s) {
    if (s.body && s.m && (s.gone ?? s.seen) >= frameN - 120) {   // (never drawn, or not lately: no body to throw)
      const i = ci; ci = (ci + 1) % corpses.length; if (corpses[i].on) rag.free(i);
      let dx = s.hx, dy = s.hy;
      if (!dx && !dy) { dx = r.hitX || 0; dy = r.hitY || 0; }
      if (!dx && !dy) { dx = -Math.sin(s.phi); dy = -Math.cos(s.phi); }   // (no way known: over backward)
      const l = hyp(dx, dy) || 1, M = s.m.M;
      HIT.x = s.hitX ?? s.x; HIT.y = s.hitY ?? s.y; HIT.h = s.hitH ?? s.z + TYPES[M.type].hitH * .55; HIT.dx = dx / l; HIT.dy = dy / l; HIT.power = s.power || LT.power;
      SO.x = s.x; SO.y = s.y; SO.z = s.z; SO.face = s.phi; SO.mats = s.body.boneMats(BMO); SO.hit = HIT; SO.flash = Math.min(1, (r.p?.flash || 0) * LT.flash);
      SO.attach = M.attach; SO.headR = LT.headR[M.type];
      SO.drop = M.type === 'big' || !(s.key & 1) ? s.m.drop : null;   // (the rock never flies with it; a pinecone in hand does)
      if (rag.spawn(i, s.m.rk, SO)) { corpses[i].on = true; corpses[i].t = 0; }
    }
    // the next life starts a fresh state (its body taken again, no old blow)
    drop(s); s.f = -999; s.hx = s.hy = s.power = 0; s.hitX = s.hitY = s.hitH = undefined;
  }

  // ---------------------------------------------------------------- a troll's frame: the state, the facing, the pose, the draw
  const DRAW = {w: null, key: 0, phi: 0, x: 0, y: 0, z: 0, sx: 0, sy: 0, sh: 0, alpha: 1, flash: 0, lie: 0, type: 7, hide: null};
  const HOLD = {w: null, key: 0, phi: 0, x: 0, y: 0, z: 0, sx: 0, sy: 0, sh: 0, alpha: 1, flash: 1, lie: 0, type: 7, hide: null};
  const DRAW_HOLD = s => { HOLD.w = s.W; HOLD.key = s.key; HOLD.phi = s.phi; HOLD.x = HOLD.sx = s.x; HOLD.y = HOLD.sy = s.y; HOLD.z = HOLD.sh = s.z; HOLD.hide = s.key & 1 ? null : s.m.M.hideProp; return HOLD; };
  function poseOf(r, s, t, yaw, mount) {
    const st = s.st, T = r.T || TYPES[r.type];
    let mode = r.st;
    if (!KNOWN[mode]) mode = r.speed > T.walk * 1.3 ? 'run' : r.speed > .25 ? 'walk' : 'idle';
    else if (mode === 'ride' && !mount) mode = 'idle';
    else if (mode === 'idle' && r.speed > .25) mode = r.speed > T.walk * 1.3 ? 'run' : 'walk';
    st.type = r.type; st.mode = mode; st.atk = r.atk || ''; st.u = r.dur > 0 ? c01(r.at / r.dur) : 0; st.gait = r.gait || 0;
    st.stone = r.stone || 0; st.hold = !!r.hold; st.ride = !!mount; st.seed = r.seed || 0; st.t = t;
    const ha = r.hitAge ?? 1e9;
    st.hit = Math.max(r.p?.wob || 0, ha < LT.hitT ? 1 - ha / LT.hitT : 0);
    // the facing: the record's (a rider: its mount's as drawn), 16 steps relative to the camera, held within .6 of a step
    if (mount) { s.phi = mount.phi; s.f = -999; }
    else {
      const a = r.face || 0;
      if (!(s.f > -999) || Math.abs(wrap(a - (s.f * STEP + yaw))) > .6 * STEP) s.f = Math.round(wrap(a - yaw) / STEP);
      s.phi = s.f * STEP + yaw;
    }
    st.hitBack = (r.hitX || r.hitY) ? (r.hitX * Math.sin(s.phi) + r.hitY * Math.cos(s.phi)) > 0 : false;   // (pushed along its facing: the blow from behind)
    const key = trollKey(st);
    if (key !== s.key) { s.key = key; trollPose(s.m.M, st, s.W, s.T); }
  }
  const SEAT = [0, 0, 0];
  function drawOne(r, s, t, yaw, mount) {
    const k = lookOf(r);
    if (!s.m || s.m.key !== k) {
      drop(s);
      const m = modelOf(k); if (!m) return false;
      s.m = m; if (!s.W || s.W.length !== m.LM.NB * 7) { s.W = new Float64Array(m.LM.NB * 7); s.T = m.M.turns(); }
      s.key = -1;
    }
    s.body ??= take(s.m); if (!s.body) return false;
    poseOf(r, s, t, yaw, mount);
    if (mount) { s.x = SEAT[0]; s.y = SEAT[1]; s.z = SEAT[2]; } else { s.x = r.x; s.y = r.y; s.z = r.z ?? host.elev(r.x, r.y); }
    const it = r.p ? host.itemOf?.(r.p) : null;
    DRAW.w = s.W; DRAW.key = s.key; DRAW.phi = s.phi; DRAW.x = DRAW.sx = s.x; DRAW.y = DRAW.sy = s.y; DRAW.z = DRAW.sh = s.z;
    DRAW.flash = Math.min(1, Math.max((r.p?.flash || 0) * LT.flash, it?.hover || 0));
    DRAW.hide = s.key & 1 ? null : s.m.M.hideProp;
    s.body.draw(DRAW, t);
    s.seen = s.drawn = frameN;
    eyes(s);
    return true;
  }

  // ---------------------------------------------------------------- the glowing eyes
  const EP = [0, 0, 0], EO = {size: 1, alpha: 1, emit: true}, RGB = new Map();
  const rgb = c => { let v = RGB.get(c); if (!v) RGB.set(c, v = host.rgb(c)); return v; };
  function eyes(s) {
    const M = s.m.M; if (!M.glow || !M.eyes) return;
    const c = rgb(M.glow); EO.size = host.zoom; EO.alpha = 1;
    for (const e of M.eyes) { if (!e) continue; s.body.pointOn(e[0], e[1], e[2], e[3], EP); host.point(EP[0], EP[1], EP[2], c, EO); }
  }

  // ---------------------------------------------------------------- the telegraphs: where a blow lands, pulsing
  const PO = {size: 1, alpha: 1, emit: true};
  function pt(x, y, c, a) { PO.alpha = a; host.point(x, y, host.elev(x, y) + .05, c, PO); }
  // a ring (arc: the whole way round, or deg about the facing) of radius R at x, y; k 0..1 how near the blow is
  function ring(x, y, R, k, blink, face = 0, arc = TAU) {
    const c = rgb(LT.ring), full = arc >= TAU - 1e-3, on = (Math.floor(blink) & 1) === 0;
    PO.size = host.zoom;
    const n = Math.max(28, Math.min(40, Math.round(R * 14))), a0 = face - arc / 2, m = full ? n : n + 1;
    const A = on ? .95 : .4 + .35 * k;
    for (let i = 0; i < m; i++) { const a = a0 + arc * i / n; pt(x + Math.sin(a) * R, y + Math.cos(a) * R, c, A); }
    // the inner ring closing out to the edge as the blow comes
    const ri = R * (.15 + .85 * k), ni = Math.max(8, Math.round(n * (.3 + .7 * k)));
    for (let i = 0; i < (full ? ni : ni + 1); i++) { const a = a0 + arc * i / ni; pt(x + Math.sin(a) * ri, y + Math.cos(a) * ri, c, .35 + .3 * k); }
    if (!full) for (let j = 1; j < 7; j++) {   // a sweep's edges
      const d = R * j / 7;
      pt(x + Math.sin(a0) * d, y + Math.cos(a0) * d, c, A); pt(x + Math.sin(a0 + arc) * d, y + Math.cos(a0 + arc) * d, c, A);
    }
  }
  function telegraphs(dt, P) {
    const R2 = TUNE.SIM_R * TUNE.SIM_R;
    for (const r of sim.list) {
      if (r.st !== 'wind' || r.dead) continue;
      const A = (r.T || TYPES[r.type]).attacks?.[r.atk]; if (!A || !A.r) continue;
      const s = S.get(r); if (!s) continue;
      const x = r.aimX ?? r.x, y = r.aimY ?? r.y, dx = x - P.x, dy = y - P.y; if (dx * dx + dy * dy > R2) continue;
      const k = r.dur > 0 ? c01(r.at / r.dur) : .5;
      s.blink += dt * (3 + 13 * k);
      if (r.atk === 'sweep') ring(x, y, A.r, k, s.blink, r.face || 0, (A.arc || 160) * Math.PI / 180);
      else ring(x, y, A.r, k, s.blink);
    }
  }

  // ---------------------------------------------------------------- the shots: boulders (rock bodies), pinecones (pixels)
  const BR = TYPES.big.attacks.boulder;
  function shots(dt, t, yaw) {
    const SH = sim.shots; if (!SH) return;
    const z = host.zoom, ca = Math.cos(yaw), sa = Math.sin(yaw), rx = ca / host.PPM, ry = -sa / host.PPM, up = 1 / host.PPMH;
    for (let i = 0; i < SH.length; i++) {
      const p = SH[i], rs = rocks[i] ??= {body: null, W: null, T: null, key: -1, blink: 0};
      if (!p.on || p.kind !== 'boulder') {
        if (rs.body) { slotUsed[rs.body.slot] = 0; rs.body = null; rs.key = -1; }
        if (p.on && p.kind === 'cone') {   // a pinecone: three brown pixels, tumbling
          PO.size = z; PO.emit = false; const tw = Math.floor(p.t * 14) & 1, c1 = rgb(PALETTE.wood[1]), c2 = rgb(PALETTE.wood[3]);
          PO.alpha = 1; host.point(p.x, p.y, p.h, c1, PO); host.point(p.x, p.y, p.h + up * z, c1, PO);
          host.point(p.x + (tw ? rx : -rx) * z, p.y + (tw ? ry : -ry) * z, p.h + (tw ? 0 : up * z), c2, PO);
          PO.emit = true;
        }
        continue;
      }
      // its landing ring while it flies
      const k = c01(p.t / (p.dur || BR.flight || 1));
      rs.blink += dt * (4 + 12 * k);
      if (p.tx !== undefined) ring(p.tx, p.ty, BR.r, k, rs.blink);
      const m = modelOf('rock'); if (!m) continue;
      if (!rs.W) { rs.W = new Float64Array(m.LM.NB * 7); rs.T = m.M.turns(); }
      rs.body ??= take(m); if (!rs.body) continue;
      let q = Math.floor((p.spin || 6) * p.t / (TAU / ROCK_STEPS)) % ROCK_STEPS; if (q < 0) q += ROCK_STEPS;
      if (q !== rs.key) { rs.key = q; rockPose(m.M, q * TAU / ROCK_STEPS, rs.W, rs.T); }
      const fa = Math.atan2(p.vx || 0, p.vy || 0), phi = Math.round(wrap(fa - yaw) / STEP) * STEP + yaw;
      DRAW.w = rs.W; DRAW.key = q; DRAW.phi = phi; DRAW.x = DRAW.sx = p.x; DRAW.y = DRAW.sy = p.y; DRAW.z = DRAW.sh = p.h; DRAW.flash = 0; DRAW.hide = null;
      rs.body.draw(DRAW, t);
    }
  }

  // ---------------------------------------------------------------- the frame
  function frame(f) {
    const list = sim.list; if (!list || (!list.length && !S.size && !rig)) return;
    setup(); frameN++;
    const t = f.t, yaw = host.yaw, P = host.player, R2 = TUNE.SIM_R * TUNE.SIM_R;
    let n = 0;
    for (const r of list) {
      const s = stateOf(r); s.mark = frameN; n++;
      if (s.p !== r.p) { if (s.p) EREC.delete(s.p); s.p = r.p || null; if (s.p) EREC.set(s.p, r); }
      if (r.dead || r.st === 'dead') {   // (down: its body held as it was until the break reaches the view: the ragdoll takes over)
        s.down ??= frameN;
        if (s.body && frameN - s.down > 90) drop(s);
        else if (s.body && s.m) { s.seen = frameN; s.body.draw(DRAW_HOLD(s), t); }
        continue;
      }
      s.down = null; s.gone = null;
      if (r.mount) continue;   // (the riders after their mounts: they sit on the drawn shoulder)
      const dx = r.x - P.x, dy = r.y - P.y, T = r.T || TYPES[r.type];
      if (dx * dx + dy * dy > R2 || !G.onScreen(r.x, (r.z || 0) + T.hitH * .5, r.y, LT.margin)) { drop(s); continue; }
      drawOne(r, s, t, yaw, null);
    }
    for (const r of list) {
      if (!r.mount || r.dead || r.st === 'dead') continue;
      const s = S.get(r), sb = S.get(r.mount), seat = sb?.m?.M.seat;
      if (!s || !sb || sb.drawn !== frameN || !seat || !sb.body) { if (s) drop(s); continue; }
      sb.body.pointOn(seat[0], seat[1], seat[2], seat[3], SEAT);
      drawOne(r, s, t, yaw, sb);
    }
    // gone from the sim's list (a dead one's break reaches the view a little later: the state waits for it a while)
    if (S.size > n) for (const [r, s] of S) if (s.mark !== frameN) { s.gone ??= frameN; if (frameN - s.gone > 90) release(r, s); }
    telegraphs(f.dt || 1 / 60, P);
    shots(f.dt || 1 / 60, t, yaw);
    rag.frame(f.dt);
    rig.render();
  }

  // ---------------------------------------------------------------- the health bars (combat's look), the big one's name
  const SC = [0, 0, 0];
  function hd(q, sc) {
    if (!rig) return;
    let any = false;
    for (const r of sim.list) {
      const s = S.get(r), p = r.p; if (!s || !p || s.drawn !== frameN || r.dead || !(p.maxHp > 0)) continue;
      const hurt = p.hp < p.maxHp; s.hpShow = hurt ? Math.max(p.hp, (s.hpShow < 0 ? p.hp : s.hpShow) - p.maxHp * .012) : p.hp;
      if (!hurt) continue;
      const big = r.type === 'big';
      G.toScreenInto(s.x, s.z + (r.T || TYPES[r.type]).hitH + (big ? .25 : .3), s.y, SC);
      if (SC[0] < -1e4) continue;
      const x = SC[0] * sc, y = SC[1] * sc;
      if (!any) { q.save(); any = true; G.hdShift?.(q, sc); }   // (slid with the pixel image: the sub-pixel camera)
      const w = Math.round((big ? 20 : 10) * sc), hh = Math.max(3, Math.round(sc * (big ? 1.4 : 1.1))), x0 = Math.round(x - w / 2), y0 = Math.round(y);
      q.fillStyle = 'rgba(14,10,14,.85)'; q.fillRect(x0 - 1, y0 - 1, w + 2, hh + 2);
      q.fillStyle = '#f4efe4'; q.fillRect(x0, y0, Math.round(w * s.hpShow / p.maxHp), hh);
      q.fillStyle = '#d8483a'; q.fillRect(x0, y0, Math.round(w * Math.max(0, p.hp) / p.maxHp), hh);
      if (big) {
        const u = Math.max(.7, Math.min(2.8, sc / 2.6));
        q.font = `700 ${Math.round(10 * u)}px "Segoe UI", system-ui, sans-serif`; q.textAlign = 'center'; q.textBaseline = 'bottom'; q.lineJoin = 'round';
        q.lineWidth = Math.max(2.5, 3 * u); q.strokeStyle = 'rgba(16,10,12,.9)'; q.strokeText(TYPES.big.name, Math.round(x), Math.round(y - 3 * u));
        q.fillStyle = '#b8d08a'; q.fillText(TYPES.big.name, Math.round(x), Math.round(y - 3 * u));
      }
    }
    if (any) q.restore();
  }

  return {
    S, corpses, models, LT, get rig() { return rig; }, get rag() { return rag; }, get count() { return S.size; },
    view(dt, evs, on) {
      if (!on) { if (S.size || rig) clear(); return; }
      if (!rig) return;
      for (const e of evs) {
        if (e.type === 'combat.hit' && e.who?.kind === 'troll') {
          const r = EREC.get(e.who) ?? sim.recOf?.(e.who), s = r && S.get(r);
          if (s) { if (e.dx || e.dy) { s.hx = e.dx; s.hy = e.dy; } s.hitX = e.hx; s.hitY = e.hy; s.hitH = e.hh; }
        } else if (e.type === 'arrow.hit' && e.prop?.kind === 'troll') {
          const r = EREC.get(e.prop) ?? sim.recOf?.(e.prop), s = r && S.get(r);
          if (s) { s.power = hyp(e.vx || 0, e.vy || 0); if (!s.hx && !s.hy) { s.hx = e.vx || 0; s.hy = e.vy || 0; } }
        }
      }
      for (const e of evs) if (e.type === 'prop.break' && (e.who?.kind === 'troll' || (e.kind === 'troll' && e.who))) {
        const r = EREC.get(e.who) ?? sim.recOf?.(e.who), s = r && S.get(r); if (s) fell(r, s);
      }
      for (let i = 0; i < corpses.length; i++) {   // the bodies lie, then fade (the rig's ordered dither)
        const c = corpses[i]; if (!c.on) continue;
        c.t += dt;
        if (c.t > LT.lie + LT.fade) { c.on = false; rag.free(i); } else rag.alpha(i, c.t < LT.lie ? 1 : 1 - (c.t - LT.lie) / LT.fade);
      }
      rag.step(dt);
    },
    frame(f, on) {
      if (!on) return;
      try { frame(f); } catch (e) { warn('a frame failed', e); }   // (never out of the frame: warned once, tried again next frame)
    },
    hd(q, sc) { try { hd(q, sc); } catch (e) { warn('the bars failed', e); } },
    clear,
  };
}
