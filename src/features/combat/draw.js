// COMBAT DRAW (render3d): the arena combat's drawWorld / emitters / drawOver, repainted into the 3D frame.
// Same pixels, same palettes, same timings; only WHERE they go changed:
//   lit pixels (the arena's g)        -> host.point (depth-tested world pixels, lit by the scene's lights); pixel
//                                        clusters keep their exact 1 px offsets (view-right on the ground / up in height)
//   glowing pixels (the arena's E())  -> host.glayer('emit') at the projected view pixel (added like an emitter, as there)
//   pixels in both                     -> host.point({emit: true}) (albedo + the same colour as glow)
//   ground shadows                     -> host.glayer('ground') (both drawn by the GPU)
//   numbers, HP bars, ability bar      -> F.hd (display resolution)
// Ground rings are world circles: under any yaw they project to the arena's ellipse (r * PPM, r * PPMY) * zoom.

export function createDraw(host, core, phys) {
  const {T, AB, SLOTS, S} = core, D = core.dbg;
  const TAU = Math.PI * 2, clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const RGB = new Map(), rgb = c => { let v = RGB.get(c); if (!v) { v = host.rgb(c); RGB.set(c, v); } return v; };
  const O = {size: 1, alpha: 1, emit: false};
  const pt = (x, y, h, c, size = 1, emit = false) => { O.size = size; O.emit = emit; host.point(x, y, h, rgb(c), O); };

  // per frame: the view basis in the world, per ART pixel (1 px right on the ground, 1 px toward the camera on the
  // ground, 1 px up). At zoom 2 an art pixel is 2 x 2 view px: points are sized z, layer blocks scaled by z
  let z = 1, rx = 0, ry = 0, gx = 0, gy = 0, up = 0, eq = null, gq = null;
  function basis() {
    z = host.zoom; const a = host.yaw, c = Math.cos(a), s = Math.sin(a);
    rx = c / host.PPM; ry = -s / host.PPM;           // view right
    gx = s / host.PPMY; gy = c / host.PPMY;           // view down, along the ground
    up = 1 / host.PPMH;
    eq = gq = null;
  }
  const E = () => eq ??= host.glayer('emit');
  const G = () => gq ??= host.glayer('ground');
  const px = (q, c, x, y, w = 1, h = 1) => { q.fillStyle = c; q.fillRect(x, y, w * z, h * z); };
  // world -> view px without allocating (host.toView's maths: G.toScreen); the result array is reused, destructure it
  const PV = [0, 0], _v = new host.THREE.Vector3();   // (host.VW / VH: the view size follows the window)
  const proj = (x, y, h) => { _v.set(x, h, y).project(host.G.camera); PV[0] = (_v.x + 1) / 2 * host.VW; PV[1] = (1 - _v.y) / 2 * host.VH; return PV; };
  const V = (x, y, h) => { proj(x, y, h); PV[0] = Math.floor(PV[0]); PV[1] = Math.floor(PV[1]); return PV; };
  // a block of w x h art pixels at (dx, dy) px from a world anchor: dx along view-right, dy down in HEIGHT (standing art)
  function blk(x, y, h, dx, dy, w, hh, c, emit = false) {
    for (let j = 0; j < hh; j++) for (let i = 0; i < w; i++) pt(x + (dx + i) * rx, y + (dx + i) * ry, h - (dy + j) * up, c, z, emit);
  }
  // the same on the ground plane (dy along the ground toward the camera): rings, roots
  const gpt = (x, y, h, dx, dy, c) => pt(x + dx * rx + dy * gx, y + dx * ry + dy * gy, h, c, z);
  // snap a world anchor onto the point lattice (pixel centres for odd sizes, corners for even: gfx.js POINT_VS), so
  // clusters keep their exact shape (no float seams between neighbouring pixels)
  const SN = [0, 0, 0];
  function snap(x, y, h) {
    const s = proj(x, y, h), o = z & 1 ? .5 : 0;
    const dx = (Math.floor(s[0] + .5 - o) + o - s[0]) / z, dy = (Math.floor(s[1] + .5 - o) + o - s[1]) / z;   // in art px
    SN[0] = x + dx * rx; SN[1] = y + dx * ry; SN[2] = h - dy * up; return SN;
  }
  // a ground ellipse of radius r metres around a view px centre (the arena's ellipse())
  function ellipse(cx, cy, r, fn) {
    const ex = r * host.PPM * z, ey = r * host.PPMY * z, n = Math.max(12, Math.round((ex + ey) / z * 1.6));
    for (let i = 0; i < n; i++) { const a = i / n * TAU; fn(Math.round(cx + Math.cos(a) * ex), Math.round(cy + Math.sin(a) * ey), i, n, a); }
  }
  // the same ellipse as world points on the ground (depth-tested): fn(i, n) -> colour | null
  function ringPts(x, y, h, r, fn) {
    const ex = r * host.PPM, ey = r * host.PPMY, n = Math.max(12, Math.round((ex + ey) * 1.6)), ca = Math.cos(host.yaw), sa = Math.sin(host.yaw);
    for (let i = 0; i < n; i++) {
      const c = fn(i, n); if (!c) continue;
      const a = i / n * TAU, vx = Math.cos(a) * r, vy = Math.sin(a) * r;   // view-frame offset -> world
      pt(x + vx * ca + vy * sa, y - vx * sa + vy * ca, h, c, z);
    }
  }

  // ---------------- the waterline ----------------
  // a sunk crate / a floating barrel meets the water: a 1 px foam line along its footprint at the water's height and
  // a slow ripple ring (the arena cut its sprite at the waterline and added a foam row). On the ground layer, so only the
  // water pixels around the prop show it: the prop itself covers the rest
  const FOAM = '#d6e8ec', RIPPLE = '#b9d7dd';
  function seg(q, ax, ay, bx, by, c) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay))));
    for (let i = 0; i <= n; i++) { q.fillStyle = c; q.fillRect(Math.round(ax + (bx - ax) * i / n), Math.round(ay + (by - ay) * i / n), 1, 1); }
  }
  function outline(q, x, y, h, crate, grow, c) {
    const P = [];
    if (crate) { const s = .37 + grow; P.push([x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s]); }
    else { const r = .31 + grow; for (let i = 0; i < 20; i++) { const a = i / 20 * TAU; P.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); } }
    const S = P.map(([px_, py_]) => { const v = proj(px_, py_, h); return [v[0], v[1]]; });
    for (let i = 0; i < S.length; i++) { const a = S[i], b = S[(i + 1) % S.length]; seg(q, a[0], a[1], b[0], b[1], c); }
  }
  function waterline() {
    const wh = host.world.waterH ?? -.18, t = core.simT, S = host.layout.stream;
    for (const q of phys.mov) {   // (only the movables sink: combat/props.js)
      // in the channel (inStream says false right ON a sunk crate: it became a stepping stone, dry footing)
      if (!q.sink || q.gone || q.broken || !S || Math.abs(q.x - S.cx(q.y)) > S.w(q.y) / 2 + .4) continue;
      const crate = q.kind === 'crate', g = G();
      outline(g, q.x, q.y, wh, crate, 0, FOAM);
      const k = (t * .8 + q.x * .37) % 1;   // one ring at a time, drifting out and fading
      g.globalAlpha = (1 - k) * .55; outline(g, q.x, q.y, wh, crate, .05 + k * .3, RIPPLE); g.globalAlpha = 1;
    }
  }

  // ---------------- the world, every rendered frame ----------------
  function frame() {
    basis();
    waterline();
    const simT = core.simT;
    // brutes: the painted card's facing (16 steps, the biome's convention) from the world facing, seen from this camera
    for (const b of core.brutes) {
      const [dx, dy] = b.faceW || [0, 1], a = host.yaw, vx = dx * Math.cos(a) - dy * Math.sin(a), vy = dx * Math.sin(a) + dy * Math.cos(a);
      b.face = ((Math.round(Math.atan2(vx, vy) / (TAU / 16)) % 16) + 16) % 16;
    }
    // arrow rain telegraph: a dotted ring that crawls, an inner ring closing in on the impact time
    for (const Z of D.zones) {
      if (Z.t > T.rainDelay + T.rainDur + .3) continue;
      const k = Z.t / T.rainDelay, crawl = Math.floor(Z.t * 24), h = Z.z + .01, [cx, cy] = V(Z.x, Z.y, Z.z);
      ringPts(Z.x, Z.y, h, T.rainR, i => (i + crawl) % 5 < 3 ? '#f2d27a' : null);
      ellipse(cx, cy, T.rainR, (x, y, i) => { if ((i + crawl) % 5 < 3 && (k < 1 || (i & 1))) px(E(), '#8a6a20', x, y); });
      if (k < 1) {
        ringPts(Z.x, Z.y, h, T.rainR * (1 - k), i => i % 3 === 0 ? '#ffb050' : null);
        ellipse(cx, cy, T.rainR * (1 - k), (x, y, i) => { if (i % 3 === 0) px(E(), '#a05818', x, y); });
      } else if (k < 1.25) ellipse(cx, cy, T.rainR, (x, y) => px(E(), '#ffe8b0', x, y));   // impact flash
    }
    // traps: a small iron jaw; armed = a blinking ember eye and a faint range ring
    for (const q of D.traps) {
      if (!q.done) {
        const [x, y, h] = snap(q.x, q.y, q.z);
        blk(x, y, h, -3, -1, 7, 2, '#34363c'); blk(x, y, h, -3, -1, 7, 1, '#8a8e98');
        for (const dx of [-2, 0, 2]) blk(x, y, h, dx, -2, 1, 1, '#c8ccd4');
        if (q.t >= T.trapArm) {
          if (Math.floor(q.t * 3) % 2 === 0) { blk(x, y, h, 0, 0, 1, 1, '#ff6a30'); const [ex, ey] = V(q.x, q.y, q.z); px(E(), '#ff5a20', ex, ey); }
          ringPts(q.x, q.y, q.z + .01, T.trapR, i => i % 9 === 0 ? '#5a5e68' : null);
        } else blk(x, y, h, 0, 0, 1, 1, '#5a5e68');
      }
      if (q.spikes) for (const s of q.spikes) {   // iron spikes punch up then sink
        if (s.t < 0) continue; const k = s.t / .5; if (k > 1) continue;
        const hgt = Math.round((k < .2 ? k / .2 : 1 - (k - .2) / .8) * 9); if (hgt <= 0) continue;
        const [x, y, h] = snap(s.x, s.y, q.z);
        blk(x, y, h, 0, -hgt, 1, hgt, '#5a5e68'); blk(x, y, h, 0, -hgt, 1, 1, '#e8ecf4');
        if (k < .3) { const [ex, ey] = V(s.x, s.y, q.z); px(E(), '#a0c8f0', ex, ey - hgt * z, 1, 2); }
      }
    }
    // brutes: roots while held, a blob shadow under a hop (the arena host drew one when its contact AO was off)
    for (const b of core.brutes) {
      if (b.broken) continue;
      const bz = b.z || 0;
      if ((b.h || 0) > .02) {
        const [sx, sy] = V(b.x, b.y, bz), w = Math.max(3, 8 - Math.round(b.h * 4)), g = G(); g.fillStyle = 'rgba(12,16,10,.38)';
        for (let r = -1; r <= 1; r++) { const hw = Math.round(w * Math.sqrt(1 - (r / 1.8) ** 2)); g.fillRect(sx - hw * z, sy + r * z, hw * 2 * z, z); }
      }
      if (b.rooted) {
        const s = core.BS.get(b), blink = s.root < .5 && Math.floor(s.root * 12) % 2;
        if (!blink) {
          const [x, y, h] = snap(b.x, b.y, bz);
          for (let i = 0; i < 7; i++) {
            const a = i / 7 * TAU + simT * 1.5, ox = Math.round(Math.cos(a) * 8), oy = Math.round(Math.sin(a) * 3), c = i & 1 ? '#8a8e98' : '#34363c';
            gpt(x, y, h + up, ox, oy, c); gpt(x, y, h + 2 * up, ox, oy, c);
          }
        }
      }
    }
    // debris chunks (solid pixels); settled ones blink out at the end
    for (const c of D.debris) {
      if (c.rest && c.t > c.life - .6 && Math.floor(c.t * 10) % 2) continue;
      if (c.sh.length === 1) { pt(c.x, c.y, c.a, c.pal[c.ci], z); continue; }
      const [x, y, h] = snap(c.x, c.y, c.a);
      for (const [dx, dy, o] of c.sh) blk(x, y, h, dx, dy, 1, 1, c.pal[Math.min(3, c.ci + o)]);
    }
    // coins: a spinning 2 px disc with a glint (the glint also glows)
    for (const c of D.coins) {
      if (c.t < 0) continue;
      const f = Math.floor(c.t * 10 + c.ph) % 4, [x, y, h] = snap(c.x, c.y, c.a);
      if (!c.mag && !c.rest) {   // its shadow on the ground while it flies
        const ge = host.elev(c.x, c.y), [sx, sy] = V(c.x, c.y, ge), [, cy0] = V(c.x, c.y, c.a);
        if (sy - cy0 > 2 * z) { const g = G(); g.fillStyle = '#1c1a14'; g.fillRect(sx, sy, 2 * z, z); }
      }
      if (f === 1 || f === 3) { blk(x, y, h, 0, -1, 1, 2, '#c8922a'); blk(x, y, h, 0, -1, 1, 1, '#ffe07a'); }
      else {
        blk(x, y, h, -1, -1, 2, 2, '#e8b83a'); blk(x, y, h, 0, 0, 1, 1, '#a8761e'); blk(x, y, h, -1, -1, 1, 1, '#fff2b0');
        const [ex, ey] = V(c.x, c.y, c.a); px(E(), '#806020', ex - z, ey - z);
      }
      if (c.rest && (c.t + c.ph) % 1.4 < .08) { const [ex, ey] = V(c.x, c.y, c.a), e = E(); px(e, '#fff4c0', ex - z, ey - 3 * z, 1, 1); px(e, '#fff4c0', ex - 2 * z, ey - 2 * z, 3, 1); }
    }
    // shock rings: glowing ones on the emit layer (as the arena's E), dust ones as lit ground pixels
    for (const r of D.rings) {
      const k = r.t / r.life, rad = r.r * (1 - (1 - k) * (1 - k)), col = r.pal[Math.min(r.pal.length - 1, Math.floor(k * r.pal.length))];
      if (r.emit) { const [cx, cy] = V(r.x, r.y, r.z); ellipse(cx, cy, rad, (x, y, i) => { if (k < .5 || i % 2) px(E(), col, x, y); }); }
      else ringPts(r.x, r.y, r.z + .01, rad, i => k < .5 || i % 2 ? col : null);
    }
    // particles (lit; emissive ones glow in their own colour too, as the arena drew them on both layers)
    for (const q of D.fx) {
      if (q.t < 0) continue;
      const k = q.t / q.life, col = q.pal[Math.min(q.pal.length - 1, Math.floor(k * q.pal.length))], s = q.sz > 1 ? Math.max(1, Math.round(q.sz * (1 - k * 1.3))) : 1;
      pt(q.x, q.y, q.a, col, s * z, q.emit);
    }
  }

  // ---------------- HD layer: HP bars, damage numbers, the ability bar ----------------
  const mouse = {x: -1, y: -1};
  let hdCanvas = null;
  const onMove = e => { if (!hdCanvas) return; const r = hdCanvas.getBoundingClientRect(); mouse.x = (e.clientX - r.left) * hdCanvas.width / (r.width || 1); mouse.y = (e.clientY - r.top) * hdCanvas.height / (r.height || 1); };
  addEventListener('mousemove', onMove);
  function hd(og, scale) {
    hdCanvas = og.canvas;
    const H = (x, y, h) => { const s = host.toView(x, y, h); return [s[0] * scale, s[1] * scale]; };
    og.save();
    // HP bars over hurt brutes (with a lagging white chip)
    for (const b of core.brutes) {
      if (b.broken || b.hp >= b.maxHp) { b.hpShow = b.hp; continue; }
      b.hpShow = Math.max(b.hp, (b.hpShow ?? b.hp) - b.maxHp * .012);
      const [x, y] = H(b.x, b.y, (b.z || 0) + (b.h || 0) + (b.hitH ?? 1.6) + .35), w = Math.round(12 * scale), hh = Math.max(3, Math.round(scale * 1.1));
      const x0 = Math.round(x - w / 2), y0 = Math.round(y);
      og.fillStyle = 'rgba(14,10,14,.85)'; og.fillRect(x0 - 1, y0 - 1, w + 2, hh + 2);
      og.fillStyle = '#f4efe4'; og.fillRect(x0, y0, Math.round(w * b.hpShow / b.maxHp), hh);
      og.fillStyle = b.rooted ? '#8ab0d8' : b.bar || '#d8483a'; og.fillRect(x0, y0, Math.round(w * b.hp / b.maxHp), hh);   // (bar: an affix's colour, features/affixes.js)
    }
    // damage numbers: pop, rise, fade; crits bigger and gold
    og.textAlign = 'center'; og.textBaseline = 'middle'; og.lineJoin = 'round';
    for (const n of D.nums) {
      const k = n.t / .8, [x, y] = H(n.x, n.y, n.h), pop = n.t < .07 ? 1.55 - n.t / .07 * .55 : 1;
      const sz = Math.round((n.crit ? 7 : 4.6) * scale * .95 * pop), rise = (1 - (1 - k) ** 2) * 9 * scale;
      og.globalAlpha = k > .7 ? 1 - (k - .7) / .3 : 1;
      og.font = `800 ${Math.max(10, sz)}px "Segoe UI", system-ui, sans-serif`;
      const txt = n.crit ? n.v + '!' : '' + n.v, yy = Math.round(y - rise);
      og.lineWidth = Math.max(2.5, scale * .9); og.strokeStyle = 'rgba(20,12,16,.92)'; og.strokeText(txt, Math.round(x), yy);
      og.fillStyle = n.crit ? (n.t < .1 ? '#fff6c8' : '#ffc83a') : '#f4efe4'; og.fillText(txt, Math.round(x), yy);
    }
    og.globalAlpha = 1;
    og.restore();
    bar(og, scale);
  }
  // the ability bar + gold (+ tooltip). While nothing on it moves (no cooldown, flash, cast, gold pop) it is drawn once
  // into a cache canvas and blitted (text + fonts cost ~.15 ms a frame otherwise)
  const barGeo = (W, HH, scale) => {
    const Sz = Math.round(clamp(scale * 12, 26, 56)), gap = Math.round(Sz * .22), tw = SLOTS.length * Sz + (SLOTS.length - 1) * gap;
    return {Sz, gap, tw, bx: Math.round((W - tw) / 2), by: HH - Sz - Math.round(Sz * .35)};
  };
  let barC = null, barKey = '';
  function bar(og, scale) {
    const W = og.canvas.width, HH = og.canvas.height;
    const live = S.goldPop > 0 || SLOTS.some(k => { const ab = AB[k]; return ab.t > 0 || ab.deny > 0 || ab.ready > 0 || ab.cast > 0; });
    if (live) { barKey = ''; drawBar(og, W, HH, scale); return; }
    const {Sz, gap, bx, by} = barGeo(W, HH, scale);
    const hi = mouse.y >= by && mouse.y < by + Sz ? SLOTS.findIndex((k, i) => mouse.x >= bx + i * (Sz + gap) && mouse.x < bx + i * (Sz + gap) + Sz) : -1;
    const key = `${W}|${HH}|${scale}|${S.gold}|${hi}|${slotsOn()}`;
    if (key !== barKey) {
      barC ??= document.createElement('canvas');
      if (barC.width !== W || barC.height !== HH) { barC.width = W; barC.height = HH; }
      const q = barC.getContext('2d'); q.clearRect(0, 0, W, HH); drawBar(q, W, HH, scale); barKey = key;
    }
    og.drawImage(barC, 0, 0);
  }
  // a gun loadout has no bow abilities (host.weapon: features/gun.js takes RMB for the fan): the gold stays where it is,
  // the slots go (the revolver's cylinder sits there: ui/cylinder.js)
  const slotsOn = () => host.weapon?.abilities !== false;
  function drawBar(og, W, HH, scale) {
    og.save();
    const {Sz, gap, tw, bx, by} = barGeo(W, HH, scale), on = slotsOn();
    if (on) { og.fillStyle = 'rgba(12,10,16,.55)'; og.fillRect(bx - 6, by - 6, tw + 12, Sz + 12); }
    let hover = null;
    if (on) SLOTS.forEach((k, i) => {
      const ab = AB[k], x = bx + i * (Sz + gap), cx = x + Sz / 2, cy = by + Sz / 2;
      if (mouse.x >= x && mouse.x < x + Sz && mouse.y >= by && mouse.y < by + Sz) hover = {ab, x: cx, k};
      og.fillStyle = '#16141c'; og.fillRect(x, by, Sz, Sz);
      og.fillStyle = 'rgba(255,255,255,.05)'; og.fillRect(x + 1, by + 1, Sz - 2, Sz * .45);
      icon(og, k, cx, cy + Sz * .06, Sz * .3, ab.t > 0 ? '#8a8490' : ab.col);
      if (ab.t > 0) {   // cooldown sweep (clockwise from 12 o'clock) + seconds left
        const f = ab.t / ab.cd;
        og.save(); og.beginPath(); og.rect(x, by, Sz, Sz); og.clip();
        og.fillStyle = 'rgba(6,4,10,.66)'; og.beginPath(); og.moveTo(cx, cy); og.arc(cx, cy, Sz, -Math.PI / 2, -Math.PI / 2 + TAU * f); og.closePath(); og.fill();
        og.restore();
        og.font = `700 ${Math.round(Sz * .34)}px "Segoe UI", system-ui, sans-serif`; og.textAlign = 'center'; og.textBaseline = 'middle';
        og.lineWidth = 3; og.strokeStyle = 'rgba(10,8,12,.9)'; const s = ab.t >= 1 ? Math.ceil(ab.t) + '' : ab.t.toFixed(1);
        og.strokeText(s, cx, cy + 1); og.fillStyle = '#f4efe4'; og.fillText(s, cx, cy + 1);
      }
      og.lineWidth = 1;
      og.strokeStyle = ab.deny > 0 ? '#e0483a' : ab.ready > 0 ? '#fff8e0' : ab.t > 0 ? '#3a3640' : 'rgba(242,210,122,.55)';
      og.strokeRect(x + .5, by + .5, Sz - 1, Sz - 1);
      if (ab.ready > 0) { og.globalAlpha = ab.ready / .3; og.strokeStyle = ab.col; og.lineWidth = 2; og.strokeRect(x - 2, by - 2, Sz + 4, Sz + 4); og.globalAlpha = 1; }
      // key label
      og.font = `700 ${Math.max(9, Math.round(Sz * .24))}px "Segoe UI", system-ui, sans-serif`; og.textAlign = 'left'; og.textBaseline = 'top';
      const kw = og.measureText(ab.key).width + 5;
      og.fillStyle = 'rgba(10,8,12,.85)'; og.fillRect(x + 1, by + 1, kw, Math.round(Sz * .28));
      og.fillStyle = '#f2d27a'; og.fillText(ab.key, x + 3.5, by + 2);
      if (ab.cast > 0) {   // the name floats up over the slot when cast
        const k2 = 1 - ab.cast / .9; og.globalAlpha = k2 > .7 ? 1 - (k2 - .7) / .3 : 1;
        og.font = `700 ${Math.max(11, Math.round(Sz * .3))}px "Segoe UI", system-ui, sans-serif`; og.textAlign = 'center'; og.textBaseline = 'bottom';
        og.lineWidth = 3; og.strokeStyle = 'rgba(10,8,12,.9)'; og.strokeText(ab.name, cx, by - 10 - k2 * 6); og.fillStyle = ab.col; og.fillText(ab.name, cx, by - 10 - k2 * 6);
        og.globalAlpha = 1;
      }
    });
    // gold, left of the bar
    {
      const gx0 = bx - 16 - Sz * .9, gy0 = by + Sz / 2, r = Math.max(4, Sz * .16) * (1 + S.goldPop * 1.2);
      og.fillStyle = '#c8922a'; og.beginPath(); og.arc(gx0, gy0, r, 0, TAU); og.fill();
      og.fillStyle = '#ffd24a'; og.beginPath(); og.arc(gx0 - r * .12, gy0 - r * .12, r * .78, 0, TAU); og.fill();
      og.fillStyle = '#fff2b0'; og.fillRect(gx0 - r * .5, gy0 - r * .5, Math.max(1, r * .35), Math.max(1, r * .35));
      og.font = `700 ${Math.round(Sz * .36)}px "Segoe UI", system-ui, sans-serif`; og.textAlign = 'left'; og.textBaseline = 'middle';
      og.lineWidth = 3; og.strokeStyle = 'rgba(10,8,12,.9)'; og.strokeText('' + S.gold, gx0 + r + 5, gy0); og.fillStyle = S.goldPop > 0 ? '#fff2b0' : '#f2d27a'; og.fillText('' + S.gold, gx0 + r + 5, gy0);
    }
    if (hover) {   // tooltip: name, cooldown, what it does
      const {ab} = hover, f1 = `700 ${Math.max(12, Math.round(Sz * .32))}px "Segoe UI", system-ui, sans-serif`, f2 = `500 ${Math.max(11, Math.round(Sz * .26))}px "Segoe UI", system-ui, sans-serif`;
      og.font = f1; const w1 = og.measureText(ab.name).width; og.font = f2; const l2 = `${ab.desc} · ${ab.cd}s`, w2 = og.measureText(l2).width;
      const w = Math.max(w1, w2) + 20, h = Sz * 1.15, x = clamp(hover.x - w / 2, 4, W - w - 4), y = by - h - 12;
      og.fillStyle = 'rgba(16,14,20,.92)'; og.fillRect(x, y, w, h); og.strokeStyle = 'rgba(242,210,122,.6)'; og.lineWidth = 1; og.strokeRect(x + .5, y + .5, w - 1, h - 1);
      og.textAlign = 'left'; og.textBaseline = 'top'; og.font = f1; og.fillStyle = ab.col; og.fillText(ab.name, x + 10, y + 7);
      og.font = f2; og.fillStyle = '#d8d0c0'; og.fillText(l2, x + 10, y + 7 + Sz * .42);
    }
    og.restore();
  }

  // simple vector icons for the slots (the arena's)
  function icon(q, k, x, y, r, col) {
    q.save(); q.strokeStyle = col; q.fillStyle = col; q.lineWidth = Math.max(1.5, r * .16); q.lineCap = 'round'; q.lineJoin = 'round';
    const L = (x0, y0, x1, y1) => { q.beginPath(); q.moveTo(x + x0 * r, y + y0 * r); q.lineTo(x + x1 * r, y + y1 * r); q.stroke(); };
    const head = (x1, y1, a) => { q.beginPath(); q.moveTo(x + x1 * r, y + y1 * r); q.lineTo(x + x1 * r - Math.cos(a - .5) * r * .4, y + y1 * r - Math.sin(a - .5) * r * .4); q.lineTo(x + x1 * r - Math.cos(a + .5) * r * .4, y + y1 * r - Math.sin(a + .5) * r * .4); q.closePath(); q.fill(); };
    if (k === 'rmb') for (const a of [-.55, -.2, .15]) { const ex = -.8 + Math.cos(a - .6) * 1.7, ey = .8 + Math.sin(a - .6) * 1.7; L(-.8, .8, ex, ey); head(ex, ey, a - .6); }
    else if (k === 1) { q.beginPath(); q.arc(x - r * .15, y + r * .2, r * .62, 0, TAU); q.fill(); L(.25, -.25, .6, -.7); q.fillStyle = '#fff4c0'; q.beginPath(); q.arc(x + r * .7, y - r * .82, r * .2, 0, TAU); q.fill(); }
    else if (k === 2) { for (const [ox, oy] of [[-.7, -.6], [0, -.9], [.7, -.5], [-.35, .1], [.4, .2]]) { L(ox, oy, ox + .2, oy + .7); head(ox + .2, oy + .7, Math.atan2(.7, .2)); } }
    else if (k === 3) { L(-1, .6, .9, -.55); head(.9, -.55, Math.atan2(-1.15, 1.9)); q.lineWidth = Math.max(1, r * .1); L(-.3, -.1, .1, .6); L(.15, -.4, .55, .3); }
    else if (k === 4) { q.beginPath(); q.arc(x, y + r * .15, r * .85, Math.PI, 0); q.stroke(); for (let i = 0; i < 5; i++) { const a = Math.PI + (i + .5) / 5 * Math.PI; L(Math.cos(a) * .85, .15 + Math.sin(a) * .85, Math.cos(a) * .45, .15 + Math.sin(a) * .45); } L(-1, .15, 1, .15); }
    q.restore();
  }

  return {frame, hd, dispose() { removeEventListener('mousemove', onMove); }};
}
