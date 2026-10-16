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
  // MINED (features/mining.js, content/mining.js, docs/MINING.md): the cave's veins and crystals, and the old pick that digs them
  // (found driven into the wall at the old miner's camp). Iron asks for a better pick than the old one
  pick: {name: 'Old Pick', kind: 'tool', stack: 1, col: '#c8a070', desc: 'a rusty miner\'s pick, its haft dark with old hands',
    tool: {job: 'mine', tier: 1, power: 1}, pal: {o: '#a8582e', O: '#d07a40'},
    icon: ['............', '..kiiiiik...', '.kiOoooiiik.', 'k.....wh..ik', '......wh...k', '.....wh.....', '.....wh.....', '....wh......',
      '....wh......', '...wh.......', '...wh.......', '..wh........']},
  stone: {name: 'Stone', kind: 'material', col: '#b8b2a6', desc: 'a chunk of grey cave stone',
    icon: ['............', '............', '............', '....pppq....', '...ppppqq...', '..pppppqqq..', '.ppppppqqqq.', '.pppppqqqqq.',
      '..ppqqqqqq..', '............', '............', '............'], pal: {p: '#b8b2a6', q: '#7c766a'}},
  copper_ore: {name: 'Copper Ore', kind: 'material', col: '#5ec4a0', desc: 'grey rock streaked green and rust: there is copper in it',
    pal: {p: '#9a948a', q: '#6c665c', c: '#5ec4a0', C: '#2e8a6a', o: '#c8743a'},
    icon: ['............', '............', '....ppcq....', '...pcCpqq...', '..ppppoqqq..', '.pcCppqqcq..', '.ppopcCqqqq.', '..ppqqqoqq..',
      '...qqqqqq...', '............', '............', '............']},
  iron_ore: {name: 'Iron Ore', kind: 'material', col: '#8a94a8', desc: 'heavy dark rock with a blue-grey sheen',
    pal: {p: '#5c6070', q: '#363a46', s: '#a8b4c8', o: '#8a4a30'},
    icon: ['............', '............', '....pppq....', '...psppqq...', '..ppppsqqq..', '.ppopppqqq..', '.ppppsqqoqq.', '..pspqqqqq..',
      '...qqqqqq...', '............', '............', '............']},
  glow_shard: {name: 'Glow Shard', kind: 'material', col: '#9ad878', desc: 'a sliver of cave crystal; it still glows a little in the dark',
    pal: {a: '#eaffd8', b: '#9ad878', c: '#58a060'},
    icon: ['............', '......a.....', '.....ab.....', '.....abc....', '....aabc....', '....abbc....', '...aabbcc...', '...abbbcc...',
      '....bbcc....', '.....bc.....', '............', '............']},
  night_ore: {name: 'Night Ore', kind: 'material', col: '#7c88c8', desc: 'black rock full of tiny lights, like a piece of the night sky. It shows only in the dark',
    pal: {p: '#2a2c3a', q: '#16161e', s: '#e8f0ff', t: '#8a9ce0'},
    icon: ['............', '............', '....pppq....', '...psppqq...', '..ppptpqsq..', '.pspppqqqq..', '.ppptpqsqqq.', '..ppqsqqtq..',
      '...qqqqqq...', '............', '............', '............']},
  // KEEPSAKES of the cave's sealed rooms (features/mining.js: a hollow wall's cache). Worn in a charm slot each bends a rule
  // (content/keepsakes.js, docs/KEEPSAKES.md); a tally stick's notches redraw its icon (features/keepsakes.js iconOf)
  tally_stick: {name: 'Tally Stick', kind: 'material', col: '#c8a878', desc: 'a stick cut with rows of notches. Someone was counting something, down here, for a long time',
    pal: {w: '#c8a878', d: '#7a5c3a', n: '#3a2a1a'},
    icon: ['..........ww', '.........wwd', '........wnd.', '.......wwd..', '......wnd...', '.....wwd....', '....wnd.....', '...wwd......',
      '..wnd.......', '.wwd........', 'wwd.........', 'dd..........']},
  big_tooth: {name: 'Big Tooth', kind: 'material', col: '#e8dcc0', desc: 'a tooth as long as your hand. Nothing you have seen in the woods has teeth like this',
    pal: {w: '#f2ead6', b: '#c8b894', d: '#7a6c52'},
    icon: ['............', '...wwwwbb...', '..wwwwwbbd..', '..wwwwwbbd..', '...wwwbbd...', '...wwwbbd...', '....wwbd....', '....wwbd....',
      '.....wbd....', '.....wd.....', '......d.....', '............']},
  full_tally_stick: {name: 'Full Tally Stick', kind: 'material', col: '#d8b888', desc: 'a stick cut with rows of notches, every one of them filled. It is warm, and it smells of soot',
    pal: {w: '#a88a5e', d: '#4e3620', n: '#1e140a', c: '#f0dcb0'},
    icon: ['..........ww', '.........wwc', '........wnc.', '.......wwc..', '......wnc...', '.....wwc....', '....wnc.....', '...wwc......',
      '..wnc.......', '.wwc........', 'wwc.........', 'dd..........']},
  // KEEPSAKES (the uncanny forest: features/uncanny.js, docs/UNCANNY.md): odd things the forest's secrets leave you. Worn in a
  // charm slot each bends a rule (content/keepsakes.js, docs/KEEPSAKES.md)
  heron_feather: {name: 'Heron Feather', kind: 'material', col: '#d6dade', desc: 'a long grey feather; it was warm when you picked it up',
    icon: ['..........ff', '.........fgf', '........fgf.', '.......fgf..', '......fgnf..', '.....fgnf...', '....fgnf....', '...fgnf.....',
      '..fgf.......', '..ff........', '.k..........', 'k...........']},
  warm_stone: {name: 'Warm Stone', kind: 'material', col: '#f2c87a', desc: 'a smooth stone from the quiet ring; it stays warm in your hand',
    icon: ['............', '............', '............', '....pppp....', '..pppppppq..', '.pppuupppqq.', '.ppuuuupqqq.', '.pppuuppqqq.',
      '..ppppqqqq..', '....qqqq....', '............', '............']},
  bark_doll: {name: 'Bark Doll', kind: 'material', col: '#c8a070', desc: 'a little figure of bark and twine, left in the hollow under the roots',
    icon: ['.....ee.....', '....eddb....', '....ebbe....', '.....rr.....', '..lbbbbbbl..', '....bbbb....', '....bddb....', '....rbbr....',
      '....bbbb....', '...bb..bb...', '...b....b...', '..dd....dd..']},
  // (the spring at dusk: sim/uncanny.js SECRETS.spring). Its card says one of `lies`, a new one each time the pack opens
  // (ui/packpanel.js); what it does is none of them
  fiddle_string: {name: 'Fiddle String', kind: 'material', col: '#e8dcb0', desc: 'a gut string from a fiddle, coiled',
    pal: {s: '#e8dcb0', S: '#a8946a', p: '#5a3a22', P: '#8a5c34'},
    icon: ['............', '.....pP.....', '....pPPp....', '.....pp.....', '.....ss.....', '....s..s....', '...s.SS.s...', '...s.S.Ss...',
      '...s..SS.s..', '....s....s..', '.....ssss...', '............'],
    lies: ['A fiddle string, wet though it\'s dry. Carry it and the fish will sing to you.', 'It hums when something hunts you.',
      'Whoever carries it is never lost in the dark.', 'A string from a fiddle nobody owns. It wants to go back in the water.', 'It does nothing. Nothing at all.']},
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
