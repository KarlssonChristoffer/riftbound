// BUILDS (docs/BUILDING.md): the things a player sets down in the persistent world, through one path: the pack panel's Build list
// (content/builds.js: a campfire, a Stone Fire Ring, a Crystal Lamp) puts one down ahead of him (a free spot: no wall, nothing
// standing within its room), offline in his save, online by asking the server (act 'build'), which keeps it for everyone and a
// late joiner. A fire's fuel is part of the build (fuel s of fire at t0, burning since: content/builds.js fuelAt), so a log one
// player adds burns for everyone (act 'stoke'); the fires themselves (flames, their light, E adds a log, cooking) are
// features/campfires.js's. A lamp is this feature's: a steady cold light; E by your own takes it back (its cost back; act
// 'unbuild'). Only in the persistent world (the sandbox's ruins biome), the cave included.
// CO-OP (features/coop.js, server/room.mjs, docs/MULTIPLAYER.md): the server's word comes in coop.mail ({k: 'world', id: 'b' + n,
// s: built | stoked | gone, kind, x, y, by, fuel, t0}); a build is paid for when the server says it stands (by: him), a log when it
// says it burns. The fires' clock online is the server's (C.serverNow), offline this feature's own (the sim's seconds).
// OWNS: the builds (their entities: props of kind content/builds.js prop), their meshes, the lamps' light records, the saved part
//   (pack.store('builds'): {n, list: [{id, kind, x, y, fuel}]}), the recipes of the group Build.
// READS: content/builds.js, pack (the pouch, the store), coop (online, act, mail, net), host.entities (near: room), host.elev,
//   host.blocked, host.inStream. EMITS: build.add, build.remove.
// API: F.list (id -> build {id, kind, def, x, y, z, by, fuel, t0, p}), F.now() (the fires' clock, s), F.fire(b) -> {fuel, ember}
//   (s left), F.stoke(b) -> '' | why not (a log on a fire), F.mine(b), F.ver (changes with the list). F.shining(out) -> out [{x, y}]:
//   where a lamp stands or a fire burns now (the cave's soot things keep away, a night vein hides: features/cavelife.js, mining.js);
//   F.shineNear(x, y, r): one within r m
// BUDGET: sim: the mail (a few messages), a save every 5 s while a fire burns. View: a mesh per build made once; the lamps'
//   lights (a record each, reused).
import * as THREE from 'three';
import {BUILDS, TUNE, fuelAt, emberAt, stokeFuel} from '../content/builds.js';
import {ITEMS} from '../content/items.js';
import {flags} from '../core/flags.js';
import {propTop} from '../world/world.js';
import {setMaterials} from '../content/materials.js';
import {geoOf, M4, along} from '../world/kit3d.js';

const ON = flags.get('builds') !== '0' && flags.get('campfires') !== '0';
propTop({pitfire: .3, firering: .25, crystallamp: .75});
setMaterials({pitfire: 'stone', firering: 'stone', crystallamp: 'stone'});

// ORDER (core/features.js): before the campfires (they read the fires in the list) and the lights; it reads co-op's mail a step
// after it came (coop is later in the order), like foraging and mining
export const order = {before: ['campfires', 'lights']};

