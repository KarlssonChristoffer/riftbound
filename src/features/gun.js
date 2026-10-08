// GUN feature: a gun loadout's glue to the game. The revolver itself is the player's (sim/player/gun.js); this feature
// gives it its controls and tells it what the yard is like:
//   RMB   fan the hammer: it takes the ability chain before combat, whose abilities (multishot, explosive arrow, rain,
//         piercing shot, vault trap) are the bow's: for a gun, 1-4 do nothing and their bar hides (combat/draw.js)
//   R     reload (the dev key that was there moved to P: dev/devkeys.js)        Y   tip the hat (the gunslinger)
//   V     the pistol whip (an atlas with gun_whip: the gunslinger's). V is a dev key (the banded A/B): while the whip is to
//         hand this feature claims it (outside dev mode too: F.claims) and takes it first
//   cues  each step: calm (nothing hunting within TUNE.calmR m: the gunslinger blows the smoke off then), an elite or
//         the champion within TUNE.duelR m (the duel stance), a foe within TUNE.meleeR m (the empty click whips him
//         instead), a kill (smoke to blow off). Hunting: combat's brutes and every other hunter in the world (the desert's
//         gunmen, features/foes; the sheriff is an elite)
//   melee the whip's blow (player.melee, sim/player/gun.js): everything hittable in its arc takes it, through combat's
//         damage() (combat owns hp: a brute, a gunman, a prop, a dummy; combat.hit by 'melee')
//   HUD   the cylinder (ui/cylinder.js), bottom centre
// OWNS: nothing of the sim (it calls the revolver's API: setCues, cue, fan, reload, melee, emote, and combat's damage).
// READS: host.weapon, host.PL.gun, the combat core's brutes (a live list) and their fight state, the other hunters (a live
// query), what's near a blow (host.entities.near).
// BUDGET: sim, a gun loadout only: one pass over the brutes and the other hunters; a blow: one near() query.
import {createCylinder} from '../ui/cylinder.js';
import {hypot2} from '../core/mathx.js';

const TUNE = {calmR: 7, duelR: 11, meleeR: 1.7};
const DEG = Math.PI / 180;
// ORDER (core/features.js): before combat in every hook chain: RMB is the fan before combat's multishot
export const order = {before: ['combat']};
export async function create(host) {
  const cyl = createCylinder();
  let combat;
  const gun = () => host.weapon?.kind === 'gun' ? host.PL.gun : null;
  const others = host.entities.query('gun.hunter', p => p.hunter && p.kind !== 'brute');   // hunters that aren't combat's brutes
  const NEAR = [];   // (a blow's candidates: reused)
  // the pistol whip's blow: what's hittable (combat's test: hp, a target, breakable) within its reach and arc in front
  function land(e) {
    const core = combat?.core; if (!core) return;
    host.entities.near(e.x, e.y, e.reach + 1, NEAR);
    const ca = Math.cos(e.arc / 2 * DEG);
    for (let i = 0; i < NEAR.length; i++) {
      const p = NEAR[i];
      if (p.broken || p.gone || !(p.hp > 0 || p.target || p.breakable)) continue;
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy);
      if (d - (p.r || .3) > e.reach || Math.abs((p.z || 0) - e.z) > 1.2) continue;
      if (d > .05 && (dx * e.vx + dy * e.vy) / d < ca) continue;   // outside the arc in front of him
      core.damage(p, e.dmg, {canCrit: true, dir: [e.vx * 3 * e.push, e.vy * 3 * e.push], by: 'melee', ux: e.vx, uy: e.vy});
    }
  }
  const F = {
    name: 'gun', label: 'Revolver', TUNE,
    update(dt, evs) {
      const g = gun(); if (!g) return;
      combat ??= host.feature('combat');
      let calm = true, duel = false, near = false;
      if (combat) {
        const px = host.player.x, py = host.player.y, core = combat.core;
        for (const b of core.brutes) {
          if (b.broken || b.gone || b.retired) continue;
          const d = Math.hypot(b.x - px, b.y - py);
          if (d < TUNE.calmR && (b.hunter || core.BS.get(b)?.mode === 'aggro')) calm = false;
          if ((b.elite || b.boss) && d < TUNE.duelR) duel = true;
          if (d < TUNE.meleeR) near = true;
        }
      }
      for (const b of others) {
        if (b.broken || b.gone) continue;
        const d = hypot2(b.x - host.player.x, b.y - host.player.y);
        if (d < TUNE.calmR) calm = false;
        if ((b.elite || b.boss) && d < TUNE.duelR) duel = true;
        if (d < TUNE.meleeR) near = true;
      }
      g.setCues(calm, duel, near);
      for (const e of evs) {
        if (e.type === 'enemy.kill' || (e.type === 'prop.break' && e.kind === 'brute')) g.cue('kill');
        else if (e.type === 'player.melee') land(e);
      }
    },
    ability(slot) { const g = gun(); if (!g) return false; if (slot === 'rmb') g.fan(); return true; },   // (1-4: the bow's)
    onKey(k, e) {
      const g = gun(); if (!g) return false;
      if (k === 'r') return g.reload();
      if (k === 'y') return g.emote('tip');
      if (k === 'v' && !e?.shiftKey) return g.melee();   // (Shift+V: gunfx's smoke styles)
      return false;
    },
    claims: k => k === 'v' && !!gun()?.canMelee,   // (core/input.js: V reaches onKey outside dev mode while a whip is to hand)
    hd(q, sc) { const g = gun(); if (g) cyl.draw(q, host.hudScale, g.S, host.weapon); },   // (HUD: its size by the window, not the zoom)
    hud: () => { const g = gun(); return g ? `${host.weapon.name} ${g.S.ammo}/${g.S.cap} ${g.S.act || (g.S.out ? 'ready' : 'holstered')}` : ''; },
  };
  return F;
}
