// PACK: the persistent world's player (docs/GATHERING.md): what he carries (the material POUCH and the small BAG:
// game/inventory.js), what he has learned (SKILLS: game/skills.js, levels as host.mods notes), and their save (game/save.js
// loadWorld / saveWorld: a key of its own, kept across reloads). Other systems give and take through this feature's API and
// keep their own part of the world in it (store(name): woodcut's felled trees). Tab opens the panel (ui/packpanel.js).
//   const pack = host.feature('pack')
//   pack.give(id, n, at?) -> how many didn't fit (at {x, y, h}: a float there) / pack.take(id, n) -> bool / pack.count(id) /
//   pack.has(id, n) / pack.best(job) -> the bag's best tool for a job | null / pack.gain(skill, n, at?) -> the new level | 0 /
//   pack.level(skill) / pack.store(name) -> that system's saved object (it writes its own; then pack.dirty()) /
//   pack.recipe(r) (a build the panel offers: {id, name, cost: {id: n}, can() -> '' | why not, run(), group?: the panel's
//   heading, 'Build' when absent}) / pack.section(s) (a part of the panel another system draws: {id, title, ver() -> number
//   (redrawn when it changes), html(esc, icon) -> string}: features/fishing.js's catch journal) / pack.held(slot)
//   (the bag slot whose tool is in hand: the panel marks it; -1 none)
// OWNS: the inventory, the skills, the world save, the panel, the modifier source 'skills'.
// READS: content/items.js, content/skills.js, the game's HUD (toasts, floats). EMITS: pack.add, skill.level.
// BUDGET: sim; nothing per step but a save timer; the panel rebuilds only when what it shows changed.
import {ITEMS, START_KIT} from '../content/items.js';
import {SKILLS, CURVE} from '../content/skills.js';
import {createInventory} from '../game/inventory.js';
import {createSkills} from '../game/skills.js';
import {loadWorld, saveWorld, clearWorld} from '../game/save.js';
import {createPackPanel} from '../ui/packpanel.js';
import {flags} from '../core/flags.js';

const ON = flags.get('pack') !== '0';
const SAVE_AFTER = 2;   // s after a change before the save is written (a string of pickups: one write)

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
  const panel = ON ? createPackPanel({host, inv, skills, ITEMS, SKILLS, recipes, sections, held: () => held, ask: r => queue.push(r)}) : null;
  const label = (id, n) => (n > 1 ? `+${n} ` : '+') + (ITEMS[id]?.name || id);

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
    gain(id, n, at = null) {
      if (!ON) return 0;
      const L = skills.gain(id, n); dirtyT = Math.max(dirtyT, 0);
      if (at && n > 0) ui()?.float(at.x, at.y, (at.h ?? 1.6) + .35, `+${n} xp`, '#c8d8a0');
      if (L) {
        const S = SKILLS[id];
        ui()?.toast(`${S.name} ${L}`, 'level up', S.col);
        host.events.push({type: 'skill.level', skill: id, level: L, x: host.player.x, y: host.player.y});
      }
      return L;
    },
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
      if (dirtyT >= 0 && (dirtyT += dt) > SAVE_AFTER) write();
    },
    frame() { panel?.frame(); },
    get open() { return !!panel?.open; },   // the panel is up (features/gear.js shows its panel beside it)
    onKey(k, e) {
      if (!ON || k !== 'tab' || e?.shiftKey || host.lock) return false;   // (Shift+Tab: dev/wardrobe.js)
      panel.toggle(); return true;
    },
    menu() { return ON ? [{label: 'New world (clear the pack and the felled trees)', run: () => queue.push({name: 'New world', run: () => F.reset()})}] : []; },
    hud: () => ON ? `pack ${[...inv.pouch].map(([id, n]) => id + ' ' + n).join(', ') || 'empty pouch'} · bag ${inv.bag.filter(Boolean).length}/${inv.bag.length}` : '',
  };
  return F;
}
