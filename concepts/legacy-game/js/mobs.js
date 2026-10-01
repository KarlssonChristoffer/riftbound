// Enemies: a roster of mob types per biome, each with its own model, element and behaviour, plus the ways to counter them.
import {THREE, G, V, TAU, rand, randi, pick, clamp, dist2, lerpAngle, parts, fx, after, glow, add, glowSprite, shockwave, marker, flashLight, bolt, place, worldUI, C} from './core.js';
import {modelRig, makeDriver, driveUpdate, dplay} from './assets.js';
import {damage, alive, center, nearest, ELEM, WEAK, RESIST, ccUpdate, isUnstoppable} from './combat.js';
import {hurtHero, addHazard, moveEnt, gainXp, dropGold, dropGlobe} from './entities.js';
import {watcherModel} from './biomes.js';
import {sfx} from './audio.js';

// ---------- mob types ----------
// beh: brute | charger | caster | bomber | guardian | healer | summoner | leaper | turret | swarm | blinker
export const MOBS = {
  // Ember Wastes (fire: weak to frost, resists fire)
  scaleguard: {name: 'Scaleguard', model: 'lizardfolk', h: 1.95, elem: 'fire', beh: 'brute', hp: 1, dmg: 1, speed: 2.6, tip: 'A plain brawler. Nothing tricky, but they hit hard in groups.'},
  cinderimp: {name: 'Cinder Imp', proc: 'imp', elem: 'fire', beh: 'caster', hp: .7, dmg: .9, speed: 2.8, shot: {col: 0xff7a2a, pc: 'fire', speed: 10, burn: true}, tip: 'Keeps its distance and throws fireballs. Sidestep the shots and close in.'},
  magmahorn: {name: 'Magmahorn', model: 'werewolf', h: 2.2, tint: 0x9a3a28, glow: 0xff4a10, elem: 'fire', beh: 'charger', hp: 1.6, dmg: 1.3, speed: 2.4, tip: 'Charges in a straight line after a red warning. Stun it during the wind-up to cancel the charge, or step aside and let it slam into a wall.'},
  emberling: {name: 'Emberling', proc: 'blob', elem: 'fire', beh: 'bomber', hp: .45, dmg: 1, speed: 3.9, group: [2, 3], tip: 'Runs at you and explodes. Kill it at range, and its blast hurts the enemies around it.'},
  // Frost Hollow (frost: weak to fire, resists frost)
  rimestalker: {name: 'Rime Stalker', model: 'werewolf', h: 2.2, tint: 0xc8dcff, glow: 0x3a70c0, elem: 'frost', beh: 'leaper', hp: 1.1, dmg: 1.1, speed: 3.1, tip: 'Leaps at you and a ring shows where it lands. It is Unstoppable mid-air, so evade out of the ring.'},
  frostwraith: {name: 'Frost Wraith', proc: 'wraith', elem: 'frost', beh: 'caster', hp: .75, dmg: .8, speed: 2.4, float: .35, shot: {col: 0x9fdcff, pc: 'ice', speed: 9, chill: 2}, tip: 'Its frost bolts slow you down. Dodge them and get close.'},
  glaciergolem: {name: 'Glacier Golem', proc: 'golem', elem: 'frost', beh: 'guardian', hp: 2.6, dmg: 1.5, speed: 1.7, tip: 'Its ice shield blocks hits from the front. Get behind it, or stun or freeze it to drop the shield. Fire melts it fast.'},
  rimeshaman: {name: 'Rimescale Shaman', model: 'lizardfolk', h: 1.9, tint: 0xa8ccff, glow: 0x3a8cff, elem: 'frost', beh: 'healer', hp: .9, dmg: .7, speed: 2.4, tip: 'Heals the other enemies. Kill it first, and stunning it interrupts the heal.'},
  // Overgrown Ruins (nature: weak to fire, resists poison)
  myconid: {name: 'Myconid', model: 'myconid', h: 1.6, elem: 'nature', beh: 'brute', hp: 1, dmg: 1, speed: 2.5, tip: 'A plain brawler that comes in numbers.'},
  sporepod: {name: 'Spore Pod', proc: 'pod', elem: 'nature', beh: 'turret', hp: 1.3, dmg: 1, speed: 0, tip: 'Rooted in place and pulses poison. Stay outside its ring or destroy it.'},
  thornback: {name: 'Thornback', model: 'werewolf', h: 2.1, tint: 0x7aa84a, glow: 0x2a5a10, elem: 'nature', beh: 'charger', hp: 1.5, dmg: 1.3, speed: 2.4, tip: 'Charges in a straight line after a red warning. Stun it during the wind-up to cancel it, or make it hit a wall.'},
  sporecaller: {name: 'Sporecaller', model: 'myconid', h: 1.8, tint: 0xe0b0ff, glow: 0x8a30d0, elem: 'nature', beh: 'summoner', summon: 'sprout', hp: 1.1, dmg: .7, speed: 2.3, tip: 'Keeps summoning sprouts. Take it down first.'},
  sprout: {name: 'Sprout', proc: 'sprout', elem: 'nature', beh: 'swarm', hp: .3, dmg: .5, speed: 3.4, minion: true, tip: 'Weak but many.'},
  // The Rift (void: weak to storm, resists void)
  watcher: {name: 'Watcher', proc: 'watcher', elem: 'void', beh: 'caster', hp: .9, dmg: .9, speed: 2.4, float: 1.2, shot: {col: 0xc050ff, pc: 'void', speed: 9}, tip: 'Floats at range and fires void bolts. Dodge and close in.'},
  voidcrawler: {name: 'Void Crawler', proc: 'crawler', elem: 'void', beh: 'swarm', hp: .35, dmg: .6, speed: 4.2, group: [4, 6], tip: 'Fast and fragile, and always in swarms. Area damage shreds them.'},
  nullsentinel: {name: 'Null Sentinel', proc: 'sentinel', elem: 'void', beh: 'guardian', hp: 2.4, dmg: 1.4, speed: 1.6, tip: 'Its barrier blocks hits from the front. Flank it, or stun it to break the barrier. Storm cuts through it.'},
  riftacolyte: {name: 'Rift Acolyte', model: 'lizardfolk', h: 1.9, tint: 0x8a5ab8, glow: 0xa040ff, elem: 'void', beh: 'blinker', hp: 1, dmg: 1, speed: 2.4, tip: 'Teleports next to you and detonates after a warning ring. Evade out of it.'},
};
const TIER = {normal: {s: 1, hp: 1, dmg: 1}, elite: {s: 1.25, hp: 4.5, dmg: 1.5}, mini: {s: 1.5, hp: 13, dmg: 1.8}, boss: {s: 2.1, hp: 50, dmg: 2.2}};
// elite affixes, many borrowed from Diablo IV's elite packs; later biomes stack two of them
const AFFIX = {Fast: '#ffe066', Molten: '#ff6a2a', Explosive: '#ff3a3a', Vampiric: '#ff4a8a', Frozen: '#9fdcff', Mortar: '#ffa040', Shielding: '#fff2a8', Teleporter: '#c070ff'};
export const hasAffix = (e, a) => e.affixes.includes(a);
const PC = {fire: C.fire, ice: C.ice, void: C.void, green: C.green};

