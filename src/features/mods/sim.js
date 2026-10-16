// MODS SIM: the truth of weapon attachments and runes (features/mods.js is the feature, content/mods.js the numbers, docs/MODS.md
// the rules). Fixed 1/60 s steps (core/loop.js); every random draw from this module's own generator (core/rng.js simRandom);
// nothing read back from presentation (the view drains S.fxq: the sim never reads it).
//   THE KIT     which parts you own (S.own: id -> how many) and what is fitted on each weapon (S.fit: weapon id -> {rune, tip,
//               grip}); a part fitted on one weapon is out of the kit (free(id) counts what's left). Saved in pack.store('mods')
//   A SHOT      every player shot as it is fired (the feature's arrow hook, sim/projectiles.js spawn): its TYPE (the rune; a
//               Prism's next rune; a Weather Vane's sky), the tip's way of flying (split, faster, a moth's flutter, a bough's
//               return: a.steer, called by sim/projectiles.js each step), the grip's trigger (a kick, an echo later). What it
//               is is kept here (TAGS: shot -> tag), never on the shot
//   A HIT       a tagged shot's hit (onArrowHit, before combat resolves it) or a melee blow (combat's hit mod, by 'melee'):
//               a REACTION with what's on the target already (content/mods.js REACT), then the type's STATUS on it (ST: target ->
//               status); the damage's factor rides to combat's own damage through the hit mod (CUR)
//   STATUSES    stepped here: burn and rot tick damage (combat core damage, by 'mods'), chill melts, a freeze holds (core root),
//               hollow throws (core launch). A target that falls with one on it passes it on (burn, rot), shatters (frozen),
//               pulls what's near in and, far off, swaps you into its place (hollow)
//   FINDS       parts turn up where things happen (content/mods.js FINDS: the events), dropped where it happened (walk over it)
//               or straight into the kit; owning all five runes makes a Prism; a rune carried in the cave grows a Caster Crystal
// MULTIPLAYER (docs/MODS.md): the kit is the player's, like the pouch (online the server would keep it and take 'fit' acts);
//   a target's statuses and the damage they do would be the server's with the enemies' health. Co-op combat is parked, so all
//   of it runs here, in this one place (S, ST, drops).
// OWNS: S (the kit, the find flags, the prism's turn, the streak), TAGS, ST, drops, CUR, the 'mods' modifier source (the
//   feature sets it from notes()). CALLS: combat core damage / root / launch / shift / explode (owners' APIs), host.spawnArrow
//   (splits, echoes, bolts), host.knock (the kick), host.warp (the hollow swap). READS: host.env (sky, season, part), the mire
//   (depth), the caves (down), host.entities (near), host.player.
// EMITS: mods.find, mods.react, mods.freeze, mods.shatter, mods.arc, mods.swap (core/events.js).
// BUDGET: sim: a WeakMap lookup per shot spawned and hit; per status a few multiplies a step; a near() query per storm hit, per
//   moth shot every 6 steps; nothing at all while no part is fitted and nothing burns.
import {ELEM, ELEM_IDS, REACT, PARTS, PART_IDS, KNOWN, START, FINDS, STREAK, CAVE_GROW, PICK, kindOf} from '../../content/mods.js';
import {WEAPONS} from '../../content/weapons.js';
import {simRandom} from '../../core/rng.js';
import {hypot2, clamp} from '../../core/mathx.js';

const RUNE_OF = Object.fromEntries(ELEM_IDS.map(e => [e, PART_IDS.find(id => PARTS[id].elem === e)]));

