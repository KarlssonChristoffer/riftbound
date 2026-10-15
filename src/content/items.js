// ITEMS: everything the player can carry in the persistent world (docs/GATHERING.md). Pure data; it imports only other content
// (the catches: content/fishing.js, docs/FISHING.md).
//   kind     'material': it goes in the POUCH (no limit, no slots) | 'tool' | 'food' | 'gear': it takes a BAG slot
//   stack    (bag kinds) how many share one slot
//   tool     {job, tier, power}: what it works ('chop'), how good a tool it is (a tree asks for a tier: content/woodcut.js),
//            how much one blow does (before the skill's notes)
//   icon     a 12 x 12 pixel picture: rows of palette letters ('.' clear); the outline is added round it when it's drawn
//            (ui/packpanel.js), so only the fills are written here
//   pal      (optional) the icon's own palette letters, over PAL's (the fish: content/fishing.js draws each its own colours)
import {CATCHES, CATCH_IDS, catchIcon, BAITS} from './fishing.js';
// The run's perks (game/items.js: Risk of Rain stacking, augments) are something else: they live for one run only.
export const PAL = {
  b: '#7a5232', l: '#9c6e44', d: '#56381f', e: '#dcbc84', r: '#a8824e',   // bark, its light and dark, end grain, a ring
  w: '#a07448', h: '#6a4626',                                              // a haft, its shade
  i: '#8a929c', s: '#d8dee4', k: '#555c66',                                // iron, a ground edge, iron's shade
  f: '#e4e8ec', g: '#a8b0b8', n: '#4c5058',                                // a heron's feather: its vane, its grey, the dark tip
  p: '#cfcabe', q: '#9a968a', u: '#f2c87a',                                // a smooth pale stone, its shade, a warmth inside it
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
  // FORAGED (features/forage.js, content/forage.js, docs/FORAGING.md): the forest floor's plants, picked. Cooked into meals
  // (content/meals.js); the fly agaric does nothing yet
  blueberries: {name: 'Blueberries', kind: 'material', col: '#8a9ae0', desc: 'a handful of small dark blueberries; they stain your fingers',
    pal: {B: '#3a4a8c', v: '#7a8ad0', D: '#1e2550', G: '#6a9a4a', j: '#3e6a2e'},
    icon: ['............', '........GG..', '.......Gjj..', '......j.....', '..vB..vBB...', '.vBBBvBBBB..', '.BBDBBBDBB..', '..BBBvBBvB..',
      '...vBBBBBBB.', '...BBDBBDBB.', '....BB..BB..', '............']},
  lingonberries: {name: 'Lingonberries', kind: 'material', col: '#f07070', desc: 'bright red lingonberries, tart and a little bitter',
    pal: {R: '#c8303a', o: '#f07070', D: '#6a1018', G: '#3e6a2e', j: '#284a20'},
    icon: ['............', '....jjGG....', '...jGGj.....', '.....j......', '....oR.oR...', '...oRRRRRR..', '...RRDRRDR..', '....RRoRR...',
      '...oRRRRRo..', '...RRDRRRR..', '....RR.RR...', '............']},
  chanterelles: {name: 'Chanterelles', kind: 'material', col: '#f0c060', desc: 'golden chanterelles that smell faintly of apricot',
    pal: {y: '#f8d878', o: '#e0a030', d: '#a86a18'},
    icon: ['............', '............', '.yyyyy......', 'oooooo.yyyy.', '.dooo.ooooo.', '..oo...dood.', '..oo....oo..', '..oo....oo..',
      '.ooo...ooo..', '............', '............', '............']},
  fly_agaric: {name: 'Fly Agaric', kind: 'material', col: '#f05a40', desc: 'Don\'t eat this. (Or do.)',
    pal: {a: '#d8302a', A: '#f05a40', m: '#f2ece0', M: '#c8c0b0'},
    icon: ['............', '....aaaa....', '..aAmaaama..', '.aaaaaAmaaa.', '.amaaaaaaam.', '.MMMMMMMMMM.', '.....mm.....', '.....mM.....',
      '....mmM.....', '....mmMM....', '...MMMMMM...', '............']},
  // KEEPSAKES (the uncanny forest: features/uncanny.js, docs/UNCANNY.md): odd things the forest's secrets leave you. They do
  // nothing yet; they sit in the pouch
  heron_feather: {name: 'Heron Feather', kind: 'material', col: '#d6dade', desc: 'a long grey feather; it was warm when you picked it up',
    icon: ['..........ff', '.........fgf', '........fgf.', '.......fgf..', '......fgnf..', '.....fgnf...', '....fgnf....', '...fgnf.....',
      '..fgf.......', '..ff........', '.k..........', 'k...........']},
  warm_stone: {name: 'Warm Stone', kind: 'material', col: '#f2c87a', desc: 'a smooth stone from the quiet ring; it stays warm in your hand',
    icon: ['............', '............', '............', '....pppp....', '..pppppppq..', '.pppuupppqq.', '.ppuuuupqqq.', '.pppuuppqqq.',
      '..ppppqqqq..', '....qqqq....', '............', '............']},
  bark_doll: {name: 'Bark Doll', kind: 'material', col: '#c8a070', desc: 'a little figure of bark and twine, left in the hollow under the roots',
    icon: ['.....ee.....', '....eddb....', '....ebbe....', '.....rr.....', '..lbbbbbbl..', '....bbbb....', '....bddb....', '....rbbr....',
      '....bbbb....', '...bb..bb...', '...b....b...', '..dd....dd..']},
};
// THE CATCHES (content/fishing.js): every fish and find is a material: it goes in the pouch
for (const id of CATCH_IDS) {
  const c = CATCHES[id], ic = catchIcon(id);
  ITEMS[id] = {name: c.name, kind: 'material', col: c.find ? '#c8bca0' : '#a8d0e0', desc: c.desc, icon: ic.rows, pal: ic.pal, catch: true};
}
// THE BAITS (content/fishing.js BAITS): cut at the pack panel, one goes on the hook a cast (features/fishing.js)
for (const id in BAITS) { const b = BAITS[id]; ITEMS[id] = {name: b.name, kind: 'material', col: '#d89a8a', desc: b.desc, icon: b.icon, pal: b.pal, bait: true}; }

// the kit a new world starts with (the bag: tools, food; the pouch: materials)
export const START_KIT = [['axe', 1]];

export const itemDef = id => ITEMS[id] || null;
export const inPouch = id => ITEMS[id]?.kind === 'material';
