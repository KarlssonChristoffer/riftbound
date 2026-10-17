// MODS LOOK: the view of weapon attachments and runes (features/mods.js). Reads the sim (features/mods/sim.js), writes only its
// own state; may use its own view random (core/rng.js viewRandom), never the sim's.
//   SHOTS     a typed shot in flight trails its type (embers, frost glints, green drips, violet motes, a storm's crackle); a
//             staff's bolt is a glowing orb; an echo is pale
//   STATUSES  burning: flames off it and a light; chilled: frost motes; frozen: a cage of ice shards round it; rotting: green
//             drips; hollow: a violet ring under it while it falls upward
//   MOMENTS   (the sim's S.fxq, drained each frame): storm arcs (zigzag lines that flicker), a bolt from the sky, a shatter, a
//             reaction's name over it, the Last Word's burst ring, spores, an implosion, the hollow swap's streak, an echo's ghost
//   DROPS     a dropped part stands over the ground as its icon in world pixels, bobbing, with a glint and a light
//   FINDS     a toast (the game HUD): the part's name, "M: the weapon bench"
// Particles go through combat's own (core.part: its fx list, drawn by combat/draw.js); pixels and lines through host.point /
// host.line. OWNS: its moments, its light records. BUDGET: view: per shot in flight a few points; per status a particle now and
// then; per drop its icon's pixels (~60); nothing while nothing is fitted, flying, burning or lying about.
import {ELEM, PARTS, REACT} from '../../content/mods.js';
import {PAL} from '../../content/items.js';
import {viewRandom} from '../../core/rng.js';
import {rgbOf} from '../../core/color.js';

const ICE = ['#ffffff', '#d8f6ff', '#9fe6ff', '#5aa8d8'], STEAM = ['#ffffff', '#e8eef2', '#c8d0d8', '#a0a8b0'];
const SMOKE = ['#6e6870', '#5a555c', '#47424a', '#38343c'];

