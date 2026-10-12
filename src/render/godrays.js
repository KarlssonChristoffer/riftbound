// GOD RAYS: real sunbeams out of the sun's shadow maps (t3ssel8r's "God Rays in 3D Pixel Art Game Engine": sample the light
// space depth map at world positions on a series of parallel planes aligned with the light direction and add light where a
// plane point in front of the scene is lit; David Holland's Godot recreation does it as ONE full-screen pass that marches
// those planes in the shader). Here: a full-screen march at ART resolution into a level target, cleaned into bold shapes (THE
// SHAPE, below) and added into the pixel image right after the composite (gfx.js outRT, or the canvas when there is no blit),
// before it is blown up: the beams are whole art pixels.
//
// THE MARCH. Every pixel's view ray is a fixed line in the world (the projection is oblique: all rays parallel; the camera
// target snaps to the art-pixel lattice). Its samples are where it crosses a stack of PLANES FIXED IN THE WORLD, n . X = k dn,
// from the pixel's surface up through TUNE.band m of air. The planes CONTAIN THE SUN'S DIRECTION s and face the camera as
// squarely as that allows (n = V - (V . s) s): a beam (a tube of light along s) cuts each plane in a strip along s, so the
// slices of a beam line up into a band with straight edges (horizontal planes cut it into offset slices: a sawtooth). A sample
// is a world point, not a step in screen or view space: panning moves the beams with the ground pixel for pixel and nothing
// crawls (a turn of the camera or the sun turns the planes). The light-space position of a sample is linear along the ray:
// two matrix products a pixel, then an add per plane.
// WHICH AIR GLOWS. Lit air in the open is everywhere (adding it would only lift the whole picture like fog). What reads as a
// sunbeam is lit air with shadow round it: light that came through an opening. A sample counts when it is lit (neither shadow
// map has anything between it and the sun) and there is shadow on BOTH sides of it across the sun (the light camera's x:
// horizontal), within TUNE.reach m and at least TUNE.margin m nearer the sun than it: a hole in a crown, the slot between two
// pillars or trunks, an arch, the space under an awning. Not the open meadow, nor the air beside a lone pillar's shadow, nor
// the slabs of light hugging low things' shadows (the margin: a shaft starts a metre down-sun of its opening). Only SOLID
// things make an opening: a min map block counts where its nearest layer (TUNE.layer m deep) fills TUNE.solid of it (leaf
// clumps, walls, pillars, trunks), not where a few thin things cross it (bare branches, poles, ropes: their slivers of light
// read as spotlights). An opening in what MOVES (the per-frame map: the trees) counts only under a dense canopy: the share of
// the ground the trees shade round the sample, seen from the sun (TUNE.dense: over its m), must be high, so a gap in a full
// crown makes a shaft and the slot between two branches of a bare tree doesn't (walls, pillars and arches, the static map,
// need no canopy). And a sample counts LESS the further it lies below its opening (the nearest of its side shadows' things,
// a crown's top): fully within TUNE.len[0] m, nothing TUNE.len[1] m further down-sun, so a shaft hangs under its crown and
// fades out instead of streaking across the ground (at a low sun a beam from a 4 m crown runs 15 m to the ground). The sun
// reaching a sample is what the clouds let through where its sun ray meets the ground (render/clouds.js: a cloud shadow half
// or all of it, a front's storm all of it): a clouded light patch dims its own beam, along the beam, not across the picture.
// THE GAPS (TUNE.gap, ?gapbeams=0): the sun breaking through a broken sky. Air lit THROUGH A CLOUD GAP glows too: a sample
// whose sun ray meets the ground (h 0) in sun (render/clouds.js cloudAt: the cloud level, a front's storm; as sunThrough)
// while there is cloud within TUNE.gap.reach m of that point on BOTH sides across the sun: a column of lit air with shade
// beside it, leaning from its sun patch toward the sun (on screen a band from the patch toward the sun, edges along the
// sun's direction like a shaft's). A gap wider than about twice the reach makes none (the slab it would make reads as lit
// ground, not air). It is SEEN only against darker ground: the sun on its way must beat the ground the pixel shows (cloudAt
// there), so nothing shows over a sun patch itself and the beam hangs over the shade beside it. Subtler than a shaft: not a
// count of samples but the beam's ROOT, the lowest lit sample over the pixel, by its height (TUNE.gap.fade): TUNE.gap.lv m
// of glowing air at its foot (level 2, never the top level by itself), stepping down to level 1 and out along its length
// (higher air is further from the patch: no hard end where the band stops), and only where the shadow maps light it too (a
// pillar's shadow cuts it). It adds into the same count (history, levels, shape, colour, strength). The GAP MAP (GAP_FS) holds
// the test for the ground under each view px of the view and its margin down-sun (as many texels as the view), so the march
// reads one byte a sample, every few planes (TUNE.gap.step m of ground apart; the phase turns frame to frame). Only while the
// sky is broken (In.broken from render/lighting.js, env.broken; without it the view's cloud TUNE.gap.cloud or a front) and
// the cloud shadows are on: on a clear or steady sky its uniform is 0, the map isn't drawn and nothing of it runs.
// THE TIME. A pixel's count of glowing samples is a coarse thing: which planes fall inside a beam is a matter of phase, so a
// beam's edge gains or loses a sample whenever the planes or the beam shift a hair (the sun turning, a crown's leaves
// fluttering in the wind), and cut into hard levels that flickered (hundreds of px a frame). So the count is SMOOTHED over the
// last frames (TUNE.tau) in a history that follows the view (a pan moves the picture by whole art px: the history is read at
// the point's place last frame; where the depth there doesn't match, something moved in front: it starts over), the planes
// are shifted by a different fraction of their spacing every frame (TUNE.jitter: the history averages the phases out, so it
// holds metres of lit air, not one phase's luck; a step of the sun's direction changes nothing much), and a level changes
// only when the smoothed count is TUNE.hyst samples past its threshold (no pixel flickering on a threshold). A beam that
// moves (a crown leaning in a gust) follows within ~tau; a turn of the camera or a zoom finds the points' places the same way.
// THE LOOK. The glowing samples (metres of beam the ray passes through) are cut into 3 hard levels (TUNE.lv), cleaned on screen
// (no beam under 3 px across, no crumbs, the top level only in a shaft's core) and drawn as flat amounts (TUNE.amt) of the
// sun's colour, warmed, and turned to amber as the sun sinks (TUNE.warm / gold). Bold, few, hard-edged; no gradients, no noise.
// STRENGTH (render/lighting.js, every frame through G.setRays: the mood and the world clock's sky): a low sun is stronger
// (morning, dusk), clouds take the beams away (overcast: none), mist makes them stronger, and looking toward the sun (forward
// scattering) they are strongest. Off at night (no sun shadow map then), with the shadows off (opt.shadows) and with ?godrays=0.
// THE ENVELOPE (set(), ?rayenv=0: the old formula): a change of the weather tells the story of the sun breaking through. The
// beams' share of the sun is the share of the view's ground it reaches (env.sunView; without one, from the view's cloud as
// before), not the view's one swapped light. On top of the day's strength, a BREAKTHROUGH boost: strongest while the sky over
// the view is broken (env.broken; without one, an estimate from a front's edge crossing the view), the sun is breaking
// through it (its share rising: not a deck closing in, not a steady sky's gaps) and the air is moist (rain on the ground,
// mist, fog); and a little for wet ground on its own (TUNE.wetX: at most 1.15x a dry day's for the minutes the ground stays
// wet; it was 1.5x). Both follow in TIME, on the frame's clock (held in a still photo): the beams GROW in over ~TUNE.rise s
// as the sun breaks through, never pop, and fade over ~TUNE.fall s when a deck covers it; the boost swells over ~TUNE.swell s
// and EBBS over ~TUNE.ebb s as the sky clears and the air dries. A steady day (no change, dry ground) is exactly the old
// formula; a preview (photo mode) shows its weather at once and leaves the smoothed state alone; a frame gap moves it at most
// TUNE.dtMax s. rays.env holds the parts (dev/wxpanel.js shows them), rays.rate the envelope's time scale (the panel sets it to
// the game speed).
// SPEED. Most air is open: the MIN MAPS (below) answer "is anything between the sun and the air round this point" in one fetch
// per shadow map (first for a run of 4 planes, then per plane), and each side test in one fetch per map; only a lit sample
// with something round it pays for the side tests. The shape passes are a few fetches of a byte a pixel.
// OWNS: its passes (materials, uniforms, the min map targets, the history), TUNE, the strength. READS: gfx.js compU's G-buffer depth, both
// sun shadow maps and their matrices (shared uniform objects, never written), uShadowA / uShadowOn (is there a sun shadow
// this frame), uView (the yaw), uSunDir. No allocation per frame, no CPU pixel work.
// BUDGET (GPU): ~0.16-0.23 ms at 688 x 288 (3440 x 1440 at scale 5) on the RTX 4070 (min maps ~.02, shape ~.02, the march);
// CPU: a few uniforms, 15 small draws (the static map's 5 more when it was re-rendered). The programs compile at load.
// THE GAPS, while on: ~.03 ms more (the gap map, a cloudAt a pixel over clouded ground, a byte a gap sample), one more draw.
// The sun's direction the maps are cast along turns in steps (gfx.js setSun: SUN_STEP), not a hair every frame.
//   const rays = createGodrays({THREE, renderer, raw, tri, cam, compU}); rays.draw() right after the composite, into the
//   same target; rays.restatic() when the static shadow map was re-rendered; rays.set(o) the strength inputs; rays.enabled
//   (features/depth.js: its painted shafts step aside); rays.TUNE (live); rays.env (the envelope's parts, read-only);
//   rays.rate (the envelope's time scale: 1)
import {flags} from '../core/flags.js';
import {CLOUD_GLSL, CLOUD_EXTRA} from './clouds.js';   // (wx-B shim: CLOUD_EXTRA)

