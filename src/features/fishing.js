// FISHING (docs/FISHING.md): a rod in the main hand (content/gear.js, kind 'fishing') and the cursor on water: LMB held charges
// a cast (the meter over his head runs up and back down; let go at its top for a PERFECT cast: luck for this one), let go
// and the bobber flies to the cursor (as far as the charge reaches). It plops into the water and bobs; NIBBLES dip it (a
// press then is too early: the fish is spooked and the wait grows); the BITE pulls it under ("!"): LMB within the hook window
// strikes. Then the FIGHT, short and readable: hold LMB to reel (the line comes in, the strain rises), let go to ease it
// (the strain falls, the fish takes a little line); when the fish THRASHES (a splash and the gauge's warning first) reeling
// strains the line hard: let go until it passes. Full strain snaps the line; the fish at the end of the line long enough
// swims off; reeled all the way in (a landing net takes the last stretch) it LEAPS out of the water to him: a catch card
// (its size, NEW, RECORD), the pouch, Fishing XP. A press while it waits brings the line in; walking off does too.
//   What bites (content/fishing.js roll): the water (lake / stream / river: world.js waterSample), the time of day, rain,
//   how far out the bobber lies, and the gear's fishing stats (host.mods 'fish.*' notes: luck, lure, reel, line, cast, hook,
//   double, find, size, net, night, rain) and the Fishing skill's.
// CO-OP (docs/MULTIPLAYER.md): the server rolls the catch (what, how big, when it bites) from the set you wear (it has it)
// and the clock (it owns it): the cast asks (coop.fish), the answer comes in coop.mail. The fight is yours; a landed fish is
// told to the server, which tells everyone (a toast: who caught what). No answer in TUNE_NET.ask s (an old server): rolled
// here. Others don't see your line yet (docs/FISHING.md: not yet).
//   Sim: the phase, the cast, the roll, the nibbles, the fight (progress, strain, surges), the catch (pack, XP, records).
//   View: the rod and line in his hands (pixel lines), the bobber, rings and spray, the fish under the water and its leap;
//   the HD layer: the prompt, the charge meter, the "!", the fight gauge, the catch card.
// FISHING SPOTS (content/fishing.js SPOT): rises and bubbles on the water, a few in reach, moving every SPOT.slot s on the
// world's clock (co-op: the server's, so friends see the same ones); a cast into one bites sooner and rarer, and a catch from
// it spends it (for you). BAIT (BAITS): cut from small fish at the pack panel; one goes on the hook a cast while you have it.
// FISH SHADOWS (content/fishing.js SHADOW, shadowAt; briefs/depth-shared.md: the one drawing of fish under the water): the nearest
// SHADOW.n fish round him, each a dark shape on a slow loop round its home, the same for everyone (the seed and the clock). Others
// ask F.shadowsNear(x, y, r, out); they never draw their own. FISH COME TO YOU (COME; content/meals.js fish_lingon's 'fish.come'
// note > 0): stand still in shallow water and a few come and circle your shins; E grabs the one flashing past your feet (a hand
// catch: roll's o.hand; co-op: the server's 'grab'). Burnt (< 0): the shadows flee you, and a friend in water within COME.friend
// of you gets your school. A friend with the dish has a few circling their legs too (view only).
// MEALS: fish cooked at a burning campfire (features/meals.js owns them: the Cook list, the buff, its timer chip; a cast tells the
// server the meal eaten). THE ANGLER'S SET: ANGLER.n fishing pieces worn (source 'fishing.set'). THE
// JOURNAL: the pack panel's Fish part (pack.section): every catch with its count and record, the ones not caught yet as
// silhouettes with a hint of where and when.
// Only in the sandbox's ruins biome (the persistent world: the Proving Grounds, the West Downs, the forest). ?fishing=0 off.
// OWNS: the fishing state, its saved part (pack.store('fishing'): counts, records), its particles, the modifier source
//   'fishing.set', the recipe group Bait, the journal section. Claims LMB (F.lmb) while
//   it can cast or is fishing.
// READS: gear (the rod worn, the set), host.mods ('fish.*'), world.js waterSample, host.env (part, sky.rain), pack, coop (mail,
//   fish, the server's clock), meals (the meal eaten: a cast's word to the server), SESSION.seed (the spots).
// EMITS: fish.cast, fish.plop, fish.snag, fish.nibble, fish.bite, fish.early, fish.slip, fish.hook, fish.tell, fish.surge,
//   fish.reel, fish.drag, fish.snap, fish.escape, fish.leap, fish.catch, fish.away, fish.spot, fish.bait, fish.gather, fish.grab.
// BUDGET: sim: a few multiplies a step while fishing (nothing otherwise but a compare). View: a rod, a line (~16 lines), a few
//   dozen points; HD: a gauge (rects + pixel text) while fishing; the prompt: one waterSample a frame while a rod is worn.
//   Spots: found again only when he crosses a 7 m cell or the slot turns (~a dozen hashes and waterSamples), a few points each.
//   Shadows: found again when he crosses a 5 m cell or the slot turns (~120 hashes, a few dozen waterSamples); 8 x 5 points a
//   frame. The school (lingon): a few multiplies a step while it's there, 6 x 5 points.
import {TUNE, CATCHES, CATCH_IDS, WATERS, SPOT, SHADOW, COME, BAITS, ANGLER, COMMON_FISH, roll, catchIcon, isFish, spotAt, shadowAt, hintOf} from '../content/fishing.js';
import {codeOf, parseCode} from '../content/meals.js';
import {gearById, RARITY} from '../content/gear.js';
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {SESSION} from '../core/session.js';
import {mulberry32, simSeed, viewRandom} from '../core/rng.js';
import {waterSample} from '../world/world.js';
import {hdUnit as U, hdFrame as frame9, hdText as text, hdFontOK, INK} from '../ui/hdpixel.js';
import {iconURL} from '../ui/packpanel.js';

const ON = flags.get('fishing') !== '0';
const TUNE_NET = {ask: 2.5};   // s to wait for the server's roll before rolling here
const THROW = 'lasso_throw.5', HAUL = 'lasso_haul_0';   // (the poses he casts and hauls in: a lasso's throw and haul)
const STATS = ['fish.luck', 'fish.lure', 'fish.reel', 'fish.line', 'fish.cast', 'fish.hook', 'fish.double', 'fish.find', 'fish.size', 'fish.net', 'fish.night', 'fish.rain'];
const BASE = {'fish.lure': 1, 'fish.reel': 1, 'fish.line': 1, 'fish.cast': 1, 'fish.size': 1};

// ORDER (core/features.js): after co-op (the server's roll arrives in its update), the gear (the rod worn, its notes this step),
// the pack (where a catch goes) and the meals (their Cook recipes go to the pack first: the panel's groups keep their order)
export const order = {after: ['coop', 'gear', 'pack', 'meals']};

