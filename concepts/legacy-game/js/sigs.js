// Signature spells: the two class-locked spells on left/right click (A / RT on a controller).
// They are never swapped out, only upgraded through Imbues: damage type, rank and up to three runes.
import {THREE, G, V, UP, TAU, rand, dist2, parts, fx, after, glow, add, glowSprite, takeLight, freeLight, flashLight, shockwave, ghost, bolt, C} from './core.js';
import {damage, explode, nearest, center, alive, applyElem, ELEM, cc} from './combat.js';
import {dplay} from './assets.js';

// ---------- runes (socketed into signature spells) ----------
export const RUNES = {
  split: {name: 'Split', kinds: ['projectile', 'charge', 'melee', 'beam'], text: k => k === 'melee' ? 'swings in a much wider arc' : k === 'beam' ? 'fires a wider beam' : 'fires 3 projectiles in a spread', apply: M => { M.count += 2; M.arc *= 1.5; }},
  pierce: {name: 'Piercing', kinds: ['projectile'], text: () => 'passes through every enemy', apply: M => { M.pierce = true; }},
  bounce: {name: 'Ricochet', kinds: ['projectile', 'charge'], text: () => 'bounces to 2 more enemies', apply: M => { M.bounce += 2; }},
  homing: {name: 'Seeking', kinds: ['projectile'], text: () => 'curves toward enemies', apply: M => { M.homing = true; }},
  wide: {name: 'Wide', kinds: ['projectile', 'charge', 'melee', 'beam', 'dash'], text: () => 'gets +40% area and reach', apply: M => { M.area *= 1.4; }},
  burst: {name: 'Detonate', kinds: ['projectile', 'charge', 'melee', 'beam', 'dash'], text: () => 'explodes on every 4th hit', apply: M => { M.burst = true; }},
  swift: {name: 'Swift', kinds: ['projectile', 'charge', 'melee', 'beam', 'dash'], text: () => 'gets +25% attack speed and -25% cooldown', apply: M => { M.rate *= 1.25; M.cdm *= .75; }},
  leech: {name: 'Leeching', kinds: ['projectile', 'charge', 'melee', 'beam', 'dash'], text: () => 'heals you for 3% of damage dealt', apply: M => { M.leech += .03; }},
};
export function sigMods(h, i) {
  const s = h.sig[i], M = {elem: s.elem, dmg: 1 + .2 * (s.rank - 1), rate: 1, cdm: 1, count: 1, arc: 1, pierce: false, bounce: 0, homing: false, area: 1, burst: false, leech: 0, rank: s.rank};
  for (const r of s.runes) RUNES[r].apply(M);
  if (s.elem === 'physical') M.dmg *= 1.2;
  return M;
}

