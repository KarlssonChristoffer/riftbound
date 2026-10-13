// GEAR (data): what a character can wear (docs/GEAR.md). Pure data and pure functions, no imports: the browser (features/gear.js,
// view/dress.js, ui/gearpanel.js) and the co-op server (server/room.mjs: it checks a set before anyone else sees it) read this
// one file.
//   SLOTS      the places a piece goes, in the panel's order. An empty slot is the character's own clothes (the model as made)
//   MATERIALS  the colours a piece is made of: 4 tones (hi, base, shade, dark), turned into the pixelizer's 6 by
//              palette_harm.py's rule (view/rigkit.js ramp6), so a piece is shaded, lined and outlined like the body
//   ZONES      a model's parts by what they are (the hat, the coat, the boots ...), per live model (its json meta.loadout):
//              a piece paints or hides ZONES, so one piece fits every model that names the zone
//   KINDS      what a piece is for (clothing, armour, robe, weapon, tool, charm); RARITY its tier (common .. mythic: a colour each).
//              Both PROVISIONAL (2026-10-12): a first pass to react to; nothing reads them but the panels yet
//   GEAR       the pieces. Each: id, name, slot, kind, rarity, weight (kg), armor (share of damage taken off), desc, look, and
//              optionally mods (more modifier notes: host.mods) and soon (what it will do once the game has the system: weather,
//              fire, sword swings, spells)
//   look       how it changes the character (view/dress.js):
//                paint {zone: material}   the zone's parts in that material
//                hide [zone]              the zone's parts not drawn
//                cloth material | 'off'   the duster's runtime cloth panel (the gunslinger's long coat tail) recoloured / gone
//                add [piece]              new shapes riding a bone: {on: bone, part, mat, shape, at: [x, y, z], rot?: [deg x, y, z],
//                                         + the shape's size} in BODY SPACE AT REST (metres: x his left, y his back, z up, the feet
//                                         at the origin; the gunslinger's head is z 1.28 .. 1.8, his hat's band at 1.65).
//                                         shape box {size: [x, y, z]} | ball {r: n | [x, y, z]} | tube {r0, r1, len} (along z)
//                                         | cone {r, len} (along z, the point up) | disc {r, len} (a flat tube); o: {sides, bias,
//                                         fixed (a tone 0..3, unlit), outline (false)}
// WEIGHT and ARMOR are the two numbers every piece has (game effects through host.mods: features/gear.js): weight past
// FREE_KG slows you, armor takes a share off the damage you take.
export const SLOTS = ['head', 'body', 'back', 'hands', 'legs', 'feet', 'main', 'off'];
export const SLOT_NAMES = {head: 'Head', body: 'Body', back: 'Back', hands: 'Hands', legs: 'Legs', feet: 'Feet', main: 'Main hand', off: 'Off hand'};
export const KINDS = {clothing: 'Clothing', armor: 'Armour', robe: 'Robe', weapon: 'Weapon', tool: 'Tool', charm: 'Charm'};
export const RARITY = {common: {name: 'Common', col: '#c9c2b2'}, fine: {name: 'Fine', col: '#7ad07a'}, rare: {name: 'Rare', col: '#5aa8ff'},
  masterwork: {name: 'Masterwork', col: '#c27bff'}, mythic: {name: 'Mythic', col: '#ffb84a'}};

// the rules turning a set into numbers (features/gear.js applies them as modifier notes)
export const RULES = {
  FREE_KG: 4,          // carried without slowing you
  SLOW_PER_KG: .012,   // speed lost per kg past that
  SLOW_MIN: .7,        // never slower than this share of your speed
  ARMOR_MAX: .5,       // never more than this share of the damage taken off
};

export const MATERIALS = {
  wool_blue:  ['#7092c4', '#4d6b9e', '#374f7a', '#212c45'],
  wool_cream: ['#f0e8d2', '#d8cba9', '#ae9f80', '#6c614e'],
  wool_grey:  ['#aca89f', '#88857c', '#64625c', '#393835'],
  straw:      ['#f4dc8c', '#dab95f', '#a8893d', '#5b4720'],
  red_cloth:  ['#e2644d', '#b94231', '#852c24', '#491714'],
  felt_red:   ['#ec5e4c', '#c43b2f', '#8f2623', '#4c1112'],
  iron:       ['#bcc4d0', '#8d96a5', '#5e6676', '#2b303a'],
  mail:       ['#aab1bb', '#7f8793', '#58606b', '#292d34'],
  brass:      ['#f2d384', '#cba44c', '#8f6f2b', '#4a3814'],
  glass:      ['#fffbe0', '#fff1a8', '#f2d36a', '#9c7a2a'],
  leather:    ['#b38862', '#8b6345', '#644531', '#352318'],
  leather_dk: ['#7c5c46', '#5b402f', '#402c21', '#20150f'],
  hide_tan:   ['#d4b68b', '#b19063', '#876b46', '#4a3a25'],
  fur:        ['#bba78e', '#917c65', '#67574b', '#352b24'],
  birchbark:  ['#f5f1e6', '#ddd6c3', '#aba38e', '#4b473d'],
  steel:      ['#e3e8ee', '#aab3bf', '#76808f', '#3b414c'],
  black_iron: ['#7a7f88', '#52565e', '#383b41', '#1a1c20'],
  gold:       ['#ffe58a', '#e0b23a', '#a37a1f', '#5c430f'],
  velvet_blue:['#7484dc', '#4b57b0', '#333c82', '#1b1f47'],
  velvet_red: ['#d8566a', '#a8313f', '#7a1f2c', '#3f0c15'],
  robe_brown: ['#a8865f', '#83623f', '#5f452a', '#33240f'],
  linen:      ['#efe7d3', '#d6cbb0', '#b0a486', '#655c48'],
  green_cloth:['#86b866', '#5d8a42', '#41652d', '#223818'],
  oak:        ['#bb8d58', '#906a3e', '#684b2a', '#382816'],
  bone:       ['#f6f0dc', '#ddd3b6', '#b3a888', '#69604a'],
  feather:    ['#ffffff', '#e6e2d8', '#bfb9ab', '#6e6a60'],
  ermine:     ['#ffffff', '#ece9e2', '#c8c3b7', '#3a3832'],
  gem_blue:   ['#e6faff', '#8fd8ff', '#4aa3e8', '#1f4f8a'],
  flame:      ['#fff6c8', '#ffd56a', '#ff9a3a', '#a33a12'],
};

