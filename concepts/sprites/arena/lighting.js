// LIGHTING: time of day, light sources, shadows, lit character. OWNER: lighting agent.
//
// CONTRACT (the host, arena.html, calls exactly these, in this order every frame):
//   export function createLighting(ctx) -> L
//   L.setBiome(biomeId)                     // 'ruins' | 'ember' | 'frost' | 'rift': mood (ambient, sun, fog colours)
//   L.setTime(i) / L.time / L.TIMES         // T key cycles L.TIMES (e.g. ['day', 'dusk', 'night'])
//   L.toggleLantern()                       // L key: a light carried by the player (to test lighting on the character)
//   L.beginFrame(cam, lights, player)       // lights: world lights [{x, y, h, color, radius, intensity, flicker}] (metres)
//                                           // player: {x, y} metres
//   L.groundShadows(g, cam, casters)        // after the ground, before sprites. casters: [{img, sx, sy, pivot, sw?, sh?, srcX?,
//                                           //   player?, prop?}]  sx, sy = pivot position on the view canvas.
//                                           // prop (optional): the layout prop {x, y, z, h, kind, occluder}: where it stands,
//                                           // h = height above its surface (a hopping brute), occluder = tall: wider AO skirt
//   L.drawSprite(g, img, nrm, srcX, srcY, w, h, dx, dy, world)   // draw the PLAYER frame (nrm = normal sheet, may be null:
//                                           // linear, +x right +y up +z toward the viewer). Default: plain drawImage.
//                                           // world {x, y, z, face, nd?, fresh?}: nd = facings in the atlas (else img.width / w),
//                                           // fresh = img is redrawn every frame (body + runtime cloth composite): no cache
//                                           // prop = a 3D prop (arena/props3d.js): lit the same way, but it leaves the
//                                           //   player-only state alone and gets no character fill / grade
//   L.apply(g, cam, emitters)               // after all sprites: darken/tint the view by the light layer, then add
//                                           // emissive pixels. emitters: [{img, x, y}] view-canvas px (top-left)
//   L.debug                                 // optional string shown in the HUD
//   L.ao                                    // optional: contact shadows on (default) / off, for A/B checks
//   ctx = {PPM, PPMY, PPMH, toS, WM, HM, WPX, HPX, VW, VH, PLAY, layout}; view px = toS(...) - [cam.x, cam.y]
//
// HOW IT WORKS
//   Light buffer  built in JS, one texel per RS x RS view px, in float: ambient + every point light as a smooth ellipse
//                 on the ground (falloff (1 - t^2)^2: no steps, no dither). Where lights pile up past 1, only the LIGHT
//                 part is compressed (soft knee, one factor for r/g/b: keeps the light's colour, no hard plateau, no hue
//                 rings where coloured lights overlap). apply() multiplies it over the view (bilinear upscale), then
//                 adds emitters, a small soft halo at each light and a faint fog ('lighter'). No bloom.
//   Player        drawSprite() computes, per opaque pixel, the light it SHOULD get from its normal (ambient shaped by the
//                 sun/moon direction, wrapped N.L from each nearby point light using its height h, rim light on the
//                 outline from lights behind) and divides by the value the multiply layer will apply at that pixel
//                 (read from the same buffer), so after apply() the result is albedo * directional light, never
//                 darkened twice. Each light's N.L is normalised by its mean over the frame's normals, so on average
//                 the character is as bright as the ground it stands on and only the shading moves. Ratio clamped to
//                 [RATIO_MIN, RATIO_MAX], highlights roll off (SOFT) instead of clipping flat.
//   Shadows       per-image silhouettes (cached, faded with height) drawn with an affine shear into a mask, a 1 px soft
//                 fringe, tinted and laid on the ground: from the sun (day / dusk) and from the strongest nearby point
//                 light on the same surface (fades with that light's strength and in daylight). Plateaus: casters on
//                 top keep their shadows on the top, ground shadows stay off the block, and the block's footprint swept
//                 along the sun is its own shadow on the ground. Airborne (leap, fall): the shadow starts on the surface
//                 below and softens with height. The silhouette is darkest at the base and fades toward the far end.
//   Contact AO    every caster also gets a contact shadow at its base, at EVERY time of day (also at night without a
//                 sun): a pixel-art stamp (hard dark core ellipse hugging the base + two stepped falloff rings, baked
//                 once per size, drawn 1:1) as wide as the sprite's bottom opaque rows (measured once per image on a
//                 scratch canvas, cached; the player uses a fixed foot width), plus a wide faint skirt under tall
//                 occluders (caster.prop.occluder). Airborne casters: it shrinks and fades with height. AO has its own mask (overlaps
//                 merge, no blotches), laid over the cast-shadow mask before the tint, so AO inside a cast shadow darkens
//                 it multiplicatively (like occluded skylight). Opacity AO_A (mood.shadow.ao overrides).
//   Cliff        buffer texels know whether they show ground, a plateau top or its south face: pools land on the
//                 surface under the light, plateau edges hide lights from the other level, the face takes light from in
//                 front only, is darker than the top in the sun's shade, and the ground at its foot is occluded.

// ---------------- moods ----------------
// amb    flat light on the ground / multiply colour (1 = the art exactly as authored)
// sun    az: compass degrees the light comes FROM (0 N, 90 E, 180 S, 270 W), el: elevation degrees,
//        c: colour, k: how strongly its direction shapes the player (relative), rim: rim light when it is behind.
//        Day / dusk suns come from the WNW-NW (upper left on screen, like the art's highlights): shadows fall to the
//        lower right, the cliff's south face is in shade and the plateau throws its shadow onto the yard.
// shadow a: ground shadow opacity from the sun (0 = none), c: shadow colour, ao: contact-shadow opacity (default AO_A)
// fog    [r, g, b, a] added haze, stronger toward the top (far) of the view
// lift   extra flat light on the surface around the player (dark scenes)
// fill   extra flat light on the CHARACTER only (not the ground): keeps him readable at night without an aura
// glow   halo strength around strong lights, emit = emitter strength (computed from amb when omitted)
const MOODS = {
  ruins: {
    day:   {amb: [1.00, .985, .95], sun: {az: 305, el: 50, c: [1, .95, .84], k: .34, rim: .15},
            shadow: {a: .46, c: [.10, .12, .20]}, fog: [0, 0, 0, 0], lift: [0, 0, 0], glow: .25},
    dusk:  {amb: [.86, .68, .58], sun: {az: 292, el: 14, c: [1, .6, .36], k: .55, rim: .3},
            shadow: {a: .48, c: [.16, .08, .20]}, fog: [.16, .07, .06, .10], lift: [.04, .03, .03], fill: [.03, .02, .02], glow: .6},
    night: {amb: [.21, .23, .33], sun: {az: 330, el: 36, c: [.55, .66, .95], k: .4, rim: .85},
            shadow: {a: 0, c: [.02, .03, .08], ao: .62}, fog: [.03, .04, .08, .10], lift: [.06, .07, .10], fill: [.15, .16, .21], glow: 1},
  },
  ember: {   // red-orange ambient under an ash sky
    day:   {amb: [1.00, .93, .86], sun: {az: 300, el: 44, c: [1, .8, .6], k: .32, rim: .15},
            shadow: {a: .38, c: [.18, .06, .06]}, fog: [.10, .04, .02, .08], lift: [0, 0, 0], glow: .35},
    dusk:  {amb: [.86, .55, .42], sun: {az: 288, el: 12, c: [1, .46, .22], k: .55, rim: .3},
            shadow: {a: .44, c: [.20, .04, .06]}, fog: [.22, .07, .03, .12], lift: [.05, .03, .02], fill: [.03, .02, .01], glow: .7},
    night: {amb: [.32, .17, .15], sun: {az: 20, el: 30, c: [.95, .42, .24], k: .38, rim: .8},
            shadow: {a: 0, c: [.08, .01, .02], ao: .62}, fog: [.10, .03, .02, .12], lift: [.08, .06, .05], fill: [.15, .12, .11], glow: 1},
  },
  frost: {   // cold blue
    day:   {amb: [.95, .98, 1.00], sun: {az: 310, el: 32, c: [.96, .98, 1], k: .34, rim: .15},
            shadow: {a: .36, c: [.12, .20, .40]}, fog: [.06, .08, .12, .10], lift: [0, 0, 0], glow: .25},
    dusk:  {amb: [.74, .70, .86], sun: {az: 295, el: 10, c: [1, .7, .62], k: .5, rim: .3},
            shadow: {a: .40, c: [.12, .12, .34]}, fog: [.10, .08, .16, .12], lift: [.03, .03, .04], fill: [.02, .02, .03], glow: .6},
    night: {amb: [.18, .25, .41], sun: {az: 335, el: 42, c: [.62, .78, 1], k: .42, rim: .85},
            shadow: {a: 0, c: [.02, .04, .12], ao: .62}, fog: [.04, .06, .12, .12], lift: [.05, .07, .10], fill: [.13, .16, .22], glow: 1},
  },
  rift: {    // violet
    day:   {amb: [.94, .90, 1.00], sun: {az: 305, el: 46, c: [.95, .86, 1], k: .34, rim: .2},
            shadow: {a: .40, c: [.12, .05, .22]}, fog: [.06, .02, .10, .08], lift: [0, 0, 0], glow: .35},
    dusk:  {amb: [.68, .52, .84], sun: {az: 290, el: 13, c: [.95, .5, .9], k: .55, rim: .3},
            shadow: {a: .44, c: [.12, .03, .22]}, fog: [.14, .05, .18, .12], lift: [.04, .03, .05], fill: [.03, .02, .03], glow: .7},
    night: {amb: [.21, .14, .33], sun: {az: 340, el: 34, c: [.72, .5, 1], k: .42, rim: .9},
            shadow: {a: 0, c: [.05, .01, .10], ao: .62}, fog: [.07, .03, .12, .12], lift: [.07, .06, .10], fill: [.17, .14, .22], glow: 1},
  },
};
const TIMES = ['day', 'dusk', 'night'];
// lantern: held `side` m to the right hand and `fwd` m ahead of the facing, h above the feet
const LANTERN = {fwd: .22, side: .3, h: .95, color: '#ffc27a', radius: 4.2, intensity: 1, flicker: .2, id: -7};

