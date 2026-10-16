// PACK: the persistent world's player (docs/GATHERING.md): what he carries (the material POUCH and the small BAG:
// game/inventory.js), what he has learned (SKILLS: game/skills.js, levels as host.mods notes), and their save (game/save.js
// loadWorld / saveWorld: a key of its own, kept across reloads). Other systems give and take through this feature's API and
// keep their own part of the world in it (store(name): woodcut's felled trees). Tab opens the panel (ui/packpanel.js).
//   const pack = host.feature('pack')
//   pack.give(id, n, at?) -> how many didn't fit (at {x, y, h}: a float there) / pack.take(id, n) -> bool / pack.count(id) /
//   pack.has(id, n) / pack.best(job) -> the bag's best tool for a job | null / pack.gain(skill, n, at?) -> the new level | 0 /
//   pack.payOf(need) -> {id: n} (a recipe's need [{ids, n}] paid with the kinds there are most of) / pack.short(cost) -> bool /
//   pack.level(skill) / pack.store(name) -> that system's saved object (it writes its own; then pack.dirty()) /
//   pack.recipe(r) (a build the panel offers: {id, name, cost: {id: n}, can() -> '' | why not, run(), group?: the panel's
//   heading, 'Build' when absent, shown?() -> false: left out for now}) / pack.section(s) (a part of the panel another system
//   draws: {id, title, ver() -> number (redrawn when it changes), html(esc, icon) -> string, click?(data, ask): an element of its
//   html with data-sec="<id>" clicked (data: its dataset; ask(r): r carried out in the sim step like a recipe)}: features/fishing.js's
//   catch journal, features/meals.js's Cook journal) / pack.held(slot)
//   (the bag slot whose tool is in hand: the panel marks it; -1 none) / pack.giveMade(id, u, at?) -> true when it went in (a made
//   thing: a slot of its own carrying its record's uid: features/workshop.js) / pack.takeU(u) / pack.slotOf(u) / pack.prefer(slot)
//   (that slot's tool swings for its job: a click on it in the panel) / pack.slotTip(t) ({show(slot, e), move(e), hide()}: the card
//   over a made thing's slot, ui/madetip.js through features/workshop.js)
// SKILLS' XP (docs/SKILLS.md): offline a gain is x its skill's RATE (content/skills.js; ?xprate= a factor, raw: RATE ignored). In
// co-op the server owns it: gain() adds nothing (the server grants XP on the acts it sees and tells this player: coop.mail
// 'skills'), the pack takes its levels from the server's word and keeps it in the save (offline play goes on from it).
// THE MOVES (content/skills.js MOVES): every few levels a skill gives a move; features ask pack.move(id) (?moves=0: none;
// ?movelvl=N: every skill counts as at least N for them, as a co-op server's --movelvl does). A level reached or a move learned
// is a pixel toast (ui/skilltoast.js) at the bottom centre; the panel lists the moves had under each skill's bar.
// TITLES (content/skills.js TITLES): offline the pack counts (from the events: trees felled, blueberries picked, night fish,
// veins spent; the metres he walks and the seconds in the cave each step) and grants them (pack.store('titles')); online the
// server does and its word (the skills message's ti) is kept there too. One worn (the newest; the panel's title row picks
// another or none): pack.title, pack.wear(id) (online asks the server: the others see it under his name).
// OWNS: the inventory, the skills, the world save, the panel, the modifier source 'skills', the skill toasts.
// READS: content/items.js, content/skills.js, the game's HUD (toasts, floats), the cave's plan (host.world.cave: the Cave Rat).
// EMITS: pack.add, skill.level, skill.move, title.earned.
// BUDGET: sim; nothing per step but a save timer; the panel rebuilds only when what it shows changed.
import {ITEMS, START_KIT} from '../content/items.js';
import {SKILLS, CURVE, TITLES, rateOf, needXP, movesHad, nextMoveLvl, hasMove, titlesEarned, inCave} from '../content/skills.js';
import {isFish} from '../content/fishing.js';
import {createInventory} from '../game/inventory.js';
import {createSkills} from '../game/skills.js';
import {loadWorld, saveWorld, clearWorld, stashWorld} from '../game/save.js';
import {createPackPanel} from '../ui/packpanel.js';
import {createSkillToasts} from '../ui/skilltoast.js';
import {hdUnit} from '../ui/hdpixel.js';
import {flags} from '../core/flags.js';

