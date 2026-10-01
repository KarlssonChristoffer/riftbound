// Skill registry. Every skill is data (tags, element, cooldown) plus a cast(hero, aim, mods) function.
// mods: {dmg, area, echo} from mutations; aim is the ground point under the cursor.
import {THREE, SkeletonUtils, G, V, UP, TAU, rand, clamp, dist2, parts, fx, after, glow, add, glowSprite, takeLight, freeLight, flashLight, shockwave, scorch, marker, ghost, bolt, C} from './core.js';
import {damage, explode, projectile, nearest, inRadius, center, alive, applyElem, cc, addStagger, isUnstoppable} from './combat.js';
import {addHazard} from './entities.js';
import {CS} from './map.js';

const clampAim = (h, aim, max) => { const p = h.g.position, d = V(aim.x - p.x, 0, aim.z - p.z); if (d.length() > max) d.setLength(max); return V(p.x + d.x, 0, p.z + d.z); };
const nearAim = (aim, r) => nearest(aim, [], r);
function walkTo(h, dir, maxD) { // furthest walkable point along dir
  const p = h.g.position.clone(); let d = 0;
  while (d < maxD) { const n = p.clone().addScaledVector(dir, .3); if (!G.map.walkableCircle(n.x, n.z, .35)) break; p.copy(n); d += .3; }
  return p;
}

