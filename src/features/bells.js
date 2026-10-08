// BELLS AND RICOCHET PLATES (the sandbox, every biome; ?bells=0 off): shootable toys scattered round the Proving Grounds,
// not a course: no levels, no score panel. Things to shoot at while you walk about:
//   plates    dark steel plates on wooden posts at assorted angles. A bullet (or an arrow) that hits one ALWAYS glances off
//             it as a mirror (angle in = angle out; no scatter), a little slower and weaker, with sparks, a ping and the
//             ricochet's whine; up to 6 glances a shot (sim/projectiles.js deflectors, apart from the range's ricochets)
//   bells     brass bells on small gallows, each tuned to a note of one pentatonic scale. A bullet or an arrow rings one and
//             glances off its curved face (mirrored about the normal where it hit), so one shot can ring several; an
//             explosion's shock, the pistol whip and a tossed can ring them too. A rung bell swings, and its clapper strikes
//             it again a time or two as it swings (a phrase when a chain rings several)
//   nests     a few stands placed together on purpose: from the worn crescent on the ground, a shot at the plate glances into
//             a bell (a bank shot), off a second plate into a bell, or into a bell and on to another
//   chains    one shot off two or more plates / bells: a floating line where it ended ("2 bells, one bullet", "3 ricochets")
//             and the session's best
// Where: found at runtime on open, flat, walkable ground (sim.js: clear of props, paths, the spawn, the trick-shot range,
// the water), seeded by the biome: the same layout every load of a biome, placed again on a biome change. Runs never see it.
// SIM / VIEW: features/bells/sim.js is the truth (props, deflectors, rings, chains; its own generator); features/bells/view.js
// the look (meshes, the swing, the clapper's tolls, sparks, the floats). docs/exp/bells.md
// OWNS: F.on (an experiment: off by default; the Sandbox tab's row and the Dev toggle remember on: 'riftbound3d.bells'), the stands (their sim and view).
// READS: the game (sandbox or not), the trick-shot range's cans (a live query: kind trick_can).
// BUDGET: off / not the sandbox: nothing (update returns; no props, no draws). Standing: sim a pass over the step's events and
// <= 8 chain records; 1 static draw (its shadow in the cached map) + 1 draw per bell in view (static too while it hangs still);
// a setMatrix per swinging bell; HD only while a float shows. tools/perf/ab.mjs, sandbox at 3440 x 1440 (2026-10-05, a busy
// machine): 2.11 -> 2.06 ms a frame (-2%, noise), draws 118.4 -> 120.4, G.render .743 -> .757 ms, heap 77.4 -> 77.4 KB/frame.
import {flags} from '../core/flags.js';
import {createBellsSim, TUNE} from './bells/sim.js';
import {createBellsView} from './bells/view.js';

// ORDER (core/features.js): after the trick-shot range (its cans have moved this step when a bell checks them)
export const order = {after: ['trickshot']};
export async function create(host) {
  const KEY = 'riftbound3d.bells';
  const stored = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
  const q = flags.get('bells');
  const F = {name: 'bells', label: 'Bells and ricochet plates (experiment)', on: q === '1' || (q !== '0' && stored()), ms: 0, TUNE};
  let game = null;
  const S = createBellsSim(host), view = createBellsView(host, S);
  S.cans = host.entities.query('bells.cans', p => p.kind === 'trick_can');   // (a live list: empty unless the range stands)
  const g = () => game ??= host.feature('game');
  const sandbox = () => g()?.mode === 'sandbox';
  let built = null;   // the biome the stands were placed for

  function setOn(v) {
    F.on = v;
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* storage blocked: for this page only */ }
    if (!v) { S.teardown(); built = null; }
  }
  F.toggle = () => setOn(!F.on);
  // the menu's Sandbox tab (Places): walk to a nest's standing spot (the next one each time)
  let nestI = 0;
  F.menu = () => {
    if (!sandbox()) return [];
    if (!F.on) return [{label: 'Put up the bells and plates', run: () => setOn(true)}];
    const rows = [{label: 'Take down the bells and plates', run: () => setOn(false)}];
    if (S.nests.length) rows.unshift({label: `Bells and plates: go to a nest (${S.nests.length})`, run: () => { const n = S.nests[nestI++ % S.nests.length]; host.teleport(n.sx, n.sy); }});
    return rows;
  };

  F.update = (dt, evs) => {
    const want = F.on && sandbox(), id = host.biome?.id;
    if (S.active && (!want || built !== id)) { S.teardown(); built = null; }   // (a new biome: placed again)
    if (want && !S.active) { S.build(); built = id; }
    if (!S.active) return;
    const t0 = performance.now();
    S.update(dt, evs);
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  F.aimTarget = () => S.active ? S.aimTarget() : null;   // (the cursor over a plate or a bell aims at it: sim.js)
  F.view = (dt, evs) => { if (S.active || view.busy) view.view(dt, evs); };
  F.frame = () => view.frame();
  F.hd = (q, sc) => view.hd(q, sc);
  F.biomeChanged = () => view.biomeChanged();
  F.hud = () => S.active ? `bells ${S.bells.length} · plates ${S.stands.length - S.bells.length} · nests ${S.nests.length} · best chain ${S.rec.best}` : '';
  F._ = {S, view};   // (tests, probes)
  return F;
}
