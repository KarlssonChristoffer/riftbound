// THE RUN: its stages, and the wave director that fills a stage with enemies.
// A run is STAGES in order (biome + time of day). A stage is a number of waves; the last wave brings the champion.
// Each wave has a BUDGET (brute = 1, elite = 4, champion = 10) that grows with the stage and the wave; the director
// spends it in small groups, every `gap` seconds, never with more than `maxAlive` on the field. A spawn is TELEGRAPHED:
// a ring on the ground for TELE seconds (game.js draws it), then the enemy pops in. A wave ends when everything it
// planned has spawned and died; after a short lull the next one starts, and after the last one the stage is cleared.
import {ENEMIES, scaleOf, spawnEnemy} from './enemies.js';

export const STAGES = [
  {biome: 'ruins', time: 'day', waves: 3},
  {biome: 'frost', time: 'dusk', waves: 3},
  {biome: 'ember', time: 'night', waves: 4},
  {biome: 'rift', time: 'night', waves: 4},
];
export const TELE = .9, LULL = 2.4;

export function createDirector({core, nav, rng, onWaveClear, onStageClear}) {
  const alive = () => core.enemies.length;
  const D = {stage: 0, wave: 0, waves: 0, phase: 'idle', plan: [], tele: [], t: 0, gap: 1.4, maxAlive: 7, spawned: 0, total: 0,
    get alive() { return alive(); },
    get left() { return D.plan.length + D.tele.length + alive(); },   // still to beat this wave
    get boss() { return core.enemies.find(b => b.boss) || null; },
  };

  function planWave(stage, wave, waves) {
    const last = wave === waves - 1;
    let budget = 4 + wave * 2 + stage * 3;
    const list = [];
    while (budget >= 6 && stage + wave >= 2 && rng() < .3 + .12 * stage) { list.push('elite'); budget -= ENEMIES.elite.cost; }
    while (budget > 0) { list.push('brute'); budget -= ENEMIES.brute.cost; }
    for (let i = list.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [list[i], list[j]] = [list[j], list[i]]; }
    if (last) list.splice(Math.min(2, list.length), 0, 'champion');   // after the first group or two
    return list;
  }
  function startWave() {
    D.plan = planWave(D.stage, D.wave, D.waves); D.total = D.plan.length; D.spawned = 0;
    D.phase = 'wave'; D.t = .4;
    D.gap = Math.max(.8, 1.6 - .15 * D.stage); D.maxAlive = 6 + D.stage + (D.wave === D.waves - 1 ? 2 : 0);
  }

  Object.assign(D, {   // (methods only: Object.assign would freeze getters into values)
    start(stage, waves) { Object.assign(D, {stage, waves, wave: 0, tele: []}); startWave(); },
    stop() { D.phase = 'idle'; D.plan = []; D.tele = []; },
    update(dt) {
      for (let i = D.tele.length - 1; i >= 0; i--) {   // telegraphs ripen into enemies
        const q = D.tele[i]; q.t += dt;
        if (q.t >= TELE) { D.tele.splice(i, 1); q.b = spawnEnemy(core, q.type, q.x, q.y, scaleOf(D.stage, D.wave)); D.spawned++; }
      }
      if (D.phase === 'wave') {
        D.t -= dt;
        if (D.plan.length && D.t <= 0 && alive() + D.tele.length < D.maxAlive) {
          D.t = D.gap;
          const n = D.plan[0] === 'champion' ? 1 : Math.min(D.plan.length, 1 + Math.floor(rng() * 3), D.maxAlive - alive() - D.tele.length);
          const at = nav.spots(n, 5, 10, rng, [...D.tele, ...core.enemies]);
          for (const p of at) { const type = D.plan.shift(); if (!type) break; D.tele.push({...p, type, t: 0, boss: type === 'champion', elite: type === 'elite'}); }
        }
        if (!D.plan.length && !D.tele.length && !alive()) {
          D.wave++;
          onWaveClear?.(D.wave, D.waves);
          if (D.wave >= D.waves) { D.phase = 'clear'; onStageClear?.(); } else { D.phase = 'lull'; D.t = LULL; }
        }
      } else if (D.phase === 'lull' && (D.t -= dt) <= 0) startWave();
    },
  });
  return D;
}
