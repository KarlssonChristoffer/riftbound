// PROJECTILES: the player's arrows and bullets (arena convention: x east, y south, h up), the hit pops over what they hit
// and the footstep dust. (The props' hit wobble / flash and the rail dummies are combat's: combat/core.js update.)
// An arrow flies (gravity .9), hits the first target / hp prop in reach (features' onArrowHit decide 'stop' | 'pierce'),
// sticks in 3D tree bark, walls, solid props or the ground, splashes in the stream, then fades.
// A BULLET (kind 'bullet', sim/player/gun.js) flies straight (no drop) at ~150 m/s, 2.5 m a step: it is tested along its
// whole path in sub-steps of at most SUB m (no tunnelling), stops at the first thing it meets and is gone at once (no
// sticking, no onArrowStuck): 'bullet.impact' says where and what. Its hits go through the same onArrowHit chain and
// 'arrow.hit' (kind 'bullet'; the push scales its velocity there: a bullet shoves like an arrow, not like 150 m/s).
// PENETRATION: a bullet carries its weapon's pen {through, dmg, speed} (content/weapons.js); when the hit chain says
// 'pierce' (combat: a body, while it has `through` left) it goes on through: a.pn bodies passed, a.penK the share of its
// damage left (combat multiplies its hits by it), slower by pen.speed; 'bullet.pierce' at the point it leaves the body.
// OWNS: arrows (a bullet's pn / penK too), pops, dust, the hit count. READS: the world (trees, elevation, stream), the
// entities (near: what an arrow hits or sticks in), features' arrow hooks.
// EMITS: arrow.hit, arrow.splash, bullet.impact, bullet.pierce (core/events.js). BUDGET: part of sim.
//   const proj = createProjectiles({world: () => world, ents: () => ents, features, events, opt: () => opt, toWorld, PPM, PPMH})
//   proj.spawn(o) | proj.step(dt) | proj.draw(host) | proj.arrows / dust / hits
//   proj.lerpBegin(alpha) / lerpEnd(): drawn between sim steps (an arrow's lx / ly / lh: where it was at the step's start)
import {elev, inStream, PROP_TOP} from '../world/world.js';
import {rgbOf} from '../core/color.js';
import {hypot2, hypot3} from '../core/mathx.js';

const ARROW = {shaft: rgbOf('#9a6c44'), head: rgbOf('#cfcbbf'), fletch: rgbOf('#efe4c8')};
const DUST = ['#b8a888', '#8a7a60', '#5e5444'].map(rgbOf), POP = rgbOf('#f2d27a');
// how far round an arrow to look for what it hits: any hitR (<= .55, a boss) plus a piercing arrow's step out of the
// prop it went through (combat core: up to 1.2 m along its flight) in the same pass
const REACH = 2;
const SUB = .3, REACH_B = .6;   // a bullet's sub-step (m) and how far round each to look (any hitR <= .55)

