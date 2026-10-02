// GUN feature: a gun loadout's glue to the game. The revolver itself is the player's (sim/player/gun.js); this feature
// gives it its controls and tells it what the yard is like:
//   RMB   fan the hammer: it takes the ability chain before combat, whose abilities (multishot, explosive arrow, rain,
//         piercing shot, vault trap) are the bow's: for a gun, 1-4 do nothing and their bar hides (combat/draw.js)
//   R     reload (the dev key that was there moved to P: dev/devkeys.js)        Y   tip the hat (the gunslinger)
//   cues  each step: calm (nothing hunting within TUNE.calmR m: the gunslinger blows the smoke off then), an elite or
//         the champion within TUNE.duelR m (the duel stance), a kill (smoke to blow off)
//   HUD   the cylinder (ui/cylinder.js), bottom centre
// OWNS: nothing of the sim (it calls the revolver's API: setCues, cue, fan, reload, emote). READS: host.weapon, host.PL.gun,
// the combat core's brutes (a live list) and their fight state. BUDGET: sim, a gun loadout only: one pass over the brutes.
import {createCylinder} from '../ui/cylinder.js';

const TUNE = {calmR: 7, duelR: 11};
// ORDER (core/features.js): before combat in every hook chain: RMB is the fan before combat's multishot
export const order = {before: ['combat']};
export async function create(host) {
  const cyl = createCylinder();
  let combat;
  const gun = () => host.weapon?.kind === 'gun' ? host.PL.gun : null;
  const F = {
    name: 'gun', label: 'Revolver', TUNE,
    update(dt, evs) {
      const g = gun(); if (!g) return;
      combat ??= host.feature('combat');
      let calm = true, duel = false;
      if (combat) {
        const px = host.player.x, py = host.player.y, core = combat.core;
        for (const b of core.brutes) {
          if (b.broken || b.gone || b.retired) continue;
          const d = Math.hypot(b.x - px, b.y - py);
          if (d < TUNE.calmR && (b.hunter || core.BS.get(b)?.mode === 'aggro')) calm = false;
          if ((b.elite || b.boss) && d < TUNE.duelR) duel = true;
        }
      }
      g.setCues(calm, duel);
      for (const e of evs) if (e.type === 'enemy.kill' || (e.type === 'prop.break' && e.kind === 'brute')) g.cue('kill');
    },
    ability(slot) { const g = gun(); if (!g) return false; if (slot === 'rmb') g.fan(); return true; },   // (1-4: the bow's)
    onKey(k) {
      const g = gun(); if (!g) return false;
      if (k === 'r') return g.reload();
      if (k === 'y') return g.emote('tip');
      return false;
    },
    hd(q, sc) { const g = gun(); if (g) cyl.draw(q, sc, g.S, host.weapon); },
    hud: () => { const g = gun(); return g ? `${host.weapon.name} ${g.S.ammo}/${g.S.cap} ${g.S.act || (g.S.out ? 'ready' : 'holstered')}` : ''; },
  };
  return F;
}
