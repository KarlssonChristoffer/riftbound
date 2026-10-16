// WORKSHOP (docs/WORKSHOP.md): what ore and logs become, and what a made thing remembers. The rules and the numbers are
// content/workshop.js (the co-op server reads the same file: server/workshop.mjs).
//   FURNACE  a Clay Furnace is a fire build (content/builds.js furnace: E feeds it a log, its fuel is the builds'); this feature
//            keeps its HEAT (0 cold .. 1 white: a burning fire rests it at .45, a pump adds to it, it falls back), its CHARGE
//            (ore loaded from the panel: it cooks while the heat is high enough, then a bar slides out onto the stone, the
//            loader's: he walks over it to take it) and its BELLOWS. LMB on it pumps (the tool job 'pump': the birch
//            blowpipe). Above white heat it eats its wood twice as fast (builds.refuel). Its mouth glows the heat's colour
//   ANVIL    a Stone Anvil is a build; Tab by it (the workshop panel beside the pack's) lays a piece on it: a recipe
//            (content/workshop.js SMITH), a haft from the logs he carries, a glow-shard inlay. LMB on it hammers (the job
//            'smith'): HAMMER.counts counts finish it (a blow in rhythm counts two) and it is made
//   TOOLS    a made tool is its item (content/items.js: tier, power) plus its haft (content/workshop.js WOODS): the tool's
//            swing time is the haft's (sim/player/tool.js swingBy), its blow's power a modifier note while it's out (source
//            'held': woodcut.power / mine.power); a pine haft held at a burning fire (E, a second) catches and burns WOODS
//            pine_log.lit s as a small torch (a light, and a lantern to the cave: features/cavelife.js, mining.js, coop's lt;
//            the rain outside puts it out, so do the soot things); a glow-shard inlay lights the rock pale green at each blow
//            (a flash, not a lantern). view/heldtool.js draws its haft's wood and its inlay (lookOf)
//   FIRE     fire-setting (content/workshop.js FIRESET): a fire build burning within r m of an iron vein for t s cracks it for
//            hours in-game hours: features/mining.js asks cracked(i) (one tier less, one chunk more, "fire would crack this");
//            its seams glow. Online the server's (a world entry 'k' + i)
//   RECORDS  every made thing has one: {u, item, maker, day, haft, inlay, hand, counts, marks} (content/workshop.js). A made
//            tool sits in the bag in a slot of its own carrying its uid (game/inventory.js: pack.giveMade). Offline they are
//            minted here; online the server mints them (act 'make' -> {k: 'made', rec}: the pouch pays when it hears it) and
//            this save keeps a copy, which the hello carries back (features/coop.js: records()). What the tool in hand does is
//            counted into its record: a felled tree (an old oak too), a broken vein (an iron one too); offline here from
//            tree.fell / mine.spent, online by the server from the uid on the 'fell' / 'mine' act (coop.tag), its counts
//            coming back as {k: 'rec'}. Hovering a made thing's bag slot shows its card (ui/madetip.js: pack.slotTip)
// CO-OP: the furnaces are the server's (server/workshop.mjs): their state rides on the build's world entry (the welcome) and
//   changes come as {k: 'smith', id, s: heat | loaded | fit | smelted | taken, ...}; between them this side steps the same rules
//   (the glow eases, the charge cooks) and the server's word puts it right. Loading, fitting and taking a bar are asked
//   ('load', 'fit', 'take') and paid / given when the server says so; a pump is asked ('pump', pow) and shown at once.
// OWNS: the furnaces' state (offline: pack.store('workshop').furn), the records (pack.store('workshop').made), the work on the
//   anvil, the workshop panel (ui/workshoppanel.js), the made-thing card's wiring, the furnace and anvil meshes (made through
//   builds.shape), the bars on the stone, the mouths' glow and light. READS: builds (the list, fire, now, refuel), pack (the
//   pouch, the bag, the store, open), coop (online, act, mail, tag, net), host.env (the day), the tool (wantBy / aimBy for the
//   jobs pump and smith), content/woodcut.js TREES (an old oak).
// EMITS: smith.load, smith.pump, smith.smelt, smith.strike, smith.make, tool.lit, tool.unlit, vein.crack.
// BUDGET: sim: the furnaces standing (a few multiplies each), the events of a step (a few kinds), the mail. View: a flame and a
//   light per hot furnace, a glow write when its heat moved, sparks after a blow; the panel only while it is up (rebuilt on a
//   change of a numeric key).
import * as THREE from 'three';
import {ITEMS, WOOD_IDS} from '../content/items.js';
import {gearById} from '../content/gear.js';
import {TREES} from '../content/woodcut.js';
import {HEAT, PUMP, CHARGES, BELLOWS, SMITH, HAND, HAMMER, WOODS, INLAY, REACH, SWING, FIRESET, MAX_RECS, heatStep, pumpAdd, words, smithCost,
  cleanRec, mintRec, countOn} from '../content/workshop.js';
import {propTop, FAMS} from '../world/world.js';
import {setMaterials} from '../content/materials.js';
import {geoOf, M4, along} from '../world/kit3d.js';
import {madeTip} from '../ui/madetip.js';
import {createWorkshopPanel} from '../ui/workshoppanel.js';
import {iconURL} from '../ui/packpanel.js';
import {gearIcon} from '../ui/gearicons.js';
import {hdUnit, hdPrompt} from '../ui/hdpixel.js';
import {viewRandom} from '../core/rng.js';
import {flags} from '../core/flags.js';

const ON = flags.get('workshop') !== '0' && flags.get('pack') !== '0';
const HEATF = +flags.get('heat') || 1, SMELTF = +flags.get('smelt') || 1;   // (?heat= a factor on a pump, ?smelt= on a charge's time)
propTop({furnace: 1.15, anvil: .52});
setMaterials({furnace: 'stone', anvil: 'stone'});   // (clay sounds as stone: content/materials.js)
const LOCK_M = 3.5, PICK_M = 1.3, BAR_T = .8;   // m: a furnace / anvil under the cursor; a bar is taken from within; s: it lies before it can be
const MOUTH = .52;   // m out from a furnace's middle: its mouth

// ORDER (core/features.js): after the pack (the bag it gives into) and the builds (the furnaces and anvils are builds); it reads
// co-op's mail a step after it came (coop is later in the order), like the builds and the mining
export const order = {after: ['pack', 'builds']};

