// WEATHER (render3d, view): the world clock's weather and seasons made visible. It reads sim/env.js (host.env) and writes
// only render inputs and its own particles; the clock itself never waits on it. OWNER: the trees / wind-feel session.
//   rain     streaks (short 1 px world lines in two tones, slanted by the wind), as many as env.sky.rain asks; each drop
//            lands as a splash on the ground or a ring on the stream. A change of weather on its way (sim/env.js
//            TRANSITIONS): it rains (snows) only where it falls (env.skyAt: behind a front's edge, under a breaking deck,
//            not in its gaps), as much as falls over the view (FRONT below); a drizzle's drops are finer and slower
//   snow     flakes (1 px points, a few 2 px near ones) drifting with the wind, where the biome has no snow of its own
//            (atmos.js keeps the frost lands' snow and scales it by the weather)
//   storm    lightning (env.sky.storm): the scene lit for an instant in two or three pulses (gfx setFlash, strongest at
//            night), now and then a bolt into the ground near the view (emissive world lines, a light at its foot), and
//            the thunder after it (rainaudio.js, delayed by the distance: close = a crack, far = a rumble)
//   ground   the season's colour matrix for green pixels (grass, bushes, tufts, leaf particles), lying snow, wet ground
//            (gfx setSeason / setGround: the season's colour matrix, tint, snow, wet) and how full the crowns are (leafK)
// OWNS: its particles (preallocated typed arrays, capped), the flash and bolts. READS: host.env (sky, season, seasonK,
// tinted, snowCover, wet, leafK), host.wind (at, the wind field), host.elev / inStream. EMITS: rainaudio.thunder.
// BUDGET: ~0.15 ms per frame at full rain (900 drops + splashes), nothing without weather.
import {clamp} from '../core/mathx.js';
import {viewRandom} from '../core/rng.js';
import {flags} from '../core/flags.js';
const TAU = Math.PI * 2;
const R = viewRandom('weather'), rr = (a, b) => a + R() * (b - a);
export const TUNE = {
  rain: {max: 900, v: [8.5, 10.5], len: .17, top: 7, splashEvery: 2},   // drops at full rain, fall m/s, streak m, spawn height
  snow: {max: 520, v: [.55, 1.05], sway: [.25, .5], big: .12, top: 6},
  splash: {max: 180, life: .14, ring: .42},                               // ground splash s, stream ring s
  bolt: {near: .35, every: [3, 11], light: {color: '#d4dcff', radius: 9, intensity: 2.6}, life: .2, minD: 5},
  flash: {day: .55, night: 1.35, c: [.78, .84, 1]},
  colRain: ['#c2cfdc', '#93a4b8'], colSnow: ['#f2f6fb', '#c9d3e2'], colSplash: ['#d6e0ea', '#a8b8c8'],
};
// the season's colour matrix for green pixels (row-major 3 x 3, rgb in -> rgb out): spring fresh, summer as painted,
// autumn ochre / rust, winter dry and grey (gfx COMP_FS: mixed in by how green the pixel is)
const SEASON_M = {
  spring: [.95, .15, 0, 0, 1.12, 0, 0, -.04, .9],
  summer: [1, 0, 0, 0, 1, 0, 0, 0, 1],
  autumn: [.55, .75, 0, .25, .55, .05, .2, .15, .25],
  winter: [.45, .4, .1, .3, .5, .15, .25, .35, .3],
};
// the cool palette (the default; ?palette=old, world/biomes.js) paints a brighter, more saturated green: a softer autumn keeps its meadow ochre,
// not a field of orange
if (flags.get('palette') !== 'old') SEASON_M.autumn = [.48, .64, 0, .24, .5, .06, .2, .16, .26];

