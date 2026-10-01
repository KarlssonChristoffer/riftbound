// EXPERIMENT: shiny armour on the ranger (X key in the arena). OWNER: arena lead.
// The masks come from armor_mask.py (out/experiments/armor/<atlas>/<pose>.png: 255 steel, 128 gold), made from the
// same ID passes as the sprites, so they line up pixel for pixel. Two parts:
//   albedo(pose, img)  the pose's sheet with the metal pixels repainted in a steel / gold ramp (by the original tone)
//                      -> drawn through lighting.drawSprite as usual (diffuse light, shadows, normals)
//   shine(g, ...)      after lighting.apply: what makes metal read as metal, added on top ('lighter'):
//                      - a glint from every light (Blinn-Phong on the frame's normal map, per pixel, in camera space)
//                      - the sun / moon
//                      - an environment reflection: sky above, ground below, stronger at grazing angles (fresnel)
//                      Glints are quantised to a few steps so they read as crisp pixel clusters, not soft blurs.
// Camera space: +x right, +y up, +z toward the viewer; the sprite camera looks down at `pitch` degrees.
// metal is mostly what it reflects: a DARK base, the shine comes from the glints and the reflected surroundings
const STEEL = [[14, 16, 22], [30, 34, 44], [52, 59, 72], [84, 94, 110], [128, 138, 154]];
const GOLD = [[40, 24, 8], [84, 56, 16], [136, 98, 30], [190, 150, 60], [236, 206, 120]];
const hex = c => { const n = parseInt(String(c || '#ffffff').slice(1, 7), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

export function createArmor(ctx) {
  const A = {on: false, ready: 0, ms: 0};
  const masks = {}, albedos = {}, normals = new WeakMap();
  let root = '';
  A.setAtlas = r => { root = r; };
  A.toggle = () => (A.on = !A.on);
  A.preload = poses => { for (const p of poses) mask(p); };   // all masks of the atlas up front (no pop-in)
  function readPixels(img) {
    const c = canvas(img.width, img.height), q = c.getContext('2d', {willReadFrequently: true});
    q.drawImage(img, 0, 0); return q.getImageData(0, 0, c.width, c.height).data;
  }
  function mask(pose) {   // Uint8Array of the mask sheet (R channel), or null while loading / missing
    const key = root + pose, m = masks[key];
    if (m !== undefined) return m;
    masks[key] = null;
    const dir = root.replace('out/outfits/', 'out/experiments/armor/');
    const i = new Image(); i.onload = () => { const d = readPixels(i), a = new Uint8Array(d.length / 4); for (let k = 0; k < a.length; k++) a[k] = d[k * 4]; masks[key] = {a, w: i.width}; A.ready++; };
    i.onerror = () => { masks[key] = false; };
    i.src = `${dir}${pose}.png`;
    return null;
  }
  // the sheet with its metal pixels repainted: the original tone picks the step in the metal ramp
  A.albedo = (pose, img) => {
    if (!A.on) return img;
    const m = mask(pose); if (!m) return img;
    const key = root + pose;
    if (albedos[key]?.src === img) return albedos[key].c;
    const c = canvas(img.width, img.height), q = c.getContext('2d', {willReadFrequently: true});
    q.drawImage(img, 0, 0);
    const id = q.getImageData(0, 0, c.width, c.height), d = id.data;
    for (let k = 0; k < m.a.length; k++) {
      const v = m.a[k]; if (!v || d[k * 4 + 3] === 0) continue;
      const l = (d[k * 4] * .3 + d[k * 4 + 1] * .59 + d[k * 4 + 2] * .11) / 255;
      const R = v > 200 ? STEEL : GOLD, t = Math.max(0, Math.min(4, Math.floor((l - .06) / .09)));   // 5 tones
      const col = R[t]; d[k * 4] = col[0]; d[k * 4 + 1] = col[1]; d[k * 4 + 2] = col[2];
    }
    q.putImageData(id, 0, 0);
    albedos[key] = {src: img, c};
    return c;
  };
  const out = canvas(1, 1), oq = out.getContext('2d');
  // o: {nrm, pose, srcX, w, h, dx, dy (view px, sprite top-left), P {x, y, z}, piv [x, y], lights [{x, y, h, color,
  //     radius, intensity}], mood (lighting mood), lantern bool, pitch (deg), ppm, ppmh}
  A.shine = (g, o) => {
    if (!A.on || !o.nrm) return;
    const m = mask(o.pose); if (!m) return;
    const t0 = performance.now();
    let N = normals.get(o.nrm); if (!N) { N = readPixels(o.nrm); normals.set(o.nrm, N); }
    const {w, h, srcX, piv, P, mood} = o, sheetW = m.w;
    if (out.width !== w || out.height !== h) { out.width = w; out.height = h; }
    const img = oq.createImageData(w, h), D = img.data;
    const cp = Math.cos(o.pitch * Math.PI / 180), sp = Math.sin(o.pitch * Math.PI / 180);
    // world offset (east, south, up) -> camera space (right, up, toward the viewer)
    const cam = (e, s, u) => [e, u * cp - s * sp, s * cp + u * sp];
    const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
    // lights near the player (+ the lantern, held at the hip in front)
    const L = [];
    for (const l of o.lights) { const r = l.radius || 4, d = Math.hypot(l.x - P.x, l.y - P.y); if (d < r + 1) L.push({x: l.x, y: l.y, h: l.h ?? 1, r, i: (l.intensity ?? 1), c: hex(l.color)}); }
    if (o.lantern) L.push({x: P.x + .3, y: P.y + .25, h: P.z + .95, r: 4.2, i: 1, c: hex('#ffc27a')});
    const sun = mood?.sun, sunOn = sun && sun.el > 2;
    const sunDir = sunOn ? norm(cam(Math.sin(sun.az * Math.PI / 180) * Math.cos(sun.el * Math.PI / 180), -Math.cos(sun.az * Math.PI / 180) * Math.cos(sun.el * Math.PI / 180), Math.sin(sun.el * Math.PI / 180))) : null;
    const sunStr = sunOn ? (mood.shadow?.a > 0 ? 1 : .45) * (sun.k ?? .4) * 2.2 : 0, sunC = sun?.c || [1, 1, 1];
    const amb = mood?.amb || [1, 1, 1];
    const sky = [amb[0] * .55, amb[1] * .6, amb[2] * .72];
    // below the horizon a polished plate reflects its SURROUNDINGS: the local light (lava, braziers, the lantern)
    const loc = [0, 0, 0, 0]; if (o.lightAt) o.lightAt(o.dx + piv[0], o.dy + piv[1] - 20, loc);
    const grd = o.lightAt ? [Math.min(1.4, loc[0]) * .5, Math.min(1.4, loc[1]) * .5, Math.min(1.4, loc[2]) * .5] : [amb[0] * .25, amb[1] * .22, amb[2] * .2];
    const q3 = v => v < .12 ? 0 : v < .4 ? .35 : v < .75 ? .7 : 1;   // crisp glint steps
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const mk = m.a[y * sheetW + srcX + x]; if (!mk) continue;
      if (o.cover && o.cover(x, y)) continue;   // hidden under the runtime cloak: no glint or reflection through it
      const ni = (y * sheetW + srcX + x) * 4; if (!N[ni + 3]) continue;
      const n = norm([N[ni] / 127.5 - 1, N[ni + 1] / 127.5 - 1, N[ni + 2] / 127.5 - 1]);
      const gold = mk < 200, tint = gold ? [1, .82, .45] : [.9, .95, 1];
      // the pixel's place in the world: sideways from the pivot, up from the feet
      const ex = P.x + (x - piv[0]) / o.ppm, uh = P.z + (piv[1] - y) / o.ppmh;
      let r = 0, gg = 0, b = 0;
      const glint = (dir, str, c, pw) => {
        const H = norm([dir[0], dir[1], dir[2] + 1]), nh = Math.max(0, n[0] * H[0] + n[1] * H[1] + n[2] * H[2]);
        const s = q3(Math.pow(nh, pw) * str) * .9 + Math.pow(nh, 6) * str * .12;
        r += s * c[0] * tint[0]; gg += s * c[1] * tint[1]; b += s * c[2] * tint[2];
      };
      for (const l of L) {
        const d = Math.hypot(l.x - ex, l.y - P.y, l.h - uh), k = 1 - (d / l.r) ** 2; if (k <= 0) continue;
        glint(norm(cam(l.x - ex, l.y - P.y, l.h - uh)), l.i * k * k * 1.8, l.c, 30);
      }
      if (sunDir) glint(sunDir, sunStr, sunC, 40);
      // environment: the reflected view ray picks sky (up) or ground (down); fresnel brightens grazing angles
      // reflection: bounce the view ray off the normal. Pointing up: the sky band. Down / sideways: the lit ground
      // ~1.5 m away in that direction (the light buffer there: lava, braziers, the lantern pool). Hard horizon between.
      const R = [2 * n[2] * n[0], 2 * n[2] * n[1], 2 * n[2] * n[2] - 1];
      const wUp = R[1] * cp + R[2] * sp, wE = R[0], wS = R[2] * cp - R[1] * sp, hl = Math.hypot(wE, wS) || 1;
      const fres = .25 + .75 * Math.pow(1 - Math.max(0, n[2]), 3), env = fres * .6;
      let er, eg, eb;
      if (wUp > .25) [er, eg, eb] = sky;
      else {
        let gc = grd;
        if (o.lightAt) { const d = 1.5 * Math.min(1, hl); o.lightAt(o.dx + x + wE / hl * d * o.ppm, o.dy + piv[1] + wS / hl * d * (o.ppmy || o.ppm * .82), loc);
          gc = [Math.min(1.6, loc[0]) * .55, Math.min(1.6, loc[1]) * .55, Math.min(1.6, loc[2]) * .55]; }
        const k = wUp > 0 ? .5 : 0;   // near the horizon: a band half way between
        er = sky[0] * k + gc[0] * (1 - k); eg = sky[1] * k + gc[1] * (1 - k); eb = sky[2] * k + gc[2] * (1 - k);
      }
      r += env * er * tint[0]; gg += env * eg * tint[1]; b += env * eb * tint[2];
      const p = (y * w + x) * 4;
      D[p] = Math.min(255, r * 255); D[p + 1] = Math.min(255, gg * 255); D[p + 2] = Math.min(255, b * 255); D[p + 3] = 255;
    }
    oq.putImageData(img, 0, 0);
    g.save(); g.globalCompositeOperation = 'lighter'; g.drawImage(out, o.dx, o.dy); g.restore();
    A.ms = A.ms * .9 + (performance.now() - t0) * .1;
  };
  return A;
}
