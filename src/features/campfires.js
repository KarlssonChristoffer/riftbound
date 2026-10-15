// CAMPFIRES the player builds (docs/GATHERING.md, the woodcutting slice's sink): the pack panel's Build list offers one for
// TUNE.cost logs; it goes down in front of him (a free spot: no wall, nothing standing within TUNE.room m), a ring of stones
// round a teepee of logs, and burns: each log TUNE.log s of fire (it starts with TUNE.start), E adds one from the pouch (up to
// TUNE.max). When the wood is gone it glows as embers for TUNE.embers s, then it is cold; a log lights it again. The flames
// are lights.js's (F.flame, as the gadgets' fire pools borrow them), the light its own. Built fires are saved
// (pack.store('camp')); at most TUNE.most stand. Only in the persistent world (the sandbox, the ruins biome).
// OWNS: the fires (their props: kind 'pitfire', and fuel), their meshes, their light records, their saved part.
// READS: pack (logs, the store, recipes), host.entities (near: room), lights (F.flame). EMITS: fire.addWood, fire.crackle.
// API: burningNear(x, y, r) (features/fishing.js cooks at a burning fire).
// BUDGET: sim: a few multiplies a fire a step. View: a flame and a light a burning fire a frame.
import * as THREE from 'three';
import {flags} from '../core/flags.js';
import {clamp} from '../core/mathx.js';
import {propTop} from '../world/world.js';
import {setMaterials} from '../content/materials.js';
import {geoOf, M4, along} from '../world/kit3d.js';

const ON = flags.get('campfires') !== '0';
const TUNE = {cost: 4, start: 2, log: 80, max: 5, embers: 90, most: 3, room: .9, ahead: 1.15, r: .45};   // (ahead: within E's reach, 1.3 m, from where he stands)
propTop({pitfire: .3});
setMaterials({pitfire: 'stone'});

// ORDER (core/features.js): before lights (its flames are drawn through lights.js F.flame within the frame)
export const order = {before: ['lights']};

