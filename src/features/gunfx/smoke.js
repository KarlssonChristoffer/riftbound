// GUN SMOKE (view; features/gunfx.js's): the powder smoke of every shot (yours and the gunmen's), the thread off a hot
// barrel and the dust puffs where bullets land, in one of four looks (SMOKE.style: Shift+V in dev mode, the menu's Dev
// tab, ?smoke=):
//   pixel    lumpy pixel puffs in the world (render/puffs.js: in the G-buffer, with normals, so the sun or moon, the
//            ambient and every light, the muzzle flash, a campfire, light them like the rest of the world). Painted in
//            four tones; each swells fast, then breaks up (clumps, its rim and underside first) as it rises and drifts.
//            The barrel's wisp is a thread of single pixels
//   hybrid   the pixel puffs, and as each breaks up a soft haze takes over and thins out (dense clumps -> a veil; the
//            haze is HD, lit by hand: the ambient and the flash)
//   strands  a small dense core of puffs, and many motes the eddies carry off, each drawn with its last few steps:
//            curling pixel strands that thin out (dithered) as they go
//   soft     the old look: soft round HD puffs on the overlay (unlit; kept to compare)
// The motion is the same in every look: a shot's jet leaves fast along the shot and stops within a metre (drag), the
// front puff the biggest; then the smoke rolls in eddies (a field of them in the camera's plane, stronger with age),
// rises, drifts downwind and goes.
// OWNS: its pools (typed arrays, capped, reused) and its puffs' renderer (render/puffs.js).
// THE AIR (view/airdrift.js, AIRK.gun): every puff, wisp, mote and dust puff also takes the moving air (G.air: a blast
// blows it away and the inflow pulls it back, a muzzle's jet carries it on, a passer-by's wake stirs it): a velocity of
// its own (sax / say, the motes' mwax / mway: relaxed toward G.air.velAt where it is, k by how light it is) on top of its
// motion. ?air=0: none of it (the same arithmetic as before).
// READS: host.G (fx, toScreenInto, air), host.point / line, host.wind (through gunfx), host.mood (hybrid's haze), host.yaw,
// host.zoom, host.PPM.
// BUDGET: step ~.02 ms (110 puffs; strands: + 480 motes; the air: a velAt a puff a step, a mote every third step); frame: one instanced draw (<= 110 puffs), strands <= 2000
// lines / points; soft: <= 110 drawImage calls on the overlay.
import {flags} from '../../core/flags.js';
import {viewRandom} from '../../core/rng.js';
import {clamp} from '../../core/mathx.js';
import {createPuffs} from '../../render/puffs.js';
import {AIRK, createDrift} from '../../view/airdrift.js';

export const SMOKE = {
  style: 'pixel', STYLES: ['pixel', 'hybrid', 'strands', 'soft'],
  max: 110, puffs: 4, life: [1, 1.8], size: [.1, .2], grow: .6, rise: .45, speed: 2.3, drag: 3, alpha: .5, wisp: 1.6, wispGap: .09,
  gap: 1, gapSpeed: 1.1, gapBack: .22, gapSize: .4,   // the cylinder gap's side jets: puffs a side, m/s out, m back from the muzzle, x size
  // the eddies: m/s at their strongest, rad per m across them, rad/s they turn over, s after its birth a puff feels them
  // fully (the jet leaves smooth); a second, finer set: x k, x the strength
  swirl: {amp: .5, k: 4.2, w: 1.1, ramp: .45, k2: 2.3, a2: .45},
  // the wind (host.wind.at where each puff is): it carries the smoke (x the wind once the jet has slowed: the drag), and
  // tears it up: a puff ages faster by eat x its m/s + gust x the gust there (0..1), rolls harder (x 1 + swirl x m/s) and
  // rises less (/ 1 + flat x m/s: the plume lies down)
  wind: {follow: 1.1, eat: .3, gust: .5, swirl: .4, flat: .6},
  // pixel puffs: the biggest radius (art px), the share of its life before it starts to break up, the radius' slow growth
  // after the swell (x grow), the share of its life it dithers out in at the end, its glow of its own (a lift at night);
  // how see-through, by look (the dither's alpha in its middle), x that at its rim, x 1 - thin x how broken up it is
  pixel: {rmax: 14, erode: .3, grow: .25, fade: .14, lift: .05, alpha: {pixel: .85, hybrid: .62, strands: .72}, edge: .35, thin: .35},
  haze: {r: 1.7, a: .42},   // hybrid: the haze's radius (x the puff's), its alpha
  // strands: motes a shot (a big gun's), life s, speed (x speed), sideways m/s, x the eddies, rise m/s, how fast they take
  // up the wind (1/s: light, quicker than the puffs), trail samples (s apart), the share of its life drawn as a trail
  motes: {max: 480, n: 34, big: 46, life: [1, 2], speed: [.15, 1.25], side: .55, swirl: 1.8, rise: .3, catch: 3.6, trail: 6, every: 1 / 30, young: .6},
};
{ const s = flags.get('smoke'); if (SMOKE.STYLES.includes(s)) SMOKE.style = s; }