export const TUNE = {
  on: flags.get('godrays') !== '0',
  band: 6,          // m of air over each pixel's surface that the march covers
  dn: 1 / 12,       // m between the planes (a beam thinner than this across them breaks into strips: at 1/8 the thin beams read as rain)
  planes: 128,      // at most this many a pixel (the shader's loops: 32 runs of 4)
  reach: .7,        // m: how far to each side of a lit sample the shadows round an opening may be (a shaft up to twice that wide)
  lv: [.3, .7, 1.5],           // m of glowing air along the view ray for levels 1, 2, 3 (a sliver .. a thin beam .. a wide one)
  amt: [.08, .16, .3],       // light added per level, x the sun's colour (warmed) x strength: a clear first step, a glowing core
  warm: 1.15,       // the sun's colour to this power: a little warmer than the light it casts (noon's white barely moves)
  gold: [1, .66, .22], goldK: .85, goldEl: [15, 50],   // and toward gold as the sun sinks (full below goldEl[0], none above [1]):
                    // dust in low sunlight glows amber, not the sun's pink-orange (which over the violet dusk stone reads mauve)
  bias: .00005,     // light depth (the per-frame map's units, ~1 cm) a sample must lie behind the stored depth to be in shadow
  margin: 1,        // m: what makes the shadow round an opening must lie this much nearer the sun than the sample (a shaft
                    // starts a metre down-sun of its opening: no slabs of light hugging low things' shadows)
  k: 1.2,           // overall strength
  el: [16, 55, .3], // the sun's elevation (deg): full below el[0], x el[2] above el[1] (noon: faint)
  view: [.5, 1],    // looking away from the sun .. toward it
  cloud: [.4, .82], // the beams fade out between these cloud covers (sim/env.js light.cloud: the view's sky); each sample's sun
                    // is what the clouds let through on its ray (render/clouds.js: none under thick cloud or a storm, half under thin)
  shadow: .3,       // the mood's shadow strength (clouds and the dusk -> night fade already in it) at which the beams are full
  mist: .8, wet: .5,   // more in mist (sky.fog) and on wet ground (after rain): x (1 + mist x fog + wet x wet) (wet: ?rayenv=0 only)
  max: 1.8,
  // THE ENVELOPE (STRENGTH, above; ?rayenv=0: the old formula, no time)
  env: flags.get('rayenv') !== '0',
  wetX: .15,        // wet ground alone: x (1 + wetX x wet) over a dry day's (after rain on a clear sky: 1.15x at most)
  burst: 1,         // the breakthrough: x (1 + burst x broken x moist x breaking) while the sun breaks through a broken sky in moist air
  breaking: .1,     // the sun's share (0..1) rising this far ahead of the beams' (they lag a rise): fully breaking through
  moist: 2,         // how moist the air is: the ground's wetness, or this x the mist / fog (a misty dawn: ~.6)
  rise: 10, fall: 6,   // s: the sun's share in the beams grows in as the sun breaks through / fades as a deck covers it
  swell: 6, ebb: 30,   // s: the boost swells as the sky breaks / ebbs as it clears and the air dries
  dtMax: .1,        // s: the most a frame moves the envelope (a stall, a hidden tab: no jump)
  edge: 36,         // m: without env.broken, a front's edge this near the view's middle breaks the sky over it (most at 0)
  solid: .45, layer: 1.5,   // a min map block makes an opening where its nearest layer (this many m deep) fills this share of it
  len: [4, 6],      // m below its opening (the nearest thing round it, up-sun) a sample counts fully, then fades to nothing over
  dense: [.4, .65, .8],   // a tree opening: the canopy's share round it from nothing .. full count, over this many m (radius)
  tau: .3,          // s: the count is smoothed over about this long (THE TIME): flutter and the planes' phase average out
  hyst: .7,         // samples: a level comes on this much past its threshold and goes this much below it
  jitter: true,     // the planes shifted by a new fraction of their spacing every frame (the history averages the phases)
  dtol: .25,        // m: a pixel's depth may differ this much from its place last frame and still be the same surface
  // THE GAPS: beams through the cloud gaps (header)
  gap: {on: flags.get('gapbeams') !== '0',
    reach: 2,       // m: the cloud must lie within this, across the sun, on both sides of a sample's sun-ray ground point (a beam
                    // is at most about this wide: a wider gap makes no beam, the slab it would make reads as lit ground, not air)
    lv: 1,          // m of glowing air (lv's units) a beam counts as at its root: level 2 there, never the top level by itself
    fade: [0, 6],   // m over the surface: a beam's root counts fully at fade[0], nothing at fade[1] (it steps down along its length)
    step: .4,       // m between the gap samples' sun-ray ground points (the stride in planes follows the sun: 2..8)
    over: 3,        // m: the gap map's margin covers samples this high over the ground plus the band (higher ones see no gap)
    res: 1,         // the gap map's texels per view px (it covers the view and its margin: a little coarser than the view)
    edge: .25,      // the sun (cloudAt .z x the level's) a beam's air must have over its sides' ground and the ground behind it
    broken: [.15, .5],   // on with env.broken (render/lighting.js -> set(): In.broken) from nothing .. full;
    cloud: [.35, .5]},   // without it: with the view's cloud (In.cloud) from nothing .. full, or a front (full)
};

