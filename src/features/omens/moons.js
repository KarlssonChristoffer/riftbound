// THE LIGHT OMENS (features/omens.js runs them): the clock and the light turned into rules.
//   BLOOD MOON   night under a red moon (the clock held at TUNE world.hour, a red grade over the mood: content/omens.js).
//                SIM: host.mods notes on combat's brutes (combat/core.js T): 'combat.enemyPace' x .75 (they wait and hop
//                faster), 'combat.enemyDmg' x 1.35, 'combat.enemyCoins' x 2 (every coin they drop, doubled).
//                VIEW: their eyes burn red; ember-red motes drift up from the ground.
//   ECLIPSE      the sun goes out (a near-black grade: only lights show the world). SIM: 'light.lantern' + 'light.lanternR'
//                (render/lighting.js lights your lantern, a little wider); an enemy IN LIGHT takes TUNE.eclipse.lit x the
//                damage (combat's hit mods): within your lantern's reach, near a fire (lights.js fireNear: torches,
//                braziers, the campfire, something burning, a fire arrow) or a blast (combat.explode, for boomT s).
//                VIEW: an enemy in light shows a turning gold ring at its feet; one in the dark only its pale eyes.
//   GOLDEN HOUR  a blessing: the clock held in the low gold light before dusk, a warm grade. SIM: 'combat.enemyCoins' x 1.5;
//                you regenerate TUNE.golden.regen health a second (the game's stats.heal, in a run). VIEW: gold motes.
// OWNS: the eclipse's lit set and its blasts (sim), the motes (view, preallocated). READS: host.player, combat's core
//   (brutes), lights (fireNear), the game (stats, phase). BUDGET: sim < .01 ms a step; view ~.02 ms.
import {TUNE as ALL} from '../../content/omens.js';
import {viewRandom} from '../../core/rng.js';
import {hypot2} from '../../core/mathx.js';
import {TAU, C} from './kit.js';

// motes: points drifting up and swaying round the view (the blood moon's embers, the golden hour's dust in the light)
function motes(host, K, name, n, pal, rise) {
  const V = viewRandom(name), vr = (a, b) => a + V() * (b - a);
  const X = new Float32Array(n), Y = new Float32Array(n), H = new Float32Array(n), Ph = new Float32Array(n), L = new Float32Array(n), A = new Float32Array(n);
  let placed = false, k = 0;
  function put(i, P, any) { const a = V() * TAU, d = Math.sqrt(V()) * 14; X[i] = P.x + Math.sin(a) * d; Y[i] = P.y + Math.cos(a) * d * .8; H[i] = any ? vr(0, 3) : vr(0, .4); Ph[i] = V() * TAU; L[i] = vr(3, 7); A[i] = any ? V() * L[i] : 0; }
  return {
    reset() { placed = false; k = 0; },
    view(dt) {
      const P = host.player; k = Math.min(1, k + dt / 3);
      if (!placed) { for (let i = 0; i < n; i++) put(i, P, true); placed = true; }
      for (let i = 0; i < n; i++) {
        A[i] += dt; Ph[i] += dt * 1.3; H[i] += rise * dt; X[i] += Math.sin(Ph[i]) * .18 * dt; Y[i] += Math.cos(Ph[i] * .7) * .14 * dt;
        if (A[i] > L[i] || hypot2(X[i] - P.x, Y[i] - P.y) > 16) put(i, P, false);
      }
    },
    frame() {
      const m = Math.round(n * k);
      for (let i = 0; i < m; i++) { const f = A[i] / L[i]; if (f > .15 && f < .85 || (i & 3) === 0) host.point(X[i], Y[i], H[i], pal[f < .3 ? 0 : f < .7 ? 1 : 2], K.E1); }
    },
  };
}

// ---------------------------------------------------------------- the blood moon
export function createBloodMoon(host, K) {
  const T = ALL.bloodmoon, EYE = C('#ff3424'), M = motes(host, K, 'omens.blood', 46, [C('#ff7050'), C('#d0302a'), C('#701818')], .35);
  return {
    notes: () => [{stat: 'combat.enemyPace', mul: T.pace}, {stat: 'combat.enemyDmg', mul: T.dmg}, {stat: 'combat.enemyCoins', mul: T.coins}],
    begin() { M.reset(); }, end() {},
    view(dt) { M.view(dt); },
    frame(t) { M.frame(); const core = K.core(); if (core) for (const b of core.brutes) if (!b.broken && !b.retired) K.eyes(b, EYE, t, .35); },
  };
}

// ---------------------------------------------------------------- the eclipse
export function createEclipse(host, K) {
  const T = ALL.eclipse, EYE = C('#dfe6ff'), GOLD = C('#ffd27a');
  const lit = new Set(), booms = [];   // SIM: the brutes in light now (every 6 steps), the blasts that light the field a moment
  let simT = 0, tick = 0;
  function inLight(p) {
    const P = host.player;
    if (hypot2(p.x - P.x, p.y - P.y) < T.lantern) return true;
    for (const b of booms) if (simT < b.until && hypot2(p.x - b.x, p.y - b.y) < b.r) return true;
    return !!host.feature('lights')?.fireNear?.(p.x, p.y, T.fire);
  }
  return {
    notes: () => [{stat: 'light.lantern', add: 1}, {stat: 'light.lanternR', mul: T.lanternR}],
    begin() { lit.clear(); booms.length = 0; simT = 0; tick = 0; }, end() { lit.clear(); booms.length = 0; },
    update(dt, evs) {
      simT += dt;
      for (const e of evs) if (e.type === 'combat.explode') booms.push({x: e.x, y: e.y, r: (e.r || 2) + T.boom * .5, until: simT + T.boomT});
      for (let i = booms.length - 1; i >= 0; i--) if (simT > booms[i].until) booms.splice(i, 1);
      if (++tick % 6) return;
      lit.clear(); const core = K.core(); if (!core) return;
      for (const b of core.brutes) if (!b.broken && !b.retired && inLight(b)) lit.add(b);
    },
    hit(p, o, M) { if ((p.hunter || p.sparring) && inLight(p)) M.dmg *= T.lit; },
    get lit() { return lit; },
    frame(t) {
      const core = K.core(); if (!core) return;
      for (const b of core.brutes) {
        if (b.broken || b.retired) continue;
        if (lit.has(b)) K.ring(b.x, b.y, (b.z || 0) + .04, .5, GOLD, t * 2.4, 4, 2);
        else K.eyes(b, EYE, t, .3);
      }
    },
  };
}

// ---------------------------------------------------------------- the golden hour
export function createGolden(host, K) {
  const T = ALL.golden, M = motes(host, K, 'omens.golden', 64, [C('#fff2b0'), C('#ffd27a'), C('#c8922a')], .12);
  return {
    notes: () => [{stat: 'combat.enemyCoins', mul: T.coins}],
    begin() { M.reset(); }, end() {},
    update(dt, evs, fight) {   // SIM: your wounds close (the game's health: its own heal())
      const g = K.game(); if (!g || g.mode !== 'run' || !fight) return;
      const S = g.stats.S; if (S.hp > 0 && S.hp < S.maxHp) g.stats.heal(T.regen * dt);
    },
    view(dt) { M.view(dt); },
    frame() { M.frame(); },
  };
}