export const KIND = {shot: 0, wisp: 1, dust: 2};
// the puffs' tints: gun smoke, then each material's dust
export const TINTS = {smoke: [236, 232, 224], sand: [244, 232, 202], dirt: [218, 202, 174], snow: [246, 248, 255], stone: [208, 204, 198], adobe: [222, 196, 162], wood: [208, 186, 150]};
export const TINT = Object.keys(TINTS);
const TINT01 = TINT.map(k => TINTS[k].map(v => v / 255));
const TONE01 = TINT01.map(c => [c, c.map(v => v * .9), c.map((v, i) => v * [.76, .78, .84][i])]);   // the motes' and the wisp's tones

export function createSmoke(host) {
  const R = viewRandom('gunsmoke'), RR = (a, b) => a + R() * (b - a);
  const G = host.G, S = SMOKE, puffsR = createPuffs(G, S.max);
  // ---- the puffs (SoA): position, velocity, age / life, size (m) / growth (x grow), tint, alpha (x soft's), shape, kind
  const SM = S.max, sx = new Float32Array(SM), sy = new Float32Array(SM), sh = new Float32Array(SM), svx = new Float32Array(SM),
    svy = new Float32Array(SM), svh = new Float32Array(SM), st = new Float32Array(SM), sl = new Float32Array(SM), ss = new Float32Array(SM), sg = new Float32Array(SM),
    sk = new Uint8Array(SM), sa = new Float32Array(SM), sd = new Uint8Array(SM), sq = new Uint8Array(SM),
    sax = new Float32Array(SM), say = new Float32Array(SM);   // its share of the moving air (m/s: view/airdrift.js)
  let sN = 0;
  function puff(x, y, h, vx, vy, vh, life, size, grow = 1, tint = 0, alpha = 1, kind = KIND.shot) {
    let i = sN < SM ? sN++ : -1;
    if (i < 0) { let o = 0; for (let k = 1; k < SM; k++) if (st[k] / sl[k] > st[o] / sl[o]) o = k; i = o; }   // full: the oldest goes
    sx[i] = x; sy[i] = y; sh[i] = h; svx[i] = vx; svy[i] = vy; svh[i] = vh; st[i] = 0; sl[i] = life; ss[i] = size; sg[i] = grow; sk[i] = tint; sa[i] = alpha;
    sd[i] = (R() * 8) | 0; sq[i] = kind; sax[i] = say[i] = 0;
  }
  function kill(i) {
    const j = --sN; if (i === j) return;
    sx[i] = sx[j]; sy[i] = sy[j]; sh[i] = sh[j]; svx[i] = svx[j]; svy[i] = svy[j]; svh[i] = svh[j]; st[i] = st[j]; sl[i] = sl[j]; ss[i] = ss[j]; sg[i] = sg[j];
    sk[i] = sk[j]; sa[i] = sa[j]; sd[i] = sd[j]; sq[i] = sq[j]; sax[i] = sax[j]; say[i] = say[j];
  }
  // ---- the motes (strands): position, velocity, age / life, tone, and a ring of where it was (its trail: TR samples)
  const M = S.motes, MM = M.max, TR = M.trail, mx = new Float32Array(MM), my = new Float32Array(MM), mh = new Float32Array(MM), mvx = new Float32Array(MM),
    mvy = new Float32Array(MM), mvh = new Float32Array(MM), mt = new Float32Array(MM), ml = new Float32Array(MM), mc = new Uint8Array(MM),
    tx = new Float32Array(MM * TR * 3), tn = new Uint8Array(MM), th = new Uint8Array(MM),   // trail xyz, samples in it, its head
    mwx = new Float32Array(MM), mwy = new Float32Array(MM), mws = new Float32Array(MM), mwk = new Float32Array(MM),   // the wind where it is (m/s, speed, its tearing), a third of them a step
    mwax = new Float32Array(MM), mway = new Float32Array(MM);   // its share of the moving air (m/s), a third of them a step
  let mN = 0, trailT = 0, stepN = 0;
  function motes(x, y, h, ux, uy, n, speedK) {
    for (let k = 0; k < n && mN < MM; k++) {
      const i = mN++, sp = S.speed * RR(M.speed[0], M.speed[1]) * speedK, sd0 = RR(-M.side, M.side), o = RR(0, .12);
      mx[i] = x + ux * o + RR(-.03, .03); my[i] = y + uy * o + RR(-.03, .03); mh[i] = h + RR(-.03, .03);
      mvx[i] = ux * sp - uy * sd0; mvy[i] = uy * sp + ux * sd0; mvh[i] = RR(-.15, .35);
      mt[i] = 0; ml[i] = RR(M.life[0], M.life[1]); mc[i] = R() < .55 ? 0 : 1; tn[i] = 0; th[i] = 0; mwx[i] = mwy[i] = mws[i] = 0; mwk[i] = 1; mwax[i] = mway[i] = 0;
    }
  }
  function killMote(i) {
    const j = --mN; if (i === j) return;
    mx[i] = mx[j]; my[i] = my[j]; mh[i] = mh[j]; mvx[i] = mvx[j]; mvy[i] = mvy[j]; mvh[i] = mvh[j]; mt[i] = mt[j]; ml[i] = ml[j]; mc[i] = mc[j];
    tn[i] = tn[j]; th[i] = th[j]; tx.copyWithin(i * TR * 3, j * TR * 3, (j + 1) * TR * 3); mwx[i] = mwx[j]; mwy[i] = mwy[j]; mws[i] = mws[j]; mwk[i] = mwk[j];
    mwax[i] = mwax[j]; mway[i] = mway[j];
  }
  // the last shot's flash (hybrid's haze is lit by hand)
  const FX = {x: 0, y: 0, h: 0, t: 0};

  // ---- the eddies: a field of them in the camera's plane (divergence-free: a stream function of two lattices of
  // vortices that drift as they turn), at (x, y, h) at time T -> along the screen's right (EDDY.s) and up (EDDY.h)
  const EDDY = {s: 0, h: 0}, W = S.swirl;
  let T = 0, cy = 1, sy0 = 0;
  function eddy(x, y, h) {
    const s = x * cy - y * sy0, a = W.k * s + T * W.w, b = W.k * 1.25 * h - T * W.w * .7;
    let us = 1.25 * Math.sin(a) * Math.cos(b), uh = -Math.cos(a) * Math.sin(b);
    const K = W.k * W.k2, a2 = K * s - T * W.w * 1.3 + 2.1, b2 = K * h + T * W.w * .9 + .7;
    us += W.a2 * Math.sin(a2) * Math.cos(b2); uh -= W.a2 * Math.cos(a2) * Math.sin(b2);
    EDDY.s = us * W.amp; EDDY.h = uh * W.amp;
  }

  const style = () => S.style === 'hybrid' && !G.fx ? 'pixel' : S.style;   // (no HD fx: hybrid's haze can't draw)
  const AD = createDrift(host), AK = AIRK.gun;   // the moving air (G.air)
  const PT = {size: 1, alpha: 1, emit: false}, AMB = [1, 1, 1], HC = [0, 0, 0], SC = [0, 0, 0], WA = {x: 0, y: 0, g: 0};
  return {
    SMOKE: S,
    get n() { return sN + mN; },
    get airN() { return AD.n; },   // (velAt calls in the last step: tests)
    puff,
    // a shot's smoke at its muzzle (x, y, h), along (ux, uy) (unit): n puffs from slow and small at the muzzle to fast and
    // big at the front (sizeK, speedK: the gun's), the cylinder gap's side jets (gap), the strands' motes
    shot(x, y, h, ux, uy, n, sizeK, speedK, gap) {
      const core = S.style === 'strands';
      for (let i = 0; i < n; i++) {
        const k = n > 1 ? i / (n - 1) : 1, sp = S.speed * (.2 + k) * RR(.8, 1.1) * speedK;
        puff(x + ux * .05 * i, y + uy * .05 * i, h + RR(-.03, .03), ux * sp + RR(-.25, .25), uy * sp + RR(-.25, .25), RR(.05, .3),
          RR(S.life[0], S.life[1]) * (core ? .55 : 1), RR(S.size[0], S.size[1]) * (.75 + .5 * k) * sizeK * (core ? .6 : 1));
      }
      if (gap) {   // the cylinder gap: a jet out of each side, a hand back from the muzzle
        const gx = x - ux * S.gapBack, gy = y - uy * S.gapBack;
        for (let i = 0; i < S.gap * 2; i++) {
          const sd = i & 1 ? 1 : -1, v = S.gapSpeed * RR(.6, 1.2);
          puff(gx, gy, h + RR(-.02, .03), -uy * sd * v + ux * RR(0, .4), ux * sd * v + uy * RR(0, .4), RR(.05, .25), RR(S.life[0], S.life[1]) * .6, RR(S.size[0], S.size[1]) * S.gapSize);
        }
      }
      if (core) motes(x, y, h, ux, uy, Math.round((sizeK > 1.1 ? M.big : M.n) * Math.min(1.3, sizeK)), speedK);
      FX.x = x; FX.y = y; FX.h = h; FX.t = .11;
    },
    // the thread off a hot barrel (blowing: the gunslinger blows it off, slower)
    wisp(x, y, h, blowing) {
      puff(x, y, h + .02, RR(-.08, .08), RR(-.08, .08), blowing ? RR(.1, .3) : RR(.25, .45), RR(.6, 1.1), RR(.025, .04), .3, 0, 1, KIND.wisp);
    },
    // dust where a bullet landed: n puffs of the tint, back toward the shooter (ux, uy: the bullet's way), rising
    dust(x, y, h, ux, uy, tint, n, size, life, rise) {
      const k = TINT.indexOf(tint);
      for (let i = 0; i < n; i++) puff(x - ux * .05, y - uy * .05, h + .05 + i * .05, -ux * RR(.2, .6) + RR(-.2, .2), -uy * RR(.2, .6) + RR(-.2, .2), rise * RR(.5, 1.3),
        RR(life[0], life[1]), size * RR(.8, 1.2), .7, k, 1.8, KIND.dust);
    },
    // wind: the wind service (host.wind: at(x, y, out) -> m/s + gust where each puff is), or null (none)
    step(dt, wind) {
      T += dt; cy = Math.cos(host.yaw); sy0 = Math.sin(host.yaw); stepN++;
      if (FX.t > 0) FX.t -= dt;
      const dr = Math.exp(-S.drag * dt), WN = S.wind, f = WN.follow;
      const air = AD.begin(dt, AK.gain), aS = air ? AD.a(AK.smoke) : 0, aW = air ? AD.a(AK.wisp) : 0, aD = air ? AD.a(AK.dust) : 0;
      for (let i = sN - 1; i >= 0; i--) {
        let wx = 0, wy = 0, ws = 0, tear = 1;
        if (wind) { wind.at(sx[i], sy[i], WA); wx = WA.x * f; wy = WA.y * f; ws = Math.hypot(WA.x, WA.y); tear = 1 + WN.eat * ws + WN.gust * WA.g; }
        st[i] += dt * tear;   // the wind tears it up: it ages (swells, breaks up, thins) faster
        if (st[i] >= sl[i]) { kill(i); continue; }
        svx[i] = svx[i] * dr + wx * (1 - dr); svy[i] = svy[i] * dr + wy * (1 - dr); svh[i] = svh[i] * dr + S.rise / (1 + WN.flat * ws) * (1 - dr);
        if (air) { const k = sq[i]; AD.relax(sx[i], sy[i], sh[i], sax[i], say[i], k === KIND.wisp ? aW : k === KIND.dust ? aD : aS); sax[i] = AD.x; say[i] = AD.y; }
        eddy(sx[i], sy[i], sh[i]); const e = Math.min(1, st[i] / W.ramp) * (sq[i] === KIND.wisp ? 1.3 : 1) * (1 + WN.swirl * ws);
        sx[i] += (svx[i] + sax[i] + cy * EDDY.s * e) * dt; sy[i] += (svy[i] + say[i] - sy0 * EDDY.s * e) * dt; sh[i] += (svh[i] + EDDY.h * e) * dt;
      }
      if (!mN) return;
      const sample = (trailT += dt) >= M.every; if (sample) trailT = 0;
      const mr = Math.exp(-M.catch * dt), aM = air ? AD.a(AK.motes * 3) : 0;   // (the air: a third of them a step, as the wind)
      for (let i = mN - 1; i >= 0; i--) {
        if (air && (i + stepN) % 3 === 0) { AD.relax(mx[i], my[i], mh[i], mwax[i], mway[i], aM); mwax[i] = AD.x; mway[i] = AD.y; }
        if (wind && (i + stepN) % 3 === 0) { wind.at(mx[i], my[i], WA); mwx[i] = WA.x * f; mwy[i] = WA.y * f; const ws = mws[i] = Math.hypot(WA.x, WA.y); mwk[i] = 1 + WN.eat * ws + WN.gust * WA.g; }
        mt[i] += dt * mwk[i];
        if (mt[i] >= ml[i]) { killMote(i); continue; }
        if (sample) { const k = th[i] = (th[i] + 1) % TR, o = (i * TR + k) * 3; tx[o] = mx[i]; tx[o + 1] = my[i]; tx[o + 2] = mh[i]; if (tn[i] < TR) tn[i]++; }
        // light: the wind takes them a little quicker than the puffs (the jet's push dies the same way)
        mvx[i] = mvx[i] * mr + mwx[i] * (1 - mr); mvy[i] = mvy[i] * mr + mwy[i] * (1 - mr); mvh[i] = mvh[i] * dr + M.rise / (1 + WN.flat * mws[i]) * (1 - dr);
        eddy(mx[i], my[i], mh[i]); const e = Math.min(1, mt[i] / W.ramp) * M.swirl * (1 + WN.swirl * mws[i]);
        mx[i] += (mvx[i] + mwax[i] + cy * EDDY.s * e) * dt; my[i] += (mvy[i] + mway[i] - sy0 * EDDY.s * e) * dt; mh[i] += (mvh[i] + EDDY.h * e) * dt;
      }
    },
    // the world's part (pixel, hybrid, strands): the puffs (render/puffs.js), wisps as points, hybrid's haze, the motes
    frame() {
      const look = style();
      if (look !== 'soft' && (sN || mN)) {
        const P = S.pixel, z = host.zoom, PPM = host.PPM, hazeOn = look === 'hybrid' && !!G.fx, A = P.alpha[look] ?? 1;
        if (hazeOn) { const a = host.mood.amb; AMB[0] = a[0]; AMB[1] = a[1]; AMB[2] = a[2]; }
        for (let i = 0; i < sN; i++) {
          const t = st[i], u = t / sl[i], k = sq[i], fade = u > 1 - P.fade ? (1 - u) / P.fade : 1;
          if (k === KIND.wisp) { PT.size = z; PT.alpha = Math.min(1, (1 - u) * 1.1); host.point(sx[i], sy[i], sh[i], TONE01[0][u < .3 ? 0 : 1], PT); continue; }
          const rad = ss[i] * (.5 + .7 * (1 - Math.exp(-4 * t))) + S.grow * sg[i] * P.grow * Math.sqrt(t);
          const e = clamp((u - P.erode) / (1 - P.erode - P.fade), 0, 1);
          puffsR.put(sx[i], sy[i], sh[i], Math.min(P.rmax, rad * PPM), TINT01[sk[i]], e, A * fade * (1 - P.thin * e), sd[i], P.lift, P.edge);
          if (hazeOn) {   // the haze that takes over as it breaks up, lit by the ambient and the flash's warmth near it
            const c = TONE01[sk[i]][1], fl = FX.t > 0 ? FX.t / .11 * Math.max(0, 1 - Math.hypot(sx[i] - FX.x, sy[i] - FX.y, sh[i] - FX.h) / 4) : 0;
            HC[0] = c[0] * Math.min(1, AMB[0] + fl); HC[1] = c[1] * Math.min(1, AMB[1] + fl * .77); HC[2] = c[2] * Math.min(1, AMB[2] + fl * .42);
            const a = S.haze.a * (.2 + .8 * e ** .7) * (1 - u) * (k === KIND.dust ? .6 : 1);
            if (a > .01) G.fx(sx[i], sh[i], sy[i], rad * S.haze.r, HC, a, 'blend');
          }
        }
        if (look === 'strands') for (let i = 0; i < mN; i++) {   // the motes: their trail while young, then a dithered point
          const u = mt[i] / ml[i], c = TONE01[0][mc[i]];
          if (u < M.young && tn[i] > 1) {
            let px = mx[i], py = my[i], ph = mh[i];
            for (let s = 0, k = th[i]; s < tn[i]; s++, k = (k + TR - 1) % TR) {
              const o = (i * TR + k) * 3; host.line(px, py, ph, tx[o], tx[o + 1], tx[o + 2], c, false); px = tx[o]; py = tx[o + 1]; ph = tx[o + 2];
              if (s >= (1 - u / M.young) * TR) break;   // (the trail shortens as it ages)
            }
            continue;
          }
          PT.size = z; PT.alpha = u < M.young ? 1 : (1 - u) / (1 - M.young) * .95; host.point(mx[i], my[i], mh[i], c, PT);
        }
        PT.alpha = 1;
      }
      puffsR.frame();
    },
    // the overlay's part (soft): the old soft puffs
    hd(q, sc) {
      if (style() !== 'soft' || !sN) return;
      const px = host.PPM * host.zoom * sc;   // display px per metre
      G.hdShift?.(q, sc);   // (slid with the pixel image: the sub-pixel camera; the host restores q after)
      for (let i = 0; i < sN; i++) {
        const k = st[i] / sl[i], s = G.toScreenInto(sx[i], sh[i], sy[i], SC), r = (ss[i] + S.grow * sg[i] * Math.sqrt(st[i])) * px;
        q.globalAlpha = Math.min(1, S.alpha * sa[i] * (sg[i] < 1 ? .6 : 1) * (k < .1 ? k / .1 : 1 - (k - .1) / .9) ** 1.4);
        q.drawImage(puffImgs()[sk[i]], s[0] * sc - r, s[1] * sc - r, r * 2, r * 2);
      }
      q.globalAlpha = 1;
    },
  };
}
// soft's sprites (made on first use): a radial puff a tint
let PUFFS = null;
const puffImgs = () => PUFFS || (PUFFS = TINT.map(k => {
  const c = document.createElement('canvas'); c.width = c.height = 64; const q = c.getContext('2d'), w = 64;
  const [r, g, b] = TINTS[k], d = (v, f) => Math.round(v * f), Gr = q.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  Gr.addColorStop(0, `rgba(${r},${g},${b},.9)`); Gr.addColorStop(.45, `rgba(${d(r, .91)},${d(g, .9)},${d(b, .89)},.55)`); Gr.addColorStop(1, `rgba(${d(r, .85)},${d(g, .84)},${d(b, .83)},0)`);
  q.fillStyle = Gr; q.fillRect(0, 0, w, w); return c;
}));
