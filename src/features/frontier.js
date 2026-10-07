// FRONTIER (Red Mesa only): the dressing that makes the desert read as an 1800s western place. On entering the desert
// its pieces join the world (colliders in the registry, 3D meshes toned by the biome's families, painted faces, bones);
// on leaving they go and the scatter they stood on comes back. The other biomes never see any of it (nothing is built,
// drawn, hidden or drawn from Math.random until the desert is entered).
//   windmill   a water pumper by the creek north of the east gate: a timber lattice tower with a ladder, a galvanised
//              wheel (18 blades) and tail vane that turn with the wind (the vane swings round into it, the wheel spins
//              up with the wind along its shaft and furls out of a gale), the pump and its spout, the stock tank at its
//              foot, a corral fence with a skull on its post
//   street     outside the east gate: a hitching rail and its trough, the wanted board (two posters; E reads them), the
//              signpost at the creek (RED MESA, FORT west, MESA east, CANYON south; E reads it), a covered wagon by the
//              wall with its rear wheel off, leaning on the bed, the axle propped on a crate, bones in the sand
//   fort's     a stone well with a windlass and bucket by the south gate, a fence along the canyon rim, a skull and
//   edges      ribs, a lone wheel half sunk in the sand; on the west side a fence run and an outhouse (a moon on the door)
//   yard       a water tower (stave tank on a braced timber frame, ladder, swing spout) at the east edge, under the mesa
//              a timbered mine portal with rails out to an ore cart, its lantern lit, a skull on the cap
// Where: open sand outside the walls, clear of the creek, the paths, the camp's open ground, the climb, the gates.
// OWNS: its props (kinds: PROP_TOP below), the scatter it hid under them (hidden while in the desert), its meshes
//   (world.mesh: five static clusters, cast into the cached static shadow map, sScene layers 1 + 2; the windmill's head
//   and wheel move: layer 0, hidden while the windmill is out of view), its painted faces (one G.surface over one atlas),
//   the bones and the mine's lantern (3D, merged into the clusters: the yard's lights the lantern's glass, mesh.setGlow;
//   ?props2d=1: the old bone / lantern cards, G.card), the windmill's motion (view), the speech bubble.
// READS: host.biome, host.wind.at (the windmill), host.entities (add / remove / hide / near), host.G (view, toScreen).
// EMITS: frontier.read {what: 'wanted' | 'sign', name: the poster's outlaw or null} as you read one (features/foes: a
//   wanted poster calls a bounty gang in the desert sandbox).
// BUDGET: static pieces: no per-frame work (built once, placed per desert world): 5 cluster meshes + 1 face surface +
//   (props2d: 11 small cards), culled by the camera; F.view ~.015 ms measured (real clock, the windmill in view: one wind sample,
//   a few lines of spring maths, two setMatrix; nothing when it's out of view); F.lights one preallocated record near
//   the mine; F.hd only while a bubble shows. Draw calls in view: <= 4 cluster + 1 face + 2 windmill (+ 2 shadow).
import * as THREE from 'three';
import * as WORLD from '../world/world.js';
import {geoOf, M4, pack} from '../world/kit3d.js';
import {clamp} from '../core/mathx.js';
import {frontierArt} from './frontier/art.js';
import * as MD from './frontier/models.js';
import {lanternParts} from '../world/props3d.js';   // the true-3D lantern (the wind decor's and the stall's too)
import {flags} from '../core/flags.js';

const TAU = Math.PI * 2, I4 = new THREE.Matrix4();
// how high these stop arrows (world.js PROP_TOP, read by sim/projectiles.js): the lattices let them through
WORLD.propTop({windmill: .9, stock_tank: .56, water_tower: 0, wagon: 2.4, hitch_rail: 1.05, trough: .5, wanted_board: 2.2, signpost: 2.75,
  rail_fence: 1.05, well: .7, outhouse: 2.2, mine_portal: 2.3, ore_cart: .8});