// ---------- procedural bodies ----------
const PROC = {
  imp(s) { // floating lava rock with horns
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.scale.setScalar(s);
    const rock = new THREE.MeshStandardMaterial({color: 0x3a2520, roughness: .9, flatShading: true, emissive: 0xff4a10, emissiveIntensity: .45});
    add(inner, new THREE.DodecahedronGeometry(.45, 0), rock, 0, 0, 0, {s: [1, 1.1, .9]});
    for (const x of [-1, 1]) { add(inner, new THREE.ConeGeometry(.08, .35, 5), rock, x * .22, .38, 0, {rz: -x * .5}); add(inner, new THREE.SphereGeometry(.06, 8, 6), glow(0xffd040, 6), x * .14, .08, .36); add(inner, new THREE.DodecahedronGeometry(.14, 0), rock, x * .5, -.1, .1); }
    const em = [0, 1, 2].map(() => { const sp = glowSprite(0xff7a2a, 3, .35); inner.add(sp); return sp; });
    return {g, mats: [rock], h: 1.6 * s, cy: 1.05 * s, r: .45 * s, anim: (t, seed) => { inner.position.y = (1.05 + Math.sin(t * 3 + seed) * .12) * s; inner.rotation.y = Math.sin(t * 2 + seed) * .3; em.forEach((sp, k) => { const a = t * 3 + k * 2.1 + seed; sp.position.set(Math.cos(a) * .6, Math.sin(t * 5 + k) * .2, Math.sin(a) * .6); }); }};
  },
  blob(s) { // molten slime with a crust
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.scale.setScalar(s);
    const lava = new THREE.MeshStandardMaterial({color: 0xff7a2a, roughness: .4, emissive: 0xff4a10, emissiveIntensity: 1.1}), crust = new THREE.MeshStandardMaterial({color: 0x2a1a14, roughness: 1, flatShading: true});
    const body = add(inner, new THREE.SphereGeometry(.42, 18, 12), lava, 0, .4, 0);
    for (let k = 0; k < 6; k++) { const a = rand(0, TAU), el = rand(.2, 1.1); add(body, new THREE.DodecahedronGeometry(.12, 0), crust, Math.sin(el) * Math.cos(a) * .4, Math.cos(el) * .4, Math.sin(el) * Math.sin(a) * .4); }
    for (const x of [-1, 1]) add(body, new THREE.SphereGeometry(.05, 8, 6), new THREE.MeshBasicMaterial({color: 0x000000}), x * .12, .1, .38);
    return {g, mats: [lava], h: .95 * s, cy: .45 * s, r: .4 * s, body, anim: (t, seed, e) => { const f = e && e.st.fuse > 0 ? 18 : 6, b = Math.abs(Math.sin(t * f + seed)); body.position.y = .4 + b * .25; body.scale.set(1 + (1 - b) * .15, 1 - (1 - b) * .18, 1 + (1 - b) * .15); }};
  },
  golem(s) { // stacked ice blocks
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.scale.setScalar(s);
    const ice = new THREE.MeshStandardMaterial({color: 0xbfe8ff, roughness: .25, metalness: .1, flatShading: true, emissive: 0x3a9cff, emissiveIntensity: .25}), rock = new THREE.MeshStandardMaterial({color: 0x5b6576, roughness: .9, flatShading: true});
    add(inner, new THREE.DodecahedronGeometry(.62, 0), ice, 0, 1.25, 0, {s: [1.2, 1, .9]}); add(inner, new THREE.DodecahedronGeometry(.3, 0), rock, 0, 2.0, .05);
    add(inner, new THREE.SphereGeometry(.07, 8, 6), glow(0x7fe8ff, 6), -.1, 2.02, .28); add(inner, new THREE.SphereGeometry(.07, 8, 6), glow(0x7fe8ff, 6), .1, 2.02, .28);
    const arms = [-1, 1].map(x => { const a = new THREE.Group(); a.position.set(x * .85, 1.55, 0); inner.add(a); add(a, new THREE.BoxGeometry(.4, .9, .4), ice, 0, -.45, 0); add(a, new THREE.DodecahedronGeometry(.3, 0), rock, 0, -.95, 0); return a; });
    for (const x of [-1, 1]) add(inner, new THREE.BoxGeometry(.38, .7, .4), rock, x * .32, .35, 0);
    return {g, mats: [ice], h: 2.3 * s, cy: 1.2 * s, r: .75 * s, anim: (t, seed, e) => { inner.rotation.z = Math.sin(t * 1.5 + seed) * .04; arms.forEach((a, k) => { a.rotation.x = Math.sin(t * 2 + k * Math.PI + seed) * (e && e.moving ? .5 : .1); }); }};
  },
  pod(s) { // rooted spore pod
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.scale.setScalar(s);
    const skin = new THREE.MeshStandardMaterial({color: 0x6a3a7a, roughness: .6, emissive: 0x3a1050, emissiveIntensity: .3}), stalk = new THREE.MeshStandardMaterial({color: 0x4f7d2f, roughness: .9, flatShading: true});
    add(inner, new THREE.CylinderGeometry(.18, .32, .6, 8), stalk, 0, .3, 0);
    const bulb = add(inner, new THREE.SphereGeometry(.55, 18, 14), skin, 0, .95, 0, {s: [1, .9, 1]});
    for (let k = 0; k < 9; k++) { const a = rand(0, TAU), el = rand(.3, 1.3); add(bulb, new THREE.SphereGeometry(.07, 8, 6), glow(0xb8ff5a, 3), Math.sin(el) * Math.cos(a) * .55, Math.cos(el) * .5, Math.sin(el) * Math.sin(a) * .55); }
    for (let k = 0; k < 5; k++) { const a = k / 5 * TAU; add(inner, new THREE.ConeGeometry(.06, .7, 5), stalk, Math.cos(a) * .4, .15, Math.sin(a) * .4, {rz: -Math.cos(a) * 1.2, rx: Math.sin(a) * 1.2}); }
    return {g, mats: [skin], h: 1.5 * s, cy: .9 * s, r: .6 * s, anim: (t, seed, e) => { const p = e && e.st.pulse > 0 ? 1 + e.st.pulse * .25 : 1 + Math.sin(t * 2 + seed) * .04; bulb.scale.set(p, .9 * p, p); }};
  },
  crawler(s) { // void spider
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.scale.setScalar(s);
    const shell = new THREE.MeshStandardMaterial({color: 0x241a33, roughness: .4, metalness: .4, flatShading: true, emissive: 0x3a1060, emissiveIntensity: .35});
    const body = add(inner, new THREE.SphereGeometry(.35, 12, 10), shell, 0, .45, 0, {s: [1, .6, 1.3]});
    add(inner, new THREE.SphereGeometry(.2, 10, 8), shell, 0, .5, .4);
    for (const x of [-1, 1]) for (const y of [0, 1]) add(inner, new THREE.SphereGeometry(.04, 6, 5), glow(0xd070ff, 6), x * (.06 + y * .06), .56 + y * .05, .56);
    const legs = []; for (const x of [-1, 1]) for (let k = 0; k < 3; k++) { const l = new THREE.Group(); l.position.set(x * .25, .45, (k - 1) * .25); inner.add(l); add(l, new THREE.CylinderGeometry(.03, .02, .7, 5), shell, x * .3, -.1, 0, {rz: x * 1.1}); legs.push(l); }
    return {g, mats: [shell], h: .8 * s, cy: .45 * s, r: .4 * s, anim: (t, seed, e) => { const sp = e && e.moving ? 18 : 3; legs.forEach((l, k) => { l.rotation.x = Math.sin(t * sp + k * 1.3 + seed) * .45; }); body.position.y = .45 + Math.abs(Math.sin(t * sp + seed)) * .04; }};
  },
  wraith(s) { // translucent frost wraith
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.scale.setScalar(s);
    const robe = new THREE.MeshStandardMaterial({color: 0xa8d8ff, roughness: .3, emissive: 0x2a70d0, emissiveIntensity: .7, transparent: true, opacity: .82, side: THREE.DoubleSide, flatShading: true});
    const body = add(inner, new THREE.ConeGeometry(.5, 1.5, 9, 1, true), robe, 0, .75, 0, {rx: Math.PI});
    add(inner, new THREE.SphereGeometry(.34, 14, 10, 0, TAU, 0, Math.PI * .6), robe, 0, 1.58, 0);
    add(inner, new THREE.SphereGeometry(.26, 12, 10), new THREE.MeshBasicMaterial({color: 0x04060c}), 0, 1.52, .05);
    for (const x of [-1, 1]) { add(inner, new THREE.SphereGeometry(.045, 8, 6), glow(0x7fe8ff, 8), .09 * x, 1.55, .27); add(inner, new THREE.ConeGeometry(.1, .75, 6, 1, true), robe, .5 * x, 1.05, .05, {rz: x * 2.7}); }
    return {g, mats: [robe], h: 1.9 * s, cy: 1 * s, r: .45 * s, anim: (t, seed) => { inner.position.y = (.35 + Math.sin(t * 2 + seed) * .15) * s; inner.rotation.z = Math.sin(t * 1.5 + seed) * .08; body.scale.x = 1 + Math.sin(t * 6 + seed) * .04; if (Math.random() < .1) { const p = g.position; parts.emit(p.x + rand(-.2, .2), p.y + .2, p.z + rand(-.2, .2), 0, -.3, 0, C.ice, 2, 1, .12); } }};
  },
  sentinel(s) { // hovering void obelisk
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.scale.setScalar(s);
    const stone = new THREE.MeshStandardMaterial({color: 0x1c1628, roughness: .3, metalness: .6, flatShading: true, emissive: 0x3a1060, emissiveIntensity: .3});
    add(inner, new THREE.OctahedronGeometry(.6), stone, 0, 1.35, 0, {s: [.8, 1.9, .8]});
    add(inner, new THREE.BoxGeometry(.08, .5, .02), glow(0xc070ff, 4), 0, 1.4, .38); add(inner, new THREE.BoxGeometry(.3, .06, .02), glow(0xc070ff, 4), 0, 1.55, .38);
    const rings = [0, 1].map(k => add(inner, new THREE.TorusGeometry(.75 + k * .2, .03, 6, 40), glow(0xa050ff, 3), 0, 1.1 + k * .5, 0, {rx: Math.PI / 2}));
    return {g, mats: [stone], h: 2.5 * s, cy: 1.3 * s, r: .7 * s, anim: (t, seed) => { inner.position.y = Math.sin(t * 1.5 + seed) * .12 * s; rings.forEach((r, k) => { r.rotation.z = t * (k ? -1 : 1.4); r.rotation.x = Math.PI / 2 + Math.sin(t + k) * .2; }); }};
  },
  sprout(s) { // tiny mushroom minion
    const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner); inner.scale.setScalar(s * .6);
    const stem = new THREE.MeshStandardMaterial({color: 0xeadcc0, roughness: .8}), cap = new THREE.MeshStandardMaterial({color: 0xb050e0, roughness: .5, emissive: 0x5a1080, emissiveIntensity: .3});
    add(inner, new THREE.CylinderGeometry(.24, .3, .7, 10), stem, 0, .35, 0); add(inner, new THREE.SphereGeometry(.55, 16, 10, 0, TAU, 0, Math.PI / 2), cap, 0, .62, 0, {s: [1, .75, 1]});
    for (const x of [-1, 1]) add(inner, new THREE.SphereGeometry(.055, 8, 6), new THREE.MeshBasicMaterial({color: 0x111111}), .1 * x, .45, .25);
    return {g, mats: [cap], h: .75 * s, cy: .35 * s, r: .3 * s, anim: (t, seed) => { const hop = Math.abs(Math.sin(t * 7 + seed)); inner.position.y = hop * .2; }};
  },
  watcher(s) { const w = watcherModel(s); return {g: w.g, mats: w.mats, h: 1.9 * s, cy: 1.2 * s, r: .5 * s, anim: (t, seed) => w.anim(t, seed)}; },
};

