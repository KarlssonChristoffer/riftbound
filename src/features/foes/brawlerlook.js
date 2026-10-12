// BRAWLER LOOK: the boxing gunmen as you see them (docs/exp/fists.md; their truth is features/foes/brawler.js, each record's
// g.fist). VIEW only: it reads the record and writes the view's own per-gunman state (v: its facing, its footwork's phase).
// foes/look.js asks pose() first for a gunman with a fist fight on, and mark() draws the haymaker's telegraph.
//   circle / wait   fx_guard (a loop) standing, fx_gstep on the move (by the distance he covers, backward when he backs off)
//   wind / strike   fx_jab / fx_hay: the telegraph frames (0 .. hit-2) across the wind, the extension and the contact across
//                   the strike to its `hit` (the contact frame at the sim's blow), the rest to its end
//   guard           fx_block's guard frame held (a block: the clip from its start)
//   react / daze    REACT's clip by the stun's progress (fx_hit_jab / _l / _r / _gut) / fx_daze looped
//   held            fx_held looped (a blow in the clinch: its reaction's clip for a moment)
//   taunt           fx_taunt
// A model without a clip: the hit clips and idle (approach: the look's own walk / run).
import {FOE, REACT} from '../../content/fists.js';

const TAUNT = 1.2, HELD_HIT = .3, STEP = .44;   // (STEP: m a fx_gstep cycle, its ground data)
const STAR = ['#ffffff', '#ffe07a', '#f2a03a'];
export function createBrawlerLook(host, faceOf) {
  const SC = new Float32Array(3);
  const markOf = (set, c, k, d) => set.tl(c)?.c.marks?.[k] ?? d;
  const loop = (set, c, t, fps) => { const C = set.CLIP[c]; return C ? set.nm(c, Math.floor(t * (C.fps || fps)) % C.frames) : null; };
  const guardPose = (set, t) => set.ok('fx_guard') ? loop(set, 'fx_guard', t, 6) : set.has('idle.0') ? 'idle.0' : null;
  function attack(set, g, f) {
    const c = f.kind === 'hay' ? 'fx_hay' : 'fx_jab', W = FOE[f.kind];
    if (!set.ok(c)) return null;
    const n = set.CLIP[c].frames, hit = Math.min(n - 1, markOf(set, c, 'hit', 3)), tele = Math.max(1, hit - 1);
    if (f.st === 'wind') return set.nm(c, Math.min(tele - 1, Math.floor(f.t / W.wind * tele)));
    if (f.t < W.hit) return set.nm(c, Math.min(hit, tele + Math.floor(f.t / W.hit * (hit - tele + 1))));
    return set.nm(c, Math.min(n - 1, hit + Math.floor((f.t - W.hit) / Math.max(.01, W.dur - W.hit) * (n - hit))));
  }
  // the pose of his fist fight (null: the look's own: approaching, down)
  function pose(set, g, v, dt, t) {
    const f = g.fist; if (!f || g.down || f.st === 'approach') return null;
    v.f = faceOf(set, g.face);
    switch (f.st) {
      case 'wind': case 'strike': return attack(set, g, f) || guardPose(set, t);
      case 'react': { const c = REACT[f.react]?.clip, k = f.t / Math.max(.05, f.stun); return c && set.ok(c) ? set.frameAt(c, k) : set.ok('hit_f') ? set.frameAt('hit_f', k) : guardPose(set, t); }
      case 'daze': return set.ok('fx_daze') ? loop(set, 'fx_daze', t, 7) : set.ok('hit_b') ? set.frameAt('hit_b', (t * .8) % 1) : guardPose(set, t);
      case 'guard': return set.ok('fx_block') ? (f.blockT > 0 ? set.frameAt('fx_block', 1 - f.blockT / .25) : set.nm('fx_block', 1)) : guardPose(set, t);
      case 'taunt': return set.ok('fx_taunt') ? set.frameAt('fx_taunt', f.t / TAUNT) : guardPose(set, t);
      case 'held': {
        const c = REACT[f.react]?.clip;
        if (f.rt < HELD_HIT && c && set.ok(c)) return set.frameAt(c, .15 + f.rt / HELD_HIT * .5);
        return set.ok('fx_held') ? loop(set, 'fx_held', t, 3) : set.has('idle.0') ? 'idle.0' : null;
      }
    }
    // circling / waiting: the guard, the footwork on the move (backward when he backs away from where he faces)
    if (g.speed > .15 && set.ok('fx_gstep')) {
      const along = (g.vx * Math.sin(g.face) + g.vy * Math.cos(g.face)) / (g.speed || 1), n = set.CLIP.fx_gstep.frames;
      v.ph = (((v.ph || 0) + (along >= -.2 ? 1 : -1) * g.speed * dt / STEP) % 1 + 1) % 1;
      return set.nm('fx_gstep', Math.floor(v.ph * n) % n);
    }
    return guardPose(set, t);
  }
  // the haymaker's telegraph: a star over his head through the last of its wind (the 'add' layer)
  function mark(set, g) {
    const f = g.fist; if (!f || f.st !== 'wind' || f.kind !== 'hay') return;
    const W = FOE.hay, k = (f.t - W.wind * .45) / (W.wind * .55); if (k <= 0) return;
    const p = g.p; host.G.toScreenInto(p.x, (p.z || 0) + 2.15, p.y, SC); if (SC[0] < -1e4) return;
    const x = Math.round(SC[0]), y = Math.round(SC[1]), r = 1 + Math.round(Math.min(1, k) * 3), q = host.glayer('add');
    q.fillStyle = STAR[2]; q.fillRect(x - r, y, 2 * r + 1, 1); q.fillRect(x, y - r, 1, 2 * r + 1);
    q.fillStyle = STAR[1]; q.fillRect(x - 1, y - 1, 3, 3);
    q.fillStyle = STAR[0]; q.fillRect(x, y, 1, 1);
  }
  return {pose, mark};
}