const TUNE = {
  // (the wind's field: ~.3 m/s in a calm breeze, ~1 brisk, up to ~3 in a gale's gusts: features/wind.js F.at)
  vane: {k: 2.2, c: 1.5, hunt: .1}, // the vane's spring (1/s^2) and damping (1/s): it swings round into the wind and settles;
                                    // in gusty air it hunts a few degrees either side (rad)
  wheel: {k: 4.5, max: 6, lag: 1.4},   // rad/s per m/s of wind along the shaft, the top speed (a soft cap), s to spin up or down
  furl: [2.0, 3.0, .9],             // a gale furls the wheel: from this wind (m/s) to that, the head turns up to .9 rad out of it
  margin: [3, 10],                  // m beyond the view's edges (across, below) within which the windmill moves; else it's
                                    // still and its moving parts are hidden (no draws). (Its top stands ~7.5 m up: seen from
                                    // below the view's bottom edge)
  bubble: 4.2,                      // s a speech bubble shows
};

// ---------------------------------------------------------------- where things stand (arena metres: x east, y south)
const MILL = {x: 35.4, y: 9.3}, TANK = {x: MILL.x + MD.MILL.tank[0], y: MILL.y + MD.MILL.tank[1]};
const STREET = {hitch: {x: 35.9, y: 17.7}, trough: {x: 35.9, y: 18.32}, wanted: {x: 35.2, y: 19.95}, sign: {x: 37.6, y: 16.55}, wagon: {x: 35.6, y: 22.95}};
const WELL = {x: 24.6, y: 25.55}, WHEEL = {x: 30.3, y: 25.6}, OUTHOUSE = {x: 5.2, y: 21.75};
const TOWER = {x: 58.45, y: 13.35}, MINE = {x: 54.5, y: 11.0}, CART = {x: 54.5, y: 12.75};
// fence runs: [x, y, length, heading ('e' east | 's' south), seed, broken spans, the cluster it's drawn with]
const FENCES = [[33.95, 7.55, 3.3, 'e', 3, [[1, 'low']], 'mill'], [8.7, 26.35, 4.1, 'e', 5, [[1, 'fallen']], 'south'], [4.45, 17.0, 3.6, 's', 7, [[0, 'top']], 'west']];
// bones: [art, x, y, h]  (skulls on the corral's end post, the west fence's, the mine's cap; the rest in the sand)
const BONES = [['skull', 37.25, 7.6, 1.07], ['skull', 4.47, 20.62, 1.07], ['skull', 54.5, 11.32, 2.15], ['skull', 11.3, 25.85, 0], ['ribs', 11.95, 25.98, 0],
  ['bone', 10.75, 26.12, 0], ['ribs', 34.35, 25.0, 0], ['bone', 34.95, 25.35, 0], ['skull', 59.3, 17.9, 0], ['bone', 6.2, 24.7, 0]];
const LANTERN = {x: 53.97, y: 11.36, h: 2.1};
// (?props2d=1: the bones and the lantern as the old cards, an A/B; else 3D pieces merged into the cluster nearest each)
const P2D = flags.get('props2d') === '1';
// what the posters and the sign say (E)
const POSTERS = ["WANTED: 'Two-Gun' Calloway | robbed the Tres Piedras stage | $500 reward", 'WANTED: Kid Ybarra, horse thief | $200, brought in alive',
  "Scratched in the wood: | 'water at the windmill, whiskey at the fort'"];
const WANTED_NAMES = ["'Two-Gun' Calloway", 'Kid Ybarra', null];   // each poster's outlaw (frontier.read), in POSTERS' order
const SIGN_TEXT = ['RED MESA | the fort west, the mesa and the mine east | the canyon south'];
// the scatter a piece hides while it stands (soft plants and stones; the unreachable big rocks and trees round the map)
const SOFT = new Set(['tuft', 'bush', 'rock', 'reed', 'fern', 'rock_big']);

