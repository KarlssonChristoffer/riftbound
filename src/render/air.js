// THE AIR: one moving-air field round the view that everything that blows air pushes into (features/airfx.js: shots, blasts,
// movers, fires), and that the mist (render/mistvol.js) and every smoke / dust particle read (docs/exp/air.md, section 1).
// VIEW ONLY: the sim never reads it. ?air=0: off (G.air exists, on false); ?air=debug: on, the field drawn over the image.
//
// THE MODEL. A 2D fluid on the ground plane (top-down), N x N cells of TUNE.cell m (128 x .35: ~45 m a side), FIXED IN THE
// WORLD and centred on the view's target: when the view moves the grid follows in WHOLE cells and the state is read across
// at its old place (nothing slides). One state texture (RGBA half float, linear): R vx, G vz (m/s, world x east / z south),
// B CLEAR (0..1: how much of the mist is blown away here), A SMOKE (0..1: dust / smoke in the air here). Each step (a fixed
// 1/TUNE.hz s, like the game's sim: the same air at 60 and 164 Hz; the frame shows the last two steps blended, ALPHA):
//   ADVECT    everything is carried by the flow: semi-Lagrangian along an RK2 back-trace, sharpened by MacCormack (a
//             forward trace measures the scheme's own smearing and half of it is put back, clamped to the values the trace
//             started between: no new extremes), so a swirl or a shot's channel keeps its edge for seconds; a little of the
//             velocity is evened with its neighbours (TUNE.smooth: grid-scale noise, which nothing else here wears down, dies);
//   SWIRL     vorticity confinement (Fedkiw): the curl's own gradient pushes a curl round itself, putting back the small
//             swirls the grid smears away;
//   SPLATS    what this step's sources put in (G.air.splat; at most 64): a push, a radial push, a swirl, CLEAR, SMOKE, each a
//             gaussian. A splat RAISES the air toward its own speed, never past it (a fan: blowing into air that already moves
//             that way adds nothing), so a source splatted every frame holds the air at its speed at any frame rate, and two
//             shots into one spot don't make a 30 m/s gale. A splat doesn't reach past a wall (its line to each cell is
//             marched through the solids: what's behind a wall is sheltered). A strong outward radial (TUNE.blowMin: a blast,
//             a smoke bomb) is a BLOW: it keeps blowing TUNE.blow s, then draws the air back in (TUNE.after: the hot gas rising
//             pulls the ground air after it, ~1 s); a weaker one (a footfall, an impact, a muzzle's gas) a one-step PUFF. A
//             `body` splat is something moving through the air (a walker, a horse): the air in it goes along, round it the air
//             PARTS (the flow round a cylinder moving through still air: pushed out ahead, backward round its sides, in behind);
//   PRESSURE  the air pushed somewhere has to go somewhere: a projection. Not strictly incompressible (in a flat layer of air
//             that would erase a blast at once: an outward push is pure divergence), but SLIGHTLY COMPRESSIBLE: the pressure
//             is a state with a wave speed TUNE.c (implicit: (1 + dt / relax) a p - lap p = a p_old - div, a = h^2 / (c dt)^2,
//             Jacobi warm-started from the last step). A blast's push piles air in a ring that runs outward and leaves a low
//             behind it, which pulls the air back in (the blast wind and the afterwind); a shot's jet pushes the air in front
//             aside and it curls back round (a pair of swirls); the pressure leaks away over TUNE.relax s (the air above
//             evens it out). c -> Infinity: the classic incompressible projection;
//   OBSTACLES walls, rocks, the tower, cliffs hold no air: a cell is SOLID where something static stands up out of the ground
//             there (the point lights' top-down height map, gfx.js hmap, copied right after its static casters are drawn,
//             before the moving ones: no tree crowns (an overhang the air passes under), no debris). The pressure takes no
//             flow through a solid face, the air beside one slides along it (free slip), splats are sheltered by them;
//   CALM      the air slows to 1/e over TUNE.damp s, fast air faster (TUNE.drag), and to nothing over the last TUNE.sponge
//             cells of the grid (its edge is open: no reflections; outside the grid: zero); CLEAR refills (the mist creeps
//             back, ~2.4 s), SMOKE settles over TUNE.smoke s.
// THE CLOCK: G.air.step(dt) hands the air the views' time (call it once per view step with the dt the features' views get:
// slow motion slows the air with the smoke, a hitstop's freeze, a pause or a still photo hold it); the frame's render runs the
// fixed steps that time made due. Until anything calls it, the air keeps the frame's own (wall) clock.
// velAt (CPU particles): no GPU readback. A coarse CPU grid (64 x 64 over the same ground) that the same pushes and swirls
// are drawn into with the same fan rule and that calms as the GPU field does; each blow (its blow and afterwind, a shape
// FITTED to the GPU field's: blowV), each puff (brief) and each moving body (the parting flow round it) analytic on top:
// good enough to push smoke the right way (a blast: .56 m/s rms off the field's 2.7), ~.3 us a call, nothing allocated.
// OWNS: its passes, targets, TUNE, the splat queue, the blows / puffs / bodies, the CPU grid. READS (shared uniform objects,
// never written): gfx.js compU's height map (tH, uHPV), and, for the debug view, the G-buffer depth and the inverse projection.
// BUDGET (RTX 4070, tmp/air/probe.mjs): GPU ~.04 ms a step, ~.1 ms with 64 splats (independent of the screen: 128^2 cells,
// 3 + TUNE.iters small passes; the solid mask only when the grid moved or the world's static things changed); CPU ~.04 ms a
// step (10 draws), .06 with 20 splats. ~.5 KB of garbage a step, all inside three.js's render calls.
//   const air = createAir({THREE, renderer, raw, tri, cam, compU}); air.api is G.air.
//   gfx.js render: air.grab() right after the height map's static casters are drawn (returns true: it changed the target);
//   air.tick(now, still, view.T.x, view.T.z) once a frame before the composite; air.over() after it (the debug view)
//   G.air = {on, tex, rect, splat(s), velAt(x, z, out), step(dt), TUNE, steps (the steps run so far), ms}: docs/exp/air.md;
//   splat(s): s = {x, z, r, vx, vz, radial, swirl, clear, smoke, body}: body (m, optional) the radius of a body moving at
//   (vx, vz) (its own velocity: the wake it drags is TUNE.bodyWake of it)
import {flags} from '../core/flags.js';

