// EVENTS: what every game sound is made of (data only). audio/runtime/CONTRACT.md, docs/AUDIO.md §3.
// Keyed by the names concepts/sprites/arena/audio.js already fires (its SFX object and its event switch), plus a few
// extra names for the continuous voices (bow draw, rolling barrel), the abilities, and the UI.
//
// An entry:
//   bus, priority (0..100), maxInstances, steal ('quietest' | 'oldest' | 'none'), coalesceMs, gainDb, send (reverb)
//   pitchSemi / gainJitDb   runtime jitter (±) on top of the baked variants
//   cooldownMs              the director drops a repeat inside this window (the old synth's per-sound `cd`)
//   pick(o, rnd) -> {recipe, case, gainDb?, delayMs?, semi?} | [layers]   (rnd = the director's random 0..1)
//   gainFrom(o) -> extra dB from the caller's params (o.g, o.k, o.n ...)
//   banks: [[recipe, case, bakePriority?], ...]  every bank pick() can return (the director prefetches these; the test
//                           checks it); a third element overrides the event's bakePriority for a rare layer
//   variants, bakePriority  what the bakery bakes and how early (lower = sooner)
//   snapshot                {name, buses, attack, hold, release}: an engine snapshot fired with the event
//   cat                     'player' | 'combat' | 'world' | 'ui' (or a function of the params): the SCREEN-BOUND rule
//                           (SPATIAL below) the director applies from the caller's `off` (metres beyond the view edge)
//   a layer may carry `alt`: a layer (or layers) played instead while its own bank isn't available, e.g. a new recipe
//   that isn't written or baked yet (see PENDING)
//
// LEVELS. The forge normalises every variant to -20 LUFS momentary max (footstep: -25), so gainDb is the mix:
//   combat hits about -3, footsteps 12-14 dB under them (gainDb -10 on the -25 bake, and the caller's g),
//   (measured on the bakes: hits -24..-25 LUFS, steps -35, explosions -17..-19, beds -42..-47, the stream -34 at the bank)
//   movement cloth -10..-12, wildlife -10..-14, UI -10..-16 (dry), explosions on top (+2..+3, with a duck).
//
// SURFACES (the arena passes the BIOME as o.surf; 'stone' means an arrow into a wall):
//   ruins -> stone / grass in 4 m patches (stable under the feet), ember -> gravel, frost -> snow, rift -> crystal.

const db = g => 20 * Math.log10(Math.max(1e-4, g));
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const L = (recipe, c, o) => ({recipe, case: c, ...o});