// a live model's zones: its json's meta.loadout -> zone -> the parts (model.json parts) it is made of
export const ZONES = {
  'gunslinger.py': {
    hat: ['hat', 'brim', 'hatband'], coat: ['cape', 'collar', 'lapel.L', 'lapel.R', 'dsleeve.L', 'dsleeve.R'], collar: ['cape', 'collar'],
    lapels: ['lapel.L', 'lapel.R'], sleeves: ['dsleeve.L', 'dsleeve.R'], vest: ['vest'], shirt: ['shirt'], neck: ['bandana'],
    trousers: ['trousers', 'trousers.L', 'trousers.R'], legs: ['trousers.L', 'trousers.R'], boots: ['boot.L', 'boot.R'], spurs: ['spur.L', 'spur.R'],
    hands: ['hand.L', 'hand.R'], hair: ['hair', 'hair.L', 'hair.R', 'hair.0', 'hair.1', 'hair.2'],
  },
  'outlaw.py': {
    hat: ['hat', 'brim', 'hatband', 'band'], coat: ['poncho', 'stripe', 'stripe.001', 'sleeve.L', 'sleeve.R'], collar: ['poncho', 'stripe', 'stripe.001'],
    lapels: [], sleeves: ['sleeve.L', 'sleeve.R'], vest: [], shirt: ['shirt'], neck: ['bandana'],
    trousers: ['trousers', 'trousers.L', 'trousers.R', 'seam.L', 'seam.R'], legs: ['trousers.L', 'trousers.R', 'seam.L', 'seam.R'], boots: ['boot.L', 'boot.R'], spurs: ['spur.L', 'spur.R'],
    hands: ['hand.L', 'hand.R'], hair: ['hair', 'hair.L', 'hair.R'],
  },
};