export function createModsLook(host, sim) {
  const R = viewRandom('mods'), rr = (a, b) => a + R() * (b - a);
  const core = () => host.feature('combat')?.core;
  const ui = () => host.feature('game')?.ui;
  const RGB = new Map(), rgb = c => { let v = RGB.get(c); if (!v) { v = rgbOf(c); RGB.set(c, v); } return v; };
  const O = {size: 1, alpha: 1, emit: true};
  const pt = (x, y, h, c, size = 1, alpha = 1) => { O.size = size; O.alpha = alpha; host.point(x, y, h, rgb(c), O); };
  const moments = [];   // {k, t, life, ...}: what the fxq said, as long as it shows
  let T = 0, rx = 0, ry = 0, up = 0, z = 1;
  const basis = () => { z = host.zoom || 1; const a = host.yaw, c = Math.cos(a), s = Math.sin(a); rx = c / host.PPM; ry = -s / host.PPM; up = 1 / host.PPMH; };
  // each part's icon as pixels: [dx, dy, colour] round its middle (made once)
  const ICONS = {};
  function iconPx(id) {
    if (ICONS[id]) return ICONS[id];
    const D = PARTS[id], L = [];
    D.icon.forEach((row, y) => { for (let x = 0; x < row.length; x++) { const ch = row[x]; if (ch === '.') continue; L.push([x - 6, y - 6, D.pal?.[ch] || PAL[ch] || '#f0f']); } });
    return (ICONS[id] = L);
  }
  const partCol = id => PARTS[id]?.elem ? ELEM[PARTS[id].elem].col : '#f2d27a';
  const part = (x, y, h, vx, vy, vh, life, pal, o) => core()?.part?.(x, y, h, vx, vy, vh, life, pal, o);

  // ---- the moments the sim reported ----
  function take() {
    const q = sim.S.fxq;
    for (let i = 0; i < q.length; i++) {
      const f = q[i];
      switch (f.k) {
        case 'arc': moments.push({...f, t: 0, life: .22}); break;
        case 'bolt': moments.push({...f, t: 0, life: .35}); for (let j = 0; j < 14; j++) part(f.x, f.y, f.h + .1, rr(-3, 3), rr(-3, 3), rr(2, 5), rr(.3, .6), ELEM.storm.pal, {emit: true, drag: 3}); break;
        case 'shatter': for (let j = 0; j < 22; j++) part(f.x, f.y, f.h + rr(-.4, .4), rr(-3.5, 3.5), rr(-3, 3), rr(1, 4), rr(.4, .9), ICE, {emit: true, grav: 9}); break;
        case 'react': { const D = REACT[f.id]; ui()?.float(f.x, f.y, f.h + .9, D.name, f.id === 'steam' ? '#e8eef2' : f.id === 'blight' || f.id === 'shatterbolt' ? '#9fe6ff' : f.id === 'unravel' ? '#b06aff' : '#ffb040', true);
          if (f.id === 'steam') for (let j = 0; j < 18; j++) part(f.x, f.y, f.h, rr(-1.2, 1.2), rr(-1, 1), rr(.8, 2.4), rr(.6, 1.2), STEAM, {drag: 2, sz: 2});
          break; }
        case 'burst': moments.push({...f, t: 0, life: .4}); for (let j = 0; j < 24; j++) { const a = j / 24 * 6.283; part(f.x, f.y, f.h, Math.sin(a) * f.r * 3, Math.cos(a) * f.r * 2.4, rr(.2, 1.4), rr(.25, .5), ELEM[f.elem].pal, {emit: true, drag: 4}); } break;
        case 'spores': for (let j = 0; j < 26; j++) { const a = R() * 6.283, d = R() * f.r; part(f.x + Math.sin(a) * d * .3, f.y + Math.cos(a) * d * .3, f.h, Math.sin(a) * d, Math.cos(a) * d, rr(.1, .6), rr(.8, 1.6), ELEM.rot.pal, {drag: 1.6, sz: 2}); } break;
        case 'implode': moments.push({...f, t: 0, life: .5}); for (let j = 0; j < 28; j++) { const a = R() * 6.283, d = f.r * rr(.6, 1); part(f.x + Math.sin(a) * d, f.y + Math.cos(a) * d, f.h + rr(-.3, .6), -Math.sin(a) * d * 2.2, -Math.cos(a) * d * 2.2, 0, rr(.35, .5), ELEM.void.pal, {emit: true}); } break;
        case 'swap': moments.push({...f, t: 0, life: .45}); break;
        case 'echo': for (let j = 0; j < 10; j++) part(f.x, f.y, f.h + rr(-.5, .4), rr(-.6, .6), rr(-.6, .6), rr(.2, .9), rr(.3, .6), ['#ffffff', '#e0d8f8', '#c0b0e8', '#8a7ab0'], {emit: true, drag: 3}); break;
        case 'shot': if (f.elem !== 'phys') for (let j = 0; j < 5; j++) part(f.x + f.ux * .2, f.y + f.uy * .2, f.h, f.ux * rr(1, 3) + rr(-.6, .6), f.uy * rr(1, 3) + rr(-.6, .6), rr(-.3, .8), rr(.15, .3), ELEM[f.elem].pal, {emit: true, drag: 5}); break;
        case 'find': { const D = PARTS[f.id]; ui()?.toast(D.name, f.first ? 'M: the weapon bench' : 'another one, for a second weapon', partCol(f.id));
          for (let j = 0; j < 16; j++) part(f.x, f.y, f.h, rr(-1.5, 1.5), rr(-1.5, 1.5), rr(1, 3), rr(.4, .8), ['#ffffff', '#fff4c0', '#ffe07a', '#f2c24a'], {emit: true, drag: 3}); break; }
      }
    }
    q.length = 0;
  }

  // ---- shots in flight: their trails ----
  function shots(dt) {
    for (const a of host.arrows) {
      if (a.stuck || a.life <= -9) continue;
      const t = sim.TAGS.get(a); if (!t || t.elem === 'phys' && !a.bolt) continue;
      const E = ELEM[t.elem], pal = E.pal;
      if (a.bolt) {   // the staff's bolt: an orb
        for (let i = 0; i < 9; i++) pt(a.x + rr(-.06, .06), a.y + rr(-.06, .06), a.h + rr(-.06, .06), pal[i % 3], z * (i < 3 ? 2 : 1));
        if (R() < dt * 40) part(a.x, a.y, a.h, rr(-.5, .5), rr(-.5, .5), rr(-.2, .5), rr(.2, .4), pal, {emit: true, drag: 3});
        continue;
      }
      const alpha = t.echo ? .55 : 1;
      if (a.kind === 'bullet') {   // a short coloured streak behind it (gunfx draws the tracer)
        const lx = a.lx ?? a.x, ly = a.ly ?? a.y, lh = a.lh ?? a.h;
        for (let i = 0; i < 4; i++) { const k = i / 4; pt(lx + (a.x - lx) * k, ly + (a.y - ly) * k, lh + (a.h - lh) * k, pal[1 + (i & 1)], z, alpha); }
      } else pt(a.x, a.y, a.h, pal[1], z * 2, alpha);
      if (R() < dt * (a.kind === 'bullet' ? 30 : 22)) {
        const g = t.elem === 'rot' ? 6 : t.elem === 'fire' ? -1.5 : 0;
        part(a.x, a.y, a.h, rr(-.4, .4), rr(-.4, .4), rr(-.2, .4), rr(.2, .45), pal, {emit: t.elem !== 'rot', drag: 3, grav: g});
      }
      if (t.elem === 'storm' && R() < .35) { const ex = rr(-.25, .25), ey = rr(-.25, .25); host.line(a.x, a.y, a.h, a.x + ex, a.y + ey, a.h + rr(-.2, .2), E.pal[1], true); }
    }
  }

  // ---- statuses on their targets ----
  function statuses(dt) {
    for (const [p, s] of sim.ST) {
      if (p.gone || p.broken) continue;
      const h0 = (p.z || 0) + (p.h || 0), tall = p.hitH ? Math.min(p.hitH, 1.8) : 1.4;
      if (s.burn > 0 && R() < dt * 26) part(p.x + rr(-.25, .25), p.y + rr(-.2, .2), h0 + rr(.2, tall), rr(-.3, .3), rr(-.3, .3), rr(.8, 2), rr(.25, .5), ELEM.fire.pal, {emit: true, drag: 2, grav: -2});
      if (s.burn > 0 && R() < dt * 4) part(p.x, p.y, h0 + tall, rr(-.2, .2), rr(-.2, .2), rr(.6, 1.2), rr(.8, 1.4), SMOKE, {drag: 1.5, sz: 2});
      if (s.rot > 0 && R() < dt * (6 + 5 * s.rotN)) part(p.x + rr(-.3, .3), p.y + rr(-.2, .2), h0 + rr(.3, tall), rr(-.2, .2), rr(-.2, .2), rr(-.1, .3), rr(.5, .9), ELEM.rot.pal, {grav: 5, sz: 1});
      if (s.chill > 0 && !(s.frozen > 0) && R() < dt * 8 * s.chill) part(p.x + rr(-.3, .3), p.y + rr(-.25, .25), h0 + rr(.2, tall), 0, 0, rr(-.4, .1), rr(.4, .8), ICE, {emit: true});
      if (s.frozen > 0) {   // a cage of ice shards: fixed by the target (its own shard pattern from where it stands), melting at the end
        const k = Math.min(1, s.frozen / .4);
        for (let i = 0; i < 18; i++) {
          const a = i * 2.39996, r = .32 + (i % 3) * .05, hh = (i * .618) % 1 * tall * k;
          pt(p.x + Math.sin(a) * r, p.y + Math.cos(a) * r, h0 + hh, ICE[i % 4], z * (i % 4 === 0 ? 2 : 1));
        }
        if (R() < dt * 6) part(p.x + rr(-.3, .3), p.y + rr(-.3, .3), h0 + rr(0, tall), 0, 0, rr(.1, .5), rr(.4, .8), ICE, {emit: true});
      }
      if (s.lift > 0) for (let i = 0; i < 12; i++) { const a = i / 12 * 6.283 + T * 3; pt(p.x + Math.sin(a) * .5, p.y + Math.cos(a) * .5, (p.z || 0) + .05, ELEM.void.pal[1 + (i & 1)], z, Math.min(1, s.lift * 2)); }
    }
  }

  // ---- moments that last a little ----
  function zig(x0, y0, h0, x1, y1, h1, col, n = 6, j = .22) {
    let px = x0, py = y0, ph = h0;
    for (let i = 1; i <= n; i++) {
      const k = i / n, w = i === n ? 0 : j;
      const x = x0 + (x1 - x0) * k + rr(-w, w), y = y0 + (y1 - y0) * k + rr(-w, w), h = h0 + (h1 - h0) * k + rr(-w, w);
      host.line(px, py, ph, x, y, h, col, true); px = x; py = y; ph = h;
    }
  }
  function drawMoments(dt) {
    for (let i = moments.length - 1; i >= 0; i--) {
      const m = moments[i]; m.t += dt;
      if (m.t > m.life) { moments.splice(i, 1); continue; }
      if (m.k === 'arc') { if (R() < .8) zig(m.x, m.y, m.h, m.x1, m.y1, m.h1, R() < .5 ? '#ffffff' : ELEM.storm.col); }
      else if (m.k === 'bolt') { if (R() < .85) zig(m.x + rr(-1, 1), m.y + rr(-1, 1), m.h + 14, m.x, m.y, m.h, R() < .5 ? '#ffffff' : '#ece4ff', 9, .7); }
      else if (m.k === 'burst' || m.k === 'implode') {
        const k = m.t / m.life, r = m.k === 'burst' ? m.r * k : m.r * (1 - k), col = m.k === 'burst' ? ELEM[m.elem].col : ELEM.void.col;
        for (let j = 0; j < 28; j++) { const a = j / 28 * 6.283; pt(m.x + Math.sin(a) * r, m.y + Math.cos(a) * r, m.h - .7, col, z, 1 - k); }
      } else if (m.k === 'swap') {
        const k = m.t / m.life;
        for (let j = 0; j < 20; j++) { const q = j / 20; pt(m.x + (m.x1 - m.x) * q + rr(-.1, .1), m.y + (m.y1 - m.y) * q + rr(-.1, .1), m.h + rr(-.3, .3), ELEM.void.pal[j % 3], z, 1 - k); }
      }
    }
  }

  // ---- dropped parts ----
  function drops() {
    for (const d of sim.drops) {
      const px = iconPx(d.id), bob = Math.sin(T * 2.4 + d.x) * .08, h = d.z + .55 + bob;
      for (let i = 0; i < px.length; i++) { const [dx, dy, c] = px[i]; pt(d.x + dx * rx * .5, d.y + dx * ry * .5, h - dy * up * .5, c, z); }
      if (R() < .06) part(d.x + rr(-.2, .2), d.y + rr(-.2, .2), h + rr(-.2, .2), 0, 0, rr(.2, .6), rr(.4, .7), ['#ffffff', '#fff4c0', '#ffe07a', '#f2c24a'], {emit: true});
    }
  }

  const LREC = [], LLIST = [];
  let nL = 0;
  const lrec = (x, y, h, color, radius, intensity, flicker, id) => {
    const o = LREC[nL] ??= {x: 0, y: 0, h: 0, color: null, radius: 0, intensity: 0, flicker: 0, id: 0};
    o.x = x; o.y = y; o.h = h; o.color = color; o.radius = radius; o.intensity = intensity; o.flicker = flicker; o.id = id; LLIST[nL++] = o;
  };
  function lights() {
    nL = 0;
    let n = 0;
    for (const [p, s] of sim.ST) { if (n >= 4) break; if (s.burn > 0 && !p.gone) lrec(p.x, p.y, (p.z || 0) + 1, '#ff8a30', 2.4, .8, .6, 9400 + n++); }
    for (let i = 0; i < sim.drops.length && i < 3; i++) { const d = sim.drops[i]; lrec(d.x, d.y, d.z + .6, partCol(d.id), 1.6, .5, .15, 9410 + i); }
    n = 0; for (const a of host.arrows) { if (n >= 3) break; if (a.bolt && !a.stuck) { const t = sim.TAGS.get(a); lrec(a.x, a.y, a.h, ELEM[t?.elem || 'phys'].col, 2.2, .9, .2, 9420 + n++); } }
    n = 0; for (const m of moments) { if (n >= 3) break; if (m.k === 'arc' || m.k === 'bolt') lrec(m.x1 ?? m.x, m.y1 ?? m.y, (m.h1 ?? m.h) + .3, '#d8ccff', m.k === 'bolt' ? 6 : 2.6, 1.4 * (1 - m.t / m.life), .4, 9430 + n++); }
    LLIST.length = nL; return LLIST;
  }

  return {
    view(dt) { T += dt; take(); },
    frame(f) { const dt = Math.min(f?.dt ?? 1 / 60, .1); basis(); shots(dt); statuses(dt); drawMoments(dt); drops(); },
    lights,
    clear() { moments.length = 0; sim.S.fxq.length = 0; },
  };
}
