// KEEPSAKES (docs/KEEPSAKES.md): the finds that do something. Each odd thing the forest's and the cave's secrets leave you
// (content/keepsakes.js KEEPSAKE_IDS: pouch materials, content/items.js) can be worn in one of two charm slots (content/gear.js
// slot 'charm'; features/gear.js: worn only while the pouch holds it), and while it is worn it bends one rule of the world.
// Nothing says which: no stat line, no toast; the rule shows itself the moment it happens.
//   THE NOTES   a worn keepsake's modifier notes (content/keepsakes.js NOTES, source 'keepsakes'), applied by their owners:
//               the animals (fauna.loud, fauna.lure), the cave (cave.shun, cave.kin, cave.relight), the watcher (watcher.every)
//   THE HERON FEATHER  stand still (HERON.still s, slower than HERON.speed) in the shallows (fishing.shallow: the lake's shelf,
//               the stream outside its deep pools) and fish shadows rise round your feet (fishing.come: fishing draws them);
//               E jabs (fishing.jab: rolled like a cast with HERON's limits, the server's online). A jab, hit or miss, or a
//               step scatters them for HERON.back s. A friend's feather: their shadows on your screen too (view only)
//   THE TALLY STICK  it counts (the rule: docs/KEEPSAKES.md, under its spoiler heading); each count a notch on its icon
//               (packpanel iconHook) and a dry scratch; at TALLY.full it is the Full Tally Stick (worn in its place)
//   THE SHELF   a Keepsake Shelf (a build: content/builds.js keep_shelf, features/builds.js puts it down) holds SHELF.places
//               keepsakes: E by it puts one of yours on (one you aren't wearing first) or, none to put, takes yours back; anyone
//               may put one on any shelf, only who put it there takes it back. What stands on it is drawn on its plank (the
//               items' own icons), the Bark Doll as itself, its head turning slowly toward the nearest secret (sim/keepsakes.js;
//               none left: toward you). Some dawns the doll walks off toward it (DOLL); E by it brings it back (anyone).
//               Round the shelf now and then: the Warm Stone steams at dawn, the Tally Stick scratches at midnight, the
//               Fiddle String plays three notes at dusk. THE BARK DOLL worn: it creaks when you come within DOLL.creak m of
//               a secret.
// CO-OP: the server keeps the shelves (server/room.mjs shelf: acts 'shelve' / 'unshelve' / 'fetch', world messages
//   s 'shelf') and walks the dolls at dawn; offline this feature does, in its save (pack.store('keepsakes').shelves).
// MULTIPLAYER: what you wear is in your gear set, which is the server's to say (features/gear.js, server/room.mjs wear): everyone
//   sees the charms on you, and the server and your friends' clients read your set for the rules that touch them (the soot
//   things: server/room.mjs; the animals: features/fauna.js reads a peer's q.gear).
// SIM vs VIEW: the worn set and its notes change in update (a step), on a change of the gear's set only. The heron's stillness,
//   its shadows' rise and the jab are the sim's; how far up the shadows are drawn (eased) and a friend's are the view's.
// OWNS: the modifier source 'keepsakes', F.worn (the keepsakes in your set now), the heron's state (HS), its save
//   (pack.store('keepsakes'): tally), packpanel's iconHook.of (the tally's notches). READS: gear (S.worn,
//   S.ver), pack (give: the dev row), fishing (shallow, come, jab, fishing), coop (peers: their gear, where they are), flags
//   ('keepsakes'), host.player, host.PL (hold, useE, nearInteract).
// EMITS: keep.notch (the jab: fishing's fish.jab / fish.catch / fish.miss). BUDGET: update: a compare a step (the set's
//   version); with the feather worn one waterSample a step (fishing.shallow); view: one ask a frame per feather near you.
import {flags} from '../core/flags.js';
import * as THREE from 'three';
import {KEEPSAKE_IDS, NOTES, HERON, STONE, TALLY, DOLL, SHELF, isKeepsake} from '../content/keepsakes.js';
import {BUILDS} from '../content/builds.js';
import {dollTargets, nearestOf, openGround, dollWalk, underground} from '../sim/keepsakes.js';
import {nameHash} from '../core/rng.js';
import {geoOf, box} from '../world/kit3d.js';
import {ITEMS, PAL} from '../content/items.js';
import {SESSION} from '../core/session.js';
import {iconHook} from '../ui/packpanel.js';
import {viewRandom} from '../core/rng.js';
import {hdUnit, hdPrompt} from '../ui/hdpixel.js';