export const GEAR = [
  // ---- head (shapes on HatHold0: they tip with the hat, and fall off with it)
  {id: 'wool_cap', name: 'Wool cap', slot: 'head', kind: 'clothing', rarity: 'common', weight: .2, armor: 0, desc: 'A knitted cap with a bobble.',
    soon: 'keeps your head warm in the cold',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'cap', mat: 'wool_blue', shape: 'ball', r: [.232, .24, .2], at: [0, .012, 1.66], o: {sides: 10}},
      {on: 'HatHold0', part: 'cap.fold', mat: 'wool_cream', shape: 'tube', r0: .238, r1: .232, len: .075, at: [0, .012, 1.6], o: {sides: 10}},
      {on: 'HatHold0', part: 'cap.bobble', mat: 'wool_cream', shape: 'ball', r: .06, at: [0, .02, 1.88]},
    ]}},
  {id: 'straw_hat', name: 'Straw hat', slot: 'head', kind: 'clothing', rarity: 'common', weight: .3, armor: 0, desc: 'A wide, flat straw hat with a red band.',
    soon: 'shade: the sun\'s glare doesn\'t blind you',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'straw.brim', mat: 'straw', shape: 'disc', r: .43, len: .025, at: [0, .01, 1.665], o: {sides: 12}},
      {on: 'HatHold0', part: 'straw.crown', mat: 'straw', shape: 'tube', r0: .19, r1: .17, len: .13, at: [0, .01, 1.735], o: {sides: 10}},
      {on: 'HatHold0', part: 'straw.band', mat: 'red_cloth', shape: 'tube', r0: .193, r1: .19, len: .035, at: [0, .01, 1.695], o: {sides: 10}},
    ]}},
  {id: 'kettle_helm', name: 'Kettle helm', slot: 'head', kind: 'armor', rarity: 'fine', weight: 3, armor: .08, desc: 'An iron dome with a narrow brim. Heavy, and it rings when hit.',
    soon: 'a lightning rod in thunderstorms',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'helm', mat: 'iron', shape: 'ball', r: [.225, .235, .17], at: [0, .01, 1.7], o: {sides: 10}},
      {on: 'HatHold0', part: 'helm.brim', mat: 'iron', shape: 'disc', r: .3, len: .022, at: [0, .01, 1.64], o: {sides: 12}},
      {on: 'HatHold0', part: 'helm.knob', mat: 'brass', shape: 'ball', r: .035, at: [0, .01, 1.875]},
    ]}},
  {id: 'tomte_cap', name: 'Tomte cap', slot: 'head', kind: 'charm', rarity: 'mythic', weight: .2, armor: 0, desc: 'A tall red cap. Someone will want it back.',
    soon: 'a tomte may take it back if you are rude',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'tomte.crown', mat: 'felt_red', shape: 'ball', r: [.236, .244, .16], at: [0, .012, 1.66], o: {sides: 10}},
      {on: 'HatHold0', part: 'tomte', mat: 'felt_red', shape: 'cone', r: .2, len: .5, at: [0, .157, 1.92], rot: [-28, 0, 0], o: {sides: 9}},
      {on: 'HatHold0', part: 'tomte.band', mat: 'wool_cream', shape: 'tube', r0: .248, r1: .242, len: .07, at: [0, .012, 1.6], o: {sides: 10}},
    ]}},
  {id: 'lamp_cap', name: 'Miner\'s lamp cap', slot: 'head', kind: 'tool', rarity: 'fine', weight: .8, armor: .02, desc: 'A leather cap with a brass lamp: your lantern is always lit.',
    mods: [{stat: 'light.lantern', add: 1}],
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'lampcap', mat: 'leather', shape: 'ball', r: [.232, .24, .19], at: [0, .012, 1.66], o: {sides: 10}},
      {on: 'HatHold0', part: 'lampcap.peak', mat: 'leather_dk', shape: 'box', size: [.28, .11, .02], at: [0, -.25, 1.6], rot: [-12, 0, 0]},
      {on: 'HatHold0', part: 'lamp', mat: 'brass', shape: 'tube', r0: .055, r1: .06, len: .07, at: [0, -.235, 1.72], rot: [90, 0, 0], o: {sides: 8}},
      {on: 'HatHold0', part: 'lamp.glass', mat: 'glass', shape: 'disc', r: .045, len: .01, at: [0, -.273, 1.72], rot: [90, 0, 0], o: {sides: 8, fixed: 0}},
    ]}},
  // ---- body
  {id: 'wool_sweater', name: 'Wool sweater', slot: 'body', kind: 'clothing', rarity: 'common', weight: 1.5, armor: .02, desc: 'A thick knitted sweater instead of the duster.',
    soon: 'warm in the cold; catches fire fast; heavy when soaked',
    look: {paint: {vest: 'wool_cream', shirt: 'wool_cream', sleeves: 'wool_cream'}, hide: ['collar', 'lapels'], cloth: 'off', add: [
      {on: 'Spine2', part: 'sweater.neck', mat: 'wool_cream', shape: 'tube', r0: .1, r1: .085, len: .07, at: [0, .0, 1.235], o: {sides: 10}},
    ]}},
  {id: 'mail_shirt', name: 'Mail shirt', slot: 'body', kind: 'armor', rarity: 'fine', weight: 9, armor: .18, desc: 'Iron rings under the duster. Stops cuts and arrows; you sink in water.',
    soon: 'draws lightning in thunderstorms',
    look: {paint: {vest: 'mail', shirt: 'mail'}}},
  {id: 'smith_apron', name: 'Smith\'s apron', slot: 'body', kind: 'tool', rarity: 'common', weight: 2, armor: .05, desc: 'Thick leather down the front.',
    soon: 'fireproof: stand in a friend\'s fire',
    look: {paint: {vest: 'leather_dk'}, add: [
      {on: 'Spine', part: 'apron', mat: 'leather', shape: 'box', size: [.3, .03, .5], at: [0, -.17, .93]},
      {on: 'Spine2', part: 'apron.bib', mat: 'leather', shape: 'box', size: [.22, .03, .14], at: [0, -.16, 1.15]},
    ]}},
  // ---- back
  {id: 'fur_cloak', name: 'Wolf-fur cloak', slot: 'back', kind: 'clothing', rarity: 'fine', weight: 3, armor: .04, desc: 'The duster\'s cape and tail in grey fur.',
    soon: 'warm in the cold',
    look: {paint: {collar: 'fur'}, cloth: 'fur'}},
  {id: 'bark_pack', name: 'Birch-bark pack', slot: 'back', kind: 'tool', rarity: 'common', weight: 1, armor: 0, desc: 'A woven birch-bark backpack (a näverkont).',
    soon: 'carry more home',
    look: {add: [
      {on: 'Spine2', part: 'pack', mat: 'birchbark', shape: 'box', size: [.3, .17, .36], at: [0, .29, 1.03]},
      {on: 'Spine2', part: 'pack.lid', mat: 'leather', shape: 'box', size: [.31, .18, .05], at: [0, .29, 1.22]},
      {on: 'Spine2', part: 'pack.strap.L', mat: 'leather_dk', shape: 'box', size: [.035, .04, .24], at: [.1, -.16, 1.12]},
      {on: 'Spine2', part: 'pack.strap.R', mat: 'leather_dk', shape: 'box', size: [.035, .04, .24], at: [-.1, -.16, 1.12]},
    ]}},
  // ---- legs
  {id: 'wool_trousers', name: 'Wool trousers', slot: 'legs', kind: 'clothing', rarity: 'common', weight: 1, armor: .01, desc: 'Grey wool breeches.',
    soon: 'warm in the cold',
    look: {paint: {trousers: 'wool_grey'}}},
  {id: 'leather_chaps', name: 'Leather chaps', slot: 'legs', kind: 'armor', rarity: 'common', weight: 2, armor: .04, desc: 'Tan leather over both legs.',
    soon: 'thorns and brambles don\'t slow you',
    look: {paint: {legs: 'hide_tan'}}},
  // ---- feet
  {id: 'moose_boots', name: 'Moose-hide boots', slot: 'feet', kind: 'clothing', rarity: 'fine', weight: 1.5, armor: .01, desc: 'Soft, warm boots. Loud on stone.',
    soon: 'bogs and snow don\'t slow you',
    look: {paint: {boots: 'hide_tan'}, hide: ['spurs']}},
  {id: 'bark_shoes', name: 'Birch-bark shoes', slot: 'feet', kind: 'clothing', rarity: 'fine', weight: .3, armor: 0, desc: 'Woven bark shoes (näverskor). Light on your feet.',
    mods: [{stat: 'player.speed', mul: 1.04}],
    look: {paint: {boots: 'birchbark'}, hide: ['spurs']}},
  {id: 'iron_boots', name: 'Iron-shod boots', slot: 'feet', kind: 'armor', rarity: 'fine', weight: 4, armor: .06, desc: 'Boots with iron plates.',
    look: {paint: {boots: 'iron'}}},
  // ================================================================ the second batch (2026-10-12): hats, armour, clothes and robes,
  // hands, weapons and off-hands. Weapons are CARRIED (no swings or spells yet: the gameplay's next step): swords, axes, spears and
  // staffs on the back, the mace on the left hip; shields on the left forearm; the lantern, torch and book in the left hand.
  // (body space at rest: the arms hang out and down at 45 degrees; the left forearm runs from (.391, 0, .999) to (.561, 0, .829),
  // its outward side (.707, 0, .707); a shield faces forward and out as the arm hangs: its normal at rest (.424, -.8, .424), rot
  // [62, 25, 0] (a kite's length along the forearm: [62, 25, -39]); the left hand is at (.561, 0, .829) and hangs along
  // (.707, 0, -.707): [0, 135, 0] turns a piece's z that way. A torch held up and forward in idle: worked out from the model's idle.0
  // pose (the hand's idle frame against its rest frame), [59, -16, 0])
  // ---- head
  {id: 'wizard_hat', name: 'Wizard\'s hat', slot: 'head', kind: 'clothing', rarity: 'rare', weight: .4, armor: 0, desc: 'A tall, starry hat with a drooping point.',
    soon: 'spells cost less',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'wiz.brim', mat: 'velvet_blue', shape: 'disc', r: .36, len: .02, at: [0, .01, 1.665], o: {sides: 12}},
      {on: 'HatHold0', part: 'wiz.cone', mat: 'velvet_blue', shape: 'cone', r: .19, len: .52, at: [0, .06, 1.92], rot: [-12, 0, 0], o: {sides: 9}},
      {on: 'HatHold0', part: 'wiz.band', mat: 'gold', shape: 'tube', r0: .196, r1: .19, len: .04, at: [0, .015, 1.695], o: {sides: 9}},
      {on: 'HatHold0', part: 'wiz.star', mat: 'gold', shape: 'ball', r: .035, at: [0, -.13, 1.82], o: {fixed: 0}},
    ]}},
  {id: 'hood', name: 'Travelling hood', slot: 'head', kind: 'clothing', rarity: 'common', weight: .4, armor: .01, desc: 'A grey wool hood, the point down your back.',
    soon: 'rain doesn\'t soak you',
    look: {hide: ['hat', 'hair'], add: [
      {on: 'HatHold0', part: 'hood', mat: 'wool_grey', shape: 'ball', r: [.245, .25, .245], at: [0, .07, 1.61], o: {sides: 10}},
      {on: 'HatHold0', part: 'hood.tip', mat: 'wool_grey', shape: 'cone', r: .1, len: .22, at: [0, .32, 1.56], rot: [-135, 0, 0], o: {sides: 7}},
    ]}},
  {id: 'horned_helm', name: 'Horned helm', slot: 'head', kind: 'armor', rarity: 'fine', weight: 3, armor: .08, desc: 'An iron cap with a pair of ox horns.',
    soon: 'a charge knocks foes down',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'horn.helm', mat: 'iron', shape: 'ball', r: [.228, .238, .175], at: [0, .01, 1.69], o: {sides: 10}},
      {on: 'HatHold0', part: 'horn.rim', mat: 'black_iron', shape: 'tube', r0: .235, r1: .23, len: .04, at: [0, .01, 1.6], o: {sides: 10}},
      {on: 'HatHold0', part: 'horn.L', mat: 'bone', shape: 'cone', r: .058, len: .32, at: [.28, .01, 1.8], rot: [0, 50, 0], o: {sides: 7}},
      {on: 'HatHold0', part: 'horn.R', mat: 'bone', shape: 'cone', r: .058, len: .32, at: [-.28, .01, 1.8], rot: [0, -50, 0], o: {sides: 7}},
    ]}},
  {id: 'great_helm', name: 'Great helm', slot: 'head', kind: 'armor', rarity: 'rare', weight: 4.5, armor: .12, desc: 'A steel bucket over the whole head. You see through a slit.',
    soon: 'arrows glance off; you hear less',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'gh.pot', mat: 'steel', shape: 'tube', r0: .24, r1: .228, len: .36, at: [0, .012, 1.58], o: {sides: 10}},
      {on: 'HatHold0', part: 'gh.top', mat: 'steel', shape: 'ball', r: [.228, .228, .07], at: [0, .012, 1.76], o: {sides: 10}},
      {on: 'HatHold0', part: 'gh.slit', mat: 'black_iron', shape: 'box', size: [.22, .03, .028], at: [0, -.232, 1.62], o: {fixed: 3, outline: false}},
      {on: 'HatHold0', part: 'gh.cross', mat: 'gold', shape: 'box', size: [.03, .02, .16], at: [0, -.245, 1.52]},
    ]}},
  {id: 'crown', name: 'Crown', slot: 'head', kind: 'charm', rarity: 'mythic', weight: 1, armor: 0, desc: 'A gold crown with red stones. Heavy is the head.',
    soon: 'merchants charge you more; guards bow',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'crown', mat: 'gold', shape: 'tube', r0: .208, r1: .212, len: .08, at: [0, .012, 1.69], o: {sides: 10}},
      {on: 'HatHold0', part: 'crown.p0', mat: 'gold', shape: 'cone', r: .035, len: .08, at: [0, -.19, 1.77], o: {sides: 5}},
      {on: 'HatHold0', part: 'crown.p1', mat: 'gold', shape: 'cone', r: .035, len: .08, at: [.18, -.06, 1.77], o: {sides: 5}},
      {on: 'HatHold0', part: 'crown.p2', mat: 'gold', shape: 'cone', r: .035, len: .08, at: [-.18, -.06, 1.77], o: {sides: 5}},
      {on: 'HatHold0', part: 'crown.p3', mat: 'gold', shape: 'cone', r: .035, len: .08, at: [.11, .18, 1.77], o: {sides: 5}},
      {on: 'HatHold0', part: 'crown.p4', mat: 'gold', shape: 'cone', r: .035, len: .08, at: [-.11, .18, 1.77], o: {sides: 5}},
      {on: 'HatHold0', part: 'crown.gem', mat: 'velvet_red', shape: 'ball', r: .03, at: [0, -.215, 1.69], o: {fixed: 1}},
    ]}},
  {id: 'headscarf', name: 'Headscarf', slot: 'head', kind: 'clothing', rarity: 'common', weight: .1, armor: 0, desc: 'A red cloth tied over the hair, the ends at the back.',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'scarf', mat: 'red_cloth', shape: 'ball', r: [.218, .23, .16], at: [0, .02, 1.67], o: {sides: 10}},
      {on: 'HatHold0', part: 'scarf.knot', mat: 'red_cloth', shape: 'ball', r: .05, at: [0, .245, 1.6]},
      {on: 'HatHold0', part: 'scarf.tail', mat: 'red_cloth', shape: 'box', size: [.06, .02, .16], at: [.03, .26, 1.5], rot: [10, 0, 12]},
    ]}},
  {id: 'feathered_cap', name: 'Feathered cap', slot: 'head', kind: 'clothing', rarity: 'fine', weight: .2, armor: 0, desc: 'A green hunter\'s cap with a long white feather.',
    soon: 'birds don\'t startle',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'fc.cap', mat: 'green_cloth', shape: 'ball', r: [.222, .232, .14], at: [0, .01, 1.7], o: {sides: 10}},
      {on: 'HatHold0', part: 'fc.peak', mat: 'green_cloth', shape: 'box', size: [.2, .12, .02], at: [0, -.24, 1.64], rot: [-10, 0, 0]},
      {on: 'HatHold0', part: 'fc.feather', mat: 'feather', shape: 'box', size: [.025, .02, .26], at: [.16, .1, 1.84], rot: [-35, 25, 0]},
    ]}},
  {id: 'leather_cap', name: 'Leather cap', slot: 'head', kind: 'armor', rarity: 'common', weight: .4, armor: .02, desc: 'A boiled-leather skullcap.',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'lc', mat: 'leather_dk', shape: 'ball', r: [.226, .236, .155], at: [0, .012, 1.69], o: {sides: 10}},
      {on: 'HatHold0', part: 'lc.rim', mat: 'hide_tan', shape: 'tube', r0: .232, r1: .228, len: .035, at: [0, .012, 1.62], o: {sides: 10}},
    ]}},
  // ---- body
  {id: 'leather_jerkin', name: 'Leather jerkin', slot: 'body', kind: 'armor', rarity: 'common', weight: 3, armor: .05, desc: 'A sleeveless leather coat over the shirt.',
    look: {paint: {vest: 'leather', sleeves: 'linen'}, hide: ['collar', 'lapels'], cloth: 'off', add: [
      {on: 'Hips', part: 'jerkin.belt', mat: 'leather_dk', shape: 'tube', r0: .215, r1: .215, len: .05, at: [0, 0, .82], o: {sides: 10}},
    ]}},
  {id: 'gambeson', name: 'Gambeson', slot: 'body', kind: 'armor', rarity: 'common', weight: 3, armor: .06, desc: 'A quilted linen coat, padded thick.',
    soon: 'warm in the cold',
    look: {paint: {vest: 'linen', shirt: 'linen', sleeves: 'linen'}, hide: ['collar', 'lapels'], cloth: 'off', add: [
      {on: 'Hips', part: 'gamb.skirt', mat: 'linen', shape: 'tube', r0: .25, r1: .22, len: .2, at: [0, 0, .7], o: {sides: 10}},
    ]}},
  {id: 'chain_hauberk', name: 'Chain hauberk', slot: 'body', kind: 'armor', rarity: 'fine', weight: 10, armor: .2, desc: 'A long coat of mail, sleeves and skirt.',
    soon: 'draws lightning; you sink in water',
    look: {paint: {vest: 'mail', shirt: 'mail', sleeves: 'mail'}, hide: ['collar', 'lapels'], cloth: 'off', add: [
      {on: 'Hips', part: 'hauberk.skirt', mat: 'mail', shape: 'tube', r0: .27, r1: .23, len: .3, at: [0, 0, .62], o: {sides: 12}},
    ]}},
  {id: 'plate_cuirass', name: 'Plate cuirass', slot: 'body', kind: 'armor', rarity: 'rare', weight: 14, armor: .28, desc: 'A steel breastplate, pauldrons and a skirt of lames.',
    soon: 'loud: everything hears you coming',
    look: {paint: {vest: 'steel', shirt: 'black_iron', sleeves: 'black_iron'}, hide: ['collar', 'lapels'], cloth: 'off', add: [
      {on: 'Spine2', part: 'plate.chest', mat: 'steel', shape: 'box', size: [.38, .07, .32], at: [0, -.125, 1.06]},
      {on: 'Spine2', part: 'plate.pL', mat: 'steel', shape: 'ball', r: [.11, .12, .09], at: [.21, 0, 1.2], o: {sides: 8}},
      {on: 'Spine2', part: 'plate.pR', mat: 'steel', shape: 'ball', r: [.11, .12, .09], at: [-.21, 0, 1.2], o: {sides: 8}},
      {on: 'Hips', part: 'plate.faulds', mat: 'steel', shape: 'tube', r0: .27, r1: .24, len: .16, at: [0, 0, .72], o: {sides: 10}},
    ]}},
  {id: 'mage_robe', name: 'Mage\'s robe', slot: 'body', kind: 'robe', rarity: 'rare', weight: 1.5, armor: 0, desc: 'A long blue robe with a gold sash, down to the boots.',
    soon: 'spells are stronger; catches fire',
    look: {paint: {vest: 'velvet_blue', shirt: 'velvet_blue', sleeves: 'velvet_blue', trousers: 'velvet_blue'}, hide: ['collar', 'lapels'], cloth: 'off', add: [
      {on: 'Hips', part: 'robe.skirt', mat: 'velvet_blue', shape: 'tube', r0: .32, r1: .22, len: .72, at: [0, 0, .42], o: {sides: 12}},
      {on: 'Hips', part: 'robe.sash', mat: 'gold', shape: 'tube', r0: .225, r1: .222, len: .045, at: [0, 0, .79], o: {sides: 12}},
      {on: 'Hips', part: 'robe.hem', mat: 'gold', shape: 'tube', r0: .325, r1: .322, len: .035, at: [0, 0, .08], o: {sides: 12}},
    ]}},
  {id: 'monk_robe', name: 'Monk\'s robe', slot: 'body', kind: 'robe', rarity: 'common', weight: 1.2, armor: 0, desc: 'A plain brown robe and a rope belt.',
    soon: 'calm: wild animals let you near',
    look: {paint: {vest: 'robe_brown', shirt: 'robe_brown', sleeves: 'robe_brown', trousers: 'robe_brown'}, hide: ['collar', 'lapels'], cloth: 'off', add: [
      {on: 'Hips', part: 'monk.skirt', mat: 'robe_brown', shape: 'tube', r0: .3, r1: .22, len: .7, at: [0, 0, .43], o: {sides: 12}},
      {on: 'Hips', part: 'monk.rope', mat: 'wool_cream', shape: 'tube', r0: .228, r1: .226, len: .03, at: [0, 0, .8], o: {sides: 12}},
      {on: 'Hips', part: 'monk.knot', mat: 'wool_cream', shape: 'box', size: [.03, .03, .2], at: [.08, -.21, .68]},
    ]}},
  {id: 'noble_doublet', name: 'Noble\'s doublet', slot: 'body', kind: 'clothing', rarity: 'masterwork', weight: 1, armor: .01, desc: 'Red velvet with gold buttons.',
    soon: 'nobles talk to you',
    look: {paint: {vest: 'velvet_red', sleeves: 'velvet_red', shirt: 'linen'}, hide: ['collar', 'lapels'], cloth: 'off', add: [
      {on: 'Spine2', part: 'doublet.b0', mat: 'gold', shape: 'ball', r: .018, at: [0, -.155, 1.15], o: {fixed: 1}},
      {on: 'Spine2', part: 'doublet.b1', mat: 'gold', shape: 'ball', r: .018, at: [0, -.16, 1.07], o: {fixed: 1}},
      {on: 'Spine2', part: 'doublet.b2', mat: 'gold', shape: 'ball', r: .018, at: [0, -.155, .99], o: {fixed: 1}},
      {on: 'Hips', part: 'doublet.belt', mat: 'leather_dk', shape: 'tube', r0: .215, r1: .215, len: .045, at: [0, 0, .82], o: {sides: 10}},
    ]}},
  {id: 'tunic', name: 'Tunic', slot: 'body', kind: 'clothing', rarity: 'common', weight: .6, armor: 0, desc: 'A green linen tunic and a belt.',
    look: {paint: {vest: 'green_cloth', shirt: 'green_cloth', sleeves: 'green_cloth'}, hide: ['collar', 'lapels'], cloth: 'off', add: [
      {on: 'Hips', part: 'tunic.skirt', mat: 'green_cloth', shape: 'tube', r0: .24, r1: .22, len: .16, at: [0, 0, .72], o: {sides: 10}},
      {on: 'Hips', part: 'tunic.belt', mat: 'leather_dk', shape: 'tube', r0: .222, r1: .222, len: .04, at: [0, 0, .81], o: {sides: 10}},
    ]}},
  // ---- back
  {id: 'traveller_cloak', name: 'Traveller\'s cloak', slot: 'back', kind: 'clothing', rarity: 'common', weight: 1.5, armor: .01, desc: 'The duster\'s cape and tail in green wool.',
    soon: 'rain runs off',
    look: {paint: {collar: 'green_cloth'}, cloth: 'green_cloth'}},
  {id: 'royal_mantle', name: 'Royal mantle', slot: 'back', kind: 'clothing', rarity: 'masterwork', weight: 3, armor: .02, desc: 'Red velvet trailing behind, an ermine collar, a gold clasp.',
    soon: 'guards let you pass',
    look: {paint: {collar: 'ermine'}, cloth: 'velvet_red', add: [
      {on: 'Spine2', part: 'mantle.clasp', mat: 'gold', shape: 'ball', r: .035, at: [0, -.17, 1.19], o: {fixed: 1}},
    ]}},
  {id: 'quiver', name: 'Quiver', slot: 'back', kind: 'tool', rarity: 'common', weight: 1, armor: 0, desc: 'A leather quiver of arrows over the shoulder.',
    soon: 'carry arrows for a bow',
    look: {add: [
      {on: 'Spine2', part: 'quiver', mat: 'leather', shape: 'tube', r0: .06, r1: .065, len: .52, at: [.1, .21, 1.06], rot: [0, -20, 0], o: {sides: 8}},
      {on: 'Spine2', part: 'quiver.f0', mat: 'feather', shape: 'box', size: [.03, .02, .1], at: [.005, .21, 1.35], rot: [0, -20, 0]},
      {on: 'Spine2', part: 'quiver.f1', mat: 'red_cloth', shape: 'box', size: [.03, .02, .1], at: [.04, .23, 1.34], rot: [0, -20, 0]},
      {on: 'Spine2', part: 'quiver.f2', mat: 'feather', shape: 'box', size: [.03, .02, .1], at: [-.02, .19, 1.33], rot: [0, -20, 0]},
    ]}},
  {id: 'bedroll', name: 'Bedroll', slot: 'back', kind: 'tool', rarity: 'common', weight: 2, armor: 0, desc: 'A rolled blanket strapped across the back.',
    soon: 'rest anywhere',
    look: {add: [
      {on: 'Spine', part: 'bedroll', mat: 'wool_grey', shape: 'tube', r0: .085, r1: .085, len: .46, at: [0, .2, .93], rot: [0, 90, 0], o: {sides: 8}},
      {on: 'Spine', part: 'bedroll.strapL', mat: 'leather_dk', shape: 'tube', r0: .09, r1: .09, len: .03, at: [.13, .2, .93], rot: [0, 90, 0], o: {sides: 8}},
      {on: 'Spine', part: 'bedroll.strapR', mat: 'leather_dk', shape: 'tube', r0: .09, r1: .09, len: .03, at: [-.13, .2, .93], rot: [0, 90, 0], o: {sides: 8}},
    ]}},
  // ---- hands
  {id: 'leather_gloves', name: 'Leather gloves', slot: 'hands', kind: 'clothing', rarity: 'common', weight: .3, armor: .01, desc: 'Riding gloves.',
    soon: 'the lasso doesn\'t burn your hands',
    look: {paint: {hands: 'leather_dk'}}},
  {id: 'iron_gauntlets', name: 'Iron gauntlets', slot: 'hands', kind: 'armor', rarity: 'fine', weight: 1.5, armor: .04, desc: 'Steel-plated gloves with flared cuffs.',
    soon: 'your fists hit harder',
    look: {paint: {hands: 'steel'}, add: [
      {on: 'LeftForeArm', part: 'gaunt.cL', mat: 'steel', shape: 'tube', r0: .042, r1: .052, len: .08, at: [.527, 0, .863], rot: [0, 135, 0], o: {sides: 8}},
      {on: 'RightForeArm', part: 'gaunt.cR', mat: 'steel', shape: 'tube', r0: .042, r1: .052, len: .08, at: [-.527, 0, .863], rot: [0, -135, 0], o: {sides: 8}},
    ]}},
  {id: 'mage_wraps', name: 'Mage\'s wraps', slot: 'hands', kind: 'robe', rarity: 'fine', weight: .1, armor: 0, desc: 'Linen wrappings marked with ink.',
    soon: 'spells are quicker',
    look: {paint: {hands: 'linen'}}},
  // ---- legs
  {id: 'plate_greaves', name: 'Plate greaves', slot: 'legs', kind: 'armor', rarity: 'rare', weight: 6, armor: .1, desc: 'Steel over the shins and thighs.',
    soon: 'kicks hit harder',
    look: {paint: {legs: 'steel', trousers: 'black_iron'}}},
  {id: 'linen_trousers', name: 'Linen trousers', slot: 'legs', kind: 'clothing', rarity: 'common', weight: .5, armor: 0, desc: 'Light summer trousers.',
    look: {paint: {trousers: 'linen'}}},
  // ---- feet
  {id: 'plate_sabatons', name: 'Plate sabatons', slot: 'feet', kind: 'armor', rarity: 'rare', weight: 4, armor: .06, desc: 'Steel shoes. Every step clanks.',
    look: {paint: {boots: 'steel'}, hide: ['spurs']}},
  {id: 'riding_boots', name: 'Riding boots', slot: 'feet', kind: 'clothing', rarity: 'fine', weight: 1.2, armor: .01, desc: 'Tall black boots, spurs on.',
    soon: 'a horse goes faster',
    look: {paint: {boots: 'leather_dk'}}},
  {id: 'fur_boots', name: 'Fur boots', slot: 'feet', kind: 'clothing', rarity: 'common', weight: 1.5, armor: .01, desc: 'Fur-lined winter boots.',
    soon: 'warm feet in the snow',
    look: {paint: {boots: 'fur'}, hide: ['spurs']}},
  // ---- main hand: weapons (carried: no swings yet; the V blow hits harder with a heavy one: weapon.melee)
  {id: 'arming_sword', name: 'Arming sword', slot: 'main', kind: 'weapon', rarity: 'common', weight: 1.4, armor: 0, desc: 'A straight one-handed sword, slung across the back.',
    mods: [{stat: 'weapon.melee', mul: 1.5}], soon: 'swing it (no sword swings yet)',
    look: {add: [
      {on: 'Spine2', part: 'sword.blade', mat: 'steel', shape: 'box', size: [.045, .012, .64], at: [.06, .21, .98], rot: [0, -30, 0]},
      {on: 'Spine2', part: 'sword.guard', mat: 'brass', shape: 'box', size: [.17, .035, .03], at: [-.108, .21, 1.27], rot: [0, -30, 0]},
      {on: 'Spine2', part: 'sword.grip', mat: 'leather_dk', shape: 'tube', r0: .018, r1: .018, len: .13, at: [-.143, .21, 1.331], rot: [0, -30, 0], o: {sides: 6}},
      {on: 'Spine2', part: 'sword.pommel', mat: 'brass', shape: 'ball', r: .03, at: [-.183, .21, 1.4]},
    ]}},
  {id: 'greatsword', name: 'Greatsword', slot: 'main', kind: 'weapon', rarity: 'rare', weight: 3.5, armor: 0, desc: 'A two-handed blade as long as a man\'s leg and more.',
    mods: [{stat: 'weapon.melee', mul: 2.2}], soon: 'wide, slow swings (no sword swings yet)',
    look: {add: [
      {on: 'Spine2', part: 'gs.blade', mat: 'steel', shape: 'box', size: [.07, .016, 1.0], at: [.12, .22, .82], rot: [0, -25, 0]},
      {on: 'Spine2', part: 'gs.guard', mat: 'black_iron', shape: 'box', size: [.26, .04, .04], at: [-.099, .22, 1.291], rot: [0, -25, 0]},
      {on: 'Spine2', part: 'gs.grip', mat: 'leather_dk', shape: 'tube', r0: .02, r1: .02, len: .2, at: [-.141, .22, 1.382], rot: [0, -25, 0], o: {sides: 6}},
      {on: 'Spine2', part: 'gs.pommel', mat: 'black_iron', shape: 'ball', r: .04, at: [-.189, .22, 1.486]},
    ]}},
  {id: 'battle_axe', name: 'Battle axe', slot: 'main', kind: 'weapon', rarity: 'fine', weight: 2.5, armor: 0, desc: 'A bearded axe on a long haft, over the shoulder.',
    mods: [{stat: 'weapon.melee', mul: 1.8}], soon: 'chops wood and foes (no swings yet)',
    look: {add: [
      {on: 'Spine2', part: 'axe.haft', mat: 'oak', shape: 'tube', r0: .022, r1: .022, len: .8, at: [0, .21, .95], rot: [0, 25, 0], o: {sides: 6}},
      {on: 'Spine2', part: 'axe.head', mat: 'steel', shape: 'box', size: [.2, .03, .16], at: [.212, .21, 1.215], rot: [0, 25, 0]},
    ]}},
  {id: 'mace', name: 'Flanged mace', slot: 'main', kind: 'weapon', rarity: 'fine', weight: 2, armor: 0, desc: 'An iron mace hanging from the belt.',
    mods: [{stat: 'weapon.melee', mul: 1.7}], soon: 'dents armour (no swings yet)',
    look: {add: [
      {on: 'Hips', part: 'mace.haft', mat: 'oak', shape: 'tube', r0: .02, r1: .02, len: .34, at: [.25, .06, .62], o: {sides: 6}},
      {on: 'Hips', part: 'mace.head', mat: 'black_iron', shape: 'ball', r: .065, at: [.25, .06, .43], o: {sides: 6}},
    ]}},
  {id: 'spear', name: 'Spear', slot: 'main', kind: 'weapon', rarity: 'fine', weight: 2, armor: 0, desc: 'An ash shaft with a steel point, nearly upright on the back.',
    mods: [{stat: 'weapon.melee', mul: 1.4}], soon: 'reach: hit from further away (no thrusts yet)',
    look: {add: [
      {on: 'Spine2', part: 'spear.shaft', mat: 'oak', shape: 'tube', r0: .02, r1: .02, len: 1.7, at: [.05, .22, .95], rot: [0, -12, 0], o: {sides: 6}},
      {on: 'Spine2', part: 'spear.tip', mat: 'steel', shape: 'cone', r: .035, len: .16, at: [-.144, .22, 1.858], rot: [0, -12, 0], o: {sides: 5}},
    ]}},
  {id: 'quarterstaff', name: 'Quarterstaff', slot: 'main', kind: 'weapon', rarity: 'common', weight: 1.5, armor: 0, desc: 'A plain oak staff, iron-shod at both ends.',
    mods: [{stat: 'weapon.melee', mul: 1.3}], soon: 'trips foes (no swings yet)',
    look: {add: [
      {on: 'Spine2', part: 'qs', mat: 'oak', shape: 'tube', r0: .024, r1: .024, len: 1.75, at: [0, .22, .95], rot: [0, 15, 0], o: {sides: 6}},
      {on: 'Spine2', part: 'qs.capT', mat: 'black_iron', shape: 'tube', r0: .028, r1: .028, len: .06, at: [.224, .22, 1.79], rot: [0, 15, 0], o: {sides: 6}},
      {on: 'Spine2', part: 'qs.capB', mat: 'black_iron', shape: 'tube', r0: .028, r1: .028, len: .06, at: [-.224, .22, .11], rot: [0, 15, 0], o: {sides: 6}},
    ]}},
  {id: 'wizard_staff', name: 'Wizard\'s staff', slot: 'main', kind: 'weapon', rarity: 'masterwork', weight: 1.8, armor: 0, desc: 'Gnarled oak with a glowing blue orb. It lights your way.',
    mods: [{stat: 'light.lantern', add: 1}, {stat: 'light.lanternR', mul: 1.4}], soon: 'cast spells (no spells yet)',
    look: {add: [
      {on: 'Spine2', part: 'staff', mat: 'oak', shape: 'tube', r0: .026, r1: .022, len: 1.65, at: [.03, .22, .95], rot: [0, -15, 0], o: {sides: 6}},
      {on: 'Spine2', part: 'staff.band', mat: 'gold', shape: 'tube', r0: .032, r1: .032, len: .04, at: [-.179, .22, 1.73], rot: [0, -15, 0], o: {sides: 6}},
      {on: 'Spine2', part: 'staff.orb', mat: 'gem_blue', shape: 'ball', r: .065, at: [-.202, .22, 1.815], o: {sides: 8, fixed: 0}},
    ]}},
  // ---- off hand: shields on the left forearm, things held in the left hand
  {id: 'round_shield', name: 'Round shield', slot: 'off', kind: 'armor', rarity: 'common', weight: 3.5, armor: .08, desc: 'Oak boards, an iron rim and boss, on the left arm.',
    soon: 'block (no blocking yet)',
    look: {add: [
      {on: 'LeftForeArm', part: 'shield.rim', mat: 'black_iron', shape: 'disc', r: .235, len: .025, at: [.501, -.048, .939], rot: [62, 25, 0], o: {sides: 12}},
      {on: 'LeftForeArm', part: 'shield', mat: 'oak', shape: 'disc', r: .215, len: .035, at: [.508, -.06, .946], rot: [62, 25, 0], o: {sides: 12}},
      {on: 'LeftForeArm', part: 'shield.boss', mat: 'iron', shape: 'ball', r: .05, at: [.521, -.084, .959], o: {sides: 8}},
    ]}},
  {id: 'kite_shield', name: 'Kite shield', slot: 'off', kind: 'armor', rarity: 'rare', weight: 5, armor: .14, desc: 'A tall steel-faced shield with a red field.',
    soon: 'block arrows (no blocking yet)',
    look: {add: [
      {on: 'LeftForeArm', part: 'kite', mat: 'steel', shape: 'box', size: [.52, .32, .03], at: [.51, -.064, .948], rot: [62, 25, -39]},
      {on: 'LeftForeArm', part: 'kite.field', mat: 'velvet_red', shape: 'box', size: [.44, .24, .012], at: [.516, -.076, .954], rot: [62, 25, -39]},
      {on: 'LeftForeArm', part: 'kite.boss', mat: 'gold', shape: 'ball', r: .035, at: [.523, -.088, .961], o: {fixed: 1}},
    ]}},
  {id: 'buckler', name: 'Buckler', slot: 'off', kind: 'armor', rarity: 'fine', weight: 1.5, armor: .04, desc: 'A small steel fist-shield.',
    soon: 'parry (no parrying yet)',
    look: {add: [
      {on: 'LeftForeArm', part: 'buckler', mat: 'steel', shape: 'disc', r: .12, len: .03, at: [.531, -.056, .919], rot: [62, 25, 0], o: {sides: 10}},
      {on: 'LeftForeArm', part: 'buckler.boss', mat: 'brass', shape: 'ball', r: .035, at: [.541, -.076, .929]},
    ]}},
  {id: 'lantern', name: 'Hand lantern', slot: 'off', kind: 'tool', rarity: 'common', weight: 1, armor: 0, desc: 'A brass lantern in the left hand: your lantern is always lit.',
    mods: [{stat: 'light.lantern', add: 1}],
    look: {add: [
      {on: 'LeftHand', part: 'lant.ring', mat: 'brass', shape: 'tube', r0: .012, r1: .012, len: .07, at: [.625, 0, .765], rot: [0, 135, 0], o: {sides: 5}},
      {on: 'LeftHand', part: 'lant.cap', mat: 'brass', shape: 'cone', r: .06, len: .05, at: [.657, 0, .733], rot: [0, -45, 0], o: {sides: 6}},
      {on: 'LeftHand', part: 'lant.glass', mat: 'glass', shape: 'tube', r0: .05, r1: .05, len: .11, at: [.7, 0, .69], rot: [0, 135, 0], o: {sides: 6, fixed: 0}},
      {on: 'LeftHand', part: 'lant.base', mat: 'brass', shape: 'tube', r0: .058, r1: .058, len: .025, at: [.743, 0, .647], rot: [0, 135, 0], o: {sides: 6}},
    ]}},
  {id: 'torch', name: 'Torch', slot: 'off', kind: 'tool', rarity: 'common', weight: .8, armor: 0, desc: 'A pitch torch, burning. Lights a small warm circle.',
    mods: [{stat: 'light.lantern', add: 1}, {stat: 'light.lanternR', mul: .8}], soon: 'set things alight',
    look: {add: [
      {on: 'LeftHand', part: 'torch', mat: 'oak', shape: 'tube', r0: .022, r1: .028, len: .42, at: [.568, -.093, .851], rot: [59, -16, 0], o: {sides: 6}},
      {on: 'LeftHand', part: 'torch.pitch', mat: 'black_iron', shape: 'tube', r0: .034, r1: .034, len: .07, at: [.519, -.242, .94], rot: [59, -16, 0], o: {sides: 6}},
      {on: 'LeftHand', part: 'torch.flame', mat: 'flame', shape: 'cone', r: .045, len: .14, at: [.497, -.308, .979], rot: [59, -16, 0], o: {sides: 6, fixed: 0, outline: false}},
    ]}},
  {id: 'spellbook', name: 'Spellbook', slot: 'off', kind: 'charm', rarity: 'rare', weight: .8, armor: 0, desc: 'A heavy book bound in black leather, held at your side.',
    soon: 'learn spells',
    look: {add: [
      {on: 'LeftHand', part: 'book', mat: 'leather_dk', shape: 'box', size: [.04, .15, .19], at: [.65, 0, .74], rot: [0, 135, 0]},
      {on: 'LeftHand', part: 'book.pages', mat: 'linen', shape: 'box', size: [.032, .14, .175], at: [.645, .005, .745], rot: [0, 135, 0]},
      {on: 'LeftHand', part: 'book.clasp', mat: 'gold', shape: 'box', size: [.05, .03, .03], at: [.66, -.08, .73], rot: [0, 135, 0], o: {fixed: 1}},
    ]}},
];
export const GEAR_BY_ID = Object.fromEntries(GEAR.map(g => [g.id, g]));
export const gearById = id => GEAR_BY_ID[id] || null;

// a set as asked for (ids, any order, maybe junk) -> the set it can be: known ids, at most one a slot (the later wins), in
// SLOTS order. The co-op server keeps only what this returns (server/room.mjs), the game too (features/gear.js)
export function cleanSet(ids) {
  const by = {};
  if (Array.isArray(ids)) for (const id of ids) { const g = typeof id === 'string' ? GEAR_BY_ID[id] : null; if (g) by[g.slot] = g.id; }
  return SLOTS.map(s => by[s]).filter(Boolean);
}
// a set's numbers: total weight (kg), armor (share, capped), the speed share its weight leaves you
export function setStats(ids) {
  let kg = 0, armor = 0;
  for (const id of ids) { const g = GEAR_BY_ID[id]; if (!g) continue; kg += g.weight || 0; armor += g.armor || 0; }
  armor = Math.min(RULES.ARMOR_MAX, armor);
  const speed = Math.max(RULES.SLOW_MIN, 1 - Math.max(0, kg - RULES.FREE_KG) * RULES.SLOW_PER_KG);
  return {kg, armor, speed};
}
// a set's key: the same pieces give the same key (the look's cache, what co-op sends)
export const setKey = ids => ids.join(',');
