// GEAR (data): what a character can wear (docs/GEAR.md). Pure data and pure functions, no imports: the browser (features/gear.js,
// view/dress.js, ui/gearpanel.js) and the co-op server (server/room.mjs: it checks a set before anyone else sees it) read this
// one file.
//   SLOTS      the places a piece goes, in the panel's order. An empty slot is the character's own clothes (the model as made)
//   MATERIALS  the colours a piece is made of: 4 tones (hi, base, shade, dark), turned into the pixelizer's 6 by
//              palette_harm.py's rule (view/rigkit.js ramp6), so a piece is shaded, lined and outlined like the body
//   ZONES      a model's parts by what they are (the hat, the coat, the boots ...), per live model (its json meta.loadout):
//              a piece paints or hides ZONES, so one piece fits every model that names the zone
//   GEAR       the pieces. Each: id, name, slot, weight (kg), armor (share of damage taken off), desc, look, and optionally
//              mods (more modifier notes: host.mods) and soon (what it will do once the game has the system: weather, fire)
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
export const SLOTS = ['head', 'body', 'back', 'legs', 'feet'];
export const SLOT_NAMES = {head: 'Head', body: 'Body', back: 'Back', legs: 'Legs', feet: 'Feet'};

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
};

// a live model's zones: its json's meta.loadout -> zone -> the parts (model.json parts) it is made of
export const ZONES = {
  'gunslinger.py': {
    hat: ['hat', 'brim', 'hatband'], coat: ['cape', 'collar', 'lapel.L', 'lapel.R', 'dsleeve.L', 'dsleeve.R'], collar: ['cape', 'collar'],
    lapels: ['lapel.L', 'lapel.R'], sleeves: ['dsleeve.L', 'dsleeve.R'], vest: ['vest'], shirt: ['shirt'], neck: ['bandana'],
    trousers: ['trousers', 'trousers.L', 'trousers.R'], legs: ['trousers.L', 'trousers.R'], boots: ['boot.L', 'boot.R'], spurs: ['spur.L', 'spur.R'],
  },
  'outlaw.py': {
    hat: ['hat', 'brim', 'hatband', 'band'], coat: ['poncho', 'stripe', 'stripe.001', 'sleeve.L', 'sleeve.R'], collar: ['poncho', 'stripe', 'stripe.001'],
    lapels: [], sleeves: ['sleeve.L', 'sleeve.R'], vest: [], shirt: ['shirt'], neck: ['bandana'],
    trousers: ['trousers', 'trousers.L', 'trousers.R', 'seam.L', 'seam.R'], legs: ['trousers.L', 'trousers.R', 'seam.L', 'seam.R'], boots: ['boot.L', 'boot.R'], spurs: ['spur.L', 'spur.R'],
  },
};

