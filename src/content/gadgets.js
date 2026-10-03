// GADGETS: the equipment experiment's table (features/equip.js: one active gadget in a slot on F, Risk of Rain's
// equipment). Data only: metres, seconds, damage at stage 1 with no items (a run's damage stat and its stage scale every
// number marked dmg: features/equip/sim.js dmgK).
//   name, col (the glyph's colour), cd (s), desc (the slot's tooltip), range (m: a throw lands under the cursor, at
//   most this far out), and each gadget's own numbers (what each does: features/equip/sim.js)
export const GADGETS = {
  // shatters where it lands (or on the first body it meets): a pool of burning oil, r m across, dur s; whoever stands in
  // it takes dps (ticks every `tick` s) and burns on for `after` s once out (afterDps); wood in it catches (lights.js fire)
  flask: {name: 'Fire Flask', col: '#ff8a3a', cd: 12, range: 11, desc: 'shatters into burning oil: 5 s of fire, sets wood alight',
    r: 1.9, dur: 5, tick: .5, dps: 18, splash: 10, after: 1.6, afterDps: 7},
  // a lit bundle: its first landing falls `lead` of the way to the mark, then it bounces (restitution `bounce`, keeping
  // `keep` of its speed along the ground), rolls to a stop (`roll` m/s2 of friction) and goes off `fuse` s after the throw:
  // combat's explosion (crates break, props are thrown, kegs chain); wood the blast leaves standing may catch
  dynamite: {name: 'Dynamite', col: '#e8483a', cd: 15, range: 10, desc: 'a lit bundle: bounces, rolls, blows up big',
    fuse: 1.5, r: 3.2, dmg: 95, lead: .75, bounce: .36, keep: .45, roll: 5, ignite: .35},
  // thrown open; armed after `arm` s; the first enemy that sets foot within `trig` m gets dmg and is held (root s; elites
  // and the champion less); a spent trap stays shut `hold` s after it lets go; unsprung, it rusts away after `life` s
  beartrap: {name: 'Bear Trap', col: '#c8ccd4', cd: 10, range: 7, desc: 'snaps shut on the first enemy: a hard bite and a long hold',
    lead: .92, arm: .45, trig: .6, dmg: 30, root: 4, rootElite: 2.6, rootBoss: 1.5, life: 30, hold: .8},
  // planted where it lands for dur s: every enemy within `lure` m hops at it instead of you (to `stop` m) and whacks it;
  // each whack takes the enemy's damage off its hp; at 0 it falls apart
  scarecrow: {name: 'Scarecrow', col: '#e0b860', cd: 22, range: 9, desc: 'every enemy nearby goes for it instead of you',
    dur: 8, hp: 260, lure: 12, stop: .8, reach: 1.2},
  // pops where it lands: a cloud r m round for dur s (growing over `grow` s, thinning over the last `fade`); while you are in
  // it (and `linger` s after) you run x speed and the enemies have lost you; an enemy inside it is lost too: they wander
  // (a new spot `wander` m off every `every` s)
  smoke: {name: 'Smoke Bomb', col: '#a8b4c8', cd: 18, range: 10, desc: 'a thick cloud: inside it the enemies lose you and you run faster',
    r: 3.3, dur: 6.5, grow: .45, fade: 1.2, speed: 1.35, linger: .8, wander: [2, 3.5], every: [.9, 1.6]},
  // the hook flies straight (speed m/s) to what is under the cursor (an enemy, a solid prop within `snap` m of it, else the
  // ground) and bites; then it pulls you there at `pull` m/s for at most `max` s, to `stop` m off; an enemy at the end takes
  // dmg (a flying kick)
  grapple: {name: 'Grappling Hook', col: '#9ad0ff', cd: 7, range: 12, desc: 'hook a tree, a rock, an enemy or the ground and pull yourself there',
    speed: 34, pull: 17, max: 1.1, stop: .55, dmg: 30, snap: 1.1},
  // a gun loadout's (gun: only the cowboys carry it; a cowboy starts with it): hold F to spin the loop overhead, let go to
  // throw it at what's under the cursor: rope an enemy (it can't fight, tap F: yank it off its feet), a barrel or a crate
  // (towed), or a high anchor (a limb, a beam: swing on it; F or Space lets go). cd: after it's back in the hand. Its
  // numbers: content/lasso.js
  lasso: {name: 'Lasso', col: '#e0c084', cd: 1.4, range: 10, gun: true, desc: 'rope an enemy (tap F: yank it off its feet), tow a barrel, swing from a high limb'},
};
export const GADGET_IDS = Object.keys(GADGETS);
// may this loadout carry it (a gun's gadgets only with a gun)
export const fits = (id, weapon) => !!GADGETS[id] && (!GADGETS[id].gun || weapon?.kind === 'gun');
// a run: a cache by the spawn on every stage (cost + perStage x the stage, gold), and now and then one in a chest
export const SHOP = {cost: 20, perStage: 10, chest: .2};
// a thrown gadget: the time in the air for a lob of d m (t0 + tk d, clamped), and gravity (m/s2: a lob reads as a lob)
export const THROW = {t0: .3, tk: .045, tMax: .95, g: 20, hand: 1.35, minD: .8};