const VS = `precision highp float; precision highp int;\nin vec3 position; void main() { gl_Position = vec4(position.xy, 0., 1.); }`;
const FS = `precision highp float; precision highp int;
uniform sampler2D tD, tS, tSS;
uniform sampler2D tNS, tNSS;   // the min maps, NEAR: anything between the sun and the air within reach (+ a block) of a texel
uniform sampler2D tCS, tCSS;   // COARSE: NEAR one block wider, round a run of 4 planes (a sample moves dn across the sun a plane)
uniform sampler2D tXS, tXSS;   // SIDE across: the same along the light's x only within half the reach, looked up to one side
uniform mat4 uInvPV, uLightPV, uLightPVS;
uniform float uSBias, uSOn;
uniform vec2 uRes;
uniform vec4 uBand;      // dn (m between planes), max planes, bias (per-frame map depth units), (unused)
uniform vec4 uPn;        // the planes' normal (world, unit, n . V > 0), band (m of air over the surface)
uniform vec4 uSide;      // uv from a sample to its side windows across the sun: per-frame map (x), static map (z)
uniform float uMargin;   // light depth (per-frame map units) something in a side window must lie nearer the sun than the sample
uniform vec4 uMinOff;    // uv from a map's texel grid to its min map's blocks (fixed in the world: below): per-frame x, y; static x, y
uniform vec3 uLv;        // glowing samples for levels 1, 2, 3
uniform sampler2D tH;    // THE TIME: last frame's history (the smoothed count, the level, the depth)
uniform vec4 uHist;      // this frame's weight in it (1 - exp(-dt / tau)), the hysteresis (samples), depth tolerance, 1: start over
uniform mat4 uPrevPV;    // last frame's projection (this pixel's point there: its place and depth then)
uniform vec4 uDM;        // m per light depth unit: the per-frame map, the static map; full below an opening (m), the fade after (m)
uniform vec3 uSun;       // toward the sun the maps are cast along (unit, world)
uniform mat4 uPV;        // this frame's projection (a sample's sun ray's ground point -> its view px: the cloud shadow there)
out vec4 oc;             // the history: the smoothed count, the level (0 none, 1..3: the morphology below reads it), the depth
vec3 worldAt(ivec2 p, float d) { vec2 ndc = (vec2(p) + .5) / uRes * 2. - 1.; vec4 w = uInvPV * vec4(ndc, d * 2. - 1., 1.); return w.xyz / w.w; }
// something nearer the sun than the sample in map m at the sample's uv + o (c: the sample in light NDC): the per-frame map (round
// the view: what moves), the static one (the world: what doesn't), as gfx.js sunShadow; the min maps take the same test
bool occS(sampler2D m, vec3 c, vec2 o, float bias) { vec3 s = c * .5 + .5; s.xy += o; return all(greaterThanEqual(s.xy, vec2(0.))) && all(lessThanEqual(s.xy, vec2(1.))) && s.z - bias > textureLod(m, s.xy, 0.).r; }
bool occSS(sampler2D m, vec3 c, vec2 o, float bias) { vec3 s = c * .5 + .5; s.xy += o; return uSOn > .5 && all(greaterThanEqual(s.xy, vec2(0.))) && all(lessThanEqual(s.xy, vec2(1.))) && s.z - bias * uSBias > textureLod(m, s.xy, 0.).r; }
// a side window (both maps): shadow there, clearly nearer the sun than the sample (the margin: the ground, which casts into the
// static map, comes nearer the sun across a block; a window is one block thick, so only the lowest few cm see it)
uniform float uMarginM;   // the margin (m)
uniform sampler2D tDen; uniform vec2 uDense;   // the trees' canopy share round a point (per-frame map blocks), the gate's ramp
// how far up-sun (m) the nearest thing in a side window is, in either map, if at least the margin (1e4: nothing there)
float occD(sampler2D m, vec3 c, vec2 o, float mpu) { vec3 s = c * .5 + .5; s.xy += o; if (any(lessThan(s.xy, vec2(0.))) || any(greaterThan(s.xy, vec2(1.)))) return 1e4; float d = (s.z - textureLod(m, s.xy, 0.).r) * mpu; return d >= uMarginM ? d : 1e4; }
vec2 sideD(sampler2D mS, sampler2D mSS, vec3 a, vec3 b, vec2 oa, vec2 ob) { return vec2(occD(mS, a, oa + uMinOff.xy, uDM.x), uSOn > .5 ? occD(mSS, b, ob + uMinOff.zw, uDM.y) : 1e4); }   // (per-frame, static)
${CLOUD_GLSL}
// the sun the clouds let through to X: the cloud shadow / a front's storm where X's sun ray meets the ground (render/clouds.js)
float sunThrough(vec3 X) {
  if (uCl.x < .5) return 1.;
  vec3 G = X - uSun * (X.y / uSun.y);
  vec4 c = uPV * vec4(G, 1.);
  vec3 cl = cloudAt(ivec2(floor((c.xy / c.w * .5 + .5) * uRes)), G);
  return cloudSunLv(cl) * cl.z;
}
// THE GAPS: the gap map (GAP_FS below: the sun through a gap at the ground under each of its texels) and how to read it
uniform sampler2D tGap;
uniform vec4 uGap;    // the count at a beam's root (samples; 0: off), the side reach (m), the stride (planes), the sun step
uniform vec4 uGapF;   // the fade up the band: full below x m over the surface, none y m higher; w: this frame's phase (planes)
uniform vec4 uGM;     // the gap map: the view px of its corner, view px per texel (x, y)
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy);
  float d = texelFetch(tD, ip, 0).r;
  if (d > .99999) { oc = vec4(0., 0., d, 0.); return; }   // nothing there (beyond the world)
  // the view ray, toward the viewer (the projection is affine: NDC z maps to one world direction), crossing the planes over
  // this pixel's surface, up through uPn.w m of air: the first crossing and the step from plane to plane, in the world and
  // in both light spaces (orthographic: linear)
  vec3 P = worldAt(ip, d), V = -normalize(uInvPV[2].xyz), n3 = uPn.xyz;
  // (the planes at n . X = (k + uBand.w) dn: this frame's phase)
  float dn = uBand.x, nV = dot(n3, V), t0 = dot(n3, P) / dn - uBand.w, t1 = (dot(n3, P) + uPn.w / V.y * nV) / dn - uBand.w;
  float k0 = floor(t0) + 1.;
  vec3 X0 = P + V * (((k0 + uBand.w) * dn - dot(n3, P)) / nV), dX = V * (dn / nV);
  vec3 a0 = (uLightPV * vec4(X0, 1.)).xyz, da = (uLightPV * vec4(dX, 0.)).xyz;
  vec3 b0 = (uLightPVS * vec4(X0, 1.)).xyz, db = (uLightPVS * vec4(dX, 0.)).xyz;
  vec2 Z = vec2(0.), sxa = vec2(uSide.x, 0.), sxb = vec2(uSide.z, 0.);
  float n = 0.;
  int N = int(min(uBand.y, floor(t1) - floor(t0)));
  bool full = false;
  for (int g = 0; g < 32; g++) {   // runs of 4 planes: a run in open air costs two fetches (the light depth: the run's farthest)
    int kg = g * 4, kl = min(kg + 3, N - 1);
    if (kg >= N || full) break;
    vec3 am = a0 + da * (float(kg + kl) * .5), bm = b0 + db * (float(kg + kl) * .5);
    float za = max(a0.z + da.z * float(kg), a0.z + da.z * float(kl)), zb = max(b0.z + db.z * float(kg), b0.z + db.z * float(kl));
    if (!(occS(tCS, vec3(am.xy, za), uMinOff.xy, uMargin) || occSS(tCSS, vec3(bm.xy, zb), uMinOff.zw, uMargin))) continue;
    for (int j = 0; j < 4; j++) {
      int k = kg + j; if (k >= N) break;
      vec3 a = a0 + da * float(k), b = b0 + db * float(k);
      if (!(occS(tNS, a, uMinOff.xy, uMargin) || occSS(tNSS, b, uMinOff.zw, uMargin))) continue;   // open air: nothing round it in either map
      if (occS(tS, a, Z, uBand.z) || occSS(tSS, b, Z, uBand.z)) continue;        // shadowed air: no light to scatter
      // lit, with shadow close on either side: light through an opening (a shaft), fading below it, as much as the clouds let through
      vec2 sl = sideD(tXS, tXSS, a, b, sxa, sxb), sr = sideD(tXS, tXSS, a, b, -sxa, -sxb);
      float dO = max(min(sl.x, sl.y), min(sr.x, sr.y));
      if (dO < 1e3) {   // (static things on both sides: no canopy needed; else the trees round it must be dense)
        float g = max(sl.y, sr.y) < 1e3 ? 1. : smoothstep(uDense.x, uDense.y, textureLod(tDen, a.xy * .5 + .5 + uMinOff.xy, 0.).r);
        if (g > 0.) n += clamp(1. - (dO - uDM.z) / uDM.w, 0., 1.) * g * sunThrough(X0 + dX * float(k));
      }
      if (n >= uLv.z + 2.) { full = true; break; }   // (past the top level and its hysteresis: nothing more to count)
    }
  }
  // THE GAPS: the lowest air over this pixel lit through a cloud gap (the gap map where its sun ray meets the ground: brighter
  // than the ground both sides of it across the sun, and than the ground this pixel shows: nothing over a sun patch itself),
  // by its height: the beam's root
  if (uGap.x > 0. && uCl.x > .5 && !full) {
    vec3 g = cloudAt(ip, P); float g0 = cloudSunLv(g) * g.z, best = 0.;
    if (g0 < 1.) {
      // a sample's sun-ray ground point (h 0) and its place in the gap map: linear along the ray (the projection is affine)
      vec3 G0 = X0 - uSun * (X0.y / uSun.y), dG = dX - uSun * (dX.y / uSun.y);
      vec2 m0 = (((uPV * vec4(G0, 1.)).xy * .5 + .5) * uRes - uGM.xy) / uGM.zw, dm = (uPV * vec4(dG, 0.)).xy * .5 * uRes / uGM.zw;
      ivec2 msz = textureSize(tGap, 0);
      for (int i = 0; i < 64; i++) {   // (up the band: the fade only falls, so the first lit sample is the root)
        int k = int(uGapF.w) + i * int(uGap.z); if (k >= N) break;
        float f = 1. - clamp((X0.y + dX.y * float(k) - P.y - uGapF.x) / uGapF.y, 0., 1.); if (f <= 0.) break;
        ivec2 t = ivec2(floor(m0 + dm * float(k)));
        if (any(lessThan(t, ivec2(0))) || any(greaterThanEqual(t, msz))) continue;
        if (texelFetch(tGap, t, 0).r <= g0 + uGap.w) continue;   // (no gap, or no brighter than the ground behind)
        if (occS(tS, a0 + da * float(k), Z, uBand.z) || occSS(tSS, b0 + db * float(k), Z, uBand.z)) continue;   // (a thing's shadow)
        best = f; break;
      }
    }
    n += best * uGap.x;
  }
  // THE TIME: blended into the history at this point's place last frame (a pan: whole art px), if the same surface was
  // there (its depth then matches: else something moved in front of it or away, and it starts over)
  float c = n, L0 = -1.;
  vec4 o = uPrevPV * vec4(P, 1.); vec3 pp = o.xyz / o.w * .5 + .5;
  ivec2 q = ivec2(floor(pp.xy * uRes));
  if (uHist.w < .5 && all(greaterThanEqual(q, ivec2(0))) && all(lessThan(q, ivec2(uRes)))) {
    vec4 h = texelFetch(tH, q, 0);
    if (abs(h.z - pp.z) < uHist.z) { c = mix(h.x, n, uHist.x); L0 = h.y; }
  }
  // the level: up only past threshold + hyst, down only below threshold - hyst (a fresh pixel: the plain thresholds)
  vec3 H = vec3(uHist.y);
  float up = dot(step(uLv + H, vec3(c)), vec3(1.)), dw = dot(step(uLv - H, vec3(c)), vec3(1.));
  float L = L0 < 0. ? dot(step(uLv, vec3(c)), vec3(1.)) : clamp(L0, up, dw);
  oc = vec4(c, L, d, 0.);
}`;
// THE SHAPE: the levels are cleaned on screen, in whole art px, by grey-scale morphology along short segments ACROSS the beams
// and ALONG them (the sun's direction as the projection draws it; MORPH_FS: the min (erode) or max (dilate) over a segment of
// 2 r + 1 px). A CLOSE across (a 1-2 px dark seam inside a shaft fills in) and along (a beam the planes broke into dashes joins
// up again), then an OPEN by a rectangle 3 px across x 5 px along: a beam less than 3 px across, or a crumb less than 5 px
// long, vanishes; a wider one keeps its edges; a level shows only where it is that wide (the top level only in a shaft's
// heart). No hairlines, no 1 px stripes, no dashes. 7 passes at art px (the last, a dilate along, draws: SHAPE_FS adds the
// level's colour). The lattice is the screen's art px, which a pan moves whole: the shapes move with the ground unchanged
const SEG = (at = '.r * 4.') => `
float lvAt(sampler2D t, ivec2 q, ivec2 sz) { return texelFetch(t, clamp(q, ivec2(0), sz - 1), 0)${at}; }   // (the edge repeats: a beam leaving the view isn't eroded there)
// the segment: the px at round(dir k), k = -r .. r, and, where it steps diagonally, both corners of the step (a 4-connected,
// point-symmetric line: a purely diagonal one let a pass leave a checkerboard of holes)
float seg(sampler2D t, vec2 dir, int r, bool grow) {
  ivec2 p = ivec2(gl_FragCoord.xy), sz = textureSize(t, 0), pq = ivec2(round(dir * float(-r)));
  float m = lvAt(t, p + pq, sz);
  for (int k = -3; k <= 4; k++) {
    if (k <= -r || k > r) continue;
    ivec2 q = ivec2(round(dir * float(k)));
    float a = lvAt(t, p + q, sz), b = lvAt(t, p + ivec2(q.x, pq.y), sz), c = lvAt(t, p + ivec2(pq.x, q.y), sz);
    m = grow ? max(m, max(a, max(b, c))) : min(m, min(a, min(b, c)));
    pq = q;
  }
  return floor(m + .5);
}`;
const MORPH_FS = at => `precision highp float; precision highp int;
uniform sampler2D tLv; uniform vec2 uDir; uniform int uR; uniform float uGrow; out vec4 oc;${SEG(at)}
void main() { oc = vec4(seg(tLv, uDir, uR, uGrow > .5) / 4., 0., 0., 1.); }`;
const SHAPE_FS = `precision highp float; precision highp int;
uniform sampler2D tLv; uniform vec2 uDir; uniform vec3 uCol[3]; out vec4 oc;${SEG()}
void main() {
  float o = seg(tLv, uDir, 2, true);
  if (o < .5) discard;
  oc = vec4(uCol[int(o) - 1], 0.);
}`;

