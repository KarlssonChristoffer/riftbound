// WILDLIFE (3D): the arena's animals (concepts/sprites/arena/wildlife.js) living in the HD-2D world and reacting to you.
// OWNER: the wind + wildlife port session. SHOW ONLY: animals never block, hurt or get hit (arrows pass through; they
// just flee), and nothing here changes how the game plays. Key 6; ?wildlife=0 starts off.
//
// Same cast, same behaviour, same tunables (F.TUNE = the arena's TUNE) as the arena; per biome:
//   ruins  pigeons / sparrows pecking in flocks (burst up when startled, circle, land on walls, pillar / tower tops or the
//          floor), crows on the towers, rabbits bolting between bushes, butterflies by day, moths round the braziers at
//          dusk / night, fish jumping in the stream, frogs on the banks that plop in
//   frost  ravens, snow buntings, snow hares, the odd fish under the floes
//   ember  ash moths round braziers and lava, salamanders that dart and freeze, vulture SHADOWS circling overhead
//   rift   drifting void jellies (glowing tips), eyes on walls / floor that track you and blink shut, schooling motes
// NOISE (sprint / roll / landing steps, arrows flying past, hits, breaks, explosions, splashes) startles them exactly as
// in the arena. AUDIBLE moments go to host.events for the audio feature (next step), names unchanged:
//   {type: 'birds_scatter', x, y, n}  {type: 'wings', x, y}  {type: 'caw', x, y}  {type: 'fish_jump', x, y}
//   {type: 'frog_jump', x, y}  {type: 'critter_dash', x, y}   (+ {type: 'splash', small, wl: true} for plops)
// and, for the wind feature (not rate-limited, in view only): {type: 'bird_perch', x, y, h, prop, off, big, scared} when a
// bird lands on (off false) / takes off from (off true) a prop's top; wind.js shakes a dying leaf off a crown
//
// WHAT CHANGED FOR 3D (the simulation is the arena's, in world metres; only the view side moved):
//   sprites    every animal is a camera-facing host.sprite from ONE atlas per biome (albedo + emit, same layout; glows
//              are part of the sprite's emit: salamander backs, moths near a flame, eyes, motes) -> depth-correct
//              against walls, props and the player, perched birds really stand on the 3D models' tops. Jellies (sway
//              each frame) use a small dynamic atlas. Facing: animals keep a WORLD heading; the sprite mirrors by its
//              projection on the screen's x (with hysteresis when it heads straight at / away from the camera).
//   perches    3D models (walls, towers, gateposts, pillars, rocks): the top of the mesh under the spot (ray cast on the
//              model, cached); painted cards (trees, bushes, dummies): the sprite's top row as in the arena, offset along
//              the screen's x (the card always faces the camera), drawn a hair in front of the card.
//   ground     host.layer('ground'): flying animals' shadows, hopper / walker shadows, fish under the water, swimming
//              frogs, the vulture's soaring shadow (turned with the camera). The arena multiplies tints; the 3D ground
//              layer is mixed over, so each tint becomes a dark colour + alpha solved against the biome's average ground
//              colour (exact on that colour, close elsewhere).
//   eyes (rift) on the south faces of the 3D walls / towers / pillars (found on the model), the plateau's cliff, the floor
//   pupils / startle / sideways drift read the screen's axes where the arena read x / y (screen right = (cos yaw, -sin yaw))
//
// FEATURE CONTRACT (main.js): create(host) -> F
//   F.name 'wildlife', F.key '6', F.on / F.toggle(), F.ms (rolling average cost per frame: update + frame)
//   F.update(dt, evs)    noise, flocks, birds, critters, fish, insects, vultures, jellies, eyes, motes (detail near the view)
//   F.frame(f)           sprites + the ground layer
//   F.lights()           jellies' faint glow
//   F.biomeChanged()     repopulate for the new biome (time of day is read from host.time every step)
// EXTRAS: F.TUNE, F.dbg(), F.sheet(z) (the atlas, zoomed), F._ (internals)
//
// host (main.js): ctxO, G (view), yaw, zoom, player (world frame), props, arrows, events, layout (stream, plateaus,
// lightGarden), biome (sprite(), groundLights), time, itemOf(p) (live mesh / card), wind (F.at), elev, inStream,
// toView, sprite, layer, world.groundCanvas.
// ART RULES (biomes.js / atmos.js): 1 texel = 1 screen px, no AA / dither / gradients; small animals are 2-6 px with 2-3
// frame animation, outlined in their own darkest tone; palettes harmonise with the biome. Motion reads at 1x.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const CALM = {x: 0, y: 0, g: 0};
const WATER = -.18;   // the stream bed's height in the 3D world (world.js)

// ---------------------------------------------------------------- tunables (the arena's)
const TUNE = {
  noise: {walk: 1.3, run: 3.2, sprint: 5.5, roll: 5, leap: 3.5, climb: 1.4, knock: 4, release: 1, arrow: 2.6, hit: 6, hitMe: 5,
    break: 8, explode: 6 /* x blast r */, splash: 5, splashSmall: 2, loot: 3, open: 3, land: 4.5, landBig: 8, jump: 2.5, scatter: 3.2,
    impact: 6, scrape: 2.5, propLand: 4.5, propSplash: 4,
    splashAnimal: 1.1},
  nervous: .6,      // threat at which animals edge away / sit up (1 = flee)
  earshot: 22,      // m from the player: animal sounds beyond it are not pushed
  margin: 4,        // m around the view simulated in detail
  cool: {birds_scatter: .3, wings: .5, caw: 2.5, fish_jump: 1.2, frog_jump: .3, critter_dash: .6, splash: .12},
};
const SPECIES = {   // sens: noise multiplier, shy: presence radius (m), perch: kind -> preference
  pigeon: {id: 'pigeon', bird: true, sens: 1, shy: 1.3, speed: 4.2, agil: 3, flap: 7, alt: [2.6, 4.2], walker: true, perchLike: .45,
    perch: {wall_n: 3, wall_s: 3, wall_w: 2, wall_e: 2, tower: 2, gatepost: 3, pillar: 3, pillar_broken: 2, ledge: 2, dummy: 1}},
  sparrow: {id: 'sparrow', bird: true, sens: 1.25, shy: 1.6, speed: 4.6, agil: 4, flap: 12, alt: [1.8, 3.2], perchLike: .5,
    perch: {bush: 3, wall_s: 2, wall_n: 1, rock: 1, tree: 2, ledge: 2, gatepost: 1, pillar_broken: 2}},
  bunting: {id: 'bunting', bird: true, sens: 1.3, shy: 1.6, speed: 4.6, agil: 4, flap: 12, alt: [1.8, 3.2], perchLike: .5,
    perch: {bush: 2, rock: 2, wall_s: 2, wall_n: 1, ledge: 2, rock_big: 1, pillar_broken: 1}},
  crow: {id: 'crow', bird: true, solo: true, sens: .8, shy: 2.2, speed: 4.2, agil: 2.6, flap: 5, alt: [3.8, 5.6], caw: true, walker: true,
    perch: {tower: 4, gatepost: 2, pillar: 2, tree: 2, dummy: 1, ledge: 1}},
  raven: {id: 'raven', bird: true, solo: true, heavy: true, sens: .7, shy: 2.4, speed: 3.8, agil: 2.1, flap: 3.4, alt: [4, 6], caw: true, walker: true,
    perch: {tower: 4, tree: 3, pillar: 2, gatepost: 2, rock_big: 2, dummy: 1, ledge: 1}},
  rabbit: {id: 'rabbit', sens: 1.1, shy: 2.4},
  hare: {id: 'hare', sens: .9, shy: 2.2},
  salamander: {id: 'salamander', sens: 1, shy: 1.6},
  frog: {id: 'frog', sens: .8, shy: 1.7},
  fish: {id: 'fish', sens: .7, shy: 1.2},
};
// perch spots per prop kind: px offsets from the sprite pivot column (3D models: along world x), sink = px below the top
// row (models: px back from the top face's north edge), jx: x jitter px, deep: extra random sink px
const PERCH = {
  tower: {dx: [-14, -5, 5, 14], sink: 0, jx: 1}, gatepost: {dx: [-3, 3], sink: 0, jx: 1}, pillar: {dx: [-6, 0, 6], sink: 0, jx: 1},
  pillar_broken: {dx: [-2, 18], sink: 0, jx: 1}, wall_n: {dx: [-9, 0, 9], sink: 1, deep: 6}, wall_s: {dx: [-9, 0, 9], sink: 1, deep: 3},
  wall_w: {dx: [0], sink: 2, jx: 1, deep: 3}, wall_e: {dx: [0], sink: 2, jx: 1, deep: 3}, tree: {dx: [-14, 0, 14], sink: 2, deep: 3},
  rock_big: {dx: [-6, 6], sink: 1, deep: 1}, rock: {dx: [0], sink: 1, jx: 1}, bush: {dx: [-3, 4], sink: 2, jx: 1, deep: 2}, dummy: {dx: [0], sink: 0, jx: 0},
};
const CAST = {
  ruins: {flocks: [{sp: 'pigeon', n: 8, homes: [[15.5, 11.5], [25.5, 11], [14.5, 19.8], [25, 20.5]]},
    {sp: 'sparrow', n: 7, homes: [[36, 18.2], [36.5, 11.5], [45, 18.6], [43.6, 25.5], [51.5, 7.6]]}],
    solos: {sp: 'crow', n: 2}, rabbits: 3, butterflies: 5, fish: 5, frogs: 3, moths: 3},
  frost: {flocks: [{sp: 'bunting', n: 9, homes: [[16, 12], [24.5, 19.8], [36.5, 17.8], [45, 18.6], [51.5, 7.6]]}],
    solos: {sp: 'raven', n: 4}, hares: 2, fish: 2, moths: 0},
  ember: {salamanders: 4, moths: 2, vultures: 2},
  rift: {jellies: 4, eyes: 10, motes: 12},
};

// ---------------------------------------------------------------- art (the arena's, unchanged)
// '0'-'3' = the species ramp [hi, base, shade, outline], letters = accents, '.' = empty; x, y = the anchor pixel (ground
// frames: the feet; flight frames: the body). Every sprite faces RIGHT; left is mirrored.
const A = (r, x, y) => ({r, x, y});
const ART = {
  pigeon: {
    stand: A(['....0.', '...b1a', '3.011.', '.3012.', '..33..'], 3, 4),
    bob: A(['......', '...b0a', '3.011.', '.3012.', '..33..'], 3, 4),
    peck: A(['......', '3.....', '.301b.', '..0111', '..33.a'], 3, 4),
    alert: A(['....0a', '...b1.', '3.011.', '.3012.', '..33..'], 3, 4),
    sleep: A(['......', '......', '3.0b1.', '.3012.', '..33..'], 3, 4),
    up: A(['..0....', '..10...', '3301b0a', '..222..', '.......'], 3, 2),
    mid: A(['.......', '.......', '0001b0a', '.3222..', '.......'], 3, 2),
    down: A(['.......', '.......', '3301b0a', '..212..', '..32...'], 3, 2),
  },
  sparrow: {
    stand: A(['.....', '..00.', '3011a', '.322.'], 2, 3),
    bob: A(['.....', '..00.', '3011a', '.322.'], 2, 3),
    peck: A(['.....', '.....', '300..', '.3211'], 2, 3),
    alert: A(['...0.', '..01a', '3011.', '.322.'], 2, 3),
    sleep: A(['.....', '.....', '3000.', '.322.'], 2, 3),
    up: A(['.0...', '..0..', '3010a', '.22..', '.....'], 2, 2),
    mid: A(['.....', '.....', '0000a', '.322.', '.....'], 2, 2),
    down: A(['.....', '.....', '3010a', '.22..', '.3...'], 2, 2),
  },
  bunting: {
    stand: A(['.....', '..bb.', '3b10a', '.322.'], 2, 3),
    bob: A(['.....', '..bb.', '3b10a', '.322.'], 2, 3),
    peck: A(['.....', '.....', '3bb..', '.3210'], 2, 3),
    alert: A(['...0.', '..b1a', '3b10.', '.322.'], 2, 3),
    sleep: A(['.....', '.....', '3bbb.', '.322.'], 2, 3),
    up: A(['.b...', '..b..', '3b10a', '.22..', '.....'], 2, 2),
    mid: A(['.....', '.....', 'bbb0a', '.322.', '.....'], 2, 2),
    down: A(['.....', '.....', '3b10a', '.2b..', '.3...'], 2, 2),
  },
  crow: {
    stand: A(['.....0.', '....01a', '3.0111.', '.31112.', '..3.3..'], 3, 4),
    bob: A(['.....0.', '....01a', '3.0111.', '.31112.', '.3...3.'], 3, 4),
    peck: A(['.......', '3......', '.3011..', '..11101', '..3.3.a'], 3, 4),
    alert: A(['....0..', '....01a', '...01..', '3.0111.', '.31112.', '..3.3..'], 3, 5),
    caw: A(['....0a.', '....01a', '3.0111.', '.31112.', '..3.3..'], 3, 4),
    sleep: A(['.......', '.......', '3.0011.', '.31112.', '..3.3..'], 3, 4),
    up: A(['.00.....', '..10....', '...1....', '3301111a', '..2222..', '........', '........'], 3, 3),
    mid: A(['........', '........', '........', '0001111a', '.322222.', '........', '........'], 3, 3),
    down: A(['........', '........', '........', '3301111a', '..2122..', '...12...', '..33....'], 3, 3),
  },
  raven: {
    stand: A(['......0.', '.....01a', '3..0111a', '.301112.', '..32222.', '...3.3..'], 4, 5),
    bob: A(['......0.', '.....01a', '3..0111a', '.301112.', '..32222.', '..3...3.'], 4, 5),
    peck: A(['........', '3.......', '.30111..', '..311101', '...2222a', '...3.3..'], 4, 5),
    alert: A(['.....0..', '.....01a', '....011a', '3..0111.', '.301112.', '..32222.', '...3.3..'], 4, 6),
    caw: A(['.....0a.', '.....01a', '3..0111.', '.301112.', '..32222.', '...3.3..'], 4, 5),
    sleep: A(['........', '........', '3..0011.', '.301112.', '..32222.', '...3.3..'], 4, 5),
    up: A(['0.0.......', '.00.......', '..10......', '...11.....', '330111111a', '..22222...', '..........', '..........'], 4, 4),
    mid: A(['..........', '..........', '..........', '0.0.......', '000011111a', '.3322222..', '..........', '..........'], 4, 4),
    down: A(['..........', '..........', '..........', '..........', '330111111a', '..21222...', '..112.....', '.3.3......'], 4, 4),
  },
  rabbit: {
    sit: A(['.....0.', '....01.', '.0011e2', 'a01111.', '.33223.'], 3, 4),
    nibble: A(['.......', '.....0.', '....01.', 'a00111e', '.332232'], 3, 4),
    alert: A(['....01.', '....01.', '...011.', '..011e2', 'a01111.', '.3323..'], 3, 5),
    hop: A(['......0.', '.....01.', 'a0011e12', '3....3..'], 3, 3),
    hop2: A(['.......', '.....0.', '.00011.', 'a0111e2', '33...3.'], 3, 4),
  },
  hare: {
    sit: A(['.....k.', '....k1.', '.0011e2', 'a01111.', '.33223.'], 3, 4),
    nibble: A(['.......', '.....k.', '....k1.', 'a00111e', '.332232'], 3, 4),
    alert: A(['....kk.', '....01.', '...011.', '..011e2', 'a01111.', '.3323..'], 3, 5),
    hop: A(['......k.', '.....k1.', 'a0011e12', '3....3..'], 3, 3),
    hop2: A(['.......', '.....k.', '.0001k.', 'a0111e2', '33...3.'], 3, 4),
  },
  salamander: {
    a: A(['..2.2..', '32a1a10', '.2...2.'], 3, 1),
    b: A(['.2...2.', '32a1a10', '..2.2..'], 3, 1),
  },
  frog: {
    sit: A(['..00', '0112', '3223'], 2, 2),
    pulse: A(['..00', '0112', '322a'], 2, 2),
    jump: A(['....0', '30111', '3....'], 2, 1),
  },
  fishj: {
    up: A(['...0', '..01', '.11.', '3...'], 2, 2),
    level: A(['3.00.', '31112'], 2, 1),
    down: A(['3...', '.11.', '..10', '...2'], 2, 1),
  },
  butterfly: {
    open: A(['0.0', '131'], 1, 1),
    flat: A(['...', '030'], 1, 1),
    closed: A(['.0.', '.3.'], 1, 1),
  },
  moth: {
    open: A(['1.1', '232'], 1, 1),
    closed: A(['.1.', '.3.'], 1, 1),
  },
  jelly: {
    wide: A(['..000..', '.00112.', '0011122', '3.3.3.3'], 3, 3),
    tall: A(['.000.', '00112', '01122', '.112.', '.3.3.'], 2, 4),
  },
  vulture: {
    glide: A(['33.........33', '.333.....333.', '...3333333...', '.....333.....'], 6, 2),
    beat: A(['.............', '333.......333', '..333333333..', '.....333.....'], 6, 2),
  },
};
const ARTOF = {bfly0: 'butterfly', bfly1: 'butterfly', bfly2: 'butterfly', ashmoth: 'moth'};
const PAL = {
  ruins: {
    pigeon: {r: ['#b4b6be', '#8e909c', '#6a6c7a', '#3e3e4c'], a: '#c28c7c', b: '#6c9480'},
    sparrow: {r: ['#c0a274', '#94764f', '#6a533a', '#3c2e22'], a: '#4a3a2c'},
    crow: {r: ['#5c5a6c', '#3e3c4c', '#2a2836', '#15141c'], a: '#6a6670'},
    rabbit: {r: ['#b09a7c', '#8c7860', '#6a5a48', '#3e3429'], a: '#e6ded0', e: '#1c1612'},
    frog: {r: ['#8aa862', '#688449', '#4d6338', '#2c3a22'], a: '#c2c08a'},
    fishj: {r: ['#e6f0f2', '#aac2ca', '#6e8e9a', '#3a505c']},
    moth: {r: ['#cfc3aa', '#a3977f', '#776d5b', '#453e33']},
    bfly0: {r: ['#f2e39c', '#d6b44e', '#a08436', '#4e4020']},
    bfly1: {r: ['#eeeae0', '#cfcabc', '#9c978a', '#4a4840']},
    bfly2: {r: ['#eab070', '#c8803e', '#96582c', '#4a2c18']},
  },
  frost: {
    raven: {r: ['#5e6880', '#3e465c', '#2a3042', '#161a26'], a: '#6a7080'},
    bunting: {r: ['#f2f4f6', '#d2d8e0', '#98a2b2', '#505a6a'], a: '#d0a060', b: '#8a6c52'},
    hare: {r: ['#f4f7fb', '#dde4ee', '#b6c1d2', '#8591a8'], a: '#ffffff', e: '#262a36', k: '#2a2e3a'},
    fishj: {r: ['#eef6fa', '#b8cedc', '#7e9cb4', '#44607c']},
  },
  ember: {
    salamander: {r: ['#6e4838', '#4c3028', '#34201b', '#1a100e'], a: '#c8541e'},
    ashmoth: {r: ['#b4aaa2', '#8c847e', '#645e5a', '#3a3533']},
    vulture: {r: ['#2c2226', '#241c20', '#1e1719', '#171114']},
  },
  rift: {
    jelly: {r: ['#dcbcff', '#a274e6', '#6c46b4', '#35205e']},
  },
};
// multiply tints for shadows (strong -> faint) and the colours that are not sprites
const SHADE = {ruins: ['#a4a69e', '#b8bab2', '#cdcec8'], frost: ['#a8b0c4', '#bcc3d4', '#d0d6e2'], ember: ['#aca29e', '#bfb6b2', '#d2cac6'],
  rift: ['#a69cba', '#bab2ca', '#ccc6da']};
