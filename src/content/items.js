// ITEMS: everything the player can carry in the persistent world (docs/GATHERING.md). Pure data, imports nothing.
//   kind     'material': it goes in the POUCH (no limit, no slots) | 'tool' | 'food' | 'gear': it takes a BAG slot
//   stack    (bag kinds) how many share one slot
//   tool     {job, tier, power}: what it works ('chop'), how good a tool it is (a tree asks for a tier: content/woodcut.js),
//            how much one blow does (before the skill's notes)
//   icon     a 12 x 12 pixel picture: rows of palette letters ('.' clear); the outline is added round it when it's drawn
//            (ui/packpanel.js), so only the fills are written here
// The run's perks (game/items.js: Risk of Rain stacking, augments) are something else: they live for one run only.
export const PAL = {
  b: '#7a5232', l: '#9c6e44', d: '#56381f', e: '#dcbc84', r: '#a8824e',   // bark, its light and dark, end grain, a ring
  w: '#a07448', h: '#6a4626',                                              // a haft, its shade
  i: '#8a929c', s: '#d8dee4', k: '#555c66',                                // iron, a ground edge, iron's shade
};

export const ITEMS = {
  log: {name: 'Oak Log', kind: 'material', col: '#c8a070', desc: 'a length of oak: burns, builds',
    icon: ['............', '............', '............', '............',
      '..lllllllee.', '.lbbbbbbbeee', '.bbdbbbdbere', '.bbbbdbbbeee', '..dddddddee.',
      '............', '............', '............']},
  axe: {name: 'Felling Axe', kind: 'tool', stack: 1, col: '#d8dee4', desc: 'fells a tree; the better the axe, the harder the wood',
    tool: {job: 'chop', tier: 1, power: 1},
    icon: ['..........s.', '........iis.', '.....wiiiis.', '.....hiiiis.', '....wh..kis.', '....wh....s.',
      '...wh.......', '...wh.......', '..wh........', '..wh........', '.wh.........', '.wh.........']},
};

// the kit a new world starts with (the bag: tools, food; the pouch: materials)
export const START_KIT = [['axe', 1]];

export const itemDef = id => ITEMS[id] || null;
export const inPouch = id => ITEMS[id]?.kind === 'material';
