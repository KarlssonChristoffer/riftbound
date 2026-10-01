// COMBAT feature (render3d): the arena's combat (concepts/sprites/arena/combat.js) and prop physics (the physics half of
// arena/props3d.js), moved into the 3D world with the same behaviour, feel and tuning. OWNER: combat session.
//   combat/core.js    the simulation: damage + crits, breakables (stage 0 / 1 / 2), hitstop chains, shake, explosions and
//                     barrel chains (burning brands), loot coins + magnet, the 5 abilities (RMB Multishot, 1 Explosive,
//                     2 Rain, 3 Piercing, 4 Vault Trap), sparring brutes (hop at you, knock you back, respawn), chests,
//                     traps, the yard restocking itself
//   combat/props.js   prop physics: barrels tip and truly roll (3D matrices), crates push / sink into the stream as dry
//                     footing, blasts shove, powder kegs blow on impact, chest lids, tumbling debris meshes
//   combat/draw.js    the arena's pixel fx, telegraphs, coins, debris pixels into the 3D frame; HP bars, damage numbers
//                     and the ability bar on the HD layer
//
// CONTRACT (main.js FEATURE CONTRACT): create(host) -> F
//   F.update(dt, evs)      combat step, then prop physics with this step's events (+ the ones combat just pushed)
//   F.frame()              brute facings, barrel / sunk-crate matrices, chunk meshes, pixel fx (host.point / layers)
//   F.lights()             explosions, chest glow, trap flash, explosive arrows in flight (arena light format)
//   F.hd(q, scale)         HP bars, damage numbers, ability bar + tooltips, gold
//   F.onArrowHit(a, p) -> 'stop' | 'pierce'   F.onArrowStuck(a)   F.ability('rmb' | 1..4) -> bool   F.interact(p) -> bool
//   F.hud() -> 'gold N · cd ...'   F.biomeChanged()   F.dispose()
// Props this feature drives (world.js shows them): stage, broken, hp, r, wob, flash, opened, lid, gone, x / y / z / h
// (moves, hops, falls), face (brutes: the biome's 16-step SCREEN facing, from b.faceW), air, squash, rooted; tip / tilt /
// sink (it.manageMatrix while set). It pushes 2 extra crates by the stream into host.props (+ world items).
// Events (host.events, for audio / atmos): hit {player} / break {kind} / explode {r} / loot {n} / coin / open / trap /
// respawn; prop events with prop: true: tip / kick / scrape / impact {speed} / land / splash / respawn.
// Test handles: F.TUNE (= the arena's C.T), F.PROPS_TUNE (props3d T), F.AB, F.gold, F.cd, F.dbg (the arena's combat.dbg:
// zones, traps, ... + props), F.seed(n), F.shove(q, vx, vy), F.ms (rolling ms per frame: update + frame + hd).
import {createCore} from './combat/core.js';
import {createPropPhysics, extraProps} from './combat/props.js';
import {createDraw} from './combat/draw.js';

export async function create(host) {
  // the 2 loose crates by the stream (the arena adds them before combat lists its hittables)
  const extra = extraProps(host.props);
  await Promise.all(extra.map(p => host.world.addItem(p)));
  const core = createCore(host);
  const phys = await createPropPhysics(host, core);
  const draw = createDraw(host, core);
  let tU = 0, tF = 0;
  const now = () => performance.now();

  const F = {
    name: 'combat', label: 'Combat', on: true, ms: 0,
    TUNE: core.T, T: core.T, PROPS_TUNE: phys.T, AB: core.AB, core, phys,
    get gold() { return core.gold; }, get cd() { return core.cd; },
    dbg: Object.assign(core.dbg, {props: phys.dbg}),
    seed: n => core.seed(n), shove: (q, vx, vy) => phys.shove(q, vx, vy),

    update(dt, evs) {
      const t0 = now(), n0 = host.events.length;
      core.update(dt);
      // the props see this step's events and the ones combat just pushed (break, explode): the arena ran both on the
      // same step's list. They are marked as seen, so next step's copy of them is skipped
      phys.update(dt, host.events.length > n0 ? evs.concat(host.events.slice(n0)) : evs);
      tU += now() - t0;
    },
    frame() { const t0 = now(); phys.frame(); draw.frame(); tF = now() - t0; },
    lights: () => core.lights(),
    hd(q, scale) {
      const t0 = now(); draw.hd(q, scale);
      const ms = tU + tF + now() - t0; tU = 0;
      F.ms = F.ms * .95 + ms * .05; F.msLast = ms;
    },
    onArrowHit: (a, p) => core.onArrowHit(a, p),
    onArrowStuck: a => core.onArrowStuck(a),
    ability: slot => core.ability(slot),
    interact: p => core.interact(p),
    hud: () => core.S.hud,
    async biomeChanged() {
      phys.biomeChanged();
      for (const p of extra) await host.world.addItem(p);   // the rebuilt world doesn't know our crates
    },
    dispose() { draw.dispose(); },
  };
  return F;
}