const ON = flags.get('pack') !== '0';
// THE SAVE'S VERSION: change the saved shape -> bump SAVE_V and add MIGRATE[old](o) -> o at old + 1 (a save is never just
// dropped: one with no way forward is stashed aside, game/save.js stashWorld, before a new world is written)
const SAVE_V = 1, MIGRATE = {};
const SAVE_AFTER = 2;   // s after a change before the save is written (a string of pickups: one write)
const XPRATE = (v => v === 'raw' ? 'raw' : +v > 0 ? +v : 1)(flags.get('xprate'));
const MOVES_ON = flags.get('moves') !== '0';
const MOVELVL = Math.max(0, parseInt(flags.get('movelvl')) || 0);

export async function create(host) {
  const inv = createInventory(ITEMS, {slots: 8});
  const skills = createSkills(SKILLS, CURVE, host.mods);
  let stores = {}, dirtyT = -1, held = -1;
  const recipes = [], sections = [], tips = [];
  const game = () => host.feature('game');
  const ui = () => game()?.ui || null;

  function load() {
    let o = flags.get('fresh') === '1' ? null : loadWorld();
    while (o && o.v < SAVE_V && MIGRATE[o.v]) o = MIGRATE[o.v](o);
    if (o && o.v === SAVE_V) { inv.load(o.inv); skills.load(o.skills); stores = o.stores && typeof o.stores === 'object' ? o.stores : {}; return; }
    if (o) { stashWorld(o); console.warn('pack: a save of version', o.v, 'this game can\'t read: kept as riftbound3d.world.v1.unread'); }
    inv.load(null); skills.load(null); stores = {};
    for (const [id, n] of START_KIT) inv.add(id, n);
    dirtyT = 0;   // (a new world: written at once)
  }
  const write = () => { dirtyT = -1; saveWorld({v: SAVE_V, inv: inv.toJSON(), skills: skills.toJSON(), stores}); };
  if (ON) { load(); addEventListener('pagehide', () => { if (dirtyT >= 0) write(); }); }

  const queue = [];   // the panel's clicks (and the menu's): carried out in the sim step
  let moveLvl = MOVELVL;   // (?movelvl, the dev row, a test server's --movelvl: the moves' pretend level)
  // the panel's move lines under a skill's bar: the moves had (name, line) and the next one's level (0: none built past them)
  const moveLines = id => { const L = Math.max(skills.level(id), moveLvl); return MOVES_ON ? {had: movesHad(id, L), next: nextMoveLvl(id, L)} : {had: [], next: 0}; };
  let titleVer = 0;
  const T = () => { const s = stores.titles ??= {}; s.n ??= {}; s.titles ??= []; s.title ??= ''; return s; };   // (the titles' part of the save)
  const titleOf = () => ({worn: T().title, had: T().titles, names: TITLES});
  const panel = ON ? createPackPanel({host, inv, skills, ITEMS, SKILLS, recipes, sections, held: () => held, ask: r => queue.push(r), moves: moveLines, movesVer: () => moveLvl * 7919 + titleVer,
    titles: titleOf, wear: id => queue.push({name: 'Title', run: () => F.wear(id)}),
    pick: i => queue.push({name: 'Bag', run: () => { const j = inv.prefer(i); if (j) dirtyT = Math.max(dirtyT, 0); }}), tips,
    put: id => { if (putter) queue.push({name: 'Put down', run: () => putter(id)}); }}) : null;
  let putter = null;   // (features/foxden.js: what "Put down" does: F.onPut)
  const label = (id, n) => (n > 1 ? `+${n} ` : '+') + (ITEMS[id]?.name || id);
  const coop = () => host.feature('coop');
  const online = () => !!coop()?.online;
  const xpText = n => `+${Math.max(1, Math.round(n))} xp`;
  const toasts = createSkillToasts();
  const levels = {};       // (the moves' levels: the skills' or the pretend level, whichever is more; hasMove reads it)
  const moveLevels = () => { for (const id in SKILLS) levels[id] = Math.max(skills.level(id), moveLvl); return levels; };
  // a level reached (from L0): the toast names a move it gave, else just the level
  function leveled(id, L, L0 = L - 1) {
    const S = SKILLS[id], P = host.player, got = MOVES_ON ? movesHad(id, L).filter(m => m.lvl > L0 && m.lvl > moveLvl) : [];
    toasts.push(`${S.name} ${L}`, got.length ? got[got.length - 1].name : '', S.col);
    host.events.push({type: 'skill.level', skill: id, level: L, x: P.x, y: P.y, move: got.length ? got[got.length - 1].id : ''});
    for (const m of got) host.events.push({type: 'skill.move', skill: id, level: L, move: m.id, x: P.x, y: P.y});
  }
  // TITLES: earned (the toast, the event), counted offline
  const sayTitle = id => `They call you ${TITLES[id].name}.`;
  function earned(got) {
    const P = host.player;
    for (const id of got) { toasts.push(sayTitle(id), '', '#f2d27a', 5); host.events.push({type: 'title.earned', id, x: P.x, y: P.y}); }
  }
  function count(name, n) {
    if (online()) return;
    const s = T(); s.n[name] = Math.round(((s.n[name] || 0) + n) * 100) / 100; dirtyT = Math.max(dirtyT, 0);
    const got = titlesEarned(name, s.n[name], s.titles); if (!got.length) return;
    for (const id of got) { s.titles.push(id); s.title = id; }
    titleVer++; earned(got);
  }
  const WALK = {x: NaN, y: NaN, m: 0, cave: 0};   // (the metres and the cave's seconds, gathered: into the save every few)
  function countSteps(dt, evs) {
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i];
      if (e.type === 'tree.fell') count('trees', 1);
      else if (e.type === 'forage.pick' && e.mine && e.kind === 'blueberry' && e.n > 0) count('berries', e.n);
      else if (e.type === 'fish.catch' && isFish(e.id) && (host.env?.part || 'day') !== 'day') count('night_fish', e.n || 1);
      else if (e.type === 'mine.spent' && e.n > 0) count('veins', 1);
    }
    const P = host.player, d = Math.hypot(P.x - WALK.x, P.y - WALK.y);
    if (d < 1) WALK.m += d;   // (a teleport, a respawn: not walked)
    WALK.x = P.x; WALK.y = P.y;
    if (inCave(host.world?.cave, P.x, P.y)) WALK.cave += dt;
    if (WALK.m >= 5) { count('walked', WALK.m); WALK.m = 0; }
    if (WALK.cave >= 5) { count('cave', WALK.cave); WALK.cave = 0; }
  }
  // co-op: the server's word on his titles (the skills message's ti)
  function serverTitles(ti) {
    if (!Array.isArray(ti.titles)) return;
    const s = T(); s.titles = ti.titles.filter(id => TITLES[id]); s.title = TITLES[ti.title] ? ti.title : ''; titleVer++; dirtyT = Math.max(dirtyT, 0);
    if (Array.isArray(ti.got)) earned(ti.got.filter(id => TITLES[id]));
  }

  // the Sandbox's Skills rows, offline (online the server's --dev does the same to his record)
  function devSkills(what) {
    for (const id in SKILLS) {
      const L0 = skills.level(id);
      if (what === 'reset') skills.set(id, 0);
      else if (what === 'next') { const n = nextMoveLvl(id, L0); if (n) { const L = skills.set(id, needXP(n)); if (L) leveled(id, L, L0); } }
    }
    if (what === 'titles') for (const id in TITLES) { const D = TITLES[id]; count(D.n, Math.max(0, D.at - (T().n[D.n] || 0))); }
    if (what === 'notitles') { const s = T(); s.n = {}; s.titles = []; s.title = ''; titleVer++; }
    dirtyT = Math.max(dirtyT, 0);
  }
  // co-op: the server's word on his XP ({k: 'skills', xp: {id: n}, d?: {id: n}: this grant's, the float over his head)
  function serverSkills(m) {
    if (!m.xp || typeof m.xp !== 'object') return;
    if (m.ti && typeof m.ti === 'object') serverTitles(m.ti);
    if (m.ml !== undefined) moveLvl = Math.max(MOVELVL, +m.ml | 0);
    for (const id in m.xp) { const L0 = skills.level(id), L = skills.set(id, +m.xp[id]); if (L) leveled(id, L, L0); }
    dirtyT = Math.max(dirtyT, 0);
    if (m.d) for (const id in m.d) if (+m.d[id] > 0) { const P = host.player; ui()?.float(P.x, P.y, P.z + 2.2, xpText(+m.d[id]), '#c8d8a0'); }
  }

  const F = {
    name: 'pack', label: 'Pack', on: ON,
    inv, skills,
    give(id, n = 1, at = null) {
      if (!ON) return n;
      if (id === 'wood') id = 'log';   // (a 'wood' cost given back: Oak Logs)
      const left = inv.add(id, n), got = n - left;
      if (got > 0) {
        dirtyT = Math.max(dirtyT, 0); host.events.push({type: 'pack.add', id, n: got, x: at?.x ?? host.player.x, y: at?.y ?? host.player.y});
        if (at) ui()?.float(at.x, at.y, at.h ?? 1.6, label(id, got), ITEMS[id]?.col || '#f4efe4');
      }
      if (left > 0) ui()?.toast('The bag is full', ITEMS[id]?.name || id, '#e8a070');
      return left;
    },
    take(id, n = 1) { if (!ON || !inv.take(id, n)) return false; dirtyT = Math.max(dirtyT, 0); return true; },
    giveMade(id, u, at = null) {
      if (!ON || !u) return false;
      if (inv.add(id, 1, u) > 0) { ui()?.toast('The bag is full', ITEMS[id]?.name || id, '#e8a070'); return false; }
      dirtyT = Math.max(dirtyT, 0); host.events.push({type: 'pack.add', id, n: 1, x: at?.x ?? host.player.x, y: at?.y ?? host.player.y});
      if (at) ui()?.float(at.x, at.y, at.h ?? 1.6, label(id, 1), ITEMS[id]?.col || '#f4efe4');
      return true;
    },
    takeU(u) { if (!ON || !inv.takeU(u)) return false; dirtyT = Math.max(dirtyT, 0); return true; },
    slotOf: u => inv.slotOf(u), prefer(slot) { const j = inv.prefer(slot); if (j) dirtyT = Math.max(dirtyT, 0); return j; },
    slotTip(t) { if (!tips.includes(t)) tips.push(t); },
    count: id => inv.count(id), has: (id, n = 1) => inv.has(id, n), best: job => ON ? inv.best(job) : null,
    payOf: need => inv.payOf(need), short: cost => !ON || inv.short(cost),
    gain(id, n, at = null) {
      if (!ON || online()) return 0;   // (co-op: the server grants it)
      n *= rateOf(id, XPRATE);
      const L0 = skills.level(id), L = skills.gain(id, n); dirtyT = Math.max(dirtyT, 0);
      if (at && n > 0) ui()?.float(at.x, at.y, (at.h ?? 1.6) + .35, xpText(n), '#c8d8a0');
      if (L) leveled(id, L, L0);
      return L;
    },
    // does he have move id (content/skills.js MOVES)? (?moves=0: never; the pretend level counts)
    move: id => ON && MOVES_ON && hasMove(moveLevels(), id),
    get moveLvl() { return moveLvl; },
    // the title he wears (content/skills.js TITLES id, '' none) and the ones he has; wear(id) one of his ('' none)
    get title() { return T().title; }, get titles() { return T().titles; },
    wear(id) {
      if (id && !T().titles.includes(id)) return false;
      if (online()) return coop().act('title', id);   // (the server's word comes back in the skills message)
      T().title = id; titleVer++; dirtyT = Math.max(dirtyT, 0); return true;
    },
    level: id => skills.level(id),
    store(name) { return stores[name] ??= {}; },
    dirty() { dirtyT = Math.max(dirtyT, 0); },
    recipe(r) { if (!recipes.some(q => q.id === r.id)) recipes.push(r); },
    section(s) { if (!sections.some(q => q.id === s.id)) sections.push(s); },
    held(slot) { held = slot; },
    onPut(fn) { putter = fn; },   // (features/foxden.js: the pack panel's right-click "Put down" on a pouch row, carried out in the sim step)
    get open() { return !!panel?.open; },
    // a fresh world (the Sandbox menu): the save cleared, the start kit back; each system's store is emptied (they see it
    // empty on their next step and put the world back as they hold it: features/woodcut.js)
    reset() { clearWorld(); for (const k in stores) for (const f in stores[k]) delete stores[k][f]; inv.load(null); skills.load(null); for (const [id, n] of START_KIT) inv.add(id, n); dirtyT = 0; host.events.push({type: 'pack.reset'}); },

    update(dt, evs) {
      if (!ON) return;
      while (queue.length) { const r = queue.shift(); const why = r.can?.() || ''; if (why) ui()?.toast(r.name, why, '#e8a070'); else r.run(); }
      const c = coop(); if (c?.online && c.mail) for (let k = 0; k < c.mail.length; k++) if (c.mail[k].k === 'skills') serverSkills(c.mail[k]);
      if (evs && !online()) countSteps(dt, evs);
      if (dirtyT >= 0 && (dirtyT += dt) > SAVE_AFTER) write();
    },
    frame() { panel?.frame(); },
    view(dt) { toasts.update(dt); },
    hd(q) { if (!host.hudOff && toasts.length) toasts.draw(q, q.canvas.width, q.canvas.height, hdUnit()); },
    get open() { return !!panel?.open; },   // the panel is up (features/gear.js shows its panel beside it)
    close() { if (panel?.open) panel.toggle(); },   // (features/meals.js: a dish goes on the stick, the panel goes)
    onKey(k, e) {
      if (!ON || k !== 'tab' || e?.shiftKey || host.lock) return false;   // (Shift+Tab: dev/wardrobe.js)
      panel.toggle(); return true;
    },
    menu() {
      if (!ON) return [];
      const dev = what => () => { if (online()) { if (!coop().act('dev', what)) ui()?.toast('Skills', 'not online', '#e8a070'); } else queue.push({name: 'Skills', run: () => devSkills(what)}); };
      return [
        {label: 'New world (clear the pack and the felled trees)', run: () => queue.push({name: 'New world', run: () => F.reset()})},
        {label: 'Skills: every skill to its next move\'s level' + (online() ? ' (asks the server: --dev)' : ''), run: dev('next')},
        {label: `Skills: all the moves (pretend level 5 for them) ${moveLvl >= 5 ? '(on)' : '(off)'}`, run: () => { moveLvl = moveLvl >= 5 ? MOVELVL : 5; }},
        {label: 'Skills: every skill back to level 1' + (online() ? ' (asks the server: --dev)' : ''), run: dev('reset')},
        {label: 'Titles: earn them all' + (online() ? ' (asks the server: --dev)' : ''), run: dev('titles')},
        {label: 'Titles: clear them and their counts' + (online() ? ' (asks the server: --dev)' : ''), run: dev('notitles')},
      ];
    },
    hud: () => ON ? `pack ${[...inv.pouch].map(([id, n]) => id + ' ' + n).join(', ') || 'empty pouch'} · bag ${inv.bag.filter(Boolean).length}/${inv.bag.length}` : '',
  };
  return F;
}
