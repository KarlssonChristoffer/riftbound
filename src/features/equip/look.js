// EQUIPMENT LOOK: the view of the equipment experiment (presentation only: it reads features/equip/sim.js and its events,
// writes only its own state; Math.random-free, its own view generator).
//   in the air   the gadgets' sprites tumbling (art.js: 8 turns), the flask's rag alight, the dynamite's and the smoke bomb's
//                fuses spitting sparks (the dynamite's faster and its stick flashing at the end), the hook and its rope
//   the preview  while F is held: the throw's arc as a crawl of glowing dots, a ring where it lands as big as what it does
//   fire         the pool: scorched oil on the ground (the ground layer: it takes the scene's light), a glow (the emit layer),
//                the game's own 3D flames (lights.js F.flame) over it, flame pixels, embers, smoke; enemies alight; a scorch
//                mark after
//   smoke        the cloud: soft HD puffs that churn and thin (gfx fx 'blend', drawn over what is in it: you vanish in it),
//                pixel puffs when the HD fx are off
//   the rest     traps (open, shut on a leg), scarecrows (sway, flinch, fall apart), the cache and pickups (floating, a ring
//                and a beam of their colour), bursts on the events (glass, straw, sparks, dirt, steam), lights
// OWNS: its particles (typed arrays, capped), scorches, flares, the light records. READS: the sim's lists and S, events,
//   host (yaw, zoom, PPM, toView, G.fx), the wind (smoke drift). CALLS: lights.js F.flame (its flames, drawn before its frame).
// BUDGET: view + frame ~.05-.15 ms with all six out (points <= ~700 a frame); render: a sprite draw per sheet in use.
import {paintArt, TIPS} from './art.js';
import {GADGETS, THROW} from '../../content/gadgets.js';
import {viewRandom} from '../../core/rng.js';
import {hex01} from '../../core/color.js';
import {clamp, hypot2, TAU, hash3} from '../../core/mathx.js';

const PM = 900;   // particles cap
const PALS = {
  fire: ['#fff6c8', '#ffd060', '#ff9a30', '#e05a1c', '#8a2a14'], spark: ['#ffffff', '#ffe8a0', '#ffb040', '#c8601e'],
  glass: ['#e8fff8', '#b8e0d8', '#6a9c98'], straw: ['#f0d070', '#d8b048', '#a88030'], dirt: ['#b8a888', '#8a7a60', '#5e5444'],
  smoke: ['#7a7480', '#5e5a64', '#47444c', '#38353c'], steam: ['#ffffff', '#e4ecf2', '#c8d4dc'], iron: ['#d8dce4', '#9aa0ac', '#5e646e'],
  water: ['#e8f4f8', '#b8d8e4', '#7aa8bc'], gold: ['#fff4c0', '#ffe07a', '#f2c24a', '#c8922a'], ash: ['#9e9890', '#7e7a74', '#64605b'],
};
const PIDX = {}, PCOL = [], PLEN = [];
for (const [k, list] of Object.entries(PALS)) { PIDX[k] = PCOL.length; PCOL.push(list.map(hex01)); PLEN.push(list.length); }
const EMITS = new Set([PIDX.fire, PIDX.spark, PIDX.gold]);
const C = {rope: hex01('#c8a878'), ropeD: hex01('#8a6a44'), smoke: hex01('#c8ced8'), smokeD: hex01('#8a9098'), soot: hex01('#4a4448'),
  steam: hex01('#eef4f8'), white: hex01('#ffffff')};

// fill styles, made once (a colour string made every frame is a new string to parse and cache each time)
const OIL_GLOW = [], SCORCH = [];
for (let i = 0; i < 16; i++) { OIL_GLOW.push([0, 1, 2, 3].map(f => `rgba(255,${110 + f * 12},30,${(.26 * i / 15).toFixed(3)})`)); SCORCH.push(`rgba(24,18,16,${(.5 * i / 15).toFixed(3)})`); }