// ---------- spawning ----------
export function spawnMob(id, pos, tier = 'normal', name) {
  const D = MOBS[id], T = TIER[tier], s = T.s, diff = G.diff();
  let e;
  if (D.model) {
    const m = modelRig(D.model, D.h * s);
    for (const mat of m.mats) { if (D.tint) mat.color.multiply(new THREE.Color(D.tint)); if (D.glow) { mat.emissive = new THREE.Color(D.glow); mat.emissiveIntensity = .22; } }
    e = {g: m.root, rig: m.rig, drv: makeDriver(m.rig, 'e_idle', 'e_walk'), mats: m.mats, h: D.h * s, cy: D.h * s * .5, radius: .45 * s * D.h / 1.9};
  } else { const P = PROC[D.proc](s); e = {g: P.g, mats: P.mats, wanim: P.anim, h: P.h, cy: P.cy, radius: P.r}; }
  Object.assign(e, {id, D, beh: tier === 'boss' ? 'boss' : D.beh, elem: D.elem, typeName: D.name, tier, elite: tier !== 'normal', boss: tier === 'boss', name, minion: !!D.minion,
    hp: 0, max: 0, vel: V(), flash: 0, frozen: 0, burn: 0, burnT: 0, dead: 0, spawn: 0, active: true, aggro: tier === 'boss', seed: rand(0, 10), atkT: rand(.6, 1.6), moving: false,
    speed: D.speed * (tier === 'boss' ? .9 : 1), dmg: 5.5 * diff * T.dmg * D.dmg, affixes: [], stag: 0, stagMax: 100, st: {cd: rand(1.5, 3.5), cd2: rand(4, 7), mode: 'walk'}, anchored: D.beh === 'turret',
    shield: D.beh === 'guardian'});
  const bossK = tier === 'boss' ? [.9, 1, 1.15, 1.7][G.run.biome] || 1 : 1; // the last boss should be the real test
  e.max = e.hp = Math.round(45 * diff * T.hp * D.hp * bossK * G.partyScale);
  const nAff = tier === 'elite' ? (G.run.biome >= 2 ? 2 : 1) : tier === 'mini' ? Math.max(0, G.run.biome - 1) : 0;
  while (e.affixes.length < nAff) { const a = pick(Object.keys(AFFIX)); if (!e.affixes.includes(a) && !(a === 'Fast' && D.beh === 'turret')) e.affixes.push(a); }
  if (hasAffix(e, 'Fast')) e.speed *= 1.5;
  e.base = e.mats.map(m => ({e: m.emissive.clone(), i: m.emissiveIntensity}));
  if (e.shield) { // guardian barrier in front
    const col = D.elem === 'frost' ? 0x9fdcff : 0xc070ff, m = glow(col, 1.4, {add: true, ds: true}); m.opacity = .45;
    e.shieldMesh = add(e.g, new THREE.CylinderGeometry(e.radius * 1.5, e.radius * 1.5, .06, 6), m, 0, e.cy, e.radius + .35, {rx: Math.PI / 2});
  }
  if (e.elite) { const col = tier === 'elite' ? AFFIX[e.affixes[0]] : tier === 'mini' ? '#ffb000' : '#ff3a3a'; e.ring = add(e.g, new THREE.RingGeometry(.8 * s, .95 * s, 40), glow(col, 2.5, {add: true, ds: true}), 0, .05, 0, {rx: -Math.PI / 2}); }
  e.bar = document.createElement('div'); e.bar.className = 'hp' + (e.elite ? ' elite' : ''); e.bar.innerHTML = (name ? `<b>${name}</b>` : e.affixes.length ? `<b>${e.affixes.join(' · ')}</b>` : '') + '<i><u></u></i>'; worldUI.appendChild(e.bar);
  e.g.position.copy(pos); e.g.rotation.y = rand(0, TAU); e.g.scale.setScalar(.001); G.scene.add(e.g); G.enemies.push(e);
  if (G.onNewMob && !e.minion) G.onNewMob(D, id);
  return e;
}
// biome roster pick (weighted)
export function rollMob(biome, pool = biome.roster) { const tot = pool.reduce((a, r) => a + r[1], 0); let x = Math.random() * tot; for (const [id, w] of pool) { x -= w; if (x <= 0) return id; } return pool[0][0]; }