const UNDER = {ruins: ['#3c6676', '#284858'], frost: ['#5a7a9a', '#425e7c']};
const EYE = {sclera: '#cbbbe6', pupil: '#120a1c', lid: '#161022', lidHi: '#443a68', lash: '#0e0a16', glow: '#7a64a8', glint: '#f4e8ff'};
const MOTE = {base: '#5a3a9a', glow: ['#e4c8ff', '#ac80f2', '#7448c4']};
const JELLY = {tend: '#6c46b4', tip: '#dcb8ff', tip2: '#6a44a8', bell: '#7c52c0', core: '#c89cff', light: '#b47cff'};
const SALA_GLOW = ['#ffb050', '#e0641e'];
const MOTH_GLOW = {ember: ['#ffc080', '#c07040', '#6a3a24'], other: ['#ffe6b0', '#c89a62', '#6e5436']};

const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
const hex = s => { const n = parseInt(s.slice(1), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };

// ---------------------------------------------------------------- the module
export async function create(host) {
  const ctx = host.ctxO, G = host.G;
  const Q = new URLSearchParams(location.search);
  const WL = {name: 'wildlife', label: 'Wildlife', key: '6', on: Q.get('wildlife') !== '0', ms: 0, count: 0, T: TUNE, TUNE};
  let biome = null, time = 'day', need = true, needTime = false, wasNight = false, T = 0, acc = 0, P = null, seasonVer = -1, raining = false;
  let seed = 1;
  const R = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rr = (a, b) => a + R() * (b - a), pick = a => a[R() * a.length | 0];
  const elev = (x, y) => host.elev(x, y), inStream = (x, y) => host.inStream(x, y), S = () => host.layout.stream;
  const gH = (x, y) => inStream(x, y) ? WATER : elev(x, y);   // the 3D ground's height (the stream bed sits lower)
  let props = [];
  const tick = t0 => { acc += performance.now() - t0; };

  // ---------- the camera (main.js turns it any time): screen right (RX, RY), toward the camera (FX, FY), zoom ----------
  let RX = 1, RY = 0, FX = 0, FY = 1, ZM = 1;
  const VB = {cx: 0, cy: 0, hw: 10, hh: 6};
  function viewSync() {
    const a = host.yaw; RX = Math.cos(a); RY = -Math.sin(a); FX = Math.sin(a); FY = Math.cos(a); ZM = host.zoom || 1;
    const T3 = G.view.T, vx = T3.x * RX + T3.z * RY, vy = T3.x * FX + T3.z * FY;
    VB.cx = vx; VB.cy = vy - T3.y * ctx.PPMH / ctx.PPMY; VB.hw = ctx.VW / 2 / (ctx.PPM * ZM); VB.hh = ctx.VH / 2 / (ctx.PPMY * ZM);
  }
  // the detail region (the arena's V): the view plus a margin, things up to ~7 m high still show from below the view
  const near = (x, y) => {
    const m = TUNE.margin, dx = x * RX + y * RY - VB.cx, dy = x * FX + y * FY - VB.cy;
    return dx > -VB.hw - m && dx < VB.hw + m && dy > -VB.hh - m && dy < VB.hh + m + 7 * ctx.PPMH / ctx.PPMY;
  };
  // on screen (view metres, at height h), pad in metres
  const onScreen = (x, y, h, pad = .5) => {
    const dx = x * RX + y * RY - VB.cx, dy = x * FX + y * FY - VB.cy - h * ctx.PPMH / ctx.PPMY;
    return dx > -VB.hw - pad && dx < VB.hw + pad && dy > -VB.hh - pad && dy < VB.hh + pad;
  };
  // facing: a world heading (fx, fy); the sprite mirrors by its projection on the screen's x
  const faceV = (o, dx, dy) => { const l = Math.hypot(dx, dy); if (l > 1e-6) { o.fx = dx / l; o.fy = dy / l; } };
  const flipF = o => { o.fx = -o.fx; o.fy = -o.fy; };
  const sface = o => { const s = o.fx * RX + o.fy * RY; if (Math.abs(s) > .25 || !o.sf) o.sf = s < 0 ? -1 : 1; return o.sf; };
  const rface = () => R() < .5 ? -1 : 1;

  const noise = [], PN = {x: 0, y: 0, h: 0, r: 0, moving: false};
  const CD = {};
  const windAt = (x, y) => { const w = host.wind; return w && w.on !== false && w.at ? (w.at(x, y) || CALM) : CALM; };
  const emit = (type, x, y, extra) => {   // an audible animal moment for the audio feature (rate-limited, only near the player)
    if (!WL.on || !host.events) return false;
    if (P && Math.hypot(x - P.x, y - P.y) > TUNE.earshot) return false;
    if ((CD[type] || 0) > 0) return false; CD[type] = TUNE.cool[type] || .3;
    host.events.push(Object.assign({type, x, y}, extra)); return true;
  };
  const splash = (x, y) => emit('splash', x, y, {small: true, wl: true});
  // a bird landing on / leaving a prop's top (not rate-limited: one per bird, only in view): the wind feature shakes a
  // dying leaf (snow) off a crown or a bush
  const perchEv = (b, s, off) => { if (WL.on && host.events && s.p && near(s.x, s.y)) host.events.push({type: 'bird_perch', x: s.x, y: s.y, h: s.h, prop: s.p, off, big: !!b.sp.solo, scared: !!b.f.scared}); };

  // ---------- perches: painted cards read their sprite's top row; 3D models are ray cast ----------
  const alphaCache = new WeakMap();
  let scratch = null;
  function alphaOf(img) {
    let a = alphaCache.get(img); if (a) return a;
    const w = img.width, h = img.height;
    if (!scratch) scratch = mkCanvas(1, 1).getContext('2d', {willReadFrequently: true});
    const c = scratch.canvas; if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
    scratch.clearRect(0, 0, w, h); scratch.drawImage(img, 0, 0);   // a SPRITE canvas (never the screen)
    const d = scratch.getImageData(0, 0, w, h).data, top = new Int16Array(w).fill(-1);
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (d[(y * w + x) * 4 + 3] > 127) { top[x] = y; break; }
    alphaCache.set(img, a = {w, h, top}); return a;
  }
  const topCache = new WeakMap();
  // the most extreme surface of a mesh (local metres) along axis `o` over the point (a, b) in the plane of axes (ia, ib)
  function surf(geo, ia, ib, o, a, b) {
    let m = topCache.get(geo); if (!m) topCache.set(geo, m = new Map());
    const key = ia + '' + ib + o + ',' + Math.round(a * 100) + ',' + Math.round(b * 100); if (m.has(key)) return m.get(key);
    const Pp = geo.attributes.position.array; let best = NaN;
    for (let i = 0; i < Pp.length; i += 9) {
      const ax = Pp[i + ia], az = Pp[i + ib], bx = Pp[i + 3 + ia], bz = Pp[i + 3 + ib], cx = Pp[i + 6 + ia], cz = Pp[i + 6 + ib];
      const d = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz); if (Math.abs(d) < 1e-9) continue;
      const l0 = ((bz - cz) * (a - cx) + (cx - bx) * (b - cz)) / d, l1 = ((cz - az) * (a - cx) + (ax - cx) * (b - cz)) / d, l2 = 1 - l0 - l1;
      if (l0 < -1e-5 || l1 < -1e-5 || l2 < -1e-5) continue;
      const v = l0 * Pp[i + o] + l1 * Pp[i + 3 + o] + l2 * Pp[i + 6 + o]; if (!(v <= best)) best = v;
    }
    m.set(key, best); return best;
  }
  const topOf = (geo, lx, lz) => surf(geo, 0, 2, 1, lx, lz);      // the highest point over (x, z)
  const frontOf = (geo, lx, ly) => surf(geo, 0, 1, 2, lx, ly);    // the most southern point at (x, height)
  const geoOf = p => host.itemOf(p)?.live?.gm.geometry || null;
  function prewarm() {   // the perch cards' alpha, read once at populate (no stutter later when a flock picks a perch)
    for (const s of spots) if (s.p && s.card) { const sp = host.biome.sprite(s.p, ctx); if (sp && sp.img && sp.img.width) alphaOf(sp.img); }
  }
  let spots = [];
  function buildSpots() {
    spots = [];
    for (const p of props) {
      const d = PERCH[p.kind]; if (!d || p.rail || p.sparring) continue;
      const card = !geoOf(p);
      for (const dx0 of d.dx) {   // jittered a little so a row of birds on a wall doesn't stand like fence posts
        const jx = d.jx ?? 2, dx = dx0 + Math.round(rr(-jx, jx)), sink = d.sink + (d.deep ? R() * (d.deep + 1) | 0 : 0);
        spots.push({p, dx, sink, kind: p.kind, card, occ: null, x: p.x + dx / ctx.PPM, y: p.y, h: 0, ok: false, geo: null, dz: 0, top: NaN});
      }
    }
    for (const q of host.layout.plateaus || []) for (let x = q.x0 + .7; x < q.x1 - .4; x += 1.05)
      spots.push({p: null, kind: 'ledge', occ: null, x, y: q.y1 - .12, h: q.h, ok: true});
    for (const s of spots) s.nb = [];
    for (let i = 0; i < spots.length; i++) for (let k = i + 1; k < spots.length; k++) {
      const a = spots[i], b = spots[k];
      if (Math.abs(a.x - b.x) < 3.8 && Math.hypot(a.x - b.x, (a.y - b.y) * 1.4) < 3.8) { a.nb.push(b); b.nb.push(a); }
    }
  }
  function spotXY(s) {   // cards face the camera, so a spot on one sits along the screen's x from its pivot
    if (!s.p) return;
    if (s.card) { const o = s.dx / ctx.PPM; s.x = s.p.x + RX * o; s.y = s.p.y + RY * o; return; }
    const ps = poseOf(s.p);
    if (!ps) { s.x = s.p.x + s.dx / ctx.PPM; s.y = s.p.y + s.dz; return; }
    // a turned, scaled model (a 3D tree): the spot was found in the model's own frame (lx, dz): turn it into the world
    const lx = (s.lx ?? s.dx / ctx.PPM) * ps.scale, lz = (s.dz || 0) * ps.scale, c = Math.cos(ps.yaw), sn = Math.sin(ps.yaw);
    s.x = s.p.x + lx * c + lz * sn; s.y = s.p.y - lx * sn + lz * c;
  }
  const poseOf = p => host.itemOf(p)?.pose || null;
  // where on the model's top the spot stands, once per model: flat tops (walls, rocks: PERCH.deep) `sink` px in from the
  // north edge like the arena's rows; crenellated / capped tops (towers, posts, pillars) on the highest point across
  // (the arena's topmost opaque pixel: a merlon, not the floor behind the parapet)
  function meshTop(s, geo) {
    if (s.geo === geo) return s.top;
    if (!geo.boundingBox) geo.computeBoundingBox();
    // a turned, scaled model (a 3D tree, item.pose): searched in its own frame (the spot's px / scale), on the highest point
    // across (a crown or a branch, not the first surface from its north edge); the height scales back
    const ps = poseOf(s.p), sc = ps ? ps.scale : 1;
    const bb = geo.boundingBox, lx = s.dx / ctx.PPM / sc; let z = Math.min(bb.min.z + .05 + s.sink / ctx.PPMY, bb.max.z - .05), top = NaN;
    if (PERCH[s.kind]?.deep && !ps) for (let k = 0; k < 12 && z < bb.max.z; k++, z += .05) { top = topOf(geo, lx, z); if (top === top) break; }
    else for (let zz = bb.min.z + .04; zz < bb.max.z - .03; zz += .04) { const t = topOf(geo, lx, zz); if (t === t && !(t <= top)) { top = t; z = zz; } }
    if (ps && top === top) top -= s.sink / ctx.PPMH;   // settle into the leaves (the crown's top is ragged)
    s.geo = geo; s.lx = lx; s.dz = z; s.top = top * sc; return s.top;
  }
  function spotPos(s) {   // refresh a spot's world point from the prop's current model / sprite
    if (!s.p) return true;
    const p = s.p; if (p.broken || p.gone) return (s.ok = false);
    if (s.card) {
      const sp = host.biome.sprite(p, ctx); if (!sp || !sp.img) return (s.ok = false);
      const col = Math.round(sp.pivot[0] + s.dx), a = alphaOf(sp.img);
      if (col < 0 || col >= a.w || a.top[col] < 0) return (s.ok = false);
      spotXY(s); s.h = (sp.pivot[1] - a.top[col] - s.sink) / ctx.PPMH + (p.z || 0) + (p.h || 0);
      return (s.ok = s.h > .15);
    }
    const geo = geoOf(p); if (!geo) return (s.ok = false);
    const top = meshTop(s, geo); spotXY(s);
    s.h = top + (p.z || 0) + (p.h || 0);
    return (s.ok = top === top && s.h > .15);
  }

  // ---------- ground: can a small animal stand here ----------
  let solids = [];
  function solid(x, y, z) {
    if (x < .6 || y < .6 || x > ctx.WM - .6 || y > ctx.HM - .6) return true;
    if (Math.abs(elev(x, y) - z) > .2) return true;
    if (z < .1 && inStream(x, y)) return true;
    for (const p of solids) {
      if (Math.abs(p.x - x) > 1.6 || p.broken || p.gone || Math.abs((p.z || 0) - z) > .8) continue;
      if (p.rect) { if (x > p.rect[0] - .06 && x < p.rect[2] + .06 && y > p.rect[1] - .06 && y < p.rect[3] + .06) return true; }
      else if (p.r > .05 && Math.hypot(p.x - x, (p.y - y) * 1.6) < p.r + .08) return true;
    }
    return false;
  }
  const clearPath = (x0, y0, x1, y1, z) => !solid((x0 + x1) / 2, (y0 + y1) / 2, z) && !solid(x1, y1, z);
  function freeNear(x, y, r, z, tries = 12) {
    for (let i = 0; i < tries; i++) { const a = R() * TAU, d = Math.sqrt(R()) * r, px = x + Math.cos(a) * d, py = y + Math.sin(a) * d * .8; if (!solid(px, py, z)) return [px, py]; }
    return null;
  }

  // ---------- noise ----------
  function gatherNoise(evs) {
    noise.length = 0; const N = TUNE.noise;
    if (P) {
      const sp = Math.hypot(P.vx || 0, P.vy || 0), st = P.state;
      let r = 0;
      if (st === 'roll') r = N.roll; else if (st === 'leap') r = N.leap; else if (st === 'knock') r = N.knock;
      else if (st === 'climb') r = N.climb; else if (st === 'release') r = N.release;
      else if (sp > .3) r = P.gait === 'sprint' || P.gait === 'drive' || sp > 5.2 ? N.sprint : P.gait === 'run' || sp > 2.4 ? N.run : N.walk;
      PN.x = P.x; PN.y = P.y; PN.h = P.z || 0; PN.r = r; PN.moving = r > 0;
    }
    for (const a of host.arrows || []) if (!a.stuck && a.life > -9) noise.push({x: a.x, y: a.y, h: a.h || 0, r: N.arrow});
    for (const e of evs || []) {
      let r = 0;
      switch (e.type) {
        case 'hit': r = e.player ? N.hitMe : N.hit; break;
        case 'break': r = N.break; break;
        case 'explode': r = N.explode * (e.r || 2.4); break;
        case 'splash': r = e.wl ? N.splashAnimal : e.small ? N.splashSmall : e.prop ? N.propSplash : N.splash; break;
        case 'loot': r = N.loot; break; case 'open': r = N.open; break;
        case 'land': r = e.prop ? N.propLand : e.big >= 3 ? N.landBig : e.big >= 2 ? N.land : 0; break;
        case 'impact': case 'tip': case 'kick': r = N.impact; break;
        case 'scrape': r = N.scrape; break;
        case 'jump': r = N.jump; break;
        case 'birds_scatter': r = N.scatter; break;
      }
      if (r > 0 && e.x !== undefined) noise.push({x: e.x, y: e.y, h: e.z ?? elev(e.x, e.y), r, ev: e.type});
    }
  }
  const TH = {t: 0, x: 0, y: 0};
  function threat(x, y, h, sp) {
    TH.t = 0;
    if (P) {
      const dx = x - PN.x, dy = y - PN.y, dh = (h - PN.h) * .6, d = Math.sqrt(dx * dx + dy * dy + dh * dh) + .05;
      const r = Math.max(PN.r * sp.sens, sp.shy * (PN.moving ? 1 : .6)), k = r / d;
      if (k > TH.t) { TH.t = k; TH.x = PN.x; TH.y = PN.y; }
    }
    for (const n of noise) {
      const dx = x - n.x, dy = y - n.y, dh = (h - n.h) * .6, k = n.r * sp.sens / (Math.sqrt(dx * dx + dy * dy + dh * dh) + .05);
      if (k > TH.t) { TH.t = k; TH.x = n.x; TH.y = n.y; }
    }
    return TH;
  }

  // =================================================================== state (per biome)
  let flocks = [], birds = [], hoppers = [], lizards = [], frogs = [], fish = [], bugs = [], vultures = [], jellies = [], eyes = [], motes = [];
  let school = null, fishT = 4, SPR = {};

  // =================================================================== BIRDS
  function newBird(sp, f) {
    return {sp, f, x: 0, y: 0, h: 0, z: 0, vx: 0, vy: 0, vh: 0, fx: rface(), fy: 0, st: 'ground', act: 'stand', at: R() * 2,
      ph: R() * TAU, flap: R(), glide: 0, air: 0, dly: 0, hop: null, walk: null, spot: null, tg: null, ro: rr(-.5, .5), ho: rr(-.35, .35), cawT: rr(5, 18), caw: 0};
  }
  function newFlock(spId, n, homes) {
    const sp = SPECIES[spId], f = {sp, birds: [], homes: homes || [], home: null, mode: 'feed', t: rr(20, 40), cx: 0, cy: 0, R: 3, alt: 3, dir: 1,
      intent: 'home', dest: 'ground', calmT: 99, scared: false, sx: 0, sy: 0};
    for (let i = 0; i < n; i++) { const b = newBird(sp, f); f.birds.push(b); birds.push(b); }
    flocks.push(f); return f;
  }
  function placeFeeding(f, home) {
    f.home = {x: home[0], y: home[1], z: elev(home[0], home[1]), r: 1.2};
    for (const b of f.birds) {
      const q = freeNear(f.home.x, f.home.y, f.home.r, f.home.z, 20) || [f.home.x, f.home.y];
      Object.assign(b, {x: q[0], y: q[1], h: f.home.z, z: f.home.z, st: 'ground', tg: null, spot: null, hop: null, walk: null, dly: 0});
    }
    f.mode = 'feed'; f.t = rr(25, 50);
  }
  function placePerched(f) {
    const c = centroid(f);
    if (!assignPerches(f, c.x, c.y, false)) return false;
    for (const b of f.birds) { if (!b.tg) continue; settle(b); }
    f.mode = 'perch'; f.t = rr(15, 40); return true;
  }
  function centroid(f) {
    let x = 0, y = 0; for (const b of f.birds) { x += b.x; y += b.y; }
    return {x: x / f.birds.length, y: y / f.birds.length};
  }
  function release(b) { if (b.spot) { if (b.spot.occ === b) b.spot.occ = null; b.spot = null; } if (b.tg && b.tg.spot && b.tg.spot.occ === b) b.tg.spot.occ = null; b.tg = null; }
  function takeOff(f, scared, intent, sx, sy) {
    const c = centroid(f);
    f.mode = 'air'; f.intent = intent; f.scared = scared; f.sx = sx ?? c.x; f.sy = sy ?? c.y;
    let ax = c.x - f.sx, ay = c.y - f.sy, d = Math.hypot(ax, ay);
    if (d < .01) { const a = R() * TAU; ax = Math.cos(a); ay = Math.sin(a); d = 1; }
    const k = scared ? rr(3.5, 5.5) : rr(1.5, 3);
    f.cx = c.x + ax / d * k; f.cy = c.y + ay / d * k * .8;
    f.R = f.sp.solo ? rr(2.5, 4) : rr(2, 3.4); f.alt = rr(f.sp.alt[0], f.sp.alt[1]); f.dir = R() < .5 ? -1 : 1;
    f.t = scared ? rr(3.5, 6.5) : rr(1.2, 2.6);
    for (const b of f.birds) {
      const settled = b.st !== 'fly';
      if (settled) b.lift = b.spot;   // (drawn a hair in front of a card perch until it lifts off)
      release(b); b.hop = null; b.walk = null; b.caw = 0; b.ghome = null;
      if (settled) { b.st = 'fly'; b.air = 0; b.dly = scared ? rr(0, .22) : rr(0, .7); }
    }
    if (scared) {
      if (f.sp.solo) { emit('wings', c.x, c.y); if (f.sp.caw && R() < .6) { CD.caw = 0; emit('caw', c.x, c.y); } }
      else emit('birds_scatter', c.x, c.y, {n: f.birds.length});
    } else if (near(c.x, c.y)) emit('wings', c.x, c.y);
    f.calmT = scared ? 0 : f.calmT;
  }
  function launch(b, f) {
    const ax = b.x - f.sx, ay = b.y - f.sy, d = Math.hypot(ax, ay) || 1;
    if (f.scared) { const s = f.sp.speed * rr(.75, 1); b.vx = ax / d * s + rr(-.8, .8); b.vy = ay / d * s * .8 + rr(-.8, .8); b.vh = rr(2.6, 3.6) * (f.sp.heavy ? .8 : 1); }
    else { b.vx = (f.cx - b.x) * .4 + rr(-.4, .4); b.vy = (f.cy - b.y) * .4 + rr(-.4, .4); b.vh = rr(1.4, 2.2); }
    if (Math.hypot(b.vx, b.vy) > .2) faceV(b, b.vx, b.vy);
    if (b.lift) perchEv(b, b.lift, true);
    b.st = 'fly'; b.air = 0; b.spot = null; b.lift = null;
  }
  function settle(b) {
    const tg = b.tg; b.tg = null; if (!tg) return;
    b.x = tg.x; b.y = tg.y; b.h = tg.h; b.vx = b.vy = b.vh = 0; b.air = 0;
    if (tg.spot) { b.st = 'perch'; b.spot = tg.spot; tg.spot.occ = b; } else { b.st = 'ground'; b.z = tg.h; }
    b.act = 'stand'; b.at = rr(.4, 1.4); b.hop = null; b.walk = null;
  }
  function assignPerches(f, cx, cy, avoidPlayer) {
    const pref = f.sp.perch, n = f.birds.length;
    let best = null;
    for (const s of spots) spotXY(s);   // props can move and cards follow the camera: read them live
    const scored = [];
    for (const s of spots) {
      const w = pref[s.kind]; if (!w || s.occ) continue;
      const d = Math.hypot(s.x - cx, s.y - cy); if (d > 18) continue;
      const pd = P ? Math.hypot(s.x - P.x, s.y - P.y) : 99;
      let cap = 1; if (n > 1) for (const o of s.nb) if (pref[o.kind] && !o.occ) cap++;
      const crowded = f.sp.solo && s.p && s.nb.some(o => o.p === s.p && o.occ);
      scored.push([w * 2 - d * .12 - (pd < 5.5 && avoidPlayer ? 14 : 0) + Math.min(cap, n) * 1.2 - (crowded ? 6 : 0) + R() * 3, s]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < scored.length && i < 10 && !best; i++) if (spotPos(scored[i][1])) best = scored[i][1];
    if (!best) return false;
    const cands = [best];
    for (const s of best.nb) if (pref[s.kind] && !s.occ) cands.push(s);
    cands.sort((a, b) => Math.hypot(a.x - best.x, a.y - best.y) - Math.hypot(b.x - best.x, b.y - best.y));
    const bs2 = [...f.birds].sort((a, b) => Math.hypot(a.x - best.x, a.y - best.y) - Math.hypot(b.x - best.x, b.y - best.y));
    let i = 0;
    for (const b of bs2) {
      let s = null; while (i < cands.length && i < n * 2 + 4 && !s) { const c = cands[i++]; if (spotPos(c)) s = c; }
      if (s) { b.tg = {spot: s, x: s.x, y: s.y, h: s.h}; s.occ = b; }
      else {
        const z = elev(best.x, best.y + .6), q = freeNear(best.x, best.y + 1, 1.2, z) || freeNear(cx, cy, 2, elev(cx, cy));
        if (q) { b.tg = {spot: null, x: q[0], y: q[1], h: elev(q[0], q[1])}; b.ghome = {x: q[0], y: q[1], z: b.tg.h, r: 1}; }
        else b.tg = {spot: best, x: best.x, y: best.y, h: best.h};
      }
    }
    return n > 0;
  }
  function farHome(f, from) {
    let best = null, bd = -1;
    for (const h of f.homes) { const d = from ? Math.hypot(h[0] - from.x, h[1] - from.y) : R() * 10; if (d > bd) { bd = d; best = h; } }
    return best;
  }
  function land(f) {
    let dest = f.intent === 'roost' || f.intent === 'perch' ? 'perch' : 'ground';
    const c = centroid(f);
    if (dest === 'ground') {
      let h = f.intent === 'home2' ? pick(f.homes.filter(q => !f.home || q[0] !== f.home.x || q[1] !== f.home.y)) || farHome(f, P) : (f.home ? [f.home.x, f.home.y] : farHome(f, P));
      if (P && Math.hypot(h[0] - P.x, h[1] - P.y) < 5.5) { h = farHome(f, P); if (Math.hypot(h[0] - P.x, h[1] - P.y) < 5.5) dest = 'perch'; }
      if (dest === 'ground') {
        f.home = {x: h[0], y: h[1], z: elev(h[0], h[1]), r: 1.2};
        for (const b of f.birds) { const q = freeNear(f.home.x, f.home.y, f.home.r, f.home.z, 16) || [f.home.x, f.home.y]; b.tg = {spot: null, x: q[0], y: q[1], h: f.home.z}; }
      }
    }
    if (dest === 'perch' && !assignPerches(f, c.x, c.y, true)) {
      const h = farHome(f, P) || [c.x, c.y]; f.home = {x: h[0], y: h[1], z: elev(h[0], h[1]), r: 1.2}; dest = 'ground';
      for (const b of f.birds) { const q = freeNear(f.home.x, f.home.y, f.home.r, f.home.z, 16) || [f.home.x, f.home.y]; b.tg = {spot: null, x: q[0], y: q[1], h: f.home.z}; }
    }
    f.mode = 'land'; f.dest = dest; f.t = 14;
    for (const b of f.birds) b.air = Math.min(b.air, 1);
  }
  function stepFlock(f, dt) {
    f.t -= dt; f.calmT += dt;
    const night = time === 'night', c = f.birds[0];
    const detail = c && (near(c.x, c.y) || (P && Math.hypot(c.x - P.x, c.y - P.y) < 26));
    if (detail && f.mode !== 'air') {
      let tmax = 0, sx = 0, sy = 0;
      for (const b of f.birds) {
        if (b.st === 'fly') continue;
        const th = threat(b.x, b.y, b.h, f.sp);
        if (th.t > tmax) { tmax = th.t; sx = th.x; sy = th.y; }
        b.nerv = th.t >= TUNE.nervous ? th : null;
        if (b.nerv) b.nx = th.x, b.ny = th.y;
      }
      if (tmax > .35) f.calmT = 0;
      if (tmax >= 1) { takeOff(f, true, f.sp.solo ? 'perch' : night ? 'roost' : R() < .55 ? 'perch' : 'home2', sx, sy); return; }
    }
    switch (f.mode) {
      case 'feed':
        if (night) takeOff(f, false, 'roost');
        else if (f.t <= 0) takeOff(f, false, f.sp.solo ? 'perch' : R() < f.sp.perchLike ? 'perch' : 'home2');
        break;
      case 'perch':
        if (f.t > 0 || night) break;
        if (f.calmT < 4 || (P && f.home && Math.hypot(f.home.x - P.x, f.home.y - P.y) < 5)) { f.t = rr(3, 6); break; }
        if (f.sp.solo) {
          if (R() < .45) { const q = freeNear(c.x, c.y + 2, 5, 0, 20); if (q && (!P || Math.hypot(q[0] - P.x, q[1] - P.y) > 6)) { f.home = {x: q[0], y: q[1], z: 0, r: 1.5}; f.homes = [[q[0], q[1]]]; takeOff(f, false, 'home'); break; } }
          takeOff(f, false, 'perch');
        } else takeOff(f, false, 'home');
        break;
      case 'air': if (f.t <= 0) land(f); break;
      case 'land': {
        let all = true; for (const b of f.birds) if (b.st === 'fly') { all = false; break; }
        if (all || f.t <= 0) {
          for (const b of f.birds) if (b.st === 'fly' && b.tg) settle(b);
          f.mode = f.dest === 'ground' ? 'feed' : 'perch';
          f.t = f.mode === 'feed' ? (f.sp.solo ? rr(8, 16) : rr(20, 45)) : f.scared ? rr(8, 16) : rr(14, 35);
          f.scared = false;
        }
        break;
      }
    }
  }
  function stepBird(b, dt) {
    const f = b.f, sp = b.sp;
    b.caw = Math.max(0, b.caw - dt);
    if (b.st === 'fly') return flyBird(b, f, dt);
    if (b.st === 'perch') {
      if (b.spot && !spotPos(b.spot)) { takeOff(f, false, 'perch'); return; }
      if (b.spot) { b.x = b.spot.x; b.y = b.spot.y; b.h = b.spot.h; }
      b.at -= dt;
      if (b.at <= 0) { const r = R(); b.act = r < .25 ? 'bob' : 'stand'; if (r > .8) flipF(b); b.at = b.act === 'bob' ? rr(.3, .7) : rr(1, 4); }
      if (sp.caw && time !== 'night' && (b.cawT -= dt) <= 0) {
        b.cawT = rr(9, 26);
        if (near(b.x, b.y) && emit('caw', b.x, b.y)) b.caw = .45;
      }
      return;
    }
    if (b.hop) {
      const H = b.hop; H.t += dt; const k = Math.min(1, H.t / H.d);
      b.x = H.x0 + (H.x1 - H.x0) * k; b.y = H.y0 + (H.y1 - H.y0) * k; b.h = b.z + Math.sin(k * Math.PI) * H.a;
      if (k >= 1) { b.hop = null; b.h = b.z; }
      return;
    }
    if (b.nerv && b.act !== 'alert2') {
      const dx = b.x - b.nx, dy = b.y - b.ny, d = Math.hypot(dx, dy) || 1, s = sp.walker ? .22 : .3;
      const x1 = b.x + dx / d * s + rr(-.08, .08), y1 = b.y + dy / d * s * .8 + rr(-.06, .06);
      faceV(b, dx, dy); b.nerv = null;
      if (clearPath(b.x, b.y, x1, y1, b.z)) { b.hop = {x0: b.x, y0: b.y, x1, y1, t: 0, d: sp.walker ? .32 : .2, a: sp.walker ? .025 : .07}; b.act = 'bob'; b.at = .3; return; }
    }
    if (b.walk) {
      const Wk = b.walk; Wk.t -= dt;
      const x1 = b.x + Wk.vx * dt, y1 = b.y + Wk.vy * dt;
      if (Wk.t <= 0 || solid(x1, y1, b.z)) b.walk = null; else { b.x = x1; b.y = y1; }
      b.act = ((T * 5 + b.ph) | 0) & 1 ? 'bob' : 'stand';
      if (!b.walk) { b.act = 'stand'; b.at = rr(.2, .8); }
      return;
    }
    b.at -= dt; if (b.at > 0) return;
    const hm = b.ghome || f.home, far = hm && Math.hypot(b.x - hm.x, b.y - hm.y) > hm.r;
    const r = R();
    if (r < .38 && !far) { b.act = 'peck'; b.at = rr(.5, 1.3); return; }
    if (r < .72 || far) {
      let a = R() * TAU; if (far) a = Math.atan2(hm.y - b.y, hm.x - b.x) + rr(-.5, .5);
      if (sp.walker && R() < .7) { const s = sp.solo ? .45 : .32; b.walk = {vx: Math.cos(a) * s, vy: Math.sin(a) * s * .8, t: rr(.5, 1.4)}; faceV(b, b.walk.vx, b.walk.vy); return; }
      const d = rr(.12, .3), x1 = b.x + Math.cos(a) * d, y1 = b.y + Math.sin(a) * d * .8;
      if (clearPath(b.x, b.y, x1, y1, b.z)) { b.hop = {x0: b.x, y0: b.y, x1, y1, t: 0, d: .2, a: .06}; faceV(b, x1 - b.x, y1 - b.y); }
      b.act = 'stand'; b.at = rr(.15, .6); return;
    }
    b.act = r < .9 ? 'stand' : 'alert'; if (R() < .5) flipF(b); b.at = rr(.4, 1.6);
  }
  function flyBird(b, f, dt) {
    const sp = b.sp;
    if (b.dly > 0) { b.dly -= dt; b.act = 'alert'; if (b.dly > 0) return; launch(b, f); }
    b.air += dt;
    let dvx, dvy, dvh, agil = sp.agil, d3 = 9;
    if (b.tg) {
      if (b.tg.spot) { spotXY(b.tg.spot); b.tg.x = b.tg.spot.x; b.tg.y = b.tg.spot.y; }   // a card perch moves with the camera
      const dx = b.tg.x - b.x, dy = b.tg.y - b.y, dh = b.tg.h - b.h, dxy = Math.hypot(dx, dy);
      d3 = Math.hypot(dxy, dh);
      const spd = Math.min(sp.speed, .7 + dxy * 2.2), tt = Math.max(.2, dxy / Math.max(.6, spd));
      dvx = dx / (dxy || 1) * spd; dvy = dy / (dxy || 1) * spd; dvh = clamp(dh / tt, -2.8, 2.8);
      if (dxy > 2.5 && dh < 0) dvh = Math.max(dvh, -.5);
      agil *= 2.2;
      if (d3 < .1 || (dxy < .16 && Math.abs(dh) < .2) || b.air > 12) { settle(b); if (b.spot) perchEv(b, b.spot, false); if (f.birds.every(o => o.st !== 'fly')) emitLanding(f); return; }
    } else {
      const rx = b.x - f.cx, ry = b.y - f.cy, d = Math.hypot(rx, ry) || .01, R0 = f.R + b.ro;
      const tx = -ry / d * f.dir, ty = rx / d * f.dir, pull = clamp((R0 - d) * .9, -2.2, 2.2);
      dvx = tx * sp.speed + rx / d * pull; dvy = ty * sp.speed * .8 + ry / d * pull;
      dvh = clamp((f.alt + b.ho - b.h) * 1.3, -1.5, 2.2);
      if (b.air < .7) agil *= .45;
    }
    if (d3 > 1.5) for (const o of f.birds) {
      if (o === b || o.st !== 'fly') continue;
      const dx = b.x - o.x, dy = b.y - o.y, dh = b.h - o.h, q = dx * dx + dy * dy + dh * dh;
      if (q < .2 && q > 1e-6) { const d = Math.sqrt(q), k = (.45 - d) * 5 / d; dvx += dx * k; dvy += dy * k; dvh += dh * k * .4; }
    }
    const w = windAt(b.x, b.y), k = Math.min(1, dt * agil);
    b.vx += (dvx + w.x * .35 - b.vx) * k; b.vy += (dvy + w.y * .35 - b.vy) * k; b.vh += (dvh - b.vh) * Math.min(1, dt * agil * 1.3);
    b.x += b.vx * dt; b.y += b.vy * dt; b.h += b.vh * dt;
    const gz = elev(b.x, b.y); if (!b.tg && b.h < gz + .3) { b.h = gz + .3; b.vh = Math.max(0, b.vh); }
    if (Math.hypot(b.vx, b.vy) > .3) faceV(b, b.vx, b.vy);
    const hard = b.air < .9 || b.vh > .5 || (b.tg && d3 < 1.2);
    const gl = !hard && !b.tg && Math.sin(T * (sp.heavy ? .5 : .8) + b.ph) > (sp.heavy ? -.1 : .25);
    b.glide = gl ? 1 : 0;
    if (!gl) b.flap = (b.flap + dt * sp.flap * (hard ? 1.45 : 1)) % 1;
  }
  function emitLanding(f) { const c = centroid(f); if (near(c.x, c.y)) emit('wings', c.x, c.y); }
  function birdFrame(b) {
    if (b.st === 'fly' && b.dly <= 0) { if (b.glide) return 'mid'; const i = (b.flap * 4) | 0; return i === 0 ? 'up' : i === 2 ? 'down' : 'mid'; }
    if (b.caw > 0 && ART[b.sp.id].caw) return 'caw';
    if (b.st === 'perch' && time === 'night' && b.f.mode === 'perch') return 'sleep';
    if (b.act === 'peck') return ((T * 3.2 + b.ph) | 0) & 1 ? 'peck' : 'stand';
    if (b.hop && b.sp.walker) return ((b.hop.t * 8) | 0) & 1 ? 'bob' : 'stand';
    return b.act === 'bob' ? 'bob' : b.act === 'alert' || b.dly > 0 ? 'alert' : 'stand';
  }

  // =================================================================== RABBITS / HARES
  function newHopper(spId, homeX, homeY, cover) {
    const a = {sp: SPECIES[spId], id: spId, x: homeX, y: homeY, z: elev(homeX, homeY), h: 0, fx: rface(), fy: 0, st: 'graze', at: rr(1, 4),
      hx: homeX, hy: homeY, cover, hop: null, run: 0, hide: 0, dashCD: 0, alertT: 0, frz: 0, ph: R() * TAU};
    a.h = a.z; hoppers.push(a); return a;
  }
  function hopTo(a, x1, y1, d, amp) { a.hop = {x0: a.x, y0: a.y, x1, y1, t: 0, d, a: amp}; if (Math.hypot(x1 - a.x, y1 - a.y) > .02) faceV(a, x1 - a.x, y1 - a.y); }
  function stepHopper(a, dt) {
    a.dashCD -= dt;
    if (a.hop) {
      const H = a.hop; H.t += dt; const k = Math.min(1, H.t / H.d);
      a.x = H.x0 + (H.x1 - H.x0) * k; a.y = H.y0 + (H.y1 - H.y0) * k; a.h = a.z + Math.sin(k * Math.PI) * H.a;
      if (k < 1) return; a.hop = null; a.h = a.z;
    }
    if (a.st === 'gone') { a.hide -= dt; if (a.hide <= 0 && !near(a.hx, a.hy)) { a.x = a.hx; a.y = a.hy; a.st = a.cover ? 'hide' : 'graze'; a.hide = rr(2, 5); } else if (a.hide <= 0) a.hide = 2; return; }
    const detail = near(a.x, a.y);
    const th = detail ? threat(a.x, a.y, a.h, a.sp) : null;
    if (a.st === 'hide') {
      if (th && th.t > .4) a.hide = Math.max(a.hide, rr(4, 7));
      if ((a.hide -= dt) <= 0) { const q = freeNear(a.cover.x + a.fx * .45, a.cover.y + .25, .3, a.z, 8); if (q) { hopTo(a, q[0], q[1], .3, .06); a.st = 'alert'; a.alertT = rr(1.2, 2.4); } else a.hide = 2; }
      return;
    }
    if (a.st === 'flee') {
      if (a.frz > 0) { a.frz -= dt; return; }
      const tx = a.fxT, ty = a.fyT, dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
      if (a.cover && d < .25) { a.x = tx; a.y = ty; a.st = 'hide'; a.hide = rr(6, 12); return; }
      if (!a.cover && (d < .4 || (a.run -= dt) <= 0)) {
        if (!near(a.x, a.y) || a.id === 'hare') { a.st = a.id === 'hare' ? 'freeze' : 'gone'; a.hide = rr(8, 15); a.at = rr(2.5, 5); if (a.id === 'hare') { a.hx = a.x; a.hy = a.y; } return; }
        a.st = 'graze'; a.at = 1; return;
      }
      const s = Math.min(d, a.id === 'hare' ? .95 : .8), x1 = a.x + dx / d * s, y1 = a.y + dy / d * s;
      if (!a.cover && solid(x1, y1, a.z)) {
        for (const da of [.6, -.6, 1.2, -1.2]) { const aa = Math.atan2(dy, dx) + da, x2 = a.x + Math.cos(aa) * s, y2 = a.y + Math.sin(aa) * s; if (!solid(x2, y2, a.z)) { hopTo(a, x2, y2, .19, .13); return; } }
        a.st = 'freeze'; a.at = rr(2, 4); return;
      }
      hopTo(a, x1, y1, .19, .13); return;
    }
    if (th && th.t >= 1) { startFlee(a, th.x, th.y); return; }
    if (a.st === 'freeze') { if ((a.at -= dt) <= 0) { a.st = 'graze'; a.at = rr(1, 3); } return; }
    if (th && th.t >= TUNE.nervous) { a.st = 'alert'; a.alertT = rr(1.2, 2.2); faceV(a, th.x - a.x, th.y - a.y); return; }
    if (a.st === 'alert') { if ((a.alertT -= dt) <= 0) { a.st = 'graze'; a.at = rr(.5, 2); } return; }
    if ((a.at -= dt) > 0) return;
    const r = R();
    if (r < .45) { a.nib = !a.nib; a.at = rr(1, 3); return; }
    const far = Math.hypot(a.x - a.hx, a.y - a.hy) > 2.2;
    let ang = far ? Math.atan2(a.hy - a.y, a.hx - a.x) + rr(-.4, .4) : R() * TAU;
    if (r > .93 && a.cover && !far) {
      const nb = coverNear(a.x, a.y, 7, a.cover); if (nb) { a.cover = nb; a.hx = nb.x + rr(-.8, .8); a.hy = nb.y + rr(.4, 1.2); ang = Math.atan2(a.hy - a.y, a.hx - a.x); }
    }
    const s = rr(.25, .45), x1 = a.x + Math.cos(ang) * s, y1 = a.y + Math.sin(ang) * s * .8;
    if (clearPath(a.x, a.y, x1, y1, a.z)) hopTo(a, x1, y1, .28, .08);
    a.nib = false; a.at = rr(.4, 2.5);
  }
  function coverNear(x, y, r, not) {
    let best = null, bd = 1e9;
    for (const p of props) if (p.kind === 'bush' && p !== not && !p.broken) { const d = Math.hypot(p.x - x, p.y - y); if (d < r && d > 1.5 && d < bd) { bd = d; best = p; } }
    return best;
  }
  function startFlee(a, sx, sy) {
    let ax = a.x - sx, ay = a.y - sy; const d = Math.hypot(ax, ay) || 1; ax /= d; ay /= d;
    a.st = 'flee'; a.nib = false; a.frz = a.id === 'hare' ? .35 : 0;
    let cov = null;
    if (a.id === 'rabbit') {
      let bs = -1e9;
      for (const p of props) {
        if (p.kind !== 'bush' || p.broken || Math.abs((p.z || 0) - a.z) > .2) continue;
        const dx = p.x - a.x, dy = p.y - a.y, dd = Math.hypot(dx, dy); if (dd > 8 || dd < .3) continue;
        const along = (dx * ax + dy * ay) / dd, fromSrc = Math.hypot(p.x - sx, p.y - sy);
        if (along < -.2 || fromSrc < 2.2) continue;
        let open = true;
        for (let k = 1; k < 6 && open; k++) { const f = k / 6 * Math.max(0, dd - .45) / dd; if (solid(a.x + dx * f, a.y + dy * f, a.z)) open = false; }
        if (!open) continue;
        const sc = along * 2 + fromSrc * .25 - dd * .15; if (sc > bs) { bs = sc; cov = p; }
      }
    }
    a.cover = cov || (a.id === 'rabbit' ? a.cover : null);
    if (cov) { a.fxT = cov.x + rr(-.1, .1); a.fyT = cov.y - .06; }
    else { a.cover = null; const L = a.id === 'hare' ? rr(6, 9) : 14; a.fxT = a.x + ax * L; a.fyT = a.y + ay * L * .8; a.run = a.id === 'hare' ? 3 : 6; }
    if (a.dashCD <= 0) { emit('critter_dash', a.x, a.y); a.dashCD = 3; }
  }
  function hopperFrame(a) {
    if (a.hop) return a.hop.t / a.hop.d < .55 ? 'hop' : 'hop2';
    if (a.st === 'alert' || a.st === 'freeze' || a.frz > 0) return 'alert';
    return a.nib && ((T * 2.5 + a.ph) | 0) % 3 ? 'nibble' : 'sit';
  }

  // =================================================================== SALAMANDERS
  function newLizard(x, y) {
    const a = {x, y, z: elev(x, y), hx: x, hy: y, fx: rface(), fy: 0, st: 'freeze', at: rr(.5, 3), vx: 0, vy: 0, ph: R()};
    lizards.push(a); return a;
  }
  function stepLizard(a, dt) {
    if (a.st === 'dart') {
      const x1 = a.x + a.vx * dt, y1 = a.y + a.vy * dt;
      if (solid(x1, y1, a.z)) { a.st = 'freeze'; a.at = rr(.8, 2.5); }
      else { a.x = x1; a.y = y1; a.ph += dt * 14; }
      if ((a.at -= dt) <= 0) { a.st = 'freeze'; a.at = rr(1.2, 4); }
      return;
    }
    const th = near(a.x, a.y) ? threat(a.x, a.y, a.z, SPECIES.salamander) : null;
    if (th && th.t >= 1) {
      const ang = Math.atan2(a.y - th.y, a.x - th.x) + rr(-.5, .5), s = rr(3.4, 4.2);
      a.vx = Math.cos(ang) * s; a.vy = Math.sin(ang) * s * .8; a.st = 'dart'; a.at = rr(.35, .6); faceV(a, a.vx, a.vy);
      emit('critter_dash', a.x, a.y); return;
    }
    if ((a.at -= dt) > 0) return;
    let ang = Math.atan2(a.fy, a.fx) + rr(-1.1, 1.1);
    if (Math.hypot(a.x - a.hx, a.y - a.hy) > 3.5) ang = Math.atan2(a.hy - a.y, a.hx - a.x);
    const s = rr(2.2, 3.2); a.vx = Math.cos(ang) * s; a.vy = Math.sin(ang) * s * .8; faceV(a, a.vx, a.vy);
    a.st = 'dart'; a.at = rr(.14, .32);
    if (near(a.x, a.y) && R() < .3) emit('critter_dash', a.x, a.y);
  }

  // =================================================================== FROGS (banks) and FISH (stream)
  function bankPoint(y, side) { const s = S(); return [s.cx(y) + side * (s.w(y) / 2 + .14), y]; }
  function newFrog(y, side) {
    const [x] = bankPoint(y, side);
    const a = {x, y, side, h: 0, st: 'sit', at: rr(1, 4), fx: -side, fy: 0, jump: null, gone: 0, pulse: 0};
    frogs.push(a); return a;
  }
  function stepFrog(a, dt) {
    a.pulse = Math.max(0, a.pulse - dt);
    if (a.jump) {
      const J = a.jump; J.t += dt; const k = Math.min(1, J.t / J.d);
      a.x = J.x0 + (J.x1 - J.x0) * k; a.y = J.y0 + (J.y1 - J.y0) * k; a.h = Math.sin(k * Math.PI) * J.a;
      if (k < 1) return;
      a.jump = null; a.h = 0;
      if (J.water) { splash(a.x, a.y); a.st = 'swim'; a.at = rr(1, 1.8); a.sx = a.x; a.sy = a.y; }
      return;
    }
    if (a.st === 'swim') { a.at -= dt; a.y += .5 * dt; if (a.at <= 0) { a.st = 'gone'; a.gone = rr(7, 14); } return; }
    if (a.st === 'gone') {
      if ((a.gone -= dt) > 0) return;
      const y = rr(15.5, 27.5), side = R() < .5 ? -1 : 1, [x] = bankPoint(y, side);
      if (P && Math.hypot(x - P.x, y - P.y) < 5) { a.gone = 2; return; }
      if (inStream(x, y) || solid(x, y, 0)) { a.gone = 1; return; }
      Object.assign(a, {x, y, side, fx: -side, fy: 0, st: 'sit', at: rr(2, 5)});
      if (near(x, y)) { const s = S(), cx = s.cx(y); a.jump = {x0: cx + side * s.w(y) * .2, y0: y + .2, x1: x, y1: y, t: 0, d: .32, a: .22, water: false}; a.x = a.jump.x0; splash(a.jump.x0, a.jump.y0); }
      return;
    }
    const th = near(a.x, a.y) ? threat(a.x, a.y, 0, SPECIES.frog) : null;
    if (th && th.t >= 1) {
      const s = S(), tx = s.cx(a.y) + a.side * s.w(a.y) * rr(.05, .22), ty = a.y + rr(-.3, .3);
      a.jump = {x0: a.x, y0: a.y, x1: tx, y1: ty, t: 0, d: .34, a: .28, water: true}; faceV(a, tx - a.x, ty - a.y);
      emit('frog_jump', a.x, a.y); return;
    }
    if ((a.at -= dt) > 0) return;
    if (R() < .6) { a.pulse = .5; a.at = rr(1, 3.5); return; }
    const y1 = clamp(a.y + rr(-.5, .5), 15.3, 27.7), [x1] = bankPoint(y1, a.side);
    if (!inStream(x1, y1)) { a.jump = {x0: a.x, y0: a.y, x1, y1, t: 0, d: .26, a: .12, water: false}; if (Math.hypot(x1 - a.x, y1 - a.y) > .02) faceV(a, x1 - a.x, y1 - a.y); }
    a.at = rr(3, 8);
  }
  function newFish(y) {
    const a = {y, u: rr(-.3, .3), v: rr(.25, .5) * (R() < .5 ? -1 : 1), du: 0, st: 'swim', at: rr(1, 4), jump: null, x: 0, h: 0, fx: 1, fy: 0, ph: R() * TAU, dart: 0};
    fish.push(a); return a;
  }
  function stepFish(a, dt) {
    const s = S();
    if (a.jump) {
      const J = a.jump; J.t += dt; const k = Math.min(1, J.t / J.d);
      a.x = J.x0 + (J.x1 - J.x0) * k; a.y = J.y0 + (J.y1 - J.y0) * k; a.h = Math.sin(k * Math.PI) * J.a;
      if (k >= 1) { a.jump = null; a.h = 0; splash(a.x, a.y); a.u = (a.x - s.cx(a.y)) / s.w(a.y); }
      return;
    }
    const th = near(s.cx(a.y), a.y) ? threat(s.cx(a.y) + a.u * s.w(a.y), a.y, 0, SPECIES.fish) : null;
    if (th && th.t >= 1 && a.dart <= 0) { a.v = Math.sign(a.y - th.y || 1) * rr(1.4, 2); a.dart = rr(.6, 1); }
    if (a.dart > 0) { a.dart -= dt; if (a.dart <= 0) a.v = Math.sign(a.v) * rr(.25, .5); }
    if ((a.at -= dt) <= 0) { a.at = rr(1.5, 4); a.du = rr(-.12, .12); if (R() < .25) a.v = -a.v; }
    a.u = clamp(a.u + a.du * dt, -.34, .34);
    a.y += a.v * dt;
    if (a.y < 1.5 || a.y > 29) { a.v = -a.v; a.y = clamp(a.y, 1.5, 29); }
    for (const st of s.stones || []) if (Math.hypot(s.cx(a.y) + a.u * s.w(a.y) - st.x, a.y - st.y) < st.r + .2) { a.v = -a.v; a.y += a.v * dt * 2; }
    a.x = s.cx(a.y) + a.u * s.w(a.y);
  }
  function fishJump() {
    const cand = fish.filter(a => !a.jump && near(a.x, a.y) && a.y > 1.5 && a.y < 29);
    if (!cand.length) return false;
    const a = pick(cand), dir = R() < .5 ? -1 : 1;
    let x1 = a.x + dir * rr(.3, .6); const y1 = a.y + rr(-.25, .25);
    if (!inStream(x1, y1)) x1 = a.x - dir * rr(.2, .4);
    if (!inStream(x1, y1)) return false;
    a.jump = {x0: a.x, y0: a.y, x1, y1, t: 0, d: rr(.5, .65), a: rr(.35, .55)}; faceV(a, x1 - a.x, y1 - a.y);
    emit('fish_jump', a.x, a.y); splash(a.x, a.y);
    return true;
  }

  // =================================================================== INSECTS: butterflies (day), moths (lights)
  function lightSources() {
    const L = [];
    for (const p of props) if ((p.kind === 'brazier' || p.kind === 'torch') && !p.unlit) {
      const sp = host.biome.sprite(p, ctx), l = sp && sp.lights && sp.lights[0];
      L.push({x: p.x + (l?.dx || 0), y: p.y + (l?.dy || 0), h: (l?.h ?? (p.kind === 'torch' ? 1.6 : 1.1)) + (p.z || 0), kind: p.kind});
    }
    if (biome === 'ember') for (const l of host.biome.groundLights || [])
      if (l.x > 1 && l.x < ctx.WM - 1 && l.y > 1 && l.y < ctx.HM - 1) L.push({x: l.x, y: l.y, h: .5, kind: 'lava'});
    return L;
  }
  function newBug(kind, pal, x, y, h, src) {
    const a = {kind, pal, x, y, h, vx: 0, vy: 0, vh: 0, ax: x, ay: y, src, st: 'flit', at: rr(.2, .6), ph: R() * TAU, fx: 1, fy: 0, rest: null,
      a: R() * TAU, r: rr(.25, .55), w: rr(3, 5.5) * (R() < .5 ? -1 : 1), hh: rr(-.25, .3), ox: 0, oy: 0, flap: 0};
    bugs.push(a); return a;
  }
  function stepBug(a, dt) {
    const w = windAt(a.x, a.y);
    if (a.kind === 'moth') {
      a.a += a.w * dt * (1 + Math.sin(T * 3.1 + a.ph) * .5); a.r = clamp(a.r + Math.sin(T * 2.3 + a.ph * 3) * dt * .4, .15, .75);
      if (R() < dt * .4) a.w = -a.w;
      a.ox = (a.ox + w.x * dt * .6) * Math.exp(-dt * 1.4); a.oy = (a.oy + w.y * dt * .6) * Math.exp(-dt * 1.4);
      a.x = a.src.x + Math.cos(a.a) * a.r + a.ox; a.y = a.src.y + Math.sin(a.a) * a.r * .7 + a.oy;
      a.hc = a.src.h + (a.src.kind === 'lava' ? .4 : 0);
      a.h = a.hc + a.hh + Math.sin(T * 4 + a.ph) * .12;
      faceV(a, -Math.sin(a.a) * a.w, Math.cos(a.a) * .7 * a.w); a.flap += dt * 14; return;
    }
    if (a.rest) {
      a.flap += dt * 1.2; a.at -= dt;
      if (spotPos(a.rest)) { a.x = a.rest.x; a.y = a.rest.y; a.h = a.rest.h - .02; }   // a bush card's top follows the camera
      const th = P && Math.hypot(a.x - P.x, a.y - P.y) < 1.4 && PN.moving;
      if (a.at <= 0 || th) { a.rest = null; a.st = 'flit'; a.vh = 1; a.at = .3; }
      return;
    }
    a.flap += dt * (9 + Math.sin(T * 5 + a.ph) * 3);
    if ((a.at -= dt) <= 0) {
      a.at = rr(.18, .55);
      let ang = R() * TAU; const d = Math.hypot(a.ax - a.x, a.ay - a.y);
      if (d > 2.2) ang = Math.atan2(a.ay - a.y, a.ax - a.x) + rr(-.8, .8);
      if (P && Math.hypot(a.x - P.x, a.y - P.y) < 1.1) ang = Math.atan2(a.y - P.y, a.x - P.x) + rr(-.5, .5);
      const s = rr(.5, 1.2); a.vx = Math.cos(ang) * s; a.vy = Math.sin(ang) * s * .8; a.vh = rr(-.5, .6);
      if (R() < .06) {
        let bb = null, bd = 3; for (const s2 of spots) if (s2.kind === 'bush' && !s2.occ) { spotXY(s2); const dd = Math.hypot(s2.x - a.x, s2.y - a.y); if (dd < bd && spotPos(s2)) { bd = dd; bb = s2; } }
        if (bb) { a.rest = bb; a.x = bb.x; a.y = bb.y; a.h = bb.h - .02; a.at = rr(3, 8); return; }
      }
    }
    a.x += (a.vx + w.x * .5 + Math.sin(T * 7 + a.ph) * .25) * dt; a.y += (a.vy + w.y * .5) * dt;
    const gz = elev(a.x, a.y); a.h = clamp(a.h + a.vh * dt + Math.sin(T * 6 + a.ph) * dt * .4, gz + .25, gz + 1.8);
    if (Math.hypot(a.vx, a.vy) > .15) faceV(a, a.vx, a.vy);
  }

  // =================================================================== VULTURES (ember): shadow + rare silhouette
  const vShadow = {};
  function vultureShadow(ai) {   // a soaring bird's shadow for heading index ai (16, in the VIEW frame): wings, fingered tips, body, tail
    const key = biome + ai; if (vShadow[key]) return vShadow[key];
    const a = ai / 16 * TAU, ca = Math.cos(a), sa = Math.sin(a), span = .62, Wd = 44, H = 34, c = mkCanvas(Wd, H), q = c.getContext('2d');
    q.fillStyle = SHC[0];
    for (let py = 0; py < H; py++) for (let px = 0; px < Wd; px++) {
      const u = (px + .5 - Wd / 2) / ctx.PPM, v = (py + .5 - H / 2) / ctx.PPMY;
      const al = u * ca + v * sa, si = -u * sa + v * ca, as = Math.abs(si);
      let on = false;
      if (as < span) {
        const mid = -.04 - as * .08, ch = .09 * (1 - (as / span) ** 2 * .45);
        if (as < span - .12) on = Math.abs(al - mid) < ch;
        else { const f = (as - (span - .12)) / .12, fi = Math.floor((al - mid + .09) / .06); on = Math.abs(al - mid) < .09 && fi >= 0 && fi < 3 && ((al - mid + .09) % .06) < .04 && f < 1 - fi * .18; }
      }
      if (!on && as < .06 && al > -.32 && al < .2) on = true;
      if (!on && al <= -.28 && al > -.42 && as < .05 + (-.28 - al) * .5) on = true;
      if (on) q.fillRect(px, py, 1, 1);
    }
    return (vShadow[key] = {c, W: Wd, H});
  }
  function newVulture(cx, cy) {
    const v = {cx, cy, hx: cx, hy: cy, R: rr(5, 8), a: R() * TAU, w: rr(.16, .24) * (R() < .5 ? -1 : 1), h: rr(8.5, 10), x: 0, y: 0, beat: 0, wt: rr(4, 9), fx: 1, fy: 0};
    vultures.push(v); return v;
  }
  function stepVulture(v, dt) {
    v.a += v.w * dt;
    v.cx += (v.hx - v.cx) * dt * .05 + Math.sin(T * .05 + v.R) * dt * .25; v.cy += (v.hy - v.cy) * dt * .05 + Math.cos(T * .04 + v.R) * dt * .2;
    v.x = v.cx + Math.cos(v.a) * v.R; v.y = v.cy + Math.sin(v.a) * v.R * .8;
    if ((v.wt -= dt) <= 0) { v.beat = .9; v.wt = rr(6, 14); } v.beat = Math.max(0, v.beat - dt);
    faceV(v, -Math.sin(v.a) * Math.sign(v.w), Math.cos(v.a) * .8 * Math.sign(v.w));
  }
  const vHeading = v => { const vx = v.fx * RX + v.fy * RY, vy = v.fx * FX + v.fy * FY; return (((Math.round(Math.atan2(vy, vx) / TAU * 16) % 16) + 16) % 16); };

  // =================================================================== RIFT: jellies, eyes, motes
  function newJelly(x, y) {
    const j = {x, y, h: rr(1.6, 2.8), base: rr(1.6, 2.8), hx: x, hy: y, vx: 0, vy: 0, head: R() * TAU, ph: R() * TAU, pulse: R(), rate: rr(.55, .8), flinch: 0,
      tn: [rr(3, 6) | 0, rr(5, 8) | 0, rr(4, 7) | 0, rr(3, 6) | 0]};
    jellies.push(j); return j;
  }
  function stepJelly(j, dt) {
    j.head += Math.sin(T * .3 + j.ph) * dt * .6;
    let tx = Math.cos(j.head) * .22, ty = Math.sin(j.head) * .18;
    const dh = Math.hypot(j.hx - j.x, j.hy - j.y); if (dh > 3) { tx += (j.hx - j.x) / dh * .25; ty += (j.hy - j.y) / dh * .25; }
    if (P) { const dx = j.x - P.x, dy = j.y - P.y, d = Math.hypot(dx, dy) || 1; if (d < 2) { tx += dx / d * (2 - d) * .6; ty += dy / d * (2 - d) * .6; } }
    if (near(j.x, j.y)) { const th = threat(j.x, j.y, j.h, SPECIES.fish); if (th.t >= 1.3 && j.flinch <= 0) { j.flinch = 1.2; j.pulse = 0; const d = Math.hypot(j.x - th.x, j.y - th.y) || 1; j.vx += (j.x - th.x) / d * .6; j.vy += (j.y - th.y) / d * .6; } }
    j.flinch = Math.max(0, j.flinch - dt);
    j.vx += (tx - j.vx) * dt * .8; j.vy += (ty - j.vy) * dt * .8;
    j.x += j.vx * dt; j.y += j.vy * dt;
    j.pulse = (j.pulse + dt * j.rate * (j.flinch > 0 ? 2.6 : 1)) % 1;
    const push = j.pulse < .3 ? .35 : -.12;
    j.base = clamp(j.base + push * dt * .35, 1.5, 3); j.h = elev(j.x, j.y) + j.base + Math.sin(T * .7 + j.ph) * .12 + (j.flinch > 0 ? j.flinch * .3 : 0);
  }
  // eyes: on the south faces of the north wall, towers and pillars (found on their 3D models), the plateau cliff, the floor
  const eyeDbg = [];
  function placeEyes(n) {
    const cand = []; eyeDbg.length = 0;
    const tryProp = (p, h, ox) => {   // the socket (5 x 4 px) must fit on a flat patch of the model's south face
      const geo = geoOf(p); if (!geo) { eyeDbg.push('nogeo ' + p.kind); return; }
      const dx = 2.5 / ctx.PPM, dh = 2 / ctx.PPMH, zs = [frontOf(geo, ox, h), frontOf(geo, ox - dx, h - dh), frontOf(geo, ox + dx, h - dh), frontOf(geo, ox - dx, h + dh), frontOf(geo, ox + dx, h + dh)];
      if (zs.some(z => !(z === z)) || Math.max(...zs) - Math.min(...zs) > .06) { eyeDbg.push(p.kind + ' ' + zs.map(z => z.toFixed(2)).join(',')); return; }
      cand.push({x: p.x + ox, y: p.y + zs[0] + .025, h: (p.z || 0) + h, wall: true, p});
    };
    const walls = props.filter(p => p.kind === 'wall_n'), towers = props.filter(p => p.kind === 'tower'), pillars = props.filter(p => p.kind === 'pillar' || p.kind === 'gatepost');
    for (let i = 0; i < 6; i++) { const p = pick(walls); if (p) tryProp(p, rr(.35, .85), rr(-.3, .3)); }
    for (const p of towers) tryProp(p, rr(.9, 1.6), rr(-.4, .4));
    for (let i = 0; i < 3; i++) { const p = pick(pillars); if (p) tryProp(p, rr(.9, 1.7), 0); }
    const pl = (host.layout.plateaus || [])[0];
    if (pl) for (let i = 0; i < 3; i++) cand.push({x: rr(pl.x0 + 1, pl.x1 - 1), y: pl.y1 + .03, h: rr(.6, 1.8), ground: true});
    for (let i = 0; i < 6; i++) { const q = freeNear(rr(10, 56), rr(8, 25), .1, 0, 1); if (q && !inStream(q[0], q[1]) && elev(q[0], q[1]) === 0) cand.push({x: q[0], y: q[1], h: 0, ground: true, floor: true}); }
    for (let i = cand.length - 1; i > 0; i--) { const k = R() * (i + 1) | 0; [cand[i], cand[k]] = [cand[k], cand[i]]; }
    const out = [];
    for (const c of cand) { if (out.length >= n) break; if (out.some(o => Math.hypot(o.x - c.x, o.y - c.y) < 1.6)) continue; out.push(c); }
    for (const e of out) { Object.assign(e, {open: 2, st: 'open', at: rr(2, 6), shut: 0, px: 1, py: 1}); eyes.push(e); }
  }
  function stepEye(e, dt) {
    if (!P) return;
    const d = Math.hypot(e.x - P.x, e.y - P.y), th = threat(e.x, e.y, e.h, SPECIES.fish);
    if (d < 2.2 || th.t >= 1.2) { e.shut = Math.max(e.shut, d < 2.2 ? .4 : rr(1.5, 3)); }
    if (e.shut > 0) { e.shut -= dt; e.open = 0; if (e.shut <= 0) { e.open = 1; e.at = .15; e.st = 'wake'; } return; }
    e.at -= dt;
    if (e.st === 'wake') { if (e.at <= 0) { e.open = 2; e.st = 'open'; e.at = rr(2.5, 7); } return; }
    if (e.st === 'blink') { if (e.at <= 0) { e.open = 2; e.st = 'open'; e.at = rr(2.5, 7); } return; }
    if (e.at <= 0) { e.open = 0; e.st = 'blink'; e.at = .12; }
    // the pupil follows the player ON SCREEN, snapping between 3 x 2 positions (with a little lag)
    const ox = P.x - e.x, oy = P.y - e.y, dx = ox * RX + oy * RY, dy = ox * FX + oy * FY;
    const wx = dx < -1.2 ? 0 : dx > 1.2 ? 2 : 1, wy = dy < -.6 ? 0 : 1;
    if (wx !== e.px || wy !== e.py) { e.look = (e.look || 0) + dt; if (e.look > .18) { e.px = wx; e.py = wy; e.look = 0; } } else e.look = 0;
  }
  function newSchool(n) {
    school = {x: 20, y: 15.5, h: 1.6, a: R() * TAU, tx: 20, ty: 15.5, t: 0};
    for (let i = 0; i < n; i++) motes.push({x: 20 + rr(-1, 1), y: 15.5 + rr(-1, 1), h: rr(1, 2), vx: rr(-.3, .3), vy: rr(-.3, .3), vh: 0, ph: R() * TAU});
  }
  function stepSchool(dt) {
    const sc = school; if (!sc) return;
    if ((sc.t -= dt) <= 0) {
      sc.t = rr(5, 10);
      const pts = [[20, 15.5], [13, 13], [12, 19], [26, 12], [27, 19], [20, 10], [20, 21]];
      [sc.tx, sc.ty] = pick(pts); sc.tx += rr(-1.5, 1.5); sc.ty += rr(-1, 1);
    }
    sc.x += (sc.tx - sc.x) * dt * .12; sc.y += (sc.ty - sc.y) * dt * .12;
    if (!near(sc.x, sc.y) && !motes.some(m => near(m.x, m.y))) { for (const m of motes) { m.x += (sc.x - m.x) * dt * .5; m.y += (sc.y - m.y) * dt * .5; } return; }
    let cx = 0, cy = 0, ch = 0, ax = 0, ay = 0; for (const m of motes) { cx += m.x; cy += m.y; ch += m.h; ax += m.vx; ay += m.vy; }
    const n = motes.length; cx /= n; cy /= n; ch /= n; ax /= n; ay /= n;
    for (const m of motes) {
      let fx = (cx - m.x) * .5 + (sc.x - m.x) * .35 + (ax - m.vx) * .8, fy = (cy - m.y) * .5 + (sc.y - m.y) * .35 + (ay - m.vy) * .8, fh = (ch - m.h) * .4 + (1.6 + Math.sin(T * .6 + m.ph) * .5 - m.h) * .5;
      for (const o of motes) { if (o === m) continue; const dx = m.x - o.x, dy = m.y - o.y, q = dx * dx + dy * dy; if (q < .1 && q > 1e-6) { fx += dx / q * .05; fy += dy / q * .05; } }
      const th = threat(m.x, m.y, m.h, SPECIES.fish);
      if (th.t >= 1.4) { const d = Math.hypot(m.x - th.x, m.y - th.y) || 1; fx += (m.x - th.x) / d * 9; fy += (m.y - th.y) / d * 9; fh += 2; }
      m.vx += fx * dt; m.vy += fy * dt; m.vh += fh * dt;
      const s = Math.hypot(m.vx, m.vy), mx = th.t >= 1.4 ? 3 : 1.1; if (s > mx) { m.vx *= mx / s; m.vy *= mx / s; }
      m.vh = clamp(m.vh, -.8, .8);
      m.x += m.vx * dt; m.y += m.vy * dt; m.h = clamp(m.h + m.vh * dt, .6, 3);
    }
  }

  // =================================================================== the atlas (albedo + emit, same layout), per biome
  // SPR[key][frame] = {sx, sy, w, h, ax, ay}. Emissive variants: salamander a0/a1/b0/b1 (glow k), moth <frame>_g0..2
  // (lit by the flame, by distance), eye e0 / e1_<px> / e2_<px><py>, mote m0..2 / mb. Jellies: a small dynamic atlas.
  let ATL = null, ATE = null;
  function buildArt() {
    SPR = {};
    const PB = PAL[biome] || {}, defs = [];   // [key, frame, w, h, ax, ay, paint(q, eq, x, y)]
    const pix = (rows, pal) => (q, x0, y0) => {
      for (let y = 0; y < rows.length; y++) for (let x = 0; x < rows[y].length; x++) {
        const ch = rows[y][x]; if (ch === '.' || ch === ' ') continue;
        const col = ch >= '0' && ch <= '3' ? pal.r[+ch] : pal[ch]; if (!col) continue;
        q.fillStyle = col; q.fillRect(x0 + x, y0 + y, 1, 1);
      }
    };
    const dims = rows => [Math.max(...rows.map(r => r.length)), rows.length];
    for (const k in PB) {
      const Ad = ART[ARTOF[k] || k]; if (!Ad) continue;
      for (const f in Ad) {
        const d = Ad[f], [w, h] = dims(d.r), body = pix(d.r, PB[k]);
        if (k === 'salamander') {
          for (const g of [0, 1]) defs.push([k, f + g, w, h, d.x, d.y, (q, eq, x, y) => { body(q, x, y); eq.fillStyle = SALA_GLOW[g]; eq.fillRect(x + d.x - 1, y + d.y, 1, 1); eq.fillStyle = SALA_GLOW[1 - g]; eq.fillRect(x + d.x + 1, y + d.y, 1, 1); }]);
        } else defs.push([k, f, w, h, d.x, d.y, (q, eq, x, y) => body(q, x, y)]);
        if (k === 'moth' || k === 'ashmoth') {
          const MG = biome === 'ember' ? MOTH_GLOW.ember : MOTH_GLOW.other;
          for (let g = 0; g < 3; g++) defs.push([k, f + '_g' + g, w, h, d.x, d.y, (q, eq, x, y) => {
            body(q, x, y); eq.fillStyle = MG[g];
            if (f === 'open') { eq.fillRect(x + d.x - 1, y + d.y - 1, 1, 1); eq.fillRect(x + d.x + 1, y + d.y - 1, 1, 1); } else eq.fillRect(x + d.x, y + d.y - 1, 1, 1);
          }]);
        }
      }
    }
    if (biome === 'rift') {
      // eyes: a 3 x 2 eyeball in a dark socket (5 x 4), anchor = the eyeball's middle-bottom pixel (the arena's eyeXY + 1)
      const sock = (q, x, y) => { q.fillStyle = EYE.lid; q.fillRect(x + 1, y, 3, 1); q.fillRect(x + 1, y + 3, 3, 1); q.fillRect(x, y + 1, 1, 2); q.fillRect(x + 4, y + 1, 1, 2); };
      defs.push(['eye', 'e0', 5, 4, 2, 2, (q, eq, x, y) => { sock(q, x, y); q.fillStyle = EYE.lidHi; q.fillRect(x + 1, y + 1, 3, 1); q.fillStyle = EYE.lash; q.fillRect(x + 1, y + 2, 3, 1); }]);
      for (let px = 0; px < 3; px++) defs.push(['eye', 'e1_' + px, 5, 4, 2, 2, (q, eq, x, y) => { sock(q, x, y); q.fillStyle = EYE.lidHi; q.fillRect(x + 1, y + 1, 3, 1); q.fillStyle = EYE.sclera; q.fillRect(x + 1, y + 2, 3, 1); q.fillStyle = EYE.pupil; q.fillRect(x + 1 + px, y + 2, 1, 1); }]);
      for (let px = 0; px < 3; px++) for (let py = 0; py < 2; py++) defs.push(['eye', 'e2_' + px + py, 5, 4, 2, 2, (q, eq, x, y) => {
        sock(q, x, y); q.fillStyle = EYE.sclera; q.fillRect(x + 1, y + 1, 3, 2); q.fillStyle = EYE.pupil; q.fillRect(x + 1 + px, y + 1 + py, 1, 1);
        eq.fillStyle = EYE.glow; for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) if (i !== px || k !== py) eq.fillRect(x + 1 + i, y + 1 + k, 1, 1);
        eq.fillStyle = EYE.glint; eq.fillRect(x + 1 + (px === 0 ? 2 : 0), y + 1, 1, 1);
      }]);
      for (let g = 0; g < 3; g++) defs.push(['mote', 'm' + g, 3, 1, 1, 0, (q, eq, x, y) => { q.fillStyle = MOTE.base; q.fillRect(x + 1, y, 1, 1); eq.fillStyle = MOTE.glow[g]; eq.fillRect(x + 1, y, 1, 1); }]);
      defs.push(['mote', 'mb', 3, 1, 1, 0, (q, eq, x, y) => { q.fillStyle = MOTE.base; q.fillRect(x + 1, y, 1, 1); eq.fillStyle = MOTE.glow[2]; eq.fillRect(x, y, 3, 1); eq.fillStyle = MOTE.glow[0]; eq.fillRect(x + 1, y, 1, 1); }]);
    }
    let x = 1, y = 1, rowH = 0; const Wd = 256;
    for (const d of defs) { if (x + d[2] + 1 > Wd) { x = 1; y += rowH + 1; rowH = 0; } d.sx = x; d.sy = y; x += d[2] + 1; rowH = Math.max(rowH, d[3]); }
    ATL = mkCanvas(Wd, y + rowH + 1); ATE = mkCanvas(Wd, y + rowH + 1);
    const q = ATL.getContext('2d'), eq = ATE.getContext('2d');
    for (const d of defs) { d[6](q, eq, d.sx, d.sy); (SPR[d[0]] ||= {})[d[1]] = {sx: d.sx, sy: d.sy, w: d[2], h: d[3], ax: d[4], ay: d[5]}; }
    // jellies (rift): one 17 x 16 slot each in a small dynamic atlas, redrawn every frame (the tendrils sway)
    JA = JE = null;
    if (biome === 'rift') { JA = mkCanvas(17 * 4, 16); JE = mkCanvas(17 * 4, 16); JA.getContext('2d').imageSmoothingEnabled = false; }
    // the ground layer's shadow tints: multiply by M ~ mix toward a dark colour with alpha a, solved on the average ground
    SHC = (SHADE[biome] || SHADE.ruins).map(h => {
      const M = hex(h).map(v => v / 255), a = 1 - Math.min(...M) + .02, c = GA.map((g, i) => clamp(g * (M[i] - 1 + a) / a, 0, 1) * 255 | 0);
      return `rgba(${c[0]},${c[1]},${c[2]},${a.toFixed(3)})`;
    });
  }
  let JA = null, JE = null, SHC = ['rgba(0,0,0,.36)', 'rgba(0,0,0,.27)', 'rgba(0,0,0,.2)'], GA = [.5, .5, .5];
  function groundAverage() {   // the biome ground's mean colour (the shadow tints are solved against it)
    const gc = host.world?.groundCanvas; if (!gc) return;
    const c = mkCanvas(64, 32), q = c.getContext('2d', {willReadFrequently: true}); q.imageSmoothingEnabled = true;
    q.drawImage(gc, 0, 0, 64, 32); const d = q.getImageData(0, 0, 64, 32).data; let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (n) GA = [r / n / 255, g / n / 255, b / n / 255];
  }

  // =================================================================== populate / time
  function clearAll() {
    flocks = []; birds = []; hoppers = []; lizards = []; frogs = []; fish = []; bugs = []; vultures = []; jellies = []; eyes = []; motes = []; school = null;
  }
  // the season's say on who is out (ruins only: env.tinted), and rain's: butterflies like spring / summer and hide from rain,
  // moths are gone in winter, frogs sleep through it
  const SEASON_LIFE = {butterflies: {spring: 1.2, summer: 1, autumn: .35, winter: 0}, moths: {spring: .7, summer: 1, autumn: .6, winter: 0},
    frogs: {spring: 1, summer: 1, autumn: .7, winter: 0}};
  const lifeK = k => { const E = host.env; return E?.tinted ? SEASON_LIFE[k]?.[E.season] ?? 1 : 1; };
  function populate() {
    need = false; clearAll();
    biome = host.biome.id; props = host.props;
    solids = props.filter(p => p.rect || p.r > .05 || ['crate', 'barrel', 'barrel_x', 'pot', 'chest'].includes(p.kind));
    seed = {ruins: 101, ember: 211, frost: 307, rift: 401}[biome] || 1;
    groundAverage(); buildArt(); buildSpots(); prewarm();
    const C = CAST[biome] || {};
    for (const F of C.flocks || []) { const f = newFlock(F.sp, F.n, F.homes); placeFeeding(f, F.homes[0]); f.t = rr(15, 40); }
    if (C.solos) for (let i = 0; i < C.solos.n; i++) {
      const f = newFlock(C.solos.sp, 1, []), b = f.birds[0];
      b.x = rr(10, 30); b.y = rr(8, 22);
      if (!placePerched(f)) { const q = freeNear(20, 12, 6, 0, 30) || [20, 12]; f.homes = [q]; placeFeeding(f, q); }
      f.home = {x: b.x, y: b.y + 2, z: 0, r: 1.5}; f.homes = [[b.x, b.y + 2]];
    }
    const bushes = props.filter(p => p.kind === 'bush' && !p.outside);
    if (C.rabbits) { const bs = [...bushes].sort(() => R() - .5); for (let i = 0; i < C.rabbits && i < bs.length; i++) { const b = bs[i]; newHopper('rabbit', b.x + rr(-.8, .8), b.y + rr(.5, 1.2), b); } }
    if (C.hares) for (const [x, y] of [[11.5, 10], [49.5, 13.8], [27.5, 21.5]].slice(0, C.hares)) newHopper('hare', x, y, null);
    if (C.fish) for (let i = 0; i < C.fish; i++) newFish(rr(3, 28));
    const nFrogs = Math.round((C.frogs || 0) * lifeK('frogs'));
    if (nFrogs) for (const y of [16.8, 20.5, 26.2].slice(0, nFrogs)) newFrog(y + rr(-.4, .4), R() < .5 ? -1 : 1);
    if (C.salamanders) for (const [x, y] of [[37, 13.5], [42.5, 19], [17, 12.5], [24, 19.5], [37.5, 22]].slice(0, C.salamanders)) newLizard(x, y);
    if (C.vultures) for (let i = 0; i < C.vultures; i++) newVulture(rr(16, 44), rr(11, 20));
    if (C.jellies) for (const [x, y] of [[14, 12], [26, 18.5], [38, 14], [50, 20.5]].slice(0, C.jellies)) newJelly(x, y);
    if (C.eyes) placeEyes(C.eyes);
    if (C.motes) newSchool(C.motes);
    needTime = true;
  }
  function applyTime() {
    needTime = false;
    const C = CAST[biome] || {};
    bugs = [];
    if (biome === 'ruins' && time !== 'night') {
      const bushes = props.filter(p => p.kind === 'bush' && !p.outside), lg = host.layout.lightGarden;
      const anchors = bushes.map(b => [b.x, b.y]).concat(lg ? [[lg.x, lg.y], [lg.x - 1, lg.y + 1]] : []);
      const n = Math.round((time === 'day' ? C.butterflies || 0 : 2) * lifeK('butterflies') * (raining ? 0 : 1));
      for (let i = 0; i < n; i++) { const [x, y] = pick(anchors); newBug('butterfly', 'bfly' + (i % 3), x + rr(-1, 1), y + rr(-.5, .5), rr(.5, 1.3)); }
    }
    const nm = C.moths ? Math.round((time === 'night' ? C.moths : time === 'dusk' ? Math.max(1, C.moths - 1) : biome === 'ember' ? 1 : 0) * lifeK('moths')) : 0;
    if (nm) for (const L of lightSources()) for (let i = 0; i < (L.kind === 'lava' ? Math.max(1, nm - 1) : nm); i++)
      newBug('moth', biome === 'ember' ? 'ashmoth' : 'moth', L.x, L.y, L.h, L);
    vultures.forEach(v => v.off = time === 'night');
    for (const f of flocks) {
      if ((time === 'night' || raining) && f.mode === 'feed') {   // night, or rain: off the ground, under cover
        const c = centroid(f);
        if (near(c.x, c.y)) takeOff(f, false, 'roost'); else if (!placePerched(f)) takeOff(f, false, 'roost');
      } else if (time !== 'night' && wasNight && f.mode === 'perch') f.t = Math.min(f.t, rr(1, 5));
    }
    wasNight = time === 'night';
  }

  // =================================================================== drawing
  const SP0 = {img: null, em: null, sx: 0, sy: 0, sw: 0, sh: 0, px: 0, py: 0, flip: false, x: 0, y: 0, h: 0};
  function put(s, x, y, h, face) {   // one atlas frame as a camera-facing sprite, mirrored when it faces screen-left
    if (!s) return;
    const fl = face < 0;
    SP0.img = ATL; SP0.em = ATE; SP0.sx = s.sx; SP0.sy = s.sy; SP0.sw = s.w; SP0.sh = s.h; SP0.px = fl ? s.w - 1 - s.ax : s.ax; SP0.py = s.ay; SP0.flip = fl;
    SP0.x = x; SP0.y = y; SP0.h = h; host.sprite(SP0);
  }
  const NEARC = .05;   // m toward the camera: a perched / resting animal stays in front of its card
  function drawSprites() {
    // birds (on the floor, perched, in flight: all depth-tested now)
    for (const b of birds) {
      if (!onScreen(b.x, b.y, b.h, .6)) continue;
      const Sp = SPR[b.sp.id]; if (!Sp) continue;
      const card = (b.st === 'perch' && b.spot?.card) || (b.st === 'fly' && b.dly > 0 && b.lift?.card);
      put(Sp[birdFrame(b)], b.x + (card ? FX * NEARC : 0), b.y + (card ? FY * NEARC : 0), b.h, sface(b));
    }
    for (const a of hoppers) {
      if (a.st === 'gone' || !onScreen(a.x, a.y, a.h, .5)) continue;
      const Sp = SPR[a.id]; if (!Sp) continue;
      const hid = a.st === 'hide' && a.cover;   // under a bush: just behind its card
      put(Sp[hopperFrame(a)], a.x - (hid ? FX * .12 : 0), a.y - (hid ? FY * .12 : 0), a.h, sface(a));
    }
    if (SPR.salamander) for (const a of lizards) {
      if (!onScreen(a.x, a.y, a.z, .4)) continue;
      const k = ((T * 1.3 + a.ph * 7) | 0) % 5 === 0 ? 1 : 0;
      put(SPR.salamander[(a.st === 'dart' && ((a.ph | 0) & 1) ? 'b' : 'a') + k], a.x, a.y, a.z, sface(a));
    }
    if (SPR.frog) for (const a of frogs) {
      if ((a.st !== 'sit' && !a.jump) || !onScreen(a.x, a.y, a.h, .4)) continue;
      const wet = a.jump && a.jump.water && a.jump.t / a.jump.d > .5;
      put(SPR.frog[a.jump ? 'jump' : a.pulse > 0 && ((a.pulse * 8) | 0) & 1 ? 'pulse' : 'sit'], a.x, a.y, a.h + (wet ? WATER * a.jump.t / a.jump.d : 0), sface(a));
    }
    if (SPR.fishj) for (const a of fish) {
      if (!a.jump || !onScreen(a.x, a.y, a.h, .4)) continue;
      const k = a.jump.t / a.jump.d; put(SPR.fishj[k < .35 ? 'up' : k < .65 ? 'level' : 'down'], a.x, a.y, WATER + a.h, sface(a));
    }
    for (const a of bugs) {
      if (!onScreen(a.x, a.y, a.h, .3)) continue;
      const Sp = SPR[a.pal]; if (!Sp) continue;
      let f;
      if (a.kind === 'moth') {
        f = ((a.flap | 0) & 1) ? 'open' : 'closed';
        const d = a.src ? Math.hypot(a.r, (a.h - (a.hc ?? a.src.h)) * 1.3) : 9;   // lit by the flame: wings glow warm, brighter the closer
        if (d <= .7) f += '_g' + (d < .3 ? 0 : d < .5 ? 1 : 2);
      } else { const i = (a.flap | 0) % 4; f = a.rest ? (i < 2 ? 'closed' : 'open') : i === 0 ? 'open' : i === 2 ? 'closed' : 'flat'; }
      put(Sp[f], a.x + (a.rest ? FX * NEARC : 0), a.y + (a.rest ? FY * NEARC : 0), a.h, sface(a));
    }
    if (SPR.vulture) for (const v of vultures) {   // the rare silhouette, when its circle brings it into the top of the view
      if (v.off || !onScreen(v.x, v.y, v.h, .6)) continue;
      put(SPR.vulture[v.beat > 0 && ((v.beat * 3) | 0) & 1 ? 'beat' : 'glide'], v.x, v.y, v.h, sface(v));
    }
    if (SPR.eye) for (const e of eyes) {
      if (!onScreen(e.x, e.y, e.h, .3)) continue;
      put(SPR.eye[e.open === 0 ? 'e0' : e.open === 1 ? 'e1_' + e.px : 'e2_' + e.px + e.py], e.x, e.y, e.h, 1);
    }
    if (SPR.mote) for (const m of motes) {
      if (!onScreen(m.x, m.y, m.h, .2)) continue;
      const b = Math.sin(T * 2.2 + m.ph * 5);
      put(SPR.mote[b > .9 ? 'mb' : 'm' + (b > .6 ? 0 : b > -.2 ? 1 : 2)], m.x, m.y, m.h, 1);
    }
    if (JA && jellies.length) drawJellies();
  }
  // jellies: the bell + tendrils that trail behind the drift (along the SCREEN's x) and sway; tips and bell glow
  const jdef = {};
  function drawJellies() {
    const q = JA.getContext('2d'), eq = JE.getContext('2d'), pal = PAL.rift.jelly;
    q.clearRect(0, 0, JA.width, JA.height); eq.clearRect(0, 0, JE.width, JE.height);
    let any = false;
    jellies.forEach((j, i) => {
      if (i >= 4 || !onScreen(j.x, j.y, j.h, .6)) return;
      const X = i * 17 + 8, Y = 5, tall = j.pulse < .3, svx = j.vx * RX + j.vy * RY;
      const at = tall ? [-2, -1, 1, 2] : [-3, -1, 1, 3];
      for (let t = 0; t < 4; t++) {
        const n = j.tn[t] + (tall ? 1 : 0);
        for (let k = 1; k <= n; k++) {
          const x = X + at[t] + Math.round(-svx * k * 1.2 + Math.sin(T * 1.8 + j.ph + t * 1.7 + k * .55) * k * .2), y = Y + k;
          if (x < i * 17 || x >= i * 17 + 17 || y >= 16) continue;
          if (k === n) { q.fillStyle = pal.r[0]; q.fillRect(x, y, 1, 1); eq.fillStyle = JELLY.tip; eq.fillRect(x, y, 1, 1); }
          else { q.fillStyle = JELLY.tend; q.fillRect(x, y, 1, 1); if (k === n - 1) { eq.fillStyle = JELLY.tip2; eq.fillRect(x, y, 1, 1); } }
        }
      }
      const d = ART.jelly[tall ? 'tall' : 'wide'];   // the bell over the tendrils
      for (let y = 0; y < d.r.length; y++) for (let x = 0; x < d.r[y].length; x++) { const ch = d.r[y][x]; if (ch === '.') continue; q.fillStyle = pal.r[+ch]; q.fillRect(X - d.x + x, Y - d.y + y, 1, 1); }
      eq.fillStyle = JELLY.bell; if (tall) eq.fillRect(X - 1, Y - 2, 3, 2); else eq.fillRect(X - 2, Y - 1, 5, 1);
      eq.fillStyle = JELLY.core; eq.fillRect(X, Y - (tall ? 2 : 1), 1, 1);
      const o = jdef; o.img = JA; o.em = JE; o.sx = i * 17; o.sy = 0; o.sw = 17; o.sh = 16; o.px = 8; o.py = 5; o.x = j.x; o.y = j.y; o.h = j.h; o.dynamic = true; o.flip = false;
      host.sprite(o); any = true;
    });
    return any;
  }
  // ---------- the ground layer: shadows (tinted), fish under the water, swimming frogs, the vulture's shadow ----------
  const bk = new Map();
  const bput = (c, x, y, w = 1, h = 1) => { let a = bk.get(c); if (!a) bk.set(c, a = []); a.push(x, y, w, h); };
  function flush(q) { for (const [c, a] of bk) { if (!a.length) continue; q.fillStyle = c; for (let i = 0; i < a.length; i += 4) q.fillRect(a[i], a[i + 1], a[i + 2], a[i + 3]); a.length = 0; } }
  const gxy = (x, y, h) => { const v = host.toView(x, y, h); v[0] = Math.round(v[0]); v[1] = Math.round(v[1]); return v; };
  const inV = (X, Y, p) => X > -p && Y > -p && X < ctx.VW + p && Y < ctx.VH + p;
  function shadowAt(x, y, hAbove) {   // a flying animal's shadow: 3 -> 1 px, lighter with height (sprite px x zoom)
    if (hAbove > 7) return;
    const [X, Y] = gxy(x, y, gH(x, y)), z = ZM; if (!inV(X, Y, 4)) return;
    if (hAbove < 1.2) bput(SHC[0], X - z, Y, 3 * z, z);
    else if (hAbove < 3) bput(SHC[0], X, Y, 2 * z, z);
    else if (hAbove < 5) bput(SHC[1], X, Y, 2 * z, z);
    else bput(SHC[2], X, Y, z, z);
  }
  function drawGround(g) {
    const z = ZM, U = UNDER[biome];
    if (U && fish.length) {   // fish under the water: a 2 x 5 px silhouette along its swim (world y), clipped to the channel
      const sxx = RX * z, syx = FX * ctx.PPMY / ctx.PPM * z, sxy = RY * ctx.PPM / ctx.PPMY * z, syy = FY * z;   // world (1/PPM, 0) / (0, 1/PPMY) -> view px
      for (const a of fish) {
        if (a.jump || !onScreen(a.x, a.y, WATER, .3)) continue;
        const [X, Y] = gxy(a.x, a.y, WATER), dir = a.v > 0 ? 1 : -1, wig = ((T * (a.dart > 0 ? 9 : 4) + a.ph) | 0) & 1;
        const px = (ox, oy, col) => { if (inStream(a.x + ox / ctx.PPM, a.y + oy / ctx.PPMY)) bput(col, X + Math.round(ox * sxx + oy * sxy), Y + Math.round(ox * syx + oy * syy), z, z); };
        px(0, 2 * dir, U[0]); px(1, 2 * dir, U[0]); px(0, dir, U[1]); px(1, dir, U[0]); px(0, 0, U[1]); px(1, 0, U[1]);
        px(wig, -dir, U[1]); px(1 - wig, -2 * dir, U[1]);
      }
      for (const a of frogs) if (a.st === 'swim') { const [X, Y] = gxy(a.x, a.y, WATER); if (inV(X, Y, 4)) bput(U[1], X, Y, 2 * z, z); }
      flush(g);
    }
    for (const b of birds) {
      if (b.st === 'fly' && b.dly <= 0) shadowAt(b.x, b.y, b.h - elev(b.x, b.y));
      else if (b.st === 'ground') { const [X, Y] = gxy(b.x, b.y, b.z); if (inV(X, Y, 4)) bput(SHC[1], X - z, Y + z, (b.sp.heavy || b.sp.id === 'crow' ? 4 : 3) * z, z); }
    }
    for (const a of hoppers) if (a.st !== 'hide' && a.st !== 'gone') { const [X, Y] = gxy(a.x, a.y, a.z); if (inV(X, Y, 5)) bput(a.hop ? SHC[1] : SHC[0], X - 2 * z, Y + z, 5 * z, z); }
    for (const a of bugs) if (!a.rest && a.kind === 'butterfly') shadowAt(a.x, a.y, a.h - elev(a.x, a.y) + 1.2);
    for (const j of jellies) { const e = elev(j.x, j.y), hA = j.h - e, [X, Y] = gxy(j.x, j.y, e); if (inV(X, Y, 4)) bput(hA < 2.2 ? SHC[1] : SHC[2], X - z, Y, 3 * z, z); }
    flush(g);
    for (const v of vultures) {   // the big soaring shadow, turned with the camera
      if (v.off) continue;
      const s = vultureShadow(vHeading(v)), [X, Y] = gxy(v.x, v.y, gH(v.x, v.y)), w = s.W * z, h = s.H * z;
      if (X > -w && Y > -h && X < ctx.VW + w && Y < ctx.VH + h) g.drawImage(s.c, X - (w >> 1), Y - (h >> 1), w, h);
    }
  }

  // =================================================================== the contract
  const LI = [];
  Object.assign(WL, {
    toggle() { WL.on = !WL.on; if (!WL.on) WL.ms = 0; return WL.on; },
    biomeChanged() { need = true; },
    update(dt, evs) {
      const t0 = performance.now();
      WL.ms = WL.ms * .95 + acc * .05; acc = 0;
      if (!WL.on) { tick(t0); return; }
      dt = Math.min(.05, Math.max(0, dt || 0)); T += dt;
      const pl = host.player;
      P = pl ? {x: pl.x, y: pl.y, z: pl.z || 0, vx: pl.vx || 0, vy: pl.vy || 0, state: pl.state, gait: pl.gait} : null;
      viewSync();
      if (host.biome.id !== biome || host.props !== props) need = true;
      if (need) populate();
      if (host.time !== time) { time = host.time; needTime = true; }
      // the world clock (sim/env.js): a new season repopulates (frogs sleep through winter), rain starting / stopping
      // re-applies the time (butterflies hide, flocks take shelter)
      const E = host.env;
      if (E) {
        if (E.ver.season !== seasonVer) { seasonVer = E.ver.season; if (seasonVer > 0 && !need) need = true; }
        const wet = E.sky.rain > .35 || E.sky.storm > .3; if (wet !== raining) { raining = wet; needTime = true; }
      }
      if (needTime) applyTime();
      for (const k in CD) if (CD[k] > 0) CD[k] -= dt;
      gatherNoise(evs);
      for (const f of flocks) stepFlock(f, dt);
      for (const b of birds) stepBird(b, dt);
      for (const a of hoppers) stepHopper(a, dt);
      for (const a of lizards) stepLizard(a, dt);
      const s = S();
      // is the stream in the detail region? (sample its course: it runs north - south whatever the camera does)
      let sv = false; for (let y = 1; y < 30 && !sv; y += 1.5) sv = near(s.cx(y), y);
      if (sv || fish.some(a => a.jump) || frogs.some(a => a.jump || a.st !== 'sit')) {
        for (const a of frogs) stepFrog(a, dt);
        for (const a of fish) stepFish(a, dt);
        if (fish.length && (fishT -= dt) <= 0) fishT = fishJump() ? (biome === 'frost' ? rr(12, 22) : rr(3, 8)) : 1;
      }
      for (const a of bugs) if (near(a.src ? a.src.x : a.x, a.src ? a.src.y : a.y) || a.rest) stepBug(a, dt);
      for (const v of vultures) stepVulture(v, dt);
      for (const j of jellies) stepJelly(j, dt);
      for (const e of eyes) if (near(e.x, e.y)) stepEye(e, dt);
      stepSchool(dt);
      WL.count = birds.length + hoppers.length + lizards.length + frogs.length + fish.length + bugs.length + vultures.length + jellies.length + eyes.length + motes.length;
      tick(t0);
    },
    frame() {
      if (!WL.on || need || !ATL) return;
      const t0 = performance.now();
      viewSync();
      drawGround(host.layer('ground'));
      drawSprites();
      tick(t0);
    },
    lights() {
      LI.length = 0;
      if (!WL.on || need) return LI;
      jellies.forEach((j, i) => { if (near(j.x, j.y)) LI.push({x: j.x, y: j.y, h: j.h, color: JELLY.light, radius: 1.5, intensity: .3 + (j.pulse < .3 ? .1 : 0), flicker: .08, id: 7700 + 40 + i}); });
      return LI;
    },
    dbg() {
      const st = {}; for (const b of birds) { const k = b.sp.id + ':' + b.st; st[k] = (st[k] || 0) + 1; }
      return {biome, time, count: WL.count, ms: +WL.ms.toFixed(3), flocks: flocks.map(f => `${f.sp.id} ${f.mode} t${f.t.toFixed(1)} ${f.intent}`), birds: st,
        hoppers: hoppers.map(a => a.id + ':' + a.st), lizards: lizards.map(a => a.st), frogs: frogs.map(a => a.st), fish: fish.length, bugs: bugs.length,
        vultures: vultures.length, jellies: jellies.length, eyes: eyes.map(e => e.open), motes: motes.length, spots: spots.length, perchOk: spots.filter(s => s.ok).length};
    },
    sheet(z = 6) {   // the atlas (albedo over emit), zoomed, for review
      if (!ATL) return null;
      const c = mkCanvas(ATL.width * z, ATL.height * z * 2 + z), q = c.getContext('2d'); q.imageSmoothingEnabled = false;
      q.fillStyle = '#6a6d62'; q.fillRect(0, 0, c.width, c.height);
      q.drawImage(ATL, 0, 0, ATL.width * z, ATL.height * z); q.drawImage(ATE, 0, ATL.height * z + z, ATE.width * z, ATE.height * z);
      return c;
    },
  });
  Object.defineProperty(WL, '_', {get: () => ({flocks, birds, hoppers, lizards, frogs, fish, bugs, vultures, jellies, eyes, motes, spots, school, noise, fishJump, spotPos, takeOff, VB, SPR, eyeDbg})});
  return WL;
}
