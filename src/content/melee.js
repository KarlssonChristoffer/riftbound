// MELEE: the weapons, the shields and the moves (the shared combat model's weapon format: /mnt/project-files/briefs/combat-shared.md).
// Pure data. sim/player/melee.js times the moves, features/melee.js lands them through features/hits.js, view/heldweapon.js draws
// the weapon in his hand and the shield on his arm, view/livehero.js picks the live clips.
//
// A MOVE (times in s at a weapon speed of 1; a weapon's `speed` divides them):
//   clip     the live clip shown (western.py: fs_* the fists', tl_chop the axe's, ls_throw the lasso's, mv_* the brawl's), its
//            `hit` mark shown at `hit` (the fists' time warp); fb: the sprite stand-in frame
//   wind     s before the swing goes (the press held longer than input.heavyAt instead charges the weapon's heavy)
//   hit      s into the swing the blade meets (the sweep's middle); dur: the move's end; chain: from here a press goes on
//            into the combo's next move (queued presses wait for it)
//   reach    x the weapon's reach; arc: x the weapon's arc; dmg: x its damage; knock, lift (m/s), stun (s): what a hit does
//   step     m he lunges forward over the swing (toward the nearest foe in the cursor's way, if one is close: the assist)
//   sweep    the blade's way at the swing's start and end, deg off his facing (+ his left): the trail's arc and the swing's look
//   cant     the blade's angle in his fist (0: out of the thumb side, straight up from a punching fist; 90: along the punch,
//            a thrust) at the swing's start -> its end
//   fin      the combo's last: the next press starts it over
export const MOVES = {
  slash_r:  {clip: 'fs_hook_r',  fb: 'lunge',    wind: .06, hit: .12, dur: .34, chain: .16, reach: 1,   arc: 1,   dmg: 1,   knock: 2.2, stun: .25, step: .35, sweep: [-75, 70],  cant: [40, 60]},
  rise:     {clip: 'fs_upper_r', fb: 'reach_up', wind: .06, hit: .11, dur: .36, chain: .18, reach: .95, arc: .8,  dmg: 1.1, knock: 1.5, lift: 3.4, stun: .35, step: .3, sweep: [-30, 40], cant: [60, 20]},
  overhead: {clip: 'fs_hay',     fb: 'lunge',    wind: .08, hit: .16, dur: .5,  chain: .3,  reach: 1.1, arc: .7,  dmg: 1.6, knock: 5,   stun: .5,  step: .55, sweep: [20, -10],  cant: [15, 70], fin: true},
  thrust:   {clip: 'fs_cross',   fb: 'lunge',    wind: .04, hit: .08, dur: .28, chain: .12, reach: 1.15, arc: .5, dmg: 1,   knock: 1.6, stun: .2,  step: .45, sweep: [0, 0],    cant: [90, 90]},
  jab:      {clip: 'fs_cl_r',    fb: 'lunge',    wind: .03, hit: .06, dur: .22, chain: .1,  reach: .9,  arc: .6,  dmg: .8,  knock: 1,   stun: .15, step: .25, sweep: [5, -5],    cant: [90, 85]},
  lunge:    {clip: 'fs_cross',   fb: 'lunge',    wind: .05, hit: .14, dur: .44, chain: .28, reach: 1.25, arc: .5, dmg: 1.8, knock: 3.5, stun: .4,  step: 1.8, sweep: [0, 0],    cant: [90, 90], fin: true},
  cleave:   {clip: 'tl_chop',    fb: 'reach_up', wind: .1,  hit: .24, dur: .62, chain: .4,  reach: 1.15, arc: 1.1, dmg: 2.2, knock: 6,  lift: 1.5, stun: .6, step: .5, sweep: [35, -20], cant: [10, 80], fin: true},
  spin:     {clip: 'fs_round',   fb: 'lunge',    wind: .04, hit: .17, dur: .5,  chain: .34, reach: 1.1, arc: 3,   dmg: 1.4, knock: 4.5, stun: .4,  step: .3,  sweep: [-170, 170], cant: [70, 70], fin: true},
  dash:     {clip: 'mv_barge',   fb: 'lunge',    wind: .02, hit: .14, dur: .38, reach: 1.1, arc: .9, dmg: 1.5, knock: 4.5, stun: .4, step: 3.2, sweep: [-40, 40], cant: [80, 80], fin: true},
  // the shield's bash (RMB held, LMB): the shield's own numbers (SHIELDS bash) on top
  bash:     {clip: 'mv_barge',   fb: 'lunge',    wind: .03, hit: .12, dur: .4,  reach: .9,  arc: .9,  dmg: 0,   knock: 1,   stun: .7,  step: .9,  sweep: [0, 0],    cant: [40, 40], fin: true},
  // the throw (R): the blade leaves his hand at `hit`
  throw:    {clip: 'ls_throw',   fb: 'reach_up', wind: .06, hit: .16, dur: .36, reach: 0,   arc: 0,   dmg: 0,   step: 0,   sweep: [40, -30], cant: [20, 80], fin: true},
};
// THE WEAPONS. cls: blade | thrust | blunt | heavy | silly (how it's held and swung); hands 2: no shield (it rides on his back)
//   len (m: the blade or the head's far end from the fist), dmg + type (+ extra: added parts by type, content/damage.js), reach (m from
//   him to the farthest contact), arc (deg: the sweep's width at arc 1), cleave (bodies one swing meets at most), speed (x every move's
//   pace), knock (x the moves'), combo (MOVES, in order; LMB's string), heavy (the move a held LMB charges), backstab (x the damage from
//   behind a foe), throw {v m/s, spin rad/s, dmg x, stick (sticks in what it hits) | bounce n (ricochets), pierce n}, guard (its own
//   block share and parry window without a shield), smash (x the air smash's radius and damage), slots (the attachment slots: the
//   attachments thread fills them), look (view/heldweapon.js: the shape and colours), light (a glow colour: its light and trail),
//   trail (the swing's streak), note (what's special, shown when it's taken out)
export const WEAPONS = {
  sword: {name: 'Iron Sword', cls: 'blade', hands: 1, len: .92, dmg: 9, type: 'slash', reach: 1.45, arc: 130, cleave: 3, speed: 1,
    combo: ['slash_r', 'rise', 'overhead'], heavy: 'cleave', throw: {v: 18, spin: 16, dmg: 1.6, stick: true}, guard: {block: .5, parry: .18},
    smash: 1, slots: ['rune', 'edge', 'grip'], trail: '#e8f0ff', note: 'a good honest sword',
    look: {kind: 'blade', blade: .78, w: .05, tip: .14, guard: .2, grip: .14, pommel: .03, steel: ['#f4f8fc', '#c8d0dc', '#8a94a4', '#3a3e48'], hilt: ['#e0b070', '#a8743c', '#6e4622', '#2a1a0c']}},
  rapier: {name: 'Rapier', cls: 'thrust', hands: 1, len: 1.02, dmg: 7, type: 'pierce', reach: 1.75, arc: 55, cleave: 1, speed: 1.35,
    combo: ['thrust', 'thrust', 'lunge'], heavy: 'lunge', throw: {v: 24, spin: 0, dmg: 2, stick: true}, guard: {block: .3, parry: .32},
    riposte: 3, smash: .7, slots: ['rune', 'point', 'grip'], trail: '#ffffff', note: 'long parry window, a riposte hits x3',
    look: {kind: 'blade', blade: .92, w: .018, tip: .3, guard: .12, cup: .07, grip: .13, pommel: .028, steel: ['#ffffff', '#dfe6ee', '#a2acba', '#40444e'], hilt: ['#f2d27a', '#c89a3a', '#8a6420', '#3a2a0c']}},
  knife: {name: 'Bowie Knife', cls: 'blade', hands: 1, len: .4, dmg: 5, type: 'slash', reach: 1.05, arc: 100, cleave: 1, speed: 1.75,
    combo: ['jab', 'slash_r', 'jab', 'rise'], heavy: 'lunge', backstab: 3, throw: {v: 28, spin: 24, dmg: 2.6, stick: true}, guard: {block: .2, parry: .14},
    smash: .6, slots: ['rune', 'edge'], trail: '#f2ead2', note: 'fast; x3 from behind; flies true',
    look: {kind: 'blade', blade: .26, w: .045, tip: .08, clip: true, guard: .07, grip: .11, pommel: .022, steel: ['#f4f6f8', '#ccd4dc', '#949ca6', '#3a3e44'], hilt: ['#c89a62', '#9e7442', '#6e4e2a', '#2e2010']}},
  flame: {name: 'Flame Sword', cls: 'blade', hands: 1, len: .98, dmg: 8, type: 'slash', extra: {fire: 6}, reach: 1.5, arc: 135, cleave: 3, speed: .95,
    combo: ['slash_r', 'rise', 'overhead'], heavy: 'spin', throw: {v: 17, spin: 14, dmg: 1.6, stick: true}, guard: {block: .5, parry: .16},
    smash: 1.2, slots: ['rune', 'grip'], light: '#ff8a3a', trail: '#ffb040', note: 'sets them alight',
    look: {kind: 'blade', blade: .84, w: .055, tip: .16, wavy: true, guard: .22, grip: .14, pommel: .035, steel: ['#fff4c0', '#ffc060', '#e0602a', '#5a1a10'], hilt: ['#5a4a48', '#3a302e', '#241c1a', '#100c0c'], flame: true}},
  saber: {name: 'Light Saber', cls: 'blade', hands: 1, len: 1.08, dmg: 8, type: 'slash', extra: {fire: 4}, reach: 1.6, arc: 140, cleave: 4, speed: 1.15,
    combo: ['slash_r', 'rise', 'slash_r', 'spin'], heavy: 'spin', throw: {v: 16, spin: 20, dmg: 1.8, back: true}, guard: {block: .7, parry: .22, deflect: true},
    pierceGuard: true, smash: 1.1, slots: ['crystal', 'grip'], light: '#7ab8ff', trail: '#bfe0ff', note: 'cuts through guards, sends bullets back, comes back when thrown',
    look: {kind: 'saber', blade: .95, w: .03, grip: .24, pommel: .02, steel: ['#ffffff', '#e8f4ff', '#9ac8ff', '#3a6ab8'], hilt: ['#e0e4ea', '#9aa0aa', '#5a5e68', '#202228']},
    colors: ['#7ab8ff', '#7aff8a', '#ff5a5a', '#c87aff', '#ffd27a']},
  cleaver: {name: 'Troll Cleaver', cls: 'heavy', hands: 2, len: 1.3, dmg: 18, type: 'slash', reach: 2, arc: 160, cleave: 6, speed: .68, knock: 1.4,
    combo: ['cleave', 'spin', 'cleave'], heavy: 'spin', throw: {v: 11, spin: 9, dmg: 1.8, stick: true, pierce: 3}, guard: {block: .65, parry: .12},
    smash: 1.6, slots: ['rune', 'edge', 'grip', 'weight'], trail: '#dce4ec', note: 'two hands, everything in front goes',
    look: {kind: 'blade', blade: 1.08, w: .14, tip: .1, chop: true, guard: .26, grip: .26, pommel: .045, steel: ['#e4e8ec', '#a8b0b8', '#6a727c', '#2a2e34'], hilt: ['#8a6a44', '#6e4a2e', '#4a3020', '#1c120a']}},
  maul: {name: 'War Maul', cls: 'blunt', hands: 2, len: 1.15, dmg: 15, type: 'blunt', reach: 1.75, arc: 120, cleave: 4, speed: .72, knock: 1.3,
    combo: ['cleave', 'rise', 'cleave'], heavy: 'cleave', throw: {v: 10, spin: 8, dmg: 2, stick: false}, guard: {block: .6, parry: .12},
    smash: 1.8, slots: ['rune', 'head', 'grip'], trail: '#c8ccd4', note: 'stuns; the air smash quakes the ground',
    look: {kind: 'hammer', haft: 1.0, head: .26, headW: .16, steel: ['#c8ccd4', '#8a8e98', '#5a5e68', '#34363c'], hilt: ['#a07a4e', '#7a5634', '#52381e', '#22160a']}},
  pike: {name: 'Frozen Pike', cls: 'blunt', hands: 1, len: .82, dmg: 4, type: 'blunt', extra: {frost: 5}, reach: 1.45, arc: 120, cleave: 2, speed: 1.1,
    combo: ['slash_r', 'slash_r', 'overhead'], heavy: 'spin', throw: {v: 15, spin: 12, dmg: 1.5, bounce: 2}, guard: {block: .3, parry: .16},
    smash: 1, slots: ['bait'], trail: '#d8f8ff', note: 'a fish, frozen solid. It chills them',
    look: {kind: 'fish', blade: .7, w: .13, steel: ['#e8fcff', '#a8d8e8', '#5a8aa8', '#1e3a52'], hilt: ['#d8f0f8', '#88b8c8', '#4a7890', '#1a3040']}},
  wobbler: {name: 'The Wobbler', cls: 'silly', hands: 1, len: .62, dmg: 1, type: 'blunt', reach: 1.35, arc: 120, cleave: 3, speed: 1.2, knock: 4, lift: 5,
    combo: ['slash_r', 'slash_r', 'overhead'], heavy: 'spin', throw: {v: 16, spin: 10, dmg: 1, bounce: 5}, guard: {block: .4, parry: .2},
    smash: 1.4, slots: ['batteries'], trail: '#ff9ad8', note: 'does no damage at all. Sends them to the moon',
    look: {kind: 'wobbler', blade: .5, w: .07, steel: ['#ffd8f0', '#ff9ad8', '#d85aa8', '#6a1e4a'], hilt: ['#ffd8f0', '#ff9ad8', '#d85aa8', '#6a1e4a']}},
  rift: {name: 'Rift Blade', cls: 'blade', hands: 1, len: .96, dmg: 7, type: 'slash', extra: {void: 6}, reach: 1.55, arc: 140, cleave: 3, speed: 1.05,
    combo: ['slash_r', 'rise', 'overhead'], heavy: 'cleave', throw: {v: 20, spin: 18, dmg: 1.6, stick: true, blink: true}, guard: {block: .5, parry: .2},
    smash: 1.3, slots: ['rune', 'edge'], light: '#b07aff', trail: '#d8a8ff', note: 'cut them loose from the ground. Throw it and press R: you go where it is',
    look: {kind: 'blade', blade: .82, w: .06, tip: .2, wavy: true, guard: .18, grip: .14, pommel: .04, steel: ['#f8e8ff', '#d8a8ff', '#9a60e0', '#2a1a4a'], hilt: ['#3a2a4a', '#2a1e36', '#1a1224', '#0a0610'], ghost: true}},
};
export const WEAPON_IDS = Object.keys(WEAPONS);
// THE SHIELDS (on the left forearm). block: the share of a frontal blow it stops; parry: s after raising it a blow is parried;
// cone: deg of cover in front; speed: x his pace while it's up; bash: the bash's damage (blunt) and knock (m/s); bullets: true -> a
// bullet that meets it is stopped whatever the share (a share < 1 still lets the rest through on a melee blow); hide: big enough
// to crouch behind (C while it's up: full cover in front, but you can't move); look: view/heldweapon.js
export const SHIELDS = {
  none: null,
  buckler: {name: 'Buckler', block: .45, parry: .26, cone: 80, speed: .92, bash: 3, knock: 4, bullets: false,
    look: {kind: 'round', r: .17, rim: .02, boss: .05, face: ['#c8ccd4', '#8a8e98', '#5a5e68', '#34363c'], trim: ['#f2d27a', '#c89a3a', '#8a6420', '#3a2a0c']}},
  round: {name: 'Round Shield', block: .8, parry: .2, cone: 110, speed: .78, bash: 6, knock: 7, bullets: true,
    look: {kind: 'round', r: .3, rim: .03, boss: .06, face: ['#c89a62', '#9e7442', '#6e4e2a', '#2e2010'], trim: ['#c8ccd4', '#8a8e98', '#5a5e68', '#34363c'], planks: true}},
  tower: {name: 'Tower Shield', block: 1, parry: .12, cone: 150, speed: .45, bash: 9, knock: 9, bullets: true, hide: true,
    look: {kind: 'tower', w: .5, h: 1.05, face: ['#a83a2e', '#7e2a22', '#56201a', '#24100c'], trim: ['#c8ccd4', '#8a8e98', '#5a5e68', '#34363c']}},
  door: {name: 'Barn Door', block: 1, parry: .1, cone: 170, speed: .38, bash: 12, knock: 16, bullets: true, hide: true, silly: true,
    look: {kind: 'door', w: .78, h: 1.6, face: ['#c8a070', '#9e7442', '#6e4e2a', '#2e2010'], trim: ['#5a5e68', '#3a3e48', '#24262c', '#101114']}},
};
export const SHIELD_IDS = Object.keys(SHIELDS);
// THE FEEL. input: s a press is held before it charges the heavy (heavyAt), s to full charge (full), s a press waits in the queue
// (buffer). jump (Space with a weapon out, where there's nothing to leap or vault): up vz m/s, gravity g, the run's speed kept
// (keep), steering in the air (air m/s^2). smash (LMB in the air): the dive's speed (dive m/s down, fwd m/s on), the ring's radius
// r (x the weapon's smash), dmg (x the weapon's), lift m/s, stun s, land s planted after; a fall from higher hits harder (perM:
// +share a metre over minH). parry: the slow-down (the 'sim.speed' note k for s), the riposte window (s) and its damage (mul);
// block: the push back (m/s) and the guard's speed; throw: range (m before it drops), drop (m/s^2 down as it flies), back (the
// recall's speed), pick (m: walked over, it's his again), lodge (s a stuck blade stays in a body before it drops); dash: Shift +
// LMB on the run; ready: s the stance stays up after a move; assist: the swing's pull toward a foe (m, deg); hitstop (s at power 0
// and 1), shake (px), trail (s a swing's streak lasts)
export const TUNE = {
  input: {heavyAt: .2, full: .6, buffer: .35},
  jump: {vz: 5.6, g: 17, keep: .95, air: 6, cool: .15},
  smash: {dive: 15, fwd: 2.5, r: 2.4, dmg: 1.5, lift: 4.2, stun: .8, land: .36, minH: .5, perM: .35},
  parry: {slowK: .25, slowT: .12, riposte: 1.4, mul: 2.5},
  block: {push: 2.2, walk: 1.25},
  throw: {range: 16, drop: 2.5, back: 26, pick: .9, lodge: 6, h: 1.2},
  dash: {speed: 3.5},
  ready: 1.6,
  assist: {range: 2.6, cone: 55},
  hitstop: [.035, .1], shake: [1, 4], trail: .14,
};
