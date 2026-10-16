// MODS (docs/MODS.md): weapon attachments and runes. Every weapon has three SLOTS: a RUNE (what kind of damage it deals), a
// TIP (how the shot flies: a gun's barrel, a bow's fletching, a staff's head) and a GRIP (a trigger that bends a rule). Parts
// are kept in the weapon kit (features/mods.js: pack.store('mods')), fitted on the bench (M, ui/modpanel.js), found round the
// world (FINDS). Pure data: imports nothing.
//
// DAMAGE TYPES (ELEM): what a hit leaves on what it hits (a STATUS: features/mods/sim.js steps them), and how the weather,
// the ground and other statuses change it (REACT). 'phys' is a plain hit: no status.
//   col / pal   the type's colour and its particles (light -> dark), the bench's text and the trails (features/mods/look.js)
export const ELEM = {
  phys: {name: 'Plain', col: '#e8e0cc', pal: ['#ffffff', '#e8e0cc', '#a89c84', '#6a6050'], says: 'a plain hit'},
  // burn: dps for dur s (ticks every tick s; a new hit tops it back up); in the rain x rain (and it hisses); a burning thing
  // that falls sets what stands within spread m alight. Wood it hits catches (features/lights.js: a.fire)
  fire: {name: 'Ember', col: '#ff8a3a', pal: ['#fff4c0', '#ffd06a', '#ff8a3a', '#d0401e', '#7a2a1e'], says: 'hits burn; rain damps it, wood catches',
    burn: {dps: 6, tick: .5, dur: 3, rain: .4, spread: 1.8}},
  // chill: a hit adds one (they melt off decay s after the last); at freezeAt (in snow or winter: snowAt) it FREEZES for freeze s
  // (rooted where it stands); the next hit on a frozen thing SHATTERS it: x shatter damage, shards within shardR m take shardDmg
  frost: {name: 'Rime', col: '#9fe6ff', pal: ['#ffffff', '#d8f6ff', '#9fe6ff', '#5aa8d8', '#2a5a8a'], says: 'hits chill; three chills freeze, the next hit shatters',
    chill: {decay: 2.6, freezeAt: 3, snowAt: 2, freeze: 2.2, shatter: 2.2, shardR: 1.8, shardDmg: 6}},
  // arc: a hit jumps to the n nearest others within r m for k of its damage; WET (rain falling, standing in the stream or the
  // mire) carries it: wetN, wetR, x wetK. In a thunderstorm every bolt-th storm hit calls the sky down on it (boltDmg in boltR m)
  storm: {name: 'Storm', col: '#c8b4ff', pal: ['#ffffff', '#ece4ff', '#c8b4ff', '#8a6ae0', '#4a3a8a'], says: 'hits jump to two more; wet things carry it further',
    arc: {n: 2, r: 3.5, k: .6, wetN: 3, wetR: 5.5, wetK: 1.4, bolt: 5, boltDmg: 18, boltR: 1.4}},
  // rot: dps per stack (up to max) for dur s; standing in the mire x mire; a rotting thing that falls bursts: rot on everything
  // within spread m
  rot: {name: 'Rot', col: '#9ad04a', pal: ['#e8ffb0', '#c8f070', '#9ad04a', '#5a8a2a', '#2e4a1a'], says: 'hits rot and stack; the mire feeds it; it spreads when they fall',
    rot: {dps: 3, tick: .5, dur: 5, max: 3, mire: 2, spread: 2.6}},
  // void: a hit makes it FALL UPWARD (thrown up `up` m/s, stunned stun s after; at night x night); in fog x fog damage. A kill
  // farther than warp m swaps you into its place; every kill pulls what stands within pull.r m pull.d m toward where it fell
  void: {name: 'Hollow', col: '#b06aff', pal: ['#ffe8ff', '#e0b0ff', '#b06aff', '#7a3ac8', '#3a1a6a'], says: 'hits make them fall upward; a far kill swaps you in',
    void: {up: 6, stun: .5, night: 1.5, fog: 1.3, warp: 3, pull: {r: 3.5, d: 1.6}}},
};
export const ELEM_IDS = ['fire', 'frost', 'storm', 'rot', 'void'];

