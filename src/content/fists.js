// FISTS: unarmed fighting for the live cowboys (docs/exp/fists.md). Data only: seconds, metres, m/s, damage at stage 1 with
// no items. The player's side is sim/player/fists.js (when, which way, his frames), what a blow does is features/fists.js,
// the gunmen who box back are features/foes/brawler.js. Its own moveset and state family: armed melee (later) gets its own
// file and slot, and shares only the impact feedback.
//
// CONTROLS (a live loadout; 2 raises the fists, 1 the gun again):
//   LMB / RMB   the left / right hand. Press = the fist cocks back (the wind), release = it goes (a quick punch);
//               held past input.heavyAt = a HEAVY with that hand (left: the body blow, right: the haymaker), charging till
//               released (or input.autoFire)
//   both        L and R pressed within input.both s = the HEADBUTT
//   V           in a string (after a punch, inside its chain window): the roundhouse finisher; else the push kick (brawl's)
//   E           at a foe in reach: the CLINCH (L / R short punches, V knee, both headbutt, E hip toss at the cursor, Space shove)
//   Space       the SLIP (a bob / weave the way you hold, else back): i-frames; a slip that beats a punch opens a counter
//   standing in the stance (not punching) = the passive guard: a frontal punch is blocked (a share of its damage goes through)
//   no fight on (TUNE.rest): the guard goes down and he walks as ever; it comes up by itself when one starts
export const TUNE = {
  // the stance: moving with the fists up (m/s: toward where he faces / backing off / sideways), its acceleration (m/s^2); he
  // faces the soft-lock target or the cursor, turning at `turn` deg/s; Shift (a sprint) drops the guard and runs
  stance: {fwd: 2.9, back: 2.2, side: 2.5, acc: 24, turn: 1080},
  // at rest: with the fists selected and no fight on he stands and walks as ever (the guard down, Space his own). The guard
  // comes up on a hand pressed, the switch (2), a blow taken, or a living foe within `near` m (features/fists.js), and goes
  // down again after `calm` s of none
  rest: {near: 4.5, calm: 3},
  // input: held past heavyAt s = a heavy; L and R within `both` s = the headbutt; a press waits `buffer` s for the move's chain
  // window; a heavy goes by itself after autoFire s held; while winding / charging he drifts at `drift` x the stance speed
  input: {heavyAt: .2, both: .09, buffer: .32, autoFire: 1.6, drift: .35},
  // the soft lock: the foe nearest the cursor's way within `cone` deg and `range` m is squared up to; a punch steps in so its
  // contact lands at the move's `dist` (at most `maxStep` m of travel, at most `maxV` m/s); with nothing there it drifts `idle`
  // m along
  lock: {range: 2.8, cone: 55, maxStep: 1.15, maxV: 6.5, idle: .12},
  // the string: it stays open `grace` s after a move ends (then the next punch starts it again); `daze` hits on one body
  // within dazeT s (unanswered) daze it
  chain: {grace: .16, daze: 4, dazeT: 1.6},
  // the slip (Space in the stance): `dur` s, untouchable from i0 to i1, `dist` m the way he holds (sideways or back; nothing:
  // back); a foe's punch that meets him untouchable opens the counter window (`counter` s): the next punch is a counter
  slip: {dur: .32, i0: .02, i1: .24, dist: .8, counter: .75, cool: .08},
  // the passive guard (standing in the stance, no move out): a punch from within `cone` deg of his facing is blocked: `jab` /
  // `share` of its damage goes through (a heavy breaks it: full, and he's knocked back); a block pushes him `push` m/s back and
  // shows the block for `show` s
  guard: {cone: 70, jab: .1, share: .3, push: 1.4, show: .22},
  // a counter (a punch while the counter window is open): x `mul` damage, its hitstop + `hs`, a slow-down to `slowK` of the
  // sim's speed for `slow` s of sim time; a knockout: the same for `koSlow` s at koSlowK
  counter: {mul: 1.8, hs: .04, slowK: .35, slow: .08},
  ko: {slowK: .3, slow: .1, hs: .06},
  // hit while winding / charging: the move is cut, he can't act for `stun` s (a haymaker throws him: the knock)
  hurt: {stun: .2, knock: 4.5},
  // the clinch (E at a foe within `reach` m in front, `arc` deg): held `d` m in front of him for at most `hold` s (a dazed one
  // `holdDazed`) before he breaks free; walking with him at `walk` x the stance speed; the toss throws him `out` m/s along
  // the cursor's way and `up` m/s up (sim/bodyfly.js: walls, ledges, water), the shove `shove` m/s
  clinch: {reach: .95, arc: 80, d: .6, hold: 2.6, holdDazed: 4.5, walk: .45, out: 7.2, up: 3.2, shove: 3.6, cool: .5},
};