// THE GAP MAP (THE GAPS): per texel, the ground (h 0) under a view px of the region the samples' sun rays can reach (the view
// and its margin down-sun): the sun the clouds let through there (render/clouds.js cloudAt) if there is cloud within the reach
// on BOTH sides of it across the sun (at the reach or half of it: TUNE.gap.edge less sun), else 0 (sun beside it: no
// column). One fetch a sample in the march instead of six. A byte
const GAP_FS = `precision highp float; precision highp int;
uniform vec2 uRes; uniform mat4 uInvPV, uPV; uniform vec3 uSun; uniform vec4 uGap, uGM; out vec4 oc;
${CLOUD_GLSL}
float sunOf(vec3 c) { return cloudSunLv(c) * c.z; }
float sunAt(vec3 G) { vec4 c = uPV * vec4(G, 1.); return sunOf(cloudAt(ivec2(floor((c.xy / c.w * .5 + .5) * uRes)), G)); }
void main() {
  vec2 p = uGM.xy + gl_FragCoord.xy * uGM.zw, ndc = p / uRes * 2. - 1.;   // (the texel's view px)
  vec4 a = uInvPV * vec4(ndc, -1., 1.), b = uInvPV * vec4(ndc, 1., 1.); a /= a.w; b /= b.w;
  vec3 G = mix(a.xyz, b.xyz, a.y / (a.y - b.y)), sd = normalize(vec3(-uSun.z, 0., uSun.x)) * uGap.y;   // (h 0 there; across the sun)
  float c = sunOf(cloudAt(ivec2(floor(p)), G));
  float e = c - uGap.w;   // (a side is shade with less sun than this)
  if (c > 0. && ((sunAt(G + sd) > e && sunAt(G + sd * .5) > e) || (sunAt(G - sd) > e && sunAt(G - sd * .5) > e))) c = 0.;
  oc = vec4(c, 0., 0., 1.);
}`;

