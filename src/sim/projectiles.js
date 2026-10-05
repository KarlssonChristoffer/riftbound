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
// GLASS: a hit chain's 'pass' (features/trickshot.js: a bottle) lets an arrow or a bullet on unchanged (no pierce, no slowing).
// RICOCHETS (off unless the modifiers' note 'proj.ricochet' > 0: the trick-shot range turns them on while it stands in the
// sandbox, ?rico=1 everywhere, ?rico=0 never): a bullet that meets a metal or stone solid (content/materials.js; a desert
// wall is adobe and stops it) at a shallow angle glances off instead of stopping: its way along the face kept, RICO.keep of
// its way into the face turned back out of it, a small random turn from this module's own generator (a fixed seed: the
// sim replays), slower (RICO.speed) and weaker (penK x RICO.dmg: combat multiplies its hits by it), at most RICO.max
// times; the steeper it comes in, the likelier it stops (always at RICO[mat] deg). 'bullet.ricochet' says where.
// DEFLECTORS (features/bells.js: steel plates on posts, hanging bells; independent of the ricochets above, no note needed): a
// prop registered with setDeflector(p, shape) is met EXACTLY along a bullet's sub-step or an arrow's step (a segment against
// the plate's rectangle or the bell's sphere), before the hit chain and the solids, and ALWAYS glances off it: a mirror
// about the face's normal at the hit point (angle in = angle out), no random draw, slower and weaker by DEFLECT (a bullet's
// penK x dmg: combat multiplies its hits by it), at most DEFLECT.max a shot (the next one stops it on the steel).
// 'bullet.ricochet' (with defl: plate | bell, shot: the bullet) / 'arrow.deflect' say where.
// WIND: a run rule may push what flies (features/omens.js, a gale): host.mods 'proj.windX' / 'proj.windY' (m/s^2, world x / y,
// base 0) accelerate every arrow in flight; a bullet feels 'proj.windBullet' x of that (base 1). None: nothing changes.
// OWNS: arrows (a bullet's pn / penK and its muzzle ox / oy / oh too; a shot's defl count), pops, dust, the hit count, the
// deflector table (setDeflector: its writers' shapes). READS: the world (trees, elevation, stream), the
// entities (near: what an arrow hits or sticks in), features' arrow hooks, the mods' wind and ricochet notes, the props'
// materials (content/materials.js), ?rico (core/flags.js).
// EMITS: arrow.hit, arrow.splash, arrow.deflect, bullet.impact, bullet.pierce, bullet.ricochet (core/events.js). BUDGET: part of sim.
//   const proj = createProjectiles({world: () => world, ents: () => ents, features, events, opt: () => opt, toWorld, PPM, PPMH, mods})
//   proj.spawn(o) | proj.step(dt) | proj.draw(host) | proj.arrows / dust / hits
//   proj.lerpBegin(alpha) / lerpEnd(): drawn between sim steps (an arrow's lx / ly / lh: where it was at the step's start)
import {elev, inStream, PROP_TOP} from '../world/world.js';
import {rgbOf} from '../core/color.js';
import {clearArray, hypot2, hypot3} from '../core/mathx.js';
import {mulberry32} from '../core/rng.js';
import {PROP_MAT} from '../content/materials.js';
import {flags} from '../core/flags.js';