export function createProjectiles({world: worldOf, ents: entsOf, features, events, opt: optOf, toWorld, PPM, PPMH}) {
  const arrows = [], pops = [], dust = [], nearH = [], nearS = [];
  let hits = 0;
  function spawn(o) { const a = {life: 1.6, vh: 0, kind: 'arrow', ...o}; for (const f of features) f.arrow?.(a); arrows.push(a); }
  function step(dt) {
    const world = worldOf(), ents = entsOf();
    for (const a of arrows) {
      a.lx = a.x; a.ly = a.y; a.lh = a.h;
      if (a.stuck) { a.life -= dt; continue; }
      if (a.kind === 'bullet') { stepBullet(a, dt, world, ents); continue; }
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
  // a bullet's step: the segment from where it was (the first step: TUNE.back m behind the muzzle) to where it gets
  function stepBullet(a, dt, world, ents) {
    const back = a.back || 0; a.back = 0;
    const ax = a.x, ay = a.y, ah = a.h;   // (a hit moves it to the hit point: one it goes through mustn't jump a step on)
    const dx = a.vx * dt, dy = a.vy * dt, dh = a.vh * dt, len = hypot3(dx, dy, dh) || 1;
    const x0 = a.x - dx / len * back, y0 = a.y - dy / len * back, h0 = a.h - dh / len * back;
    const ex = a.x + dx - x0, ey = a.y + dy - y0, eh = a.h + dh - h0, n = Math.max(1, Math.ceil((len + back) / SUB));
    let px = x0, py = y0, ph = h0;
    a.life -= dt;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = x0 + ex * t, y = y0 + ey * t, h = h0 + eh * t;
      for (const p of ents.near(x, y, REACH_B, nearH)) {
        if (p.broken || p.gone || !(p.target || p.hp > 0) || (a.hitSet && a.hitSet.has(p))) continue;
        const rel = h - (p.z || 0) - (p.h || 0);
        if (hypot2(p.x - x, p.y - y) < (p.hitR ?? .45) && rel > -.2 && rel < (p.hitH ?? 1.6)) {
          a.x = x; a.y = y; a.h = h; hits++; pops.push({x: p.x, y: p.y, z: (p.z || 0) + (p.h || 0), t: 0});
          const k = a.push ?? 1;
          events.push({type: 'arrow.hit', x: p.x, y: p.y, vx: a.vx * k, vy: a.vy * k, prop: p, kind: 'bullet'});
          let r; for (const f of features) { r = f.onArrowHit?.(a, p); if (r) break; }
          if (r === 'pierce') { (a.hitSet ??= new Set()).add(p); if (a.pen) pierce(a, p, x, y, h); } else return endBullet(a, 'hit', x, y, h);
        }
      }
      const ground = elev(x, y);
      const tree = world.treeHit?.(px, py, ph, x, y, h);
      if (tree) return endBullet(a, 'tree', tree.x, tree.y, tree.h);
      if (solidAt(world, ents, a, x, y, h)) return endBullet(a, 'prop', x, y, h);
      if (h <= ground && ground === 0 && inStream(x, y)) { events.push({type: 'arrow.splash', x, y, small: true}); return endBullet(a, 'water', x, y, ground); }
      if (h <= ground) return endBullet(a, 'ground', x, y, ground);
      px = x; py = y; ph = h;
    }
    a.x = ax + dx; a.y = ay + dy; a.h = ah + dh;
    if (a.life <= 0) endBullet(a, 'air', a.x, a.y, a.h);
  }
  // through a body (the hit chain said 'pierce'): weaker and slower from here (this step's path stays as it was), and
  // 'bullet.pierce' where its line leaves the body's hit circle (the exit wound)
  function pierce(a, p, x, y, h) {
    const P = a.pen; a.pn = (a.pn || 0) + 1; a.penK = (a.penK ?? 1) * P.dmg;
    const l = hypot2(a.vx, a.vy) || 1, ux = a.vx / l, uy = a.vy / l, r = p.hitR ?? .45;
    const cx = p.x - x, cy = p.y - y, along = cx * ux + cy * uy, out = Math.max(0, along + Math.sqrt(Math.max(0, r * r - (cx * cx + cy * cy - along * along))));
    events.push({type: 'bullet.pierce', x: x + ux * out, y: y + uy * out, h: h + a.vh / l * out, vx: ux, vy: uy, who: p, gun: a.gun});
    a.vx *= P.speed; a.vy *= P.speed; a.vh *= P.speed;
  }
  function solidAt(world, ents, a, x, y, h) {   // a wall, a crate, a solid prop at this point (as an arrow sticks in it)
    for (const p of ents.near(x, y, 0, nearS)) {
      if (p.broken || p.gone || (a.hitSet && a.hitSet.has(p)) || world.itemOf(p)?.pose) continue;
      if (!(p.rect ? x > p.rect[0] && x < p.rect[2] && y > p.rect[1] && y < p.rect[3] : p.r > .3 && hypot2(p.x - x, p.y - y) < p.r)) continue;
      if (h > (p.z || 0) && h < (p.z || 0) + (PROP_TOP[p.kind] ?? 2.5)) return true;
    }
    return false;
  }
  // gone: where it ended (x0..: where it was at this step's start, for the tracer's last streak), what it met
  function endBullet(a, surf, x, y, h) {
    a.x = x; a.y = y; a.h = h; a.life = -9;
    const l = hypot2(a.vx, a.vy) || 1;
    events.push({type: 'bullet.impact', x, y, h, x0: a.lx, y0: a.ly, h0: a.lh, surf, gun: a.gun, dx: a.vx / l, dy: a.vy / l});
  }
  function draw(host) {   // arrows as 3 world lines (the HD bow draws flying ones itself), dust, hit pops (bullets: view/gunfx.js)
    const opt = optOf();
    for (const a of arrows) {
      if (a.kind === 'bullet') continue;
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
  function lerpEnd() { for (const a of lerped) { a.x = a.cx; a.y = a.cy; a.h = a.ch; } lerped.length = 0; }
  return {arrows, pops, dust, spawn, step, draw, lerpBegin, lerpEnd, get hits() { return hits; }};
}