// REACTIONS: an incoming type meeting a status already on the target (features/mods/sim.js react()). mul: x this hit's damage;
// boom: an explosion there (combat core explode: r m, dmg); the rest each its own rule (the sim's comments)
export const REACT = {
  steam: {on: 'frozen', by: 'fire', mul: 2.5, name: 'Steam burst', says: 'fire on a frozen thing: x2.5, it thaws in a cloud'},
  flashover: {on: 'burn', by: 'storm', boom: {r: 1.6, dmg: 14}, name: 'Flashover', says: 'storm on a burning thing: it goes off'},
  swampgas: {on: 'rot', by: 'fire', boom: {r: 2.4, dmg: 20}, name: 'Swamp gas', says: 'fire on a rotting thing: the gas in it goes off'},
  blight: {on: 'rot', by: 'frost', name: 'Blight frost', says: 'frost on a rotting thing: it freezes at once'},
  shatterbolt: {on: 'frozen', by: 'storm', r: 6, name: 'Shatterbolt', says: 'storm on a frozen thing: every frozen thing near shatters'},
  unravel: {on: 'any', by: 'void', r: 3, name: 'Unravel', says: 'hollow on anything with a status: its statuses jump to all near it'},
};
export const REACT_IDS = ['steam', 'flashover', 'swampgas', 'blight', 'shatterbolt', 'unravel'];

// WEAPON KINDS: which parts fit (PART.fits) and what each slot is called on it. A weapon's kind is content/weapons.js kind ('bow',
// 'gun'); 'staff' and every melee kind (the melee weapons: 'blade', 'blunt', ...) share 'melee' unless named here
export const SLOTS = ['rune', 'tip', 'grip'];
export const SLOT_NAMES = {
  bow: {rune: 'Arrowhead', tip: 'Fletching', grip: 'Grip'},
  gun: {rune: 'Chamber', tip: 'Barrel', grip: 'Grip'},
  staff: {rune: 'Crystal', tip: 'Head', grip: 'Wrap'},
  melee: {rune: 'Rune', tip: 'Edge', grip: 'Pommel'},
};
export const kindOf = k => k === 'bow' || k === 'gun' || k === 'staff' ? k : 'melee';
// a weapon this kit knows by id but content/weapons.js doesn't hold (the melee weapons' own file names them; this is the
// fallback name and kind on the bench)
export const KNOWN = {bow: {name: 'Bow', kind: 'bow'}, peacemaker: {name: 'Peacemaker', kind: 'gun'}, brass_navy: {name: 'Brass Navy', kind: 'gun'},
  staff: {name: 'Staff', kind: 'staff'}};

