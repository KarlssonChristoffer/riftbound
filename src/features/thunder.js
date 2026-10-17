// THUNDER (docs/WEATHER.md "Thunder and fire"): natural lightning with rules, and the trees it sets alight. In a storm a bolt
// comes down now and then near you: it picks what draws it most (content/thunder.js: the tallest lone tree, a tor's top, you
// out on the fell, iron on you), marks it for TUNE.tele s (your hair's crackle, a blue glint on iron, sparks at a tree's top),
// then strikes. What it does to what it hits is content/thunder.js STRIKE (a tree catches and burns, then stands charred till
// the spring, now and then a splinter of thunderwood at its foot; you: hurt, knocked flat, a wool sweater smoulders). Fire
// spreads a little (never across water or rock, never more than TUNE.fire.max at once) and the rain burns it out faster.
//   SIM    offline: the rules (sim/thunder.js) run here on this feature's own clock and generator; online: the server's word
//          (coop mail: {k: 'bolt'} marks and strikes, {k: 'world', id: 'z' + fid} the trees' fires), and only the hurt to you
//          is this client's (where you stand when it strikes: get off the spot in time). EMITS thunder.mark / thunder.strike
//          (core/events.js: a future build listens), tree.burn, tree.charred, player.hurt (world: the sandbox counts it out of
//          a fight too, never below TUNE.hurt.floor: game/game.js), player.hit
//   VIEW   the marks, the bolt (features/weather.js boltAt: the flash, the thunder by its distance), sparks and a scorched
//          star, the burning trees (their meshes char: world.js mesh.burn; flames: lights.js flame; smoke; a light each),
//          the charred ones (black, leafless), the splinters, the smouldering sweater
//   BRAND  ?firestart=1 (or Esc > Sandbox): E at a burning campfire takes a burning brand (a second E adds a log as before);
//          walk it into a tree and it catches, unless the ground is wet (experimental: the same caps and spread)
// Only in the persistent forest (the sandbox's ruins with the forest's plan); ?thunder=0 or ?wx2=0: none (the storm's flashes
// as before); ?strikes= a factor on how often; ?treefire=0: struck trees char at once.
// OWNS: the bolts (marks), the trees' fire states as this client knows them (fid -> look), the brand, its pools. READS:
//   host.env (skyAt, sky, wet, t, season), host.player, caves (down), body (inHut), coop (mail, act, net), host.mods
//   ('thunder.iron', 'thunder.smoulder'), weather (boltAt, real), lights (flame), pack (give, store).
// BUDGET: sim ~.01 ms a step (a mark or two, a fire tick a second); view ~.05 ms with 8 trees burning.
import {TUNE, STRIKE, WOOD, SMOULDER} from '../content/thunder.js';
import {createThunder, nextSpring} from '../sim/thunder.js';
import {FOREST, CAVE} from '../world/layout.js';
import {TUNE as WXT} from '../sim/wxclock.js';
import {flags} from '../core/flags.js';
import {simRandom, viewRandom} from '../core/rng.js';
import {clamp, smooth} from '../core/mathx.js';

const ON = !!FOREST && flags.get('wx2') !== '0' && flags.get('thunder') !== '0';
const MUL = flags.get('strikes') !== null && +flags.get('strikes') > 0 ? +flags.get('strikes') : 1;
const TREEFIRE = flags.get('treefire') !== '0';
const TAU = Math.PI * 2;

// ORDER (core/features.js): before the campfires (E at a burning fire takes a brand first, ?firestart=1) and the lights (its
// flames are drawn with lights.flame, which must come before the lights' own frame). It reads coop's mail a step late (the
// way builds does: each message seen once)
export const order = {before: ['campfires', 'lights']};

