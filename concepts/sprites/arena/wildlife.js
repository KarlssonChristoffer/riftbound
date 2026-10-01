// WILDLIFE: animals that live in the proving grounds and react to you. OWNER: ambience session ("Game demo
// improvements brainstorm"), wildlife agent. SHOW ONLY: animals never block, hurt or get hit (arrows pass through;
// they just flee), and nothing here changes how the game plays.
//
// Per biome cast (each reacts to NOISE: sprint / roll / landing steps, arrows flying past, hits, breaks, explosions):
//   ruins  pigeons / sparrows pecking in small flocks: burst up when startled, circle with ground shadows, land again
//          on walls, pillar tops, tower tops or back on the floor; crows on the towers; rabbits bolting between bushes;
//          butterflies by day, moths around the braziers at dusk / night; fish jumping in the stream, frogs on the banks
//          that plop in
//   frost  ravens (a few, heavy flaps), snow buntings flocking, snow hares; the odd fish under the floes
//   ember  ash moths spiralling round braziers and lava glow, salamanders that dart and freeze, vulture SHADOWS
//          circling high overhead (only the shadow on the ground + the occasional silhouette)
//   rift   drifting void jellies (bobbing, glowing tips), eyes on walls / floor that open, track the player, blink
//          shut when you come close; motes that school like boids
//
// CONTRACT (the host, arena.html, calls exactly these):
//   export function createWildlife(ctx, host) -> WL
//   WL.on / WL.toggle()          key 6; ?wildlife=0 starts off
//   WL.ms                        rolling average cost per frame (ms)
//   WL.setBiome(id), WL.setTime(name)
//   WL.update(dt, evs)           every simulation step. evs = this frame's gameplay events (step / land / jump / splash /
//                                roll... from player.js, hit / break / explode / loot / open from combat). Push AUDIBLE
//                                animal moments into host.events for audio.js (next frame):
//                                  {type: 'birds_scatter', x, y, n}  {type: 'wings', x, y}  {type: 'caw', x, y}
//                                  {type: 'fish_jump', x, y}  {type: 'frog_jump', x, y}  {type: 'critter_dash', x, y}
//   WL.drawGround(g, cam)        after the ground (before prop / player sprites): flying animals' shadows, fish under the
//                                water, ripples
//   WL.sortables(cam) -> [{y, draw(g)}]   ground animals and perched birds, depth-sorted with props and the player
//   WL.drawAir(g, cam)           after all sprites, BEFORE lighting: animals in flight (they get lit like the world)
//   WL.emitters(cam) -> [{img, x, y}]     glowing bits after lighting (jelly tips, eye glints, moths near a flame)
//   WL.lights() -> [...]         optional small lights (a jelly), same format as the host's lights
//
// host: see the AMBIENCE HOST block in arena.html. host.wind.at(x, y) gives the wind (birds drift, moths get blown).
// ctx = {PPM, PPMY, PPMH, toS(x, y, h), WM, HM, WPX, HPX, VW, VH, PLAY, layout}; view px = toS(...) - [cam.x, cam.y]
// Perches come from host.props (wall_n / wall_e / wall_w tops, tower, gatepost, pillar, pillar_broken, tree, rock_big,
// dummy heads) at their sprite's top row: spriteOf(p).img / pivot tell you the height in px.
//
// ART RULES (same as biomes.js / atmos.js): 1 texel = 1 screen px, no AA / dither / gradients / alpha on the pixel
// canvas; small animals are 2-6 px with 2-3 frame animation (wings up / mid / down), outlined in their own darkest tone;
// palettes harmonise with the biome (see biomes.js STYLES). Glow only through emitters(). Motion reads at 1x.
//
// HOW IT WORKS
//   Noise      every step the player (by gait: sprint / drive / roll loud, run medium, walk quiet, still silent), every
//              flying arrow (a moving source) and the frame's events (hit, break, explode = very loud, splash, loot /
//              open, big landings, a flock bursting up nearby) are noise sources {x, y, h, r}. An animal's threat = the
//              strongest r * sens / distance (height counts 0.6x), plus a presence radius `shy` around the player (smaller
//              while he stands still). threat >= NERVOUS: it edges away / sits up; >= 1: it flees. Animals calm down
//              after a while and come back (birds circle and land on a perch or the floor, critters leave their cover).
//   Birds      3D points (x, y, h) with steering (circle / arrive), flock separation, wind drift; flap cycle up / mid /
//              down / mid with glides. Flocks: feed on the floor -> startled: burst up + 'birds_scatter' -> circle ->
//              land on perches away from the noise (or another feeding spot) -> after a calm spell fly home. Perch
//              heights are measured from the prop sprite's topmost opaque column pixel (scanned once per image).
//              Night: every flock roosts. Perched birds sort just in front of their perch (y = p.y + 0.001).
//   Shadows    multiply-composited solid colours (hard pixels, 3 steps lighter with height), never alpha.
//   Glow       one view-sized emitter layer (lighting adds it directly: faint by day, full at night, the same for every
//              animal); glows behind the player are painted first and his silhouette (host.player()) is cut out of them.
//   Culling    detail (threats, boids, insects, eyes) only near the view; drawing only on screen.
// DEBUG: WL.dbg() counts / states, WL.sheet(zoom) a canvas with every sprite frame, WL.T tunables, WL._ internals.

import {BIOMES} from './biomes.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const sgn = v => v < 0 ? -1 : 1;
const CALM = {x: 0, y: 0, g: 0};

// ---------------------------------------------------------------- tunables (WL.T)
const TUNE = {
  // noise radii (m): at this distance an animal of sens 1 flees
  noise: {walk: 1.3, run: 3.2, sprint: 5.5, roll: 5, leap: 3.5, climb: 1.4, knock: 4, release: 1, arrow: 2.6, hit: 6, hitMe: 5,
    break: 8, explode: 6 /* x blast r */, splash: 5, splashSmall: 2, loot: 3, open: 3, land: 4.5, landBig: 8, jump: 2.5, scatter: 3.2,
    impact: 6, scrape: 2.5, propLand: 4.5, propSplash: 4,   // props3d events (prop: true)
    splashAnimal: 1.1},   // a fish / frog plop (only its closest neighbours flinch)
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
// perch spots per prop kind: px offsets from the sprite pivot column, sink = px below the top row the feet go
// (jx: x jitter px, deep: extra random sink px = how far onto a top face the bird may stand)
const PERCH = {
  tower: {dx: [-14, -5, 5, 14], sink: 0, jx: 1}, gatepost: {dx: [-3, 3], sink: 0, jx: 1}, pillar: {dx: [-6, 0, 6], sink: 0, jx: 1},
  pillar_broken: {dx: [-2, 18], sink: 0, jx: 1}, wall_n: {dx: [-9, 0, 9], sink: 1, deep: 6}, wall_s: {dx: [-9, 0, 9], sink: 1, deep: 3},
  wall_w: {dx: [0], sink: 2, jx: 1, deep: 3}, wall_e: {dx: [0], sink: 2, jx: 1, deep: 3}, tree: {dx: [-14, 0, 14], sink: 2, deep: 3},
  rock_big: {dx: [-6, 6], sink: 1, deep: 1}, rock: {dx: [0], sink: 1, jx: 1}, bush: {dx: [-3, 4], sink: 2, jx: 1, deep: 2}, dummy: {dx: [0], sink: 0, jx: 0},
};
// per biome populations
const CAST = {
  ruins: {flocks: [{sp: 'pigeon', n: 8, homes: [[15.5, 11.5], [25.5, 11], [14.5, 19.8], [25, 20.5]]},
    {sp: 'sparrow', n: 7, homes: [[36, 18.2], [36.5, 11.5], [45, 18.6], [43.6, 25.5], [51.5, 7.6]]}],
    solos: {sp: 'crow', n: 2}, rabbits: 3, butterflies: 5, fish: 5, frogs: 3, moths: 3},
  frost: {flocks: [{sp: 'bunting', n: 9, homes: [[16, 12], [24.5, 19.8], [36.5, 17.8], [45, 18.6], [51.5, 7.6]]}],
    solos: {sp: 'raven', n: 4}, hares: 2, fish: 2, moths: 0},
  ember: {salamanders: 4, moths: 2, vultures: 2},
  rift: {jellies: 4, eyes: 10, motes: 12},
};

// ---------------------------------------------------------------- art
// Tone maps: '0'-'3' = the species ramp [hi, base, shade, outline] (light from the top-left, the darkest tone outlines
// the bottom / back), letters = accents from the palette, '.' = empty. x, y = the anchor pixel (ground frames: the
// feet; flight frames: the body). Every sprite faces RIGHT; left is mirrored.
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
  fishj: {   // a jumping fish, side view: rising / level / falling
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
  jelly: {   // the bell open (drifting down) / contracted (a pulse that lifts it)
    wide: A(['..000..', '.00112.', '0011122', '3.3.3.3'], 3, 3),
    tall: A(['.000.', '00112', '01122', '.112.', '.3.3.'], 2, 4),
  },
  vulture: {   // high overhead: a dark silhouette only
    glide: A(['33.........33', '.333.....333.', '...3333333...', '.....333.....'], 6, 2),
    beat: A(['.............', '333.......333', '..333333333..', '.....333.....'], 6, 2),
  },
};
const ARTOF = {bfly0: 'butterfly', bfly1: 'butterfly', bfly2: 'butterfly', ashmoth: 'moth'};
// palettes per biome, harmonised with biomes.js STYLES (r = [hi, base, shade, outline])
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
const UNDER = {ruins: ['#3c6676', '#284858'], frost: ['#5a7a9a', '#425e7c']};   // fish under the water (below the water's own shade tones)
const EYE = {sclera: '#cbbbe6', pupil: '#120a1c', lid: '#161022', lidHi: '#443a68', lash: '#0e0a16', glow: '#7a64a8', glint: '#f4e8ff'};
const MOTE = {base: '#5a3a9a', glow: ['#e4c8ff', '#ac80f2', '#7448c4']};
const JELLY = {tend: '#6c46b4', tip: '#dcb8ff', tip2: '#6a44a8', bell: '#7c52c0', core: '#c89cff', light: '#b47cff'};
const SALA_GLOW = ['#ffb050', '#e0641e'];

const mkCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h); return c; };
function mkSprite(def, pal) {
  const rows = def.r, h = rows.length, w = Math.max(...rows.map(r => r.length));
  const c = mkCanvas(w, h), m = mkCanvas(w, h), q = c.getContext('2d'), qm = m.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < rows[y].length; x++) {
    const ch = rows[y][x]; if (ch === '.' || ch === ' ') continue;
    const col = ch >= '0' && ch <= '3' ? pal.r[+ch] : pal[ch]; if (!col) continue;
    q.fillStyle = col; q.fillRect(x, y, 1, 1); qm.fillStyle = col; qm.fillRect(w - 1 - x, y, 1, 1);
  }
  return {c, m, w, h, ax: def.x, ay: def.y};
}
const blit = (g, s, X, Y, face) => { if (s) face < 0 ? g.drawImage(s.m, X - (s.w - 1 - s.ax), Y - s.ay) : g.drawImage(s.c, X - s.ax, Y - s.ay); };