// THE PARTS. slot, name, desc (the bench's line: what it does, in play words), fits (kinds), find (the bench's hint where one
// turns up: shown once you own it, and as a riddle on the list of the ones you haven't), icon (12 x 12, the pack's icon format:
// ui/packpanel.js iconURL), pal (its letters). The numbers are the sim's (features/mods/sim.js), named on each.
const ALL = ['bow', 'gun', 'staff', 'melee'], SHOOT = ['bow', 'gun', 'staff'];
// a rune stone with its glyph (5 x 5, '#' = the glyph) in the middle
function rune(glyph) {
  const base = ['............', '....pppp....', '...pqqqqp...', '..pqqqqqqp..', '..pqqqqqqp..', '..pqqqqqqp..',
    '..pqqqqqqp..', '..pqqqqqqp..', '..pqqqqqqp..', '...pqqqqp...', '....pppp....', '............'];
  return base.map((row, y) => {
    const g = glyph[y - 3]; if (!g) return row;
    let r = row.slice(0, 3); for (let x = 0; x < 6; x++) r += g[x] === '#' ? 'G' : row[3 + x]; return r + row.slice(9);
  });
}
const STONE = {p: '#cfcabe', q: '#7a756a'};
export const PARTS = {
  // ---- runes: the damage type ----
  ember_rune: {slot: 'rune', elem: 'fire', name: 'Ember Rune', fits: ALL, find: 'You set out with it.', riddle: '',
    icon: rune(['..#...', '.##...', '.###..', '#####.', '.###..', '......']), pal: {...STONE, G: '#ff8a3a'}},
  rime_rune: {slot: 'rune', elem: 'frost', name: 'Rime Rune', fits: ALL, find: 'Cold places: a hole cut in the ice, deep in a vein.', riddle: 'It sleeps where the water is hard.',
    icon: rune(['#.#.#.', '.###..', '#####.', '.###..', '#.#.#.', '......']), pal: {...STONE, G: '#9fe6ff'}},
  storm_rune: {slot: 'rune', elem: 'storm', name: 'Storm Rune', fits: ALL, find: 'Left in the ground where lightning struck near you.', riddle: 'The sky drops one now and then. Stand close.',
    icon: rune(['...##.', '..##..', '.####.', '..##..', '.##...', '......']), pal: {...STONE, G: '#c8b4ff'}},
  rot_rune: {slot: 'rune', elem: 'rot', name: 'Rot Rune', fits: ALL, find: 'Dug out of the mire, or sunk into it.', riddle: 'Go down into the bog and come back up.',
    icon: rune(['..#...', '.###..', '#.#.#.', '.###..', '..#...', '......']), pal: {...STONE, G: '#9ad04a'}},
  hollow_rune: {slot: 'rune', elem: 'void', name: 'Hollow Rune', fits: ALL, find: 'The night elk dropped it when it knocked you down.', riddle: 'Something at night has it. Let it find you.',
    icon: rune(['.###..', '#...#.', '#.#.#.', '#...#.', '.###..', '......']), pal: {...STONE, G: '#b06aff'}},
  // ---- tips: how the shot flies ----
  split_choke: {slot: 'tip', name: 'Fork Choke', fits: SHOOT, split: {n: 3, deg: 9, dmg: .55}, find: 'You set out with it.', riddle: '',
    desc: 'Every shot splits in three, each worth a bit more than half.',
    icon: ['............', '.........ss.', '........ss..', '..kkkiiii...', '.kiiiiiiiss.', '..kkkiiii...', '........ss..', '.........ss.', '............', '............', '............', '............']},
  long_barrel: {slot: 'tip', name: 'Sighted Barrel', fits: SHOOT, notes: {spread: .45, dmg: 1.2, gap: 1.25}, speed: 1.35, find: 'You set out with it.', riddle: '',
    desc: 'Tighter, faster and harder; a breath longer between shots.',
    icon: ['............', '....s.......', '...kik......', 'kkiiiiiiiiii', 'iiiiiiiiiiis', 'kkkkkkkkkkkk', '............', '............', '............', '............', '............', '............']},
  moth_lens: {slot: 'tip', name: 'Moth Lens', fits: SHOOT, steer: 'moth', seek: {r: 7, turn: 7, wob: 9}, find: 'In the belly of a fish.', riddle: 'Something swallowed it. Fish for it.',
    desc: 'Shots flutter like moths and go for the nearest thing alive.',
    icon: ['............', '.mm......mm.', 'mMMm....mMMm', 'mMMMm..mMMMm', '.mMMMddMMMm.', '..mMMddMMm..', '..mMMddMMm..', '.mMMm..mMMm.', '.mmm....mmm.', '............', '............', '............'],
    pal: {m: '#8a7a5a', M: '#e8dcb0', d: '#3a2c1e'}},
  boomerang_bend: {slot: 'tip', name: 'Bent Bough', fits: SHOOT, steer: 'boom', boom: {at: .45, turn: 9}, find: 'Off a felled tree now and then.', riddle: 'Fell enough trees and one gives you a bent branch.',
    desc: 'Shots turn round and come back past you.',
    icon: ['............', '.ww.........', '.wlw........', '..wlw.......', '...wlw......', '....wlww....', '.....wllwwww', '......wwllll', '.......wwwww', '............', '............', '............']},
  heavy_slug: {slot: 'tip', name: 'Heavy Slug', fits: ['gun'], pen: 2, push: 2, find: 'Inside a broken vein now and then.', riddle: 'Break rock.',
    desc: 'Bullets go through two more bodies and shove twice as hard.',
    icon: ['............', '............', '....kiii....', '...kiiiis...', '..kiiiiiis..', '..kiiiiiis..', '..kiiiiiis..', '..kiiiiiis..', '..uuuuuuuu..', '..uuuuuuuu..', '............', '............']},
  glancing_lip: {slot: 'tip', name: 'Glancing Lip', fits: ['gun'], notes: {ricochet: 1}, find: 'Inside a broken vein now and then.', riddle: 'Break rock.',
    desc: 'Bullets glance off stone and iron.',
    icon: ['............', '..........u.', '.........u.u', '.kkkkiii..u.', 'kiiiiiiis...', 'kiiiiiiiss..', '.kkkkkkk.ss.', '..........s.', '............', '............', '............', '............']},
  prism: {slot: 'tip', name: 'Prism', fits: ALL, find: 'The five runes, together, made it.', riddle: 'Own every rune.',
    desc: 'Every shot or swing takes the next rune you own.',
    icon: ['............', '.....ss.....', '....sffs....', '....sffs....', '...sfffs....', '...sffffs...', '..sffffffs..', '..sfffffffs.', '.ssssssssss.', '..RYGBV.....', '............', '............'],
    pal: {s: '#d8dee4', f: '#a8c8e8', R: '#ff6a4a', Y: '#ffd06a', G: '#9ad04a', B: '#9fe6ff', V: '#b06aff'}},
  caster_crystal: {slot: 'tip', name: 'Caster Crystal', fits: ['staff'], bolt: {speed: 22, life: 1.1, dmg: 14}, find: 'A rune stone grows one if you leave it in a cave.', riddle: 'Carry a rune into the cave.',
    desc: 'Each swing looses a bolt of the staff\'s rune.',
    icon: ['............', '.....cc.....', '....cCCc....', '....cCCc....', '...cCCCCc...', '...cCCCCc...', '....cCCc....', '....cCCc....', '.....cc.....', '.....ww.....', '.....ww.....', '............'],
    pal: {c: '#7ac0e0', C: '#e0f8ff', w: '#a07448'}},
  // ---- grips: a trigger that bends a rule ----
  hair_trigger: {slot: 'grip', name: 'Hair Trigger', fits: SHOOT, notes: {gap: .6, reload: .75, spread: 1.5, fanSpread: 1.3}, bow: {speed: 1.25, dmg: .85},
    find: 'You set out with it.', riddle: '', desc: 'Quicker shots and reloads, wilder aim.',
    icon: ['............', '............', '.kkkkkkkkk..', '.kiiiiiiiik.', '.kkkkkkiik..', '......kik...', '.....kik....', '....kik.....', '....kk......', '............', '............', '............']},
  kick_grip: {slot: 'grip', name: 'Kick Grip', fits: SHOOT, knock: 7, find: 'You came away with it after a wall stopped you.', riddle: 'Get thrown into a wall.',
    desc: 'Every shot throws you back. Shoot the ground in a leap.',
    icon: ['............', '...hhhhh....', '...hwwwh....', '...hwwwh....', '...hwwwh..u.', '...hwwwh.u.u', '...hwwwh..u.', '...hwwwh....', '..hwwwwwh...', '..hhhhhhh...', '............', '............']},
  echo_charm: {slot: 'grip', name: 'Echo Charm', fits: ALL, echo: {delay: .45}, find: 'Three fell to you at once and it fell from the last.', riddle: 'Drop three at once.',
    desc: 'Every shot is fired again a moment later, from where you stood.',
    icon: ['............', '...eeeee....', '..e.....e...', '.e..EEE..e..', '.e.E...E.e..', '.e.E.p.E.e..', '.e.E...E.e..', '.e..EEE..e..', '..e.....e...', '...eeeee....', '............', '............'],
    pal: {e: '#7a6a9a', E: '#c0b0e8', p: '#ffffff'}},
  weather_vane: {slot: 'grip', name: 'Weather Vane', fits: ALL, find: 'Lightning hit you, and it was in your hand.', riddle: 'Be struck.',
    desc: 'Your rune follows the sky: rain storms, snow freezes, the bog rots, the night hollows, a clear day burns.',
    icon: ['............', '.....u......', '....uuu.....', '.....u......', '.uuuuuuuuu..', '.u...u....u.', '.....u...uu.', '.....u......', '.....i......', '.....i......', '...iiiii....', '............']},
  last_word: {slot: 'grip', name: 'Last Word', fits: ['gun'], notes: {last: 2}, burst: {r: 2.2}, find: 'A kill with the last round in the cylinder.', riddle: 'Make the last one count.',
    desc: 'The cylinder\'s last round hits three times as hard and bursts in its rune.',
    icon: ['............', '.....RR.....', '....RRRR....', '....iiii....', '....iiii....', '....iiii....', '....iiii....', '....uuuu....', '....uuuu....', '....kkkk....', '............', '............'],
    pal: {R: '#e8604a'}},
};
export const PART_IDS = Object.keys(PARTS);
export const fits = (id, kind) => !!PARTS[id]?.fits.includes(kindOf(kind));

