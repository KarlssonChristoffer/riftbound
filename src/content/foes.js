// FOES: the desert's gunmen (features/foes.js), as data. Seconds, metres, degrees here; nothing imported.
//   TYPES   one row per kind of gunman: its art, toughness, legs, the band of range it fights from, its gun
//     atlas     the outfit's folder: concepts/sprites/out/outfits/<atlas>/ (the full 16-facing atlas) once its poses.json
//               lists the poses the gunmen use, else the gate-2 preview western/art_g2b/<atlas>/all/ (features/foes/look.js)
//     hp, r     health; the body's collider radius (m). hitR / hitH: what a bullet or an arrow must pass through
//     foot      the contact shadow's half width (art px: features/contact.js)
//     speed     m/s: walk (the gun up, strafing or backing off at `back`), run (holstered, closing in)
//     range     [near, far] m: inside `near` it backs off, past `far` it closes in; `keep` m is where it strafes. The view
//               shows ~5.4 m of ground above and below you at zoom 1 (more across): ranges stay on screen mostly; a gun
//               held on you from off screen gets an arrow at the screen's edge (features/foes/look.js)
//     gun       sound: what its gun sounds like (peacemaker: the forge's revolver recipe; coach: the coach gun's own recipe,
//               audio/forge/recipes/coachgun.js; src/audio/audio.js picks by it); rounds (the cylinder, the shells);
//               draw (s from the holster), aim (s the gun is held on you before each shot: the TELEGRAPH), lock (the
//               last s of it: the aim freezes and the barrel glints: roll or step out of the line), recover (s of the
//               kick), gap [lo, hi] s between shots, holster (s)
//       bullet  speed (m/s: slower than the player's, so a tracer can be seen and dodged), dmg (per hit), spread (deg,
//               triangular: most near the line), pellets (the coach gun's), range (m), lead (0..1 of the player's motion
//               it aims ahead of)
//       reload  s: up (the gate open), eject, round (each round / shell back in), close. Planted while it reloads: the
//               window to punish
//     flinch    s a hit freezes him (gun up: ready, aiming, the kick): no step, his gun's timers held, a shot he was
//               aiming comes that much later. It matches the hit clips' `back` mark (hit_f / hit_b: the frame from which
//               he can act again; features/foes/look.js warns in dev when they differ). 0: he doesn't flinch (the elite;
//               the view still shows the clip while he's between shots)
//     coins     [lo, hi] dropped on death (combat core's coin burst); weight: how often it comes in a gang; max alive
//     elite     the sheriff: tougher, steadier, a nameplate; the gunslinger's duel cue (features/gun.js) reads it
//   TUNE    how gangs come and how they fight together (see each line)
export const TYPES = {
  bandit: {name: 'Bandit', atlas: 'bandit', hp: 40, r: .3, hitR: .4, hitH: 1.75, foot: 5,
    speed: {walk: 1.55, back: 1.25, run: 3.4}, range: [3.5, 7], keep: 5,
    gun: {sound: 'peacemaker', rounds: 6, draw: .32, aim: .62, lock: .2, recover: .22, gap: [.8, 1.5], holster: .42,
      bullet: {speed: 46, dmg: 10, spread: 4, pellets: 1, range: 24, lead: 0},
      reload: {up: .3, eject: .35, round: .3, close: .3}},
    flinch: .2, coins: [2, 4], weight: 6, max: 6},
  sheriff: {name: 'Sheriff', atlas: 'sheriff', elite: true, hp: 110, r: .3, hitR: .4, hitH: 1.8, foot: 5,
    speed: {walk: 1.5, back: 1.2, run: 3.2}, range: [5, 9], keep: 6.8,
    gun: {sound: 'peacemaker', rounds: 6, draw: .22, aim: .46, lock: .14, recover: .18, gap: [.55, .95], holster: .36,
      bullet: {speed: 60, dmg: 14, spread: 1.6, pellets: 1, range: 30, lead: .5},
      reload: {up: .22, eject: .26, round: .22, close: .22}},
    flinch: 0, coins: [7, 10], weight: 1, max: 1},
  bruiser: {name: 'Bruiser', atlas: 'bruiser', hp: 85, r: .33, hitR: .44, hitH: 1.8, foot: 6,
    speed: {walk: 1.4, back: 1.1, run: 3.0}, range: [2, 4.5], keep: 3.2,
    gun: {sound: 'coach', rounds: 2, draw: .4, aim: .62, lock: .22, recover: .4, gap: [.25, .4], holster: .48,
      bullet: {speed: 38, dmg: 5, spread: 16, pellets: 6, range: 12, lead: 0},
      reload: {up: .3, eject: .45, round: .65, close: .35}},
    flinch: .18, coins: [3, 6], weight: 2, max: 2},
};
export const TUNE = {
  // gangs: the first one comes `first` s after you enter the desert sandbox, then one every `every` s while there is room
  // under `cap` alive; `gang` gunmen each, in from the walkable ground's edge `minWalk` m of walking (and `minLine` m of
  // straight line) from you
  spawn: {first: 8, every: [22, 36], retry: 2, cap: 6, gang: [2, 4], minWalk: 14, minLine: 11, edge: 2, apart: 1.3, devCap: 8},
  ai: {
    perceive: .2,        // s between looks at you (line of sight, distance), staggered per gunman
    maxAiming: 2,        // at most this many hold a gun on you at once (the rest wait their turn): telegraphs stay readable
    firstAim: [.25, .7], // s after the draw before the first aim (the gang doesn't fire as one)
    drawPast: 2.5,       // m past its range where a closing gunman draws (it walks in the rest of the way with the gun up)
    shootPast: 1.5,      // m past its range it still takes a shot
    lose: 2.5,           // s with no line on you (or far beyond its range) before the gun goes back in the holster
    strafe: [1.2, 2.8],  // s before a strafing gunman may turn round
    sep: 2.2,            // m: gang mates closer than this push apart (they spread out)
    turn: 9,             // rad/s the body turns
    accel: 10,           // m/s^2
    muzzle: {fwd: .5, h: 1.22},   // the shot leaves this far ahead of the body (m) at this height
    chest: 1.1,          // m: where on you they aim
    hitFront: 90,        // deg: a hit whose way comes from within this of his facing is from the front (hit_f / die_b)
    hitGap: .12,         // s: hits closer than this after the last one start no new reaction (a fanned cylinder: one flinch)
  },
  // you, as their bullets see you: a round body this wide between these heights (the dodge roll's i-frames let them by)
  body: {r: .3, h0: .1, h1: 1.75},
  bullets: {max: 96, sub: .3},   // pool size; sub-step length (m) of the hit test (no tunnelling at any speed)
  // the view's deaths (features/foes/look.js). With the death clips (die_b: shot from the front, on his back; die_f: from
  // behind, forward): the clip (its last frame the corpse, the gun beside him), a dust puff and a thud at its `ground`
  // mark, then the body lies `hold` s and fades over `fade` s; at most `max` lie about (the oldest fades early, `early` s).
  // travel: m the root moves as he falls, only where the clip's own bones can't say (features/foes/look.js reads the Hips
  // bone at its first frame) and it doesn't carry clip.travel. Without the clips (the fallback): thrown
  // back in `fall` (s), `land` (s), then `crouch`, faded over old: [from, to] s, sliding `slide` m/s, lifted `lift` m
  corpse: {hold: 9, fade: .8, max: 10, early: .5, travel: {die_b: .8, die_f: .7}, puff: {n: 14, r: .6},
    fall: .24, land: .2, old: [.7, 1.5], slide: 1.6, lift: .22},
  // the view's hit (features/foes/look.js): a bullet shoves the sprite `nudge` m along its way in `out` s and it eases
  // back over `back` s (only the picture: the body doesn't move); combat's white flash shows x `flash` (held full at first)
  hit: {nudge: .1, out: .035, back: .15, flash: 1.6},
};