export function createLook(host, sim) {
  const V = viewRandom('equip'), VR = (a, b) => a + V() * (b - a);
  const seenPools = [], flameKeys = new Map();   // the pools drawn last step (a pool gone: its scorch); a pool's 5 flame keys (lights.js F.flame)
  const S = sim.S;
  let art = null, T = 0;
  const COL = {}, LITE = {}; for (const [id, G] of Object.entries(GADGETS)) { COL[id] = hex01(G.col); LITE[id] = COL[id].map(v => v + (1 - v) * .45); }

  // ---------------------------------------------------------------- particles (structure of arrays)
  const X = new Float32Array(PM), Y = new Float32Array(PM), H = new Float32Array(PM), VX = new Float32Array(PM), VY = new Float32Array(PM), VH = new Float32Array(PM);
  const PT = new Float32Array(PM), PL = new Float32Array(PM), GR = new Float32Array(PM), DR = new Float32Array(PM), SZ = new Uint8Array(PM), PAL = new Uint8Array(PM);
  let N = 0;
  function part(x, y, h, vx, vy, vh, life, pal, o = 0, sz = 1, grav = 0, drag = 0) {
    if (N >= PM) return;
    const i = N++; X[i] = x; Y[i] = y; H[i] = h; VX[i] = vx; VY[i] = vy; VH[i] = vh; PT[i] = -o; PL[i] = life; GR[i] = grav; DR[i] = drag; SZ[i] = sz; PAL[i] = pal;
  }
  function burstOf(x, y, h, n, pal, sp, up, life, sz = 1, grav = 9, drag = 2) {
    for (let k = 0; k < n; k++) { const a = V() * TAU, s = VR(.3, 1) * sp; part(x, y, h, Math.sin(a) * s, Math.cos(a) * s * .8, VR(up * .4, up), VR(life * .6, life), pal, 0, sz, grav, drag); }
  }
  function stepParts(dt) {
    for (let i = N - 1; i >= 0; i--) {
      PT[i] += dt; if (PT[i] < 0) continue;
      if (PT[i] > PL[i]) { const j = --N; X[i] = X[j]; Y[i] = Y[j]; H[i] = H[j]; VX[i] = VX[j]; VY[i] = VY[j]; VH[i] = VH[j]; PT[i] = PT[j]; PL[i] = PL[j]; GR[i] = GR[j]; DR[i] = DR[j]; SZ[i] = SZ[j]; PAL[i] = PAL[j]; continue; }
      if (DR[i]) { const k = Math.max(0, 1 - DR[i] * dt); VX[i] *= k; VY[i] *= k; VH[i] *= k; }
      X[i] += VX[i] * dt; Y[i] += VY[i] * dt; VH[i] -= GR[i] * dt; H[i] += VH[i] * dt;
      if (GR[i] > 0) { const g = host.elev(X[i], Y[i]); if (H[i] < g) { H[i] = g; VH[i] = -VH[i] * .3; VX[i] *= .5; VY[i] *= .5; } }
    }
  }
  // soft HD puffs (gfx fx 'blend'): smoke over a fire, steam, a dynamite blast's dust
  const FM = 160, FX = new Float32Array(FM), FY = new Float32Array(FM), FH = new Float32Array(FM), FV = new Float32Array(FM), FR = new Float32Array(FM), FG = new Float32Array(FM),
    FT = new Float32Array(FM), FL = new Float32Array(FM), FA = new Float32Array(FM), FK = new Uint8Array(FM);   // FK: 0 soot, 1 steam, 2 dust, 3 the smoke bomb's
  let NF = 0;
  function puff(x, y, h, r, grow, rise, life, a, k) {
    if (NF >= FM) return;
    const i = NF++; FX[i] = x; FY[i] = y; FH[i] = h; FR[i] = r; FG[i] = grow; FV[i] = rise; FT[i] = 0; FL[i] = life; FA[i] = a; FK[i] = k;
  }
  const WS = {x: 0, y: 0, g: 0};
  function stepPuffs(dt) {
    const w = host.wind?.on && host.wind.at ? host.wind.at(host.player.x, host.player.y, WS) : null, wx = w ? w.x * .12 : 0, wy = w ? w.y * .12 : 0;
    for (let i = NF - 1; i >= 0; i--) {
      FT[i] += dt;
      if (FT[i] > FL[i]) { const j = --NF; FX[i] = FX[j]; FY[i] = FY[j]; FH[i] = FH[j]; FR[i] = FR[j]; FG[i] = FG[j]; FV[i] = FV[j]; FT[i] = FT[j]; FL[i] = FL[j]; FA[i] = FA[j]; FK[i] = FK[j]; continue; }
      FH[i] += FV[i] * dt; FR[i] += FG[i] * dt; FX[i] += wx * dt; FY[i] += wy * dt; FV[i] *= Math.max(0, 1 - dt * .6);
    }
  }
  // scorch marks on the ground (a pool burnt out, a blast) and short light flares
  const scorches = [], flares = [];
  const scorch = (x, y, z, r, life) => { if (scorches.length > 12) scorches.shift(); scorches.push({x, y, z, r, t: 0, life, s: V() * 99}); };
  const flare = (x, y, h, c, r, k, life) => { if (flares.length > 8) flares.shift(); flares.push({x, y, h, c, r, k, t: 0, life}); };

  // ---------------------------------------------------------------- events: the bursts
  function onEvents(evs) {
    for (let i = 0; i < evs.length; i++) {
      const e = evs[i]; if (!e.type.startsWith('equip.')) continue;
      switch (e.type) {
        case 'equip.shatter':   // glass flies, a whoomp of fire, the oil splashes out
          burstOf(e.x, e.y, e.h, 14, PIDX.glass, 3.2, 2.6, .7, 1, 12, 1.5);
          burstOf(e.x, e.y, e.z + .3, 26, PIDX.fire, 2.6, 3.2, .55, 2, 2, 2.5);
          for (let k = 0; k < 6; k++) puff(e.x + VR(-.4, .4), e.y + VR(-.3, .3), e.z + VR(.4, .9), VR(.25, .4), .5, VR(.4, .8), VR(1, 1.6), .55, 0);
          flare(e.x, e.y, e.z + .6, '#ffb050', 5.5, 2.6, .45);
          break;
        case 'equip.puff':      // the pop: a ring of smoke thrown out fast, the cloud fills in after (drawn from the sim's)
          for (let k = 0; k < 18; k++) { const a = k / 18 * TAU; puff(e.x + Math.sin(a) * .4, e.y + Math.cos(a) * .4, e.z + .5, .35, 1.8, .4, VR(.5, .8), .6, 3); }
          burstOf(e.x, e.y, e.z + .2, 10, PIDX.spark, 2, 1.5, .3, 1, 6, 3);
          flare(e.x, e.y, e.z + .5, '#e8e0d0', 3, 1, .2);
          break;
        case 'equip.blast': {   // dynamite: dirt thrown up in a crown, rocks, a dust ring (combat's explosion does the fire)
          if (e.wet) {   // under water: a white column, spray
            for (let k = 0; k < 40; k++) { const a = V() * TAU, s = VR(.2, 1.4); part(e.x + Math.sin(a) * .3, e.y + Math.cos(a) * .2, e.z, Math.sin(a) * s, Math.cos(a) * s * .8, VR(4, 9), VR(.6, 1.1), PIDX.water, 0, VR(1, 2.5) | 0, 14, .5); }
            for (let k = 0; k < 8; k++) puff(e.x + VR(-.5, .5), e.y + VR(-.3, .3), VR(.2, 1.8), VR(.3, .5), .4, VR(.3, .6), VR(1, 1.8), .6, 1);
          } else {
            for (let k = 0; k < 34; k++) { const a = V() * TAU, s = VR(1, 4.5); part(e.x, e.y, e.z + .1, Math.sin(a) * s, Math.cos(a) * s * .8, VR(2.5, 7), VR(.7, 1.3), PIDX.dirt, 0, VR(1, 2.5) | 0, 14, .4); }
            for (let k = 0; k < 14; k++) { const a = k / 14 * TAU + V() * .3; puff(e.x + Math.sin(a) * .8, e.y + Math.cos(a) * .6, e.z + .2, VR(.3, .5), 1.2, VR(.2, .5), VR(1.2, 2.2), .5, 2); }
            scorch(e.x, e.y, e.z, GADGETS.dynamite.r * .55, 14);
          }
          break;
        }
        case 'equip.fizzle':    // into the water: a splash and a hiss of steam
          burstOf(e.x, e.y, .02, 12, PIDX.water, 1.6, 2.4, .5, 1, 10, 1);
          for (let k = 0; k < 4; k++) puff(e.x + VR(-.2, .2), e.y + VR(-.15, .15), .2, .2, .35, VR(.5, .9), VR(.8, 1.3), .5, 1);
          break;
        case 'equip.snap':      // the jaws: sparks, iron bits, a flash
          burstOf(e.x, e.y, .3, 14, PIDX.spark, 3, 2.5, .3, 1, 6, 3);
          burstOf(e.x, e.y, .2, 6, PIDX.iron, 2, 2, .5, 1, 12, 1);
          flare(e.x, e.y, .5, '#d8f0ff', 2.6, 1.3, .2);
          break;
        case 'equip.hit':       // straw knocked out of the scarecrow
          burstOf(e.x, e.y, VR(.6, 1.2), 10, PIDX.straw, 2.2, 2.2, .9, 1, 9, 1.5);
          break;
        case 'equip.break':
          if (e.gadget === 'scarecrow') { burstOf(e.x, e.y, .8, 30, PIDX.straw, 2.8, 3, 1.2, 1, 9, 1.2); for (let k = 0; k < 4; k++) puff(e.x, e.y, .6, .25, .4, .4, 1, .4, 2); }
          else burstOf(e.x, e.y, .1, 8, PIDX.ash, .8, .8, .8, 1, 4, 2);
          break;
        case 'equip.latch':     // the hook bites: sparks off stone, chips off wood
          burstOf(e.x, e.y, e.h, 9, PIDX.spark, 2.4, 1.6, .25, 1, 6, 3);
          break;
        case 'equip.bounce':
          if (e.speed > 2) burstOf(e.x, e.y, host.elev(e.x, e.y) + .03, 4, PIDX.dirt, .9, .9, .35, 1, 8, 3);
          break;
        case 'equip.land':
          burstOf(e.x, e.y, host.elev(e.x, e.y) + .03, e.gadget === 'scarecrow' ? 12 : 6, PIDX.dirt, 1.4, 1, .45, 1, 8, 3);
          break;
        case 'equip.pick':      // a glint over you
          burstOf(e.x, e.y, 1.4, 12, PIDX.gold, 1.4, 1.4, .5, 1, 2, 3);
          break;
      }
    }
  }

  // ---------------------------------------------------------------- emitters: what the things out there throw off each view step
  const fuseTip = [0, 0, 0];
  function emit(dt) {
    for (const o of sim.air) {
      const fr = frameOf(o), tip = TIPS[o.id];
      if (tip) {
        tipAt(o, tip, fr, fuseTip);
        if (o.id === 'flask') { if (V() < dt * 40) part(fuseTip[0], fuseTip[1], fuseTip[2], VR(-.3, .3), VR(-.3, .3), VR(.3, 1), VR(.15, .3), PIDX.fire, 0, V() < .3 ? 2 : 1, -1, 2); }
        else {
          const hot = o.id === 'dynamite' && o.fuse < .6, rate = o.id === 'dynamite' ? (hot ? 90 : 45) : 25;
          for (let k = 0, n = (rate * dt + V()) | 0; k < n; k++) part(fuseTip[0], fuseTip[1], fuseTip[2], VR(-1.6, 1.6), VR(-1.2, 1.2), VR(.5, 2.4), VR(.1, .26), PIDX.spark, 0, 1, 7, 1);
          if (o.wet && V() < dt * 20) part(o.x + VR(-.1, .1), o.y + VR(-.1, .1), 0, 0, 0, VR(.3, .6), VR(.3, .6), PIDX.water, 0, 1, 0, 1);   // bubbles off a sunk stick
        }
      }
    }
    for (const q of sim.pools) {
      const k = q.t > q.dur - 1 ? Math.max(0, q.dur - q.t) : 1, r = q.r * (.4 + .6 * k);
      for (let n = 0, m = (dt * 18 * k + V()) | 0; n < m; n++) { const a = V() * TAU, d = Math.sqrt(V()) * r; part(q.x + Math.sin(a) * d, q.y + Math.cos(a) * d, q.z + .1, VR(-.2, .2), VR(-.2, .2), VR(1, 2.4), VR(.5, 1), PIDX.fire, 0, 1, -.3, .5); }
      if (V() < dt * 6 * k) { const a = V() * TAU, d = Math.sqrt(V()) * r * .7; puff(q.x + Math.sin(a) * d, q.y + Math.cos(a) * d, q.z + .9, VR(.15, .28), .35, VR(.5, .9), VR(1.4, 2.2), .38, 0); }
    }
    for (const [p] of sim.burning) if (V() < dt * 14) part(p.x + VR(-.15, .15), p.y + VR(-.1, .1), (p.z || 0) + (p.h || 0) + VR(.3, 1.2), VR(-.2, .2), VR(-.2, .2), VR(.8, 1.8), VR(.3, .6), PIDX.fire, 0, 1, -.5, 1);
  }
  // which of a sheet's 8 turns a thrown thing shows (its spin; on the ground: lying)
  function frameOf(o) {
    if (o.rest) return o.settled ? 2 : ((Math.round(o.t * 9) % 8) + 8) % 8;
    return ((Math.round(o.t * o.spin / (TAU / 8)) % 8) + 8) % 8;
  }
  // a point of a turned sprite (map px tip from its centre, frame fr) in the world, around the sprite's centre at (o.x, o.y, o.h + lift)
  function tipAt(o, tip, fr, out) {
    const a = fr / 8 * TAU, c = Math.cos(a), s = Math.sin(a), dx = tip[0] * c - tip[1] * s, dy = tip[0] * s + tip[1] * c, cy = lift(o);
    out[0] = o.x + dx * rx; out[1] = o.y + dx * ry; out[2] = o.h + cy - dy * up;
  }
  const lift = o => o.rest ? .1 : 0;   // (a sprite turned about its centre: on the ground it sits on its edge)

  // ---------------------------------------------------------------- per frame: the view basis (as combat/draw.js)
  let z = 1, rx = 0, ry = 0, gx = 0, gy = 0, up = 0, tx = 0, ty = 1;
  function basis() {
    z = host.zoom; const a = host.yaw, c = Math.cos(a), s = Math.sin(a);
    rx = c / host.PPM; ry = -s / host.PPM; gx = s / host.PPMY; gy = c / host.PPMY; up = 1 / host.PPMH; tx = s; ty = c;   // (tx, ty: toward the camera, on the ground)
  }
  const PO = {size: 1, alpha: 1, emit: false};
  const pt = (x, y, h, c, size, emit, alpha = 1) => { PO.size = size; PO.emit = emit; PO.alpha = alpha; host.point(x, y, h, c, PO); };
  const SPR = {img: null, em: null, sx: 0, sy: 0, sw: 0, sh: 0, x: 0, y: 0, h: 0, px: 0, py: 0, shadow: true, alpha: 1, flash: 0, flip: false, type: 3};
  function spr(sheet, fr, x, y, h, cx, alpha = 1, flash = 0, shadow = true) {   // cx: pivot at the centre (true) or the bottom middle
    const s = SPR; s.img = sheet.img; s.em = sheet.em; s.sx = fr * sheet.w; s.sy = 0; s.sw = sheet.w; s.sh = sheet.h;
    s.x = x; s.y = y; s.h = h; s.px = sheet.w / 2; s.py = cx ? sheet.h / 2 : sheet.h; s.alpha = alpha; s.flash = flash; s.shadow = shadow;
    host.sprite(s);
  }
  // world -> view px (for the ground and emit layers), into a reused pair
  const VP = [0, 0, 0];
  const vpx = (x, y, h) => { host.G.toScreenInto(x, h, y, VP); VP[0] = Math.round(VP[0]); VP[1] = Math.round(VP[1]); return VP; };

  // ---------------------------------------------------------------- the frame
  function frame() {
    if (!art) return;
    basis();
    const L = host.feature('lights'), flames = L?.on !== false && L?.flame ? L : null;
    // fire pools: the ground (oil, scorch), the glow, the game's flames, flame pixels
    const gq = sim.pools.length || scorches.length ? host.glayer('ground') : null, eq = sim.pools.length ? host.glayer('emit') : null;
    for (let i = 0; i < sim.pools.length; i++) {
      const q = sim.pools[i], k = q.t > q.dur - 1 ? Math.max(0, q.dur - q.t) : 1, grow = Math.min(1, q.t / .25), r = q.r * (.4 + .6 * k) * (.5 + .5 * grow);
      const [cx, cy] = vpx(q.x, q.y, q.z), ex = r * host.PPM * z, ey = r * host.PPMY * z;
      ellipseRows(gq, cx, cy, ex * 1.06, ey * 1.06, 'rgba(26,14,10,.6)', q.x * 3);
      ellipseRows(gq, cx, cy, ex * .82, ey * .82, 'rgba(150,62,18,.5)', q.x * 5 + T * 1.3);
      ellipseRows(gq, cx, cy, ex * .5, ey * .5, 'rgba(230,130,40,.45)', q.x * 9 + T * 2.1);
      ellipseRows(eq, cx, cy, ex * .78, ey * .78, OIL_GLOW[Math.round(15 * k)][(((Math.sin(T * 9 + i) + 1) * 2) | 0) & 3], q.x * 7 + T * 2);
      ellipseRows(eq, cx, cy, ex * .45, ey * .45, OIL_GLOW[Math.round(15 * k)][(((Math.sin(T * 13 + i) + 1) * 2) | 0) & 3], q.x * 11 + T * 3);
      // the game's own flames over the oil (lights.js: 3D particle flames), a few spread on the pool
      if (flames) {
        let keys = flameKeys.get(q); if (!keys) flameKeys.set(q, keys = [{}, {}, {}, {}, {}]);
        for (let n = 0; n < 5; n++) {
          const a = n * 2.4 + i, d = n ? r * .55 : 0, fx = q.x + Math.sin(a) * d, fy = q.y + Math.cos(a) * d * .8;
          flames.flame(keys[n], 'burn', '#ff9a40', fx, fy + .01, q.z + .02, k * grow, n ? .55 : .8, n ? .6 + .2 * Math.sin(T * 3 + n) : .9);
        }
      }
      // flame pixels licking up all over it (glowing)
      const m = Math.round(40 * k);
      for (let n = 0; n < m; n++) {
        const s1 = hash3(n, i, 7), s2 = hash3(n, i, 13), ph = (T * (1.6 + s1) + s2) % 1, a = s1 * TAU + T * .2, d = Math.sqrt(s2) * r * .92;
        const fx = q.x + Math.sin(a) * d, fy = q.y + Math.cos(a) * d, hh = q.z + ph * (.25 + .35 * (1 - d / r)) * k;
        pt(fx, fy, hh, PCOL[PIDX.fire][Math.min(4, (ph * 5) | 0)], z * (ph < .3 ? 2 : 1), true);
      }
    }
    // scorch marks
    for (let i = scorches.length - 1; i >= 0; i--) {
      const s = scorches[i], k = 1 - s.t / s.life; if (k <= 0) continue;
      const [cx, cy] = vpx(s.x, s.y, s.z);
      ellipseRows(gq, cx, cy, s.r * host.PPM * z, s.r * host.PPMY * z, SCORCH[Math.round(15 * Math.min(1, k * 2))], s.s);
    }
    // smoke clouds: soft puffs (HD), or pixel ones
    for (let i = 0; i < sim.clouds.length; i++) drawCloud(sim.clouds[i], i);
    for (let i = 0; i < NF; i++) {
      const k = FT[i] / FL[i], a = FA[i] * (k < .15 ? k / .15 : 1 - (k - .15) / .85);
      if (host.G.fx) host.G.fx(FX[i], FH[i], FY[i], FR[i], FK[i] === 1 ? C.steam : FK[i] === 2 ? C.smokeD : FK[i] === 3 ? C.smoke : C.soot, a, 'blend');
      else if ((i & 1) === 0) pt(FX[i], FY[i], FH[i], PCOL[PIDX.smoke][1], z * 3, false, a);
    }
    // thrown things in the air
    for (const o of sim.air) {
      const sh = sheetOf(o.id); if (!sh) continue;
      const fr = frameOf(o), flash = o.id === 'dynamite' && o.fuse < .45 && ((o.fuse * 14) | 0) % 2 === 0 ? .8 : 0;
      spr(sh, fr, o.x, o.y, o.h + lift(o) - (o.wet ? .14 : 0), true, o.wet ? .55 : 1, flash, !o.wet);   // (sunk: under the water, dim)
      if (o.id === 'dynamite' || o.id === 'smoke') { const tip = TIPS[o.id]; tipAt(o, tip, fr, fuseTip); pt(fuseTip[0], fuseTip[1], fuseTip[2], PCOL[PIDX.spark][(T * 30 | 0) % 2], z * 2, true); }
      if (o.id === 'flask') { tipAt(o, TIPS.flask, fr, fuseTip); pt(fuseTip[0], fuseTip[1], fuseTip[2] + up * 2, PCOL[PIDX.fire][(T * 24 | 0) % 3], z * 2, true); }
    }
    // the hook and its rope
    const hk = sim.hook;
    if (hk) {
      const P = host.player, hx = P.x, hy = P.y, hh = P.z + 1.15;
      host.line(hx, hy, hh, hk.x, hk.y, hk.h, C.rope, false);
      const [sx0, sy0] = vpx(hx, hy, hh), [sx1, sy1] = vpx(hk.x, hk.y, hk.h), dx = sx1 - sx0, dy = sy1 - sy0;
      const fr = ((Math.round(Math.atan2(-dx, dy) / (TAU / 8)) % 8) + 8) % 8;
      spr(art.hook, fr, hk.x, hk.y, hk.h, true, 1, 0, false);
    }
    // traps
    for (const q of sim.traps) {
      const shut = q.state === 'shut' || q.state === 'spent', who = q.state === 'shut' ? q.who : null;
      const x = who ? who.x + tx * .2 : q.x, y = who ? who.y + ty * .2 : q.y, a = q.state === 'spent' ? Math.max(0, 1 - q.gone / 1.2) : 1;
      spr(art.trap, shut ? 1 : 0, x, y, (who ? who.z || 0 : q.z) + .01, false, a, 0, true);
      if (q.state === 'armed') {   // a glint now and then; a faint ring: where it bites
        if ((T * 1.3 + q.x) % 1 < .07) pt(q.x, q.y, q.z + .16, C.white, z, true);
        const n = 18, r = GADGETS.beartrap.trig + .15; for (let j = 0; j < n; j++) { if ((j + ((T * 5) | 0)) % 3) continue; const ang = j / n * TAU; gpt(q.x, q.y, q.z + .02, Math.cos(ang) * r, Math.sin(ang) * r, COL.beartrap, .7); }
      }
    }
    // scarecrows (planted)
    for (const c of sim.crows) {
      let fr = 0, a = 1;
      if (c.dead) { fr = 4; a = Math.max(0, 1 - c.deadT / 1.2); }
      else if (c.t - c.hitT < .14) fr = 3;
      else { const w = Math.sin(T * 1.7 + c.x * 3); fr = w > .55 ? 1 : w < -.55 ? 2 : 0; }
      spr(art.crow, fr, c.x, c.y, c.z, false, a, c.t - c.hitT < .1 ? .7 : 0);
      if (!c.dead) {   // its taunt: a slow ring of its colour round its foot, and the hp it has left as a thin bar
        const k = c.hp / c.hp0, n = 24;
        for (let j = 0; j < n; j++) { if ((j + ((T * 8) | 0)) % 4 >= 2) continue; const ang = j / n * TAU; gpt(c.x, c.y, c.z + .02, Math.cos(ang) * 1.1, Math.sin(ang) * 1.1, COL.scarecrow, k); }
      }
    }
    // the cache and the pickups: floating, a ring, a beam
    const ca = sim.cache;
    if (ca) {
      spr(art.cache, ca.spent ? 1 : 0, ca.p.x, ca.p.y, ca.p.z, false);
      if (!ca.spent) item(ca.id, ca.p.x, ca.p.y, ca.p.z + .95, ca.t, 1);
    }
    for (const d of sim.drops) item(d.id, d.p.x, d.p.y, d.p.z + .35, d.t, Math.min(1, d.t / .3));
    // the preview while F is held
    if (S.aiming && S.slot) preview();
    // enemies alight: flame pixels round them
    for (const [p] of sim.burning) {
      if (p.gone) continue;
      const b = (p.z || 0) + (p.h || 0);
      for (let n = 0; n < 7; n++) { const ph = (T * 2.2 + n * .37) % 1, a = n * 2.1 + T; pt(p.x + Math.sin(a) * .18, p.y + Math.cos(a) * .12, b + .3 + ph * 1.1, PCOL[PIDX.fire][Math.min(4, (ph * 5) | 0)], z * (ph < .4 ? 2 : 1), true); }
    }
    // particles
    for (let i = 0; i < N; i++) {
      if (PT[i] < 0) continue;
      const p = PAL[i], k = PT[i] / PL[i], n = PLEN[p];
      pt(X[i], Y[i], H[i], PCOL[p][Math.min(n - 1, (k * n) | 0)], z * (SZ[i] > 1 && k < .5 ? SZ[i] : 1), EMITS.has(p));
    }
  }
  // a gadget floating over the cache / lying as a pickup: its sprite bobbing, a turning dashed ring, a beam of its colour
  function item(id, x, y, h, t, k) {
    const sh = id === 'scarecrow' ? art.crow : sheetOf(id), fr = id === 'scarecrow' ? 4 : 0, bob = Math.sin(t * 2.4) * .06;
    spr(sh, fr, x, y, h + bob + (id === 'scarecrow' ? -.2 : 0), id !== 'scarecrow', k);
    const c = COL[id], n = 20, g = host.elev(x, y) + .02;
    for (let j = 0; j < n; j++) { if ((j + ((t * 6) | 0)) % 5 >= 3) continue; const a = j / n * TAU; gpt(x, y, g, Math.cos(a) * .45, Math.sin(a) * .45, c, k); }
    for (let j = 0; j < 14; j++) { const hh = g + j * .12, a = (1 - j / 14) * .7 * k * (.75 + .25 * Math.sin(t * 3 - j * .4)); pt(x, y, hh, c, z, true, a); }
  }
  // a point on the ground at a view-frame offset (ox right, oy toward the camera, metres) from (x, y)
  function gpt(x, y, h, ox, oy, c, a, s = 1) { pt(x + ox * rx * host.PPM + oy * gx * host.PPMY, y + ox * ry * host.PPM + oy * gy * host.PPMY, h, c, z * s, true, a); }
  // filled ellipse as row spans on a GPU layer (view px), its edge ragged by a little noise
  function ellipseRows(q, cx, cy, ex, ey, col, seed) {
    q.fillStyle = col;
    const n = Math.max(2, Math.round(ey / z));
    for (let j = -n; j <= n; j++) {
      const v = j / n, w = Math.sqrt(Math.max(0, 1 - v * v)) * ex * (.9 + .1 * Math.sin(seed + j * 1.7)), w0 = Math.round(w / z) * z;
      if (w0 <= 0) continue;
      q.fillRect(cx - w0, cy + j * z, w0 * 2, z);
    }
  }
  function drawCloud(c, ci) {
    const G = GADGETS.smoke, R = sim.cloudR(c), fin = Math.min(1, c.t / .25), fout = c.t > c.dur - G.fade ? Math.max(0, (c.dur - c.t) / G.fade) : 1, A = fin * fout;
    const n = 44, big = R / G.r;
    for (let i = 0; i < n; i++) {
      const s1 = hash3(i, ci, 3), s2 = hash3(i, ci, 5), s3 = hash3(i, ci, 11), s4 = hash3(i, ci, 17);
      const a = s1 * TAU + c.t * (.12 + .18 * s2) * (s3 < .5 ? -1 : 1), d = Math.sqrt(s2) * R * .85, h = c.z + .55 + s4 * 1.7 * big * (1 - .45 * d / R) + Math.sin(c.t * .7 + i) * .1;
      const x = c.x + Math.sin(a) * d, y = c.y + Math.cos(a) * d * .9, r = (.7 + .55 * s3) * big;
      if (host.G.fx) host.G.fx(x, h, y, r, s4 < .25 ? C.smokeD : C.smoke, .58 * A, 'blend');
      else for (let k = 0; k < 6; k++) pt(x + (k - 3) * .08, y, h + (k & 1) * .1, PCOL[PIDX.smoke][k & 3], z * 3, false, .7 * A);
    }
  }
  const sheetOf = id => id === 'flask' ? art.flask : id === 'dynamite' ? art.dynamite : id === 'smoke' ? art.smoke : id === 'scarecrow' ? art.crow8 : id === 'beartrap' ? TRAP1 : id === 'grapple' ? art.hook : null;
  let TRAP1 = null;   // (the open trap, flying: frame 0 of its sheet, not turned)
  // the preview: the arc to where it lands (glowing dots crawling along it) and a ring as big as what it does there
  function preview() {
    const A = S.aim, id = S.slot.id, G = GADGETS[id], c = LITE[id], P = host.player;
    if (id === 'grapple') {
      const n = Math.max(6, Math.round(hypot2(A.ax - P.x, A.ay - P.y) / .35)), h0 = P.z + 1.2;
      for (let i = 1; i <= n; i++) { if ((i + ((T * 12) | 0)) % 3 === 0) continue; const k = i / n; pt(P.x + (A.ax - P.x) * k, P.y + (A.ay - P.y) * k, h0 + (A.ah - h0) * k, c, z * 2, true); }
      ring(A.ax, A.ay, A.ground ? A.z + .03 : A.ah, A.who ? .55 : A.prop ? .45 : .3, c, 3);
      return;
    }
    // the throw's own arc (sim.js launch: the same numbers)
    const lead = G.lead ?? 1, mx = P.x + (A.x - P.x) * lead, my = P.y + (A.y - P.y) * lead, mz = lead < 1 ? host.elev(mx, my) : A.z;
    const d = A.d || 1, ux = (A.x - P.x) / d, uy = (A.y - P.y) / d, x0 = P.x + ux * .3, y0 = P.y + uy * .3, h0 = P.z + THROW.hand;
    const t = clamp(THROW.t0 + A.d * lead * THROW.tk, THROW.t0, THROW.tMax), vx = (mx - x0) / t, vy = (my - y0) / t, vh = (mz + .05 - h0) / t + .5 * THROW.g * t;
    const n = 22, crawl = (T * 10) | 0;
    for (let i = 1; i <= n; i++) {
      if ((i + crawl) % 3 === 0) continue;
      const s = t * i / n; pt(x0 + vx * s, y0 + vy * s, h0 + vh * s - .5 * THROW.g * s * s, c, z * 2, true);
    }
    const r = id === 'flask' ? G.r : id === 'dynamite' ? G.r : id === 'smoke' ? G.r : id === 'beartrap' ? G.trig + .2 : id === 'scarecrow' ? 1.1 : .5;
    ring(A.x, A.y, A.z + .03, r, c, id === 'dynamite' ? 2 : 3);
  }
  function ring(x, y, h, r, c, of) {
    const n = Math.max(16, Math.round(r * (host.PPM + host.PPMY) * 1.4)), crawl = (T * 14) | 0;
    for (let j = 0; j < n; j++) { if ((j + crawl) % of === 0) continue; const a = j / n * TAU; gpt(x, y, h, Math.cos(a) * r, Math.sin(a) * r, c, 1, 2); }
    pt(x, y, h, c, z * 3, true);
  }

  // ---------------------------------------------------------------- lights (records reused: lighting.js copies them at once)
  const LREC = [], LLIST = [];
  let nL = 0;
  const lrec = (x, y, h, color, radius, intensity, flicker, id) => {
    const o = LREC[nL] ??= {x: 0, y: 0, h: 0, color: null, radius: 0, intensity: 0, flicker: 0, id: 0};
    o.x = x; o.y = y; o.h = h; o.color = color; o.radius = radius; o.intensity = intensity; o.flicker = flicker; o.id = id; LLIST[nL++] = o;
  };
  function lights() {
    nL = 0;
    if (!art) { LLIST.length = 0; return LLIST; }
    for (let i = 0; i < sim.pools.length && i < 4; i++) { const q = sim.pools[i], k = (q.t > q.dur - 1 ? Math.max(0, q.dur - q.t) : 1) * Math.min(1, q.t / .2); lrec(q.x, q.y, q.z + .6, '#ff8a30', 4.8 * (.6 + .4 * k), 1.35 * k, .55, 7600 + i); }
    let n = 0;
    for (const o of sim.air) {
      if (n >= 3) break;
      if (o.id === 'flask') lrec(o.x, o.y, o.h, '#ffa040', 2.2, .7, .6, 7610 + n++);
      else if (o.id === 'dynamite') lrec(o.x, o.y, o.h + .2, '#ffc070', 1.8, o.fuse < .6 ? .95 : .6, .8, 7610 + n++);
    }
    const ca = sim.cache; if (ca && !ca.spent) lrec(ca.p.x, ca.p.y, ca.p.z + 1.1, GADGETS[ca.id].col, 2.4, .6, .1, 7620);
    for (let i = 0; i < sim.drops.length && i < 4; i++) { const d = sim.drops[i]; lrec(d.p.x, d.p.y, d.p.z + .5, GADGETS[d.id].col, 1.8, .45, .1, 7621 + i); }
    n = 0; for (const [p] of sim.burning) { if (n >= 3) break; if (!p.gone) lrec(p.x, p.y, (p.z || 0) + 1, '#ff8a30', 2, .7, .6, 7630 + n++); }
    for (let i = 0; i < flares.length; i++) { const f = flares[i], k = 1 - f.t / f.life; lrec(f.x, f.y, f.h, f.c, f.r * (.7 + .3 * k), f.k * k * k, 0, 7640 + i); }
    LLIST.length = nL; return LLIST;
  }

  return {
    get art() { return art; },
    load() { if (art) return; art = paintArt(); TRAP1 = {img: art.trap.img, em: null, w: art.trap.w, h: art.trap.h, frames: 1}; },
    view(dt, evs) {
      if (!art) return;
      T += dt;
      onEvents(evs); emit(dt); stepParts(dt); stepPuffs(dt);
      for (let i = scorches.length - 1; i >= 0; i--) if ((scorches[i].t += dt) > scorches[i].life) scorches.splice(i, 1);
      for (let i = flares.length - 1; i >= 0; i--) if ((flares[i].t += dt) > flares[i].life) flares.splice(i, 1);
      // a pool burning out leaves its scorch (seen as the sim drops it: the view keeps the last pools it drew)
      for (let i = 0; i < seenPools.length; i++) if (sim.pools.indexOf(seenPools[i]) < 0) { const q = seenPools[i]; scorch(q.x, q.y, q.z, q.r * .9, 18); flameKeys.delete(q); }
      seenPools.length = 0; for (let i = 0; i < sim.pools.length; i++) seenPools.push(sim.pools[i]);
    },
    frame, lights,
    clear() { N = 0; NF = 0; scorches.length = 0; flares.length = 0; seenPools.length = 0; flameKeys.clear(); },
    get counts() { return {parts: N, puffs: NF, scorches: scorches.length}; },
  };
}