export const order = {after: ['wind']};   // the windmill turns in this step's wind
export async function create(host) {
  const F = {name: 'frontier', label: 'Frontier', ambient: true, on: true, ms: 0};
  let active = false, ART = null, GEO = null;
  const props = [], hidden = [], meshes = [], faces = [], cards = [], scratch = [];
  let wanted = null, sign = null;
  const PPM = host.PPM, PPMH = host.PPMH;

  // ================================================================ built once, the first time the desert is entered
  // DRAW CALLS (docs/ARCHITECTURE.md 3.3.7): the static pieces are merged per place into one mesh each, in world
  // coordinates (5 meshes: the mill, the street, the yard, the south, the west); every painted face shares one atlas
  // and one surface (1 draw); only the windmill's head and wheel are meshes of their own (they move)
  const rot = h => h === 's' ? -Math.PI / 2 : 0;   // a piece's heading: local +x east, or turned to run south
  const piece = (parts, x, y, r = [0, 0, 0], h = 0) => MD.at(parts, M4([x, h, y], r));
  function buildAssets() {
    ART = frontierArt(host.biome.style);
    const S = ART.signs, {hitch, trough, wanted: wb, sign: sp, wagon} = STREET;
    const signParts = MD.signpost();
    for (const n of ['top', 'fort', 'mesa', 'canyon']) signParts.push(...MD.signBoardParts(n, S[n].w / PPM, S[n].h / PPMH));
    const C = {
      mill: [...piece(MD.millTower(), MILL.x, MILL.y), ...piece(MD.millRod(), MILL.x, MILL.y), ...piece(MD.stockTank(), TANK.x, TANK.y)],
      street: [...piece(MD.hitchRail(), hitch.x, hitch.y), ...piece(MD.trough(), trough.x, trough.y), ...piece(MD.wantedBoard(), wb.x, wb.y),
        ...piece(signParts, sp.x, sp.y), ...piece(MD.wagon(), wagon.x, wagon.y)],
      yard: [...piece(MD.waterTower(), TOWER.x, TOWER.y), ...piece(MD.minePortal(), MINE.x, MINE.y), ...piece(MD.oreCart(), CART.x, CART.y)],
      south: [...piece(MD.well(), WELL.x, WELL.y), ...piece(MD.wheel(.6, {missing: [2, 7, 8]}), WHEEL.x, WHEEL.y, [.32, .6, .1], .36)],   // (sunk to its hub, leaning)
      west: [...piece(MD.outhouse(), OUTHOUSE.x, OUTHOUSE.y)],
    };
    for (const [x, y, len, h, seed, brk, c] of FENCES) C[c].push(...piece(MD.fence(len, {seed, brk}), x, y, [0, rot(h), 0]));
    if (!P2D) bones3d(C);
    GEO = {clusters: Object.values(C).map(geoOf), names: Object.keys(C), head: geoOf(MD.millHead()), wheel: geoOf(MD.millWheel()), faces: buildFaces()};
  }
  // THE BONES IN 3D: lying in the sand, turned their own way (a skull rests a little tilted, half the ribs sunk); a skull on a post
  // rests on its top, its brow tipped a little to the south; the mine's is nailed to the cap's face, looking out, the snout down. The
  // mine's lantern hangs from an iron hook on the cap (its glass lights itself: the yard's mesh, buildVisuals). Each piece goes into
  // the cluster nearest it (no draw of its own)
  function bones3d(C) {
    const AT = {mill: MILL, street: STREET.wagon, yard: MINE, south: WELL, west: OUTHOUSE};
    const near = (x, y) => { let b = 'south', bd = 1e9; for (const k in AT) { const d = Math.hypot(AT[k].x - x, AT[k].y - y); if (d < bd) { bd = d; b = k; } } return C[b]; };
    for (const [k, x, y, h] of BONES) {
      const a = (x * 7.31 + y * 3.17) % TAU, P = k === 'skull' ? MD.skull() : k === 'ribs' ? MD.ribs() : MD.longBone();
      if (h > 2) near(x, y).push(...piece(P, x, y + .02, [1.0, 0, 0], h + .17));   // on the mine's cap: nailed to its face, looking out
      else if (h > 0) near(x, y).push(...piece(P, x, y + .01, [.2, 0, 0], h - .03));   // resting on a post's top, its brow tipped a little to the south (it reads from above at any yaw)
      else near(x, y).push(...piece(P, x, y, k === 'skull' ? [.12, a, .18] : [0, a, 0], k === 'ribs' ? -.015 : 0));
    }
    const L = LANTERN, hook = [MD.beam('metal', [0, .05, -.075], [0, .05, 0], .014, .014), MD.beam('metal', [0, .055, 0], [0, -.004, 0], .012, .012)];
    near(L.x, L.y).push(...piece([...hook, ...lanternParts()], L.x, L.y, [0, 0, 0], 2.12));
  }
  // the painted faces in one geometry over one atlas: the posters, the sign boards (front and back), the moon on the
  // outhouse's door, the water in the tank, the trough and the well. A face is a plane at 1 texel per art px seen square on
  // (PPM px a metre across, PPMH high on a wall). Each picture is packed with a 1 px border copied from its edge, so the
  // smooth sampling while the camera turns never blends in the gap between pictures
  function buildFaces() {
    const S = ART.signs, items = [['board', ART.board], ['moon', ART.moon], ['water', ART.water], ['deep', ART.deep], ['top', S.top.front]];
    for (const n of ['fort', 'mesa', 'canyon']) items.push([n + 'F', S[n].front], [n + 'B', S[n].back]);
    const A = pack(items.map(([name, img]) => ({name, img: padded(img), pivot: [0, 0]})), 256), AW = A.img.width, AH = A.img.height;
    const P = [], N = [], U = [];
    function put(geo, name, m) {   // geo: uv 0..1 (v up) -> the picture's rect in the atlas (rows go down); placed by m
      const f = A.fr[name], g = geo.toNonIndexed().applyMatrix4(m), p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        P.push(p.getX(i), p.getY(i), p.getZ(i)); N.push(n.getX(i), n.getY(i), n.getZ(i));
        U.push((f.sx + 1 + uv.getX(i) * (f.sw - 2)) / AW, (f.sy + 1 + (1 - uv.getY(i)) * (f.sh - 2)) / AH);
      }
    }
    const wall = (name, m) => { const f = A.fr[name]; put(new THREE.PlaneGeometry((f.sw - 2) / PPM, (f.sh - 2) / PPMH), name, m); };
    const flat = (geo, name, x, h, y) => put(geo, name, M4([x, h, y], [-Math.PI / 2, 0, 0]));
    const {trough, wanted: wb, sign: sp} = STREET, Q = MD.SIGN, t = Q.t / 2 + .004;
    flat(new THREE.CircleGeometry(MD.TANK.r - .035, 20), 'water', TANK.x, MD.TANK.water, TANK.y);
    flat(new THREE.CircleGeometry(.46, 16), 'deep', WELL.x, MD.WELL.water, WELL.y);
    flat(new THREE.PlaneGeometry(MD.TROUGH.w - .1, MD.TROUGH.d - .1), 'water', trough.x, MD.TROUGH.water, trough.y);
    wall('board', M4([wb.x, MD.WANTED.y0 + MD.WANTED.h / 2, wb.y + MD.WANTED.face]));
    wall('top', M4([sp.x, Q.top.y, sp.y + Q.top.z + t]));
    for (const n of ['fort', 'mesa']) {   // the east-west boards: the front faces south, the back north
      const cx = sp.x + Q[n].x * (.065 + S[n].w / PPM / 2);
      wall(n + 'F', M4([cx, Q[n].y, sp.y + t])); wall(n + 'B', M4([cx, Q[n].y, sp.y - t], [0, Math.PI, 0]));
    }
    const cz = sp.y + .065 + S.canyon.w / PPM / 2;   // the south board: its faces east and west
    wall('canyonB', M4([sp.x + t, Q.canyon.y, cz], [0, Math.PI / 2, 0])); wall('canyonF', M4([sp.x - t, Q.canyon.y, cz], [0, -Math.PI / 2, 0]));
    wall('moon', M4([OUTHOUSE.x, 1.78, OUTHOUSE.y + MD.OUTHOUSE.door + .004]));
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
    geo.computeBoundingSphere(); geo.computeBoundingBox();
    return {geo, img: A.img};
  }
  function padded(cv) {   // the picture with a 1 px border copied from its edge rows and columns
    const w = cv.width, h = cv.height, o = document.createElement('canvas'); o.width = w + 2; o.height = h + 2;
    const q = o.getContext('2d');
    q.drawImage(cv, 1, 1); q.drawImage(cv, 0, 0, w, 1, 1, 0, w, 1); q.drawImage(cv, 0, h - 1, w, 1, 1, h + 1, w, 1);
    q.drawImage(o, 1, 0, 1, h + 2, 0, 0, 1, h + 2); q.drawImage(o, w, 0, 1, h + 2, w + 1, 0, 1, h + 2);
    return o;
  }

  // ================================================================ the props (sim: colliders, interaction)
  function addProp(p) { p.z = 0; host.entities.add(p); props.push(p); return p; }
  function clearUnder(x, y, r) {   // hide the soft scatter (and the big decor rocks / trees) a piece stands on
    for (const q of host.entities.near(x, y, r, scratch)) {
      if (q.gone || props.includes(q) || !(SOFT.has(q.kind) || (q.kind === 'tree' && q.outside))) continue;
      if (Math.hypot(q.x - x, q.y - y) > r) continue;
      host.entities.hide(q); hidden.push(q);
    }
  }
  function enter() {
    active = true;
    if (!GEO) buildAssets();
    const {hitch, trough, wanted: wb, sign: sp, wagon} = STREET;
    addProp({kind: 'windmill', x: MILL.x, y: MILL.y, rect: [MILL.x - .9, MILL.y - .9, MILL.x + .9, MILL.y + .9]});
    addProp({kind: 'stock_tank', x: TANK.x, y: TANK.y, r: MD.TANK.r});
    addProp({kind: 'hitch_rail', x: hitch.x, y: hitch.y, rect: [hitch.x - 1.15, hitch.y - .08, hitch.x + 1.15, hitch.y + .08]});
    addProp({kind: 'trough', x: trough.x, y: trough.y, rect: [trough.x - .88, trough.y - .25, trough.x + .88, trough.y + .25]});
    wanted = addProp({kind: 'wanted_board', x: wb.x, y: wb.y, rect: [wb.x - .85, wb.y - .08, wb.x + .85, wb.y + .14], interact: 'read'});
    sign = addProp({kind: 'signpost', x: sp.x, y: sp.y, r: .14, interact: 'read'});
    addProp({kind: 'wagon', x: wagon.x, y: wagon.y, rect: [wagon.x - 1.62, wagon.y - .8, wagon.x + 1.62, wagon.y + 1.0]});
    addProp({kind: 'wagon', x: wagon.x + 1.85, y: wagon.y + .62, r: .2});   // the water barrel by the front wheel
    addProp({kind: 'well', x: WELL.x, y: WELL.y, r: MD.WELL.r});
    addProp({kind: 'outhouse', x: OUTHOUSE.x, y: OUTHOUSE.y, rect: [OUTHOUSE.x - .56, OUTHOUSE.y - .56, OUTHOUSE.x + .56, OUTHOUSE.y + .6]});
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) addProp({kind: 'water_tower', x: TOWER.x + sx, y: TOWER.y + sy, r: .15});
    for (const sx of [-1, 1]) addProp({kind: 'mine_portal', x: MINE.x + sx * .79, y: MINE.y + .15, r: .14});
    addProp({kind: 'ore_cart', x: CART.x, y: CART.y, rect: [CART.x - .45, CART.y - .55, CART.x + .45, CART.y + .55]});
    for (const [x, y, len, h] of FENCES) addProp({kind: 'rail_fence', x: h === 's' ? x : x + len / 2, y: h === 's' ? y + len / 2 : y,
      rect: h === 's' ? [x - .08, y, x + .08, y + len] : [x, y - .08, x + len, y + .08]});
    // the scatter under them
    for (const [x, y, r] of [[MILL.x, MILL.y, 1.2], [TANK.x, TANK.y, 1.05], [hitch.x, hitch.y + .3, 1.4], [wb.x, wb.y, 1], [sp.x, sp.y, .45], [wagon.x, wagon.y + .15, 2.1],
      [wagon.x + 2.4, wagon.y, .9], [WELL.x, WELL.y, 1], [WHEEL.x, WHEEL.y, .7], [OUTHOUSE.x, OUTHOUSE.y, .85], [TOWER.x, TOWER.y, 1.6], [MINE.x, MINE.y + .6, 1.2],
      [CART.x, CART.y + .4, .9], [MINE.x + 1.6, MINE.y + .6, .7]]) clearUnder(x, y, r);
    for (const [x, y, len, h] of FENCES) for (let d = 0; d <= len; d += .5) clearUnder(h === 's' ? x : x + d, h === 's' ? y + d : y, .4);
    for (const [, x, y, h] of BONES) if (!h) clearUnder(x, y, .35);
  }
  function leave() {
    active = false; say(null);
    for (const p of props) host.entities.remove(p);
    for (const q of hidden) host.entities.hide(q, false);
    props.length = hidden.length = 0; wanted = sign = null;
  }

  // ================================================================ the visuals (rebuilt with every desert world)
  const MV = {head: null, wheel: null, shown: true};
  function card(a, x, h, y, em = null) {   // a billboard (the bones lying in the sand face you, like the painted rocks)
    const c = host.G.card({tex: host.G.tex(a.cv), em: em ? host.G.tex(em) : null, w: a.w, h: a.h, px: a.px, py: a.py, type: 3, obj: 1, bias: .00125, shadow: false});
    c.anchor = new THREE.Vector3(x, h, y); cards.push(c);
  }
  function buildVisuals() {
    GEO.clusters.forEach((g, i) => {   // (still: the cached static shadow)
      const m = host.world.mesh(g, I4, {occlude: true, static: true}); meshes.push(m);
      if (!P2D) m.setGlow(0, WORLD.FAMS.indexOf('flame'), 1);   // the lantern's glass (no other piece is of the flame family)
    });
    MV.head = host.world.mesh(GEO.head, new THREE.Matrix4()); MV.wheel = host.world.mesh(GEO.wheel, new THREE.Matrix4());
    meshes.push(MV.head, MV.wheel); MV.shown = true; poseMill();
    // the painted faces (gfx type 5, a textured surface: lit and shadowed by the scene, no outline, casting nothing)
    faces.push(host.G.surface(GEO.faces.geo, {tex: host.G.tex(GEO.faces.img), planar: false, type: 5, obj: 1}, false));
    if (P2D) { for (const [k, x, y, h] of BONES) card(ART[k], x, h, y); card(ART.lantern, LANTERN.x, LANTERN.h, LANTERN.y, ART.lantern.em); }
  }
  function dropVisuals() {   // (the world's rebuild already disposed the meshes it lent us)
    meshes.length = 0; MV.head = MV.wheel = null;
    for (const f of faces) f.dispose(); for (const c of cards) c.dispose();
    faces.length = cards.length = 0;
  }

  // ================================================================ the windmill (view: presentation only)
  const W = {yaw: 0, yawV: 0, want: 0, spin: 0, omega: 0, init: false, t: 0};
  const HM = new THREE.Matrix4(), WM = new THREE.Matrix4(), TM = new THREE.Matrix4(), AIR = {x: 0, y: 0, g: 0};
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
  function poseMill() {
    if (!MV.head) return;
    HM.makeRotationY(W.yaw).setPosition(MILL.x, MD.MILL.H, MILL.y);
    TM.makeRotationX(W.spin).setPosition(MD.MILL.hub[0], MD.MILL.hub[1], MD.MILL.hub[2]);
    WM.multiplyMatrices(HM, TM);
    MV.head.setMatrix(HM); MV.wheel.setMatrix(WM);
  }
  function stepMill(dt) {
    const wf = host.wind, w = wf?.on && wf.at ? wf.at(MILL.x, MILL.y, AIR) : (AIR.x = AIR.y = AIR.g = 0, AIR), sp = Math.hypot(w.x, w.y);
    W.t += dt;
    if (sp > .04) {   // the vane points downwind (the head's +x); a gale turns the wheel partly out of the wind
      const [f0, f1, fm] = TUNE.furl, hunt = (Math.sin(W.t * .9) * .6 + Math.sin(W.t * 2.3 + 1) * .4) * TUNE.vane.hunt * Math.min(1, w.g + sp * .4);
      W.want = Math.atan2(-w.y, w.x) + clamp((sp - f0) / (f1 - f0), 0, 1) * fm + hunt;
      if (!W.init) { W.yaw = W.want; W.init = true; }
    }
    W.yawV += (wrap(W.want - W.yaw) * TUNE.vane.k - W.yawV * TUNE.vane.c) * dt; W.yaw = wrap(W.yaw + W.yawV * dt);
    const along = Math.max(0, w.x * Math.cos(W.yaw) - w.y * Math.sin(W.yaw)), T = TUNE.wheel;
    W.omega += (T.max * Math.tanh(along * T.k / T.max) - W.omega) * (1 - Math.exp(-dt / T.lag));
    W.spin = (W.spin + W.omega * dt) % TAU;
    poseMill();
  }

  // ================================================================ reading the posters and the sign (a speech bubble)
  const SAY = {lines: null, x: 0, h: 0, y: 0, t: 0};
  let pi = 0;
  function say(text, x = 0, h = 0, y = 0) { SAY.lines = text ? text.split(' | ') : null; SAY.x = x; SAY.h = h; SAY.y = y; SAY.t = text ? TUNE.bubble : 0; }

  // ================================================================ contract
  const nearView = (x, y, m) => { const t = host.G.view.T; return Math.abs(x - t.x) < m && Math.abs(y - t.z) < m; };
  function millInView() {   // the windmill's foot in the camera's frame (x right, y toward the camera) against the view's half size
    const t = host.G.view.T, dx = MILL.x - t.x, dy = MILL.y - t.z, c = Math.cos(host.yaw), s = Math.sin(host.yaw), z = host.zoom;
    const vx = dx * c - dy * s, vy = dx * s + dy * c, hx = host.VW / (2 * PPM * z), hy = host.VH / (2 * host.PPMY * z), [ma, mb] = TUNE.margin;
    return Math.abs(vx) < hx + ma && vy > -hy - ma && vy < hy + mb;
  }
  function showMill(v) { if (MV.shown === v) return; MV.shown = v; MV.head.setVisible(v); MV.wheel.setVisible(v); }
  F.view = dt => {
    if (!active) return;
    const t0 = performance.now();
    if (MV.head) { const on = millInView(); showMill(on); if (on) stepMill(dt); }
    if (SAY.t > 0 && (SAY.t -= dt) <= 0) SAY.lines = null;
    F.ms = F.ms * .95 + (performance.now() - t0) * .05;
  };
  const LIGHT = [{x: LANTERN.x, y: LANTERN.y + .05, h: LANTERN.h - .2, color: [1, .76, .44], radius: 3.4, intensity: .95, flicker: .22, id: 9601}], NONE = [];
  F.lights = () => active && nearView(MINE.x, MINE.y, 26) ? LIGHT : NONE;
  F.prompt = p => active && (p === wanted || p === sign) ? 'E  read' : null;
  F.interact = p => {
    if (!active) return false;
    if (p === wanted) {
      const i = pi++ % POSTERS.length; say(POSTERS[i], wanted.x, 2.45, wanted.y);
      host.events.push({type: 'frontier.read', what: 'wanted', name: WANTED_NAMES[i], x: wanted.x, y: wanted.y});
      return true;
    }
    if (p === sign) { say(SIGN_TEXT[0], sign.x, 2.95, sign.y); host.events.push({type: 'frontier.read', what: 'sign', name: null, x: sign.x, y: sign.y}); return true; }
    return false;
  };
  F.hd = (q, sc) => {   // the bubble at display resolution over the board / the sign
    if (!SAY.lines) return;
    host.G.hdShift?.(q, sc);   // (slid with the pixel image: the sub-pixel camera; the host restores q after)
    const [sx, sy] = host.G.toScreen(SAY.x, SAY.h, SAY.y), dpr = devicePixelRatio || 1, a = Math.min(1, SAY.t * 3), lh = 14 * dpr;
    q.font = `${Math.round(11 * dpr)}px ui-monospace, Consolas, monospace`; q.textAlign = 'center';
    let w = 0; for (const l of SAY.lines) w = Math.max(w, q.measureText(l).width);
    w += 16 * dpr; const h = SAY.lines.length * lh + 8 * dpr, x = sx * sc, y = sy * sc - 12 * dpr;
    q.globalAlpha = a; q.fillStyle = 'rgba(240,232,214,.94)';
    q.beginPath(); q.roundRect(x - w / 2, y - h, w, h, 5 * dpr); q.fill();
    q.beginPath(); q.moveTo(x - 5 * dpr, y); q.lineTo(x + 3 * dpr, y); q.lineTo(x - 3 * dpr, y + 6 * dpr); q.fill();
    q.fillStyle = '#3a2a24';
    for (let i = 0; i < SAY.lines.length; i++) q.fillText(SAY.lines[i], x, y - h + 4 * dpr + (i + .78) * lh);
    q.globalAlpha = 1;
  };
  F.biomeChanged = () => {   // (synchronous: the run's navigation is built right after a switch and must see our colliders)
    dropVisuals();
    if (host.biome.id === 'desert') { if (!active) enter(); buildVisuals(); }
    else if (active) leave();
  };
  if (host.biome.id === 'desert') { enter(); buildVisuals(); }
  F._ = {props, hidden, W, MV, TUNE, SAY, get active() { return active; }, art: () => ART};
  return F;
}
