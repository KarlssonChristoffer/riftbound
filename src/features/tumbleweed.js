// TUMBLEWEEDS (view): the desert's signature. A few dry tangles of twigs (up to TUNE.n.max round the view, more the windier
// it is) roll and bounce downwind with the gusts, spinning as they go. Only in the desert. SHOW ONLY: nothing here touches the
// sim (no entities, no colliders, no events); the weeds are this file's own pool, like riverside.js's lily pads.
//   life     spawned just off-screen UPWIND of the view while the wind is up (host.wind: the same gust fronts the plants feel),
//            gone again off-screen downwind (or after TUNE.life s, or down the canyon, or drifted off in the creek)
//   motion   the ground speed eases toward TUNE.push x the wind where it is (a calm lets it settle), it hops every metre or
//            two (higher the faster it goes), a strong gust bounces it, landings bounce a little; it spins by the distance it
//            rolled (radius x angle) about the axis across its motion. In the air it rides the wind
//   contact  read-only: host.entities.near + the exact test (a prop's r or rect, the height it stands to: a tumbleweed
//            higher than a wall or a crate passes over it), the mesa's cliff (host.elev). It bumps off softly; pushed into
//            a wall by the wind it LODGES there (sliding along it with what the wind gives sideways) until a gust strong
//            enough lifts it out (TUNE.free): over a low wall, or back at it. Small rocks, tufts and bushes make it hop.
//            The player walking or rolling into one knocks it away (a little hop), an arrow through it kicks it along
//   water    in the creek it floats half sunk and drifts with the current; the canyon's hole swallows it
//   devils   a dust devil (features/dust.js F.swirl) catches it: it whirls round and is lifted, then dropped
//   art      a 3D tangle of curling twigs per variant (three sizes), turned about the rolling axis and drawn in the desert's
//            straw (outer twigs, lit from the top-left) and bark (inner / far twigs) ramps, ROLL frames a turn for 4 axes
//            (the screen directions it can roll in, 45 deg apart; the opposite way plays them backward), with hysteresis
//            on the axis so a wobble in the wind doesn't flick it. One atlas, built once. A camera-facing card with a sun
//            shadow (the shadow is the tangle's own lace)
// FEATURE CONTRACT (main.js): create(host) -> F: view, frame, biomeChanged, toggle; F.weeds (the pool, tests), F.info().
// OWNS: its weeds (a fixed pool), its atlas. READS: host.wind (at, level), host.entities.near (props: kind, r / rect, z,
// gone / broken), host.elev / inStream, host.biome (id, hole, style.wallH), host.world.waterH, host.layout.stream,
// host.player, host.arrows, the dust feature's devils (F.swirl), combat.explode events (a blast throws them). EMITS: 'tumbleweed.bounce' (audio: a dry rustle when one
// comes down hard or is knocked, near the player and on screen, at most every TUNE.sound.every s).
// BUDGET: view <= 0.07 ms, frame <= 0.02 ms with 4-8 weeds (measured 2026-10-02, headless 1920x1080, a gale: view .065 avg,
// .031 in a tight loop; frame .009); nothing in other biomes; no allocation per frame.
import {flags} from '../core/flags.js';
import {clamp, hypot2} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';
import {ART} from '../world/biomes.js';
import {pack} from '../world/kit3d.js';

