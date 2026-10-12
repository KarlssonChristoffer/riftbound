// CLOUDS: the cloud shadows on the ground and a change of weather's DECK (sim/env.js TRANSITIONS: a front's storm side, a
// breaking deck), as GLSL shared by the composite (gfx.js COMP_FS: it lights each pixel by them) and the god rays
// (render/godrays.js SHAPE_FS: no beam where the sun is clouded over). features/depth.js sets the uniforms every frame it shows
// them (G.setClouds); gfx.js owns them (compU; the new ones: CLOUD_EXTRA, made and set generically).
//
// THE FIELD (core/cloudfield.js: the same function the sim evaluates): one cloud density over the ground (the smooth field:
// big clouds with gently irregular edges, drifting as one on env.aloft; ?cloudfield=0 the old two layers through a warp),
// sampled at the centre of the ground texel under the pixel (1 texel = 1 / PPM m, on the ground plane h 0: viewTexel). The
// drift is in whole texels (depth.js rounds it before core/cloudfield.js fieldUniforms; the old field's uClD, uClW), so an
// edge moves texel by texel, never shimmering.
// THE SHADOW (the smooth field; the user chose it from mock-ups, 2026-10-10): cloudAt().x is the cloud's SHARE, 0..1: a SOFT
// EDGE SOFT.pen m either side of the cover's threshold (uClT.x, from the field's quantiles: coverQ, any cover, continuous), the
// same width everywhere (the m into the cloud: (density - threshold) / its slope, cfField's), then THICKER inward: SOFT.edge
// at the edge, full SOFT.full of density in, thinner in the thin patches (SOFT.thin of it, cfField's 24 m noise). A cloud
// takes cloudBlock() of the sun (x uCl.z: features/depth.js TUNE.clouds.sun) and lets cloudSunLv() through (render/godrays.js).
// THE LEVELS (?cloudfield=0, the old field): a texel at or above the EDGE threshold is cloud (level 1), at or above the CORE
// threshold thick cloud (level 2), cloudBlock() uCl.y / uCl.z of the sun; cloudSunLv() .5 / 0.
// THE DECK (env.deck, only while the weather changes): where the field is over the deck's threshold the ground is UNDER it
// (lit by env.under's light, no sun), a thin rim below that half under, the rest OPEN (env.open's light, the sun and its
// cloud shadows). Mode 1: one threshold everywhere (a breakup: the deck's cover falls, gaps open at the field's thinnest places
// and grow; a front's settling). Mode 2: a front: the deck's cover is the share behind its edge (u: m ahead of it, two bends
// across its way), so its wall is torn by the field, and the clear side's clouds thicken toward it (uClT.zw within uFrE.w m).
//   cloudAt(view px, world P) -> vec3(the share 0..1 (old: level 0 / 1 / 2; 0 under the deck), under 0 / .5 / 1 (ABSOLUTE: 0
//   lit by env.open, 1 by env.under), sun through the deck 1 / .5 / 0)   (uCl.x > .5: clouds on this frame; off: nothing under)
// The sun reaching a point is .z x cloudSunLv() (render/godrays.js sunThrough). P is unused now (the ground under the pixel
// in the view's plane is the field's point); kept for the signature.
//
// ?wxtrans=0: the OLD field (a 40 x 30 m noise tile in tTop's first rows, fixed quantiles, a front's storm torn from the same
// tile by stormQ); .y is ABSOLUTE there too (depth.js premultiplies the old composite's storm look by the light's share).
import {flags} from '../core/flags.js';
import {FIELD_GLSL, QUANT, FIELD_V2} from '../core/cloudfield.js';
export const OLD_CLOUDS = flags.get('wxtrans') === '0';
// CLOUD_SUN (?cloudsun=0: the old tint): a cloud shadow is the sun taken away, not a colour laid over the ground. The composite
// (gfx.js COMP_FS) reads the level where the sun's ray to the point meets the field's plane (cloudSunAt: a prop, a tree's crown
// and a wall's face meet the edge before the ground at their foot does) and merges it with the cast shadow: the sun's share
// left is (1 - cast) x (1 - cloud), so the coloured shade (render/lighting.js SHADE) is the one look of both, a tree's shadow
// fades into a cloud's instead of doubling it, and the crests and glints go out under it. uCl.y / .z are then the share of the
// sun the edge / core levels take (features/depth.js TUNE.clouds.sun), not alphas. (The cinema camera keeps the old tint)
export const CLOUD_SUN = !OLD_CLOUDS && flags.get('cloudsun') !== '0';
// CLOUD_VIEW (the smooth field; ?cloudmap=1: the shapes): no cloud shadow lies on the ground as a shape. The user (2026-10-10)
// didn't want an edge sweeping across the view: a cloud passing over DIMS THE WHOLE VIEW and the sun comes back as it goes, the
// way it feels standing in a field. cloudAt().x is then the view's share for every point (uCl.w: features/depth.js measures it
// round the player, eased); the field per pixel only for a deck (a weather change's front and breakup still roll over)
export const CLOUD_VIEW = FIELD_V2 && flags.get('cloudmap') !== '1';
// the uniforms past the old set (all vec4; gfx.js makes them and setClouds copies o.u[name] into them; godrays.js shares them)
export const CLOUD_EXTRA = ['uClD', 'uClW', 'uDk', 'uFrE', 'uClQa', 'uClQb', 'uClQc', 'uCfA', 'uCfB', 'uCfC', 'uCfD'];   // (uCf*: the smooth field's offsets)
// the smooth field's shadow (THE SHADOW above): m either side of the threshold the edge fades over; the share at the edge; the
// density in from the threshold where it is full; how much thinner the thin patches are
export const SOFT = {pen: 1.25, edge: .72, full: .1, thin: .2};
// the field's quantile table as those uniforms' values (constant: depth.js sends them with the rest)
export const QUANT_U = [Array.from(QUANT.subarray(0, 4)), Array.from(QUANT.subarray(4, 8)), [...QUANT.subarray(8, 11), 0]];