// ORDER (core/features.js): rain slants with this step's wind
export const order = {after: ['wind']};
export async function create(host) {
  const G = host.G, ctx = host.ctxO;
  const F = {name: 'weather', label: 'Weather fx (rain, snow, storms)', ambient: true, on: true, fx: true, TUNE, ms: 0, stats: {rain: 0, snow: 0, splash: 0, bolts: 0}};   // fx: the particles / bolts (the season / snow / wet look always follows the clock)
  // ---- particles: one pool each, structure of arrays
  const RN = TUNE.rain.max, rX = new Float32Array(RN), rY = new Float32Array(RN), rH = new Float32Array(RN), rV = new Float32Array(RN); let rn = 0;
  const SN = TUNE.snow.max, sX = new Float32Array(SN), sY = new Float32Array(SN), sH = new Float32Array(SN), sV = new Float32Array(SN), sP = new Float32Array(SN); let sn = 0;
  const PN = TUNE.splash.max, pX = new Float32Array(PN), pY = new Float32Array(PN), pH = new Float32Array(PN), pT = new Float32Array(PN), pK = new Uint8Array(PN); let pn = 0;
  let T = 0, drops = 0, caves = null, open = 1;   // open: 1 - how far underground he is (features/caves.js: no weather in the cave)
  const WV = {x: 0, y: 0, g: 0}, CALM = {x: 0, y: 0, g: 0};   // the wind at the view (wind.at fills WV: no allocation)
  const V = {RX: 1, RY: 0, FX: 0, FY: 1, cx: 0, cy: 0, hw: 8, hh: 6};
  function view() {   // the view's ground centre / half extents (view-frame m) and the screen's axes on the ground
    const yaw = host.yaw, z = host.zoom || 1, T3 = G.view.T;
    V.RX = Math.cos(yaw); V.RY = -Math.sin(yaw); V.FX = Math.sin(yaw); V.FY = Math.cos(yaw);
    const up = T3.y * ctx.PPMH / ctx.PPMY; V.cx = T3.x - V.FX * up; V.cy = T3.z - V.FY * up;
    V.hw = ctx.VW / 2 / (ctx.PPM * z) + 1.5; V.hh = ctx.VH / 2 / (ctx.PPMY * z) + 1.5;
  }
  // a random ground point over the view (a little more toward the camera: things high up show above their ground point)
  function placeX(o) { const ox = rr(-1, 1) * V.hw, oy = rr(-1, 1.6) * V.hh; o[0] = V.cx + V.RX * ox + V.FX * oy; o[1] = V.cy + V.RY * ox + V.FY * oy; }
  const out = (x, y) => { const dx = (x - V.cx) * V.RX + (y - V.cy) * V.RY, dy = (x - V.cx) * V.FX + (y - V.cy) * V.FY; return Math.abs(dx) > V.hw + 1 || dy < -V.hh - 1 || dy > V.hh * 1.6 + 1; };
  const Q2 = [0, 0];
  // FRONT: with a front on screen, how much of the view each falls on (the mean over a 4 x 4 grid of ground points: the pool's
  // size) and the most it falls anywhere there; a drop is placed where it falls (a few tries: a point is kept with the odds
  // channel there / the most; none kept: it waits out of the view and tries again next frame). A breaking deck: the view's
  // mean (env.light) and the deck's own (env.under). Nothing changing: the sky's own (no extra random draws: the same drops)
  const FRT = {on: false, rain: 0, snow: 0, rainMax: 0, snowMax: 0};
  function frontCover(E) {
    const dk = !!(E.deck && E.deck.mode && E.skyAt && !(E.front && E.front.on));
    FRT.on = !!((E.front && E.front.on && E.skyAt) || dk); if (!FRT.on) return;
    if (dk) {   // (a breakup, a front's settling: the deck's gaps; its mean is the view's)
      FRT.rain = E.light.rain; FRT.snow = E.light.snow; FRT.rainMax = Math.max(E.open.rain, E.under.rain); FRT.snowMax = Math.max(E.open.snow, E.under.snow);
      return;
    }
    let r = 0, n = 0, rm = 0, nm = 0;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      const ox = ((i + .5) / 2 - 1) * V.hw, oy = (-1 + (j + .5) / 4 * 2.6) * V.hh, x = V.cx + V.RX * ox + V.FX * oy, y = V.cy + V.RY * ox + V.FY * oy;
      const a = E.skyAt(x, y, 'rain'), b = E.skyAt(x, y, 'snow'); r += a; n += b; rm = Math.max(rm, a); nm = Math.max(nm, b);
    }
    FRT.rain = r / 16; FRT.snow = n / 16; FRT.rainMax = rm; FRT.snowMax = nm;
  }
  function placeUnder(o, c, most) {
    const E = host.env;
    for (let k = 0; k < 16; k++) { placeX(o); if (R() * most <= E.skyAt(o[0], o[1], c)) return; }
    o[0] = V.cx + 1e4; o[1] = V.cy;   // (nowhere it falls: out of the view, placed again next frame)
  }
  const place = (o, c) => { if (FRT.on) placeUnder(o, c, c === 'rain' ? FRT.rainMax : FRT.snowMax); else placeX(o); };
  let fine = 1;   // the rain's weight (1 a downpour .. 0 a drizzle: finer, slower drops)
  function spawnRain(i, fresh) {
    place(Q2, 'rain'); rX[i] = Q2[0]; rY[i] = Q2[1];
    const g = Q2[0] > V.cx + 1e3 ? 0 : host.elev(Q2[0], Q2[1]);   // (one placed out of the view: no ground lookup there)
    rH[i] = g + (fresh ? rr(0, TUNE.rain.top) : rr(TUNE.rain.top * .8, TUNE.rain.top)); rV[i] = rr(...TUNE.rain.v) * (.55 + .45 * fine);
  }
  function spawnSnow(i, fresh) { place(Q2, 'snow'); sX[i] = Q2[0]; sY[i] = Q2[1]; sH[i] = host.elev(Q2[0], Q2[1]) + (fresh ? rr(0, TUNE.snow.top) : rr(TUNE.snow.top * .8, TUNE.snow.top)); sV[i] = rr(...TUNE.snow.v); sP[i] = R() * TAU; }
  function splash(x, y, ring) {
    if (pn >= PN) return;
    const i = pn++; pX[i] = x; pY[i] = y; pK[i] = ring ? 1 : 0; pT[i] = 0; pH[i] = ring ? (host.world?.waterH ?? -.18) + .01 : host.elev(x, y) + .01;
  }
  // ---- lightning: flash pulses + now and then a bolt near the view
  const bolt = {t: -1, x: 0, y: 0, pts: new Float32Array(3 * 16), n: 0, br: new Float32Array(3 * 6), bn: 0}, light = {x: 0, y: 0, h: 1.2, color: TUNE.bolt.light.color, radius: TUNE.bolt.light.radius, intensity: 0, flicker: 0, id: 9701};
  let nextStrike = 4, flashT = -1, flashK = 1, dark = 0;
  const PULSES = [[0, .9], [.05, .15], [.1, .75], [.17, .25], [.26, 0]];   // (s, amount): a flicker, not a fade
  function strike(w) {
    flashT = 0; flashK = rr(.6, 1); F.stats.bolts++;
    const P = host.player, aw = host.feature('audio')?.rainAudio;
    let dist = rr(250, 1400), pan = rr(-.8, .8);   // far: only the flash, thunder rolling in late
    if (R() < TUNE.bolt.near) {
      for (let k = 0; k < 6; k++) { placeX(Q2); if (Math.hypot(Q2[0] - P.x, Q2[1] - P.y) > TUNE.bolt.minD) break; }
      bolt.x = Q2[0]; bolt.y = Q2[1]; bolt.t = 0;
      const g = host.elev(bolt.x, bolt.y), n = 10 + (R() * 5 | 0); let x = bolt.x + rr(-1, 1), y = bolt.y + rr(-1, 1);
      for (let i = 0; i < n; i++) {   // from 15 m down to the ground, zig-zagging, ending on the strike point
        const f = i / (n - 1); if (i === n - 1) { x = bolt.x; y = bolt.y; }
        bolt.pts[i * 3] = x; bolt.pts[i * 3 + 1] = y; bolt.pts[i * 3 + 2] = g + 15 * (1 - f);
        x += rr(-.45, .45); y += rr(-.25, .25);
      }
      bolt.n = n;
      const j = 2 + (R() * (n - 5) | 0), bx = bolt.pts[j * 3], by = bolt.pts[j * 3 + 1], bh = bolt.pts[j * 3 + 2];   // one fork
      bolt.bn = 4; for (let i = 0; i < 4; i++) { bolt.br[i * 3] = bx + (i * rr(.2, .5)) * (R() < .5 ? -1 : 1); bolt.br[i * 3 + 1] = by + rr(-.2, .2) * i; bolt.br[i * 3 + 2] = bh - i * rr(.8, 1.4); }
      light.x = bolt.x; light.y = bolt.y; light.h = g + 1.2;
      dist = Math.hypot(bolt.x - P.x, bolt.y - P.y) * 18; pan = clamp(((bolt.x - P.x) * V.RX + (bolt.y - P.y) * V.RY) / 8, -.9, .9);
    }
    aw?.thunder?.(dist, pan);
  }
  // ---- the season's look (env -> gfx): the colour matrix only on a change of season / blend step
  let seasonKey = -1; const GR = {tinted: false, snow: 0, wet: 0, leafK: 1, autumn: 0};   // (the renderer's setters: render/gfx.js)
  const SEAS = ['spring', 'summer', 'autumn', 'winter'], MX = new Float32Array(9);
  function lookFromEnv(E) {
    const q = Math.round(E.seasonK * 16), key = (SEAS.indexOf(E.season) * 4 + SEAS.indexOf(E.seasonNext)) * 17 + q;
    if (key !== seasonKey) {
      seasonKey = key; const a = SEASON_M[E.season], b = SEASON_M[E.seasonNext], k = q / 16;
      for (let i = 0; i < 9; i++) MX[i] = a[i] + (b[i] - a[i]) * k;
      G.setSeason(MX);
    }
    GR.tinted = E.tinted; GR.snow = E.snowCover * open; GR.wet = E.wet * open; GR.leafK = E.leafK; GR.autumn = E.autumn || 0; G.setGround(GR);
  }

  F.view = dt => {   // (the weather's state is the world clock's, sim/env.js: this is how it looks)
    const t0 = performance.now(), E = host.env, w = host.wind; T += dt;
    if (!E) return;
    view();
    caves ??= host.feature('caves') || false; open = caves ? 1 - caves.under : 1;
    const S = E.sky, area = Math.min(1.6, V.hw * V.hh / 70) * open;   // a zoomed-in view needs fewer drops (underground: none)
    frontCover(E);
    // rain: the pool grows / shrinks toward what the sky asks for (a front: the share of the view it rains on). Capped at the
    // pool's size: a wide view's area (up to 1.6) asks for more, and a drop past the arrays' end was NaN (G.line / G.point)
    const wantR = Math.min(RN, Math.round(TUNE.rain.max * clamp(FRT.on ? FRT.rain : S.rain, 0, 1) * area * (F.fx ? 1 : 0)));
    fine = clamp(((FRT.on ? FRT.rainMax : S.rain) - .15) / .6, 0, 1);
    while (rn < wantR) spawnRain(rn++, true);
    if (rn > wantR) rn = Math.max(wantR, rn - Math.ceil(dt * 400));   // stop gradually (no hole in the air)
    const wv = w?.at ? w.at(V.cx, V.cy, WV) : CALM, wx = wv.x * 1.3, wy = wv.y * 1.3;
    for (let i = 0; i < rn; i++) {
      rH[i] -= rV[i] * dt; rX[i] += wx * dt; rY[i] += wy * dt;
      const g = host.elev(rX[i], rY[i]);
      if (rH[i] <= g) { if ((++drops) % TUNE.rain.splashEvery === 0) splash(rX[i], rY[i], g === 0 && host.inStream(rX[i], rY[i])); spawnRain(i, false); }
      else if (out(rX[i], rY[i])) spawnRain(i, false);
    }
    // snow (not in the frost lands: atmos.js snows there)
    const wantS = host.biome.id === 'frost' ? 0 : Math.min(SN, Math.round(TUNE.snow.max * clamp(FRT.on ? FRT.snow : S.snow, 0, 1) * area * (F.fx ? 1 : 0)));
    while (sn < wantS) spawnSnow(sn++, true);
    if (sn > wantS) sn = Math.max(wantS, sn - Math.ceil(dt * 200));
    for (let i = 0; i < sn; i++) {
      sH[i] -= sV[i] * dt; sP[i] += dt * 1.7;
      const sw = Math.sin(sP[i]) * TUNE.snow.sway[0];
      sX[i] += (wv.x * .9 + sw * V.RX) * dt; sY[i] += (wv.y * .9 + sw * V.RY) * dt;
      if (sH[i] <= host.elev(sX[i], sY[i]) || out(sX[i], sY[i])) spawnSnow(i, false);
    }
    // splashes / rings age
    for (let i = pn - 1; i >= 0; i--) {
      pT[i] += dt;
      if (pT[i] > (pK[i] ? TUNE.splash.ring : TUNE.splash.life)) { pn--; pX[i] = pX[pn]; pY[i] = pY[pn]; pH[i] = pH[pn]; pT[i] = pT[pn]; pK[i] = pK[pn]; }
    }
    // storms
    if (S.storm > .35 && F.fx && open > .5) { if ((nextStrike -= dt * S.storm) <= 0) { nextStrike = rr(...TUNE.bolt.every); strike(w); } }
    else nextStrike = Math.max(nextStrike, 2);
    if (flashT >= 0) flashT += dt;
    if (bolt.t >= 0) { bolt.t += dt; if (bolt.t > TUNE.bolt.life) bolt.t = -1; }
    lookFromEnv(E);
    F.stats.rain = rn; F.stats.snow = sn; F.stats.splash = pn;
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  const C = c => host.rgb(c), CR = TUNE.colRain.map(C), CS = TUNE.colSnow.map(C), CP = TUNE.colSplash.map(C), CB = [C('#f4f6ff'), C('#c8b8ff')];
  const P1 = {size: 1}, P2 = {size: 2};
  F.frame = () => {
    const E = host.env; if (!E) return;
    // the flash: pulses, brighter at night (the moodier the light, the more a bolt shows)
    let fk = 0;
    if (flashT >= 0) {
      let i = 0; while (i < PULSES.length - 1 && flashT >= PULSES[i + 1][0]) i++;
      if (i >= PULSES.length - 1) flashT = -1; else { const [t0, a0] = PULSES[i], [t1, a1] = PULSES[i + 1]; fk = (a0 + (a1 - a0) * (flashT - t0) / (t1 - t0)) * flashK; }
    }
    const M = host.mood, lum = M ? M.amb[0] * .3 + M.amb[1] * .55 + M.amb[2] * .15 : 1, fs = TUNE.flash.day + (TUNE.flash.night - TUNE.flash.day) * clamp(1 - lum, 0, 1);
    fk *= open; G.setFlash(TUNE.flash.c[0] * fk * fs, TUNE.flash.c[1] * fk * fs, TUNE.flash.c[2] * fk * fs);
    light.intensity = bolt.t >= 0 ? TUNE.bolt.light.intensity * (1 - bolt.t / TUNE.bolt.life) : 0;
    if (!F.fx) return;
    // rain: a short streak along the drop's motion (the wind slants it), two tones
    const wv = host.wind?.at ? host.wind.at(V.cx, V.cy, WV) : CALM, L = TUNE.rain.len * (.5 + .5 * fine), sx = -wv.x * 1.3 / 9.5 * L * 2, sy = -wv.y * 1.3 / 9.5 * L * 2;
    for (let i = 0; i < rn; i++) host.line(rX[i], rY[i], rH[i], rX[i] + sx, rY[i] + sy, rH[i] + L, CR[i & 1]);
    for (let i = 0; i < sn; i++) host.point(sX[i], sY[i], sH[i], CS[i & 1], i % 8 === 0 ? P2 : P1);
    for (let i = 0; i < pn; i++) {
      const t = pT[i];
      if (!pK[i]) {   // a ground splash: a pixel, then two bouncing up and out
        if (t < .05) host.point(pX[i], pY[i], pH[i], CP[0], P1);
        else { const o = .03; host.point(pX[i] - V.RX * o, pY[i] - V.RY * o, pH[i] + .04, CP[1], P1); host.point(pX[i] + V.RX * o, pY[i] + V.RY * o, pH[i] + .04, CP[1], P1); }
      } else {        // a ring on the stream, widening and fading
        const r = .04 + t * .55, c = t < TUNE.splash.ring * .5 ? CP[0] : CP[1];
        for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; host.point(pX[i] + Math.cos(a) * r, pY[i] + Math.sin(a) * r * .9, pH[i], c, P1); }
      }
    }
    if (bolt.t >= 0) {   // the bolt: emissive lines, the fork fainter
      for (let i = 0; i + 1 < bolt.n; i++) { const a = i * 3, b = a + 3; host.line(bolt.pts[a], bolt.pts[a + 1], bolt.pts[a + 2], bolt.pts[b], bolt.pts[b + 1], bolt.pts[b + 2], CB[0], true); }
      for (let i = 0; i + 1 < bolt.bn; i++) { const a = i * 3, b = a + 3; host.line(bolt.br[a], bolt.br[a + 1], bolt.br[a + 2], bolt.br[b], bolt.br[b + 1], bolt.br[b + 2], CB[1], true); }
    }
  };
  const LIGHTS = [light], NONE = [];
  F.lights = () => light.intensity > 0 ? LIGHTS : NONE;
  // another system's lightning (features/omens/storm.js: a storm omen's strike): the scene flashes in a bolt's pulses, at
  // k (0..1, like a strike's own .6..1). The flash is this feature's (G.setFlash every frame): one writer
  F.flash = k => { flashT = 0; flashK = k; };
  F.settings = () => [{label: 'Weather fx', options: ['on', 'off'], get: () => F.fx ? 'on' : 'off', set: v => { F.fx = v === 'on'; }}];
  F.hud = () => { const E = host.env; return E && (rn || sn || F.stats.bolts) ? `rain ${rn} · snow ${sn} · splash ${pn} · bolts ${F.stats.bolts}` : ''; };
  return F;
}
