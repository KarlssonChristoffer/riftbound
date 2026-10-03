// HERO: the Ranger as the renderer sees him. Every frame his card's picture is COMPOSITED on the CPU from the atlas
// frame (albedo + normals), the runtime cloth cloak (view/cloth.js: sim + draw), hair streaming in strong wind, the pixel
// bow and the shiny-armour metal mask. The albedo and the normals are composited in ARRAYS (pix, below) and only the box
// drawn this frame and last frame goes up (G.texData): a canvas went up whole, a snapshot of all of it each frame. The
// two canvases are the readers' copy (sprite(): contact's foot, flow's afterimages), filled only when one reads them. Also: the loadouts (which atlas: baked
// cloak / runtime cloth / bare body) and the HD bow overlay.
// OWNS: the loadout + atlas state (SP, rig, FW / FH / PIV / ND / DIRS; `atlas` is the live object player.js reads),
//   the hero card, the composite canvases, the armour, the hair cache.
// READS (app): P, PL, player, yaw, zoom, opt, cam, arrows, feat('wind'), toView.  BUDGET: char group (0.5 ms).
//   const hero = createHero({G, set, loadI, ctxO, app}); hero.moveCloth(dx, dy) + hero.stepCloth(dt) in the sim step;
//   hero.compose(PX, PY) -> sinkPx in draw (before world.update); hero.drawHDBow(hq, sc) on the HD overlay
import {texOf} from '../world/world.js';
import {loadAtlas} from '../render/atlas.js';
import {ClothRig, depthOf, CLOTH_PARAMS, setClothWind} from './cloth.js';
import {createArmor} from './armor.js';   // the shiny-armour experiment: its albedo repaint (the shine is on the GPU)
import {atlasOf} from '../sim/player/player.js';
import {cssRGBA} from '../core/color.js';

export const LOADOUTS = [['ranger basic', '../concepts/sprites/out/outfits/ranger_basic/'], ['ranger + cloth sim', '../concepts/sprites/out/outfits/ranger_sim/'], ['bare body', '../concepts/sprites/out/skel/']];
export const loadLoadout = i => loadAtlas(LOADOUTS[i][1], {ClothRig});   // (packed atlases: render/atlas.js)
const CLOTH_CALM = {wind: [...CLOTH_PARAMS.wind], gust: CLOTH_PARAMS.gust};   // the cloak's own breeze when there's no wind feature
const $ = s => document.querySelector(s);