// the two levels' sun taken / let through (the old fields)
const LEVELS = `float cloudBlock(vec3 c) { return c.x > 1.5 ? uCl.z : c.x > .5 ? uCl.y : 0.; }
float cloudSunLv(vec3 c) { return c.x > 1.5 ? 0. : c.x > .5 ? .5 : 1.; }`;
// cloudAt's end: the smooth field's share (THE SHADOW above), or the old field's levels
const F3 = v => v.toFixed(4);
const VIEW_GLSL = `  if (uDk.x > .5) { float d = cfDensity(g, uClD, uClW.xy); y = d >= q ? 1. : d >= q - uDk.z ? .5 : 0.; }
  return vec3(y > .75 ? 0. : uCl.w, y, 1. - y);   // (CLOUD_VIEW: the view's share, everywhere)
}
float cloudBlock(vec3 c) { return c.x * uCl.z; }
float cloudSunLv(vec3 c) { return 1. - c.x; }`;
const SHARE_GLSL = `  vec4 F = cfField(g); float d = F.x, e = d - th.x;
  if (uDk.x > .5) y = d >= q ? 1. : d >= q - uDk.z ? .5 : 0.;
  // the share: the soft edge (m into the cloud: e over the slope), thicker inward, thinner in the thin patches
  float c = smoothstep(${F3(-SOFT.pen)}, ${F3(SOFT.pen)}, e / max(length(F.yz), 1e-5)) * (${F3(SOFT.edge)} + ${F3(1 - SOFT.edge)} * smoothstep(0., ${F3(SOFT.full)}, e) * (${F3(1 - SOFT.thin)} + ${F3(SOFT.thin)} * F.w));
  return vec3(y > .75 ? 0. : c, y, 1. - y);
}
float cloudBlock(vec3 c) { return c.x * uCl.z; }   // the sun the cloud takes (x the deck's open share: the caller)
float cloudSunLv(vec3 c) { return 1. - c.x; }      // the sun it lets through (x .z: the caller)`;
const LEVEL_GLSL = `  float d = cfDensity(g, uClD, uClW.xy);
  if (uDk.x > .5) y = d >= q ? 1. : d >= q - uDk.z ? .5 : 0.;
  return vec3(y > .75 ? 0. : d >= th.y ? 2. : d >= th.x ? 1. : 0., y, 1. - y);
}
${LEVELS}`;
const UNIFORMS = `
uniform sampler2D tTop;
uniform vec4 uCl, uClM, uClO; uniform vec3 uClC;   // on, the two levels' shares (the smooth field: .z its most), (CLOUD_VIEW) the view's share; view -> texel (2x2); the world origin (view px), (old: tile size); colour
uniform vec4 uClT;   // the levels' thresholds (density): edge, core; the same at a front's edge (its approach)
uniform vec4 uFr;    // a front: its way (x, y: unit, on the ground: world x, z), the edge's place along it (m), (old: on)
uniform vec4 uFrB;   // its change behind / ahead of the edge (m), its first bend (m), the bend's wave number (rad / m)
uniform vec4 uFrK;   // (the old composite's storm look) the view's share under it, 1 arriving, grey, darkening
uniform vec4 uFrC;   // the storm's grey (rgb), the first bend's phase
uniform vec4 uFrS;   // (the old composite) the sun's shaping of meshes under the deck
uniform vec4 uFrQ;   // (old) the tile's quantiles
uniform vec4 uClD;   // (the old field) the drift (m, whole texels): layer A (x, y), layer B (x, y)
uniform vec4 uClW;   // (the old field) the warp's drift (m, whole texels), -; texels per m
uniform vec4 uDk;    // the deck: mode (0 none, 1 everywhere, 2 behind a front's edge), its threshold (mode 1), the rim (density)
uniform vec4 uFrE;   // a front's second bend: amplitude (m), wave number (rad / m), phase; the approach (m)
uniform vec4 uClQa, uClQb, uClQc;   // the field's quantiles (core/cloudfield.js QUANT)
ivec2 viewTexel(ivec2 p, vec4 M, vec2 o) {   // view pixel p (GL, y up) -> the top-down map's texel (the pattern's nearest sample)
  vec2 c = vec2(float(p.x) + .5, uRes.y - float(p.y) - .5) - o;
  return ivec2(floor(vec2(M.x * c.x + M.y * c.y, M.z * c.x + M.w * c.y)));
}`;