// THE MOVES. Every time is seconds from the move's THROW (the release; the wind before it is the press, held at least
// `wind` s). hit: the contact (the blow lands then: player.punch); dur: the move's end; chain: from then a press goes into the
// next move (its recovery is cut). dist: the distance (m, his middle to the target's, a man's: r .3) the contact is posed at
// (the punch steps in to it: TUNE.lock), reach: the farthest it still lands at (m, middle to middle, + the target's r over .3),
// arc (deg), dmg, hs (hitstop s), kick
// (the camera's px), push (m/s the body is moved), at (head | body: the contact's height), react (what it does to a body:
// REACT below), fin (a finisher: the string ends), guard (it breaks a guard). A heavy charges from input.heavyAt to `full`
// s of holding: its dmg / hs / push grow by `k` (0..1) to dmg + dmgK, hs + hsK.
// clip: the live clip (western.py FISTS_LIVE; the view times it by these: its `hit` mark shown at `hit`, its end at `dur`)
export const MOVES = {
  jab:     {hand: 'L', clip: 'fs_jab',     wind: .05, hit: .06, dur: .24, chain: .1,  dist: 0.85, reach: 1.15,  arc: 70,  dmg: 4,  hs: .035, kick: 1, push: .8,  at: 'head', react: 'jab'},
  jab2:    {hand: 'L', clip: 'fs_jab2',    wind: .04, hit: .05, dur: .22, chain: .09, dist: 0.85, reach: 1.15,  arc: 70,  dmg: 4,  hs: .035, kick: 1, push: .8,  at: 'head', react: 'jab'},
  cross:   {hand: 'R', clip: 'fs_cross',   wind: .07, hit: .08, dur: .32, chain: .14, dist: 0.88, reach: 1.2,  arc: 70,  dmg: 7,  hs: .05,  kick: 2, push: 1.6, at: 'head', react: 'cross'},
  hook_l:  {hand: 'L', clip: 'fs_hook_l',  wind: .08, hit: .09, dur: .36, chain: .16, dist: 0.74, reach: 1.02, arc: 120, dmg: 9,  hs: .06,  kick: 2, push: 1.2, at: 'head', react: 'hook_l'},
  hook_r:  {hand: 'R', clip: 'fs_hook_r',  wind: .08, hit: .09, dur: .36, chain: .16, dist: 0.74, reach: 1.02, arc: 120, dmg: 9,  hs: .06,  kick: 2, push: 1.2, at: 'head', react: 'hook_r'},
  upper_r: {hand: 'R', clip: 'fs_upper_r', wind: .09, hit: .1,  dur: .48, chain: .3,  dist: 0.7, reach: 0.98,  arc: 80,  dmg: 12, hs: .09,  kick: 3, push: 2,   at: 'head', react: 'upper', fin: true},
  upper_l: {hand: 'L', clip: 'fs_upper_l', wind: .09, hit: .1,  dur: .48, chain: .3,  dist: 0.7, reach: 0.98,  arc: 80,  dmg: 12, hs: .09,  kick: 3, push: 2,   at: 'head', react: 'upper', fin: true},
  // the heavies (held past input.heavyAt): the left to the body (doubles him over, breaks a guard), the right haymaker (floors)
  body:    {hand: 'L', clip: 'fs_body',    heavy: true, full: .55, hit: .09, dur: .42, chain: .18, dist: 0.78, reach: 1.05, arc: 90, dmg: 10, dmgK: 5,  hs: .07, hsK: .02, kick: 2, push: 1.4, pushK: .8, at: 'body', react: 'gut', guard: true},
  hay:     {hand: 'R', clip: 'fs_hay',     heavy: true, full: .75, hit: .13, dur: .56, chain: .34, dist: 0.9, reach: 1.25, arc: 100, dmg: 14, dmgK: 10, hs: .1, hsK: .03, kick: 4, push: 2.4, pushK: 1.6, at: 'head', react: 'knock', guard: true, fin: true},
  // both hands: the headbutt (short, dazes); V in a string: the roundhouse (floors)
  head:    {hand: 'B', clip: 'fs_head',    wind: .06, hit: .1,  dur: .42, chain: .24, dist: 0.56, reach: 0.82, arc: 70,  dmg: 7,  hs: .08,  kick: 2, push: 1,   at: 'head', react: 'daze', guard: true},
  round:   {hand: 'V', clip: 'fs_round',   wind: .04, hit: .17, dur: .5,  chain: .36, dist: 1, reach: 1.4, arc: 110, dmg: 11, hs: .09,  kick: 3, push: 2.4, at: 'body', react: 'knock', guard: true, fin: true},
  // the clinch: the grab (its hands close at `hit`: what's in reach is held), then (held) short punches, the knee, the
  // headbutt, the hip toss (he leaves the hands at `hit`), the shove
  grab:    {hand: 'E', clip: 'fs_grab',    wind: .02, hit: .12, dur: .34, miss: .44, dist: 0.62, reach: 1, arc: 80},
  cl_l:    {hand: 'L', clip: 'fs_cl_l',    wind: .02, hit: .07, dur: .26, chain: .14, dmg: 4,  hs: .04,  kick: 1, push: 0, at: 'head', react: 'jab'},
  cl_r:    {hand: 'R', clip: 'fs_cl_r',    wind: .02, hit: .07, dur: .26, chain: .14, dmg: 4,  hs: .04,  kick: 1, push: 0, at: 'head', react: 'cross'},
  knee:    {hand: 'V', clip: 'fs_knee',    wind: .02, hit: .12, dur: .36, chain: .22, dmg: 8,  hs: .07,  kick: 2, push: 0, at: 'body', react: 'gut'},
  cl_head: {hand: 'B', clip: 'fs_cl_head', wind: .03, hit: .11, dur: .42, chain: .26, dmg: 8,  hs: .08,  kick: 2, push: 0, at: 'head', react: 'daze'},
  toss:    {hand: 'E', clip: 'fs_toss',    wind: .02, hit: .26, dur: .55, dmg: 0,  hs: .05,  kick: 2},
  shove:   {hand: 'S', clip: 'fs_shove',   wind: .02, hit: .1,  dur: .32, dmg: 0,  hs: .03,  kick: 1},
};
// THE STRING: the punch a hand throws after the one before (alternate hands: jab, cross, hook, uppercut; the same hand twice:
// the double jab, the right hook after a cross). '' = the first. The heavies, the headbutt and the kick come from their inputs
export const STRING = {
  '':      {L: 'jab',     R: 'cross'},
  jab:     {L: 'jab2',    R: 'cross'},
  jab2:    {L: 'jab',     R: 'cross'},
  cross:   {L: 'hook_l',  R: 'hook_r'},
  hook_l:  {L: 'jab',     R: 'upper_r'},
  hook_r:  {L: 'upper_l', R: 'cross'},
  body:    {L: 'hook_l',  R: 'cross'},
  head:    {L: 'hook_l',  R: 'hook_r'},
};
export const HEAVY = {L: 'body', R: 'hay'};
export const CLINCH = {L: 'cl_l', R: 'cl_r', V: 'knee', B: 'cl_head', E: 'toss', S: 'shove'};