// a stable 0..1 hash per 4 m cell: ruins ground is flagstones with grass patches, the same patch under the same spot
function cellHash(x, y) {
  let h = (Math.floor(x / 4) * 73856093) ^ (Math.floor(y / 4) * 19349663);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
// the footstep case for a biome (or an explicit o.ground)
export function groundCase(o = {}, rnd = Math.random) {
  if (o.ground) return o.ground;
  switch (o.surf) {
    case 'ember': return 'gravel';
    case 'frost': return 'snow';
    case 'rift': return 'crystal';
    case 'stone': return 'stone';
    default: return (Number.isFinite(o.x) && Number.isFinite(o.y) ? cellHash(o.x, o.y) : rnd()) < .45 ? 'grass' : 'stone';
  }
}
const STEP_CASES = ['stone', 'grass', 'gravel', 'snow', 'crystal'];

// ----- shared defaults per family -----
const FOOT = {cat: 'player', bus: 'sfx.foot', priority: 25, maxInstances: 3, steal: 'oldest', coalesceMs: 0, send: .08, pitchSemi: .6, gainJitDb: 1.5};
const PLAYER = {cat: 'player', bus: 'sfx.player', priority: 45, maxInstances: 2, steal: 'oldest', coalesceMs: 0, send: .1, pitchSemi: .8, gainJitDb: 1.5};
const IMPACT = {cat: 'combat', bus: 'sfx.impacts', priority: 60, maxInstances: 6, steal: 'quietest', coalesceMs: 40, send: .15, pitchSemi: 1.2, gainJitDb: 2};
const WORLD = {cat: 'world', bus: 'sfx.world', priority: 50, maxInstances: 4, steal: 'quietest', coalesceMs: 0, send: .18, pitchSemi: 1, gainJitDb: 1.5};
const WILD = {cat: 'world', bus: 'sfx.world', priority: 15, maxInstances: 3, steal: 'oldest', coalesceMs: 0, send: .3, pitchSemi: 1, gainJitDb: 2, variants: 4, bakePriority: 6};
const UI = {cat: 'ui', bus: 'ui', priority: 95, maxInstances: 2, steal: 'oldest', coalesceMs: 0, send: 0, pitchSemi: 0, gainJitDb: 0, variants: 2, bakePriority: 5};
// the desert's gunmen: placed where they stand, combat's spatial rule (off screen a shot fades slowly: you hear it coming)
const COACH_MARK = {break: 'break', dump: 'eject', load: 'load', close: 'close'};   // coachReload's o.mark -> the coachgun case
const BULLET_DB = {sand: 0, stone: -1, wood: 0, metal: -1};   // bulletHit: the bullet recipe's case per o.mat, and its trim
const FOE = {cat: 'combat', bus: 'sfx.world', priority: 50, maxInstances: 3, steal: 'quietest', coalesceMs: 0, send: .15, pitchSemi: .8, gainJitDb: 1.5};
// GUN SOUNDS: the western-movie flavors (the user, on the v2 guns: "make them sound more 'western movie'"): every gun
// event plays the forge cases '<flavor>_<case>' (recipes revolver.js v4, coachgun.js v3, bullet.js v3; their headers say
// what each flavor is). Two flavors (the user dropped spaghetti, "by far worst", and keeps both of these for now): the
// caller passes o.gunsfx (src/audio/audio.js: ?gunsfx= / menu > Audio > Gun sounds, remembered); anything else (an old
// saved 'spaghetti', an unknown name) plays GUN_SFX_DEF. Per flavor:
//   trims (dB)  each shot's transient (its first 50 ms, K-weighted) ~2 dB over the v2 / v1 shot's: larger than life (the
//               forge normalises the loudest 400 ms, and a wet shot's echoes take a share of it); peaks stay under the
//               master limiter's -3 dBFS
//   send        the reverb send: the place is baked into the buffers, the biome's reverb only adds air
//   rico        how often a bullet ricochets off stone / metal, ricoSand off sand ([the player's, a gunman's]); ricoDb its
//               level against the hit (hollywood: the stock ricochet now and then; gritty: rarely and under)
// The reloads keep their one sound (the v2 / v1 cases). GUN_SFX_DEF: hollywood, the classic western-movie sound.
export const GUN_SFX = ['hollywood', 'gritty'], GUN_SFX_DEF = 'hollywood';
const GSX = {
  hollywood: {peacemaker: 4.5, navy: 4.5, fire: 4, cock: 0, send: .06, rico: [.3, .18], ricoSand: [.05, .03], ricoDb: -2},
  gritty: {peacemaker: 5.5, navy: 6, fire: 3, cock: 0, send: .08, rico: [.1, .05], ricoSand: [0, 0], ricoDb: -5},
};
const gsx = o => (GSX[o?.gunsfx] ? o.gunsfx : GUN_SFX_DEF);
// a flavored layer: the case for o's flavor, with its trim and send
const GL = (recipe, c, o, extra = {}) => { const s = gsx(o), F = GSX[s]; return L(recipe, `${s}_${c}`, {send: F.send, ...extra, gainDb: (F[c] || 0) + (extra.gainDb || 0)}); };
const gunBanks = (recipe, cases, bp) => GUN_SFX.flatMap(s => cases.map(c => (bp == null ? [recipe, `${s}_${c}`] : [recipe, `${s}_${c}`, bp])));
// the director's prefetch skips the other flavors' banks (they bake when picked: src/audio/audio.js prefetches again)
export const otherGunSfx = style => (recipe, c) => { const m = /^(hollywood|gritty)_/.exec(c); return !!m && m[1] !== style; };

export const EVENTS = {
  // ================================================ player movement ================================================
  step: {   // o.surf (biome), o.k weight (walk .25 .. sprint 1, plant 1.3), o.g (.55..1), o.ground / o.water optional
    ...FOOT, gainDb: -10, cooldownMs: 60,
    pick: (o, rnd) => {
      if (o.water) return L('splash', 'step', {gainDb: 2});   // a foot in the shallow stream
      const c = groundCase(o, rnd), k = o.k ?? .6;
      return L('footstep', c === 'stone' && k >= .85 ? 'run_stone' : c);
    },
    gainFrom: o => db(o.g ?? 1) + ((o.k ?? .6) - .6) * 3,   // sprint and plant a little louder
    banks: [...STEP_CASES.map(c => ['footstep', c]), ['footstep', 'run_stone'], ['splash', 'step', 4]],
    variants: 8, bakePriority: 1,
  },
  land: {   // o.big 0 a leap landing / 1 a big drop
    ...FOOT, priority: 45, maxInstances: 2, gainDb: -7, cooldownMs: 100,
    pick: (o, rnd) => {
      const c = groundCase(o, rnd), out = [L('footstep', 'land_stone')];
      if (c !== 'stone') out.push(L('footstep', c, {gainDb: -3, delayMs: 15}));   // the ground's own texture on top
      if (o.big) out.push(L('impact', 'thud', {gainDb: -8}), L('cloth', 'jump', {gainDb: -8}));
      return out;
    },
    gainFrom: o => (o.big ? 2 : 0),
    banks: [['footstep', 'land_stone'], ...STEP_CASES.filter(c => c !== 'stone').map(c => ['footstep', c]), ['impact', 'thud', 3], ['cloth', 'jump']],
    variants: 8, bakePriority: 2,
  },
  jump: {
    ...PLAYER, gainDb: -12, cooldownMs: 100,
    pick: (o, rnd) => {
      const c = groundCase(o, rnd), out = [L('cloth', 'jump')];
      if (c === 'gravel' || c === 'snow') out.push(L('footstep', c, {gainDb: 2}));   // a grainy push-off on loose ground
      return out;
    },
    banks: [['cloth', 'jump'], ['footstep', 'gravel'], ['footstep', 'snow']],
    variants: 6, bakePriority: 2,
  },
  roll: {
    ...PLAYER, gainDb: -10, cooldownMs: 150,
    pick: () => L('cloth', 'roll'),
    banks: [['cloth', 'roll']], variants: 6, bakePriority: 2,
  },
  climb: {   // one hand-hold / scrape every ~0.3 s; o.big = mantling over the lip
    ...PLAYER, priority: 35, gainDb: -11, cooldownMs: 120,
    pick: (o, rnd) => o.big ? L('climb', 'mantle', {gainDb: 2}) : L('climb', rnd() < .6 ? 'grab' : 'scrape'),
    banks: [['climb', 'grab'], ['climb', 'scrape'], ['climb', 'mantle']], variants: 6, bakePriority: 3,
  },

  // ================================================ the bow ================================================
  shot: {   // o.kind 'arrow' | 'multi' | 'pierce' | 'boom', o.k draw strength 0..1
    ...PLAYER, priority: 80, maxInstances: 3, coalesceMs: 25, gainDb: -2, send: .12, pitchSemi: .7, cooldownMs: 30,
    pick: o => {
      switch (o.kind) {
        case 'multi': return [L('bow_release', 'multi'), L('magic', 'multishot', {gainDb: -6, delayMs: 8})];
        case 'pierce': return [L('bow_release', 'heavy', {gainDb: 1}), L('arrow_fly', 'flyby', {gainDb: -12, delayMs: 10})];
        case 'boom': return [L('bow_release', 'basic'), L('explosion', 'fuse', {gainDb: -12, delayMs: 30})];
        default: return L('bow_release', 'basic');
      }
    },
    gainFrom: o => ((o.k ?? .7) - .7) * 4,   // a weak draw is a little softer
    banks: [['bow_release', 'basic'], ['bow_release', 'multi', 2], ['bow_release', 'heavy', 2], ['magic', 'multishot', 3], ['arrow_fly', 'flyby', 3], ['explosion', 'fuse', 3]],
    variants: 6, bakePriority: 1,
  },
  volley: {   // the arrow-rain cast: a fan of shafts going up
    ...PLAYER, priority: 78, gainDb: -4, send: .2, cooldownMs: 200,
    pick: () => [L('magic', 'rain_cast'), L('arrow_fly', 'volley', {gainDb: -6, delayMs: 60})],
    banks: [['magic', 'rain_cast'], ['arrow_fly', 'volley']], variants: 4, bakePriority: 3,
  },
  whistle: {   // one rain arrow coming down (14 of them inside ~0.5 s): coalesced, few voices
    ...IMPACT, bus: 'sfx.world', priority: 35, maxInstances: 4, steal: 'oldest', coalesceMs: 45, gainDb: -12, pitchSemi: 2, gainJitDb: 3, send: .2,
    pick: () => L('arrow_fly', 'whistle'),
    banks: [['arrow_fly', 'whistle']], variants: 6, bakePriority: 3,
  },
  // the draw creak, driven by director.makeCreak() from the draw amount (not posted by audio.js directly)
  draw_pull: {...PLAYER, priority: 55, maxInstances: 1, gainDb: -9, pitchSemi: .5, pick: () => L('bow_draw', 'draw'), banks: [['bow_draw', 'draw']], variants: 6, bakePriority: 2},
  draw_hold: {...PLAYER, priority: 40, maxInstances: 2, gainDb: -13, pitchSemi: .5, pick: () => L('bow_draw', 'hold'), banks: [['bow_draw', 'hold']], variants: 6, bakePriority: 2},
  draw_full: {...PLAYER, priority: 60, maxInstances: 1, gainDb: -10, pitchSemi: 0, gainJitDb: .5, pick: () => L('bow_draw', 'full'), banks: [['bow_draw', 'full']], variants: 4, bakePriority: 3},
  nock: {...PLAYER, priority: 40, maxInstances: 1, gainDb: -14, pick: () => L('bow_draw', 'nock'), banks: [['bow_draw', 'nock']], variants: 4, bakePriority: 4},
  creakTick: {...PLAYER, gainDb: -14, pick: () => L('bow_draw', 'hold'), banks: [['bow_draw', 'hold']], variants: 6, bakePriority: 2},   // tests only in audio.js

  // abilities that have no trigger in the arena yet (wire when the game has a charge-up / level-up)
  pierce_charge: {...PLAYER, priority: 70, maxInstances: 1, gainDb: -6, pitchSemi: 0, pick: () => L('magic', 'pierce_charge'), banks: [['magic', 'pierce_charge']], variants: 3, bakePriority: 7},
  levelup: {...UI, cat: 'player', bus: 'sfx.player', priority: 90, gainDb: -6, pick: () => L('magic', 'levelup'), banks: [['magic', 'levelup']], variants: 3, bakePriority: 7},
  fuse: {   // a barrel lit by a chain (combat brands) before it blows
    ...WORLD, priority: 55, maxInstances: 3, gainDb: -10, pick: () => L('explosion', 'fuse'), banks: [['explosion', 'fuse']], variants: 4, bakePriority: 4,
  },

  // ================================================ the revolver (src/sim/player/gun.js; forge recipe 'revolver') ================================================
  gunshot: {   // o.gun 'peacemaker' (a sharp crack) | 'brass_navy' (a deeper boom), o.fan (a fanned shot: a touch softer)
    ...PLAYER, priority: 85, maxInstances: 4, coalesceMs: 0, gainDb: 0, send: .1, pitchSemi: .5, gainJitDb: 1, cooldownMs: 20,
    pick: o => GL('revolver', o.gun === 'brass_navy' ? 'navy' : 'peacemaker', o),
    gainFrom: o => (o.fan ? -1.5 : 0),
    snapshot: {name: 'gunDuck', buses: {amb: -4, music: -2}, attack: .005, hold: .05, release: .4},
    banks: gunBanks('revolver', ['peacemaker', 'navy']), variants: 5, bakePriority: 1,
  },
  gunDry: {...PLAYER, priority: 70, gainDb: -6, cooldownMs: 60, pick: () => L('revolver', 'dry'), banks: [['revolver', 'dry']], variants: 4, bakePriority: 2},
  gunDraw: {...PLAYER, priority: 55, gainDb: -10, cooldownMs: 100, pick: o => GL('revolver', 'cock', o), banks: gunBanks('revolver', ['cock']), variants: 4, bakePriority: 2},
  gunReload: {   // o.phase: start (the hammer to half cock, the gate open) | eject (the cases out) | round (one in) | done (the spin)
    ...PLAYER, priority: 55, maxInstances: 3, gainDb: -9, cooldownMs: 40,
    pick: o => L('revolver', {eject: 'eject', round: 'load', done: 'spin'}[o.phase] || 'cock'),
    gainFrom: o => (o.phase === 'start' ? -4 : 0),
    banks: [['revolver', 'eject'], ['revolver', 'load'], ['revolver', 'spin'], ['revolver', 'cock']], variants: 4, bakePriority: 3,
  },
  gunHolster: {...PLAYER, priority: 45, gainDb: -10, cooldownMs: 150, pick: () => L('revolver', 'holster'), banks: [['revolver', 'holster']], variants: 4, bakePriority: 4},
  // the desert's gunmen with revolvers (src/features/foes: foe.shoot / aim / draw / reload / holster): the same recipe as
  // yours, heard where they stand. o.gun 'peacemaker' (the bandit's, the sheriff's) | 'navy'; foeCock is the hammer thumbed
  // back as a gunman starts to aim: the shot's telegraph in sound. (The bruiser's coach gun has its own: coach* below.)
  foeShot: {
    ...FOE, priority: 80, maxInstances: 4, gainDb: -2, send: .16, cooldownMs: 25, pitchSemi: .6,
    pick: o => GL('revolver', o.gun === 'navy' ? 'navy' : 'peacemaker', o), gainFrom: o => (o.gun === 'navy' ? 1.5 : 0),
    banks: gunBanks('revolver', ['peacemaker', 'navy']), variants: 5, bakePriority: 1,
  },
  foeCock: {...FOE, priority: 62, gainDb: -6, cooldownMs: 60, pick: o => GL('revolver', 'cock', o), banks: gunBanks('revolver', ['cock']), variants: 4, bakePriority: 2},
  foeDraw: {...FOE, priority: 40, gainDb: -12, cooldownMs: 120, pick: () => L('revolver', 'holster'), banks: [['revolver', 'holster']], variants: 4, bakePriority: 4},
  foeReload: {   // o.phase start | eject | round | done (the cylinder's spin)
    ...FOE, priority: 45, maxInstances: 3, gainDb: -10, cooldownMs: 40,
    pick: o => L('revolver', {eject: 'eject', round: 'load', done: 'spin'}[o.phase] || 'cock'),
    gainFrom: o => (o.phase === 'start' ? -4 : 0),
    banks: [['revolver', 'eject'], ['revolver', 'load'], ['revolver', 'spin'], ['revolver', 'cock']], variants: 4, bakePriority: 3,
  },
  foeHolster: {...FOE, priority: 40, gainDb: -12, cooldownMs: 150, pick: () => L('revolver', 'holster'), banks: [['revolver', 'holster']], variants: 4, bakePriority: 4},
  // the bruiser's coach gun (forge recipe 'coachgun'; content/foes.js gun.sound 'coach'), heard where he stands with the
  // other gunmen's rule: its shot (a barrel: 6 variants and the director never repeats the last two, so a pair of shots
  // never matches; 2 dB over the revolvers' peacemaker), the hammer thumbed back as he aims (the telegraph), the reload:
  // the break from the sim (foe.reload start), then the marks as you SEE them (foe.clip from features/foes/look.js: dump =
  // the spent shells fall, load = a shell seated, close = snapped shut). His draw and holster are leather (foeDraw /
  // foeHolster above)
  coachShot: {
    ...FOE, priority: 82, maxInstances: 4, gainDb: 0, send: .18, cooldownMs: 25, pitchSemi: .5,
    pick: o => GL('coachgun', 'fire', o), banks: gunBanks('coachgun', ['fire']), variants: 6, bakePriority: 1,
  },
  coachCock: {...FOE, priority: 62, gainDb: -6, cooldownMs: 60, pick: o => GL('coachgun', 'cock', o), banks: gunBanks('coachgun', ['cock']), variants: 4, bakePriority: 2},
  coachReload: {   // o.mark break | dump | load | close
    ...FOE, priority: 45, maxInstances: 3, gainDb: -9, cooldownMs: 40,
    pick: o => L('coachgun', COACH_MARK[o.mark] || 'load'),
    gainFrom: o => (o.mark === 'close' ? 1.5 : o.mark === 'load' ? -1.5 : 0),   // the lock is the payoff; a shell in, a touch under
    banks: [['coachgun', 'break'], ['coachgun', 'eject'], ['coachgun', 'load'], ['coachgun', 'close']], variants: 4, bakePriority: 3,
  },
  foeFall: {   // a dead gunman hits the ground (foe.ground): a body's thud, the ground's own texture, his clothes
    ...FOE, priority: 55, maxInstances: 3, gainDb: -4, cooldownMs: 60,
    pick: (o, rnd) => [L('impact', 'thud'), L('footstep', groundCase(o, rnd), {gainDb: -4, delayMs: 12}), L('cloth', 'jump', {gainDb: -9, delayMs: 6})],
    gainFrom: o => (o.heavy ? 2 : 0),
    banks: [['impact', 'thud', 3], ...STEP_CASES.map(c => ['footstep', c]), ['cloth', 'jump']], variants: 6, bakePriority: 3,
  },
  // ================================================ bullets (forge recipe 'bullet') ================================================
  // where a bullet ends (bullet.impact: src/audio/audio.js reads its material: the ground's own, a tree, a prop's kind),
  // the hits on a gunman (combat.hit: flesh, a crit heavier), the player's hit-confirm, a bullet through a gunman
  bulletHit: {   // o.mat sand | stone | wood | metal, o.foe (a gunman's: the coach gun's pellets come six at once, a touch under);
    // off stone and metal (and now and then sand) a ricochet's whine, as often as the flavor wants (GSX)
    ...IMPACT, priority: 50, maxInstances: 5, coalesceMs: 30, gainDb: -7, send: .14, pitchSemi: 1.2, gainJitDb: 2,
    pick: (o, rnd) => {
      const m = o.mat in BULLET_DB ? o.mat : 'sand', F = GSX[gsx(o)], out = [GL('bullet', m, o, {gainDb: BULLET_DB[m], send: .1})];
      const pr = m === 'stone' || m === 'metal' ? F.rico : m === 'sand' ? F.ricoSand : null;
      if (pr && rnd() < pr[o.foe ? 1 : 0]) out.push(GL('bullet', 'ricochet', o, {gainDb: F.ricoDb, delayMs: [4, 20], send: .1}));
      return out;
    },
    gainFrom: o => (o.foe ? -3 : 0),
    banks: [...gunBanks('bullet', ['sand', 'stone', 'wood', 'metal']), ...gunBanks('bullet', ['ricochet'], 3)], variants: 6, bakePriority: 2,
  },
  fleshHit: {   // a gunman hit (combat.hit): o.crit the heavier thump
    ...IMPACT, priority: 75, maxInstances: 4, coalesceMs: 20, gainDb: -2, send: .1, pitchSemi: .8, gainJitDb: 1.5,
    pick: o => GL('bullet', o.crit ? 'crit' : 'flesh', o, o.crit ? {gainDb: 1.5, send: .08} : {send: .08}),
    banks: gunBanks('bullet', ['flesh', 'crit']), variants: 6, bakePriority: 1,
  },
  hitConfirm: {   // the player's own: a hit on an enemy confirmed, at any range (posted at the listener: never faded, never culled)
    ...PLAYER, priority: 70, maxInstances: 2, coalesceMs: 30, gainDb: -10, send: 0, pitchSemi: .4, gainJitDb: .5,
    pick: o => L('bullet', 'confirm', o.crit ? {gainDb: 2, semi: -1.5} : {}),
    banks: [['bullet', 'confirm']], variants: 4, bakePriority: 1,
  },
  bulletPierce: {   // bullet.pierce: a bullet through a gunman (layered on its flesh hit)
    ...IMPACT, priority: 70, maxInstances: 3, coalesceMs: 30, gainDb: -4, pitchSemi: .8,
    pick: o => GL('bullet', 'pierce', o, {send: .08}), banks: gunBanks('bullet', ['pierce']), variants: 4, bakePriority: 2,
  },
  // ================================================ impacts ================================================
  hit: {   // o.mat 'wood' | 'straw' | 'clay' | 'glass' | 'stone' | 'body' (the player); o.g from physics impacts (.45..1.4)
    ...IMPACT, gainDb: -3, cooldownMs: 25, cat: o => (o.mat === 'body' || o.mat === 'flesh' ? 'player' : 'combat'),
    pick: o => {
      switch (o.mat) {
        case 'body': case 'flesh': return L('stomp', 'hurt', {gainDb: 2});   // the player takes a hit: never lost in the mix
        case 'straw': return L('impact', 'straw', {gainDb: -1});
        case 'clay': return L('impact', 'clay', {gainDb: 1});   // the bake sits ~2 dB under target (true-peak cap)
        case 'glass': case 'crystal': return L('impact', 'crystal', {gainDb: -2});
        case 'stone': return L('impact', 'stone');
        default: return L('impact', 'wood');
      }
    },
    gainFrom: o => db(o.g ?? 1),
    banks: [['impact', 'wood'], ['impact', 'straw'], ['impact', 'clay', 2], ['impact', 'crystal', 2], ['impact', 'stone', 4], ['stomp', 'hurt', 2]],
    variants: 6, bakePriority: 1,
  },
  stuck: {   // an arrow into the ground (o.surf biome) or a wall (o.surf 'stone'); rain arrows pass g .7; o.ricochet optional
    ...IMPACT, priority: 40, maxInstances: 4, steal: 'oldest', coalesceMs: 35, gainDb: -8, cooldownMs: 30,
    pick: o => {
      if (o.ricochet) return L('arrow_stick', 'ricochet');
      switch (o.surf) {
        case 'stone': return L('arrow_stick', 'stone', {gainDb: 1});
        case 'frost': return L('arrow_stick', 'snow');
        case 'rift': return L('arrow_stick', 'crystal', {alt: L('arrow_stick', 'stone', {semi: 3, gainDb: -2})});   // crystal ground
        default: return L('arrow_stick', 'ground');
      }
    },
    gainFrom: o => db(o.g ?? 1),
    banks: [['arrow_stick', 'ground'], ['arrow_stick', 'stone'], ['arrow_stick', 'snow', 2], ['arrow_stick', 'crystal', 2], ['arrow_stick', 'ricochet', 7]],
    variants: 6, bakePriority: 1,
  },
  splash: {   // o.small (an arrow) / a body; o.surf: water (ruins, frost), lava (ember), the rift's crack
    ...IMPACT, priority: 50, maxInstances: 3, coalesceMs: 50, gainDb: -4, cooldownMs: 50,
    pick: o => {
      const s = !!o.small;
      if (o.surf === 'ember') return L('splash', 'lava', s ? {semi: 4, gainDb: -6, alt: L('creature', 'lava_belch', {semi: 5, gainDb: -6})}
        : {alt: [L('creature', 'lava_belch', {gainDb: 1}), L('splash', 'big', {semi: -5, gainDb: -12})]});
      if (o.surf === 'rift') return L('splash', 'rift', s ? {semi: 4, gainDb: -6, alt: L('creature', 'rift_shimmer', {gainDb: -6})}
        : {alt: [L('creature', 'rift_shimmer'), L('creature', 'rift_whisper', {gainDb: -8, delayMs: 200})]});
      const out = [L('splash', s ? 'small' : 'big', {gainDb: s ? -4 : 0})];
      if (o.surf === 'frost') out.push(L('ice', 'tinkle', {gainDb: -14, delayMs: 30}));   // a crust of ice breaking
      return out;
    },
    banks: [['splash', 'small'], ['splash', 'big'], ['splash', 'lava', 4], ['splash', 'rift', 4], ['ice', 'tinkle', 4], ['creature', 'lava_belch', 4], ['creature', 'rift_shimmer', 4], ['creature', 'rift_whisper', 5]],
    variants: 6, bakePriority: 3,
  },
  brk: {   // o.kind: crate | pot | barrel | barrel_x | crystal | dummy | brute
    ...IMPACT, priority: 70, maxInstances: 4, coalesceMs: 30, gainDb: -2, send: .2, cooldownMs: 30,
    pick: o => {
      switch (o.kind) {
        case 'pot': return L('crate_break', 'pot');
        case 'barrel': case 'barrel_x': return L('crate_break', 'barrel', {gainDb: 1});
        case 'crystal': return [L('ice', 'shatter'), L('impact', 'crystal', {gainDb: -8})];
        case 'dummy': case 'brute': return [L('impact', 'thud'), L('crate_break', 'splinter', {gainDb: -10, delayMs: 10})];   // a stuffed sack bursting
        default: return L('crate_break', 'crate', {gainDb: 1});
      }
    },
    banks: [['crate_break', 'crate'], ['crate_break', 'pot'], ['crate_break', 'barrel'], ['crate_break', 'splinter', 3], ['ice', 'shatter', 3], ['impact', 'crystal'], ['impact', 'thud', 3]],
    variants: 4, bakePriority: 2,
  },
  explode: {   // o.r blast radius: the explosive arrow is 2 m, a powder barrel 2.4 m; far ones are 'distant'
    ...IMPACT, priority: 90, maxInstances: 3, steal: 'oldest', coalesceMs: 80, gainDb: 3, send: .3, pitchSemi: 1, gainJitDb: 1, cooldownMs: 50,
    pick: o => (o.dist ?? o.d ?? 0) > 16 ? L('explosion', 'distant') : L('explosion', (o.r ?? 2.4) < 2.2 ? 'small' : 'barrel', (o.r ?? 2.4) < 2.2 ? {gainDb: -2} : {}),
    snapshot: {name: 'explosionDuck', buses: {amb: -6, music: -4}, attack: .02, hold: .1, release: .6},
    banks: [['explosion', 'barrel'], ['explosion', 'small'], ['explosion', 'distant', 6]], variants: 4, bakePriority: 3,
  },
  trap: {   // iron jaws snapping
    ...IMPACT, priority: 75, maxInstances: 2, coalesceMs: 0, gainDb: -1, cooldownMs: 100,
    pick: () => L('trap', 'snap'), banks: [['trap', 'snap']], variants: 6, bakePriority: 3,
  },
  trapSet: {...WORLD, cat: 'player', bus: 'sfx.player', priority: 50, gainDb: -8, cooldownMs: 200, pick: () => L('trap', 'set'), banks: [['trap', 'set']], variants: 4, bakePriority: 4},
  trap_rattle: {...WORLD, priority: 40, gainDb: -10, cooldownMs: 300, pick: () => L('trap', 'rattle'), banks: [['trap', 'rattle']], variants: 4, bakePriority: 7},
  stomp: {   // a sparring brute landing a hop
    ...IMPACT, priority: 55, maxInstances: 3, coalesceMs: 30, gainDb: -4, cooldownMs: 80,
    pick: () => L('stomp', 'hop'), banks: [['stomp', 'hop']], variants: 6, bakePriority: 3,
  },
  slam: {...IMPACT, priority: 70, maxInstances: 2, gainDb: -2, pick: () => L('stomp', 'slam'), banks: [['stomp', 'slam']], variants: 4, bakePriority: 7},   // a heavy creature (later)

  // ================================================ physical props (props3d.js) ================================================
  tip: {...WORLD, priority: 55, gainDb: -3, cooldownMs: 150, pick: () => L('prop', 'tip'), banks: [['prop', 'tip']], variants: 6, bakePriority: 4},
  kick: {
    ...WORLD, gainDb: -5, cooldownMs: 120,
    pick: o => o.mat === 'clay' ? L('impact', 'clay', {gainDb: -1}) : L('prop', 'kick', {gainDb: 1}),
    banks: [['prop', 'kick'], ['impact', 'clay', 5]], variants: 6, bakePriority: 4,
  },
  scrape: {...WORLD, priority: 30, maxInstances: 2, gainDb: -9, cooldownMs: 200, pick: () => L('prop', 'scrape'), banks: [['prop', 'scrape']], variants: 6, bakePriority: 4},
  propDrop: {
    ...WORLD, priority: 55, gainDb: -2, cooldownMs: 100,
    pick: o => o.mat === 'clay' ? L('impact', 'clay', {gainDb: 2}) : L('prop', 'drop', {gainDb: 1}),
    banks: [['prop', 'drop'], ['impact', 'clay', 5]], variants: 6, bakePriority: 4,
  },
  barrel_loop: {   // the rolling barrel as a seamless loop (rate and level follow the speed), driven by director.makeRoll()
    ...WORLD, loop: true, priority: 45, maxInstances: 1, gainDb: -8, pitchSemi: 0, gainJitDb: 0,
    pick: o => L('prop_roll', o.surf === 'frost' || o.surf === 'ember' ? 'dirt' : 'stone'),   // o.surf: the biome
    banks: [['prop_roll', 'stone'], ['prop_roll', 'dirt']], variants: 1, bakePriority: 6,
  },
  barrel_roll: {   // fallback until prop_roll is baked: one ~2 s segment of the rolling barrel, chained by makeRoll()
    ...WORLD, priority: 45, maxInstances: 2, steal: 'oldest', gainDb: -6, pitchSemi: .5,
    pick: () => L('prop', 'roll'), banks: [['prop', 'roll']], variants: 6, bakePriority: 4,
  },

  // ================================================ loot / world ================================================
  loot: {   // coins spilling; o.n
    ...WORLD, priority: 65, maxInstances: 2, gainDb: -6, pitchSemi: .3, cooldownMs: 80,
    pick: () => L('coin', 'spill'), gainFrom: o => clamp(((o.n ?? 2) - 2) * 1, -2, 3),
    banks: [['coin', 'spill']], variants: 6, bakePriority: 3,
  },
  coin: {...WORLD, priority: 60, maxInstances: 3, coalesceMs: 30, gainDb: -8, pitchSemi: .3, cooldownMs: 60, pick: () => L('coin', 'pickup'), banks: [['coin', 'pickup']], variants: 6, bakePriority: 3},
  open: {   // chest: latch, hinge, lid, sparkle; the loot chime rides on top
    ...WORLD, priority: 65, maxInstances: 2, gainDb: -3, pitchSemi: .3, cooldownMs: 300,
    pick: () => [L('chest', 'open'), L('coin', 'chime', {gainDb: -6, delayMs: 380})],
    banks: [['chest', 'open'], ['coin', 'chime', 4]], variants: 4, bakePriority: 3,
  },
  chest_close: {...WORLD, gainDb: -5, pick: () => L('chest', 'close'), banks: [['chest', 'close']], variants: 4, bakePriority: 7},
  chest_locked: {...WORLD, gainDb: -6, pick: () => L('chest', 'locked'), banks: [['chest', 'locked']], variants: 4, bakePriority: 7},
  respawn: {...WORLD, cat: 'player', bus: 'sfx.player', priority: 70, gainDb: -6, cooldownMs: 200, pick: () => L('magic', 'respawn'), banks: [['magic', 'respawn']], variants: 4, bakePriority: 4},

  // ================================================ wildlife (wildlife.js) ================================================
  wings: {   // o.n birds taking off
    ...WILD, gainDb: -10, cooldownMs: 120,
    pick: o => (o.n || 1) >= 3 ? L('creature', 'scatter') : L('creature', 'wings'),
    gainFrom: o => (o.n || 1) >= 3 ? clamp(((o.n || 3) - 3) * 1, 0, 4) : 0,
    banks: [['creature', 'wings'], ['creature', 'scatter']],
  },
  caw: {...WILD, gainDb: -12, cooldownMs: 800, pick: () => L('creature', 'caw'), banks: [['creature', 'caw']]},
  plop: {   // a fish or frog breaking the water (o.fish / o.frog); no water in ember / rift
    ...WILD, gainDb: -10, cooldownMs: 150,
    pick: o => {
      if (o.surf === 'ember') return L('splash', 'lava', {semi: 4, gainDb: -6, alt: L('creature', 'lava_belch', {semi: 4, gainDb: -6})});
      if (o.surf === 'rift') return L('splash', 'rift', {semi: 4, gainDb: -6, alt: L('creature', 'rift_shimmer', {gainDb: -6})});
      if (o.frog) return [L('plunk', 'small', {gainDb: -2}), L('creature', 'frog', {gainDb: 1, delayMs: 80})];
      return L('creature', 'fish');
    },
    banks: [['creature', 'fish'], ['creature', 'frog'], ['plunk', 'small'], ['splash', 'lava', 7], ['splash', 'rift', 7], ['creature', 'lava_belch', 7], ['creature', 'rift_shimmer', 7]],
  },
  rustle: {...WILD, gainDb: -12, cooldownMs: 200, pick: () => L('creature', 'critter'), banks: [['creature', 'critter']]},
  // the night's canids (features/wildlife/coyotes.js: wildlife.howl {kind: coyote | fox | wolf, call: howl | yips | bark}):
  // the canid recipe. Combat's screen rule (they sit at the view's edge and call from just past it: heard a little off screen)
  howl: {
    ...WILD, cat: 'combat', gainDb: -13, cooldownMs: 700, variants: 4, bakePriority: 7,
    pick: o => L('canid', o.kind === 'wolf' ? 'wolf_howl' : o.kind === 'fox' ? 'fox_bark' : o.call === 'yips' ? 'coyote_yips' : 'coyote_howl'),
    gainFrom: o => o.call === 'yips' ? -2 : 0,
    banks: [['canid', 'coyote_howl'], ['canid', 'coyote_yips'], ['canid', 'wolf_howl', 8], ['canid', 'fox_bark', 8]],
  },

  // ================================================ UI (pause menu) ================================================
  ui_hover: {...UI, gainDb: -13, maxInstances: 1, cooldownMs: 40, pick: () => L('ui', 'hover'), banks: [['ui', 'hover']]},
  ui_click: {...UI, gainDb: -9, pick: () => L('ui', 'click'), banks: [['ui', 'click']]},
  ui_confirm: {...UI, gainDb: -9, pick: () => L('ui', 'confirm'), banks: [['ui', 'confirm']]},
  ui_back: {...UI, gainDb: -10, pick: () => L('ui', 'back'), banks: [['ui', 'back']]},
  ui_open: {...UI, gainDb: -11, pick: () => L('ui', 'open'), banks: [['ui', 'open']]},
  ui_error: {...UI, gainDb: -10, pick: () => L('ui', 'error'), banks: [['ui', 'error']]},
};

// the names audio.js fires, for the coverage test (SFX keys; creak / roll / beds are the continuous voices below)
export const ARENA_NAMES = ['step', 'land', 'jump', 'roll', 'climb', 'shot', 'volley', 'whistle', 'creakTick', 'hit', 'stuck',
  'splash', 'tip', 'kick', 'scrape', 'propDrop', 'wings', 'caw', 'plop', 'rustle', 'brk', 'explode', 'loot', 'coin', 'open',
  'trap', 'trapSet', 'respawn', 'stomp'];

// ======================================================================================================================
// SCREEN-BOUND AUDIBILITY (phase 3, the user: "too much happening around me that I experience through sound compared to
// what's on screen"). RULE: if you hear it, its source is on screen, or it is clearly a distant background.
// The caller passes `off` = metres beyond the edge of the view (0 = on screen). Per event category:
//   fadeDbPerM  dB lost per metre off-screen;  cullOff  silent beyond this (the post still counts as handled: no fallback)
//   lpf: [hz at the edge, factor per metre, floor]   a low-pass that closes as the source leaves the view
//   minDist / maxDist   the engine's distance model for these sounds: 0 dB within minDist (on-screen things stay present),
//                       maxDist past the cull so the engine never cuts something the screen rule keeps
// 'player' and 'ui' are never affected.
// ======================================================================================================================
export const SPATIAL = {
  world: {fadeDbPerM: 6, cullOff: 2, lpf: [9000, .6, 1200], minDist: 5, maxDist: 40},
  combat: {fadeDbPerM: 3, cullOff: 6, lpf: [6000, .62, 600], minDist: 5, maxDist: 40},
};

// recipes / cases being written by the recipe agent; every use has an `alt` (or simply stays silent: the insect bed)
// (all delivered 2026-10-01; the alts stay as a safety net if a bake fails)
export const PENDING = [['arrow_stick', 'crystal'], ['splash', 'lava'], ['splash', 'rift'], ['prop_roll', 'stone'], ['prop_roll', 'dirt']];

// ======================================================================================================================
// AMBIENCE: per biome. QUIET and CONTINUOUS (the user found loud nature textures overwhelming, and random calls "in my
// ear" disturbing):
//   beds     forge loops (one variant each), crossfaded on biome / time change; ducked by `combat` (AMB_RULES.duck)
//            {recipe, case, gainDb, gust?: dB swing with the arena wind (wind.gust 0..1, around .5), bakePriority?}
//            insects (night / dusk / day all bake at -20 LUFS): dusk sits 4 dB and day 12 dB under night
//   calls    the ONLY random one-shots: rare, far-off, heavily low-passed and panned wide (never centre, never close)
//            {recipe, case, every: [lo, hi] s, time: [...], gainDb (<= -30), lpf: [lo, hi] Hz, pan: [|min|, |max|]}
//            and all ambient one-shots together stay under AMB_RULES.budget
//   emitters positional loops: the stream, driven by proximity
//            {recipe, case, at: 'stream', gainDb (at the bank), floorDb (far away, re gainDb), lpf: [far, near] Hz}
// Wildlife you can SEE is not here: it comes from the wildlife system's events (wings, caw, plop, rustle) with positions.
// Visible fire sources (torches, braziers) get emitters from SOURCES.
// ======================================================================================================================
const CALL = {pan: [.6, .8], send: .5, pitchSemi: .7};
export const AMBIENCE = {
  ruins: {
    beds: {
      day: [{recipe: 'wind', case: 'breeze', gainDb: -24.5, gust: 6}, {recipe: 'insects', case: 'day', gainDb: -42, bakePriority: 6}],
      dusk: [{recipe: 'wind', case: 'breeze', gainDb: -25.5, gust: 6}, {recipe: 'insects', case: 'dusk', gainDb: -34, bakePriority: 5}],
      night: [{recipe: 'wind', case: 'breeze', gainDb: -28.5, gust: 5}, {recipe: 'insects', case: 'night', gainDb: -30, bakePriority: 5}],
    },
    calls: [
      {recipe: 'creature', case: 'songbird', every: [25, 45], time: ['day'], gainDb: -32, lpf: [900, 1500], ...CALL},
      {recipe: 'creature', case: 'songbird', every: [35, 60], time: ['dusk'], gainDb: -34, lpf: [800, 1300], ...CALL},
      {recipe: 'creature', case: 'owl', every: [30, 50], time: ['night'], gainDb: -31, lpf: [700, 1100], ...CALL},
    ],
    emitters: [{recipe: 'stream', case: 'brook', at: 'stream', gainDb: -20, floorDb: -14, lpf: [600, 9000]}],
  },
  ember: {
    beds: {
      day: [{recipe: 'wind', case: 'ember_hot', gainDb: -24.5, gust: 5}, {recipe: 'fire', case: 'embers', gainDb: -27.5}, {recipe: 'lava', case: 'pool', gainDb: -28.5}],
      dusk: [{recipe: 'wind', case: 'ember_hot', gainDb: -24.5, gust: 5}, {recipe: 'fire', case: 'embers', gainDb: -26.5}, {recipe: 'lava', case: 'pool', gainDb: -28.5}],
      night: [{recipe: 'wind', case: 'ember_hot', gainDb: -26.5, gust: 4}, {recipe: 'fire', case: 'embers', gainDb: -25.5}, {recipe: 'lava', case: 'pool', gainDb: -27.5}],
    },
    calls: [
      {recipe: 'creature', case: 'lava_belch', every: [30, 60], time: ['day', 'dusk', 'night'], gainDb: -31, lpf: [500, 900], ...CALL, pitchSemi: 1.5},
    ],
    emitters: [{recipe: 'lava', case: 'flow', at: 'stream', gainDb: -21, floorDb: -14, lpf: [500, 6000]}],
  },
  frost: {
    beds: {
      day: [{recipe: 'wind', case: 'gusty', gainDb: -24.5, gust: 7}],
      dusk: [{recipe: 'wind', case: 'gusty', gainDb: -24.5, gust: 7}, {recipe: 'wind', case: 'howl', gainDb: -32.5, gust: 6}],
      night: [{recipe: 'wind', case: 'howl', gainDb: -26.5, gust: 7}],
    },
    calls: [
      {recipe: 'ice', case: 'crack', every: [35, 70], time: ['day', 'dusk', 'night'], gainDb: -31, lpf: [800, 1500], ...CALL},
      {recipe: 'creature', case: 'owl', every: [35, 60], time: ['night'], gainDb: -32, lpf: [700, 1100], ...CALL},
    ],
    emitters: [{recipe: 'stream', case: 'brook', at: 'stream', gainDb: -21, floorDb: -14, lpf: [500, 7000]}],
  },
  rift: {
    beds: {
      day: [{recipe: 'rift', case: 'drone', gainDb: -26}, {recipe: 'rift', case: 'shimmer', gainDb: -29.5}],
      dusk: [{recipe: 'rift', case: 'drone', gainDb: -26}, {recipe: 'rift', case: 'shimmer', gainDb: -28.5}],
      night: [{recipe: 'rift', case: 'drone', gainDb: -25}, {recipe: 'rift', case: 'whisper', gainDb: -29.5}],
    },
    calls: [],
    emitters: [{recipe: 'rift', case: 'whisper', at: 'stream', gainDb: -22, floorDb: -12, lpf: [700, 6000]}],   // the humming crack
  },
};

// visible sound sources in the world (ambience.update's `sources`): one positional loop each, the nearest few on screen.
// Level, pan, distance and off-screen fade follow SPATIAL.world.
export const SOURCES = {
  torch: {recipe: 'fire', case: 'torch', gainDb: -30},
  brazier: {recipe: 'fire', case: 'brazier', gainDb: -30},
};
export const AMB_RULES = {
  maxSources: 4,
  budget: {max: 2, windowS: 10},                       // ambient one-shots (calls) overall
  duck: {'amb.beds': -6, 'amb.spots': -6, 'amb.emitters': -3},   // dB at combat = 1 (the music's intensity)
};
// bake order for ambience: the current biome's beds early; other biomes are baked lazily, when you get there (loops are
// ~3.5 MB per stereo variant), or at `other` with prefetch({allBiomes: true})
export const AMB_PRIORITY = {current: 2, sources: 4, spots: 6, other: 9};