const NEW_GLSL = `${UNIFORMS}
${FIELD_GLSL}
float clQ(int i) { return i < 4 ? uClQa[i] : i < 8 ? uClQb[i - 4] : uClQc[i - 8]; }
// the density above which the share f of the ground lies (core/cloudfield.js coverQ: its table crowds toward the ends)
float coverQ(float f) { float x = acos(1. - 2. * clamp(f, 0., 1.)) * ${(10 / Math.PI).toFixed(7)}; int i = min(int(x), 9); return mix(clQ(i), clQ(i + 1), x - float(i)); }
// m ahead of a front's edge at the ground point g (downwind), its two bends across the way
float frontU(vec2 g) {
  float a = dot(g, vec2(-uFr.y, uFr.x));
  return dot(g, uFr.xy) - uFr.z + uFrB.z * sin(a * uFrB.w + uFrC.w) + uFrE.x * sin(a * uFrE.y + uFrE.z);
}
vec3 cloudAt(ivec2 ip, vec3 P) {
  vec2 g = (vec2(viewTexel(ip, uClM, uClO.xy)) + .5) / uClW.w;
  vec2 th = uClT.xy; float q = 0., y = 0.;
  if (uDk.x > .5) {
    q = uDk.y;
    if (uDk.x > 1.5) { float u = frontU(g); q = coverQ(1. - smoothstep(-uFrB.x, uFrB.y, u)); th = mix(uClT.xy, uClT.zw, 1. - smoothstep(0., uFrE.w, u)); }
  }
${CLOUD_VIEW ? VIEW_GLSL : FIELD_V2 ? SHARE_GLSL : LEVEL_GLSL}
`;

// ?wxtrans=0: the old tile and its quantiles (.y absolute: the storm's mask)
const OLD_GLSL = `${UNIFORMS}
// the weather behind a front's edge: its share at the ground point g (0 well ahead of the edge .. 1 well behind it)
float frontBehind(vec2 g) {
  float u = dot(g, uFr.xy) - uFr.z + uFrB.z * sin(dot(g, vec2(-uFr.y, uFr.x)) * uFrB.w + uFrC.w);
  return 1. - smoothstep(-uFrB.x, uFrB.y, u);
}
// the bin above which f of the tile lies (the quantiles, linear between them): f = 0 none, 1 all
float stormQ(float f) {
  if (f <= 0.) return 1025.; if (f >= 1.) return 0.;
  float x = f * 5., k = fract(x);
  return x < 1. ? mix(1024., uFrQ.x, k) : x < 2. ? mix(uFrQ.x, uFrQ.y, k) : x < 3. ? mix(uFrQ.y, uFrQ.z, k) : x < 4. ? mix(uFrQ.z, uFrQ.w, k) : mix(uFrQ.w, 0., k);
}
vec3 cloudAt(ivec2 ip, vec3 P) {
  ivec2 t = ivec2(mod(vec2(viewTexel(ip, uClM, uClO.xy)), uClO.zw));   // (the tile repeats: mod, never negative)
  float n = floor(texelFetch(tTop, t, 0).r * 255. + .5) * 4. + floor(texelFetch(tTop, t + ivec2(0, int(uClO.w)), 0).r * 255. + .5);
  float b = uFr.w > .5 ? frontBehind(P.xz) : 0.;
  float L = n >= mix(uClT.y, uClT.w, b) ? 2. : n >= mix(uClT.x, uClT.z, b) ? 1. : 0.;
  if (uFr.w < .5) return vec3(L, 0., 1.);
  float st = uFrK.y > .5 ? b : 1. - b, q = stormQ(st);   // the storm's share here, the noise above which it covers
  // (wx-A shim: B owns this file) .y = the ABSOLUTE under share (0: lit by env.open's light, 1: by env.under's: gfx.js COMP_FS
  // mixes the two lights by it), no longer x (1 - uFrK.x); ?wxlight=0's old fake takes that factor in the composite
  return vec3(L, n >= q ? 1. : n >= stormQ(st * 1.3) ? .5 : 0., n >= q ? 0. : 1.);
}
${LEVELS}
`;
export const CLOUD_GLSL = (CLOUD_SUN ? '#define CL_SUN\n' : '') + (OLD_CLOUDS ? OLD_GLSL : NEW_GLSL);