const ON = flags.get('keepsakes') !== '0';

// ORDER (core/features.js): after the gear (the set worn this step), the pack and co-op (their mail this step), fishing (its
// step done: a jab lands after it, its asks are drawn after its view), the builds (the shelves standing this step)
export const order = {after: ['gear', 'pack', 'coop', 'fishing', 'builds']};
export async function create(host) {
  const gear = () => host.feature('gear'), pack = () => host.feature('pack'), game = () => host.feature('game'), fishing = () => host.feature('fishing');
  const F = {name: 'keepsakes', label: 'Keepsakes', on: ON, worn: new Set(), ver: 0};
  F.wears = id => F.worn.has(id);
  let gearV = -1;
  const notes = [];
  function setNotes() {
    notes.length = 0;
    if (ON) for (const id of F.worn) for (const n of NOTES[id] || []) notes.push(n);
    if (notes.length) host.mods.set('keepsakes', notes.slice()); else host.mods.clear('keepsakes');
  }

  // ---------------------------------------------------------------- the Heron Feather
  // HS: the water he stands in ('' : not the shallows, or no feather), s stood still there, how far up the shadows are
  // (0..1), s before they come again after a scatter, E pressed this step
  const HS = {w: '', still: 0, k: 0, away: 0, jab: false};
  F.heron = HS;
  const free = () => { const P = host.player; return !host.lock && !host.paused && !host.BUSY.has(P.state) && !host.PL.tool?.S.mode && !host.PL.nearInteract?.(); };
  const ready = () => HS.w !== '' && HS.k >= .5;
  function scatter() { if (HS.k > 0) HS.away = HERON.back; HS.k = 0; HS.still = 0; }
  function heron(dt) {
    const P = host.player, Fi = fishing();
    HS.w = ON && F.worn.has('heron_feather') && Fi && !Fi.fishing && P.state !== 'hold' ? Fi.shallow(P.x, P.y) : '';
    if (HS.away > 0) HS.away = Math.max(0, HS.away - dt);
    if (HS.jab) {   // E: the jab (he stoops to the water), hit or miss they scatter
      HS.jab = false;
      if (ready() && free() && Fi.jab(P.x, P.y, HS.w)) { host.PL.hold('crouch', .35); scatter(); return; }
    }
    if (P.state === 'hold') return;   // (stooped: neither still nor a step)
    if (!HS.w || Math.hypot(P.vx || 0, P.vy || 0) >= HERON.speed || host.BUSY.has(P.state)) { scatter(); return; }
    if ((HS.still += dt) >= HERON.still && HS.away <= 0) HS.k = Math.min(1, HS.k + dt / HERON.rise);
  }

  // ---------------------------------------------------------------- the Tally Stick
  const store = () => { const s = pack()?.store('keepsakes'); if (s) s.tally ??= 0; return s; };
  let dayWas = null, devTally = flags.get('tally');
  function tally() {
    const pk = pack(), s = store(); if (!pk || !s) return;
    if (devTally && isFinite(+devTally)) { s.tally = Math.max(0, +devTally | 0); devTally = null; pk.dirty(); iconHook.ver++; }
    const day = host.env?.day;
    const turned = dayWas !== null && day > dayWas; dayWas = day ?? null;
    if (turned && ON && F.worn.has('tally_stick') && host.feature('caves')?.down) {   // (the rule: docs/KEEPSAKES.md, spoiler)
      s.tally++; pk.dirty(); iconHook.ver++;
      const P = host.player; host.events.push({type: 'keep.notch', x: P.x, y: P.y, n: s.tally});
    }
    if (s.tally >= TALLY.full && pk.count('tally_stick') > 0) {   // full: the stick is the Full Tally Stick now, worn in its place
      const G = gear(), worn = F.worn.has('tally_stick');
      pk.take('tally_stick', 1); pk.give('full_tally_stick', 1); s.tally = 0; pk.dirty(); iconHook.ver++;
      if (worn && G) G.choose([...G.S.want.filter(id => id !== 'tally_stick'), 'full_tally_stick']);
    }
  }
  // the tally's look in the pouch: its notches cut pale (row r, column 11 - r for the r-th), cached per count
  const TALLY_ICONS = [];
  function tallyIcon(n) {
    if (TALLY_ICONS[n]) return TALLY_ICONS[n];
    const d = ITEMS.tally_stick, icon = d.icon.map(r => r.split(''));
    for (let r = 1; r <= Math.min(n, TALLY.full); r++) icon[r][11 - r] = 'c';
    return TALLY_ICONS[n] = {icon: icon.map(r => r.join('')), pal: {...d.pal, c: TALLY.cut}, key: 'tally' + n};
  }
  iconHook.of = id => { if (id !== 'tally_stick') return null; const n = store()?.tally || 0; return n ? tallyIcon(n) : null; };

  // ---------------------------------------------------------------- the shelves
  const coop = () => host.feature('coop'), online = () => !!coop()?.online, me = () => online() ? coop().net?.id : 0;
  const builds = () => host.feature('builds'), ui = () => game()?.ui || null;
  const SHV = new Map();   // build id -> {on: [[item, by]], doll: null | {x, y, by, n}, walks, p (the walked doll's prop), dv (its view)}
  const shelfOf = id => { let s = SHV.get(id); if (!s) SHV.set(id, s = {on: [], doll: null, walks: 0, p: null, dv: null, loaded: false}); return s; };
  const saveShelves = () => {
    const st = store(); if (!st || online()) return;
    st.shelves = {}; for (const [id, s] of SHV) st.shelves[id] = {on: s.on, doll: s.doll, walks: s.walks};
    pack()?.dirty();
  };
  function setDoll(id, s, doll) {   // the walked doll: a prop E can reach (features/keepsakes.js interact), or none
    if (s.p) { host.entities.remove(s.p); s.p = null; }
    s.doll = doll;
    if (doll) { s.p = {kind: 'barkdoll', x: doll.x, y: doll.y, z: host.elev(doll.x, doll.y), r: .12, interact: 'doll', shelf: id}; host.entities.add(s.p); }
  }
  function load(id, s, o) {   // a shelf's state as the save or the server says it
    s.on = Array.isArray(o?.on) ? o.on.filter(q => Array.isArray(q) && isKeepsake(q[0])).map(q => [q[0], q[1]]) : [];
    s.walks = +o?.walks || 0; setDoll(id, s, o?.doll && isFinite(o.doll.x) && isFinite(o.doll.y) ? {x: +o.doll.x, y: +o.doll.y, by: o.doll.by, n: +o.doll.n || 0} : null);
    s.loaded = true; shelvesV++;
  }
  let buildsV = -1, shelvesV = 0;
  function syncShelves() {   // the shelves standing (on the builds' list changing): new ones from the save, gone ones dropped
    const B = builds(); if (!B || B.ver === buildsV) return;
    buildsV = B.ver;
    for (const [id, s] of SHV) if (!B.list.get(id)) { setDoll(id, s, null); s.dv?.dispose(); SHV.delete(id); shelvesV++; }
    for (const b of B.list.values()) if (b.def.shelf) { const s = shelfOf(b.id); if (!s.loaded && !online()) load(b.id, s, store()?.shelves?.[b.id]); }
  }
  const myLast = s => { for (let i = s.on.length - 1; i >= 0; i--) if (s.on[i][1] === me()) return s.on[i][0]; return ''; };
  function nextPut(s, b) {   // the keepsake E would put on: one in the pouch not on this shelf, an unworn one first
    if (s.on.length >= b.def.shelf.places) return '';
    const pk = pack(); if (!pk) return '';
    for (const pass of [0, 1]) for (const id of KEEPSAKE_IDS) {
      if (pk.count(id) < 1 || (pass === 0) === F.worn.has(id) || s.on.some(q => q[0] === id) || (id === 'bark_doll' && s.doll)) continue;
      return id;
    }
    return '';
  }
  const nameOf = id => ITEMS[id]?.name || id;
  function shelfE(b) {
    const s = shelfOf(b.id), put = nextPut(s, b), mine = put ? '' : myLast(s);
    if (put) {
      if (online()) { coop().act('shelve', b.id, {item: put}); return; }
      if (!pack().take(put, 1)) return;
      s.on.push([put, 0]); shelvesV++; host.events.push({type: 'keep.shelve', x: b.x, y: b.y, id: put}); saveShelves(); return;
    }
    if (mine) {
      if (online()) { coop().act('unshelve', b.id, {item: mine}); return; }
      s.on.splice(s.on.findIndex(q => q[0] === mine && q[1] === 0), 1); pack().give(mine, 1, {x: b.x, y: b.y, h: 1});
      shelvesV++; host.events.push({type: 'keep.shelve', x: b.x, y: b.y, id: mine}); saveShelves(); return;
    }
    ui()?.float(b.x, b.y, 1.3, s.on.length >= b.def.shelf.places ? 'the shelf is full' : 'nothing of yours to put on it', '#e8dcc0');
  }
  function fetchDoll(id, s) {
    if (online()) { coop().act('fetch', id); return; }
    s.on.push(['bark_doll', s.doll.by]); s.walks = 0; setDoll(id, s, null); shelvesV++;
    const b = builds()?.list.get(id); if (b) host.events.push({type: 'keep.shelve', x: b.x, y: b.y, id: 'bark_doll'});
    saveShelves();
  }
  function shelfMail(m) {   // the server's word: a shelf put down (late: with what stands on it), changed
    if (m.k !== 'world' || typeof m.id !== 'string') return;
    if (m.s === 'built' && BUILDS[m.kind]?.shelf) { load(m.id, shelfOf(m.id), m); return; }
    if (m.s !== 'shelf') return;
    const s = shelfOf(m.id), mine = m.by === me() && !m.late;
    if (mine && m.a === 'shelve' && isKeepsake(m.item)) pack()?.take(m.item, 1);
    if (mine && m.a === 'unshelve' && isKeepsake(m.item)) pack()?.give(m.item, 1);
    load(m.id, s, {on: m.on, doll: m.doll, walks: m.doll?.n ?? 0});
    const b = builds()?.list.get(m.id); if (b && !m.late) host.events.push({type: m.a === 'walk' ? 'keep.walk' : 'keep.shelve', x: b.x, y: b.y, id: m.item});
  }
  // the doll's secrets, as the server sees them too (sim/keepsakes.js); `head`: the head's own extra (the miner's pick)
  const TGT = [], DO = {U: null, C: null, spring: null, spent: id => { const q = host.feature('uncanny')?.st?.[id]; return q?.s === 'spent' || q?.s === 'triggered'; },
    opened: i => !!host.feature('mining')?.isSpent?.(host.world?.cave?.hollows?.[i]?.vein), extra: null};
  function secretFrom(x, y, head) {
    const un = host.feature('uncanny'), FP = host.layout?.forest;
    DO.U = un?.on ? un.U : null; DO.C = host.world?.cave || null; DO.spring = un?.on && un.st?.spring ? FP?.spring || null : null;
    DO.extra = head && DO.C?.camp && !pack()?.store('mining')?.took ? DO.C.camp : null;
    return nearestOf(dollTargets(DO, x, y, TGT), x, y);
  }
  let dawnN = null, walkNow = false;
  const dollAlways = () => walkNow || flags.get('dollwalk') === 'always';
  function dawn() {   // offline: a new dawn, the dolls may walk (the server's dawnTick, the same rules)
    const t = host.env?.t; if (t === undefined) return;
    const n = Math.floor((t - 6) / 24) + (walkNow ? 1000 : 0); if (n === dawnN) return;
    const first = dawnN === null; dawnN = n; if (first || online()) return;
    const B = builds(), C = host.world?.cave || null, FP = host.layout?.forest || null;
    for (const [id, s] of SHV) {
      const b = B?.list.get(id); if (!b || underground(C, b.x, b.y)) continue;
      const onI = s.on.findIndex(q => q[0] === 'bark_doll'); if ((onI < 0 && !s.doll) || s.walks >= DOLL.most) continue;
      const fx = s.doll ? s.doll.x : b.x, fy = s.doll ? s.doll.y : b.y;
      const w = dollWalk({seed: SESSION.seed | 0, day: n, key: nameHash(id), x: fx, y: fy, to: secretFrom(fx, fy, false), always: dollAlways(),
        ok: (x, y) => openGround(FP, C, x, y) && !host.inStream(x, y)});
      if (!w) continue;
      const by = s.doll ? s.doll.by : s.on[onI][1]; if (onI >= 0) s.on.splice(onI, 1);
      s.walks++; setDoll(id, s, {x: w.x, y: w.y, by, n: s.walks}); shelvesV++;
      host.events.push({type: 'keep.walk', x: b.x, y: b.y, id: 'bark_doll'});
    }
    if (walkNow) { walkNow = false; dawnN = Math.floor((t - 6) / 24); }
    saveShelves();
  }
  F.interact = p => {
    if (p.kind === 'keepshelf' && p.build) { const b = builds()?.list.get(p.build); if (!b) return false; shelfE(b); return true; }
    if (p.kind === 'barkdoll' && p.shelf) { const s = SHV.get(p.shelf); if (!s?.doll) return false; fetchDoll(p.shelf, s); return true; }
    return false;
  };
  F.prompt = p => {
    if (p.kind === 'barkdoll' && p.shelf) return {text: 'E  take the doll home', color: '#e8dcc0'};
    if (p.kind !== 'keepshelf' || !p.build) return null;
    const b = builds()?.list.get(p.build); if (!b) return null;
    const s = shelfOf(b.id), put = nextPut(s, b), mine = put ? '' : myLast(s);
    return {text: put ? `E  put the ${nameOf(put)} on` : mine ? `E  take the ${nameOf(mine)} back` : 'Keepsake Shelf', color: '#e8dcc0'};
  };
  // the worn doll: a creak when a secret is near (checked every DOLL.every s)
  let creakT = 0, creakCd = 0;
  function creak(dt) {
    if ((creakCd -= dt) > 0 || (creakT -= dt) > 0) return; creakT = DOLL.every;
    if (!ON || !F.worn.has('bark_doll')) return;
    const P = host.player, t = secretFrom(P.x, P.y, false);
    if (t && Math.hypot(t.x - P.x, t.y - P.y) < DOLL.creak) { creakCd = 7; host.events.push({type: 'keep.creak', x: P.x, y: P.y}); }
  }

  F.update = dt => {
    const G = gear(), v = G?.S?.ver ?? 0;
    if (v !== gearV) {   // (the set changed: which keepsakes are worn now, their notes)
      gearV = v; F.worn.clear();
      for (const id of G?.S?.worn || []) if (isKeepsake(id)) F.worn.add(id);
      F.ver++; setNotes();
    }
    heron(dt);
    tally();
    if (!ON) return;
    syncShelves();
    const c = coop(); if (online() && c.mail) for (let k = 0; k < c.mail.length; k++) shelfMail(c.mail[k]);
    dawn(); creak(dt);
  };
  F.onKey = k => {
    if (k !== 'e' || !ready() || !free()) return false;
    HS.jab = true; host.PL.useE?.(); return true;
  };

  // the view: the shadows asked of fishing (eased up as the sim's k rises, darting off fast when it drops), and a friend's
  // feather: his stillness in the shallows judged here from where he's drawn (no word from the server: it's only a look)
  const VK = {me: 0}, PEERS = new Map(), PSM = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', w: null, ls: null};
  const ease = (v, to, dt) => to > v ? Math.min(to, v + dt * 1.5) : Math.max(to, v - dt * 3);
  F.view = (dt, evs) => {
    stoneView(dt, evs);
    shelvesView(dt);
    const Fi = fishing(); if (!Fi?.come) return;
    const P = host.player;
    VK.me = ease(VK.me, HS.w ? HS.k : 0, dt);
    if (VK.me > 0) Fi.come('heron:me', P.x, P.y, VK.me, HERON.n[0] + (HERON.n[1] - HERON.n[0]) * VK.me | 0);
    const C = host.feature('coop')?.net;
    if (!ON || !C?.peers?.size || dt <= 0) return;
    for (const peer of C.peers.values()) {
      let q = PEERS.get(peer.id);
      if (!peer.gear?.includes?.('heron_feather')) { if (q) q.k = 0; continue; }
      const o = C.sample(peer, PSM); if (!o) continue;
      if (!q) { q = {px: o.x, py: o.y, still: 0, k: 0, away: 0, key: 'heron:' + peer.id}; PEERS.set(peer.id, q); }
      const v = Math.hypot(o.x - q.px, o.y - q.py) / dt; q.px = o.x; q.py = o.y;
      const w = Fi.shallow(o.x, o.y), go = !w || v >= HERON.speed || o.s === 'hold';
      if (q.away > 0) q.away -= dt;
      if (go) { if (q.k > .3) q.away = HERON.back; q.still = 0; q.k = ease(q.k, 0, dt); }
      else if ((q.still += dt) >= HERON.still && q.away <= 0) q.k = Math.min(1, q.k + dt / HERON.rise);
      if (q.k > 0) Fi.come(q.key, o.x, o.y, q.k, HERON.n[0] + (HERON.n[1] - HERON.n[0]) * q.k | 0);
    }
  };
  // ---------------------------------------------------------------- the Warm Stone's look: snuffed, the wick glows red a moment,
  // then catches in a puff of sparks (the relight itself is features/caves.js's: x the 'cave.relight' note)
  const VR = viewRandom('keepsakes'), SPARK = [];   // {x, y, h, vx, vy, vh, t, life}
  let glowT = 0;
  const PG = {size: 2, emit: true}, PS = {size: 1, emit: true};
  function stoneView(dt, evs) {
    const P = host.player;
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'lantern.snuff' && F.worn.has('warm_stone')) glowT = STONE.glow;
      else if (e.type === 'lantern.relight' && F.worn.has('warm_stone')) {
        glowT = 0;
        for (let k = 0; k < 10 && SPARK.length < 24; k++) SPARK.push({x: P.x, y: P.y, h: P.z + 1.15, vx: (VR() - .5) * 1.2, vy: (VR() - .5) * 1.2, vh: .6 + VR() * 1.2, t: 0, life: .3 + VR() * .4});
      }
    }
    if (glowT > 0) glowT -= dt;
    for (let i = SPARK.length - 1; i >= 0; i--) { const s = SPARK[i]; if ((s.t += dt) > s.life) { SPARK.splice(i, 1); continue; } s.vh -= 4 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.h += s.vh * dt; }
  }
  F.frame = () => {
    shelvesFrame();
    if (glowT > 0) { const P = host.player; host.point(P.x, P.y, P.z + 1.15, (glowT * 9 | 0) % 2 ? '#d8401c' : '#a82a14', PG); }
    for (let i = 0; i < SPARK.length; i++) { const s = SPARK[i]; host.point(s.x, s.y, s.h, s.t < s.life * .5 ? '#ffd27a' : '#e86a2a', PS); }
  };

  // ---------------------------------------------------------------- the shelves' look: what stands on them, the doll
  // the items' own 12 x 12 icons as little standing sprites (outlined, like a catch: features/fishing.js), made once each
  const SPR = {};
  function spriteOf(id) {
    if (SPR[id]) return SPR[id];
    const o = iconHook.of?.(id), d = ITEMS[id], rows = o?.icon || d.icon, pal = {...PAL, ...(o?.pal || d.pal || {})};
    const c = document.createElement('canvas'); c.width = c.height = 14; const q = c.getContext('2d');
    const filled = (x, y) => y >= 0 && y < 12 && x >= 0 && x < 12 && rows[y][x] !== '.';
    for (let y = -1; y <= 12; y++) for (let x = -1; x <= 12; x++) {
      if (filled(x, y)) { q.fillStyle = pal[rows[y][x]] || d.col || '#f0f'; q.fillRect(x + 1, y + 1, 1, 1); }
      else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) { q.fillStyle = '#1a120c'; q.fillRect(x + 1, y + 1, 1, 1); }
    }
    return SPR[id] = c;
  }
  // the Bark Doll: a body of bark and twig, its head apart (it turns)
  const GEO = {};
  const bodyGeo = () => GEO.body ??= geoOf([
    box('bark', [.09, .16, .06], [0, .1, 0]), box('bark', [.03, .08, .03], [-.03, .02, 0], [0, 0, .1]), box('bark', [.03, .08, .03], [.03, .02, 0], [0, 0, -.1]),
    box('bark', [.13, .025, .025], [0, .15, 0], [0, 0, .3]), box('straw', [.07, .03, .065], [0, .19, 0])]);
  const headGeo = () => GEO.head ??= geoOf([box('bark', [.075, .07, .065], [0, .035, 0]), box('char', [.012, .012, .01], [-.017, .04, .033]), box('char', [.012, .012, .01], [.017, .04, .033])]);
  const MX = new THREE.Matrix4(), Q4 = new THREE.Quaternion(), V3 = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
  const place = (m, x, h, y, yaw, s) => m.setMatrix(MX.compose(V3.set(x, h, y), Q4.setFromAxisAngle(UP, yaw), ONE.set(s, s, s)));
  const SIGHT = 26, RATE = DOLL.rate * Math.PI / 180;
  const wrapA = a => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;
  function dollView(dt, s, x, h, y, scale, P) {   // the doll at (x, h, y): its head eases toward the nearest secret, or him
    const v = s.dv ??= {body: null, head: null, yaw: 0, want: 0, lookT: 0, dispose() { this.body?.dispose?.(); this.head?.dispose?.(); this.body = this.head = null; }};
    if (!v.body && host.world?.mesh) { v.body = host.world.mesh(bodyGeo(), new THREE.Matrix4()); v.head = host.world.mesh(headGeo(), new THREE.Matrix4()); v.yaw = VR() * 6.28; }
    if (!v.body) return;
    if ((v.lookT -= dt) <= 0) { v.lookT = DOLL.every; const t = secretFrom(x, y, true) || P; v.want = Math.atan2(t.x - x, t.y - y); }
    const d = wrapA(v.want - v.yaw); v.yaw += Math.sign(d) * Math.min(Math.abs(d), RATE * dt);
    place(v.body, x, h, y, 0, scale);
    place(v.head, x, h + .2 * scale, y, v.yaw, scale);
    v.body.setVisible(true); v.head.setVisible(true);
  }
  const hideDoll = s => { s.dv?.body?.setVisible(false); s.dv?.head?.setVisible(false); };
  // the small things round a shelf: by the clock's turns (each player's own view)
  let partWas = '', dayWas2 = null;
  const STEAM = [];   // {x, y, h, t, life}
  function shelvesView(dt) {
    const B = builds(), P = host.player; if (!B) return;
    const part = host.env?.part || '', day = host.env?.day, dawnNow = part === 'dawn' && partWas !== 'dawn' && partWas !== '';
    const duskNow = part === 'dusk' && partWas !== 'dusk' && partWas !== '', midnight = dayWas2 !== null && day > dayWas2;
    partWas = part; dayWas2 = day ?? null;
    for (const [id, s] of SHV) {
      const b = B.list.get(id); if (!b) continue;
      const near = Math.abs(b.x - P.x) < SIGHT && Math.abs(b.y - P.y) < SIGHT;
      const onDoll = s.on.some(q => q[0] === 'bark_doll');
      if (near && onDoll) dollView(dt, s, b.x + .3, b.z + .665, b.y, 1, P); else if (!s.doll) hideDoll(s);
      if (s.doll) { const dz = host.elev(s.doll.x, s.doll.y); if (Math.abs(s.doll.x - P.x) < SIGHT && Math.abs(s.doll.y - P.y) < SIGHT) dollView(dt, s, s.doll.x, dz, s.doll.y, 1.6, P); else hideDoll(s); }
      if (!near || !ON) continue;
      const has = id2 => s.on.some(q => q[0] === id2);
      if (dawnNow && has('warm_stone')) for (let k = 0; k < 18; k++) STEAM.push({x: b.x + (VR() - .5) * .5, y: b.y + (VR() - .5) * .15, h: b.z + .7, t: -k * .9, life: 3 + VR() * 2});
      if (midnight && has('tally_stick')) host.events.push({type: 'keep.notch', x: b.x, y: b.y, n: 0});
      if (duskNow && has('fiddle_string')) host.events.push({type: 'keep.fiddle', x: b.x, y: b.y});
    }
    for (let i = STEAM.length - 1; i >= 0; i--) { const q = STEAM[i]; if ((q.t += dt) > q.life) { STEAM.splice(i, 1); continue; } if (q.t > 0) { q.h += dt * .35; q.x += Math.sin(q.t * 2 + i) * dt * .05; } }
  }
  const PSTEAM = {size: 2, alpha: .45};
  let sprV = 0;
  function shelvesFrame() {
    const B = builds(), P = host.player; if (!B) return;
    if (sprV !== iconHook.ver) { sprV = iconHook.ver; delete SPR.tally_stick; }   // (the tally's notches)
    for (const [id, s] of SHV) {
      const b = B.list.get(id); if (!b || Math.abs(b.x - P.x) > SIGHT || Math.abs(b.y - P.y) > SIGHT) continue;
      let i = 0;
      for (const q of s.on) {   // along the plank, left to right (the doll at the right end is drawn as itself)
        if (q[0] === 'bark_doll') continue;
        host.sprite({img: spriteOf(q[0]), x: b.x - .36 + i * .17, y: b.y, h: b.z + .67}); i++;
      }
    }
    for (const q of STEAM) if (q.t > 0) host.point(q.x, q.y, q.h, '#e8e4dc', PSTEAM);
  }

  // the HD layer: "E jab" over him while the shadows are up
  F.hd = (q, sc) => {
    if (!ready() || host.hudOff || host.playerHidden || pack()?.open || !free()) return;
    const P = host.player, s = host.G.toScreen(P.x, P.z + 2.2, P.y);
    q.save(); host.G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
    hdPrompt(q, 'E jab', s[0] * sc, s[1] * sc, hdUnit(), '#f2d27a');
    q.restore();
  };

  F.menu = () => game()?.mode !== 'sandbox' ? [] : [
    {label: 'Keepsakes: give all (one of each in the pouch)', run: () => { const pk = pack(); if (pk) for (const id of KEEPSAKE_IDS) if (!pk.count(id)) pk.give(id, 1); }},
    {label: 'Keepsakes: the Tally Stick +1 notch', run: () => { const s = store(); if (s) { s.tally++; pack()?.dirty(); iconHook.ver++; const P = host.player; host.events.push({type: 'keep.notch', x: P.x, y: P.y, n: s.tally}); } }},
    {label: 'Keepsakes: the shelves\' dolls walk now (offline)', run: () => { if (!online()) walkNow = true; }},
    {label: 'Keepsakes: to the spring (the Fiddle String, at dusk)', run: () => { const s = host.layout?.forest?.spring; if (s) host.teleport(s.x + 1.2, s.y + .4); }},
  ];
  F.biomeChanged = () => { for (const s of SHV.values()) if (s.dv) s.dv.body = s.dv.head = null; };   // (the rebuild disposed the world's meshes)
  F.hud = () => F.worn.size ? `keepsakes worn ${[...F.worn].join(', ')}${ON ? '' : ' (rules off)'} · tally ${store()?.tally ?? '-'}${HS.w ? ` · heron ${HS.w} still ${HS.still.toFixed(1)} k ${HS.k.toFixed(2)}${HS.away > 0 ? ' away ' + HS.away.toFixed(0) : ''}` : ''}` : '';
  return F;
}
