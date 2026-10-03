// PROJECTILES: the player's arrows (arena convention: x east, y south, h up), the hit pops over what they hit and the
// footstep dust. (The props' hit wobble / flash and the rail dummies are combat's: combat/core.js update.)
// An arrow flies (gravity .9), hits the first target / hp prop in reach (features' onArrowHit decide 'stop' | 'pierce'),
// sticks in 3D tree bark, walls, solid props or the ground, splashes in the stream, then fades.
// OWNS: arrows, pops, dust, the hit count. READS: the world (trees, elevation, stream), the entities (near: what an arrow
// hits or sticks in), features' arrow hooks.
// EMITS: arrow.hit, arrow.splash (core/events.js). BUDGET: part of sim.
//   const proj = createProjectiles({world: () => world, ents: () => ents, features, events, opt: () => opt, toWorld, PPM, PPMH})
//   proj.spawn(o) | proj.step(dt) | proj.draw(host) | proj.arrows / dust / hits
//   proj.lerpBegin(alpha) / lerpEnd(): drawn between sim steps (an arrow's lx / ly / lh: where it was at the step's start)
import {elev, inStream, PROP_TOP} from '../world/world.js';
import {rgbOf} from '../core/color.js';
import {clearArray} from '../core/mathx.js';

const ARROW = {shaft: rgbOf('#9a6c44'), head: rgbOf('#cfcbbf'), fletch: rgbOf('#efe4c8')};
const DUST = ['#b8a888', '#8a7a60', '#5e5444'].map(rgbOf), POP = rgbOf('#f2d27a');
// how far round an arrow to look for what it hits: any hitR (<= .55, a boss) plus a piercing arrow's step out of the
// prop it went through (combat core: up to 1.2 m along its flight) in the same pass
const REACH = 2;

