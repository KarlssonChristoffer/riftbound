// TROLLS feature: the forest's trolls (docs/TROLLS.md): the big BERGTROLL that stands as stone by day where the sun caught it
// and walks the woods at night, and the knee-high PYSSLINGAR in packs round their burrows. Readable, not punishing: every blow is
// wound up with a ring on the ground where it lands; overworld fights are light (the heavy ones belong to the runs).
//   world/trolls.js     the plan: where the stones and burrows are (a pure function of the forest's seed)
//   trolls/sim.js       the truth: the records, the AI, the sun, the blows, the shots (its own seeded generator, fixed steps)
//   trolls/look.js      the view: the 3D bodies (view/troll3d.js through render/rigmesh.js), the stone, the rider on a shoulder,
//                       the telegraph rings, the rocks and cones in the air, the ragdolls
//   content/trolls.js   the numbers (TYPES, TUNE, PALETTE)
// In the forest (the ruins biome with a forest seed), the sandbox only for their anger (on the title they mind their own business).
// ?trolls=0 starts it off; ?trolls=near: a big one and a pack near you a few s after you arrive (awake whatever the hour: dev).
// Menu (sandbox): spawn some near you, go to the nearest stone / burrow.
// E on a troll stone: a knock (it grumbles). The third knock wakes it, grumpy, whatever the sun, for a while.
// API: F.list (the records), F.isTroll(p), F.shove(p, vx, vy, stun) (other systems' pushes: m/s), F.stagger(p, s),
//   F.spawnNear('big' | 'small' | 'pack', n?), F.stakes (a troll is fighting you: game/game.js counts your hurts), F.sim / F.look /
//   F.TUNE / F.TYPES / F.plan (tests), F.ms.
// OWNS: through trolls/sim.js and trolls/look.js; the first-meeting toasts. READS: the game's mode and ui, the biome, FOREST, flags.
// EMITS: through the sim (troll.*, player.hit, player.hurt). The shakes of a step, a roar, a boulder's landing are this file's view.
// MULTIPLAYER: local to each client (co-op for enemies was declined); a server would own the sim's state (see trolls/sim.js).
// BUDGET: sim ~.02 ms a step for the ~20 trolls of a forest (only those within TUNE.SIM_R think; a collide move each that walks);
//   view: a pose on a step change and a draw per troll on screen (render/rigmesh.js), no allocation a frame.
import {flags} from '../core/flags.js';
import {FOREST} from '../world/layout.js';
import {trollPlan} from '../world/trolls.js';
import {createTrollSim} from './trolls/sim.js';
import {createTrollLook} from './trolls/look.js';
import {TYPES, TUNE} from '../content/trolls.js';

