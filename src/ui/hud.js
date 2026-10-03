// THE RUN'S HUD, on the HD overlay (display resolution, over the pixel canvas; the combat feature's ability bar + gold
// sit at the bottom centre already):
//   bottom left   health (a lagging white chip on hits, a green glow on heals) and the build: augments (gold frames)
//                 then items with their stack counts; hover one for what it does
//   top centre    stage and wave, enemies left; a boss bar while the champion lives
//   top right     the run's clock and kills
//   centre        banners (stage start, cleared, death) and toasts (an item you just got)
//   world         floating text (damage you take, heals, "need 30 gold"), elite / champion nameplates
//   edges         a red vignette when you're hit, a slow pulse at low health
import {TIER} from '../game/items.js';
import {clock} from '../game/save.js';
import {clamp} from '../core/mathx.js';

const FONT = '"Segoe UI", system-ui, sans-serif';

export function createHud(host) {
  const banners = [], toasts = [], floats = [];
  const lag = new WeakMap();   // boss -> the HP bar's lagging chip (the HUD's own state: not a field on the enemy)
  let hoverTip = null;

  function text(q, s, x, y, size, col, o = {}) {
    q.font = `${o.w ?? 700} ${Math.round(size)}px ${FONT}`; q.textAlign = o.align ?? 'left'; q.textBaseline = o.base ?? 'alphabetic';
    q.lineJoin = 'round'; q.lineWidth = Math.max(2, size * .22); q.strokeStyle = o.stroke ?? 'rgba(10,8,12,.9)'; q.strokeText(s, x, y);
    q.fillStyle = col; q.fillText(s, x, y);
  }
  function bar(q, x, y, w, h, k, chip, col, o = {}) {
    q.fillStyle = 'rgba(12,10,14,.85)'; q.fillRect(x - 2, y - 2, w + 4, h + 4);
    q.fillStyle = '#2a2228'; q.fillRect(x, y, w, h);
    if (chip > k) { q.fillStyle = '#f4efe4'; q.fillRect(x, y, Math.round(w * clamp(chip, 0, 1)), h); }
    q.fillStyle = col; q.fillRect(x, y, Math.round(w * clamp(k, 0, 1)), h);
    q.fillStyle = 'rgba(255,255,255,.16)'; q.fillRect(x, y, Math.round(w * clamp(k, 0, 1)), Math.max(1, Math.round(h * .35)));
    if (o.glow) { q.globalAlpha = o.glow; q.strokeStyle = o.glowCol ?? '#9af07a'; q.lineWidth = 2; q.strokeRect(x - 3, y - 3, w + 6, h + 6); q.globalAlpha = 1; }
  }
  function icon(q, def, n, aug, x, y, s) {
    const col = aug ? '#f2d27a' : TIER[def.tier].col;
    q.fillStyle = 'rgba(16,14,20,.9)'; q.fillRect(x, y, s, s);
    q.strokeStyle = col; q.lineWidth = aug ? 2 : 1.5; q.strokeRect(x + 1, y + 1, s - 2, s - 2);
    text(q, def.glyph, x + s / 2, y + s / 2 + 1, s * .55, col, {align: 'center', base: 'middle', w: 600});
    if (n > 1) text(q, '' + n, x + s - 3, y + s - 3, s * .36, '#f4efe4', {align: 'right', base: 'alphabetic'});
  }

  const H = {
    banner(title, sub = '', dur = 2.4, col = '#f2d27a') { banners.length = 0; banners.push({title, sub, t: 0, dur, col}); },
    toast(title, sub = '', col = '#f4efe4') { toasts.push({title, sub, col, t: 0, dur: 3}); if (toasts.length > 3) toasts.shift(); },
    float(x, y, h, s, col = '#f4efe4', big = false) { floats.push({x, y, h, s, col, big, t: 0}); if (floats.length > 30) floats.shift(); },
    clear() { banners.length = toasts.length = floats.length = 0; },
    update(dt) {
      for (const a of [banners, toasts]) for (let i = a.length - 1; i >= 0; i--) if ((a[i].t += dt) > a[i].dur) a.splice(i, 1);
      for (let i = floats.length - 1; i >= 0; i--) if ((floats[i].t += dt) > 1) floats.splice(i, 1);
    },
    // v: {run, stats, build, stage, stages, stageName, wave, waves, left, phase, time, kills, boss, enemies, cost}
    draw(q, sc, v) {
      const W = q.canvas.width, Hh = q.canvas.height, u = clamp(sc / 2.6, .7, 2.8);   // 1.5 at 1080p (4x)
      q.save();
      // hit vignette, low-health pulse
      const S = v.stats.S, low = S.hp > 0 && S.hp < S.maxHp * .3 ? (.5 + .5 * Math.sin(performance.now() / 180)) * .25 : 0, red = Math.max(S.hurtT * .55, low);
      if (red > .01) {
        const g = q.createRadialGradient(W / 2, Hh / 2, Math.min(W, Hh) * .35, W / 2, Hh / 2, Math.max(W, Hh) * .72);
        g.addColorStop(0, 'rgba(160,20,20,0)'); g.addColorStop(1, `rgba(170,24,24,${red})`); q.fillStyle = g; q.fillRect(0, 0, W, Hh);
      }
      // world: nameplates over elites / the champion, floating text
      const at = (x, y, h) => { const s = host.toView(x, y, h); return [s[0] * sc, s[1] * sc]; };
      for (const b of v.enemies) {
        if (!b.elite && !b.boss) continue;
        const [x, y] = at(b.x, b.y, (b.h || 0) + (b.hitH ?? 1.6) + .45);   // just over combat's HP bar (+.35)
        text(q, b.name, x, y, 11 * u, b.aura || '#f4efe4', {align: 'center', w: 700});
      }
      for (const f of floats) {
        const [x, y] = at(f.x, f.y, f.h), k = f.t, rise = (1 - (1 - k) ** 2) * 26 * u;
        q.globalAlpha = k > .7 ? 1 - (k - .7) / .3 : 1;
        text(q, f.s, x, y - rise, (f.big ? 17 : 13) * u, f.col, {align: 'center', w: 800});
        q.globalAlpha = 1;
      }
      const bx = Math.round(20 * u), bw = Math.round(300 * u), bh = Math.round(16 * u), by = Math.round(Hh - 30 * u - bh);
      if (v.run || v.health) {   // health (bottom left): in a run; in the sandbox while a fight has stakes (v.health: game.js)
        bar(q, bx, by, bw, bh, S.hp / S.maxHp, S.hpShow / S.maxHp, S.hp < S.maxHp * .3 ? '#e0483a' : '#c8403a', {glow: S.healT * .8});
        text(q, `${Math.ceil(S.hp)} / ${S.maxHp}`, bx + 8 * u, by + bh / 2 + 1, 12 * u, '#f4efe4', {base: 'middle', w: 700});
        if (S.regen > 0) text(q, `+${S.regen.toFixed(1)}/s`, bx + bw - 6 * u, by + bh / 2 + 1, 10 * u, '#b8e0a0', {align: 'right', base: 'middle', w: 600});
      }
      if (v.run) {
        // the build (bottom left, over the health)
        const is = Math.round(28 * u), gap = Math.round(5 * u), iy = by - is - Math.round(10 * u), mx = (host.VW / 2 + (host.mouse.x - host.VW / 2) * host.zoom) * sc, my = (host.VH / 2 + (host.mouse.y - host.VH / 2) * host.zoom) * sc;
        hoverTip = null;
        v.build.forEach((e, i) => {
          const x = bx + i * (is + gap);
          icon(q, e.def, e.n, e.aug, x, iy, is);
          if (mx >= x && mx < x + is && my >= iy && my < iy + is) hoverTip = {e, x, y: iy};
        });
        if (hoverTip) {
          const {e, x, y} = hoverTip, t1 = e.def.name + (e.n > 1 ? `  x${e.n}` : ''), t2 = e.def.desc, t0 = e.aug ? 'Augment' : TIER[e.def.tier].name;
          q.font = `700 ${Math.round(13 * u)}px ${FONT}`; const w1 = q.measureText(t1).width; q.font = `500 ${Math.round(11 * u)}px ${FONT}`; const w2 = q.measureText(t2).width;
          const w = Math.max(w1, w2) + 20 * u, h = 52 * u, tx = clamp(x, 4, W - w - 4), ty = y - h - 8 * u;
          q.fillStyle = 'rgba(16,14,20,.94)'; q.fillRect(tx, ty, w, h); q.strokeStyle = e.aug ? '#f2d27a' : TIER[e.def.tier].col; q.lineWidth = 1; q.strokeRect(tx + .5, ty + .5, w - 1, h - 1);
          text(q, t0, tx + 10 * u, ty + 15 * u, 9 * u, '#9a937f', {w: 600, stroke: 'rgba(0,0,0,0)'});
          text(q, t1, tx + 10 * u, ty + 31 * u, 13 * u, e.aug ? '#f2d27a' : TIER[e.def.tier].col, {stroke: 'rgba(0,0,0,0)'});
          text(q, t2, tx + 10 * u, ty + 45 * u, 11 * u, '#d8d0c0', {w: 500, stroke: 'rgba(0,0,0,0)'});
        }
        // stage / wave (top centre), clock + kills (top right)
        text(q, `Stage ${v.stage + 1} / ${v.stages} · ${v.stageName}`, W / 2, 26 * u, 15 * u, '#f2d27a', {align: 'center'});
        const line = v.phase === 'wave' || v.phase === 'lull' ? `Wave ${Math.min(v.wave + 1, v.waves)} / ${v.waves}` + (v.phase === 'wave' ? ` · ${v.left} left` : ' · next wave…')
          : v.phase === 'portal' ? `Stage cleared · chests ${v.cost} gold · the portal is open` : v.phase === 'arrive' ? 'Get ready' : '';
        if (line) text(q, line, W / 2, 46 * u, 12 * u, '#e8e2d2', {align: 'center', w: 600});
        text(q, clock(v.time), W - 20 * u, 30 * u, 18 * u, '#f4efe4', {align: 'right'});
        text(q, `${v.kills} kills`, W - 20 * u, 48 * u, 11 * u, '#9a937f', {align: 'right', w: 600});
        if (v.boss) {
          const b = v.boss, w = Math.round(Math.min(W * .5, 440 * u)), h = Math.round(10 * u), x = Math.round(W / 2 - w / 2), y = Math.round(72 * u);
          const chip = Math.max(b.hp, (lag.get(b) ?? b.hp) - b.maxHp * .006); lag.set(b, chip);
          text(q, b.name, W / 2, y - 6 * u, 13 * u, b.aura || '#f2d27a', {align: 'center'});
          bar(q, x, y, w, h, b.hp / b.maxHp, chip / b.maxHp, b.bar || '#d8483a');   // (bar: an affix's colour, features/affixes.js)
        }
      }
      // banners + toasts (centre)
      for (const b of banners) {
        const a = Math.min(1, b.t / .25, (b.dur - b.t) / .5);
        q.globalAlpha = clamp(a, 0, 1);
        text(q, b.title, W / 2, Hh * .3, 34 * u, b.col, {align: 'center', w: 800});
        if (b.sub) text(q, b.sub, W / 2, Hh * .3 + 28 * u, 15 * u, '#e8e2d2', {align: 'center', w: 600});
        q.globalAlpha = 1;
      }
      toasts.forEach((t, i) => {
        const a = Math.min(1, t.t / .2, (t.dur - t.t) / .6), y = Hh * .74 + i * 40 * u;
        q.globalAlpha = clamp(a, 0, 1);
        text(q, t.title, W / 2, y, 17 * u, t.col, {align: 'center', w: 800});
        if (t.sub) text(q, t.sub, W / 2, y + 18 * u, 12 * u, '#e8e2d2', {align: 'center', w: 600});
        q.globalAlpha = 1;
      });
      q.restore();
    },
  };
  return H;
}