export const SKILLS = {
  // ---------- fire ----------
  fireball: {name: 'Fireball', elem: 'fire', tags: ['projectile', 'area'], cd: 1.4, icon: 'flame', color: '#ff7a2f', anim: ['cast1', 1.7],
    desc: 'Homing fireball that explodes and sets enemies alight.',
    cast(h, aim, M) {
      after(.15, () => projectile({from: h.from(), to: V(aim.x, 1, aim.z), enemy: nearAim(aim, 3), speed: 16, size: 1.1, col: 0xff7a2a, k: 5, li: 40, range: 18, hitAny: true,
        trail: p => { for (let i = 0; i < 6; i++) parts.emit(p.x + rand(-.12, .12), p.y + rand(-.12, .12), p.z + rand(-.12, .12), rand(-.5, .5), rand(0, 1), rand(-.5, .5), i % 3 ? C.fire : C.gold, rand(3, 5), rand(.25, .5), rand(.2, .35), -1, 2); },
        onHit: P => explode(P, {elem: M && M.elem, cols: [C.fire, C.gold, C.ember], n: 90, speed: 7, col: 0xff7a2a, R: 2.4 * M.area, light: 110, shake: .12, scorch: 1.6, dmg: 40 * M.dmg, hitR: 1.9 * M.area, knock: 4, dmgCol: '#ffa048', onHit: e => { e.burn = 2.5; e.burnT = .5; }})}));
    }},
  meteor: {name: 'Meteor', elem: 'fire', tags: ['area'], cd: 6, icon: 'meteor', color: '#ff4a2a', anim: ['area', 1.3],
    desc: 'Calls a meteor down on the target area after a short delay.',
    cast(h, aim, M) {
      const P = clampAim(h, aim, 12), R = 3.3 * M.area; marker(P, R, 0xff4020, 1.1);
      const S = P.clone().add(V(-6, 16, -5)); const rock = add(G.scene, new THREE.DodecahedronGeometry(.75, 0), new THREE.MeshStandardMaterial({color: 0x3a2a22, emissive: 0xff5a1a, emissiveIntensity: 2, flatShading: true}), S.x, S.y, S.z);
      const sp = glowSprite(0xff7a2a, 6, 4); G.scene.add(sp); const L = takeLight(0xff7a30, 0, 16);
      fx(1.05, k => {
        rock.position.lerpVectors(S, P, k * k * k); rock.rotation.x += .25; sp.position.copy(rock.position); L.position.copy(rock.position); L.intensity = 90 * k;
        for (let i = 0; i < 12; i++) parts.emit(rock.position.x + rand(-.5, .5), rock.position.y + rand(-.5, .5), rock.position.z + rand(-.5, .5), rand(-1, 1), rand(-.5, 1.5), rand(-1, 1), i % 3 ? C.fire : C.gold, rand(3, 6), rand(.4, 1), rand(.35, .7), -.5, 1);
      }, () => {
        G.scene.remove(rock, sp); sp.material.dispose(); freeLight(L);
        explode(P, {elem: M && M.elem, cols: [C.fire, C.gold, C.ember, C.white], n: 240, speed: 12, col: 0xff6a20, R: R * 1.4, R2: R, light: 240, shake: .55, scorch: R, dmg: 90 * M.dmg, hitR: R, knock: 9, dmgCol: '#ffa048', size: .45, life: .9});
      });
    }},
  nova: {name: 'Blazing Nova', elem: 'fire', tags: ['area'], cd: 5, icon: 'sun', color: '#ffb347', anim: ['area', 1.7],
    desc: 'A ring of fire bursts outward from you, knocking enemies back and burning them.',
    cast(h, aim, M) {
      const P = h.g.position.clone(), Rm = 5.2 * M.area, hit = new Set();
      shockwave(P, 0xff6a20, Rm, .55, 5); flashLight(V(P.x, 1, P.z), 0xff7a30, 140, .6, 12); G.shake = Math.max(G.shake, .2);
      fx(.55, k => {
        const r = .5 + (Rm - .5) * (1 - Math.pow(1 - k, 2));
        for (let i = 0; i < 36; i++) { const a = rand(0, TAU); parts.emit(P.x + Math.cos(a) * r, .15, P.z + Math.sin(a) * r, Math.cos(a) * 1.5, rand(1.5, 4), Math.sin(a) * 1.5, i % 2 ? C.fire : C.gold, rand(3, 6), rand(.35, .7), rand(.25, .5), -1, 1.5); }
        for (const e of G.enemies) { if (!alive(e) || hit.has(e)) continue; const d = V(e.g.position.x - P.x, 0, e.g.position.z - P.z); if (d.length() < r) { hit.add(e); damage(e, 32 * M.dmg, {elem: M && M.elem, dir: d, knock: 8, col: '#ffa048'}); e.burn = 3; e.burnT = .4; } }
      });
    }},
  // ---------- frost ----------
  charge: {name: 'Shield Charge', elem: 'frost', tags: ['dash', 'melee'], cd: 4, icon: 'shield', color: '#7fd0ff', anim: ['shieldatk', 1.6],
    desc: 'Dash toward the cursor behind your shield, slamming into everything in the way. Frozen enemies you hit shatter for triple damage.',
    cast(h, aim, M) {
      const A = h.g.position.clone(), dir = V(aim.x - A.x, 0, aim.z - A.z).normalize(), B = walkTo(h, dir, 7), hit = new Set(); let gt = 0;
      h.lock = .3; h.invuln = .3; h.face(aim);
      fx(.22, (k, dt) => {
        h.g.position.lerpVectors(A, B, 1 - Math.pow(1 - k, 2)); gt -= dt; if (gt <= 0) { gt = .035; ghost(h.g, 0x7fd4ff, .35); }
        const p = h.g.position; for (let i = 0; i < 5; i++) parts.emit(p.x + rand(-.3, .3), .1, p.z + rand(-.3, .3), rand(-.5, .5), rand(.5, 1.5), rand(-.5, .5), i % 2 ? C.ice : C.white, 2.5, .6, .2, 2, 1);
        for (const e of G.enemies) if (alive(e) && !hit.has(e) && dist2(e.g.position, p) < 1.3 + e.radius) { hit.add(e); const shat = e.frozen > 0; damage(e, 45 * M.dmg * (shat ? 3 : 1), {elem: M && M.elem, dir, knock: 9, col: '#9fe4ff', crit: shat || undefined}); if (shat) { explode(e.g.position.clone(), {elem: 'frost', cols: [C.ice, C.white], n: 70, speed: 7, col: 0xbfe8ff, R: 3, light: 60, b: 2.5, shake: .3, dmg: 30 * M.dmg, hitR: 2.5, knock: 5, dmgCol: '#9fe4ff'}); G.toast && G.toast('Shatter!'); } cc(e, 'freeze', .8); }
      }, () => { const P = h.g.position.clone().addScaledVector(dir, .8); explode(P, {elem: M && M.elem, cols: [C.ice, C.white], n: 70, speed: 6, col: 0x8fdcff, R: 2.4 * M.area, light: 50, shake: .25, b: 2.5, dmg: 20 * M.dmg, hitR: 1.8 * M.area, knock: 4, dmgCol: '#9fe4ff'}); });
    }},
  slam: {name: 'Glacial Slam', elem: 'frost', tags: ['area', 'melee'], cd: 7, icon: 'snowflake', color: '#a8e6ff', anim: ['jump', 1.3],
    desc: 'Leap and slam down. Rings of ice spikes erupt and freeze everything they catch.',
    cast(h, aim, M) {
      h.lock = .6; const R = 5.2 * M.area;
      fx(.5, k => { h.lift = k < .6 ? Math.sin(k / .6 * Math.PI / 2) * 1.6 : 1.6 * (1 - Math.pow((k - .6) / .4, 2)); }, () => {
        h.lift = 0; const P = h.g.position.clone().setY(0);
        shockwave(P, 0x8fdcff, R * 1.25, .6, 2.5); flashLight(V(P.x, 1, P.z), 0x9fe4ff, 70, .5, 10); G.shake = Math.max(G.shake, .5);
        parts.burst(V(P.x, .2, P.z), 110, {cols: [C.ice, C.white, C.snow], b: 1.6, speed: 8, life: .9, size: .3, grav: 7, drag: 1.5, up: 3.5, flat: true});
        const sg = new THREE.ConeGeometry(.24, 1.7, 5); sg.translate(0, .85, 0); const im = new THREE.MeshStandardMaterial({color: 0xbfe8ff, roughness: .1, emissive: 0x3a9cff, emissiveIntensity: 1, flatShading: true});
        for (let ring = 0; ring < 3; ring++) { const n = 9 + ring * 6, r = (1.4 + ring * 1.4) * M.area; for (let i = 0; i < n; i++) { const a = i / n * TAU + ring * .3; after(ring * .09 + rand(0, .03), () => {
          const x = P.x + Math.cos(a) * r * rand(.9, 1.1), z = P.z + Math.sin(a) * r * rand(.9, 1.1), hh = rand(.7, 1.5) * (1 - ring * .15);
          if (!G.map.walkable(x, z)) return; const m = add(G.scene, sg, im, x, 0, z, {rx: Math.sin(a) * .35, rz: -Math.cos(a) * .35}); m.scale.set(1, .001, 1);
          fx(1.4, k => { const s = k < .1 ? k / .1 : k > .75 ? 1 - (k - .75) / .25 : 1; m.scale.set(1, Math.max(.001, s) * hh, 1); }, () => G.scene.remove(m)); }); } }
        for (const e of inRadius(P, R)) { damage(e, 55 * M.dmg, {elem: M && M.elem, dir: V(e.g.position.x - P.x, 0, e.g.position.z - P.z), knock: 3, col: '#9fe4ff'}); cc(e, 'freeze', 2.4); }
      });
    }},
  moonfall: {name: 'Moonfall', elem: 'frost', tags: ['area'], cd: 8, icon: 'sword', color: '#dff1ff', anim: ['cast2', 1.4],
    desc: 'A giant blade of moonlight falls on the target point.',
    cast(h, aim, M) {
      const tgt = nearAim(aim, 3), P = tgt ? tgt.g.position.clone().setY(0) : clampAim(h, aim, 12), R = 2.8 * M.area;
      const m = glow(0xcfe8ff, 4, {add: true}); m.opacity = .95; const blade = new THREE.Group();
      add(blade, new THREE.BoxGeometry(.55, 5, .12), m, 0, 2.5, 0); add(blade, new THREE.ConeGeometry(.39, .9, 4), m, 0, -.45, 0, {rx: Math.PI, ry: Math.PI / 4});
      add(blade, new THREE.BoxGeometry(2.1, .26, .3), m, 0, 5.1, 0); add(blade, new THREE.BoxGeometry(.2, 1, .2), m, 0, 5.7, 0);
      blade.position.set(P.x, 20, P.z); blade.rotation.y = rand(0, TAU); G.scene.add(blade); marker(P, R, 0x9fd0ff, .7);
      fx(.65, k => { blade.position.y = 20 - 19.8 * k * k * k; }, () => {
        explode(P, {elem: M && M.elem, cols: [C.white, C.ice], n: 150, speed: 10, col: 0xbfe4ff, R: R * 1.7, R2: R * 1.1, light: 90, b: 2.5, shake: .45, size: .4});
        for (const e of inRadius(P, R)) damage(e, (dist2(e.g.position, P) < 1.2 ? 115 : 50) * M.dmg, {elem: M && M.elem, dir: V(e.g.position.x - P.x, 0, e.g.position.z - P.z), knock: 5, col: '#dff1ff'});
        fx(.9, k => { m.opacity = .95 * (1 - k * k); blade.position.y = .2 - k * 1.4; }, () => { G.scene.remove(blade); m.dispose(); });
      });
    }},
  // ---------- nature / storm ----------
  pierce: {name: 'Piercing Shot', elem: 'storm', tags: ['projectile'], cd: 1.1, icon: 'arrow-right', color: '#9aff6a', anim: ['bow', 1.9],
    desc: 'A wind-charged arrow that passes through every enemy in a line.',
    cast(h, aim, M) {
      after(.15, () => {
        const from = h.from(); from.y = 1.1; const dir = V(aim.x - from.x, 0, aim.z - from.z).normalize(); const ar = arrow(true); ar.position.copy(from); ar.lookAt(from.clone().add(dir)); G.scene.add(ar); const hit = new Set();
        fx(.6, (k, dt) => {
          ar.position.addScaledVector(dir, 30 * dt); const p = ar.position; if (!G.map.walkable(p.x, p.z)) return true;
          for (let i = 0; i < 3; i++) { const a = rand(0, TAU); parts.emit(p.x + Math.cos(a) * .15, p.y + Math.sin(a) * .15, p.z, Math.cos(a) * .6, Math.sin(a) * .6, 0, i % 2 ? C.green : C.white, 2.5, .4, .18, 0, 2); }
          for (const e of G.enemies) if (alive(e) && !hit.has(e) && dist2(e.g.position, p) < .7 + e.radius) { hit.add(e); damage(e, 42 * M.dmg, {elem: M && M.elem, dir, knock: 5, col: '#c8ff9a'}); parts.burst(p, 26, {cols: [C.green, C.white], b: 4, speed: 5, life: .4, size: .2}); }
        }, () => G.scene.remove(ar));
      });
    }},
  storm: {name: 'Arrow Storm', elem: 'storm', tags: ['area', 'projectile'], cd: 6, icon: 'cloud-rain', color: '#d6ff8a', anim: ['bow', 1.6],
    desc: 'Thirty arrows rain down on the target area.',
    cast(h, aim, M) {
      const P = clampAim(h, aim, 13), R = 2.9 * M.area; marker(P, R, 0x9aff6a, 1.7);
      for (let i = 0; i < 30; i++) after(.4 + i * .03, () => {
        const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R, T = V(P.x + Math.cos(a) * r, 0, P.z + Math.sin(a) * r), S = T.clone().add(V(-1.4, 12, -.9));
        const ar = arrow(false); ar.position.copy(S); ar.lookAt(T); G.scene.add(ar);
        fx(.3, k => { ar.position.lerpVectors(S, T, k); }, () => {
          ar.position.copy(T).addScaledVector(S.clone().sub(T).normalize(), .3); parts.burst(V(T.x, .15, T.z), 6, {col: C.leaf, b: 2, speed: 2.5, life: .4, size: .2, grav: 4, up: 1});
          for (const e of G.enemies) if (alive(e) && dist2(e.g.position, T) < .9 + e.radius) damage(e, 14 * M.dmg, {elem: M && M.elem, dir: V(e.g.position.x - T.x, 0, e.g.position.z - T.z), knock: 1, col: '#d6ff8a'});
          after(1.4, () => G.scene.remove(ar));
        });
      });
    }},
  chain: {name: 'Chain Lightning', elem: 'storm', tags: ['projectile'], cd: 3, icon: 'bolt', color: '#8fc8ff', anim: ['cast2', 1.5],
    desc: 'A bolt that jumps between up to six enemies, stunning each one.',
    cast(h, aim, M) {
      let cur = nearAim(aim, 4) || nearest(h.g.position, [], 11); if (!cur) return; const hitList = []; let from = null, dmg = 46 * M.dmg;
      const hop = i => {
        if (!cur || i > 5) return; hitList.push(cur); const to = center(cur);
        bolt(from || h.from(), to.clone(), .35); flashLight(to, 0x9fd0ff, 90, .3, 7); parts.burst(to, 30, {cols: [C.bolt, C.white], b: 7, speed: 6, life: .35, size: .18});
        damage(cur, dmg, {elem: M && M.elem, col: '#bfe0ff'}); cc(cur, 'stun', .35); dmg *= .88; from = to; cur = nearest(to, hitList, 7 * M.area); after(.1, () => hop(i + 1));
      };
      after(.12, () => hop(0));
    }},
  // ---------- void ----------
  blink: {name: 'Blink Strike', elem: 'void', tags: ['dash', 'melee'], cd: 2.5, icon: 'ghost', color: '#c070ff', anim: ['dagger', 1.6],
    desc: 'Teleport behind the enemy nearest the cursor and cut through it. Detonates Death Mark and resets its own cooldown.',
    cast(h, aim, M) {
      const e = nearAim(aim, 4); const A = h.g.position.clone();
      let B; if (e) { const dir = V(e.g.position.x - A.x, 0, e.g.position.z - A.z).normalize(); B = e.g.position.clone().setY(0).addScaledVector(dir, 1.3); } else B = clampAim(h, aim, 7);
      if (!G.map.walkableCircle(B.x, B.z, .35)) B = walkTo(h, V(B.x - A.x, 0, B.z - A.z).normalize(), dist2(A, B));
      ghost(h.g, 0xb070ff, .5, .6); h.invuln = .3;
      for (let i = 0; i < 40; i++) { const p = A.clone().lerp(B, i / 40); parts.emit(p.x, 1, p.z, rand(-.2, .2), rand(-.2, .2), rand(-.2, .2), C.void, 3, .5, .2); }
      h.g.position.copy(B); if (e) h.face(e.g.position); h.path = [];
      parts.burst(V(B.x, 1, B.z), 50, {cols: [C.void, C.pink], b: 5, speed: 5, life: .45, size: .25});
      if (e) after(.07, () => { if (!alive(e)) return; const c = center(e); damage(e, 62 * M.dmg, {elem: M && M.elem, dir: V(e.g.position.x - B.x, 0, e.g.position.z - B.z), knock: 4, col: '#e0b0ff'}); if (e.markSprite) { detonateMark(e); const bs = h.skills.indexOf('blink'); if (bs >= 0) h.cds[bs] = 0; } parts.burst(c, 40, {cols: [C.void, C.white], b: 5, speed: 6, life: .4, size: .2}); flashLight(c, 0xc070ff, 90, .35, 7); G.shake = Math.max(G.shake, .2); });
    }},
  singularity: {name: 'Singularity', elem: 'void', tags: ['area', 'projectile'], cd: 8, icon: 'circle-dot', color: '#9a50ff', anim: ['cast1', 1.5],
    desc: 'Opens a black hole that drags enemies in, then collapses violently.',
    cast(h, aim, M) {
      const P = clampAim(h, aim, 12).setY(1.2), R = 3 * M.area;
      projectile({from: h.from(), to: P, speed: 13, size: .9, col: 0xb070ff, k: 5, trail: p => { for (let i = 0; i < 3; i++) parts.emit(p.x, p.y, p.z, rand(-.4, .4), rand(-.4, .4), rand(-.4, .4), i % 2 ? C.void : C.pink, 4, .4, .2); },
        onHit: Q => {
          const P2 = V(Q.x, 1.2, Q.z); const core = add(G.scene, new THREE.SphereGeometry(.5, 24, 16), new THREE.MeshBasicMaterial({color: 0x000000}), P2.x, P2.y, P2.z);
          const rm = glow(0xe080ff, 5, {add: true}); const ring = add(G.scene, new THREE.TorusGeometry(.85, .06, 8, 48), rm, P2.x, P2.y, P2.z, {rx: Math.PI / 2.4});
          const L = takeLight(0xa050ff, 60, 12); L.position.copy(P2); parts.attr = P2; parts.attrK = 34; let tick = 0;
          fx(2.2, (k, dt) => {
            core.scale.setScalar((1 + Math.sin(k * 50) * .06) * Math.min(1, k * 10)); ring.rotation.z += dt * 7;
            for (let i = 0; i < 14; i++) { const a = rand(0, TAU), r = rand(2.5, 4.8), y = rand(-1, 1.6); parts.emit(P2.x + Math.cos(a) * r, P2.y + y, P2.z + Math.sin(a) * r, -Math.sin(a) * 4.5, -y * .4, Math.cos(a) * 4.5, i % 3 ? C.void : C.pink, rand(3, 6), 1.6, rand(.14, .3), 0, .2, 1); }
            tick -= dt;
            for (const e of G.enemies) { if (!alive(e)) continue; const d = V(P2.x - e.g.position.x, 0, P2.z - e.g.position.z); const Ln = d.length(); if (Ln < 6.5 * M.area && Ln > .3) if (e.boss) addStagger(e, dt * 4); else if (!isUnstoppable(e)) e.vel.addScaledVector(d.normalize(), dt * 11 * (1 - Ln / (7.5 * M.area))); }
            if (tick <= 0) { tick = .35; for (const e of inRadius(P2, R)) damage(e, 9 * M.dmg, {elem: M && M.elem, noCrit: true, dot: true, col: '#d8a0ff'}); }
          }, () => {
            parts.attr = null; G.scene.remove(core, ring); rm.dispose(); freeLight(L);
            explode(V(P2.x, .3, P2.z), {elem: M && M.elem, cols: [C.void, C.pink, C.white], n: 200, speed: 10, col: 0xc070ff, R: 5.5 * M.area, R2: 3.8 * M.area, light: 200, shake: .4, dmg: 72 * M.dmg, hitR: 4.2 * M.area, knock: 9, dmgCol: '#e0b0ff', size: .4});
          });
        }});
    }},
  fan: {name: 'Blade Fan', elem: 'void', tags: ['projectile', 'area'], cd: 3.5, icon: 'star', color: '#e0a8ff', anim: ['spin', 1.5],
    desc: 'Sixteen spectral daggers orbit you, then fire outward in every direction.',
    cast(h, aim, M) {
      const P = h.g.position.clone().setY(1.1), n = 16, bm = glow(0xd8a0ff, 4, {add: true}); bm.opacity = 1; const bg = new THREE.ConeGeometry(.08, .8, 4); bg.rotateX(Math.PI / 2); const bl = [];
      for (let i = 0; i < n; i++) { const b = new THREE.Group(); add(b, bg, bm); b.userData = {a: i / n * TAU, hit: new Set(), dead: false}; G.scene.add(b); bl.push(b); }
      fx(1.2, (k, dt) => {
        const t = k * 1.2;
        bl.forEach(b => {
          const u = b.userData; if (u.dead) return;
          if (t < .28) { const aa = u.a + t * 7; u.fa = aa; const c = h.g.position; b.position.set(c.x + Math.cos(aa) * .95, P.y, c.z + Math.sin(aa) * .95); b.lookAt(c.x + Math.cos(aa) * 5, P.y, c.z + Math.sin(aa) * 5); return; }
          b.position.x += Math.cos(u.fa) * 17 * dt; b.position.z += Math.sin(u.fa) * 17 * dt; parts.emit(b.position.x, b.position.y, b.position.z, 0, 0, 0, C.void, 3, .3, .18);
          if (!G.map.walkable(b.position.x, b.position.z)) { u.dead = true; b.visible = false; return; }
          for (const e of G.enemies) if (alive(e) && !u.hit.has(e) && dist2(e.g.position, b.position) < .75 + e.radius) { u.hit.add(e); damage(e, 24 * M.dmg, {elem: M && M.elem, dir: V(Math.cos(u.fa), 0, Math.sin(u.fa)), knock: 2.5, col: '#e0b0ff'}); }
        });
        bm.opacity = t > 1 ? 1 - (t - 1) / .2 : 1;
      }, () => { bl.forEach(b => G.scene.remove(b)); bm.dispose(); bg.dispose(); });
    }},
  // ---------- Pyromancer (new) ----------
  flamewall: {name: 'Flame Wall', elem: 'fire', tags: ['area'], cd: 7, icon: 'wall', color: '#ff6a2a', anim: ['cast2', 1.6],
    desc: 'Raises a wall of fire across the target point. Enemies walking through it burn.',
    cast(h, aim, M) {
      const P = clampAim(h, aim, 11), d = V(P.x - h.g.position.x, 0, P.z - h.g.position.z).normalize(), side = V(-d.z, 0, d.x), L = 7 * M.area;
      for (let k = 0; k <= 8; k++) { const q = P.clone().addScaledVector(side, (k / 8 - .5) * L); if (G.map.walkable(q.x, q.z)) addHazard(q, 1.1, 22 * M.dmg, 'hero', 5, C.fire); }
      shockwave(P, 0xff6a20, 2.5, .4, 3); flashLight(V(P.x, 1, P.z), 0xff7a30, 60, .8, 10);
      fx(5, () => { for (let k = 0; k < 10; k++) { const q = P.clone().addScaledVector(side, rand(-.5, .5) * L); parts.emit(q.x, .1, q.z, rand(-.3, .3), rand(2, 4.5), rand(-.3, .3), k % 3 ? C.fire : C.gold, rand(3, 5), rand(.4, .8), rand(.3, .55), -1, 1); } });
    }},
  livingbomb: {name: 'Living Bomb', elem: 'fire', tags: ['projectile', 'area'], cd: 4, icon: 'bomb', color: '#ff9a3a', anim: ['cast1', 1.8],
    desc: 'Plants a bomb in an enemy. After 2 seconds, or when it dies, it explodes and sets nearby enemies on fire.',
    cast(h, aim, M) { const e = nearAim(aim, 4) || nearest(h.g.position, [], 11); if (e) plantBomb(h, e, M, 0); }},
  phoenix: {name: 'Phoenix Dash', elem: 'fire', tags: ['dash', 'area'], cd: 6, icon: 'feather', color: '#ffc04a', anim: ['cast2', 2],
    desc: 'Dash through enemies in a streak of flame, leaving burning ground behind.',
    cast(h, aim, M) {
      const A = h.g.position.clone(), dir = V(aim.x - A.x, 0, aim.z - A.z).normalize(), B = walkTo(h, dir, 7.5), hit = new Set(); let lay = 0;
      h.lock = .25; h.invuln = .35; h.face(aim);
      fx(.25, (k, dt) => {
        h.g.position.lerpVectors(A, B, k); const p = h.g.position; lay -= dt;
        if (lay <= 0) { lay = .04; addHazard(V(p.x, 0, p.z), .9, 14 * M.dmg, 'hero', 3.5, C.fire); }
        for (let q = 0; q < 8; q++) parts.emit(p.x + rand(-.3, .3), rand(.3, 1.8), p.z + rand(-.3, .3), rand(-1, 1), rand(0, 2), rand(-1, 1), q % 2 ? C.fire : C.gold, 4, .5, .35, -1, 1);
        for (const e of G.enemies) if (alive(e) && !hit.has(e) && dist2(e.g.position, p) < 1.4 + e.radius) { hit.add(e); damage(e, 30 * M.dmg, {elem: M.elem, dir, knock: 4, col: '#ffa048'}); e.burn = 3; e.burnT = .4; }
      }, () => explode(h.g.position.clone(), {elem: M.elem, cols: [C.fire, C.gold], n: 60, speed: 6, col: 0xff7a2a, R: 2.4, light: 60, shake: .12, dmg: 20 * M.dmg, hitR: 2 * M.area, knock: 4, dmgCol: '#ffa048'}));
    }},
  // ---------- Warden (new) ----------
  frostarmor: {name: 'Frost Armor', elem: 'frost', tags: ['buff'], cd: 12, icon: 'shield-half', color: '#9fdcff', anim: ['area', 2],
    desc: 'Encase yourself in ice for 6 seconds: take 50% less damage, and enemies that hit you are chilled and take damage.',
    cast(h, aim, M) {
      h.buffs = h.buffs.filter(b => b.kind !== 'frostarmor'); h.buffs.push({kind: 'frostarmor', t: 6, dmg: 12 * M.dmg});
      const s = glowSprite(0x7fd0ff, 1.4, 3.2); s.position.y = 1.1; h.g.add(s); shockwave(h.g.position, 0x9fdcff, 3, .4, 3);
      parts.burst(center(h), 60, {cols: [C.ice, C.white], b: 2.5, speed: 4, life: .6, size: .25});
      fx(6, (k) => { s.material.opacity = .6 + Math.sin(k * 60) * .15; if (Math.random() < .4) { const p = h.g.position; parts.emit(p.x + rand(-.6, .6), rand(.3, 2), p.z + rand(-.6, .6), 0, .3, 0, C.ice, 2, .6, .15); } }, () => { h.g.remove(s); s.material.dispose(); });
    }},
  chains: {name: 'Chains of Ice', elem: 'frost', tags: ['area'], cd: 8, icon: 'link', color: '#bfe8ff', anim: ['cast2', 1.8],
    desc: 'Lash out with icy chains in a cone, dragging enemies to you and chilling them.',
    cast(h, aim, M) {
      const p = h.g.position, dir = V(aim.x - p.x, 0, aim.z - p.z).normalize(), R = 9 * M.area;
      for (const e of G.enemies) {
        if (!alive(e)) continue; const d = V(e.g.position.x - p.x, 0, e.g.position.z - p.z), L = d.length();
        if (L > R + e.radius || L < .5 || d.normalize().dot(dir) < .55) continue;
        bolt(center(h), center(e), .35, 0x9fdcff); damage(e, 20 * M.dmg, {elem: M.elem, col: '#9fe4ff'}); cc(e, 'chill', 3);
        if (e.boss) addStagger(e, 6); else if (!e.anchored && !isUnstoppable(e)) e.vel.addScaledVector(d, -Math.min(14, (L - 1.6) * 3.2));
      }
      shockwave(p, 0x9fdcff, 2, .3, 3);
    }},
  shieldthrow: {name: 'Avalanche Shield', elem: 'frost', tags: ['projectile'], cd: 5, icon: 'disc', color: '#7fd0ff', anim: ['shieldatk', 2],
    desc: 'Hurl a spinning shield that flies out and comes back, hitting and stunning enemies both ways.',
    cast(h, aim, M) {
      const from = h.g.position.clone().setY(1.1), dir = V(aim.x - from.x, 0, aim.z - from.z).normalize(), out = 9 * M.area;
      const s = new THREE.Group(); add(s, new THREE.CylinderGeometry(.45, .45, .06, 18), glow(0x9fdcff, 2.2)); add(s, new THREE.TorusGeometry(.45, .05, 6, 20), glow(0xffffff, 2), 0, 0, 0, {rx: Math.PI / 2}); s.position.copy(from); G.scene.add(s);
      let hits = new Set(), back = false, dist = 0;
      fx(3, (k, dt) => {
        s.rotation.y += dt * 20; const tgt = back ? h.g.position.clone().setY(1.1) : null;
        if (!back) { s.position.addScaledVector(dir, 20 * dt); dist += 20 * dt; if (dist > out || !G.map.walkable(s.position.x, s.position.z)) { back = true; hits = new Set(); } }
        else { const d = tgt.clone().sub(s.position); if (d.length() < .7) return true; s.position.addScaledVector(d.normalize(), 22 * dt); }
        parts.emit(s.position.x, s.position.y, s.position.z, rand(-.5, .5), rand(-.3, .3), rand(-.5, .5), C.ice, 2.5, .3, .2);
        for (const e of G.enemies) if (alive(e) && !hits.has(e) && dist2(e.g.position, s.position) < .9 + e.radius) { hits.add(e); damage(e, 32 * M.dmg, {elem: M.elem, dir, knock: 3, col: '#9fe4ff'}); cc(e, 'stun', .6); }
      }, () => G.scene.remove(s));
    }},
  // ---------- Ranger (new) ----------
  volley: {name: 'Volley', elem: 'storm', tags: ['projectile'], cd: 4, icon: 'arrows-split', color: '#b8ff8a', anim: ['bow', 2.2],
    desc: 'Fires seven arrows in a wide fan.',
    cast(h, aim, M) {
      const from = h.from(); from.y = 1.1; const base = V(aim.x - from.x, 0, aim.z - from.z).normalize();
      for (let k = 0; k < 7; k++) {
        const dir = base.clone().applyAxisAngle(UP, (k - 3) * .14 * M.area), ar = arrow(true); ar.position.copy(from); ar.lookAt(from.clone().add(dir)); G.scene.add(ar); const hit = new Set(); let tr = 0;
        fx(.8, (q, dt) => {
          ar.position.addScaledVector(dir, 26 * dt); tr += 26 * dt; const p = ar.position; if (tr > 15 || !G.map.walkable(p.x, p.z)) return true;
          for (const e of G.enemies) if (alive(e) && !hit.has(e) && dist2(e.g.position, p) < .6 + e.radius) { hit.add(e); damage(e, 18 * M.dmg, {elem: M.elem, dir, knock: 2, col: '#c8ff9a'}); return true; }
        }, () => G.scene.remove(ar));
      }
    }},
  snare: {name: 'Snare Trap', elem: 'nature', tags: ['trap'], cd: 5, icon: 'target', color: '#9aff6a', anim: ['cast1', 2],
    desc: 'Place a trap. The first enemy to step on it is rooted for 2.5 seconds and takes 40% more damage while stuck. Up to 2 traps.',
    cast(h, aim, M) {
      const P = clampAim(h, aim, 9); if (!G.map.walkable(P.x, P.z)) return;
      G.traps = (G.traps || []).filter(t => !t.done); if (G.traps.length >= 2) { const o = G.traps.shift(); o.done = true; }
      const g = new THREE.Group(); g.position.copy(P); G.scene.add(g);
      add(g, new THREE.RingGeometry(.55, .7, 16), glow(0x9aff6a, 2.5, {ds: true}), 0, .05, 0, {rx: -Math.PI / 2});
      for (let k = 0; k < 8; k++) { const a = k / 8 * TAU; add(g, new THREE.ConeGeometry(.06, .3, 4), new THREE.MeshStandardMaterial({color: 0x8a8a8a, metalness: .8, roughness: .3}), Math.cos(a) * .55, .12, Math.sin(a) * .55, {rz: -Math.cos(a) * .6, rx: Math.sin(a) * .6}); }
      const trap = {g, done: false}; G.traps.push(trap);
      fx(20, () => {
        if (trap.done) return true;
        for (const e of G.enemies) if (alive(e) && dist2(e.g.position, P) < .9 + e.radius) {
          trap.done = true; cc(e, 'root', 2.5); damage(e, 30 * M.dmg, {elem: M.elem, col: '#a8ff7a'});
          fx(.25, k => g.scale.set(1, 1 - k * .8, 1)); parts.burst(center(e), 30, {cols: [C.green, C.white], b: 3, speed: 4, life: .5, size: .2}); return true;
        }
      }, () => { trap.done = true; after(.3, () => G.scene.remove(g)); });
    }},
  tumble: {name: 'Tumble', elem: 'storm', tags: ['dash'], cd: 5, icon: 'arrow-back-up', color: '#d6ffb0', anim: ['dagger', 2],
    desc: 'Flip away from the cursor. Your next two basic shots deal double damage.',
    cast(h, aim, M) {
      const A = h.g.position.clone(), dir = V(A.x - aim.x, 0, A.z - aim.z).normalize(), B = walkTo(h, dir, 5.5);
      h.lock = .22; h.invuln = .3; h.empower = 2; h.face(aim); ghost(h.g, 0x9aff6a, .4, .4);
      fx(.22, k => { h.g.position.lerpVectors(A, B, 1 - (1 - k) * (1 - k)); h.lift = Math.sin(k * Math.PI) * .9; }, () => { h.lift = 0; h.face(aim); });
    }},
  // ---------- Voidblade (new) ----------
  shadowclone: {name: 'Shadow Clone', elem: 'void', tags: ['summon'], cd: 12, icon: 'users', color: '#b070ff', anim: ['spin', 2],
    desc: 'Summon a shadow of yourself for 7 seconds that hunts and slashes nearby enemies.',
    cast(h, aim, M) {
      const c = SkeletonUtils.clone(h.g), rm = []; c.traverse(o => { if (o.isLight || o.isSprite || o.isPoints) rm.push(o); }); rm.forEach(o => o.parent.remove(o));
      const m = glow(0x9a50ff, 1.2, {add: true}); m.opacity = .75; c.traverse(o => { if (o.isMesh) { o.material = m; o.castShadow = false; } });
      c.position.copy(h.g.position).add(V(rand(-1, 1), 0, rand(-1, 1))); G.scene.add(c); let swing = 0;
      parts.burst(c.position.clone().setY(1), 50, {cols: [C.void, C.pink], b: 4, speed: 4, life: .5, size: .25});
      fx(7, (k, dt) => {
        const e = nearest(c.position, [], 12); swing -= dt; c.position.y = Math.sin(k * 40) * .05;
        if (e) {
          const d = V(e.g.position.x - c.position.x, 0, e.g.position.z - c.position.z), L = d.length(); c.rotation.y = Math.atan2(d.x, d.z);
          if (L > 1.4 + e.radius) c.position.addScaledVector(d.normalize(), Math.min(L, 6 * dt));
          else if (swing <= 0) { swing = .45; c.rotation.y += Math.PI; for (const o of G.enemies) if (alive(o) && dist2(o.g.position, c.position) < 2.2 + o.radius) damage(o, 14 * M.dmg, {elem: M.elem, col: '#e0b0ff'}); parts.burst(c.position.clone().setY(1), 14, {col: C.void, b: 4, speed: 4, life: .3, size: .2}); }
        }
        m.opacity = k > .9 ? (1 - k) * 7.5 : .75;
      }, () => { G.scene.remove(c); m.dispose(); });
    }},
  deathmark: {name: 'Death Mark', elem: 'void', tags: ['projectile'], cd: 7, icon: 'skull', color: '#ff5aa0', anim: ['cast1', 2],
    desc: 'Mark an enemy for 4 seconds. When the mark ends it takes 50% of all damage it suffered again. Blink Strike detonates it instantly.',
    cast(h, aim, M) {
      const e = nearAim(aim, 4) || nearest(h.g.position, [], 11); if (!e) return;
      e.dmark = 4; e.markDmg = 0; e.markM = M; const s = glowSprite(0xff3a90, 3, 1.4); s.position.y = e.h + .6; e.g.add(s); e.markSprite = s;
      bolt(h.from(), center(e), .25, 0xff5aa0);
      fx(4, (k) => { if (!alive(e) || !e.markSprite) return true; s.scale.setScalar(1.2 + Math.sin(k * 40) * .2); }, () => detonateMark(e));
    }},
  smoke: {name: 'Smoke Veil', elem: 'void', tags: ['buff'], cd: 10, icon: 'cloud-fog', color: '#8a7aa8', anim: ['area', 2],
    desc: 'Vanish in smoke for 3 seconds. Enemies lose track of you, and your next hit is a guaranteed crit for 2.5x damage.',
    cast(h, aim, M) {
      h.stealth = 3; h.ambush = true; const p = h.g.position;
      for (let k = 0; k < 90; k++) parts.emit(p.x + rand(-2, 2), rand(.1, 2), p.z + rand(-2, 2), rand(-.5, .5), rand(0, .6), rand(-.5, .5), new THREE.Color(.25, .2, .35), 1.2, rand(1, 2), rand(.5, 1), 0, .5);
      for (const e of G.enemies) e.aggro = false;
    }},
};

