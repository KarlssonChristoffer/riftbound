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

// a log's picture (every species' log: its palette over the bark letters b l d, the end grain e r)
const LOG_ICON = ['............', '............', '............', '............',
  '..lllllllee.', '.lbbbbbbbeee', '.bbdbbbdbere', '.bbbbdbbbeee', '..dddddddee.',
  '............', '............', '............'];
//   wood     a log of a tree species (content/woodcut.js TREES log): a cost that says 'wood' takes any of them (game/inventory.js),
//            fires burn any of them; the workshop's hafts are made of them (content/workshop.js WOODS, docs/WORKSHOP.md)
//   made     a thing made at the workshop (content/workshop.js): its bag slot carries the uid of its record (maker, history)
export const ITEMS = {
  log: {name: 'Oak Log', kind: 'material', col: '#c8a070', desc: 'a length of oak: burns, builds', wood: true, icon: LOG_ICON},
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
  // it keeps the house from the next bolt. Carried, it does the opposite: the bolts come for you (features/surprises/charged.js)
  thunderwood: {name: 'Thunderwood', kind: 'material', col: '#d8c8a0', desc: 'a pale splinter split out of a struck pine, scorched black down one edge. They say it keeps the house safe from lightning',
    pal: {w: '#e4d4aa', d: '#a08a5c', n: '#2a221c', c: '#5a4a3a'},
    icon: ['..........n.', '.........nw.', '........nwd.', '.......nwwd.', '......cwwd..', '.....nwwd...', '....nwwd....', '...cwwd.....',
      '..nwwd......', '.nwd........', '.nd.........', '............']},
  // STAR SHARD (features/surprises/stars.js): what a falling star leaves where it comes down on a clear night. Carried into the lake
  // at night, the lake drinks it: the star frenzy
  star_shard: {name: 'Star Shard', kind: 'material', col: '#cfe8ff', desc: 'a sliver of a fallen star, still warm. It hums louder when you face the lake',
    pal: {w: '#ffffff', c: '#cfe8ff', b: '#7f9cd8', n: '#2a3460'},
    icon: ['............', '.....nn.....', '.....cc.....', '....nwcn....', '.nnccwwccnn.', '..ncwwwwcn..', '...bcwwcb...', '...cwbbwc...',
      '..ncb..bcn..', '..nb....bn..', '............', '............']},
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
  // THE WORKSHOP (features/workshop.js, content/workshop.js, docs/WORKSHOP.md): each tree species' log (oak keeps the id 'log': saves
  // and costs stay valid), the bars a furnace smelts, and the tier-2 tools an anvil makes (each one a record: who made it, of what)
  birch_log: {name: 'Birch Log', kind: 'material', col: '#f0ece0', desc: 'white birch, quick to split; a haft of it swings quick', wood: true, icon: LOG_ICON,
    pal: {b: '#e8e4d8', l: '#f8f6ee', d: '#3a3632', e: '#ecd8b0', r: '#c8a878'}},
  pine_log: {name: 'Pine Log', kind: 'material', col: '#d08a5a', desc: 'red-barked pine, sticky with resin; a haft of it can be lit', wood: true, icon: LOG_ICON,
    pal: {b: '#8a4e2e', l: '#b06a3e', d: '#5a301c', e: '#f0d29a', r: '#c09050'}},
  aspen_log: {name: 'Aspen Log', kind: 'material', col: '#c0c8a8', desc: 'grey-green aspen, light and soft', wood: true, icon: LOG_ICON,
    pal: {b: '#a8b098', l: '#c8d0b8', d: '#6a7260', e: '#ece0c0', r: '#c0aa84'}},
  willow_log: {name: 'Willow Log', kind: 'material', col: '#a89880', desc: 'furrowed willow from the water\'s edge', wood: true, icon: LOG_ICON,
    pal: {b: '#7a6a58', l: '#9a8a74', d: '#4e4234', e: '#e4cca0', r: '#b49470'}},
  rowan_log: {name: 'Rowan Log', kind: 'material', col: '#b0aea6', desc: 'smooth grey rowan, tough for its size', wood: true, icon: LOG_ICON,
    pal: {b: '#8a8a86', l: '#aaa9a2', d: '#5a5a56', e: '#e8cfa4', r: '#b89670'}},
  deadwood: {name: 'Deadwood', kind: 'material', col: '#b8b0a2', desc: 'a dry grey length of a dead tree; it burns fast', wood: true, icon: LOG_ICON,
    pal: {b: '#9a9284', l: '#b8b0a2', d: '#6a6258', e: '#c8bca8', r: '#9a8e78'}},
  copper_bar: {name: 'Copper Bar', kind: 'material', col: '#e0a060', desc: 'a short green-gold bar of copper, still smelling of the fire',
    pal: {c: '#f0c070', C: '#c07a3a', o: '#7a4a22', g: '#7ac4a0'},
    icon: ['............', '............', '............', '............', '...ccccccc..', '..cccccccCC.', '.CCgCCCCCCo.', '.CCCCCCgCoo.',
      '..oooooooo..', '............', '............', '............']},
  iron_bar: {name: 'Iron Bar', kind: 'material', col: '#a8b0bc', desc: 'a dark bar of bloom iron, hammered square',
    pal: {c: '#a8b0bc', C: '#6c7480', o: '#3a3e46', g: '#c8d0dc'},
    icon: ['............', '............', '............', '............', '...ggccccc..', '..cccccccCC.', '.CCCCCCCCCo.', '.CCCCCCCCoo.',
      '..oooooooo..', '............', '............', '............']},
  iron_pick: {name: 'Iron Pick', kind: 'tool', stack: 1, made: true, col: '#d8dee4', desc: 'a miner\'s pick with a forged iron head: it bites iron',
    tool: {job: 'mine', tier: 2, power: 1.25},
    icon: ['............', '..kiiiiik...', '.kiissiiiik.', 'k.....wh..ik', '......wh...k', '.....wh.....', '.....wh.....', '....wh......',
      '....wh......', '...wh.......', '...wh.......', '..wh........']},
  iron_axe: {name: 'Iron Axe', kind: 'tool', stack: 1, made: true, col: '#d8dee4', desc: 'a forged iron axe: it fells the old oaks',
    tool: {job: 'chop', tier: 2, power: 1.25},
    icon: ['.........ss.', '.......iiis.', '....wiiiiis.', '....hiiiiis.', '...wh.kiiis.', '...wh....ss.',
      '..wh........', '..wh........', '.wh.........', '.wh.........', 'wh..........', 'wh..........']},
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
export const START_KIT = [['axe', 1], ['lasso', 1]];   // (the Lasso: old saves get one once, features/rope.js)

export const itemDef = id => ITEMS[id] || null;
// the logs (every species': a cost of 'wood' takes any of them)
export const WOOD_IDS = Object.keys(ITEMS).filter(id => ITEMS[id].wood);
export const inPouch = id => ITEMS[id]?.kind === 'material';
// the named things (content/animals.js NAMED): a den's thimble, ring or button scratched with the name of someone who never played
// here; one item each (id base + '_' + the name's letters: thimble_marta), its own name and the base's look
export const namedId = (base, name) => base + '_' + name.toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
for (const base of NAMED.ids) for (const nm of NAMED.names) {
  const b = ITEMS[base]; if (!b) continue;
  ITEMS[namedId(base, nm)] = {...b, name: `${b.name} "${nm}"`, desc: `${b.desc}; scratched on it: ${nm}`, named: nm};
}