export function createModsSim(host, saved) {
  const P = host.player, ents = host.entities;
  const R = simRandom('mods');
  const core = () => host.feature('combat')?.core;
  const S = {own: {}, fit: {}, seen: {}, prism: 0, kills: [], caveT: 0, stormN: 0, ver: 0, fxq: []};
  const TAGS = new WeakMap(), ST = new Map(), drops = [], nearA = [], nearB = [];
  const CUR = {p: null, mul: 1};
  let inner = false;   // spawning our own extra shots (splits, echoes): they're tagged, not split or echoed again
  const echoes = [];   // {t, a: the shot's copy} fired again later from where it was fired

  // ---- the kit ----
  function load() {
    const o = saved();
    if (!o.own) { o.own = {}; for (const id of START.own) o.own[id] = 1; o.fit = JSON.parse(JSON.stringify(START.fit)); o.seen = {}; }
    S.own = o.own; S.fit = o.fit; S.seen = o.seen ??= {};
    for (const id in S.own) if (!PARTS[id]) delete S.own[id];   // (a part since renamed)
    S.ver++;
  }
  load();
  let dirty = () => {};
  const changed = () => { S.ver++; dirty(); };
  const fitted = (id, but = '') => { let n = 0; for (const w in S.fit) if (w !== but) for (const s in S.fit[w]) if (S.fit[w][s] === id) n++; return n; };
  const free = (id, but = '') => (S.own[id] || 0) - fitted(id, but);
  const fitOf = wid => S.fit[wid] || null;
  function give(id, at = null) {
    if (!PARTS[id]) return false;
    S.own[id] = (S.own[id] || 0) + 1; changed();
    const x = at?.x ?? P.x, y = at?.y ?? P.y;
    host.events.push({type: 'mods.find', id, x, y, first: S.own[id] === 1});
    S.fxq.length < 96 && S.fxq.push({k: 'find', id, first: S.own[id] === 1, x, y, h: (P.z || 0) + 1.2});
    if (ELEM_IDS.every(e => S.own[RUNE_OF[e]]) && !S.own.prism) give('prism');   // the five runes make a Prism
    return true;
  }
  // fit part `id` (or '' to take it out) in `slot` of weapon `wid` (kind: its kind) -> true
  function fit(wid, kind, slot, id) {
    const f = S.fit[wid] ??= {};
    if (id) {
      const D = PARTS[id]; if (!D || D.slot !== slot || !D.fits.includes(kindOf(kind))) return false;
      if (f[slot] !== id && free(id) <= 0) return false;
      f[slot] = id;
    } else delete f[slot];
    changed();
    host.events.push({type: 'mods.fit', wid, slot, id: id || ''});
    return true;
  }

  // ---- what the weapon in hand is ----
  const kindOfW = wid => WEAPONS[wid]?.kind || KNOWN[wid]?.kind || 'melee';
  // the type a shot or blow of weapon wid deals now (advances the Prism's turn when `shot`)
  function elemOf(wid, shot = false) {
    const f = fitOf(wid); if (!f) return 'phys';
    if (f.grip === 'weather_vane') return skyElem();
    if (f.tip === 'prism') {
      const owned = ELEM_IDS.filter(e => S.own[RUNE_OF[e]]); if (!owned.length) return 'phys';
      const e = owned[S.prism % owned.length]; if (shot) S.prism++; return e;
    }
    return f.rune ? PARTS[f.rune].elem : 'phys';
  }
  // the Weather Vane: the bog rots, rain storms, snow freezes, the night hollows, a clear day burns
  function skyElem() {
    const E = host.env, sky = E?.sky;
    if ((host.feature('mire')?.depth || 0) > 0) return 'rot';
    if (sky && (sky.rain > .15 || sky.storm > .3)) return 'storm';
    if (sky && (sky.snow > .15 || E.season === 'winter')) return 'frost';
    if (E?.part === 'night') return 'void';
    return 'fire';
  }
  const raining = (x, y) => { const E = host.env; return (E?.skyAt ? E.skyAt(x, y, 'rain') : E?.sky?.rain ?? 0) > .15; };
  const wet = p => raining(p.x, p.y) || host.inStream(p.x, p.y) || ((host.feature('mire')?.depth || 0) > 0 && hypot2(p.x - P.x, p.y - P.y) < 6);
  const cold = () => { const E = host.env; return (E?.sky?.snow ?? 0) > .15 || E?.season === 'winter'; };

  // ---- shots (the feature's arrow hook: every shot as it is spawned) ----
  function shot(a) {
    if (a.foe) return;
    const wid = a.kind === 'bullet' ? a.gun : a.wid || 'bow';
    if (!wid) return;
    if (inner) { const t = TAGS.get(inner); if (t) TAGS.set(a, {...t, child: true}); return; }
    const f = fitOf(wid), kind = kindOfW(wid);
    const elem = elemOf(wid, true);
    if (!f && elem === 'phys') return;
    const tip = f?.tip ? PARTS[f.tip] : null, grip = f?.grip ? PARTS[f.grip] : null;
    const tag = {elem, wid, kind, t: 0, life: a.life || 1, steer: tip?.steer || '', tgt: null, look: 0, back: false, last: false, child: false, echo: false};
    TAGS.set(a, tag);
    if (elem === 'fire') a.fire = true;   // (features/lights.js: wood it hits catches)
    // the bow's arrows don't read the gun's notes: its tip and grip change the arrow itself
    if (kind !== 'gun') {
      let sp = 1, dk = 1;
      if (tip?.speed) { sp *= tip.speed; dk *= tip.notes?.dmg ?? 1; }
      if (grip?.bow) { sp *= grip.bow.speed; dk *= grip.bow.dmg; }
      if (sp !== 1) { a.vx *= sp; a.vy *= sp; a.vh *= sp; a.life /= Math.sqrt(sp); }
      a.dmg = (a.dmg ?? 10) * dk;
    } else if (grip?.notes?.last) {   // the cylinder's last round (its notes made it hit x3): it bursts too
      const base = WEAPONS[wid] ? host.mods.value('weapon.dmg', WEAPONS[wid].dmg) : 0;
      if (base && a.dmg > base * 2) tag.last = true;
    }
    if (tip?.pen) { const p0 = a.pen || {through: 0, dmg: .7, speed: .85}; a.pen = {...p0, through: p0.through + tip.pen}; }
    if (tip?.push) a.push = (a.push ?? 1) * tip.push;
    if (tag.steer) a.steer = steer;
    // the grip's trigger: the kick (back against the shot), the echo (the same shot again from here, later)
    const l = Math.hypot(a.vx, a.vy) || 1, ux = a.vx / l, uy = a.vy / l;
    if (grip?.knock) host.knock(-ux * grip.knock, -uy * grip.knock);
    if (grip?.echo) echoes.push({t: grip.echo.delay, a: {...a, steer: a.steer, hitSet: undefined, trail: undefined}, tag});
    // the tip's split: two more either side, each (and this one) worth split.dmg
    if (tip?.split) {
      const k = tip.split.dmg; a.dmg *= k;
      inner = a;
      for (let i = 1; i < tip.split.n; i++) {
        const off = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * tip.split.deg * Math.PI / 180, c = Math.cos(off), s = Math.sin(off);
        host.spawnArrow({...a, extra: true, trail: undefined, vx: a.vx * c - a.vy * s, vy: a.vx * s + a.vy * c});
      }
      inner = false;
    }
    S.fxq.length < 96 && S.fxq.push({k: 'shot', elem, x: a.x, y: a.y, h: a.h, ux, uy});
  }
  // a tip's flight (sim/projectiles.js calls it each step before the shot moves): the moth's flutter and seek, the bough's return
  function steer(a, dt) {
    const t = TAGS.get(a); if (!t) return;
    t.t += dt;
    const sp = Math.hypot(a.vx, a.vy) || 1;
    let ux = a.vx / sp, uy = a.vy / sp, turn = 0;
    if (t.steer === 'moth') {
      const M = PARTS.moth_lens.seek;
      if (--t.look <= 0) { t.look = 6; t.tgt = nearestFoe(a.x, a.y, M.r, null); }
      const g = t.tgt;
      if (g && !g.broken && !g.gone) { const want = Math.atan2(g.x - a.x, g.y - a.y), cur = Math.atan2(ux, uy); turn = clamp(angle(want - cur), -M.turn * dt, M.turn * dt); }
      turn += Math.sin(t.t * M.wob + (t.child ? 2 : 0)) * 3 * dt;
    } else if (t.steer === 'boom') {
      const B = PARTS.boomerang_bend.boom;
      if (!t.back && t.t > t.life * B.at) {   // halfway: it turns for home, with as long to get there as it had out
        t.back = true; a.life = Math.max(a.life, t.t + .2);
        if (a.kind === 'bullet' && sp > 40) { a.vx *= 40 / sp; a.vy *= 40 / sp; }
        a.vh = Math.max(a.vh, 2);
      }
      if (t.back) { const want = Math.atan2(P.x - a.x, P.y - a.y), cur = Math.atan2(ux, uy); turn = clamp(angle(want - cur), -B.turn * dt, B.turn * dt); }
    }
    if (turn) { const ang = Math.atan2(ux, uy) + turn, v = Math.hypot(a.vx, a.vy); a.vx = Math.sin(ang) * v; a.vy = Math.cos(ang) * v; }
  }
  const angle = d => ((d + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
  const alive = p => !!p && !p.broken && !p.gone && (p.hp > 0 || p.target);
  const foe = p => alive(p) && (p.hunter || p.sparring || p.target || p.foe);
  function nearestFoe(x, y, r, but) {
    let best = null, bd = r;
    for (const p of ents.near(x, y, r, nearA)) { if (p === but || !foe(p)) continue; const d = hypot2(p.x - x, p.y - y); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  // ---- hits ----
  const st = p => { let s = ST.get(p); if (!s) { s = {burn: 0, bAcc: 0, chill: 0, chillT: 0, frozen: 0, rot: 0, rotN: 0, rAcc: 0, lift: 0, last: '', lastT: 0, lastShot: false}; ST.set(p, s); } return s; };
  const has = s => s.burn > 0 || s.frozen > 0 || s.rot > 0 || s.chill > 0;
  // a hit of type elem on p for dmg; o: {last (the Last Word's round), x, y}. Returns the factor on this hit's damage
  function hit(p, elem, dmg, o = {}) {
    if (!alive(p) || elem === 'phys' && !ST.has(p)) return 1;
    const s = st(p), C = core();
    let mul = 1;
    // what's on it already meets what comes in (REACT)
    if (s.frozen > 0) {
      if (elem === 'fire') { mul *= REACT.steam.mul; s.frozen = 0; s.chill = 0; react('steam', p); }
      else {
        mul *= ELEM.frost.chill.shatter; shatter(p, s);
        if (elem === 'storm') { react('shatterbolt', p); for (const q of ents.near(p.x, p.y, REACT.shatterbolt.r, nearB)) { const t = ST.get(q); if (q !== p && t?.frozen > 0 && alive(q)) { arc(p, q); shatter(q, t); } } }
      }
    }
    if (elem === 'storm' && s.burn > 0) { react('flashover', p); boom(p, REACT.flashover.boom); s.burn = 0; }
    if (elem === 'fire' && s.rot > 0) { react('swampgas', p); boom(p, REACT.swampgas.boom); s.rot = 0; s.rotN = 0; }
    if (elem === 'frost' && s.rot > 0 && !(s.frozen > 0)) { react('blight', p); freeze(p, s); }
    if (elem === 'void' && has(s)) { react('unravel', p); for (const q of ents.near(p.x, p.y, REACT.unravel.r, nearB)) if (q !== p && foe(q)) copy(s, st(q), q); }
    // the type's own status
    if (elem === 'fire') { s.burn = ELEM.fire.burn.dur; }
    else if (elem === 'frost') {
      const F = ELEM.frost.chill; s.chillT = F.decay;
      if (!(s.frozen > 0) && ++s.chill >= (cold() ? F.snowAt : F.freezeAt)) freeze(p, s);
    } else if (elem === 'rot') { s.rot = ELEM.rot.rot.dur; s.rotN = Math.min(ELEM.rot.rot.max, s.rotN + 1); }
    else if (elem === 'storm') storm(p, dmg);
    else if (elem === 'void') {
      const V = ELEM.void.void, night = host.env?.part === 'night' ? V.night : 1;
      if ((host.env?.sky?.fog ?? 0) > .3) mul *= V.fog;
      if (C?.launch && !C.airborne?.(p)) C.launch(p, 0, 0, V.up * night, {stun: V.stun, dmgFly: 0});
      s.lift = .8;
    }
    s.last = elem; s.lastT = .4; s.lastShot = !!o.last;
    if (o.last) lastWord(p, elem);
    return mul;
  }
  function react(id, p) { if (!S.seen['r:' + id]) { S.seen['r:' + id] = 1; changed(); } host.events.push({type: 'mods.react', id, x: p.x, y: p.y}); S.fxq.length < 96 && S.fxq.push({k: 'react', id, x: p.x, y: p.y, h: (p.z || 0) + 1}); }
  function freeze(p, s) {
    const F = ELEM.frost.chill; s.frozen = F.freeze; s.chill = 0; core()?.root?.(p, F.freeze);
    host.events.push({type: 'mods.freeze', x: p.x, y: p.y, who: p});
  }
  function shatter(p, s) {
    const F = ELEM.frost.chill; s.frozen = 0; s.chill = 0;
    host.events.push({type: 'mods.shatter', x: p.x, y: p.y, who: p});
    S.fxq.length < 96 && S.fxq.push({k: 'shatter', x: p.x, y: p.y, h: (p.z || 0) + .9});
    const C = core(); if (!C) return;
    for (const q of ents.near(p.x, p.y, F.shardR, nearB)) if (q !== p && foe(q) && hypot2(q.x - p.x, q.y - p.y) < F.shardR) C.damage(q, F.shardDmg, {quiet: true, by: 'mods', elem: 'frost'});
  }
  function boom(p, B) { core()?.explode?.(p.x, p.y, p.z || 0, B.r, B.dmg, false); }
  function copy(s, t, q) {
    if (s.burn > 0) t.burn = Math.max(t.burn, s.burn);
    if (s.rot > 0) { t.rot = Math.max(t.rot, s.rot); t.rotN = Math.max(t.rotN, s.rotN); }
    if (s.frozen > 0 && !(t.frozen > 0)) freeze(q, t);
    else if (s.chill > 0) { t.chill = Math.max(t.chill, s.chill); t.chillT = ELEM.frost.chill.decay; }
  }
  // storm: the hit jumps to the n nearest others (wet: further, more, harder); in a thunderstorm every bolt-th calls the sky down
  function storm(p, dmg) {
    const A = ELEM.storm.arc, w = wet(p), n = w ? A.wetN : A.n, r = w ? A.wetR : A.r, k = A.k * (w ? A.wetK : 1), C = core();
    let from = p;
    const done = [p];
    for (let i = 0; i < n; i++) {
      let best = null, bd = r;
      for (const q of ents.near(from.x, from.y, r, nearB)) { if (done.includes(q) || !foe(q)) continue; const d = hypot2(q.x - from.x, q.y - from.y); if (d < bd) { bd = d; best = q; } }
      if (!best) break;
      arc(from, best); done.push(best);
      C?.damage(best, Math.max(1, dmg * k), {quiet: true, by: 'mods', elem: 'storm'});
      const t = ST.get(best); if (t?.burn > 0) { react('flashover', best); boom(best, REACT.flashover.boom); t.burn = 0; }
      from = best;
    }
    if ((host.env?.sky?.storm ?? 0) > .3 && ++S.stormN % A.bolt === 0) {
      S.fxq.length < 96 && S.fxq.push({k: 'bolt', x: p.x, y: p.y, h: p.z || 0});
      for (const q of ents.near(p.x, p.y, A.boltR, nearB)) if (foe(q) && hypot2(q.x - p.x, q.y - p.y) < A.boltR) C?.damage(q, A.boltDmg, {by: 'mods', elem: 'storm'});
    }
  }
  function arc(a, b) {
    host.events.push({type: 'mods.arc', x: a.x, y: a.y, x1: b.x, y1: b.y});
    S.fxq.length < 96 && S.fxq.push({k: 'arc', x: a.x, y: a.y, h: (a.z || 0) + (a.h || 0) + 1, x1: b.x, y1: b.y, h1: (b.z || 0) + (b.h || 0) + 1});
  }
  // the Last Word's round: its type on everything within burst.r
  function lastWord(p, elem) {
    const r = PARTS.last_word.burst.r;
    S.fxq.length < 96 && S.fxq.push({k: 'burst', elem, x: p.x, y: p.y, h: (p.z || 0) + .8, r});
    if (elem === 'phys') return;
    for (const q of ents.near(p.x, p.y, r, nearB)) if (q !== p && foe(q) && hypot2(q.x - p.x, q.y - p.y) < r) hit(q, elem, 6);
  }

  // the projectile chain (the feature's onArrowHit, ahead of combat): a tagged shot's hit
  function onArrowHit(a, p) {
    CUR.p = null;
    const t = TAGS.get(a); if (!t) return;
    CUR.mul = hit(p, t.elem, (a.dmg ?? 10) * (a.penK ?? 1), {last: t.last});
    CUR.p = p;
  }
  // combat's hit mod (every damage): the shot's factor (CUR), or a melee blow's type (the weapon's rune: its hit runs here)
  function hitMod(p, o, M) {
    if (o.by === 'mods') return;
    if (CUR.p === p) { M.dmg *= CUR.mul; CUR.p = null; return; }
    if (o.by === 'melee' || o.by === 'throw') {
      const wid = o.weapon || weaponId(); if (!wid) return;
      const e = o.elem || elemOf(wid, true);
      if (e !== 'phys' || ST.has(p)) M.dmg *= hit(p, e, o.dmg ?? 10, {});
    }
  }
  let weaponId = () => host.weapon?.id || '';
  const setWeapon = fn => { weaponId = fn; };

  // ---- each step ----
  const near = (x, y, r, fn) => { for (const q of ents.near(x, y, r, nearB)) if (foe(q) && hypot2(q.x - x, q.y - y) < r) fn(q); };
  function step(dt, evs) {
    const C = core();
    // the falls (before the statuses drop what fell), the finds
    for (const e of evs) {
      if (e.type === 'enemy.kill' || e.type === 'prop.break') fell(e.who, e.type === 'enemy.kill');
      const L = FINDS[e.type]; if (L) for (const f of L) maybeFind(f, e);
      if (e.type === 'player.melee' || e.type === 'player.swing') castBolt(e);
    }
    // statuses
    for (const [p, s] of ST) {
      if (!alive(p)) { ST.delete(p); continue; }
      if (s.burn > 0) {
        const B = ELEM.fire.burn, k = raining(p.x, p.y) ? B.rain : 1;
        s.burn -= dt * (k < 1 ? 2 : 1); s.bAcc += dt;
        if (s.bAcc >= B.tick) { s.bAcc -= B.tick; C?.damage(p, Math.max(1, Math.round(B.dps * B.tick * k)), {quiet: true, by: 'mods', elem: 'fire'}); }
      }
      if (s.rot > 0) {
        const T = ELEM.rot.rot, k = (host.feature('mire')?.depth || 0) > 0 ? T.mire : 1;
        s.rot -= dt / k; s.rAcc += dt;
        if (s.rAcc >= T.tick) { s.rAcc -= T.tick; C?.damage(p, Math.max(1, Math.round(T.dps * s.rotN * T.tick * k)), {quiet: true, by: 'mods', elem: 'rot'}); }
        if (s.rot <= 0) s.rotN = 0;
      }
      if (s.chill > 0 && (s.chillT -= dt) <= 0) s.chill = 0;
      if (s.frozen > 0) s.frozen -= dt;
      if (s.lift > 0) s.lift -= dt;
      if (s.lastT > 0) s.lastT -= dt;
      if (!has(s) && !(s.lift > 0) && !(s.lastT > 0)) ST.delete(p);
    }
    // echoes: the shot again, from where it was fired
    for (let i = echoes.length - 1; i >= 0; i--) {
      const E = echoes[i]; if ((E.t -= dt) > 0) continue;
      echoes.splice(i, 1);
      inner = E.a; TAGS.set(E.a, {...E.tag, echo: true}); host.spawnArrow({...E.a, extra: true}); inner = false;
      S.fxq.length < 96 && S.fxq.push({k: 'echo', x: E.a.x, y: E.a.y, h: E.a.h});
    }
    // the dropped parts: walk over one to take it; they sink away after a while
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i]; d.t += dt;
      if (hypot2(d.x - P.x, d.y - P.y) < PICK.r && Math.abs((P.z || 0) - d.z) < 1.5) { drops.splice(i, 1); give(d.id, d); continue; }
      if (d.t > PICK.life) drops.splice(i, 1);
    }
    // a rune carried in the cave grows a Caster Crystal (once)
    if (!S.seen.crystal && host.feature('caves')?.down && ELEM_IDS.some(e => S.own[RUNE_OF[e]])) {
      if ((S.caveT += dt) > CAVE_GROW) { S.seen.crystal = 1; give('caster_crystal'); }
    }
    for (let i = S.kills.length - 1; i >= 0; i--) if ((S.kills[i] -= dt) <= 0) S.kills.splice(i, 1);
  }
  // something with a status on it fell: it passes it on
  function fell(p, enemy) {
    const s = p && ST.get(p);
    if (enemy) { S.kills.push(STREAK.t); if (S.kills.length >= STREAK.n && !S.own.echo_charm) drop('echo_charm', p.x, p.y); }
    if (!s) return;
    if (s.burn > 0) near(p.x, p.y, ELEM.fire.burn.spread, q => { if (q !== p) st(q).burn = Math.max(st(q).burn, ELEM.fire.burn.dur * .7); });
    if (s.rot > 0) { near(p.x, p.y, ELEM.rot.rot.spread, q => { if (q !== p) { const t = st(q); t.rot = ELEM.rot.rot.dur; t.rotN = Math.max(1, t.rotN); } }); S.fxq.length < 96 && S.fxq.push({k: 'spores', x: p.x, y: p.y, h: (p.z || 0) + .5, r: ELEM.rot.rot.spread}); }
    if (s.frozen > 0) shatter(p, s);
    if (s.lastShot && enemy && !S.own.last_word) drop('last_word', p.x, p.y);
    if (s.last === 'void' && s.lastT > 0) {
      const V = ELEM.void.void, C = core();
      S.fxq.length < 96 && S.fxq.push({k: 'implode', x: p.x, y: p.y, h: (p.z || 0) + .8, r: V.pull.r});
      near(p.x, p.y, V.pull.r, q => { if (q !== p) { const d = hypot2(q.x - p.x, q.y - p.y) || 1; C?.shift?.(q, (p.x - q.x) / d * Math.min(V.pull.d, d - .5), (p.y - q.y) / d * Math.min(V.pull.d, d - .5)); } });
      const dx = p.x - P.x, dy = p.y - P.y;
      if (Math.hypot(dx, dy) > V.warp && enemy && host.warp && !host.blocked?.(p.x, p.y, p.z || 0)) {
        S.fxq.length < 96 && S.fxq.push({k: 'swap', x: P.x, y: P.y, h: (P.z || 0) + 1, x1: p.x, y1: p.y});
        host.warp(dx, dy);
        host.events.push({type: 'mods.swap', x: p.x, y: p.y, dx, dy});
      }
    }
    ST.delete(p);
  }
  // a find's rule against an event that happened (content/mods.js FINDS)
  function maybeFind(f, e) {
    if (f.you && !e.you) return;
    if (f.near && hypot2(e.x - P.x, e.y - P.y) > f.near) return;
    let id = f.id;
    if (id === '*') {
      const left = PART_IDS.filter(k => !S.own[k] && !PARTS[k].elem && k !== 'prism' && k !== 'caster_crystal' && k !== 'weather_vane' && k !== 'echo_charm' && k !== 'last_word');
      if (!left.length) return;
      id = left[(R() * left.length) | 0];
    } else if (S.own[id]) return;
    const firstK = 'first:' + e.type + ':' + id, first = f.first && !S.seen[firstK];
    if (!first && R() >= f.p) return;
    if (f.first) { S.seen[firstK] = 1; dirty(); }
    if (f.hand) give(id); else drop(id, e.x ?? P.x, e.y ?? P.y);
  }
  function drop(id, x, y) {
    if (drops.some(d => d.id === id)) return;
    drops.push({id, x, y, z: host.elev(x, y), t: 0});
  }
  // the staff's crystal: each swing looses a bolt of its rune (a swing event: the melee weapons' own, or the pistol whip's)
  function castBolt(e) {
    const wid = e.weapon || e.gun || weaponId(); if (!wid || kindOfW(wid) !== 'staff' || fitOf(wid)?.tip !== 'caster_crystal') return;
    const B = PARTS.caster_crystal.bolt, l = Math.hypot(e.vx, e.vy) || 1, ux = e.vx / l, uy = e.vy / l;
    host.spawnArrow({x: e.x + ux * .6, y: e.y + uy * .6, h: (e.z || 0) + 1.1, vx: ux * B.speed, vy: uy * B.speed, vh: .45, life: B.life, dmg: B.dmg, kind: 'arrow', wid, bolt: true});
  }

  return {S, ST, drops, TAGS, echoes, load, give, fit, free, fitOf, elemOf, skyElem, kindOfW, shot, onArrowHit, hitMod, step, setWeapon, drop,
    setDirty: fn => { dirty = fn; }, hit};
}