// ---------- ultimates (R) ----------
export const ULTS = {
  infernorain: {name: 'Inferno Rain', elem: 'fire', tags: ['area'], cd: 40, icon: 'flame', color: '#ff5a1a', anim: ['area', 1.2], ult: true,
    desc: 'Eight meteors crash down around the cursor.',
    cast(h, aim, M) { const P = clampAim(h, aim, 12); for (let i = 0; i < 8; i++) after(i * .22, () => SKILLS.meteor.cast(h, V(P.x + rand(-4, 4), 0, P.z + rand(-4, 4)), {dmg: M.dmg * .8, area: M.area * .75})); }},
  absolutezero: {name: 'Absolute Zero', elem: 'frost', tags: ['area'], cd: 40, icon: 'snowflake', color: '#bfe8ff', anim: ['area', 1.3], ult: true,
    desc: 'Freezes every enemy around you solid and shatters them.',
    cast(h, aim, M) {
      const P = h.g.position.clone(); shockwave(P, 0xbfe8ff, 12, .9, 3); after(.1, () => shockwave(P, 0xffffff, 9, .8, 2)); G.shake = .6; flashLight(V(P.x, 2, P.z), 0x9fe4ff, 120, .8, 20);
      parts.burst(V(P.x, .5, P.z), 260, {cols: [C.ice, C.white, C.snow], b: 2, speed: 14, life: 1.1, size: .35, grav: 2, flat: true});
      for (const e of inRadius(P, 11)) { cc(e, 'freeze', 4); damage(e, 80 * M.dmg, {elem: M && M.elem, col: '#bfe8ff'}); }
    }},
  stormcall: {name: 'Storm Call', elem: 'storm', tags: ['area'], cd: 40, icon: 'bolt', color: '#a8d0ff', anim: ['cast2', 1.2], ult: true,
    desc: 'Lightning strikes enemies around you twelve times.',
    cast(h, aim, M) {
      for (let i = 0; i < 12; i++) after(i * .15, () => {
        const list = inRadius(h.g.position, 12); if (!list.length) return; const e = list[Math.floor(Math.random() * list.length)], c = center(e);
        bolt(c.clone().add(V(rand(-1, 1), 14, rand(-1, 1))), c, .3); flashLight(c, 0xa8d0ff, 120, .3, 9); parts.burst(c, 30, {cols: [C.bolt, C.white], b: 7, speed: 6, life: .35, size: .2});
        damage(e, 50 * M.dmg, {elem: M && M.elem, col: '#bfe0ff'}); cc(e, 'stun', .4); G.shake = Math.max(G.shake, .15);
      });
    }},
  eventhorizon: {name: 'Event Horizon', elem: 'void', tags: ['area'], cd: 40, icon: 'circle-dot', color: '#b050ff', anim: ['cast1', 1.2], ult: true,
    desc: 'A huge singularity that pulls in a whole room.',
    cast(h, aim, M) { SKILLS.singularity.cast(h, aim, {dmg: M.dmg * 2.2, area: M.area * 1.7}); }},
  supernova: {name: 'Supernova', elem: 'fire', tags: ['area'], cd: 40, icon: 'sun-high', color: '#ffd04a', anim: ['area', .9], ult: true,
    desc: 'Gather the heat of a star for a second, then detonate everything around you.',
    cast(h, aim, M) {
      h.lock = 1; const s = glowSprite(0xffb040, 4, .5); s.position.y = 1.2; h.g.add(s); const L = takeLight(0xffa040, 0, 14);
      fx(1, k => { s.scale.setScalar(.5 + k * 5); L.position.copy(h.g.position).setY(2); L.intensity = 120 * k; const p = h.g.position; for (let q = 0; q < 10; q++) { const a = rand(0, TAU), r = rand(4, 8); parts.emit(p.x + Math.cos(a) * r, rand(.3, 3), p.z + Math.sin(a) * r, -Math.cos(a) * r * 1.2, 0, -Math.sin(a) * r * 1.2, C.gold, 4, .7, .3); } },
        () => { h.g.remove(s); s.material.dispose(); freeLight(L); const P = h.g.position.clone();
          explode(P, {elem: M.elem, cols: [C.gold, C.fire, C.white], n: 320, speed: 16, col: 0xffa040, R: 9 * M.area, R2: 6 * M.area, light: 300, shake: .8, scorch: 7, dmg: 150 * M.dmg, hitR: 8 * M.area, knock: 12, dmgCol: '#ffd04a', size: .5, life: 1});
          for (const e of inRadius(P, 8 * M.area)) { e.burn = 4; e.burnT = .3; } });
    }},
  crusade: {name: 'Frozen Crusade', elem: 'frost', tags: ['buff'], cd: 40, icon: 'swords', color: '#dff1ff', anim: ['area', 1.3], ult: true,
    desc: 'For 8 seconds, you attack 30% faster and every basic attack also sends out a piercing wave of frost.',
    cast(h, aim, M) { h.buffs.push({kind: 'crusade', t: 8, M}); shockwave(h.g.position, 0xdff1ff, 5, .6, 3); flashLight(center(h), 0x9fdcff, 80, .6, 8); parts.burst(center(h), 100, {cols: [C.ice, C.white], b: 3, speed: 6, life: .8, size: .3, up: 3}); }},
  starfall: {name: 'Rain of Stars', elem: 'storm', tags: ['area'], cd: 40, icon: 'stars', color: '#fff4b0', anim: ['bow', 1.2], ult: true,
    desc: 'Every enemy around you is struck by three falling star-arrows.',
    cast(h, aim, M) {
      const list = inRadius(h.g.position, 14);
      list.forEach((e, n) => { for (let k = 0; k < 3; k++) after(.25 + k * .35 + n * .03, () => {
        if (!alive(e)) return; const c = center(e), S = c.clone().add(V(rand(-2, 2), 14, rand(-2, 2))), s = glowSprite(0xfff4b0, 5, .9); s.position.copy(S); G.scene.add(s);
        fx(.25, q => s.position.lerpVectors(S, c, q), () => { G.scene.remove(s); s.material.dispose(); if (!alive(e)) return; damage(e, 35 * M.dmg, {elem: M.elem, col: '#fff4b0'}); parts.burst(c, 20, {cols: [C.gold, C.white], b: 5, speed: 5, life: .4, size: .2}); flashLight(c, 0xfff4b0, 40, .2, 5); });
      }); });
    }},
  thousandcuts: {name: 'Thousand Cuts', elem: 'void', tags: ['dash'], cd: 40, icon: 'slice', color: '#e070ff', anim: ['dagger', 2.4], ult: true,
    desc: 'Blink between up to eight nearby enemies, cutting each one.',
    cast(h, aim, M) {
      const list = inRadius(h.g.position, 11).sort(() => Math.random() - .5).slice(0, 8); h.lock = list.length * .13 + .2; h.invuln = h.lock + .2;
      list.forEach((e, n) => after(n * .13, () => {
        if (!alive(e)) return; ghost(h.g, 0xb070ff, .3, .5); const d = V(rand(-1, 1), 0, rand(-1, 1)).normalize(), B = e.g.position.clone().setY(0).addScaledVector(d, 1.1);
        if (G.map.walkableCircle(B.x, B.z, .35)) h.g.position.copy(B); h.face(e.g.position);
        damage(e, 45 * M.dmg, {elem: M.elem, col: '#e0b0ff'}); parts.burst(center(e), 30, {cols: [C.void, C.pink, C.white], b: 5, speed: 6, life: .35, size: .2}); G.shake = Math.max(G.shake, .12);
      }));
    }},
};

