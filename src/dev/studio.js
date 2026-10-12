// STUDIO: the wardrobe's scene (dev/wardrobe.js): a renderer of its own (render/gfx.js createGfx on a canvas of its own, an
// empty scene: no world), a fixed camera looking north, studio light, the set (dev/stage.js: a stage under him, a backdrop
// behind), and a copy of the character: his live model (the export the live hero draws: view/livehero.js MODELS, through
// live.modelUrl) drawn by a body of its own (view/livebody.js) on a rig of its own (render/rigmesh.js), dressed in what the
// wardrobe shows (view/dress.js), with the gunslinger's duster tail as the live hero runs it (a ClothRig on the sprite
// path's cloth, fed from the drawn pose: the live hero's THE RUNTIME CLOTH, the same steps). HE turns (his facing), the
// camera and the set never do. While it shows, the game holds (core/loop.js hold: not stepped, not drawn).
//   light   'day' | 'dusk' | 'night' | 'dawn': the ruins' moods (content/moods.js) with the sun as a key light from the front
//           left, its shadow on the set; a lamp in front when it's dark
//   pose    'idle' (his breathing loop) or one of his clips (an emote: played, held, played again)
//   frame   the camera puts his chest in the middle of what the UI leaves (area()), at a whole display scale (the wheel), in
//           whole art px (he never shifts by a pixel)
// API: const st = createStudio({host, hero, live, area}); st.show(on); st.frame(dt, t) (every frame it shows); st.look(pieces,
//   key); st.set({stage, back, light, pose}); st.turn(d) / st.spin; st.zoom(d); st.reframe(); st.photo() (a PNG, the next frame); st.emotes; st.ready.
// OWNS: its canvas, renderer, rigs, bodies, cloth, light. READS: hero (the loadout, its atlas's cloth), live (the model's URL).
// BUDGET: hidden: nothing. Shown: a frame of its own small scene (the game's held instead); a change of look: a dress (2-25 ms).
import * as THREE from 'three';
import {createGfx, DEG} from '../render/gfx.js';
import {createRigMesh} from '../render/rigmesh.js';
import {liveModel, createLiveBody, qrot} from '../view/livebody.js';
import {ClothRig} from '../view/cloth.js';
import {dress} from '../view/dress.js';
import {MOODS, CHAR} from '../content/moods.js';
import {lum} from '../core/color.js';
import {createStage} from './stage.js';

const TAU = Math.PI * 2;
const wrap = a => a - TAU * Math.round(a / TAU);
const GRADE = [1.039, 1.029, .818];   // (the ruins': render/lighting.js GRADE)
// the light: a mood, the key light's direction (az from north, clockwise; el up), a lamp in front (or none)
const LIGHTS = {
  day: {mood: 'day', az: 212, el: 48, lamp: null},
  dawn: {mood: 'dusk', az: 150, el: 16, lamp: [1, .78, .55, .5]},
  dusk: {mood: 'dusk', az: 228, el: 16, lamp: [1, .7, .45, .6]},
  night: {mood: 'night', az: 200, el: 38, lamp: [1, .76, .48, 1]},
};
const CHEST = .9;   // m: the height framed in the middle