const TAU = Math.PI * 2, R = Math.random, rr = (a, b) => a + R() * (b - a);
// ---------------------------------------------------------------- tunables
const TUNE = {
  n: {k: 3.2, at: .45, max: 8},   // weeds wanted round the view = k x (wind level - at), capped at max
  every: [1.4, 4.5],              // s between two spawns while there are fewer than wanted (divided by the level)
  size: [.27, .34, .41],          // the three variants' radius (m)
  push: 2.6,                      // ground speed = push x the wind there (m/s): a breeze's gust ~2.5 m/s, a gale's ~8
  grip: 1.5,                      // 1/s: how fast it takes that speed on the ground
  air: 1.1,                       // 1/s in the air (light: it rides the wind)
  still: .45,                     // m/s of wind below which it rolls to a stop
  stop: 1.3,                      // m/s^2: how it slows then
  hop: {every: [.6, 2.4], v: [.5, 1], k: [.1, .3], gust: .6, big: [1.6, 2.8]},   // m rolled between hops; m/s up + x speed; a gust (level x gust) bounce
  g: 7.5,                         // m/s^2 (light and draggy: it comes down soft)
  bounce: .3, land: .88,          // a landing: the vertical speed kept (up again), the horizontal kept
  wall: .35,                      // restitution off a wall or a prop
  free: {gust: 1.1, rate: 1.1, up: [3.4, 5.4]},   // lodged: a gust over this (level x gust) frees it at this rate (/s), this fast up (m/s)
  margin: 1.4, gone: 4.5,         // m outside the view: where they come in / where they are dropped
  life: 90,                       // s at most
  player: {r: .3, kick: 1.3, max: 5, up: [1.1, 1.9], roll: 1.4},   // his body radius, the push off him (x his speed, at most max m/s), the hop, x when he rolls into it
  arrow: {kick: .14, up: [1.2, 2]},
  sound: {hard: 1.5, near: 10, every: .3},   // a bounce is heard: coming down faster than this (m/s), within this of the player (m), this often (s)
  water: {sink: .5, flow: .5, wind: .25, rate: .8},       // floating: share of it under, the creek's pace (m/s), the wind's share
  ROLL: 16,                       // frames a turn
  // the tangle (tools: tmp/western/life/tools/twsheet.mjs previews it offline): twigs (+ random up to) x (size / .34)^k, how many of
  // them inner, how hard they curl round the ball, their length (ball radii), wobble, how far a twig's end may poke out, the shell
  art: {twigs: [28, 6], k: 1.6, inner: 3, curl: 4, len: [.9, 1.2], jit: 1.6, out: .12, shell: .84},
};
// how high things stand (m) for a tumbleweed going over them; the radius it bumps at where the prop's own r is the player's
// (a saguaro's trunk is thinner than its collider). small: makes it hop instead of blocking (scatter has no collider)
const TALL = {tower: 5, gatepost: 1.8, pillar: 3, pillar_broken: 1.4, tree: 5, dummy: 1.7, brute: 2.2, crate: .8, barrel: .95, barrel_x: .95,
  pot: .5, chest: .6, goods: .7, woodpile: .7, campfire: .35, brazier: 1.2, ruin: 1, rubble: .5, crystal: 1, beacon: 1.6, stall: 2.4, bench: .5};
const RAD = {tree: .24, rock_big: .45};
const SMALL = {rock: .12, tuft: .05, bush: .22};   // hop when it rolls into one (m: how far it reaches)