// WHAT A BLOW DOES TO A BODY: stun (s he can't act: the reaction plays), the reaction's clip on a gunman (features/foes/brawler.js:
// fx_*), down: thrown off his feet (out m/s along the blow, up m/s: sim/bodyfly.js); hat: the chance his hat flies off. A
// brute (combat's) is held `stun` s (core.hold) and thrown by `down` (core.launch); a champion only holds
export const REACT = {
  jab:    {stun: .22, clip: 'fx_hit_jab', hat: 0},
  cross:  {stun: .3,  clip: 'fx_hit_jab', hat: .1},
  hook_l: {stun: .34, clip: 'fx_hit_l',   hat: .2},   // (a left hook lands on his right cheek: his head goes to his left)
  hook_r: {stun: .34, clip: 'fx_hit_r',   hat: .2},
  gut:    {stun: .55, clip: 'fx_hit_gut', hat: 0},
  daze:   {stun: 1.3, clip: 'fx_daze',    hat: .15},
  upper:  {stun: .4,  clip: 'fx_hit_jab', hat: .85, down: {out: 2.6, up: 4.4}},
  knock:  {stun: .4,  clip: 'fx_hit_jab', hat: .6,  down: {out: 5.2, up: 2.8}},
};

// THE GUNMEN WHO BOX BACK (features/foes/brawler.js: the unarmed ones, ?foes=unarmed). ring: the distance they square up at
// (m; the one with the turn to attack comes in to `close`, the others wait out at `wait`); circle: m/s round you, their turn
// changes every `turn` s; the attacks: jab (a quick one) and hay (the big telegraphed one: its wind-up shows a glint):
// wind (s, the telegraph), hit (s after it), dur, reach (m), dmg, and the knock it gives you (m/s; 0 none); `gap`: s between
// one gunman's attacks; `guard`: the chance he raises his guard when you wind up within 2 m in front of him (held `guardT`
// s); per type: speed x, guard chance, the mix of haymakers, damage x, and how heavy he is to throw (BRAWL heft)
export const FOE = {
  ring: 1.55, close: 1.05, wait: 2.6, circle: 1.5, turn: [1.1, 2.4], gap: [.7, 1.6], guardT: [.5, 1.1], first: [.6, 1.2],
  jab: {wind: .3,  hit: .07, dur: .42, reach: 1.1,  dmg: 5,  knock: 0, step: 1.6},
  hay: {wind: .62, hit: .12, dur: .68, reach: 1.25, dmg: 12, knock: 4.2, step: 2.4},
  types: {
    bandit:  {speed: 1.1,  guard: .25, hay: .25, dmg: 1,    gap: 1},
    sheriff: {speed: 1,    guard: .55, hay: .3,  dmg: 1.15, gap: .8},
    bruiser: {speed: .85,  guard: .4,  hay: .5,  dmg: 1.35, gap: 1.2},
  },
};