// ORDER (core/features.js): after combat (a troll it broke this step leaves the fight in the same step; its hits are this step's)
export const order = {after: ['combat']};
export async function create(host) {
  const plan = trollPlan(FOREST);
  const sim = createTrollSim(host, plan), look = createTrollLook(host, sim), NONE = [];
  let game = null, tU = 0, tF = 0, devWant = flags.get('trolls') === 'near' ? 3 : -1;
  const now = () => performance.now();
  const mode = () => (game ??= host.feature('game'))?.mode;
  const active = () => F.on && !!plan && host.biome.id === 'ruins' && mode() !== 'run';
  const told = new Set();
  const tell = (k, title, sub) => { if (told.has(k)) return; told.add(k); game?.ui?.toast?.(title, sub, '#c8d89a'); };
  const near = (e, r) => Math.hypot(e.x - host.player.x, e.y - host.player.y) < r;

  const F = {
    name: 'trolls', label: 'Trolls', on: flags.get('trolls') !== '0', ms: 0, TUNE, TYPES, sim, look, plan,
    get list() { return sim.list; },
    isTroll: p => p?.kind === 'troll',
    shove: (p, vx, vy, stun) => sim.shove(p, vx, vy, stun),
    stagger: (p, s) => sim.stagger(p, s),
    spawnNear: (kind, n) => sim.spawnNear(kind, n),
    get stakes() { return active() && mode() === 'sandbox' && sim.fighting > 0; },
    update(dt, evs) {
      const t0 = now(), on = active();
      if (!registered) register();
      if (on && devWant > 0 && (devWant -= dt) <= 0 && !sim.spawnNear('pack')) devWant = 1;   // (not yet: you aren't standing anywhere yet)
      sim.update(dt, evs, on, on && mode() === 'sandbox');
      tU += now() - t0;
    },
    view(dt, evs) {
      const t0 = now(), on = active();
      if (on) for (const e of evs) {   // (the ground under you shakes: a step, a roar, a rock landing)
        if (e.type === 'troll.step') { if (near(e, 10)) host.shake(e.big > 1 ? 2 : 1, .07); }
        else if (e.type === 'troll.roar') { if (near(e, 18)) host.shake(2, .45); tell('roar', 'A Bergtroll!', 'Watch the ground: its blows land where the ring is'); }
        else if (e.type === 'troll.land' && e.atk === 'boulder') { if (near(e, 9)) host.shake(3, .2); }
        else if (e.type === 'troll.wake') { if (near(e, 25)) { host.shake(1, .6); tell('wake', 'A stone stirs', 'Trolls turn to stone in the sun; at dusk they wake'); } }
        else if (e.type === 'troll.stone') { if (near(e, 25)) tell('stone', 'Caught by the sun', 'The troll is stone until dusk'); }
        else if (e.type === 'troll.grumble') { if (near(e, 4)) host.shake(e.big >= 2 ? 2 : 1, .25); }
        else if (e.type === 'troll.giggle' && e.troll === 'small') { if (near(e, 14)) tell('small', 'Pysslingar', 'Small trolls: they bite and run. Fire keeps them off'); }
      }
      look.view(dt, on ? evs : NONE, on);
      tU += now() - t0;
    },
    frame(f) { const t0 = now(); look.frame(f, active()); tF = now() - t0; },
    hd(q, sc) {
      const t0 = now(); if (active()) look.hd(q, sc);
      const ms = tU + tF + now() - t0; tU = 0; F.ms = F.ms * .95 + ms * .05; F.msLast = ms;
    },
    lights: () => active() ? look.lights?.() || NONE : NONE,
    interact(p) {
      if (p?.kind !== 'trollstone' || !active()) return false;
      const n = sim.knock(p);
      if (n) game?.ui?.float?.(p.x, p.y, 2.2, n >= TUNE.knock.n ? 'it opens an eye...' : n === 1 ? '*knock*' : '*knock knock*', '#c8d89a');
      return true;
    },
    prompt(p) { return p?.kind === 'trollstone' ? {text: 'E  knock on the stone', color: '#c8d89a'} : null; },
    toggle() { F.on = !F.on; if (!F.on) { sim.update(0, NONE, false, false); look.clear(); } return F.on; },
    biomeChanged() { sim.update(0, NONE, false, false); look.clear(); },
    menu: () => mode() !== 'sandbox' || !plan ? [] : [
      {label: 'Trolls: a big one and a pack near you (awake)', run: () => sim.spawnNear('pack')},
      {label: 'Trolls: a big one near you (awake)', run: () => sim.spawnNear('big')},
      {label: 'Trolls: a pack of small ones near you', run: () => sim.spawnNear('small')},
      {label: 'Trolls: go to the nearest troll stone', run: () => goNear(plan.stones)},
      {label: 'Trolls: go to the nearest burrow', run: () => goNear(plan.burrows)},
    ],
    dbg: () => ({on: F.on, active: active(), sun: +sim.S.sun.toFixed(2), alive: sim.alive, fighting: sim.fighting, ms: +F.ms.toFixed(3),
      trolls: sim.list.map(r => `${r.id} ${r.st}${r.atk ? ':' + r.atk : ''}${r.foe ? ' FOE' : ''}${r.dead ? ' dead' : ''} ${r.x.toFixed(1)},${r.y.toFixed(1)} hp${r.p ? Math.round(r.p.hp) : '-'}`)}),
  };
  // the shared combat model (briefs/combat-shared.md): every sword, thrown weapon, smash and status reaches a troll through the
  // hits feature; its health stays combat's (core.damage: the coins, enemy.kill, the break), its reaction the sim's
  let registered = false;
  const NOHIT = {dmg: 0, ko: false, blocked: false}, OUT = {dmg: 0, ko: false, blocked: false}, DIR = [0, 0];
  function register() {
    const H = host.feature('hits'); if (!H?.register) return;
    registered = true;
    H.register('troll', {
      test: p => p?.kind === 'troll',
      take(p, hit) {
        const cr = host.feature('combat')?.core; if (!cr || p.broken) return NOHIT;
        let dmg = hit.dmg || 0; if (hit.extra) for (const k in hit.extra) dmg += hit.extra[k] || 0;
        sim.typeOf(p, hit.type, hit.extra);
        DIR[0] = (hit.ux || 0) * 3; DIR[1] = (hit.uy || 0) * 3;
        OUT.ko = !!cr.damage(p, dmg, {by: hit.by, canCrit: false, quiet: true, dir: DIR, ux: hit.ux, uy: hit.uy, hx: hit.x, hy: hit.y, hh: hit.h});
        OUT.dmg = Math.round(dmg); OUT.blocked = false; return OUT;
      },
      push: (p, vx, vy) => sim.shove(p, vx, vy, 0),
      stun: (p, s) => sim.shove(p, 0, 0, s),   // (a big one reels only past its poise)
    });
  }
  function goNear(L) {
    const P = host.player; let b = null, bd = 1e9;
    for (const s of L) { const d = Math.hypot(s.x - P.x, s.y - P.y); if (d < bd) { bd = d; b = s; } }
    if (b) host.teleport(b.x, b.y + 7);
  }
  return F;
}