export function createProjectiles({world: worldOf, ents: entsOf, features, events, opt: optOf, toWorld, PPM, PPMH}) {
  const arrows = [], pops = [], dust = [], nearH = [], nearS = [];
  let hits = 0;
  function spawn(o) { const a = {life: 1.6, vh: 0, kind: 'arrow', ...o}; for (const f of features) f.arrow?.(a); arrows.push(a); }
  function step(dt) {
    const world = worldOf(), ents = entsOf();
    for (const a of arrows) {
      a.lx = a.x; a.ly = a.y; a.lh = a.h;
      if (a.stuck) { a.life -= dt; continue; }
      a.x += a.vx * dt; a.y += a.vy * dt; a.h += a.vh * dt; a.vh -= .9 * dt; a.life -= dt;
      (a.trail ??= []).push([a.x, a.y, a.h]); if (a.trail.length > 7) a.trail.shift();
      for (const p of ents.near(a.x, a.y, REACH, nearH)) {
        if (p.broken || p.gone || !(p.target || p.hp > 0) || (a.hitSet && a.hitSet.has(p))) continue;
        const rel = a.h - (p.z || 0) - (p.h || 0);
        if (Math.hypot(p.x - a.x, p.y - a.y) < (p.hitR ?? .45) && rel > -.2 && rel < (p.hitH ?? 1.6)) {
          hits++; pops.push({x: p.x, y: p.y, z: (p.z || 0) + (p.h || 0), t: 0}); events.push({type: 'arrow.hit', x: p.x, y: p.y, vx: a.vx, vy: a.vy, prop: p});
          let r; for (const f of features) { r = f.onArrowHit?.(a, p); if (r) break; }
          if (r === 'pierce') (a.hitSet ??= new Set()).add(p); else { a.life = -9; break; }
        }
      }
      if (a.life <= -9) continue;
      const ground = elev(a.x, a.y);
      // a 3D tree (trees3d.js) stops an arrow only in its trunk / big limbs, the tip in the bark; its round collider is skipped
      const tree = world.treeHit?.(a.x - a.vx * dt, a.y - a.vy * dt, a.h - a.vh * dt, a.x, a.y, a.h);
      if (tree) { a.x = tree.x; a.y = tree.y; a.h = tree.h; a.stuck = true; a.life = 3; features.forEach(f => f.onArrowStuck?.(a)); }
      else if (!a.stuck && ents.near(a.x, a.y, 0, nearS).some(p => !p.broken && !p.gone && !(a.hitSet && a.hitSet.has(p)) && !world.itemOf(p)?.pose && (p.rect ? a.x > p.rect[0] && a.x < p.rect[2] && a.y > p.rect[1] && a.y < p.rect[3] : p.r > .3 && Math.hypot(p.x - a.x, p.y - a.y) < p.r)
        && a.h > (p.z || 0) && a.h < (p.z || 0) + (PROP_TOP[p.kind] ?? 2.5))) { a.stuck = true; a.life = 3; features.forEach(f => f.onArrowStuck?.(a)); }
      else if (!a.stuck && a.h <= ground && ground === 0 && inStream(a.x, a.y)) { a.life = -9; events.push({type: 'arrow.splash', x: a.x, y: a.y, small: true}); features.forEach(f => f.onArrowStuck?.(a)); }
      else if (!a.stuck && (a.h <= ground || a.life <= 0)) { a.stuck = true; a.h = Math.max(ground, Math.min(a.h, ground + 2.4)); a.life = 3; features.forEach(f => f.onArrowStuck?.(a)); }
    }
    for (let i = arrows.length - 1; i >= 0; i--) if (arrows[i].life <= -9 || (arrows[i].stuck && arrows[i].life <= 0)) arrows.splice(i, 1);
    for (let i = pops.length - 1; i >= 0; i--) if ((pops[i].t += dt) > .8) pops.splice(i, 1);
    for (let i = dust.length - 1; i >= 0; i--) { const q = dust[i]; q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt; q.h += q.vh * dt; q.vx *= .9; q.vy *= .9; if (q.t > q.life) dust.splice(i, 1); }
  }
  function draw(host) {   // arrows as 3 world lines (the HD bow draws flying ones itself), dust, hit pops
    const opt = optOf();
    for (const a of arrows) {
      if (opt.hdBow && !a.stuck) continue;   // HD bow: arrows in flight are drawn on the HD overlay (player.js drawHD)
      const l = Math.hypot(a.vx, a.vy, a.vh) || 1, dx = a.vx / l, dy = a.vy / l, dh = a.vh / l, k = a.stuck ? .45 : .72;
      host.line(a.x - dx * k, a.y - dy * k, a.h - dh * k, a.x - dx * .1, a.y - dy * .1, a.h - dh * .1, ARROW.shaft);
      host.line(a.x - dx * .1, a.y - dy * .1, a.h - dh * .1, a.x, a.y, a.h, ARROW.head);
      if (!a.stuck) host.line(a.x - dx * k, a.y - dy * k, a.h - dh * k, a.x - dx * (k - .1), a.y - dy * (k - .1), a.h - dh * (k - .1), ARROW.fletch);
    }
    for (const q of dust) { const kk = q.t / q.life; host.point(q.x, q.y, q.h, DUST[kk < .4 ? 0 : kk < .75 ? 1 : 2]); }
    for (const p of pops) { const h = p.z + 1.7 + p.t * .5; for (const [dx, dh] of [[0, 0], [-1, 0], [1, 0], [0, 1], [0, -1]]) { const [vx, vy] = toWorld(dx / PPM, 0); host.point(p.x + vx, p.y + vy, h + dh / PPMH, POP, {emit: true}); } }
  }
  const lerped = [];
  function lerpBegin(k) {
    if (k >= 1) return;
    for (const a of arrows) {
      if (a.lx === undefined || (a.x === a.lx && a.y === a.ly && a.h === a.lh)) continue;
      a.cx = a.x; a.cy = a.y; a.ch = a.h; lerped.push(a);
      a.x = a.lx + (a.x - a.lx) * k; a.y = a.ly + (a.y - a.ly) * k; a.h = a.lh + (a.h - a.lh) * k;
    }
  }
  function lerpEnd() { for (const a of lerped) { a.x = a.cx; a.y = a.cy; a.h = a.ch; } clearArray(lerped); }
  return {arrows, pops, dust, spawn, step, draw, lerpBegin, lerpEnd, get hits() { return hits; }};
}
