// Run-time effects of legendary relics (h.legend[id] = rarity multiplier) and of the run's omens.
// Called from small hooks: G.onCast / G.onDodge (entities.js), kills and hits (hub.js).
import {G, V, C, after, parts, shockwave, marker, bolt, flashLight, dist2, dmgNum} from './core.js';
import {damage, alive, center, explode, cc} from './combat.js';
import {hurtHero} from './entities.js';
import {sfx} from './audio.js';
import * as M from './meta.js';

const near = (p, R) => G.enemies.filter(e => alive(e) && dist2(e.g.position, p) < R + e.radius).sort((a, b) => dist2(a.g.position, p) - dist2(b.g.position, p));

G.onCast = (h, slot, def, aim, Mo) => {
  const L = h.legend; if (!L) return;
  if (L.stormsigil && ++h.stormN % 4 === 0) {
    const r = L.stormsigil, hits = near(h.g.position, 10).slice(0, r >= 2.5 ? 4 : 3);
    hits.forEach((e, k) => after(.1 + k * .09, () => {
      if (!alive(e)) return; const c = center(e);
      bolt(V(c.x + .6, 10, c.z - .4), c, .28); flashLight(c, 0xbfe0ff, 60, .3, 7); sfx('crit', {}, .02);
      damage(e, 45 * r, {elem: 'storm', col: '#dff1ff'}); parts.burst(c, 25, {col: C.white, b: 4, speed: 5, life: .35, size: .2});
    }));
  }
  if (L.tome && Math.random() < .15 * L.tome) after(.3, () => { if (!h.dead) { def.cast(h, aim.clone(), Mo); dmgNum(h.g.position.clone().add(V(0, 2.6, 0)), 'Echo', '#ffb060', false); } });
};
G.onDodge = (h, A) => {
  const r = h.legend && h.legend.greaves; if (!r) return;
  after(.05, () => explode(A, {cols: [C.white, C.ice], col: 0xbfe0ff, n: 70, R: 3.2, R2: 4, dmg: 35 * r, hitR: 3.2, knock: 10, elem: 'storm', dmgCol: '#dff1ff', shake: .2, light: 60}));
};
export function onKill(e) {
  const h = G.hero, L = h.legend || {}, P = e.g.position.clone();
  if (L.carrion && Math.random() < .15 * L.carrion) after(.15, () => explode(P, {cols: [C.green, C.gold], col: 0x9aff6a, n: 70, R: 2.6, dmg: 40 * L.carrion, hitR: 2.6, knock: 3, elem: 'poison', dmgCol: '#c8ff9a', shake: .12}));
  if (e.elite) {
    if (L.tyrant && h.cds[3] > 0) { h.cds[3] *= 1 - Math.min(1, .35 * L.tyrant); dmgNum(h.g.position.clone().add(V(0, 2.6, 0)), 'Ultimate ready sooner', '#ffd84a', false); }
    if (L.trophy) { h.stats.dmg += .02 * L.trophy; h.trophies = (h.trophies || 0) + 1; dmgNum(h.g.position.clone().add(V(0, 2.9, 0)), `+${(2 * L.trophy).toFixed(1)}% damage`, '#ffb060', false); }
  }
  if (G.run.omens.includes('volatile') && !e.boss && !e.minion) {
    marker(P, 2.2, 0xff3a2a, 1);
    after(1, () => { explode(P, {cols: [C.fire, C.red], col: 0xff3a2a, n: 50, R: 2.2, shake: .1}); if (G.hero && dist2(G.hero.g.position, P) < 2.2) hurtHero(e.dmg * 1.2); });
  }
}
export function onHurt() {
  const h = G.hero, r = h && h.legend && h.legend.winter; if (!r || G.time - (h.winterT ?? -9) < 4 || Math.random() >= Math.min(.6, .25 * r)) return;
  h.winterT = G.time; const p = h.g.position; shockwave(p, 0x9fdcff, 4.5, .5, 4); flashLight(V(p.x, 1.5, p.z), 0x9fdcff, 60, .5, 9);
  parts.burst(V(p.x, 1, p.z), 70, {cols: [C.ice, C.white], b: 3, speed: 7, life: .6, size: .3}); sfx('block');
  for (const e of near(p, 4.5)) cc(e, 'freeze', 1.6);
}
// omens that change enemies are applied once to everything that spawns
export function omenEnemies() {
  const O = G.run.omens.map(M.omenDef).filter(o => o.enemy); if (!O.length) return;
  for (const e of G.enemies) if (!e.omened) { e.omened = true; for (const o of O) o.enemy(e); }
}
export function omenHero(h) { for (const id of G.run.omens) { const o = M.omenDef(id); o.hero && o.hero(h); } h.stormN = 0; }