// THE MIN MAPS: each shadow map cut into blocks of RED x RED texels, a block's nearest depth to the sun (REDUCE_FS: where that
// nearest layer, TUNE.layer m deep, fills TUNE.solid of the block; else nothing: thin things make no openings), then spread
// over the neighbouring blocks (DILATE_FS: one axis a pass). SIDE by K blocks along the light's x only (half the reach): a side
// window is looked up K + 1 blocks away, so it starts past the sample's own block (a lit sample just off one shadow's edge
// doesn't find that shadow on both sides) and is one block thick (the ground, which casts into the static map, comes nearer the
// sun down the light's y: it stays out). NEAR is both side windows in one (2K + 1 blocks across, the sample's row); COARSE is
// NEAR a block wider all round (a run of 4 planes moves 4 dn across the sun). The per-frame map's every frame the rays draw (5
// passes at 256 x 256: ~.02 ms), the static map's when it was re-rendered (restatic(): gfx.js calls it). The blocks are FIXED
// IN THE WORLD: the per-frame map moves with the view by whole texels (gfx.js setSun snaps it to the world's texel grid), so
// block b holds texels 8 b - off .. 8 b - off + 7, off following the world origin's texel (else a block's decision would shift
// under a beam as the view pans: it would shimmer)
const RED = 8, KMAX = 16;
const REDUCE_FS = `precision highp float; precision highp int;
uniform sampler2D tIn; uniform ivec2 uOff; uniform vec2 uSolid; out vec4 oc;   // uSolid: the layer's depth (map units), its share
void main() {   // (r: the nearest depth where its layer is solid, else 1; g: the share of the block anything stands in: THE CANOPY)
  ivec2 o = ivec2(gl_FragCoord.xy) * ${RED} - uOff, sz = textureSize(tIn, 0); float m = 1., a = 0., n = 0.;
  for (int y = 0; y < ${RED}; y++) for (int x = 0; x < ${RED}; x++) { float d = texelFetch(tIn, clamp(o + ivec2(x, y), ivec2(0), sz - 1), 0).r; m = min(m, d); a += d < 1. ? 1. : 0.; }
  if (m >= 1.) { oc = vec4(1., 0., 0., 1.); return; }   // (an empty block: most of the per-frame map)
  for (int y = 0; y < ${RED}; y++) for (int x = 0; x < ${RED}; x++) n += texelFetch(tIn, clamp(o + ivec2(x, y), ivec2(0), sz - 1), 0).r < m + uSolid.x ? 1. : 0.;
  oc = vec4(n >= uSolid.y * ${RED * RED}. ? m : 1., a / ${RED * RED}., 0., 1.);
}`;
// THE CANOPY: per block of the per-frame map, the share of its texels anything stands in (the trees, what moves: the ground
// isn't in that map; REDUCE_FS's g), averaged over the blocks round it (BOX_FS, one axis a pass: the first from g, the
// second from r): how dense the canopy is round a point
const BOX_FS = `precision highp float; precision highp int;
uniform sampler2D tIn; uniform ivec2 uDir; uniform int uR, uG; out vec4 oc;
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), sz = textureSize(tIn, 0); float s = 0.;
  for (int i = -${KMAX}; i <= ${KMAX}; i++) { if (i < -uR || i > uR) continue; vec4 t = texelFetch(tIn, clamp(p + uDir * i, ivec2(0), sz - 1), 0); s += uG > 0 ? t.g : t.r; }
  oc = vec4(s / float(2 * uR + 1), 0., 0., 1.);
}`;
const DILATE_FS = `precision highp float; precision highp int;
uniform sampler2D tIn, tAlso; uniform ivec2 uDir, uR; uniform int uAlso; out vec4 oc;   // blocks uR.x .. uR.y along uDir (and tAlso's own)
void main() {
  ivec2 p = ivec2(gl_FragCoord.xy), sz = textureSize(tIn, 0); float m = 1.;
  for (int i = -${KMAX}; i <= ${KMAX}; i++) { if (i < uR.x || i > uR.y) continue; m = min(m, texelFetch(tIn, clamp(p + uDir * i, ivec2(0), sz - 1), 0).r); }
  if (uAlso > 0) m = min(m, texelFetch(tAlso, p, 0).r);
  oc = vec4(m, 0., 0., 1.);
}`;

