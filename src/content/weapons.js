// WEAPONS: what each loadout shoots (view/hero.js LOADOUTS names one per character). Data only: the player's bow code
// (sim/player/player.js shoot) reads `bow`, the revolver (sim/player/gun.js) reads the guns. Degrees and seconds here.
//   bow     today's numbers, moved verbatim: speed v0 + min(1, draw s x drawK) x vDraw (m/s), damage dmg0 + ... x dmgDraw,
//           on the move within +-cone deg of the torso's aim, launched `muzzle` m out; vh clamped to vhMin..vhMax with
//           `lift` x the flight time added against the arrows' gravity (sim/projectiles.js .9)
//   gun     rounds (the cylinder), speed (m/s, no drop), range (m: the bullet's life = range / speed), dmg per hit (the
//           build's notes on top: host.mods 'weapon.dmg'), push (how hard a hit shoves, x the bullet's velocity; an arrow
//           is 1 x ~20 m/s), spread (deg, triangular: aim standing / move / hip / fan), gap (s between aimed shots),
//           fanGap (s between fanned shots), fanDmg (x), draw (x the clip's speed: the quick draw), hip (the first shot
//           from the holster leaves from the hip: gun_hipfire), reload {up, eject, round (each), close} (s), dry (s after
//           the empty click before the reload starts), ready (s the gun stays up after the last shot), cone (deg: on the
//           move the shot leaves within this of the torso's aim), pen {through (bodies a bullet passes through: a
//           gunman, a brute; walls and props still stop it), dmg (x its damage after each body), speed (x its speed)}
// Game effects are notes on these (core/modifiers.js; gun.js applies them): weapon.dmg, weapon.reload, weapon.gap,
// weapon.spread, weapon.fanSpread, weapon.last (extra damage x for the cylinder's last round), weapon.quick (the
// first shot from the holster).
export const WEAPONS = {
  bow: {id: 'bow', kind: 'bow', name: 'Bow', abilities: true,
    v0: 14, vDraw: 12, dmg0: 10, dmgDraw: 14, drawK: 1.5, life: 1.6, cone: 35, muzzle: .35, vhMin: -12, vhMax: 8, lift: .45},
  // the gunslinger's Colt: accurate, a quick draw from the hip, a quick reload
  peacemaker: {id: 'peacemaker', kind: 'gun', name: 'Peacemaker', abilities: false,
    rounds: 6, speed: 160, range: 42, dmg: 15, push: .13, spread: {aim: .7, move: 2.4, hip: 3.2, fan: 8},
    gap: .2, fanGap: .095, fanDmg: .85, draw: 1.6, hip: true,
    reload: {up: .16, eject: .2, round: .2, close: .2}, dry: .3, ready: 3, cone: 25,
    pen: {through: 1, dmg: .6, speed: .75}},
  // the outlaw's brass-framed Navy: a heavier hit, wider spread, a slower reload
  brass_navy: {id: 'brass_navy', kind: 'gun', name: 'Brass Navy', abilities: false,
    rounds: 6, speed: 140, range: 38, dmg: 23, push: .2, spread: {aim: 1.8, move: 3.8, hip: 5, fan: 12},
    gap: .3, fanGap: .13, fanDmg: .85, draw: 1.05, hip: false,
    reload: {up: .22, eject: .28, round: .29, close: .26}, dry: .35, ready: 3, cone: 25,
    pen: {through: 2, dmg: .7, speed: .85}},
};