// ---------------------------------------------------------------- the module
export function createWildlife(ctx, host) {
  const Q = new URLSearchParams(location.search);
  const WL = {on: Q.get('wildlife') !== '0', ms: 0, count: 0, T: TUNE};
  let biome = 'ruins', time = 'day', need = true, needTime = false, wasNight = false, T = 0, acc = 0, cam = {x: 0, y: 0}, P = null;
  let seed = 1;
  const R = () => { seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const rr = (a, b) => a + R() * (b - a), pick = a => a[R() * a.length | 0];
  const props = host.props, elev = host.elev, inStream = host.inStream, S = () => host.layout.stream;
  const V = {x0: 0, y0: 0, x1: 0, y1: 0};   // detail region (metres)
  const near = (x, y) => x > V.x0 && x < V.x1 && y > V.y0 && y < V.y1;
  const tick = t0 => { acc += performance.now() - t0; };
  const timed = fn => g => { const t0 = performance.now(); fn(g); acc += performance.now() - t0; };   // sortable draws run in the host's pass

  // state (per biome)
  let flocks = [], birds = [], hoppers = [], lizards = [], frogs = [], fish = [], bugs = [], vultures = [], jellies = [], eyes = [], motes = [];
  let school = null, spots = [], fishT = 4, SPR = {};
  const solids = props.filter(p => p.rect || p.r > .05 || ['crate', 'barrel', 'barrel_x', 'pot', 'chest'].includes(p.kind));   // things a critter can't walk through (read live)
  const noise = [], PN = {x: 0, y: 0, h: 0, r: 0, moving: false};
  const CD = {};
  const windAt = (x, y) => { const w = host.wind; return w && w.on !== false && w.at ? (w.at(x, y) || CALM) : CALM; };
  const emit = (type, x, y, extra) => {   // an audible animal moment for audio.js (rate-limited, only near the player)
    if (!WL.on || !host.events) return false;
    if (P && Math.hypot(x - P.x, y - P.y) > TUNE.earshot) return false;
    if ((CD[type] || 0) > 0) return false; CD[type] = TUNE.cool[type] || .3;
    host.events.push(Object.assign({type, x, y}, extra)); return true;
  };
  const splash = (x, y) => emit('splash', x, y, {small: true, wl: true});   // wl: ours (a quieter noise for the others)

  // ---------- perch heights: the topmost opaque pixel of a prop sprite's column (scanned once per image) ----------
  const alphaCache = new WeakMap();
  let scratch = null;
  function alphaOf(img) {
    let a = alphaCache.get(img); if (a) return a;
    const w = img.width, h = img.height;
    if (!scratch) scratch = mkCanvas(1, 1).getContext('2d', {willReadFrequently: true});
    const c = scratch.canvas; if (c.width < w || c.height < h) { c.width = Math.max(c.width, w); c.height = Math.max(c.height, h); }
    scratch.clearRect(0, 0, w, h); scratch.drawImage(img, 0, 0);   // a SPRITE canvas (never the screen)
    const d = scratch.getImageData(0, 0, w, h).data, al = new Uint8Array(w * h), top = new Int16Array(w).fill(-1);
    for (let i = 0; i < w * h; i++) al[i] = d[i * 4 + 3] > 127 ? 1 : 0;
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) if (al[y * w + x]) { top[x] = y; break; }
    alphaCache.set(img, a = {w, h, al, top}); return a;
  }
  const opaque = (img, x, y) => { const a = alphaOf(img); return x >= 0 && y >= 0 && x < a.w && y < a.h && a.al[y * a.w + x] === 1; };
  // at populate: every perch sprite of the biome packed into ONE scratch canvas and read back once (one GPU readback
  // instead of one per image: no stutter later when a flock picks a new perch)
  function prewarm() {
    const imgs = new Set();
    for (const s of spots) if (s.p) { const sp = host.spriteOf(s.p); if (sp && sp.img && sp.img.width && !alphaCache.has(sp.img)) imgs.add(sp.img); }
    if (!imgs.size) return;
    const WMAX = 2048, pos = []; let x = 0, y = 0, rowH = 0;
    for (const img of imgs) {
      if (img.width > WMAX) continue;
      if (x + img.width > WMAX) { x = 0; y += rowH + 1; rowH = 0; }
      pos.push([img, x, y]); x += img.width + 1; rowH = Math.max(rowH, img.height);
    }
    const H = y + rowH; if (!H || H > 4096) return;
    const c = mkCanvas(WMAX, H), q = c.getContext('2d');
    for (const [img, px, py] of pos) q.drawImage(img, px, py);
    const d = q.getImageData(0, 0, WMAX, H).data;
    for (const [img, px, py] of pos) {
      const w = img.width, h = img.height, al = new Uint8Array(w * h), top = new Int16Array(w).fill(-1);
      for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) al[j * w + i] = d[((py + j) * WMAX + px + i) * 4 + 3] > 127 ? 1 : 0;
      for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (al[j * w + i]) { top[i] = j; break; }
      alphaCache.set(img, {w, h, al, top});
    }
  }
  function buildSpots() {
    spots = [];
    for (const p of props) {
      const d = PERCH[p.kind]; if (!d || p.rail || p.sparring) continue;
      for (const dx0 of d.dx) {   // jittered a little so a row of birds on a wall doesn't stand like fence posts
        const jx = d.jx ?? 2, dx = dx0 + Math.round(rr(-jx, jx)), sink = d.sink + (d.deep ? R() * (d.deep + 1) | 0 : 0);
        spots.push({p, dx, sink, kind: p.kind, occ: null, x: p.x + dx / ctx.PPM, y: p.y, h: 0, ok: false});
      }
    }
    for (const q of host.layout.plateaus || []) for (let x = q.x0 + .7; x < q.x1 - .4; x += 1.05)
      spots.push({p: null, kind: 'ledge', occ: null, x, y: q.y1 - .12, h: q.h, ok: true});
    // neighbours within a flock's landing cluster (perches are static kinds: computed once)
    for (const s of spots) s.nb = [];
    for (let i = 0; i < spots.length; i++) for (let k = i + 1; k < spots.length; k++) {
      const a = spots[i], b = spots[k];
      if (Math.abs(a.x - b.x) < 3.8 && Math.hypot(a.x - b.x, (a.y - b.y) * 1.4) < 3.8) { a.nb.push(b); b.nb.push(a); }
    }
  }
  function spotPos(s) {   // refresh a spot's world point from the prop's CURRENT sprite (props3d on / off, biome)
    if (!s.p) return true;
    const p = s.p; if (p.broken || p.gone) return (s.ok = false);
    const sp = host.spriteOf(p); if (!sp || !sp.img) return (s.ok = false);
    const col = Math.round(sp.pivot[0] + s.dx), a = alphaOf(sp.img);
    if (col < 0 || col >= a.w || a.top[col] < 0) return (s.ok = false);
    s.x = p.x + s.dx / ctx.PPM; s.y = p.y;
    s.h = (sp.pivot[1] - a.top[col] - s.sink) / ctx.PPMH + (p.z || 0) + (p.h || 0);
    return (s.ok = s.h > .15);
  }
  const spotSortY = s => (s.p ? s.p.y : s.y) + .001;

  // ---------- ground: can a small animal stand here (no walls, pillars, water, cliff) ----------
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
  function freeNear(x, y, r, z, tries = 12) {   // a free ground point within r of (x, y) on level z
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
        case 'impact': case 'tip': case 'kick': r = N.impact; break;   // props3d: barrels tipping / rolling into things
        case 'scrape': r = N.scrape; break;
        case 'jump': r = N.jump; break;
        case 'birds_scatter': r = N.scatter; break;
      }
      if (r > 0 && e.x !== undefined) noise.push({x: e.x, y: e.y, h: e.z ?? elev(e.x, e.y), r, ev: e.type});
    }
  }
  const TH = {t: 0, x: 0, y: 0};
  function threat(x, y, h, sp) {   // strongest noise at (x, y, h) for a species: TH {t, x, y} (the source)
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

  // =================================================================== BIRDS
  function newBird(sp, f) {
    const b = {sp, f, x: 0, y: 0, h: 0, z: 0, vx: 0, vy: 0, vh: 0, face: R() < .5 ? -1 : 1, st: 'ground', act: 'stand', at: R() * 2,
      ph: R() * TAU, flap: R(), glide: 0, air: 0, dly: 0, hop: null, walk: null, spot: null, tg: null, ro: rr(-.5, .5), ho: rr(-.35, .35), cawT: rr(5, 18), caw: 0};
    b.so = {y: 0, draw: timed(g => drawBird(g, b))};
    return b;
  }
  function newFlock(spId, n, homes) {
    const sp = SPECIES[spId], f = {sp, birds: [], homes: homes || [], home: null, mode: 'feed', t: rr(20, 40), cx: 0, cy: 0, R: 3, alt: 3, dir: 1,
      intent: 'home', dest: 'ground', calmT: 99, scared: false, sx: 0, sy: 0};
    for (let i = 0; i < n; i++) { const b = newBird(sp, f); f.birds.push(b); birds.push(b); }
    flocks.push(f); return f;
  }
  function placeFeeding(f, home) {   // settle the whole flock on the floor around a home spot (no flight)
    f.home = {x: home[0], y: home[1], z: elev(home[0], home[1]), r: 1.2};
    for (const b of f.birds) {
      const q = freeNear(f.home.x, f.home.y, f.home.r, f.home.z, 20) || [f.home.x, f.home.y];
      Object.assign(b, {x: q[0], y: q[1], h: f.home.z, z: f.home.z, st: 'ground', tg: null, spot: null, hop: null, walk: null, dly: 0});
    }
    f.mode = 'feed'; f.t = rr(25, 50);
  }
  function placePerched(f) {   // on perches directly (night, solo birds at start); false = no spot found
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
      const settled = b.st !== 'fly';   // birds already in the air just turn back to the circle
      if (settled) b.sortY = b.spot ? spotSortY(b.spot) : b.y;   // stays in front of its perch until it lifts off
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
    if (Math.abs(b.vx) > .2) b.face = sgn(b.vx);
    b.st = 'fly'; b.air = 0; b.spot = null;
  }
  function settle(b) {
    const tg = b.tg; b.tg = null; if (!tg) return;
    b.x = tg.x; b.y = tg.y; b.h = tg.h; b.vx = b.vy = b.vh = 0; b.air = 0;
    if (tg.spot) { b.st = 'perch'; b.spot = tg.spot; tg.spot.occ = b; } else { b.st = 'ground'; b.z = tg.h; }
    b.act = 'stand'; b.at = rr(.4, 1.4); b.hop = null; b.walk = null;
  }
  // perches for a flock: the best free anchor (preferred kinds, not near the player), then the nearest free spots to it
  function assignPerches(f, cx, cy, avoidPlayer) {
    const pref = f.sp.perch, n = f.birds.length;
    let best = null;
    for (const s of spots) if (s.p) { s.x = s.p.x + s.dx / ctx.PPM; s.y = s.p.y; }   // props can move (props3d): read them live
    const scored = [];
    for (const s of spots) {
      const w = pref[s.kind]; if (!w || s.occ) continue;
      const d = Math.hypot(s.x - cx, s.y - cy); if (d > 18) continue;
      const pd = P ? Math.hypot(s.x - P.x, s.y - P.y) : 99;
      let cap = 1; if (n > 1) for (const o of s.nb) if (pref[o.kind] && !o.occ) cap++;   // room for the whole flock nearby
      const crowded = f.sp.solo && s.p && s.nb.some(o => o.p === s.p && o.occ);   // crows / ravens: a tower each
      scored.push([w * 2 - d * .12 - (pd < 5.5 && avoidPlayer ? 14 : 0) + Math.min(cap, n) * 1.2 - (crowded ? 6 : 0) + R() * 3, s]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    for (let i = 0; i < scored.length && i < 10 && !best; i++) if (spotPos(scored[i][1])) best = scored[i][1];   // sprite scans only for the top few
    if (!best) return false;
    const cands = [best];
    for (const s of best.nb) if (pref[s.kind] && !s.occ) cands.push(s);
    cands.sort((a, b) => Math.hypot(a.x - best.x, a.y - best.y) - Math.hypot(b.x - best.x, b.y - best.y));
    const bs2 = [...f.birds].sort((a, b) => Math.hypot(a.x - best.x, a.y - best.y) - Math.hypot(b.x - best.x, b.y - best.y));
    let i = 0;
    for (const b of bs2) {
      let s = null; while (i < cands.length && i < n * 2 + 4 && !s) { const c = cands[i++]; if (spotPos(c)) s = c; }
      if (s) { b.tg = {spot: s, x: s.x, y: s.y, h: s.h}; s.occ = b; }
      else {   // no spot left: the floor under the anchor
        const z = elev(best.x, best.y + .6), q = freeNear(best.x, best.y + 1, 1.2, z) || freeNear(cx, cy, 2, elev(cx, cy));
        if (q) { b.tg = {spot: null, x: q[0], y: q[1], h: elev(q[0], q[1])}; b.ghome = {x: q[0], y: q[1], z: b.tg.h, r: 1}; }   // it pecks about below the others
        else b.tg = {spot: best, x: best.x, y: best.y, h: best.h};
      }
    }
    return n > 0;
  }
  function farHome(f, from) {   // the flock's feeding spot furthest from `from` (the player)
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
    if (dest === 'perch' && !assignPerches(f, c.x, c.y, true)) {   // nowhere to perch: back to the floor, away from him
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
    // startle: any settled bird that hears a threat >= 1 lifts the whole flock (feeding, perched or landing)
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
        if (f.sp.solo) {   // a crow / raven: another perch, or down to walk the floor a while
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
      if (b.spot && !spotPos(b.spot)) { takeOff(f, false, 'perch'); return; }   // the perch is gone
      if (b.spot) { b.x = b.spot.x; b.y = b.spot.y; b.h = b.spot.h; }
      b.at -= dt;
      if (b.at <= 0) { const r = R(); b.act = r < .25 ? 'bob' : 'stand'; if (r > .8) b.face = -b.face; b.at = b.act === 'bob' ? rr(.3, .7) : rr(1, 4); }
      if (sp.caw && time !== 'night' && (b.cawT -= dt) <= 0) {
        b.cawT = rr(9, 26);
        if (near(b.x, b.y) && emit('caw', b.x, b.y)) b.caw = .45;
      }
      return;
    }
    // on the floor: hop, walk, peck, look around; edge away from a nervous-making source
    if (b.hop) {
      const H = b.hop; H.t += dt; const k = Math.min(1, H.t / H.d);
      b.x = H.x0 + (H.x1 - H.x0) * k; b.y = H.y0 + (H.y1 - H.y0) * k; b.h = b.z + Math.sin(k * Math.PI) * H.a;
      if (k >= 1) { b.hop = null; b.h = b.z; }
      return;
    }
    if (b.nerv && b.act !== 'alert2') {   // walk / hop a little away (pigeons walk, small birds hop)
      const dx = b.x - b.nx, dy = b.y - b.ny, d = Math.hypot(dx, dy) || 1, s = sp.walker ? .22 : .3;
      const x1 = b.x + dx / d * s + rr(-.08, .08), y1 = b.y + dy / d * s * .8 + rr(-.06, .06);
      b.face = sgn(dx); b.nerv = null;
      if (clearPath(b.x, b.y, x1, y1, b.z)) { b.hop = {x0: b.x, y0: b.y, x1, y1, t: 0, d: sp.walker ? .32 : .2, a: sp.walker ? .025 : .07}; b.act = 'bob'; b.at = .3; return; }
    }
    if (b.walk) {
      const W = b.walk; W.t -= dt;
      const x1 = b.x + W.vx * dt, y1 = b.y + W.vy * dt;
      if (W.t <= 0 || solid(x1, y1, b.z)) b.walk = null; else { b.x = x1; b.y = y1; }
      b.act = ((T * 5 + b.ph) | 0) & 1 ? 'bob' : 'stand';
      if (!b.walk) { b.act = 'stand'; b.at = rr(.2, .8); }
      return;
    }
    b.at -= dt; if (b.at > 0) return;
    const hm = b.ghome || f.home, far = hm && Math.hypot(b.x - hm.x, b.y - hm.y) > hm.r;
    const r = R();
    if (r < .38 && !far) { b.act = 'peck'; b.at = rr(.5, 1.3); return; }
    if (r < .72 || far) {   // move: toward home if strayed, else a random nearby spot
      let a = R() * TAU; if (far) a = Math.atan2(hm.y - b.y, hm.x - b.x) + rr(-.5, .5);
      if (sp.walker && R() < .7) { const s = sp.solo ? .45 : .32; b.walk = {vx: Math.cos(a) * s, vy: Math.sin(a) * s * .8, t: rr(.5, 1.4)}; b.face = sgn(Math.cos(a)); return; }
      const d = rr(.12, .3), x1 = b.x + Math.cos(a) * d, y1 = b.y + Math.sin(a) * d * .8;
      if (clearPath(b.x, b.y, x1, y1, b.z)) { b.hop = {x0: b.x, y0: b.y, x1, y1, t: 0, d: .2, a: .06}; b.face = sgn(x1 - b.x); }
      b.act = 'stand'; b.at = rr(.15, .6); return;
    }
    b.act = r < .9 ? 'stand' : 'alert'; if (R() < .5) b.face = -b.face; b.at = rr(.4, 1.6);
  }
  function flyBird(b, f, dt) {
    const sp = b.sp;
    if (b.dly > 0) { b.dly -= dt; b.act = 'alert'; if (b.dly > 0) return; launch(b, f); }
    b.air += dt;
    let dvx, dvy, dvh, agil = sp.agil, d3 = 9;
    if (b.tg) {   // landing: arrive at the target, height reaching it as the ground distance closes
      const dx = b.tg.x - b.x, dy = b.tg.y - b.y, dh = b.tg.h - b.h, dxy = Math.hypot(dx, dy);
      d3 = Math.hypot(dxy, dh);
      const spd = Math.min(sp.speed, .7 + dxy * 2.2), tt = Math.max(.2, dxy / Math.max(.6, spd));
      dvx = dx / (dxy || 1) * spd; dvy = dy / (dxy || 1) * spd; dvh = clamp(dh / tt, -2.8, 2.8);
      if (dxy > 2.5 && dh < 0) dvh = Math.max(dvh, -.5);   // hold height until it's close, then drop in
      agil *= 2.2;
      if (d3 < .1 || (dxy < .16 && Math.abs(dh) < .2) || b.air > 12) { settle(b); if (f.birds.every(o => o.st !== 'fly')) emitLanding(f); return; }
    } else {      // circling the flock's centre, radius and altitude jittered per bird
      const rx = b.x - f.cx, ry = b.y - f.cy, d = Math.hypot(rx, ry) || .01, R0 = f.R + b.ro;
      const tx = -ry / d * f.dir, ty = rx / d * f.dir, pull = clamp((R0 - d) * .9, -2.2, 2.2);
      dvx = tx * sp.speed + rx / d * pull; dvy = ty * sp.speed * .8 + ry / d * pull;
      dvh = clamp((f.alt + b.ho - b.h) * 1.3, -1.5, 2.2);
      if (b.air < .7) agil *= .45;   // the take-off burst carries it first
    }
    if (d3 > 1.5) for (const o of f.birds) {     // separation (boids-lite; off for the last metre of a landing); cohesion = the shared circle
      if (o === b || o.st !== 'fly') continue;
      const dx = b.x - o.x, dy = b.y - o.y, dh = b.h - o.h, q = dx * dx + dy * dy + dh * dh;
      if (q < .2 && q > 1e-6) { const d = Math.sqrt(q), k = (.45 - d) * 5 / d; dvx += dx * k; dvy += dy * k; dvh += dh * k * .4; }
    }
    const w = windAt(b.x, b.y), k = Math.min(1, dt * agil);
    b.vx += (dvx + w.x * .35 - b.vx) * k; b.vy += (dvy + w.y * .35 - b.vy) * k; b.vh += (dvh - b.vh) * Math.min(1, dt * agil * 1.3);
    b.x += b.vx * dt; b.y += b.vy * dt; b.h += b.vh * dt;
    const gz = elev(b.x, b.y); if (!b.tg && b.h < gz + .3) { b.h = gz + .3; b.vh = Math.max(0, b.vh); }
    if (Math.abs(b.vx) > .3) b.face = sgn(b.vx);
    // wings: fast on take-off, climbing and the last metre of a landing; glides while circling level
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
  const lowFlight = b => b.st === 'fly' && (b.dly > 0 || (b.tg && Math.hypot(b.tg.x - b.x, b.tg.y - b.y) < 1 && b.h - b.tg.h < .9) || b.air < .12);
  function drawBird(g, b) {
    const Sp = SPR[b.sp.id]; if (!Sp) return;
    const [sx, sy] = ctx.toS(b.x, b.y, b.h), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y);
    if (X < -12 || Y < -12 || X > ctx.VW + 12 || Y > ctx.VH + 12) return;
    blit(g, Sp[birdFrame(b)], X, Y, b.face);
  }

  // =================================================================== RABBITS / HARES (hoppers)
  function newHopper(spId, homeX, homeY, cover) {
    const a = {sp: SPECIES[spId], id: spId, x: homeX, y: homeY, z: elev(homeX, homeY), h: 0, face: R() < .5 ? -1 : 1, st: 'graze', at: rr(1, 4),
      hx: homeX, hy: homeY, cover, hop: null, run: 0, hide: 0, dashCD: 0, alertT: 0, frz: 0, ph: R() * TAU};
    a.h = a.z; a.so = {y: 0, draw: timed(g => drawHopper(g, a))};
    hoppers.push(a); return a;
  }
  function hopTo(a, x1, y1, d, amp) { a.hop = {x0: a.x, y0: a.y, x1, y1, t: 0, d, a: amp}; a.face = Math.abs(x1 - a.x) > .02 ? sgn(x1 - a.x) : a.face; }
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
    if (a.st === 'hide') {   // under a bush: wait for calm, then peek out
      if (th && th.t > .4) a.hide = Math.max(a.hide, rr(4, 7));
      if ((a.hide -= dt) <= 0) { const q = freeNear(a.cover.x + a.face * .45, a.cover.y + .25, .3, a.z, 8); if (q) { hopTo(a, q[0], q[1], .3, .06); a.st = 'alert'; a.alertT = rr(1.2, 2.4); } else a.hide = 2; }
      return;
    }
    if (a.st === 'flee') {   // a chain of long, fast hops to the cover (or off the view)
      if (a.frz > 0) { a.frz -= dt; return; }
      const tx = a.fx, ty = a.fy, dx = tx - a.x, dy = ty - a.y, d = Math.hypot(dx, dy);
      if (a.cover && d < .25) { a.x = tx; a.y = ty; a.st = 'hide'; a.hide = rr(6, 12); return; }
      if (!a.cover && (d < .4 || (a.run -= dt) <= 0)) {
        if (!near(a.x, a.y) || a.id === 'hare') { a.st = a.id === 'hare' ? 'freeze' : 'gone'; a.hide = rr(8, 15); a.at = rr(2.5, 5); if (a.id === 'hare') { a.hx = a.x; a.hy = a.y; } return; }
        a.st = 'graze'; a.at = 1; return;
      }
      const s = Math.min(d, a.id === 'hare' ? .95 : .8), x1 = a.x + dx / d * s, y1 = a.y + dy / d * s;
      if (!a.cover && solid(x1, y1, a.z)) {   // blocked: try around it
        for (const da of [.6, -.6, 1.2, -1.2]) { const aa = Math.atan2(dy, dx) + da, x2 = a.x + Math.cos(aa) * s, y2 = a.y + Math.sin(aa) * s; if (!solid(x2, y2, a.z)) { hopTo(a, x2, y2, .19, .13); return; } }
        a.st = 'freeze'; a.at = rr(2, 4); return;
      }
      hopTo(a, x1, y1, .19, .13); return;
    }
    if (th && th.t >= 1) { startFlee(a, th.x, th.y); return; }
    if (a.st === 'freeze') { if ((a.at -= dt) <= 0) { a.st = 'graze'; a.at = rr(1, 3); } return; }
    if (th && th.t >= TUNE.nervous) { a.st = 'alert'; a.alertT = rr(1.2, 2.2); a.face = sgn(th.x - a.x); return; }
    if (a.st === 'alert') { if ((a.alertT -= dt) <= 0) { a.st = 'graze'; a.at = rr(.5, 2); } return; }
    // grazing: nibble, sit, a hop or two within reach of home
    if ((a.at -= dt) > 0) return;
    const r = R();
    if (r < .45) { a.nib = !a.nib; a.at = rr(1, 3); return; }
    const far = Math.hypot(a.x - a.hx, a.y - a.hy) > 2.2;
    let ang = far ? Math.atan2(a.hy - a.y, a.hx - a.x) + rr(-.4, .4) : R() * TAU;
    if (r > .93 && a.cover && !far) {   // wander over to another bush (a new home)
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
    if (a.id === 'rabbit') {   // the bush that leads away from the noise
      let bs = -1e9;
      for (const p of props) {
        if (p.kind !== 'bush' || p.broken || Math.abs((p.z || 0) - a.z) > .2) continue;
        const dx = p.x - a.x, dy = p.y - a.y, dd = Math.hypot(dx, dy); if (dd > 8 || dd < .3) continue;
        const along = (dx * ax + dy * ay) / dd, fromSrc = Math.hypot(p.x - sx, p.y - sy);
        if (along < -.2 || fromSrc < 2.2) continue;
        let open = true;   // no wall / pillar / water between it and the bush
        for (let k = 1; k < 6 && open; k++) { const f = k / 6 * Math.max(0, dd - .45) / dd; if (solid(a.x + dx * f, a.y + dy * f, a.z)) open = false; }
        if (!open) continue;
        const sc = along * 2 + fromSrc * .25 - dd * .15; if (sc > bs) { bs = sc; cov = p; }
      }
    }
    a.cover = cov || (a.id === 'rabbit' ? a.cover : null);
    if (cov) { a.fx = cov.x + rr(-.1, .1); a.fy = cov.y - .06; }
    else { a.cover = null; const L = a.id === 'hare' ? rr(6, 9) : 14; a.fx = a.x + ax * L; a.fy = a.y + ay * L * .8; a.run = a.id === 'hare' ? 3 : 6; }
    if (a.dashCD <= 0) { emit('critter_dash', a.x, a.y); a.dashCD = 3; }
  }
  function hopperFrame(a) {
    if (a.hop) return a.hop.t / a.hop.d < .55 ? 'hop' : 'hop2';
    if (a.st === 'alert' || a.st === 'freeze' || a.frz > 0) return 'alert';
    return a.nib && ((T * 2.5 + a.ph) | 0) % 3 ? 'nibble' : 'sit';
  }
  function drawHopper(g, a) {
    const Sp = SPR[a.id]; if (!Sp) return;
    const [sx, sy] = ctx.toS(a.x, a.y, a.h), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y);
    if (X < -10 || Y < -10 || X > ctx.VW + 10 || Y > ctx.VH + 10) return;
    blit(g, Sp[hopperFrame(a)], X, Y, a.face);
  }

  // =================================================================== SALAMANDERS (dart, freeze)
  function newLizard(x, y) {
    const a = {x, y, z: elev(x, y), hx: x, hy: y, face: R() < .5 ? -1 : 1, st: 'freeze', at: rr(.5, 3), vx: 0, vy: 0, ph: R()};
    a.so = {y: 0, draw: timed(g => drawLizard(g, a))}; lizards.push(a); return a;
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
    if (th && th.t >= 1) {   // bolt away
      const ang = Math.atan2(a.y - th.y, a.x - th.x) + rr(-.5, .5), s = rr(3.4, 4.2);
      a.vx = Math.cos(ang) * s; a.vy = Math.sin(ang) * s * .8; a.st = 'dart'; a.at = rr(.35, .6); a.face = sgn(a.vx);
      emit('critter_dash', a.x, a.y); return;
    }
    if ((a.at -= dt) > 0) return;
    let ang = (a.face > 0 ? 0 : Math.PI) + rr(-1.1, 1.1);
    if (Math.hypot(a.x - a.hx, a.y - a.hy) > 3.5) ang = Math.atan2(a.hy - a.y, a.hx - a.x);
    const s = rr(2.2, 3.2); a.vx = Math.cos(ang) * s; a.vy = Math.sin(ang) * s * .8; a.face = sgn(a.vx);
    a.st = 'dart'; a.at = rr(.14, .32);
    if (near(a.x, a.y) && R() < .3) emit('critter_dash', a.x, a.y);
  }
  function lizardXY(a) { const [sx, sy] = ctx.toS(a.x, a.y, a.z); return [Math.round(sx - cam.x), Math.round(sy - cam.y)]; }
  function drawLizard(g, a) {
    const [X, Y] = lizardXY(a); if (X < -8 || Y < -8 || X > ctx.VW + 8 || Y > ctx.VH + 8) return;
    blit(g, SPR.salamander?.[a.st === 'dart' && ((a.ph | 0) & 1) ? 'b' : 'a'], X, Y, a.face);
  }

  // =================================================================== FROGS (banks) and FISH (stream)
  function bankPoint(y, side) { const s = S(); return [s.cx(y) + side * (s.w(y) / 2 + .14), y]; }
  function newFrog(y, side) {
    const [x] = bankPoint(y, side);
    const a = {x, y, side, h: 0, st: 'sit', at: rr(1, 4), face: -side, jump: null, gone: 0, pulse: 0};
    a.so = {y: 0, draw: timed(g => drawFrog(g, a))}; frogs.push(a); return a;
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
    if (a.st === 'gone') {   // back on a bank somewhere away from the player
      if ((a.gone -= dt) > 0) return;
      const y = rr(15.5, 27.5), side = R() < .5 ? -1 : 1, [x] = bankPoint(y, side);
      if (P && Math.hypot(x - P.x, y - P.y) < 5) { a.gone = 2; return; }
      if (inStream(x, y) || solid(x, y, 0)) { a.gone = 1; return; }
      Object.assign(a, {x, y, side, face: -side, st: 'sit', at: rr(2, 5)});
      if (near(x, y)) { const s = S(), cx = s.cx(y); a.jump = {x0: cx + side * s.w(y) * .2, y0: y + .2, x1: x, y1: y, t: 0, d: .32, a: .22, water: false}; a.x = a.jump.x0; splash(a.jump.x0, a.jump.y0); }
      return;
    }
    const th = near(a.x, a.y) ? threat(a.x, a.y, 0, SPECIES.frog) : null;
    if (th && th.t >= 1) {   // plop into the water
      const s = S(), tx = s.cx(a.y) + a.side * s.w(a.y) * rr(.05, .22), ty = a.y + rr(-.3, .3);
      a.jump = {x0: a.x, y0: a.y, x1: tx, y1: ty, t: 0, d: .34, a: .28, water: true}; a.face = sgn(tx - a.x);
      emit('frog_jump', a.x, a.y); return;
    }
    if ((a.at -= dt) > 0) return;
    if (R() < .6) { a.pulse = .5; a.at = rr(1, 3.5); return; }
    const y1 = clamp(a.y + rr(-.5, .5), 15.3, 27.7), [x1] = bankPoint(y1, a.side);   // a short hop along the bank
    if (!inStream(x1, y1)) { a.jump = {x0: a.x, y0: a.y, x1, y1, t: 0, d: .26, a: .12, water: false}; a.face = Math.abs(x1 - a.x) > .02 ? sgn(x1 - a.x) : a.face; }
    a.at = rr(3, 8);
  }
  function drawFrog(g, a) {
    if (a.st !== 'sit' && !a.jump) return;
    const Sp = SPR.frog; if (!Sp) return;
    const [sx, sy] = ctx.toS(a.x, a.y, a.h), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y);
    if (X < -6 || Y < -6 || X > ctx.VW + 6 || Y > ctx.VH + 6) return;
    blit(g, Sp[a.jump ? 'jump' : a.pulse > 0 && ((a.pulse * 8) | 0) & 1 ? 'pulse' : 'sit'], X, Y, a.face);
  }
  function newFish(y) {
    const a = {y, u: rr(-.3, .3), v: rr(.25, .5) * (R() < .5 ? -1 : 1), du: 0, st: 'swim', at: rr(1, 4), jump: null, x: 0, h: 0, face: 1, ph: R() * TAU, dart: 0};
    a.so = {y: 0, draw: timed(g => drawJump(g, a))}; fish.push(a); return a;
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
    if (th && th.t >= 1 && a.dart <= 0) { a.v = sgn(a.y - th.y) * rr(1.4, 2); a.dart = rr(.6, 1); }   // dart off
    if (a.dart > 0) { a.dart -= dt; if (a.dart <= 0) a.v = sgn(a.v) * rr(.25, .5); }
    if ((a.at -= dt) <= 0) { a.at = rr(1.5, 4); a.du = rr(-.12, .12); if (R() < .25) a.v = -a.v; }
    a.u = clamp(a.u + a.du * dt, -.34, .34);
    a.y += a.v * dt;
    if (a.y < 1.5 || a.y > 29) { a.v = -a.v; a.y = clamp(a.y, 1.5, 29); }
    for (const st of s.stones || []) if (Math.hypot(s.cx(a.y) + a.u * s.w(a.y) - st.x, a.y - st.y) < st.r + .2) { a.v = -a.v; a.y += a.v * dt * 2; }
    a.x = s.cx(a.y) + a.u * s.w(a.y);
  }
  function fishJump() {   // one fish in view leaps (ruins often, frost rarely)
    const cand = fish.filter(a => !a.jump && near(a.x, a.y) && a.y > 1.5 && a.y < 29);
    if (!cand.length) return false;
    const a = pick(cand), dir = R() < .5 ? -1 : 1;
    let x1 = a.x + dir * rr(.3, .6); const y1 = a.y + rr(-.25, .25);
    if (!inStream(x1, y1)) x1 = a.x - dir * rr(.2, .4);
    if (!inStream(x1, y1)) return false;
    a.jump = {x0: a.x, y0: a.y, x1, y1, t: 0, d: rr(.5, .65), a: rr(.35, .55)}; a.face = sgn(x1 - a.x);
    emit('fish_jump', a.x, a.y); splash(a.x, a.y);
    return true;
  }
  function drawJump(g, a) {
    if (!a.jump) return;
    const Sp = SPR.fishj; if (!Sp) return;
    const [sx, sy] = ctx.toS(a.x, a.y, a.h), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y), k = a.jump.t / a.jump.d;
    blit(g, Sp[k < .35 ? 'up' : k < .65 ? 'level' : 'down'], X, Y, a.face);
  }

  // =================================================================== INSECTS: butterflies (day), moths (lights)
  function lightSources() {   // braziers + torches (+ lava glow in the ember wastes): world {x, y, h}
    const L = [];
    for (const p of props) if (p.kind === 'brazier' || p.kind === 'torch') {
      const sp = host.spriteOf(p), l = sp && sp.lights && sp.lights[0];
      L.push({x: p.x + (l?.dx || 0), y: p.y + (l?.dy || 0), h: (l?.h ?? (p.kind === 'torch' ? 1.6 : 1.1)) + (p.z || 0), kind: p.kind});
    }
    if (biome === 'ember') for (const l of BIOMES.find(b => b.id === 'ember')?.groundLights || [])
      if (l.x > 1 && l.x < ctx.WM - 1 && l.y > 1 && l.y < ctx.HM - 1) L.push({x: l.x, y: l.y, h: .5, kind: 'lava'});
    return L;
  }
  function newBug(kind, pal, x, y, h, src) {
    const a = {kind, pal, x, y, h, vx: 0, vy: 0, vh: 0, ax: x, ay: y, src, st: 'flit', at: rr(.2, .6), ph: R() * TAU, face: 1, rest: null,
      a: R() * TAU, r: rr(.25, .55), w: rr(3, 5.5) * (R() < .5 ? -1 : 1), hh: rr(-.25, .3), ox: 0, oy: 0, flap: 0};
    a.so = {y: 0, draw: timed(g => drawBug(g, a))}; bugs.push(a); return a;
  }
  function stepBug(a, dt) {
    const w = windAt(a.x, a.y);
    if (a.kind === 'moth') {   // orbit the flame: erratic angle speed and radius, the wind blows it off, it returns
      a.a += a.w * dt * (1 + Math.sin(T * 3.1 + a.ph) * .5); a.r = clamp(a.r + Math.sin(T * 2.3 + a.ph * 3) * dt * .4, .15, .75);
      if (R() < dt * .4) a.w = -a.w;
      a.ox = (a.ox + w.x * dt * .6) * Math.exp(-dt * 1.4); a.oy = (a.oy + w.y * dt * .6) * Math.exp(-dt * 1.4);
      a.x = a.src.x + Math.cos(a.a) * a.r + a.ox; a.y = a.src.y + Math.sin(a.a) * a.r * .7 + a.oy;
      a.hc = a.src.h + (a.src.kind === 'lava' ? .4 : 0);   // over lava they circle in the heat above it
      a.h = a.hc + a.hh + Math.sin(T * 4 + a.ph) * .12;
      a.face = sgn(-Math.sin(a.a) * a.w); a.flap += dt * 14; return;
    }
    // butterfly
    if (a.rest) {
      a.flap += dt * 1.2; a.at -= dt;
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
      if (R() < .06) {   // rest on a bush top a while
        let bb = null, bd = 3; for (const s2 of spots) if (s2.kind === 'bush' && !s2.occ) { const dd = Math.hypot(s2.x - a.x, s2.y - a.y); if (dd < bd && spotPos(s2)) { bd = dd; bb = s2; } }
        if (bb) { a.rest = bb; a.x = bb.x; a.y = bb.y; a.h = bb.h - .02; a.at = rr(3, 8); return; }
      }
    }
    a.x += (a.vx + w.x * .5 + Math.sin(T * 7 + a.ph) * .25) * dt; a.y += (a.vy + w.y * .5) * dt;
    const gz = elev(a.x, a.y); a.h = clamp(a.h + a.vh * dt + Math.sin(T * 6 + a.ph) * dt * .4, gz + .25, gz + 1.8);
    if (Math.abs(a.vx) > .15) a.face = sgn(a.vx);
  }
  function drawBug(g, a) {
    const Sp = SPR[a.pal]; if (!Sp) return;
    const [sx, sy] = ctx.toS(a.x, a.y, a.h), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y);
    if (X < -4 || Y < -4 || X > ctx.VW + 4 || Y > ctx.VH + 4) return;
    let f;
    if (a.kind === 'moth') f = ((a.flap | 0) & 1) ? 'open' : 'closed';
    else { const i = (a.flap | 0) % 4; f = a.rest ? (i < 2 ? 'closed' : 'open') : i === 0 ? 'open' : i === 2 ? 'closed' : 'flat'; }
    blit(g, Sp[f], X, Y, a.face);
  }

  // =================================================================== VULTURES (ember): shadow + rare silhouette
  const vShadow = {};
  function vultureShadow(ai) {   // a soaring bird's shadow for heading index ai (16): wings, fingered tips, body, tail
    const key = biome + ai; if (vShadow[key]) return vShadow[key];
    const a = ai / 16 * TAU, ca = Math.cos(a), sa = Math.sin(a), span = .62, W = 44, H = 34, c = mkCanvas(W, H), q = c.getContext('2d');
    q.fillStyle = (SHADE[biome] || SHADE.ruins)[0];   // as dark as the host's cast shadows
    for (let py = 0; py < H; py++) for (let px = 0; px < W; px++) {
      const u = (px + .5 - W / 2) / ctx.PPM, v = (py + .5 - H / 2) / ctx.PPMY;
      const al = u * ca + v * sa, si = -u * sa + v * ca, as = Math.abs(si);
      let on = false;
      if (as < span) {   // wing: swept back a little, tapering chord; the last 12 cm split into three fingers
        const mid = -.04 - as * .08, ch = .09 * (1 - (as / span) ** 2 * .45);
        if (as < span - .12) on = Math.abs(al - mid) < ch;
        else { const f = (as - (span - .12)) / .12, fi = Math.floor((al - mid + .09) / .06); on = Math.abs(al - mid) < .09 && fi >= 0 && fi < 3 && ((al - mid + .09) % .06) < .04 && f < 1 - fi * .18; }
      }
      if (!on && as < .06 && al > -.32 && al < .2) on = true;                                   // body + head
      if (!on && al <= -.28 && al > -.42 && as < .05 + (-.28 - al) * .5) on = true;            // tail fan
      if (on) q.fillRect(px, py, 1, 1);
    }
    return (vShadow[key] = {c, W, H});
  }
  function newVulture(cx, cy) {
    const v = {cx, cy, hx: cx, hy: cy, R: rr(5, 8), a: R() * TAU, w: rr(.16, .24) * (R() < .5 ? -1 : 1), h: rr(8.5, 10), x: 0, y: 0, beat: 0, wt: rr(4, 9)};
    vultures.push(v); return v;
  }
  function stepVulture(v, dt) {
    v.a += v.w * dt;
    v.cx += (v.hx - v.cx) * dt * .05 + Math.sin(T * .05 + v.R) * dt * .25; v.cy += (v.hy - v.cy) * dt * .05 + Math.cos(T * .04 + v.R) * dt * .2;
    v.x = v.cx + Math.cos(v.a) * v.R; v.y = v.cy + Math.sin(v.a) * v.R * .8;
    if ((v.wt -= dt) <= 0) { v.beat = .9; v.wt = rr(6, 14); } v.beat = Math.max(0, v.beat - dt);
  }
  const vHeading = v => { const hx = -Math.sin(v.a) * sgn(v.w), hy = Math.cos(v.a) * .8 * sgn(v.w); return (((Math.round(Math.atan2(hy, hx) / TAU * 16) % 16) + 16) % 16); };

  // =================================================================== RIFT: jellies, eyes, motes
  function newJelly(x, y) {
    const j = {x, y, h: rr(1.6, 2.8), base: rr(1.6, 2.8), hx: x, hy: y, vx: 0, vy: 0, head: R() * TAU, ph: R() * TAU, pulse: R(), rate: rr(.55, .8), flinch: 0,
      tn: [rr(3, 6) | 0, rr(5, 8) | 0, rr(4, 7) | 0, rr(3, 6) | 0]};
    j.so = {y: 0, draw: timed(g => drawJelly(g, j))}; jellies.push(j); return j;
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
    const push = j.pulse < .3 ? .35 : -.12;   // contracting pushes it up, then it sinks back while the bell opens
    j.base = clamp(j.base + push * dt * .35, 1.5, 3); j.h = elev(j.x, j.y) + j.base + Math.sin(T * .7 + j.ph) * .12 + (j.flinch > 0 ? j.flinch * .3 : 0);
  }
  function jellyGeo(j) {   // screen anchor + the tendril pixels (shared by the draw and the glow)
    const [sx, sy] = ctx.toS(j.x, j.y, j.h), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y), tall = j.pulse < .3;
    const at = tall ? [-2, -1, 1, 2] : [-3, -1, 1, 3], pts = [];
    for (let i = 0; i < 4; i++) {   // tendrils trail behind the drift and sway, longer while the bell is contracted
      const n = j.tn[i] + (tall ? 1 : 0);
      for (let k = 1; k <= n; k++) pts.push(X + at[i] + Math.round(-j.vx * k * 1.2 + Math.sin(T * 1.8 + j.ph + i * 1.7 + k * .55) * k * .2), Y + k, k === n ? 1 : k === n - 1 ? 2 : 0);
    }
    return {X, Y, tall, pts};
  }
  function drawJelly(g, j) {
    const G = jellyGeo(j); if (G.X < -8 || G.Y < -10 || G.X > ctx.VW + 8 || G.Y > ctx.VH + 10) return;
    g.fillStyle = JELLY.tend;
    for (let i = 0; i < G.pts.length; i += 3) if (G.pts[i + 2] !== 1) g.fillRect(G.pts[i], G.pts[i + 1], 1, 1);
    g.fillStyle = PAL.rift.jelly.r[0]; for (let i = 0; i < G.pts.length; i += 3) if (G.pts[i + 2] === 1) g.fillRect(G.pts[i], G.pts[i + 1], 1, 1);
    blit(g, SPR.jelly?.[G.tall ? 'tall' : 'wide'], G.X, G.Y, 1);
  }
  // eyes: on the north wall's face, tower / pillar shafts, the plateau cliff and cracks in the floor
  function placeEyes(n) {
    const cand = [];
    const tryProp = (p, h, dy, ox) => {
      const sp = host.spriteOf(p); if (!sp) return;
      const x = p.x + ox, y = p.y + dy, [a, b] = ctx.toS(x, y, (p.z || 0) + h), [c0, d0] = ctx.toS(p.x, p.y, (p.z || 0) + (p.h || 0));
      const ix = Math.round(a - c0) + sp.pivot[0], iy = Math.round(b - d0) + sp.pivot[1];
      for (let dx = -2; dx <= 2; dx++) for (let dy2 = -2; dy2 <= 1; dy2++) if (!opaque(sp.img, ix + dx, iy + dy2)) return;   // the socket fits on the face
      cand.push({x, y, h: (p.z || 0) + h, sortY: p.y + .001, wall: true, p});
    };
    const walls = props.filter(p => p.kind === 'wall_n'), towers = props.filter(p => p.kind === 'tower'), pillars = props.filter(p => p.kind === 'pillar' || p.kind === 'gatepost');
    for (let i = 0; i < 6; i++) { const p = pick(walls); if (p) tryProp(p, rr(.35, .85), .25, rr(-.3, .3)); }
    for (const p of towers) tryProp(p, rr(.9, 1.6), .45, rr(-.4, .4));
    for (let i = 0; i < 3; i++) { const p = pick(pillars); if (p) tryProp(p, rr(.9, 1.7), .2, 0); }
    const pl = (host.layout.plateaus || [])[0];
    if (pl) for (let i = 0; i < 3; i++) cand.push({x: rr(pl.x0 + 1, pl.x1 - 1), y: pl.y1 + .02, h: rr(.6, 1.8), ground: true});
    for (let i = 0; i < 6; i++) { const q = freeNear(rr(10, 56), rr(8, 25), .1, 0, 1); if (q && !inStream(q[0], q[1]) && elev(q[0], q[1]) === 0) cand.push({x: q[0], y: q[1], h: 0, ground: true, floor: true}); }
    for (let i = cand.length - 1; i > 0; i--) { const k = R() * (i + 1) | 0; [cand[i], cand[k]] = [cand[k], cand[i]]; }
    const out = [];
    for (const c of cand) { if (out.length >= n) break; if (out.some(o => Math.hypot(o.x - c.x, o.y - c.y) < 1.6)) continue; out.push(c); }
    for (const e of out) { Object.assign(e, {open: 2, st: 'open', at: rr(2, 6), shut: 0, px: 1, py: 1}); e.so = {y: e.sortY || e.y, draw: timed(g => drawEye(g, e))}; eyes.push(e); }
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
    // the pupil follows the player, snapping between 3 x 2 positions (with a little lag)
    const dx = P.x - e.x, dy = P.y - e.y, wx = dx < -1.2 ? 0 : dx > 1.2 ? 2 : 1, wy = dy < -.6 ? 0 : 1;
    if (wx !== e.px || wy !== e.py) { e.look = (e.look || 0) + dt; if (e.look > .18) { e.px = wx; e.py = wy; e.look = 0; } } else e.look = 0;
  }
  function eyeXY(e) { const [sx, sy] = ctx.toS(e.x, e.y, e.h); return [Math.round(sx - cam.x) - 1, Math.round(sy - cam.y) - 1]; }
  function drawEye(g, e) {   // a 3 x 2 eyeball in a dark socket; lids: open / half (the upper lid down) / shut (lash line)
    const [X, Y] = eyeXY(e); if (X < -4 || Y < -4 || X > ctx.VW + 4 || Y > ctx.VH + 4) return;
    g.fillStyle = EYE.lid; g.fillRect(X, Y - 1, 3, 1); g.fillRect(X, Y + 2, 3, 1); g.fillRect(X - 1, Y, 1, 2); g.fillRect(X + 3, Y, 1, 2);
    if (e.open === 0) { g.fillStyle = EYE.lidHi; g.fillRect(X, Y, 3, 1); g.fillStyle = EYE.lash; g.fillRect(X, Y + 1, 3, 1); return; }
    if (e.open === 1) { g.fillStyle = EYE.lidHi; g.fillRect(X, Y, 3, 1); g.fillStyle = EYE.sclera; g.fillRect(X, Y + 1, 3, 1); g.fillStyle = EYE.pupil; g.fillRect(X + e.px, Y + 1, 1, 1); return; }
    g.fillStyle = EYE.sclera; g.fillRect(X, Y, 3, 2);
    g.fillStyle = EYE.pupil; g.fillRect(X + e.px, Y + e.py, 1, 1);
  }
  function newSchool(n) {
    school = {x: 20, y: 15.5, h: 1.6, a: R() * TAU, tx: 20, ty: 15.5, t: 0};
    for (let i = 0; i < n; i++) motes.push({x: 20 + rr(-1, 1), y: 15.5 + rr(-1, 1), h: rr(1, 2), vx: rr(-.3, .3), vy: rr(-.3, .3), vh: 0, ph: R() * TAU});
  }
  function stepSchool(dt) {
    const sc = school; if (!sc) return;
    if ((sc.t -= dt) <= 0) {   // the school's slow wander target, around the ring and the grove
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

  // =================================================================== populate / time
  function clearAll() {
    flocks = []; birds = []; hoppers = []; lizards = []; frogs = []; fish = []; bugs = []; vultures = []; jellies = []; eyes = []; motes = []; school = null;
  }
  function buildArt() {
    SPR = {};
    const PB = PAL[biome] || {};
    for (const k in PB) { const Ad = ART[ARTOF[k] || k]; if (!Ad) continue; SPR[k] = {}; for (const f in Ad) SPR[k][f] = mkSprite(Ad[f], PB[k]); }
  }
  function populate() {
    need = false; clearAll();
    seed = {ruins: 101, ember: 211, frost: 307, rift: 401}[biome] || 1;
    buildArt(); buildSpots(); prewarm();
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
    if (C.frogs) for (const y of [16.8, 20.5, 26.2].slice(0, C.frogs)) newFrog(y + rr(-.4, .4), R() < .5 ? -1 : 1);
    if (C.salamanders) for (const [x, y] of [[37, 13.5], [42.5, 19], [17, 12.5], [24, 19.5], [37.5, 22]].slice(0, C.salamanders)) newLizard(x, y);
    if (C.vultures) for (let i = 0; i < C.vultures; i++) newVulture(rr(16, 44), rr(11, 20));
    if (C.jellies) for (const [x, y] of [[14, 12], [26, 18.5], [38, 14], [50, 20.5]].slice(0, C.jellies)) newJelly(x, y);
    if (C.eyes) placeEyes(C.eyes);
    if (C.motes) newSchool(C.motes);
    needTime = true;
  }
  function applyTime() {   // insects follow the time of day; flocks go to roost / wake up
    needTime = false;
    const C = CAST[biome] || {};
    bugs = [];
    if (biome === 'ruins' && time !== 'night') {
      const bushes = props.filter(p => p.kind === 'bush' && !p.outside), lg = host.layout.lightGarden;
      const anchors = bushes.map(b => [b.x, b.y]).concat(lg ? [[lg.x, lg.y], [lg.x - 1, lg.y + 1]] : []);
      const n = time === 'day' ? C.butterflies || 0 : 2;
      for (let i = 0; i < n; i++) { const [x, y] = pick(anchors); newBug('butterfly', 'bfly' + (i % 3), x + rr(-1, 1), y + rr(-.5, .5), rr(.5, 1.3)); }
    }
    const nm = C.moths ? (time === 'night' ? C.moths : time === 'dusk' ? Math.max(1, C.moths - 1) : biome === 'ember' ? 1 : 0) : 0;
    if (nm) for (const L of lightSources()) for (let i = 0; i < (L.kind === 'lava' ? Math.max(1, nm - 1) : nm); i++)
      newBug('moth', biome === 'ember' ? 'ashmoth' : 'moth', L.x, L.y, L.h, L);
    vultures.forEach(v => v.off = time === 'night');
    for (const f of flocks) {
      if (time === 'night' && f.mode === 'feed') {
        const c = centroid(f);
        if (near(c.x, c.y)) takeOff(f, false, 'roost'); else if (!placePerched(f)) takeOff(f, false, 'roost');
      } else if (time !== 'night' && wasNight && f.mode === 'perch') f.t = Math.min(f.t, rr(1, 5));   // morning: down to feed
    }
    wasNight = time === 'night';
  }

  // =================================================================== drawing helpers
  const bk = new Map();   // colour buckets (batched fillRects)
  const put = (m, c, x, y, w = 1, h = 1) => { let a = m.get(c); if (!a) m.set(c, a = []); a.push(x, y, w, h); };
  function flush(m, q) { let any = false; for (const [c, a] of m) { if (!a.length) continue; any = true; q.fillStyle = c; for (let i = 0; i < a.length; i += 4) q.fillRect(a[i], a[i + 1], a[i + 2], a[i + 3]); a.length = 0; } return any; }
  function shadowAt(x, y, hAbove, sh) {   // a flying animal's shadow on the ground: 3 -> 1 px, lighter with height
    if (hAbove > 7) return;
    const z = elev(x, y), [sx, sy] = ctx.toS(x, y, z), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y);
    if (X < -3 || Y < -2 || X > ctx.VW + 3 || Y > ctx.VH + 2) return;
    if (hAbove < 1.2) put(bk, sh[0], X - 1, Y, 3, 1);
    else if (hAbove < 3) { put(bk, sh[0], X, Y, 2, 1); }
    else if (hAbove < 5) put(bk, sh[1], X, Y, 2, 1);
    else put(bk, sh[2], X, Y, 1, 1);
  }
  const EF = mkCanvas(1, 1), efq = EF.getContext('2d'), EOUT = [{img: EF, x: 0, y: 0}];
  const gB = new Map(), gF = new Map();
  const glow = (c, X, Y, wy, w = 1, h = 1) => put(!P || wy < P.y ? gB : gF, c, X, Y, w, h);

  // =================================================================== the contract
  const SO = [], LI = [];
  Object.assign(WL, {
    toggle() { WL.on = !WL.on; return WL.on; },
    setBiome(id) { if (id !== biome) { biome = id; need = true; } else need = need || !flocks.length; },
    setTime(name) { if (name !== time) { time = name; needTime = true; } },
    update(dt, evs) {
      const t0 = performance.now();
      WL.ms = WL.ms * .95 + acc * .05; acc = 0;
      if (!WL.on) { tick(t0); return; }
      dt = Math.min(.05, Math.max(0, dt || 0)); T += dt;
      P = host.P; const c = host.cam(); if (c) cam = c;
      if (need) populate();
      if (needTime) applyTime();
      for (const k in CD) if (CD[k] > 0) CD[k] -= dt;
      // the detail region: the view plus a margin (things up to ~7 m high still show from below the view)
      const m = TUNE.margin;
      V.x0 = cam.x / ctx.PPM - m; V.x1 = (cam.x + ctx.VW) / ctx.PPM + m;
      V.y0 = cam.y / ctx.PPMY - m; V.y1 = (cam.y + ctx.VH) / ctx.PPMY + m + 7 * ctx.PPMH / ctx.PPMY;
      gatherNoise(evs);
      for (const f of flocks) stepFlock(f, dt);
      for (const b of birds) stepBird(b, dt);
      for (const a of hoppers) stepHopper(a, dt);
      for (const a of lizards) stepLizard(a, dt);
      const s = S(), sv = s && (near(s.cx(V.y0 + m), V.y0 + m) || near(s.cx((V.y0 + V.y1) / 2), (V.y0 + V.y1) / 2) || near(s.cx(V.y1 - m), V.y1 - m));
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
    drawGround(g, c) {
      if (!WL.on || need) return;
      const t0 = performance.now(); if (c) cam = c;
      const sh = SHADE[biome] || SHADE.ruins;
      // fish under the water (solid water-shade pixels, clipped to the channel)
      const U = UNDER[biome];
      if (U && fish.length) {
        for (const a of fish) {
          if (a.jump) continue;
          const [sx, sy] = ctx.toS(a.x, a.y, 0), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y);
          if (X < -4 || Y < -6 || X > ctx.VW + 4 || Y > ctx.VH + 6) continue;
          const dir = a.v > 0 ? 1 : -1, wig = ((T * (a.dart > 0 ? 9 : 4) + a.ph) | 0) & 1;
          const px = (ox, oy, col) => { const wx = a.x + ox / ctx.PPM, wy = a.y + oy / ctx.PPMY; if (inStream(wx, wy)) put(bk, col, X + ox, Y + oy); };
          // a 2 x 5 px silhouette, head toward the swim direction (down the screen = south = +y), the tail fin wagging
          px(0, 2 * dir, U[0]); px(1, 2 * dir, U[0]); px(0, dir, U[1]); px(1, dir, U[0]); px(0, 0, U[1]); px(1, 0, U[1]);
          px(wig, -dir, U[1]); px(1 - wig, -2 * dir, U[1]);
        }
        for (const a of frogs) if (a.st === 'swim') { const [sx, sy] = ctx.toS(a.x, a.y, 0); put(bk, U[1], Math.round(sx - cam.x), Math.round(sy - cam.y), 2, 1); }
        flush(bk, g);
      }
      // floor / cliff eyes (rift)
      for (const e of eyes) if (e.ground) drawEye(g, e);
      // shadows: multiply, hard pixels
      for (const b of birds) {
        if (b.st === 'fly' && b.dly <= 0) shadowAt(b.x, b.y, b.h - elev(b.x, b.y), sh);
        else if (b.st === 'ground') { const [sx, sy] = ctx.toS(b.x, b.y, b.z); const X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y); if (X > -4 && Y > -2 && X < ctx.VW + 4 && Y < ctx.VH + 2) put(bk, sh[1], X - 1, Y + 1, b.sp.heavy || b.sp.id === 'crow' ? 4 : 3, 1); }
      }
      for (const a of hoppers) if (a.st !== 'hide' && a.st !== 'gone') { const [sx, sy] = ctx.toS(a.x, a.y, a.z); const X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y); if (X > -5 && Y > -2 && X < ctx.VW + 5 && Y < ctx.VH + 2) put(bk, a.hop ? sh[1] : sh[0], X - 2, Y + 1, 5, 1); }
      for (const a of bugs) if (!a.rest && a.kind === 'butterfly') shadowAt(a.x, a.y, a.h - elev(a.x, a.y) + 1.2, sh);
      for (const j of jellies) { const hA = j.h - elev(j.x, j.y); const [sx, sy] = ctx.toS(j.x, j.y, elev(j.x, j.y)); const X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y); if (X > -4 && Y > -2 && X < ctx.VW + 4 && Y < ctx.VH + 2) put(bk, hA < 2.2 ? sh[1] : sh[2], X - 1, Y, 3, 1); }
      g.save(); g.globalCompositeOperation = 'multiply'; flush(bk, g);
      for (const v of vultures) {   // the big soaring shadow
        if (v.off) continue;
        const [sx, sy] = ctx.toS(v.x, v.y, elev(v.x, v.y)), s = vultureShadow(vHeading(v)), X = Math.round(sx - cam.x) - (s.W >> 1), Y = Math.round(sy - cam.y) - (s.H >> 1);
        if (X > -s.W && Y > -s.H && X < ctx.VW && Y < ctx.VH) g.drawImage(s.c, X, Y);
      }
      g.restore();
      tick(t0);
    },
    sortables(c) {
      SO.length = 0;
      if (!WL.on || need) return SO;
      const t0 = performance.now(); if (c) cam = c;
      const vis = (x, y, h, pad = 12) => { const [sx, sy] = ctx.toS(x, y, h); const X = sx - cam.x, Y = sy - cam.y; return X > -pad && Y > -pad && X < ctx.VW + pad && Y < ctx.VH + pad; };
      for (const b of birds) {
        if (b.st === 'fly' && !lowFlight(b)) continue;
        if (!vis(b.x, b.y, b.h)) continue;
        b.so.y = b.st === 'perch' && b.spot ? spotSortY(b.spot) : b.dly > 0 || b.air < .12 ? b.sortY ?? b.y : b.tg && b.tg.spot ? spotSortY(b.tg.spot) : b.y;
        SO.push(b.so);
      }
      for (const a of hoppers) {
        if (a.st === 'gone' || !vis(a.x, a.y, a.h)) continue;
        a.so.y = a.st === 'hide' && a.cover ? a.cover.y - .02 : a.y; SO.push(a.so);
      }
      for (const a of lizards) if (vis(a.x, a.y, a.z)) { a.so.y = a.y; SO.push(a.so); }
      for (const a of frogs) if ((a.st === 'sit' || a.jump) && vis(a.x, a.y, a.h)) { a.so.y = a.y; SO.push(a.so); }
      for (const a of fish) if (a.jump && vis(a.x, a.y, a.h)) { a.so.y = a.y; SO.push(a.so); }
      for (const a of bugs) if (vis(a.x, a.y, a.h, 6)) { a.so.y = a.rest ? spotSortY(a.rest) : a.y; SO.push(a.so); }
      for (const j of jellies) if (vis(j.x, j.y, j.h, 16)) { j.so.y = j.y; SO.push(j.so); }
      for (const e of eyes) if (e.wall && vis(e.x, e.y, e.h, 6)) SO.push(e.so);
      tick(t0);
      return SO;
    },
    drawAir(g, c) {
      if (!WL.on || need) return;
      const t0 = performance.now(); if (c) cam = c;
      for (const b of birds) if (b.st === 'fly' && !lowFlight(b)) drawBird(g, b);
      if (motes.length) {
        for (const m of motes) { const [sx, sy] = ctx.toS(m.x, m.y, m.h), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y); if (X >= 0 && Y >= 0 && X < ctx.VW && Y < ctx.VH) put(bk, MOTE.base, X, Y); }
        flush(bk, g);
      }
      for (const v of vultures) {   // the rare silhouette: only when the circle brings it into the top of the view
        if (v.off) continue;
        const [sx, sy] = ctx.toS(v.x, v.y, v.h), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y);
        if (X < -8 || Y < -4 || X > ctx.VW + 8 || Y > ctx.VH + 4) continue;
        blit(g, SPR.vulture?.[v.beat > 0 && ((v.beat * 3) | 0) & 1 ? 'beat' : 'glide'], X, Y, -Math.sin(v.a) * v.w > 0 ? 1 : -1);
      }
      tick(t0);
    },
    emitters(c) {
      if (!WL.on || need) return [];
      const t0 = performance.now(); if (c) cam = c;
      const on = (X, Y) => X > -4 && Y > -4 && X < ctx.VW + 4 && Y < ctx.VH + 4;
      for (const a of lizards) {   // fire salamanders: two ember spots on the back
        const [X, Y] = lizardXY(a); if (!on(X, Y)) continue;
        const f = a.face, k = ((T * 1.3 + a.ph * 7) | 0) % 5 === 0 ? 1 : 0;
        glow(SALA_GLOW[k], X + (f > 0 ? -1 : 1), Y, a.y); glow(SALA_GLOW[1 - k], X + (f > 0 ? 1 : -1), Y, a.y);
      }
      for (const a of bugs) {       // moths catch the flame's light: wings lit warm, brighter the closer they flutter
        if (a.kind !== 'moth' || !a.src) continue;
        const d = Math.hypot(a.r, (a.h - (a.hc ?? a.src.h)) * 1.3); if (d > .7) continue;
        const [sx, sy] = ctx.toS(a.x, a.y, a.h), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y); if (!on(X, Y)) continue;
        const G = biome === 'ember' ? ['#ffc080', '#c07040', '#6a3a24'] : ['#ffe6b0', '#c89a62', '#6e5436'], k = d < .3 ? 0 : d < .5 ? 1 : 2;
        if (((a.flap | 0) & 1)) { glow(G[k], X - 1, Y - 1, a.y); glow(G[k], X + 1, Y - 1, a.y); } else glow(G[k], X, Y - 1, a.y);
      }
      for (const j of jellies) {    // glowing tendril tips, a faint pulse in the bell
        const G = jellyGeo(j); if (!on(G.X, G.Y)) continue;
        for (let i = 0; i < G.pts.length; i += 3) if (G.pts[i + 2]) glow(G.pts[i + 2] === 1 ? JELLY.tip : JELLY.tip2, G.pts[i], G.pts[i + 1], j.y);
        if (G.tall) glow(JELLY.bell, G.X - 1, G.Y - 2, j.y, 3, 2); else glow(JELLY.bell, G.X - 2, G.Y - 1, j.y, 5, 1);
        glow(JELLY.core, G.X, G.Y - (G.tall ? 2 : 1), j.y);
      }
      for (const e of eyes) {       // the sclera glows faintly, one bright glint
        if (e.open < 2) continue;
        const [X, Y] = eyeXY(e); if (!on(X, Y)) continue;
        const wy = e.floor ? e.y - 1 : e.sortY || e.y;
        for (let i = 0; i < 3; i++) for (let k = 0; k < 2; k++) if (i !== e.px || k !== e.py) glow(EYE.glow, X + i, Y + k, wy);
        glow(EYE.glint, X + (e.px === 0 ? 2 : 0), Y, wy);
      }
      for (const m of motes) {
        const [sx, sy] = ctx.toS(m.x, m.y, m.h), X = Math.round(sx - cam.x), Y = Math.round(sy - cam.y); if (!on(X, Y)) continue;
        const b = Math.sin(T * 2.2 + m.ph * 5); glow(MOTE.glow[b > .6 ? 0 : b > -.2 ? 1 : 2], X, Y, m.y);
        if (b > .9) { glow(MOTE.glow[2], X - 1, Y, m.y); glow(MOTE.glow[2], X + 1, Y, m.y); }
      }
      // ONE view-sized layer (the lighting adds it directly, alpha by the ambient: faint by day, full at night, the same
      // for every animal). Glows behind the player are painted first and his silhouette is cut out of them.
      let anyB = false, anyF = false;
      for (const a of gB.values()) if (a.length) { anyB = true; break; }
      for (const a of gF.values()) if (a.length) { anyF = true; break; }
      if (!anyB && !anyF) { tick(t0); return []; }
      if (EF.width !== ctx.VW || EF.height !== ctx.VH) { EF.width = ctx.VW; EF.height = ctx.VH; efq.imageSmoothingEnabled = false; } else efq.clearRect(0, 0, ctx.VW, ctx.VH);
      if (anyB) {
        flush(gB, efq);
        const pl = host.player && host.player();
        if (pl && pl.img) { efq.globalCompositeOperation = 'destination-out'; efq.drawImage(pl.img, pl.srcX, 0, pl.w, pl.h, pl.sx - pl.pivot[0], pl.sy - pl.pivot[1], pl.w, pl.h); efq.globalCompositeOperation = 'source-over'; }
      }
      if (anyF) flush(gF, efq);
      tick(t0);
      EOUT[0].img = EF; return EOUT;
    },
    lights() {
      LI.length = 0;
      if (!WL.on || need) return LI;
      jellies.forEach((j, i) => { if (near(j.x, j.y)) LI.push({x: j.x, y: j.y, h: j.h, color: JELLY.light, radius: 1.5, intensity: .3 + (j.pulse < .3 ? .1 : 0), flicker: .08, id: 7700 + i}); });
      return LI;
    },
    // ---------- debug ----------
    dbg() {
      const st = {}; for (const b of birds) { const k = b.sp.id + ':' + b.st; st[k] = (st[k] || 0) + 1; }
      return {biome, time, count: WL.count, ms: +WL.ms.toFixed(3), flocks: flocks.map(f => `${f.sp.id} ${f.mode} t${f.t.toFixed(1)} ${f.intent}`), birds: st,
        hoppers: hoppers.map(a => a.id + ':' + a.st), lizards: lizards.map(a => a.st), frogs: frogs.map(a => a.st), fish: fish.length, bugs: bugs.length,
        vultures: vultures.length, jellies: jellies.length, eyes: eyes.map(e => e.open), motes: motes.length, spots: spots.length};
    },
    sheet(z = 6) {   // every sprite frame of the current biome, zoomed, for review
      const rows = Object.entries(SPR);
      const W = 12 + Math.max(1, ...rows.map(([, f]) => Object.values(f).reduce((s, x) => s + x.w + 3, 0))) * z, H = rows.reduce((s, [, f]) => s + (Math.max(...Object.values(f).map(x => x.h)) + 3) * z, 12);
      const c = mkCanvas(W, H), q = c.getContext('2d'); q.imageSmoothingEnabled = false; q.fillStyle = '#6a6d62'; q.fillRect(0, 0, W, H);
      let y = 6;
      for (const [, f] of rows) {
        let x = 6; const h = Math.max(...Object.values(f).map(s => s.h));
        for (const s of Object.values(f)) { q.drawImage(s.c, x, y, s.w * z, s.h * z); x += (s.w + 3) * z; }
        y += (h + 3) * z;
      }
      return c;
    },
  });
  Object.defineProperty(WL, '_', {get: () => ({flocks, birds, hoppers, lizards, frogs, fish, bugs, vultures, jellies, eyes, motes, spots, school, noise, fishJump, spotPos, V})});
  return WL;
}