export async function create(host) {
  const pack = () => host.feature('pack');
  const game = () => host.feature('game');
  const ui = () => game()?.ui || null;
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const fires = [];   // {p (the prop), fuel (s of fire left), ember (s of glow left)}
  const NEAR = [];
  let was = false, saveT = 0;
  const LOUT = [], LREC = Array.from({length: TUNE.most}, () => ({x: 0, y: 0, h: 0, color: '', radius: 0, intensity: 0, flicker: 0, id: 0}));
  const store = () => { const s = pack()?.store('camp'); if (s) s.fires ??= []; return s; };

  function place(x, y, fuel, ember) {
    const p = {kind: 'pitfire', x, y, z: host.elev(x, y), r: TUNE.r, interact: 'fire'};
    host.entities.add(p);
    fires.push({p, fuel, ember, mesh: null}); return fires[fires.length - 1];
  }
  function save() {
    const s = store(); if (!s) return;
    s.fires = fires.map(f => ({x: +f.p.x.toFixed(2), y: +f.p.y.toFixed(2), fuel: Math.round(f.fuel), ember: Math.round(f.ember)}));
  }
  function apply() { const s = store(); for (const o of s?.fires || []) place(o.x, o.y, o.fuel || 0, o.ember || 0); }
  function unapply() { save(); for (const f of fires) { host.entities.remove(f.p); f.mesh?.dispose(); } fires.length = 0; }
  // where a new fire would go: ahead of him, clear of walls and of anything standing there -> {x, y} | null (why: a string)
  let why = '';
  function spot() {
    const P = host.player, a = P.faceAngle, x = P.x + Math.sin(a) * TUNE.ahead, y = P.y + Math.cos(a) * TUNE.ahead, z = host.elev(x, y);
    why = '';
    if (fires.length >= TUNE.most) { why = `${TUNE.most} fires already burn`; return null; }
    if (host.blocked(x, y, z) || Math.abs(z - P.z) > .5 || host.inStream?.(x, y)) { why = 'no room here'; return null; }
    for (const q of host.entities.near(x, y, TUNE.room + .6, NEAR)) {
      if (q.gone || q.broken || q.outside || q.hunter || !(q.r > 0)) continue;   // (a plant, a tuft: no collider, no matter)
      if (Math.hypot(q.x - x, q.y - y) - (q.r || 0) < TUNE.room) { why = 'no room here'; return null; }
    }
    return {x, y};
  }
  const RECIPE = {id: 'campfire', name: 'Campfire', cost: {log: TUNE.cost},
    can() {
      if (!active()) return 'only in the open world';
      if ((pack()?.count('log') || 0) < TUNE.cost) return `needs ${TUNE.cost} logs`;
      return spot() ? '' : why;
    },
    run() {
      const s = spot(); if (!s || !pack()?.take('log', TUNE.cost)) return;
      const f = place(s.x, s.y, TUNE.start * TUNE.log, 0); save(); pack()?.dirty();
      host.events.push({type: 'fire.addWood', x: f.p.x, y: f.p.y});
      ui()?.toast('Campfire', 'E by it adds a log', '#ffb060');
    }};
  let offered = false;   // (the recipe goes to the pack at the first step: the pack is made after this feature, LOAD_ORDER)

  // ---------------------------------------------------------------- the meshes: a ring of stones, a teepee of logs, the ash bed
  let geoCache = null;
  const geo = () => geoCache ??= (() => {
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
  })();

  const F = {
    name: 'campfires', label: 'Campfires', on: ON,
    get fires() { return fires; },
    check: () => spot() ? '' : why,   // (tests, the panel: '' = a fire can go down ahead of him, else why not)
    update(dt) {
      if (!offered && pack()) { pack().recipe(RECIPE); offered = true; }
      const on = active();
      if (on !== was) { was = on; if (on) apply(); else unapply(); }
      if (!on) return;
      for (const f of fires) {
        if (f.fuel > 0) { f.fuel = Math.max(0, f.fuel - dt); if (!f.fuel) f.ember = TUNE.embers; }
        else if (f.ember > 0) f.ember = Math.max(0, f.ember - dt);
      }
      if ((saveT += dt) > 5) { saveT = 0; save(); }   // (its fuel kept current in the store: written with the next save)
    },
    interact(p) {
      if (p.kind !== 'pitfire') return false;
      const f = fires.find(q => q.p === p); if (!f) return false;
      if (f.fuel >= (TUNE.max - .5) * TUNE.log) { ui()?.float(p.x, p.y, 1.3, 'it burns well', '#ffb060'); return true; }
      if (!pack()?.take('log', 1)) { ui()?.float(p.x, p.y, 1.3, 'no logs in the pouch', '#e8a070'); return true; }
      f.fuel += TUNE.log; f.ember = 0; save(); pack()?.dirty();
      host.events.push({type: 'fire.addWood', x: p.x, y: p.y});
      return true;
    },
    prompt(p) {
      if (p.kind !== 'pitfire') return null;
      const f = fires.find(q => q.p === p), n = pack()?.count('log') || 0; if (!f) return null;
      return {text: n ? `E  add a log (${n})` : 'no logs in the pouch', color: n ? '#ffb060' : '#e8a070'};
    },
    frame() {
      const L = host.feature('lights'), flames = L?.on !== false && L?.flame ? L : null;
      for (const f of fires) {
        if (!f.mesh) f.mesh = host.world.mesh(geo(), M4([f.p.x, f.p.z, f.p.y], [0, (f.p.x * 7.3 + f.p.y * 3.1) % 6.28, 0]), {static: true});
        const k = clamp(f.fuel / (TUNE.log * 2.2), 0, 1.1);
        if (flames && f.fuel > 0) flames.flame(f.p, 'camp', '#ffa040', f.p.x, f.p.y + .01, f.p.z + .1, 1, .88 * (.3 + .7 * k), .42 + .58 * k);
      }
    },
    lights() {   // (the records reused: one per fire slot, no allocation a frame)
      LOUT.length = 0;
      for (let i = 0; i < fires.length; i++) {
        const f = fires[i], k = clamp(f.fuel / (TUNE.log * 2.2), 0, 1.1), e = f.fuel > 0 ? 0 : f.ember / TUNE.embers, r = LREC[i];
        if (f.fuel <= 0 && e <= 0) continue;
        r.x = f.p.x; r.y = f.p.y; r.id = 9810 + i;
        if (f.fuel > 0) { r.h = f.p.z + .3 + .45 * Math.min(1, k); r.color = '#ffa048'; r.radius = 6.5 * (.6 + .4 * k); r.intensity = 1.25 * (.28 + .72 * k); r.flicker = .55; }
        else { r.h = f.p.z + .15; r.color = '#ff5a20'; r.radius = 2.2; r.intensity = .5 * e; r.flicker = .25; }
        LOUT.push(r);
      }
      return LOUT;
    },
    hud: () => active() && fires.length ? 'campfires ' + fires.map(f => f.fuel > 0 ? Math.round(f.fuel) + 's' : f.ember > 0 ? 'embers' : 'cold').join(' ') : '',
    biomeChanged() { for (const f of fires) f.mesh = null; },
    // a fire burning within r m of (x, y)? (features/fishing.js: cooking needs one)
    burningNear(x, y, r) { for (const f of fires) if (f.fuel > 0 && Math.hypot(f.p.x - x, f.p.y - y) <= r) return true; return false; },
  };
  return F;
}
