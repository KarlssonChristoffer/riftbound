// XP RATE PROBE (docs/SKILLS.md, content/skills.js RATE): how much XP a minute of focused doing gives in each skill, raw (the
// tables' own XP) and with RATE, against the TARGET (45 a minute, within 20%), and the minutes to the move levels. An
// ESTIMATE from the forest's own plan (seed 1337: its trees, patches and veins) and the actions' own timings (the swings'
// durations, the cast's and the fight's numbers, the walk between things at run speed): no browser, so it runs anywhere in a
// second. The rates it prints are what RATE was tuned from; a playtest says whether the feel is right.
//   node tools/test/xprate.mjs [--seed 1337]
import {forestPlan} from '../../src/world/forest.js';
import {SKILLS, RATE, TARGET, XP, needXP, fellXP} from '../../src/content/skills.js';
import {TUNE as WOOD, treeStats} from '../../src/content/woodcut.js';
import {PLANTS, TUNE as FOR} from '../../src/content/forage.js';
import {VEINS, SWING as MSW, TUNE as MIN} from '../../src/content/mining.js';
import {CATCHES, TUNE as FISH, roll} from '../../src/content/fishing.js';
import {mulberry32} from '../../src/core/rng.js';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const SEED = +arg('seed', 1337), F = forestPlan(SEED), RUN = 3;   // m/s: the run (sim/player/player.js SPEED.run)
// the walk to the next thing of its kind: a greedy tour (always the nearest one not yet done) of `n` of them from each of a few
// starts, its mean step (m), x 1.3 for the way round trunks, rocks and walls
function nearest(pts, n = 40) {
  if (pts.length < 2) return 0;
  let sum = 0, k = 0;
  for (let s0 = 0; s0 < pts.length; s0 += Math.max(1, Math.floor(pts.length / 8))) {
    const done = new Set([s0]); let at = s0;
    for (let step = 0; step < Math.min(n, pts.length - 1); step++) {
      let b = -1, bd = 1e9;
      for (let j = 0; j < pts.length; j++) if (!done.has(j)) { const d = Math.hypot(pts[at][0] - pts[j][0], pts[at][1] - pts[j][1]); if (d < bd) { bd = d; b = j; } }
      done.add(b); at = b; sum += bd; k++;
    }
  }
  return sum / k * 1.3;
}
const out = {};

// WOODCUTTING: a tree's bites at an old axe's power (1), a swing each, the first a moment late (he walks in, .6 s); the fall
// (the logs come LOGS_T 2.6 s after the last bite) and the logs flying to him (~.8 s); then the walk to the next
{
  const T = [...F.trees.values()].filter(t => treeStats(t[2], t[3])), w = nearest(T);
  let xp = 0, s = 0;
  for (const t of T) { const st = treeStats(t[2], t[3]); xp += fellXP(t[2], t[3]); s += .6 + st.hp * WOOD.swing.dur + 2.6 + .8 + w / RUN; }
  out.woodcutting = {perMin: xp / s * 60, note: `${T.length} trees, ${(xp / T.length).toFixed(1)} XP a tree, ${(s / T.length).toFixed(1)} s a tree (walk ${w.toFixed(1)} m)`};
}
// FISHING: a cast's charge (~half a period) and flight, the wait (the roll's own, x the default lure), the bite's reaction
// (.35 s), the fight (its stamina at the reel's speed, plus the surges' let-goes: a third longer), the leap and the card (1.5 s)
{
  const R = mulberry32(7); let xp = 0, s = 0, n = 0;
  for (const part of ['dawn', 'day', 'dusk', 'night']) for (let i = 0; i < 2000; i++) {
    const r = roll(R, {water: 'lake', part, deep: 2, luck: 0, lure: 1, size: 1});
    const c = CATCHES[r.id], fight = c.find ? 1 : (c.fight?.stam || 2) / FISH.reel.speed * 1.33;
    xp += c.xp; s += FISH.cast.period / 2 + FISH.cast.fly + r.wait + .35 + fight + 1.5; n++;
  }
  out.fishing = {perMin: xp / s * 60, note: `${n} rolls (lake, all day), ${(xp / n).toFixed(1)} XP a catch, ${(s / n).toFixed(1)} s a catch`};
}
// FORAGING: the patches' XP, the crouch (and a moment to turn to it), the walk to the next patch
{
  const P = F.decor.filter(e => PLANTS[e[0]]).map(e => [e[1], e[2], e[0]]), w = nearest(P);
  let xp = 0; for (const p of P) xp += PLANTS[p[2]].xp;
  const s = P.length * (FOR.crouch + .4 + w / RUN);
  out.foraging = {perMin: xp / s * 60, note: `${P.length} patches, ${(xp / P.length).toFixed(1)} XP a patch, walk ${w.toFixed(1)} m`};
}
// MINING: a vein's blows (half of them rhythm blows: x the rhythm's power), a swing each, its XP and the spent vein's x 4; the
// walk between veins. While veins last: a cave holds what it holds, back after TUNE.days in-game days
{
  const V = F.cave?.veins || [], w = nearest(V.map(v => [v.x, v.y]));
  let xp = 0, s = 0;
  for (const v of V) { const K = VEINS[v.kind]; if (K.tier > 1) continue; const blows = Math.ceil(K.blows / ((1 + MIN.rhythmMul) / 2)); xp += blows * K.xp + K.xp * 4; s += .6 + blows * MSW.dur + 1 + w / RUN; }
  // (the veins come back an hour later: 3 in-game days at 20 real minutes a day. So mining's minute is the hour's: a sweep, then
  // the rest of the hour at the other skills; RATE makes a sweep a little more than Mining 5)
  const hour = MIN.days * 20;
  out.mining = {perMin: xp / hour, note: `${V.length} veins (${V.filter(v => VEINS[v.kind].tier > 1).length} need a better pick): a sweep ${Math.round(xp)} XP raw in ${(s / 60).toFixed(1)} min, once every ${hour} min`, sweep: xp};
}

console.log(`XP a minute of focused doing (seed ${SEED}); target ${TARGET}, within 20% = ${Math.round(TARGET * .8)}-${Math.round(TARGET * 1.2)}`);
console.log('skill        raw/min   RATE  rated/min  Lv5 min  Lv10 min   ok   (how)');
let bad = 0;
for (const id in SKILLS) {
  const o = out[id], r = o.perMin * RATE[id];
  // (mining: its rule is the sweep's, below)
  const okk = id === 'mining' ? o.sweep * RATE[id] >= needXP(5) && 2 * o.sweep * RATE[id] >= needXP(10) && o.sweep * RATE[id] < needXP(10) : r >= TARGET * .8 && r <= TARGET * 1.2; if (!okk) bad++;
  console.log(`${id.padEnd(12)} ${o.perMin.toFixed(0).padStart(7)} ${RATE[id].toFixed(2).padStart(6)} ${r.toFixed(1).padStart(10)} ${(needXP(5) / r).toFixed(0).padStart(8)} ${(needXP(10) / r).toFixed(0).padStart(9)}   ${okk ? 'yes' : 'NO '}  ${o.note}`);
}
if (out.mining.sweep) console.log(`mining: a sweep of the cave is ${Math.round(out.mining.sweep * RATE.mining)} XP rated: one sweep must reach Lv 5 (${needXP(5)}), two Lv 10 (${needXP(10)})`);
void XP;
process.exit(bad ? 1 : 0);