// ORDER (core/features.js): the wind's step (gust fronts) and the dust devils' (they whirl the weeds) come first
export const order = {after: ['wind', 'dust']};
export async function create(host) {
  const F = {name: 'tumbleweed', label: 'Tumbleweeds', ambient: true, on: flags.get('tumbleweed') !== '0', ms: 0};
  const {PPM, PPMH} = host, ctx = host.ctxO, G = host.G;

  // ================================================================ the art: a tangle per variant, ROLL frames x 4 axes
  // bleached twigs in front (paler than the sand, so it reads on it), dark weathered ones at the back and inside
  const STRAW = ART.ramp('#f2e4c0', '#c9a873', '#9a7a50', '#5e4a34'), BARK = ART.ramp('#9c8264', '#7a624a', '#584634', '#3a2e22'), TA = TUNE.art;
  const C20 = Math.cos(20 * Math.PI / 180), S20 = Math.sin(20 * Math.PI / 180), T20 = S20 / C20;
  const LX = -.55, LY = .45, LZ = .7, LL = Math.hypot(LX, LY, LZ);   // the light (model axes: u right, v toward the camera, w up)
  // the model: points along curling twigs inside the unit ball (most near its shell, a few through the middle), 4 floats
  // each: u, v, w, inner (1 = an inner twig: drawn in the bark ramp)
  function tangle(seed, size) {
    const Rn = mulberry32(seed), pts = [], n = Math.round((TA.twigs[0] + (Rn() * TA.twigs[1] | 0)) * size);
    for (let i = 0; i < n; i++) {
      let x, y, z; do { x = Rn() * 2 - 1; y = Rn() * 2 - 1; z = Rn() * 2 - 1; } while (x * x + y * y + z * z > 1 || x * x + y * y + z * z < .01);
      const inner = i < TA.inner, l0 = Math.hypot(x, y, z), rad = inner ? .3 + Rn() * .35 : TA.shell + Rn() * (1 - TA.shell);
      x = x / l0 * rad; y = y / l0 * rad; z = z / l0 * rad;
      let dx = Rn() * 2 - 1, dy = Rn() * 2 - 1, dz = Rn() * 2 - 1;
      { const k = (dx * x + dy * y + dz * z) / (rad * rad); dx -= k * x; dy -= k * y; dz -= k * z; const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l; }
      const curl = (Rn() * 2 - 1) * TA.curl, len = TA.len[0] + Rn() * TA.len[1], step = .03;
      for (let s = 0; s < len / step; s++) {
        pts.push(x, y, z, inner ? 1 : 0);
        const l = Math.hypot(x, y, z) || 1, ux = x / l, uy = y / l, uz = z / l;   // curl round the radius (the twigs wind round the ball)
        dx += ((uy * dz - uz * dy) * curl + (Rn() - .5) * TA.jit) * step; dy += ((uz * dx - ux * dz) * curl + (Rn() - .5) * TA.jit) * step; dz += ((ux * dy - uy * dx) * curl + (Rn() - .5) * TA.jit) * step;
        const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
        x += dx * step; y += dy * step; z += dz * step;
        const r2 = Math.hypot(x, y, z), lim = s > len / step - 4 ? 1 + TA.out : 1; if (r2 > lim) { x *= lim / r2; y *= lim / r2; z *= lim / r2; }   // (it slides along the shell; its last points may poke out)
      }
    }
    return new Float32Array(pts);
  }
  // one frame: the model turned by theta about (ax, ay, 0), projected as the card shows it (x: PPM px / m; y: PPMH px / m of
  // height, the ground's depth tilted 20 deg toward the camera), the nearest point wins a pixel
  function frame(M, rad, ax, ay, theta, W, H, cx, cy) {
    const P = new ART.Pix(W, H), Z = new Float32Array(W * H).fill(-9), I = new Uint8Array(W * H), Lt = new Float32Array(W * H);
    const c = Math.cos(theta), s = Math.sin(theta), k = 1 - c;
    for (let i = 0; i < M.length; i += 4) {
      const x = M[i], y = M[i + 1], z = M[i + 2], d = ax * x + ay * y;   // Rodrigues about (ax, ay, 0)
      const cxp = ay * z, cyp = -ax * z, czp = ax * y - ay * x;
      const u = x * c + cxp * s + ax * d * k, v = y * c + cyp * s + ay * d * k, w = z * c + czp * s;
      const X = Math.floor(cx + u * rad * PPM), Y = Math.floor(cy + (v * T20 - w) * rad * PPMH);
      if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
      const j = Y * W + X, dep = v * C20 + w * S20;
      if (dep <= Z[j]) continue;
      Z[j] = dep; I[j] = M[i + 3]; const l = Math.hypot(u, v, w) || 1; Lt[j] = (u * LX + v * LY + w * LZ) / (l * LL);
    }
    for (let j = 0; j < W * H; j++) {
      if (Z[j] < -8) continue;
      const X = j % W, Y = (j / W) | 0, dep = Z[j], lit = Lt[j];
      if (I[j] || dep < -.42) P.p(X, Y, BARK, dep < -.72 ? 3 : 2);   // inner and far twigs: the dark lace seen through the gaps
      else P.p(X, Y, STRAW, lit > .5 && dep > .1 ? 0 : lit > -.15 ? 1 : 2);
    }
    return P;
  }
  const ROLL = TUNE.ROLL, NV = TUNE.size.length, FR = [];   // FR[v][bin][k] = atlas rect
  {
    const items = [];
    for (let v = 0; v < NV; v++) {
      const rad = TUNE.size[v], M = tangle(311 + v * 97, (rad / .34) ** TA.k), W = Math.ceil(2 * rad * (1 + TA.out) * PPM) + 3, H = W, cx = W / 2, cy = H / 2;   // (room for the twig ends)
      const py = Math.min(H - 1, Math.round(cy + rad * PPMH));
      for (let b = 0; b < 4; b++) {
        const psi = b * Math.PI / 4, ax = -Math.sin(psi), ay = Math.cos(psi);   // rolling toward psi (view frame: x right, y toward the camera)
        for (let k = 0; k < ROLL; k++) items.push({name: `w${v}_${b}_${k}`, img: frame(M, rad, ax, ay, k / ROLL * TAU, W, H, cx, cy).canvas(), pivot: [Math.round(cx), py]});
      }
    }
    const A = pack(items, 512);
    F.atlas = A;
    for (let v = 0; v < NV; v++) { FR[v] = []; for (let b = 0; b < 4; b++) { FR[v][b] = []; for (let k = 0; k < ROLL; k++) FR[v][b][k] = A.fr[`w${v}_${b}_${k}`]; } }
  }

  // ================================================================ the weeds: a fixed pool
  const MAXN = TUNE.n.max + 2, weeds = [];
  for (let i = 0; i < MAXN; i++) weeds.push({on: false, v: 0, r: .3, x: 0, y: 0, h: 0, gz: 0, vx: 0, vy: 0, vh: 0, th: 0, w: 0, bin: 0, sgn: 1, hopIn: 1,
    st: 'roll', lodge: 0, nx: 0, ny: 0, age: 0, wet: 0, fall: false, hit: null, kick: 0});
  F.weeds = weeds;
  let biomeOn = false, T = 0, spawnIn = 1, wanted = 0, count = 0, waterH = -.18, dustF = null, wallH = 1.2, arrows = null;   // (dustF: the dust feature, looked up once)
  // the player, read once a view step (host.player's getters turn his view frame into the world's on every read)
  const PL = {ok: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, roll: false};
  function readPlayer() { const p = host.player; PL.ok = !!p; if (!p) return; PL.x = p.x; PL.y = p.y; PL.z = p.z || 0; PL.vx = p.vx || 0; PL.vy = p.vy || 0; PL.roll = p.state === 'roll'; }
  const WA = {x: 0, y: 0, g: 0}, SW = {x: 0, y: 0, up: 0}, NEAR = [];

  // the view: its centre and half sizes in VIEW-frame metres; screen right (RX, RY) and toward the camera (FX, FY) on the ground
  let RX = 1, RY = 0, FX = 0, FY = 1;
  const VB = {cx: 0, cy: 0, hw: 8, hh: 5};
  function viewSync() {
    const a = host.yaw, ZM = host.zoom || 1; RX = Math.cos(a); RY = -Math.sin(a); FX = Math.sin(a); FY = Math.cos(a);
    const T3 = G.view.T, vx = T3.x * RX + T3.z * RY, vy = T3.x * FX + T3.z * FY;
    VB.cx = vx; VB.cy = vy - T3.y * ctx.PPMH / ctx.PPMY; VB.hw = host.VW / 2 / (PPM * ZM); VB.hh = host.VH / 2 / (ctx.PPMY * ZM);
  }
  // metres outside the view (0 inside), along the view's axes
  const outside = (x, y) => { const dx = Math.abs(x * RX + y * RY - VB.cx) - VB.hw, dy = Math.abs(x * FX + y * FY - VB.cy) - VB.hh; return Math.max(0, dx, dy); };
  const canyon = (x, y) => y > ctx.HM - 4.5 && !host.inStream(x, y) && host.biome.hole?.(x, y);
  function blockedAt(x, y, r) {   // a spawn spot: a prop's collider, the creek, the mesa, the canyon
    if (x < .5 || y < .5 || x > ctx.WM - .5 || y > ctx.HM - 3.5 || host.inStream(x, y) || host.elev(x, y) > .05 || canyon(x, y)) return true;
    for (const p of host.entities.near(x, y, r + 1, NEAR)) {
      if (p.gone || p.broken || (p.z || 0) > .3) continue;
      if (p.rect) { if (x > p.rect[0] - r && x < p.rect[2] + r && y > p.rect[1] - r && y < p.rect[3] + r) return true; }
      else { const pr = RAD[p.kind] ?? p.r; if (pr > 0 && hypot2(p.x - x, p.y - y) < pr + r) return true; }
    }
    return false;
  }
  function spawn() {
    const w = host.wind; if (!w) return false;
    let q = null; for (const o of weeds) if (!o.on) { q = o; break; } if (!q) return false;
    // the upwind edges of the view (view frame), weighted by how square the wind meets them
    const ux = w.dir[0] * RX + w.dir[1] * RY, uy = w.dir[0] * FX + w.dir[1] * FY;
    const wl = Math.max(0, ux), wr = Math.max(0, -ux), wt = Math.max(0, uy), wb = Math.max(0, -uy), m = TUNE.margin + .3;
    for (let tries = 0; tries < 6; tries++) {
      let e = R() * (wl + wr + wt + wb), vx, vy;
      const along = R() * 2 - 1;
      if ((e -= wl) < 0) { vx = VB.cx - VB.hw - m; vy = VB.cy + along * (VB.hh + 1); }
      else if ((e -= wr) < 0) { vx = VB.cx + VB.hw + m; vy = VB.cy + along * (VB.hh + 1); }
      else if ((e -= wt) < 0) { vy = VB.cy - VB.hh - m - 1.2; vx = VB.cx + along * (VB.hw + 1); }   // (the far edge: a little further, tall things show above it)
      else { vy = VB.cy + VB.hh + m; vx = VB.cx + along * (VB.hw + 1); }
      const x = vx * RX + vy * FX, y = vx * RY + vy * FY, v = R() < .25 ? 0 : R() < .55 ? 1 : 2, r = TUNE.size[v];
      if (blockedAt(x, y, r)) continue;
      w.at(x, y, WA);
      q.on = true; q.v = v; q.r = r; q.x = x; q.y = y; q.gz = 0; q.h = rr(0, .3); q.vh = rr(0, 1);
      q.vx = WA.x * TUNE.push * rr(.6, 1); q.vy = WA.y * TUNE.push * rr(.6, 1); q.th = R() * TAU; q.w = 0; q.sgn = 1;
      q.bin = ((Math.round(Math.atan2(q.vx * FX + q.vy * FY, q.vx * RX + q.vy * RY) / (Math.PI / 4)) % 8) + 8) % 8;
      q.hopIn = rr(TUNE.hop.every[0], TUNE.hop.every[1]); q.st = 'roll'; q.lodge = 0; q.age = 0; q.wet = 0; q.fall = false; q.hit = null; q.kick = 0;
      return true;
    }
    return false;
  }
  const drop = q => { q.on = false; };
  let sndT = -9;
  function sound(q, k) {   // a dry rustle (audio.js plays it: the critter rustle, pitched down)
    const P = PL, S = TUNE.sound;
    if (T - sndT < S.every || !P.ok || hypot2(q.x - P.x, q.y - P.y) > S.near || !G.onScreen(q.x, q.gz + q.h, q.y, 8)) return;
    sndT = T; host.events.push({type: 'tumbleweed.bounce', x: q.x, y: q.y, k: clamp(k, 0, 1)});
  }

  // ---- contact: props (read-only), the mesa's cliff, the player, arrows
  function collide(q) {
    q.nx = q.ny = 0;
    let hit = false;
    const top = q.gz + q.h;   // the weed's underside (m)
    for (const p of host.entities.near(q.x, q.y, q.r + 1, NEAR)) {
      if (p.gone || p.broken) continue;
      const pz = p.z || 0; if (Math.abs(pz - q.gz) > .8) continue;
      const k = p.kind, small = SMALL[k];
      if (small !== undefined) {   // scatter: a hop over it
        if (q.h < .05 && q.hopIn > .25 && hypot2(p.x - q.x, p.y - q.y) < q.r + small) { q.vh = Math.max(q.vh, rr(.9, 1.4)); q.hopIn = rr(TUNE.hop.every[0], TUNE.hop.every[1]); if (k === 'bush') { q.vx *= .9; q.vy *= .9; } }
        continue;
      }
      const tall = k.startsWith('wall_') ? wallH : TALL[k] ?? 1.2;
      if (top > pz + tall) continue;   // over it
      let nx, ny, d, pen;
      if (p.rect) {
        const qx = clamp(q.x, p.rect[0], p.rect[2]), qy = clamp(q.y, p.rect[1], p.rect[3]), ex = q.x - qx, ey = q.y - qy;
        d = hypot2(ex, ey); if (d >= q.r) continue;
        if (d > 1e-4) { nx = ex / d; ny = ey / d; pen = q.r - d; }
        else {   // the centre inside the rect: out through the nearest side
          const l = q.x - p.rect[0], r2 = p.rect[2] - q.x, t = q.y - p.rect[1], b = p.rect[3] - q.y, mn = Math.min(l, r2, t, b);
          nx = mn === l ? -1 : mn === r2 ? 1 : 0; ny = mn === t ? -1 : mn === b ? 1 : 0; pen = q.r + mn;
        }
      } else {
        const pr = RAD[k] ?? p.r; if (!(pr > 0)) continue;
        const ex = q.x - p.x, ey = q.y - p.y; d = hypot2(ex, ey); if (d >= pr + q.r) continue;
        if (d > 1e-4) { nx = ex / d; ny = ey / d; } else { nx = 1; ny = 0; }
        pen = pr + q.r - d;
      }
      q.x += nx * pen; q.y += ny * pen;
      const vn = q.vx * nx + q.vy * ny;
      if (vn < 0) { q.vx -= (1 + TUNE.wall) * vn * nx; q.vy -= (1 + TUNE.wall) * vn * ny; q.w *= -.5; }
      q.nx = nx; q.ny = ny; hit = true;
    }
    // the mesa's cliff (and anything the ground rises to): a wall of rock
    const e = host.elev(q.x, q.y);
    if (e > q.gz + q.h + .3 && !q.fall) {
      const ex = host.elev(q.x + .35, q.y) - host.elev(q.x - .35, q.y), ey = host.elev(q.x, q.y + .35) - host.elev(q.x, q.y - .35), l = hypot2(ex, ey);
      let nx = -ex / (l || 1), ny = -ey / (l || 1);
      if (!(l > 0)) { const sp = hypot2(q.vx, q.vy) || 1; nx = -q.vx / sp; ny = -q.vy / sp; }
      for (let s = 0; s < 8 && host.elev(q.x, q.y) > q.gz + q.h + .3; s++) { q.x += nx * .06; q.y += ny * .06; }
      const vn = q.vx * nx + q.vy * ny; if (vn < 0) { q.vx -= (1 + TUNE.wall) * vn * nx; q.vy -= (1 + TUNE.wall) * vn * ny; }
      q.nx = nx; q.ny = ny; hit = true;
    }
    // the player: he knocks it away (harder rolling), it hops
    const P = PL;
    if (P.ok && Math.abs(P.z - q.gz) < 1 && q.h < 1.3) {
      const ex = q.x - P.x, ey = q.y - P.y, d = hypot2(ex, ey), rr0 = q.r + TUNE.player.r;
      if (d < rr0) {
        const nx = d > 1e-4 ? ex / d : 1, ny = d > 1e-4 ? ey / d : 0, pvx = P.vx, pvy = P.vy, rel = (q.vx - pvx) * nx + (q.vy - pvy) * ny;
        q.x = P.x + nx * rr0; q.y = P.y + ny * rr0;
        if (rel < .3) {
          const k = TUNE.player.kick * (P.roll ? TUNE.player.roll : 1), push = Math.min(TUNE.player.max, Math.max(1.2, hypot2(pvx, pvy)) * k);
          q.vx = pvx * .5 + nx * push; q.vy = pvy * .5 + ny * push; q.vh = Math.max(q.vh, rr(TUNE.player.up[0], TUNE.player.up[1]) * (P.roll ? 1.3 : 1));
          if (q.kick <= 0) sound(q, .5 + hypot2(pvx, pvy) * .08);
          q.st = 'roll'; q.lodge = 0; q.kick = .4;
        }
      }
    }
    // arrows through it (each arrow once)
    const A = arrows;
    if (A) for (let i = 0; i < A.length; i++) {
      const a = A[i]; if (a.stuck || a === q.hit) continue;
      const ex = a.x - q.x, ey = a.y - q.y, rel = a.h - (q.gz + q.h);
      if (ex * ex + ey * ey < (q.r + .06) * (q.r + .06) && rel > -.1 && rel < q.r * 2 + .1) {
        q.hit = a; q.vx += a.vx * TUNE.arrow.kick; q.vy += a.vy * TUNE.arrow.kick; q.vh = Math.max(q.vh, rr(TUNE.arrow.up[0], TUNE.arrow.up[1])); q.st = 'roll'; q.lodge = 0;
      }
    }
    return hit;
  }

  function step(q, dt, lv) {
    const w = host.wind, P0 = TUNE;
    q.age += dt; q.kick = Math.max(0, q.kick - dt);
    w.at(q.x, q.y, WA);
    let tx = WA.x * P0.push, ty = WA.y * P0.push;
    const gust = WA.g * lv;
    const dust = dustF ??= host.feature('dust') || false, sw = dust && dust.on && dust.swirl ? dust.swirl(q.x, q.y, SW) : null;
    if (sw) { tx += sw.x; ty += sw.y; if (sw.up > 0 && q.vh < sw.up * 2.2) q.vh += sw.up * 9 * dt; }
    const air = q.h > .02 || q.vh > 0;
    // ---- the water: afloat, drifting with the creek
    if (!q.fall && q.h < .1 && host.inStream(q.x, q.y)) {
      q.wet += dt; q.st = 'float';
      const S = host.layout?.stream;   // (the creek runs south, into the canyon)
      const fx = WA.x * P0.water.wind, fy = WA.y * P0.water.wind + P0.water.flow, k = Math.min(1, dt * P0.water.rate);
      q.vx += (fx - q.vx) * k; q.vy += (fy - q.vy) * k; q.vh = 0; q.h = 0;
      let nx = q.x + q.vx * dt, ny = q.y + q.vy * dt;
      if (!host.inStream(nx, q.y)) { nx = q.x; q.vx *= -.3; }
      if (!host.inStream(nx, ny)) { ny = q.y; q.vy *= -.3; }
      if (S && !host.inStream(nx, ny)) { nx = S.cx(q.y); }   // (a bank in the way: back to mid-stream)
      q.x = nx; q.y = ny; q.gz = waterH - q.r * P0.water.sink * 2 + q.r * .08 * Math.sin(T * 2.3 + q.v);
      q.th += hypot2(q.vx, q.vy) / q.r * dt * .5 * q.sgn;
      return;
    }
    if (q.st === 'float') { q.st = 'roll'; q.gz = host.elev(q.x, q.y); }
    // ---- over the canyon: nothing under it
    if (!q.fall && canyon(q.x, q.y)) q.fall = true;
    // ---- speed: the ground eases it toward the wind (friction in a lull), the air carries it
    if (air) { const k = Math.min(1, dt * P0.air); q.vx += (tx - q.vx) * k; q.vy += (ty - q.vy) * k; q.vh -= P0.g * dt; }
    else if (q.st === 'lodge') {
      // pressed against the wall: only what the wind gives along it moves it; a strong gust lifts it out
      const tn = tx * q.nx + ty * q.ny, sx = tx - tn * q.nx, sy = ty - tn * q.ny, k = Math.min(1, dt * P0.grip);
      q.vx += (sx * .35 - q.vx) * k; q.vy += (sy * .35 - q.vy) * k;
      q.lodge += dt;
      if (gust > P0.free.gust && R() < P0.free.rate * dt * (gust - P0.free.gust + .3)) { q.vh = rr(P0.free.up[0], P0.free.up[1]); q.vx = tx * .8; q.vy = ty * .8; q.st = 'roll'; q.lodge = 0; }
      else if (tn > -.25) { q.st = 'roll'; q.lodge = 0; }   // the wind turned: it rolls off
    } else {
      const ts = hypot2(tx, ty), sp = hypot2(q.vx, q.vy);
      if (ts < P0.still * P0.push && sp < ts + .2) {   // a lull: rolling to a stop
        const dec = Math.min(sp, P0.stop * dt); if (sp > 1e-4) { q.vx -= q.vx / sp * dec; q.vy -= q.vy / sp * dec; }
      } else { const k = Math.min(1, dt * P0.grip); q.vx += (tx - q.vx) * k; q.vy += (ty - q.vy) * k; }
      // hops: every so far rolled (higher the faster), a big one off a gust
      q.hopIn -= sp * dt;
      if (q.hopIn <= 0 && sp > .5) { q.vh = rr(P0.hop.v[0], P0.hop.v[1]) + sp * rr(P0.hop.k[0], P0.hop.k[1]); q.hopIn = rr(P0.hop.every[0], P0.hop.every[1]); }
      if (gust > P0.hop.gust && R() < (gust - P0.hop.gust) * .7 * dt) q.vh = Math.max(q.vh, rr(P0.hop.big[0], P0.hop.big[1]) * Math.min(1.4, gust));
    }
    // ---- move, then contact
    const ox = q.x, oy = q.y;
    q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt;
    if (!q.fall) {
      const g = host.elev(q.x, q.y);
      if (g < q.gz - .3) { q.h += q.gz - g; q.gz = g; }   // off the mesa's edge: a drop
      const hit = collide(q);
      if (hit && q.h < .05 && q.st !== 'lodge') {
        const tn = tx * q.nx + ty * q.ny;
        if (tn < -.3 && hypot2(q.vx, q.vy) < 1.2) { q.st = 'lodge'; q.lodge = 0; }
      }
      if (q.h <= 0) {   // landing
        q.h = 0;
        if (q.vh < -.9) {
          if (-q.vh > P0.sound.hard) { sound(q, (-q.vh - P0.sound.hard) / 3); if (dustF && dustF.puff) dustF.puff(q.x, q.y, Math.min(1.5, -q.vh / 2.5)); }   // (a little sand thrown up)
          q.vh = -q.vh * P0.bounce; q.vx *= P0.land; q.vy *= P0.land;
        } else q.vh = 0;
        q.gz = host.elev(q.x, q.y);
      }
    } else if (q.gz + q.h < -6) { drop(q); return; }
    // ---- the spin: rolled distance / radius about the axis across its motion (in the air: it keeps turning, slowing)
    const mu = q.vx * RX + q.vy * RY, mv = q.vx * FX + q.vy * FY, sp = hypot2(mu, mv);
    if (sp > .15) {
      const a = Math.atan2(mv, mu), cur = q.bin * Math.PI / 4;
      let da = a - cur; da -= Math.round(da / TAU) * TAU;
      if (Math.abs(da) > .55) q.bin = ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8;   // (hysteresis: +-31 deg round the axis' own direction)
    }
    const along = mu * Math.cos(q.bin * Math.PI / 4) + mv * Math.sin(q.bin * Math.PI / 4);   // the speed along the frames' rolling direction
    if (q.h < .02 && q.st !== 'lodge') q.w = along / q.r;
    else if (q.st === 'lodge') q.w = Math.sin(T * 9 + q.v * 2) * gust * 1.2;   // shivering against the wall in the gusts
    else q.w *= Math.max(0, 1 - dt * .6);
    q.th += q.w * dt;
    if (ox === q.x && oy === q.y && q.st !== 'lodge') q.w *= .9;
  }

  // ================================================================ the view step / the draw
  const SP = {img: F.atlas.img, sx: 0, sy: 0, sw: 1, sh: 1, px: 0, py: 0, x: 0, y: 0, h: 0, type: 3, shadow: true};
  // a blast (combat.explode) throws the weeds near it away and up
  function blasts(evs) {
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]; if (e.type !== 'combat.explode') continue;
      const reach = (e.r || 2) * 2.2;
      for (const q of weeds) {
        if (!q.on) continue;
        const dx = q.x - e.x, dy = q.y - e.y, d = hypot2(dx, dy); if (d > reach) continue;
        const k = (1 - d / reach) * 9, ux = d > 1e-3 ? dx / d : 1, uy = d > 1e-3 ? dy / d : 0;
        q.vx += ux * k; q.vy += uy * k; q.vh = Math.max(q.vh, 2 + k * .5); q.st = 'roll'; q.lodge = 0;
      }
    }
  }
  F.view = (dt, evs) => {
    const t0 = performance.now();
    dt = Math.min(.05, Math.max(0, dt || 0)); T += dt;
    biomeOn = host.biome?.id === 'desert';
    const w = host.wind;
    if (!F.on || !biomeOn || !w) { if (count) { for (const q of weeds) q.on = false; count = 0; } F.ms = F.ms * .95 + (performance.now() - t0) * .05; return; }
    waterH = host.world?.waterH ?? -.18; wallH = host.biome.style?.wallH ?? 1.2; arrows = host.arrows;
    viewSync(); readPlayer();
    const lv = w.on === false ? 0 : (w.level ?? 1);
    wanted = clamp(Math.round(TUNE.n.k * (lv - TUNE.n.at)), 0, TUNE.n.max);
    if (evs && evs.length && count) blasts(evs);
    count = 0;
    const steps = dt > 1 / 40 ? 2 : 1, h = dt / steps;
    for (const q of weeds) {
      if (!q.on) continue;
      for (let s = 0; s < steps && q.on; s++) step(q, h, lv);
      if (!q.on) continue;
      const out = outside(q.x, q.y);
      // gone: well off-screen (not while it is just coming in), too old off-screen, out of the map
      if ((out > TUNE.gone && q.age > 3) || out > TUNE.gone + 6 || (q.age > TUNE.life && out > .5) || (q.wet > 25 && out > .5) || q.x < -3 || q.x > ctx.WM + 3 || q.y < -3) { drop(q); continue; }
      count++;
    }
    if (count < wanted) { spawnIn -= dt * Math.max(.5, lv); if (spawnIn <= 0) { if (spawn()) count++; spawnIn = rr(TUNE.every[0], TUNE.every[1]); } }
    else spawnIn = Math.max(spawnIn, .5);
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  F.frame = () => {
    if (!F.on || !biomeOn || !count) return;
    for (const q of weeds) {
      if (!q.on) continue;
      const y = q.gz + q.h;
      if (!G.onScreen(q.x, y + q.r, q.y, 24)) continue;
      // the frame: the axis bin (4, the opposite direction plays backward), the phase by the turned angle
      const b = q.bin & 3, back = q.bin >= 4, th = back ? -q.th : q.th, k = ((Math.floor(th / TAU * ROLL) % ROLL) + ROLL) % ROLL, f = FR[q.v][b][k];
      SP.sx = f.sx; SP.sy = f.sy; SP.sw = f.sw; SP.sh = f.sh; SP.px = f.px; SP.py = f.py;
      SP.x = q.x; SP.y = q.y; SP.h = y; host.sprite(SP);
    }
  };
  F.biomeChanged = () => { for (const q of weeds) q.on = false; count = 0; spawnIn = 1; };
  F.toggle = () => { F.on = !F.on; if (!F.on) F.biomeChanged(); return F.on; };
  F.info = () => ({on: F.on, desert: biomeOn, wanted, count, weeds: weeds.filter(q => q.on).map(q => ({x: +q.x.toFixed(2), y: +q.y.toFixed(2), h: +q.h.toFixed(2), st: q.st, v: +hypot2(q.vx, q.vy).toFixed(2), age: +q.age.toFixed(1)}))});
  F.TUNE = TUNE;
  return F;
}
