// THE PLAYTEST TOUR (features/tour.js): the guided walk through the game, one STOP at a time. Data only: each stop sets
// the world up (where you stand, the hour, the weather, the season, the camera, things in the pack) and lists a few
// things to do there; a task with `ev` or `check` ticks itself when you've done it.
//
// A STOP:
//   id        a short name (the URL's ?tour=<id> starts there; the progress is kept by it)
//   section   the part of the tour it belongs to (shown over its title)
//   title     a few words
//   where     one line: where you are and what's set
//   world     {hour (0-24), weather (sim/wxclock.js WEATHER: clear, fair, rain, storm, snow, fog, windy, gale, ...),
//             wet (0..1: the ground's), snow (0..1: its snow cover; out of winter none), season (spring | summer | autumn | winter)}: applied offline (co-op: the server's
//             clock and weather stand). Left out: a summer's fair day, the clock where it is
//   view      '' top-down | '3p' third person | '1p' first person (left out: the camera as you have it)
//   needs     a feature's name: the stop is left out when that feature isn't loaded (a PR not in this build)
//   uncanny   true: the uncanny forest on while you're at this stop (off again when you leave)
//   setup(T)  put things in place (T: features/tour.js makeT: go, row, toggle, give, wear, feat, forest, cave, player)
//   leave(T)  undo what only this stop wanted
//   tasks     [{text, ev?: 'type' | ['type', ...] (core/events.js), n? (how many; default 1), when?(e, T) (that event
//             counts only if true), check?(T) (polled: true once is enough)}]. A task with neither is a thing to look
//             at: listed, not ticked, not counted
//
// A FEATURE'S OWN STOPS: a feature can bring its own stops with F.tour?() -> [stop, ...] (the same shape; section
// optional). The tour gathers them when it starts, in the "New tonight" part before the last stop, so a new feature
// slots in without touching this file.
//
// OWNS: nothing (constants). READS: nothing.

const near = (o, dx = 0, dy = 0) => o ? [o.x + dx, o.y + dy] : null;
// the forest's places (world/forest.js layout; seed 1337 numbers in the comments)
const lakeW = T => { const l = T.forest?.lake; return l ? [l.x - l.rx - 1.5, l.y] : null; };      // (-13, -37): the lake's west strand
const lakeE = T => { const l = T.forest?.lake; return l ? [l.x + l.rx + 1.8, l.y + 1] : null; };  // the east strand: open water and wind
const clearing = T => near(T.forest?.clearing, 0, 1.5);                                           // (-4, -51): the open shore clearing
const spring = T => near(T.forest?.spring, 1.4, .6);                                              // (-27, -53): the spring and its stream
const lane = T => near(T.forest?.storm);                                                          // (-5, -91): the old gale's lane, tipped spruces
const where = (T, f) => { const p = f(T); if (p) T.go(p[0], p[1]); };
const is = (k, v) => e => e[k] === v;
const mine = e => e.mine !== false && e.n !== 0;