// THE COMPOSITE IN ARRAYS: pix(w, h) is an RGBA8 picture in an array (rows top down) + the box drawn into it this frame.
// It takes what the composite's draws need: blit (an atlas frame, the cloak's box from view/cloth.js: source-over of
// whole pixels), put (one hair pixel) and the 2D calls the pixel bow makes (fillStyle, globalAlpha, source-over, save /
// restore, fillRect). A pixel whose alpha is neither 0 nor 255 is laid over by straight-alpha source-over
function pix(w, h) {
  const data = new Uint8ClampedArray(w * h * 4), u32 = new Uint32Array(data.buffer), stack = [], views = new WeakMap();
  let fv = 0xff000000, fa = 1, ga = 1, depth = 0;
  const over = (i, v, k) => {   // v (packed RGBA) at k x its alpha over the pixel
    const a = (v >>> 24) / 255 * k, d = u32[i], da = (d >>> 24) / 255, oa = a + da * (1 - a); if (oa <= 0) { u32[i] = 0; return; }
    const q = da * (1 - a), ch = s => Math.round(((v >>> s & 255) * a + (d >>> s & 255) * q) / oa);
    u32[i] = (Math.round(oa * 255) << 24 | ch(16) << 16 | ch(8) << 8 | ch(0)) >>> 0;
  };
  const T = {
    w, h, data, x0: 1e9, y0: 1e9, x1: -1e9, y1: -1e9, p0: 0, p1: 0, p2: 0, p3: 0, imageSmoothingEnabled: false, fs: '#000000',
    grow(x, y, bw, bh) { if (x < T.x0) T.x0 = x; if (y < T.y0) T.y0 = y; if (x + bw > T.x1) T.x1 = x + bw; if (y + bh > T.y1) T.y1 = y + bh; },
    clearBox() {   // last frame's box cleared, kept as p0..p3 (the upload covers it too: what was there is gone)
      if (T.x1 > T.x0) for (let y = T.y0; y < T.y1; y++) u32.fill(0, y * w + T.x0, y * w + T.x1);
      if (T.x1 > T.x0) { T.p0 = T.x0; T.p1 = T.y0; T.p2 = T.x1; T.p3 = T.y1; } else T.p0 = T.p1 = T.p2 = T.p3 = 0;
      T.x0 = T.y0 = 1e9; T.x1 = T.y1 = -1e9;
    },
    // src (an RGBA8 array, or its Uint32Array), rows sw px apart: its (sx, sy, cw, ch) at (dx, dy)
    blit(src, sw, sx, sy, cw, ch, dx, dy) {
      let S = src; if (!(S instanceof Uint32Array)) { S = views.get(src); if (!S) views.set(src, S = new Uint32Array(src.buffer, src.byteOffset, src.length >> 2)); }
      const x0 = Math.max(0, dx), y0 = Math.max(0, dy), x1 = Math.min(w, dx + cw), y1 = Math.min(h, dy + ch); if (x1 <= x0 || y1 <= y0) return;
      for (let y = y0; y < y1; y++) {
        let si = (sy + y - dy) * sw + sx + x0 - dx, di = y * w + x0;
        for (let x = x0; x < x1; x++, si++, di++) { const v = S[si], a = v >>> 24; if (a === 255) u32[di] = v; else if (a) over(di, v, 1); }
      }
      T.grow(x0, y0, x1 - x0, y1 - y0);
    },
    put(x, y, v) { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = y * w + x; if (v >>> 24 === 255) u32[i] = v; else if (v >>> 24) over(i, v, 1); T.grow(x, y, 1, 1); },
    get fillStyle() { return T.fs; },
    set fillStyle(s) { if (s === T.fs) return; const c = cssRGBA(s); T.fs = s; fa = c[3]; fv = (0xff000000 | Math.round(c[2] * 255) << 16 | Math.round(c[1] * 255) << 8 | Math.round(c[0] * 255)) >>> 0; },
    get globalAlpha() { return ga; }, set globalAlpha(v) { if (v >= 0 && v <= 1) ga = v; },
    get globalCompositeOperation() { return 'source-over'; },
    set globalCompositeOperation(v) { if (v !== 'source-over') throw new Error(`hero composite: no '${v}'`); },
    save() { const s = stack[depth] ??= {fs: '', ga: 1}; s.fs = T.fs; s.ga = ga; depth++; },
    restore() { if (depth > 0) { const s = stack[--depth]; T.fillStyle = s.fs; ga = s.ga; } },
    fillRect(x, y, bw, bh) {
      const k = fa * ga; if (!(k > 0)) return;
      const x0 = Math.max(0, Math.round(x)), y0 = Math.max(0, Math.round(y)), x1 = Math.min(w, Math.round(x + bw)), y1 = Math.min(h, Math.round(y + bh)); if (x1 <= x0 || y1 <= y0) return;
      for (let yy = y0; yy < y1; yy++) for (let i = yy * w + x0, e = yy * w + x1; i < e; i++) { if (k >= 1) u32[i] = fv; else over(i, fv, k); }
      T.grow(x0, y0, x1 - x0, y1 - y0);
    },
  };
  return T;
}

