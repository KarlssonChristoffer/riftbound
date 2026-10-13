// THE UNCANNY FOREST (docs/UNCANNY.md): the forest's second life, after dark. Unease and wonder, no jump scares.
//   the night shift   at dusk a handful of trees and boulders walk a couple of metres (each at an hour of its own, a slow slide
//                     you can catch happening), a different handful every night, the same for everyone; at dawn they slide home
//   the heron         by day a grey heron stands by the lake, perfectly still; its head follows you, all the way round. At dusk
//                     it sinks into the shore and a ring of pale mushrooms rises where it stood; in the ring at night your
//                     shadow is a heron's
//   the elk           by day it walks its way through its patch of the woods (now and then backwards, its legs swinging as if
//                     it walked forwards). At dusk it grows wrong: longer legs, a longer neck. At night it stalks whoever is in
//                     its patch, trunk to trunk, closer every time they stop; close enough, it knocks them down and they drop
//                     something (it lies where they fell: walk over it to pick it up). The settlement's light, or leaving its
//                     patch, lets you go; it stands at the edge and stares after you
//   the secrets       (sim/uncanny.js) the heron's ring: two players standing in it together at night; the quiet stones (your
//                     steps make no sound inside them): stand in the middle at night, lantern out, still, a while; the pale
//                     marks on trunks, seen only by lantern light at night: follow them to the hollow under an old windthrow's
//                     roots. Each opens once (a low hum, a keepsake in the pouch of whoever opened it), then sleeps for a few nights
// SIM vs VIEW: update moves the walkers (from the clock: world/uncanny.js), runs the secrets and the elk offline (sim/uncanny.js,
// its draws from the feature's own generator), or follows the co-op server's (coop.mail: it owns them in a shared world), the
// knocks, the drops and the pick-ups, the quiet steps (host.mods 'audio.steps'). view / frame (features/uncanny/look.js) draw it all.
// MULTIPLAYER: the server owns the clock, the secrets' states and who opened them, and the elk; the walkers come from the clock.
// Private to each player: the heron's gaze (it watches YOU), the marks' look, what the elk made you drop (only you see it).
// FEATURE CONTRACT (main.js): create(host) -> F: update, view, frame, lights, hud, menu, settings, biomeChanged, toggle.
// OWNS: the walkers' x / y / z while they walk (dev/owncheck.js), the offline secrets / elk, the drops, the modifier source
//   'uncanny', its saved part of the pack (pack.store('uncanny')). READS: host.env (the clock), host.player, host.lantern,
//   host.layout.forest, host.entities, coop (mail, act, the elk's snapshots). EMITS: uncanny.hum, uncanny.slide, uncanny.knock.
// BUDGET: update ~.02 ms (the walkers only while they slide; the elk's brain; a few distances); view / frame: a dozen matrices.
// ON / OFF: off by default. Esc > Game > World > Uncanny forest switches it (remembered on this machine; ?uncanny=1 / 0 / dev
// override that). In co-op the server decides (its --uncanny): the walkers move colliders, so everyone has it or no one does.
// Switches: ?uncanny=1 | 0 | dev (on, with markers), ?nshift, ?nelk, ?nnotice (core/flags.js); ?time=night, ?daymin (sim/env.js).
import {flags} from '../core/flags.js';
import {mulberry32, simSeed} from '../core/rng.js';
import {ITEMS} from '../content/items.js';
import {uncannyPlan, nightK, nightNo, shiftK} from '../world/uncanny.js';
import {createSecrets, createStalker, SECRETS, SECRET_IDS, SEC, MODES, placeOf} from '../sim/uncanny.js';
import {createUncannyLook} from './uncanny/look.js';

const MODE = flags.get('uncanny'), num = (v, d) => v !== null && isFinite(+v) ? +v : d;
export const TUNE = {
  shift: num(flags.get('nshift'), 1),     // the night shift's strength (knob)
  elk: num(flags.get('nelk'), 1),         // how often the elk hunts (knob)
  notice: num(flags.get('nnotice'), 1),   // how far the odd things show (knob: look.js)
  quiet: .1,        // x the footsteps' gain inside the quiet stones
  still: .25,       // m/s that counts as standing still (the stones)
  hear: 18,         // m: a walker starting its slide this near is heard
  pick: 1,          // m from a dropped thing that picks it back up
  pickWait: 1.5,    // s after the knock before it can be
  up: 3.2,          // m/s the knock throws you up
  ask: 2,           // s between two asks of the server (co-op)
};
const KEEPS = SECRET_IDS.map(id => SECRETS[id].keep);

