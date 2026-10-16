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
import {NAMED} from './animals.js';
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
  // THE ANIMALS FOR REAL (features/rope.js, docs/FAUNA.md "The Lasso"): the bag Lasso (F: spin, let go: throw) and what the
  // forest's animals leave you without anything dying
  lasso: {name: 'Lasso', kind: 'tool', stack: 1, col: '#c8a876', desc: 'a coil of hemp rope with a running loop; hold F to spin it, let go to throw',
    tool: {job: 'rope', tier: 1, power: 1}, pal: {a: '#c8a876', m: '#9a7c50', z: '#6a5234'},
    icon: ['............', '....aaaa....', '..aammmmaa..', '.am......ma.', '.a..aaaa..m.', 'am.am..ma.mz', 'am.a....a.mz', '.a.am..ma.z.',
      '.am.aaaa.mz.', '..amm..mmz..', '...zzaazz.m.', '..........mz']},
  hare_fur: {name: 'Hare Fur', kind: 'material', col: '#e4e2dc', desc: 'a soft tuft of hare fur, shed in its moult; it came off in your hands',
    pal: {a: '#f2f0ea', m: '#cfcbc0', z: '#9c968a'},
    icon: ['............', '............', '.....a......', '...aaam.a...', '..aaammaam..', '.aaammmmmma.', '.aammmzmmma.', '..ammzzmmz..',
      '...mmzzmz...', '....z..z....', '............', '............']},
  // FINDS WITHOUT KILLING (features/animalfinds.js, living-animals.md): what the forest drops
  roe_antler: {name: 'Shed Antler', kind: 'material', col: '#e0d2b0', desc: "a roe buck's antler, shed in the winter woods where the herd beds",
    pal: {a: '#efe4c8', m: '#c8b894', z: '#8a7a5a'},
    icon: ['............', '.......a....', '...a...am...', '...am..am...', '....am.am...', '.....amam..a', '......amm.am', '......ammam.', '.....zmmmm..',
      '....zzmz....', '....zz......', '............']},
  caper_feather: {name: 'Capercaillie Feather', kind: 'material', col: '#8a90a8', desc: "a long tail feather from a capercaillie cock's fan, left where he sang",
    pal: {a: '#f2f0ea', m: '#3c4050', z: '#1a1c24'},
    icon: ['............', '.........aa.', '........maa.', '.......mmm..', '......mmzm..', '.....mmzm...', '....mmzm....', '...mmzm.....', '..mmzm......',
      '..mzm.......', '.z..........', 'z...........']},
  // THE FOX'S DEN (features/foxden.js, living-animals.md): what the forest lost, kept under a rock (old boot, rusty key and silver
  // ring are the fishing finds: content/fishing.js)
  brass_button: {name: 'Brass Button', kind: 'material', col: '#e0b860', desc: 'a brass button off somebody\'s coat, dull and dented',
    pal: {a: '#f4d27a', m: '#c89a3a', z: '#7a5a1e'},
    icon: ['............', '............', '....aaam....', '...aammmm...', '..aamzmzmm..', '..ammmmmmz..', '..amzmzmmz..', '..ammmmmzz..', '...mmmmzz...',
      '....mzzz....', '............', '............']},
  lost_mitten: {name: 'Lost Mitten', kind: 'material', col: '#c86a5a', desc: 'a knitted mitten, one of a pair; the other is somewhere',
    pal: {a: '#e88a72', m: '#b85444', z: '#6e2a24'},
    icon: ['............', '....aam.....', '...aammm....', '...ammmm.a..', '...ammmmam..', '...ammmmmm..', '...ammmmmz..', '...ammmmz...', '...zzzzzz...',
      '...azazaz...', '...zzzzzz...', '............']},
  thimble: {name: 'Thimble', kind: 'material', col: '#c8ccd4', desc: 'a little silver thimble, pocked all over',
    pal: {a: '#eef0f4', m: '#a8acb6', z: '#62666e'},
    icon: ['............', '............', '.....aam....', '....amzmm...', '....mmmzm...', '...amzmmzm..', '...mmmzmmm..', '...amzmmzm..', '...mmmmmmz..',
      '..azzzzzzzz.', '............', '............']},
};
// THE CATCHES (content/fishing.js): every fish and find is a material: it goes in the pouch
for (const id of CATCH_IDS) {
  const c = CATCHES[id], ic = catchIcon(id);
  ITEMS[id] = {name: c.name, kind: 'material', col: c.find ? '#c8bca0' : '#a8d0e0', desc: c.desc, icon: ic.rows, pal: ic.pal, catch: true};
}
// THE BAITS (content/fishing.js BAITS): cut at the pack panel, one goes on the hook a cast (features/fishing.js)
for (const id in BAITS) { const b = BAITS[id]; ITEMS[id] = {name: b.name, kind: 'material', col: '#d89a8a', desc: b.desc, icon: b.icon, pal: b.pal, bait: true}; }

// the kit a new world starts with (the bag: tools, food; the pouch: materials)
export const START_KIT = [['axe', 1], ['lasso', 1]];   // (the Lasso: old saves get one once, features/rope.js)

export const itemDef = id => ITEMS[id] || null;
export const inPouch = id => ITEMS[id]?.kind === 'material';
// the named things (content/animals.js NAMED): a den's thimble, ring or button scratched with the name of someone who never played
// here; one item each (id base + '_' + the name's letters: thimble_marta), its own name and the base's look
export const namedId = (base, name) => base + '_' + name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
for (const base of NAMED.ids) for (const nm of NAMED.names) {
  const b = ITEMS[base]; if (!b) continue;
  ITEMS[namedId(base, nm)] = {...b, name: `${b.name} "${nm}"`, desc: `${b.desc}; scratched on it: ${nm}`, named: nm};
}
