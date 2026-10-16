// TOOL (the player's side): a tool in hand for the live cowboys (docs/GATHERING.md: key 3 takes out the bag's tool; the axe
// first). Each tool has a JOB (content/items.js tool.job: 'chop' the axe, 'mine' the pick, docs/MINING.md) with its own swing
// (SWINGS) and its own feature saying what a press is for and where it goes (wantBy / aimBy per job). Like brawl.js it runs inside player.js's step: while it swings it drives the frame, the facing, the state and the
// motion the way player.js does (the player's code, in another file). What a blow DOES (which trunk it bites, a foe in the
// way) is features/woodcut.js's: this module says when and which way.
//   out     S.on: the tool is in his right hand (the gun holstered, the fists down); he walks and runs as ever (not busy). No
//           key takes it out: a press the feature says is the tool's (wantBy: LMB on a trunk) or its use(id) (E at a trunk)
//           does, and it goes back by itself TUNE.swing.stow s after the last swing
//   chop    P.state 'chop' (BUSY): turned to the target (a world point the feature picked: the trunk) and kept facing it;
//           WASD steps him meanwhile (TUNE.swing.move, the fists' guard footwork: S.stepDir, P.ph). A target with a KEEP
//           distance (a trunk: the feature's aim says) is circled: the keys' sideways part goes round it, his distance is
//           held there; one farther than its FAR he walks in to first (S.closing: the swing's clock waits at 0, the view
//           shows the ready pose over his steps). The blow at TUNE.swing.hit: event player.chop {x, y, z, vx, vy (unit: his
//           facing then), tool, job, rhythm}. A press held swings again at once as one ends (no idle step: the facing stays on
//           it). RHYTHM: a fresh press (let go and pressed again) within RHYTHM s of a swing's end, before or after it, makes
//           the next blow a rhythm blow (rhythm: true on its event; the job's feature says what that does: mining hits harder)
// The live clip is the view's (livehero.js toolMotion: a stand-in until the chop's own, time-warped onto these times).
// OWNS: S (the tool out, its id, the swing, its clock, the target), and while it swings P's frame / face / state / vx / vy.
// READS: SWINGS (content/woodcut.js, content/mining.js), H.yaw (world <-> view). EMITS (player.js's queue, turned into the world by the loop):
//   player.chop.
// BUDGET: part of player.step: a few multiplies a step.
//   const T = createTool(PL, internals); T.step(dt, mx, my) -> true while it drives; the API below (features/woodcut.js,
//   player.js press / release)
import {TUNE} from '../../content/woodcut.js';
import {SWING as MINE, TUNE as MINING} from '../../content/mining.js';
import {ITEMS} from '../../content/items.js';
import {flags} from '../../core/flags.js';

export const STATES = ['chop'];   // (player.js puts them in BUSY)
const FB = ['lunge', 'reach_up'];
const FOOT = .6;   // m a footwork cycle (two steps), as the fists' (the view's step clips by P.ph)
const SWINGS = {chop: TUNE.swing, mine: MINE};   // a job's swing (its footwork: W.move)
const RHYTHM = flags.get('rhythm') === '0' ? -1 : MINING.rhythm;   // s either side of a swing's end ('rhythm=0': off)
const jobOf = id => ITEMS[id]?.tool?.job || 'chop';