export const STOPS = [
  // ---------------------------------------------------------------- getting around
  {id: 'welcome', section: 'Getting around', title: 'Welcome to the tour',
    where: 'The forest clearing by the lake, a summer morning',
    world: {hour: 9}, view: '', setup: T => where(T, clearing),
    tasks: [
      {text: 'PgDn: the next stop, PgUp: back, End: hide this card. Esc > Game has the tour\'s rows; F10 > Panels > Playtest tour jumps to any stop'},
      {text: 'Walk (WASD) and sprint (Shift)', check: T => T.sprinting()},
      {text: 'Leap with Space', ev: 'player.jump'},
      {text: 'Tab opens your window (pack, skills, crafting, map). Tab or Esc shuts it', check: T => !!T.feat('pack')?.open},
      {text: 'Turn the camera with Z / X (or drag with the middle mouse button)'},
    ]},
  {id: 'cameras', section: 'Getting around', title: 'Three cameras',
    where: 'The same clearing, now in first person (F6 cycles them)',
    world: {hour: 10}, view: '1p', setup: T => where(T, clearing),
    tasks: [
      {text: 'Click to take the mouse, look up and down'},
      {text: 'F6 round all three: top-down, third person, first person', check: T => T.view() === '3p'},
      {text: 'In first person: chop a tree you look at (E or LMB, the axe)', ev: 'tree.chop', when: (e, T) => T.view() === '1p'},
      {text: 'Crouch (C): the eye drops. Swim in the lake: it drops more'},
      {text: 'In first person you see your hands: they change with what you hold (the axe, fists on 2, the lasso on F)'},
    ]},
  {id: 'ground', section: 'Getting around', title: 'The forest floor in 3D',
    where: 'At the spring, first person: stones, pebbles and twigs are real 3D now',
    world: {hour: 11}, view: '1p', setup: T => where(T, spring),
    tasks: [
      {text: 'Look down at the stream stones and the ring of stones round the spring'},
      {text: 'Walk the stream down to the lake: pebbles on the shore, twigs in the moss'},
      {text: 'F6 until you are back to the view from above: the stones and twigs still show', check: T => T.view() === ''},
    ]},

  // ---------------------------------------------------------------- gathering
  {id: 'forage', section: 'Gathering', title: 'Foraging',
    where: 'The clearing. Plants you can pick are marked so you find them',
    world: {hour: 10}, setup: T => { where(T, clearing); T.toggle('forage', 'Foraging: marks', true); },
    leave: T => T.toggle('forage', 'Foraging: marks', false),
    tasks: [
      {text: 'Pick a plant: walk up to one and press E (or click it)', ev: 'forage.pick', when: mine},
      {text: 'Hold E and walk past a row of plants: 5 picks', ev: 'forage.pick', n: 5, when: mine},
      {text: 'Pick blueberries AND a chanterelle (the yellow mushroom)', check: T => T.has('blueberries') && T.has('chanterelles')},
      {text: 'K opens Skills: your Foraging bar went up'},
    ]},
  {id: 'woodcut', section: 'Gathering', title: 'Trees and their logs',
    where: 'The clearing\'s edge: oak, birch, pine, aspen, willow, rowan',
    world: {hour: 11}, setup: T => where(T, clearing),
    tasks: [
      {text: 'Fell a tree (E or LMB at it, hold to keep chopping)', ev: 'tree.fell', when: mine},
      {text: 'Fell a second one of another kind', ev: 'tree.fell', n: 2, when: mine},
      {text: 'Two kinds of log in your pouch (each tree kind gives its own)', check: T => T.logKinds() >= 2},
      {text: 'Fell one onto a standing tree: that tree shakes and needs one blow less'},
    ]},
  {id: 'campfire', section: 'Gathering', title: 'Campfire and cooking',
    where: 'The clearing, late afternoon. Logs, stones, fish, berries and mushrooms in your pouch',
    world: {hour: 17.5}, setup: T => { where(T, clearing); T.give('log', 10); T.give('stone', 8); T.give('blueberries', 5); T.give('lingonberries', 4); T.give('chanterelles', 3); T.give('perch', 6); },
    tasks: [
      {text: 'Build a campfire: press B (Craft), click Build on the left, then Campfire. It goes down in front of you', ev: 'build.add', when: e => e.mine !== false && e.kind === 'campfire'},
      {text: 'E at the fire puts a log on', ev: 'fire.addWood'},
      {text: 'Cook: next to the burning fire, B (Craft) > Cook > Fish on a stick. You hold it over the flames', ev: 'cook.start'},
      {text: 'Pull it out when it turns golden (E, LMB or Space): that is "just right"', ev: 'cook.pull', when: is('q', 'right')},
      {text: 'New dishes: J (Journal) > Cook journal, click up to 3 kinds of food, then "Try it over the fire". The right mix teaches you a dish'},
      {text: 'A pot for four: B > Cook, click the first row to switch to a pot, then a dish. When it is done, E by the fire takes a spoon', ev: 'pot.spoon'},
    ]},
  {id: 'meals', section: 'Gathering', title: 'Meals that do things',
    where: 'By your fire. A fly agaric (the red mushroom with white spots) and berries in your pouch',
    world: {hour: 18.5}, setup: T => { T.give('fly_agaric', 2); T.give('blueberries', 4); },
    tasks: [
      {text: 'Eat a dish you cooked (or test any dish: F10, search "Mood", then "eat it just right")', ev: 'meal.cook'},
      {text: 'Each dish does its own thing: fried chanterelles make the pick ring, smoked eel lets you see in the dark, blueberry soup leaves glowing footprints'},
      {text: 'A burnt dish does the opposite: burn one and see'},
      {text: 'Fly agaric broth: 1 fly agaric + 2 berries on the test stick (J > Cook journal). 90 s of strange colours, and something stares at you', ev: 'trip.start'},
    ]},
  {id: 'fishing', section: 'Gathering', title: 'Fishing',
    where: 'The lake\'s west shore, a willow rod in your hand',
    world: {hour: 7.5, weather: 'cloudy'}, setup: T => { where(T, lakeW); T.wear('willow_rod'); },
    tasks: [
      {text: 'Hold LMB on the water to charge, let go at the top: a perfect cast', ev: 'fish.cast'},
      {text: 'Wait for the bite (the float goes under)', ev: 'fish.bite'},
      {text: 'Hook it, reel it in: a fish in the pouch', ev: 'fish.catch', when: e => e.n !== 0},
      {text: 'Rings and bubbles on the water are fish feeding: cast onto them and they bite sooner', ev: 'fish.spot'},
    ]},

  // ---------------------------------------------------------------- skills
  {id: 'skills', section: 'Skills', title: 'Skill moves',
    where: 'The clearing. Every skill counts as level 5 here, so you have each skill\'s first special move',
    world: {hour: 10}, setup: T => { where(T, clearing); T.toggle('pack', 'Skills: all the moves', true); T.give('stone', 4); },
    leave: T => T.toggle('pack', 'Skills: all the moves', false),
    tasks: [
      {text: 'The fall line (Woodcutting): chop a tree; just before it falls, the ground trembles where it will land', ev: 'tree.fell', when: mine},
      {text: 'Glimmer (Foraging): crouch (hold C) and keep still: the plants left to pick catch the light'},
      {text: 'K (Skills): click a skill to see its moves. Titles you have earned are there too: click one to wear it'},
      {text: 'Shadows (Fishing): at the lake you see dark fish shapes under the water. Cast so the float lands just in front of one\'s nose', ev: 'fish.shadow', when: is('a', 'nose')},
    ]},

  // ---------------------------------------------------------------- the cave
  {id: 'cave', section: 'The cave', title: 'Into the cave',
    where: 'Underground, at the old miner\'s camp in the cave\'s first room. Your lantern lights by itself down here',
    world: {hour: 12}, setup: T => { if (!T.has('pick')) T.row('mining', 'Mining: the old pick back at the camp'); T.row('mining', 'Mining: to the miner\'s camp'); },
    tasks: [
      {text: 'The camp: a crate, a candle stub, a rusty pick stuck in the wall. Stand by the pick and press E to take it', check: T => T.has('pick')},
      {text: 'Veins are lumps of ore at the foot of the walls; "E mine" shows when you stand at one. Hold E (or click it) till it breaks', ev: 'mine.spent', when: mine},
      {text: 'A harder blow: press E again right as a swing ends (not before, no mashing): a brighter ring', ev: 'mine.hit', when: e => !!e.rhythm},
      {text: 'Iron (dark blue-grey veins, deeper in) is too hard for this old pick: it just clangs off'},
      {text: 'Break a cave crystal (the glowing green ones) with the pick: Glow Shards roll out', check: T => T.has('glow_shard')},
    ]},
  {id: 'dark', section: 'The cave', title: 'Lantern out',
    where: 'Deep in the cave, next to a wall with a hidden vein in it. L puts your lantern out and lights it again',
    world: {hour: 12}, setup: T => { T.row('mining', 'Mining: every vein back'); T.give('pick', 1); T.row('mining', 'Mining: to a night vein'); },
    tasks: [
      {text: 'Press L: your lantern goes out', ev: 'lantern.toggle', when: is('on', false)},
      {text: 'Look at the wall next to you: a patch glitters like a starry sky. That is a night vein: any light near it hides it'},
      {text: 'Mine it in the dark (hold E, or click it): Night Ore', ev: 'mine.spent', when: e => e.kind === 'night' && mine(e)},
      {text: 'L lights the lantern again', ev: 'lantern.toggle', when: is('on', true)},
    ]},
  {id: 'soot', section: 'The cave', title: 'The soot things',
    where: 'The far room where the soot things live. The makings of a Crystal Lamp in your pouch',
    world: {hour: 12}, setup: T => { T.row('cavelife', 'Cave life: to the soot things\' roost'); T.give('glow_shard', 3); T.give('copper_ore', 2); T.give('log', 2); },
    tasks: [
      {text: 'Soot things: small black fluttering creatures that hang here. Keep your lantern lit (L) and wait: they fly at it, circle your head and blow it out', ev: 'lantern.snuff'},
      {text: 'It lights again by itself after 4 s (at once next to a crystal or a lamp)', ev: 'lantern.relight'},
      {text: 'Build a Crystal Lamp: press B (Craft), click Build on the left, then Crystal Lamp. It goes down in front of you', ev: 'build.add', when: e => e.mine !== false && e.kind === 'crystal_lamp'},
      {text: 'The soot things never come into a lamp\'s light: stand by it with your lantern lit'},
      {text: 'Walk up to your lamp and press E: you pick it up and get its makings back', ev: 'build.remove', when: is('kind', 'crystal_lamp')},
    ]},
  {id: 'hollow', section: 'The cave', title: 'A hollow wall',
    where: 'In front of a hollow wall: loose rubble blocking a hidden room. The old pick in your bag',
    world: {hour: 12}, setup: T => { T.row('mining', 'Mining: every vein back'); T.give('pick', 1); T.row('mining', 'Mining: to a hollow wall'); },
    tasks: [
      {text: 'How to spot one: your lantern\'s flame leans toward it, and now and then dust trickles down it'},
      {text: 'Hit it with the pick like a vein (hold E, or click it): it sounds hollow', ev: 'mine.hit', when: e => !!e.hollow},
      {text: 'Six blows and it caves in', ev: 'mine.open'},
      {text: 'Walk in: the room holds copper ore, Glow Shards and an odd keepsake'},
    ]},

  // ---------------------------------------------------------------- the workshop
  {id: 'workshop', section: 'The workshop', title: 'Furnace and anvil',
    where: 'The clearing. Stone, logs, copper ore and an iron bar in your pouch: enough for a furnace, an anvil and a tool',
    world: {hour: 13}, setup: T => { where(T, clearing); T.row('workshop', 'Workshop: makings'); T.give('iron_bar', 1); },
    tasks: [
      {text: 'Build a Clay Furnace: B (Craft) > Build > Clay Furnace. It is lit when it goes down; E at it adds a log', ev: 'build.add', when: e => e.mine !== false && e.kind === 'furnace'},
      {text: 'Next to the furnace press Tab: its panel opens on the right. Click "Load copper"', ev: 'smith.load'},
      {text: 'Blow air in: click (LMB) on the furnace again and again. A click right as the last one ends counts more', ev: 'smith.pump', n: 6},
      {text: 'Wait for a copper bar to slide out onto the stone, then walk over it', ev: 'smith.smelt'},
      {text: 'Build a Stone Anvil (B > Build > Stone Anvil)', ev: 'build.add', when: e => e.mine !== false && e.kind === 'anvil'},
      {text: 'Next to the anvil press Tab: pick a tool and a log for its handle, click "Lay it on the anvil". Then click the anvil to hammer', ev: 'smith.strike', n: 3},
      {text: 'Finish it: a tool of your own', ev: 'smith.make'},
      {text: 'Hover it in your pack (I): it says who made it and on which day. Hold Shift for more'},
    ]},

  // ---------------------------------------------------------------- animals
  {id: 'hare', section: 'Animals', title: 'Lasso a hare',
    where: 'Next to a hare. The lasso is in your bag',
    world: {hour: 8}, setup: T => { T.row('rope', 'Lasso: one in the bag'); T.row('rope', 'Animals: go to the nearest hare'); },
    tasks: [
      {text: 'Hold F to swing the lasso over your head, let go to throw it', ev: 'lasso.throw'},
      {text: 'Get the loop round the hare', ev: 'lasso.catch', when: is('what', 'animal')},
      {text: 'The hare lies stunned for 2 s: press E to pick it up', ev: 'animal.lift'},
      {text: 'A fox slips the rope after 1.5 s (F10, search "nearest fox" to go to one)'},
    ]},
  {id: 'roe', section: 'Animals', title: 'Ride out a roe deer',
    where: 'Next to a roe deer',
    world: {hour: 8.5}, setup: T => T.row('rope', 'Animals: go to the nearest roe deer'),
    tasks: [
      {text: 'Rope it (F): it bolts and drags you. A / D steer, S leans back, F or Space lets go', ev: 'lasso.catch', when: is('what', 'animal')},
      {text: 'Hang on till it\'s tired and stands still', ev: 'animal.tired'},
      {text: 'E calms it: for the rest of the day it lets you walk past', ev: 'animal.calm'},
    ]},
  {id: 'tracks', section: 'Animals', title: 'Morning trails',
    where: 'Dawn after a wet night: soft ground takes every track',
    world: {hour: 6.5, weather: 'fair', wet: 1}, setup: T => { where(T, clearing); T.row('fauna', 'Animals: lay this morning\'s trails'); },
    tasks: [
      {text: 'Find your own footprints in the mud, and a deer\'s, a fox\'s, a hare\'s'},
      {text: 'Follow a fresh trail to its end: a deer\'s bed, a fox den or a hare\'s hiding spot (F10, search "roe bed" to go to one)'},
      {text: 'At a fox den (a dark hole under a rock): press E to reach in', ev: 'animal.den'},
      {text: 'Pick up a shed antler or a feather from the ground: E (F10, search "antler" or "feather")', ev: 'animal.find'},
    ]},
  {id: 'fox', section: 'Animals', title: 'The fox and your perch',
    where: 'The clearing with a perch in your pouch. Foxes steal food left on the ground',
    world: {hour: 15}, setup: T => { where(T, clearing); T.give('perch', 1); },
    tasks: [
      {text: 'I (Pack): right-click the perch in the pouch, click "Put down". Walk 10 m away'},
      {text: 'A fox comes and carries it home (none coming? F10, search "send it now")', ev: 'animal.theft'},
      {text: 'Lasso the fox on its way (F): it drops the perch', ev: 'lasso.catch', when: is('what', 'animal')},
    ]},
  {id: 'lek', section: 'Animals', title: 'The capercaillie\'s lek',
    where: 'A spring morning, next to a capercaillie cock (a big black forest bird) singing to win a mate',
    world: {season: 'spring'}, setup: T => T.row('fauna', 'Animals: start the lek'),
    tasks: [
      {text: 'His song goes click, pop, then a scraping grind. Move only during the grind (he can\'t hear then); stand still otherwise'},
      {text: 'Hear the song', ev: 'wildlife.lek', n: 3},
      {text: 'Get within 3 m: he flies up and leaves you 2 feathers', check: T => T.has('caper_feather')},
    ]},

  // ---------------------------------------------------------------- weather
  {id: 'rain', section: 'Weather', title: 'Rain you feel',
    where: 'The clearing in steady rain. Logs and stones in your pouch',
    world: {hour: 11, weather: 'rain', wet: 1}, setup: T => { where(T, clearing); T.row('body', 'Body: dry and warm'); T.give('log', 8); T.give('stone', 8); },
    tasks: [
      {text: 'Before you get soaked (soaked, you can\'t light a fire): build a Campfire (B > Build). The rain puts it out in about 10 s', ev: 'fire.doused'},
      {text: 'Then build a Stone Fire Ring (B > Build): rain doesn\'t put that one out', ev: 'build.add', when: e => e.mine !== false && e.kind === 'fire_ring'},
      {text: 'Stand in the rain till you drip, then till you\'re soaked (about 1.5 min)', check: T => (T.mem.soaked ||= T.body('wet') > .8)},
      {text: 'Dry off by the fire ring (steam rises off you)', check: T => !!T.mem.soaked && T.body('wet') < .3},
      {text: 'Under a spruce the rain doesn\'t reach you; under a birch only half'},
    ]},
  {id: 'wind', section: 'Weather', title: 'A gale',
    where: 'The old gale\'s lane: spruces blown over with their roots up',
    world: {hour: 14, weather: 'gale'}, setup: T => where(T, lane),
    tasks: [
      {text: 'Walk into the wind on open ground: heavier. With it: pushed along'},
      {text: 'Among the trees you feel it less'},
      {text: 'The wind streaks, flying leaves, your cloak and the trees all lean the same way'},
    ]},
  {id: 'storm', section: 'Weather', title: 'Thunder',
    where: 'The clearing in a thunderstorm. A bolt every 10-20 s',
    world: {hour: 15, weather: 'storm', wet: 1}, setup: T => where(T, clearing),
    tasks: [
      {text: 'A blue crackle on the ground warns 1.5 s before a strike: run', ev: 'thunder.mark'},
      {text: 'See a bolt come down', ev: 'thunder.strike'},
      {text: 'A struck tree burns, and can spread to its neighbours', ev: 'tree.burn'},
      {text: 'Find a splinter of thunderwood at a struck tree\'s foot', check: T => T.has('thunderwood')},
      {text: 'Get hit (or F10, search "bolt on me"): knocked down, never below 1 hp', ev: 'thunder.strike', when: e => !!e.you},
    ]},
  {id: 'fog', section: 'Weather', title: 'Fog at dawn',
    where: 'The lake shore at dawn in thick fog',
    world: {hour: 6, weather: 'fog'}, view: '3p', setup: T => where(T, lakeW),
    tasks: [
      {text: 'Walk the shore in third person: how far can you see?'},
      {text: 'Go up to the high ground north of the lake and look back down'},
      {text: 'F4 photo mode: worth a picture?'},
    ]},

  // ---------------------------------------------------------------- winter
  {id: 'winternight', section: 'Winter', title: 'A winter night',
    where: 'The clearing on a clear winter night. Logs in your pouch',
    world: {hour: 22, weather: 'clear', season: 'winter', snow: .6}, setup: T => { where(T, clearing); T.row('body', 'Body: dry and warm'); T.give('log', 8); },
    tasks: [
      {text: 'Get cold: slower, no sprint, frost creeps in at the edges of the screen', check: T => (T.mem.cold ||= T.body('cold') > .5)},
      {text: 'Your breath shows in the cold'},
      {text: 'Build a Campfire (B > Build) and stand by it till you\'re warm', check: T => !!T.mem.cold && T.body('cold') < .2},
      {text: 'A hot meal keeps the cold off for a while'},
    ]},
  {id: 'snow', section: 'Winter', title: 'Snow',
    where: 'Deep snow and still falling',
    world: {hour: 11, weather: 'snow', season: 'winter'}, setup: T => where(T, clearing),
    tasks: [
      {text: 'You wade: slower, you sink in a little (moose-hide boots take that away)'},
      {text: 'Stand still on snow, nothing near to use, and hold E: a snowball. LMB throws it', ev: 'snow.throw'},
      {text: 'Get hit by one (F10, search "snowball at me")', ev: 'snow.hit'},
      {text: 'Your tracks in the snow: deeper when you sprint. Falling snow fills them'},
    ]},
  {id: 'ice', section: 'Winter', title: 'The frozen lake',
    where: 'The lake shore, the ice thick enough to walk on. The pick and the axe in your bag, the rod in your hand',
    world: {hour: 12, weather: 'clear', season: 'winter', snow: .4}, setup: T => { T.give('pick', 1); T.wear('willow_rod'); T.row('ice', 'Ice: take me to the lake'); },
    tasks: [
      {text: 'Walk out on the ice', check: T => !!T.feat('ice')?.onIce},
      {text: 'Find thin ice (where the stream runs in, or out over the deep water): it cracks under you', ev: 'ice.crack'},
      {text: 'Go through. Hold Space to climb out', ev: 'ice.out'},
      {text: 'Cut a hole: click (LMB) on the ice with the pick (3 blows) or the axe (4)', ev: 'ice.hole'},
      {text: 'Fish through it: stand at the hole, click to drop the line, then click slowly, about once a second', ev: 'fish.jig'},
      {text: 'Stay out a while: something long and dark slides along under you'},
    ]},

  // ---------------------------------------------------------------- the mire
  {id: 'mire', section: 'The mire', title: 'The mire',
    where: 'The boardwalk into the mire (a wet bog up in the hills), a summer afternoon',
    world: {hour: 16}, setup: T => T.row('mire', 'Mire: take me there'),
    tasks: [
      {text: 'Step off the boardwalk onto the soft moss and stand still: you sink', ev: 'mire.sink'},
      {text: 'Space pulls you free', ev: 'mire.free'},
      {text: 'Find the bog body: an old man lying in the peat near the mire\'s edge (F10, search "bog body")'},
      {text: 'Rain floods the mire: the pools grow and parts of the boardwalk go under (F10, search "flood it")'},
    ]},
  {id: 'wisps', section: 'The mire', title: 'Will-o\'-the-wisps',
    where: 'The mire at dusk. Small cold lights hover over the pools',
    world: {hour: 19.6}, setup: T => T.row('mire', 'Mire: take me there'),
    tasks: [
      {text: 'Walk toward the lights: they drift ahead of you. Most lead you into a pool'},
      {text: 'Follow the one with no reflection in the water: it stops over a spot'},
      {text: 'Dig there (E): one of four old things', ev: 'mire.dig'},
      {text: 'Lost? F10, search "night\'s find" takes you to the spot'},
    ]},

  // ---------------------------------------------------------------- keepsakes and the odd things
  {id: 'keepsakes', section: 'Keepsakes', title: 'Keepsakes',
    where: 'The lake shore. One of each keepsake in your pouch: odd finds that each bend a rule while you wear them',
    world: {hour: 10}, setup: T => { where(T, lakeW); T.row('keepsakes', 'Keepsakes: give all'); T.give('log', 4); },
    tasks: [
      {text: 'Wear two: I (Pack), the top row on the left is Charms. Click two keepsakes', check: T => T.charms() >= 2},
      {text: 'Wear the Heron Feather, stand still 3 s in the shallow water at the shore: fish shadows gather. E grabs at one', ev: 'fish.jab'},
      {text: 'Build a Keepsake Shelf (B > Build) and press E by it to put a keepsake on it', ev: 'keep.shelve'},
      {text: 'The Tally Stick counts something you do. To test it: F10, search "notch", click 10 times', ev: 'keep.notch', n: 10},
      {text: 'Hover a keepsake in the pack: some cards lie, differently each time'},
    ]},
  {id: 'uncanny', section: 'Keepsakes', title: 'The uncanny forest',
    where: 'The forest at dusk with the uncanny forest on (the forest\'s strange side at night; normally off)',
    world: {hour: 19.4}, uncanny: true, setup: T => where(T, clearing),
    tasks: [
      {text: 'Walk into the trees at dusk: some trees and rocks slowly move from where they stood', ev: 'uncanny.slide'},
      {text: 'Open a secret: at the quiet stones (F10, search "quiet stones"), stand in the middle at night, lantern out, still, a while', ev: 'uncanny.hum'},
      {text: 'At night, light the lantern (L) and look behind you now and then'},
      {text: 'The Watcher: a pale one-eyed toadstool that peeks at you from behind a trunk (F10, search "watcher" calls it)'},
    ]},

  // ---------------------------------------------------------------- gear
  {id: 'gear', section: 'Gear', title: 'Clothes and the pack',
    where: 'The clearing. I opens the Pack tab: what you wear is on the left',
    world: {hour: 12}, setup: T => where(T, clearing),
    tasks: [
      {text: 'Change what you wear: I (Pack), click a piece on the left', ev: 'gear.wear'},
      {text: 'The faint pieces (No hat, No coat, No cape, Long johns, Barefoot) each take just that one thing off'},
      {text: 'Hover the hood, wool cap, wool sweater or fur cape: the card says how it helps against rain and cold'},
    ]},
  // ---------------------------------------------------------------- new tonight (each only when its feature is in the build)
  {id: 'mods', section: 'New tonight', title: 'Runes and attachments', needs: 'mods',
    where: 'The clearing. Every weapon part in your kit, and a pack of brutes (big enemies) to try them on',
    world: {hour: 14}, setup: T => { where(T, clearing); T.row('mods', 'Weapon mods: every part in the kit'); T.row('mods', 'Weapon mods: a pack of brutes'); },
    tasks: [
      {text: 'A gun suits these best: Esc > Game > Play as > Gunslinger'},
      {text: 'Shift+M opens the weapon bench: fit the Rime Rune (ice)', ev: 'mods.fit'},
      {text: 'Hit a brute three times with it: it freezes', ev: 'mods.freeze'},
      {text: 'Swap to the Ember Rune (fire) and hit the frozen one: a burst of steam', ev: 'mods.react', when: is('id', 'steam')},
      {text: 'The Storm Rune into the pack: the hits jump from one brute to the next', ev: 'mods.arc'},
      {text: 'Try the other parts: the Fork Choke splits a shot in three, the Moth Lens steers it, the Kick Grip (shoot behind you to dash)'},
    ]},
  {id: 'stormrune', section: 'New tonight', title: 'The Storm Rune in the rain', needs: 'mods',
    where: 'The same clearing in heavy rain: the Storm Rune\'s jumps reach further when it\'s wet',
    world: {hour: 15, weather: 'rain', wet: 1}, setup: T => { where(T, clearing); T.row('mods', 'Weapon mods: a pack of brutes'); },
    tasks: [
      {text: 'Storm Rune on, shoot into the pack: the hits jump between them', ev: 'mods.arc', n: 5},
      {text: 'Other runes follow the world too: the Hollow Rune at night, the Rot Rune in the mire'},
    ]},
  {id: 'trollstone', section: 'New tonight', title: 'The troll stone', needs: 'trolls',
    where: 'A grey troll statue shielding its eyes, a few metres north of you, by day',
    world: {hour: 12}, setup: T => T.go(9, -14),
    tasks: [
      {text: 'Press E on the stone three times'},
      {text: 'It wakes up angry for 30 s, then the sun turns it back to stone'},
      {text: 'Small trolls live in burrows; more stones stand around the forest'},
    ]},
  {id: 'trollnight', section: 'New tonight', title: 'Trolls at night', needs: 'trolls',
    where: 'Night. A big troll and a pack of small ones, about 11 m away, awake',
    world: {hour: 21}, setup: T => { where(T, clearing); const f = T.feat('trolls'); if (f?.spawnNear) f.spawnNear('pack'); else T.row('trolls', 'Trolls: a big one and a pack'); },
    tasks: [
      {text: 'Fight them: the big one swings slow and heavy, the small ones swarm'},
      {text: 'Keep them busy till dawn and watch what the sun does'},
    ]},
  {id: 'melee', section: 'New tonight', title: 'Swords and shields', needs: 'melee',
    where: 'The Proving Grounds\' open yard, a sword and a round shield in hand, a brute coming',
    world: {hour: 13}, setup: T => { T.go(20, 15.5); T.feat('melee')?.equip?.('sword', 'round'); T.row('melee', 'Call up a brute to fight'); },
    tasks: [
      {text: '3 picks the weapon, 4 the shield. Click (LMB) for a combo, hold LMB for a heavy blow'},
      {text: 'Space then LMB: a smash from the air'},
      {text: 'RMB raises the shield; raise it just as a blow lands and it\'s a parry'},
      {text: 'R throws the weapon, R again calls it back. Try the Rift Blade\'s throw, and the Wobbler'},
      {text: 'A saber parries bullets back at the gunmen'},
    ]},
  {id: 'raindance', section: 'Night surprises', title: 'The rain dance', needs: 'surprises',
    where: 'The standing stones by day. Walk round them',
    world: {hour: 13}, setup: T => T.row('surprises', 'Surprise: take me to the standing stones'),
    tasks: [
      {text: 'Walk three laps round the stones: a counter at the bottom left counts them'},
      {text: 'The third lap brings a bolt onto the altar stone, and a storm', ev: 'thunder.strike'},
      {text: 'Stuck? F10, search "rain dance"'},
    ]},
  {id: 'fishrain', section: 'Night surprises', title: 'Raining fish, and charged', needs: 'surprises',
    where: 'Out in a thunderstorm',
    world: {hour: 15, weather: 'storm', wet: 1}, setup: T => { where(T, clearing); T.row('surprises', 'Surprise: rain fish on me'); },
    tasks: [
      {text: 'Fish fall out of the clouds and flop about: walk over them'},
      {text: 'Stay out till a bolt hits you (or F10, search "get struck")', ev: 'thunder.strike', when: e => !!e.you},
      {text: 'Hit by a bolt you are charged for a while: sprint, jump and land for a thunderclap; wade in and fish float up'},
      {text: 'Carry a thunderwood splinter (from a struck tree): the bolts come for you'},
    ]},
  {id: 'stars', section: 'Night surprises', title: 'Falling stars', needs: 'surprises',
    where: 'A clear night. One lands near you within about 15 s',
    world: {hour: 23, weather: 'clear'}, setup: T => where(T, clearing),
    tasks: [
      {text: 'Watch the sky: a star falls nearby (or F10, search "star falls")'},
      {text: 'Walk over the shard to take it'},
      {text: 'Take it to the lake shore, wade in and fish: they bite at once', ev: 'fish.bite'},
    ]},
  {id: 'mirror', section: 'Night surprises', title: 'The looking-lake', needs: 'surprises',
    where: 'The lake shore at night',
    world: {hour: 23.5, weather: 'clear'}, setup: T => T.row('surprises', 'Surprise: take me to the lake shore'),
    tasks: [
      {text: 'Swim out and float still for 6 s: the world flips into its mirror image'},
      {text: 'Do it again to flip it back (or F10, search "looking-lake")'},
      {text: 'Dizzy: spin the camera round and round (the mouse in first person, or a middle-button drag)'},
    ]},
  {id: 'gui', section: 'New tonight', title: 'The new window', needs: 'panels',
    where: 'Your stuff in one window with tabs. A few logs, stones and berries in the pack so the tabs aren\'t empty',
    world: {hour: 11}, setup: T => { where(T, clearing); T.give('log', 6); T.give('stone', 8); T.give('blueberries', 5); T.feat('panels')?.open?.('pack'); },
    tasks: [
      {text: 'Tab opens it where you left it. I Pack, Shift+M Weapon, K Skills, B Craft, J Journal, H Map', check: T => { const o = T.feat('panels')?.isOpen; return !!(typeof o === 'function' ? o() : o); }},
      {text: 'Hover anything for its card; right-click a material to put it down; Esc closes'},
      {text: 'The Map (H): the fog lifts where you have walked'},
    ]},
  {id: 'almanac', section: 'New tonight', title: 'The almanac', needs: 'almanac',
    where: 'The field book, top left: chapters of goals that lead you through the world',
    world: {hour: 9}, setup: T => where(T, clearing),
    tasks: [
      {text: 'Read chapter I in the card at the top left. Shift+J folds it away; J opens it in the Journal'},
      {text: 'Meet one of the chapter\'s goals', ev: 'almanac.goal'},
      {text: 'Finish the chapter: its page tears out and you get its gift', ev: 'almanac.chapter'},
      {text: 'After chapter I, "Today" has three daily goals', ev: 'almanac.today'},
      {text: 'J (Journal): the Almanac page has every chapter and its hints'},
    ]},
];
// the last stop: after the features' own (F.tour) and the late arrivals
export const LAST = {id: 'coop', section: 'Together', title: 'Co-op, and what\'s new',
  where: 'The end of the tour. The world goes back to its own clock and weather',
  world: null, setup: T => T.release(),
  tasks: [
    {text: 'Open the co-op link (?mp=1) in two tabs: you both see the same picked patches, fires, pots and holes in the ice'},
    {text: 'The other sees you wet, cold, knocked down, your snowball hits and the animal on your lasso'},
    {text: 'Two pumping one furnace reach iron heat without a bellows'},
    {text: 'Anything new from tonight that has no stop yet: see the project\'s threads'},
  ]};