export async function create(host) {
  const pack = () => host.feature('pack'), game = () => host.feature('game'), ui = () => game()?.ui || null, coop = () => host.feature('coop');
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const online = () => !!coop()?.online;
  const me = () => online() ? coop().net?.id : 0;
  const store = () => { const s = pack()?.store('builds'); if (s) { s.list ??= []; s.n ??= 0; } return s; };
  const list = new Map();   // id -> {id, kind, def, x, y, z, by, fuel, t0, p, mesh}
  const NEAR = [];
  let T = 0, ver = 0, was = false, wasOnline = false, offered = false, saveT = 0;
  const now = () => online() ? (coop().net?.serverNow?.() ?? 0) / 1000 : T;

  // ---------------------------------------------------------------- the list: add / remove (props through the registry)
  function add(id, kind, x, y, by, fuel = 0, t0 = now()) {
    const def = BUILDS[kind]; if (!def || list.has(id)) return null;
    const z = host.elev(x, y), p = {kind: def.prop, x, y, z, r: def.r, interact: 'build', build: id};
    host.entities.add(p);
    const b = {id, kind, def, x, y, z, by, fuel, t0, p, mesh: null};
    list.set(id, b); ver++;
    return b;
  }
  function drop(id) {
    const b = list.get(id); if (!b) return;
    host.entities.remove(b.p); b.mesh?.dispose?.(); list.delete(id); ver++;
  }
  function clear() { for (const id of [...list.keys()]) drop(id); }
  // offline: the save (each fire's fuel left now; read back burning from this session's clock)
  function save() {
    const s = store(); if (!s || online()) return;
    s.list = [...list.values()].map(b => ({id: b.id, kind: b.kind, x: +b.x.toFixed(2), y: +b.y.toFixed(2), ...(b.def.fire ? {fuel: Math.round(fuelAt(b, T)), ember: Math.round(emberAt(b, T, b.def))} : {})}));
    pack()?.dirty();
  }
  function restore() {
    const s = store(); if (!s) return;
    const old = pack()?.store('camp');   // (a world saved before builds had their own path: features/campfires.js's fires, moved here once)
    if (old?.fires?.length) { for (const o of old.fires) s.list.push({id: 'o' + (++s.n), kind: 'campfire', x: o.x, y: o.y, fuel: o.fuel || 0, ember: o.ember || 0}); old.fires = []; pack()?.dirty(); }
    for (const o of s.list) {
      const def = BUILDS[o.kind]; if (!def) continue;
      // (a fire saved as embers: its fuel run out ember s before the end of their time)
      const t0 = def.fire && !(o.fuel > 0) && o.ember > 0 ? T - (def.fire.embers - o.ember) : T;
      add(o.id, o.kind, o.x, o.y, 0, o.fuel || 0, t0);
    }
  }

  // ---------------------------------------------------------------- placing: ahead of him, clear of walls and of anything standing
  let why = '';
  function spot(def) {
    const P = host.player, a = P.faceAngle, x = P.x + Math.sin(a) * TUNE.ahead, y = P.y + Math.cos(a) * TUNE.ahead, z = host.elev(x, y);
    why = '';
    let mine = 0; for (const b of list.values()) if (b.def === def && b.by === me()) mine++;
    if (mine >= def.most) { why = `${def.most} stand already`; return null; }
    if (host.blocked(x, y, z) || Math.abs(z - P.z) > .5 || host.inStream?.(x, y)) { why = 'no room here'; return null; }
    for (const q of host.entities.near(x, y, def.room + .8, NEAR)) {
      if (q.gone || q.broken || q.outside || q.hunter || !(q.r > 0)) continue;   // (a plant, a tuft: no collider, no matter)
      if (Math.hypot(q.x - x, q.y - y) - (q.r || 0) < def.room) { why = 'no room here'; return null; }
    }
    return {x, y};
  }
  const costWords = c => Object.entries(c).map(([k, n]) => `${n} ${(ITEMS[k]?.name || k).toLowerCase()}`).join(', ');
  const RECIPES = Object.entries(BUILDS).map(([kind, def]) => ({id: kind === 'campfire' ? 'campfire' : 'build.' + kind, name: def.name, cost: def.cost, desc: def.desc,
    can() {
      if (!active()) return 'only in the open world';
      if (pack()?.short(def.cost)) return 'needs ' + costWords(def.cost);
      return spot(def) ? '' : why;
    },
    run() {
      const s = spot(def); if (!s) return;
      if (online()) { coop().act('build', kind, {x: +s.x.toFixed(2), y: +s.y.toFixed(2)}); return; }   // (paid when the server says it stands)
      for (const k in def.cost) if (!pack().take(k, def.cost[k])) return;
      const st = store(), b = add('o' + (++st.n), kind, s.x, s.y, 0, def.fire ? def.fire.start * def.fire.log : 0);
      placed(b, true);
    }}));
  function placed(b, mine) {
    host.events.push({type: 'build.add', x: b.x, y: b.y, id: b.id, kind: b.kind, mine});
    if (b.def.fire) host.events.push({type: 'fire.addWood', x: b.x, y: b.y});
    if (mine) { ui()?.toast(b.def.name, b.def.fire ? 'E by it adds a log' : b.def.lamp?.takeBack ? 'E by it takes it back' : '', b.def.fire ? '#ffb060' : '#b8f0a4'); save(); }
  }
  // a log on a fire: offline at once; online asked (the log taken when the server says it burns)
  function stoke(b) {
    const F0 = b.def.fire; if (!F0) return 'not a fire';
    const left = fuelAt(b, now());
    if (left >= (F0.max - .5) * F0.log) return 'it burns well';
    if ((pack()?.count('wood') || 0) < 1) return 'no logs in the pouch';   // (any species' log: game/inventory.js 'wood')
    if (online()) { coop().act('stoke', b.id); return ''; }
    pack().take('wood', 1); b.fuel = stokeFuel(left, b.def); b.t0 = T; ver++;
    host.events.push({type: 'fire.addWood', x: b.x, y: b.y}); save();
    return '';
  }
  function takeBack(b) {
    if (online()) { coop().act('unbuild', b.id); return; }
    for (const k in b.def.cost) pack()?.give(k, b.def.cost[k], {x: b.x, y: b.y, h: 1.2});
    drop(b.id); host.events.push({type: 'build.remove', x: b.x, y: b.y, id: b.id, kind: b.kind}); save();
  }
  // co-op: the server's word on a build
  function mail(m) {
    if (m.k !== 'world' || typeof m.id !== 'string' || m.id[0] !== 'b') return;
    const mine = m.by === me() && !m.late;
    if (m.s === 'built') {
      const def = BUILDS[m.kind]; if (!def) return;
      const b = add(m.id, m.kind, +m.x, +m.y, m.by, +m.fuel || 0, +m.t0 || 0); if (!b) return;
      if (mine) for (const k in def.cost) pack()?.take(k, def.cost[k]);
      if (!m.late) placed(b, mine);
    } else if (m.s === 'stoked') {
      const b = list.get(m.id); if (!b) return;
      b.fuel = +m.fuel || 0; b.t0 = +m.t0 || 0; ver++;
      if (mine) pack()?.take('wood', 1);
      if (!m.late) host.events.push({type: 'fire.addWood', x: b.x, y: b.y});
    } else if (m.s === 'gone') {
      const b = list.get(m.id); if (!b) return;
      if (mine && b.def.lamp?.takeBack) for (const k in b.def.cost) pack()?.give(k, b.def.cost[k], {x: b.x, y: b.y, h: 1.2});
      drop(m.id); host.events.push({type: 'build.remove', x: b.x, y: b.y, id: b.id, kind: b.kind});
    }
  }

  // ---------------------------------------------------------------- the meshes (a build's frame: its foot at x, z, y)
  const GEO = {};
  const geoOfKind = kind => GEO[kind] ??= (MAKE[kind] || MAKE.campfire)();
  const MAKE = {
    campfire() {   // a ring of stones round a teepee of logs on an ash bed (features/campfires.js draws the flames)
      const L = [];
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * Math.PI * 2 + (i % 2) * .12, d = .4 + (i % 3) * .025;
        L.push({g: new THREE.IcosahedronGeometry(1, 0), m: M4([Math.cos(a) * d, .045, Math.sin(a) * d], [i * 1.7, i * 2.3, i * .9], [.09, .07, .08 + (i % 2) * .02]), fam: 'rock'});
      }
      L.push({g: new THREE.CylinderGeometry(.33, .35, .02, 9), m: M4([0, .01, 0]), fam: 'ash'});
      for (let i = 0; i < 4; i++) {   // the teepee: leaning in to a point over the middle
        const a = i / 4 * Math.PI * 2 + .4, c = Math.cos(a), s = Math.sin(a);
        L.push({...along([c * .26, .02, s * .26], [c * .03, .36, s * .03], .045, .035, 6), fam: 'bark'});
      }
      return geoOf(L);
    },
    fire_ring() {   // a wide double ring of flat cave stones, a deep ash bed, short logs laid crosswise
      const L = [];
      for (let i = 0; i < 13; i++) {
        const a = i / 13 * Math.PI * 2, d = .56 + (i % 2) * .03;
        L.push({g: new THREE.IcosahedronGeometry(1, 0), m: M4([Math.cos(a) * d, .06, Math.sin(a) * d], [i * 1.3, a, i * .7], [.12, .085 + (i % 3) * .015, .1]), fam: i % 3 ? 'stone' : 'rock'});
      }
      for (let i = 0; i < 7; i++) {   // (the outer course, lower)
        const a = i / 7 * Math.PI * 2 + .3;
        L.push({g: new THREE.IcosahedronGeometry(1, 0), m: M4([Math.cos(a) * .7, .03, Math.sin(a) * .7], [i, i * 2.1, 0], [.09, .05, .08]), fam: 'rock'});
      }
      L.push({g: new THREE.CylinderGeometry(.46, .5, .03, 12), m: M4([0, .015, 0]), fam: 'ash'});
      for (let i = 0; i < 3; i++) {   // three short logs, crossed
        const a = i / 3 * Math.PI + .2, c = Math.cos(a) * .3, s = Math.sin(a) * .3;
        L.push({...along([-c, .06 + i * .05, -s], [c, .06 + i * .05, s], .05, .045, 6), fam: 'bark'});
      }
      return geoOf(L);
    },
    crystal_lamp() {   // a little cairn of stone, a copper band round its top, three Glow Shards standing out of it
      const L = [];
      [[.17, .08, .09], [.14, .2, .08], [.11, .31, .07]].forEach(([r, h, t], i) =>
        L.push({g: new THREE.IcosahedronGeometry(1, 0), m: M4([(i - 1) * .015, h, i * .01], [i * .9, i * 1.7, 0], [r, t, r * .95]), fam: i === 1 ? 'stone' : 'rock'}));
      L.push({g: new THREE.CylinderGeometry(.09, .1, .06, 8), m: M4([0, .4, 0]), fam: 'copper'});
      L.push({g: new THREE.CylinderGeometry(.1, .1, .015, 8), m: M4([0, .44, 0]), fam: 'rust'});
      [[0, .62, 0, 0, .055, .22], [.05, .55, .03, -.35, .04, .15], [-.05, .54, -.02, .4, .035, .13]].forEach(([x, y, z, tilt, w, h]) =>
        L.push({g: new THREE.OctahedronGeometry(1, 0), m: M4([x, y, z], [tilt * .6, tilt, tilt], [w, h, w]), fam: 'gem'}));
      return geoOf(L);
    },
  };
  function mesh(b) {
    if (b.mesh || !host.world?.mesh) return;
    b.mesh = host.world.mesh(geoOfKind(b.kind), M4([b.x, b.z, b.y], [0, (b.x * 7.3 + b.y * 3.1) % 6.28, 0]), {static: true});
  }
  // the lamps' lights (records reused: the pool grows with the lamps standing, never per frame)
  const LOUT = [], LREC = [], FO = {fuel: 0, ember: 0}, SH = [];

  const F = {
    name: 'builds', label: 'Building', on: ON,
    list, now, get ver() { return ver; },
    fire(b) { const t = now(); FO.fuel = fuelAt(b, t); FO.ember = b.def.fire ? emberAt(b, t, b.def) : 0; return FO; },   // (one object, reused: read it at once)
    shining(out) {   // (the records are this feature's, reused; a build is a lamp or a fire with fuel)
      let n = 0; const t = now();
      for (const b of list.values()) if (b.def.lamp || (b.def.fire && fuelAt(b, t) > 0)) { const o = SH[n] ??= {x: 0, y: 0}; o.x = b.x; o.y = b.y; out[n++] = o; }
      out.length = n; return out;
    },
    shineNear(x, y, r) { const t = now(); for (const b of list.values()) if ((b.def.lamp || (b.def.fire && fuelAt(b, t) > 0)) && Math.hypot(b.x - x, b.y - y) < r) return true; return false; },
    stoke, mine: b => b.by === me(),
    check: kind => { const d = BUILDS[kind]; return d && spot(d) ? '' : why; },   // (tests: '' = it can go down ahead of him)
    update(dt, evs) {
      T += dt;
      if (!ON) return;
      const pk = pack(); if (!pk) return;
      if (!offered) { offered = true; for (const r of RECIPES) pk.recipe(r); }   // (the pack is made after this feature: LOAD_ORDER)
      const on = active(), ol = online();
      if (on !== was || ol !== wasOnline) {   // (online: the server's builds come in its welcome; offline: the save's)
        if (was && !wasOnline) save();
        clear(); was = on; wasOnline = ol;
        if (on && !ol) restore();
      }
      if (!on) return;
      for (let k = 0; k < evs.length; k++) if (evs[k].type === 'pack.reset' && !ol) clear();
      const c = coop(); if (ol && c.mail) for (let k = 0; k < c.mail.length; k++) mail(c.mail[k]);
      if (!ol && (saveT += dt) > 5) { saveT = 0; for (const b of list.values()) if (b.def.fire && fuelAt(b, T) > 0) { save(); break; } }
    },
    interact(p) {
      if (p.kind !== 'crystallamp' || !p.build) return false;
      const b = list.get(p.build); if (!b) return false;
      if (!b.def.lamp?.takeBack || b.by !== me()) { ui()?.float(b.x, b.y, 1.2, 'someone else\'s lamp', '#b8f0a4'); return true; }
      takeBack(b); return true;
    },
    prompt(p) {
      if (p.kind !== 'crystallamp' || !p.build) return null;
      const b = list.get(p.build); if (!b) return null;
      return b.by === me() ? {text: 'E  take the lamp back', color: '#b8f0a4'} : null;
    },
    frame() { if (active()) for (const b of list.values()) mesh(b); },
    lights() {
      LOUT.length = 0; if (!active()) return LOUT;
      let i = 0;
      for (const b of list.values()) {
        const L = b.def.lamp; if (!L) continue;
        const r = LREC[i] ??= {x: 0, y: 0, h: 0, color: '', radius: 0, intensity: 0, flicker: 0, id: 0};
        r.x = b.x; r.y = b.y; r.h = b.z + .62; r.color = L.color; r.radius = L.radius; r.intensity = L.intensity; r.flicker = .04; r.id = 9870 + i;
        LOUT.push(r); i++;
      }
      return LOUT;
    },
    menu() {
      if (!ON || game()?.mode !== 'sandbox') return [];
      return [{label: 'Building: a Crystal Lamp\'s and a Stone Fire Ring\'s makings in the pouch', run: () => { const pk = pack(); if (!pk) return;
        for (const [k, n] of [['glow_shard', 6], ['copper_ore', 4], ['log', 6], ['stone', 12]]) pk.give(k, n); }}];
    },
    hud: () => active() && list.size ? 'builds ' + [...list.values()].map(b => b.kind + (b.def.fire ? ' ' + Math.round(fuelAt(b, now())) + 's' : '')).join(', ') : '',
    biomeChanged() { for (const b of list.values()) b.mesh = null; },   // (the rebuild disposed the world's meshes: made again)
  };
  return F;
}