// ---------- death ----------
export function killEnemy(e) {
  if (e.dead > 0) return; e.dead = e.drv ? 2.2 : .7; e.bar.remove(); e.active = false;
  if (e.drv) dplay(e.drv, 'e_die', true, 1.3); sfx('death', {}, .05);
  parts.burst(center(e), e.elite ? 90 : 45, {cols: G.biome.deathCols, b: 4, speed: 5, life: .8, size: .3, up: 1, grav: 3});
  if (e.beh === 'bomber' && !e.st.blown) blowUp(e, false);
  if (hasAffix(e, 'Explosive')) { const P = e.g.position.clone(); marker(P, 3, 0xff3a3a, .9); after(.9, () => { shockwave(P, 0xff3a3a, 3.5, .5, 4); parts.burst(V(P.x, .5, P.z), 80, {cols: [C.fire, C.red], b: 5, speed: 7, life: .6, size: .35}); if (dist2(G.hero.g.position, P) < 3) hurtHero(e.dmg * 2.5); }); }
  const h = G.hero; h.kills++;
  if (h.pas.pyroclasm && e.burn > 0) { const P = e.g.position.clone(); after(.05, () => { shockwave(P, 0xff6a20, 2.8, .4, 4); parts.burst(V(P.x, .8, P.z), 50, {cols: [C.fire, C.gold], b: 4, speed: 6, life: .5, size: .3}); for (const o of G.enemies) if (alive(o) && dist2(o.g.position, P) < 2.6 + o.radius) { damage(o, 30, {elem: 'fire', col: '#ffa048'}); o.burn = 3; o.burnT = .4; } }); }
  if (h.pas.momentum) for (let k = 0; k < 4; k++) h.cds[k] = Math.max(0, h.cds[k] - .5);
  if (h.pas.voidhunger) h.heal(h.maxHp * .04);
  if (e.markSprite) { e.g.remove(e.markSprite); e.markSprite = null; }
  const xp = e.minion ? 4 : {normal: 15, elite: 70, mini: 170, boss: 320}[e.tier];
  gainXp(h, Math.round(xp * (1 + G.run.biome * .3)), e.g.position.clone().add(V(0, e.h, 0)));
  if (!e.minion) { dropGold(e.g.position, Math.round(rand(3, 7) * {normal: 1, elite: 5, mini: 12, boss: 30}[e.tier])); if (Math.random() < (e.elite ? .6 : .12)) dropGlobe(e.g.position); }
}

// ---------- telegraphs & attacks ----------
function lineMarker(p, dir, len, w, dur) {
  sfx('warn', {}, .1);
  const m = glow(0xff3a2a, 1.6, {add: true, ds: true}), mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, len), m);
  mesh.rotation.set(-Math.PI / 2, 0, -Math.atan2(dir.x, dir.z) + Math.PI); mesh.position.set(p.x + dir.x * len / 2, .07, p.z + dir.z * len / 2); G.scene.add(mesh);
  fx(dur, k => { m.opacity = .15 + k * .55 + Math.sin(k * 40) * .08; }, () => { G.scene.remove(mesh); m.dispose(); mesh.geometry.dispose(); });
}
function meleeHit(e, h, mult = 1, reach = 2.2, delay = .45) {
  if (e.drv) dplay(e.drv, Math.random() < .5 ? 'e_atk1' : 'e_atk2', true, e.boss ? 1.1 : 1.3);
  else { e.st.lunge = .25; }
  after(delay, () => { if (alive(e) && e.frozen <= 0 && !(e.stun > 0) && dist2(e.g.position, h.g.position) < e.radius + reach) { hurtHero(e.dmg * mult, e); parts.burst(center(h), 10, {col: C.red, b: 3, speed: 3, life: .3, size: .2}); if (hasAffix(e, 'Vampiric')) { e.hp = Math.min(e.max, e.hp + e.dmg * 2); } } });
}
function enemyShot(e, h, spec, lead = true) {
  const from = center(e), hp = h.g.position, T = lead ? hp.clone().addScaledVector(h.vel, .35) : hp.clone(); T.y = 1;
  const dir = T.clone().sub(from); dir.y *= .2; dir.normalize();
  const s = glowSprite(spec.col, 4, e.boss ? 1.4 : .9); s.position.copy(from); G.scene.add(s); const pc = PC[spec.pc] || C.void;
  fx(3.5, (k, dt) => {
    s.position.addScaledVector(dir, spec.speed * dt); parts.emit(s.position.x, s.position.y, s.position.z, 0, 0, 0, pc, 3, .3, .2);
    if (!G.map.walkable(s.position.x, s.position.z)) return true;
    if (dist2(s.position, h.g.position) < .7) { hurtHero(e.dmg, e, {chill: spec.chill, ranged: true}); if (spec.burn) addHazard(h.g.position.clone().setY(0), 1, e.dmg * .8, 'enemy', 2); return true; }
  }, () => { G.scene.remove(s); s.material.dispose(); });
}
function blowUp(e, self) { // bomber explosion: hurts you AND the enemies around it
  e.st.blown = true; const P = e.g.position.clone(), R = 2.8;
  shockwave(P, 0xff5a1a, R * 1.2, .45, 5); flashLight(V(P.x, 1, P.z), 0xff6a20, 100, .5, 9); G.shake = Math.max(G.shake, .3);
  parts.burst(V(P.x, .5, P.z), 90, {cols: [C.fire, C.gold, C.ember], b: 5, speed: 8, life: .6, size: .35});
  if (dist2(G.hero.g.position, P) < R) hurtHero(e.dmg * 2.6, null);
  for (const o of G.enemies) if (o !== e && alive(o) && dist2(o.g.position, P) < R + o.radius) damage(o, 45, {col: '#ffa048', dir: V(o.g.position.x - P.x, 0, o.g.position.z - P.z), knock: 6});
  if (self) { e.hp = 0; G.onKill(e); }
}
function spawnNear(id, p, n) {
  for (let k = 0; k < n; k++) { const a = rand(0, TAU), q = p.clone().add(V(Math.cos(a) * 1.5, 0, Math.sin(a) * 1.5)); if (G.map.walkableCircle(q.x, q.z, .3)) { const m = spawnMob(id, q, 'normal'); m.aggro = true; } }
}

