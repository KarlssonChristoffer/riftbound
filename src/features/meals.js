// MEALS (docs/FORAGING.md, docs/FISHING.md): cooked at a burning campfire and eaten at once. The pack panel's Cook list offers
// every meal of content/meals.js; one costs its need from the pouch (each part paid with the kind he has most of), needs a
// campfire burning within COOK_R m (features/campfires.js burningNear) and gives a buff for its time: its notes in host.mods
// (source 'meal'), read by their owners (player.speed: the player; fish.*: fishing; woodcut.power: woodcutting ...). One meal at
// a time: a new one replaces it. Its time left is saved (pack.store('meals')) and counts down in the sim; the chip at the
// bottom left (HD, the pixel UI) shows the meal and its time while the pack's panel is shut (the panel's Fish part says it).
// A meal with trip: true (the fly agaric broth) is drunk, not eaten: features/trip.js starts (the meal eaten stays).
// Only in the persistent world (the sandbox's ruins biome). The meals were fishing's until the foraging slice (2026-10-15):
// a world saved before that has its meal under pack.store('fishing').meal; it is taken from there once.
// OWNS: the meal eaten and its time, its saved part, the modifier source 'meal', the recipe group Cook, the chip.
// READS: content/meals.js, content/items.js (names), pack (the pouch, the store), campfires (burningNear).
// EMITS: meal.cook. API: F.id (the meal eaten, '' none), F.left (s), F.ver() (changes as the panel's words would),
//   F.note(esc) -> the panel's line about it ('' none), F.eat(id, t?) (tests, dev).
// BUDGET: sim: a compare a step (a save every 5 s while one lasts); HD: one frame and a line of pixel text while one lasts.
import {MEALS} from '../content/meals.js';
import {COMMON_FISH} from '../content/fishing.js';
import {ITEMS} from '../content/items.js';
import {flags} from '../core/flags.js';
import {hdUnit, hdFont, hdFrame, hdText} from '../ui/hdpixel.js';

const ON = flags.get('pack') !== '0';
const COOK_R = 2.5;   // m from a burning campfire to cook

// ORDER (core/features.js): after the pack (its store); the Cook recipes go to it before fishing's Bait (the panel's group order)
export const order = {after: ['pack'], before: ['fishing']};

export async function create(host) {
  const game = () => host.feature('game'), ui = () => game()?.ui || null, pack = () => host.feature('pack');
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const store = () => pack()?.store('meals') || null;
  let id = '', left = 0, saveT = 0, offered = false, restored = false;

  function eat(m, t) {
    id = m; left = t; host.mods.set('meal', MEALS[m].notes);
    const s = store(); if (s) { s.meal = {id: m, t: Math.round(t)}; pack()?.dirty(); }
  }
  function unEat() {
    id = ''; left = 0; host.mods.clear('meal');
    const s = store(); if (s?.meal) { delete s.meal; pack()?.dirty(); }
  }
  const costOf = need => pack()?.payOf(need) || {};
  const short = o => pack()?.short(o) ?? true;
  const kinds = ids => ids === COMMON_FISH ? 'small fish' : ids.length > 4 ? 'fish' : ids.map(i => ITEMS[i]?.name || i).join(' or ');
  const needWords = need => need.map(q => `${q.n} ${kinds(q.ids)}`).join(' + ');
  const fireNear = () => { const P = host.player; return !!host.feature('campfires')?.burningNear?.(P.x, P.y, COOK_R); };
  const RECIPES = [];
  for (const m in MEALS) {
    const M = MEALS[m];
    RECIPES.push({id: 'meal.' + m, name: M.name, group: 'Cook',
      get cost() { return costOf(M.need); },
      desc: `${M.say}${M.trip ? '' : `, for ${Math.round(M.dur / 60)} min`}. Needs ${needWords(M.need)}, cooked by a burning campfire.`,
      can() {
        if (!active()) return 'only in the open world';
        if (M.trip && !host.feature('trip')?.on) return 'not now';
        if (short(costOf(M.need))) return `needs ${needWords(M.need)}`;
        return fireNear() ? '' : 'cook it by a burning campfire';
      },
      run() {
        const c = costOf(M.need); if (short(c)) return;
        for (const k in c) pack().take(k, c[k]);
        const P = host.player;
        if (M.trip) { host.feature('trip')?.start(M.dur); host.events.push({type: 'meal.cook', x: P.x, y: P.y, id: m}); return; }   // (a trip: the meal eaten stays)
        const had = id; eat(m, M.dur);
        host.events.push({type: 'meal.cook', x: P.x, y: P.y, id: m});
        ui()?.toast(M.name, M.say + (had && had !== m ? ` (instead of the ${MEALS[had].name.toLowerCase()})` : ''), '#ffb060');
      }});
  }
  // the meal saved: this feature's store, else (a world saved before meals had their own) fishing's, moved here
  function restore() {
    let m = store()?.meal;
    const old = pack()?.store('fishing');
    if (!m && old?.meal) { m = old.meal; delete old.meal; pack()?.dirty(); }
    if (m && MEALS[m.id] && m.t > 0) eat(m.id, m.t);
  }

  const F = {
    name: 'meals', label: 'Meals', on: ON,
    get id() { return id; }, get left() { return left; },
    ver: () => id ? Math.ceil(left / 60) : 0,
    note: esc => id ? `<div class="p-note">Eaten: ${esc(MEALS[id].name)}, ${Math.ceil(left / 60)} min left (${esc(MEALS[id].say)})</div>` : '',
    eat(m, t) { if (MEALS[m]) eat(m, t ?? MEALS[m].dur); },
    // each step: the recipes offered to the pack (once: it is made after this feature), the meal saved restored (once), its clock
    update(dt) {
      const pk = pack(); if (!ON || !pk) return;
      if (!offered) { offered = true; for (const r of RECIPES) pk.recipe(r); }
      if (!restored) { restored = true; restore(); }
      if (!id) return;
      if ((left -= dt) <= 0) { const M = MEALS[id]; unEat(); ui()?.toast(M.name, 'has worn off', '#a39478'); }
      else if ((saveT += dt) > 5) { saveT = 0; const s = store(); if (s?.meal) { s.meal.t = Math.round(left); pk.dirty(); } }
    },
    hd(q) { if (id && active() && !host.hudOff && !host.playerHidden && !pack()?.open) chip(q); },   // (the pack's panel shows it too, over that corner)
    hud: () => id ? `meal ${id} ${Math.ceil(left)}s` : '',
  };
  // the meal eaten (bottom left): its name and the time it has left
  function chip(q) {
    const u = hdUnit(), M = MEALS[id], s = Math.max(0, Math.ceil(left)), t = `${M.name}  ${(s / 60) | 0}:${String(s % 60).padStart(2, '0')}`;
    q.save(); q.setTransform(1, 0, 0, 1, 0, 0); q.imageSmoothingEnabled = false;
    q.font = hdFont(u);
    const W = Math.ceil(q.measureText(t).width / u) * u + 10 * u, H = 13 * u, x0 = 6 * u, y0 = q.canvas.height - H - 6 * u;
    hdFrame(q, x0, y0, W, H, u);
    hdText(q, t, x0 + 5 * u, y0 + 10 * u, u, s < 30 && ((performance.now() / 300) | 0) % 2 ? '#a39478' : '#ffb060');
    q.restore();
  }
  return F;
}