const ARROW = {shaft: rgbOf('#9a6c44'), head: rgbOf('#cfcbbf'), fletch: rgbOf('#efe4c8')};
const DUST = ['#b8a888', '#8a7a60', '#5e5444'].map(rgbOf), POP = rgbOf('#f2d27a');
// how far round an arrow to look for what it hits: any hitR (<= .55, a boss) plus a piercing arrow's step out of the
// prop it went through (combat core: up to 1.2 m along its flight) in the same pass
const REACH = 2;
const SUB = .3, REACH_B = .6;   // a bullet's sub-step (m) and how far round each to look (any hitR <= .55)
const DEG = Math.PI / 180;
// a ricochet: the steepest angle (deg, between its way and the face) it may glance off metal / stone at; x the speed into the
// face it keeps out of it; x its speed and its damage share per ricochet; a random turn (deg either way); ricochets a bullet
export const RICO = {metal: 24, stone: 14, keep: .3, speed: .7, dmg: .55, scatter: 3, max: 2};
const RICO_BASE = flags.get('rico') === '1' ? 1 : 0;   // (?rico=1: on everywhere; the note 'proj.ricochet' adds to it)
// a deflector (above): x a bullet's speed and damage share off a plate / a bell; x an arrow's speed; the most a shot glances off
export const DEFLECT = {plate: {speed: .92, dmg: .9}, bell: {speed: .86, dmg: .85}, arrow: .6, max: 6};
// the deflectors: prop -> its shape (world metres, h up), set by the prop's owner while the prop stands, null to take it out:
//   {kind: 'plate', x, y, h (its middle), nx, ny, nh (unit normal), ux, uy, uh / vx, vy, vh (unit, along / up its face), hw, hh (half sizes)}
//   {kind: 'bell', x, y, h, r}: a sphere. A plate's x, y (and a bell's) is its prop's, within .3 m of every point of it (a sub-step's near() reaches .6 m)
const DEFL = new Map();
export function setDeflector(p, shape) { if (shape) DEFL.set(p, shape); else DEFL.delete(p); }
const DH = {t: 2, nx: 0, ny: 0, nh: 0, p: null, s: null};   // the deflector hit found last (deflHit)
// the first deflector among cand that the segment (x0, y0, h0) -> (x1, y1, h1) meets from outside: DH, true; else false
function deflHit(cand, x0, y0, h0, x1, y1, h1) {
  const ex = x1 - x0, ey = y1 - y0, eh = h1 - h0;
  let best = 2;
  for (let i = 0; i < cand.length; i++) {
    const p = cand[i], s = DEFL.get(p); if (s === undefined || p.gone) continue;
    if (s.kind === 'plate') {
      const d0 = (x0 - s.x) * s.nx + (y0 - s.y) * s.ny + (h0 - s.h) * s.nh, d1 = (x1 - s.x) * s.nx + (y1 - s.y) * s.ny + (h1 - s.h) * s.nh;
      if (d0 === 0 || (d0 > 0 ? d1 > 0 : d1 < 0)) continue;   // (on one side all along, or starting on it)
      const t = d0 / (d0 - d1); if (!(t <= 1 && t < best)) continue;
      const qx = x0 + ex * t - s.x, qy = y0 + ey * t - s.y, qh = h0 + eh * t - s.h;
      if (Math.abs(qx * s.ux + qy * s.uy + qh * s.uh) > s.hw || Math.abs(qx * s.vx + qy * s.vy + qh * s.vh) > s.hh) continue;
      const sg = d0 > 0 ? 1 : -1;   // the face it came in on
      best = t; DH.nx = s.nx * sg; DH.ny = s.ny * sg; DH.nh = s.nh * sg; DH.p = p; DH.s = s;
    } else {
      const fx = x0 - s.x, fy = y0 - s.y, fh = h0 - s.h, A = ex * ex + ey * ey + eh * eh, B = 2 * (fx * ex + fy * ey + fh * eh), C = fx * fx + fy * fy + fh * fh - s.r * s.r;
      if (C <= 0 || A < 1e-12) continue;   // (it started inside)
      const D = B * B - 4 * A * C; if (D < 0) continue;
      const t = (-B - Math.sqrt(D)) / (2 * A); if (!(t >= 0 && t <= 1 && t < best)) continue;
      best = t; DH.nx = (fx + ex * t) / s.r; DH.ny = (fy + ey * t) / s.r; DH.nh = (fh + eh * t) / s.r; DH.p = p; DH.s = s;
    }
  }
  DH.t = best;
  return best <= 1;
}