export async function create(host) {
  const game = () => host.feature('game'), coop = () => host.feature('coop'), pack = () => host.feature('pack'), ui = () => game()?.ui || null;
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const online = () => !!coop()?.online;
  const me = () => online() ? coop().net?.id : 0;
  const R = simRandom('thunder'), V = viewRandom('thunder'), vr = (a, b) => a + V() * (b - a);
  const T = ON ? createThunder(FOREST) : null;
  let firestart = flags.get('firestart') === '1';
  const F = {name: 'thunder', label: 'Thunder and burning trees', on: ON, strikes: 0, down: false, smoulder: 0,
    get firestart() { return firestart; }, set firestart(v) { firestart = !!v; }, get brand() { return brand > 0; }};
  // the gear's notes (content/gear.js): iron on him, a sweater that smoulders (read on a change of host.mods)
  let iron = false, smoulders = false;
  const readMods = () => { iron = host.mods.value('thunder.iron', 0) > 0; smoulders = host.mods.value('thunder.smoulder', 0) > 0; };
  host.mods.watch(readMods); readMods();

  // ---- the trees as this client knows them: fid -> {s: 'burning' | 'charred', t0, t1 (s: the sim's clock offline, the server's
  // online), at (the hour it's whole again), tw (a splinter at its foot)}; the props by fid (a live query, a map on a change)
  const look = new Map();
  const treeQ = host.entities.query('thunder.trees', p => p.kind === 'tree' && typeof p.fid === 'string');
  let byFid = null, byVer = -1;
  const treeOf = fid => { if (byVer !== host.propsVersion || !byFid) { byFid = new Map(treeQ.map(p => [p.fid, p])); byVer = host.propsVersion; } return byFid.get(fid) || null; };
  let simT = 0, ver = 0;
  const now = () => online() ? (coop().net?.serverNow?.() ?? 0) / 1000 : simT;
  function setLook(fid, s, o) {
    const was = look.get(fid), e = was || {s: '', t0: 0, t1: 0, at: 0, tw: 0};
    e.s = s; if (o.t0 !== undefined) e.t0 = +o.t0; if (o.t1 !== undefined) e.t1 = +o.t1; if (o.at !== undefined) e.at = +o.at; if (o.tw !== undefined) e.tw = o.tw | 0;
    if (!was) look.set(fid, e);
    const p = treeOf(fid);
    if (s === 'burning' && was?.s !== 'burning' && !o.late) host.events.push({type: 'tree.burn', x: p?.x ?? 0, y: p?.y ?? 0, id: fid});
    if (s === 'charred' && was?.s === 'burning' && !o.late) host.events.push({type: 'tree.charred', x: p?.x ?? 0, y: p?.y ?? 0, id: fid});
    ver++;
  }
  function unLook(fid) { if (!look.delete(fid)) return; host.itemOf(treeOf(fid))?.live?.burn?.(0, 0, 0, 0); ver++; }
  function clearLooks() { for (const fid of [...look.keys()]) unLook(fid); T?.burning.clear(); T?.charred.clear(); marks.length = 0; }

  // ---- offline: the save (pack.store('thunder'): {seed, c: {fid: [the hour it's whole again, tw]}}: a burning tree is saved charred)
  const store = () => pack()?.store('thunder');
  function save() {
    const s = store(); if (!s || online()) return;
    s.seed = FOREST.seed; s.c = {};
    for (const [fid, e] of look) s.c[fid] = [+(e.s === 'charred' ? e.at : nextSpring(host.env?.t ?? 0, WXT.seasonDays)).toFixed(3), e.tw];
    pack().dirty();
  }
  function restore() {
    const s = store(); if (!s?.c || s.seed !== FOREST.seed) return;
    for (const fid in s.c) { const [at, tw] = s.c[fid]; if (!T.tree(fid)) continue; T.charred.add(fid); setLook(fid, 'charred', {at, tw, late: true}); }
  }

  // ---- the bolts on their way: {n, kind, id, x, y, h, t (s left), tele}
  const marks = [];
  const MK = Array.from({length: 6}, () => ({on: false, n: 0, kind: '', id: '', x: 0, y: 0, h: 0, t: 0, tele: 1}));
  let nB = 0;
  function mark(n, kind, id, x, y, h, tele) {
    const m = MK.find(q => !q.on); if (!m) return;
    m.on = true; m.n = n; m.kind = kind; m.id = id; m.x = x; m.y = y; m.h = h; m.t = tele; m.tele = tele; marks.push(m);
    host.events.push({type: 'thunder.mark', x, y, h, kind, id, tele});
  }
  // the strike: what it hits (offline: the rules; online: the server already did the tree), and you if you're under it
  const near = [], AIM = {kind: '', id: '', x: 0, y: 0, h: 0}, PLS = [{id: 0, x: 0, y: 0, z: 0, iron: false, safe: false}];
  const safeHere = () => !!host.feature('caves')?.down || !!host.feature('body')?.inHut;
  function strike(kind, id, x, y, h) {
    F.strikes++;
    if (!online() && kind === 'tree' && T.tree(id)) {
      const S = STRIKE.tree, tw = R() < (S.wood || 0) ? 1 : 0;
      if (S.burn && TREEFIRE && T.ignite(id, simT, R)) { const b = T.burning.get(id); setLook(id, 'burning', {t0: b.at, t1: b.t1, tw}); }
      else { T.charred.add(id); setLook(id, 'charred', {at: nextSpring(host.env.t, WXT.seasonDays), tw}); }
      save();
    }
    // you: within r of it a direct hit, within near a graze (not in the cave, the hut, a roll's i-frames, up a ladder)
    const P = host.player, d = Math.hypot(P.x - x, P.y - y), g = host.elev(x, y);
    let hit = 0;
    if (d < TUNE.near && !safeHere() && !P.untouchable && P.state !== 'climb' && Math.abs(P.z - g) < 2.5) {
      hit = d < TUNE.r ? 1 : smooth(1 - (d - TUNE.r) / (TUNE.near - TUNE.r)) * .5;
      const direct = d < TUNE.r, ux = d > .05 ? (P.x - x) / d : 0, uy = d > .05 ? (P.y - y) / d : 1, th = direct ? TUNE.throw.direct : TUNE.throw.graze;
      if (!(th[1] > 0 && host.launch(ux * th[0], uy * th[0], th[1]))) host.knock(ux * th[0], uy * th[0]);
      host.events.push({type: 'player.hit', x: P.x, y: P.y, vx: ux * 5, vy: uy * 5, player: true});
      host.events.push({type: 'player.hurt', dmg: Math.round(direct ? TUNE.hurt.direct * (STRIKE.player.hurt || 1) : TUNE.hurt.graze), by: 'lightning', world: true, floor: TUNE.hurt.floor, x: P.x, y: P.y});
      if (direct) { downT = 2; if (smoulders) F.smoulder = SMOULDER; }
      host.hitstop(.06);
    }
    host.shake(d < 6 ? 5 : d < 14 ? 3 : 1, d < 6 ? .35 : .2);
    host.events.push({type: 'thunder.strike', x, y, h, kind, id, k: hit ? clamp(1 - d / TUNE.near, 0, 1) : 1, you: hit > 0});
    struck(x, y, h, kind);
  }
  let downT = 0, boltT = TUNE.every[1], tickT = 0, saveT = 0, springT = 0, wasOn = false, wasOnline = false;
  // the server's word (coop mail): bolts and the trees' fires
  function mail(m) {
    if (m.k === 'bolt') {
      if (m.a === 'mark') mark(m.n, m.kind, m.kind === 'player' ? +m.id : String(m.id), +m.x, +m.y, +m.h, +m.tele || TUNE.tele);
      else if (m.a === 'strike') {
        for (let i = marks.length - 1; i >= 0; i--) if (marks[i].n === m.n) { marks[i].on = false; marks.splice(i, 1); }
        strike(m.kind, String(m.id), +m.x, +m.y, +m.h);
      }
      return;
    }
    if (m.k !== 'world' || typeof m.id !== 'string' || m.id[0] !== 'z') return;
    const fid = m.id.slice(1);
    if (m.s === 'grown') unLook(fid);
    else if (m.s === 'burning' || m.s === 'charred') setLook(fid, m.s, m);
    else if (m.s === 'struck') setLook(fid, 'charred', {...m, at: 1e9, late: true});   // (a strike's first word; burning or charred follows)
    if (woodAsk === fid && m.by === me() && m.tw === 0 && !m.late) { woodAsk = ''; giveWood(fid); }   // (the splinter you asked for: 'wood')
  }
  function giveWood(fid) { const p = treeOf(fid); pack()?.give(WOOD, 1, {x: p?.x ?? host.player.x, y: p?.y ?? host.player.y, h: .6}); }

  // the brand (?firestart=1): s left in his hand
  let brand = 0, woodAsk = '';
  F.update = (dt, evs) => {
    if (!ON) return;
    simT += dt;
    const on = active(), ol = online();
    if (on !== wasOn || ol !== wasOnline) {   // (online: the server's trees come in its welcome; offline: the save's)
      if (wasOn && !wasOnline) save();
      clearLooks(); wasOn = on; wasOnline = ol;
      host.feature('weather')?.real?.(on);
      if (on && !ol) restore();
    }
    if (!on) return;
    for (let k = 0; k < evs.length; k++) if (evs[k].type === 'pack.reset' && !ol) { clearLooks(); save(); }
    const c = coop(); if (ol && c.mail) for (let k = 0; k < c.mail.length; k++) mail(c.mail[k]);
    const env = host.env, P = host.player; if (!env) return;
    if (downT > 0) downT -= dt; F.down = downT > 0;
    if (F.smoulder > 0) F.smoulder = Math.max(0, F.smoulder - dt);
    // the marks count down (offline they strike here; online the server's 'strike' does, a late one gives up)
    for (let i = marks.length - 1; i >= 0; i--) {
      const m = marks[i]; m.t -= dt;
      if (m.t > (ol ? -2 : 0)) continue;
      marks.splice(i, 1); m.on = false;
      if (!ol) strike(m.kind, m.id, m.x, m.y, m.h);
    }
    if (!ol) {
      // BOLTS: while the storm is over him (and he isn't in the cave), now and then one somewhere round him
      const storm = env.skyAt ? env.skyAt(P.x, P.y, 'storm') : env.sky.storm;
      if (storm >= TUNE.storm && !host.feature('caves')?.down) {
        if ((boltT -= dt * MUL) <= 0) {
          boltT = TUNE.every[0] + R() * (TUNE.every[1] - TUNE.every[0]);
          const a = R() * TAU, d = Math.sqrt(R()) * TUNE.reach, Q = PLS[0];
          Q.x = P.x; Q.y = P.y; Q.z = P.z; Q.iron = iron; Q.safe = safeHere();
          const t = T.aim(P.x + Math.cos(a) * d, P.y + Math.sin(a) * d, PLS, R, AIM);
          if (t) mark(++nB, t.kind, t.kind === 'player' ? 0 : t.id, t.x, t.y, t.h, TUNE.tele);
        }
      } else boltT = Math.max(boltT, 2);
      // FIRE: a tick a second (the rain over him burns them out faster; the ground's wet keeps it from spreading)
      if ((tickT += dt) >= TUNE.fire.tick) {
        tickT = 0;
        T.tick(simT, env.sky.rain, env.wet, R, fid => { const b = T.burning.get(fid); setLook(fid, 'burning', {t0: b.at, t1: b.t1}); },
          fid => { setLook(fid, 'charred', {at: nextSpring(env.t, WXT.seasonDays)}); save(); });
        for (const [fid, b] of T.burning) { const e = look.get(fid); if (e) e.t1 = b.t1; }   // (the rain shortens it)
      }
      if ((springT += dt) > 2) { springT = 0; for (const [fid, e] of look) if (e.s === 'charred' && env.t >= e.at) { T.charred.delete(fid); unLook(fid); save(); } }
      if (T.burning.size && (saveT += dt) > 5) { saveT = 0; save(); }
    }
    // THUNDERWOOD: walk over a struck tree's splinter and it's yours (online: ask the server, once)
    for (const [fid, e] of look) {
      if (!e.tw) continue;
      const p = treeOf(fid); if (!p || Math.hypot(p.x + .5 - P.x, p.y + .35 - P.y) > .7) continue;
      if (!ol) { e.tw = 0; giveWood(fid); save(); ver++; }
      else if (woodAsk !== fid) { woodAsk = fid; c.act('wood', fid); }
      break;
    }
    // THE BRAND: it burns down in his hand; walked into a tree, the tree catches (not on wet ground)
    if (brand > 0) {
      brand -= dt; if (P.state === 'swim') brand = 0;
      for (const p of host.entities.near(P.x, P.y, TUNE.brand.reach, near)) {
        if (p.kind !== 'tree' || typeof p.fid !== 'string' || look.has(p.fid) || Math.hypot(p.x - P.x, p.y - P.y) > (p.r || .45) + .5) continue;
        if (env.wet > .2 || env.sky.rain > .1) { ui()?.float(p.x, p.y, 1.6, 'too wet to catch', '#9fc0e0'); brand = 0; break; }
        if (ol) c.act('ignite', p.fid);
        else if (T.ignite(p.fid, simT, R)) { const b = T.burning.get(p.fid); setLook(p.fid, 'burning', {t0: b.at, t1: b.t1}); save(); }
        brand = 0; break;
      }
    }
  };
  F.bits = () => (F.down ? 512 : 0) | (F.smoulder > 0 ? 1024 : 0);   // (features/body.js packs them with its own: content/body.js packBody)
  // E at a burning campfire takes a brand (?firestart=1), when he holds none
  const fireOf = p => p.build ? host.feature('builds')?.list.get(p.build) : null;
  const burningFire = p => { const b = fireOf(p); return b?.def.fire && host.feature('builds').fire(b).fuel > 0; };
  F.interact = p => {
    if (!active() || !firestart || brand > 0 || !burningFire(p)) return false;
    brand = TUNE.brand.life; ui()?.float(p.x, p.y, 1.3, 'a burning brand', '#ffb060'); return true;
  };
  F.prompt = p => active() && firestart && brand <= 0 && burningFire(p) ? {text: 'E  take a burning brand', color: '#ffb060'} : null;

  // ---------------------------------------------------------------- VIEW
  // sparks (a strike's, a mark's crackle), scorched stars, smoke puffs (a burning tree, a smouldering sweater)
  const SN = 220, sX = new Float32Array(SN), sY = new Float32Array(SN), sH = new Float32Array(SN), sVX = new Float32Array(SN), sVY = new Float32Array(SN), sVH = new Float32Array(SN), sT = new Float32Array(SN), sL = new Float32Array(SN), sB = new Uint8Array(SN);
  let sn = 0;
  function spark(x, y, h, sp, up, blue) {
    if (sn >= SN) return;
    const a = V() * TAU, v = vr(.3, 1) * sp, i = sn++;
    sX[i] = x; sY[i] = y; sH[i] = h; sVX[i] = Math.cos(a) * v; sVY[i] = Math.sin(a) * v * .8; sVH[i] = vr(.4, 1) * up; sT[i] = 0; sL[i] = vr(.25, .7); sB[i] = blue ? 1 : 0;
  }
  const NSC = 6, SCN = 48, scorch = Array.from({length: NSC}, () => ({t: -1, x: 0, y: 0, d: new Float32Array(SCN * 3)}));
  const MN = 80, mX = new Float32Array(MN), mY = new Float32Array(MN), mH = new Float32Array(MN), mT = new Float32Array(MN), mL = new Float32Array(MN), mR = new Float32Array(MN); let mn = 0;
  function smoke(x, y, h, r, life) { if (mn >= MN) return; const i = mn++; mX[i] = x; mY[i] = y; mH[i] = h; mT[i] = 0; mL[i] = life; mR[i] = r; }
  function struck(x, y, h, kind) {   // (from the sim's strike: the view's own randoms)
    host.feature('weather')?.boltAt?.(x, y, h);
    for (let i = 0; i < 40; i++) spark(x, y, h, vr(2, 6), vr(1.5, 4.5), i & 1);
    const sc = scorch.find(q => q.t < 0) || scorch.reduce((a, q) => q.t > a.t ? q : a);
    sc.t = 0; sc.x = x; sc.y = y;
    for (let i = 0; i < SCN; i++) { const a = (i % 7) / 7 * TAU + vr(-.25, .25), d = Math.sqrt(V()) * (kind === 'tree' ? 1.4 : 1.8) * (i < 12 ? .45 : 1); sc.d[i * 3] = Math.sin(a) * d; sc.d[i * 3 + 1] = Math.cos(a) * d * .9; sc.d[i * 3 + 2] = V() * 3 | 0; }
    flash = 1; fX = x; fY = y; fH = h;
  }
  let flash = 0, fX = 0, fY = 0, fH = 0, T0 = 0;
  const BODY = {x: 0, y: 0, z: 0, phi: 0}, LOOKB = {wet: 0, cold: 0, sunk: 0, down: false, smoulder: false};
  F.view = dt => {
    if (!ON) return;
    T0 += dt; flash = Math.max(0, flash - dt / .5);
    if (!active()) { sn = mn = 0; return; }
    for (const q of scorch) if (q.t >= 0 && (q.t += dt) > 14) q.t = -1;
    // the marks' crackle: sparks at what it picked, blue; on a player round his head (his hair stands up), more as it comes
    for (const m of marks) {
      const k = 1 - m.t / m.tele;
      let x = m.x, y = m.y, h = m.h;
      if (m.kind === 'player') { const pos = whereIs(m.id); if (!pos) continue; x = pos.x; y = pos.y; h = pos.z + 1.75; }
      if (V() < dt * (6 + 30 * k)) spark(x + vr(-.15, .15), y + vr(-.1, .1), h + vr(-.1, .15), vr(.3, .9), vr(.6, 2.2), 1);
    }
    // the burning trees: smoke off the crown, embers falling; a smouldering sweater (his, a friend's)
    for (const [fid, e] of look) {
      if (e.s !== 'burning') continue;
      const p = treeOf(fid); if (!p) continue;
      const top = (p.z || host.elev(p.x, p.y)) + (T.tree(fid)?.h ?? 8) * .75;
      if (V() < dt * 6) smoke(p.x + vr(-.8, .8), p.y + vr(-.6, .6), top + vr(-.5, .8), vr(.5, .9), vr(2.5, 4.5));
      if (V() < dt * 10) spark(p.x + vr(-1, 1), p.y + vr(-.8, .8), top + vr(-1.5, .5), vr(.2, .8), vr(-.5, .8), 0);
    }
    const P = host.player;
    if (F.smoulder > 0 && !host.playerHidden && V() < dt * 9) smoke(P.x + vr(-.15, .15), P.y + vr(-.1, .1), P.z + vr(.9, 1.3), .12, vr(.8, 1.4));
    const C = online() ? coop().net : null, body = host.feature('body');
    if (C && body?.lookOf) for (const q of C.peers.values()) {
      if (!q.n) continue; body.lookOf(q, LOOKB); if (!LOOKB.smoulder) continue;
      C.sample(q, BODY); if (V() < dt * 9) smoke(BODY.x + vr(-.15, .15), BODY.y + vr(-.1, .1), BODY.z + vr(.9, 1.3), .12, vr(.8, 1.4));
    }
    for (let i = sn - 1; i >= 0; i--) {
      sT[i] += dt;
      if (sT[i] > sL[i]) { sn--; sX[i] = sX[sn]; sY[i] = sY[sn]; sH[i] = sH[sn]; sVX[i] = sVX[sn]; sVY[i] = sVY[sn]; sVH[i] = sVH[sn]; sT[i] = sT[sn]; sL[i] = sL[sn]; sB[i] = sB[sn]; continue; }
      const k = Math.max(0, 1 - dt * 3); sVX[i] *= k; sVY[i] *= k;
      sX[i] += sVX[i] * dt; sY[i] += sVY[i] * dt; sVH[i] -= 9 * dt; sH[i] += sVH[i] * dt;
      const g = host.elev(sX[i], sY[i]); if (sH[i] < g) { sH[i] = g; sVH[i] *= -.3; }
    }
    for (let i = mn - 1; i >= 0; i--) {
      mT[i] += dt; mH[i] += .7 * dt; mX[i] += .25 * dt;
      if (mT[i] >= mL[i]) { mn--; mX[i] = mX[mn]; mY[i] = mY[mn]; mH[i] = mH[mn]; mT[i] = mT[mn]; mL[i] = mL[mn]; mR[i] = mR[mn]; }
    }
  };
  const PB = {x: 0, y: 0, z: 0};
  function whereIs(id) {   // a player's feet (id 0 / yours: him; else a friend's latest)
    const P = host.player;
    if (!id || id === me()) { PB.x = P.x; PB.y = P.y; PB.z = P.z; return PB; }
    const q = coop()?.net?.peers.get(id); if (!q?.n) return null;
    coop().net.sample(q, BODY); PB.x = BODY.x; PB.y = BODY.y; PB.z = BODY.z; return PB;
  }
  const C = c => host.rgb(c), COL = {spark: [C('#ffffff'), C('#ffd890'), C('#ff9a40'), C('#8a4a20')], blue: [C('#ffffff'), C('#cfe6ff'), C('#7aa8f0'), C('#4a6ab8')],
    scorch: [C('#17110e'), C('#241b15'), C('#33281f')], wood: C('#e4d4aa'), woodD: C('#2a221c'), glint: C('#bfe2ff')};
  const SMOKE = [.36, .34, .33], P1 = {size: 1}, E1 = {size: 1, emit: true};
  // the flames' keys (lights.flame wants one object a flame): 3 a burning tree, up to TUNE.fire.max trees, and the brand's
  const FK = Array.from({length: TUNE.fire.max * 3 + 1}, () => ({}));
  F.frame = f => {
    if (!active()) return;
    const L = host.feature('lights'), flames = L?.on !== false && L?.flame ? L : null, t = now();
    // the trees' meshes: burning (char creeping up, glowing cracks, the crown going), charred (black, bare); the splinters
    let fi = 0;
    for (const [fid, e] of look) {
      const p = treeOf(fid); if (!p) continue;
      const m = host.itemOf(p)?.live, g = p.z || host.elev(p.x, p.y), H = T.tree(fid)?.h || 8;
      if (e.s === 'burning') {
        const u = clamp((t - e.t0) / Math.max(1, e.t1 - e.t0), 0, 1), fl = smooth(Math.min(1, u * 5)) * (1 - smooth((u - .75) / .25));
        m?.burn?.(.15 + .85 * smooth(u * 1.3), clamp(u * 4, 0, 1) * (.7 + .3 * Math.sin(T0 * 3 + p.x)), T0, u * .3);
        if (flames && fl > 0 && fi + 3 <= FK.length - 1) {
          flames.flame(FK[fi++], 'burn', '#ff9a40', p.x, p.y + .01, g + H * .62, 1, 1.5 * fl, 1.4 * fl);
          flames.flame(FK[fi++], 'burn', '#ffa848', p.x + .5, p.y + .2, g + H * .4, 1, 1.1 * fl, 1.1 * fl);
          flames.flame(FK[fi++], 'burn', '#ff8a30', p.x - .1, p.y + .05, g + .3, 1, .7 * fl * (1 - u), .9);
        }
      } else m?.burn?.(1, 0, 0, .25);
      if (e.tw) {   // the splinter at its foot: a pale sliver, a black edge
        const x = p.x + .5, y = p.y + .35, h = host.elev(x, y) + .03;
        host.line(x - .12, y - .02, h, x + .12, y + .03, h + .02, COL.wood); host.line(x - .1, y - .05, h, x + .1, y, h + .01, COL.woodD);
        if (((T0 * 2) | 0) % 4 === 0) host.point(x, y, h + .05, COL.glint, E1);
      }
    }
    // the brand in his hand
    if (brand > 0 && flames && !host.playerHidden) { const P = host.player, fx = Math.sin(P.faceAngle ?? 0) * .3, fy = Math.cos(P.faceAngle ?? 0) * .3; flames.flame(FK[FK.length - 1], 'torch', '#ffa040', P.x + fx, P.y + fy, P.z + 1.1, 1, .45, .6); }
    // sparks, scorches, smoke
    for (let i = 0; i < sn; i++) host.point(sX[i], sY[i], sH[i], (sB[i] ? COL.blue : COL.spark)[Math.min(3, sT[i] / sL[i] * 4 | 0)], E1);
    for (const q of scorch) {
      if (q.t < 0) continue;
      const n = Math.round(SCN * clamp(1.2 - q.t / 14, 0, 1)), g = host.elev(q.x, q.y) + .015;
      for (let i = 0; i < n; i++) host.point(q.x + q.d[i * 3], q.y + q.d[i * 3 + 1], g, COL.scorch[q.d[i * 3 + 2]], P1);
    }
    const G = host.G;
    if (G.fx) for (let i = 0; i < mn; i++) { const u = mT[i] / mL[i]; G.fx(mX[i], mH[i], mY[i], mR[i] * (.6 + u * 1.4), SMOKE, .28 * Math.sin(Math.PI * Math.min(1, u * 1.3)), 'blend'); }
    // a blue glint on iron on you while a bolt is coming for you
    if (iron && !host.playerHidden) for (const m of marks) if (m.kind === 'player' && (m.id === 0 || m.id === me()) && ((T0 * 16) | 0) % 2 === 0) { const P = host.player; host.point(P.x, P.y, P.z + 1.85, COL.glint, E1); host.point(P.x + .08, P.y, P.z + 1.7, COL.glint, E1); }
  };
  // lights: the strike's white burst, each burning tree's glow (records reused)
  const LR = Array.from({length: TUNE.fire.max + 1}, (_, i) => ({x: 0, y: 0, h: 0, color: '#ff9a48', radius: 0, intensity: 0, flicker: .6, id: 9890 + i})), LOUT = [];
  F.lights = () => {
    LOUT.length = 0; if (!active()) return LOUT;
    let i = 0;
    if (flash > 0) { const r = LR[i++]; r.x = fX; r.y = fY; r.h = fH + .5; r.color = '#dce6ff'; r.radius = 12; r.intensity = 3.4 * flash ** 1.5; r.flicker = 0; LOUT.push(r); }
    const t = now();
    for (const [fid, e] of look) {
      if (e.s !== 'burning' || i >= LR.length) continue;
      const p = treeOf(fid); if (!p) continue;
      const u = clamp((t - e.t0) / Math.max(1, e.t1 - e.t0), 0, 1), k = smooth(Math.min(1, u * 5)) * (1 - smooth((u - .75) / .25)), r = LR[i++];
      r.x = p.x; r.y = p.y; r.h = (p.z || host.elev(p.x, p.y)) + 4; r.color = '#ff9a48'; r.radius = 9 * (.5 + .5 * k); r.intensity = 1.6 * k; r.flicker = .6; LOUT.push(r);
    }
    return LOUT;
  };
  F.hud = () => active() && (look.size || marks.length) ? `thunder: ${F.strikes} strikes · ${[...look.values()].filter(e => e.s === 'burning').length} burning · ${look.size} struck${brand > 0 ? ' · brand ' + brand.toFixed(0) + ' s' : ''}` : '';
  // Esc > Sandbox
  F.menu = () => {
    if (!active()) return [];
    const P = host.player, rows = [
      {label: 'Thunder: a bolt at the nearest tall tree', run: () => {
        if (online()) { ui()?.toast('Thunder', 'online the server aims the bolts'); return; }
        const t = T.aim(P.x + 4, P.y, [], R, AIM); if (t) mark(++nB, t.kind, t.id, t.x, t.y, t.h, TUNE.tele);
      }},
      {label: 'Thunder: a bolt on me', run: () => { if (!online()) mark(++nB, 'player', 0, P.x, P.y, P.z + 1.8, TUNE.tele); }},
      {label: 'Thunder: set the nearest tree alight', run: () => {
        let best = null, bd = 12; for (const p of host.entities.near(P.x, P.y, 12, near)) if (p.kind === 'tree' && typeof p.fid === 'string' && !look.has(p.fid)) { const d = Math.hypot(p.x - P.x, p.y - P.y); if (d < bd) { bd = d; best = p; } }
        if (!best) return; if (online()) { coop().act('ignite', best.fid); return; }
        if (T.ignite(best.fid, simT, R)) { const b = T.burning.get(best.fid); setLook(best.fid, 'burning', {t0: b.at, t1: b.t1, tw: 1}); save(); }
      }},
      {label: `Thunder: players start fires (experimental): ${firestart ? 'on' : 'off'}`, run: () => { firestart = !firestart; }},
    ];
    if (!online()) rows.push({label: 'Thunder: the charred trees whole again', run: () => { clearLooks(); save(); }});
    return rows;
  };
  return F;
}