export function createHero({G, set, loadI, ctxO, app}) {
  const atlas = atlasOf(set);
  let {SP} = set, rig = set.rig, {FW, FH, PIV, ND, DIRS} = atlas;
  // the Ranger's card: sprite (+ runtime cloak) + pixel bow composited every frame, normals likewise
  const charCv = document.createElement('canvas'), nrmCv = document.createElement('canvas');
  charCv.width = nrmCv.width = 192; charCv.height = nrmCv.height = 160;   // margins: the cloth sim swings past the frame
  const cq = charCv.getContext('2d', {willReadFrequently: true}), nq = nrmCv.getContext('2d', {willReadFrequently: true});
  cq.imageSmoothingEnabled = nq.imageSmoothingEnabled = false;
  const CX = 48, CY = 40;   // where the 96 x 80 frame sits in the composite
  const A = pix(192, 160), N = pix(192, 160), imA = new ImageData(A.data, 192, 160), imN = new ImageData(N.data, 192, 160);
  const pend = [1e9, 1e9, -1e9, -1e9];   // the box the readers' canvases are behind by (sync(): put in when one is read)
  // a pose sheet's pixels, decoded once a sheet (its first frame on screen; null while an image still loads)
  const sheets = new WeakMap(), [dc, dq] = (c => [c, c.getContext('2d', {willReadFrequently: true})])(document.createElement('canvas'));
  function bytesOf(img) {
    let b = sheets.get(img); if (b) return b;
    if (img.complete === false || !(img.width > 0)) return null;
    const w = img.width, h = img.height; if (dc.width !== w || dc.height !== h) { dc.width = w; dc.height = h; } else dq.clearRect(0, 0, w, h);
    dq.drawImage(img, 0, 0); const d = dq.getImageData(0, 0, w, h).data;
    b = {u32: new Uint32Array(d.buffer, d.byteOffset, d.length >> 2), w}; sheets.set(img, b); return b;
  }
  // this frame's box + last frame's into the texture; the readers' canvases are behind by that box now
  function send(cv, T) {
    const x0 = Math.min(T.x0, T.p2 > T.p0 ? T.p0 : 1e9), y0 = Math.min(T.y0, T.p3 > T.p1 ? T.p1 : 1e9), x1 = Math.max(T.x1, T.p2 > T.p0 ? T.p2 : -1e9), y1 = Math.max(T.y1, T.p3 > T.p1 ? T.p3 : -1e9);
    if (x1 <= x0 || y1 <= y0) return;
    G.texData(cv, x0, y0, x1 - x0, y1 - y0, T.data, T.w, x0, y0);
    if (x0 < pend[0]) pend[0] = x0; if (y0 < pend[1]) pend[1] = y0; if (x1 > pend[2]) pend[2] = x1; if (y1 > pend[3]) pend[3] = y1;
  }
  function sync() {
    if (pend[2] <= pend[0]) return;
    const x = pend[0], y = pend[1], w = pend[2] - x, h = pend[3] - y;
    cq.putImageData(imA, 0, 0, x, y, w, h); nq.putImageData(imN, 0, 0, x, y, w, h);
    pend[0] = pend[1] = 1e9; pend[2] = pend[3] = -1e9;
  }
  const card = G.card({tex: texOf(charCv), nrm: texOf(nrmCv), w: 192, h: 160, px: PIV[0] + CX, py: PIV[1] + CY, type: 4, obj: 8, bias: .00125, xray: true});

  // SHINY ARMOUR (the arena's experiment; its X key turns the camera here, so it's I / the menu): armor.js repaints the
  // metal pixels dark steel / gold, and a METAL MASK aligned with the composite (255 steel, 128 gold, cleared under the
  // cloth cloak) tells the lighting pass where to add the glints and reflections (gfx.js COMP_FS)
  const armor = createArmor(ctxO);
  const metalCv = document.createElement('canvas'); metalCv.width = 192; metalCv.height = 160;
  const mq = metalCv.getContext('2d', {willReadFrequently: true}); mq.imageSmoothingEnabled = false;
  card.g.uniforms.uMetal.value = texOf(metalCv);
  const maskImgs = {}, maskDir = () => LOADOUTS[loadI][1].replace('out/outfits/', 'out/experiments/armor/');
  function maskOf(pose) {   // the pose's mask sheet (loaded once; null while loading, false when this loadout has none)
    const key = maskDir() + pose; if (key in maskImgs) return maskImgs[key];
    maskImgs[key] = null; const i = new Image(); i.onload = () => { maskImgs[key] = i; }; i.onerror = () => { maskImgs[key] = false; }; i.src = key + '.png';
    return null;
  }
  function toggleArmour() {
    armor.toggle(); armor.setAtlas(LOADOUTS[loadI][1]);
    if (armor.on) { armor.preload(Object.keys(SP)); Object.keys(SP).forEach(maskOf); }
  }
  function drawMetal(frame, sinkPx) {   // the metal mask of this frame into the composite's layout, minus what the cloak covers
    const P = app.P;
    mq.clearRect(0, 0, 192, 160);
    const m = armor.on && !sinkPx ? maskOf(frame) : null;
    card.g.uniforms.uHasMetal.value = m ? 1 : 0; if (!m) return;
    mq.drawImage(m, P.face * FW, 0, FW, FH, CX, CY, FW, FH);
    if (rig.active) {
      const id = mq.getImageData(CX, CY, FW, FH), d = id.data;
      for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) { const k = (y * FW + x) * 4; if (d[k] && rig.covers(x, y)) d[k] = d[k + 1] = d[k + 2] = 0; }
      mq.putImageData(id, CX, CY);
    }
    G.tex(metalCv, {dynamic: true});
  }

  async function switchLoadout(i) {
    const P = app.P;
    loadI = ((i % LOADOUTS.length) + LOADOUTS.length) % LOADOUTS.length;
    $('#load').classList.remove('hidden'); $('#load').textContent = 'Loading ' + LOADOUTS[loadI][0] + '…';
    const s = await loadAtlas(LOADOUTS[loadI][1], {ClothRig});
    const a = atlasOf(s), old = ND;
    Object.assign(atlas, a); set = s; SP = s.SP; rig = s.rig; ({FW, FH, PIV, ND, DIRS} = a);
    if (ND !== old) app.PL.regrid(old, ND);   // the facings re-counted for the new atlas (player.js)
    rig.reset?.();
    card.u.uPivot.value.set(PIV[0] + CX, PIV[1] + CY);
    armor.setAtlas(LOADOUTS[loadI][1]); if (armor.on) { armor.preload(Object.keys(SP)); Object.keys(SP).forEach(maskOf); }
    $('#load').classList.add('hidden');
  }

  // the cloak in the wind: the wind feature's cloth numbers (or a calm breeze), then the sim (120 Hz substeps).
  // clothPos: the Ranger's motion in the view frame, without the camera's turns (moveCloth, each sim step)
  const clothPos = [0, 0];
  const moveCloth = (dx, dy) => { clothPos[0] += dx; clothPos[1] += dy; };
  function stepCloth(dt, perf) {
    if (!rig.active) return;
    const P = app.P, W = app.feat('wind');
    setClothWind(W?.on && W.cloth?.() || CLOTH_CALM);
    perf?.begin('cloth.sim', 'char'); rig.update(dt, SP[P.frame]?.sim, P.face, clothPos); perf?.end('cloth.sim');
  }

  // HAIR IN THE WIND: once the wind at the Ranger is more than a breeze (the wind feature's strength), the hair's edge pixels
  // stream downwind on the screen by a pixel or two and lift at the crown, flickering at 10 fps like the arena's flame licks.
  // Hair = the harmonized hair ramp (a57a58 / 845f46 / 624535, read off the ID passes), inside a box round the Head bone;
  // the normals go along, so the lighting treats the strands as hair.
  // No read-back per frame: each sprite frame + facing is read ONCE off its atlas (hairOf: the hair pixels in the box,
  // which neighbours are empty, their colours) and cached; a frame then only paints the few strands that stream, one
  // fillRect each, into the composite and its normals. (Where the cloak covers a pixel it is neither hair nor empty.)
  const HAIR = new Set([0xa57a58, 0x845f46, 0x624535]);
  const hh32 = (a, b, c) => { let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1442695041) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const HB = 26, hairCache = new WeakMap(), hairCv = document.createElement('canvas'), hairQ = hairCv.getContext('2d', {willReadFrequently: true}), HAIR_A = {x: 0, y: 0, g: 0};
  hairCv.width = HB; hairCv.height = HB * 2;
  const u32Of = (d, i) => (d[i + 3] << 24 | d[i + 2] << 16 | d[i + 1] << 8 | d[i]) >>> 0;   // packed RGBA (the composite's pixels)
  // -> {bx, by (the box in frame px), n, x, y (box px), f (bits: empty at x-1, x+1, x-2, x+2, y-1), ca, cn (packed colours; cn null: no normals)}
  function hairOf(sp, face, hb) {
    let byFace = hairCache.get(sp); if (!byFace) hairCache.set(sp, byFace = []);
    if (byFace[face]) return byFace[face];
    if (sp.img.complete === false) return null;   // (an atlas still loading: try again next frame)
    const bx = Math.round((hb[0] + hb[2]) / 2) - 13, by = Math.round(Math.min(hb[1], hb[3])) - 6;
    const sx0 = Math.max(0, bx), sy0 = Math.max(0, by), sx1 = Math.min(FW, bx + HB), sy1 = Math.min(FH, by + HB);   // (inside this facing's frame)
    hairQ.clearRect(0, 0, HB, HB * 2);
    if (sx1 > sx0 && sy1 > sy0) {
      hairQ.drawImage(sp.img, face * FW + sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 - bx, sy0 - by, sx1 - sx0, sy1 - sy0);
      if (sp.nrm) hairQ.drawImage(sp.nrm, face * FW + sx0, sy0, sx1 - sx0, sy1 - sy0, sx0 - bx, HB + sy0 - by, sx1 - sx0, sy1 - sy0);
    }
    const all = hairQ.getImageData(0, 0, HB, HB * 2).data, nOff = HB * HB * 4, a = i => all[i + 3] > 0;
    const xs = [], ys = [], fs = [], ca = [], cn = [];
    for (let y = 1; y < HB; y++) for (let x = 1; x < HB - 1; x++) {
      const i = (y * HB + x) * 4; if (!a(i) || !HAIR.has(all[i] << 16 | all[i + 1] << 8 | all[i + 2])) continue;
      const f = (a(i - 4) ? 0 : 1) | (a(i + 4) ? 0 : 2) | (x >= 2 && !a(i - 8) ? 4 : 0) | (x + 2 < HB && !a(i + 8) ? 8 : 0) | (a(i - HB * 4) ? 0 : 16);
      if (!f) continue;
      xs.push(x); ys.push(y); fs.push(f); ca.push(u32Of(all, i)); cn.push(sp.nrm ? u32Of(all, nOff + i) : 0);
    }
    return (byFace[face] = {bx, by, n: xs.length, x: Int16Array.from(xs), y: Int16Array.from(ys), f: Uint8Array.from(fs), ca: Uint32Array.from(ca), cn: sp.nrm ? Uint32Array.from(cn) : null});
  }
  function hairWind(fr) {
    const P = app.P, player = app.player, yaw = app.yaw;
    const W = app.feat('wind'); if (!W?.on || !W.at) return;
    const k = Math.min(1, Math.max(0, ((W.strength || 0) - 1.05) / 1.3)); if (k <= 0) return;
    const sp = SP[fr], hb = sp?.bones?.[DIRS[P.face]]?.Head; if (!hb) return;
    const a = W.at(player.x, player.y, HAIR_A), dir = Math.sign(a.x * Math.cos(yaw) - a.y * Math.sin(yaw)) || 1;   // downwind on screen
    const H = hairOf(sp, P.face, hb); if (!H) return;
    const x0 = CX + H.bx, y0 = CY + H.by, tk = Math.floor(performance.now() / 100), cl = rig.active ? rig : null;
    const fOut = dir > 0 ? 2 : 1, fOut2 = dir > 0 ? 8 : 4;
    for (let i = 0; i < H.n; i++) {
      const x = H.x[i], y = H.y[i], f = H.f[i], fx = H.bx + x, fy = H.by + y;   // fx, fy: frame px (the cloak's covers())
      if (cl && cl.covers(fx, fy)) continue;
      const r = hh32(x0 + x, y0 + y, tk);
      let n = 0, ux = 0, uy = 0;
      if (f & fOut && r < k * .6 && !(cl && cl.covers(fx + dir, fy))) { n = k > .5 && f & fOut2 && r < (k - .5) * .5 && !(cl && cl.covers(fx + 2 * dir, fy)) ? 2 : 1; ux = dir; }   // a lock streams out
      else if (f & 16 && r > 1 - k * .2 && !(cl && cl.covers(fx, fy - 1))) { n = 1; uy = -1; }   // a tuft lifts at the crown
      for (let s = 1; s <= n; s++) {
        A.put(x0 + x + ux * s, y0 + y + uy * s, H.ca[i]);
        if (H.cn) N.put(x0 + x + ux * s, y0 + y + uy * s, H.cn[i]);
      }
    }
  }

  // the Ranger this frame: sprite (+ runtime cloak) + pixel bow, albedo and normals, sinking when he falls in -> sinkPx
  function compose(PX, PY, perf) {
    const P = app.P, PL = app.PL, opt = app.opt;
    perf?.begin('hero.compose', 'char');
    const fr = SP[P.frame] ? P.frame : 'idle.0', sp = SP[fr];
    A.clearBox(); N.clearBox();
    const sinkPx = Math.round((P.sink || 0) * 22);
    const sa = bytesOf(armor.albedo(fr, sp.img)), sn = sp.nrm ? bytesOf(sp.nrm) : null;   // (armor: metal repainted)
    if (sa) A.blit(sa.u32, sa.w, P.face * FW, 0, FW, FH - sinkPx, CX, CY + sinkPx);
    if (sn) N.blit(sn.u32, sn.w, P.face * FW, 0, FW, FH - sinkPx, CX, CY + sinkPx);
    if (rig.active && sp.depth && !sinkPx) rig.draw(A, CX, CY, depthOf(sp.depth), P.face, N);
    if (!sinkPx) hairWind(fr);
    if (!sinkPx && !opt.hdBow) PL.drawPixelBow(A, CX, CY);
    drawMetal(fr, sinkPx);
    send(charCv, A); send(nrmCv, N);
    perf?.end('hero.compose');
    card.g.uniforms.uHasNrm.value = sp.nrm ? 1 : 0;
    card.u.uAnchor.value.set(PX, P.z, PY);
    card.setVisible(!(P.blink && Math.floor(P.blink * 12) % 2));
    G.setPlayer(PX, P.z + .9, PY);
    return sinkPx;
  }

  // the HD bow (J): player.js's display-resolution string, nocked arrow and flying arrows, drawn on the HD overlay. It works
  // in the view frame at zoom 1 (its own toS / cam), so arrows go in as view-frame copies and the zoom is a transform
  function drawHDBow(hq, sc) {
    const P = app.P, PL = app.PL, cam = app.cam, toView = app.toView, VW = app.VW, VH = app.VH;
    const z = app.zoom, s2 = sc * z, [px, py] = ctxO.toS(P.x, P.y, P.z);
    const view = app.arrows.map(a => {
      const [x, y] = toView(a.x, a.y), [vx, vy] = toView(a.vx, a.vy);
      return {...a, x, y, vx, vy, trail: a.trail?.map(([tx, ty, th]) => { const [u, v] = toView(tx, ty); return [u, v, th]; })};
    });
    hq.save(); hq.translate(VW / 2 * sc * (1 - z), VH / 2 * sc * (1 - z));
    PL.drawHD(hq, s2, (Math.round(px - cam.fx) - PIV[0]) * s2, (Math.round(py - cam.fy) - PIV[1]) * s2, view);
    hq.restore();
  }

  // the Ranger as drawn this frame, for afterimages / reflections (host.playerSprite)
  // (img / nrm: the canvases, filled from the arrays when read)
  // (one kept object, filled per call: its readers use it at once; flow's afterimage copies what it keeps)
  const SPRO = {get img() { sync(); return charCv; }, get nrm() { sync(); return nrmCv; }, px: 0, py: 0, x: 0, y: 0, h: 0, frame: '', face: 0};
  const sprite = () => { const P = app.P, player = app.player, o = SPRO; o.px = PIV[0] + CX; o.py = PIV[1] + CY; o.x = player.x; o.y = player.y; o.h = P.z; o.frame = P.frame; o.face = P.face; return o; };

  return {atlas, card, armor, toggleArmour, switchLoadout, moveCloth, stepCloth, compose, drawHDBow, sprite,
    get SP() { return SP; }, get rig() { return rig; }, get ND() { return ND; }, get set() { return set; }, get loadI() { return loadI; }, get loadName() { return LOADOUTS[loadI][0]; }};
}
