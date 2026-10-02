// GUN FX (view): what a revolver's shots look like. Presentation only: it reads the sim (the player's pose through the
// revolver's barrel(), the bullets in host.arrows) and its events, and writes only its own pools; with ?views=0 or
// switched off nothing in play changes (tools/test/simview.mjs).
//   flash    HD: a muzzle flash at the pose's GunMuzzle0 for ~3 frames (pre-rendered flame stars, turned along the
//            barrel on screen; the Navy's bigger and redder), plus a short warm point light (F.lights) for the yard
//   smoke    HD: puffs of gun smoke from the muzzle that rise, spread, drift downwind and fade; a thin wisp keeps curling
//            off the barrel for a moment after the last shot, and while the gunslinger blows it off (gun_blow)
//   tracer   world lines (glowing): each bullet in flight as a streak behind its head; its last step (the impact) as a
//            streak that shrinks into the impact in ~70 ms (a bullet that hit within its first step is seen only so)
//   cases    world points: brass cases dropping from the cylinder on a reload's eject, bouncing, lying a while
//   impacts  world points: dust and sparks where a bullet hits the ground, chips off trees and props, sparks off a hit
// OWNS: its pools (typed arrays, capped; reused, nothing allocated per frame). READS: host.P, host.PL.gun, host.weapon,
// host.arrows, events (player.shoot / reload, bullet.impact, arrow.hit), host.wind (the smoke's drift), host.yaw / zoom.
// BUDGET: view ~.02 ms with a fanned cylinder in the air (6 tracers x 3 lines, <= 200 points); HD: <= 60 drawImage calls.
import {WEAPONS} from '../content/weapons.js';
import {rgbOf} from '../core/color.js';
import {hypot3} from '../core/mathx.js';

export const TUNE = {
  flash: {life: .05, len: .62, glow: .2, navy: 1.3, fan: 1.1, light: {radius: 3.4, intensity: 2.4, life: .08, color: '#ffc46a'}},
  smoke: {max: 48, puffs: 4, life: [.9, 1.6], size: [.10, .2], grow: .55, rise: .45, speed: 1.6, drag: 3, alpha: .5, wisp: 1.4, wispGap: .09},
  tracer: {len: 2.4, head: .45, mid: 1.1, last: .07},
  cases: {max: 36, life: 5, grav: 9.8, bounce: .35},
  bits: {max: 220, grav: 9},
};
const C = {head: rgbOf('#fff6d8'), mid: rgbOf('#ffd27a'), tail: rgbOf('#b8642e'), brass: rgbOf('#d8a93c'), brassHi: rgbOf('#ffe08a'),
  dust: ['#cbb593', '#a99272', '#8a765c'].map(rgbOf), spark: [rgbOf('#fff4c8'), rgbOf('#ffc860')], chip: ['#b08a5a', '#7a5636'].map(rgbOf)};
const R = Math.random, RR = (a, b) => a + R() * (b - a);   // presentation's randomness