export function createGodrays({THREE, renderer, raw, tri, cam, compU}) {
  const nf = THREE.NearestFilter, mk = (n, f = THREE.RedFormat) => new THREE.WebGLRenderTarget(n, n, {type: THREE.FloatType, format: f, minFilter: nf, magFilter: nf, depthBuffer: false, generateMipmaps: false});
  const SZ = compU.tS.value.image.width / RED, SZS = compU.tSS.value.image.width / RED;   // (2048 / 8, 4096 / 8)
  // per map: reduced, side x, side y, scratch, near
  const maps = n => ({r: mk(n, THREE.RGFormat), x: mk(n), t: mk(n), near: mk(n), coarse: mk(n)});   // (r: + the canopy share)
  const MIN = {S: maps(SZ), SS: maps(SZS), staticDirty: true, kSS: 1, oSS: [0, 0]};   // (kSS: the static map's reach in blocks)
  MIN.S.den = mk(SZ); MIN.S.den2 = mk(SZ);   // (the per-frame map's canopy density, and a scratch)
  const redU = {tIn: {value: null}, uOff: {value: new THREE.Vector2()}, uSolid: {value: new THREE.Vector2()}}, dilU = {tIn: {value: null}, tAlso: {value: null}, uDir: {value: new THREE.Vector2()}, uR: {value: new THREE.Vector2()}, uAlso: {value: 0}};
  const pass = fs => { const sc = new THREE.Scene(); sc.matrixAutoUpdate = false; const m = new THREE.Mesh(tri, raw(VS, fs, fs === REDUCE_FS ? redU : dilU, {depthTest: false, depthWrite: false})); m.frustumCulled = false; m.matrixAutoUpdate = false; sc.add(m); return sc; };
  const redScene = pass(REDUCE_FS), dilScene = pass(DILATE_FS);
  const boxU = {tIn: {value: null}, uDir: {value: new THREE.Vector2()}, uR: {value: 1}, uG: {value: 1}};
  const boxScene = (() => { const sc = new THREE.Scene(); sc.matrixAutoUpdate = false; const m = new THREE.Mesh(tri, raw(VS, BOX_FS, boxU, {depthTest: false, depthWrite: false})); m.frustumCulled = false; m.matrixAutoUpdate = false; sc.add(m); return sc; })();
  function canopy(T, r) {   // the per-frame map's canopy share (its reduced map's g) averaged over r blocks round each
    boxU.uR.value = r; boxU.tIn.value = T.r.texture; boxU.uG.value = 1; boxU.uDir.value.set(1, 0); renderer.setRenderTarget(T.den2); renderer.render(boxScene, cam);
    boxU.tIn.value = T.den2.texture; boxU.uG.value = 0; boxU.uDir.value.set(0, 1); renderer.setRenderTarget(T.den); renderer.render(boxScene, cam);
  }
  // dst = src's min over blocks lo .. hi along (x, y) [and also's own]
  const dilate = (src, dst, x, y, lo, hi, also = null) => {
    dilU.tIn.value = src.texture; dilU.uDir.value.set(x, y); dilU.uR.value.set(lo, hi); dilU.tAlso.value = also ? also.texture : src.texture; dilU.uAlso.value = also ? 1 : 0;
    renderer.setRenderTarget(dst); renderer.render(dilScene, cam);
  };
  // a shadow map (depth texture) -> its min maps: side (kx across), near (2 kx + 1 across), coarse (near + 1 round)
  function minMaps(depth, T, kx, ox, oy, layer) {   // (layer: TUNE.layer m in this map's depth units)
    redU.tIn.value = depth; redU.uOff.value.set(ox, oy); redU.uSolid.value.set(layer, TUNE.solid); renderer.setRenderTarget(T.r); renderer.render(redScene, cam);
    dilate(T.r, T.x, 1, 0, -kx, kx); dilate(T.r, T.near, 1, 0, -2 * kx - 1, 2 * kx + 1);
    dilate(T.near, T.t, 1, 0, -1, 1); dilate(T.t, T.coarse, 0, 1, -1, 1);
  }
  const U = {tD: compU.tD, tS: compU.tS, tSS: compU.tSS, uInvPV: compU.uInvPV, uLightPV: compU.uLightPV, uLightPVS: compU.uLightPVS,
    uSBias: compU.uSBias, uSOn: compU.uSOn, uRes: compU.uRes,
    tNS: {value: MIN.S.near.texture}, tNSS: {value: MIN.SS.near.texture}, tCS: {value: MIN.S.coarse.texture}, tCSS: {value: MIN.SS.coarse.texture}, tXS: {value: MIN.S.x.texture}, tXSS: {value: MIN.SS.x.texture},
    uBand: {value: new THREE.Vector4()}, uPn: {value: new THREE.Vector4()}, uSide: {value: new THREE.Vector4()}, uMargin: {value: 0}, uMinOff: {value: new THREE.Vector4()},
    uLv: {value: new THREE.Vector3()}, tH: {value: null}, uHist: {value: new THREE.Vector4()}, uPrevPV: {value: new THREE.Matrix4()},
    uDM: {value: new THREE.Vector4()}, uMarginM: {value: 1}, uSun: {value: new THREE.Vector3()}, uPV: {value: null},
    tDen: {value: MIN.S.den.texture}, uDense: {value: new THREE.Vector2()},
    uGap: {value: new THREE.Vector4()}, uGapF: {value: new THREE.Vector4()}, uGM: {value: new THREE.Vector4()}, tGap: {value: null}};   // (THE GAPS)
  for (const k of ['tTop', 'uCl', 'uClM', 'uClO', 'uClC', 'uClT', 'uFr', 'uFrB', 'uFrK', 'uFrC', 'uFrS', 'uFrQ', ...CLOUD_EXTRA]) U[k] = compU[k];   // (the clouds: render/clouds.js) (wx-B shim: ...CLOUD_EXTRA)
  const full = (vs, fs, u, extra) => { const sc = new THREE.Scene(); sc.matrixAutoUpdate = false; const m = new THREE.Mesh(tri, raw(vs, fs, u, {depthTest: false, depthWrite: false, ...extra})); m.frustumCulled = false; m.matrixAutoUpdate = false; sc.add(m); return sc; };
  // the march into the history (art px: the smoothed count, the level, the depth; two, this frame's and last frame's), its
  // levels cleaned in the level targets (one byte), then their shape added into the target the composite drew
  const lvT = () => new THREE.WebGLRenderTarget(compU.uRes.value.x, compU.uRes.value.y, {format: THREE.RedFormat, minFilter: nf, magFilter: nf, depthBuffer: false, generateMipmaps: false});
  const lvRT = lvT(), lvB = lvT();   // (ping-pong for the morphology)
  const hT = () => new THREE.WebGLRenderTarget(compU.uRes.value.x, compU.uRes.value.y, {type: THREE.FloatType, minFilter: nf, magFilter: nf, depthBuffer: false, generateMipmaps: false});
  const HI = {a: hT(), b: hT(), t: 0, f: 0, pv: new THREE.Matrix4()};   // (f: frames drawn: the planes' phase)
  const ALONG = new THREE.Vector2(1, 0), ACROSS = new THREE.Vector2(0, 1);   // unit steps on screen (art px), set each frame
  const SU = {tLv: {value: lvRT.texture}, uDir: {value: ALONG}, uCol: {value: [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]}};
  const MU = {tLv: {value: null}, uDir: {value: ACROSS}, uR: {value: 1}, uGrow: {value: 0}};
  const scene = full(VS, FS, U, {}), morphScene = full(VS, MORPH_FS(), MU, {}), morphHScene = full(VS, MORPH_FS('.y'), MU, {});   // (H: from the history's level)
  const morph = (src, dst, dir, r, grow, sc = morphScene) => { MU.tLv.value = src.texture; MU.uDir.value = dir; MU.uR.value = r; MU.uGrow.value = grow ? 1 : 0; renderer.setRenderTarget(dst); renderer.render(sc, cam); };
  const _pv = new THREE.Matrix4(), _d = new THREE.Vector4(); U.uPV.value = _pv;
  const shapeScene = full(VS, SHAPE_FS, SU, {transparent: true, blending: THREE.CustomBlending,
    blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor});
  // compiled now, while the page loads (else the first sunlit frame waits ~80 ms for them: a hitch at dawn after a night start)
  for (const sc of [scene, morphScene, morphHScene, shapeScene, redScene, dilScene, boxScene]) renderer.compile(sc, cam);
  // THE GAPS: the gap map (GAP_FS: a byte a view px of the view and its margin down-sun), drawn before the march when it's on
  const gapRT = lvT(), GU = {uRes: compU.uRes, uInvPV: compU.uInvPV, uPV: U.uPV, uSun: U.uSun, uGap: U.uGap, uGM: U.uGM};
  for (const k of ['tTop', 'uCl', 'uClM', 'uClO', 'uClC', 'uClT', 'uFr', 'uFrB', 'uFrK', 'uFrC', 'uFrS', 'uFrQ', ...CLOUD_EXTRA]) GU[k] = compU[k];   // (wx-B shim: ...CLOUD_EXTRA)
  const gapScene = full(VS, GAP_FS, GU, {}); U.tGap.value = gapRT.texture; renderer.compile(gapScene, cam);
  // the strength inputs (render/lighting.js, every frame): the sun's elevation (deg) and colour, the mood's shadow strength,
  // the sky's cloud and mist, the ground's wetness; THE ENVELOPE's: the share of the view's ground the sun reaches
  // (env.sunView, else 1 - .9 x cloud), how broken the sky over it is (env.broken; undefined: the estimate below, resolved
  // here, so In.broken is always a number), the frame's clock (s: the draw's, held in a still photo), the world clock (env:
  // its front, a preview)
  const In = {el: 45, c: [1, 1, 1], shadow: 0, cloud: 0, mist: 0, wet: 0, sunView: 1, broken: 0, t: 0, env: null};
  let base = 0;   // the strength before the view's share
  const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // THE ENVELOPE's state and parts (rays.env, read-only; dev/wxpanel.js shows them): the sun's share, its target and smoothed
  // (sun, sunS); how broken the sky is (est: by the estimate below), how moist the air, how fast the sun breaks through
  // (breaking: 0..1); the boost's target (x = its
  // wet part wetX + its breakthrough part burst) and smoothed (xS); the result (base: before the view's share) and what the
  // old formula gives from the same inputs (old); the clock's last reading (t; -1: none yet); held: a preview, shown at once
  const ENV = {sun: 0, sunS: 0, broken: 0, est: true, moist: 0, breaking: 0, wetX: 0, burst: 0, x: 0, xS: 0, base: 0, old: 0, t: -1, held: false};
  // without env.broken: a front's edge crossing the view breaks the sky over it (sim/env.js FRONTS: up, the player's m ahead
  // of the edge: the view's middle), as much as the clouds on its two sides differ
  function brokenOf(F) {
    if (!F || !F.on || !(F.up === F.up)) return 0;
    const dc = Math.abs((F.A?.cloud ?? 0) - (F.B?.cloud ?? 0));
    return (1 - smooth(0, TUNE.edge, Math.abs(F.up))) * Math.min(1, dc / .5);
  }
  const ease = (x, to, dt, up, dn) => x + (to - x) * (1 - Math.exp(-dt / (to > x ? up : dn)));
  function set(o) {
    In.el = o.el; In.c = o.c; In.shadow = o.shadow; In.cloud = o.cloud || 0; In.mist = o.mist || 0; In.wet = o.wet || 0;
    const T = TUNE, kEl = 1 - (1 - T.el[2]) * smooth(T.el[0], T.el[1], In.el), kCl = 1 - smooth(T.cloud[0], T.cloud[1], In.cloud);
    const kSh = Math.min(1, Math.max(0, In.shadow / T.shadow));
    const old = ENV.old = Math.min(T.max, T.k * kEl * kCl * kSh * (1 + T.mist * In.mist + T.wet * In.wet));
    const env = In.env = o.env || null;
    In.sunView = o.sunView ?? 1 - In.cloud * .9; In.t = o.t ?? performance.now() / 1000;
    ENV.est = o.broken == null; In.broken = ENV.broken = ENV.est ? brokenOf(env?.front) : o.broken;
    if (!T.env) { base = ENV.base = old; ENV.t = -1; return; }   // (?rayenv=0, or TUNE.env off live: the old formula)
    // the targets: the sun's share (through TUNE.cloud as the cloud that leaves that much sun), the boost (wet ground, the
    // breakthrough while the sky is broken in moist air)
    const sun = ENV.sun = 1 - smooth(T.cloud[0], T.cloud[1], (1 - In.sunView) / .9);
    const moist = ENV.moist = Math.min(1, Math.max(In.wet, T.moist * In.mist));
    // (the breakthrough only while the sun BREAKS THROUGH: its share rising ahead of the beams, which lag a rise; a steady sky
    // or a deck closing in has none: an arriving storm's broken edge, or a cloudy day's gaps, boost nothing)
    const brk = ENV.breaking = ENV.t < 0 ? 0 : smooth(0, T.breaking, sun - ENV.sunS);
    ENV.wetX = T.wetX * In.wet; ENV.burst = T.burst * In.broken * moist * brk;
    const x = ENV.x = ENV.wetX + ENV.burst;
    // in time: the frame's clock (at most T.dtMax s a frame, x rays.rate); a preview shows its weather at once, the state waits
    let sS = sun, xS = x;
    if (!(ENV.held = !!env?.previewing)) {
      const dt = Math.min(T.dtMax, Math.max(0, In.t - ENV.t)) * R.rate;
      if (ENV.t < 0) { ENV.sunS = sun; ENV.xS = x; }   // (the first frame: as it is)
      else if (dt > 0) { ENV.sunS = ease(ENV.sunS, sun, dt, T.rise, T.fall); ENV.xS = ease(ENV.xS, x, dt, T.swell, T.ebb); }
      ENV.t = In.t; sS = ENV.sunS; xS = ENV.xS;
    }
    // (a steady dry day: sS = the old kCl, xS = 0: exactly the old formula)
    base = ENV.base = Math.min(T.max, T.k * kEl * sS * kSh * (1 + T.mist * In.mist) * (1 + xS));
  }
  const R = {live: false, strength: 0, TUNE, set, draw, restatic: () => { MIN.staticDirty = true; }, env: ENV, In, rate: 1,
    get enabled() { return TUNE.on && compU.uShadowOn.value > .5; }};
  // K: half the reach in blocks of a min map, at m metres per block (at least one). A block's size in metres across / up:
  // 2 / (light NDC per metre x blocks), the NDC per metre being the length of the light matrix's first / second row
  const kOf = (m, r = TUNE.reach) => Math.max(1, Math.min(KMAX >> 1, Math.round(r / 2 / m)));
  const blk = (L0, L1, L2, n) => 2 / ((Math.hypot(L0, L1, L2) || 1) * n);
  // the blocks' phase in a map: from the world origin's texel (whole texels: the maps sit on the world's texel grid)
  const ph = (t, n) => ((-Math.round((t * .5 + .5) * n * RED)) % RED + RED) % RED;
  function draw() {
    const T = TUNE;
    let re = !R.live;   // the history starts over after a frame without the rays (and at the first)
    R.live = false;
    if (!T.on || compU.uShadowA.value <= 0 || compU.uShadowOn.value < .5 || base <= .01) return;   // (no sun shadow map this frame)
    if (compU.uDebug.value) return;   // (a debug view: albedo, normals, the shadow mask... shows only itself)
    // looking toward the sun: the camera's forward on the ground (away from the viewer) against the sun's bearing
    const v = compU.uView.value, s = compU.uSunDir.value, sl = Math.hypot(s.x, s.z) || 1, vl = Math.hypot(v.x, v.z) || 1;
    const fw = -(v.x * s.x + v.z * s.z) / (vl * sl), k = base * (T.view[0] + (T.view[1] - T.view[0]) * smooth(-.4, .9, fw));
    R.strength = k;
    if (k <= .01) return;
    // the planes contain the light's direction s (the casting sun: the light matrix's view axis) and face the camera as
    // squarely as that allows: n = V - (V . s) s, V toward the viewer (the inverse projection's NDC z axis). Fixed in the world
    // while the view pans (V and s don't change); a turn of the camera or of the sun turns them
    const e = compU.uLightPV.value.elements, f = compU.uLightPVS.value.elements, iv = compU.uInvPV.value.elements;
    const ql = -1 / (Math.hypot(e[2], e[6], e[10]) || 1), sx = e[2] * ql, sy = e[6] * ql, sz = e[10] * ql;
    const wl = -1 / (Math.hypot(iv[8], iv[9], iv[10]) || 1), Vx = iv[8] * wl, Vy = iv[9] * wl, Vz = iv[10] * wl, vs = Vx * sx + Vy * sy + Vz * sz;
    let nx = Vx - vs * sx, ny = Vy - vs * sy, nz = Vz - vs * sz; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    U.uPn.value.set(nx, ny, nz, T.band);
    U.uBand.value.set(T.dn, Math.min(128, T.planes), T.bias, T.jitter ? (HI.f * .6180339887) % 1 : 0);   // (w: this frame's phase)
    const dpm = Math.hypot(e[2], e[6], e[10]) / 2, dpmS = Math.hypot(f[2], f[6], f[10]) / 2 || 1;   // (light depth per metre: half the light matrix's third row)
    U.uMargin.value = T.margin * dpm;
    U.uDM.value.set(1 / dpm, 1 / dpmS, T.len[0], Math.max(.01, T.len[1])); U.uMarginM.value = T.margin; U.uSun.value.set(sx, sy, sz);
    U.uLv.value.set(T.lv[0] / T.dn - .01, T.lv[1] / T.dn - .01, T.lv[2] / T.dn - .01);   // (n: whole samples, gap fractions)
    // the colour: the sun's, warmed (its own hue pushed further: a dusk sun's orange deepens, a noon sun's white barely moves)
    const c = In.c, gk = T.goldK * (1 - smooth(T.goldEl[0], T.goldEl[1], In.el)), G = T.gold;
    const wr = Math.pow(c[0], T.warm) * (1 - gk) + G[0] * gk, wg = Math.pow(c[1], T.warm) * (1 - gk) + G[1] * gk, wb = Math.pow(c[2], T.warm) * (1 - gk) + G[2] * gk;
    for (let i = 0; i < 3; i++) SU.uCol.value[i].set(wr * T.amt[i] * k, wg * T.amt[i] * k, wb * T.amt[i] * k);
    // the beams on screen: the sun's direction through the projection (the inverse projection, inverted), in art px
    const VW = compU.uRes.value.x, VH = compU.uRes.value.y;
    if (lvRT.width !== VW || lvRT.height !== VH) { lvRT.setSize(VW, VH); lvB.setSize(VW, VH); HI.a.setSize(VW, VH); HI.b.setSize(VW, VH); re = true; }
    _d.set(sx, sy, sz, 0).applyMatrix4(_pv.copy(compU.uInvPV.value).invert());
    const bx = _d.x * VW, by = _d.y * VH, bl = Math.hypot(bx, by);
    if (bl > 1e-6) { ALONG.set(bx / bl, by / bl); ACROSS.set(-by / bl, bx / bl); }
    // the min maps (the side windows sit K + 1 blocks off the sample), then the march into the target the composite drew
    const rt = renderer.getRenderTarget();
    const kx = kOf(blk(e[0], e[4], e[8], SZ));
    const ox = ph(e[12], SZ), oy = ph(e[13], SZ);
    minMaps(compU.tS.value, MIN.S, kx, ox, oy, T.layer * dpm);
    canopy(MIN.S, Math.max(1, Math.min(KMAX, Math.round(T.dense[2] / blk(e[0], e[4], e[8], SZ)))));
    U.uDense.value.set(T.dense[0], T.dense[1]);
    if (MIN.staticDirty && compU.uSOn.value > .5) {
      MIN.staticDirty = false; MIN.kSS = kOf(blk(f[0], f[4], f[8], SZS)); MIN.oSS[0] = ph(f[12], SZS); MIN.oSS[1] = ph(f[13], SZS);
      minMaps(compU.tSS.value, MIN.SS, MIN.kSS, MIN.oSS[0], MIN.oSS[1], T.layer * dpmS);
    }
    U.uMinOff.value.set(ox / (SZ * RED), oy / (SZ * RED), MIN.oSS[0] / (SZS * RED), MIN.oSS[1] / (SZS * RED));
    U.uSide.value.set((kx + 1) / SZ, 0, (MIN.kSS + 1) / SZS, 0);
    // THE GAPS: on while the sky is broken (In.broken via set(); without it the view's cloud, or a front) and the cloud
    // shadows are on this frame (0: none of it runs, the map isn't drawn); the root's count; the stride: the planes over which
    // a sample's sun-ray ground point moves Gp.step m (a plane moves it dX - s dX.y / s.y, dX = V dn / nV), its phase turning
    const nV = Vx * nx + Vy * ny + Vz * nz, dq = T.dn / Math.max(.05, nV), gy = Vy * dq / Math.max(.05, sy);
    const Gp = T.gap, st = Math.max(2, Math.min(8, Math.round(Gp.step / (Math.hypot(Vx * dq - sx * gy, Vz * dq - sz * gy) || 1))));
    const gq = !Gp.on || compU.uCl.value.x < .5 ? 0 : typeof In.broken === 'number' ? smooth(Gp.broken[0], Gp.broken[1], In.broken)
      : compU.uFr.value.w > .5 ? 1 : smooth(Gp.cloud[0], Gp.cloud[1], In.cloud);
    U.uGap.value.set(gq > .01 ? gq * Gp.lv / T.dn : 0, Gp.reach, st, Gp.edge);
    R.gapStride = gq > .01 ? st : 0;   // (a readout: the gap samples' stride this frame, 0 off)
    if (gq > .01) {   // the gap map: the view and its margin down-sun (a sample's sun ray meets the ground up to (band + over) / s.y m
      // down-sun of it), as many texels as the view has px; the sun's direction on screen (_d: NDC a metre) -> px a metre of height
      const MW = Math.max(16, Math.round(VW * Gp.res)), MH = Math.max(16, Math.round(VH * Gp.res));
      if (gapRT.width !== MW || gapRT.height !== MH) gapRT.setSize(MW, MH);
      const H = (T.band + Gp.over) / Math.max(.05, sy), mx = -_d.x * .5 * VW * H, my = -_d.y * .5 * VH * H;
      const x0 = Math.max(-2 * VW, Math.min(0, mx)), x1 = Math.min(3 * VW, VW + Math.max(0, mx)), y0 = Math.max(-2 * VH, Math.min(0, my)), y1 = Math.min(3 * VH, VH + Math.max(0, my));
      U.uGM.value.set(x0, y0, (x1 - x0) / MW, (y1 - y0) / MH);
      renderer.setRenderTarget(gapRT); renderer.render(gapScene, cam);
    }
    U.uGapF.value.set(Gp.fade[0], Math.max(.01, Gp.fade[1] - Gp.fade[0]), 0, T.jitter ? Math.floor((HI.f * .6180339887) % 1 * st) : 0);
    // THE TIME: this frame's weight in the history (by the real time since the last: any frame rate smooths alike), the
    // hysteresis, the depth tolerance (metres along the view ray -> depth units), and whether it starts over (the first frame
    // after none, a gap, a resize); last frame's projection, to find each point's place then
    const now = performance.now(), dt = Math.min(.1, Math.max(0, (now - HI.t) / 1000));
    if (now - HI.t > 250) re = true;
    HI.t = now; HI.f++;
    U.uHist.value.set(re || T.tau <= 0 ? 1 : 1 - Math.exp(-dt / T.tau), T.hyst, T.dtol / (2 * Math.hypot(iv[8], iv[9], iv[10]) || 1), re ? 1 : 0);
    U.uPrevPV.value.copy(HI.pv); HI.pv.copy(_pv);
    const hNow = HI.a; HI.a = HI.b; HI.b = hNow; U.tH.value = HI.a.texture;   // (a: last frame's, read; b: this frame's)
    renderer.setRenderTarget(hNow); renderer.render(scene, cam);
    morph(hNow, lvB, ACROSS, 1, true, morphHScene); morph(lvB, lvRT, ACROSS, 1, false);   // close across: seams fill
    morph(lvRT, lvB, ALONG, 2, true); morph(lvB, lvRT, ALONG, 4, false);                   // close along (+ the open's erode along): gaps bridge
    morph(lvRT, lvB, ACROSS, 1, false); morph(lvB, lvRT, ACROSS, 1, true);                 // the open across
    renderer.setRenderTarget(rt); renderer.render(shapeScene, cam);                        // (the open's dilate along: drawn)
    R.live = true;
  }
  return R;
}
