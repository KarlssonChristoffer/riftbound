// MIRE (docs/MIRE.md): the upland's bog, the first place that is a little hostile by itself. Its ground, pools, boardwalk and
// things are the forest plan's (world/mire.js: grown from the seed); its rules are sim/mire.js and content/mire.js (shared with
// the co-op server).
//   SIM    update: how high its water stands (the weather's spells, then the rain as it falls: sim/mire.js floodAt / floodStep),
//          frozen in winter (the lake's ice: features/ice.js thick). Him on it: soft ground takes him down when he stands still
//          ('player.sink' and 'player.speed' notes, source 'mire'); deep enough, he's held ('player.stuck') till he holds jump;
//          a shallower sink a press of jump frees. A pool takes him chest deep, slow and soaked (body.soak). A rotten plank of
//          the boardwalk breaks under him (his: it stays broken for him). The wisps of the night (which is true, where it leads:
//          the seed's) and the dig at the find: E there, everyone who reaches it once a night (online the server's: act 'dig')
//   VIEW   the pools, the wet and the frost in the ground shader (G.setMire once, setMireLook on a change), the quake round him,
//          the broken planks (the ground layer), the wisps (points, their light, the false ones' reflection in the pools), the
//          true wisp at his shoulder till dawn after the dig
// Only in the persistent world (the sandbox's ruins biome: the forest). ?mire=0 off (the hollow and its paint stay: the plan's),
// ?wisps=often every night, all day. Esc > Sandbox: Mire.
// OWNS: the modifier source 'mire', the flood, the broken planks, the dug nights (offline: pack.store('mire')), the wisps' drift.
// READS: host.player, host.env (t, seed, season, sky, part), world/layout.js FOREST (its mire), host.keys (Space), pack (give,
//   store), gear (S.worn: the mail shirt), coop (online, act, mail, net), body (soak), ice (thick), host.mods ('soft.slow').
// EMITS: mire.sink, mire.free, mire.plank, mire.dig. API: F.flood, F.frozen, F.depth (m he's down), F.night (the wisps' record)
// BUDGET: sim ~.005 ms a step (a few grid reads); the flood's spells once at the start and on a clock jump; view: a few points.
import {TUNE, findOf} from '../content/mire.js';
import {TUNE as MT} from '../world/mire.js';
import {floodAt, floodStep, nightOf, createWisps} from '../sim/mire.js';
import {createSchedule, TUNE as WXT} from '../sim/wxclock.js';
import {FOREST} from '../world/layout.js';
import {flags} from '../core/flags.js';
import {clamp, smooth} from '../core/mathx.js';
import {rgbOf} from '../core/color.js';

const M = FOREST?.mire || null;
const ON = flags.get('wx2') !== '0' && flags.get('mire') !== '0' && !!M;
const OFTEN = flags.get('wisps') === 'often';
const S = TUNE.sink, PO = TUNE.pool, W = TUNE.wisps;

// ORDER (core/features.js): after co-op (its mail this step: a dig) and the ice (its thickness); the body's soak is a call
export const order = {after: ['coop', 'ice']};