// ---------------- tuning ----------------
const RS = 3;               // light buffer texel = RS x RS view px (bilinear upscale: smooth, cheap)
const KNEE = .72, KNEE_TAIL = .5;   // light compression starts here (or at the ambient); TAIL: how slowly it nears 1
const RATIO_MIN = .5, RATIO_MAX = 2.4;   // player lighting relative to the multiply layer (RATIO_MAX * 255 < 1024: SOFT)
const WRAP_SUN = .35;       // sun / moon: wrapped N.L, re-centred on the sprite's mean so its average brightness stays
// point lights: wrapped N.L, divided by its mean over the sprite (at least NORM_MIN), times GAIN_PT. So on average
// the character gets what the ground under it gets (no darker figure in a lit pool), shaped by where the light is.
const WRAP_PT = .25, GAIN_PT = 1.05, NORM_MIN = .3, RIM_PT = 1.8, RIM_EDGE = .9;   // rim: outline px RIM_EDGE, inner less
// point-light shadows (integration fix, 2026-09-30): EVERY light that reaches a caster throws its own shadow, and at
// each ground pixel it removes only THAT light's share of the light there (its falloff / the buffer's total). Where
// another light or the ambient still reaches, the shadow is faint; overlaps only go dark where every light is blocked.
// (Before: one shadow per caster, from its strongest light only, painted at a fixed opacity: it jumped between
// lights and stayed dark inside other lights' pools.)
// PT: shadow opacity = min(max, share x gain); a pure share is physically right but reads faint when several lights
// overlap, so the gain lifts it (overlaps still only go dark where every light is blocked). Live-tunable: L.PTS.
const PTS = {gain: 2.2, max: .75, lights: 6};
// flat structures (walls, towers, gateposts) cast no point-light shadows: their lights are mounted on them and a
// sheared billboard of a wall reads as a wedge
const NO_PT_SHADOW = /^(wall_|tower|gatepost)/;
// the character in dark scenes (integration fix): the readability fill takes the AMBIENT's hue (a neutral grey fill
// washed him out and turned him pink in violet light); GRADE: a partial recolour of the character's albedo toward the
// biome's own art colour (its ground, lum-normalised), stronger at night, so a warm palette doesn't turn magenta under
// violet light while the environment's art is painted in the biome's hues.
// FILL_CAP: the fill never adds more than this fraction of the light actually falling at that pixel (the multiply
// layer B), so in a dark scene he stays readable without glowing brighter than his surroundings.
const GRADE = {ruins: [1.039, 1.029, .818], ember: [1.166, .958, .82], frost: [.896, 1.013, 1.161], rift: [1.056, .792, 1.649]};
const CHAR = {fillK: 1, fillCap: .25, gradeK: {day: .12, dusk: .25, night: .4}};   // live-tunable: L.CHAR
const FRINGE = .08;         // soft 1 px shadow edge (low: a crisp edge that still isn't a hard cut)
// contact shadows (AO at the base of every caster), in view px. Core ellipse: half-width = footprint half-width +
// AO_PAD, half-height = AO_H * that, clamped to [AO_HMIN, AO_HMAX]; its centre AO_DY px below the pivot row.
// Around it the falloff rings (AO_RING: pad / extra height / the two step opacities, relative to the core).
const AO_A = .5, AO_PAD = 1, AO_H = .15, AO_HMIN = 1, AO_HMAX = 2, AO_DY = 1;
const AO_RING = {pad: 2, h: 2, a: [.5, .22]};
const AO_SKIRT = {w: 1.3, pad: 3, h: 2.2, a: .14};   // tall occluders: a wide, faint skirt on the floor
const AO_AIR = 1.2, AO_FOOT = 5;   // airborne: shrinks / fades over AO_AIR m; the player's foot half-width (px)
const HALO_A = .16, HALO_R = .3;   // soft additive halo around each light source (metres)
// emitters add emit * max(1 - B, EMIT_MIN + EMIT_MIN_DARK * darkness) * EMIT_GAIN: a flame in its own light still pops a little
const EMIT_GAIN = 1.15, EMIT_MIN = .1, EMIT_MIN_DARK = .2;
const SUN_LEN_MAX = 1.7;   // longest sun shadow, metres per metre of height (dusk)
// elevation: pools fall off with 3D distance, the vertical part weighted DZK (a tall light still lights its base)
const DZK = .25;
// the cliff: face ambient in the sun's shade (day / dusk) and at night, darker toward its foot; the face takes
// light from in front (N.L, FACE_GAIN); ambient occlusion on the ground at the foot (FOOT) and along the sides
const FACE_SHADE = .62, FACE_NIGHT = .8, FACE_AO = .3, FACE_GAIN = 1.25;
const FOOT_AO = .35, FOOT_R = 1.3, SIDE_AO = .22, SIDE_R = .9;

