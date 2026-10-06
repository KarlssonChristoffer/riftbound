// FLAGS: every URL switch of the game, declared once (docs/ARCHITECTURE.md, code standards: "Flags in one place").
// Reading one works like URLSearchParams.get: flags.get('wind') -> the raw string, or null when the URL doesn't set it.
// Reading a switch that isn't declared below warns (once): add it here with a line saying what it does.
// OWNS: the parsed URL query. READS: location.search. Nothing else in the game parses the URL.
export const FLAG_DOCS = {
  // ---- the game
  mode:      'title (default) | sandbox | run: skip the title screen',
  dev:       '1: dev keys + debug HUD in a run (the key left of 1 toggles them any time)',
  biome:     'ruins | ember | frost | rift: the starting biome',
  time:      'day | dusk | night: jump the world clock to that part of the day',
  hour:      'the world clock\'s starting hour (0-24)',
  season:    'spring | summer | autumn | winter: lock the season',
  weather:   'a sim/env.js WEATHER state (clear, fair, cloudy, ..., storm, snow) to lock; 0 = no weather particles (atmos)',
  daymin:    'real minutes per in-game day; 0 = the clock stands still',
  at:        'x,y (m): start the player there',
  world:     'big: the grown world, 162 x 90 m round the Proving Grounds (layout.js WORLD; the world plan: open land in step 3)',
  yaw:       'the camera\'s starting yaw (deg)',
  zoom:      '2: start zoomed in',
  omens:     '1: stage omens in a run (features/omens.js: the weather, wind and light turned into a stage\'s rules); 0: off (the Dev toggle remembers it)',
  omen:      'storm | gale | bloodmoon | riftfog | eclipse | golden: that omen on every run stage (and in the sandbox from the start)',
  // ---- the player
  set:       'basic | sim | body | gunslinger | outlaw: the loadout (baked cloak / runtime cloth / bare body; the cowboys with their revolvers)',
  bow:       'hd: the bow drawn on the HD overlay instead of in pixels',
  live:      'the player drawn LIVE (view/livehero.js: his Blender model through render/rigmesh.js, the pixelizer rules on the GPU) instead of his sprite. Absent: the gunslinger is live (his duster is runtime cloth on the live bones), the others are sprites; 1: every loadout with a live model (the outlaw too); 0: none. Shift+7 flips sprite / live, Shift+8 the motion knobs, Shift+9 the demos (dev/livekeys.js); docs/exp/livehero.md',
  livek:     'the live hero (?live): the preset of the motion knobs to start with (view/livehero.js PRESETS: smooth, step, face16, hyst, hold, snap, smear, all (default), allsmear, free32)',
  livedemo:  'the live hero (?live): a procedural demo to start with (lasso: the rope hand spinning a loop overhead, two-bone IK; swing: hanging from a rope, a pendulum), or an emote made for the live model only (cheer, wave, shrug, squat: played while he stands still)',
  lantern:   '1: start with the lantern lit',
  detail:    'low: the low detail tier (no wind lines, wildlife, depth layer or grass; menu > Graphics > Detail)',
  // ---- renderer A/B
  snap:      '0 | 1 | 2: camera rotation free / 22.5 deg steps / 90 deg steps',
  subpx:     '0: the camera moves in whole art pixels (no sub-pixel image shift; an A/B)',
  sampling:  'auto | nearest | smooth: ground texture sampling',
  smooth:    '1: = sampling=smooth',
  props:     'yaw: the 16-angle pre-rendered props instead of live 3D (reference)',
  trees3d:   '0: painted tree cards instead of the procedural 3D trees',
  cliffs:    '0: the old painted strata planes on the plateau and the ravine wall instead of the 3D rock (world/cliffs3d.js)',
  water:     '0: the old water look (no depth colour, bed, refraction or contact foam: world/waterbed.js, gfx.js WATER_FS wDeep; an A/B)',
  terrain:   '0: flat ground (no hills, terraces or ramps: world/terrain.js, the shapes in layout.js TERRAIN; docs/TERRAIN.md) and the plateau as its old box with the waterfall (not the mesa with its gully), the world 62 m wide: an A/B',
  debug:     'a debug view index (G cycles them)',
  sshadow:   '0: every shadow caster in the per-frame sun shadow (no cached static map; an A/B)',
  godrays:   '0: no shadow-map god rays (render/godrays.js: sunbeams through crowns and between pillars; the painted shafts of features/depth.js come back)',
  cards:     '0: every world card its own mesh and draw (no instanced card batches; an A/B)',
  mist:      '0: the old screen-space haze instead of the world mist (an A/B; features/mist.js)',
  crest:     '0: no light line along the top edges of blocks, walls and caps (gfx.js COMP_FS crest, render/lighting.js SHADE)',
  shade:     '0: shadows as the old flat tint toward the shadow colour of the mood, not the coloured shade that keeps the hue of what they fall on (render/lighting.js SHADE; an A/B)',
  preserve:  '1: keep the WebGL drawing buffer between frames (a capture that reads the canvas outside the frame that drew it)',
  cinema:    '0: never the cinematic camera (features/cinema.js); now: start it at once and keep it through input (captures, tests)',
  cineidle:  's of no input before the cinematic camera starts (features/cinema.js TUNE.idle: 45)',
  // ---- features (0 turns one off)
  wind: '0: no wind', windlevel: 'calm | breeze | brisk | gale: lock the wind strength', windlines: '0 | hd | pixel: the wind lines',
  litter: '0: the fallen leaves stay as baked (no wind moves them, none are lifted); also the low detail tier',
  riverside: '0: no riverside plants (reeds, ferns, willows, lily pads)', grass: '0: no grass (features/grass.js)', wildlife: '0: no wildlife', wildfight: '0: wildlife ignores fights (no flush, no scavengers at kills, no coyotes / fox / wolves at night; features/wildlife/fightlife.js; menu > Dev > Fight reactions)', flow: '0: no flow (camera feel, trails, marks)', depth: '0: no depth cues', fg: '1: the depth foreground silhouettes',
  contact: '0: no contact shadows', hd: '0: no HD atmosphere layer',
  tumbleweed: '0: no tumbleweeds (the desert)', dust: '0: no blowing sand, dust devils or kicked-up dust (the desert)',
  foes: '0: no gunmen in the desert sandbox (features/foes.js); unarmed: two at a time who never draw (targets to test on)', ragdoll: '0: the gunmen die by their death clips instead of as live 3D ragdolls (features/foes/look.js, view/ragdoll.js; ragdolls are the default)',
  blood: '0: no blood from bullet hits (features/blood.js; menu > Graphics > Effects > Blood)',
  smoke: 'pixel | hybrid | strands | soft: the gun smoke\'s look (features/gunfx/smoke.js; Shift+V cycles it in dev mode)',
  audio: '0: no audio', forge: 'the forge sound set to use (audio)', sheet: 'a sprite-sheet capture mode (audio stays silent)',
  gunsfx: 'hollywood | gritty: the gun sounds\' western-movie flavor (audio/runtime/events.js GUN_SFX; menu > Audio > Gun sounds, remembered)',
  equip: '1 | a gadget id (flask, dynamite, beartrap, scarecrow, smoke, grapple): the equipment experiment on (features/equip.js: a gadget on F), with that one in the slot; 0 forces it off',
  affixes: '1: elite affixes on (features/affixes.js: Blazing, Glacial, Overloaded, Splitting, Warded, Vampiric); 0: off; menu > Dev > Features remembers it',
  battlemusic: '1: the premade Six Chambers songs follow the fight (features/battlemusic.js); off by default: the procedural score plays',
  bmforce: 'state[:song[:x]]: dev, pin the battle music (dev/bmusic.js), e.g. boss:iron:.25 (x = the champion health) or battle:dust:.8 (x = intensity)',
  shrines: '1 | 0: shrines and mini-events in a run (features/shrines.js, an experiment; off by default; the Dev tab toggle remembers it)',
  trick: '1 | 0: the trick-shot range in the sandbox (features/trickshot.js, an experiment: bottles on a fence, cans to toss and juggle, a steel plate, ricochets on; off by default; the Dev toggle and the Game tab remember it); docs/exp/trickshot.md',
  rico: '1: bullets glance off metal and stone at shallow angles everywhere (sim/projectiles.js RICO); 0: never, not even at the trick-shot range; absent: on while the range stands',
  anomaly: '0: no rift anomaly in the sandbox (features/anomaly.js: a tear in the air on open ground, VISUALS ONLY, a reminder of the gameplay to come; on by default; menu > Dev > Features; docs/exp/anomaly.md)',
  bells: '1 | 0: bells and ricochet plates in the sandbox (features/bells.js, an experiment: steel plates bullets always glance off, hanging bells that ring, scattered round the Proving Grounds; off by default; the Game tab row and the Dev toggle remember on); docs/exp/bells.md',
  // ---- tools
  perf: '1: start with the frame profiler (F3) on', bench: '1: set by tools/perf/bench.mjs (weather pinned to fair)',
  lineup: 'trees: the procedural trees side by side for review',
  views: '0: run the sim alone, no presentation step or drawing (tools/test/simview.mjs: the sim must come out the same)',
  owncheck: '1: record writes to entity fields by systems that do not own them (dev/owncheck.js; slow: for checks)',
  photo: '1: open straight into photo mode (ui/photo.js; F4 or the menu otherwise: tests)',
};
const params = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const warned = new Set();
const check = name => { if (!(name in FLAG_DOCS) && !warned.has(name)) { warned.add(name); console.warn(`flags: '${name}' is not declared in core/flags.js`); } };
export const flags = {
  get(name) { check(name); return params.get(name); },
  has(name) { check(name); return params.has(name); },
};