const MODE = flags.get('air');   // '0': off; 'debug': the overlay
export const TUNE = {
  on: MODE !== '0',
  n: 128,            // cells a side (at creation)
  cell: .35,         // m a cell (at creation)
  hz: 60,            // steps a second (fixed: the same air at any frame rate)
  iters: 7,          // Jacobi iterations a step (warm-started; with c = 10 each sweep takes the error down ~.47: 7 -> .005;
                     // c = Infinity, the incompressible limit, wants 20+)
  c: 10,             // m/s: how fast pushed air piles up and runs out as pressure (the blast ring's speed); Infinity: incompressible
  relax: .45,        // s: a pressure difference evens out (into the air above) over this long
  damp: 2.5,         // s: the air's speed falls to 1/e over this long (slow air: swirls and wakes linger)...
  drag: .08,         // 1/m: ...and fast air faster (turbulent drag, |v| v): a 20 m/s blow is spent in a fraction of a second
  blow: .2,          // s: a radial splat (outward) keeps blowing this long, fading (the gas of a blast expanding)...
  blowMin: [4, 8],   // a radial splat blows on (a BLOW) only from this push (m/s) and push x r (m^2/s): a blast, a smoke bomb,
                     // a frost burst; a footfall, an impact or a muzzle's gas is a PUFF (one step's push)
  after: [.1, 2.2, 1.2],    // ...then the AFTERWIND: the hot gas rising draws the ground air back in: an inflow of [0] x the push
                     // over [1] x its radius (peaking at about its radius), fading out over [2] s
  sponge: 8,         // cells at the grid's edge over which the air calms to nothing (open, no reflections)
  spongeK: 12,       // 1/s: the calming at the very edge
  vort: .6,          // vorticity confinement (x the cell): the swirls the grid smears away are put back
  vmax: 40,          // m/s: no faster
  maccormack: true,  // sharper advection of CLEAR and SMOKE (false: plain semi-Lagrangian)
  macVel: true,      // ...and of the velocity (a shot's pair of swirls ~2x as strong after 2 s as plain semi-Lagrangian)...
  smooth: .02,       // ...with a share of each step's velocity evened with its 4 neighbours: grid-scale noise (which the pressure
                     // can't see on this grid and MacCormack doesn't wear down: 40 m/s of chaos held at 9 m/s) dies out
                     // (tmp/air/stress.mjs: .6 m/s 5 s after, still falling); a swirl 3 m across loses ~10 % a second to it
  clear: [2.1, .06], // CLEAR refills along a logistic curve, rate (1/s), its start where fully clear: the hole holds a moment,
                     // closes fastest half way, ~3 s from fully blown away to the mist back
  smoke: 3.5,        // s: SMOKE settles to 1/e
  shelter: true,     // a splat doesn't reach past a wall
  bodyWake: .5,      // a `body` splat: the air in the body goes along at this share of its speed (the wake it drags)...
  bodyLife: .15,     // ...and velAt keeps its round flow this long after its last splat (fading: a mover splats every step)
  // a cell is SOLID where a static thing stands up out of the ground round it: its top (the highest point over the cell) over
  // the ground (the median of 8 points a ring away, so a thing narrower than the ring stands out; a rim over a hollow doesn't)
  ring: [.9, 2.6],   // m: the near ring (walls, rocks, posts) and the wide ring (the tower, big rocks)
  rise: [.5, .8],    // m over the near ring's ground: from not to fully solid
  riseWide: [2, 2.5],// m over the wide ring's ground (wide, tall things)
  drop: [1.8, 2.4],  // m over the near ring's LOWEST point: a cliff's edge (a drop this deep blocks even where it is a rim)
};