export function createProjectiles({world: worldOf, ents: entsOf, features, events, opt: optOf, toWorld, PPM, PPMH, mods = null}) {
  const arrows = [], pops = [], dust = [], nearH = [], nearS = [];
  let hits = 0, WX = 0, WY = 0, WB = 1;   // the wind's push (m/s^2) and a bullet's share of it: the mods' notes, on change
  let RON = RICO_BASE;   // ricochets on (> 0): the note 'proj.ricochet' on ?rico's base (?rico=0: never)
  const rr = mulberry32(0x2f6b3c1d);   // the ricochets' draws (a fixed seed: no Math.random in the sim)
  const NO_RICO = flags.get('rico') === '0';
  const applyWind = () => {
    WX = mods.value('proj.windX', 0); WY = mods.value('proj.windY', 0); WB = mods.value('proj.windBullet', 1);
    RON = NO_RICO ? 0 : mods.value('proj.ricochet', RICO_BASE);
  };
  if (mods) { mods.watch(applyWind); applyWind(); }
  function spawn(o) {
    const a = {life: 1.6, vh: 0, kind: 'arrow', ...o};
    if (a.kind === 'bullet') { a.ox = a.x; a.oy = a.y; a.oh = a.h; }   // the muzzle it left (gunfx: its tracer never reaches back past it)
    for (const f of features) f.arrow?.(a); arrows.push(a);
  }
  function step(dt) {
    const world = worldOf(), ents = entsOf();
    for (const a of arrows) {
      a.lx = a.x; a.ly = a.y; a.lh = a.h;
      if (a.stuck) { a.life -= dt; continue; }
      if (a.kind === 'bullet') { stepBullet(a, dt, world, ents); continue; }
      if (WX || WY) { a.vx += WX * dt; a.vy += WY * dt; }
      a.x += a.vx * dt; a.y += a.vy * dt; a.h += a.vh * dt; a.vh -= .9 * dt; a.life -= dt;
      const cand = ents.near(a.x, a.y, REACH, nearH);
      if (DEFL.size && deflHit(cand, a.lx, a.ly, a.lh, a.x, a.y, a.h)) {   // a deflector on this step's way (features/bells.js): off it, on next step
        deflect(a, a.lx, a.ly, a.lh, a.x - a.lx, a.y - a.ly, a.h - a.lh);
        if (a.life > -9) { (a.trail ??= []).push([a.x, a.y, a.h]); if (a.trail.length > 7) a.trail.shift(); }
        continue;
      }
      (a.trail ??= []).push([a.x, a.y, a.h]); if (a.trail.length > 7) a.trail.shift();
      for (const p of cand) {
        if (p.broken || p.gone || !(p.target || p.hp > 0) || (a.hitSet && a.hitSet.has(p))) continue;
        const rel = a.h - (p.z || 0) - (p.h || 0);
        if (Math.hypot(p.x - a.x, p.y - a.y) < (p.hitR ?? .45) && rel > -.2 && rel < (p.hitH ?? 1.6)) {
          hits++; pops.push({x: p.x, y: p.y, z: (p.z || 0) + (p.h || 0), t: 0}); events.push({type: 'arrow.hit', x: p.x, y: p.y, vx: a.vx, vy: a.vy, prop: p});
          let r; for (const f of features) { r = f.onArrowHit?.(a, p); if (r) break; }
          if (r === 'pierce' || r === 'pass') (a.hitSet ??= new Set()).add(p); else { a.life = -9; break; }
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
    if (WX || WY) { a.vx += WX * WB * dt; a.vy += WY * WB * dt; }
    const ax = a.x, ay = a.y, ah = a.h;   // (a hit moves it to the hit point: one it goes through mustn't jump a step on)
    const dx = a.vx * dt, dy = a.vy * dt, dh = a.vh * dt, len = hypot3(dx, dy, dh) || 1;
    const x0 = a.x - dx / len * back, y0 = a.y - dy / len * back, h0 = a.h - dh / len * back;
    const ex = a.x + dx - x0, ey = a.y + dy - y0, eh = a.h + dh - h0, n = Math.max(1, Math.ceil((len + back) / SUB));
    let px = x0, py = y0, ph = h0;
    a.life -= dt;
    for (let i = 1; i <= n; i++) {
      const t = i / n, x = x0 + ex * t, y = y0 + ey * t, h = h0 + eh * t;
      const cand = ents.near(x, y, REACH_B, nearH);
      if (DEFL.size && deflHit(cand, px, py, ph, x, y, h)) { deflect(a, px, py, ph, x - px, y - py, h - ph); return; }   // (features/bells.js)
      for (const p of cand) {
        if (p.broken || p.gone || !(p.target || p.hp > 0) || (a.hitSet && a.hitSet.has(p))) continue;
        const rel = h - (p.z || 0) - (p.h || 0);
        if (hypot2(p.x - x, p.y - y) < (p.hitR ?? .45) && rel > -.2 && rel < (p.hitH ?? 1.6)) {
          a.x = x; a.y = y; a.h = h; hits++; pops.push({x: p.x, y: p.y, z: (p.z || 0) + (p.h || 0), t: 0});
          const k = a.push ?? 1;
          events.push({type: 'arrow.hit', x: p.x, y: p.y, vx: a.vx * k, vy: a.vy * k, prop: p, kind: 'bullet'});
          let r; for (const f of features) { r = f.onArrowHit?.(a, p); if (r) break; }
          if (r === 'pierce' || r === 'pass') { (a.hitSet ??= new Set()).add(p); if (a.pen && r === 'pierce') pierce(a, p, x, y, h); } else return endBullet(a, 'hit', x, y, h);
        }
      }
      const ground = elev(x, y);
      const tree = world.treeHit?.(px, py, ph, x, y, h);
      if (tree) return endBullet(a, 'tree', tree.x, tree.y, tree.h);
      const solid = solidAt(world, ents, a, x, y, h);
      if (solid) { if (RON > 0 && ricochet(a, solid, px, py, ph, x, y, h, world)) return; return endBullet(a, 'prop', x, y, h); }
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
  function solidAt(world, ents, a, x, y, h) {   // a wall, a crate, a solid prop at this point (as an arrow sticks in it), or null
    for (const p of ents.near(x, y, 0, nearS)) {
      if (p.broken || p.gone || (a.hitSet && a.hitSet.has(p)) || world.itemOf(p)?.pose) continue;
      if (!(p.rect ? x > p.rect[0] && x < p.rect[2] && y > p.rect[1] && y < p.rect[3] : p.r > .3 && hypot2(p.x - x, p.y - y) < p.r)) continue;
      if (h > (p.z || 0) && h < (p.z || 0) + (PROP_TOP[p.kind] ?? 2.5)) return p;
    }
    return null;
  }
  // a bullet meets solid p between (px, py, ph) (outside it) and (x, y, h) (inside): glance off (true) or not (false: it stops).
  // The face it came in through: a box's side or its top, a round solid's side; the point where it crossed it
  function ricochet(a, p, px, py, ph, x, y, h, world) {
    if ((a.rico || 0) >= RICO.max) return false;
    const mat = PROP_MAT[p.kind];
    if (mat !== 'metal' && (mat !== 'stone' || (world.biome?.id === 'desert' && p.kind.startsWith('wall')))) return false;   // (adobe stops it)
    const ex = x - px, ey = y - py, eh = h - ph, top = (p.z || 0) + (PROP_TOP[p.kind] ?? 2.5);
    let nx = 0, ny = 0, nh = 0, t = -1;
    if (ph >= top && eh < 0) { t = (top - ph) / eh; nh = 1; }   // down onto its top
    else if (p.rect) {   // the side crossed last is the one it came in through
      const R = p.rect, tx = px <= R[0] && ex > 0 ? (R[0] - px) / ex : px >= R[2] && ex < 0 ? (R[2] - px) / ex : -1;
      const ty = py <= R[1] && ey > 0 ? (R[1] - py) / ey : py >= R[3] && ey < 0 ? (R[3] - py) / ey : -1;
      if (tx < 0 && ty < 0) return false;   // (it started inside)
      if (tx >= ty) { t = tx; nx = px <= R[0] ? -1 : 1; } else { t = ty; ny = py <= R[1] ? -1 : 1; }
    } else {   // a round solid: where the path first meets its circle
      const fx = px - p.x, fy = py - p.y, A = ex * ex + ey * ey, B = 2 * (fx * ex + fy * ey), C = fx * fx + fy * fy - p.r * p.r, D = B * B - 4 * A * C;
      if (C <= 0 || D < 0 || A < 1e-9) return false;
      t = (-B - Math.sqrt(D)) / (2 * A);
      nx = (fx + ex * t) / p.r; ny = (fy + ey * t) / p.r;
    }
    if (!(t >= 0 && t <= 1)) return false;
    const v = hypot3(a.vx, a.vy, a.vh) || 1, ux = a.vx / v, uy = a.vy / v, uh = a.vh / v;
    const into = -(ux * nx + uy * ny + uh * nh), lim = Math.sin(RICO[mat] * DEG);   // into: the sine of the angle it meets the face at
    if (!(into > 0) || into >= lim) return false;
    const k = into / lim; if (rr() < k * k) return false;   // the steeper, the likelier it stops
    // along the face it keeps its way; out of the face, `keep` of what went into it; then a small random turn
    const kk = into * (1 + RICO.keep);
    let ox = ux + nx * kk, oy = uy + ny * kk, oh = uh + nh * kk;
    const s = RICO.scatter * DEG, ta = (rr() - rr()) * s, c = Math.cos(ta), sn = Math.sin(ta), qx = ox * c - oy * sn;
    oy = ox * sn + oy * c; ox = qx; oh += (rr() - rr()) * s * .5;
    const out = ox * nx + oy * ny + oh * nh;
    if (out < .03) { ox += nx * (.03 - out); oy += ny * (.03 - out); oh += nh * (.03 - out); }   // (it leaves the face)
    const l = hypot3(ox, oy, oh), sp = v * RICO.speed;
    a.vx = ox / l * sp; a.vy = oy / l * sp; a.vh = oh / l * sp;
    a.x = px + ex * t + nx * .02; a.y = py + ey * t + ny * .02; a.h = ph + eh * t + nh * .02;
    a.ox = a.x; a.oy = a.y; a.oh = a.h;   // its tracer starts again here (gunfx)
    a.rico = (a.rico || 0) + 1; a.penK = (a.penK ?? 1) * RICO.dmg;
    (a.hitSet ??= new Set()).add(p);   // (not this solid again: it glances on along it)
    events.push({type: 'bullet.ricochet', x: a.x, y: a.y, h: a.h, x0: a.lx, y0: a.ly, h0: a.lh, dx: ox / l, dy: oy / l, dh: oh / l, mat, gun: a.gun, n: a.rico, who: p});
    return true;
  }
  // off the deflector deflHit found (DH) on the way (x0, y0, h0) + t (ex, ey, eh): mirrored about its normal there, slower
  // (a bullet weaker too), set 2 cm off the face (the rest of the step is lost, as a ricochet's). After DEFLECT.max it stops
  function deflect(a, x0, y0, h0, ex, ey, eh) {
    const s = DH.s, p = DH.p, t = DH.t, n = a.defl || 0, bullet = a.kind === 'bullet';
    const hx = x0 + ex * t, hy = y0 + ey * t, hh = h0 + eh * t, nx = DH.nx, ny = DH.ny, nh = DH.nh;
    if (n >= DEFLECT.max) { if (bullet) endBullet(a, 'prop', hx, hy, hh); else { a.x = hx; a.y = hy; a.h = hh; a.life = -9; } return; }
    const vn = a.vx * nx + a.vy * ny + a.vh * nh, k = bullet ? DEFLECT[s.kind].speed : DEFLECT.arrow;
    if (vn < 0) { a.vx = (a.vx - 2 * vn * nx) * k; a.vy = (a.vy - 2 * vn * ny) * k; a.vh = (a.vh - 2 * vn * nh) * k; }
    a.x = hx + nx * .02; a.y = hy + ny * .02; a.h = hh + nh * .02;
    a.defl = n + 1;
    const v = hypot3(a.vx, a.vy, a.vh) || 1;
    if (bullet) {
      a.ox = a.x; a.oy = a.y; a.oh = a.h;   // its tracer starts again here (gunfx)
      a.penK = (a.penK ?? 1) * DEFLECT[s.kind].dmg;
      events.push({type: 'bullet.ricochet', x: a.x, y: a.y, h: a.h, x0: a.lx, y0: a.ly, h0: a.lh, dx: a.vx / v, dy: a.vy / v, dh: a.vh / v, mat: 'metal', gun: a.gun,
        n: (a.rico || 0) + a.defl, who: p, defl: s.kind, shot: a});
    } else events.push({type: 'arrow.deflect', x: a.x, y: a.y, h: a.h, dx: a.vx / v, dy: a.vy / v, dh: a.vh / v, v, n: a.defl, who: p, defl: s.kind, shot: a});
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
  function lerpEnd() { for (const a of lerped) { a.x = a.cx; a.y = a.cy; a.h = a.ch; } clearArray(lerped); }
  return {arrows, pops, dust, spawn, step, draw, lerpBegin, lerpEnd, get hits() { return hits; }};
}
