// CONTACT SHADOWS (render3d): the arena's contact AO (concepts/sprites/arena/lighting.js "Contact AO"), ported.
// Every caster gets a small dark stamp at its base, at every time of day (also at night, without a sun): a hard core
// ellipse hugging the base + two stepped falloff rings (pixel-art steps, baked once per size, drawn 1:1 in art px), as
// wide as the sprite's bottom opaque rows, a wide faint skirt under tall occluders, smaller and fainter while airborne.
// The stamps go into one mask (overlaps merge), tinted with the mood's shadow colour and laid on the GROUND layer
// (mixed into the ground's albedo before the light; props and characters standing on it are untouched).
// Why it matters here: a character's sun shadow comes from a flat card turned to face the sun, so with the feet apart
// (aiming, running) each foot's shadow lands off to the side and only the pivot touches: without a contact shadow the
// figure reads as floating. The arena had the same flat-card limits and grounded everything this way.
//   casters  the player (his bottom rows measured per frame / facing), every world item drawn as a card (dummies,
//            brutes and enemies, trees, braziers, bushes ...) and every live mesh standing on a round footprint
//            (crates, barrels, pots, pillars, posts). Rect props (walls) have their real 3D foot: no stamp. And the
//            characters a feature draws itself (the desert's gunmen, features/foes): an entity with `foot` (its
//            footprint's half width, art px, set by its creator) gets a standing character's stamp.
// CONTRACT: create(host) -> F with frame(); F.on / F.toggle() (in the menu as "Contact shadows"), ?contact=0 starts off.
import {flags} from '../core/flags.js';
const AO_A = .5, AO_PAD = 1, AO_H = .15, AO_HMIN = 1, AO_HMAX = 2, AO_DY = 1;   // the arena's numbers (lighting.js)
const AO_RING = {pad: 2, h: 2, a: [.5, .22]};
const AO_SKIRT = {w: 1.3, pad: 3, h: 2.2, a: .14};
const AO_AIR = 1.2;        // airborne: shrinks / fades over this height (m)
const SKIP = new Set(['tuft', 'portal']);