// ---------- shared pieces ----------
function sigHit(h, i, e, base, M, dir, knock = 1.5) {
  const E = ELEM[M.elem], amt = damage(e, base * M.dmg * (i === 0 && h.empowered ? 2 : 1), {dir, knock, col: E.css, elem: M.elem, src: i === 0 ? 'basic' : 'core'});
  applyElem(e, M.elem, base * M.dmg); if (M.leech) h.heal(amt * M.leech);
  if (i === 0 && h.aug.static && Math.random() < .35) { const n = nearest(center(e), [e], 6); if (n) { bolt(center(e), center(n), .25); damage(n, base * M.dmg * .6, {col: '#bfe0ff'}); } }
  h.sigHits[i] = (h.sigHits[i] || 0) + 1;
  if (i === 0 && h.pas.heatsink) for (let k = 0; k < 4; k++) h.cds[k] = Math.max(0, h.cds[k] - .15);
  if (i === 0 && h.pas.crusader) { h.barrier = Math.min(h.maxHp * .2, (h.barrier || 0) + h.maxHp * .02); h.barrierT = 4; }
  if (M.burst && h.sigHits[i] % 4 === 0) {
    const p = e.g.position.clone();
    explode(p, {cols: [E.pc, C.white], n: 40, speed: 5, col: E.col, R: 2.2 * M.area, light: 40, b: 3, shake: .08, dmg: base * M.dmg * .8, hitR: 2 * M.area, knock: 3, dmgCol: E.css, elem: M.elem});
  }
}
const aimDir = (h, aim) => { const d = V(aim.x - h.g.position.x, 0, aim.z - h.g.position.z); if (d.lengthSq() < .01) d.set(Math.sin(h.g.rotation.y), 0, Math.cos(h.g.rotation.y)); return d.normalize(); };
function projectiles(h, i, from, dir, M, o) {
  const n = M.count; for (let k = 0; k < n; k++) shot(h, i, from.clone(), dir.clone().applyAxisAngle(UP, (k - (n - 1) / 2) * .2), M, o);
}
function shot(h, i, pos, dir, M, o) {
  const E = ELEM[M.elem], s = glowSprite(E.col, 4, o.size); s.position.copy(pos); G.scene.add(s);
  let travelled = 0, bounces = M.bounce; const hit = new Set(), pierce = M.pierce || o.pierce;
  fx(3, (k, dt) => {
    if (M.homing) { const tg = nearest(s.position, [...hit], 8); if (tg) { const want = center(tg).sub(s.position).setY(0).normalize(); dir.lerp(want, Math.min(1, dt * 6)).normalize(); } }
    const step = o.speed * dt; s.position.addScaledVector(dir, step); travelled += step;
    for (let q = 0; q < 2; q++) parts.emit(s.position.x, s.position.y, s.position.z, rand(-.3, .3), rand(-.3, .3), rand(-.3, .3), E.pc, 3, .25, o.size * .3);
    if (travelled > o.range || !G.map.walkable(s.position.x, s.position.z)) return true;
    for (const e of G.enemies) {
      if (!alive(e) || hit.has(e) || dist2(e.g.position, s.position) > e.radius + .35) continue;
      hit.add(e); sigHit(h, i, e, o.dmg, M, dir, o.knock); parts.burst(s.position, 10, {col: E.pc, b: 4, speed: 3, life: .3, size: .18});
      if (bounces > 0) { const n2 = nearest(s.position, [...hit], 7); if (n2) { bounces--; dir.copy(center(n2).sub(s.position).setY(0).normalize()); travelled = 0; return; } }
      if (!pierce) return true;
    }
  }, () => { G.scene.remove(s); s.material.dispose(); });
}
function meleeArc(h, i, dir, range, arcDeg, dmg, M, knock, width = 1) {
  const E = ELEM[M.elem], p = h.g.position, R = range * M.area, half = Math.min(Math.PI, arcDeg * M.arc / 2 * Math.PI / 180);
  const phi = Math.atan2(-dir.z, dir.x), m = glow(E.col, 3, {add: true, ds: true});
  const mesh = new THREE.Mesh(new THREE.RingGeometry(R * (1 - .35 * width), R, 28, 1, phi - half, half * 2), m);
  mesh.rotation.x = -Math.PI / 2; mesh.position.set(p.x, .9, p.z); G.scene.add(mesh);
  fx(.2, k => { m.opacity = 1 - k; mesh.scale.setScalar(.85 + k * .2); }, () => { G.scene.remove(mesh); m.dispose(); mesh.geometry.dispose(); });
  for (const e of G.enemies) {
    if (!alive(e)) continue; const d = V(e.g.position.x - p.x, 0, e.g.position.z - p.z), L = d.length();
    if (L > R + e.radius) continue; if (L > .6 && d.normalize().dot(dir) < Math.cos(half)) continue;
    sigHit(h, i, e, dmg, M, d, knock); parts.burst(center(e), 10, {col: E.pc, b: 4, speed: 4, life: .3, size: .18});
  }
}
function walkTo(h, dir, maxD) {
  const p = h.g.position.clone(); let d = 0;
  while (d < maxD) { const n = p.clone().addScaledVector(dir, .3); if (!G.map.walkableCircle(n.x, n.z, .35)) break; p.copy(n); d += .3; }
  return p;
}

