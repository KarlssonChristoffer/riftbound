// FOES LOOK: the desert's gunmen as you see them (features/foes.js is the feature; foes/sim.js the truth). VIEW only:
// it reads the sim's records and bullets and writes its own state; ?views=0 or the feature off changes nothing in play.
//   bodies   one sprite each from its outfit's atlas (render/atlas.js, the player's loader: 16 facings x the gun's
//            clips, albedo + normals), drawn through the renderer's sprite batch (gfx.js G.sprite type 7: lit by the
//            scene's lights through its normals, a sun-shadow card; one draw per pose image on screen, no per-gunman
//            canvas, no CPU compositing). The pose follows the sim like the player's revolver (sim/player/gun.js): the
//            clips' timelines (play / ms / marks) for the draw, the kick, the reload by its phases and the holster; the
//            aim by what you SEE: the standing twists (gun_aim_*) or the walking ones (gws_<twist>_<frame>, forward or
//            backing up) scored by the barrel's angle on screen (the pose's GunMuzzle0 + GunHold0 bones) against the line
//            to its target; walk / run / idle holstered. The hit flash and wobble are combat's (p.flash, p.wob)
//   hits     hit_f / hit_b (a hit from in front of his facing / from behind: the sim keeps which and when): the clip from
//            the gun up back to it; a gunman who flinches is held still by the sim until its `back` mark (TYPES flinch:
//            dev mode warns when they differ), after which it gives way to what he does; one who doesn't (the sheriff)
//            shows it only between shots, standing. Without the clips: the flash and the wobble alone. Every bullet hit
//            also shoves the sprite a little along its way (TUNE.hit: back in ~.2 s; the body stays where the sim has
//            it) and shows combat's flash brighter, held full white for its first frames
//   death    die_b (the killing hit from in front: he falls on his back) / die_f (from behind: forward): the clip, its
//            last frame the corpse with the gun beside him, held; at its `ground` mark a dust puff (combat's puff) and
//            foe.ground (the thud: audio); the body lies TUNE.corpse.hold s, then fades (an ordered dither); at most
//            TUNE.corpse.max lie about (the oldest fades early). The corpse lies on the sprite's pivot, so the sprite
//            is placed back by how far his root starts from it (the Hips bone at the clip's first frame, side view;
//            else clip.travel / TUNE.corpse.travel), and he falls from where he stood. Going down he LIES DOWN in the
//            world: the clip's per-frame `lie` (0 upright .. 1 lying: its lying frames are rendered in the game's own
//            ground projection, tools/blender/western.py) goes to the sprite (gfx.js BATCH_VS: the card's depth and its
//            sun card lie down onto the ground, so the shadow is the body's footprint and what stands behind him shows
//            over him), and a contact shadow hugs the body on the ground (his silhouette grown a px or two, dark, on
//            the ground layer, as much as he lies; a small one under his feet while he still stands: contact.js's
//            walker stamp ends when he dies). Without the clips: thrown back in `fall`, down through `land` to `crouch`, faded
//            at once; without those either, his last pose slides and fades
//   telegraph the aim's last moment (the lock): a glint on the barrel (the 'add' layer, after the light: it reads at noon)
//   tracers  the bullets in flight, with gunfx's look (features/gunfx.js tracer()); the flash, smoke, impacts and the
//            reload's cases are gunfx's own (its events: foe.shoot, foe.reload, bullet.impact)
//   marks    foe.clip {mark: dump | load | close}: the moments the reload you SEE drops the spent shells, seats a shell,
//            snaps the gun shut (audio: the coach gun's eject / load / close land on those frames). A reload clip with its
//            own timeline (the coach gun's: play / ms / marks) says them as its steps reach those frames; without one
//            (the revolvers' clips, an atlas not loaded) the sim's phases do: the eject begins, a round goes in, it ends
//   HD       health bars over hurt gunmen (combat's look), the sheriff's name; a gun held on you from OFF SCREEN: an
//            arrow at the screen's edge toward it, through the aim (gold), bright and bigger once the aim locks
// ATLASES: each type's outfit (content/foes.js atlas) from concepts/sprites/out/outfits/<name>/ once its poses.json lists
// the poses used here, else the gate-2 preview western/art_g2b/<name>/all/; loaded on the first visit to the desert.
// OWNS: the atlases, the view state per gunman (facing, twist, gait phase, health chip), the corpses.
// READS: the sim (gang, B), host.yaw / zoom / G (toScreenInto), host.player, the events (arrow.hit: the way a hit came).
// EMITS (a view's, like wildlife's calls: nothing in the sim listens): foe.ground (a body hits the ground), foe.clip (the
//   reload's marks as seen).
// BUDGET: view; frame ~.15 ms with 6 gunmen fighting (measured 2026-10-03 in headless Chrome on a busy machine: the pose
//   picks ~.035 ms, the sprites ~.04 ms; a pick scores <= 3 facings x 9 twists, or 2 stances x 5 legs x 7 twists walking,
//   against barrel angles worked out once per pose); render: a sprite + a shadow draw per pose image on screen; a corpse's
//   contact shadow: one drawImage of a mask made once per death frame and facing seen.
import {loadAtlas} from '../../render/atlas.js';
import {atlasOf} from '../../sim/player/player.js';
import {TYPES, TUNE} from '../../content/foes.js';
import {tracer} from '../gunfx.js';
import {hypot3} from '../../core/mathx.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180, OUT = '../concepts/sprites/out/';
const NEED = ['idle.0', 'walk.0', 'run.0', 'gun_draw.0', 'gun_aim', 'gun_fire.0', 'gun_reload.0'];
const TWS = ['gun_aim_m45', 'gun_aim_m34', 'gun_aim_m22', 'gun_aim_m11', 'gun_aim', 'gun_aim_p11', 'gun_aim_p22', 'gun_aim_p34', 'gun_aim_p45'];
const TWM = ['m90', 'm67', 'm45', 'm22', '0', 'p22', 'p45'];
const angDiff = (a, b) => Math.abs(((a - b) + Math.PI * 3) % TAU - Math.PI);
const GLINT = ['#fff8e0', '#ffe2a0', '#ffc86a'];