export function createStudio({host, hero, live, area}) {
  const canvas = document.createElement('canvas'); canvas.id = 'wd-canvas';
  canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:21;display:none;image-rendering:pixelated;cursor:grab;touch-action:none';
  document.body.appendChild(canvas);
  const PPM = host.PPM, PPMY = host.PPMY, PPMH = host.PPMH;
  let G = null, rig = null, stage = null, S = 4, VW = 0, VH = 0, shown = false;
  const T = new THREE.Vector3(), sunDir = new THREE.Vector3();
  const st = {phi: 0, spin: false, light: 'day', pose: 'idle', poseT: 0, zoomK: 0, panX: 0, panY: 0};
  // ---------------------------------------------------------------- the character: his live model, a body, his cloth
  const C = {name: '', LM: null, J: null, bin: null, body: null, loading: null, key: '', clothCol: null, emotes: []};
  const D = {pose: 'idle.0', phi: 0, x: 0, y: 0, z: 0, sx: 0, sy: 0, sh: 0, aim: false, alpha: 1, flash: 0, lie: 0, type: 7};
  function load(name) {
    const url = live?.modelUrl?.(name); C.name = name; C.LM = C.body = null; C.key = ''; CLO.reset();
    if (!url) return;   // (a sprite loadout: no live model to show)
    rig ??= createRigMesh(G, {slots: 1});
    const want = name;
    C.loading = Promise.all([fetch(url + 'model.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }), fetch(url + 'model.bin').then(r => r.arrayBuffer())])
      .then(async ([J, bin]) => {
        if (C.name !== want) return;
        const LM = liveModel(rig, J, bin); await rig.warm().catch(() => {});
        if (C.name !== want) return;
        C.J = J; C.bin = bin; C.LM = LM; C.body = createLiveBody(LM, rig, 0, G);
        C.emotes = (J.live || []).filter(n => J.clips[n] && LM.poseOf(n + '.0'));
        if (look0) st2.look(look0.pieces, look0.key, true);
      })
      .catch(e => console.warn('studio: no model for', name, e));
  }
  let look0 = null;   // (the look asked for before the model was in)
  // his pose this frame: the clip's frame by its own timing (ms a frame, or fps); an emote plays, holds 1.2 s, plays again
  function poseName(dt) {
    const J = C.J, c = J?.clips[st.pose]; if (!c) return 'idle.0';
    st.poseT += dt * 1000;
    const ms = c.ms || null, f0 = 1000 / (c.fps || 8), n = c.frames;
    const dur = ms ? ms.reduce((a, b) => a + b, 0) : n * f0, hold = c.loop ? 0 : 1200, cyc = dur + hold;
    let t = st.poseT % cyc, i = 0;
    if (t >= dur) i = n - 1;
    else if (ms) { while (i < n - 1 && t >= ms[i]) t -= ms[i++]; }
    else i = Math.min(n - 1, Math.floor(t / f0));
    return `${st.pose}.${i}`;
  }
  // THE DUSTER'S CLOTH (view/livehero.js's runtime cloth, the same steps on this body): the sprite path's ClothRig on the
  // atlas's cloths, its capsules from the atlas's idle.0 against the model's idle.0 bones, fed from the drawn pose
  const QI = new Float64Array(4), V3 = new Float64Array(3), CT = new Float64Array(12), G0 = [0, 0];
  const CLO = {rig: null, D: null, tried: false, sim: null, capB: null, capL: null, matB: null, hip: -1, fams: null,
    reset() { CLO.tried = false; CLO.rig = CLO.D = null; }};
  function clothSetup() {
    const LM = C.LM, J = C.J, R0 = hero.rig, idx = R0?.idx;
    if (!R0?.active || !idx || idx.model !== J.meta.loadout) return;
    CLO.tried = true;
    const ref = hero.SP?.['idle.0']?.sim, live0 = LM.poseOf('idle.0'), hip = J.segs.findIndex(sg => sg.bone === 'Hips');
    if (!ref || !live0 || hip < 0) return;
    const names = idx.sim.capsule_names || [], nc = names.length;
    CLO.capB = Int16Array.from(names, n => LM.IX[n] ?? -1); CLO.capL = new Float64Array(nc * 7);
    for (let i = 0; i < nc; i++) {
      const b = CLO.capB[i], c = ref.caps[i]; if (b < 0 || !c) continue;
      const o = b * 7; QI[0] = -live0.w[o]; QI[1] = -live0.w[o + 1]; QI[2] = -live0.w[o + 2]; QI[3] = live0.w[o + 3];
      for (let e = 0; e < 2; e++) {
        qrot(QI, 0, c[e * 3] - live0.w[o + 4], c[e * 3 + 1] - live0.w[o + 5], c[e * 3 + 2] - live0.w[o + 6], V3, 0);
        CLO.capL[i * 7 + e * 3] = V3[0]; CLO.capL[i * 7 + e * 3 + 1] = V3[1]; CLO.capL[i * 7 + e * 3 + 2] = V3[2];
      }
      CLO.capL[i * 7 + 6] = c[6];
    }
    const R = new ClothRig(idx); if (!R.active) return;
    const fams = []; let corners = 0;
    for (const Cl of R.cloths) { const f = J.families.find(x => x.name === Cl.def.fam); if (!f) return; fams.push(f); corners += (Cl.rows - 1) * (Cl.cols - 1) * 6; }
    CLO.sim = {mats: {}, caps: Array.from({length: nc}, () => [0, 0, 0, 0, 0, 0, 0])};
    CLO.matB = R.cloths.map(Cl => { CLO.sim.mats[Cl.def.bone] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; return LM.IX[Cl.def.bone] ?? -1; });
    if (CLO.matB.some(b => b < 0)) return;
    CLO.D = rig.attach(LM.model, corners, fams); CLO.rig = R; CLO.hip = hip; CLO.fams = fams;
    let k = 0;
    R.cloths.forEach((Cl, ci) => {
      const part = 255 - ci, bias = Math.max(-127, Math.min(127, Math.round((Cl.def.bias ?? 0) * 100)));
      for (let i = 0; i < (Cl.rows - 1) * (Cl.cols - 1) * 6; i++, k++) { CLO.D.info[k * 4] = hip; CLO.D.info[k * 4 + 1] = part; CLO.D.info[k * 4 + 2] = CLO.D.fam[ci]; CLO.D.info[k * 4 + 3] = 0; CLO.D.nrm[k * 4 + 3] = bias; }
    });
    clothPaint();
  }
  function clothPaint() {
    const Dc = CLO.D; if (!Dc) return;
    let k = 0;
    CLO.rig.cloths.forEach((Cl, ci) => {
      const row = Dc.famRow(C.clothCol && C.clothCol !== 'off' ? C.clothCol : CLO.fams[ci]);
      for (let i = 0; i < (Cl.rows - 1) * (Cl.cols - 1) * 6; i++, k++) Dc.info[k * 4 + 2] = row;
    });
    Dc.infoChanged();
  }
  let clC = 1, clS = 0, clO = null, clW = null, clH = 0, clV = 0;
  function clLocal(p, j) {
    const dx = p[0] - clO[0], dy = p[1] - clO[1], bx = clC * dx + clS * dy, by = -clS * dx + clC * dy;
    qrot(QI, 0, bx - clW[clH + 4], by - clW[clH + 5], p[2] - clW[clH + 6], V3, 0); CT[j] = V3[0]; CT[j + 1] = V3[1]; CT[j + 2] = V3[2];
  }
  function clTri(Dc, a, b, c) {
    const ux = CT[b * 3] - CT[a * 3], uy = CT[b * 3 + 1] - CT[a * 3 + 1], uz = CT[b * 3 + 2] - CT[a * 3 + 2];
    const wx = CT[c * 3] - CT[a * 3], wy = CT[c * 3 + 1] - CT[a * 3 + 1], wz = CT[c * 3 + 2] - CT[a * 3 + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
    nx = Math.round(nx / nl * 127); ny = Math.round(ny / nl * 127); nz = Math.round(nz / nl * 127);
    for (let e = 0; e < 3; e++) {
      const j = (e === 0 ? a : e === 1 ? b : c) * 3, v = clV++;
      Dc.pos[v * 3] = CT[j]; Dc.pos[v * 3 + 1] = CT[j + 1]; Dc.pos[v * 3 + 2] = CT[j + 2];
      Dc.nrm[v * 4] = nx; Dc.nrm[v * 4 + 1] = ny; Dc.nrm[v * 4 + 2] = nz;
    }
  }
  function cloth(w, phi, dt) {
    if (!CLO.tried) clothSetup();
    const R = CLO.rig; if (!R) return;
    for (let ci = 0; ci < R.cloths.length; ci++) {
      const o = CLO.matB[ci] * 7, M = CLO.sim.mats[R.cloths[ci].def.bone], x = w[o], y = w[o + 1], z = w[o + 2], q = w[o + 3];
      M[0] = 1 - 2 * (y * y + z * z); M[1] = 2 * (x * y - z * q); M[2] = 2 * (x * z + y * q); M[3] = w[o + 4];
      M[4] = 2 * (x * y + z * q); M[5] = 1 - 2 * (x * x + z * z); M[6] = 2 * (y * z - x * q); M[7] = w[o + 5];
      M[8] = 2 * (x * z - y * q); M[9] = 2 * (y * z + x * q); M[10] = 1 - 2 * (x * x + y * y); M[11] = w[o + 6];
    }
    for (let i = 0; i < CLO.capB.length; i++) {
      const b = CLO.capB[i], c = CLO.sim.caps[i]; if (b < 0) { c[6] = 0; continue; }
      const o = b * 7;
      for (let e = 0; e < 2; e++) { qrot(w, o, CLO.capL[i * 7 + e * 3], CLO.capL[i * 7 + e * 3 + 1], CLO.capL[i * 7 + e * 3 + 2], V3, 0); c[e * 3] = V3[0] + w[o + 4]; c[e * 3 + 1] = V3[1] + w[o + 5]; c[e * 3 + 2] = V3[2] + w[o + 6]; }
      c[6] = CLO.capL[i * 7 + 6];
    }
    const N = R.N, k = wrap(phi) / (TAU / N);   // (his facing from the camera, which looks north: yaw 0)
    R.update(Math.min(dt, .05), CLO.sim, k, G0);
    const a = (R.idx.cam.yaw0 + 360 / N * k) * DEG;
    clC = Math.cos(a); clS = Math.sin(a); clO = R.origin; clW = w; clH = C.LM.SEG[CLO.hip] * 7; clV = 0;
    QI[0] = -w[clH]; QI[1] = -w[clH + 1]; QI[2] = -w[clH + 2]; QI[3] = w[clH + 3];
    for (const Cl of R.cloths) {
      const pts = Cl.pos, cols = Cl.cols; if (!pts) continue;
      for (let r = 0; r < Cl.rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
        const i00 = r * cols + c;
        clLocal(pts[i00], 0); clLocal(pts[i00 + 1], 3); clLocal(pts[i00 + cols], 6); clLocal(pts[i00 + cols + 1], 9);
        clTri(CLO.D, 0, 2, 1); clTri(CLO.D, 1, 2, 3);
      }
    }
    CLO.D.update(C.clothCol === 'off' ? 0 : clV);
  }

  // ---------------------------------------------------------------- the view, the light
  function size() {
    const H = innerHeight, W = innerWidth, a = area(), base = Math.max(2, Math.floor(.5 * a.h / (2 * PPMH)));
    S = Math.max(1, base + st.zoomK);
    VW = Math.ceil(W / S) + (Math.ceil(W / S) & 1); VH = Math.ceil(H / S) + (Math.ceil(H / S) & 1);
    G.resize(VW, VH); G.setDisplay(S, 1);
    canvas.style.width = VW * S + 'px'; canvas.style.height = VH * S + 'px';
    // his chest at the area's middle: the feet a whole number of art px from the view's centre
    const ox = Math.round((a.cx - W / 2) / S) + st.panX, oy = Math.round((a.cy - H / 2) / S + CHEST * PPMH) + st.panY;
    T.set(-ox / PPM, 0, -oy / PPMY);
    G.setView(T, 0, 1);
  }
  const SHADOW_EL_MIN = Math.atan(1 / 1.7), shadowDir = new THREE.Vector3(), NOLIGHT = {el: 0, c: [1, 1, 1], shadow: 0, cloud: 0, mist: 0, wet: 0};
  function light() {
    const L = LIGHTS[st.light] || LIGHTS.day, m = MOODS.ruins[L.mood], U = G.compU, amb = m.amb;
    U.uAmb.value.set(amb[0], amb[1], amb[2]);
    const az = L.az * DEG, el = L.el * DEG, sel = Math.max(el, SHADOW_EL_MIN);
    sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    shadowDir.set(Math.sin(az) * Math.cos(sel), Math.sin(sel), -Math.cos(az) * Math.cos(sel));
    G.setSun(sunDir, shadowDir);
    const sc = m.sun.c; U.uSunC.value.set(sc[0], sc[1], sc[2]); U.uSunStr.value = (m.sun.k ?? .4) * 2.2; U.uSunK.value = m.sun.k;
    U.uShadowA.value = m.shadow.a; U.uShadowC.value.set(m.shadow.c[0], m.shadow.c[1], m.shadow.c[2]); U.uFog.value.set(0, 0, 0, 0);
    U.uShadeT.value.set(1, 1, 1, 0); U.uShadeL.value.set(0, 0, 0); U.uShadeH.value.set(1, 1, 1); U.uCrest.value.set(1, .15);
    const la = Math.max(.02, lum(amb)), fk = lum(m.fill || [0, 0, 0]) / la * CHAR.fillK;
    U.uFill.value.set(amb[0] * fk, amb[1] * fk, amb[2] * fk); U.uGrade.value.set(GRADE[0], GRADE[1], GRADE[2]); U.uGradeK.value = CHAR.gradeK[L.mood] ?? 0;
    U.uEmin.value = .1 + .2 * Math.max(0, 1 - la);
    const bg = stage.bg; U.uBg.value.set(bg[0], bg[1], bg[2]);
    let n = 0;
    if (L.lamp) { U.uLP.value[0].set(1.3, 1.5, 1.6, 4.5); U.uLC.value[0].set(L.lamp[0] * L.lamp[3], L.lamp[1] * L.lamp[3], L.lamp[2] * L.lamp[3], 0); n = 1; }
    U.uNL.value = n; U.uNH.value = 0;
    G.setRays?.(NOLIGHT);
  }

  // ---------------------------------------------------------------- input on the scene: drag turns him, right-drag moves, the wheel zooms
  let drag = null;
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => { drag = {x: e.clientX, y: e.clientY, pan: e.button !== 0}; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = drag.pan ? 'move' : 'grabbing'; e.preventDefault(); });
  canvas.addEventListener('pointermove', e => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (drag.pan) { const kx = Math.trunc(dx / S), ky = Math.trunc(dy / S); if (kx || ky) { st.panX += kx; st.panY += ky; drag.x += kx * S; drag.y += ky * S; size(); } return; }
    drag.x = e.clientX; drag.y = e.clientY; st.phi = wrap(st.phi + dx * .012); st.spin = false;
  });
  const endDrag = () => { drag = null; canvas.style.cursor = 'grab'; };
  canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
  canvas.addEventListener('wheel', e => { e.preventDefault(); st2.zoom(e.deltaY < 0 ? 1 : -1); }, {passive: false});

  let shot = false;
  function save(url) {
    const a = document.createElement('a'), d = new Date(), p = n => String(n).padStart(2, '0');
    a.href = url; a.download = `riftbound_wardrobe_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  }
  const st2 = {
    canvas,
    get ready() { return !!C.body; }, get emotes() { return C.emotes; }, get modelName() { return C.name; }, get hasModel() { return !!live?.modelUrl?.(hero.loadName); },
    get spin() { return st.spin; }, set spin(v) { st.spin = !!v; },
    show(on) {
      shown = !!on;
      if (on && !G) {
        G = createGfx(canvas, {VW: 320, VH: 180, PPM, PPMY, PPMH, world: {x0: -6, y0: -6, x1: 6, y1: 6}});
        G.setOptions({outline: true, banded: true, shadows: true, debug: 0});
        stage = createStage(G);
      }
      canvas.style.display = on ? '' : 'none';
      if (on) { size(); if (C.name !== hero.loadName) load(hero.loadName); }
    },
    // the frame: his pose and cloth, the set, the light, the render
    frame(dt, t) {
      if (!shown) return;
      if (C.name !== hero.loadName) load(hero.loadName);   // (the loadout changed)
      if (st.spin && !drag) st.phi = wrap(st.phi + dt * .6);
      if (C.body) {
        D.pose = poseName(dt); D.phi = st.phi;
        C.body.draw(D, t); cloth(C.body.W, st.phi, dt); rig.render();
      }
      stage.draw(t);
      light();
      G.render();
      if (shot) { shot = false; save(canvas.toDataURL('image/png')); }   // (read in the task that drew it)
    },
    resize() { if (shown) size(); },
    // what he wears (content/gear.js pieces, as the wardrobe composes them; key: their identity)
    look(pieces, key, force = false) {
      look0 = {pieces, key};
      if (!C.LM || (key === C.key && !force)) return;
      const Dr = pieces.length ? dress(C.J, C.bin, pieces) : {J: C.J, bin: C.bin, cloth: null};
      rig.restyle(C.LM.model, Dr.J, Dr.bin); C.key = key;
      const was = C.clothCol; C.clothCol = Dr.cloth; if (C.clothCol !== was) clothPaint();
    },
    set({stage: sg, back, light: lt, pose} = {}) {
      if (sg !== undefined || back !== undefined) stage?.set({stage: sg, back});
      if (lt) st.light = lt;
      if (pose && pose !== st.pose) { st.pose = pose; st.poseT = 0; }
    },
    turn(d) { st.phi = wrap(st.phi + d); },
    zoom(d) { st.zoomK = Math.max(-3, Math.min(6, st.zoomK + d)); size(); },
    reframe() { st.zoomK = 0; st.panX = st.panY = 0; st.phi = 0; size(); },
    // a PNG of the scene (the canvas as drawn this frame: rendered again now, read in the same task)
    photo() { shot = true; },
  };
  return st2;
}