// ---------- behaviours ----------
// Each returns a desired move direction (or null) for this frame and may start attacks. ctx: {d, to, dir, sees, approach()}
const BEH = {
  brute(e, h, dt, c) { if (c.d > e.radius + 1.3) return c.approach(); if (e.atkT <= 0) { e.atkT = rand(1.3, 1.9); meleeHit(e, h); } return null; },
  swarm(e, h, dt, c) { if (c.d > e.radius + 1) return c.approach(); if (e.atkT <= 0) { e.atkT = rand(.9, 1.3); meleeHit(e, h, 1, 1.6, .2); } return null; },
  charger(e, h, dt, c) {
    const st = e.st;
    if (st.mode === 'wind') { e.busy = true; st.t -= dt; e.g.rotation.y = Math.atan2(st.dir.x, st.dir.z); if (Math.random() < .5) parts.emit(e.g.position.x, .2, e.g.position.z, rand(-1, 1), rand(.5, 1.5), rand(-1, 1), C.red, 2, .4, .25); if (st.t <= 0) { st.mode = 'dash'; st.t = .6; st.hit = false; e.unstopAct = 'dash'; if (e.drv) dplay(e.drv, 'e_atk2', true, 1.6); } return null; }
    if (st.mode === 'dash') {
      st.t -= dt; const before = e.g.position.clone(); moveEnt(e, st.dir.x * 17 * dt, st.dir.z * 17 * dt, e.radius * .8);
      if (!st.hit && dist2(e.g.position, h.g.position) < e.radius + .9) { st.hit = true; hurtHero(e.dmg * 2, e); h.vel.addScaledVector(st.dir, 12); G.shake = Math.max(G.shake, .3); }
      if (dist2(before, e.g.position) < 17 * dt * .3) { st.mode = 'walk'; st.cd = 4; e.unstopAct = null; e.stun = 1.6; e.busy = false; shockwave(e.g.position, 0xffffff, 2, .3, 3); G.shake = Math.max(G.shake, .25); G.toast && G.toast(`${e.typeName} stunned!`); return null; }
      if (st.t <= 0) { st.mode = 'walk'; st.cd = 4; e.busy = false; e.unstopAct = null; }
      return null;
    }
    if (c.sees && c.d < 10 && c.d > 3 && st.cd <= 0) { st.mode = 'wind'; st.t = .85; st.dir = c.dir.clone(); lineMarker(e.g.position, st.dir, 12, e.radius * 2.4, .85); return null; }
    return BEH.brute(e, h, dt, c);
  },
  caster(e, h, dt, c) {
    const D = e.D;
    if (e.atkT <= 0 && c.sees && c.d < 11) { e.atkT = rand(2, 2.6) * (e.boss ? .6 : 1); e.st.cast = .35; if (e.drv) dplay(e.drv, 'e_atk2', true, 1.6); after(.35, () => { if (alive(e) && !(e.stun > 0) && e.frozen <= 0) { enemyShot(e, h, D.shot || {col: 0xc050ff, pc: 'void', speed: 9}); if (e.boss || e.elite) after(.2, () => alive(e) && enemyShot(e, h, D.shot, false)); } }); }
    if (c.d < 4.5) return c.dir.clone().negate(); if (c.d > 9 || !c.sees) return c.approach();
    return V(-c.dir.z, 0, c.dir.x).multiplyScalar(Math.sin(G.time * .8 + e.seed) > 0 ? .5 : -.5);
  },
  bomber(e, h, dt, c) {
    const st = e.st;
    if (st.fuse > 0) { st.fuse -= dt; e.busy = true; e.flash = Math.abs(Math.sin(st.fuse * 25)); if (st.fuse <= 0) blowUp(e, true); return null; }
    if (c.d < e.radius + 1.3) { st.fuse = .9; marker(e.g.position.clone(), 2.8, 0xff3a2a, .9); return null; }
    return c.approach();
  },
  guardian(e, h, dt, c) { e.turnRate = 1.8; if (c.d > e.radius + 1.5) return c.approach(); if (e.atkT <= 0) { e.atkT = rand(2.2, 2.8); meleeHit(e, h, 1.3, 2.6, .6); } return null; },
  healer(e, h, dt, c) {
    const st = e.st; st.cd -= dt;
    if (st.heal) { st.heal.t -= dt; e.busy = true; if (e.stun > 0 || e.frozen > 0) { st.heal = null; e.busy = false; G.toast && G.toast('Heal interrupted!'); return null; }
      if (Math.random() < .6) parts.emit(e.g.position.x + rand(-.5, .5), rand(.2, 2), e.g.position.z + rand(-.5, .5), 0, 1, 0, C.green, 3, .5, .2);
      if (st.heal.t <= 0) { const t = st.heal.target; if (alive(t)) { t.hp = Math.min(t.max, t.hp + t.max * .3); bolt(center(e), center(t), .4, 0x7dff8a); parts.burst(center(t), 30, {col: C.green, b: 4, speed: 3, life: .6, size: .25, up: 2}); } st.heal = null; e.busy = false; st.cd = 4.5; } return null; }
    if (st.cd <= 0) {
      let t = null, lo = .9; for (const o of G.enemies) if (o !== e && alive(o) && o.hp / o.max < lo && dist2(o.g.position, e.g.position) < 10) { lo = o.hp / o.max; t = o; }
      if (t) { st.heal = {t: 1, target: t}; marker(e.g.position.clone(), 1.2, 0x5aff7a, 1); if (e.drv) dplay(e.drv, 'e_atk2', true, 1); return null; }
      st.cd = 1;
    }
    if (e.atkT <= 0 && c.sees && c.d < 10) { e.atkT = 3; enemyShot(e, h, {col: 0x9fdcff, pc: 'ice', speed: 8, chill: 1.5}); }
    if (c.d < 5) return c.dir.clone().negate(); if (c.d > 9 || !c.sees) return c.approach(); return null;
  },
  summoner(e, h, dt, c) {
    const st = e.st; st.cd -= dt;
    if (st.cast > 0) { st.cast -= dt; e.busy = true; if (e.stun > 0 || e.frozen > 0) { st.cast = 0; e.busy = false; return null; } if (st.cast <= 0) { e.busy = false; spawnNear(e.D.summon, e.g.position, 2); st.cd = 6; } return null; }
    if (st.cd <= 0 && G.enemies.filter(o => o.minion && alive(o)).length < 6) { st.cast = .8; marker(e.g.position.clone(), 1.6, 0xb050ff, .8); if (e.drv) dplay(e.drv, 'e_atk2', true, 1); return null; }
    if (c.d < 5) return c.dir.clone().negate(); if (c.d > 9 || !c.sees) return c.approach(); return null;
  },
  leaper(e, h, dt, c) {
    const st = e.st;
    if (st.mode === 'leap') return null;
    if (c.sees && c.d > 3.5 && c.d < 11 && st.cd <= 0) {
      st.mode = 'leap'; st.cd = 5; const A = e.g.position.clone(), B = h.g.position.clone().setY(0), LR = e.boss ? 3.4 : 2.3; marker(B, LR, 0xff3a2a, 1.1); e.busy = true;
      after(.5, () => { if (!alive(e) || e.stun > 0 || e.frozen > 0) { st.mode = 'walk'; e.busy = false; return; } e.unstopAct = 'leap'; if (e.drv) dplay(e.drv, 'e_atk1', true, 1.1);
        fx(.6, k => { e.g.position.lerpVectors(A, B, k); e.g.position.y = Math.sin(k * Math.PI) * 3; }, () => {
          e.g.position.y = 0; st.mode = 'walk'; e.busy = false; e.unstopAct = null; if (!G.map.walkable(e.g.position.x, e.g.position.z)) e.g.position.copy(A);
          shockwave(B, 0x9fdcff, 2.8, .4, 4); G.shake = Math.max(G.shake, .25); parts.burst(V(B.x, .3, B.z), 50, {cols: G.biome.deathCols, b: 3, speed: 6, life: .5, size: .3, flat: true});
          if (alive(e) && dist2(h.g.position, B) < LR) hurtHero(e.dmg * 1.8, e);
        }); });
      return null;
    }
    return BEH.brute(e, h, dt, c);
  },
  turret(e, h, dt, c) {
    const st = e.st; st.cd -= dt; st.pulse = Math.max(0, (st.pulse || 0) - dt * 2);
    if (st.cd <= 0 && c.d < 9) {
      st.cd = 3.4; const P = e.g.position.clone(), R = 4.5; marker(P, R, 0x9aff3a, 1);
      after(1, () => { if (!alive(e) || e.stun > 0 || e.frozen > 0) return; st.pulse = 1; shockwave(P, 0x9aff3a, R, .5, 3);
        for (let k = 0; k < 60; k++) { const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R; parts.emit(P.x + Math.cos(a) * r, rand(.2, 1.2), P.z + Math.sin(a) * r, 0, rand(.2, .8), 0, C.green, 2, rand(.6, 1.2), rand(.3, .6)); }
        if (dist2(h.g.position, P) < R) hurtHero(e.dmg * 1.4, null, {ranged: true}); });
    }
    return null;
  },
  blinker(e, h, dt, c) {
    const st = e.st;
    if (st.nova > 0) { st.nova -= dt; e.busy = true; if (e.stun > 0 || e.frozen > 0) { st.nova = 0; e.busy = false; return null; }
      if (st.nova <= 0) { e.busy = false; const P = e.g.position.clone(); shockwave(P, 0xc070ff, 3.4, .45, 4); parts.burst(V(P.x, 1, P.z), 70, {cols: [C.void, C.pink], b: 4, speed: 7, life: .5, size: .3}); if (dist2(h.g.position, P) < 3.2) hurtHero(e.dmg * 1.8, e); st.cd = 5; } return null; }
    if (st.cd <= 0 && c.d < 14) {
      for (let k = 0; k < 8; k++) { const a = rand(0, TAU), q = h.g.position.clone().add(V(Math.cos(a) * 2.6, 0, Math.sin(a) * 2.6)); if (G.map.walkableCircle(q.x, q.z, e.radius)) {
        parts.burst(center(e), 40, {cols: [C.void, C.pink], b: 4, speed: 4, life: .4, size: .25}); e.g.position.copy(q); parts.burst(center(e), 40, {cols: [C.void, C.pink], b: 4, speed: 4, life: .4, size: .25});
        st.nova = 1.1; marker(q, 3.2, 0xc050ff, 1.1); if (e.drv) dplay(e.drv, 'e_atk2', true, .9); return null; } }
      st.cd = 1;
    }
    if (c.d > 7 || !c.sees) return c.approach(); return null;
  },
  boss(e, h, dt, c) {
    const st = e.st; st.cd2 -= dt;
    // phase changes at 66% and 33% (a la Diablo IV / Lost Ark): the boss roars, becomes unstaggerable and blasts everything around it
    if (st.phaseT > 0) { st.phaseT -= dt; e.busy = true; if (st.phaseT <= 0) phaseBlast(e, h); return null; }
    for (const [th, n] of [[.66, 1], [.33, 2]]) if ((st.phase || 0) < n && e.hp < e.max * th) {
      st.phase = n; st.phaseT = 1.6; e.unstopAct = 'phase'; e.busy = true; e.stun = 0; e.staggered = 0; sfx('roar'); G.toast && G.toast(n === 2 ? `${e.name} is enraged!` : `${e.name} roars!`);
      marker(e.g.position.clone(), 7.5, 0xff2a2a, 1.6); flashLight(center(e), 0xff2a2a, 120, 1.6, 12); if (e.drv) dplay(e.drv, 'e_atk2', true, .8); return null;
    }
    if (st.cd <= 0 && c.d < 12) { // telegraphed slam
      st.cd = st.phase === 2 ? 4.5 : 6.5; const P = h.g.position.clone().setY(0), R = 3.6; marker(P, R, 0xff2a2a, 1.3);
      if (e.drv) after(.5, () => dplay(e.drv, 'e_atk2', true, 1.2));
      after(1.3, () => { if (!alive(e) || e.staggered > 0) return; shockwave(P, 0xff4a2a, R * 1.3, .5, 4); G.shake = Math.max(G.shake, .5); flashLight(V(P.x, 1, P.z), 0xff5a2a, 120, .5, 10);
        parts.burst(V(P.x, .3, P.z), 120, {cols: G.biome.deathCols, b: 4, speed: 9, life: .7, size: .35, flat: true}); if (dist2(h.g.position, P) < R) hurtHero(e.dmg * 2.2, e); });
    }
    if (st.cd2 <= 0) { st.cd2 = 14; const adds = G.biome.roster.filter(r => !MOBS[r[0]].minion && MOBS[r[0]].beh !== 'turret'); spawnNear(rollMob(G.biome, adds), e.g.position, 2); G.toast && G.toast('Reinforcements!'); }
    // each biome's boss fights with its own mob's moves plus a signature ability
    const sp = G.biome.bossSpecial; st.sp = (st.sp ?? 5) - dt;
    if (sp === 'molten') { st.trail = (st.trail || 0) - dt; if (st.trail <= 0 && e.moving) { st.trail = .35; addHazard(e.g.position.clone().setY(0), 1.4, e.dmg * .6, 'enemy', 5); } if (st.sp <= 0) { st.sp = 9; for (let k = 0; k < 5; k++) { const P = h.g.position.clone().add(V(rand(-4, 4), 0, rand(-4, 4))).setY(0); marker(P, 1.8, 0xff4020, 1.2); after(1.2, () => { if (!alive(e) || e.staggered > 0) return; shockwave(P, 0xff6a20, 2.2, .4, 4); parts.burst(V(P.x, .5, P.z), 40, {cols: [C.fire, C.gold], b: 5, speed: 6, life: .5, size: .3}); if (dist2(h.g.position, P) < 1.8) hurtHero(e.dmg * 1.4, e); addHazard(P, 1.2, e.dmg * .5, 'enemy', 3); }); } } }
    if (sp === 'howl' && st.sp <= 0) { st.sp = 12; shockwave(e.g.position, 0x9fdcff, 7, .7, 3); G.toast && G.toast(`${e.name} howls!`); if (dist2(h.g.position, e.g.position) < 7) h.slowT = Math.max(h.slowT, 2.5); spawnNear('rimestalker', e.g.position, 2); }
    if (sp === 'spores') { if (st.sp <= 0) { st.sp = 6; const P = e.g.position.clone(), R = 6; marker(P, R, 0x9aff3a, 1.2); after(1.2, () => { if (!alive(e) || e.staggered > 0) return; shockwave(P, 0x9aff3a, R, .6, 3); for (let k = 0; k < 90; k++) { const a = rand(0, TAU), r = Math.sqrt(Math.random()) * R; parts.emit(P.x + Math.cos(a) * r, rand(.2, 1.4), P.z + Math.sin(a) * r, 0, rand(.2, .8), 0, C.green, 2, rand(.6, 1.2), rand(.3, .6)); } if (dist2(h.g.position, P) < R) hurtHero(e.dmg * 1.3, null, {ranged: true}); }); } }
    if (sp === 'beams' && st.sp <= 0) { st.sp = 7; for (let k = 0; k < 8; k++) after(k * .12, () => { if (!alive(e) || e.staggered > 0) return; const a = k / 8 * TAU + G.time; const s = {col: 0xd070ff, pc: 'void', speed: 8}; enemyShotDir(e, V(Math.cos(a), 0, Math.sin(a)), s); }); }
    return BEH[e.D.beh === 'brute' || e.D.beh === 'swarm' ? 'brute' : e.D.beh](e, h, dt, c);
  },
};
function phaseBlast(e, h) {
  e.busy = false; e.unstopAct = null; const P = e.g.position.clone(), R = 7.5;
  shockwave(P, 0xff3a2a, R * 1.1, .7, 5); shockwave(P, 0xffffff, R * .6, .5, 3); G.shake = Math.max(G.shake, .7); flashLight(center(e), 0xff4a2a, 220, .7, 16); sfx('bigboom');
  parts.burst(V(P.x, .5, P.z), 200, {cols: G.biome.deathCols, b: 5, speed: 12, life: .8, size: .4, flat: true});
  if (dist2(h.g.position, P) < R) hurtHero(e.dmg * 2.4, e);
  const adds = G.biome.roster.filter(r => !MOBS[r[0]].minion && MOBS[r[0]].beh !== 'turret'); spawnNear(rollMob(G.biome, adds), P, 3);
  if (e.st.phase === 2) { e.speed *= 1.3; e.st.cd2 = 10; }
}
// elite affix abilities
function affixUpdate(e, h, dt, d) {
  const st = e.st;
  if (hasAffix(e, 'Frozen') && (st.frz = (st.frz ?? rand(2, 4)) - dt) <= 0 && d < 14) { // frost orbs that burst and chill
    st.frz = 6;
    for (let k = 0; k < 3; k++) { const P = h.g.position.clone().add(V(rand(-2.5, 2.5), 0, rand(-2.5, 2.5))).setY(0); if (!G.map.walkable(P.x, P.z)) continue;
      marker(P, 1.7, 0x9fdcff, 1.5); const o = glowSprite(0xbfe8ff, 4, 1.1); o.position.set(P.x, .8, P.z); G.scene.add(o);
      fx(1.5, q => o.scale.setScalar(.6 + q * .8 + Math.sin(q * 30) * .1), () => { G.scene.remove(o); o.material.dispose(); if (!alive(e)) return;
        shockwave(P, 0x9fdcff, 2.2, .4, 4); parts.burst(V(P.x, .6, P.z), 40, {cols: [C.ice, C.white], b: 4, speed: 6, life: .5, size: .25}); if (dist2(h.g.position, P) < 1.7) hurtHero(e.dmg * .9, e, {chill: 2.5, ranged: true}); }); }
  }
  if (hasAffix(e, 'Mortar') && (st.mor = (st.mor ?? rand(1, 3)) - dt) <= 0 && d < 15 && d > 2.5) { // lobbed bombs
    st.mor = 3.2; const A = center(e), P = h.g.position.clone().addScaledVector(h.vel, .5).setY(0); if (G.map.walkable(P.x, P.z)) {
      marker(P, 1.9, 0xffa040, 1.2); const b = glowSprite(0xffa040, 4, 1); G.scene.add(b);
      fx(1.2, q => { b.position.lerpVectors(A, P, q); b.position.y = A.y * (1 - q) + Math.sin(q * Math.PI) * 5; }, () => { G.scene.remove(b); b.material.dispose();
        shockwave(P, 0xffa040, 2.4, .4, 4); parts.burst(V(P.x, .4, P.z), 50, {cols: [C.fire, C.gold], b: 5, speed: 7, life: .5, size: .3}); sfx('boom', {}, .1); if (dist2(h.g.position, P) < 1.9) hurtHero(e.dmg * 1.2, null, {ranged: true}); }); }
  }
  if (hasAffix(e, 'Shielding')) { // periodic invulnerable bubble: wait it out or deal with its friends
    if ((st.shl = (st.shl ?? rand(3, 6)) - dt) <= 0) { st.shl = 9; e.immune = 2.5; if (!e.bubble) { const m = glow(0xfff2a8, .6, {add: true}); m.opacity = .12; e.bubble = add(e.g, new THREE.SphereGeometry(1, 20, 14), m, 0, e.cy, 0); e.bubble.scale.setScalar(e.radius + .9); } e.bubble.visible = true; sfx('block'); }
    if (e.immune > 0) { e.immune -= dt; if (e.immune <= 0 && e.bubble) e.bubble.visible = false; }
  }
  if (hasAffix(e, 'Teleporter') && (st.tp = (st.tp ?? rand(3, 5)) - dt) <= 0 && d > 5 && !e.busy) {
    st.tp = 5.5; for (let k = 0; k < 8; k++) { const a = rand(0, TAU), q = h.g.position.clone().add(V(Math.cos(a) * 2.2, 0, Math.sin(a) * 2.2)); if (G.map.walkableCircle(q.x, q.z, e.radius)) {
      parts.burst(center(e), 40, {cols: [C.void, C.pink], b: 4, speed: 4, life: .4, size: .25}); e.g.position.copy(q); e.vel.set(0, 0, 0); parts.burst(center(e), 40, {cols: [C.void, C.pink], b: 4, speed: 4, life: .4, size: .25}); e.atkT = Math.max(e.atkT, .5); break; } }
  }
}
function enemyShotDir(e, dir, spec) {
  const from = center(e), s = glowSprite(spec.col, 4, 1.1); s.position.copy(from); G.scene.add(s); const h = G.hero;
  fx(4, (k, dt) => { s.position.addScaledVector(dir, spec.speed * dt); parts.emit(s.position.x, s.position.y, s.position.z, 0, 0, 0, C.void, 3, .3, .2);
    if (!G.map.walkable(s.position.x, s.position.z)) return true; if (dist2(s.position, h.g.position) < .75) { hurtHero(e.dmg * .8, e, {ranged: true}); return true; } }, () => { G.scene.remove(s); s.material.dispose(); });
}