// which atlas a type draws from: the full outfit once it lists what's needed, else the gate-2 preview
async function rootOf(name) {
  const full = `${OUT}outfits/${name}/`;
  try { const idx = await fetch(full + 'poses.json').then(r => r.ok ? r.json() : null); if (idx && NEED.every(n => idx.poses.includes(n))) return full; } catch (e) {}
  return `${OUT}western/art_g2b/${name}/all/`;
}
// one type's atlas, with what the poses need made once: names, clip timelines, the twists it has
function prep(s, root) {
  const a = atlasOf(s), SP = a.SP, has = n => !!SP[n];
  const NM = {}, nm = (base, i) => (NM[base] ??= [])[i] ??= base + '.' + i;
  const ST = {}, st = (pre, tw, f) => ((ST[pre] ??= {})[tw] ??= [])[f] ??= `${pre}_${tw}_${f}`;
  const TL = {};
  // the barrel per pose and facing (the GunMuzzle0 + GunHold0 bones): its screen angle and the muzzle's px from the pivot,
  // [a, mx, my] x ND (NaN: no gun bones), worked out once per pose
  const BAR = new Map();
  function barrel(frame) {
    let b = BAR.get(frame); if (b) return b;
    b = new Float32Array(a.ND * 3).fill(NaN); const sp = SP[frame];
    if (sp && sp.bones) for (let f = 0; f < a.ND; f++) {
      const k = sp.bones[a.DIRS[f]], m = k && k.GunMuzzle0; if (!m) continue;
      let dx = m[2] - m[0], dy = m[3] - m[1]; const h = k.GunHold0; if (h) { dx += h[2] - h[0]; dy += h[3] - h[1]; }
      b[f * 3] = Math.atan2(dy, dx); b[f * 3 + 1] = m[0] - a.PIV[0]; b[f * 3 + 2] = m[1] - a.PIV[1];
    }
    BAR.set(frame, b); return b;
  }
  function tl(name) {   // a clip's timeline (sim/player/gun.js tl: play order, ms per step or 1 / fps)
    if (TL[name]) return TL[name];
    const c = a.CLIP[name]; if (!c) return null;
    const n = c.play ? c.play.length : c.frames, ends = new Float64Array(n); let t = 0;
    for (let i = 0; i < n; i++) { t += c.ms ? c.ms[i] / 1000 : 1 / c.fps; ends[i] = t; }
    return (TL[name] = {c, n, ends, total: t, play: c.play || null});
  }
  // the time (s) the timeline reaches rendered frame marks[mark] (the first step showing it), or null
  function markT(name, mark) {
    const L = tl(name), m = L && L.c.marks ? L.c.marks[mark] : undefined; if (m === undefined) return null;
    for (let i = 0; i < L.n; i++) if ((L.play ? L.play[i] : i) === m) return i ? L.ends[i - 1] : 0;
    return null;
  }
  // the frame t s into clip `name`, held on its last step after the end
  function frameAtT(name, t) {
    const L = tl(name); if (!L) return null;
    let i = 0; while (i < L.n - 1 && t >= L.ends[i]) i++;
    return nm(name, L.play ? L.play[i] : i);
  }
  const ok = name => !!a.CLIP[name] && has(nm(name, 0));   // the clip is in this atlas
  // how far ahead of the sprite's pivot his root stands as the clip begins (m along his facing; - behind): the Hips bone
  // in the side view (E: screen x is his forward) at its first frame. A death clip ends with the body on the pivot, so
  // the sprite goes this far back from where he stood. null without the bones
  const ppm = s.idx?.fwd_px?.E?.[0] || 30.5;
  function rootShift(name) {
    const L = tl(name), sp = L && SP[nm(name, L.play ? L.play[0] : 0)], h = sp && sp.bones && sp.bones.E && sp.bones.E.Hips;
    return h ? (h[0] - a.PIV[0]) / ppm : null;
  }
  // the frame of clip `name` a fraction k (0..1) through it
  function frameAt(name, k) {
    const L = tl(name); if (!L) return null;
    const t = Math.max(0, Math.min(.9999, k)) * L.total; let i = 0; while (i < L.n - 1 && t >= L.ends[i]) i++;
    return nm(name, L.play ? L.play[i] : i);
  }
  // a death clip renders the falling body raised a whole number of px up the image (its `shift`: m along the ground away
  // from the camera, so the depth stays in range; tools/blender/western.py): those frames are drawn with the pivot as many
  // px higher, which puts the body back where it lies. px per frame worked out once per clip
  const SH = {}, sinP = Math.sin((s.idx?.pitch ?? 20) * Math.PI / 180), upp = s.idx?.units_per_px || .0328;
  function shiftPx(name, t) {
    const L = tl(name); if (!L || !L.c.shift) return 0;
    const px = SH[name] ??= Int16Array.from(L.c.shift, v => Math.round(v * sinP / upp));
    let i = 0; while (i < L.n - 1 && t >= L.ends[i]) i++;
    return px[L.play ? L.play[i] : i] || 0;
  }
  // how far down the body is in the frame t s into clip `name` (its `lie`: 0 upright .. 1 lying), 0 without it
  function lieAt(name, t) {
    const L = tl(name), v = L && L.c.lie; if (!v) return 0;
    let i = 0; while (i < L.n - 1 && t >= L.ends[i]) i++;
    return v[L.play ? L.play[i] : i] || 0;
  }
  return {root, ...a, SP, has, nm, st, tl, frameAt, frameAtT, markT, ok, rootShift, shiftPx, lieAt, barrel, tws: TWS.filter(has), twm: TWM.filter(t => has(st('gws', t, 0))), preview: !root.includes('/outfits/')};
}