// ORDER (core/features.js): after combat (its hits' chunks first; nothing reads ours)
export const order = {after: ['combat']};
export async function create(host) {
  const gun = () => host.weapon?.kind === 'gun' ? host.PL.gun : null;
  const MZ = {x: 0, y: 0, a: 0}, W3 = {x: 0, y: 0, h: 0}, WIND = {x: 0, y: 0, g: 0}, SC = [0, 0, 0];
  const view = (x, y, h) => host.G.toScreenInto(x, h, y, SC);   // world -> view px, no allocation (host.toView's maths)
  // the muzzle in the world this frame: the pose's muzzle (sprite px from the feet) put back through the camera at the
  // player's depth: exact on screen, which is all the HD layers need
  function muzzleWorld(g) {
    const P = host.P; if (!g.barrel(P.frame, P.face, MZ)) return null;
    const pl = host.player, dx = MZ.x / host.PPM, c = Math.cos(host.yaw), s = Math.sin(host.yaw);
    W3.x = pl.x + dx * c; W3.y = pl.y - dx * s; W3.h = P.z - MZ.y / host.PPMH; return W3;
  }

  // ---- pre-rendered sprites (made once) ----
  const mk = (w, h, fn) => { const c = document.createElement('canvas'); c.width = w; c.height = h; fn(c.getContext('2d'), w, h); return c; };
  const puffImg = mk(64, 64, (q, w) => {
    const g = q.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(236,232,224,.9)'); g.addColorStop(.45, 'rgba(214,208,200,.55)'); g.addColorStop(1, 'rgba(200,194,186,0)');
    q.fillStyle = g; q.fillRect(0, 0, w, w);
  });
  // a flash: a hot core and flame lobes along +x (the barrel), a side spray; three variants
  const flashImg = [0, 1, 2].map(v => mk(96, 48, (q, w, h) => {
    q.globalCompositeOperation = 'lighter';
    const blob = (x, y, rx, ry, col) => { const g = q.createRadialGradient(x, y, 0, x, y, Math.max(rx, ry)); g.addColorStop(0, col); g.addColorStop(1, 'rgba(255,120,30,0)');
      q.save(); q.translate(x, y); q.scale(rx / Math.max(rx, ry), ry / Math.max(rx, ry)); q.translate(-x, -y); q.fillStyle = g; q.beginPath(); q.arc(x, y, Math.max(rx, ry), 0, Math.PI * 2); q.fill(); q.restore(); };
    blob(14, h / 2, 14, 12, 'rgba(255,250,220,1)');
    blob(34 + v * 4, h / 2, 26 + v * 3, 8 - v, 'rgba(255,214,120,.95)');
    blob(58 + v * 6, h / 2 + (v - 1) * 2, 18, 5, 'rgba(255,150,60,.8)');
    blob(20, h / 2 - 10 - v * 2, 10, 4, 'rgba(255,190,90,.6)'); blob(20, h / 2 + 10 + v, 10, 4, 'rgba(255,190,90,.6)');
  }));

  const glowImg = mk(64, 64, (q, w) => {   // the flash's round glow at the muzzle
    const g = q.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, 'rgba(255,252,230,1)'); g.addColorStop(.25, 'rgba(255,220,140,.85)'); g.addColorStop(1, 'rgba(255,140,40,0)');
    q.fillStyle = g; q.fillRect(0, 0, w, w);
  });
  // ---- state: the flash, the smoke (SoA pools), tracers' last streaks, cases, bits ----
  const FL = {t: 0, v: 0, k: 1, a: 0, x: 0, y: 0, h: 0};
  const LIGHT = {x: 0, y: 0, h: 0, color: TUNE.flash.light.color, radius: 1, intensity: 0, flicker: 0, id: 7450}, LIT = [LIGHT], NONE = [];
  const SM = TUNE.smoke.max, sx = new Float32Array(SM), sy = new Float32Array(SM), sh = new Float32Array(SM), svx = new Float32Array(SM),
    svy = new Float32Array(SM), svh = new Float32Array(SM), st = new Float32Array(SM), sl = new Float32Array(SM), ss = new Float32Array(SM), sg = new Float32Array(SM);
  let sN = 0, wispT = 0, wispFor = 0;
  function puff(x, y, h, vx, vy, vh, life, size, grow = 1) {   // grow: x TUNE.smoke.grow (a wisp: thin, it barely spreads)
    let i = sN < SM ? sN++ : -1;
    if (i < 0) { let o = 0; for (let k = 1; k < SM; k++) if (st[k] / sl[k] > st[o] / sl[o]) o = k; i = o; }   // full: the oldest goes
    sx[i] = x; sy[i] = y; sh[i] = h; svx[i] = vx; svy[i] = vy; svh[i] = vh; st[i] = 0; sl[i] = life; ss[i] = size; sg[i] = grow;
  }
  const TR = [], TRN = 16; for (let i = 0; i < TRN; i++) TR.push({x0: 0, y0: 0, h0: 0, x1: 0, y1: 0, h1: 0, t: 9});
  let trI = 0;
  const CM = TUNE.cases.max, cx = new Float32Array(CM), cy = new Float32Array(CM), ch = new Float32Array(CM), cvx = new Float32Array(CM),
    cvy = new Float32Array(CM), cvh = new Float32Array(CM), ct = new Float32Array(CM);
  let cN = 0, cI = 0;
  const BM = TUNE.bits.max, bx = new Float32Array(BM), by = new Float32Array(BM), bh = new Float32Array(BM), bvx = new Float32Array(BM),
    bvy = new Float32Array(BM), bvh = new Float32Array(BM), bt = new Float32Array(BM), bl = new Float32Array(BM), bk = new Uint8Array(BM), bg = new Float32Array(BM);
  let bN = 0;
  // kinds: 0-2 dust tones, 3-4 sparks (glow), 5-6 chips
  function bit(x, y, h, vx, vy, vh, life, kind, grav) {
    if (bN >= BM) return;
    const i = bN++; bx[i] = x; by[i] = y; bh[i] = h; bvx[i] = vx; bvy[i] = vy; bvh[i] = vh; bt[i] = 0; bl[i] = life; bk[i] = kind; bg[i] = grav;
  }
  function impact(e) {
    const ux = e.dx || 0, uy = e.dy || 0;
    if (e.surf === 'ground') {
      for (let i = 0; i < 7; i++) bit(e.x, e.y, e.h + .02, RR(-.8, .8) - ux * RR(0, 1.2), RR(-.8, .8) - uy * RR(0, 1.2), RR(.6, 2.2), RR(.25, .5), i % 3, 6);
      for (let i = 0; i < 3; i++) bit(e.x, e.y, e.h + .03, RR(-2, 2) - ux * 2, RR(-2, 2) - uy * 2, RR(1, 3), RR(.06, .14), 3 + (i & 1), 12);
      puff(e.x, e.y, e.h + .08, -ux * .4, -uy * .4, .25, RR(.35, .6), .07);
    } else if (e.surf === 'tree' || e.surf === 'prop') {
      for (let i = 0; i < 6; i++) bit(e.x, e.y, e.h, RR(-1.4, 1.4) - ux * RR(.5, 2), RR(-1.4, 1.4) - uy * RR(.5, 2), RR(.5, 2.5), RR(.4, .8), 5 + (i & 1), 9);
      for (let i = 0; i < 2; i++) bit(e.x, e.y, e.h, RR(-2, 2), RR(-2, 2), RR(0, 2), RR(.05, .12), 3, 0);
    } else if (e.surf === 'hit') {
      for (let i = 0; i < 3; i++) bit(e.x, e.y, e.h, RR(-2.5, 2.5) + ux * 2, RR(-2.5, 2.5) + uy * 2, RR(-.5, 2), RR(.05, .12), 3 + (i & 1), 0);
    }
  }

  const F = {
    name: 'gunfx', label: 'Gun fx', on: true, TUNE,
    toggle() { F.on = !F.on; return F.on; },
    view(dt, evs) {
      const g = gun();
      for (const e of evs) {
        if (e.type === 'player.shoot') {
          const w = WEAPONS[e.gun] || {}, navy = e.gun === 'brass_navy';
          FL.t = TUNE.flash.life; FL.v = (R() * 3) | 0; FL.k = (navy ? TUNE.flash.navy : 1) * (e.fan ? TUNE.flash.fan : 1);
          LIGHT.x = e.x; LIGHT.y = e.y; LIGHT.h = e.h;
          const S = TUNE.smoke, n = S.puffs + (navy ? 1 : 0);
          for (let i = 0; i < n; i++) {
            const sp = S.speed * RR(.2, 1) * (w.push ? 1 + w.push : 1);
            puff(e.x + e.vx * .08 * i, e.y + e.vy * .08 * i, e.h + RR(-.03, .03), e.vx * sp + RR(-.3, .3), e.vy * sp + RR(-.3, .3), RR(.05, .3), RR(S.life[0], S.life[1]), RR(S.size[0], S.size[1]) * (navy ? 1.25 : 1));
          }
          wispFor = TUNE.smoke.wisp;
        } else if (e.type === 'bullet.impact') {
          const T = TR[trI]; trI = (trI + 1) % TRN;
          T.x0 = e.x0 ?? e.x; T.y0 = e.y0 ?? e.y; T.h0 = e.h0 ?? e.h; T.x1 = e.x; T.y1 = e.y; T.h1 = e.h; T.t = 0;
          impact(e);
        } else if (e.type === 'player.reload' && e.phase === 'eject' && e.n > 0) {
          for (let i = 0; i < e.n; i++) {
            const k = cI; cI = (cI + 1) % CM; if (cN < CM) cN++;
            cx[k] = e.x + RR(-.08, .08); cy[k] = e.y + RR(-.08, .08); ch[k] = e.z + RR(1.05, 1.25);
            cvx[k] = RR(-.7, .7); cvy[k] = RR(-.7, .7); cvh[k] = RR(-.2, .6); ct[k] = -i * .03;
          }
        }
      }
      if (FL.t > 0) FL.t -= dt;
      // the wisp off the barrel after a shot, and while the gunslinger blows on it
      const blowing = !!g && host.P.frame.startsWith('gun_blow.') && host.P.frame !== 'gun_blow.0' && host.P.frame !== 'gun_blow.4';
      if (g && (wispFor > 0 || blowing)) {
        wispFor -= dt; wispT -= dt;
        if (wispT <= 0) {
          wispT = TUNE.smoke.wispGap * (blowing ? .6 : 1);
          const m = muzzleWorld(g);
          if (m) puff(m.x, m.y, m.h + .02, RR(-.08, .08), RR(-.08, .08), blowing ? RR(.1, .3) : RR(.25, .45), RR(.6, 1.1), RR(.025, .04), .3);
        }
      }
      // smoke: rises, slows, drifts with the wind, grows; puffs past their life are swapped out
      const Wd = host.wind, wind = Wd?.on && Wd.at ? Wd.at(host.player.x, host.player.y, WIND) : null, S = TUNE.smoke, dr = Math.exp(-S.drag * dt);
      for (let i = sN - 1; i >= 0; i--) {
        st[i] += dt;
        if (st[i] >= sl[i]) { sN--; sx[i] = sx[sN]; sy[i] = sy[sN]; sh[i] = sh[sN]; svx[i] = svx[sN]; svy[i] = svy[sN]; svh[i] = svh[sN]; st[i] = st[sN]; sl[i] = sl[sN]; ss[i] = ss[sN]; sg[i] = sg[sN]; continue; }
        svx[i] = svx[i] * dr + (wind ? wind.x * .35 : 0) * (1 - dr); svy[i] = svy[i] * dr + (wind ? wind.y * .35 : 0) * (1 - dr);
        svh[i] = svh[i] * dr + S.rise * (1 - dr);
        sx[i] += svx[i] * dt; sy[i] += svy[i] * dt; sh[i] += svh[i] * dt;
      }
      for (const T of TR) if (T.t < 9) T.t += dt;
      // cases: fall, bounce, lie, then go
      const CS = TUNE.cases;
      for (let i = 0; i < cN; i++) {
        if ((ct[i] += dt) < 0 || ct[i] > CS.life) continue;
        if (cvh[i] === 0 && cvx[i] === 0 && cvy[i] === 0) continue;   // resting
        cvh[i] -= CS.grav * dt; cx[i] += cvx[i] * dt; cy[i] += cvy[i] * dt; ch[i] += cvh[i] * dt;
        const gz = host.elev(cx[i], cy[i]);
        if (ch[i] <= gz) { ch[i] = gz; if (cvh[i] < -1.2) { cvh[i] = -cvh[i] * CS.bounce; cvx[i] *= .5; cvy[i] *= .5; } else cvh[i] = cvx[i] = cvy[i] = 0; }
      }
      // bits: dust, sparks, chips
      for (let i = bN - 1; i >= 0; i--) {
        bt[i] += dt;
        if (bt[i] >= bl[i]) { bN--; bx[i] = bx[bN]; by[i] = by[bN]; bh[i] = bh[bN]; bvx[i] = bvx[bN]; bvy[i] = bvy[bN]; bvh[i] = bvh[bN]; bt[i] = bt[bN]; bl[i] = bl[bN]; bk[i] = bk[bN]; bg[i] = bg[bN]; continue; }
        const d = Math.exp(-3 * dt); bvx[i] *= d; bvy[i] *= d; bvh[i] -= bg[i] * dt;
        bx[i] += bvx[i] * dt; by[i] += bvy[i] * dt; bh[i] += bvh[i] * dt;
        const gz = host.elev(bx[i], by[i]); if (bh[i] < gz) { bh[i] = gz; bvh[i] = 0; bvx[i] *= .5; bvy[i] *= .5; }
      }
    },
    frame() {
      // tracers: every bullet in flight, a streak behind its head (length capped by how far it has come)
      const T = TUNE.tracer;
      for (const a of host.arrows) {
        if (a.kind !== 'bullet' || a.life <= -9) continue;
        const w = WEAPONS[a.gun], v = hypot3(a.vx, a.vy, a.vh) || 1, ux = a.vx / v, uy = a.vy / v, uh = a.vh / v;
        const flown = w ? (w.range / w.speed - a.life) * w.speed + .3 : T.len, L = Math.min(T.len, flown);
        seg(a.x, a.y, a.h, ux, uy, uh, 0, Math.min(L, T.head), C.head, true);
        if (L > T.head) seg(a.x, a.y, a.h, ux, uy, uh, T.head, Math.min(L, T.mid), C.mid, true);
        if (L > T.mid) seg(a.x, a.y, a.h, ux, uy, uh, T.mid, L, C.tail, false);
      }
      for (const S of TR) {   // a bullet's last step, shrinking into where it ended
        if (S.t >= T.last) continue;
        const k = S.t / T.last, x0 = S.x0 + (S.x1 - S.x0) * k, y0 = S.y0 + (S.y1 - S.y0) * k, h0 = S.h0 + (S.h1 - S.h0) * k;
        host.line(x0, y0, h0, S.x1, S.y1, S.h1, k < .5 ? C.head : C.mid, true);
      }
      const z = host.zoom, O = PT;
      for (let i = 0; i < cN; i++) {
        if (ct[i] < 0 || ct[i] > TUNE.cases.life) continue;
        O.size = z; O.emit = false; O.alpha = ct[i] > TUNE.cases.life - .6 ? .5 : 1;
        host.point(cx[i], cy[i], ch[i] + .01, (Math.floor(ct[i] * 9 + i) & 3) === 0 ? C.brassHi : C.brass, O);
      }
      for (let i = 0; i < bN; i++) {
        const k = bk[i]; O.size = z; O.alpha = bt[i] / bl[i] > .6 && k < 3 ? .5 : 1; O.emit = k === 3 || k === 4;
        host.point(bx[i], by[i], bh[i], k < 3 ? C.dust[k] : k < 5 ? C.spark[k - 3] : C.chip[k - 5], O);
      }
      O.alpha = 1; O.emit = false;
    },
    lights() {
      const L = TUNE.flash.light;
      if (FL.t <= -L.life + TUNE.flash.life) return NONE;
      const k = Math.max(0, (FL.t + L.life - TUNE.flash.life) / L.life);
      LIGHT.radius = L.radius * (.7 + .3 * k) * FL.k; LIGHT.intensity = L.intensity * k * FL.k;
      return LIT;
    },
    hd(q, sc) {
      if (!sN && FL.t <= 0) return;
      const z = host.zoom, px = host.PPM * z * sc;   // display px per metre
      // smoke first (the flash glows through it)
      for (let i = 0; i < sN; i++) {
        const k = st[i] / sl[i], s = view(sx[i], sy[i], sh[i]), r = (ss[i] + TUNE.smoke.grow * sg[i] * Math.sqrt(st[i])) * px;
        q.globalAlpha = TUNE.smoke.alpha * (sg[i] < 1 ? .6 : 1) * (k < .1 ? k / .1 : 1 - (k - .1) / .9) ** 1.4;
        q.drawImage(puffImg, s[0] * sc - r, s[1] * sc - r, r * 2, r * 2);
      }
      q.globalAlpha = 1;
      const g = gun();
      if (FL.t > 0 && g) {
        const m = muzzleWorld(g);
        if (m) {
          const s = view(m.x, m.y, m.h), len = TUNE.flash.len * px * FL.k * (.8 + .4 * FL.t / TUNE.flash.life), img = flashImg[FL.v];
          const k = len / img.width, c = Math.cos(MZ.a) * k, sn = Math.sin(MZ.a) * k;
          q.globalCompositeOperation = 'lighter';
          const gr = TUNE.flash.glow * px * FL.k * (.7 + .5 * FL.t / TUNE.flash.life);
          q.drawImage(glowImg, s[0] * sc - gr, s[1] * sc - gr, gr * 2, gr * 2);
          q.setTransform(c, sn, -sn, c, s[0] * sc, s[1] * sc);
          q.drawImage(img, -img.width * .12, -img.height / 2);
          q.setTransform(1, 0, 0, 1, 0, 0); q.globalCompositeOperation = 'source-over';
        }
      }
    },
  };
  const PT = {size: 1, alpha: 1, emit: false};
  function seg(x, y, h, ux, uy, uh, d0, d1, col, emit) {
    host.line(x - ux * d0, y - uy * d0, h - uh * d0, x - ux * d1, y - uy * d1, h - uh * d1, col, emit);
  }
  return F;
}
