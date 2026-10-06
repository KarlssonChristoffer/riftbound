// CLOUDS: the cloud shadows on the ground and a weather FRONT's storm side (sim/env.js FRONTS), as GLSL shared by the
// composite (gfx.js COMP_FS: they darken the picture) and the god rays (render/godrays.js SHAPE_FS: no beam where the sun is
// clouded over). features/depth.js sets the uniforms every frame it shows them (G.setClouds); gfx.js owns them (compU).
//
// THE LEVELS. tTop's first rows hold the cloud noise (a 40 x 30 m tile, 1 texel = 1 / PPM m, fixed to the ground plane and
// drifting with the wind): each texel's value as a bin 0..1023 of the field's histogram, in two planes (rows 0.. the bin / 4,
// the next TH rows the bin's last 2 bits: tTop is a byte texture). A texel at or above the EDGE threshold is cloud (level 1),
// at or above the CORE threshold thick cloud (level 2); the thresholds are the bins that cover the wanted fraction of the
// tile (depth.js cloudLevels), so the levels are exactly the old CPU-thresholded map's when the cover is the same everywhere.
// A FRONT makes the cover vary over the ground: the thresholds go from the side ahead of the edge's (uClT.xy) to the side
// behind it's (uClT.zw) across its band, so the clouds thicken (or break up) toward the storm. The storm side is darker still
// than its clouds (the view is lit by the clear side's light while that shows, env.light), cut from the same noise: where the
// storm has share f, the f of the tile with the highest noise is storm (full) and a rim round it half (stormQ: the field's
// quantiles), so a storm thins by tearing into holes of sun that grow and drift with the clouds, and thickens by closing
// them. How DARK a storm patch is drawn: the part of the storm the light doesn't already carry (1 - uFrK.x: all of it while
// the clear light holds, fading as the light crosses over to the storm's). The SUN reaches the ground in the holes only: the
// god rays shine there.
//   cloudAt(view px, world P) -> vec3(level 0 / 1 / 2, dark 0 / .5 / 1, sun 0 / 1)   (uCl.x > .5: clouds on this frame)
export const CLOUD_GLSL = `
uniform sampler2D tTop;
uniform vec4 uCl, uClM, uClO; uniform vec3 uClC;   // clouds: on, the two alphas; view -> texel (2x2); origin (view px), tile size; colour
uniform vec4 uClT;   // the thresholds (noise bins): edge, core ahead of a front (or everywhere without one); edge, core behind it
uniform vec4 uFr;    // a front: its way (x, y: unit, on the ground: world x, z), the edge's place along it (m), on
uniform vec4 uFrB;   // its change behind / ahead of the edge (m), the edge's bend (m), the bend's wave number (rad / m)
uniform vec4 uFrK;   // the light's storm share (env.front.storm), 1: the storm is behind the edge (arriving), grey, darkening
uniform vec4 uFrC;   // the storm's grey (rgb), the bend's phase
uniform vec4 uFrS;   // the sun's shaping of meshes under the full storm (x its own: COMP_FS's form)
uniform vec4 uFrQ;   // the noise's quantiles: the bins above which .2, .4, .6, .8 of the tile lie
ivec2 viewTexel(ivec2 p, vec4 M, vec2 o) {   // view pixel p (GL, y up) -> the top-down map's texel (the pattern's nearest sample)
  vec2 c = vec2(float(p.x) + .5, uRes.y - float(p.y) - .5) - o;
  return ivec2(floor(vec2(M.x * c.x + M.y * c.y, M.z * c.x + M.w * c.y)));
}
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
  return vec3(L, (n >= q ? 1. : n >= stormQ(st * 1.3) ? .5 : 0.) * (1. - uFrK.x), n >= q ? 0. : 1.);
}
`;