// A RUNE'S DESCRIPTION (the bench): its type's line
export const descOf = id => PARTS[id]?.desc ?? (PARTS[id]?.elem ? ELEM[PARTS[id].elem].says[0].toUpperCase() + ELEM[PARTS[id].elem].says.slice(1) + '.' : '');

// WHAT YOU SET OUT WITH (a fresh kit) and what a fresh kit has fitted on each weapon
export const START = {own: ['ember_rune', 'split_choke', 'long_barrel', 'hair_trigger'], fit: {peacemaker: {rune: 'ember_rune'}, brass_navy: {rune: 'ember_rune'}, bow: {rune: 'ember_rune'}}};

// FINDS (features/mods/sim.js listens for the events): event -> [{id (part), p (chance; first: the first time it happens, p 1)}].
// A found part drops where it happened (a glowing stone or piece on the ground: walk over it) unless `hand` (straight into the kit)
export const FINDS = {
  'thunder.strike': [{id: 'storm_rune', p: .35, first: true, near: 18}, {id: 'weather_vane', p: 1, you: true, hand: true}],
  'ice.hole': [{id: 'rime_rune', p: .5, first: true}],
  'mine.spent': [{id: 'rime_rune', p: .05}, {id: 'heavy_slug', p: .1}, {id: 'glancing_lip', p: .1}],
  'mire.dig': [{id: 'rot_rune', p: 1}],
  'mire.sink': [{id: 'rot_rune', p: .15, first: true}],
  'uncanny.knock': [{id: 'hollow_rune', p: 1, hand: true}],
  'fish.catch': [{id: 'moth_lens', p: .08}],
  'tree.fell': [{id: 'boomerang_bend', p: .08}],
  'player.slam': [{id: 'kick_grip', p: 1, first: true, hand: true}],
  'enemy.kill': [{id: '*', p: .12}],    // a random part you don't own yet (no runes but the ember: those are the world's)
  'chest.open': [{id: '*', p: .5}],
};
export const STREAK = {n: 3, t: 1.2};   // kills within t s that count as "at once" (the echo charm)
export const CAVE_GROW = 90;            // s carrying a rune in the cave before a caster crystal grows on it (once)
export const PICK = {r: 1.1, life: 240};   // m a dropped part is taken from; s it lies before it sinks away