export function createTool(PL, I) {
  const {P, H, has, ev, dirOf, vecOf, moveBy, turnToward, BUSY} = I;
  let W = SWINGS.chop, M = W.move;   // (the tool in hand's swing: take())
  const S = {on: false, id: '', job: '', mode: '', t: 0, done: false, tx: 0, ty: 0, dx: 0, dy: 1, want: false, held: false, n: 0, stepDir: 'f', ph0: 0,
    keep: 0, far: 0, closing: false, closeT: 0, idleT: 0, rhythm: false, sinceEnd: 9};
  const aimFns = {};    // job -> the feature's: where a swing goes, asked as it starts -> {x, y} world
  const wantFns = [];   // [job, fn]: the features': is this press the tool's -> the tool's id (content/items.js) | ''
  let c = 1, s = 0;
  const yaw = () => { const a = H.yaw ? H.yaw() : 0; c = Math.cos(a); s = Math.sin(a); };
  const OV = [0, 0];
  const toV = (x, y) => { OV[0] = x * c - y * s; OV[1] = x * s + y * c; return OV; };   // world -> his view frame (viewxf's)
  const fb = () => { for (let i = 0; i < FB.length; i++) if (has(FB[i])) return FB[i]; return 'idle.0'; };
  const free = () => !BUSY.has(P.state) && P.state !== 'roll' && P.state !== 'backstep';

  function step(dt, mx = 0, my = 0) {
    if (!S.mode) S.sinceEnd += dt;
    if (S.want && !S.mode) { S.want = false; if (S.on && free() && !PL.brawl?.carrying) start(); }
    if (!S.mode) {   // (out and idle: back in the bag after a while)
      if (S.on && !S.held && (S.idleT += dt) > W.stow) put();
      return false;
    }
    S.idleT = 0;
    if (P.state !== S.mode) { S.mode = ''; return false; }   // (something else took him: a blast, a knock)
    S.t += dt; P.t = S.t;
    const dist = footwork(dt, mx, my);
    if (S.closing) {   // walking in: the swing starts in reach (LMB let go, or too long getting there: none)
      S.closeT += dt;
      if (!S.held || S.closeT > M.closeT) { end(); return true; }
      if (dist > S.far) { S.t = 0; P.t = 0; P.frame = fb(); return true; }
      S.closing = false; S.t = 0; P.t = 0;
    }
    if (!S.done && S.t >= W.hit) {
      S.done = true; S.n++; const f = vecOf(P.face); S.dx = f[0]; S.dy = f[1];
      ev({type: 'player.chop', x: P.x, y: P.y, z: P.z, vx: S.dx, vy: S.dy, tool: S.id, job: S.job, rhythm: S.rhythm});
      S.rhythm = false;   // (one blow: a held press chains on without it)
    }
    P.frame = fb();
    if (S.t >= W.dur) {
      if (S.held && S.on) start();   // (held: the next swing at once, still facing the target)
      else end();
    }
    return true;
  }
  function end() { S.mode = ''; S.closing = false; S.sinceEnd = 0; P.state = 'idle'; P.t = 0; P.prevF = -1; }
  function take(id) {
    if (S.on && S.id === id) return;
    if (S.mode && P.state === S.mode) end();   // (another tool: its swing ends)
    S.on = true; S.id = id; S.job = jobOf(id); W = SWINGS[S.job] || SWINGS.chop; M = W.move; S.idleT = 0; S.mode = ''; PL.gun?.stow?.(); PL.fists?.select(false);
  }
  function put() { S.on = false; S.id = ''; S.job = ''; S.want = false; S.held = false; S.idleT = 0; if (S.mode && P.state === S.mode) end(); S.mode = ''; }
  // a fresh press: in rhythm when it comes within RHYTHM s of the swing's end (before it: the swing under way is near its end)
  function beat() { S.rhythm = RHYTHM > 0 && (S.mode ? !S.closing && S.t >= W.dur - RHYTHM : S.sinceEnd <= RHYTHM); }
  // stepping while he swings, turned to the target all the while: a KEEP target circled at its distance (the keys' sideways
  // part round it, the distance sprung back to keep), else any way the keys say, at the footwork's speeds -> his distance
  function footwork(dt, mx, my) {
    yaw(); const v = toV(S.tx, S.ty); let fx = v[0] - P.x, fy = v[1] - P.y; const fl = Math.hypot(fx, fy);
    if (fl > .05) { fx /= fl; fy /= fl; P.want = dirOf(fx, fy); turnToward(P.want, dt, M.turn); } else { const f = vecOf(P.face); fx = f[0]; fy = f[1]; }
    let wx, wy;
    if (S.keep > 0 && fl > .05) {
      const tx = -fy, ty = fx, vt = (mx * tx + my * ty) * M.side;   // (round it: the keys' part across the line to it)
      const vr = Math.max(-M.back, Math.min(S.closing ? M.close : M.fwd, (fl - S.keep) * M.hold));   // (toward it +)
      wx = fx * vr + tx * vt; wy = fy * vr + ty * vt;
    } else {
      const along = mx * fx + my * fy, sp = !(mx || my) ? 0 : along > .5 ? M.fwd : along < -.5 ? M.back : M.side;
      wx = mx * sp; wy = my * sp;
    }
    const a = Math.min(1, dt * M.acc / Math.max(1, Math.hypot(wx, wy) || 1));
    P.vx += (wx - P.vx) * a; P.vy += (wy - P.vy) * a;
    const d = moveBy(P.vx * dt, P.vy * dt), sv = Math.hypot(P.vx, P.vy);
    if (sv > .2) { const al = (P.vx * fx + P.vy * fy) / sv; S.stepDir = al > .5 ? 'f' : al < -.5 ? 'b' : fx * P.vy - fy * P.vx < 0 ? 'l' : 'r'; }   // (his left: as the fists')
    P.ph = ((P.ph || 0) + (d || 0) / FOOT) % 1;
    const half = P.ph < .5 ? 0 : 1;
    if (d > 0 && half !== S.ph0) { S.ph0 = half; ev({type: 'player.step', x: P.x, y: P.y, z: P.z, foot: half ? 'R' : 'L', big: 0}); }
    return fl;
  }
  function start() {
    const q = aimFns[S.job]?.(); if (q) { S.tx = q.x; S.ty = q.y; S.keep = q.keep || 0; S.far = q.far || 0; }
    yaw(); const v = toV(S.tx, S.ty), dx = v[0] - P.x, dy = v[1] - P.y;
    S.closing = S.far > 0 && Math.hypot(dx, dy) > S.far; S.closeT = 0;   // (out of reach: walked in first)
    if (dx * dx + dy * dy > 1e-4 && S.mode !== 'chop') P.face = P.want = dirOf(dx, dy);   // (squared up at once from a stand; a chained swing keeps turning)
    const f = vecOf(P.face); S.dx = f[0]; S.dy = f[1];
    S.mode = 'chop'; S.t = 0; S.done = false; P.state = 'chop'; P.t = 0; P.aimRoll = false; P.queuedShot = false;
  }
  function want(id) { const fresh = !S.held; take(id); if (fresh) beat(); S.held = true; if (!S.mode) S.want = true; }

  return {
    S, step, STATES,
    get on() { return S.on; }, get mode() { return S.mode; },
    get progress() { return S.mode ? S.t / W.dur : 0; },
    get swing() { return W; },   // (the tool in hand's swing: view/livehero.js times the clip by it)
    // the tool away at once (a loadout change, the gun or the fists asked for)
    put,
    // a press a job's feature says is its tool's: fn() -> the tool's id | '' (features/woodcut.js: the cursor on a trunk;
    // features/mining.js: on a vein). The first job to answer takes the press
    wantBy(fn, job = 'chop') { const i = wantFns.findIndex(w => w[0] === job); if (i >= 0) wantFns[i][1] = fn; else wantFns.push([job, fn]); },
    // used without a press (E at a trunk): the tool out and swinging while `held` stays true (the feature lets go: release())
    use(id) { if (PL.brawl?.carrying || !free() && !S.mode) return false; want(id); return true; },
    // where a job's swing goes: fn() -> a world point {x, y, keep?, far?} (keep: the distance he holds from it, far: beyond it he
    // walks in first; 0 / none: a free point), asked as each swing starts (features/woodcut.js: the trunk under the cursor)
    aimBy(fn, job = 'chop') { aimFns[job] = fn; },
    // LMB (player.js press / release): true = taken (the tool is out)
    press() {
      if (PL.brawl?.carrying) return false;
      let id = ''; for (let i = 0; i < wantFns.length && !id; i++) id = wantFns[i][1]() || '';
      if (!id) { if (S.on && !S.mode) put(); return false; }   // (not the tool's: the gun's, the fists'; an idle axe goes away)
      want(id); return true;
    },
    release() { if (!S.on) return false; S.held = false; return true; },
    clear() { S.want = false; S.held = false; S.closing = false; if (S.mode && P.state === S.mode) { P.state = 'idle'; P.t = 0; } S.mode = ''; },
  };
}