export const order = {after: ['coop', 'pack']};
export async function create(host) {
  const FP = host.layout?.forest;
  if (!FP || MODE === '0') return {name: 'uncanny', label: 'Uncanny forest', on: false};
  const U = uncannyPlan(FP, {shift: TUNE.shift});
  const R = mulberry32(simSeed());   // (the sim's own draws: the elk's, what you drop)
  const env = host.env, pack = () => host.feature('pack'), coop = () => host.feature('coop');
  const online = () => !!coop()?.online;
  const F = {name: 'uncanny', label: 'Uncanny forest', on: MODE === '1' || MODE === 'dev', U, TUNE, dev: MODE === 'dev',
    k: 0, night: 0, st: null, me: 0, flash: {heron: 0, stones: 0, marks: 0}, elk: {x: 0, y: 0, phi: 0, mode: 'day', tid: -1, ok: false},
    dropped: [], lit: false, inStones: false, stillT: 0, ringFriend: false, walkers: null};

  // ---------------------------------------------------------------- the walkers: the props tonight's shift moves
  // (by their place as the forest grew them: a tree's or a boulder's F.props entry; one key a prop, made as it joins)
  const byKey = new Map();
  host.entities.query('uncanny.walkers', p => (p.kind === 'tree' && typeof p.fid === 'string') || p.kind === 'rock_big', p => { byKey.set(p.x + ',' + p.y, p); });
  let curN = null, cur = [], curP = [], curK = new Float32Array(0);
  const put = (p, x, y, jump) => {
    if (!p || !host.entities.has(p)) return;
    p.x = x; p.y = y; p.z = host.elev(x, y);
    if (jump) host.entities.moved(p);
  };
  function shift(t) {
    const n = nightNo(t);
    if (n !== curN) {   // a new night (or a jump in time): last night's walkers home, tonight's list
      for (let j = 0; j < cur.length; j++) if (curK[j] > 0) put(curP[j], cur[j].x0, cur[j].y0, true);
      curN = n; cur = U.shift(n); curP = cur.map(m => byKey.get(m.x0 + ',' + m.y0) || null); curK = new Float32Array(cur.length);
      F.walkers = cur;
    }
    const P = host.player;
    for (let j = 0; j < cur.length; j++) {
      const m = cur[j], k = shiftK(m, t), was = curK[j];
      if (k === was) continue;
      curK[j] = k;
      const x = m.x0 + (m.x1 - m.x0) * k, y = m.y0 + (m.y1 - m.y0) * k;
      put(curP[j], x, y, Math.abs(k - was) > .35);   // (a jump in the clock: no slide drawn across)
      if ((was === 0 || was === 1) && k > 0 && k < 1 && Math.hypot(x - P.x, y - P.y) < TUNE.hear) host.events.push({type: 'uncanny.slide', x, y, kind: m.kind});
    }
  }

  // the players as the rules see them offline: this one (and, dev, a pretend friend standing in the heron's ring)
  const ME = {id: 0, x: 0, y: 0}, FRIEND = {id: -2, x: 0, y: 0}, PLAYERS = [ME], PLAYERS2 = [ME, FRIEND];

  // ---------------------------------------------------------------- the secrets: offline the rules run here, online the server's
  const saved = pack()?.store?.('uncanny') || {};
  const S = createSecrets(U);
  if (saved.sec) S.load(saved.sec);
  const mirror = Object.fromEntries(SECRET_IDS.map(id => [id, {s: 'sleeping', by: [], n: -1000}]));
  F.st = S.st;
  const save = () => { const pk = pack(); if (!pk?.store) return; const o = pk.store('uncanny'); o.sec = S.toJSON(); o.dropped = F.dropped.map(d => [d.id, +d.x.toFixed(2), +d.y.toFixed(2)]); pk.dirty(); };
  for (const d of Array.isArray(saved.dropped) ? saved.dropped : []) if (ITEMS[d[0]]) F.dropped.push({id: d[0], x: +d[1], y: +d[2], t: 0});
  function changed(c, late) {   // a secret's state changed (offline: S.tick / S.ask; online: the server's sec)
    if (online()) { const q = mirror[c.id]; if (!q) return; q.s = c.s; q.by = c.by || []; q.n = c.n; }
    if (c.s !== 'triggered' || late) { if (!online()) save(); return; }
    const w = placeOf(U, c.id); F.flash[c.id] = SEC.show;
    host.events.push({type: 'uncanny.hum', x: w.x, y: w.y, id: c.id});
    if (c.by.includes(F.me)) pack()?.give?.(SECRETS[c.id].keep, 1, {x: host.player.x, y: host.player.y, h: 1.4});
    if (!online()) save();
  }
  let askT = 0;
  function ask(id, t) {
    if (online()) { if (askT > 0) return; askT = TUNE.ask; coop().act('secret', id); return; }
    const c = S.ask(id, ME, t); if (typeof c !== 'string') changed(c, false);
  }

  // ---------------------------------------------------------------- the elk: offline its brain runs here, online the server's
  const K = createStalker(U, R, {get often() { return TUNE.elk; }});
  const ELK = {x: 0, y: 0, z: 0, phi: 0, s: 0, pose: 0};
  function knocked(e) {
    const P = host.player;
    if (!host.launch(e.vx, e.vy, TUNE.up)) host.knock(e.vx, e.vy);
    // it makes you drop something: a keepsake first, else something from the pouch
    const pk = pack(); let drop = null;
    if (pk?.count) {
      for (const id of KEEPS) if (pk.count(id) > 0) { drop = id; break; }
      if (!drop) { const have = []; for (const id in ITEMS) if (ITEMS[id].kind === 'material' && pk.count(id) > 0) have.push(id); if (have.length) drop = have[Math.floor(R() * have.length)]; }
      if (drop && pk.take(drop, 1)) F.dropped.push({id: drop, x: P.x + e.vx * .12, y: P.y + e.vy * .12, t: TUNE.pickWait}); else drop = null;
    }
    host.events.push({type: 'uncanny.knock', x: P.x, y: P.y, vx: e.vx, vy: e.vy, drop});
    if (drop) save();
  }

  // ---------------------------------------------------------------- the sim step
  let lastX = NaN, lastY = NaN, lantern = 0, wasOnline = false;
  if (host.mods) { const f = () => { lantern = host.mods.value('light.lantern', 0); }; host.mods.watch(f); f(); }
  F.update = (dt) => {
    const on = online();
    if (on && F.on !== !!coop().net.unc) F.toggle(true);   // (co-op: the server's world has it or it doesn't)
    if (!F.on || !env) return;
    const t = env.t, P = host.player;
    F.k = nightK(t); F.night = nightNo(t);
    shift(t);
    const v = isNaN(lastX) ? 0 : Math.hypot(P.x - lastX, P.y - lastY) / dt; lastX = P.x; lastY = P.y;
    ME.x = P.x; ME.y = P.y;
    // co-op: who we are, the server's word on the secrets and the knocks (coop.mail: this step's)
    if (on !== wasOnline) { wasOnline = on; F.st = on ? mirror : S.st; const C = coop()?.net; F.me = on ? C.id : 0; ME.id = F.me; if (on && C.unc) U.setStrength(C.unc.shift); else U.setStrength(TUNE.shift); curN = null; }
    if (on) {
      for (const m of coop().mail) {
        if (m.k === 'sec') changed(m, !!m.late);
        else if (m.k === 'ev' && m.a === 'knock' && m.id === F.me) knocked(m);
      }
      const C = coop().net; if (C.sample(C.elk, ELK)) { const E = F.elk; E.x = ELK.x; E.y = ELK.y; E.phi = ELK.phi; E.mode = MODES[ELK.s] || 'day'; E.tid = ELK.pose; E.ok = true; }
    } else {
      if (F.ringFriend && U.heron) { FRIEND.x = U.heron.x + .4; FRIEND.y = U.heron.y; }   // (dev: a pretend friend in the ring)
      for (const c of S.tick(dt, t, F.ringFriend ? PLAYERS2 : PLAYERS)) changed(c, false);
      if (K) { for (const e of K.step(dt, t, PLAYERS)) if (e.id === ME.id) knocked(e); const E = F.elk; E.x = K.x; E.y = K.y; E.phi = K.phi; E.mode = K.mode; E.tid = K.tid; E.ok = true; }
    }
    if (askT > 0) askT -= dt;
    for (const id of SECRET_IDS) if (F.flash[id] > 0) F.flash[id] -= dt;
    // the quiet stones: no footsteps inside them; the secret: in the middle, the lantern out, still
    const st = U.stones, lit = F.lit = host.lantern || lantern > 0;
    if (st) {
      const d = Math.hypot(P.x - st.x, P.y - st.y), inside = d < st.r - .25;
      if (inside !== F.inStones) { F.inStones = inside; if (inside) host.mods?.set('uncanny', [{stat: 'audio.steps', mul: TUNE.quiet}]); else host.mods?.clear('uncanny'); }
      F.stillT = F.st.stones.s === 'awake' && d < SECRETS.stones.r && !lit && v < TUNE.still ? F.stillT + dt : 0;
      if (F.stillT >= SECRETS.stones.hold) { F.stillT = 0; ask('stones', t); }
    }
    // the marks' hollow: reached by lantern light at night
    const H = U.hollow;
    if (H && F.st.marks.s === 'awake' && lit && Math.hypot(P.x - H.x, P.y - H.y) < SECRETS.marks.r) ask('marks', t);
    // what the elk made you drop: walk over it
    for (let i = F.dropped.length - 1; i >= 0; i--) {
      const d = F.dropped[i]; if (d.t > 0) { d.t -= dt; continue; }
      if (Math.hypot(P.x - d.x, P.y - d.y) < TUNE.pick) { F.dropped.splice(i, 1); pack()?.give?.(d.id, 1, {x: d.x, y: d.y, h: .3}); save(); }
    }
  };

  // ---------------------------------------------------------------- the view
  const look = createUncannyLook(host, F);
  F.view = dt => { if (F.on) look.view(dt); };
  F.frame = f => { if (F.on) look.frame(f); };
  F.lights = () => look.lights();
  F.biomeChanged = () => look.drop();
  F.toggle = server => {
    if (online() && !server) return F.on;   // (co-op: the server's --uncanny decides)
    F.on = !F.on;
    if (!F.on) { look.hide(); host.mods?.clear('uncanny'); F.inStones = false; for (let j = 0; j < cur.length; j++) if (curK[j] > 0) put(curP[j], cur[j].x0, cur[j].y0, true); curN = null; cur = []; }
    return F.on;
  };
  F.hud = () => {
    if (!F.on) return '';
    const s = SECRET_IDS.map(id => id + ' ' + F.st[id].s).join(', ');
    return `uncanny: night ${F.night} k ${F.k.toFixed(2)} · walkers ${cur.length} · elk ${F.elk.mode}${F.elk.tid >= 0 ? ' on #' + F.elk.tid : ''} · ${s}${F.dropped.length ? ' · dropped ' + F.dropped.length : ''}`;
  };
  // the knobs (Dev > World): the shift's strength, how far things show; the dev rows: go to each place, the time, a pretend friend
  F.settings = () => [
    {label: 'Night shift strength', min: 0, max: 3, step: .25, get: () => U.strength, set: v => { if (!online()) { TUNE.shift = v; U.setStrength(v); curN = null; } }},
    {label: 'Odd things notice distance', min: .25, max: 3, step: .25, get: () => TUNE.notice, set: v => { TUNE.notice = v; }},
    {label: 'Night elk hunts', min: 0, max: 3, step: .5, get: () => TUNE.elk, set: v => { TUNE.elk = v; }},
  ];
  const go = (x, y) => host.teleport(x, y + 2.5);
  const time = part => { if (online()) coop().act('time', part); else env.setPart(part); };
  F.menu = () => !F.on ? [] : [
    {label: 'Uncanny: dusk', run: () => time('dusk')}, {label: 'Uncanny: night', run: () => time('night')}, {label: 'Uncanny: dawn', run: () => time('dawn')},
    ...(U.heron ? [{label: 'Uncanny: go to the heron', run: () => go(U.heron.x, U.heron.y)}] : []),
    ...(U.stones ? [{label: 'Uncanny: go to the quiet stones', run: () => go(U.stones.x, U.stones.y)}] : []),
    ...(U.marks.length ? [{label: 'Uncanny: go to the first pale mark', run: () => { const p = FP.props[U.marks[0].i]; go(p[1], p[2]); }}] : []),
    ...(U.elk ? [{label: "Uncanny: go to the elk's patch", run: () => go(U.elk.x, U.elk.y)}] : []),
    {label: `Uncanny: a pretend friend in the heron's ring (${F.ringFriend ? 'on' : 'off'})`, run: () => { F.ringFriend = !F.ringFriend; }},
    {label: 'Uncanny: wake every secret (offline)', run: () => { if (online()) return; for (const id of SECRET_IDS) { const q = S.st[id]; q.s = F.k >= SEC.night ? 'awake' : 'sleeping'; q.n = -1000; } save(); }},
  ];
  return F;
}