// ---------- per-frame update ----------
export function enemyUpdate(e, dt, t) {
  const g = e.g, h = G.hero;
  if (e.dead > 0) {
    e.dead -= dt; if (e.drv) { e.drv.once = 1; driveUpdate(e, dt); }
    if (e.dead < .6) { g.scale.setScalar(Math.max(.001, e.dead / .6 * (g.userData.s0 || 1))); g.position.y -= dt * .8; }
    if (e.dead <= 0) { G.scene.remove(g); e.gone = true; }
    return;
  }
  if (e.spawn < 1) { e.spawn = Math.min(1, e.spawn + dt * 2.5); const s = e.spawn; g.userData.s0 = 1; g.scale.setScalar(Math.max(.001, 1 + 2.7 * Math.pow(s - 1, 3) + 1.7 * Math.pow(s - 1, 2))); }
  const H = h.g.position, to = V(H.x - g.position.x, 0, H.z - g.position.z), d = to.length(), dir = d > 1e-4 ? to.clone().divideScalar(d) : V(0, 0, 1);
  if (h.stealth > 0) e.aggro = false;
  else if (!e.aggro && !h.dead && d < 11 && G.map.los(g.position, H, .1)) { e.aggro = true; for (const o of G.enemies) if (!o.aggro && dist2(o.g.position, g.position) < 6) o.aggro = true; }
  e.atkT -= dt; e.st.cd -= dt; e.stun = (e.stun || 0) - dt; e.weak = (e.weak || 0) - dt; e.chill = (e.chill || 0) - dt; e.rooted = (e.rooted || 0) - dt; e.mark = (e.mark || 0) - dt; if (e.dmark > 0) e.dmark -= dt; e.shieldHit = Math.max(0, (e.shieldHit || 0) - dt); ccUpdate(e, dt);
  const held = e.frozen > 0 || e.stun > 0 || e.rooted > 0, slow = e.chill > 0 ? .55 : 1;
  let want = null;
  if (e.aggro && !held && !h.dead) {
    const sees = d < 14 && G.map.los(g.position, H, .15);
    const approach = () => {
      if (sees) return dir.clone();
      if (!G.flow) return null; const [i, j] = G.map.cellOf(g.position.x, g.position.z); let best = null, bd = G.flow[G.map.idx(i, j)];
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) { const ni = i + di, nj = j + dj; if (!G.map.floor(ni, nj)) continue; const v = G.flow[G.map.idx(ni, nj)]; if (v >= 0 && (bd < 0 || v < bd)) { bd = v; best = [ni, nj]; } }
      if (!best) return null; const cc = G.map.center(best[0], best[1]); return V(cc.x - g.position.x, 0, cc.z - g.position.z).normalize();
    };
    want = BEH[e.beh](e, h, dt, {d, to, dir, sees, approach});
    if (!e.busy) g.rotation.y = lerpAngle(g.rotation.y, Math.atan2(to.x, to.z), Math.min(1, dt * (e.turnRate || 6)));
    if (e.affixes.length) affixUpdate(e, h, dt, d);
    if (hasAffix(e, 'Molten')) { e.moltT = (e.moltT || 0) - dt; if (e.moltT <= 0) { e.moltT = .8; addHazard(g.position.clone().setY(0), 1, e.dmg, 'enemy', 3); } }
  } else if (held && e.st.mode === 'wind') { e.st.mode = 'walk'; e.busy = false; }
  if (want && !e.anchored) e.vel.addScaledVector(want, dt * e.speed * slow * 5);
  if (!e.anchored) {
    for (const o of G.enemies) { if (o === e || !alive(o)) continue; const dx = g.position.x - o.g.position.x, dz = g.position.z - o.g.position.z, dd = dx * dx + dz * dz, rr = (e.radius + o.radius) * 1.2; if (dd < rr * rr && dd > 1e-4) { e.vel.x += dx / dd * dt * 2; e.vel.z += dz / dd * dt * 2; } }
    const vmax = e.speed * slow * (held ? 0 : 1), vl = e.vel.length(); if (vl > vmax + 4) e.vel.setLength(vmax + 4);
    e.vel.multiplyScalar(1 - Math.min(1, dt * (held ? 8 : 5)));
    if (e.st.mode !== 'dash' && e.st.mode !== 'leap') moveEnt(e, e.vel.x * dt, e.vel.z * dt, e.radius * .8);
  } else e.vel.set(0, 0, 0);
  e.moving = e.vel.length() > .4;
  const baseY = e.st.mode === 'leap' ? g.position.y : 0; if (e.st.mode !== 'leap') g.position.y = baseY;
  if (e.st.lunge > 0) { e.st.lunge -= dt; }
  if (e.frozen > 0) { e.frozen -= dt; if (Math.random() < .3) { const c = center(e); parts.emit(c.x + rand(-.4, .4), c.y + rand(-.4, .4), c.z + rand(-.4, .4), 0, .2, 0, C.ice, 2, .6, .12); } }
  else { if (e.drv) driveUpdate(e, dt); if (e.wanim) e.wanim(t, e.seed, e); }
  if (e.poison && e.poison.t > 0) { e.poison.t -= dt; e.poison.tick -= dt; if (Math.random() < .25) { const c = center(e); parts.emit(c.x + rand(-.3, .3), c.y, c.z + rand(-.3, .3), 0, rand(.3, .8), 0, C.green, 2.5, .6, .15); } if (e.poison.tick <= 0) { e.poison.tick = .5; damage(e, e.poison.stacks * 1.6, {noCrit: true, dot: true, col: '#a8ff7a'}); } if (e.poison.t <= 0) e.poison.stacks = 0; }
  if (e.burn > 0) { e.burn -= dt; e.burnT -= dt; const c = center(e); parts.emit(c.x + rand(-.3, .3), c.y + rand(-.3, .4), c.z + rand(-.3, .3), 0, rand(.8, 1.8), 0, C.fire, 4, .5, .22, -.5, 1); if (e.burnT <= 0) { e.burnT = .5; damage(e, 6, {noCrit: true, dot: true, col: '#ff9a3c'}); } }
  if (e.shieldMesh) { const up = !(e.stun > 0) && !(e.frozen > 0); e.shieldMesh.visible = up; e.shieldMesh.material.opacity = .35 + e.shieldHit * 2; }
  e.flash = Math.max(0, e.flash - dt * 5);
  e.mats.forEach((m, i) => {
    const b = e.base[i]; m.emissive.copy(b.e); m.emissiveIntensity = b.i;
    if (e.frozen > 0) { m.emissive.setRGB(.2, .5, .9); m.emissiveIntensity = Math.max(b.i, .35); }
    else if (e.chill > 0) { m.emissive.setRGB(.1, .25, .45); m.emissiveIntensity = Math.max(b.i, .3); }
    if (e.staggered > 0) { m.emissive.setRGB(.4, .28, .05); m.emissiveIntensity = Math.max(b.i, (.15 + Math.abs(Math.sin(t * 6)) * .15) * (e.drv ? 1 : 2)); }
    else if (e.unstop > 0 && !e.boss) { m.emissive.lerp(new THREE.Color(.55, .35, .05), .6); m.emissiveIntensity = Math.max(m.emissiveIntensity, .3); }
    if (e === G.hover || e === G.padTarget) { m.emissive.lerp(C.red, .5); m.emissiveIntensity = Math.max(m.emissiveIntensity, .35); }
    if (e.flash > 0) { m.emissive.lerp(C.white, e.flash); m.emissiveIntensity = Math.max(m.emissiveIntensity, e.flash * (e.drv ? .35 : 1.5)); }
  });
  if (e.ring) e.ring.rotation.z += dt;
  if (e.staggered > 0 && Math.random() < .5) { const c = g.position, a = t * 5 + rand(0, TAU); parts.emit(c.x + Math.cos(a) * .7, e.h + .3, c.z + Math.sin(a) * .7, 0, .3, 0, C.gold, 3, .5, .18); }
  const show = G.map.seen(g.position.x, g.position.z) && (e.hp < e.max || e.elite);
  if (show) { place(e.bar, g.position.clone().add(V(0, e.h + .3, 0))); e.bar.lastChild.firstChild.style.width = Math.max(0, e.hp / e.max * 100) + '%'; } else e.bar.style.display = 'none';
  if (e.hp <= 0) G.onKill(e);
}
export const weakText = e => { const w = WEAK[e.elem], r = RESIST[e.elem]; return (w ? `Weak: ${ELEM[w].name}` : '') + (r ? ` · Resists: ${r.map(x => ELEM[x].name).join(', ')}` : ''); };