const VS = `precision highp float; precision highp int;\nin vec3 position; void main() { gl_Position = vec4(position.xy, 0., 1.); }`;
const HEAD = `precision highp float; precision highp int;
uniform vec4 uG;    // this step's grid: x0, z0 (m: its corner), cell (m), N
uniform vec4 uGo;   // the grid the read state lies on: x0, z0, 1 / its size (m), dt (s)
out vec4 o;
vec2 cellX(ivec2 c) { return uG.xy + (vec2(c) + .5) * uG.z; }   // a cell's centre (world x, z)
vec2 uvG(vec2 X) { return (X - uG.xy) / (uG.z * uG.w); }
vec2 uvO(vec2 X) { return (X - uGo.xy) * uGo.z; }
bool outside(ivec2 c) { int n = int(uG.w); return c.x < 0 || c.y < 0 || c.x >= n || c.y >= n; }
`;
// ADVECT (1/2): the state carried along an RK2 back-trace through last step's velocity (read at its old place: the shift)
const ADV_FS = HEAD + `
uniform sampler2D tS;
void main() {
  vec2 X = cellX(ivec2(gl_FragCoord.xy)); float dt = uGo.w;
  vec2 v = texture(tS, uvO(X)).xy, vm = texture(tS, uvO(X - v * (.5 * dt))).xy;
  o = texture(tS, uvO(X - vm * dt));
}`;
// ADVECT (2/2) + SWIRL + SPLATS + SOLIDS: MacCormack's correction (the forward trace of the advected field, half the
// difference put back, clamped between the 4 values the back-trace read), the vorticity confinement (from last step's curl
// round the cell), this step's splats, nothing in a solid cell
const MAC_FS = HEAD + `
uniform sampler2D tS, tA, tSol;
uniform vec4 uK;    // MacCormack (0 off, 1 the scalars, 2 all), the confinement (eps x cell), shelter on, splats
uniform vec4 uS[192];   // per splat: (x, z, r, radial), (vx, vz, swirl, -), (clear, smoke, body radius, its wake share)
float solAt(vec2 X) { return textureLod(tSol, uvG(X), 0.).r; }
// how much of a splat at S reaches X: its line marched through the solids (a wall between: nothing)
float shelter(vec2 S, vec2 X) {
  vec2 d = X - S; float L = length(d), T = 1.;
  int n = int(min(24., ceil(L / uG.z)));
  for (int i = 1; i < 24; i++) { if (i >= n) break; T *= 1. - solAt(S + d * (float(i) / float(n))); if (T < .01) return 0.; }
  return T;
}
// raise v's component along u (unit) to m, never past it; air blowing against it is slowed by m
void fan(inout vec2 v, vec2 u, float m) { float a = dot(v, u), b = a < 0. ? a + m : max(a, m); v += u * (b - a); }
float curlO(vec2 X) {
  float h = 1. / (uGo.z * uG.w);
  return (texture(tS, uvO(X + vec2(h, 0.))).y - texture(tS, uvO(X - vec2(h, 0.))).y - texture(tS, uvO(X + vec2(0., h))).x + texture(tS, uvO(X - vec2(0., h))).x) / (2. * h);
}
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy); vec2 X = cellX(c); float dt = uGo.w, h = uG.z; int n = int(uG.w);
  vec4 a = texelFetch(tA, c, 0);
  if (uK.x > .5) {
    vec2 v = texture(tS, uvO(X)).xy, vb = texture(tS, uvO(X - v * (.5 * dt))).xy, vf = texture(tS, uvO(X + v * (.5 * dt))).xy;
    vec4 m = a + .5 * (texture(tS, uvO(X)) - texture(tA, uvG(X + vf * dt)));
    vec2 g = uvO(X - vb * dt) * uG.w - .5; ivec2 b = ivec2(floor(g)), hi = ivec2(n - 1);
    vec4 t0 = texelFetch(tS, clamp(b, ivec2(0), hi), 0), t1 = texelFetch(tS, clamp(b + ivec2(1, 0), ivec2(0), hi), 0);
    vec4 t2 = texelFetch(tS, clamp(b + ivec2(0, 1), ivec2(0), hi), 0), t3 = texelFetch(tS, clamp(b + ivec2(1, 1), ivec2(0), hi), 0);
    m = clamp(m, min(min(t0, t1), min(t2, t3)), max(max(t0, t1), max(t2, t3)));
    a = uK.x > 1.5 ? m : vec4(a.xy, m.zw);
  }
  if (uK.y > 0.) {   // f = eps h (N x w): N the unit gradient of |curl|
    float w = curlO(X);
    vec2 N = vec2(abs(curlO(X + vec2(h, 0.))) - abs(curlO(X - vec2(h, 0.))), abs(curlO(X + vec2(0., h))) - abs(curlO(X - vec2(0., h))));
    float nl = length(N); if (nl > 1e-4) { N /= nl; a.xy += dt * uK.y * vec2(N.y * w, -N.x * w); }
  }
  int ns = int(uK.w);
  for (int k = 0; k < 64; k++) {
    if (k >= ns) break;
    vec4 s0 = uS[k * 3], s1 = uS[k * 3 + 1], s2 = uS[k * 3 + 2];
    vec2 d = X - s0.xy; float r = s0.z, q = dot(d, d) / (r * r);
    if (q > 4.) continue;   // (beyond 2 r: under 1 / 3000)
    float T = uK.z > .5 ? shelter(s0.xy, X) : 1.; if (T <= 0.) continue;
    float g = exp(-2. * q) * T, rho = sqrt(dot(d, d)), pr = 2. * rho / r * exp(.5 - 2. * q) * T;   // (pr: 1 at r / 2, the radial / swirl profile)
    vec2 u = rho > 1e-4 ? d / rho : vec2(0.);
    float pl = length(s1.xy);
    if (s2.z > 0.) {   // a moving BODY (radius A, velocity U = s1.xy): in it the air goes along (x its wake share); round it, the
      float A = s2.z;  // flow round a cylinder moving through still air: pushed out ahead, backward round its sides, in behind
      if (pl > 1e-4) {
        if (rho < A) fan(a.xy, s1.xy / pl, pl * s2.w * T);
        else { vec2 D = A * A / (rho * rho) * (2. * dot(s1.xy, u) * u - s1.xy) * T * (1. - smoothstep(2.5 * A, 4. * A, rho)); float dl = length(D); if (dl > 1e-4) fan(a.xy, D / dl, dl); }
      }
    } else if (pl > 1e-4) fan(a.xy, s1.xy / pl, pl * g);
    if (s0.w != 0.) fan(a.xy, u * sign(s0.w), abs(s0.w) * pr);
    if (s1.z != 0.) fan(a.xy, vec2(u.y, -u.x) * sign(s1.z), abs(s1.z) * pr);   // (+: counter-clockwise seen from above)
    a.z = max(a.z, s2.x * g); a.w = max(a.w, s2.y * g);
  }
  if (texelFetch(tSol, c, 0).r > .5) a = vec4(0.);
  o = a;
}`;
// PRESSURE (1/n): the divergence, the solids, last step's pressure (shifted with the grid) as the first guess, one iteration.
// P (units: m^2/s, P = dt p) -> (P, h^2 div, solid, last step's P)
const JAC0_FS = HEAD + `
uniform sampler2D tV, tSol, tP;
uniform ivec2 uSh;   // last step's cell of this step's cell c: c + uSh
uniform vec4 uJ;     // alpha, the diagonal (4 + alpha (1 + dt / relax)), last step's P to this step's units, (unused)
float Po(ivec2 q) { q += uSh; return outside(q) ? 0. : texelFetch(tP, q, 0).r; }
bool solid(ivec2 q) { return !outside(q) && texelFetch(tSol, q, 0).r > .5; }
vec2 V(ivec2 q) { return outside(q) ? vec2(0.) : texelFetch(tV, q, 0).xy; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy);
  if (solid(c)) { o = vec4(0., 0., 1., 0.); return; }
  float h = uG.z, b = h * .5 * (V(c + ivec2(1, 0)).x - V(c - ivec2(1, 0)).x + V(c + ivec2(0, 1)).y - V(c - ivec2(0, 1)).y);
  float pc = Po(c), s = 0.;
  s += solid(c + ivec2(1, 0)) ? pc : Po(c + ivec2(1, 0)); s += solid(c - ivec2(1, 0)) ? pc : Po(c - ivec2(1, 0));
  s += solid(c + ivec2(0, 1)) ? pc : Po(c + ivec2(0, 1)); s += solid(c - ivec2(0, 1)) ? pc : Po(c - ivec2(0, 1));
  float pp = pc * uJ.z;
  o = vec4((s + uJ.x * pp - b) / uJ.y, b, 0., pp);
}`;
// PRESSURE (2..n): Jacobi. A solid neighbour mirrors the cell (no flow through its face); outside the grid: 0 (open)
const JAC_FS = HEAD + `
uniform sampler2D tP; uniform vec4 uJ;
float nb(ivec2 q, float pc) { if (outside(q)) return 0.; vec4 t = texelFetch(tP, q, 0); return t.b > .5 ? pc : t.r; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy); vec4 m = texelFetch(tP, c, 0);
  if (m.b > .5) { o = m; return; }
  float s = nb(c + ivec2(1, 0), m.r) + nb(c - ivec2(1, 0), m.r) + nb(c + ivec2(0, 1), m.r) + nb(c - ivec2(0, 1), m.r);
  o = vec4((s + uJ.x * m.a - m.g) / uJ.y, m.gba);
}`;
// THE NEW STATE: minus the pressure's gradient, free slip along solids, calm, the sponge at the edge, CLEAR refilling, SMOKE
// settling; nothing in solids or on the grid's outermost ring (so a read outside the grid, clamped to its edge, is zero)
const FIN_FS = HEAD + `
uniform sampler2D tV, tP;
uniform vec4 uF;    // the speed kept a step, the drag a step (dt x drag), CLEAR's refill a step (dt x rate), SMOKE kept a step
uniform vec4 uF2;   // sponge cells, the sponge's calming a step at the edge (dt x rate), the most speed, CLEAR's refill start
uniform float uSm;  // the share evened with the 4 neighbours (grid-scale noise)
vec2 Vn(ivec2 q, vec2 v) { return outside(q) ? vec2(0.) : texelFetch(tV, q, 0).xy; }
float nb(ivec2 q, float pc) { if (outside(q)) return 0.; vec4 t = texelFetch(tP, q, 0); return t.b > .5 ? pc : t.r; }
bool sol(ivec2 q) { return !outside(q) && texelFetch(tP, q, 0).b > .5; }
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy); vec4 m = texelFetch(tP, c, 0); int n = int(uG.w);
  int e = min(min(c.x, c.y), min(n - 1 - c.x, n - 1 - c.y));
  if (m.b > .5 || e == 0) { o = vec4(0.); return; }
  vec4 a = texelFetch(tV, c, 0); float pc = m.r, h = uG.z;
  if (uSm > 0.) a.xy = mix(a.xy, .25 * (Vn(c + ivec2(1, 0), a.xy) + Vn(c - ivec2(1, 0), a.xy) + Vn(c + ivec2(0, 1), a.xy) + Vn(c - ivec2(0, 1), a.xy)), uSm);
  a.xy -= vec2(nb(c + ivec2(1, 0), pc) - nb(c - ivec2(1, 0), pc), nb(c + ivec2(0, 1), pc) - nb(c - ivec2(0, 1), pc)) / (2. * h);
  if (sol(c + ivec2(1, 0))) a.x = min(a.x, 0.); if (sol(c - ivec2(1, 0))) a.x = max(a.x, 0.);
  if (sol(c + ivec2(0, 1))) a.y = min(a.y, 0.); if (sol(c - ivec2(0, 1))) a.y = max(a.y, 0.);
  float sp = max(0., 1. - float(e) / uF2.x), sk = exp(-uF2.y * sp * sp);
  a.xy *= uF.x * sk / (1. + uF.y * length(a.xy)); float l = length(a.xy); if (l > uF2.z) a.xy *= uF2.z / l;
  a.z = max(0., a.z - uF.z * (a.z * (1. - a.z) + uF2.w)) * sk; a.w *= uF.w * sk;   // (CLEAR: logistic, from its start)
  o = a;
}`;
// ALPHA: what the frame shows, between the last two steps (on this step's grid; the one before read at its own place)
const LERP_FS = HEAD + `
uniform sampler2D tS0, tS1; uniform float uA;
void main() { ivec2 c = ivec2(gl_FragCoord.xy); o = mix(texture(tS0, uvO(cellX(c))), texelFetch(tS1, c, 0), uA); }`;
// THE STATIC THINGS' TOPS: the height map right after its static casters were drawn (no crowns, no debris), each texel of this
// map the highest of 4 x 4 of its texels, as a height (m). Nothing drawn there: the flat ground (0)
const TOP_FS = `precision highp float; precision highp int;
uniform highp sampler2D tH; uniform vec2 uHZ; out vec4 o;   // (height = depth x uHZ.x + uHZ.y)
void main() {
  ivec2 c = ivec2(gl_FragCoord.xy) * 4, hi = textureSize(tH, 0) - 1; float m = 1.;
  for (int y = 0; y < 4; y++) for (int x = 0; x < 4; x++) m = min(m, texelFetch(tH, min(c + ivec2(x, y), hi), 0).r);
  o = vec4(m > .99999 ? 0. : m * uHZ.x + uHZ.y, 0., 0., 1.);
}`;
// THE SOLIDS on the grid: a cell's top (the highest of 3 x 3 points over it) against the ground round it (TUNE.ring/rise/drop)
const SOL_FS = HEAD + `
uniform sampler2D tTop; uniform mat4 uHPV;
uniform vec4 uR;    // near ring (m), wide ring (m), -, -
uniform vec4 uT0;   // rise (from, to), riseWide (from, to)
uniform vec4 uT1;   // drop (from, to), -, -
float top(vec2 X, float f) { vec2 uv = (uHPV * vec4(X.x, 0., X.y, 1.)).xy * .5 + .5; return any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.))) ? f : textureLod(tTop, uv, 0.).r; }
float med8(float v[8]) {   // the 4th lowest of 8
  float r = 0.;
  for (int i = 0; i < 8; i++) { int lo = 0, eq = 0; for (int j = 0; j < 8; j++) { lo += v[j] < v[i] ? 1 : 0; eq += v[j] == v[i] && j < i ? 1 : 0; } if (lo + eq == 3) r = v[i]; }
  return r;
}
void main() {
  vec2 X = cellX(ivec2(gl_FragCoord.xy)); float h = uG.z, t = -1e3;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) t = max(t, top(X + vec2(i, j) * (.45 * h), -1e3));
  if (t < -100.) { o = vec4(0.); return; }
  float a[8], b[8], lo = 1e3;
  for (int i = 0; i < 8; i++) { vec2 d = vec2(cos(float(i) * .7853982), sin(float(i) * .7853982)); a[i] = top(X + d * uR.x, t); b[i] = top(X + d * uR.y, t); lo = min(lo, a[i]); }
  float s = max(smoothstep(uT0.x, uT0.y, t - med8(a)), max(smoothstep(uT0.z, uT0.w, t - med8(b)), smoothstep(uT1.x, uT1.y, t - lo)));
  o = vec4(s, 0., 0., 1.);
}`;
// THE DEBUG VIEW (?air=debug): over the image at art px, each ground pixel's air: hue = the way it blows, strength = speed;
// CLEAR pale cyan, SMOKE orange, solid cells red. A view of the field, nothing else reads it
const DBG_FS = `precision highp float; precision highp int;
uniform sampler2D tD, tSt, tSol; uniform mat4 uInvPV; uniform vec2 uRes; uniform vec4 uR; out vec4 oc;
vec3 worldAt(ivec2 p, float d) { vec2 ndc = (vec2(p) + .5) / uRes * 2. - 1.; vec4 w = uInvPV * vec4(ndc, d * 2. - 1., 1.); return w.xyz / w.w; }
void main() {
  ivec2 ip = ivec2(gl_FragCoord.xy); float d = texelFetch(tD, ip, 0).r; if (d > .99999) discard;
  vec2 uv = (worldAt(ip, d).xz - uR.xy) * uR.zw;
  if (any(lessThan(uv, vec2(0.))) || any(greaterThan(uv, vec2(1.)))) discard;
  vec4 s = texture(tSt, uv); float sp = length(s.xy), so = texture(tSol, uv).r;
  vec3 col = .5 + .5 * cos(atan(s.y, s.x) + vec3(0., 2.094, 4.189)); float a = min(1., sp / 6.) * .8;
  if (s.z > .02) { col = mix(col, vec3(.75, 1., 1.), s.z); a = max(a, s.z * .7); }
  if (s.w > .02) { col = mix(col, vec3(1., .55, .15), s.w); a = max(a, s.w * .7); }
  if (so > .5) { col = vec3(1., .1, .1); a = .5; }
  vec2 g = fract(uv * 16.); if (min(g.x, g.y) < .02) { col = mix(col, vec3(1.), .3); a = max(a, .12); }   // (every 8 cells)
  oc = vec4(col * a, 1. - a);
}`;

