// TRICK-SHOT RANGE (an experiment, ?trick=1; off unless that or the Dev toggle / the Game tab's row, which remember it):
// a place in the sandbox to play with the guns and tune how they feel. In the Proving Grounds' north-west corner, along the
// north wall and north of the bow's lane (the desert's fort has the same walls), ~12 m from the spawn (the Game tab's "go to
// the mark" takes you there):
//   bottles   six on a fence rail. A bullet or an arrow breaks one (glass flies along the shot, the shot goes on through);
//             so does a blast or the pistol whip. They are set up again 2.5 s after the last one breaks, or with E at the
//             fence, or from the menu
//   cans      three stacked on a crate (knock them off) and three to toss: 1 (a gun loadout, at the range) or E at the
//             crate throws one up in front of you. A hit kicks it up and away (along the shot, an upward pop, a sideways
//             push for a hit off its middle), so you can keep it in the air: the JUGGLE counts its airborne hits in a
//             row. They bounce, roll, land on the crate or the rail, and a tossed can goes back in the crate after a while.
//             The aim assist: with a gun, the cursor near a can in the air aims where it will be when the bullet gets there
//   plate     a steel plate hanging from a frame: it rings and swings when shot (the cursor aims at it like a dummy)
//   ricochets on while the range stands (sim/projectiles.js RICO: off metal and stone at shallow angles; ?rico=0 never,
//             ?rico=1 everywhere): a host.mods note, so a run (the range isn't there) plays as ever
//   score     the HUD panel while you are at the range: shots, hits, accuracy, ricochets, the juggle and its best, the
//             fence against the clock (the first shot from the mark, a dotted line 4.5 m in front of the fence, with every
//             bottle up starts it; the last bottle stops it; walking off the range drops it); the bests are
//             remembered on this machine (localStorage 'riftbound3d.trickshot.v1')
// SIM / VIEW: features/trickshot/sim.js is the truth (its own generator; the hit chain, the shots, the keys' actions done in
// the next step); features/trickshot/view.js is the look (meshes, glass, spin, the HUD). docs/exp/trickshot.md
// OWNS: F.on (remembered: 'riftbound3d.trickshot'), the range (its sim and view).
// READS: the game (sandbox or not), host.weapon.
// BUDGET: off: nothing (update returns; no props, no draws, no Math.random). On, at the range: ~.1 ms a frame in all on the dev
// machine (tools/perf/ab.mjs, 3440 x 1440): +9 draws (the fence / crate / frame piece, the plate, one mesh of the standing
// bottles, the cans out of the crate), the HUD panel a copy of its own canvas (repainted when its numbers change).
import {flags} from '../core/flags.js';
import {createRangeSim, TUNE} from './trickshot/sim.js';
import {createRangeView} from './trickshot/view.js';
import {SHAPE} from './trickshot/models.js';

// ORDER (core/features.js): before combat in the hit chain (a bottle or a can is the range's to resolve, not combat's)
export const order = {before: ['combat']};
export async function create(host) {
  const KEY = 'riftbound3d.trickshot';
  const stored = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
  const q = flags.get('trick');
  const F = {name: 'trickshot', label: 'Trick-shot range (experiment)', on: q === '1' || (q !== '0' && stored()), ms: 0, TUNE};
  let game = null, view = null;
  const S = createRangeSim(host, {onDrop: () => view?.drop()});
  view = createRangeView(host, S);
  const g = () => game ??= host.feature('game');
  const sandbox = () => g()?.mode === 'sandbox';

  function setOn(v) {
    F.on = v;
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* storage blocked: for this page only */ }
    if (!v) S.teardown();   // (off, the views and draws stop: the meshes go now)
  }
  F.toggle = () => setOn(!F.on);
  // the sandbox's Game tab: open the range, or (open) go there, set it up again, close it
  F.menu = () => {
    if (!sandbox()) return [];
    if (!F.on) return [{label: 'Open the trick-shot range', run: () => setOn(true)}];
    const m = SHAPE.mark;
    return [{label: 'Trick-shot range: go to the mark', run: () => host.teleport(S.A.x + m.x, S.A.y + m.y + .4)},
      {label: 'Trick-shot range: set it up again', run: () => S.want('reset')},
      {label: 'Close the trick-shot range', run: () => setOn(false)}];
  };

  F.update = (dt, evs) => {
    const want = F.on && sandbox();
    if (want !== S.active) { if (want) S.build(); else S.teardown(); }
    if (!S.active) return;
    const t0 = performance.now();
    S.update(dt, evs);
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  F.onArrowHit = (a, p) => S.active ? S.onArrowHit(a, p) : undefined;
  F.arrow = a => { if (S.active) S.arrow(a); };
  F.aimTarget = () => S.active ? S.aimTarget() : null;
  F.interact = p => S.active && S.interact(p);
  F.prompt = p => S.active ? S.prompt(p) : null;
  // 1 (a gun has no abilities on 1-4): toss a can, at the range
  F.onKey = k => {
    if (k !== '1' || !S.active || host.weapon?.kind !== 'gun' || !S.near()) return false;
    S.want('toss'); return true;
  };
  F.view = (dt, evs) => { if (S.active || view.busy) view.view(dt, evs); };
  F.frame = () => view.frame();
  F.hd = (q, sc) => view.hd(q, sc);
  F.biomeChanged = () => view.biomeChanged();
  // Dev > Features, under its toggle: the aim assist on cans in the air (a gun's cursor near one leads it)
  F.settings = () => [{label: 'Aim assist (cans)', options: ['on', 'off'], get: () => S.assist ? 'on' : 'off', set: v => { S.assist = v === 'on'; }}];
  F.hud = () => S.active ? `range ${S.up()}/${S.bottles.length} · shots ${S.stats.shots} hits ${S.stats.hits} · juggle best ${S.rec.bestJuggle} · ${S.clear.st} ${S.clear.t.toFixed(2)}` : '';
  F._ = {S, view};   // (tests, probes)
  return F;
}