function arrow(magic) {
  const g = new THREE.Group(); const wood = new THREE.MeshStandardMaterial({color: 0x6a4a2c, roughness: .7});
  add(g, new THREE.CylinderGeometry(.02, .02, 1, 5), wood, 0, 0, 0, {rx: Math.PI / 2});
  add(g, new THREE.ConeGeometry(.055, .2, 6), magic ? glow(0xb0ff80, 5) : new THREE.MeshStandardMaterial({color: 0x9aa4ae, metalness: .8, roughness: .3}), 0, 0, .58, {rx: Math.PI / 2});
  if (magic) g.add(glowSprite(0x9aff6a, 3, .8)); return g;
}

// ---------- helpers for the new class skills ----------
export function plantBomb(h, e, M, gen) {
  if (!alive(e) || e.bomb) return; const s = glowSprite(0xff8a2a, 3, 1); s.position.y = e.cy + .3; e.g.add(s); e.bomb = true;
  let t = 0;
  fx(2, (k, dt) => { t += dt; s.scale.setScalar(.8 + Math.sin(t * (8 + t * 10)) * .3 + k * .6); if (!alive(e)) return true; }, () => {
    e.g.remove(s); s.material.dispose(); e.bomb = false; const P = e.g.position.clone();
    explode(P, {elem: 'fire', cols: [C.fire, C.gold, C.ember], n: 80, speed: 7, col: 0xff7a2a, R: 2.8 * M.area, light: 90, shake: .15, scorch: 1.8, dmg: 55 * M.dmg, hitR: 2.6 * M.area, knock: 5, dmgCol: '#ffa048', onHit: x => { x.burn = 3; x.burnT = .4; }});
    if (h.pas.chainreaction && gen < 3) { const n = nearest(P, [e], 5); if (n) plantBomb(h, n, M, gen + 1); }
  });
}
export function detonateMark(e) {
  if (!e.markSprite) return; e.g.remove(e.markSprite); e.markSprite.material.dispose(); e.markSprite = null; e.dmark = 0;
  const M = e.markM || {dmg: 1}, burst = (e.markDmg || 0) * .5 + 40 * M.dmg, P = e.g.position.clone();
  explode(P, {elem: 'void', cols: [C.pink, C.void, C.white], n: 70, speed: 6, col: 0xff3a90, R: 2.8, light: 90, shake: .2, dmg: 0});
  if (alive(e)) damage(e, burst, {elem: 'void', col: '#ff7ab8', crit: true});
  for (const o of inRadius(P, 2.5)) if (o !== e) damage(o, burst * .5, {elem: 'void', col: '#ff7ab8'});
}
// Frozen Crusade: extra frost wave on every basic attack
export function frostWave(h, aim, M) {
  const from = h.g.position.clone().setY(.9), dir = V(aim.x - from.x, 0, aim.z - from.z).normalize(), s = glowSprite(0xbfe8ff, 3.5, 1.6); s.position.copy(from); G.scene.add(s); const hit = new Set(); let tr = 0;
  fx(1, (k, dt) => {
    s.position.addScaledVector(dir, 16 * dt); tr += 16 * dt; const p = s.position; if (tr > 11 || !G.map.walkable(p.x, p.z)) return true;
    for (let q = 0; q < 3; q++) parts.emit(p.x + rand(-.5, .5), p.y, p.z + rand(-.5, .5), 0, .5, 0, C.ice, 3, .4, .25);
    for (const e of G.enemies) if (alive(e) && !hit.has(e) && dist2(e.g.position, p) < 1 + e.radius) { hit.add(e); damage(e, 20 * M.dmg, {elem: 'frost', dir, knock: 2, col: '#9fe4ff'}); applyElem(e, 'frost', 20); }
  }, () => { G.scene.remove(s); s.material.dispose(); });
}