export async function create(host) {
  let rng = null; const R = () => (rng ??= mulberry32(simSeed()))(), VR = viewRandom('fishing');
  const game = () => host.feature('game'), ui = () => game()?.ui || null, pack = () => host.feature('pack');
  const coop = () => { const c = host.feature('coop'); return c?.online && c.fish ? c : null; };
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const store = () => { const s = pack()?.store('fishing'); if (s) { s.n ??= {}; s.best ??= {}; } return s; };
  // the rod worn (the gear's set: a fishing piece in the main hand) -> the piece | null
  function rod() { const w = host.feature('gear')?.S.worn; if (!w) return null; for (const id of w) { const g = gearById(id); if (g?.slot === 'main' && g.kind === 'fishing') return g; } return null; }
  // the fishing stats (host.mods: the gear's notes, the skill's), read again when the notes change
  const ST = {}; let stV = -1;
  const stats = () => { const m = host.mods; if (m.ver !== stV) { stV = m.ver; for (const k of STATS) ST[k] = m.value(k, BASE[k] ?? 0); } return ST; };
  const reach = () => TUNE.cast.max * stats()['fish.cast'];

  // ---------------------------------------------------------------- fishing spots (content/fishing.js SPOT, spotAt)
  // the spots in reach of him: found again when he crosses a cell or the slot turns; a spent one (a catch from it) is gone for
  // him till the next slot. The slot clock: the sim's offline, the server's online (the same spots for everyone).
  const NSP = 40, SP = [], SPQ = {x: 0, y: 0}, SPK = {cx: 1e9, cy: 1e9, slot: -1, n: 0}, spent = new Set();
  const WS2 = {kind: 0, a: 0, hw: 0, edge: 0, s: 0, speed: 1, hold: 0};
  for (let i = 0; i < NSP; i++) SP.push({x: 0, y: 0, key: 0});
  const clockNow = () => { const c = coop(); return c ? c.net.serverNow() / 1000 : S.clock; };
  function findSpots() {
    const P = host.player, cx = Math.floor(P.x / SPOT.cell), cy = Math.floor(P.y / SPOT.cell), slot = Math.floor(clockNow() / SPOT.slot);
    if (cx === SPK.cx && cy === SPK.cy && slot === SPK.slot) return;
    if (slot !== SPK.slot) spent.clear();
    SPK.cx = cx; SPK.cy = cy; SPK.slot = slot;
    const r = Math.ceil((TUNE.cast.max * 1.6 + 3) / SPOT.cell), seed = (SESSION.seed ?? 0) | 0; let n = 0;
    for (let a = cx - r; a <= cx + r; a++) for (let b = cy - r; b <= cy + r; b++) {
      if (n >= NSP || !spotAt(a, b, slot, seed, SPQ)) continue;
      waterSample(SPQ.x, SPQ.y, WS2); if (!WATERS[WS2.kind] || (WS2.edge || 0) < SPOT.edge) continue;
      const s = SP[n++]; s.x = SPQ.x; s.y = SPQ.y; s.key = (a & 0xffff) * 65536 + (b & 0xffff);
    }
    SPK.n = n;
  }
  // the live spot within SPOT.r of (x, y) -> the spot | null
  function liveSpot(x, y) {
    for (let i = 0; i < SPK.n; i++) { const s = SP[i]; if (!spent.has(s.key) && Math.hypot(s.x - x, s.y - y) <= SPOT.r) return s; }
    return null;
  }

  // ---------------------------------------------------------------- the fish under the water (content/fishing.js SHADOW, shadowAt)
  // the nearest SHADOW.n cells round him holding a fish this slot (its home in water far enough from the bank), found again when he
  // crosses a cell or the slot turns; where each swims now is shadowAt's (the clock: the same for everyone). View only.
  const NSH = SHADOW.n, SH = [], SHQ = {x: 0, y: 0, a: 0, len: 0, hx: 0, hy: 0, rad: 0}, SHK = {cx: 1e9, cy: 1e9, slot: -1, n: 0};
  const WS3 = {kind: 0, a: 0, hw: 0, edge: 0, s: 0, speed: 1, hold: 0};
  for (let i = 0; i < NSH; i++) SH.push({a: 0, b: 0, d: 0, x: 0, y: 0, ang: 0, len: .2, ox: 0, oy: 0, vis: true});
  function findShadows() {
    const P = host.player, cx = Math.floor(P.x / SHADOW.cell), cy = Math.floor(P.y / SHADOW.cell), slot = Math.floor(clockNow() / SHADOW.slot);
    if (cx === SHK.cx && cy === SHK.cy && slot === SHK.slot) return;
    SHK.cx = cx; SHK.cy = cy; SHK.slot = slot;
    const r = Math.ceil(SHADOW.r / SHADOW.cell), seed = (SESSION.seed ?? 0) | 0; let n = 0;
    for (let a = cx - r; a <= cx + r; a++) for (let b = cy - r; b <= cy + r; b++) {
      if (!shadowAt(a, b, slot, seed, 0, SHQ)) continue;
      const d = Math.hypot(SHQ.hx - P.x, SHQ.hy - P.y); if (d > SHADOW.r || (n === NSH && d >= SH[n - 1].d)) continue;
      waterSample(SHQ.hx, SHQ.hy, WS3); if (!WATERS[WS3.kind] || (WS3.edge || 0) < SHADOW.edge + SHQ.rad) continue;
      let j = n < NSH ? n++ : NSH - 1; const s = SH[j]; s.a = a; s.b = b; s.d = d; s.ox = s.oy = 0; s.vis = true;
      while (j > 0 && SH[j - 1].d > SH[j].d) { const t = SH[j - 1]; SH[j - 1] = SH[j]; SH[j] = t; j--; }   // (kept nearest first)
    }
    SHK.n = n;
  }
  const shadowFade = () => { const t = clockNow() % SHADOW.slot; return clamp(Math.min(t, SHADOW.slot - t) / SHADOW.fade, 0, 1); };
  // where each swims now; with the burnt dish in him and his feet in the water they dart off to COME.flee m from him
  function moveShadows(dt) {
    const t = clockNow(), seed = (SESSION.seed ?? 0) | 0, P = host.player, flee = come < 0 && shallow(P.x, P.y);
    for (let i = 0; i < SHK.n; i++) {
      const s = SH[i]; shadowAt(s.a, s.b, SHK.slot, seed, t, SHQ);
      let tx = 0, ty = 0;
      if (flee) { const dx = SHQ.x - P.x, dy = SHQ.y - P.y, d = Math.hypot(dx, dy); if (d < COME.flee && d > .01) { const k = (COME.flee - d) / d; tx = dx * k; ty = dy * k; } }
      const e = 1 - Math.exp(-(flee ? 6 : 1.5) * dt); s.ox += (tx - s.ox) * e; s.oy += (ty - s.oy) * e;
      s.x = SHQ.x + s.ox; s.y = SHQ.y + s.oy; s.len = SHQ.len;
      const off = Math.abs(s.ox) + Math.abs(s.oy) > .3;
      s.ang = off ? Math.atan2(s.oy, s.ox) : SHQ.a;
      s.vis = !off || !!WATERS[waterSample(s.x, s.y, WS3).kind];   // (driven off: not onto the bank)
    }
  }

  // ---------------------------------------------------------------- the cursor on the water (world), as the sim reads it
  const CW = {x: 0, y: 0, d: 0, ok: false}, WS = {kind: 0, a: 0, hw: 0, edge: 0, s: 0, speed: 1, hold: 0};
  function cursorWater() {
    CW.ok = false;
    const gv = host.PL.cursorGround?.(); if (!gv) return CW;
    const c = Math.cos(host.yaw), s = Math.sin(host.yaw), P = host.player;
    CW.x = gv.x * c + gv.y * s; CW.y = -gv.x * s + gv.y * c; CW.d = Math.hypot(CW.x - P.x, CW.y - P.y);
    waterSample(CW.x, CW.y, WS); CW.ok = !!WATERS[WS.kind];
    return CW;
  }
  const baitLeft = () => { const pk = pack(); let n = 0; if (pk) for (const id in BAITS) n += pk.count(id); return n; };
  const free = () => { const P = host.player; return !host.lock && !host.paused && !host.BUSY.has(P.state) && P.state !== 'draw' && !host.PL.tool?.S.mode; };
  // can a press start a cast here: a rod, the cursor on water in reach (+ a little: it falls short of what's further), nothing
  // hostile under the cursor
  function canCast() {
    if (!active() || !rod() || !free()) return false;
    const w = cursorWater(); if (!w.ok || w.d > reach() + 3 || w.d < 1) return false;
    return !host.aim?.()?.target;
  }

  // ---------------------------------------------------------------- the sim's state
  const S = {
    phase: '', t: 0, n: 0,                 // '' | charge | fly | wait | bite | fight | land | reel; s in it; casts so far
    held: false, presses: 0, ups: 0,       // LMB (claimed): down now; presses / let-gos not yet read by the step
    charge: 0, perfect: false,             // the charge (0..1) and whether the cast was let go at its top
    ox: 0, oy: 0, tx: 0, ty: 0,            // where he cast from, where the bobber goes (world m)
    water: '', deep: 0,                    // the water it fell in, m from the shore
    r: null, local: true, askT: 0,         // the roll ({id, cm, kg, wait, nibbles, two}); rolled here or the server's; s asked
    nib: 0, lastNib: -9,                   // the nibbles passed; when the last one was (s, in the wait)
    win: 0,                                // the hook window (s)
    dist: 1, strain: 0, surge: '', sT: 0, nextS: 0, goneT: 0, clickT: 0, dragT: 0,   // the fight
    note: '',                              // a word for the gauge (view): 'let go!' etc.
    clock: 0,                              // s of sim (the spots' slot clock offline)
    spot: -1, near: false, bait: '',       // this cast: the spot it fell in (its key), near him with the lingon in him (COME.rod), the bait
  };
  const I = {id: '', cm: 0, kg: 0, n: 0, first: false, record: false, xp: 0, t: 0};   // the last catch (the card)
  const ev = (type, o) => { o.type = type; host.events.push(o); };
  const at = (x, y) => ({x, y});
  const say = (text, col = '#e8a070', h = 2) => { const P = host.player; ui()?.float(P.x, P.y, P.z + h, text, col); };

  function begin() { S.phase = 'charge'; S.t = 0; S.charge = 0; S.perfect = false; }
  function cast() {
    const P = host.player, w = cursorWater(), tri = x => 1 - Math.abs(1 - 2 * (x % 1));
    S.charge = tri(S.t / TUNE.cast.period); S.perfect = S.charge >= TUNE.cast.perfect;
    const far = TUNE.cast.min + (reach() - TUNE.cast.min) * S.charge;
    let dx = w.x - P.x, dy = w.y - P.y, d = Math.hypot(dx, dy);
    if (d < .05) { const f = P.faceAngle; dx = Math.sin(f); dy = Math.cos(f); d = 1; }
    const L = Math.min(Math.max(d, TUNE.cast.min * .6), far);
    S.ox = P.x; S.oy = P.y; S.tx = P.x + dx / d * L; S.ty = P.y + dy / d * L;
    const c = Math.cos(host.yaw), s = Math.sin(host.yaw); host.PL.faceShot?.((dx * c - dy * s), (dx * s + dy * c));   // (his view frame)
    host.play?.(THROW, .42);
    S.phase = 'fly'; S.t = 0; S.n++;
    ev('fish.cast', {x: P.x, y: P.y, tx: S.tx, ty: S.ty, perfect: S.perfect, k: S.charge});
  }
  function splashDown() {
    waterSample(S.tx, S.ty, WS);
    S.water = WATERS[WS.kind] || '';
    if (!S.water) { ev('fish.snag', at(S.tx, S.ty)); say('missed the water'); reelIn(); return; }
    S.deep = Math.max(0, WS.edge || 0);
    ev('fish.plop', at(S.tx, S.ty));
    const sp = liveSpot(S.tx, S.ty); S.spot = sp ? sp.key : -1;
    S.near = !sp && come > 0 && Math.hypot(S.tx - host.player.x, S.ty - host.player.y) <= COME.rod;   // (the lingon's fish round his legs: a spot of their own)
    if (sp || S.near) { ev('fish.spot', at(S.tx, S.ty)); say('a fishing spot!', '#9ad07a'); }
    S.bait = ''; const pk = pack();
    if (pk) for (const id in BAITS) if (pk.count(id) > 0 && pk.take(id, 1)) { S.bait = id; break; }
    S.phase = 'wait'; S.t = 0; S.nib = 0; S.lastNib = -9; S.r = null; S.askT = 0;
    const c = coop(), st = stats(), rain = (host.env?.sky?.rain ?? 0) > .3;
    if (c) { S.local = false; c.fish({a: 'cast', n: S.n, x: +S.tx.toFixed(2), y: +S.ty.toFixed(2), w: S.water, deep: +S.deep.toFixed(2), rain, perfect: S.perfect, lvl: pack()?.level('fishing') || 1,
      spot: S.spot >= 0 || S.near, bait: S.bait, meal: host.feature('meals')?.code || ''}); }   // (the meal's code: content/meals.js, a burnt one has no numbers)
    else { S.local = true; S.r = rollHere(st, rain); }
  }
  function rollHere(st, rain) {
    const r = roll(R, {water: S.water, part: host.env?.part || 'day', rain, deep: S.deep, luck: st['fish.luck'] + (rain ? st['fish.rain'] : 0), find: st['fish.find'],
      size: st['fish.size'], lure: st['fish.lure'], night: st['fish.night'], perfect: S.perfect, spot: S.spot >= 0 || S.near, bait: S.bait});
    r.two = R() < st['fish.double'];
    return r;
  }
  function reelIn(quiet = false) {   // the line comes in (no fish): .45 s of the bobber skipping back
    if (S.phase === 'fight' && !S.local) coop()?.fish({a: 'lost', n: S.n});
    if (!quiet) ev('fish.away', at(S.tx, S.ty));
    S.phase = 'reel'; S.t = 0; S.held = false;
  }
  function strike() {   // the bite taken: the fight starts
    const f = CATCHES[S.r.id].fight;
    S.phase = 'fight'; S.t = 0; S.dist = 1; S.strain = .15; S.surge = ''; S.sT = 0; S.goneT = 0; S.clickT = 0; S.dragT = 0;
    S.nextS = f.surge > 0 ? (.5 + R()) / f.surge : 1e9;
    ev('fish.hook', {x: S.tx, y: S.ty, id: S.r.id});
    host.hitstop?.(.05); host.shake?.(1.5, .1);
  }
  function fight(dt) {
    const r = S.r, f = CATCHES[r.id].fight, st = stats(), T = TUNE.reel, size = clamp((r.cm - CATCHES[r.id].cm[0]) / Math.max(1, CATCHES[r.id].cm[1] - CATCHES[r.id].cm[0]), 0, 1);
    const pull = f.pull * (.8 + .4 * size);   // (a big one pulls harder)
    // the surges: a warning (tell), then the thrash
    if (S.surge === '') { if ((S.nextS -= dt) <= 0) { S.surge = 'tell'; S.sT = T.tell; ev('fish.tell', fishAt()); } }
    else if ((S.sT -= dt) <= 0) {
      if (S.surge === 'tell') { S.surge = 'on'; S.sT = TUNE.surge.len[0] + (TUNE.surge.len[1] - TUNE.surge.len[0]) * R(); ev('fish.surge', fishAt()); }
      else { S.surge = ''; S.nextS = (.6 + 1.4 * R()) / f.surge; }
    }
    const on = S.surge === 'on';
    if (S.held) {
      S.dist -= T.speed * st['fish.reel'] / f.stam * (on ? .25 : 1) * dt;
      S.strain += (T.rise + (on ? pull * 1.5 : 0)) / st['fish.line'] * dt;
      S.note = on ? 'let go!' : '';
      if ((S.clickT -= dt) <= 0) { S.clickT = .085; ev('fish.reel', fishAt()); }
    } else {
      S.strain = Math.max(0, S.strain - T.fall * dt);
      S.dist = Math.min(1, S.dist + (on ? T.taken : T.slack) * dt);
      S.note = '';
      if (on && (S.dragT -= dt) <= 0) { S.dragT = .11; ev('fish.drag', fishAt()); }
    }
    if (S.strain >= 1) { ev('fish.snap', fishAt()); say('the line snapped!', '#ff7a5a'); host.shake?.(2, .12); reelIn(true); return; }
    if (S.dist >= 1) { if ((S.goneT += dt) > T.gone) { ev('fish.escape', fishAt()); say('it got away', '#e8a070'); reelIn(true); return; } } else S.goneT = 0;
    if (S.dist <= st['fish.net']) land();
  }
  // where the fish is now: on the line from the bobber's spot toward his feet, dist of the way out (world)
  const FA = {x: 0, y: 0};
  function fishAt() {
    const P = host.player, k = clamp(S.dist, 0, 1) * .85 + .15;
    FA.x = P.x + (S.tx - P.x) * k; FA.y = P.y + (S.ty - P.y) * k;
    return {x: FA.x, y: FA.y};
  }
  function land() {
    const o = fishAt(); o.id = S.r.id;
    ev('fish.leap', o);
    S.phase = 'land'; S.t = 0; S.held = false;
    host.hitstop?.(.06); host.shake?.(2, .12);
  }
  function give(r = S.r, hand = false) {   // the fish in the pouch, the XP, the records (hand: grabbed, no rod: COME)
    const c = CATCHES[r.id], n = r.two && !c.find ? 2 : 1, P = host.player, s = store();
    const first = !!s && !s.n[r.id], record = !!s && !c.find && r.cm > (s.best[r.id] || 0) && !first;
    if (s) { s.n[r.id] = (s.n[r.id] || 0) + n; if (!c.find && r.cm > (s.best[r.id] || 0)) s.best[r.id] = r.cm; pack()?.dirty(); }
    pack()?.give(r.id, n);
    const xp = Math.round(c.xp * (first ? 2 : 1) * (S.perfect && !hand ? 1.2 : 1));
    pack()?.gain('fishing', xp, {x: P.x, y: P.y, h: P.z + 2.2});
    Object.assign(I, {id: r.id, cm: r.cm, kg: r.kg, n, first, record, xp, t: 0});
    ev('fish.catch', {x: P.x, y: P.y, id: r.id, cm: r.cm, kg: r.kg, n, first, record, rarity: c.rarity});
    if (!hand && !S.local) coop()?.fish({a: 'land', n: S.n});
    if (!hand && S.spot >= 0) { spent.add(S.spot); S.spot = -1; }
    jV++;
  }

  // what a recipe costs from the pouch: each need paid with the kind he has most of ({ids, n}[] -> {id: n}: game/inventory.js)
  const costOf = need => pack()?.payOf(need) || {};
  const short = o => pack()?.short(o) ?? true;
  const kinds = ids => ids === COMMON_FISH ? 'small fish' : ids.length > 4 ? 'fish' : ids.map(id => CATCHES[id].name).join(' or ');
  const RECIPES = [];
  for (const id in BAITS) {
    const B = BAITS[id], need = [{ids: B.from, n: 1}];
    RECIPES.push({id: 'bait.' + id, name: `${B.name} x${B.n}`, group: 'Bait',
      get cost() { return costOf(need); },
      desc: `${B.desc} Cut from one ${kinds(B.from)}; one goes on the hook each cast while you have it.`,
      can: () => short(costOf(need)) ? `needs a ${B.from.map(f => CATCHES[f].name).join(', ')}` : '',
      run() {
        const c = costOf(need); if (short(c)) return;
        for (const k in c) pack().take(k, c[k]);
        const P = host.player; pack().give(id, B.n, {x: P.x, y: P.y, h: P.z + 1.6});
        ev('fish.bait', {x: P.x, y: P.y, id});
      }});
  }

  // ---------------------------------------------------------------- the journal: the pack panel's Fish part
  let jV = 0, setN = 0, setV = -1;
  const SIL = {};
  function silhouette(id) {   // a catch not caught yet: its shape in one dark colour
    if (SIL[id]) return SIL[id];
    const {rows} = catchIcon(id), pal = {}; for (const r of rows) for (const ch of r) pal[ch] = '#6a5d4e';
    return SIL[id] = iconURL(rows, pal);
  }
  const JOURNAL = {id: 'fish', title: 'Fish',
    ver: () => jV * 4096 + setN * 512 + (host.feature('meals')?.ver() || 0),
    html(esc, icon) {
      const s = store() || {n: {}, best: {}}; let h = '<div class="p-bag p-grid7">', got = 0, all = 0;
      for (const id of CATCH_IDS) {
        const c = CATCHES[id], n = s.n[id] || 0, rar = RARITY[c.rarity]?.name || c.rarity;
        if (n) {
          got++; all += n; const b = s.best[id];
          h += `<div class="p-slot" title="${esc(c.name)} (${esc(rar)}): ${n} caught${b ? `, best ${b} cm` : ''}. ${esc(c.desc)}"><img src="${icon(id)}" alt="">${n > 1 ? `<em>${n > 99 ? '99+' : n}</em>` : ''}</div>`;
        } else h += `<div class="p-slot p-dim" title="??? (${esc(rar)}): ${esc(hintOf(id))}"><img src="${silhouette(id)}" alt=""></div>`;
      }
      h += `</div><div class="p-note">${got} / ${CATCH_IDS.length} kinds found · ${all} caught</div>`;
      h += `<div class="p-note">${esc(ANGLER.name)}: ${setN} / ${ANGLER.n} fishing pieces worn${setN >= ANGLER.n ? ` (${esc(ANGLER.say)})` : ''}</div>`;
      h += host.feature('meals')?.note(esc) || '';
      return h;
    }};
  let offered = false;
  // each step, fishing or not: the recipes and the journal offered to the pack (once: it is made after this feature), the
  // angler's set (on a change of the set worn)
  function keep(dt) {
    const pk = pack();
    if (!offered && pk) { offered = true; for (const r of RECIPES) pk.recipe(r); pk.section(JOURNAL); }
    const g = host.feature('gear');
    if (g && g.S.ver !== setV) {
      setV = g.S.ver; let n = 0; for (const id of g.S.worn) if (gearById(id)?.kind === 'fishing') n++;
      const was = setN >= ANGLER.n; setN = n;
      if (n >= ANGLER.n && !was) { host.mods.set('fishing.set', ANGLER.notes); ui()?.toast(ANGLER.name, ANGLER.say, '#7ec8e3'); }
      else if (n < ANGLER.n && was) host.mods.clear('fishing.set');
    }
  }
  // a press (LMB down, claimed) and a let-go, in the step
  function press() {
    const ph = S.phase;
    if (ph === '') { if (canCast()) begin(); return; }
    if (ph === 'wait') {
      if (S.r && S.t - S.lastNib < .45) { S.r.wait += TUNE.spook; S.lastNib = -9; ev('fish.early', at(S.tx, S.ty)); say('too early!'); return; }
      reelIn(); return;
    }
    if (ph === 'bite') { strike(); return; }
    if (ph === 'fly') return;
  }
  function letGo() { if (S.phase === 'charge') cast(); }

  // ---------------------------------------------------------------- fish come to you (content/fishing.js COME; the 'fish.come' note)
  // the sim: standing still in shallow water with the lingon in him (or a friend's burnt one near) a while, a school gathers
  // ('come': sliding in, then 'circle'); now and then one turns past his feet and flashes ('flash': its index, flashT s left): E then
  // grabs it, E otherwise misses (they scatter: 'leave', and none come for COME.scatter s). Walking off, fishing, leaving the
  // water: they swim off. The view draws them where the sim says (SF: angle round him, ring radius, angular speed, from how far)
  const SC = {phase: '', t: 0, still: 0, scatter: 0, x: 0, y: 0, n: 0, next: 0, flash: -1, flashT: 0, press: 0, wait: -1, askT: 0, grabs: 0};
  const SF = []; for (let i = 0; i < COME.n[1]; i++) SF.push({a: 0, r: 1, w: 1, d0: 10, len: .2});
  const LINGON_BURNT = codeOf('fish_lingon', 'burnt'), PS = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', w: null, ls: null}, MC = {id: '', q: 'done'};
  let come = 0, comeV = -1;
  // shallow water under (x, y): the lake's, a stream's, a river's edge, not the swimming water
  const shallow = (x, y) => !!WATERS[waterSample(x, y, WS3).kind] && !host.inStream?.(x, y);
  function burntFriendNear(P) {   // a friend with the burnt dish in them within COME.friend: their fish come to me
    const C = host.feature('coop')?.net; if (!C?.peers) return false;
    for (const p of C.peers.values()) if (p.md === LINGON_BURNT && C.sample(p, PS) && Math.hypot(PS.x - P.x, PS.y - P.y) <= COME.friend) return true;
    return false;
  }
  const turn = () => COME.turn[0] + (COME.turn[1] - COME.turn[0]) * R();
  function gather(P) {
    SC.phase = 'come'; SC.t = 0; SC.still = 0; SC.x = P.x; SC.y = P.y; SC.flash = -1;
    SC.n = COME.n[0] + Math.floor(R() * (COME.n[1] - COME.n[0] + 1));
    const dir = R() < .5 ? -1 : 1;
    for (let i = 0; i < SC.n; i++) {
      const f = SF[i]; f.a = R() * Math.PI * 2; f.r = COME.ring[0] + (COME.ring[1] - COME.ring[0]) * R();
      f.w = dir * (.35 + .3 * R()) / f.r; f.d0 = COME.from[0] + (COME.from[1] - COME.from[0]) * R(); f.len = .14 + .1 * R();
    }
    ev('fish.gather', {x: P.x, y: P.y, n: SC.n});
  }
  function leave() { if (SC.phase && SC.phase !== 'leave') { SC.phase = 'leave'; SC.t = 0; SC.flash = -1; } SC.still = 0; }
  function rollHand() {
    const st = stats(), P = host.player, rain = (host.env?.sky?.rain ?? 0) > .3;
    return roll(R, {water: WATERS[waterSample(P.x, P.y, WS3).kind] || 'lake', part: host.env?.part || 'day', rain, deep: 0, luck: st['fish.luck'] + (rain ? st['fish.rain'] : 0),
      size: st['fish.size'], lure: 1, hand: true});
  }
  function handCatch(r) { r.two = false; give(r, true); }
  function grab() {   // E while they circle: the one flashing past his feet, or a miss
    const P = host.player;
    if (SC.flash < 0) { ev('fish.grab', {x: P.x, y: P.y, ok: false}); say('missed!'); SC.scatter = COME.scatter; leave(); return; }
    const f = SF[SC.flash], x = SC.x + Math.cos(f.a) * f.r * .4, y = SC.y + Math.sin(f.a) * f.r * .4;
    SF[SC.flash] = SF[SC.n - 1]; SF[SC.n - 1] = f; SC.n--; SC.flash = -1; SC.next = turn();   // (swapped out of the school: no allocation)
    ev('fish.grab', {x, y, ok: true});
    const c = coop();
    if (c) { SC.wait = ++SC.grabs; SC.askT = 0; c.fish({a: 'grab', n: SC.wait, x: +P.x.toFixed(2), y: +P.y.toFixed(2), w: WATERS[waterSample(P.x, P.y, WS3).kind] || '',
      lvl: pack()?.level('fishing') || 1, rain: (host.env?.sky?.rain ?? 0) > .3, meal: host.feature('meals')?.code || ''}); }
    else handCatch(rollHand());
    if (!SC.n) leave();
  }
  function school(dt) {
    const m = host.mods; if (m.ver !== comeV) { comeV = m.ver; come = m.value('fish.come', 0); }
    if (SC.scatter > 0) SC.scatter -= dt;
    if (SC.wait >= 0 && (SC.askT += dt) > TUNE_NET.ask) { SC.wait = -1; handCatch(rollHand()); }   // (no word from the server: an old one)
    while (SC.press > 0) { SC.press--; if (SC.phase === 'circle') grab(); }
    const P = host.player, sp = Math.hypot(P.vx || 0, P.vy || 0);
    const lure = come > 0 || (come === 0 && burntFriendNear(P));
    const here = lure && !S.phase && free() && sp < COME.slow && shallow(P.x, P.y);
    if (SC.phase === 'leave') { if ((SC.t += dt) > 1.2) SC.phase = ''; }
    else if (SC.phase) {
      if (!here) leave();
      else {
        SC.t += dt; SC.x = P.x; SC.y = P.y;
        if (SC.phase === 'come' && SC.t >= COME.arrive) { SC.phase = 'circle'; SC.next = turn(); }
        for (let i = 0; i < SC.n; i++) SF[i].a += SF[i].w * dt;
        if (SC.phase === 'circle') {
          if (SC.flash >= 0 && (SC.flashT -= dt) <= 0) SC.flash = -1;
          if (SC.flash < 0 && SC.n > 0 && (SC.next -= dt) <= 0) { SC.flash = Math.floor(R() * SC.n); SC.flashT = COME.flash; SC.next = turn(); }
        }
      }
    }
    if (!SC.phase) { if (here && SC.scatter <= 0) { if ((SC.still += dt) >= COME.still) gather(P); } else SC.still = 0; }
  }

  // ---------------------------------------------------------------- the view's state
  const RINGS = [], DROPS = [], NR = 40, ND = 120;   // water rings {x, y, h, r, t, life, big}; spray {x, y, h, vx, vy, vh, t, life, c}
  for (let i = 0; i < NR; i++) RINGS.push({x: 0, y: 0, h: 0, r: 0, t: 0, life: 0, big: 0, on: false});
  for (let i = 0; i < ND; i++) DROPS.push({x: 0, y: 0, h: 0, vx: 0, vy: 0, vh: 0, t: 0, life: 0, on: false});
  function ring(x, y, big = 0) { for (const r of RINGS) if (!r.on) { r.on = true; r.x = x; r.y = y; r.h = host.elev(x, y) + .02; r.t = 0; r.life = big ? 1.4 : .9; r.big = big; return; } }
  function spray(x, y, n, v = 1.6) {
    const h = host.elev(x, y) + .05;
    for (let i = 0, k = 0; i < ND && k < n; i++) {
      const d = DROPS[i]; if (d.on) continue; k++;
      const a = VR() * Math.PI * 2, s = (.3 + VR()) * v * .6;
      d.on = true; d.x = x; d.y = y; d.h = h; d.vx = Math.cos(a) * s; d.vy = Math.sin(a) * s; d.vh = (1 + VR() * 1.5) * v; d.t = 0; d.life = .5 + VR() * .4;
    }
  }
  const V = {bob: 0, dip: 0, under: 0, fx: 0, fy: 0, dart: 0, dartV: 0, leapT: -1, lx: 0, ly: 0, flash: 0, bang: 0, card: 0, peer: null, peerT: 0};
  const COL = {rod: '#c4bc7c', line: '#e8e4d8', red: '#d83a2a', white: '#f4f0e6', ring: '#d8ecf0', drop: '#e8f6fa', shade: '#0e1c20', glow: '#b8c8f0', silver: '#e8f0f6'};
  const P1 = {size: 1}, P2 = {size: 2}, P2A = {size: 2, alpha: .55}, P1A = {size: 1, alpha: .6}, P2E = {size: 2, emit: true}, P3A = {size: 3, alpha: .75};
  const PSP = {size: 2, alpha: .9};   // (the spots' bubbles: alpha follows the slot's fade in and out)
  const PRL = []; for (let i = 1; i <= 8; i++) PRL.push({size: 1, alpha: i / 8});   // (the spots' ripples: alpha in 8 steps)
  // how present the spots are now (0..1): they fade in at the slot's start and out at its end (SPOT.fade s)
  const spotFade = () => { const t = clockNow() % SPOT.slot; return clamp(Math.min(t, SPOT.slot - t) / SPOT.fade, 0, 1); };
  // the fish's leap sprite: its icon with an outline (content/fishing.js catchIcon), a canvas each, made once
  const SPR = {};
  function spriteOf(id) {
    if (SPR[id]) return SPR[id];
    const {rows, pal} = catchIcon(id), c = document.createElement('canvas'); c.width = c.height = 14; const q = c.getContext('2d');
    const filled = (x, y) => y >= 0 && y < 12 && x >= 0 && x < 12 && rows[y][x] !== '.';
    for (let y = -1; y <= 12; y++) for (let x = -1; x <= 12; x++) {
      if (filled(x, y)) { q.fillStyle = pal[rows[y][x]] || '#f0f'; q.fillRect(x + 1, y + 1, 1, 1); }
      else if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1)) { q.fillStyle = '#1a120c'; q.fillRect(x + 1, y + 1, 1, 1); }
    }
    return SPR[id] = c;
  }

  // the rod in his hands and the line, this frame (world): the hand, the tip, the bobber
  const RD = {hx: 0, hy: 0, hh: 0, tx: 0, ty: 0, th: 0, bx: 0, by: 0, bh: 0, fx: 0, fy: 0, show: false, taut: 0, under: false};
  function pose(dt) {
    const P = host.player, ph = S.phase; RD.show = ph !== '' && !!rod(); if (!RD.show) return;
    const hand = host.playerRopeHand?.();
    let fx = S.tx - P.x, fy = S.ty - P.y; const fl = Math.hypot(fx, fy);
    if (ph === 'charge' || fl < .1) { const f = P.faceAngle; fx = Math.sin(f); fy = Math.cos(f); } else { fx /= fl; fy /= fl; }
    RD.fx = fx; RD.fy = fy;
    if (hand) { RD.hx = hand.x; RD.hy = hand.y; RD.hh = hand.h; } else { RD.hx = P.x + fx * .25 - fy * .18; RD.hy = P.y + fy * .25 + fx * .18; RD.hh = P.z + 1; }
    // the tip: up and out in front; cocked back over his shoulder while charging; whipped forward as it flies; bent to the fish
    let out = 1.25, up = 1.1;
    if (ph === 'charge') { const k = S.charge; out = 1.1 - 1.6 * k; up = 1.2 + .45 * k; }
    else if (ph === 'fly') { const k = clamp(S.t / .18, 0, 1); out = -.5 + 1.95 * k; up = 1.65 - .7 * k; }
    else if (ph === 'fight') { const b = .25 + .55 * S.strain; out = 1.25 - b * .6; up = 1.1 - b * .9; }
    else if (ph === 'bite') { out = 1.3; up = .95; }
    RD.tx = RD.hx + fx * out; RD.ty = RD.hy + fy * out; RD.th = RD.hh + up;
    // the bobber
    const wh = host.elev(S.tx, S.ty);
    if (ph === 'charge') { RD.bx = RD.tx; RD.by = RD.ty; RD.bh = RD.th - .45; }
    else if (ph === 'fly') {
      const k = clamp(S.t / TUNE.cast.fly, 0, 1);
      RD.bx = RD.tx + (S.tx - RD.tx) * k; RD.by = RD.ty + (S.ty - RD.ty) * k; RD.bh = RD.th + (wh - RD.th) * k + TUNE.cast.arc * 4 * k * (1 - k);
    } else if (ph === 'reel') {
      const k = clamp(S.t / .45, 0, 1), e = k * k;
      RD.bx = S.tx + (RD.tx - S.tx) * e; RD.by = S.ty + (RD.ty - S.ty) * e; RD.bh = wh + (RD.th - .45 - wh) * e + .25 * Math.sin(Math.PI * k);
    } else if (ph === 'fight' || ph === 'land') { RD.bx = V.fx; RD.by = V.fy; RD.bh = host.elev(V.fx, V.fy) + .02; }
    else { RD.bx = S.tx; RD.by = S.ty; RD.bh = wh + .03 + V.bob - V.dip; }
    RD.taut = ph === 'fight' ? .6 + .4 * S.strain : ph === 'fly' ? .9 : ph === 'charge' ? 1 : .15;
    RD.under = ph === 'fight' || ph === 'land' || (ph === 'bite' && V.under > .5);
  }
  // a quadratic curve as n pixel lines (world), colour c
  function curve(x0, y0, h0, cx, cy, ch, x1, y1, h1, n, c, emit = false) {
    let px = x0, py = y0, ph = h0;
    for (let i = 1; i <= n; i++) {
      const t = i / n, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), d = t * t;
      const x = a * x0 + b * cx + d * x1, y = a * y0 + b * cy + d * y1, h = a * h0 + b * ch + d * h1;
      host.line(px, py, ph, x, y, h, c, emit); px = x; py = y; ph = h;
    }
  }

  // the fish under the water: dark shapes (five points along its way, the tail wagging); the lingon's school, its flash silver
  const PSH = [{size: 1, alpha: .5}, {size: 2, alpha: .42}], PSC = [{size: 1, alpha: .6}, {size: 2, alpha: .5}], PSV = [{size: 1, alpha: .95, emit: true}, {size: 2, alpha: .95, emit: true}];
  function fishShape(x, y, ang, len, wig, o) {
    const h = host.elev(x, y) + .012, cx = Math.cos(ang), cy = Math.sin(ang), c = o === PSV ? COL.silver : COL.shade;
    for (let k = 0; k < 5; k++) {
      const u = (k / 4 - .5) * len, tw = k === 0 ? wig : 0;
      host.point(x + cx * u - cy * tw, y + cy * u + cx * tw, h, c, o[k === 0 || k === 4 ? 0 : 1]);
    }
  }
  function drawFish() {
    if (!active()) return;
    const t = performance.now() / 1000, fade = shadowFade();
    if (fade > 0) {
      PSH[0].alpha = .5 * fade; PSH[1].alpha = .42 * fade;
      for (let i = 0; i < SHK.n; i++) { const s = SH[i]; if (s.vis) fishShape(s.x, s.y, s.ang, s.len, Math.sin(t * 6 + i * 2.1) * .03, PSH); }
    }
    if (SC.phase) for (let i = 0; i < SC.n; i++) {
      const f = SF[i], fl = i === SC.flash; let r = f.r, ang = f.a + Math.sign(f.w) * Math.PI / 2;
      if (SC.phase === 'come') { const k = clamp(SC.t / COME.arrive, 0, 1); r = f.d0 + (f.r - f.d0) * (1 - (1 - k) * (1 - k)); if (k < 1) ang = f.a + Math.PI; }
      else if (SC.phase === 'leave') { r = f.r + SC.t * 7; ang = f.a; }
      if (fl) r *= 1 - .6 * Math.sin(Math.PI * clamp(1 - SC.flashT / COME.flash, 0, 1));   // (it turns in past his feet)
      const x = SC.x + Math.cos(f.a) * r, y = SC.y + Math.sin(f.a) * r;
      if (SC.phase !== 'circle' && !WATERS[waterSample(x, y, WS3).kind]) continue;   // (coming in or going: not over the bank)
      fishShape(x, y, ang, f.len, Math.sin(t * 9 + i * 1.7) * .035, fl ? PSV : PSC);
    }
    // a friend with the dish in them, in the water: a few at their legs too (view only: their own client has the real school)
    const Cn = host.feature('coop')?.net;
    if (Cn?.peers) for (const p of Cn.peers.values()) {
      if (!p.md) continue; parseCode(p.md, MC); if (MC.id !== 'fish_lingon' || MC.q === 'burnt' || !Cn.sample(p, PS) || !shallow(PS.x, PS.y)) continue;
      for (let i = 0; i < 4; i++) { const a = t * .6 + i * 1.571 + (p.id | 0), r = .7 + .25 * Math.sin(i * 2.3 + t * .3); fishShape(PS.x + Math.cos(a) * r, PS.y + Math.sin(a) * r, a + Math.PI / 2, .18, Math.sin(t * 9 + i) * .03, PSC); }
    }
  }

  const F = {
    name: 'fishing', label: 'Fishing', on: ON, S,
    get fishing() { return S.phase !== ''; },
    // E: grab the fish flashing past his feet (the lingon's school, while it circles)
    onKey(k) {
      if (k !== 'e' || SC.phase !== 'circle' || !active() || host.lock) return false;
      SC.press++; return true;
    },
    // other features' question (briefs/depth-shared.md: fishing draws the fish): the shadows within r m of (x, y) now -> how many;
    // out: your array of {x, y, ang, len} objects, filled from 0 (no more than out.length)
    shadowsNear(x, y, r, out) {
      let k = 0;
      for (let i = 0; i < SHK.n && k < out.length; i++) { const s = SH[i]; if (s.vis && Math.hypot(s.x - x, s.y - y) <= r) { const o = out[k++]; o.x = s.x; o.y = s.y; o.ang = s.ang; o.len = s.len; } }
      return k;
    },
    // (tests) the lingon's school: phase, how many, the one flashing
    get school() { return SC; },
    // LMB (core/input.js, before the player's own): down -> true when it's the rod's (then its let-go comes here too)
    lmb(down) {
      if (!down) { if (!S.held && S.phase !== 'charge') return false; S.held = false; S.ups++; return true; }
      if (S.phase === '' && !canCast()) return false;
      S.held = true; S.presses++; return true;
    },
    update(dt, evs) {
      const ph0 = S.phase;
      if (!ON) return;
      S.clock += dt; keep(dt);
      if (!active()) { if (ph0) { S.phase = ''; S.r = null; } S.presses = S.ups = 0; S.held = false; SC.phase = ''; SC.press = 0; return; }
      // the server's word (co-op): the roll for our cast, others' catches
      const c = coop();
      if (c) for (const m of c.mail) {
        if (m.k !== 'fish') continue;
        if (m.a === 'bite' && m.n === S.n && S.phase === 'wait' && !S.r && typeof m.id === 'string' && CATCHES[m.id]) {
          S.r = {id: m.id, cm: +m.cm || CATCHES[m.id].cm[0], kg: +m.kg || 0, wait: +m.wait || 4, nibbles: Array.isArray(m.nibbles) ? m.nibbles.map(Number) : [], two: !!m.two};
        } else if (m.a === 'grabbed' && m.n === SC.wait && typeof m.id === 'string' && CATCHES[m.id]) {
          SC.wait = -1; handCatch({id: m.id, cm: +m.cm || CATCHES[m.id].cm[0], kg: +m.kg || 0});
        } else if (m.a === 'caught' && m.id !== c.net.id && CATCHES[m.c]) { V.peer = m; V.peerT = 0; ui()?.toast(`${m.name || 'A friend'} caught a ${CATCHES[m.c].name}`, isFish(m.c) ? `${m.cm} cm` : '', RARITY[CATCHES[m.c].rarity]?.col); }
      }
      // presses since the last step, in order: a press, then (maybe) its let-go
      while (S.presses > 0 || S.ups > 0) {
        if (S.presses > 0) { S.presses--; press(); }
        if (S.ups > 0 && S.presses === 0) { S.ups--; letGo(); }
      }
      findSpots();
      school(dt);
      if (!S.phase) return;
      S.t += dt;
      const P = host.player;
      // off: the rod taken off, a roll or a fall, walking off from where he cast
      const busy = host.BUSY.has(P.state) && P.state !== 'hold';
      if (S.phase !== 'land' && S.phase !== 'reel' && (!rod() || busy || host.lock || (S.phase !== 'charge' && Math.hypot(P.x - S.ox, P.y - S.oy) > TUNE.stray))) {
        if (S.phase === 'charge') { S.phase = ''; return; }
        if (S.phase === 'fight') { ev('fish.escape', fishAt()); say('it got away'); }
        reelIn(S.phase === 'fight'); return;
      }
      switch (S.phase) {
        case 'charge': { const tri = x => 1 - Math.abs(1 - 2 * (x % 1)); S.charge = tri(S.t / TUNE.cast.period); break; }
        case 'fly': if (S.t >= TUNE.cast.fly) splashDown(); break;
        case 'wait': {
          if (!S.r) { if ((S.askT += dt) > TUNE_NET.ask) { S.local = true; S.r = rollHere(stats(), (host.env?.sky?.rain ?? 0) > .3); S.t = 0; } else { S.t = 0; break; } }
          const nb = S.r.nibbles;
          while (S.nib < nb.length && S.t >= nb[S.nib]) { S.nib++; S.lastNib = S.t; ev('fish.nibble', at(S.tx, S.ty)); }
          if (S.t >= S.r.wait) { S.phase = 'bite'; S.t = 0; S.win = TUNE.hook + stats()['fish.hook']; ev('fish.bite', at(S.tx, S.ty)); }
          break;
        }
        case 'bite':
          if (S.t >= S.win) { ev('fish.slip', at(S.tx, S.ty)); say('it slipped the hook'); S.phase = 'wait'; S.t = 0; S.nib = 0; S.r.nibbles = []; S.r.wait = TUNE.rebite[0] + (TUNE.rebite[1] - TUNE.rebite[0]) * R(); }
          break;
        case 'fight': {
          const f = fishAt(), c2 = Math.cos(host.yaw), s2 = Math.sin(host.yaw), dx = f.x - P.x, dy = f.y - P.y;
          if (dx * dx + dy * dy > .01) host.PL.faceShot?.(dx * c2 - dy * s2, dx * s2 + dy * c2);
          if (P.state !== 'hold') host.play?.(HAUL, .5);   // (he braces and hauls while the fight lasts)
          fight(dt); break;
        }
        case 'land': if (S.t >= .7) { give(); S.phase = ''; S.r = null; } break;
        case 'reel': if (S.t >= .45) { S.phase = ''; S.r = null; } break;
      }
    },
    view(dt, evs) {
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        switch (e.type) {
          case 'fish.plop': ring(e.x, e.y, 0); spray(e.x, e.y, 5, .9); V.bob = .12; break;
          case 'fish.nibble': V.dip = .08; ring(e.x, e.y, 0); break;
          case 'fish.bite': V.under = 1; V.bang = 1; ring(e.x, e.y, 1); spray(e.x, e.y, 9, 1.4); break;
          case 'fish.hook': V.fx = S.tx; V.fy = S.ty; V.dart = 0; V.dartV = 0; spray(e.x, e.y, 10, 1.6); ring(e.x, e.y, 1); break;
          case 'fish.surge': spray(e.x, e.y, 14, 2); ring(e.x, e.y, 1); break;
          case 'fish.tell': ring(e.x, e.y, 0); spray(e.x, e.y, 3, .8); break;
          case 'fish.leap': V.leapT = 0; V.lx = e.x; V.ly = e.y; spray(e.x, e.y, 20, 2.4); ring(e.x, e.y, 1); ring(e.x, e.y, 0); break;
          case 'fish.catch': V.card = 3.4; V.leapT = -1; break;
          case 'fish.snap': case 'fish.escape': spray(e.x, e.y, 8, 1.4); ring(e.x, e.y, 1); break;
          case 'fish.cast': V.flash = S.perfect ? .5 : 0; break;
        }
      }
      // the bobber's life on the water
      V.bob = S.phase === 'wait' ? .012 * Math.sin(performance.now() / 260) + V.bob * Math.exp(-6 * dt) : 0;
      V.dip *= Math.exp(-9 * dt); V.under = S.phase === 'bite' ? Math.min(1, V.under + dt * 6) : V.under * Math.exp(-8 * dt);
      V.bang = Math.max(0, V.bang - dt); V.flash = Math.max(0, V.flash - dt); if (V.card > 0) V.card -= dt; if (V.peer) V.peerT += dt;
      // the fish on the line: where the sim says, darting across (view only)
      if (S.phase === 'fight') {
        const f = fishAt(), Fd = CATCHES[S.r.id].fight;
        V.dartV += ((VR() - .5) * 18 * (S.surge === 'on' ? 3 : 1) - V.dart * 4 - V.dartV * 2.5) * dt; V.dart += V.dartV * dt;
        V.dart = clamp(V.dart, -Fd.dart, Fd.dart);
        const P = host.player, dx = S.tx - P.x, dy = S.ty - P.y, l = Math.hypot(dx, dy) || 1, k = clamp(S.dist, 0, 1);
        V.fx = f.x - dy / l * V.dart * k; V.fy = f.y + dx / l * V.dart * k;
        if (VR() < dt * (S.surge === 'on' ? 14 : 2.5)) ring(V.fx, V.fy, 0);
        if (S.surge === 'on' && VR() < dt * 20) spray(V.fx, V.fy, 2, 1.3);
      }
      if (V.leapT >= 0) V.leapT += dt;
      for (const r of RINGS) if (r.on && (r.t += dt) > r.life) r.on = false;
      for (const d of DROPS) if (d.on) {
        if ((d.t += dt) > d.life) { d.on = false; continue; }
        d.vh -= 9 * dt; d.x += d.vx * dt; d.y += d.vy * dt; d.h += d.vh * dt;
      }
      // the spots: a ring now and then, a fish breaking the surface once in a while
      const fade = spotFade();
      for (let i = 0; i < SPK.n; i++) {
        const sp = SP[i]; if (spent.has(sp.key)) continue;
        if (VR() < dt * 2.2 * fade) ring(sp.x + (VR() - .5) * .8, sp.y + (VR() - .5) * .8, VR() < .3 ? 1 : 0);
        if (VR() < dt * .12 * fade) { spray(sp.x, sp.y, 7, 1.3); ring(sp.x, sp.y, 1); }
      }
      pose(dt);
      if (active()) { findShadows(); moveShadows(dt); } else { SHK.n = 0; SHK.slot = -1; }
    },
    frame() {
      drawFish();
      // rings and spray
      for (const r of RINGS) {
        if (!r.on) continue;
        const k = r.t / r.life, rad = (r.big ? .25 : .12) + k * (r.big ? .9 : .5), n = r.big ? 16 : 10, o = k < .5 ? P1 : P1A;
        for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; host.point(r.x + Math.cos(a) * rad, r.y + Math.sin(a) * rad * .8, r.h, COL.ring, o); }
      }
      for (const d of DROPS) if (d.on) host.point(d.x, d.y, d.h, COL.drop, P1);
      // the spots' bubbles: a few points wheeling slowly over each, popping in and out
      const fade = spotFade();
      if (fade > 0 && SPK.n) {
        PSP.alpha = .9 * fade; const t = performance.now() / 1000;
        for (let i = 0; i < SPK.n; i++) {
          const sp = SP[i]; if (spent.has(sp.key)) continue;
          const h = host.elev(sp.x, sp.y) + .03, k0 = (sp.key % 97) * .37;
          for (let w = 0; w < 2; w++) {   // two ripples always spreading out from it, one after the other
            const k = (t * .45 + k0 + w * .5) % 1, rad = .2 + k * 1.1, a = Math.round(.85 * (1 - k) * fade * 8);
            if (a < 1) continue;
            for (let i = 0; i < 18; i++) { const an = i / 18 * Math.PI * 2; host.point(sp.x + Math.cos(an) * rad, sp.y + Math.sin(an) * rad * .8, h - .01, COL.ring, PRL[a - 1]); }
          }
          for (let j = 0; j < 6; j++) {
            const ph = t * (.5 + .13 * j) + k0 + j * 1.7; if (Math.sin(ph * 3.1 + j) < -.2) continue;   // (a bubble pops, another comes)
            const r = .15 + .35 * ((j * .29 + k0) % 1);
            host.point(sp.x + Math.cos(ph) * r, sp.y + Math.sin(ph) * r * .8, h, COL.white, PSP);
          }
        }
      }
      if (RD.show) {
        const g = rod(), rc = g?.fish?.tip || COL.rod, lc = g?.fish?.line || COL.line, glow = !!g?.fish?.glow;
        // the rod: a gentle curve from his hand (a little behind it) to the tip, bent toward the line by the strain
        const bx = RD.hx - RD.fx * .3, by = RD.hy - RD.fy * .3, bh = RD.hh - .18;
        const mx = (bx + RD.tx) / 2 + RD.fx * .05, my = (by + RD.ty) / 2 + RD.fy * .05, mh = (bh + RD.th) / 2 + .18 * (1 - (S.phase === 'fight' ? S.strain : 0));
        curve(bx, by, bh, mx, my, mh, RD.tx, RD.ty, RD.th, 4, rc, glow);
        // the line: sagging when slack, straight when taut
        if (S.phase !== 'land' || V.leapT < .1) {
          const sag = (1 - RD.taut) * Math.min(1.2, Math.hypot(RD.bx - RD.tx, RD.by - RD.ty) * .18);
          curve(RD.tx, RD.ty, RD.th, (RD.tx + RD.bx) / 2, (RD.ty + RD.by) / 2, (RD.th + RD.bh) / 2 - sag, RD.bx, RD.by, RD.bh + (RD.under ? 0 : .05), 8, lc, glow);
        }
        // the bobber (not while it's under)
        if (!RD.under && S.phase !== 'fight') { host.point(RD.bx, RD.by, RD.bh + .07, COL.red, P2); host.point(RD.bx, RD.by, RD.bh + .02, COL.white, P2); }
        // the fish under the water: a dark shape the size of it, along the line
        if (S.phase === 'fight') {
          const len = clamp(S.r.cm / 100, .15, 1), P = host.player, dx = V.fx - P.x, dy = V.fy - P.y, l = Math.hypot(dx, dy) || 1, h = host.elev(V.fx, V.fy) + .01;
          for (let i = 0; i < 7; i++) { const u = (i / 6 - .5) * len, w = i > 0 && i < 6 ? P3A : P2A; host.point(V.fx + dx / l * u, V.fy + dy / l * u, h, COL.shade, w); }
        }
      }
      // the leap: the fish out of the water to him (its sprite on an arc), flipping as it goes
      if (V.leapT >= 0 && S.r && S.phase === 'land') {
        const P = host.player, k = clamp(V.leapT / .7, 0, 1), x = V.lx + (P.x - V.lx) * k, y = V.ly + (P.y - V.ly) * k;
        const h = host.elev(V.lx, V.ly) + (P.z + 1.6 - host.elev(V.lx, V.ly)) * k + 1.6 * 4 * k * (1 - k);
        host.sprite({img: spriteOf(S.r.id), x, y, h, flip: ((V.leapT * 10) | 0) % 2 === 1});
      }
    },
    // the HD layer: the prompt, the charge meter, the "!", the fight gauge, the catch card
    hd(q, sc) { drawHD(q, sc); },
    hud: () => active() ? `fishing ${S.phase || (rod() ? 'rod ready' : 'no rod')} · ${SPK.n} spots${setN >= ANGLER.n ? ' · set' : ''}${S.r ? ' ' + S.r.id + ' ' + S.r.cm + 'cm' : ''}${S.phase === 'fight' ? ` dist ${S.dist.toFixed(2)} strain ${S.strain.toFixed(2)} ${S.surge}` : ''} · ${SHK.n} shadows${SC.phase ? ` · school ${SC.phase} ${SC.n}` : ''}` : '',
    // (tests) the catch log: {n: {id: count}, best: {id: cm}}
    get log() { return store(); },
    // (tests) the rod and line as drawn this frame (world): hand, tip, bobber
    get drawn() { return RD; },
    // (tests) the spots in reach now ({x, y, key} the first n), whether a spot is spent
    spots: () => SP.slice(0, SPK.n).filter(sp => !spent.has(sp.key)),
  };

  // ---------------------------------------------------------------- the HD layer (pixel art: whole UI pixels, the pixel font)
  const ICONC = {};
  function iconCanvas(id) { return ICONC[id] ??= spriteOf(id); }
  function drawHD(q, sc) {
    if (!active() || host.hudOff || host.playerHidden) return;
    const u = U(), G = host.G, P = host.player;
    q.save(); G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
    // the prompt: the rod worn, nothing going on, the cursor on water in reach
    if (!S.phase && rod() && free() && !host.lock) {
      const w = cursorWater();
      if (w.ok && w.d <= reach() + 3 && w.d >= 1) {
        const s = G.toScreen(w.x, host.elev(w.x, w.y) + .5, w.y), x = Math.round(s[0] * sc), y = Math.round(s[1] * sc);
        const far = w.d > reach(), good = !far && !!liveSpot(w.x, w.y), bait = baitLeft();
        const label = far ? 'LMB  cast (too far)' : `LMB  cast${good ? ' · spot!' : ''}${bait ? ` · bait ${bait}` : ''}`;
        q.font = hdFontOK() ? `${10 * u}px RiftPixel` : `${7 * u}px monospace`;
        const tw = Math.ceil(q.measureText(label).width / u) * u + 8 * u;
        frame9(q, x - tw / 2, y - 14 * u, tw, 13 * u, u);
        text(q, label, x, y - 4 * u, u, far ? '#e8a070' : good ? '#9ad07a' : '#f2d27a', 'center');
      }
    }
    if (S.phase) {
      const s = G.toScreen(P.x, P.z + 2.5, P.y), x = Math.round(s[0] * sc), y = Math.round(s[1] * sc);
      if (S.phase === 'charge') {   // the meter: a column filling and draining; its top band gold (let go there)
        const H = 28 * u, W = 7 * u, x0 = x + 10 * u, y0 = y - H;
        frame9(q, x0, y0, W, H, u);
        const ih = H - 4 * u, fill = Math.round(S.charge * ih / u) * u;
        q.fillStyle = '#3a2c1e'; q.fillRect(x0 + 2 * u, y0 + 2 * u, W - 4 * u, ih);
        q.fillStyle = '#6e5222'; q.fillRect(x0 + 2 * u, y0 + 2 * u, W - 4 * u, Math.round(ih * (1 - TUNE.cast.perfect) / u) * u);
        q.fillStyle = S.charge >= TUNE.cast.perfect ? '#ffe08a' : S.charge > .5 ? '#9ad07a' : '#7ec8e3';
        q.fillRect(x0 + 2 * u, y0 + 2 * u + ih - fill, W - 4 * u, fill);
      }
      if (V.flash > 0 && S.phase === 'fly') text(q, 'perfect!', x, y - 6 * u - Math.round((.5 - V.flash) * 20) * u, u, '#ffe08a', 'center');
      if (S.phase === 'bite' || (V.bang > 0 && S.phase === 'fight')) {   // "!" over the bobber
        const b = G.toScreen(S.tx, host.elev(S.tx, S.ty) + .9, S.ty), bx = Math.round(b[0] * sc), by = Math.round(b[1] * sc) - Math.round(Math.abs(Math.sin(performance.now() / 70)) * 3) * u;
        q.save(); q.font = hdFontOK() ? `${20 * u}px RiftPixel` : `${14 * u}px monospace`; q.textAlign = 'center';
        q.fillStyle = INK; for (const [ox, oy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [2, 2]]) q.fillText('!', bx + ox * u * 2, by + oy * u * 2);
        q.fillStyle = '#ffe08a'; q.fillText('!', bx, by); q.restore();
      }
      if (S.phase === 'wait' && !S.r) text(q, '...', x, y, u, '#a39478', 'center');
      if (S.phase === 'fight') {   // the gauge under his feet (over his head it hides the line and the fish)
        const f = G.toScreen(P.x, P.z - .2, P.y);
        drawGauge(q, x, Math.round(f[1] * sc) + 26 * u, u);
      }
    }
    // the catch card (top middle): the icon, the name in its rarity's colour, size and weight, NEW / RECORD
    if (V.card > 0 && I.id) drawCard(q, u);
    q.restore();
  }
  function drawGauge(q, x, y, u) {
    const W = 72 * u, H = 22 * u, x0 = Math.round(x - W / 2), y0 = y - H, tell = S.surge === 'tell', on = S.surge === 'on';
    const blink = (tell || (on && S.held)) && ((performance.now() / 90) | 0) % 2 === 0;
    frame9(q, x0, y0, W, H, u, blink);
    // the line's way in: water, the fish where it is, the rod at the left end
    const lx = x0 + 4 * u, lw = W - 8 * u, ly = y0 + 4 * u;
    q.fillStyle = '#1f3a44'; q.fillRect(lx, ly, lw, 4 * u);
    q.fillStyle = '#3e6a7a'; q.fillRect(lx, ly, lw, u);
    const net = stats()['fish.net'];
    if (net > 0) { q.fillStyle = '#5a6a42'; q.fillRect(lx, ly, Math.round(lw * net / u) * u, 4 * u); }
    const fx = lx + Math.round(clamp(S.dist, 0, 1) * (lw - 6 * u) / u) * u;
    q.fillStyle = on ? '#ffe08a' : '#c8d4dc'; q.fillRect(fx, ly + u, 5 * u, 2 * u); q.fillRect(fx + 5 * u, ly, u, 4 * u);   // (a little fish, its tail)
    q.fillStyle = '#d6b66c'; q.fillRect(lx - 2 * u, ly - u, 2 * u, 6 * u);
    // the strain: green, amber, red
    const sy = ly + 6 * u, sw = lw, k = clamp(S.strain, 0, 1);
    q.fillStyle = '#2a1f15'; q.fillRect(lx, sy, sw, 3 * u);
    q.fillStyle = k < .55 ? '#7ad07a' : k < .82 ? '#f2c95c' : '#e2644d'; q.fillRect(lx, sy, Math.round(k * sw / u) * u, 3 * u);
    const label = on ? (S.held ? 'LET GO!' : 'it thrashes...') : tell ? 'it\'s turning!' : S.held ? 'reeling' : 'hold LMB: reel';
    text(q, label, x, y0 + H - 3 * u, u, on || tell ? '#ff9a7a' : '#efe6cf', 'center');
  }
  function drawCard(q, u) {
    const c = CATCHES[I.id], R2 = RARITY[c.rarity], cw = q.canvas.width, H = 34 * u;
    const kg = I.kg < 1 ? `${Math.max(1, Math.round(I.kg * 1000))} g` : `${I.kg} kg`;
    const t1 = c.name + (I.n > 1 ? ' x2' : ''), t2 = c.find ? `${R2?.name || ''} find` : `${R2?.name || ''} · ${I.cm} cm · ${kg}`, tag = I.first ? 'NEW!' : I.record ? 'RECORD!' : '';
    q.font = hdFontOK() ? `${10 * u}px RiftPixel` : `${7 * u}px ui-monospace, monospace`;
    const W = Math.max(132 * u, Math.ceil((Math.max(q.measureText(t1).width + (tag ? q.measureText(tag).width + 8 * u : 0), q.measureText(t2).width) + 42 * u) / u) * u);
    const k = clamp((3.4 - V.card) / .15, 0, 1), fade = clamp(V.card / .4, 0, 1);
    const x0 = Math.round((cw - W) / 2 / u) * u, y0 = Math.round((q.canvas.height * .16 - (1 - k) * 20 * u) / u) * u;
    q.save(); q.setTransform(1, 0, 0, 1, 0, 0); q.globalAlpha = fade; q.imageSmoothingEnabled = false;
    frame9(q, x0, y0, W, H, u);
    q.fillStyle = '#15100c'; q.fillRect(x0 + 4 * u, y0 + 4 * u, 26 * u, 26 * u);
    q.drawImage(iconCanvas(I.id), x0 + 4 * u - u, y0 + 4 * u - u, 28 * u, 28 * u);
    const tx = x0 + 34 * u;
    text(q, t1, tx, y0 + 13 * u, u, R2?.col || '#efe6cf');
    text(q, t2, tx, y0 + 22 * u, u, '#a39478');
    text(q, `+${I.xp} xp`, tx, y0 + 31 * u, u, '#7ec8e3');
    if (tag) text(q, tag, x0 + W - 5 * u, y0 + 13 * u, u, '#ffe08a', 'right');
    q.restore();
  }
  return F;
}