export const GEAR = [
  // ---- head (shapes on HatHold0: they tip with the hat, and fall off with it)
  {id: 'wool_cap', name: 'Wool cap', slot: 'head', weight: .2, armor: 0, desc: 'A knitted cap with a bobble.',
    soon: 'keeps your head warm in the cold',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'cap', mat: 'wool_blue', shape: 'ball', r: [.232, .24, .2], at: [0, .012, 1.66], o: {sides: 10}},
      {on: 'HatHold0', part: 'cap.fold', mat: 'wool_cream', shape: 'tube', r0: .238, r1: .232, len: .075, at: [0, .012, 1.6], o: {sides: 10}},
      {on: 'HatHold0', part: 'cap.bobble', mat: 'wool_cream', shape: 'ball', r: .06, at: [0, .02, 1.88]},
    ]}},
  {id: 'straw_hat', name: 'Straw hat', slot: 'head', weight: .3, armor: 0, desc: 'A wide, flat straw hat with a red band.',
    soon: 'shade: the sun\'s glare doesn\'t blind you',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'straw.brim', mat: 'straw', shape: 'disc', r: .43, len: .025, at: [0, .01, 1.665], o: {sides: 12}},
      {on: 'HatHold0', part: 'straw.crown', mat: 'straw', shape: 'tube', r0: .19, r1: .17, len: .13, at: [0, .01, 1.735], o: {sides: 10}},
      {on: 'HatHold0', part: 'straw.band', mat: 'red_cloth', shape: 'tube', r0: .193, r1: .19, len: .035, at: [0, .01, 1.695], o: {sides: 10}},
    ]}},
  {id: 'kettle_helm', name: 'Kettle helm', slot: 'head', weight: 3, armor: .08, desc: 'An iron dome with a narrow brim. Heavy, and it rings when hit.',
    soon: 'a lightning rod in thunderstorms',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'helm', mat: 'iron', shape: 'ball', r: [.225, .235, .17], at: [0, .01, 1.7], o: {sides: 10}},
      {on: 'HatHold0', part: 'helm.brim', mat: 'iron', shape: 'disc', r: .3, len: .022, at: [0, .01, 1.64], o: {sides: 12}},
      {on: 'HatHold0', part: 'helm.knob', mat: 'brass', shape: 'ball', r: .035, at: [0, .01, 1.875]},
    ]}},
  {id: 'tomte_cap', name: 'Tomte cap', slot: 'head', weight: .2, armor: 0, desc: 'A tall red cap. Someone will want it back.',
    soon: 'a tomte may take it back if you are rude',
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'tomte.crown', mat: 'felt_red', shape: 'ball', r: [.236, .244, .16], at: [0, .012, 1.66], o: {sides: 10}},
      {on: 'HatHold0', part: 'tomte', mat: 'felt_red', shape: 'cone', r: .2, len: .5, at: [0, .157, 1.92], rot: [-28, 0, 0], o: {sides: 9}},
      {on: 'HatHold0', part: 'tomte.band', mat: 'wool_cream', shape: 'tube', r0: .248, r1: .242, len: .07, at: [0, .012, 1.6], o: {sides: 10}},
    ]}},
  {id: 'lamp_cap', name: 'Miner\'s lamp cap', slot: 'head', weight: .8, armor: .02, desc: 'A leather cap with a brass lamp: your lantern is always lit.',
    mods: [{stat: 'light.lantern', add: 1}],
    look: {hide: ['hat'], add: [
      {on: 'HatHold0', part: 'lampcap', mat: 'leather', shape: 'ball', r: [.232, .24, .19], at: [0, .012, 1.66], o: {sides: 10}},
      {on: 'HatHold0', part: 'lampcap.peak', mat: 'leather_dk', shape: 'box', size: [.28, .11, .02], at: [0, -.25, 1.6], rot: [-12, 0, 0]},
      {on: 'HatHold0', part: 'lamp', mat: 'brass', shape: 'tube', r0: .055, r1: .06, len: .07, at: [0, -.235, 1.72], rot: [90, 0, 0], o: {sides: 8}},
      {on: 'HatHold0', part: 'lamp.glass', mat: 'glass', shape: 'disc', r: .045, len: .01, at: [0, -.273, 1.72], rot: [90, 0, 0], o: {sides: 8, fixed: 0}},
    ]}},
  // ---- body
  {id: 'wool_sweater', name: 'Wool sweater', slot: 'body', weight: 1.5, armor: .02, desc: 'A thick knitted sweater instead of the duster.',
    soon: 'warm in the cold; catches fire fast; heavy when soaked',
    look: {paint: {vest: 'wool_cream', shirt: 'wool_cream', sleeves: 'wool_cream'}, hide: ['collar', 'lapels'], cloth: 'off', add: [
      {on: 'Spine2', part: 'sweater.neck', mat: 'wool_cream', shape: 'tube', r0: .1, r1: .085, len: .07, at: [0, .0, 1.235], o: {sides: 10}},
    ]}},
  {id: 'mail_shirt', name: 'Mail shirt', slot: 'body', weight: 9, armor: .18, desc: 'Iron rings under the duster. Stops cuts and arrows; you sink in water.',
    soon: 'draws lightning in thunderstorms',
    look: {paint: {vest: 'mail', shirt: 'mail'}}},
  {id: 'smith_apron', name: 'Smith\'s apron', slot: 'body', weight: 2, armor: .05, desc: 'Thick leather down the front.',
    soon: 'fireproof: stand in a friend\'s fire',
    look: {paint: {vest: 'leather_dk'}, add: [
      {on: 'Spine', part: 'apron', mat: 'leather', shape: 'box', size: [.3, .03, .5], at: [0, -.17, .93]},
      {on: 'Spine2', part: 'apron.bib', mat: 'leather', shape: 'box', size: [.22, .03, .14], at: [0, -.16, 1.15]},
    ]}},
  // ---- back
  {id: 'fur_cloak', name: 'Wolf-fur cloak', slot: 'back', weight: 3, armor: .04, desc: 'The duster\'s cape and tail in grey fur.',
    soon: 'warm in the cold',
    look: {paint: {collar: 'fur'}, cloth: 'fur'}},
  {id: 'bark_pack', name: 'Birch-bark pack', slot: 'back', weight: 1, armor: 0, desc: 'A woven birch-bark backpack (a näverkont).',
    soon: 'carry more home',
    look: {add: [
      {on: 'Spine2', part: 'pack', mat: 'birchbark', shape: 'box', size: [.3, .17, .36], at: [0, .29, 1.03]},
      {on: 'Spine2', part: 'pack.lid', mat: 'leather', shape: 'box', size: [.31, .18, .05], at: [0, .29, 1.22]},
      {on: 'Spine2', part: 'pack.strap.L', mat: 'leather_dk', shape: 'box', size: [.035, .04, .24], at: [.1, -.16, 1.12]},
      {on: 'Spine2', part: 'pack.strap.R', mat: 'leather_dk', shape: 'box', size: [.035, .04, .24], at: [-.1, -.16, 1.12]},
    ]}},
  // ---- legs
  {id: 'wool_trousers', name: 'Wool trousers', slot: 'legs', weight: 1, armor: .01, desc: 'Grey wool breeches.',
    soon: 'warm in the cold',
    look: {paint: {trousers: 'wool_grey'}}},
  {id: 'leather_chaps', name: 'Leather chaps', slot: 'legs', weight: 2, armor: .04, desc: 'Tan leather over both legs.',
    soon: 'thorns and brambles don\'t slow you',
    look: {paint: {legs: 'hide_tan'}}},
  // ---- feet
  {id: 'moose_boots', name: 'Moose-hide boots', slot: 'feet', weight: 1.5, armor: .01, desc: 'Soft, warm boots. Loud on stone.',
    soon: 'bogs and snow don\'t slow you',
    look: {paint: {boots: 'hide_tan'}, hide: ['spurs']}},
  {id: 'bark_shoes', name: 'Birch-bark shoes', slot: 'feet', weight: .3, armor: 0, desc: 'Woven bark shoes (näverskor). Light on your feet.',
    mods: [{stat: 'player.speed', mul: 1.04}],
    look: {paint: {boots: 'birchbark'}, hide: ['spurs']}},
  {id: 'iron_boots', name: 'Iron-shod boots', slot: 'feet', weight: 4, armor: .06, desc: 'Boots with iron plates.',
    look: {paint: {boots: 'iron'}}},
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
