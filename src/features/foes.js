// FOES feature: gunmen to fight in the desert (Red Mesa). In the SANDBOX only (?mode=sandbox&biome=desert; the desert is
// kept out of a run's stages): gangs of 2-4 come in from the edge of the walkable ground every so often while there's
// room under a cap, close in, draw, and trade shots with you from their range; a fight has stakes (game/game.js: your
// health counts while gunmen are about, you fall, you wake at the fort). ?foes=0 turns it off.
//   bandit   a revolver, the common one: mid range
//   sheriff  a revolver, the elite: tougher, steadier, a quicker aim with a lead on you, long range; his name over him
//            (the gunslinger's duel cue sees him: features/gun.js)
//   bruiser  a double-barrelled coach gun: close in, a wide spray of pellets, two shells, a slow two-shell reload
// Every shot is TELEGRAPHED: the gun is held on you for a moment (the hammer clicks back), then the aim freezes and the
// barrel glints: roll (the dodge's i-frames let bullets by) or step out of the line. An empty gun is reloaded standing:
// the window to punish. Their bullets are slower than yours: you see the tracers.
//   foes/sim.js    the truth: the gunmen's records, AI, guns, bullets, gangs (its own seeded generator, fixed steps)
//   foes/look.js   the view: their sprites (the outfits' atlases), death, the glint, tracers, health bars, the name
//   content/foes.js the numbers (TYPES, TUNE)
// They are entities (kind 'gunman') hurt through combat's damage path: hit numbers, hitstop, coins, enemy.kill (the
// gun's kill cue), the aim's hover; their shots and reloads go out as events (gunfx's flash, smoke, tracers' ends, the
// cases; the revolver recipe's sounds: src/audio/audio.js).
// API: F.stakes (a fight is on: the game counts your hurts), F.respawn() -> {x, y} (the fort, after you fall),
//   F.spawnGang(n?) (dev/devkeys.js C: a gang now), F.sim / F.look / F.TUNE / F.TYPES (tests), F.ms.
// OWNS: through foes/sim.js and foes/look.js (see there).  READS: the game's mode (host.feature('game')), the biome, flags.
// EMITS: foe.draw / aim / shoot / reload / holster, bullet.impact, player.hit, player.hurt (foes/sim.js).
// BUDGET (measured 2026-10-03, headless Chrome, 6 gunmen fighting, a busy machine): sim ~.10-.13 ms a step (the legs'
//   step tests ~.03, the guns ~.01, sight ~.005, bullets ~.007, the flow field ~.007 averaged: a BFS every .25 s);
//   view + frame + hd ~.17 ms; render: a sprite draw + a shadow draw per pose image on screen. No allocation of its own
//   per step or frame (events' payloads are a ring; the engine's queue grows as it does for every emitter).
import {createFoesSim} from './foes/sim.js';
import {createLook} from './foes/look.js';
import {flags} from '../core/flags.js';
import {TYPES, TUNE} from '../content/foes.js';

// ORDER (core/features.js): after combat (a gunman it broke this step leaves the fight in the same step); after frontier
// (its props stand in the world before the gunmen's nav grid is built from them)
export const order = {after: ['combat', 'frontier']};
export async function create(host) {
  const enabled = flags.get('foes') !== '0';
  const sim = createFoesSim(host), look = createLook(host, sim);
  let game = null, tU = 0, tF = 0;
  const now = () => performance.now();
  const active = () => enabled && host.biome.id === 'desert' && (game ??= host.feature('game'))?.mode === 'sandbox';
  const RESPAWN = {x: 0, y: 0};
  const F = {
    name: 'foes', label: 'Desert gunmen', on: true, ms: 0, TUNE, TYPES, sim, look,
    update(dt, evs) { const t0 = now(); sim.update(dt, evs, active()); tU += now() - t0; },
    view(dt, evs) { const t0 = now(); if (active()) look.load(); look.view(dt, evs); tU += now() - t0; },
    frame(f) { const t0 = now(); look.frame(f); tF = now() - t0; },
    hd(q, sc) {
      const t0 = now(); look.hd(q, sc);
      const ms = tU + tF + now() - t0; tU = 0; F.ms = F.ms * .95 + ms * .05; F.msLast = ms;
    },
    biomeChanged() { sim.biomeChanged(); if (enabled && host.biome.id === 'desert') look.load(); },   // (the art loads as you enter the desert)
    // the game's (game/game.js, the sandbox): a fight is on: your hurts count
    get stakes() { return active() && sim.alive > 0; },
    // where you wake after you fall: the fort (the layout's spawn, the yard's middle)
    respawn() { const s = host.layout.spawn; RESPAWN.x = s.x; RESPAWN.y = s.y; return RESPAWN; },
    // dev (dev/devkeys.js): a gang now (n gunmen, or the usual 2-4), if the desert sandbox is on
    spawnGang(n = 0) { if (!active()) return false; sim.request(n); return true; },
    hud: () => active() ? `foes ${sim.alive} alive · ${sim.B.n} bullets · next gang ${Math.max(0, sim.S.clock).toFixed(0)} s${look.failed ? ' · ART FAILED' : ''}` : '',
  };
  if (enabled && host.biome.id === 'desert') look.load();
  return F;
}