export function createLook(host, sim) {
  const sets = {}, G = host.G;
  let loading = null, failed = '';
  function load() {
    if (loading) return loading;
    return (loading = Promise.all(Object.keys(TYPES).map(async k => {
      let root = await rootOf(TYPES[k].atlas), s;
      try { s = await loadAtlas(root, {normals: true}); }
      catch (e) { if (!root.includes('/outfits/')) throw e; root = `${OUT}western/art_g2b/${TYPES[k].atlas}/all/`; s = await loadAtlas(root, {normals: true}); }
      const set = sets[k] = prep(s, root);
      for (const c of ['hit_f', 'hit_b']) {   // (the sim's flinch is TUNE's, never the art's: it should match the clip)
        const bt = set.ok(c) ? set.markT(c, 'back') : null, fl = TYPES[k].flinch;
        if (host.dev && bt !== null && fl > 0 && Math.abs(bt - fl) > .03) console.warn(`foes: ${k} ${c} 'back' is at ${bt.toFixed(2)} s, TYPES.${k}.flinch is ${fl} s`);
      }
    })).catch(e => { failed = String(e); console.warn('foes: an atlas failed to load', e); }));
  }

  // ---------------------------------------------------------------- per gunman: the view's own state
  const VS = new Map();   // entity -> {f, tw, ph, pose, face0, hpShow, idle}
  const vsOf = p => { let v = VS.get(p); if (!v) VS.set(p, v = {f: 0, tw: 'gun_aim', twm: '0', back: false, ph: 0, pose: 'idle.0', hpShow: p.hp, idle: (p.x * 7.3 + p.y * 3.1) % 1, seen: 0, hx: 0, hy: 0, face: 0,
    nx: 0, ny: 0, nt: 9, rs: -1, rph: '', ram: 0}); return v; };   // nx / ny / nt: a bullet's shove (its way, its age); rs: the reload clip's next step to say a mark for (-1: not reloading); rph / ram: the phase and rounds last seen
  const SC = [0, 0, 0], SM = [0, 0, 0];
  let yaw = 0, z = 1;
  const faceOf = (set, w) => { const n = set.ND; return ((Math.round((w - yaw) / (TAU / n)) % n) + n) % n; };   // world angle -> the atlas's facing at this yaw
  const worldOf = (set, f) => f * TAU / set.ND + yaw;
  // the barrel's screen angle in pose `frame` at facing f vs the line from its muzzle to the target (both on screen)
  function aimErr(set, frame, f, ox, oy, tx, ty) {
    const b = set.barrel(frame), i = f * 3, a = b[i]; if (a !== a) return 9;
    return angDiff(a, Math.atan2(ty - (oy + b[i + 2] * z), tx - (ox + b[i + 1] * z)));
  }
  // standing with the gun up: the facing near its aim and the twist whose barrel lines up best (kept unless clearly beaten)
  function standAim(set, g, v, ox, oy, tx, ty) {
    const f0 = faceOf(set, g.aim), n = set.ND;
    let bf = v.f, bt = set.has(v.tw) ? v.tw : 'gun_aim', be = aimErr(set, bt, bf, ox, oy, tx, ty) - 2 * DEG;
    for (let k = -1; k <= 1; k++) {
      const f = (f0 + k + n) % n;
      for (const tw of set.tws) { const e = aimErr(set, tw, f, ox, oy, tx, ty); if (e < be) { be = e; bf = f; bt = tw; } }
    }
    v.f = bf; v.tw = bt; return bt;
  }
  // walking with the gun up: legs along the way (or backing up, up to 45 deg off it) + the torso's twist, scored like
  // the player's (sim/player/gun.js movingAim)
  function walkAim(set, g, v, ox, oy, tx, ty, gf) {
    const n = set.ND, mvd = faceOf(set, Math.atan2(g.vx, g.vy)), aimF = faceOf(set, g.aim), Q = n / 4, crab = n / 8;
    const rel = (aimF - mvd + n) % n, behind = rel > Q && rel < n - Q;
    let bc = 1e9;
    for (let bi = 0; bi < 2; bi++) for (let k = -crab; k <= crab; k++) {
      const back = bi === 1, f = ((back ? mvd + n / 2 : mvd) + k + n) % n;
      const leg = Math.abs(k) + (back !== behind ? 2.5 : 0) + (back !== v.back ? .8 : 0) + (f !== v.f ? .3 : 0);
      for (const tw of set.twm) {
        const c = leg + aimErr(set, set.st('gws', tw, gf), f, ox, oy, tx, ty) / DEG / 6;
        if (c < bc) { bc = c; v.f = f; v.back = back; v.twm = tw; }
      }
    }
    return set.st('gws', v.twm, gf);
  }
  // how far through the whole reload he is (0..1): the sim's phases laid end to end (a reload clip with its own timeline
  // plays over all of it)
  function reloadK(g) {
    const Rl = g.T.gun.reload, k = g.rk, rounds = g.T.gun.rounds;
    const n0 = g.r0 ?? 0, total = Rl.up + Rl.eject + (rounds - n0) * Rl.round + Rl.close, base = Rl.up + Rl.eject + (g.ammo - n0) * Rl.round;
    const t = g.rph === 'up' ? k * Rl.up : g.rph === 'eject' ? Rl.up + k * Rl.eject : g.rph === 'fetch' ? base + k * Rl.round / 2
      : g.rph === 'load' ? base + Rl.round / 2 + k * Rl.round / 2 : total - (1 - k) * Rl.close;
    return t / total;
  }
  // the reload's frame: a clip with its own timeline (the coach gun's) plays over the whole reload; the revolver's by its
  // marks, phase by phase (sim/player/gun.js reloadFrame)
  function reloadPose(set, g) {
    const c = set.CLIP.gun_reload; if (!c) return null;
    if (c.play) return set.frameAt('gun_reload', reloadK(g));
    const M = c.marks, k = g.rk; if (!M) return set.nm('gun_reload', Math.min(c.frames - 1, {up: 0, eject: 1, fetch: 3, load: 2, close: 5}[g.rph] ?? 0));
    let a, b, back = false;
    switch (g.rph) {
      case 'up': a = M.up; b = M.eject - 1; break;
      case 'eject': a = M.eject; b = M.first - 1; break;
      case 'fetch': if (g.rfirst) { a = M.first; b = M.fetch; } else { a = M.fetch; b = M.load - 1; back = true; } break;
      case 'load': a = M.fetch + 1; b = M.load; break;
      default: a = M.close; b = c.frames - 1;
    }
    const i = Math.min(b - a, Math.floor(k * (b - a + 1)));
    return set.nm('gun_reload', back ? b - i : a + i);
  }
  // the gait frame (walk / run clip) from the phase: the clip's own strides (cum) or even steps
  function gaitFrame(C, ph) {
    if (!C.cum) return Math.floor(ph * C.frames) % C.frames;
    const at = ph * C.stride; let f = 0; while (f < C.frames - 1 && at >= C.cum[f + 1]) f++;
    return f;
  }

  // ---------------------------------------------------------------- the corpses (view only)
  // the clip `want`, else `alt`, if this atlas has it
  const pick = (set, want, alt) => set.ok(want) ? want : set.ok(alt) ? alt : null;
  // made the frame a gunman leaves the fight broken (combat killed him; the kill's hitstop holds the views a moment, not
  // the draw): die_b / die_f by the way the killing hit went against his facing (or away from you), or the fallback
  const CM = 16, corpses = [];
  for (let i = 0; i < CM; i++) corpses.push({on: false, set: null, clip: '', x: 0, y: 0, z: 0, face: 0, vx: 0, vy: 0, t: 0, pose: '', lift: 0,
    groundT: 0, grounded: true, fadeAt: 0, fadeLen: 1, foe: '', fx: 0, fy: 0});   // fx / fy: where he stood
  function fell(v, p) {
    const set = sets[p.foe], C = TUNE.corpse; if (!set) return;
    let n = 0, old = null;   // at most C.max lie about: the oldest still lying starts to fade now
    for (const q of corpses) if (q.on) { n++; if (q.t < q.fadeAt && (!old || q.t > old.t)) old = q; }
    if (n >= C.max && old) { old.fadeAt = old.t; old.fadeLen = C.early; }
    let c = null; for (const q of corpses) if (!q.on) { c = q; break; }
    if (!c) { c = corpses[0]; for (const q of corpses) if (q.t > c.t) c = q; }   // (all in use: the oldest goes)
    let dx = v.hx, dy = v.hy, l = hypot3(dx, dy, 0);
    if (l < 1e-3) { dx = p.x - host.player.x; dy = p.y - host.player.y; l = hypot3(dx, dy, 0) || 1; }
    dx /= l; dy /= l;
    const front = -(dx * Math.sin(v.face) + dy * Math.cos(v.face)) >= Math.cos(TUNE.ai.hitFront * DEG);
    const clip = pick(set, front ? 'die_b' : 'die_f', front ? 'die_f' : 'die_b');
    c.on = true; c.set = set; c.clip = clip || ''; c.z = p.z || 0; c.t = 0; c.lift = 0; c.vx = dx; c.vy = dy; c.pose = v.pose; c.foe = p.foe; c.fx = p.x; c.fy = p.y;
    if (clip) {   // the clip as rendered, its corpse on the pivot: the sprite goes back by his root's start ahead of it
      const L = set.tl(clip), sh = set.rootShift(clip) ?? (clip === 'die_b' ? 1 : -1) * (L.c.travel ?? C.travel[clip] ?? 0);
      c.face = v.face; c.x = p.x - Math.sin(v.face) * sh; c.y = p.y - Math.cos(v.face) * sh;
      c.groundT = set.markT(clip, 'ground') ?? L.total * .7; c.grounded = false; c.fadeAt = L.total + C.hold; c.fadeLen = C.fade;
    } else {   // the fallback: thrown back facing the shot, faded at once
      c.face = Math.atan2(-dx, -dy); c.x = p.x; c.y = p.y; c.grounded = true; c.fadeAt = C.old[0]; c.fadeLen = C.old[1] - C.old[0];
    }
  }
  // the body hits the ground: dust (combat's puff, its view's particles) and foe.ground (the thud). The payloads are a ring
  const GE = []; for (let i = 0; i < 8; i++) GE.push({type: 'foe.ground', x: 0, y: 0, z: 0, foe: ''});
  let gi = 0, combat = null;
  function ground(c) {
    const P = TUNE.corpse.puff; (combat ??= host.feature('combat'))?.core.puff(c.x, c.y, c.z, P.n, P.r);
    const e = GE[gi]; gi = (gi + 1) % GE.length; e.x = c.x; e.y = c.y; e.z = c.z; e.foe = c.foe; host.events.push(e);
  }
  // the reload's marks as you see them (foe.clip; see the header). The payloads are a ring too
  const KE = []; for (let i = 0; i < 16; i++) KE.push({type: 'foe.clip', x: 0, y: 0, z: 0, foe: '', gun: '', mark: ''});
  let ki = 0;
  function clipEv(g, mark) {
    const e = KE[ki]; ki = (ki + 1) % KE.length;
    e.x = g.p.x; e.y = g.p.y; e.z = g.p.z; e.foe = g.type; e.gun = g.T.gun.sound; e.mark = mark; host.events.push(e);
  }
  // the timeline clip's steps from v.rs up to step `to`: a mark for each that shows the dump / a load / the close frame
  function stepMarks(g, v, L, M, to) {
    for (let j = Math.max(0, v.rs); j <= to; j++) {
      const fr = L.play ? L.play[j] : j;
      if (fr === M.dump) clipEv(g, 'dump'); else if (fr === M.load) clipEv(g, 'load'); else if (fr === M.close) clipEv(g, 'close');
    }
    v.rs = to + 1;
  }
  function marks(g, v) {
    const set = sets[g.type], c = set && set.CLIP.gun_reload, M = c && c.play && c.marks ? c.marks : null, L = M && set.tl('gun_reload');
    if (g.act !== 'reload') {
      if (v.rs >= 0 && g.ammo >= g.T.gun.rounds) { if (L) stepMarks(g, v, L, M, L.n - 1); else clipEv(g, 'close'); }   // it ended: what's left
      v.rs = -1; return;
    }
    if (v.rs < 0) { v.rs = 0; v.rph = g.rph; v.ram = g.ammo; }   // a reload begins
    if (L) {   // the clip's own timeline: the step it shows now (as frameAt picks it)
      const t = Math.max(0, Math.min(.9999, reloadK(g))) * L.total; let i = 0; while (i < L.n - 1 && t >= L.ends[i]) i++;
      if (i >= v.rs) stepMarks(g, v, L, M, i);
    } else {   // the sim's phases
      if (g.rph === 'eject' && v.rph !== 'eject') clipEv(g, 'dump');
      if (g.ammo > v.ram) clipEv(g, 'load');
    }
    v.rph = g.rph; v.ram = g.ammo;
  }
  let frameN = 0;
  function sweep(v, p) { if (v.seen === frameN) return; if (p.broken) fell(v, p); VS.delete(p); }   // (gone: killed, or the gang left)

  // ---------------------------------------------------------------- the frame
  const O = {img: null, nrm: null, em: null, sx: 0, sy: 0, sw: 0, sh: 0, x: 0, y: 0, h: 0, px: 0, py: 0, type: 7, shadow: true, alpha: 1, flash: 0, flip: false, sway: 0, dynamic: false, lie: 0};
  // lift: px the pivot moves up the image (a death clip's shift); lie: how far down the body is (gfx.js BATCH_VS)
  function put(set, pose, f, x, y, h, alpha, flash, wob, lift = 0, lie = 0) {
    const sp = set.SP[pose] || set.SP['idle.0']; if (!sp) return;
    const img = sp.img; if (!img || !(img.width > 0)) return;
    O.img = img; O.nrm = sp.nrm || null; O.sx = f * set.FW; O.sy = 0; O.sw = set.FW; O.sh = set.FH;
    O.x = x; O.y = y; O.h = h; O.px = set.PIV[0] - wob; O.py = set.PIV[1] - lift; O.alpha = alpha; O.flash = flash; O.lie = lie;
    host.sprite(O); O.img = O.nrm = null;
  }
  // a corpse's contact shadow (view only, the ground layer: under the light, ground pixels only, so it shows round the
  // body and never on it): per death frame and facing, the frame's silhouette grown 1 px (dark) inside a 3 px fringe
  // (faint), made once on first sight and kept with the frame's image; a small stepped blob under his feet while he
  // stands. Drawn at the mood's contact-shadow strength (features/contact.js's), as much as he lies
  const AOM = new WeakMap(), GROW = [], FRINGE = [];
  for (let dy = -2; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
    const e = dx * dx / 10 + (dy - .5) * (dy - .5) / 7;
    if (e <= 1) FRINGE.push(dx, dy);
    if (Math.abs(dx) + Math.abs(dy - (dy > 0 ? 1 : 0)) <= 1) GROW.push(dx, dy);
  }
  let aoTmp = null;
  function aoMask(set, sp, f) {
    let arr = AOM.get(sp.img); if (!arr) AOM.set(sp.img, arr = new Array(set.ND).fill(null));
    if (arr[f]) return arr[f];
    const W = set.FW, H = set.FH, mk = () => { const c = document.createElement('canvas'); c.width = W + 8; c.height = H + 8; return c; };
    const c = mk(), q = c.getContext('2d'), t = aoTmp ??= mk(), tq = t.getContext('2d');
    const union = (D) => { tq.globalCompositeOperation = 'source-over'; tq.clearRect(0, 0, W + 8, H + 8); for (let k = 0; k < D.length; k += 2) tq.drawImage(sp.img, f * W, 0, W, H, 4 + D[k], 4 + D[k + 1], W, H); };
    union(FRINGE); q.globalAlpha = .38; q.drawImage(t, 0, 0);
    union(GROW); q.globalAlpha = .8; q.drawImage(t, 0, 0);
    q.globalAlpha = 1; q.globalCompositeOperation = 'source-in'; q.fillStyle = '#000'; q.fillRect(0, 0, W + 8, H + 8);
    return (arr[f] = c);
  }
  const blob = (() => {   // the feet: a stepped ellipse, 13 x 3 px core in a 19 x 7 px ring (contact.js's stamp, smaller)
    const c = document.createElement('canvas'); c.width = 19; c.height = 7; const q = c.getContext('2d'), id = q.createImageData(19, 7);
    for (let j = 0; j < 7; j++) for (let i = 0; i < 19; i++) {
      const x = i - 9, y = j - 3, e = (a, b) => x * x / (a * a) + y * y / (b * b);
      id.data[(j * 19 + i) * 4 + 3] = e(6.5, 1.5) <= 1 ? 255 : e(9.5, 3.5) <= 1 ? 90 : 0;
    }
    q.putImageData(id, 0, 0);
    return c;
  })();
  let aoK = .5;   // the mood's contact-shadow strength, read once a frame
  function corpseAO(c, set, pose, f, lift, lie, alpha) {
    const sp = set.SP[pose]; if (!sp || !sp.img || !(sp.img.width > 0)) return;
    const k = alpha * aoK, g = host.layer('ground');
    g.save(); g.imageSmoothingEnabled = false;
    if (lie > .02) {
      G.toScreenInto(c.x, c.z, c.y, SC);
      g.globalAlpha = k * Math.min(1, lie * 1.25);
      g.drawImage(aoMask(set, sp, f), Math.round(SC[0]) - (set.PIV[0] + 4) * z, Math.round(SC[1]) - (set.PIV[1] - lift + 4) * z, (set.FW + 8) * z, (set.FH + 8) * z);
    }
    if (lie < .98) {
      G.toScreenInto(c.fx, c.z, c.fy, SC);
      g.globalAlpha = k * (1 - lie);
      g.drawImage(blob, Math.round(SC[0]) - 9.5 * z, Math.round(SC[1]) - 2.5 * z, 19 * z, 7 * z);
    }
    g.restore();
  }
  function poseOf(set, g, v, dt, t) {
    const p = g.p, act = g.act, G2 = g.T.gun;
    G.toScreenInto(p.x, p.z, p.y, SC); const ox = SC[0], oy = SC[1];
    G.toScreenInto(g.tx, g.th, g.ty, SM); const tx = SM[0], ty = SM[1];
    const moving = g.speed > .15;
    // a hit: hit_f / hit_b while the sim holds him (flinch), then while he stands with the gun up (one who doesn't
    // flinch: only between shots); anything else he does takes over
    if (g.hitAge < 1) {
      const hc = pick(set, g.hitFront ? 'hit_f' : 'hit_b', g.hitFront ? 'hit_b' : 'hit_f');
      if (hc && g.hitAge < set.tl(hc).total && (g.flinch > 0 || (!moving && (act === 'ready' || (act === 'aim' && g.T.flinch > 0))))) {
        v.f = faceOf(set, g.face); return set.frameAtT(hc, g.hitAge);
      }
    }
    // the legs' phase (walk / run, or backing up: the phase runs back)
    const run = g.gait === 'run', C = set.CLIP[run ? 'run' : 'walk'];
    switch (act) {
      case 'draw': v.f = faceOf(set, g.face); return set.frameAt('gun_draw', g.at / G2.draw);
      case 'holster': v.f = faceOf(set, g.face); return set.has('gun_holster.0') ? set.frameAt('gun_holster', g.at / G2.holster) : set.frameAt('gun_draw', 1 - g.at / G2.holster);
      case 'fire': {
        const last = set.nm('gun_fire', (set.CLIP.gun_fire?.frames || 1) - 1); let bf = v.f, be = 9;
        for (let k = -1; k <= 1; k++) { const f = (faceOf(set, g.aim) + k + set.ND) % set.ND, e = aimErr(set, last, f, ox, oy, tx, ty); if (e < be) { be = e; bf = f; } }   // squared up for the kick
        v.f = bf; return set.frameAt('gun_fire', g.at / G2.recover);
      }
      case 'reload': v.f = faceOf(set, g.face); return reloadPose(set, g);
      case 'aim': return standAim(set, g, v, ox, oy, tx, ty);
      case 'ready':
        if (moving && set.twm.length) {
          const fa = worldOf(set, v.f), along = (g.vx * Math.sin(fa) + g.vy * Math.cos(fa)) / (g.speed || 1);
          v.ph = ((v.ph + along * g.speed * dt / set.CLIP.walk.stride) % 1 + 1) % 1;
          return walkAim(set, g, v, ox, oy, tx, ty, gaitFrame(set.CLIP.walk, v.ph));
        }
        return standAim(set, g, v, ox, oy, tx, ty);
      default:   // holstered: walk / run / idle
        if (moving && C) {
          v.f = faceOf(set, Math.atan2(g.vx, g.vy));
          v.ph = (v.ph + g.speed * dt / C.stride) % 1;
          return set.nm(run ? 'run' : 'walk', gaitFrame(C, v.ph));
        }
        v.f = faceOf(set, g.face);
        { const ci = set.CLIP.idle; return ci ? set.nm('idle', Math.floor(t * ci.fps + v.idle * ci.frames) % ci.frames) : 'idle.0'; }
    }
  }
  function glint(set, g, v) {   // the barrel glints through the lock: a small star on the 'add' layer, growing
    const B = set.barrel(v.pose), i = v.f * 3; if (B[i] !== B[i]) return;
    const G2 = g.T.gun, k = Math.min(1, (g.at - (G2.aim - G2.lock)) / G2.lock);
    G.toScreenInto(g.p.x, g.p.z, g.p.y, SC);
    const x = Math.round(SC[0] + B[i + 1] * z), y = Math.round(SC[1] + B[i + 2] * z), r = 1 + Math.round(k * 2), q = host.layer('add');
    q.fillStyle = GLINT[2]; q.fillRect(x - r * z, y, (2 * r + 1) * z, z); q.fillRect(x, y - r * z, z, (2 * r + 1) * z);
    q.fillStyle = GLINT[1]; q.fillRect(x - z, y - z, 3 * z, 3 * z);
    q.fillStyle = GLINT[0]; q.fillRect(x, y, z, z);
  }

  const L = {
    get sets() { return sets; }, get failed() { return failed; }, load, VS, corpses,
    view(dt, evs, on) {
      if (!on) { if (VS.size) VS.clear(); for (const c of corpses) c.on = false; return; }   // (out of the desert sandbox)
      for (const e of evs) if (e.type === 'arrow.hit' && e.prop?.kind === 'gunman') {   // (the way the last hit came; a bullet's shove)
        const v = VS.get(e.prop); if (!v) continue;
        v.hx = e.vx; v.hy = e.vy;
        if (e.kind === 'bullet') { const l = Math.hypot(e.vx, e.vy) || 1; v.nx = e.vx / l; v.ny = e.vy / l; v.nt = 0; }
      }
      for (const g of sim.gang) {   // a bullet's shove ages (in the view: it holds through the hitstop); the reload's marks as seen (foe.clip)
        if (g.p.broken) continue;
        const v = vsOf(g.p); if (v.nt < 9) v.nt += dt;
        marks(g, v);
      }
      const C = TUNE.corpse;
      for (const c of corpses) {
        if (!c.on) continue;
        c.t += dt;
        if (!c.clip) {   // the fallback's throw
          if (c.t < C.fall) { const k = 1 - c.t / C.fall; c.x += c.vx * C.slide * k * dt; c.y += c.vy * C.slide * k * dt; c.lift = Math.sin(Math.PI * c.t / C.fall) * C.lift; }
          else c.lift = 0;
        } else if (!c.grounded && c.t >= c.groundT) { c.grounded = true; ground(c); }
        if (c.t >= c.fadeAt + c.fadeLen) c.on = false;
      }
    },
    frame(f, on) {
      if (!on) return;
      yaw = host.yaw; z = host.zoom; frameN++;
      const t = f.t;
      for (const g of sim.gang) {
        const set = sets[g.type]; if (!set) continue;
        const p = g.p, v = vsOf(p); v.seen = frameN; v.face = g.face;
        const pose = poseOf(set, g, v, f.dt, t) || 'idle.0';
        v.pose = set.SP[pose] ? pose : 'idle.0';
        const wob = p.wob ? Math.round(Math.sin(p.wob * 18) * p.wob * 2) : 0, H = TUNE.hit;
        const k = v.nt < H.out ? v.nt / H.out : v.nt < H.out + H.back ? 1 - (v.nt - H.out) / H.back : 0, nd = H.nudge * k * (2 - k);   // (out fast, back eased)
        put(set, v.pose, v.f, p.x + v.nx * nd, p.y + v.ny * nd, (p.z || 0) + (p.h || 0), 1, Math.min(1, (p.flash || 0) * H.flash), wob);
        if (g.act === 'aim' && g.locked) glint(set, g, v);
      }
      if (VS.size > sim.gang.length) VS.forEach(sweep);
      const C = TUNE.corpse;
      aoK = host.mood?.shadow?.ao ?? .5;
      for (const c of corpses) {
        if (!c.on) continue;
        const set = c.set, pose = c.clip ? set.frameAtT(c.clip, c.t)
          : c.t < C.fall ? (set.has('fall') ? 'fall' : c.pose) : c.t < C.fall + C.land ? (set.has('land') ? 'land' : c.pose) : set.has('crouch') ? 'crouch' : c.pose;
        const a = c.t < c.fadeAt ? 1 : Math.max(0, 1 - (c.t - c.fadeAt) / c.fadeLen), f = faceOf(set, c.face);
        const lift = c.clip ? set.shiftPx(c.clip, c.t) : 0, lie = c.clip ? set.lieAt(c.clip, c.t) : 0;
        put(set, pose, f, c.x, c.y, c.z + c.lift, a, 0, 0, lift, lie);
        if (c.clip) corpseAO(c, set, set.SP[pose] ? pose : 'idle.0', f, lift, lie, a);
      }
      // their bullets in flight: gunfx's tracer look
      const B = sim.B;
      for (let i = 0; i < B.n; i++) {
        const v = hypot3(B.vx[i], B.vy[i], B.vh[i]) || 1;
        tracer(host, B.x[i], B.y[i], B.h[i], B.vx[i] / v, B.vy[i] / v, B.vh[i] / v, B.flown[i] + .3);
      }
    },
    hd(q, sc) {   // health bars (combat's look: a lagging white chip), the sheriff's name over his
      let any = false;
      for (const g of sim.gang) {
        const p = g.p, v = VS.get(p); if (!v) continue;
        const hurt = p.hp < p.maxHp; v.hpShow = hurt ? Math.max(p.hp, (v.hpShow ?? p.hp) - p.maxHp * .012) : p.hp;
        if (!hurt && !p.elite) continue;
        G.toScreenInto(p.x, (p.z || 0) + (p.h || 0) + (p.hitH ?? 1.6) + .35, p.y, SC);
        const x = SC[0] * sc, y = SC[1] * sc;
        if (!any) { q.save(); any = true; }
        if (hurt) {
          const w = Math.round(12 * sc), hh = Math.max(3, Math.round(sc * 1.1)), x0 = Math.round(x - w / 2), y0 = Math.round(y);
          q.fillStyle = 'rgba(14,10,14,.85)'; q.fillRect(x0 - 1, y0 - 1, w + 2, hh + 2);
          q.fillStyle = '#f4efe4'; q.fillRect(x0, y0, Math.round(w * v.hpShow / p.maxHp), hh);
          q.fillStyle = '#d8483a'; q.fillRect(x0, y0, Math.round(w * p.hp / p.maxHp), hh);
        }
        if (p.elite) {
          const u = Math.max(.7, Math.min(2.8, sc / 2.6));
          q.font = `700 ${Math.round(11 * u)}px "Segoe UI", system-ui, sans-serif`; q.textAlign = 'center'; q.textBaseline = 'bottom'; q.lineJoin = 'round';
          q.lineWidth = Math.max(2.5, 3 * u); q.strokeStyle = 'rgba(16,10,12,.9)'; q.strokeText(p.name, Math.round(x), Math.round(y - 3 * u));
          q.fillStyle = '#f2d27a'; q.fillText(p.name, Math.round(x), Math.round(y - 3 * u));
        }
      }
      if (any) q.restore();
      // a gun held on you from off screen: an arrow at the edge, toward it
      const VW = host.VW, VH = host.VH, cx = VW / 2, cy = VH / 2, inset = 7;
      for (const g of sim.gang) {
        if (g.act !== 'aim') continue;
        const p = g.p; G.toScreenInto(p.x, (p.z || 0) + 1.2, p.y, SC);
        if (SC[0] > 2 && SC[0] < VW - 2 && SC[1] > 2 && SC[1] < VH - 2) continue;
        const dx = SC[0] - cx, dy = SC[1] - cy, l = Math.hypot(dx, dy) || 1, ux = dx / l, uy = dy / l;
        const t = Math.min(Math.abs(dx) > 1e-3 ? (cx - inset) / Math.abs(dx) : 1e9, Math.abs(dy) > 1e-3 ? (cy - inset) / Math.abs(dy) : 1e9);
        const ex = (cx + dx * t) * sc, ey = (cy + dy * t) * sc, u = Math.max(.7, Math.min(2.8, sc / 2.6)), s = (g.locked ? 10 : 7) * u;
        q.fillStyle = g.locked ? '#fff4c8' : '#ffb84a'; q.strokeStyle = 'rgba(30,14,8,.85)'; q.lineWidth = Math.max(1.5, 1.5 * u);
        q.beginPath(); q.moveTo(ex + ux * s, ey + uy * s); q.lineTo(ex - ux * s * .4 - uy * s * .75, ey - uy * s * .4 + ux * s * .75); q.lineTo(ex - ux * s * .4 + uy * s * .75, ey - uy * s * .4 - ux * s * .75); q.closePath();
        q.stroke(); q.fill();
      }
    },
  };
  return L;
}