// soft shoulder for brightened pixels: highlights roll off instead of clipping flat (keeps the ramps readable)
const SOFT = new Uint8ClampedArray(1024);
for (let v = 0, K = 200; v < 1024; v++) SOFT[v] = v < K ? v : K + (255 - K) * (1 - Math.exp(-(v - K) / (255 - K)));
const falloff = t2 => { const u = 1 - t2; return u > 0 ? u * u : 0; };   // t2 = (d / r)^2
const hexCache = new Map();
function rgb(c) {
  if (Array.isArray(c)) return c;
  let v = hexCache.get(c); if (v) return v;
  let s = String(c || '#ffffff').replace('#', ''); if (s.length === 3) s = s.replace(/./g, m => m + m);
  const n = parseInt(s.slice(0, 6), 16) || 0;
  v = [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; hexCache.set(c, v); return v;
}
const lum = c => c[0] * .3 + c[1] * .55 + c[2] * .15;
const css = (c, a = 1) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
const canvas = (w, h, opts) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d', opts); q.imageSmoothingEnabled = false; return [c, q]; };

export function createLighting(ctx) {
  let biome = 'ruins', mood = MOODS.ruins.day, lantern = false, T0 = performance.now();
  const L = {TIMES, time: 0, debug: '', mood: () => mood, MOODS, CHAR, PTS};
  // pitch of the sprite camera: PPMH = PPM * cos(pitch)
  const trig = () => { const cs = Math.min(1, ctx.PPMH / ctx.PPM); return [cs, Math.sqrt(1 - cs * cs)]; };
  // world direction (east, south, up) -> view space of the normal maps (+x right, +y up, +z toward the viewer)
  const toView = (dx, dy, dh, cs, sn) => [dx, -dy * sn + dh * cs, dy * cs + dh * sn];

  // ---- per-frame state ----
  let cam = {x: 0, y: 0}, player = {x: 0, y: 0}, FL = [], sunV = [0, 0, 1], sunG = [0, 0], nShadows = 0, nAO = 0;
  const stats = {ms: 0, sprite: 0, n: 0}, hist = new Float32Array(60);   // HUD: mean of the last 60 frames
  const [buf, bq] = canvas(1, 1, {willReadFrequently: true}), [mask, mq] = canvas(1, 1), [mask2, mq2] = canvas(1, 1);
  const [aom, aq] = canvas(1, 1);   // contact-shadow (AO) mask, merged into mask2 before the tint
  const [oc, oq] = canvas(1, 1);   // the point-light occlusion, laid into the shadow mask
  let OCC = new Float32Array(0), TMP = new Float32Array(0);   // occlusion / one light's silhouettes (view px)
  // ibuf: 1 - B (what the multiply took away), em: the emitter layer, emk: the union of the emitters' alpha
  const [ibuf, iq] = canvas(1, 1, {willReadFrequently: true}), [em, eq] = canvas(1, 1), [emk, ekq] = canvas(1, 1);
  // scr: CPU-backed (willReadFrequently), so putImageData is a memcpy, not a GPU upload + flush (~10x cheaper)
  const [scr, sq] = canvas(96, 80, {willReadFrequently: true}), [fx, fq] = canvas(1, 1);
  const [rd, rq] = canvas(96, 80, {willReadFrequently: true});

  function refreshMood() { mood = MOODS[biome]?.[TIMES[L.time]] ?? MOODS.ruins.day; }
  L.setBiome = id => { biome = MOODS[id] ? id : 'ruins'; refreshMood(); };
  L.setTime = i => { L.time = ((i % TIMES.length) + TIMES.length) % TIMES.length; refreshMood(); };
  L.toggleLantern = () => { lantern = !lantern; return lantern; };
  Object.defineProperty(L, 'lantern', {get: () => lantern, set: v => { lantern = !!v; }});

  // smooth flicker, seeded per light id (no per-frame randomness: stable, never pops)
  function flick(l, t) {
    const f = l.flicker || 0; if (!f) return 1;
    const s = (l.id ?? 0) * 12.9898 % 6.283;
    const n = .5 * Math.sin(t * 7.3 + s) + .3 * Math.sin(t * 12.7 + s * 2.3) + .2 * Math.sin(t * 23.1 + s * 3.7);  // -1..1
    return 1 - f * .22 * (1 + n);
  }
  // halo texture per colour: the falloff baked per texel (opaque, black outside), drawn scaled with bilinear
  // filtering and 'lighter'. Much cheaper than a gradient fill per light, and just as smooth.
  const texCache = new Map(), TEX = 64;
  function tex(c) {
    const key = c.join(); let t = texCache.get(key); if (t) return t;
    const [cv, q] = canvas(TEX, TEX), id = q.createImageData(TEX, TEX), d = id.data;
    for (let y = 0; y < TEX; y++) for (let x = 0; x < TEX; x++) {
      const u = (x + .5) / TEX * 2 - 1, v = (y + .5) / TEX * 2 - 1, f = falloff(u * u + v * v), i = (y * TEX + x) * 4;
      d[i] = c[0] * f * 255 + .5; d[i + 1] = c[1] * f * 255 + .5; d[i + 2] = c[2] * f * 255 + .5; d[i + 3] = 255;
    }
    q.putImageData(id, 0, 0); texCache.set(key, cv); return cv;
  }
  const view = (x, y, h = 0) => [x * ctx.PPM - cam.x, y * ctx.PPMY - h * ctx.PPMH - cam.y];

  // ---------------- elevation: plateaus (ctx.layout.plateaus / elev) ----------------
  const plats = () => ctx.layout?.plateaus || [];
  const elevAt = (x, y) => ctx.layout?.elev ? ctx.layout.elev(x, y) : 0;
  const platIndex = (x, y) => { const P = plats(); for (let i = 0; i < P.length; i++) { const p = P[i]; if (x >= p.x0 && x <= p.x1 && y >= p.y0 && y <= p.y1) return i; } return -1; };
  // how much of a light at (lx, ly, lh) reaches the surface point (qx, qy, qz) past the edge of plateau block p
  // (lin / qin: the light / the point is on top of it). Height along the ray where it crosses the block's outline,
  // against the block's height, soft over 0.5 m.
  function edgeVis(p, lx, ly, lh, lin, qx, qy, qz, qin) {
    if (lin && qin) return 1;
    const dx = qx - lx, dy = qy - ly;
    let t0 = 0, t1 = 1;
    if (dx > 1e-9 || dx < -1e-9) { let a = (p.x0 - lx) / dx, b = (p.x1 - lx) / dx; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
    else if (lx < p.x0 || lx > p.x1) return 1;
    if (dy > 1e-9 || dy < -1e-9) { let a = (p.y0 - ly) / dy, b = (p.y1 - ly) / dy; if (a > b) { const t = a; a = b; b = t; } if (a > t0) t0 = a; if (b < t1) t1 = b; }
    else if (ly < p.y0 || ly > p.y1) return 1;
    if (t0 > t1) return 1;   // the ray misses the block
    const z0 = lh + (qz - lh) * t0, z1 = lh + (qz - lh) * t1, z = qin ? z0 : lin ? z1 : (z0 < z1 ? z0 : z1);
    const v = (z - p.h + .25) * 2; return v < 0 ? 0 : v > 1 ? 1 : v;
  }

  // ---------------- beginFrame: collect lights, build the light buffer ----------------
  L.beginFrame = (c, lights, pl) => {
    const t0 = performance.now(), t = (t0 - T0) / 1000;
    cam = c; player = pl || player; drawn = null;
    const [cs, sn] = trig(), s = mood.sun, az = s.az * Math.PI / 180, el = s.el * Math.PI / 180;
    sunG = [Math.sin(az), -Math.cos(az)];                                   // toward the sun, on the ground
    sunV = toView(sunG[0] * Math.cos(el), sunG[1] * Math.cos(el), Math.sin(el), cs, sn);
    let all = lights;
    if (lantern) {   // held on the facing side (right hand, a little ahead), hip height; facing from the last frame
      const a = lastFace * 2 * Math.PI / lastND, fx = Math.sin(a), fy = Math.cos(a), pz = player.z || 0;
      all = lights.concat([{...LANTERN, x: player.x + fx * LANTERN.fwd - fy * LANTERN.side, y: player.y + fy * LANTERN.fwd + fx * LANTERN.side, h: pz + LANTERN.h}]);
    }
    FL = [];
    const VW = ctx.VW, VH = ctx.VH, PPM = ctx.PPM, PPMY = ctx.PPMY, PPMH = ctx.PPMH, P = plats();
    for (const l of all) {
      const r = l.radius || 4, fk = flick(l, t), gain = (l.intensity ?? 1) * fk, rr = r * (1 + (fk - 1) * .15);
      const base = elevAt(l.x, l.y); let h = l.h || 0; if (h < base - .05) h += base;   // tolerate an h relative to the surface
      const pi = base > 0 ? platIndex(l.x, l.y) : -1;
      // screen extent: the pool on the ground, plus on any plateau top it reaches
      let yA = (l.y - rr) * PPMY - cam.y, yB = (l.y + rr) * PPMY - cam.y; const near = [];
      for (let i = 0; i < P.length; i++) {
        const p = P[i]; if (l.x + rr < p.x0 || l.x - rr > p.x1 || l.y + rr < p.y0 || l.y - rr > p.y1) continue;
        near.push(i); const hp = p.h * PPMH;
        yA = Math.min(yA, Math.max(p.y0, l.y - rr) * PPMY - hp - cam.y); yB = Math.max(yB, Math.min(p.y1, l.y + rr) * PPMY - cam.y);
      }
      const xA = (l.x - rr) * PPM - cam.x, xB = (l.x + rr) * PPM - cam.x;
      if (xB < -4 || xA > VW + 4 || yB < -4 || yA > VH + 4) continue;   // no effect on the view
      const [cx, cy] = view(l.x, l.y, h);   // the flame (halo)
      FL.push({x: l.x, y: l.y, h, base, pi, near, r: rr, gain, c: rgb(l.color), cx, cy, box: [xA, yA, xB, yB]});
    }
    const lift = mood.lift;   // readability lift: a soft flat pool on the surface under the player
    if (lift[0] + lift[1] + lift[2] > 0) {
      const pz = player.z || 0, pi = platIndex(player.x, player.y), top = pi >= 0 && pz > P[pi].h - .3;
      FL.push({x: player.x, y: player.y, h: (top ? P[pi].h : 0) + .9, base: top ? P[pi].h : 0, pi: top ? pi : -1, near: [], r: 1.7, gain: 1, c: lift, flat: true,
        cx: 0, cy: 0, box: [(player.x - 1.7) * PPM - cam.x, (player.y - 1.7) * PPMY - (top ? P[pi].h * PPMH : 0) - cam.y, (player.x + 1.7) * PPM - cam.x, (player.y + 1.7) * PPMY - cam.y]});
    }
    buildBuffer(VW, VH);
    stats.acc = performance.now() - t0; stats.sprite = 0;
  };

  // ---------------- surfaces: what each buffer texel shows ----------------
  // ST: 0 ground, 1 + 2i top of plateau i, 2 + 2i its south face. WX/WY/WZ: the world point seen there.
  // AM: ambient multiplier (the face is darker; ambient occlusion at the foot of the cliff and along its sides).
  let WX, WY, WZ, ST, AM, ROWG, PR = [], surfKey = '';   // ROWG[j]: row j shows only ground; PR[i]: texel rect of plateau i's top
  function faceShade() {   // the south face against the top: in the sun's shade by day / dusk, a flat skylight at night
    const el = mood.sun.el * Math.PI / 180;
    if (!(mood.shadow.a > 0)) return FACE_NIGHT;
    const ndF = Math.max(0, sunG[1] * Math.cos(el)), ndT = Math.max(.2, Math.sin(el));
    return FACE_SHADE + (1 - FACE_SHADE) * Math.min(1, ndF / ndT);
  }
  function buildSurfaces(W, H) {
    const face = faceShade(), P = plats(), PPM = ctx.PPM, PPMY = ctx.PPMY, PPMH = ctx.PPMH;
    const key = [W, H, cam.x, cam.y, PPM, PPMY, face, P.length].join();
    if (key === surfKey) return; surfKey = key;
    const n = W * H;
    if (!WX || WX.length !== n) { WX = new Float32Array(n); WY = new Float32Array(n); WZ = new Float32Array(n); ST = new Int8Array(n); AM = new Float32Array(n); }
    if (!ROWG || ROWG.length !== H) ROWG = new Uint8Array(H);
    PR = P.map(p => { const hp = p.h * PPMH;   // texels whose centres are surely on the top
      return [Math.ceil((p.x0 * PPM - cam.x) / RS - .5), Math.floor((p.x1 * PPM - cam.x) / RS - .5),
        Math.ceil((p.y0 * PPMY - hp - cam.y) / RS - .5), Math.floor((p.y1 * PPMY - hp - cam.y) / RS - .5)]; });
    for (let j = 0, k = 0; j < H; j++) {
      const Yw = (j + .5) * RS + cam.y; let pure = 1;
      for (let i = 0; i < W; i++, k++) {
        const x = ((i + .5) * RS + cam.x) / PPM;
        let st = 0, y = Yw / PPMY, z = 0, am = 1;
        for (let pi = 0; pi < P.length; pi++) {
          const p = P[pi]; if (x < p.x0 || x > p.x1) continue;
          const hp = p.h * PPMH, top1 = p.y1 * PPMY - hp;
          if (Yw >= p.y0 * PPMY - hp && Yw <= top1) { st = 1 + 2 * pi; y = (Yw + hp) / PPMY; z = p.h; break; }
          if (Yw > top1 && Yw <= p.y1 * PPMY) { st = 2 + 2 * pi; y = p.y1; z = (p.y1 * PPMY - Yw) / PPMH; const u = 1 - z / p.h; am = face * (1 - FACE_AO * u * u); break; }
        }
        if (st === 0) for (const p of P) {   // ambient occlusion on the ground along the plateau
          if (x > p.x0 - .3 && x < p.x1 + .3 && y > p.y1 && y < p.y1 + FOOT_R) { const u = 1 - (y - p.y1) / FOOT_R; am *= 1 - FOOT_AO * u * u; }
          if (y > p.y0 && y < p.y1 + .3) {
            if (x < p.x0 && x > p.x0 - SIDE_R) { const u = 1 - (p.x0 - x) / SIDE_R; am *= 1 - SIDE_AO * u * u; }
            if (x > p.x1 && x < p.x1 + SIDE_R) { const u = 1 - (x - p.x1) / SIDE_R; am *= 1 - SIDE_AO * u * u; }
          }
        }
        WX[k] = x; WY[k] = y; WZ[k] = z; ST[k] = st; AM[k] = am; if (st) pure = 0;
      }
      ROWG[j] = pure;
    }
  }

  // ---------------- the light buffer (CPU, one texel per RS view px) ----------------
  // B = amb * AM + s * sum(lights). Each light is evaluated at the WORLD point a texel shows (ground, plateau top,
  // cliff face), so a pool lands on the surface under the light, a light below the cliff does not leak onto the top
  // (or the other way) unless it is high enough to see past the edge, and the face is lit only from the front.
  // Where the sum would blow past 1, the LIGHT part is compressed with a soft knee and one factor s for all three
  // channels: the light keeps its colour (no hard plateau, no hue rings where coloured lights overlap, explosions
  // don't flatten to white) and the ambient stays exactly as the mood says.
  let bw = 0, bh = 0, LR, LG, LB, BB, SS, bufData;
  let buf32, ibufData, ibuf32;
  function buildBuffer(VW, VH) {
    const T0b = performance.now();
    const nw = Math.ceil(VW / RS) + 1, nh = Math.ceil(VH / RS) + 1;   // +1: bilinear sampling has data at the edges
    if (nw !== bw || nh !== bh) {
      bw = nw; bh = nh; const n = bw * bh;
      LR = new Float32Array(n); LG = new Float32Array(n); LB = new Float32Array(n); BB = new Float32Array(n * 3); SS = new Float32Array(n);
      buf.width = bw; buf.height = bh; bufData = new ImageData(bw, bh); buf32 = new Uint32Array(bufData.data.buffer); surfKey = '';
      ibuf.width = bw; ibuf.height = bh; ibufData = new ImageData(bw, bh); ibuf32 = new Uint32Array(ibufData.data.buffer);
    } else { LR.fill(0); LG.fill(0); LB.fill(0); }
    buildSurfaces(bw, bh);
    const lr_ = LR, lg_ = LG, lb_ = LB, W = bw, H = bh, wx = WX, wy = WY, wz = WZ, st_ = ST, P = plats();   // locals: faster than closure slots
    for (const l of FL) {
      const cr = l.c[0] * l.gain, cg = l.c[1] * l.gain, cb = l.c[2] * l.gain, lx = l.x, ly = l.y, lh = l.h, r2 = l.r * l.r, ir2 = 1 / r2;
      const ls = l.pi >= 0 ? 1 + 2 * l.pi : 0, np = l.near, nn = np.length;
      const i0 = Math.max(0, Math.floor(l.box[0] / RS - .5)), i1 = Math.min(W - 1, Math.ceil(l.box[2] / RS - .5));
      const j0 = Math.max(0, Math.floor(l.box[1] / RS - .5)), j1 = Math.min(H - 1, Math.ceil(l.box[3] / RS - .5));
      const fast = !ls, PPM = ctx.PPM, dzz = DZK * lh * lh;
      const tr = ls ? PR[l.pi] : null, topRows = tr && i0 >= tr[0] && i1 <= tr[1], dzt = ls ? DZK * (lh - P[l.pi].h) ** 2 : 0;
      for (let j = j0; j <= j1; j++) {
        if ((fast && ROWG[j]) || (topRows && j >= tr[2] && j <= tr[3])) {   // one surface across the light's columns   // a ground-only row and a light on the ground: just this row's chord of the pool
          const dzr = fast && ROWG[j] ? dzz : dzt, dy = wy[j * W + i0] - ly, a = r2 - dy * dy - dzr; if (a <= 0) continue;
          const span = Math.sqrt(a) * PPM, cxv = lx * PPM - cam.x;
          const x0 = Math.max(i0, Math.ceil((cxv - span) / RS - .5)), x1 = Math.min(i1, Math.floor((cxv + span) / RS - .5));
          const base = (dy * dy + dzr) * ir2;
          for (let k = j * W + x0, ke = j * W + x1; k <= ke; k++) {
            const dx = wx[k] - lx, t = 1 - dx * dx * ir2 - base; if (t <= 0) continue;
            const f = t * t; lr_[k] += cr * f; lg_[k] += cg * f; lb_[k] += cb * f;
          }
          continue;
        }
        for (let k = j * W + i0, ke = j * W + i1; k <= ke; k++) {
        const dx = wx[k] - lx, dy = wy[k] - ly, d2 = dx * dx + dy * dy; if (d2 >= r2) continue;
        const z = wz[k], dz = z - lh, t = 1 - (d2 + DZK * dz * dz) * ir2; if (t <= 0) continue;
        let f = t * t;
        if (nn || ls) {
          const st = st_[k];
          if (st && !(st & 1)) {   // a south face: lit only from in front of it
            const Ly = ly - wy[k]; if (Ly <= 0) continue;
            const nd = Ly / (Math.sqrt(d2 + dz * dz) + 1e-4); f *= (nd + .2) / 1.2 * FACE_GAIN;
          } else if (st !== ls) {   // different surfaces: the plateau edge may hide the light
            const pi = st ? (st - 1) >> 1 : l.pi; f *= edgeVis(P[pi], lx, ly, lh, l.pi === pi, wx[k], wy[k], z, st !== 0);
            if (f <= 0) continue;
          }   // (ground to ground past a block is not tested: the pool would have to be wider than the block)
        }
        lr_[k] += cr * f; lg_[k] += cg * f; lb_[k] += cb * f;
        }
      }
    }
    const T1 = performance.now();
    const ar = mood.amb[0], ag = mood.amb[1], ab = mood.amb[2], K = Math.min(.97, Math.max(KNEE, ar, ag, ab)), iK = 1 / (1 - K);   // (day: K near 1, lights add ~nothing)
    const bb = BB, ss = SS, o32 = buf32, i32 = ibuf32, am_ = AM, emin = EMIT_MIN + EMIT_MIN_DARK * Math.max(0, 1 - lum(mood.amb));
    for (let k = 0, n = W * H; k < n; k++) {
      const lr = lr_[k], lg = lg_[k], lb = lb_[k], am = am_[k], er = ar * am, eg = ag * am, eb = ab * am;
      let r = er + lr, g = eg + lg, b = eb + lb, sc = 1;
      const m = r > g ? (r > b ? r : b) : (g > b ? g : b);
      if (m > K) {
        const y = (m - K) * iK * KNEE_TAIL, m2 = K + (1 - K) * y / (1 + y);   // Reinhard-style tail: stacked flashes keep a gradient
        const a0 = m === r ? er : m === g ? eg : eb, l0 = m === r ? lr : m === g ? lg : lb;
        sc = l0 > 1e-6 ? (m2 - a0) / l0 : 1; sc = sc < 0 ? 0 : sc > 1 ? 1 : sc;
        r = er + lr * sc; g = eg + lg * sc; b = eb + lb * sc;
        if (r > 1) r = 1; if (g > 1) g = 1; if (b > 1) b = 1;
      }
      ss[k] = sc; bb[k * 3] = r; bb[k * 3 + 1] = g; bb[k * 3 + 2] = b;
      o32[k] = 0xff000000 | (b * 255 + .5) << 16 | (g * 255 + .5) << 8 | (r * 255 + .5);   // little-endian RGBA
      const ir = 1 - r > emin ? 1 - r : emin, ig = 1 - g > emin ? 1 - g : emin, ib = 1 - b > emin ? 1 - b : emin;
      i32[k] = 0xff000000 | (ib * 255 + .5) << 16 | (ig * 255 + .5) << 8 | (ir * 255 + .5);
    }
    const T2 = performance.now();
    bq.putImageData(bufData, 0, 0); iq.putImageData(ibufData, 0, 0);
    L.prof = {accum: T1 - T0b, tone: T2 - T1, put: performance.now() - T2};
  }
  // sample the buffer at view px (x, y), bilinear like the upscale in apply(): out = [r, g, b, s]
  function sampleB(x, y, out) {
    let fx = x / RS - .5, fy = y / RS - .5;
    fx = fx < 0 ? 0 : fx > bw - 1.001 ? bw - 1.001 : fx; fy = fy < 0 ? 0 : fy > bh - 1.001 ? bh - 1.001 : fy;
    const i0 = fx | 0, j0 = fy | 0, u = fx - i0, v = fy - j0, k = j0 * bw + i0;
    const w00 = (1 - u) * (1 - v), w10 = u * (1 - v), w01 = (1 - u) * v, w11 = u * v, a = k * 3, b = a + 3, c = a + bw * 3, e = c + 3;
    out[0] = BB[a] * w00 + BB[b] * w10 + BB[c] * w01 + BB[e] * w11;
    out[1] = BB[a + 1] * w00 + BB[b + 1] * w10 + BB[c + 1] * w01 + BB[e + 1] * w11;
    out[2] = BB[a + 2] * w00 + BB[b + 2] * w10 + BB[c + 2] * w01 + BB[e + 2] * w11;
    out[3] = SS[k] * w00 + SS[k + 1] * w10 + SS[k + bw] * w01 + SS[k + bw + 1] * w11;
    return out;
  }
  L.flatAt = (x, y) => sampleB(x, y, [0, 0, 0, 0]);

  // ---------------- ground shadows ----------------
  const ids = new WeakMap(); let nextId = 1;
  const idOf = o => { let i = ids.get(o); if (!i) { i = nextId++; ids.set(o, i); } return i; };
  const silCache = new Map();
  let box = null, lastBox = [0, 0, 1e5, 1e5];
  function silhouette(img, sx, sy, w, h, py) {
    const key = idOf(img) + ':' + sx + ':' + sy + ':' + w + ':' + h;
    let e = silCache.get(key);
    if (e) { silCache.delete(key); silCache.set(key, e); return e; }
    const [c, q] = canvas(w, h);
    q.drawImage(img, sx, sy, w, h, 0, 0, w, h);
    q.globalCompositeOperation = 'source-in';
    const gr = q.createLinearGradient(0, py, 0, 0);   // dark at the feet, fading with height (a soft far end)
    gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(.3, 'rgba(0,0,0,.9)'); gr.addColorStop(1, 'rgba(0,0,0,.36)');
    q.fillStyle = gr; q.fillRect(0, 0, w, h);
    silCache.set(key, c);
    if (silCache.size > 500) silCache.delete(silCache.keys().next().value);
    return c;
  }
  // the same silhouette as an alpha array (0..255, the height gradient baked in), read once per image on a CPU scratch
  const alphaCache = new Map(), [sac, saq] = canvas(1, 1, {willReadFrequently: true});
  function silAlpha(img, sx, w, h, py) {
    const key = idOf(img) + ':' + sx + ':' + w + ':' + h;
    let e = alphaCache.get(key);
    if (e) { alphaCache.delete(key); alphaCache.set(key, e); return e; }
    if (!(img.width > 0)) return null;
    if (sac.width !== w || sac.height !== h) { sac.width = w; sac.height = h; } else saq.clearRect(0, 0, w, h);
    saq.drawImage(img, sx, 0, w, h, 0, 0, w, h);
    const D = saq.getImageData(0, 0, w, h).data, a = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {   // the gradient of silhouette(): 1 at the feet, .9 at 30%, .36 at the top
      const t = py > 0 ? Math.max(0, Math.min(1, (py - y) / py)) : 0, g = t < .3 ? 1 - .1 * t / .3 : .9 - .54 * (t - .3) / .7;
      for (let x = 0; x < w; x++) a[y * w + x] = D[(y * w + x) * 4 + 3] * g;
    }
    e = {a};
    alphaCache.set(key, e); if (alphaCache.size > 600) alphaCache.delete(alphaCache.keys().next().value);
    return e;
  }
  function shade(cst, kx, ky, a, airPx = 0) {
    const w = cst.sw || cst.img.width, h = cst.sh || cst.img.height, px = cst.pivot[0], py = cst.pivot[1];
    const sil = silhouette(cst.img, cst.srcX || 0, 0, w, h, py);
    // airborne (leap / fall): the shadow starts on the surface below, every pixel is airPx higher
    const e = cst.sx - px + kx * (py + airPx), f = cst.sy + airPx + ky * (py + airPx);
    mq.globalAlpha = Math.min(1, a);
    mq.setTransform(1, 0, -kx, -ky, e, f);
    mq.drawImage(sil, 0, 0);
    nShadows++;
    // bounding box of the sheared rectangle, so the fringe / tint passes only touch that part of the view
    for (let c = 0; c < 4; c++) {
      const u = c & 1 ? w : 0, v = c & 2 ? h : 0, x = u - kx * v + e, y = -ky * v + f;
      if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y;
    }
  }
  // ---- contact shadows ----
  // an AO stamp, baked once per size (black, alpha in pixel-art steps, drawn 1:1): a hard core ellipse hugging the
  // base (hw x hh), stepped falloff rings around it (AO_RING), and for tall occluders a faint wide skirt (AO_SKIRT)
  const stamps = new Map();
  function aoStamp(hw, hh, skirt) {
    const key = hw + ':' + hh + ':' + skirt; let e = stamps.get(key); if (e) return e;
    const wo = hw + AO_RING.pad + (hw > 8 ? 1 : 0), ho = hh + AO_RING.h;   // falloff ellipse
    const ws = skirt ? Math.round(wo * AO_SKIRT.w + AO_SKIRT.pad) : 0, hs = skirt ? Math.round(ho * AO_SKIRT.h) : 0;
    const W = Math.max(wo, ws), up = Math.max(ho, Math.round(hs * .6)), dn = Math.max(ho, hs), w = 2 * W + 1, h = up + dn + 1;
    const [c, q] = canvas(w, h), id = q.createImageData(w, h), d = id.data;
    const el = (x, y, a, b) => (x * x) / (a * a) + (y * y) / (b * b);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = i - W, y = j - up, yd = y < 0 ? y * 1.4 : y;   // (the half behind the base is mostly hidden: a bit tighter)
      let a = 0;
      if (el(x, yd, hw + .5, hh + .5) <= 1) a = 1;
      else { const t = el(x, yd, wo + .5, ho + .5); if (t <= .55) a = AO_RING.a[0]; else if (t <= 1) a = AO_RING.a[1]; }
      if (skirt && a < AO_SKIRT.a) { const y2 = j - up - hs * .35; if (el(x, y2, ws + .5, hs * .65 + .5) <= 1) a = Math.max(a, AO_SKIRT.a); }
      d[(j * w + i) * 4 + 3] = a * 255 + .5;
    }
    q.putImageData(id, 0, 0);
    e = {c, ox: W, oy: up};
    stamps.set(key, e); if (stamps.size > 200) stamps.delete(stamps.keys().next().value);
    return e;
  }
  // footprint of a sprite: the extent of its bottom opaque rows (up to 3, from 2 rows below the pivot up to 16 rows), relative to
  // the pivot. Read ONCE per image on a small CPU-backed scratch canvas (never the view), cached.
  const footCache = new Map(), [fpc, fpq] = canvas(1, 1, {willReadFrequently: true});
  function footprint(img, sx, w, h, px, py) {
    const key = idOf(img) + ':' + sx + ':' + w + ':' + h + ':' + px + ':' + py;
    let e = footCache.get(key); if (e !== undefined) return e;
    if (!(img.width > 0)) return null;   // not loaded yet: try again next frame
    const yb = Math.min(h - 1, Math.round(py) + 2), ya = Math.max(0, yb - 16), rh = yb - ya + 1;
    if (rh <= 0 || w <= 0) return null;
    if (fpc.width !== w || fpc.height !== rh) { fpc.width = w; fpc.height = rh; } else fpq.clearRect(0, 0, w, rh);
    fpq.drawImage(img, sx, ya, w, rh, 0, 0, w, rh);
    const D = fpq.getImageData(0, 0, w, rh).data;
    let x0 = 1e9, x1 = -1, rows = 0;
    for (let y = rh - 1; y >= 0 && rows < 3; y--) {
      let a = -1, b = -1;
      for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4) if (D[i] > 100) { if (a < 0) a = x; b = x; }
      if (a < 0) { if (rows) break; continue; }
      rows++; if (a < x0) x0 = a; if (b > x1) x1 = b;
    }
    e = x1 < 0 ? null : {cx: (x0 + x1 + 1) / 2 - px, hw: (x1 - x0 + 1) / 2};
    footCache.set(key, e); if (footCache.size > 400) footCache.delete(footCache.keys().next().value);
    return e;
  }
  function contact(cst, air, airPx) {
    const w = cst.sw || cst.img.width, h = cst.sh || cst.img.height, px = cst.pivot[0], py = cst.pivot[1];
    const fp = cst.player ? {cx: 0, hw: AO_FOOT} : footprint(cst.img, cst.srcX || 0, w, h, px, py);
    if (!fp) return;
    const up = Math.min(1, air / AO_AIR), s = 1 - .35 * up;   // airborne: smaller and fainter
    const a = Math.min(1, Math.max(.25, (py - 3) / 12)) * (1 - .65 * up);   // tiny things (tufts): a faint smudge
    if (a < .02) return;
    const hw = Math.max(1, Math.round((fp.hw + AO_PAD) * s)), hh = Math.max(1, Math.round(Math.min(AO_HMAX, Math.max(AO_HMIN, hw * AO_H)) * s));
    const st = aoStamp(hw, hh, !!cst.prop?.occluder && up < .5);
    // centred on the row under the base (the pivot row is the sprite's last row of the base)
    const x = Math.round(cst.sx + fp.cx - .5) - st.ox, y = Math.round(cst.sy + airPx) + AO_DY - st.oy;
    aq.globalAlpha = a; aq.drawImage(st.c, x, y);
    if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y;
    if (x + st.c.width > box[2]) box[2] = x + st.c.width; if (y + st.c.height > box[3]) box[3] = y + st.c.height;
    nAO++;
  }
  // shear for a shadow along ground direction (gx, gy) (unit, metres), length `len` metres per metre of height
  function shear(gx, gy, len) {
    let kx = gx * len * ctx.PPM / ctx.PPMH, ky = gy * len * ctx.PPMY / ctx.PPMH;
    if (Math.abs(ky) < .3) ky = ky > 0 ? .3 : -.3;   // a flat card casts a line when lit from the side: fake some depth
    return [kx, ky];
  }
  const hull = pts => {   // convex hull (monotone chain), for the plateau's sun shadow
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const p of pts) { while (lo.length > 1 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length > 1 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    return lo.slice(0, -1).concat(up.slice(0, -1));
  };
  L.groundShadows = (g, c, casters) => {
    const t0 = performance.now(); nShadows = 0; nAO = 0;
    const VW = ctx.VW, VH = ctx.VH, PPM = ctx.PPM, PPMY = ctx.PPMY, PPMH = ctx.PPMH, P = plats();
    for (const [cv, q] of [[mask, mq], [mask2, mq2], [aom, aq]]) if (cv.width !== VW || cv.height !== VH) { cv.width = VW; cv.height = VH; q.imageSmoothingEnabled = false; }
    mq.setTransform(1, 0, 0, 1, 0, 0); mq.globalAlpha = 1;
    aq.setTransform(1, 0, 0, 1, 0, 0); aq.globalAlpha = 1; aq.imageSmoothingEnabled = false;
    if (lastBox) { mq.clearRect(lastBox[0], lastBox[1], lastBox[2], lastBox[3]); aq.clearRect(lastBox[0], lastBox[1], lastBox[2], lastBox[3]); }
    box = [1e9, 1e9, -1e9, -1e9]; lastBox = null;
    const s = mood.sun, dark = Math.max(0, 1 - lum(mood.amb) * 1.15), sun = mood.shadow.a > 0 && s.el > 2;
    // the mask holds shadow strength relative to G (sun shadows at 1: overlaps merge instead of stacking up)
    const G = sun ? mood.shadow.a : 1, len = sun ? Math.min(SUN_LEN_MAX, 1 / Math.tan(s.el * Math.PI / 180)) : 0;
    const [skx, sky] = sun ? shear(-sunG[0], -sunG[1], len) : [0, 0];
    // plateau blocks on screen: top (y from t0 to t1) and face (t1 to foot)
    const R = P.map(p => { const hp = p.h * PPMH; return {p, x0: p.x0 * PPM - c.x, x1: p.x1 * PPM - c.x, t0: p.y0 * PPMY - hp - c.y, t1: p.y1 * PPMY - hp - c.y, foot: p.y1 * PPMY - c.y}; });
    // where each caster stands: plateau top i (its pivot is drawn at that height) or the ground (-1); air above it
    const where = cst => {
      if (cst.player) {
        const x = player.x, y = player.y, z = player.z || 0, i = platIndex(x, y), on = i >= 0 && z > P[i].h - .3;
        return {x, y, z: on ? P[i].h : 0, surf: on ? i : -1, air: Math.max(0, z - (on ? P[i].h : elevAt(x, y)))};
      }
      if (cst.prop) {   // the host passed the prop: its own position; h = height above its surface (a hopping brute)
        const p = cst.prop, z = p.z || 0, i = z > 0 ? platIndex(p.x, p.y) : -1, on = i >= 0 && z > P[i].h - .3;
        return {x: p.x, y: p.y, z: on ? P[i].h : 0, surf: on ? i : -1, air: Math.max(0, p.h || 0)};
      }
      const x = (cst.sx + c.x) / PPM;
      for (let i = 0; i < R.length; i++) { const r = R[i]; if (cst.sx >= r.x0 && cst.sx <= r.x1 && cst.sy >= r.t0 - 1 && cst.sy <= r.t1 + 1) return {x, y: (cst.sy + c.y + r.p.h * PPMH) / PPMY, z: r.p.h, surf: i, air: 0}; }
      return {x, y: (cst.sy + c.y) / PPMY, z: 0, surf: -1, air: 0};
    };
    const W = casters.map(where);
    if (OCC.length !== VW * VH) { OCC = new Float32Array(VW * VH); TMP = new Float32Array(VW * VH); }
    const occBox = [1e9, 1e9, -1e9, -1e9];
    const layer = surf => {
      for (let n = 0; n < casters.length; n++) {
        const cst = casters[n], w = W[n]; if (w.surf !== surf) continue;
        const airPx = w.air * PPMH, fade = 1 / (1 + w.air * .4);   // higher: fainter
        if (L.ao) contact(cst, w.air, airPx);
        if (sun) shade(cst, skx, sky, fade, airPx);
      }
      if (dark > .05 && L.ptShadows !== false) pointShadows(surf);
    };
    // every point light on this surface: its casters' silhouettes rasterised in JS through the same shear as shade()
    // (max per pixel: two casters don't block one light twice), then per pixel that light's share of B there. No
    // canvas here: a sheared drawImage + readback costs ~5 ms per light (deferred software raster), this ~0.2 ms.
    const SB2 = [0, 0, 0, 0];
    const pointShadows = surf => {
      const hs = surf < 0 ? 0 : P[surf].h, hp = hs * PPMH, cand = [];
      for (const l of FL) {
        if (l.flat || l.pi !== surf) continue;
        const list = [];
        for (let n = 0; n < casters.length; n++) {
          const w = W[n]; if (w.surf !== surf || (casters[n].prop && NO_PT_SHADOW.test(casters[n].prop.kind))) continue;
          const dx = w.x - l.x, dy = w.y - l.y, d2 = dx * dx + dy * dy;
          if (d2 < .25 || d2 > l.r * l.r) continue;   // the light's own prop / out of reach
          list.push([n, dx, dy, Math.sqrt(d2)]);
        }
        if (list.length) cand.push([l, list, l.gain * lum(l.c)]);
      }
      cand.sort((a, b) => b[2] - a[2]);
      // the surface: ground = outside every plateau block (top + face), plateau i = its top only
      const inSurf = surf < 0 ? (x, y) => { for (const r of R) if (x >= r.x0 && x < r.x1 && y >= r.t0 && y < r.foot) return false; return true; }
        : (r => (x, y) => x >= r.x0 && x < r.x1 && y >= r.t0 && y < r.t1)(R[surf]);
      for (const [l, list] of cand.slice(0, PTS.lights)) {
        let bx0 = 1e9, by0 = 1e9, bx1 = -1e9, by1 = -1e9;
        for (const [n, dx, dy, d] of list) {
          const cst = casters[n], w = W[n], ln = Math.max(.3, Math.min(1.25, d / Math.max(.6, l.h - w.z) * .8)), [kx, ky] = shear(dx / d, dy / d, ln);
          const sw = cst.sw || cst.img.width, sh = cst.sh || cst.img.height, px = cst.pivot[0], py = cst.pivot[1];
          const sa = silAlpha(cst.img, cst.srcX || 0, sw, sh, py); if (!sa) continue;
          const airPx = w.air * PPMH, fade = 1 / (1 + w.air * .4);
          const e = cst.sx - px + kx * (py + airPx), f = cst.sy + airPx + ky * (py + airPx);
          // destination box of the sheared rectangle (x = u - kx v + e, y = f - ky v)
          let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
          for (let c4 = 0; c4 < 4; c4++) { const u = c4 & 1 ? sw : 0, v = c4 & 2 ? sh : 0, x = u - kx * v + e, y = f - ky * v;
            if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
          x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(VW, Math.ceil(x1)); y1 = Math.min(VH, Math.ceil(y1));
          const A = sa.a, fa = fade * 255;
          for (let y = y0; y < y1; y++) {
            const v = Math.floor((f - (y + .5)) / ky); if (v < 0 || v >= sh) continue;
            const ub = e - kx * v, row = v * sw, o = y * VW;
            for (let x = x0; x < x1; x++) {
              const u = Math.floor(x + .5 - ub); if (u < 0 || u >= sw) continue;
              const al = A[row + u]; if (!al) continue;
              const val = al * fade; if (val > TMP[o + x]) TMP[o + x] = val;
            }
          }
          if (x0 < bx0) bx0 = x0; if (y0 < by0) by0 = y0; if (x1 > bx1) bx1 = x1; if (y1 > by1) by1 = y1;
        }
        if (bx1 <= bx0 || by1 <= by0) continue;
        const lc = lum(l.c) * l.gain, ir2 = 1 / (l.r * l.r), dz = hs - l.h;
        let any = false;
        for (let y = by0; y < by1; y++) for (let x = bx0, k = y * VW + bx0; x < bx1; x++, k++) {
          const a = TMP[k]; if (!a) continue; TMP[k] = 0;
          if (!inSurf(x + .5, y + .5)) continue;
          const X = x + .5, Y = y + .5, dx = (X + c.x) / PPM - l.x, dy = (Y + c.y + hp) / PPMY - l.y;
          const t = 1 - (dx * dx + dy * dy + DZK * dz * dz) * ir2; if (t <= 0) continue;
          sampleB(X, Y, SB2); const Bl = lum(SB2);
          let fr = lc * t * t * SB2[3] / (Bl > .02 ? Bl : .02); if (fr > 1) fr = 1;
          OCC[k] += a / 255 * fr; any = true;
        }
        if (!any) continue;
        if (bx0 < occBox[0]) occBox[0] = bx0; if (by0 < occBox[1]) occBox[1] = by0; if (bx1 > occBox[2]) occBox[2] = bx1; if (by1 > occBox[3]) occBox[3] = by1;
      }
    };
    // 1) the ground: everything outside the plateau blocks (their top and face are drawn over the ground)
    for (const q of [mq, aq]) {
      q.save(); q.beginPath(); q.rect(0, 0, VW, VH);
      for (const r of R) q.rect(r.x0, r.t0, r.x1 - r.x0, r.foot - r.t0);
      q.clip('evenodd');
    }
    if (sun) for (const r of R) {   // the plateau's own shadow: its footprint swept along the sun
      const p = r.p, ox = -sunG[0] * p.h * len, oy = -sunG[1] * p.h * len, pts = [];
      for (const [x, y] of [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]]) pts.push([x, y], [x + ox, y + oy]);
      const hp = hull(pts).map(([x, y]) => [x * PPM - c.x, y * PPMY - c.y]);
      mq.globalAlpha = 1; mq.fillStyle = '#000'; mq.beginPath(); hp.forEach(([x, y], i) => i ? mq.lineTo(x, y) : mq.moveTo(x, y)); mq.fill();
      for (const [x, y] of hp) { if (x < box[0]) box[0] = x; if (y < box[1]) box[1] = y; if (x > box[2]) box[2] = x; if (y > box[3]) box[3] = y; }
      nShadows++;
    }
    layer(-1);
    mq.restore(); aq.restore();
    // 2) each plateau top: its casters' shadows stay on it
    for (let i = 0; i < R.length; i++) {
      if (!W.some(w => w.surf === i)) continue;
      const r = R[i];
      for (const q of [mq, aq]) { q.save(); q.beginPath(); q.rect(r.x0, r.t0, r.x1 - r.x0, r.t1 - r.t0); q.clip(); }
      layer(i); mq.restore(); aq.restore();
    }
    mq.setTransform(1, 0, 0, 1, 0, 0); mq.globalAlpha = 1; aq.globalAlpha = 1;
    if (occBox[2] > occBox[0]) {   // point-light occlusion -> the shadow mask (relative to G, like the rest of it)
      const [ox0, oy0, ox1, oy1] = occBox, ow = ox1 - ox0, oh = oy1 - oy0;
      if (oc.width !== ow || oc.height !== oh) { oc.width = ow; oc.height = oh; }
      const id = oq.createImageData(ow, oh), d = id.data;
      for (let y = oy0; y < oy1; y++) for (let x = ox0; x < ox1; x++) {
        const k = y * VW + x, v = OCC[k]; if (!v) continue; OCC[k] = 0;
        const a = Math.min(1, Math.min(PTS.max, v * PTS.gain) / G); d[((y - oy0) * ow + x - ox0) * 4 + 3] = a * 255 + .5;
      }
      oq.putImageData(id, 0, 0); mq.drawImage(oc, ox0, oy0); nShadows++;
      if (ox0 < box[0]) box[0] = ox0; if (oy0 < box[1]) box[1] = oy0; if (ox1 > box[2]) box[2] = ox1; if (oy1 > box[3]) box[3] = oy1;
    }
    const x0 = Math.max(0, Math.floor(box[0]) - 2), y0 = Math.max(0, Math.floor(box[1]) - 2);
    const x1 = Math.min(VW, Math.ceil(box[2]) + 2), y1 = Math.min(VH, Math.ceil(box[3]) + 2), bw = x1 - x0, bh = y1 - y0;
    if ((nShadows || nAO) && bw > 0 && bh > 0) {
      lastBox = [x0, y0, bw, bh];
      mq2.setTransform(1, 0, 0, 1, 0, 0); mq2.globalCompositeOperation = 'source-over'; mq2.clearRect(x0 - 1, y0 - 1, bw + 2, bh + 2);
      if (nShadows) {
        // cast shadows: soft fringe (1 px, 4-neighbour) + the mask, then scaled to their opacity G ('destination-in'
        // is unbounded: it also clears anything left outside the rect)
        mq2.globalAlpha = FRINGE;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) mq2.drawImage(mask, x0, y0, bw, bh, x0 + ox, y0 + oy, bw, bh);
        mq2.globalAlpha = 1; mq2.drawImage(mask, x0, y0, bw, bh, x0, y0, bw, bh);
        mq2.globalCompositeOperation = 'destination-in'; mq2.globalAlpha = G; mq2.fillStyle = '#000'; mq2.fillRect(x0 - 1, y0 - 1, bw + 2, bh + 2);
        mq2.globalCompositeOperation = 'source-over';
      }
      // contact shadows over them (inside a cast shadow they darken it further: occluded skylight)
      if (nAO) { mq2.globalAlpha = Math.min(1, mood.shadow.ao ?? AO_A); mq2.drawImage(aom, x0, y0, bw, bh, x0, y0, bw, bh); }
      // tint, then lay it on the ground (only inside the box)
      mq2.globalAlpha = 1; mq2.globalCompositeOperation = 'source-atop'; mq2.fillStyle = css(mood.shadow.c); mq2.fillRect(x0 - 1, y0 - 1, bw + 2, bh + 2);
      mq2.globalCompositeOperation = 'source-over';
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.drawImage(mask2, x0 - 1, y0 - 1, bw + 2, bh + 2, x0 - 1, y0 - 1, bw + 2, bh + 2); g.restore();
    } else if (nShadows || nAO) lastBox = [0, 0, VW, VH];
    stats.acc += performance.now() - t0;
  };

  // ---------------- the player, lit per pixel by its normal map ----------------
  const frames = new Map();
  let outData = null, drawn = null, NL = new Float64Array(64), lastFace = 0, lastND = 16;   // drawn: where the player went this frame (masks glow from things behind it)
  function frameData(img, nrm, sx, sy, w, h, fresh = false) {   // fresh: an image redrawn every frame (no cache)
    const key = idOf(img) + ':' + idOf(nrm) + ':' + sx + ':' + sy + ':' + w + ':' + h;
    let e = fresh ? null : frames.get(key);
    if (e) { frames.delete(key); frames.set(key, e); return e; }
    if (rd.width !== w || rd.height !== h) { rd.width = w; rd.height = h; }
    rq.clearRect(0, 0, w, h); rq.drawImage(img, sx, sy, w, h, 0, 0, w, h); const A = rq.getImageData(0, 0, w, h).data;
    rq.clearRect(0, 0, w, h); rq.drawImage(nrm, sx, sy, w, h, 0, 0, w, h); const N = rq.getImageData(0, 0, w, h).data;
    let n = 0; for (let i = 3; i < A.length; i += 4) if (A[i]) n++;
    const idx = new Uint16Array(n), alb = new Uint8ClampedArray(n * 4), nv = new Float32Array(n * 3), edge = new Uint8Array(n);
    const clear = (x, y) => x < 0 || y < 0 || x >= w || (y < h && !A[(y * w + x) * 4 + 3]);   // (a crop line is not an outline)
    const [cs, sn] = trig();
    for (let i = 0, k = 0; i < w * h; i++) {
      if (!A[i * 4 + 3]) continue;
      idx[k] = i; alb.set(A.subarray(i * 4, i * 4 + 4), k * 4);
      { const u = i % w, v = (i - u) / w; edge[k] = clear(u - 1, v) || clear(u + 1, v) || clear(u, v - 1) || clear(u, v + 1) ? 1 : 0; }
      let x = 0, y = -sn, z = cs;   // missing normal: a surface facing the camera horizontally
      if (N[i * 4 + 3] > 8) {
        x = N[i * 4] / 127.5 - 1; y = N[i * 4 + 1] / 127.5 - 1; z = N[i * 4 + 2] / 127.5 - 1;
        const l = Math.hypot(x, y, z) || 1; x /= l; y /= l; z /= l;
      }
      nv[k * 3] = x; nv[k * 3 + 1] = y; nv[k * 3 + 2] = z; k++;
    }
    // a few representative normals (evenly spread over the pixels) to normalise each light's shading
    const rep = new Float32Array(Math.min(n, 96) * 3);
    for (let j = 0, m = rep.length / 3; j < m; j++) { const k = Math.floor((j + .5) * n / m) * 3; rep.set(nv.subarray(k, k + 3), j * 3); }
    e = {idx, alb, nv, edge, n, rep};
    if (!fresh) { frames.set(key, e); if (frames.size > 400) frames.delete(frames.keys().next().value); }
    return e;
  }
  // BANDED (integration step 2, V key): the per-pixel light D is snapped to 3 bands (shadow / mid / lit, by its
  // luminance relative to the sprite's mean), single stray pixels join their neighbours' band, and every pixel of a
  // band gets that band's MEAN light colour. The character then reads as flat clusters in its own palette (like the
  // environment's art) instead of ~200 smooth shades; the bands still carry the direction and colour of the lights.
  L.banded = false;
  L.BAND = {lo: .9, hi: 1.1};
  let bandD = new Float32Array(0), bandB = new Float32Array(0), bandI = new Int8Array(0), bandPx = new Int32Array(0);
  function ensureBand(n, wh) {
    if (bandD.length < n * 3) { bandD = new Float32Array(n * 3); bandB = new Float32Array(n * 3); bandI = new Int8Array(n); }
    if (bandPx.length < wh) bandPx = new Int32Array(wh);
  }
  function bandPass(e, w, o, GR) {
    const {idx, alb, n} = e, lo = L.BAND.lo, hi = L.BAND.hi;
    let mean = 0;
    for (let k = 0; k < n; k++) mean += lum([bandD[k * 3], bandD[k * 3 + 1], bandD[k * 3 + 2]]);
    mean = mean / n || 1;
    for (let k = 0; k < n; k++) { const r = lum([bandD[k * 3], bandD[k * 3 + 1], bandD[k * 3 + 2]]) / mean; bandI[k] = r > hi ? 2 : r < lo ? 0 : 1; }
    // stray pixels: a pixel whose band no 4-neighbour shares (with 3+ opaque neighbours) takes the majority band
    bandPx.fill(-1, 0, bandPx.length); for (let k = 0; k < n; k++) bandPx[idx[k]] = k;
    const fix = [];
    for (let k = 0; k < n; k++) {
      const i = idx[k], u = i % w, c = [0, 0, 0]; let m = 0, same = 0;
      for (const j of [u > 0 ? i - 1 : -1, u < w - 1 ? i + 1 : -1, i - w, i + w]) {
        const q = j >= 0 && j < bandPx.length ? bandPx[j] : -1; if (q < 0) continue; m++; c[bandI[q]]++; if (bandI[q] === bandI[k]) same++;
      }
      if (m >= 3 && !same) fix.push(k, c[0] >= c[1] && c[0] >= c[2] ? 0 : c[1] >= c[2] ? 1 : 2);
    }
    for (let f = 0; f < fix.length; f += 2) bandI[fix[f]] = fix[f + 1];
    const M = [0, 0, 0, 0, 0, 0, 0, 0, 0], N = [0, 0, 0];
    for (let k = 0; k < n; k++) { const b = bandI[k] * 3; M[b] += bandD[k * 3]; M[b + 1] += bandD[k * 3 + 1]; M[b + 2] += bandD[k * 3 + 2]; N[bandI[k]]++; }
    for (let b = 0; b < 3; b++) if (N[b]) { M[b * 3] /= N[b]; M[b * 3 + 1] /= N[b]; M[b * 3 + 2] /= N[b]; }
    L.bandShare = N.map(c => +(c / n).toFixed(2));
    let sR = 0, sG = 0, sB = 0;
    for (let k = 0; k < n; k++) {
      const b = bandI[k] * 3, k3 = k * 3;
      let rr = M[b] / (bandB[k3] > .02 ? bandB[k3] : .02), rg = M[b + 1] / (bandB[k3 + 1] > .02 ? bandB[k3 + 1] : .02), rb = M[b + 2] / (bandB[k3 + 2] > .02 ? bandB[k3 + 2] : .02);
      rr = rr < RATIO_MIN ? RATIO_MIN : rr > RATIO_MAX ? RATIO_MAX : rr;
      rg = rg < RATIO_MIN ? RATIO_MIN : rg > RATIO_MAX ? RATIO_MAX : rg;
      rb = rb < RATIO_MIN ? RATIO_MIN : rb > RATIO_MAX ? RATIO_MAX : rb;
      sR += rr; sG += rg; sB += rb;
      const p = idx[k] * 4, a4 = k * 4;
      const ar = alb[a4], ag = alb[a4 + 1], ab = alb[a4 + 2], al = ar * .3 + ag * .55 + ab * .15;
      o[p] = SOFT[(ar * GR[0] + al * GR[1]) * rr | 0]; o[p + 1] = SOFT[(ag * GR[0] + al * GR[2]) * rg | 0]; o[p + 2] = SOFT[(ab * GR[0] + al * GR[3]) * rb | 0]; o[p + 3] = alb[a4 + 3];
    }
    return [sR, sG, sB];
  }
  // world.prop (3D props, arena/props3d.js): the same per-pixel light, but none of the PLAYER-only state (drawn,
  // lastFace, spriteRatio) and none of the character-only terms (readability fill, biome grade: prop art is already
  // in its biome's colours); the surface lift only as far as it reaches in the buffer (a pool around the player)
  const outDatas = new Map(), propLit = new Map();
  L.drawSprite = (g, img, nrm, sx, sy, w, h, dx, dy, world) => {
    const isProp = !!world?.prop;
    if (!nrm || (!(nrm instanceof HTMLCanvasElement) && (!nrm.complete || !nrm.naturalWidth))) {   // (a canvas: always ready)
      if (world?.face !== undefined) { lastFace = world.face; lastND = world.nd ?? Math.max(1, Math.round(img.width / w)); }
      g.drawImage(img, sx, sy, w, h, dx, dy, w, h);
      if (!isProp) drawn = {img, sx, sy, w, h, dx, dy, y: world?.y ?? player.y, feet: view(world?.x ?? player.x, world?.y ?? player.y, world?.z ?? 0)[1]};
      return;
    }
    const t0 = performance.now();
    const e = frameData(img, nrm, sx, sy, w, h, !!world?.fresh);
    const [cs, sn] = trig(), PPM = ctx.PPM, PPMH = ctx.PPMH;
    const wx = world?.x ?? player.x, wy = world?.y ?? player.y, wz = world?.z ?? player.z ?? 0;
    if (world?.face !== undefined) { lastFace = world.face; lastND = world.nd ?? Math.max(1, Math.round(img.width / w)); }
    const [px0, py0] = view(wx, wy, wz);
    // lights that can reach this sprite in 3D, each with how much of it gets past a plateau edge (at the hip)
    const near = [], vis = [], P = plats(), pi = platIndex(wx, wy), onTop = pi >= 0 && wz > P[pi].h - .3;
    for (const l of FL) {
      if (l.flat || Math.hypot(l.x - wx, l.y - wy) >= l.r + .6) continue;
      let v = 1;
      for (let i = 0; i < P.length && v > 0; i++) {
        const lin = l.pi === i, qin = onTop && pi === i;
        if (lin !== qin || l.near.includes(i)) v *= edgeVis(P[i], l.x, l.y, l.h, lin, wx, wy, wz + .9, qin);
      }
      if (v > 0) { near.push(l); vis.push(v); }
    }
    const pd = isProp ? Math.hypot(wx - player.x, wy - player.y) / 1.7 : 0, pk = pd < 1 ? (1 - pd * pd) * (1 - pd * pd) : 0;
    // a prop that no point light reaches (and outside the lift pool) is lit by the mood alone: reuse its lit result
    let propKey = null;
    if (isProp && !near.length && !pk && !world.fresh) {
      propKey = idOf(img) + ':' + idOf(nrm) + ':' + sx + ':' + sy + ':' + w + ':' + h + '|' + biome + ':' + L.time + ':' + (L.banded ? 1 : 0);
      const c = propLit.get(propKey);
      if (c) { g.drawImage(c, dx, dy); const ms = performance.now() - t0; stats.sprite += ms; stats.acc += ms; return; }
    }
    const lift = isProp ? mood.lift.map(v => v * pk) : mood.lift, f0 = isProp ? [0, 0, 0] : mood.fill || [0, 0, 0], la = Math.max(.02, lum(mood.amb)), fk = lum(f0) / la * CHAR.fillK;
    const fill = mood.amb.map(v => v * fk), FC = CHAR.fillCap;   // the fill in the ambient's hue, capped per pixel below
    // grade: each albedo pixel moves gk of the way toward the biome's colour at its own luminance (a partial recolour,
    // like the props' per-biome art); GR = [1 - gk, cast r * gk, cast g * gk, cast b * gk]
    const gk = isProp ? 0 : CHAR.gradeK[TIMES[L.time]] ?? .2, gc = GRADE[biome] || [1, 1, 1], GR = [1 - gk, gc[0] * gk, gc[1] * gk, gc[2] * gk];
    const m = mood, amb = m.amb, s = m.sun, sMax = Math.max(...s.c), tint = s.c.map(v => v / sMax);
    const [Sx, Sy, Sz] = sunV, sxy = Math.hypot(Sx, Sy) || 1, sunRim = Sz < 0 ? m.sun.rim * Math.min(1, -Sz * 2.5) : 0;
    const ok = w * 4096 + h;   // one ImageData per size (props alternate sizes every call)
    outData = outDatas.get(ok); if (!outData) { outData = new ImageData(w, h); outDatas.set(ok, outData); }
    const o = outData.data; o.fill(0);
    const {idx, alb, nv, edge, n} = e, nl = near.length, SB = [0, 0, 0, 0];
    if (L.banded) ensureBand(n, w * h);
    let sR = 0, sG = 0, sB = 0;
    if (NL.length < nl * 9) NL = new Float64Array(nl * 9);
    // per light: its mean wrapped N.L over the representative normals, seen from the sprite's middle (0.9 m)
    const rp = e.rep, nr = rp.length / 3, meanOf = (vx, vy, vz, wrap) => {
      let acc = 0;
      for (let j = 0; j < nr * 3; j += 3) { const d = rp[j] * vx + rp[j + 1] * vy + rp[j + 2] * vz; if (d > -wrap) acc += (d + wrap) / (1 + wrap); }
      return acc / nr;
    };
    near.forEach((l, j) => {
      const Lx = l.x - wx, Ly = l.y - wy, Lh = l.h - wz - .9, d = Math.sqrt(Lx * Lx + Ly * Ly + Lh * Lh) || 1;
      const mean = meanOf(Lx / d, (-Ly * sn + Lh * cs) / d, (Ly * cs + Lh * sn) / d, WRAP_PT);
      NL.set([l.x, l.y, l.h, l.r * l.r, GAIN_PT / Math.max(NORM_MIN, mean), l.c[0], l.c[1], l.c[2], l.gain * vis[j]], j * 9);
    });
    const MEAN_SUN = meanOf(sunV[0], sunV[1], sunV[2], WRAP_SUN);
    for (let k = 0; k < n; k++) {
      const i = idx[k], u = i % w, v = (i - u) / w, X = dx + u + .5, Y = dy + v + .5;
      const nx = nv[k * 3], ny = nv[k * 3 + 1], nz = nv[k * 3 + 2];
      // B: what the multiply layer will give this pixel; sc: its light compression (applied to our lights too)
      sampleB(X, Y, SB); const Br = SB[0], Bg = SB[1], Bb = SB[2], sc = SB[3];
      // flat extras: the ground lift around him (in the buffer too) and a fill on the character only (readability)
      const Fr = lift[0] * sc * .9 + Math.min(fill[0], Br * FC), Fg = lift[1] * sc * .9 + Math.min(fill[1], Bg * FC), Fb = lift[2] * sc * .9 + Math.min(fill[2], Bb * FC);
      // D: what it should get given its normal. Ambient shaped by the sun / moon direction (re-centred)
      const ds = nx * Sx + ny * Sy + nz * Sz, ws = (ds + WRAP_SUN) / (1 + WRAP_SUN), q = s.k * ((ws > 0 ? ws : 0) - MEAN_SUN);
      let Dr = amb[0] * (1 + q * tint[0]) + Fr, Dg = amb[1] * (1 + q * tint[1]) + Fg, Db = amb[2] * (1 + q * tint[2]) + Fb;
      if (sunRim) {   // moon / low sun behind: rim on the edges that face it
        const e2 = 1 - (nz > 0 ? nz : 0), side = (nx * Sx + ny * Sy) / sxy;
        if (side > -.6) { const r = sunRim * (edge[k] ? RIM_EDGE : e2 * e2 * .5) * (.6 + side) / 1.6; Dr += s.c[0] * r; Dg += s.c[1] * r; Db += s.c[2] * r; }
      }
      // point lights in 3D: pixel position = on the sprite card at the player's depth, height from the pivot
      if (nl) {
        const xm = wx + (X - px0) / PPM, hm = wz + (py0 - Y) / PPMH;
        for (let j = 0; j < nl * 9; j += 9) {
          const Lx = NL[j] - xm, Ly = NL[j + 1] - wy, Lh = NL[j + 2] - hm, d2 = Lx * Lx + Ly * Ly + Lh * Lh, r2 = NL[j + 3];
          if (d2 >= r2) continue;
          const t = 1 - d2 / r2, att = t * t * NL[j + 8], d = Math.sqrt(d2) + 1e-4;
          const vx = Lx / d, vy = (-Ly * sn + Lh * cs) / d, vz = (Ly * cs + Lh * sn) / d;
          const ndl = nx * vx + ny * vy + nz * vz;
          let k2 = ndl > -WRAP_PT ? (ndl + WRAP_PT) / (1 + WRAP_PT) * NL[j + 4] : 0;
          if (vz < 0) {   // light behind the character: rim on the silhouette edges facing it
            const e2 = 1 - (nz > 0 ? nz : 0), sl = Math.sqrt(vx * vx + vy * vy) || 1, side = (nx * vx + ny * vy) / sl;
            if (side > -.6) k2 += RIM_PT * -vz * (edge[k] ? RIM_EDGE : e2 * e2 * .5) * (.6 + side) / 1.6;
          }
          const a = att * k2 * sc; Dr += NL[j + 5] * a; Dg += NL[j + 6] * a; Db += NL[j + 7] * a;
        }
      }
      if (L.banded) { const k3 = k * 3; bandD[k3] = Dr; bandD[k3 + 1] = Dg; bandD[k3 + 2] = Db; bandB[k3] = Br; bandB[k3 + 1] = Bg; bandB[k3 + 2] = Bb; continue; }
      let rr = Dr / (Br > .02 ? Br : .02), rg = Dg / (Bg > .02 ? Bg : .02), rb = Db / (Bb > .02 ? Bb : .02);
      rr = rr < RATIO_MIN ? RATIO_MIN : rr > RATIO_MAX ? RATIO_MAX : rr;
      rg = rg < RATIO_MIN ? RATIO_MIN : rg > RATIO_MAX ? RATIO_MAX : rg;
      rb = rb < RATIO_MIN ? RATIO_MIN : rb > RATIO_MAX ? RATIO_MAX : rb;
      sR += rr; sG += rg; sB += rb;
      const p = i * 4, a4 = k * 4;
      const ar = alb[a4], ag = alb[a4 + 1], ab = alb[a4 + 2], al = ar * .3 + ag * .55 + ab * .15;
      o[p] = SOFT[(ar * GR[0] + al * GR[1]) * rr | 0]; o[p + 1] = SOFT[(ag * GR[0] + al * GR[2]) * rg | 0]; o[p + 2] = SOFT[(ab * GR[0] + al * GR[3]) * rb | 0]; o[p + 3] = alb[a4 + 3];
    }
    if (L.banded) [sR, sG, sB] = bandPass(e, w, o, GR);
    if (scr.width < w || scr.height < h) { scr.width = Math.max(scr.width, w); scr.height = Math.max(scr.height, h); }   // grow only
    sq.putImageData(outData, 0, 0);   // (overwrites its whole w x h rect, alpha included)
    g.drawImage(scr, 0, 0, w, h, dx, dy, w, h);
    if (!isProp) { L.spriteRatio = [sR / n, sG / n, sB / n]; drawn = {img: scr, sx: 0, sy: 0, w, h, dx, dy, y: wy, feet: py0}; }   // mean light ratio on the player (debug)
    if (propKey) {   // (a GPU canvas: drawing it later is cheap, unlike the CPU scratch canvas)
      const c = document.createElement('canvas'); c.width = w; c.height = h; c.getContext('2d').drawImage(scr, 0, 0, w, h, 0, 0, w, h);
      propLit.set(propKey, c); if (propLit.size > 800) propLit.delete(propLit.keys().next().value);
    }
    const ms = performance.now() - t0; stats.sprite += ms; stats.acc += ms;
  };

  // ---------------- apply: multiply the light layer, add glow ----------------
  L.apply = (g, c, emitters) => {
    const t0 = performance.now(), VW = ctx.VW, VH = ctx.VH, dark = Math.max(0, 1 - lum(mood.amb));
    g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1;
    g.globalCompositeOperation = 'multiply';
    g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'low';
    g.drawImage(buf, 0, 0, buf.width, buf.height, 0, 0, buf.width * RS, buf.height * RS);
    g.imageSmoothingEnabled = false;
    g.globalCompositeOperation = 'lighter';
    // Glow is added on top of everything, so glow from things BEHIND the player (further north, overlapping its
    // rectangle) goes to a side layer first, the player's silhouette is cut out of it, then it is added.
    const P = drawn, overlaps = (x0, y0, x1, y1) => P && x1 > P.dx && x0 < P.dx + P.w && y1 > P.dy && y0 < P.dy + P.h;
    let fxUsed = false;
    const target = behind => {
      if (!behind) return g;
      if (!fxUsed) {
        if (fx.width !== VW || fx.height !== VH) { fx.width = VW; fx.height = VH; fq.imageSmoothingEnabled = false; }
        fq.setTransform(1, 0, 0, 1, 0, 0); fq.globalAlpha = 1; fq.globalCompositeOperation = 'source-over';
        fq.clearRect(0, 0, VW, VH); fq.globalCompositeOperation = 'lighter'; fxUsed = true;
      }
      return fq;
    };
    // soft halo around strong lights (at the flame, not on the ground)
    const glow = mood.glow ?? 1;
    for (const l of FL) {
      if (l.flat) continue;
      const a = Math.min(.75, HALO_A * l.gain * glow * (.3 + .7 * dark) + Math.max(0, l.gain - 1.5) * .12); if (a < .02) continue;   // flashes read by day too
      const x = l.cx, y = l.cy, r = (HALO_R + .12 * Math.min(2, l.gain) + Math.max(0, l.gain - 1.3) * .35) * ctx.PPM;   // flashes: wider
      const q = target(P && l.y < P.y && overlaps(x - r, y - r, x + r, y + r));
      q.globalAlpha = Math.min(1, a); q.imageSmoothingEnabled = true;
      q.drawImage(tex(l.c), x - r, y - r * .9, 2 * r, 1.8 * r); q.imageSmoothingEnabled = false;
    }
    // Emissive pixels ADD back what the multiply took away: emit * (1 - B). A glowing pixel therefore looks as
    // authored under any light (day, a lava pool's own light) and never blows out to flat yellow; in the dark it
    // glows. (EMIT_GAIN a touch over 1 lets it read as a light source.) Emitters in front of the player that overlap
    // him are the rare exception: they are added directly (they are not behind him).
    let emUsed = false, cut = false;
    const emLayer = () => {
      if (!emUsed) {
        if (em.width !== VW || em.height !== VH) { em.width = VW; em.height = VH; eq.imageSmoothingEnabled = false; }
        eq.setTransform(1, 0, 0, 1, 0, 0); eq.globalAlpha = 1; eq.globalCompositeOperation = 'source-over'; eq.clearRect(0, 0, VW, VH); emUsed = true;
      }
      return eq;
    };
    const list = [];
    for (const e of emitters) {
      const w = e.img.width, h = e.img.height;
      let sx = 0, sy = 0, cw = w, ch = h, behind;
      if (w > VW * 1.2 || h > VH * 1.2) {   // a ground-sized layer (lava, runes): only the visible part; behind the player
        sx = Math.max(0, -e.x); sy = Math.max(0, -e.y); cw = Math.min(w - sx, VW - Math.max(0, e.x)); ch = Math.min(h - sy, VH - Math.max(0, e.y));
        if (cw <= 0 || ch <= 0) continue;
        behind = true;
      } else behind = !P || e.y + h < P.feet;
      const ov = overlaps(e.x + sx, e.y + sy, e.x + sx + cw, e.y + sy + ch);
      if (ov && !behind) { g.globalAlpha = Math.max(.3, Math.min(1, 1.25 - lum(mood.amb) * .95)); g.drawImage(e.img, sx, sy, cw, ch, e.x + sx, e.y + sy, cw, ch); continue; }
      if (ov) cut = true;
      list.push([e, sx, sy, cw, ch]);
    }
    if (list.length) {
      const q = emLayer();
      for (const [e, sx, sy, cw, ch] of list) q.drawImage(e.img, sx, sy, cw, ch, e.x + sx, e.y + sy, cw, ch);
      q.imageSmoothingEnabled = true; q.imageSmoothingQuality = 'low';
      q.globalAlpha = 1; q.globalCompositeOperation = 'multiply';   // colour * (1 - B)
      q.drawImage(ibuf, 0, 0, ibuf.width, ibuf.height, 0, 0, ibuf.width * RS, ibuf.height * RS);
      // multiply painted the transparent parts too: back to the emitters' alpha. ONE destination-in with the UNION of
      // all emitters (one per emitter kept only where they all overlap: two or more on screen wiped each other out)
      if (list.length === 1) { const [e, sx, sy, cw, ch] = list[0]; q.globalCompositeOperation = 'destination-in'; q.drawImage(e.img, sx, sy, cw, ch, e.x + sx, e.y + sy, cw, ch); }
      else {
        if (emk.width !== VW || emk.height !== VH) { emk.width = VW; emk.height = VH; }
        ekq.setTransform(1, 0, 0, 1, 0, 0); ekq.globalAlpha = 1; ekq.globalCompositeOperation = 'source-over'; ekq.imageSmoothingEnabled = false; ekq.clearRect(0, 0, VW, VH);
        for (const [e, sx, sy, cw, ch] of list) ekq.drawImage(e.img, sx, sy, cw, ch, e.x + sx, e.y + sy, cw, ch);
        q.globalCompositeOperation = 'destination-in'; q.drawImage(emk, 0, 0);
      }
      q.imageSmoothingEnabled = false;
      if (cut) { q.globalCompositeOperation = 'destination-out'; q.drawImage(P.img, P.sx, P.sy, P.w, P.h, P.dx, P.dy, P.w, P.h); }
      q.globalCompositeOperation = 'source-over';
      g.globalAlpha = Math.min(1, EMIT_GAIN); g.drawImage(em, 0, 0);
      if (EMIT_GAIN > 1) { g.globalAlpha = EMIT_GAIN - 1; g.drawImage(em, 0, 0); }
    }
    if (fxUsed) {
      fq.globalAlpha = 1; fq.globalCompositeOperation = 'destination-out';
      fq.drawImage(P.img, P.sx, P.sy, P.w, P.h, P.dx, P.dy, P.w, P.h);
      g.globalAlpha = 1; g.drawImage(fx, 0, 0);
    }
    // fog / haze: a faint added tint, stronger toward the far (top) edge
    const f = mood.fog;
    if (f[3] > 0) {
      g.globalAlpha = 1;
      const gr = g.createLinearGradient(0, 0, 0, VH);
      gr.addColorStop(0, css(f, f[3])); gr.addColorStop(1, css(f, f[3] * .35));
      g.fillStyle = gr; g.fillRect(0, 0, VW, VH);
    }
    g.restore();
    const ms = stats.acc + performance.now() - t0;
    hist[stats.n++ % hist.length] = ms; stats.ms = hist.reduce((a, b) => a + b, 0) / Math.min(stats.n, hist.length);
    L.lastMs = ms;
    L.debug = `${TIMES[L.time]}${lantern ? ' + lantern' : ''} · ${FL.filter(l => !l.flat).length} lights · ${nShadows} shadows · light ${stats.ms.toFixed(2)} ms`;
  };

  L.ao = true;   // contact shadows on / off (debug, A/B)
  L.canvases = {buf, mask, mask2, aom};   // debug: the light buffer and the shadow masks
  refreshMood();
  return L;
}