export async function create(host) {
  const game = () => host.feature('game'), pack = () => host.feature('pack'), ui = () => game()?.ui || null;
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const F = {name: 'mire', label: 'Mire', on: true, flood: 0, frozen: false, depth: 0, night: null};
  if (!M) return F;
  const wisps = createWisps(FOREST.seed, M);
  let coop = null, gear = null, ice = null, live = false, sched = null, schedSeed = NaN, lastT = NaN;
  const online = () => !!coop?.online;

  // ---- the water: the spells' rain over the last hours, then the rain as it falls
  function flood(dt) {
    const E = host.env; if (!E) return;
    if (E.seed !== schedSeed) { schedSeed = E.seed; sched = createSchedule(E.seed | 0); lastT = NaN; }
    const t = E.t, d = t - lastT;
    if (!(d >= 0 && d < 1)) F.flood = floodAt(sched, 'ruins', t, E.TUNE?.seasonDays ?? WXT.seasonDays);
    else if (d > 0) F.flood = floodStep(F.flood, (E.sky?.rain ?? 0) * ((E.sky?.storm ?? 0) > .3 ? TUNE.flood.storm : 1), d);
    lastT = t;
  }
  const softTh = () => MT.soft.th - MT.soft.flood * F.flood;
  const poolLev = () => -MT.pools.flood * F.flood;

  // ---- him on it
  const broken = new Set(); let plankWas = -1;
  let standT = 0, freeT = 0, stuck = false, spaceWas = false, key = '', sinkMsgT = 0, onMire = false;
  const SMP = {x: 0, y: 0, z: 0, phi: 0};
  function friendNear(P) {
    const C = online() ? coop.net : null; if (!C) return false;
    for (const q of C.peers.values()) { if (!q.n || !C.sample(q, SMP)) continue; if (Math.hypot(SMP.x - P.x, SMP.y - P.y) < S.friendR) return true; }
    return false;
  }
  function notes(depth, slow, held) {
    const d = Math.round(depth * 20) / 20, sp = Math.round(slow * 20) / 20, k = `${d}|${sp}|${held ? 1 : 0}`; if (k === key) return; key = k;
    const n = [];
    if (d > 0) n.push({stat: 'player.sink', add: d});
    if (sp < 1) n.push({stat: 'player.speed', mul: sp});
    if (held) n.push({stat: 'player.stuck', add: 1});
    if (n.length) host.mods.set('mire', n); else host.mods.clear('mire');
  }
  function free(P, by) {
    F.depth = 0; standT = 0; freeT = 0; stuck = false; notes(0, 1, false);
    host.events.push({type: 'mire.free', x: P.x, y: P.y, by});
  }
  function onIt(P, dt) {
    const on = !F.frozen && P.state !== 'swim' && M.k(P.x, P.y) > .05 && Math.abs(P.z - host.elev(P.x, P.y)) < .35 && !host.feature('caves')?.down;
    onMire = on;
    const space = host.keys.has(' '), press = space && !spaceWas; spaceWas = space;
    if (!on) { if (F.depth > 0 || key) { F.depth = 0; standT = 0; stuck = false; notes(0, 1, false); } return; }
    if (Math.hypot(P.x - lastX, P.y - lastY) > 3) F.depth = 0;   // (a teleport: he arrives on top)
    lastX = P.x; lastY = P.y;
    const pl = M.plankAt(P.x, P.y), q = M.poolQ(P.x, P.y), lev = poolLev(), inPool = q > lev;
    // the boardwalk: a rotten plank breaks under him (his own: it stays broken)
    if (pl >= 0 && pl !== plankWas && M.walk.rotten[pl] && !broken.has(pl) && !inPool) {
      broken.add(pl); verPlank++; F.depth = Math.max(F.depth, TUNE.plank.knee);
      host.events.push({type: 'mire.plank', x: P.x, y: P.y, i: pl});
    }
    plankWas = pl;
    const onPlank = pl >= 0 && !broken.has(pl) && !inPool, inBroken = pl >= 0 && broken.has(pl);
    const soft = !onPlank && !inPool && M.softQ(P.x, P.y) > softTh();
    const boots = 1 - (1 - S.boots) * (1 - clamp(host.mods.value('soft.slow', 1), 0, 1));   // (the moose boots' 0: half the speed of the sink)
    const moving = Math.hypot(P.vx, P.vy) > .5;
    let tgt = 0, rate = S.up;
    if (inPool) { tgt = PO.edge + (PO.chest - PO.edge) * smooth((q - lev) / .8); rate = 1.6; }
    else if (soft) {
      standT = moving ? 0 : standT + dt;
      if (standT > S.wait) { tgt = S.deep; rate = S.deep / S.time * boots; if (F.depth < .05 && sinkMsgT <= 0) { host.events.push({type: 'mire.sink', x: P.x, y: P.y}); sinkMsgT = 8; } }
      else if (moving) { tgt = Math.max(S.walk, F.depth > S.walk ? F.depth : 0); rate = S.walk; }   // (walking keeps you at the shins: deeper, you stay where you are)
      else tgt = F.depth;
    } else if (inBroken) tgt = Math.max(F.depth, TUNE.plank.knee * .8);
    sinkMsgT -= dt;
    F.depth += clamp(tgt - F.depth, -S.up * dt, rate * dt);
    if (tgt === 0 && F.depth < .005) F.depth = 0;
    // free: a press of jump while he's shallow; deeper, held till he holds it
    stuck = soft && F.depth >= S.free;
    if (stuck) {
      if (space) { const mail = gear?.S?.worn?.includes('mail_shirt'), need = (mail ? S.mail : S.hold) * (friendNear(P) ? S.friend : 1); if ((freeT += dt) >= need) { free(P, 'hold'); ui()?.float(P.x, P.y, 1.6, 'pulled free', '#d8e4c0'); return; } }
      else freeT = Math.max(0, freeT - dt * .5);
      if (stuckSaid !== true) { stuckSaid = true; ui()?.float(P.x, P.y, 1.6, 'hold Space to pull free', '#d8e4c0'); }
    } else { freeT = 0; stuckSaid = false; if (press && F.depth > 0 && !inPool) { free(P, 'jump'); return; } }
    if (inPool) body0?.soak?.(dt / PO.soak);
    const slow = inPool ? PO.wade : soft || inBroken ? 1 - (1 - S.slower) * clamp(F.depth / S.deep, 0, 1) : 1;
    notes(F.depth, slow, stuck);
  }
  let stuckSaid = false, body0 = null, lastX = 0, lastY = 0;

  // ---- the wisps and the dig
  const dug = new Set();   // nights he has dug the find of
  const store = () => pack()?.store?.('mire');
  let restored = false, digT = -1, digN = -1, digAsk = -1, follow = -1, findSaid = -1;
  function restore() { restored = true; dug.clear(); const s = store(); if (s && s.seed === FOREST.seed) for (const n of s.dug || []) dug.add(n); }
  function save() { if (online()) return; const s = store(); if (!s) return; s.seed = FOREST.seed; s.dug = [...dug].slice(-16); pack()?.dirty?.(); }
  const nightNow = () => { const t = host.env?.t ?? 0; return nightOf(t, OFTEN); };
  function nearFind(P) { const n = F.night; if (!n) return false; return Math.hypot(n.find[0] - P.x, n.find[1] - P.y) < W.reach; }
  function give(n) {
    const k = findOf(FOREST.seed, n), f = F.night?.find || [host.player.x, host.player.y];
    dug.add(n); save(); follow = n;
    pack()?.give(k, 1, {x: f[0], y: f[1], h: host.elev(f[0], f[1]) + .4});
    host.events.push({type: 'mire.dig', x: f[0], y: f[1], kind: k, n});
  }
  function mail(m) {
    if (m.k !== 'world' || typeof m.id !== 'string' || m.id[0] !== 'w' || m.s !== 'dug') return;
    const n = +m.id.slice(1); if (m.by === coop.net?.id && !m.late && digAsk === n) { digAsk = -1; give(n); }
  }
  F.onKey = k => {
    if (k !== 'e' || !live || F.night == null || digT >= 0 || host.lock) return false;
    const P = host.player; if (!nearFind(P) || dug.has(F.night.n)) return false;
    host.PL?.hold?.('crouch', W.dig); digT = 0; digN = F.night.n;
    return true;
  };

  let wasOnline = false;
  F.update = (dt) => {
    live = active();
    if (!live) { if (key) { key = ''; host.mods.clear('mire'); } F.depth = 0; return; }
    coop ??= host.feature('coop') || false; gear ??= host.feature('gear') || false; body0 ??= host.feature('body') || false; ice ??= host.feature('ice') || false;
    const ol = online(); if (ol !== wasOnline || (!ol && !restored)) { wasOnline = ol; if (!ol) restore(); else dug.clear(); }
    if (ol && coop.mail) for (const m of coop.mail) mail(m);
    flood(dt);
    F.frozen = host.env?.season === 'winter' && (ice?.thick ?? 0) > TUNE.frozen.ice;
    const n = nightNow(); F.night = n >= 0 ? wisps.night(n) : null;
    if (follow >= 0 && n !== follow) follow = -1;   // (the true wisp leaves him at dawn)
    const P = host.player;
    onIt(P, dt);
    if (digT >= 0) {
      digT += dt;
      if (P.state !== 'hold' && digT < W.dig * .8) digT = -1;   // (he moved off: no dig)
      else if (digT >= W.dig) {
        digT = -1;
        if (F.night && F.night.n === digN && !dug.has(digN)) { if (ol) { coop.act('dig', 'w' + digN, {}); digAsk = digN; } else give(digN); }
      }
    }
    if (F.night && findSaid !== F.night.n && nearFind(P) && !dug.has(F.night.n)) { findSaid = F.night.n; ui()?.float(F.night.find[0], F.night.find[1], 1, 'E  dig', '#d8f0e8'); }
  };

  // ---- VIEW: the shader's look (on a change), the wisps' drift
  let setOn = null, lookKey = '', verPlank = 1, quake = 0, vt = 0;
  const WS = [];   // per light: {s (m along its path), x, y, h, a (alpha)}
  let wN = -2;
  function pathAt(L, s, out) {
    const p = L.path; let k = 1, run = 0;
    for (; k < p.length; k++) { const l = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]); if (run + l >= s) { const f = (s - run) / (l || 1); out.x = p[k - 1][0] + (p[k][0] - p[k - 1][0]) * f; out.y = p[k - 1][1] + (p[k][1] - p[k - 1][1]) * f; return out; } run += l; }
    out.x = p[p.length - 1][0]; out.y = p[p.length - 1][1]; return out;
  }
  F.view = dt => {
    const G = host.G;
    if (!live) { if (setOn) { G.setMire(null); setOn = null; lookKey = ''; } return; }
    if (setOn !== host.world) { setOn = host.world; G.setMire({data: M.grid.data, w: M.grid.w, h: M.grid.h, x0: M.grid.x0, z0: M.grid.y0, n: M.grid.n}); lookKey = ''; }
    vt += dt;
    const P = host.player, moving = Math.hypot(P.vx, P.vy) > .5 && onMire && M.softQ(P.x, P.y) > softTh();
    quake += ((moving ? 1 : 0) - quake) * Math.min(1, dt * 4);
    const fl = Math.round(F.flood * 50) / 50, k = `${fl}|${F.frozen ? 1 : 0}`;
    if (k !== lookKey || quake > .01) { lookKey = k; G.setMireLook(fl, F.frozen ? 1 : 0, MT.soft.th - MT.soft.flood * fl, P.x, P.y, vt % 1000, quake); }
    // the wisps: they wait over the pools till he comes near, then drift ahead along their paths, keeping their distance
    const N = F.night;
    if (!N) { wN = -2; WS.length = 0; return; }
    if (wN !== N.n) { wN = N.n; WS.length = 0; for (let i = 0; i < N.lights.length; i++) WS.push({s: 0, x: N.lights[i].path[0][0], y: N.lights[i].path[0][1], a: 0, ph: i * 1.7}); }
    for (let i = 0; i < WS.length; i++) {
      const L = N.lights[i], w = WS[i], d = Math.hypot(P.x - w.x, P.y - w.y), keep = W.keep[0] + (W.keep[1] - W.keep[0]) * ((i * .37) % 1);
      const end = w.s >= L.len - .05;
      if (d < keep + 2 && !end) w.s = Math.min(L.len, w.s + W.speed * dt * (1.4 - d / (keep + 2)));
      else if (end && !L.truth && d < 2.5) { w.s = 0; w.a = 0; }   // (a false one, reached: it's gone, and back over its pool)
      pathAt(L, w.s, w);
      w.a = Math.min(1, w.a + dt * .7);
    }
  };
  // ---- drawn: the wisps (and the false ones' reflections in the pools), the broken planks, the follower
  const CORE = rgbOf('#e8fff4'), GLOW = rgbOf('#7ef0c8'), REFL = rgbOf('#5ab89a'), PT = {emit: true, size: 2, alpha: 1};
  const pt = (x, y, h, c, size, alpha) => { PT.size = size; PT.alpha = alpha; host.point(x, y, h, c, PT); };
  F.frame = f => {
    if (!live) return;
    const t = f?.t ?? 0, N = F.night;
    if (N) for (let i = 0; i < WS.length; i++) {
      const w = WS[i], L = N.lights[i]; if (w.a < .05) continue;
      const h = M.h + W.h + Math.sin(t * 1.3 + w.ph) * W.bob, a = w.a * (.75 + .25 * Math.sin(t * 5.1 + w.ph * 3));
      pt(w.x, w.y, h, CORE, 2, a); pt(w.x, w.y, h, GLOW, 4, a * .4);
      if (!L.truth && M.poolQ(w.x, w.y) > poolLev() && !F.frozen) pt(w.x, w.y, M.h + .02, REFL, 2, a * .55);   // its reflection: the true one has none
    }
    if (follow >= 0) { const P = host.player, a = t * 1.1; pt(P.x + Math.cos(a) * .55, P.y + Math.sin(a) * .4, (P.z || 0) + 1.5 + Math.sin(t * 2.3) * .08, CORE, 2, .85); }
    if (broken.size) {   // the broken planks: a dark hole where each was
      const o = host.toView(0, 0, M.h), ax = host.toView(1, 0, M.h), ay = host.toView(0, 1, M.h), q = host.glayer('ground');
      q.save(); q.setTransform(ax[0] - o[0], ax[1] - o[1], ay[0] - o[0], ay[1] - o[1], o[0], o[1]); q.fillStyle = '#1c1510';
      for (const i of broken) { const [cx, cy, dx, dy] = M.walk.planks[i]; q.save(); q.translate(cx, cy); q.rotate(Math.atan2(dy, dx)); q.fillRect(-MT.walk.plank / 2 + .04, -M.walk.w / 2 + .1, MT.walk.plank - .08, M.walk.w - .2); q.restore(); }
      q.restore();
    }
  };
  const LREC = [];
  F.lights = () => {
    LREC.length = 0; if (!live) return LREC;
    const N = F.night;
    if (N) for (let i = 0; i < WS.length; i++) { const w = WS[i]; if (w.a < .05) continue; const o = LREC[LREC.length] = WREC[i] ??= {x: 0, y: 0, h: 0, color: '#7ef0c8', radius: 3, intensity: 1, flicker: .15, id: 9800 + i}; o.x = w.x; o.y = w.y; o.h = M.h + W.h; o.intensity = .9 * w.a; }
    if (follow >= 0) { const P = host.player, o = LREC[LREC.length] = FREC; o.x = P.x; o.y = P.y; o.h = (P.z || 0) + 1.5; }
    return LREC;
  };
  const WREC = [], FREC = {x: 0, y: 0, h: 0, color: '#7ef0c8', radius: 3.5, intensity: .8, flicker: .1, id: 9810};
  F.biomeChanged = () => { setOn = null; lookKey = ''; };
  F.hud = () => live && (onMire || F.flood > .01) ? `mire: water ${(F.flood * 100) | 0}%${F.frozen ? ' · frozen' : ''}${onMire ? ` · down ${(F.depth * 100) | 0} cm${stuck ? ' · held' : ''}` : ''}${F.night ? ` · night ${F.night.n} (${F.night.kind})` : ''}` : '';
  F.menu = () => live ? [
    {label: 'Mire: take me there', run: () => { const w = M.walk.pts[0]; host.teleport(w[0], w[1]); }},
    {label: 'Mire: to the bog body', run: () => { if (M.body) host.teleport(M.body.x + 1.6, M.body.y + 1.2); }},
    {label: 'Mire: dusk now (the wisps)', run: () => { if (!online()) host.env?.setHour?.(W.from + .2); }},
    {label: 'Mire: to the night\'s find', run: () => { const N = F.night || wisps.night(Math.max(0, nightOf((host.env?.t ?? 0) + 24, true))); host.teleport(N.find[0] + 1, N.find[1]); }},
    {label: `Mire: flood it (water ${(F.flood * 100) | 0}%)`, run: () => { F.flood = F.flood > .5 ? 0 : 1; lastT = host.env?.t ?? 0; }},
  ] : [];
  F.state = () => ({flood: F.flood, frozen: F.frozen, depth: F.depth, stuck, onMire, night: F.night?.n ?? -1, find: F.night?.find, broken: broken.size, dug: [...dug]});
  return F;
}