const SPLATS = 64;
const NC = 64;   // velAt's CPU grid (cells a side)
const BLOWS = 16;   // outward radial splats still blowing (the GPU) or followed by velAt (their blow and afterwind)
const PUFFS = 32;   // the weaker radial splats velAt follows (a brief push each)
const BODIES = 16;  // moving bodies velAt follows (the air parting round each)

export function createAir({THREE, renderer, raw, tri, cam, compU}) {
  const N = TUNE.n, H = TUNE.cell, SIZE = N * H;
  const zero = new THREE.DataTexture(new Uint16Array(4), 1, 1, THREE.RGBAFormat, THREE.HalfFloatType); zero.needsUpdate = true;
  const rect = new THREE.Vector4(0, 0, 0, 0);
  const off = {on: false, tex: zero, rect, splat() {}, velAt(x, z, out) { out[0] = out[1] = 0; return out; }, step() {}, TUNE, steps: 0, ms: 0};
  const ok = TUNE.on && renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float');
  if (!ok) return {api: off, grab: () => false, tick() {}, over() {}};

  const lin = THREE.LinearFilter, near = THREE.NearestFilter;
  const rt = (w, h, type, format, f) => new THREE.WebGLRenderTarget(w, h, {type, format, minFilter: f, magFilter: f, depthBuffer: false, generateMipmaps: false});
  const st = () => rt(N, N, THREE.HalfFloatType, THREE.RGBAFormat, lin);
  const S = [st(), st()], A = st(), B = st(), L = st();   // the state (last two steps), the advection's scratch, the frame's blend
  const P = [rt(N, N, THREE.FloatType, THREE.RGBAFormat, near), rt(N, N, THREE.FloatType, THREE.RGBAFormat, near)];
  const SOL = rt(N, N, THREE.UnsignedByteType, THREE.RedFormat, lin);
  const hmI = compU.tH.value.image, TW = Math.max(1, Math.ceil(hmI.width / 4)), TH = Math.max(1, Math.ceil(hmI.height / 4));
  const TOP = rt(TW, TH, THREE.HalfFloatType, THREE.RedFormat, near);

  // the passes: one triangle each, their own uniforms; uG / uGo shared
  const uG = {value: new THREE.Vector4(0, 0, H, N)}, uGo = {value: new THREE.Vector4(0, 0, 1 / SIZE, 1 / TUNE.hz)};
  const pass = (fs, U, extra = {}) => {
    const sc = new THREE.Scene(); sc.matrixAutoUpdate = false;
    const m = new THREE.Mesh(tri, raw(VS, fs, {uG, uGo, ...U}, {depthTest: false, depthWrite: false, ...extra})); m.frustumCulled = false; m.matrixAutoUpdate = false; sc.add(m);
    return {sc, U: m.material.uniforms};
  };
  const SPL = new Float32Array(SPLATS * 12);   // the queue: per splat x, z, r, radial, vx, vz, swirl, 0, clear, smoke, strength, 0
  const ADV = pass(ADV_FS, {tS: {value: null}});
  const MAC = pass(MAC_FS, {tS: {value: null}, tA: {value: A.texture}, tSol: {value: SOL.texture}, uK: {value: new THREE.Vector4()}, uS: {value: SPL}});
  const J0 = pass(JAC0_FS, {tV: {value: B.texture}, tSol: {value: SOL.texture}, tP: {value: null}, uSh: {value: new THREE.Vector2()}, uJ: {value: new THREE.Vector4()}});
  const JI = pass(JAC_FS, {tP: {value: null}, uJ: J0.U.uJ});
  const FIN = pass(FIN_FS, {tV: {value: B.texture}, tP: {value: null}, uF: {value: new THREE.Vector4()}, uF2: {value: new THREE.Vector4()}, uSm: {value: 0}});
  const LRP = pass(LERP_FS, {tS0: {value: null}, tS1: {value: null}, uA: {value: 1}});
  const TOPP = pass(TOP_FS, {tH: compU.tH, uHZ: {value: new THREE.Vector2()}});
  const SOLP = pass(SOL_FS, {tTop: {value: TOP.texture}, uHPV: compU.uHPV, uR: {value: new THREE.Vector4()}, uT0: {value: new THREE.Vector4()}, uT1: {value: new THREE.Vector4()}});
  const DBG = MODE === 'debug' ? pass(DBG_FS, {tD: compU.tD, tSt: {value: null}, tSol: {value: SOL.texture}, uInvPV: compU.uInvPV, uRes: compU.uRes, uR: {value: rect}},
    {transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.SrcAlphaFactor,
      blendSrcAlpha: THREE.ZeroFactor, blendDstAlpha: THREE.OneFactor}) : null;
  for (const p of [ADV, MAC, J0, JI, FIN, LRP, TOPP, SOLP, DBG]) if (p) renderer.compile(p.sc, cam);   // (at load: no hitch at the first frame)

  // ---- the grid: its corner cell (whole cells), the view's centre it follows
  let gi = 0, gj = 0, cur = 0, pc = 0, solDirty = true, topOk = false, acc = 0, cx = 0, cz = 0, first = true, steps = 0;
  const go = [0, 0];   // the grid the current state lies on (x0, z0)
  const go1 = [0, 0];   // the grid the state before it lies on
  let ns = 0;   // splats queued
  let fed = false, fedT = 0;   // THE CLOCK: the views' time handed over by step(dt) since the last frame (once any came)
  const api = {on: true, tex: S[0].texture, rect, TUNE, splat, velAt, step: feed, ms: 0, steps: 0};
  // (tests only: tmp/air's probe reads the targets back, moves the centre, steps at once; nothing in the game touches these)
  Object.defineProperty(api, '_t', {value: {S, SOL, P, TOP, L, A, B, centre(x, z) { cx = x; cz = z; cpuCentre(x, z); }, stepNow: run,
    reset() { const p = renderer.getRenderTarget(); for (const t of [...S, ...P, A, B, L]) { renderer.setRenderTarget(t); renderer.clear(true, false, false); } renderer.setRenderTarget(p); CV.fill(0); bwN = pfN = 0; BD.fill(0); ns = 0; },
    get cur() { return cur; }, get pc() { return pc; }, get blows() { return bwN; }, get puffs() { return pfN; }}});

  // ---- splats: copied at once into the queue (the caller may reuse its object); full: the weakest goes. A strong outward
  // radial becomes a BLOW (it keeps blowing), a weak radial a PUFF (velAt follows its brief life), a `body` a moving body
  function splat(s) {
    const x = +s.x, z = +s.z; if (!(x === x && z === z)) return;   // (NaN)
    let r = +s.r || 1; if (r < .05) r = .05;
    const vx = +s.vx || 0, vz = +s.vz || 0, rad = +s.radial || 0, sw = +s.swirl || 0, bd = +s.body || 0;
    let cl = +s.clear || 0, sm = +s.smoke || 0; cl = cl < 0 ? 0 : cl > 1 ? 1 : cl; sm = sm < 0 ? 0 : sm > 1 ? 1 : sm;
    if (bd > 0 && r < 2 * bd) r = 2 * bd;   // (a body's round flow reaches ~4 x its radius: the splat's 2 r)
    const i = slot((Math.sqrt(vx * vx + vz * vz) + (rad < 0 ? -rad : rad) + (sw < 0 ? -sw : sw) + 4 * (cl + sm)) * r * r); if (i < 0) return;
    const o = i * 12;
    SPL[o] = x; SPL[o + 1] = z; SPL[o + 2] = r; SPL[o + 3] = rad; SPL[o + 4] = vx; SPL[o + 5] = vz; SPL[o + 6] = sw;
    SPL[o + 8] = cl; SPL[o + 9] = sm; SPL[o + 10] = bd; SPL[o + 11] = bd > 0 ? TUNE.bodyWake : 0;
    if (rad > 0 && rad >= TUNE.blowMin[0] && rad * r >= TUNE.blowMin[1]) blowAdd(x, z, r, rad);
    else if (rad !== 0) puffAdd(x, z, r, rad);
    if (bd > 0) bodyAdd(x, z, bd, vx, vz);
  }
  // a free place in the queue (its strength k kept for this), or the weakest one's if k is stronger; -1: dropped
  function slot(k) {
    let i = ns;
    if (ns >= SPLATS) { i = 0; for (let j = 1; j < SPLATS; j++) if (SPL[j * 12 + 7] < SPL[i * 12 + 7]) i = j; if (SPL[i * 12 + 7] >= k) return -1; }
    else ns++;
    SPL[i * 12 + 7] = k; return i;
  }
  function queueRadial(x, z, r, rad) {   // (a blow, again)
    const i = slot((rad < 0 ? -rad : rad) * r * r); if (i < 0) return;
    const o = i * 12; SPL[o] = x; SPL[o + 1] = z; SPL[o + 2] = r; SPL[o + 3] = rad;
    SPL[o + 4] = SPL[o + 5] = SPL[o + 6] = SPL[o + 8] = SPL[o + 9] = SPL[o + 10] = SPL[o + 11] = 0;
  }

  // ---- THE BLOWS: an outward radial splat at least TUNE.blowMin strong keeps blowing for TUNE.blow s, fading (re-queued each
  // step: the fan rule holds the air at that speed against the pressure building round it), then draws the air back in (the
  // afterwind); per blow x, z, r, push (m/s), age (s), how far velAt looks for it (squared; 0: spent). velAt follows each for
  // its whole life (analytic); one landing near another's centre while it still blows refreshes it
  const BW = new Float32Array(BLOWS * 6); let bwN = 0;
  const bwEnd = () => TUNE.blow + TUNE.after[2];
  function blowAdd(x, z, r, R) {
    for (let n = 0; n < bwN; n++) { const o = n * 6; if ((x - BW[o]) * (x - BW[o]) + (z - BW[o + 1]) * (z - BW[o + 1]) < BW[o + 2] * BW[o + 2] * .25 && BW[o + 4] < TUNE.blow) { BW[o + 2] = Math.max(BW[o + 2], r); BW[o + 3] = Math.max(BW[o + 3], R); BW[o + 4] = -1; BW[o + 5] = cull(BW[o + 2], 0); return; } }
    let n = bwN < BLOWS ? bwN++ : -1;
    if (n < 0) { n = 0; for (let m = 1; m < BLOWS; m++) if (BW[m * 6 + 3] * BW[m * 6 + 2] < BW[n * 6 + 3] * BW[n * 6 + 2]) n = m; if (BW[n * 6 + 3] * BW[n * 6 + 2] > R * r) return; }
    const o = n * 6; BW[o] = x; BW[o + 1] = z; BW[o + 2] = r; BW[o + 3] = R; BW[o + 4] = -1; BW[o + 5] = cull(r, 0);   // (-1: in the queue this step already)
  }
  // how far a blow of radius r reaches at age t (squared; blowV's shape: past it under 1 / 300 of the push)
  function cull(r, t) {
    const F = BF, t1 = TUNE.blow + F[7];
    if (t < t1) { const c = r * (F[0] + F[1] * (1 - Math.exp(-t / (F[2] + F[3] * r)))) + 3.4 * F[6] * r; return c * c; }
    const tt = t - t1; if (Math.exp(-tt / (F[11] + F[12] * r)) < .003) return 0;
    const c = 3.6 * (r * F[9] + F[10] * tt); return c * c;
  }
  function blowStep(dt) {   // (before the splats are applied) the blows re-queued (blowing, then drawing back in), aged; spent ones go
    const T = TUNE.blow, F = TUNE.after, end = bwEnd();
    for (let n = 0; n < bwN;) {
      const o = n * 6, a = BW[o + 4];
      if (a >= 0 && a < T) queueRadial(BW[o], BW[o + 1], BW[o + 2], BW[o + 3] * (1 - a / T));
      else if (a >= T && a < T + F[2]) { const k = 1 - (a - T) / F[2]; queueRadial(BW[o], BW[o + 1], BW[o + 2] * F[1], -F[0] * BW[o + 3] * k * k); }
      BW[o + 4] = (a > 0 ? a : 0) + dt; BW[o + 5] = cull(BW[o + 2], BW[o + 4]);
      if (BW[o + 4] > end) { bwN--; BW.copyWithin(o, bwN * 6, bwN * 6 + 6); } else n++;
    }
  }
  // ---- PUFFS: the weaker radial splats (a footfall, an impact, a muzzle's gas, a fire's draw): one step's push on the GPU,
  // which the pressure spends within a few hundredths of a second; velAt follows that brief life. Per puff x, z, r, push, age
  const PF = new Float32Array(PUFFS * 5); let pfN = 0;
  const pfTau = r => .03 + .02 * r;
  function puffAdd(x, z, r, R) {
    let n = pfN < PUFFS ? pfN++ : -1;
    if (n < 0) { n = 0; for (let m = 1; m < PUFFS; m++) if (PF[m * 5 + 4] > PF[n * 5 + 4]) n = m; }   // (full: the oldest goes)
    const o = n * 5; PF[o] = x; PF[o + 1] = z; PF[o + 2] = r; PF[o + 3] = R; PF[o + 4] = 0;
  }
  function puffStep(dt) {
    for (let n = 0; n < pfN;) { const o = n * 5; PF[o + 4] += dt; if (PF[o + 4] > 5 * pfTau(PF[o + 2])) { pfN--; PF.copyWithin(o, pfN * 5, pfN * 5 + 5); } else n++; }
  }
  // ---- BODIES: a splat with `body` (its radius, m) is a body moving at (vx, vz) through the air: on the GPU the air in it goes
  // along (TUNE.bodyWake of its speed) and round it flows as round a cylinder moving through still air (pushed out ahead,
  // backward round its sides, in behind: the air parts for it); velAt adds the same round flow for each body splatted within
  // TUNE.bodyLife s (matched to the one it was a step ago by where that one has moved since). Per body x, z, a, ux, uz, age
  const BD = new Float32Array(BODIES * 6);
  function bodyAdd(x, z, a, ux, uz) {
    const life = TUNE.bodyLife; let n = -1, oldest = 0, ot = -1;
    for (let m = 0; m < BODIES; m++) {
      const o = m * 6, t = BD[o + 2] > 0 ? BD[o + 5] : 1e9;   // (an empty place: as old as can be)
      if (t < life) { const px = BD[o] + BD[o + 3] * t - x, pz = BD[o + 1] + BD[o + 4] * t - z, q = a + .3; if (px * px + pz * pz < q * q) { n = m; break; } }
      if (t > ot) { ot = t; oldest = m; }
    }
    const o = (n >= 0 ? n : oldest) * 6;
    BD[o] = x; BD[o + 1] = z; BD[o + 2] = a; BD[o + 3] = ux; BD[o + 4] = uz; BD[o + 5] = 0;
  }
  function bodyStep(dt) { for (let m = 0; m < BODIES; m++) BD[m * 6 + 5] += dt; }

  // ---- velAt's CPU grid: vx, vz on NC x NC cells of SIZE / NC m, re-centred with the GPU grid (whole cells of its own); the
  // splats' pushes and swirls drawn in with the same fan rule, calmed as the GPU field is (TUNE.damp, TUNE.drag)
  const HC = SIZE / NC, CV = new Float32Array(NC * NC * 2), CT = new Float32Array(NC * NC * 2);
  let ci = 0, cj = 0;
  function cpuCentre(x, z) {
    const ni = Math.round(x / HC) - NC / 2, nj = Math.round(z / HC) - NC / 2, di = ni - ci, dj = nj - cj;
    if (!di && !dj) return;
    CT.fill(0);
    for (let j = 0; j < NC; j++) { const sj = j + dj; if (sj < 0 || sj >= NC) continue; for (let i = 0; i < NC; i++) { const si = i + di; if (si < 0 || si >= NC) continue; const a = (j * NC + i) * 2, b = (sj * NC + si) * 2; CT[a] = CV[b]; CT[a + 1] = CV[b + 1]; } }
    CV.set(CT); ci = ni; cj = nj;
  }
  function cpuStep(dt) {
    const k = Math.exp(-dt / TUNE.damp), dr = dt * TUNE.drag;
    for (let i = 0; i < CV.length; i += 2) { const a = CV[i], b = CV[i + 1], f = k / (1 + dr * Math.sqrt(a * a + b * b)); CV[i] = a * f; CV[i + 1] = b * f; }
    const x0 = ci * HC, z0 = cj * HC;
    for (let s = 0; s < ns; s++) {
      const o = s * 12, sx = SPL[o], sz = SPL[o + 1], r = SPL[o + 2], bd = SPL[o + 10], wk = bd > 0 ? SPL[o + 11] : 1, vx = SPL[o + 4] * wk, vz = SPL[o + 5] * wk, sw = SPL[o + 6];
      if (!vx && !vz && !sw) continue;   // (radial: the blows and puffs, analytic; a body's round flow: the bodies)
      const rr = bd > 0 ? bd : r;   // (a body: its wake drawn in over its own radius)
      const i0 = Math.max(0, Math.floor((sx - 2 * rr - x0) / HC)), i1 = Math.min(NC - 1, Math.ceil((sx + 2 * rr - x0) / HC));
      const j0 = Math.max(0, Math.floor((sz - 2 * rr - z0) / HC)), j1 = Math.min(NC - 1, Math.ceil((sz + 2 * rr - z0) / HC));
      const pl = Math.sqrt(vx * vx + vz * vz);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const dx = x0 + (i + .5) * HC - sx, dz = z0 + (j + .5) * HC - sz, q = (dx * dx + dz * dz) / (rr * rr);
        if (q > 4) continue;
        const c = (j * NC + i) * 2;
        if (pl > 1e-4) fanC(c, vx / pl, vz / pl, pl * Math.exp(-2 * q));
        if (sw) { const rho = Math.sqrt(dx * dx + dz * dz); if (rho > 1e-4) { const sg = (sw < 0 ? -1 : 1) / rho; fanC(c, dz * sg, -dx * sg, (sw < 0 ? -sw : sw) * 2 * rho / rr * Math.exp(.5 - 2 * q)); } }
      }
    }
  }
  function fanC(c, ux, uz, m) { const a = CV[c] * ux + CV[c + 1] * uz, b = a < 0 ? a + m : Math.max(a, m); CV[c] += ux * (b - a); CV[c + 1] += uz * (b - a); }
  // the air's velocity at (x, z) (m/s): the CPU grid (bilinear) + each blow's (out from its centre while it blows, then back in:
  // the afterwind) + each puff's + the flow round each moving body. Inlined (no calls returning numbers: nothing allocated)
  function velAt(x, z, out) {
    const fx = (x - ci * HC) / HC - .5, fz = (z - cj * HC) / HC - .5;
    let vx = 0, vz = 0;
    if (fx > -1 && fz > -1 && fx < NC && fz < NC) {
      const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
      for (let b = 0; b < 2; b++) for (let a = 0; a < 2; a++) {
        const ii = i + a, jj = j + b; if (ii < 0 || jj < 0 || ii >= NC || jj >= NC) continue;
        const w = (a ? u : 1 - u) * (b ? v : 1 - v), c = (jj * NC + ii) * 2; vx += CV[c] * w; vz += CV[c + 1] * w;
      }
    }
    const F = BF, t1 = TUNE.blow + F[7];
    for (let n = 0; n < bwN; n++) {   // the blows (blowV, inlined)
      const o = n * 6, dx = x - BW[o], dz = z - BW[o + 1], d2 = dx * dx + dz * dz; if (d2 >= BW[o + 5] || d2 < 1e-6) continue;
      const rho = Math.sqrt(d2), r = BW[o + 2], R = BW[o + 3], t = BW[o + 4] > 0 ? BW[o + 4] : 0;
      let f;
      if (t < t1) {
        const c = r * (F[0] + F[1] * (1 - Math.exp(-t / (F[2] + F[3] * r)))), amp = R * Math.exp(-t / (F[4] + F[5] * r));
        if (rho < c) f = amp / c; else { const q = (rho - c) / (F[6] * r); f = amp * Math.exp(-.5 * q * q) / rho; }
      } else {
        const tt = t - t1, ri = r * F[9] + F[10] * tt, q = rho / ri, ra = tt / .03;
        f = -F[8] * R * Math.exp(-tt / (F[11] + F[12] * r)) * (ra < 1 ? ra : 1) * Math.exp(.5 * (1 - q * q)) / ri;
      }
      vx += dx * f; vz += dz * f;
    }
    for (let n = 0; n < pfN; n++) {   // the puffs: the radial profile, spent fast
      const o = n * 5, dx = x - PF[o], dz = z - PF[o + 1], r = PF[o + 2], q = (dx * dx + dz * dz) / (r * r); if (q > 4) continue;
      const f = PF[o + 3] * 2 / r * Math.exp(.5 - 2 * q - PF[o + 4] / (.03 + .02 * r)); vx += dx * f; vz += dz * f;
    }
    const life = TUNE.bodyLife, wake = TUNE.bodyWake;
    for (let m = 0; m < BODIES; m++) {   // the bodies: in one, along with it; round it, a moving cylinder's flow (fading after its last splat)
      const o = m * 6, t = BD[o + 5], a = BD[o + 2]; if (a <= 0 || t >= life) continue;
      const ux = BD[o + 3], uz = BD[o + 4], dx = x - BD[o] - ux * t, dz = z - BD[o + 1] - uz * t, d2 = dx * dx + dz * dz, k = 1 - t / life;
      if (d2 >= 16 * a * a) continue;
      if (d2 < a * a) { vx += ux * wake * k; vz += uz * wake * k; continue; }
      const e = d2 > 6.25 * a * a ? (16 - d2 / (a * a)) / 9.75 : 1, s = a * a / d2 * k * e * e, un = 2 * (ux * dx + uz * dz) / d2;
      vx += s * (un * dx - ux); vz += s * (un * dz - uz);
    }
    out[0] = vx; out[1] = vz; return out;
  }
  // a blow's radial speed (m/s, + outward) at rho m from its centre, t s after it started (r its radius, R its push): while it
  // blows, the air inside a crest moving out evenly, the crest running out (and the push spent) faster for a small blow; then
  // the afterwind, an inflow whose crest runs outward (the low behind the blast spreading) as it fades. The constants are
  // FITTED to the GPU field's blasts (r 1..3 m, push 6..25 m/s: tmp/air/blastfit.mjs + fit.py; rms error .56 m/s against
  // a signal of ~2.7) for this TUNE's c, blow, after, damp and drag: re-fit after changing those. (velAt has it inlined)
  const BF = [.209, 5, .455, .126, .012, .055, .545, .016, .522, .419, 6.21, .031, .071];   // a0 a1 tc0 tc1 ta0 ta1 w d K g0 vc ti0 ti1

  // ---- the static tops: right after the height map's static casters were drawn (gfx.js render)
  const _e = compU.uHPV.value.elements;
  function grab() {
    const e = _e;   // height from depth: z_ndc = e6 y + e14 (a top-down orthographic camera)
    TOPP.U.uHZ.value.set(2 / e[6], (-1 - e[14]) / e[6]);
    renderer.setRenderTarget(TOP); renderer.render(TOPP.sc, cam);
    topOk = true; solDirty = true;
    return true;
  }

  // ---- one step of dt s (1 / hz; tick runs them)
  function run(dt) {
    if (!(dt > 0)) return;
    const t0 = performance.now(), prev = renderer.getRenderTarget(), T = TUNE;
    // the grid: where the view's centre is now (whole cells); the shift reads the state across at its old place
    const ni = Math.round(cx / H) - N / 2, nj = Math.round(cz / H) - N / 2, di = first ? N * 4 : ni - gi, dj = first ? N * 4 : nj - gj;
    gi = ni; gj = nj; first = false;
    if (di || dj) solDirty = true;
    const x0 = gi * H, z0 = gj * H;
    uG.value.set(x0, z0, H, N);
    uGo.value.set(go[0], go[1], 1 / SIZE, dt);
    // the solids, when the grid moved or the static things changed
    if (solDirty) {
      solDirty = false;
      if (topOk) { SOLP.U.uR.value.set(T.ring[0], T.ring[1], 0, 0); SOLP.U.uT0.value.set(T.rise[0], T.rise[1], T.riseWide[0], T.riseWide[1]); SOLP.U.uT1.value.set(T.drop[0], T.drop[1], 0, 0); renderer.setRenderTarget(SOL); renderer.render(SOLP.sc, cam); }
      else { renderer.setRenderTarget(SOL); renderer.clear(true, false, false); }
    }
    const Sc = S[cur], Sn = S[1 - cur];
    ADV.U.tS.value = Sc.texture; renderer.setRenderTarget(A); renderer.render(ADV.sc, cam);
    blowStep(dt);
    MAC.U.tS.value = Sc.texture; MAC.U.uK.value.set(T.maccormack ? (T.macVel ? 2 : 1) : 0, T.vort * H, T.shelter ? 1 : 0, ns);
    renderer.setRenderTarget(B); renderer.render(MAC.sc, cam);
    cpuStep(dt); puffStep(dt); bodyStep(dt); ns = 0;
    // the pressure: alpha = h^2 / (c dt)^2 (0: incompressible), the diagonal with the leak, last step's P in this step's units
    const al = T.c > 0 && T.c < 1e6 ? H * H / (T.c * T.c * dt * dt) : 0;
    J0.U.uJ.value.set(al, 4 + al * (1 + dt / Math.max(1e-3, T.relax)), 1, 0);
    J0.U.uSh.value.set(di, dj);
    J0.U.tP.value = P[pc].texture; renderer.setRenderTarget(P[1 - pc]); renderer.render(J0.sc, cam); pc = 1 - pc;
    for (let k = 1; k < T.iters; k++) { JI.U.tP.value = P[pc].texture; renderer.setRenderTarget(P[1 - pc]); renderer.render(JI.sc, cam); pc = 1 - pc; }
    FIN.U.uF.value.set(Math.exp(-dt / T.damp), dt * T.drag, dt * T.clear[0], Math.exp(-dt / T.smoke));
    FIN.U.uF2.value.set(Math.max(1, T.sponge), dt * T.spongeK, T.vmax, T.clear[1]); FIN.U.uSm.value = T.smooth;
    FIN.U.tP.value = P[pc].texture; renderer.setRenderTarget(Sn); renderer.render(FIN.sc, cam);
    go1[0] = go[0]; go1[1] = go[1]; go[0] = x0; go[1] = z0; cur = 1 - cur;
    rect.set(x0, z0, 1 / SIZE, 1 / SIZE); api.tex = Sn.texture;
    renderer.setRenderTarget(prev);
    api.steps = ++steps; api.ms = api.ms * .9 + (performance.now() - t0) * .1;
  }
  // ---- THE CLOCK: G.air.step(dt) hands the air the views' time (the dt the features' views step by: slowed in slow motion,
  // none in a hitstop's freeze, a pause or a still photo), so the field keeps time with the smoke it pushes. Until anything
  // hands it time, it follows the frame's own clock (the air on its own: no view feeding it)
  function feed(dt) { fed = true; if (dt > 0) fedT += dt; }
  // ---- once a frame (gfx.js render, before the composite): the fixed steps due, then what the frame shows between the last two
  let lastT = -1;
  function tick(now, still, x, z) {
    const wall = lastT < 0 || still ? 0 : Math.min(.1, (now - lastT) / 1000); lastT = now;
    const dt = fed ? Math.min(.1, fedT) : wall; fedT = 0;
    cx = x; cz = z; cpuCentre(x, z);
    const h = 1 / TUNE.hz;
    acc += dt;
    let n = 0;
    for (; acc > 1e-9 && n < 3; n++) { run(h); acc -= h; }
    if (acc > 0) acc = 0;   // (behind after 3 steps: let it go)
    const al = 1 + acc / h;
    if (al < .999 && steps > 1) {   // the frame between the last two steps: blended on the current grid
      const prev = renderer.getRenderTarget();
      uG.value.set(go[0], go[1], H, N); uGo.value.set(go1[0], go1[1], 1 / SIZE, h);
      LRP.U.tS0.value = S[1 - cur].texture; LRP.U.tS1.value = S[cur].texture; LRP.U.uA.value = al;
      renderer.setRenderTarget(L); renderer.render(LRP.sc, cam); renderer.setRenderTarget(prev);
      api.tex = L.texture;
    } else api.tex = S[cur].texture;
  }
  // ---- the debug view, over the frame (after the composite, the mist and the rays)
  function over() {
    if (!DBG || compU.uDebug.value) return;
    DBG.U.tSt.value = api.tex; renderer.render(DBG.sc, cam);
  }
  return {api, grab, tick, over};
}
