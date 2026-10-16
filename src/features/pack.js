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
//   heading, 'Build' when absent}) / pack.section(s) (a part of the panel another system draws: {id, title, ver() -> number
//   (redrawn when it changes), html(esc, icon) -> string}: features/fishing.js's catch journal) / pack.held(slot)
//   (the bag slot whose tool is in hand: the panel marks it; -1 none)
// SKILLS' XP (docs/SKILLS.md): offline a gain is x its skill's RATE (content/skills.js; ?xprate= a factor, raw: RATE ignored). In
// co-op the server owns it: gain() adds nothing (the server grants XP on the acts it sees and tells this player: coop.mail
// 'skills'), the pack takes its levels from the server's word and keeps it in the save (offline play goes on from it).
// THE MOVES (content/skills.js MOVES): every few levels a skill gives a move; features ask pack.move(id) (?moves=0: none;
// ?movelvl=N: every skill counts as at least N for them, as a co-op server's --movelvl does). A level reached or a move learned
// is a pixel toast (ui/skilltoast.js) at the bottom centre; the panel lists the moves had under each skill's bar.
// OWNS: the inventory, the skills, the world save, the panel, the modifier source 'skills', the skill toasts.
// READS: content/items.js, content/skills.js, the game's HUD (toasts, floats). EMITS: pack.add, skill.level, skill.move.
// BUDGET: sim; nothing per step but a save timer; the panel rebuilds only when what it shows changed.
import {ITEMS, START_KIT} from '../content/items.js';
import {SKILLS, CURVE, rateOf, needXP, movesHad, nextMoveLvl, hasMove} from '../content/skills.js';
import {createInventory} from '../game/inventory.js';
import {createSkills} from '../game/skills.js';
import {loadWorld, saveWorld, clearWorld} from '../game/save.js';
import {createPackPanel} from '../ui/packpanel.js';
import {createSkillToasts} from '../ui/skilltoast.js';
import {hdUnit} from '../ui/hdpixel.js';
import {flags} from '../core/flags.js';

const ON = flags.get('pack') !== '0';
const SAVE_AFTER = 2;   // s after a change before the save is written (a string of pickups: one write)
const XPRATE = (v => v === 'raw' ? 'raw' : +v > 0 ? +v : 1)(flags.get('xprate'));
const MOVES_ON = flags.get('moves') !== '0';
const MOVELVL = Math.max(0, parseInt(flags.get('movelvl')) || 0);

export async function create(host) {
  const inv = createInventory(ITEMS, {slots: 8});
  const skills = createSkills(SKILLS, CURVE, host.mods);
  let stores = {}, dirtyT = -1, held = -1;
  const recipes = [], sections = [];
  const game = () => host.feature('game');
  const ui = () => game()?.ui || null;

  function load() {
    const o = flags.get('fresh') === '1' ? null : loadWorld();
    if (o && o.v === 1) { inv.load(o.inv); skills.load(o.skills); stores = o.stores && typeof o.stores === 'object' ? o.stores : {}; return; }
    inv.load(null); skills.load(null); stores = {};
    for (const [id, n] of START_KIT) inv.add(id, n);
    dirtyT = 0;   // (a new world: written at once)
  }
  const write = () => { dirtyT = -1; saveWorld({v: 1, inv: inv.toJSON(), skills: skills.toJSON(), stores}); };
  if (ON) { load(); addEventListener('pagehide', () => { if (dirtyT >= 0) write(); }); }

  const queue = [];   // the panel's clicks (and the menu's): carried out in the sim step
  let moveLvl = MOVELVL;   // (?movelvl, the dev row, a test server's --movelvl: the moves' pretend level)
  // the panel's move lines under a skill's bar: the moves had (name, line) and the next one's level (0: none built past them)
  const moveLines = id => { const L = Math.max(skills.level(id), moveLvl); return MOVES_ON ? {had: movesHad(id, L), next: nextMoveLvl(id, L)} : {had: [], next: 0}; };
  const panel = ON ? createPackPanel({host, inv, skills, ITEMS, SKILLS, recipes, sections, held: () => held, ask: r => queue.push(r), moves: moveLines, movesVer: () => moveLvl}) : null;
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
  // the Sandbox's Skills rows, offline (online the server's --dev does the same to his record)
  function devSkills(what) {
    for (const id in SKILLS) {
      const L0 = skills.level(id);
      if (what === 'reset') skills.set(id, 0);
      else if (what === 'next') { const n = nextMoveLvl(id, L0); if (n) { const L = skills.set(id, needXP(n)); if (L) leveled(id, L, L0); } }
    }
    dirtyT = Math.max(dirtyT, 0);
  }
  // co-op: the server's word on his XP ({k: 'skills', xp: {id: n}, d?: {id: n}: this grant's, the float over his head)
  function serverSkills(m) {
    if (!m.xp || typeof m.xp !== 'object') return;
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
      const left = inv.add(id, n), got = n - left;
      if (got > 0) {
        dirtyT = Math.max(dirtyT, 0); host.events.push({type: 'pack.add', id, n: got, x: at?.x ?? host.player.x, y: at?.y ?? host.player.y});
        if (at) ui()?.float(at.x, at.y, at.h ?? 1.6, label(id, got), ITEMS[id]?.col || '#f4efe4');
      }
      if (left > 0) ui()?.toast('The bag is full', ITEMS[id]?.name || id, '#e8a070');
      return left;
    },
    take(id, n = 1) { if (!ON || !inv.take(id, n)) return false; dirtyT = Math.max(dirtyT, 0); return true; },
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
    level: id => skills.level(id),
    store(name) { return stores[name] ??= {}; },
    dirty() { dirtyT = Math.max(dirtyT, 0); },
    recipe(r) { if (!recipes.some(q => q.id === r.id)) recipes.push(r); },
    section(s) { if (!sections.some(q => q.id === s.id)) sections.push(s); },
    held(slot) { held = slot; },
    get open() { return !!panel?.open; },
    // a fresh world (the Sandbox menu): the save cleared, the start kit back; each system's store is emptied (they see it
    // empty on their next step and put the world back as they hold it: features/woodcut.js)
    reset() { clearWorld(); for (const k in stores) for (const f in stores[k]) delete stores[k][f]; inv.load(null); skills.load(null); for (const [id, n] of START_KIT) inv.add(id, n); dirtyT = 0; host.events.push({type: 'pack.reset'}); },

    update(dt) {
      if (!ON) return;
      while (queue.length) { const r = queue.shift(); const why = r.can?.() || ''; if (why) ui()?.toast(r.name, why, '#e8a070'); else r.run(); }
      const c = coop(); if (c?.online && c.mail) for (let k = 0; k < c.mail.length; k++) if (c.mail[k].k === 'skills') serverSkills(c.mail[k]);
      if (dirtyT >= 0 && (dirtyT += dt) > SAVE_AFTER) write();
    },
    frame() { panel?.frame(); },
    view(dt) { toasts.update(dt); },
    hd(q) { if (!host.hudOff && toasts.length) toasts.draw(q, q.canvas.width, q.canvas.height, hdUnit()); },
    get open() { return !!panel?.open; },   // the panel is up (features/gear.js shows its panel beside it)
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
      ];
    },
    hud: () => ON ? `pack ${[...inv.pouch].map(([id, n]) => id + ' ' + n).join(', ') || 'empty pouch'} · bag ${inv.bag.filter(Boolean).length}/${inv.bag.length}` : '',
  };
  return F;
}
