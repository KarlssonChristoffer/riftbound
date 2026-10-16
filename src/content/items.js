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
  // THE MIRE (features/mire.js, docs/MIRE.md): cloudberries (summer, on its hummocks), bog iron (rusty lumps at its pools' edges)
  cloudberries: {name: 'Cloudberries', kind: 'material', col: '#f0a850', desc: 'amber cloudberries from the mire, soft and tart. Only in summer',
    pal: {A: '#e89038', o: '#f8c070', D: '#a85a20', G: '#5e8a3e', j: '#3e6a2e'},
    icon: ['............', '...GGjjGG...', '..GGGjGGGj..', '....jjj.....', '.....j......', '....oAAo....', '...oAoAoA...', '...AAoAAA...',
      '...ADAADA...', '....AAAA....', '.....DD.....', '............']},
  bog_iron: {name: 'Bog Iron', kind: 'material', col: '#a0603a', desc: 'a rusty, pitted lump from the edge of a mire pool. Smelted, it gives iron',
    pal: {r: '#a0603a', d: '#6a3a22', l: '#c88a5a', k: '#3a2216'},
    icon: ['............', '............', '.....rrl....', '...rrdrrl...', '..rdrrkdrr..', '..rrrdrrrdr.', '.rdrkrrdrrd.', '..rrrdrrkd..',
      '...ddrrdd...', '....kddk....', '............', '............']},
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
  // THUNDERWOOD (features/thunder.js, docs/WEATHER.md): a splinter at the foot of a tree the lightning struck. A keepsake: folklore says
  // it keeps the house from the next bolt. It does nothing yet
  thunderwood: {name: 'Thunderwood', kind: 'material', col: '#d8c8a0', desc: 'a pale splinter split out of a struck pine, scorched black down one edge. They say it keeps the house safe from lightning',
    pal: {w: '#e4d4aa', d: '#a08a5c', n: '#2a221c', c: '#5a4a3a'},
    icon: ['..........n.', '.........nw.', '........nwd.', '.......nwwd.', '......cwwd..', '.....nwwd...', '....nwwd....', '...cwwd.....',
      '..nwwd......', '.nwd........', '.nd.........', '............']},
  // WHAT THE BOG GIVES (features/mire.js: the true wisp's find, one kind a night; docs/MIRE.md). Things people sank in the mire
  // long ago; they do nothing yet
  bog_butter: {name: 'Bog Butter', kind: 'material', col: '#e8e0c0', desc: 'a little wooden keg packed with pale, waxy butter, sunk in the bog a very long time ago. It smells... fine?',
    pal: {w: '#8a6a44', d: '#5a4228', b: '#e8e0c0', h: '#3a2a1a'},
    icon: ['............', '...bbbbbb...', '..bbbbbbbb..', '..wwwwwwww..', '..hwdwwdwh..', '..wwdwwdww..', '..hhhhhhhh..', '..wwdwwdww..',
      '..wwdwwdww..', '..hhhhhhhh..', '...wwwwww...', '............']},
  bronze_ring: {name: 'Bronze Neck Ring', kind: 'material', col: '#c89a48', desc: 'a twisted bronze ring for the neck, green where the peat touched it. Somebody gave it to the bog on purpose',
    pal: {g: '#c89a48', l: '#f0d080', d: '#7a5a24', v: '#5aa080'},
    icon: ['............', '....gggg....', '..ggl..lgg..', '.gl......gg.', '.g........g.', 'gd........dg', 'gd........dv', '.g........g.',
      '.vd......dg.', '..dg....gd..', '...v.gg.....', '............']},
  bent_sword: {name: 'Bent Sword', kind: 'material', col: '#8a94a0', desc: 'an iron sword folded in two before it went into the bog, so no one would use it again',
    pal: {s: '#a8b0bc', d: '#5a6270', h: '#6a4a2a', r: '#8a5a3a'},
    icon: ['............', '.......ss...', '......sd....', '.....sd.....', '....sd......', '...hsd......', '...hh.......', '...hsd......',
      '....sdr.....', '.....sdr....', '......ss....', '............']},
  amber_beads: {name: 'Amber Beads', kind: 'material', col: '#f0a030', desc: 'a string of rough amber beads; held up to the light they glow like honey',
    pal: {a: '#f0a030', l: '#ffd070', d: '#a85a10', t: '#6a4a2a'},
    icon: ['............', '...t....t...', '..t......t..', '.al......al.', '.ad......ad.', '..t......t..', '..al....al..', '..ad....ad..',
      '...tt..tt...', '....alal....', '....adad....', '............']},
  // KEEPSAKES of the cave's sealed rooms (features/mining.js: a hollow wall's cache): they do nothing yet
  tally_stick: {name: 'Tally Stick', kind: 'material', col: '#c8a878', desc: 'a stick cut with rows of notches. Someone was counting something, down here, for a long time',
    pal: {w: '#c8a878', d: '#7a5c3a', n: '#3a2a1a'},
    icon: ['..........ww', '.........wwd', '........wnd.', '.......wwd..', '......wnd...', '.....wwd....', '....wnd.....', '...wwd......',
      '..wnd.......', '.wwd........', 'wwd.........', 'dd..........']},
  big_tooth: {name: 'Big Tooth', kind: 'material', col: '#e8dcc0', desc: 'a tooth as long as your hand. Nothing you have seen in the woods has teeth like this',
    pal: {w: '#f2ead6', b: '#c8b894', d: '#7a6c52'},
    icon: ['............', '...wwwwbb...', '..wwwwwbbd..', '..wwwwwbbd..', '...wwwbbd...', '...wwwbbd...', '....wwbd....', '....wwbd....',
      '.....wbd....', '.....wd.....', '......d.....', '............']},
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