export async function create(host) {
  const pack = () => host.feature('pack'), coop = () => host.feature('coop'), builds = () => host.feature('builds');
  const game = () => host.feature('game'), ui = () => game()?.ui || null, T = () => host.live ? host.PL?.tool : null;
  const online = () => !!coop()?.online;
  const me = () => online() ? coop().net?.id : 0;
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const store = () => { const s = pack()?.store('workshop'); if (s) { s.n ??= 0; s.made ??= {}; s.furn ??= {}; } return s; };
  const day = () => (host.env?.day ?? 0) + 1;
  // the maker's name: the co-op name (?name= or the one saved), else none ("Forged by your hand")
  const myName = () => { let n = flags.get('name') || ''; try { n ||= localStorage.getItem('rb.coop.name') || ''; } catch {} return n.replace(/[^\w .'-]/g, '').slice(0, 20); };
  const nameOf = id => id === me() ? 'your' : (coop()?.net?.peers.get(id)?.name || 'a friend') + '\'s';
  let ver = 0, T0 = 0;

  // ---------------------------------------------------------------- records
  const recOf = u => (u && store()?.made[u]) || null;
  function keep(r) {   // a record into the save (a newer copy of one replaces it)
    const s = store(); if (!s || !r) return null;
    s.made[r.u] = r; pack()?.dirty(); ver++;
    return r;
  }
  // a made thing is his: a tool into the bag (its slot carries the uid); a cost paid unless it is the dev's
  function receive(r, pay, at = null) {
    if (pay) for (const [k, n] of Object.entries(costOf(r))) pack()?.take(k, n);
    if (ITEMS[r.item]?.made) pack()?.giveMade(r.item, r.u, at || {x: host.player.x, y: host.player.y, h: 1.8});
    host.events.push({type: 'smith.make', x: host.player.x, y: host.player.y, item: r.item, u: r.u, hand: !!r.hand});
  }
  const costOf = r => r.hand ? HAND[r.item]?.cost || {} : smithCost(r.item, r.haft, r.inlay) || {};
  // making something: offline minted here at once; online asked of the server (the record comes back in the mail)
  //   r: a recipe (content/workshop.js SMITH or HAND), at: the anvil's build id ('' by hand), dev: no anvil, nothing paid
  function make(r, haft = '', inlay = false, at = '', dev = false) {
    const S = SMITH[r], Hd = HAND[r]; if (!S && !Hd) return false;
    if (online()) return coop().act('make', at, {r, haft, inlay: inlay ? 1 : 0, ...(dev ? {dev: 1} : {})});
    const s = store(); if (!s) return false;
    const u = 'o' + (++s.n).toString(36) + '.' + Date.now().toString(36).slice(-5);
    receive(keep(mintRec(u, S ? S.item || S.gear : Hd.gear, myName(), day(), haft, !!S?.haft && inlay, !!Hd)), !dev);
    return true;
  }
  // a count on the tool in hand's record (offline: online the server counts)
  function counted(job, ks) {
    const b = pack()?.best(job), r = recOf(b?.u); if (!r) return;
    let ch = false; for (const k of ks) ch = countOn(r, k, day()) || ch;
    if (ch) { pack()?.dirty(); ver++; }
  }
  const oldOak = (species, scale) => !!TREES[species]?.old && scale >= TREES[species].old;

  // ---------------------------------------------------------------- the furnaces (build id -> state)
  const FURN = new Map();
  const blank = () => ({heat: 0, ch: null, bel: false, bars: [], bn: 0, burnT: 0, glowK: -1});
  function furn(id) {
    let f = FURN.get(id); if (f) return f;
    f = blank();
    const o = !online() && store()?.furn[id];   // (offline: as the save left it)
    if (o) { f.heat = +o.heat || 0; f.ch = CHARGES[o.ch?.ore] ? {ore: o.ch.ore, by: 0, prog: +o.ch.prog || 0} : null; f.bel = !!o.bel; f.bn = o.bn | 0; for (const b of o.bars || []) if (ITEMS[b.bar]) f.bars.push({n: b.n | 0, bar: b.bar, by: 0, t: 9, mesh: null, asked: false}); }
    FURN.set(id, f); return f;
  }
  const fromServer = (f, m) => {   // a furnace's state off its world entry (the welcome) or a message
    if (m.heat !== undefined) f.heat = +m.heat || 0;
    if (m.ch !== undefined) f.ch = m.ch && CHARGES[m.ch.ore] ? {ore: m.ch.ore, by: m.ch.by, prog: +m.ch.prog || 0} : null;
    if (m.bel !== undefined) f.bel = !!m.bel;
    if (Array.isArray(m.bars)) { for (const b of f.bars) b.mesh?.dispose(); f.bars.length = 0; for (const b of m.bars) if (ITEMS[b.bar]) f.bars.push({n: b.n, bar: b.bar, by: b.by, t: 9, mesh: null, asked: false}); }
  };
  function saveFurn() {
    const s = store(); if (!s || online()) return;
    s.furn = {};
    for (const [id, f] of FURN) s.furn[id] = {heat: +f.heat.toFixed(3), ch: f.ch && {ore: f.ch.ore, prog: +f.ch.prog.toFixed(3)}, bel: f.bel, bn: f.bn, bars: f.bars.map(b => ({n: b.n, bar: b.bar}))};
    pack()?.dirty();
  }
  function dropFurn(id) { const f = FURN.get(id); if (!f) return; for (const b of f.bars) b.mesh?.dispose(); f.mouth?.dispose(); FURN.delete(id); }
  function clearFurn() { for (const id of [...FURN.keys()]) dropFurn(id); }
  // the builds of the workshop's kinds (refilled when the builds' list changes)
  const FURNS = [], ANVILS = [];
  let seen = -1;
  function sync() {
    const B = builds(); if (!B || B.ver === seen) return;
    seen = B.ver; FURNS.length = ANVILS.length = 0;
    for (const b of B.list.values()) { if (b.def.smelt) FURNS.push(b); else if (b.def.anvil) ANVILS.push(b); }
    for (const id of FURN.keys()) if (!B.list.has(id)) dropFurn(id);
  }
  const yawOf = b => (b.x * 7.3 + b.y * 3.1) % 6.28;   // (features/builds.js mesh: the build's turn)
  const mouthX = b => b.x + Math.sin(yawOf(b)) * MOUTH, mouthY = b => b.y + Math.cos(yawOf(b)) * MOUTH;
  const barX = (b, k) => b.x + Math.sin(yawOf(b)) * (MOUTH + .32) + Math.cos(yawOf(b)) * (k - .5) * .22;
  const barY = (b, k) => b.y + Math.cos(yawOf(b)) * (MOUTH + .32) - Math.sin(yawOf(b)) * (k - .5) * .22;
  const burning = b => (builds()?.fire(b).fuel || 0) > 0;

  // ---------------------------------------------------------------- furnace actions (offline at once; online asked)
  const has = cost => !pack()?.short(cost);
  const costWords = c => Object.entries(c).map(([k, n]) => `${n} ${(k === 'wood' ? (n > 1 ? 'logs' : 'log') : (ITEMS[k]?.name || k).toLowerCase())}`).join(', ');
  function load(b, ore) {
    const C = CHARGES[ore], f = furn(b.id); if (!C) return;
    if (f.ch) return say(b, 'something is in it');
    if (pack()?.count(C.ore) < C.n) return say(b, `needs ${C.n} ${ITEMS[C.ore].name.toLowerCase()}`);
    if (online()) { coop().act('load', b.id, {ore}); return; }
    pack().take(C.ore, C.n); f.ch = {ore, by: 0, prog: 0}; loaded(b, f, ore, true); saveFurn();
  }
  function loaded(b, f, ore, mine) { host.events.push({type: 'smith.load', x: b.x, y: b.y, id: b.id, ore, mine}); ver++; }
  function fit(b) {
    const f = furn(b.id); if (f.bel) return;
    if (!has(BELLOWS.cost)) return say(b, 'needs ' + costWords(BELLOWS.cost));
    if (online()) { coop().act('fit', b.id); return; }
    for (const k in BELLOWS.cost) pack().take(k, BELLOWS.cost[k]);
    f.bel = true; ver++; ui()?.toast('A bellows', 'fitted to the furnace', '#f2c95c'); saveFurn();
  }
  function pump(b, rhythm) {
    const f = furn(b.id);
    if (!burning(b)) return say(b, 'no fire in it: E feeds it a log');
    f.heat = Math.min(1, f.heat + Math.min(PUMP.most, pumpAdd(f.bel, rhythm) * HEATF));   // (online: shown at once, the server's word follows)
    if (online()) coop().act('pump', b.id, {pow: rhythm ? PUMP.rhythm : 1});
    host.events.push({type: 'smith.pump', x: mouthX(b), y: mouthY(b), id: b.id, heat: f.heat, rhythm, mine: true});
  }
  function smelted(b, f, n, bar, by) {   // a bar slides out onto the stone (the loader's)
    f.ch = null; f.bars.push({n, bar, by, t: 0, mesh: null, asked: false}); ver++;
    host.events.push({type: 'smith.smelt', x: mouthX(b), y: mouthY(b), id: b.id, bar, mine: by === me()});
  }
  function takeBar(b, f, k) {
    const B0 = f.bars[k];
    if (online()) { if (!B0.asked) { B0.asked = true; coop().act('take', b.id, {n: B0.n}); } return; }
    f.bars.splice(k, 1); B0.mesh?.dispose(); ver++;
    pack()?.give(B0.bar, 1, {x: host.player.x, y: host.player.y, h: host.player.z + 1.8}); saveFurn();
  }
  let sayT = -9;
  function say(b, text) { if (T0 - sayT > 1.2) { sayT = T0; ui()?.float(b.x, b.y, (b.z || 0) + 1.5, text, '#e8a070'); } }

  // ---------------------------------------------------------------- the anvil: the piece on it, hammering
  const sel = {r: 'iron_pick', haft: '', inlay: false};   // the panel's choice
  let work = null;   // {id: the anvil, r, haft, inlay, n}: his piece on an anvil
  function lay(b) {
    const S = SMITH[sel.r]; if (!S) return;
    if (work) return say(b, 'something is on an anvil already: hammer it');
    if (S.haft && !(pack()?.count(sel.haft) > 0)) return say(b, 'choose a haft');
    const c = smithCost(sel.r, sel.haft, sel.inlay && S.haft);
    if (!has(c)) return say(b, 'needs ' + costWords(c));
    work = {id: b.id, r: sel.r, haft: S.haft ? sel.haft : '', inlay: !!(sel.inlay && S.haft), n: 0}; ver++;
  }
  function hammer(b, rhythm, e) {
    if (!work || work.id !== b.id) return say(b, 'nothing on it: Tab by it lays a bar on it');
    work.n += rhythm ? HAMMER.rhythm : 1; ver++;
    host.events.push({type: 'smith.strike', x: b.x, y: b.y, h: (b.z || 0) + .62, n: Math.min(work.n, HAMMER.counts), of: HAMMER.counts, rhythm});
    if (work.n < HAMMER.counts) return;
    const w = work; work = null;
    if (!has(smithCost(w.r, w.haft, w.inlay))) return say(b, 'the makings are gone from the pouch');
    make(w.r, w.haft, w.inlay, b.id);
  }

  // ---------------------------------------------------------------- the tool: LMB on a furnace pumps, on an anvil hammers
  const PT = {x: 0, y: 0, keep: 0, far: 0};
  let aimB = null;   // the build the job's swings go at
  function underCursor(list) {   // the build in list under the cursor's line (as mining's veins): -> build | null
    const gv = host.PL?.cursorGround?.(); if (!gv) return null;
    const c = Math.cos(host.yaw), s = Math.sin(host.yaw), gx = gv.x * c + gv.y * s, gy = -gv.x * s + gv.y * c, hg = host.elev(gx, gy), k = host.PPMY / host.PPMH, P = host.player;
    let best = null, bd = 9;
    for (const b of list) {
      if (Math.hypot(b.x - P.x, b.y - P.y) > LOCK_M || Math.abs((b.z || 0) - P.z) > 1.2) continue;
      const vx = b.x * c - b.y * s, vy = b.x * s + b.y * c, h = hg + (vy - gv.y) * k, dx = Math.abs(vx - gv.x);
      if (dx > b.def.r + .2 || h < (b.z || 0) - .2 || h > (b.z || 0) + 1.6) continue;
      if (dx < bd) { bd = dx; best = b; }
    }
    return best;
  }
  function nearest(list, r) { const P = host.player; let best = null, bd = r; for (const b of list) { const d = Math.hypot(b.x - P.x, b.y - P.y) - b.def.r; if (d < bd && Math.abs((b.z || 0) - P.z) < 1.2) { bd = d; best = b; } } return best; }
  const aimAt = (b, job) => { aimB = b; PT.x = b.x; PT.y = b.y; PT.keep = b.def.r + SWING[job].keep; PT.far = b.def.r + SWING[job].reach + .1; return PT; };
  let toolSet = false;
  function setTool(t) {
    toolSet = true;
    t.wantBy(() => active() && !pack()?.open && underCursor(FURNS) ? 'pump' : '', 'pump');
    t.wantBy(() => active() && !pack()?.open && underCursor(ANVILS) ? 'smith' : '', 'smith');
    t.aimBy(() => { const b = underCursor(FURNS) || nearest(FURNS, LOCK_M); return b ? aimAt(b, 'pump') : null; }, 'pump');
    t.aimBy(() => { const b = underCursor(ANVILS) || nearest(ANVILS, LOCK_M); return b ? aimAt(b, 'smith') : null; }, 'smith');
  }
  function blow(e) {
    const b = aimB; if (!b || Math.hypot(b.x - e.x, b.y - e.y) - b.def.r > SWING[e.job].reach + .6) return;
    if (e.job === 'pump' && b.def.smelt) pump(b, !!e.rhythm);
    else if (e.job === 'smith' && b.def.anvil) hammer(b, !!e.rhythm, e);
  }

  // ---------------------------------------------------------------- the tool in hand: its haft (swing, power), its look
  const jobOfId = id => ITEMS[id]?.tool?.job || '';
  const heldRec = id => { const j = jobOfId(id); if (!j) return null; const b = pack()?.best(j); return b && b.id === id ? recOf(b.u) : null; };
  const LOOK = new Map();   // u -> 'haft:inlay' (made once a record)
  function lookOf(id) { const r = heldRec(id); if (!r) return ''; let k = LOOK.get(r.u); if (k === undefined) { k = r.haft + ':' + (r.inlay ? 1 : 0); LOOK.set(r.u, k); } return k; }
  const NOTES = {};   // a haft with power -> its notes per job (made once)
  for (const w in WOODS) if (WOODS[w].power) NOTES[w] = {chop: [{stat: 'woodcut.power', mul: WOODS[w].power}], mine: [{stat: 'mine.power', mul: WOODS[w].power}]};
  let heldNotes = null;
  function heldMods() {   // the 'held' source: the tool out's haft's power (dropped when it goes away)
    const t = T(), id = t?.S.on ? t.S.id : '', r = id ? heldRec(id) : null, n = r && NOTES[r.haft] ? NOTES[r.haft][jobOfId(id)] || null : null;
    if (n === heldNotes) return;
    heldNotes = n; if (n) host.mods.set('held', n); else host.mods.clear('held');
  }
  // THE PINE HAFT: E held a second by a burning fire (a campfire, a ring, a furnace) lights the pine-hafted tool (the one in hand,
  // else the first in the bag)
  let torch = null, holdT = 0;   // {u, t: s left}
  function pineRec() {
    const t = T(), id = t?.S.on ? t.S.id : '', r0 = id ? heldRec(id) : null; if (r0?.haft === 'pine_log') return r0;
    for (const sl of pack().inv.bag) { const r = sl?.u ? recOf(sl.u) : null; if (r?.haft === 'pine_log') return r; }
    return null;
  }
  function fireNear() {
    const P = host.player; if (host.feature('campfires')?.burningNear?.(P.x, P.y, 1.8)) return true;
    for (const b of FURNS) if (burning(b) && Math.hypot(b.x - P.x, b.y - P.y) - b.def.r < 1.4) return true;
    return false;
  }
  function torchStep(dt, evs) {
    const P = host.player, W = WOODS.pine_log;
    if (torch) {
      torch.t -= dt;
      let why = torch.t <= 0 || pack().slotOf(torch.u) < 0 ? 'out' : (host.env?.sky?.rain || 0) > .3 && !host.feature('caves')?.down ? 'rain' : '';
      for (let k = 0; k < evs.length; k++) if (evs[k].type === 'lantern.snuff') why = 'out';   // (the soot things put it out too)
      if (why) {
        host.events.push({type: 'tool.unlit', x: P.x, y: P.y, u: torch.u, why}); torch = null;
        ui()?.float(P.x, P.y, P.z + 2, why === 'rain' ? 'the rain put the resin out' : 'the resin has burnt out', '#e8a070');
      }
      return;
    }
    if (host.keys?.has('e') && !host.lock && fireNear()) {
      const r = pineRec(); if (!r) { holdT = 0; return; }
      if ((holdT += dt) < W.hold) return;
      holdT = 0; torch = {u: r.u, t: W.lit};
      host.events.push({type: 'tool.lit', x: P.x, y: P.y, u: r.u});
      ui()?.toast('The resin catches', `the pine haft burns like a torch for ${Math.round(W.lit / 60)} minutes`, '#ffb060');
    } else holdT = 0;
  }

  // ---------------------------------------------------------------- fire-setting (the iron veins: features/mining.js asks cracked(i))
  const CRACK = new Map();   // vein -> the world hour it closes again (online: until the server says it has)
  const heatV = new Map();   // vein -> s a fire has burnt by it (offline; online the server counts)
  let IRON = [], ironOf = null, crackT = 0, crackOn = false;
  const veinsNow = () => host.feature('mining')?.veins || null;
  const crackKey = V => V.length + ':' + (V[0] ? V[0].x.toFixed(1) + ',' + V[0].y.toFixed(1) : '');   // (this cave's: another seed, another plan)
  function ironVeins() { const V = veinsNow(); if (V && V !== ironOf) { ironOf = V; IRON = []; V.forEach((v, i) => { if (v.kind === 'iron') IRON.push(i); }); } return IRON; }
  function crackSave() {
    const s = store(), V = veinsNow(); if (!s || !V || online()) return;
    s.crk = {key: crackKey(V), v: Object.fromEntries(CRACK)}; pack()?.dirty();
  }
  function crackRestore() {
    CRACK.clear(); heatV.clear(); crackOn = true;
    const s = store(), V = veinsNow(); if (!s?.crk || !V || s.crk.key !== crackKey(V)) return;
    for (const k in s.crk.v) if (V[+k]) CRACK.set(+k, +s.crk.v[k]);
  }
  function crackSet(i, at, quiet = false) {
    const V = veinsNow(), v = V?.[i]; if (!v) return;
    const was = CRACK.has(i); CRACK.set(i, at); if (was || quiet) return;
    host.events.push({type: 'vein.crack', x: v.x, y: v.y, i, on: true});
    if (Math.hypot(v.x - host.player.x, v.y - host.player.y) < 12) ui()?.float(v.x, v.y, floorOf(v) + 1.4, 'the rock cracks in the heat', '#ff9a50');
  }
  function crackOff(i) { const v = veinsNow()?.[i]; if (!CRACK.delete(i) || !v) return; host.events.push({type: 'vein.crack', x: v.x, y: v.y, i, on: false}); }
  const floorOf = v => host.elev(v.x + v.nx * .45, v.y + v.ny * .45);
  function crackTick() {   // offline, once a second: a burning fire by an iron vein; a crack closing on the clock
    const B = builds(); if (!B) return;
    const h = host.env?.t ?? 0; let ch = false;
    for (const [i, at] of CRACK) if (h >= at) { crackOff(i); ch = true; }
    for (const i of ironVeins()) {
      if (CRACK.has(i)) continue;
      const v = ironOf[i]; let near = false;
      for (const b of B.list.values()) if (b.def.fire && Math.hypot(b.x - v.x, b.y - v.y) < FIRESET.r && burning(b)) { near = true; break; }
      if (!near) { heatV.delete(i); continue; }
      const t = (heatV.get(i) || 0) + 1; heatV.set(i, t);
      if (t >= FIRESET.t) { heatV.delete(i); crackSet(i, h + FIRESET.hours); ch = true; }
    }
    if (ch) crackSave();
  }
  // the inlay's flash (a blow of a tool with glow shards in its head: the rock lit pale green)
  const FLASH = {x: 0, y: 0, h: 0, t: 99};
  const inlaid = job => !!recOf(pack()?.best(job)?.u)?.inlay;

  // ---------------------------------------------------------------- the panel (Tab by a furnace or an anvil)
  const queue = [];
  const panel = ON ? createWorkshopPanel({ask: (a, v) => queue.push([a, v])}) : null;
  let near = null;   // the furnace / anvil the panel is about
  function ask(a, v) {
    const b = near; if (!b) return;
    if (a === 'load') load(b, v);
    else if (a === 'fit') fit(b);
    else if (a === 'recipe' && SMITH[v]) { sel.r = v; ver++; }
    else if (a === 'haft' && WOODS[v]) { sel.haft = v; ver++; }
    else if (a === 'inlay') { sel.inlay = !sel.inlay; ver++; }
    else if (a === 'lay') lay(b);
  }
  const ICON = {};
  const iconOf = id => ICON[id] ??= ITEMS[id]?.icon ? iconURL(ITEMS[id].icon, ITEMS[id].pal) : gearById(id) ? gearIcon(gearById(id)) || '' : '';
  const GLOW = [[0, [42, 32, 24]], [.12, [90, 26, 14]], [.3, [150, 34, 16]], [.45, [196, 56, 18]], [.62, [255, 112, 32]], [.8, [255, 196, 80]], [.9, [255, 240, 200]], [1, [255, 252, 240]]];
  function glowRGB(h, out) {
    let i = 0; while (i < GLOW.length - 2 && h > GLOW[i + 1][0]) i++;
    const [h0, a] = GLOW[i], [h1, b] = GLOW[i + 1], k = Math.max(0, Math.min(1, (h - h0) / (h1 - h0)));
    for (let j = 0; j < 3; j++) out[j] = Math.round(a[j] + (b[j] - a[j]) * k);
    return out;
  }
  const RGB = [0, 0, 0], hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  function chargeWords(f) {
    if (!f.ch) return '';
    const C = CHARGES[f.ch.ore], who = nameOf(f.ch.by), hot = f.heat >= C.heat;
    if (!hot) return `${who[0].toUpperCase() + who.slice(1)} ${C.name} ore is in it: it wants more heat.`;
    return f.ch.prog > .75 ? `The ${C.name} is nearly a bar.` : f.ch.prog > .35 ? `The ${C.name} is running.` : `The ${C.name} ore is starting to give.`;
  }
  function panelModel(b) {
    if (b.def.smelt) {
      const f = furn(b.id), hot = burning(b);
      return {kind: 'furnace', glow: hex(glowRGB(hot || f.heat > .05 ? f.heat : 0, RGB)), words: words(f.heat, f.ch?.ore), burning: hot, charge: chargeWords(f), bel: f.bel,
        loads: Object.entries(CHARGES).map(([v, C]) => ({v, label: `Load ${C.name}`, cost: `${C.n} ${ITEMS[C.ore].name.toLowerCase()}`, ok: !f.ch && pack().count(C.ore) >= C.n,
          why: f.ch ? 'something is in it' : `needs ${C.n} ${ITEMS[C.ore].name.toLowerCase()}`})),
        fit: f.bel ? null : {label: 'A bellows', cost: costWords(BELLOWS.cost), ok: has(BELLOWS.cost), why: 'needs ' + costWords(BELLOWS.cost)}};
    }
    const S = SMITH[sel.r], hafts = S.haft ? WOOD_IDS.filter(id => WOODS[id] && pack().count(id) > 0) : null;
    if (hafts && !hafts.includes(sel.haft)) sel.haft = hafts[0] || '';
    const inlay = !!(S.haft && sel.inlay), c = smithCost(sel.r, sel.haft, inlay);
    return {kind: 'anvil',
      work: work && work.id === b.id ? {name: SMITH[work.r].name + (work.haft ? `, ${WOODS[work.haft].name} haft` : '') + (work.inlay ? ', shard inlay' : ''), n: Math.min(work.n, HAMMER.counts), of: HAMMER.counts} : null,
      recipes: Object.entries(SMITH).map(([v, R]) => { const rc = smithCost(v, R.haft ? sel.haft : '', R.haft && sel.inlay); return {v, name: R.name, icon: iconOf(R.item || R.gear), cost: costWords(rc), ok: has(rc), sel: v === sel.r}; }),
      hafts: hafts && hafts.map(v => ({v, name: WOODS[v].name, trait: WOODS[v].trait || '', icon: iconOf(v), n: pack().count(v), sel: v === sel.haft})),
      inlay: S.haft ? {cost: costWords(INLAY.cost), ok: has(INLAY.cost), on: sel.inlay} : null,
      go: work ? {ok: false, why: 'something is on it: LMB hammers'} : S.haft && !sel.haft ? {ok: false, why: 'no logs for a haft'} : has(c) ? {ok: true} : {ok: false, why: 'needs ' + costWords(c)}};
  }
  let panelKey = NaN;
  function panelFrame() {
    const pk = pack();
    if (!panel || !pk?.open || !active()) { panel?.hide(); near = null; panelKey = NaN; return; }
    const b = nearest(FURNS, REACH.use) || nearest(ANVILS, REACH.use);
    if (!b) { panel.hide(); near = null; panelKey = NaN; return; }
    near = b;
    const f = b.def.smelt ? furn(b.id) : null;
    // the panel's key: what it shows, as one number (no string a frame); the model is made only when it changed
    let k = b.id.length * 7 + b.id.charCodeAt(b.id.length - 1) * 131 + (b.def.smelt ? 1 : 2);
    k = Math.imul(k, 31) + pk.inv.ver; k = Math.imul(k, 31) + ver; k = Math.imul(k, 31) + (b.def.smelt && burning(b) ? 1 : 0);
    if (f) { k = Math.imul(k, 31) + Math.round(f.heat * 40); k = Math.imul(k, 31) + Math.round((f.ch?.prog || 0) * 8); }
    if (k !== panelKey) { panelKey = k; const m = panelModel(b); m.key = k; panel.show(m); }
  }

  // co-op: the server's word ({k: 'made', rec, dev?, late?}: one minted for him, or his records in the welcome; {k: 'rec', u,
  // counts, marks}: what his tool has done since; {k: 'smith', id, s, ...}: a furnace; {k: 'world', s: 'built', kind: furnace}:
  // a furnace's state with it, in the welcome)
  function mail(m) {
    if (m.k === 'made') {
      const r = cleanRec(m.rec); if (!r) return;
      keep(r);
      if (!m.late) receive(r, m.dev !== 1);
    } else if (m.k === 'rec') {
      const r = recOf(m.u); if (!r) return;
      const c = cleanRec({...r, counts: m.counts, marks: m.marks}); if (!c) return;
      r.counts = c.counts; r.marks = c.marks; pack()?.dirty(); ver++;
    } else if (m.k === 'world' && m.s === 'built' && m.kind === 'furnace') fromServer(furn(m.id), m);
    else if (m.k === 'world' && typeof m.id === 'string' && m.id[0] === 'k') {   // fire-setting: a vein cracked ('k' + i) or closed again
      const i = +m.id.slice(1); if (!(i >= 0)) return;
      if (m.s === 'cracked') crackSet(i, +m.at || 1, !!m.late); else if (m.s === 'grown') crackOff(i);
    }
    else if (m.k === 'smith') {
      const b = builds()?.list.get(m.id); if (!b?.def.smelt) return;
      const f = furn(m.id), mine = m.by === me();
      if (m.s === 'heat') { f.heat = +m.heat || 0; if (f.ch && m.prog !== undefined) f.ch.prog = +m.prog || 0; if (m.fuel !== undefined) builds().refuel(m.id, +m.fuel, +m.t0); }
      else if (m.s === 'loaded') { const C = CHARGES[m.ore]; if (!C) return; f.ch = {ore: m.ore, by: m.by, prog: 0}; if (mine) pack()?.take(C.ore, C.n); loaded(b, f, m.ore, mine); }
      else if (m.s === 'fit') { f.bel = true; ver++; if (mine) { for (const k in BELLOWS.cost) pack()?.take(k, BELLOWS.cost[k]); ui()?.toast('A bellows', 'fitted to the furnace', '#f2c95c'); } }
      else if (m.s === 'smelted') smelted(b, f, m.n, m.bar, m.by);
      else if (m.s === 'taken') {
        const k = f.bars.findIndex(x => x.n === m.n); if (k < 0) return;
        const B0 = f.bars.splice(k, 1)[0]; B0.mesh?.dispose(); ver++;
        if (mine) pack()?.give(B0.bar, 1, {x: host.player.x, y: host.player.y, h: host.player.z + 1.8});
      }
      else if (m.s === 'pumped' && !mine) host.events.push({type: 'smith.pump', x: mouthX(b), y: mouthY(b), id: b.id, heat: f.heat, rhythm: !!m.rhythm, mine: false});
    }
  }

  // ---------------------------------------------------------------- the meshes (through builds.shape: in the build's frame)
  const SHAPE = {
    furnace() {   // a stone footing, a squat clay dome with its mouth toward +z, a short chimney, a log or two by the mouth
      const L = [];
      for (let i = 0; i < 11; i++) { const a = i / 11 * Math.PI * 2; L.push({g: new THREE.IcosahedronGeometry(1, 0), m: M4([Math.cos(a) * .5, .07, Math.sin(a) * .5], [i, a, i * .6], [.12, .09, .11]), fam: i % 3 ? 'stone' : 'rock'}); }
      L.push({g: new THREE.SphereGeometry(.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), m: M4([0, .12, 0], [0, 0, 0], [1, 1.45, 1]), fam: 'clay'});
      L.push({g: new THREE.CylinderGeometry(.14, .2, .5, 8), m: M4([0, .9, -.06]), fam: 'clay'});
      L.push({g: new THREE.CylinderGeometry(.16, .16, .05, 8), m: M4([0, 1.15, -.06]), fam: 'char'});
      L.push({g: new THREE.BoxGeometry(.3, .24, .14), m: M4([0, .24, .44]), fam: 'char'});   // (the mouth's dark: the glow is the workshop's own mesh)
      L.push({g: new THREE.BoxGeometry(.42, .06, .16), m: M4([0, .38, .46]), fam: 'stone'});   // (its lintel)
      L.push({...along([-.62, .05, .2], [-.6, .05, -.4], .05, .045, 6), fam: 'bark'});
      return geoOf(L);
    },
    anvil() {   // an oak stump, a flat block of hard stone on it, a little horn of stone
      const L = [];
      L.push({g: new THREE.CylinderGeometry(.24, .29, .34, 9), m: M4([0, .17, 0]), fam: 'bark'});
      L.push({g: new THREE.CylinderGeometry(.235, .235, .02, 9), m: M4([0, .345, 0]), fam: 'wood'});
      L.push({g: new THREE.BoxGeometry(.5, .16, .3), m: M4([0, .43, 0], [0, .08, 0]), fam: 'stone'});
      L.push({g: new THREE.BoxGeometry(.46, .03, .26), m: M4([0, .52, 0], [0, .08, 0]), fam: 'rock'});
      L.push({g: new THREE.ConeGeometry(.07, .2, 6), m: M4([.33, .46, .03], [0, 0, -Math.PI / 2]), fam: 'stone'});
      return geoOf(L);
    },
  };
  let shaped = false;
  const BAR = {copper_bar: null, iron_bar: null}, barGeo = id => BAR[id] ??= geoOf([{g: new THREE.BoxGeometry(.2, .05, .08), m: M4([0, .025, 0]), fam: id === 'copper_bar' ? 'copper' : 'ironore'}]);
  let mouthGeo = null, workGeo = null, workM = null;
  const MX = new THREE.Matrix4(), V3 = new THREE.Vector3(), QY = new THREE.Quaternion(), UPV = new THREE.Vector3(0, 1, 0), SC = new THREE.Vector3(1, 1, 1);
  const place = (m, x, h, y, yaw) => m.setMatrix(MX.compose(V3.set(x, h, y), QY.setFromAxisAngle(UPV, yaw), SC));
  const EMBER = FAMS.indexOf('ember');
  function meshes() {
    if (!host.world?.mesh) return;
    mouthGeo ??= geoOf([{g: new THREE.BoxGeometry(.26, .18, .02), m: M4([0, .22, .46]), fam: 'ember'}]);
    for (const b of FURNS) {
      const f = furn(b.id), hot = burning(b) || f.heat > .05;
      f.mouth ??= host.world.mesh(mouthGeo, M4([b.x, b.z, b.y], [0, yawOf(b), 0]));
      const gk = hot ? Math.round(f.heat * 20) / 20 : 0;
      if (gk !== f.glowK) { f.glowK = gk; f.mouth.setGlow(0, EMBER, gk > 0 ? .4 + gk * 2.2 : 0); }
      for (let k = 0; k < f.bars.length; k++) {
        const B0 = f.bars[k]; if (B0.mesh) continue;
        B0.mesh = host.world.mesh(barGeo(B0.bar), new THREE.Matrix4());
        const x = barX(b, k % 3), y = barY(b, k % 3); place(B0.mesh, x, host.elev(x, y) + .01, y, yawOf(b) + .2);
        B0.mesh.setGlow(0, FAMS.indexOf(B0.bar === 'copper_bar' ? 'copper' : 'ironore'), .8);
      }
      for (const B0 of f.bars) if (B0.mesh && B0.t > 4) { B0.mesh.setGlow(0, 0, 0); }   // (it has cooled)
    }
    // the piece on his anvil: a bar lying on it, glowing a little
    const ab = work ? builds()?.list.get(work.id) : null;
    if (ab) {
      workGeo ??= geoOf([{g: new THREE.BoxGeometry(.18, .04, .07), m: M4([0, .02, 0]), fam: 'ironore'}]);
      if (!workM) { workM = host.world.mesh(workGeo, new THREE.Matrix4()); workM.setGlow(0, FAMS.indexOf('ironore'), .9); }
      place(workM, ab.x, (ab.z || 0) + .535, ab.y, yawOf(ab) + .3); workM.setVisible?.(true);
    } else workM?.setVisible?.(false);
  }

  // ---------------------------------------------------------------- the view: sparks off the anvil, the mouth's flame and light
  const SP = [], VR = viewRandom;
  function sparks(e) {
    const n = e.rhythm ? 14 : 8;
    for (let i = 0; i < n && SP.length < 120; i++) {
      const a = VR() * Math.PI * 2, v = 1 + VR() * 2.4;
      SP.push({x: e.x, y: e.y, h: e.h, vx: Math.cos(a) * v, vy: Math.sin(a) * v, vh: 1 + VR() * 2.2, t: 0, life: .15 + VR() * .25, col: VR() < .5 ? '#fff4c8' : '#ffb040'});
    }
  }
  const LOUT = [], LREC = [], TORCH = {};   // (TORCH: the pine haft's flame's key)

  let wired = false, was = false, wasOnline = false, saveT = 0;
  function wire() {   // once the pack and co-op are there: the card over a made thing's slot, the uid on an act
    wired = true;
    const pk = pack(), tip = madeTip();
    pk.slotTip({show(slot, e) { const r = recOf(pk.inv.bag[slot]?.u); if (r) tip.show(r, e); else tip.hide(); }, move: e => tip.move(e), hide: () => tip.hide()});
    const c = coop();
    c?.tag?.('fell', p => { const ps = host.itemOf?.(p)?.pose; return {u: pk.best('chop')?.u || '', old: ps && oldOak(ps.species, ps.scale || 1) ? 1 : 0}; });
    c?.tag?.('mine', () => ({u: pk.best('mine')?.u || ''}));
  }
  function wireTool(t) { setTool(t); t.swingBy?.((id, job) => WOODS[heldRec(id)?.haft]?.swing || 1); }

  const F = {
    name: 'workshop', label: 'Workshop', on: ON,
    get ver() { return ver; }, get work() { return work; }, furnaces: FURN,
    recOf, make, furn, lookOf, get torch() { return !!torch; }, cracked: i => CRACK.has(i), load: (id, ore) => { const b = builds()?.list.get(id); if (b?.def.smelt) load(b, ore); }, fit: id => { const b = builds()?.list.get(id); if (b?.def.smelt) fit(b); },
    pump: (id, rhythm = false) => { const b = builds()?.list.get(id); if (b?.def.smelt) pump(b, rhythm); },
    lay: (id, r, haft = '', inlay = false) => { const b = builds()?.list.get(id); if (!b?.def.anvil) return; Object.assign(sel, {r, haft, inlay}); lay(b); },
    hammer: (id, rhythm = false) => { const b = builds()?.list.get(id); if (b?.def.anvil) hammer(b, rhythm); },   // (tests, dev)
    // the records the hello carries (features/coop.js: the save's copy; the newest MAX_RECS)
    records() { const s = store(); return s ? Object.values(s.made).slice(-MAX_RECS) : []; },
    update(dt, evs) {
      T0 += dt;
      if (!ON || !pack()) return;
      if (!wired) wire();
      const B = builds(); if (B && !shaped) { shaped = true; B.shape('furnace', SHAPE.furnace); B.shape('anvil', SHAPE.anvil); }
      const t = T(); if (t && !toolSet) wireTool(t);
      const ol = online(), on = active();
      if (!ol) for (let k = 0; k < evs.length; k++) {
        const e = evs[k];
        if (e.type === 'tree.fell') counted('chop', oldOak(e.species, e.scale) ? ['fell', 'oldoak'] : ['fell']);
        else if (e.type === 'mine.spent' && e.n > 0) counted('mine', e.kind === 'iron' ? ['veins', 'iron'] : ['veins']);
      }
      if (on !== was || ol !== wasOnline) {
        if (was && !wasOnline) { saveFurn(); crackSave(); }
        clearFurn(); work = null; was = on; wasOnline = ol; seen = -1; CRACK.clear(); heatV.clear(); crackOn = false;
      }
      if (on && !ol && !crackOn && veinsNow()) crackRestore();   // (offline: the save's cracks, once the cave's veins are there)
      const c = coop(); if (ol && c.mail) for (let k = 0; k < c.mail.length; k++) mail(c.mail[k]);
      if (!on || !B) return;
      sync();
      for (let k = 0; k < evs.length; k++) {
        const e = evs[k];
        if (e.type === 'player.chop' && (e.job === 'pump' || e.job === 'smith')) blow(e);
        else if (e.type === 'pack.reset') { clearFurn(); work = null; }
      }
      while (queue.length) { const [a, v] = queue.shift(); ask(a, v); }
      if (work && !B.list.has(work.id)) work = null;
      heldMods(); torchStep(dt, evs);
      if (!ol && crackOn && (crackT += dt) >= 1) { crackT = 0; crackTick(); }
      // the furnaces: the heat falls back to the fire's (or to cold), a charge cooks, a bar out; his bars taken by walking over them
      const P = host.player; let hot = false;
      for (const b of FURNS) {
        const f = furn(b.id), lit = burning(b);
        f.heat = heatStep(f.heat, dt, lit); if (f.heat > .05) hot = true;
        if (!ol && lit && f.heat > HEAT.white && (f.burnT += dt) >= 1) { const fu = B.fire(b).fuel; B.refuel(b.id, fu - f.burnT, B.now()); f.burnT = 0; }   // (white heat: twice the wood)
        if (f.ch) {
          const C = CHARGES[f.ch.ore];
          if (f.heat >= C.heat) f.ch.prog = Math.min(ol ? .99 : 1, f.ch.prog + dt / (C.t * SMELTF));
          if (!ol && f.ch.prog >= 1) { smelted(b, f, ++f.bn, C.bar, 0); saveFurn(); }
        }
        for (let k = f.bars.length - 1; k >= 0; k--) {
          const B0 = f.bars[k]; B0.t += dt;
          if (B0.by !== me() || B0.t < BAR_T) continue;
          const x = barX(b, k % 3), y = barY(b, k % 3);
          if (Math.hypot(P.x - x, P.y - y) < PICK_M && Math.abs(P.z - host.elev(x, y)) < 1.2) takeBar(b, f, k);
        }
      }
      if (!ol && hot && (saveT += dt) > 5) { saveT = 0; saveFurn(); }
    },
    view(dt, evs) {
      if (!ON) return;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        if (e.type === 'smith.strike') sparks(e);
        else if ((e.type === 'mine.hit' && !e.other && e.i >= 0 && inlaid('mine')) || (e.type === 'tree.chop' && inlaid('chop'))) { FLASH.x = e.x; FLASH.y = e.y; FLASH.h = e.h; FLASH.t = 0; }
      }
      FLASH.t += dt;
      for (let i = SP.length - 1; i >= 0; i--) {
        const c = SP[i]; c.t += dt; if (c.t > c.life) { SP.splice(i, 1); continue; }
        c.vh -= 9 * dt; c.x += c.vx * dt; c.y += c.vy * dt; c.h += c.vh * dt;
      }
    },
    frame() {
      if (!ON) return;
      panelFrame();
      if (!active()) { workM?.setVisible?.(false); return; }
      meshes();
      for (let i = 0; i < SP.length; i++) { const c = SP[i]; host.point(c.x, c.y, c.h, c.col); }
      if (CRACK.size) for (const i of CRACK.keys()) {   // a cracked vein's seams: embers glowing in them
        const v = ironOf?.[i]; if (!v || Math.abs(v.x - host.player.x) > 16 || Math.abs(v.y - host.player.y) > 12) continue;
        const z = floorOf(v);
        for (let k = 0; k < 5; k++) { const a = (k - 2) * .14, f = .5 + .5 * Math.sin(T0 * 3.1 + k * 1.7 + i); host.point(v.x + v.nx * .12 - v.ny * a, v.y + v.ny * .12 + v.nx * a, z + .45 + (k % 3) * .22, f > .6 ? '#ffb060' : '#c84a1c'); }
      }
      const L = host.feature('lights'), flames = L?.on !== false && L?.flame ? L : null; if (!flames) return;
      if (torch) { const P = host.player, a = P.faceAngle; flames.flame(TORCH, 'camp', WOODS.pine_log.light.color, P.x + Math.sin(a) * .3 + Math.cos(a) * .18, P.y + Math.cos(a) * .3 - Math.sin(a) * .18, P.z + 1.35, .45, .3, .5); }
      for (const b of FURNS) {
        if (!burning(b)) continue;
        const f = furn(b.id); glowRGB(f.heat, RGB);
        flames.flame(b.p, 'camp', hex(RGB), mouthX(b), mouthY(b), (b.z || 0) + .14, .5, .25 + f.heat * .35, .25 + f.heat * .35);
      }
    },
    lights() {   // a hot furnace's mouth (records reused)
      LOUT.length = 0; if (!active()) return LOUT;
      let i = 0;
      for (const b of FURNS) {
        const f = furn(b.id); if (f.heat < .05 && !burning(b)) continue;
        glowRGB(Math.max(.2, f.heat), RGB);
        const r = LREC[i] ??= {x: 0, y: 0, h: 0, color: '', radius: 0, intensity: 0, flicker: 0, id: 0};
        r.x = mouthX(b); r.y = mouthY(b); r.h = (b.z || 0) + .35; r.color = hex(RGB); r.radius = 2.5 + 3.5 * f.heat; r.intensity = .45 + 1.2 * f.heat; r.flicker = .3; r.id = 9930 + i;
        LOUT.push(r); i++;
      }
      const rec = () => LREC[i] ??= {x: 0, y: 0, h: 0, color: '', radius: 0, intensity: 0, flicker: 0, id: 0};
      if (torch) {   // the pine haft burning in his hand
        const P = host.player, a = P.faceAngle, Lt = WOODS.pine_log.light, r = rec();
        r.x = P.x + Math.sin(a) * .3; r.y = P.y + Math.cos(a) * .3; r.h = P.z + 1.4; r.color = Lt.color; r.radius = Lt.radius; r.intensity = Lt.intensity; r.flicker = .5; r.id = 9950;
        LOUT.push(r); i++;
      }
      if (FLASH.t < INLAY.full + INLAY.fade) {   // the inlay's flash: full, then fading
        const r = rec(), k = FLASH.t < INLAY.full ? 1 : 1 - (FLASH.t - INLAY.full) / INLAY.fade;
        r.x = FLASH.x; r.y = FLASH.y; r.h = FLASH.h; r.color = INLAY.color; r.radius = INLAY.radius; r.intensity = INLAY.intensity * k * k; r.flicker = 0; r.id = 9951;
        LOUT.push(r); i++;
      }
      if (CRACK.size) for (const v0 of CRACK.keys()) {   // a cracked vein's seams
        const v = ironOf?.[v0]; if (!v || Math.hypot(v.x - host.player.x, v.y - host.player.y) > 20) continue;
        const r = rec(); r.x = v.x + v.nx * .2; r.y = v.y + v.ny * .2; r.h = floorOf(v) + .7; r.color = '#ff7a30'; r.radius = 1.8; r.intensity = .55; r.flicker = .45; r.id = 9960 + v0;
        LOUT.push(r); i++;
      }
      return LOUT;
    },
    prompt(p) {
      if (p.kind !== 'anvil' || !p.build) return null;
      return {text: work && work.id === p.build ? `LMB  hammer (${Math.min(work.n, HAMMER.counts)} of ${HAMMER.counts})` : 'Tab  lay a bar on the anvil', color: '#f2c95c'};
    },
    hd(q, sc) {   // over the furnace under the cursor: its glow in a word and what LMB does
      const t = T(); if (!t || !active() || host.lock || host.hudOff || host.playerHidden || pack()?.open || host.BUSY?.has(host.player.state)) return;
      const b = underCursor(FURNS); if (!b) return;
      const f = furn(b.id), lit = burning(b), text = lit ? `${words(f.heat, f.ch?.ore).split(':')[0]}  ·  LMB pump` : 'cold  ·  E feed it a log';
      const s = host.G.toScreen(b.x, (b.z || 0) + 1.6, b.y);
      q.save(); host.G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
      hdPrompt(q, text, s[0] * sc, s[1] * sc, hdUnit(), lit ? hex(glowRGB(Math.max(.45, f.heat), RGB)) : '#e8a070');
      q.restore();
    },
    menu() {
      if (!ON || game()?.mode !== 'sandbox') return [];
      const furnNear = () => nearest(FURNS, 6);
      return [
        {label: 'Workshop: makings (stone, logs, copper and iron ore, glow shards: a furnace, an anvil, a bellows, a tool)', run: () => { const pk = pack(); if (!pk) return;
          for (const [k, n] of [['stone', 24], ['log', 6], ['birch_log', 4], ['pine_log', 3], ['copper_ore', 8], ['iron_ore', 9], ['glow_shard', 4]]) pk.give(k, n); }},
        {label: 'Workshop: the nearest furnace at white heat', run: () => { const b = furnNear(); if (b) { furn(b.id).heat = 1; ver++; } }},
        {label: 'Workshop: the nearest furnace\'s charge done', run: () => { const b = furnNear(), f = b && furn(b.id); if (f?.ch && !online()) { f.ch.prog = 1; } }},
        {label: 'Workshop: a test Iron Axe with a birch haft (made by you, now)', run: () => make('iron_axe', 'birch_log', false, '', true)},
        {label: 'Workshop: a test Iron Pick, pine haft and shard inlay', run: () => make('iron_pick', 'pine_log', true, '', true)},
        {label: 'Workshop: crack the nearest iron vein (as a fire would)', run: () => { if (online()) return; const P = host.player; let bi = -1, bd = 30; for (const i of ironVeins()) { const d = Math.hypot(ironOf[i].x - P.x, ironOf[i].y - P.y); if (d < bd) { bd = d; bi = i; } } if (bi >= 0) { crackSet(bi, (host.env?.t ?? 0) + FIRESET.hours); crackSave(); } }},
      ];
    },
    hud: () => { const s = store(); if (!ON || !s) return ''; let h = `workshop ${Object.keys(s.made).length} made`; for (const [id, f] of FURN) h += ` · ${id} heat ${f.heat.toFixed(2)}${f.ch ? ' ' + f.ch.ore + ' ' + Math.round(f.ch.prog * 100) + '%' : ''}${f.bel ? ' bellows' : ''}`; return h; },
    biomeChanged() { for (const f of FURN.values()) { f.mouth = null; f.glowK = -1; for (const b of f.bars) b.mesh = null; } workM = null; },   // (the rebuild disposed the world's meshes: made again)
  };
  return F;
}
