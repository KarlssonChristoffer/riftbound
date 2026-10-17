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
      {text: 'Open the pack with Tab', check: T => !!T.feat('pack')?.open},
      {text: 'Turn the camera with Z / X (or drag the middle mouse button)'},
    ]},
  {id: 'cameras', section: 'Getting around', title: 'Three cameras',
    where: 'The same clearing, now in first person (F6 cycles them)',
    world: {hour: 10}, view: '1p', setup: T => where(T, clearing),
    tasks: [
      {text: 'Click to take the mouse, look up and down'},
      {text: 'F6 round all three: top-down, third person, first person', check: T => T.view() === '3p'},
      {text: 'In first person: chop a tree you look at (E or LMB, the axe)', ev: 'tree.chop', when: (e, T) => T.view() === '1p'},
      {text: 'Crouch (C): the eye drops. Swim in the lake: it drops more'},
      {text: 'The pixel hands change with the tool: axe, fists (2), lasso, lantern'},
    ]},
  {id: 'ground', section: 'Getting around', title: 'The forest floor in 3D',
    where: 'At the spring, first person: stones, pebbles and twigs are real 3D now',
    world: {hour: 11}, view: '1p', setup: T => where(T, spring),
    tasks: [
      {text: 'Look down at the stream stones and the spring\'s ring of stones'},
      {text: 'Walk the stream down to the lake: pebbles on the strand, twigs in the moss'},
      {text: 'Back to top-down (F6 until it is) and see they still read from above', check: T => T.view() === ''},
    ]},

  // ---------------------------------------------------------------- gathering
  {id: 'forage', section: 'Gathering', title: 'Foraging',
    where: 'The clearing, marks on the patches so you find them',
    world: {hour: 10}, setup: T => { where(T, clearing); T.toggle('forage', 'Foraging: marks', true); },
    leave: T => T.toggle('forage', 'Foraging: marks', false),
    tasks: [
      {text: 'Pick a patch: E at a plant, or LMB on one', ev: 'forage.pick', when: mine},
      {text: 'Hold E and walk past a row of patches: 5 picks', ev: 'forage.pick', n: 5, when: mine},
      {text: 'Pick blueberries AND a chanterelle', check: T => T.has('blueberries') && T.has('chanterelles')},
      {text: 'Tab: Foraging XP went up. Picked shrubs keep their twigs'},
    ]},
  {id: 'woodcut', section: 'Gathering', title: 'Trees and their logs',
    where: 'The clearing\'s edge: oak, birch, pine, aspen, willow, rowan',
    world: {hour: 11}, setup: T => where(T, clearing),
    tasks: [
      {text: 'Fell a tree (E or LMB at it, hold to keep chopping)', ev: 'tree.fell', when: mine},
      {text: 'Fell a second one of another kind', ev: 'tree.fell', n: 2, when: mine},
      {text: 'Two kinds of log in the pouch (each species its own)', check: T => T.logKinds() >= 2},
      {text: 'Fell one onto a standing tree: it shakes and loses a blow'},
    ]},
  {id: 'campfire', section: 'Gathering', title: 'Campfire and cooking',
    where: 'The clearing. Logs and fire-ring stone in the pouch, a fish and berries too',
    world: {hour: 17.5}, setup: T => { where(T, clearing); T.give('log', 10); T.give('stone', 8); T.give('blueberries', 4); T.give('lingonberries', 4); T.give('chanterelles', 3); T.row('foxden', 'Fox: a perch in the bag'); },
    tasks: [
      {text: 'Tab > Build: a Campfire (4 logs)', ev: 'build.add', when: e => e.mine !== false && e.kind === 'campfire'},
      {text: 'E at the fire puts a log on', ev: 'fire.addWood'},
      {text: 'Tab > Cook by the burning fire: a dish goes on the stick', ev: 'cook.start'},
      {text: 'Pull it out just right, when it turns golden (E, LMB or Space)', ev: 'cook.pull', when: is('q', 'right')},
      {text: 'Try the test stick: up to 3 foods, the right mix teaches a dish'},
      {text: 'Cook\'s first row: a shared pot for four. Take a spoon (E)', ev: 'pot.spoon'},
    ]},
  {id: 'meals', section: 'Gathering', title: 'Meals that do things',
    where: 'By your fire. F10 > Meals: Mood (dev) serves any dish',
    world: {hour: 18.5}, setup: T => { T.give('fly_agaric', 2); T.give('blueberries', 4); },
    tasks: [
      {text: 'A meal eaten (a dish you cooked, or Mood (dev): eat it just right)', ev: 'meal.cook'},
      {text: 'Ringing pick, Eel eyes, Blue fingers, Fish come to you, Heavy as a pike: each does its own thing'},
      {text: 'Burnt turns the effect round: try one burnt'},
      {text: 'Fly agaric broth (1 fly agaric + 2 berries), or F10 > Trip: 90 s of colours. The Watcher stares', ev: 'trip.start'},
    ]},
  {id: 'fishing', section: 'Gathering', title: 'Fishing',
    where: 'The lake\'s west strand, a willow switch in your hand',
    world: {hour: 7.5, weather: 'cloudy'}, setup: T => { where(T, lakeW); T.wear('willow_rod'); },
    tasks: [
      {text: 'Hold LMB on the water to charge, let go at the top: a perfect cast', ev: 'fish.cast'},
      {text: 'Wait for the bite (the bobber goes under)', ev: 'fish.bite'},
      {text: 'Hook it, reel it in: a fish in the pouch', ev: 'fish.catch', when: e => e.n !== 0},
      {text: 'Look for the rings where fish rise: the spots bite better'},
    ]},

  // ---------------------------------------------------------------- skills
  {id: 'skills', section: 'Skills', title: 'Skill moves',
    where: 'The clearing. Every skill counts as level 5 for its moves here',
    world: {hour: 10}, setup: T => { where(T, clearing); T.toggle('pack', 'Skills: all the moves', true); T.give('stone', 4); },
    leave: T => T.toggle('pack', 'Skills: all the moves', false),
    tasks: [
      {text: 'Fall line: chop a tree; dots shiver where it will land', ev: 'tree.fell', when: mine},
      {text: 'Glimmer: hold C, stand still. A wave shows the unpicked patches'},
      {text: 'Fell a tree onto a crate or a dummy: it takes the hit'},
      {text: 'Tab: the moves you have under each skill\'s bar. Click the title under PACK to wear one'},
      {text: 'Shadows: at the lake, drop the bobber just in front of a fish shadow\'s nose', ev: 'fish.shadow', when: is('a', 'nose')},
    ]},

  // ---------------------------------------------------------------- the cave
  {id: 'cave', section: 'The cave', title: 'Into the cave',
    where: 'The old miner\'s camp in the first room',
    world: {hour: 12}, setup: T => T.row('mining', 'Mining: to the miner\'s camp'),
    tasks: [
      {text: 'Take the Old Pick from the camp (E)', check: T => T.has('pick')},
      {text: 'Mine a stone or copper vein till it breaks', ev: 'mine.spent', when: mine},
      {text: 'Rhythm: press again at the end of the swing (a harder blow)', ev: 'mine.hit', when: e => !!e.rhythm},
      {text: 'Iron refuses the old pick: find an iron vein and try'},
      {text: 'Break a cave crystal: Glow Shards', check: T => T.has('glow_shard')},
    ]},
  {id: 'dark', section: 'The cave', title: 'Lantern out',
    where: 'Deeper in the cave. L puts the lantern out and lights it',
    world: {hour: 12}, setup: T => { T.row('mining', 'Mining: to a night vein'); T.give('glow_shard', 3); T.give('copper_ore', 2); T.give('log', 2); },
    tasks: [
      {text: 'Put the lantern out (L): night veins glimmer in the dark', ev: 'lantern.toggle', when: is('on', false)},
      {text: 'Let the soot things snuff it; it lights again after 4 s', ev: 'lantern.snuff'},
      {text: 'Tab > Build: a Crystal Lamp. E at it takes it back', ev: 'build.add', when: e => e.mine !== false && e.kind === 'crystal_lamp'},
      {text: 'Find a hollow wall (it knocks differently, dust trickles) and open it: 6 blows', ev: 'mine.open'},
      {text: 'No mist stripes on the floor under the overhang'},
    ]},

  // ---------------------------------------------------------------- the workshop
  {id: 'workshop', section: 'The workshop', title: 'Furnace and anvil',
    where: 'The clearing, with the makings of a furnace, an anvil and a tool',
    world: {hour: 13}, setup: T => { where(T, clearing); T.row('workshop', 'Workshop: makings'); },
    tasks: [
      {text: 'Tab > Build: a Clay Furnace. E feeds it a log', ev: 'build.add', when: e => e.mine !== false && e.kind === 'furnace'},
      {text: 'Tab at the furnace: load copper', ev: 'smith.load'},
      {text: 'Pump (LMB, in rhythm counts more) to a red glow', ev: 'smith.pump', n: 6},
      {text: 'Take the bar that slides out', ev: 'smith.smelt'},
      {text: 'Build a Stone Anvil, pick a tool and a haft, LMB hammers: 6 blows', ev: 'smith.strike', n: 6},
      {text: 'A tool of your own', ev: 'smith.make'},
      {text: 'Hover it in the pack: "Forged by ... on day ...". Shift shows the rest'},
    ]},

  // ---------------------------------------------------------------- animals
  {id: 'hare', section: 'Animals', title: 'Lasso a hare',
    where: 'Next to a hare. The lasso is in the bag (F)',
    world: {hour: 8}, setup: T => { T.row('rope', 'Lasso: one in the bag'); T.row('rope', 'Animals: go to the nearest hare'); },
    tasks: [
      {text: 'Hold F to spin, let go to throw', ev: 'lasso.throw'},
      {text: 'Catch an animal', ev: 'lasso.catch', when: is('what', 'animal')},
      {text: 'The hare lies dazed for 2 s: E lifts it', ev: 'animal.lift'},
      {text: 'Rope a fox: it tears loose after 1.5 s (F10 > Animals: go to the nearest fox)'},
    ]},
  {id: 'roe', section: 'Animals', title: 'Ride out a roe deer',
    where: 'Next to a roe deer',
    world: {hour: 8.5}, setup: T => T.row('rope', 'Animals: go to the nearest roe deer'),
    tasks: [
      {text: 'Rope it: it drags you off. A/D steer, S leans back, F or Space lets go', ev: 'lasso.catch', when: is('what', 'animal')},
      {text: 'Hang on till it\'s tired and stands', ev: 'animal.tired'},
      {text: 'E calms it: for the rest of the day it lets you walk past', ev: 'animal.calm'},
    ]},
  {id: 'tracks', section: 'Animals', title: 'Morning trails',
    where: 'Dawn after a wet night: soft ground takes every track',
    world: {hour: 6.5, weather: 'fair', wet: 1}, setup: T => { where(T, clearing); T.row('fauna', 'Animals: lay this morning\'s trails'); },
    tasks: [
      {text: 'Find your own prints in the mud, and a deer\'s, a fox\'s, a hare\'s'},
      {text: 'Follow a fresh trail to its end: a roe bed, a fox den or a hare\'s form (F10 > Animals: go to the nearest roe bed)'},
      {text: 'At a den: E reaches in', ev: 'animal.den'},
      {text: 'Pick up a shed antler or a feather (F10 > Finds)', ev: 'animal.find'},
    ]},
  {id: 'fox', section: 'Animals', title: 'The fox and your perch',
    where: 'The clearing with a perch in the bag. This fox steals often',
    world: {hour: 15}, setup: T => { where(T, clearing); T.row('foxden', 'Fox: a perch in the bag'); },
    tasks: [
      {text: 'Tab, right-click the perch, "Put down". Walk 10 m away'},
      {text: 'The fox comes and carries it home (or F10 > Fox: send it now)', ev: 'animal.theft'},
      {text: 'Lasso it on the way and it drops the perch', ev: 'lasso.catch', when: is('what', 'animal')},
    ]},
  {id: 'lek', section: 'Animals', title: 'The capercaillie\'s lek',
    where: 'A spring morning, by the nearest cock',
    world: {season: 'spring'}, setup: T => T.row('fauna', 'Animals: start the lek'),
    tasks: [
      {text: 'Move only while he grinds (the scraping part of his song); stand still otherwise'},
      {text: 'Hear the song: click, pop, grind', ev: 'wildlife.lek', n: 3},
      {text: 'Get within 3 m: he flies up and leaves you 2 feathers', check: T => T.has('caper_feather')},
    ]},

  // ---------------------------------------------------------------- weather
  {id: 'rain', section: 'Weather', title: 'Rain you feel',
    where: 'The clearing in steady rain',
    world: {hour: 11, weather: 'rain', wet: 1}, setup: T => { where(T, clearing); T.row('body', 'Body: dry and warm'); T.give('log', 8); T.give('stone', 8); },
    tasks: [
      {text: 'Stand in the rain till you drip, then till you\'re soaked (about 1.5 min)', check: T => (T.mem.soaked ||= T.body('wet') > .8)},
      {text: 'Under a spruce the rain doesn\'t reach you; under a birch half'},
      {text: 'Light a Campfire in the rain: it goes out in about 10 s with a hiss', ev: 'fire.doused'},
      {text: 'A Stone Fire Ring holds. Dry off by it (steam rises off you)', check: T => !!T.mem.soaked && T.body('wet') < .3},
      {text: 'Puddles and the lake show scattered drops, no diagonal stripes'},
    ]},
  {id: 'wind', section: 'Weather', title: 'A gale',
    where: 'The old gale\'s lane, tipped spruces with their root plates up',
    world: {hour: 14, weather: 'gale'}, setup: T => where(T, lane),
    tasks: [
      {text: 'Walk into the wind on open ground: heavier. With it: pushed along'},
      {text: 'Among the trees you feel it less'},
      {text: 'Wind lines, flying leaves, the cloak and the trees all lean the same way'},
    ]},
  {id: 'storm', section: 'Weather', title: 'Thunder',
    where: 'The clearing in a thunderstorm. A bolt every 10-20 s',
    world: {hour: 15, weather: 'storm', wet: 1}, setup: T => where(T, clearing),
    tasks: [
      {text: 'Watch for the blue crackle 1.5 s before a strike, and run', ev: 'thunder.mark'},
      {text: 'See a bolt come down', ev: 'thunder.strike'},
      {text: 'A struck tree burns, and can spread to its neighbours', ev: 'tree.burn'},
      {text: 'Find a sliver of thunderwood at a struck tree\'s foot', check: T => T.has('thunderwood')},
      {text: 'Get hit (F10 > Thunder: a bolt on me): knocked down, never below 1 hp', ev: 'thunder.strike', when: e => !!e.you},
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
    where: 'The clearing on a clear winter night. Logs in the pouch',
    world: {hour: 22, weather: 'clear', season: 'winter', snow: .6}, setup: T => { where(T, clearing); T.row('body', 'Body: dry and warm'); T.give('log', 8); },
    tasks: [
      {text: 'Get cold: slower, no sprint, frost creeps in at the edges', check: T => (T.mem.cold ||= T.body('cold') > .5)},
      {text: 'Your breath shows in the cold'},
      {text: 'Build a Campfire and warm up by it', check: T => !!T.mem.cold && T.body('cold') < .2},
      {text: 'A hot meal keeps the cold off for a while'},
    ]},
  {id: 'snow', section: 'Winter', title: 'Snow',
    where: 'Deep snow and still falling',
    world: {hour: 11, weather: 'snow', season: 'winter'}, setup: T => where(T, clearing),
    tasks: [
      {text: 'You wade: slower, you sink in a little (elk-hide boots take that away)'},
      {text: 'Hold E on snow with empty hands: a snowball. LMB throws it', ev: 'snow.throw'},
      {text: 'Get hit by one (F10 > Winter: a snowball at me)', ev: 'snow.hit'},
      {text: 'Your tracks in the snow: deeper when you sprint. Falling snow fills them'},
    ]},
  {id: 'ice', section: 'Winter', title: 'The frozen lake',
    where: 'The lake\'s shore, the ice thick enough to walk. The pick and axe in the bag',
    world: {hour: 12, weather: 'clear', season: 'winter', snow: .4}, setup: T => { T.give('pick', 1); T.row('ice', 'Ice: take me to the lake'); },
    tasks: [
      {text: 'Walk out on the ice', check: T => !!T.feat('ice')?.onIce},
      {text: 'Find a thin spot (where the stream comes in, over the deep): it cracks', ev: 'ice.crack'},
      {text: 'Go through. Hold Space to climb out', ev: 'ice.out'},
      {text: 'Cut a hole: pick 3 blows, axe 4', ev: 'ice.hole'},
      {text: 'With the rod at the hole: jig, lift the rod (LMB) in rhythm', ev: 'fish.jig'},
      {text: 'Stay out a while: something long and dark slides along under you'},
    ]},

  // ---------------------------------------------------------------- the mire
  {id: 'mire', section: 'The mire', title: 'The mire',
    where: 'The boardwalk into the mire, a summer afternoon',
    world: {hour: 16}, setup: T => T.row('mire', 'Mire: take me there'),
    tasks: [
      {text: 'Stand still on the soft moss: you sink', ev: 'mire.sink'},
      {text: 'Space pulls you free', ev: 'mire.free'},
      {text: 'Find the bog body (F10 > Mire: to the bog body)'},
      {text: 'Flood it (F10 > Mire: flood it): the boardwalk keeps you dry'},
    ]},
  {id: 'wisps', section: 'The mire', title: 'Will-o\'-the-wisps',
    where: 'The mire at dusk. Lights over the water',
    world: {hour: 19.6}, setup: T => T.row('mire', 'Mire: take me there'),
    tasks: [
      {text: 'Follow the true wisp to where it stops'},
      {text: 'Dig there (E): one of four old things', ev: 'mire.dig'},
      {text: 'Stuck? F10 > Mire: to the night\'s find'},
    ]},

  // ---------------------------------------------------------------- keepsakes and the odd things
  {id: 'keepsakes', section: 'Keepsakes', title: 'Keepsakes',
    where: 'The lake shore, one of each keepsake in the pouch',
    world: {hour: 10}, setup: T => { where(T, lakeW); T.row('keepsakes', 'Keepsakes: give all'); T.give('log', 4); },
    tasks: [
      {text: 'Tab > GEAR > CHARMS: wear two at a time', check: T => T.charms() >= 2},
      {text: 'Heron Feather: stand still 3 s in shallow water. E jabs at the fish', ev: 'fish.jab'},
      {text: 'Build a Keepsake Shelf (3 logs) and put one on it (E)', ev: 'keep.shelve'},
      {text: 'Tally Stick: F10 > Keepsakes: +1 notch ten times', ev: 'keep.notch', n: 10},
      {text: 'Hover a keepsake in the pack: some cards lie, differently each time'},
    ]},
  {id: 'uncanny', section: 'Keepsakes', title: 'The uncanny forest',
    where: 'The forest at dusk with the uncanny forest on (it is off by default)',
    world: {hour: 19.4}, uncanny: true, setup: T => where(T, clearing),
    tasks: [
      {text: 'Walk into the trees at dusk: some of them aren\'t where they were', ev: 'uncanny.slide'},
      {text: 'Find one of the forest\'s secrets (the heron, the stones, the marks)', ev: 'uncanny.hum'},
      {text: 'Light the lantern (L) at night and look behind you'},
      {text: 'The Watcher (F10 > Summon the watcher)'},
    ]},

  // ---------------------------------------------------------------- gear
  {id: 'gear', section: 'Gear', title: 'Clothes and the pack',
    where: 'The clearing. Tab opens the pack, the gear panel beside it',
    world: {hour: 12}, setup: T => where(T, clearing),
    tasks: [
      {text: 'Change what you wear (the gear panel)', ev: 'gear.wear'},
      {text: 'No hat, No coat, No cape, Long johns, Barefoot: each takes just that off'},
      {text: 'The pack panel sits centred, fits the window, and is the same pixel style as the gear panel'},
      {text: 'The hood, wool cap, wool sweater and fur cape say what they do against wet and cold'},
    ]},
  // ---------------------------------------------------------------- new tonight (each only when its feature is in the build)
  {id: 'mods', section: 'New tonight', title: 'Runes and attachments', needs: 'mods',
    where: 'The clearing with every weapon part in the kit and a pack of brutes to try them on',
    world: {hour: 14}, setup: T => { where(T, clearing); T.row('mods', 'Weapon mods: every part in the kit'); T.row('mods', 'Weapon mods: a pack of brutes'); },
    tasks: [
      {text: 'The Gunslinger suits it best: Esc > Game > Play as'},
      {text: 'M opens the weapon bench: fit the Rime Rune', ev: 'mods.fit'},
      {text: 'Hit a brute three times with it: it freezes', ev: 'mods.freeze'},
      {text: 'Swap to the Ember Rune and hit the frozen one: a steam burst', ev: 'mods.react', when: is('id', 'steam')},
      {text: 'The Storm Rune in a pack: the hits jump from one to the next', ev: 'mods.arc'},
      {text: 'The Fork Choke with the Moth Lens; the Kick Grip (shoot behind you to dash)'},
    ]},
  {id: 'stormrune', section: 'New tonight', title: 'The Storm Rune in the rain', needs: 'mods',
    where: 'The same clearing in heavy rain: the arcs reach further when it\'s wet',
    world: {hour: 15, weather: 'rain', wet: 1}, setup: T => { where(T, clearing); T.row('mods', 'Weapon mods: a pack of brutes'); },
    tasks: [
      {text: 'Storm Rune on, into the pack: arcs between them', ev: 'mods.arc', n: 5},
      {text: 'At night the Hollow Rune flings them higher; in the mire the Rot Rune'},
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
    world: {hour: 13}, setup: T => { T.go(20, 15.5); const m = T.feat('melee'); m?.equip?.('sword', 'round'); try { m?.dev?.rows?.()[2]?.run?.(); } catch (e) {} },
    tasks: [
      {text: '3 weapon, 4 shield. LMB for a combo, hold LMB for a heavy blow'},
      {text: 'Space then LMB: a smash from the air'},
      {text: 'RMB blocks; time it right and it\'s a parry'},
      {text: 'R throws the weapon, R again calls it back. Try the Rift Blade\'s throw, and the Wobbler'},
      {text: 'A saber parries bullets back at the gunmen'},
    ]},
  {id: 'raindance', section: 'Night surprises', title: 'The rain dance', needs: 'surprises',
    where: 'The standing stones by day. Walk round them',
    world: {hour: 13}, setup: T => T.row('surprises', 'Surprise: take me to the standing stones'),
    tasks: [
      {text: 'Walk three laps round the stones: the chip bottom left counts them'},
      {text: 'The third lap brings a bolt onto the altar, and a storm', ev: 'thunder.strike'},
      {text: 'Stuck? F10 > Surprises: the rain dance, done'},
    ]},
  {id: 'fishrain', section: 'Night surprises', title: 'Raining fish, and charged', needs: 'surprises',
    where: 'Out in a thunderstorm',
    world: {hour: 15, weather: 'storm', wet: 1}, setup: T => { where(T, clearing); T.row('surprises', 'Surprise: rain fish on me'); },
    tasks: [
      {text: 'Fish fall out of the clouds and flop about: walk over them'},
      {text: 'Stay out till a bolt hits you (or F10 > Surprises: get struck)', ev: 'thunder.strike', when: e => !!e.you},
      {text: 'Storm-charged: sprint, jump and land for a thunderclap; wade in and fish float up'},
      {text: 'Carry a thunderwood splinter: the bolts come for you'},
    ]},
  {id: 'stars', section: 'Night surprises', title: 'Falling stars', needs: 'surprises',
    where: 'A clear night. One lands near you within about 15 s',
    world: {hour: 23, weather: 'clear'}, setup: T => where(T, clearing),
    tasks: [
      {text: 'Watch the sky: a star falls nearby (or F10 > Surprises: a star falls near me)'},
      {text: 'Walk over the shard to take it'},
      {text: 'Take it to the lake shore, wade in and fish: bites at once (the star frenzy)', ev: 'fish.bite'},
    ]},
  {id: 'mirror', section: 'Night surprises', title: 'The looking-lake', needs: 'surprises',
    where: 'The lake shore at night',
    world: {hour: 23.5, weather: 'clear'}, setup: T => T.row('surprises', 'Surprise: take me to the lake shore'),
    tasks: [
      {text: 'Swim out and float still for 6 s: the world flips into its mirror image'},
      {text: 'The same again (or the F10 row) flips it back'},
      {text: 'Dizzy: spin the camera round and round (first person mouse, or a middle drag)'},
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
      {text: 'Read chapter I in the card at the top left. Shift+J folds it (with the new window: J opens it on the Journal)'},
      {text: 'Meet one of the chapter\'s goals', ev: 'almanac.goal'},
      {text: 'Finish the chapter: its page tears out and you get its gift', ev: 'almanac.chapter'},
      {text: 'After chapter I, "Today" has three daily goals', ev: 'almanac.today'},
      {text: 'Tab > pack: the Almanac section has every chapter and its hints'},
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