// ORDER (core/features.js): frame only: no update
export const order = {};
export async function create(host) {
  const Q = flags;
  let VW = host.VW, VH = host.VH;   // the view size: F.resize follows the window
  const mk = (w, h, o) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const q = c.getContext('2d', o); q.imageSmoothingEnabled = false; return [c, q]; };
  const [mc, mq] = mk(VW, VH);   // this frame's mask (all stamps), then tinted
  const stamps = new Map();
  function aoStamp(hw, hh, skirt) {   // the arena's aoStamp, as is
    const key = (hw * 16 + hh) * 2 + (skirt ? 1 : 0); let e = stamps.get(key); if (e) return e;   // (hh <= AO_HMAX: a number, no string per stamp)
    const wo = hw + AO_RING.pad + (hw > 8 ? 1 : 0), ho = hh + AO_RING.h;
    const ws = skirt ? Math.round(wo * AO_SKIRT.w + AO_SKIRT.pad) : 0, hs = skirt ? Math.round(ho * AO_SKIRT.h) : 0;
    const W = Math.max(wo, ws), up = Math.max(ho, Math.round(hs * .6)), dn = Math.max(ho, hs), w = 2 * W + 1, h = up + dn + 1;
    const [c, q] = mk(w, h), id = q.createImageData(w, h), d = id.data;
    const el = (x, y, a, b) => (x * x) / (a * a) + (y * y) / (b * b);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const x = i - W, y = j - up, yd = y < 0 ? y * 1.4 : y;   // the half behind the base is mostly hidden: tighter
      let a = 0;
      if (el(x, yd, hw + .5, hh + .5) <= 1) a = 1;
      else { const t = el(x, yd, wo + .5, ho + .5); if (t <= .55) a = AO_RING.a[0]; else if (t <= 1) a = AO_RING.a[1]; }
      if (skirt && a < AO_SKIRT.a) { const y2 = j - up - hs * .35; if (el(x, y2, ws + .5, hs * .65 + .5) <= 1) a = Math.max(a, AO_SKIRT.a); }
      d[(j * w + i) * 4 + 3] = a * 255 + .5;
    }
    q.putImageData(id, 0, 0);
    e = {c, ox: W, oy: up}; stamps.set(key, e); if (stamps.size > 200) stamps.delete(stamps.keys().next().value);
    return e;
  }
  // a sprite's footprint: the extent of its bottom opaque rows (up to 3, from 2 rows below the pivot up to 16 rows),
  // relative to the pivot (the arena's footprint()). Read once per image + pivot (the player: once per frame + facing)
  const [fc, fq] = mk(1, 1, {willReadFrequently: true});
  const foot = new WeakMap(), pfoot = new Map();
  function measure(img, px, py) {
    const w = img.width, h = img.height; if (!(w > 0)) return null;
    const yb = Math.min(h - 1, Math.round(py) + 2), ya = Math.max(0, yb - 16), rh = yb - ya + 1;
    if (rh <= 0) return null;
    if (fc.width !== w || fc.height !== rh) { fc.width = w; fc.height = rh; } else fq.clearRect(0, 0, w, rh);
    fq.drawImage(img, 0, ya, w, rh, 0, 0, w, rh);
    const D = fq.getImageData(0, 0, w, rh).data;
    let x0 = 1e9, x1 = -1, rows = 0;
    for (let y = rh - 1; y >= 0 && rows < 3; y--) {
      let a = -1, b = -1;
      for (let x = 0, i = y * w * 4 + 3; x < w; x++, i += 4) if (D[i] > 100) { if (a < 0) a = x; b = x; }
      if (a < 0) { if (rows) break; continue; }
      rows++; if (a < x0) x0 = a; if (b > x1) x1 = b;
    }
    return x1 < 0 ? null : {cx: (x0 + x1 + 1) / 2 - px, hw: (x1 - x0 + 1) / 2, py};
  }
  const footSp = new WeakMap();   // the same, per sprite record (its image and pivot don't change): no key string per card per frame
  function footOf(sp) {
    const f = footSp.get(sp); if (f !== undefined) return f;
    const e = footOfImg(sp); footSp.set(sp, e); return e;
  }
  function footOfImg(sp) {
    let m = foot.get(sp.img); if (!m) foot.set(sp.img, m = new Map());
    const k = sp.pivot[0] + ':' + sp.pivot[1]; let e = m.get(k);
    if (e === undefined) { e = measure(sp.img, sp.pivot[0], sp.pivot[1]); m.set(k, e); }
    return e;
  }

  // the characters a feature draws itself (not world items): a live list, so a gunman who walks in later is in it
  const walkers = host.entities.query('contact.foot', p => p.foot > 0), WFP = {cx: 0, hw: 0};
  let n = 0;
  // one stamp: world base (x, y, h ground), footprint {cx, hw} in art px, air (m above the ground), py (the sprite's
  // pivot row: tiny things get a faint smudge), skirt (tall occluders)
  const SV = [0, 0, 0], RFP = {cx: 0, hw: 0};   // scratch: the stamp's view position, a round mesh's footprint
  function stamp(x, y, h, fp, air, py, skirt) {
    const z = host.zoom, sv = host.G.toScreenInto(x, h, y, SV), sx = sv[0], sy = sv[1];   // (= host.toView, without its arrays)
    if (sx < -40 * z || sx > VW + 40 * z || sy < -20 * z || sy > VH + 30 * z) return;
    const up = Math.min(1, air / AO_AIR), s = 1 - .35 * up;
    const a = Math.min(1, Math.max(.25, (py - 3) / 12)) * (1 - .65 * up);
    if (a < .02) return;
    const hw = Math.max(1, Math.round((fp.hw + AO_PAD) * s)), hh = Math.max(1, Math.round(Math.min(AO_HMAX, Math.max(AO_HMIN, hw * AO_H)) * s));
    const st = aoStamp(hw, hh, !!skirt && up < .5);
    mq.globalAlpha = a;
    mq.drawImage(st.c, Math.round(sx + (fp.cx - .5 - st.ox) * z), Math.round(sy + (AO_DY - st.oy) * z), st.c.width * z, st.c.height * z);
    n++;
  }

  const F = {
    name: 'contact', label: 'Contact shadows', ambient: true,  on: Q.get('contact') !== '0', get count() { return n; },
    toggle() { F.on = !F.on; },
    resize(w, h) { VW = w; VH = h; mc.width = w; mc.height = h; mq.imageSmoothingEnabled = false; },   // the view changed size (main.js fit)
    frame() {
      n = 0;
      mq.globalCompositeOperation = 'source-over'; mq.globalAlpha = 1; mq.clearRect(0, 0, VW, VH);
      // the player: his bottom rows this frame (feet apart when aiming / running: the stamp spans both)
      const ps = host.playerSprite(), P = host.P, pl = host.player, gz = host.elev(pl.x, pl.y);
      if (!(P.blink && Math.floor(P.blink * 12) % 2) && !(P.sink > .05)) {
        const key = ps.frame + '|' + ps.face; let fp = pfoot.get(key);
        if (fp === undefined) { fp = measure(ps.img, ps.px, ps.py); pfoot.set(key, fp); if (pfoot.size > 600) pfoot.delete(pfoot.keys().next().value); }
        if (fp) stamp(pl.x, pl.y, gz, fp, Math.max(0, P.z - gz), 14, false);
      }
      // world items: cards by their sprite's foot, round live meshes by their radius
      for (const it of host.world.items) {
        const p = it.p; if (p.gone || p.broken || SKIP.has(p.kind) || p.rect) continue;
        const base = p.z || 0, air = Math.max(0, p.h || 0);
        if (it.card && it.sp) { const fp = footOf(it.sp); if (fp) stamp(p.x, p.y, base, fp, air, fp.py, p.occluder || p.kind === 'tree' || p.kind === 'rock_big'); }
        else if (it.live && p.r > 0 && !p.float && !(p.sink > .05)) { RFP.hw = Math.round(p.r * host.PPM * .8); stamp(p.x, p.y, base, RFP, air, 14, false); }
      }
      for (const p of walkers) { if (p.gone || p.broken) continue; WFP.hw = p.foot; stamp(p.x, p.y, p.z || 0, WFP, Math.max(0, p.h || 0), 14, false); }
      if (!n) return;
      // tint: the mood's shadow colour, at the arena's AO opacity (night: mood.shadow.ao)
      const m = host.mood, c = m.shadow.c;
      mq.globalAlpha = 1; mq.globalCompositeOperation = 'source-in';
      mq.fillStyle = `rgb(${c[0] * 255 | 0},${c[1] * 255 | 0},${c[2] * 255 | 0})`; mq.fillRect(0, 0, VW, VH);
      mq.globalCompositeOperation = 'source-over';
      const g = host.layer('ground'); g.save(); g.globalAlpha = Math.min(1, m.shadow.ao ?? AO_A); g.drawImage(mc, 0, 0); g.restore();
    },
  };
  return F;
}