// ---------- the eight signature spells ----------
// kind: projectile | melee | beam | charge | dash. Primaries use `rate` (attacks per second), secondaries `cd`.
export const SIGS = {
  firebolt: {name: 'Firebolt', slot: 0, kind: 'projectile', elem: 'fire', icon: 'flame', rate: 2.3, range: 13, anim: ['cast1', 2.8],
    desc: 'A fast bolt of flame.',
    fire(h, i, aim, M) { const dir = aimDir(h, aim); after(.08, () => projectiles(h, i, h.from(), dir, M, {speed: 22, dmg: 15, size: .7, range: 15})); }},
  quickshot: {name: 'Quick Shot', slot: 0, kind: 'projectile', elem: 'physical', icon: 'arrow-narrow-right', rate: 2.6, range: 14, anim: ['bow', 3.2],
    desc: 'A fast, precise arrow.',
    fire(h, i, aim, M) { const dir = aimDir(h, aim); after(.08, () => projectiles(h, i, h.from(), dir, M, {speed: 30, dmg: 14, size: .5, range: 16})); }},
  frostcleave: {name: 'Frost Cleave', slot: 0, kind: 'melee', elem: 'frost', icon: 'sword', rate: 1.7, range: 2.6, anim: ['slash', 2.4],
    desc: 'A wide sword swing that hits everything in front of you.',
    fire(h, i, aim, M) { const dir = aimDir(h, aim); after(.12, () => meleeArc(h, i, dir, 2.6, 120, 21, M, 2.5)); }},
  voidslash: {name: 'Void Slash', slot: 0, kind: 'melee', elem: 'void', icon: 'slice', rate: 2.6, range: 2.3, anim: ['dagger', 3],
    desc: 'A three-hit dagger combo; the third hit is a wide, heavy spin.',
    fire(h, i, aim, M) {
      const dir = aimDir(h, aim); if (G.time - (h.comboT || 0) > 1.1) h.combo = 0; h.combo = (h.combo || 0) % 3 + 1; h.comboT = G.time; const third = h.combo === 3;
      const tf = third && h.pas.twinfangs; after(.1, () => meleeArc(h, i, dir, third ? 2.8 : 2.3, third ? 220 : 90, (third ? 30 : 13) * (tf ? 2 : 1), M, third ? 4 : 1, third ? 1.4 : .8));
    }},
  incinerate: {name: 'Incinerate', slot: 1, kind: 'beam', elem: 'fire', icon: 'flame', cd: 2.5, anim: ['cast2', .8],
    desc: 'Hold to pour a beam of flame. Moving slows you while you channel.',
    channel: {max: 2.6,
      start(h, aim, M, st) { st.m = glow(ELEM[M.elem].col, 3, {add: true}); st.m.opacity = .85; st.beam = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), st.m); G.scene.add(st.beam); st.L = takeLight(ELEM[M.elem].col, 30, 8); st.tt = 0; },
      tick(h, i, aim, dt, M, st) {
        const E = ELEM[M.elem], from = h.from(), dir = aimDir(h, aim); let len = 0; const maxL = 8.5 * M.area;
        while (len < maxL && G.map.walkable(from.x + dir.x * len, from.z + dir.z * len)) len += .25;
        const to = from.clone().addScaledVector(dir, len), w = .22 * M.arc * (1 + Math.sin(G.time * 40) * .15);
        st.beam.position.copy(from).lerp(to, .5); st.beam.quaternion.setFromUnitVectors(UP, dir); st.beam.scale.set(w, len, w); st.L.position.copy(to);
        for (let q = 0; q < 6; q++) { const t = Math.random() * len; parts.emit(from.x + dir.x * t, from.y + rand(-.15, .15), from.z + dir.z * t, rand(-.8, .8), rand(0, 1.5), rand(-.8, .8), q % 2 ? E.pc : C.gold, 4, .35, .25, -1, 2); }
        st.tt -= dt; if (st.tt > 0) return; st.tt = .15;
        for (const e of G.enemies) {
          if (!alive(e)) continue; const rel = V(e.g.position.x - from.x, 0, e.g.position.z - from.z), along = rel.dot(dir);
          if (along < 0 || along > len + e.radius) continue; const off = rel.addScaledVector(dir, -along).length();
          if (off < .7 * M.arc + e.radius) sigHit(h, i, e, 8, M, dir, .4);
        }
      },
      end(h, st) { G.scene.remove(st.beam); st.m.dispose(); st.beam.geometry.dispose(); freeLight(st.L); },
    }},
  chargedshot: {name: 'Charged Shot', slot: 1, kind: 'charge', elem: 'storm', icon: 'target-arrow', cd: 1.2, anim: ['bow', 1],
    desc: 'Hold to draw, release to fire a piercing arrow. Full charge hits very hard.',
    charge: {max: 1.1,
      start(h, aim, M, st) { st.s = glowSprite(ELEM[M.elem].col, 3, .3); G.scene.add(st.s); },
      tick(h, i, aim, dt, M, st, c) { st.s.position.copy(h.from()); st.s.scale.setScalar(.3 + c * 1.1); if (Math.random() < .5) { const p = st.s.position; parts.emit(p.x + rand(-.6, .6), p.y + rand(-.6, .6), p.z + rand(-.6, .6), 0, 0, 0, ELEM[M.elem].pc, 3, .3, .15, 0, 0); } },
      release(h, i, aim, c, M, st) {
        G.scene.remove(st.s); st.s.material.dispose(); dplay(h.drv, 'bow', true, 3.5);
        const dir = aimDir(h, aim); projectiles(h, i, h.from(), dir, M, {speed: 34, dmg: 25 + 90 * c, size: .6 + c * .8, range: 20, knock: 3 + 6 * c, pierce: true});
        if (c > .95) { G.shake = Math.max(G.shake, .15); flashLight(h.from(), ELEM[M.elem].col, 60, .25, 6); }
      },
    }},
  shieldbash: {name: 'Shield Bash', slot: 1, kind: 'dash', elem: 'frost', icon: 'shield', cd: 3, anim: ['shieldatk', 1.8],
    desc: 'Lunge behind your shield, stunning what you hit. You take 70% less damage for a second.',
    press(h, i, aim, M) {
      const dir = aimDir(h, aim), A = h.g.position.clone(), B = walkTo(h, dir, 3 * M.area); h.lock = .16; h.guard = 1; h.face(A.clone().add(dir));
      fx(.16, k => { h.g.position.lerpVectors(A, B, 1 - (1 - k) * (1 - k)); }, () => {
        meleeArc(h, i, dir, 2.4, 110, 32, M, 8); for (const e of G.enemies) if (alive(e) && dist2(e.g.position, h.g.position) < 2.6 * M.area + e.radius) cc(e, 'stun', .9);
        shockwave(h.g.position.clone().addScaledVector(dir, 1), ELEM[M.elem].col, 2 * M.area, .3, 3); G.shake = Math.max(G.shake, .15);
      });
    }},
  shadowstep: {name: 'Shadow Step', slot: 1, kind: 'dash', elem: 'void', icon: 'ghost', cd: 4, anim: ['dagger', 2],
    desc: 'Blink toward the cursor. The shadow you leave behind explodes.',
    press(h, i, aim, M) {
      const A = h.g.position.clone(), d = V(aim.x - A.x, 0, aim.z - A.z), L = Math.min(6.5, d.length()); const B = walkTo(h, d.normalize(), L);
      ghost(h.g, ELEM[M.elem].col, .8, .7); h.invuln = .35;
      for (let q = 0; q < 30; q++) { const p = A.clone().lerp(B, q / 30); parts.emit(p.x, 1, p.z, rand(-.2, .2), rand(-.2, .2), rand(-.2, .2), ELEM[M.elem].pc, 3, .5, .2); }
      h.g.position.copy(B); h.vel && h.vel.set(0, 0, 0); h.path = [];
      after(.7, () => {
        const E = ELEM[M.elem]; explode(A, {cols: [E.pc, C.white], n: 70, speed: 6, col: E.col, R: 2.6 * M.area, light: 70, b: 3, shake: .15, dmg: 0});
        for (const e of G.enemies) if (alive(e) && dist2(e.g.position, A) < 2.4 * M.area + e.radius) sigHit(h, i, e, 30, M, V(e.g.position.x - A.x, 0, e.g.position.z - A.z), 4);
      });
    }},
};
export const CLASS_SIGS = {pyromancer: ['firebolt', 'incinerate'], warden: ['frostcleave', 'shieldbash'], ranger: ['quickshot', 'chargedshot'], voidblade: ['voidslash', 'shadowstep']};
