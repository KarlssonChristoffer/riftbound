// LIVE HERO (the gunslinger's by default, main.js; docs/exp/livehero.md): the player drawn LIVE instead of as his atlas sprite. The model
// is the atlas's own Blender model in rigid per-bone segments with every atlas pose as bone matrices and the clips'
// timing (tools/blender/ragdoll_export.py --atlas), drawn by render/rigmesh.js (the pixelizer's rules on the GPU, the
// character's pixel type 4). It shows the SAME frame the sprite path picks each step (P.frame at P.face), so the two
// compare directly; dev/livekeys.js flips sprite <-> live at runtime (Shift+7).
// THE PIXEL-FRIENDLY MOTION LAYER: knobs (K), each switchable at runtime and measured (tmp/exp-livehero: the shimmer meter):
//   step   stepped time: the pose is the sim's frame as the sprites show it (the clip's fps, its play / ms holds) and the
//          procedural layers sample at STEP_HZ; off (smooth): each bone slerped toward the clip's next frame by the clip's
//          own phase (distance travelled) or time, a clip change cross-faded, the facing eased at the aim's turn rate
//   face   facing snap: the body's yaw in 16 | 32 steps relative to the camera (16: the sprites'); 0: free (his facing in
//          the world: turning the camera doesn't turn him)
//   hyst   procedural rotations (the aim twist, the IK hand's orbit, the swing) move only when their target moved more than
//          this many degrees, else they hold (0: off)
//   hold   hold-until-change: the drawn pose stays until the new one would move some bone tip >= 1 screen px
//   snap   the body's anchor on whole pixels (rigmesh uSnap, as the sprite cards). (The tone bands are fixed to the camera
//          always: rigmesh's light turns with the view.)
//   smear  a segment whose tip jumped more than SMEAR.px since the last drawn frame is stretched back along its motion
//          (by the jump's share, at most SMEAR.max m and SMEAR.kmax x its own extent that way; the hat and the coil, which
//          ride other pieces, never)
// PROCEDURAL ANIMATION (K.proc; the payoff of going live): the gun aimed at ANY angle, standing or on the move (a continuous
// spine twist onto the cursor over the twist-0 pose, instead of the gun_aim_* / gws_* / grs_* twist families), a reload's
// upper body over the walk / run legs (layering: legs from one clip, the upper body from another, here gun_reload's 13
// frames instead of the 3 gwr_* / grr_* phases), and two demos (K.demo): 'lasso' (the rope hand on a point circling
// overhead: a two-bone IK hand, the loop drawn as rope) and 'swing' (hanging from a rope, swinging as a pendulum).
// EMOTES (K.demo = a clip of J.live: animations made for the live model only, no atlas render: western.py OUTLAW_EMOTES,
// exported with ragdoll_export.py --clips): played by their own timing while he stands still (emote() below).
// FLOW (K.flow, with the procedural layers: gunplay that moves): the aim LEADS with the head and the chest follows on a
// spring that overshoots a little and settles (the world's aim angle springs, so re-planted legs don't jolt it), the gun
// arm trails a fast swing; the body leans into its acceleration; the free arm pumps with the stride on the move; every
// shot kicks a little differently (RECOIL: the wrist's flip, the shoulder's rock, the whole chest), the standing kick
// included (gun_aim + a kick instead of gun_fire's one). All of it on the drawn pose only, stepped with the knobs.
// COMBAT STYLE (with FLOW, a model with the cb_* clips: western.py COMBAT_LIVE): the STANCE he shoots from, picked each
// time the gun comes out by how far the target is and whether he is moving (up close: low at the hip; further: the aim,
// a deep crouch, side-on like a duelist, down on a knee two-handed), the DRAW into it (straight, a sweep out wide, a spin
// out of the holster, up by the cheek, dropping to the knee) laid over the sim's draw by its progress, the hip shot from
// the hip stance; on the move the hip stance's upper body over the legs; changing as the fight goes (he sets off, stops,
// a few shots in), cross-faded. The spine twist aims whichever it is. The drawn muzzle goes to the gun's flash
// (live.muzzle(): host.playerMuzzle, features/gunfx.js), since the sim's muzzle is its atlas frame's.
// THE RUNTIME CLOTH (the gunslinger's duster's long panel: runtime cloth on the sprite path, view/cloth.js): the atlas's
// cloth simulated by a ClothRig of its own, fed every frame from the DRAWN pose (the bone it hangs from; the body's
// capsules carried by the live bones), his motion and his continuous facing; drawn through rigmesh with his body
// (rig.attach: its points in the hips' frame, a flat normal a facet, its family and bias, a part of its own), so pass B
// gives it the body's bands, lines and outline and the depth buffer sorts it against his legs. (cloth())
// TRANSITIONS (with FLOW): when what is drawn switches (another clip, stance, layer or angle family, the aim on or off) or
// his facing steps, the drawn body blends from what was on screen over TB.dur / TB.face s, in his frame turned by the
// facing (so a facing step turns smoothly too), joints held together (a local blend, then FK); and the aim's spring
// restarts on the new pose instead of swinging the arm across. (Within a clip, frame to frame, nothing is blended: that
// motion is drawn as authored.)
// VIEW only: reads the player (P, the gun's state), the cursor; writes its own state, its rig, and hides the hero's card
// while it draws (hero.card.setVisible). The sim never reads any of it (?views=0 and ?live leave the sim the same).
// OWNS: the live model and its rig (render/rigmesh.js), the knobs, the drawn pose, the lineup (dev: setLineup).
// READS: app (P, PL, player, yaw, zoom, cam, mouse), hero (atlas, card, loadName), pa (hoverTarget, faceRest), G.
// BUDGET: char: ~25 bones a frame (slerp + FK + ~100 projected tips), ~.02 ms; render: rigmesh's A + B + S (3 draws).
//   const live = await createLiveHero({G, app, hero, pa, mouse, cam, ctxO}); live.on / toggle() / compose(PX, PY, perf)
//   -> sinkPx (instead of hero.compose) / sprite() (host.playerSprite's object) / set(knobs) / preset(name) / K / stats
// ONE BODY PER LOADOUT (MODELS): each loadout with a live model gets its own body (createLiveBody: its model, poses, clips,
// emotes, history) on one shared rig, loaded the first time he wears it (the sprite shows meanwhile); the knobs and the
// demo (K) are shared, so a preset or an emote carries over a loadout switch.
import {createRigMesh} from '../render/rigmesh.js';
import {createFlashes} from '../render/flashes.js';
import {ClothRig} from './cloth.js';
import {flags} from '../core/flags.js';
import {LOADOUTS} from './hero.js';
import {WEAPONS} from '../content/weapons.js';
import {elev} from '../world/world.js';   // (the ground under his feet: FEET ON THE GROUND)
import {VAULT_T, VAULT_OVER_T} from '../sim/player/player.js';   // (MOTION: the vaults' frames by their progress)
import {createHeroRag} from './herorag.js';   // THROWN: his ragdoll while a blast throws him (sim/player/launch.js)
import {TUNE as LASSO_TUNE} from '../content/lasso.js';   // LASSO: the snare's timing (the clip warped onto the sim's)
import {TUNE as ROPEWALL, LADDER} from '../content/ropewall.js';   // ROPEWALL: the climb's numbers (the clips' phases)
import {TUNE as FISTS_TUNE, MOVES as FISTS_MOVES} from '../content/fists.js';   // FISTS: the moves' times (the clips warped onto them)
import {TUNE as WOOD} from '../content/woodcut.js';   // TOOL: the swing's times (its clip warped onto them)
import {createHeldTool} from './heldtool.js';   // TOOL: the axe in his fist (a runtime mesh on the hand: docs/GATHERING.md)
import {ramp6} from './rigkit.js';
import {dress as dressModel} from './dress.js';   // GEAR: the model as worn (docs/GEAR.md)

const DEG = Math.PI / 180, TAU = Math.PI * 2;
const C20 = Math.cos(20 * DEG), S55 = Math.sin(55 * DEG), K_UP = Math.tan(20 * DEG) * C20 / S55;   // the sprite camera's squash
const FADE = .08, STEP_HZ = 12, TURN = 1200 * DEG;   // clip cross-fade (s), procedural steps / s, eased facing (rad/s)
const PLAYER_SUN = 1.6;   // m toward the sun of his chest where the composite tests whether he stands in shade (the sprite: .5)
const XFAMS = new Set(['ob', 'ub', 'cx']);   // the angles' gait families (sim/player/gun.js TWX): drawn as they are, trimmed by
                                             // at most XLIM of spine twist (their upper bodies aren't the aim's twist-0)
const XLIM = 30 * Math.PI / 180;
const SHOT_FX = {life: .065, len: .62};
// TRANSITIONS: s a switch / a facing step blends over at least; longer for a bigger change (the hands, the gun, the head,
// the feet moving at most `speed` art px / s on screen; the gun's heading turning at most `turn` deg / s), at most max s
const TB = {dur: .12, face: .09, speed: 300, turn: 720, max: .28};   // (turn: deg / s the barrel's heading may swing)   // an emote's shot: the flash's life (s) and length (m along the barrel), as gunfx's
const SMEAR = {px: 3, k: .55, max: .3, kmax: 2};   // a tip jump past px screen px: stretched back k of its move (at most
                                                   // max m, at most kmax x the piece's own extent along the move)
// the knobs' presets (dev/livekeys.js cycles them; the shimmer meter runs each)
export const PRESETS = {
  exact: {step: true, face: 16, hyst: 0, hold: false, snap: true, smear: false, proc: false},   // the sprite path's frames, drawn live
  smooth: {step: false, face: 0, hyst: 0, hold: false, snap: false, smear: false},
  step: {step: true, face: 0, hyst: 0, hold: false, snap: false, smear: false},
  face16: {step: false, face: 16, hyst: 0, hold: false, snap: false, smear: false},
  hyst: {step: false, face: 0, hyst: 7, hold: false, snap: false, smear: false},
  hold: {step: false, face: 0, hyst: 0, hold: true, snap: false, smear: false},
  snap: {step: false, face: 0, hyst: 0, hold: false, snap: true, smear: false},
  smear: {step: false, face: 0, hyst: 0, hold: false, snap: false, smear: true},
  all: {step: true, face: 16, hyst: 7, hold: true, snap: true, smear: false},
  allsmear: {step: true, face: 16, hyst: 7, hold: true, snap: true, smear: true},
  free32: {step: false, face: 32, hyst: 7, hold: true, snap: true, smear: false},   // smooth time, 32 facings, the rest on
};
for (const v of Object.values(PRESETS)) { v.proc ??= true; v.flow ??= v.proc; v.blend ??= v.flow; v.feet ??= v.proc; v.move ??= v.proc; }   // (blend: TRANSITIONS)   // (every preset but exact: the procedural layers on)
for (const v of Object.values(PRESETS)) { v.look ??= v.proc; v.hit ??= v.proc; v.mlean ??= v.flow; v.wx ??= v.proc; v.idle ??= v.proc; }   // (REACTIONS: the head's look, the flinches, the lean on the move, the weather, the idles)
// REACTIONS' numbers (docs/exp/livereact.md). LOOK: the head's turn to what he notices: deg the neck takes (neck), deg
// more the chest adds (chest), past max (round behind him) he doesn't look; the pitch's limits up / down (the sombrero's
// brim tips a lot); the spring (w rad/s, z damping; fast: w for danger: a gunman aiming, a shot, a blast, a hit, a bullet
// landing close); hyst: deg the target may drift before the held one moves; fade s
const LOOK = {neck: 62, chest: 28, max: 125, up: 12, down: 18, w: 13, fast: 22, z: .8, hyst: 4, fade: .2,
  danger: new Set(['aim', 'locked', 'shot', 'explode', 'hit', 'miss'])};
// FLINCH: a hit bends him along its push: deg at strength 1 for the chest, the head (more: it whips), the arms (flung the
// other way); up to the peak in rise s, eased out by dur s, stepped at hz; a knock (the sim's: a brute, a blast) x knock
const FLINCH = {chest: 15, head: 10, arm: 16, rise: .05, dur: .34, knock: 1.6, hz: 24};
// MLEAN: the lean on the move with his gun away (FLOW's lean has it while he aims): deg per m/s^2 of acceleration, at most
// side (into a turn), fwd (setting off), back (stopping); tau s of smoothing, fade s in / out
const MLEAN = {k: .45, side: 11, fwd: 8, back: 7, tau: .15, fade: .15};
// WEATHER: the hat held in a gust (the wind's strength over hat.on, let go under hat.off after hat.hold s; the left hand on
// the brim hat.fwd m before the hat's band, hat.side to his left, hat.up over it), leaning into the wind (deg at a gale) with
// the head down; the rain's hunch (from rain.on, all of it at rain.full: shoulders up, the head down, the chest forward,
// deg) and a hand over the eyes in heavy rain (over rain.shade, standing or walking); the cold's hug (the hands on the other
// arm, from cold.on, standing or walking) and its shivers (bursts of burst s every 2.5 to 5 s: the shoulders deg, the chest
// chest deg, at hz); fade s in / out
const WX = {hat: {on: 1.85, off: 1.45, hold: .7, fwd: .12, side: .1, up: -.02, fade: .25}, lean: {max: 5, head: 7},
  rain: {on: .3, full: .8, shoulder: 9, head: 10, chest: 4, shade: .6, fade: .6},
  cold: {on: .3, full: .7, burst: .45, every: [2.5, 5], deg: 3, chest: 1.5, hz: 14, fade: .5}};
// IDLES: standing calm a while: after `spot` s a place for a context move (the senses' spot(), again every `retry` s while there
// is none), the body eased onto it over `ease` s; else after `shift` s the weight shift, and every `every` s one of the
// fidgets; calm again `calm` s after a hit
const IDLE = {spot: 2.5, retry: 3, ease: .45, shift: 5, every: [6, 12], calm: 3, fidgets: ['id_hat', 'id_gun', 'id_neck', 'id_scuff']};
// FLOW's numbers: the aim spring (w rad/s, z damping: ~10 % overshoot, settled in ~.2 s), the head's lead (share of the
// chest's lag, at most headMax deg), the gun arm's drag (s of the swing's speed, at most dragMax deg), the free arm's
// pump (deg at a full stride: walk, run), the lean into acceleration (deg per m/s^2, at most max; tau s of smoothing)
const FLOW = {w: 26, z: .55, head: .85, headMax: 40, drag: .03, dragMax: 12, pump: {walk: 14, run: 26}, stride: .22,
  lean: {k: .3, max: 7, tau: .12}, kickHz: 24};
// the shots' kicks: weight (how often), dur (s), and deg at the peak: the wrist's flip (the gun in the fist), the arm up at
// the shoulder, the chest back, the head's flinch; each shot draws one, x .85..1.15 (the Navy kicks x 1.25, a fan x .5)
const RECOIL = [
  {w: 4, dur: .15, wrist: 28, arm: 8, chest: 2, head: 3},   // the wrist flips the muzzle up
  {w: 3, dur: .2, wrist: 12, arm: 15, chest: 5, head: 5},   // the shoulder rocks back
  {w: 2, dur: .24, wrist: 16, arm: 7, chest: 9, head: 2},   // the whole chest takes it
];
const RECOIL_W = RECOIL.reduce((a, r) => a + r.w, 0);
// COMBAT STYLE's numbers: each stance's weight by the target's distance [up close (< near m), mid, far (> far m)], the
// draws into it ('' = the sim's own gun_draw), the cross-fade (s), how long he stands before a standing stance comes
// back after moving (s), the chance a shot (from the 2nd after a pick) changes the stance
const COMBAT = {near: 3, far: 7, fade: .15, settle: .3, shift: .22,
  w: {aim: [1, 4, 2], hip: [7, 1, 0], crouch: [2, 2.5, 1.5], duel: [0, 2, 3.5], kneel: [0, 1.5, 3]},
  draws: {aim: ['', 'cb_dr_sweep', 'cb_dr_spin'], hip: ['cb_dr_hip'], crouch: ['cb_dr_crouch', 'cb_dr_spin'], duel: ['cb_dr_high'],
    kneel: ['cb_dr_kneel']},
  move: ['aim', 'hip']};   // the stances his upper body has on the move
export const DEMOS = ['', 'lasso', 'swing'];
// the loadouts with a live model (view/hero.js names). The gunslinger's duster's long panel isn't in his mesh: it is the
// atlas's runtime cloth, run on his live bones (THE RUNTIME CLOTH below)
export const MODELS = {outlaw: '../concepts/sprites/out/live/outlaw/', gunslinger: '../concepts/sprites/out/live/gunslinger/'};

// ---------------------------------------------------------------- quaternions (x, y, z, w) and rigid transforms in Float64Arrays
function qmul(a, i, b, j, o, k) {   // o = a * b
  const ax = a[i], ay = a[i + 1], az = a[i + 2], aw = a[i + 3], bx = b[j], by = b[j + 1], bz = b[j + 2], bw = b[j + 3];
  o[k] = aw * bx + ax * bw + ay * bz - az * by; o[k + 1] = aw * by - ax * bz + ay * bw + az * bx;
  o[k + 2] = aw * bz + ax * by - ay * bx + az * bw; o[k + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
function qrot(q, i, x, y, z, o, k) {   // o = q v q*
  const qx = q[i], qy = q[i + 1], qz = q[i + 2], qw = q[i + 3];
  const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
  o[k] = x + qw * tx + qy * tz - qz * ty; o[k + 1] = y + qw * ty + qz * tx - qx * tz; o[k + 2] = z + qw * tz + qx * ty - qy * tx;
}
function slerp(a, i, b, j, u, o, k) {
  let bx = b[j], by = b[j + 1], bz = b[j + 2], bw = b[j + 3], d = a[i] * bx + a[i + 1] * by + a[i + 2] * bz + a[i + 3] * bw;
  if (d < 0) { d = -d; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  let s0 = 1 - u, s1 = u;
  if (d < .9995) { const th = Math.acos(d), sn = Math.sin(th); s0 = Math.sin((1 - u) * th) / sn; s1 = Math.sin(u * th) / sn; }
  const x = s0 * a[i] + s1 * bx, y = s0 * a[i + 1] + s1 * by, z = s0 * a[i + 2] + s1 * bz, w = s0 * a[i + 3] + s1 * bw, l = Math.hypot(x, y, z, w) || 1;
  o[k] = x / l; o[k + 1] = y / l; o[k + 2] = z / l; o[k + 3] = w / l;
}
const R4 = new Float64Array(4), V3 = new Float64Array(3);
function axisAngle(x, y, z, a, o, k = 0) { const s = Math.sin(a / 2); o[k] = x * s; o[k + 1] = y * s; o[k + 2] = z * s; o[k + 3] = Math.cos(a / 2); return o; }
function fromTo(ax, ay, az, bx, by, bz, o) {   // the shortest rotation taking direction a onto direction b
  const la = Math.hypot(ax, ay, az) || 1, lb = Math.hypot(bx, by, bz) || 1; ax /= la; ay /= la; az /= la; bx /= lb; by /= lb; bz /= lb;
  const d = ax * bx + ay * by + az * bz;
  let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx, w = 1 + d;
  if (w < 1e-6) { x = Math.abs(ax) < .9 ? 0 : -az; y = Math.abs(ax) < .9 ? -az : 0; z = Math.abs(ax) < .9 ? ay : ax; w = 0; }
  const l = Math.hypot(x, y, z, w) || 1; o[0] = x / l; o[1] = y / l; o[2] = z / l; o[3] = w / l; return o;
}
const wrap = a => a - TAU * Math.round(a / TAU);

async function createLiveBody({G, app, hero, pa, mouse, cam, ctxO, url: base, rig, flashes, K, slots, bust = ''}) {   // (bust: a reload's query, past the browser's cache)
  const [J, bin] = await Promise.all([fetch(base + 'model.json' + bust).then(r => r.json()), fetch(base + 'model.bin' + bust).then(r => r.arrayBuffer())]);
  const model = rig.addModel(J, bin);
  const HELD = createHeldTool(rig, model, J, ramp6);   // TOOL: what his right fist holds besides the gun (the axe)
  const CL = J.clips || {};
  const HIDE = J.hide || {};   // pose -> pieces it hides (the lasso's coil packed away: the poses carry no scale)
  const EMOTES = (J.live || []).filter(c => CL[c] && !c.startsWith('cb_') && !c.startsWith('mv_') && !c.startsWith('ls_')), demos = [...DEMOS, ...EMOTES];   // (cb_*: combat, mv_*: MOTION, ls_*: LASSO)
  for (const c of Object.values(CL)) if (c.advance && !c.cum) { c.cum = [0]; c.advance.forEach((a, i) => c.cum.push(c.cum[i] + a)); }   // (render/atlas.js's)
  // the bones in depth-first order (a bone's subtree is the range [b, END[b])), those the poses carry
  const names = Object.keys(J.bones).filter(b => J.poses['idle.0']?.[b] || J.poses[Object.keys(J.poses)[0]][b]);
  const kids = {}; for (const b of names) { const p = J.bones[b].parent; (kids[p] ??= []).push(b); }
  const BN = []; (function dfs(p) { for (const b of kids[p] || []) { BN.push(b); dfs(b); } })(null);
  for (const b of names) if (!BN.includes(b)) BN.push(b);   // (a bone whose parent the poses lack: a root of its own)
  const NB = BN.length, IX = Object.fromEntries(BN.map((b, i) => [b, i]));
  const PI = Int16Array.from(BN.map(b => IX[J.bones[b].parent] ?? -1)), END = new Int16Array(NB);
  for (let i = NB - 1; i >= 0; i--) { END[i] = i + 1; for (let j = i + 1; j < NB; j++) { let q = PI[j]; while (q > i) q = PI[q]; if (q === i) END[i] = j + 1; else if (q < i) break; } }
  const LEN = Float64Array.from(BN.map(b => { const B = J.bones[b]; return Math.hypot(B.tail[0] - B.head[0], B.tail[1] - B.head[1], B.tail[2] - B.head[2]); }));
  const SEG = Int16Array.from(J.segs.map(s => IX[s.bone] ?? 0)), NS = J.segs.length;
  const HELD_O = (IX.RightHand ?? 0) * 7;   // (TOOL: the right hand's turn in the drawn pose: a carried tool hangs from it)
  // each piece's box size in its bone's frame (the export's min / max; else a bone-long rod) and whether it may smear
  const BOX = Float64Array.from(J.segs.flatMap(s => s.min && s.max ? [0, 1, 2].map(i => s.max[i] - s.min[i]) : [.1, LEN[IX[s.bone] ?? 0] || .1, .1]));
  const SMEARS = Uint8Array.from(J.segs, s => s.kind === 'hat' || s.kind === 'coil' ? 0 : 1);
  const B_ = n => IX[n] ?? -1;
  const HIPS = B_('Hips'), SPINE = B_('Spine'), SPINE1 = B_('Spine1'), SPINE2 = B_('Spine2'), HEAD = B_('Head'), GUN = B_('GunHold0'), HAND_R = B_('RightHand');
  const NECK = B_('Neck'), ARM_L = B_('LeftArm'), FOOT_L = B_('LeftFoot'), FOOT_R = B_('RightFoot');
  const ARM_R = B_('RightArm'), FARM_R = B_('RightForeArm'), HAND_L = B_('LeftHand'), UPLEG_L = B_('LeftUpLeg'), UPLEG_R = B_('RightUpLeg');
  const LEG_L = B_('LeftLeg'), LEG_R = B_('RightLeg'), TOE_L = B_('LeftToeBase'), TOE_R = B_('RightToeBase');
  const TB_PARTS = [GUN, HAND_R, HAND_L, HEAD, FOOT_L, FOOT_R].filter(b => b >= 0);
  // the muzzle in the gun's frame (GunMuzzle0 is a fixed child of GunHold0: rest^-1 x rest)
  const MZ = new Float64Array(3);
  if (J.bones.GunMuzzle0 && J.bones.GunHold0) {
    const r = J.bones.GunHold0.rest, h = J.bones.GunMuzzle0.head, d = [h[0] - r[3], h[1] - r[7], h[2] - r[11]];
    for (let k = 0; k < 3; k++) MZ[k] = r[k] * d[0] + r[4 + k] * d[1] + r[8 + k] * d[2];   // R^T d (the rest's rows are R's rows)
  }
  // each pose: the bones' WORLD transforms (body space: Blender axes, the feet at the origin facing -Y) and their LOCAL ones
  // (parent^-1 x world: what blends without the joints coming apart), made on first use
  const POSE = new Map(), QI = new Float64Array(4);
  function poseOf(name) {
    let p = POSE.get(name); if (p !== undefined) return p;
    const src = J.poses[name]; if (!src) { POSE.set(name, null); return null; }
    const w = new Float64Array(NB * 7), l = new Float64Array(NB * 7);
    for (let i = 0; i < NB; i++) { const v = src[BN[i]] || src.Hips; for (let k = 0; k < 7; k++) w[i * 7 + k] = v[k]; }
    toLocal(w, l);
    const h = HIDE[name], hide = h ? Uint8Array.from(J.segs, s => h.includes(s.bone) ? 1 : 0) : null;
    POSE.set(name, p = {w, l, name, hide});
    return p;
  }
  function toLocal(w, l) {
    for (let i = 0; i < NB; i++) {
      const o = i * 7, p = PI[i] * 7;
      if (PI[i] < 0) { for (let k = 0; k < 7; k++) l[o + k] = w[o + k]; continue; }
      QI[0] = -w[p]; QI[1] = -w[p + 1]; QI[2] = -w[p + 2]; QI[3] = w[p + 3];
      qmul(QI, 0, w, o, l, o);
      qrot(QI, 0, w[o + 4] - w[p + 4], w[o + 5] - w[p + 5], w[o + 6] - w[p + 6], l, o + 4);
    }
  }
  function fk(l, w) {   // local -> world, parents first
    for (let i = 0; i < NB; i++) {
      const o = i * 7, p = PI[i] * 7;
      if (PI[i] < 0) { for (let k = 0; k < 7; k++) w[o + k] = l[o + k]; continue; }
      qmul(w, p, l, o, w, o);
      qrot(w, p, l[o + 4], l[o + 5], l[o + 6], V3, 0);
      w[o + 4] = w[p + 4] + V3[0]; w[o + 5] = w[p + 5] + V3[1]; w[o + 6] = w[p + 6] + V3[2];
    }
  }
  function blendLocal(a, b, u, o) { for (let i = 0; i < NB; i++) { const k = i * 7; slerp(a, k, b, k, u, o, k); for (let j = 4; j < 7; j++) o[k + j] = a[k + j] + (b[k + j] - a[k + j]) * u; } }
  // a subtree [b, END[b]) turned by quaternion q about point c (body space)
  function turnTree(w, b, q, cx, cy, cz) {
    for (let i = b; i < END[b]; i++) {
      const o = i * 7; qmul(q, 0, w, o, w, o);
      qrot(q, 0, w[o + 4] - cx, w[o + 5] - cy, w[o + 6] - cz, V3, 0);
      w[o + 4] = cx + V3[0]; w[o + 5] = cy + V3[1]; w[o + 6] = cz + V3[2];
    }
  }
  const gunNear = w => Math.hypot(w[GUN * 7 + 4] - w[HAND_R * 7 + 4], w[GUN * 7 + 5] - w[HAND_R * 7 + 5], w[GUN * 7 + 6] - w[HAND_R * 7 + 6]) < .15;

  // ---------------------------------------------------------------- state
  let on = true, t = 0;   // (K: the knobs, shared by the bodies: createLiveHero)
  const Ll = new Float64Array(NB * 7), Lfrom = new Float64Array(NB * 7), Ltmp = new Float64Array(NB * 7);
  const Wb = new Float64Array(NB * 7), Wshow = new Float64Array(NB * 7), Wt = new Float64Array(NB * 7);
  let clipNow = '', frameNow = '', frameT = 0, fadeT = 1, haveShow = false;
  let wf = NaN, twist = 0, twistShown = NaN, demoA = NaN, stepK = -1, sampT = 0, lastT = -1, aimPhi = NaN, aimBase = '';
  let twistHeld = NaN, aimOn = false, aimX = 0, aimV = 0, aimShow = 0, aimVShow = 0, aimSpringPhi = 0;   // (FLOW: the aim's spring, world angle)
  let rc = null, rcT = 0, rcK = 1, rcN = -1, accX = 0, accY = 0, lvx = NaN, lvy = 0;   // (FLOW: the kick, the smoothed acceleration)
  let fadeDur = FADE;   // (the cross-fade now: a clip change's, or COMBAT.fade for a stance's)
  // TRANSITIONS: what was drawn last (its clip, layer, the upper body's clip, aiming, the facing) and its pose as locals in
  // his frame turned by the facing; the blend from it
  const LW = new Float64Array(NB * 7), TBF = new Float64Array(NB * 7), LTB = new Float64Array(NB * 7), WTB = new Float64Array(NB * 7);
  let tbClip = '', tbLayer = '', tbUp = '', tbAim = false, tbPhi = NaN, tbT = 1, tbDur = 1, tbHave = false;
  const TBP = new Float64Array(3 * 8), TBQ = new Float64Array(3 * 8);
  let tbGun = NaN;   // (the drawn barrel's heading in the world, last frame: NaN with the gun not in his hand)   // (the parts whose travel sets the blend's length; where they were drawn, turned)
  const MATS = new Float32Array(24 * 12), PR = {x: 0, y: 0, z: 0, k: K_UP, alpha: 1, flash: 0, pitch: 20 * DEG, sx: 0, sy: 0, sz: 0, snap: 1, type: 4};
  const TIPS = new Float64Array(NB * 4), TIPS2 = new Float64Array(NB * 4), PREV = new Float64Array(NB * 3), SC = [0, 0, 0];
  let prevOk = false;
  const stats = {held: 0, frames: 0, smears: 0, smearK: 0, ms: 0, msRender: 0, cb: ''};   // (cb: the combat stance / draw now)
  const aim = {ok: false, mx: 0, my: 0, a: 0};   // the drawn gun on screen (view px): the muzzle, the barrel's angle (the meter's aim error)
  // the pose drawn this frame (body space, BN order, 7 a bone) and where: the world's x, height, z of his anchor and his facing
  // (render world: x' = cos phi x - sin phi y + x, h' = z + h, z' = -sin phi x - cos phi y + z). Read by the movement meters
  // (feet on the ground, slide); n counts the frames drawn
  const DRAWN = {w: null, phi: 0, x: 0, h: 0, z: 0, n: 0};
  // THROWN (view/herorag.js): while a blast throws him (P.state launch / down / getup) his pose is a ragdoll's, pinned to the sim's body
  const HR = createHeroRag({app, G, rig, model, J, BN, PI, toLocal, fk, blendLocal, poseOf, K}); HR.warm();

  // ---------------------------------------------------------------- which pose: the frame, its clip, the next frame, the fraction
  const NAME = {}, nm = (pre, i) => (NAME[pre] ??= [])[i] ??= pre + i;
  const LOCO = /^(g[wr][sr]|g[wr]r|[wr]s)_([a-z0-9]+)_(\d)$/;
  const parsed = new Map();   // frame name -> {clip, i, pre, tw, loco: 'walk' | 'run' | null}
  function parse(f) {
    let p = parsed.get(f); if (p) return p;
    const m = LOCO.exec(f), d = f.lastIndexOf('.');
    if (m) p = {clip: m[1] + '_' + m[2], i: +m[3], pre: m[1] + '_' + m[2] + '_', tw: m[2], fam: m[1], loco: m[1][1] === 'r' || m[1] === 'rs' ? 'run' : 'walk'};
    else if (d > 0 && CL[f.slice(0, d)]) p = {clip: f.slice(0, d), i: +f.slice(d + 1), pre: f.slice(0, d + 1), tw: '', fam: '', loco: ['walk', 'run', 'sprint', 'drive'].includes(f.slice(0, d)) ? f.slice(0, d) : null};
    else p = {clip: f, i: 0, pre: '', tw: '', fam: '', loco: null};
    parsed.set(f, p); return p;
  }
  // the fraction toward the clip's next frame: by the phase (locomotion: P.ph x stride over the clip's frame advances) or by
  // the time this frame has shown (its step: ms / fps); -> [next name | null, u]
  const NX = {name: '', u: 0};
  function next(p, P, f) {
    NX.name = ''; NX.u = 0;
    if (p.loco) {
      const C = CL[p.loco]; if (!C || !C.cum) return NX;
      const at = ((P.ph % 1) + 1) % 1 * C.stride, i = p.i, a = C.cum[i], b = C.cum[i + 1] ?? C.stride;
      NX.u = Math.max(0, Math.min(1, (at - a) / ((b - a) || 1))); NX.name = nm(p.pre, (i + 1) % C.frames);
      return NX;
    }
    const C = CL[p.clip]; if (!C) return NX;
    const play = C.play, n = play ? play.length : C.frames;
    let s = play ? play.indexOf(p.i) : p.i; if (s < 0) s = 0;
    const dur = C.ms ? C.ms[s] / 1000 : 1 / C.fps, s2 = s + 1 < n ? s + 1 : C.loop ? 0 : -1;
    if (s2 < 0) return NX;
    NX.name = nm(p.pre, play ? play[s2] : s2); NX.u = Math.min(1, frameT / dur);
    return NX;
  }

  // ---------------------------------------------------------------- the procedural layers (body space, in Wt)
  // the cursor on screen (view px)
  const CUR = new Float64Array(2);
  function cursor() { const z = app.zoom || 1; CUR[0] = G.VW / 2 + (mouse.x - G.VW / 2) * z; CUR[1] = G.VH / 2 + (mouse.y - G.VH / 2) * z; return CUR; }
  // the gun's heading (rad about +Z from -Y) and its muzzle, in w
  const MUZ = new Float64Array(3);
  function barrel(w) {
    const o = GUN * 7; qrot(w, o, MZ[0], MZ[1], MZ[2], V3, 0);
    MUZ[0] = w[o + 4] + V3[0]; MUZ[1] = w[o + 5] + V3[1]; MUZ[2] = w[o + 6] + V3[2];
    return Math.atan2(V3[0], -V3[1]);
  }
  // the spine twist (_TWIST's split: .4 / .3 / .3 over Spine, Spine1, Spine2, about the vertical through each)
  const TWB = Int16Array.of(SPINE, SPINE1, SPINE2), TWF = Float64Array.of(.4, .3, .3);
  function spineTwist(w, d) {
    for (let k = 0; k < 3; k++) { const b = TWB[k]; if (b < 0) continue; axisAngle(0, 0, 1, d * TWF[k], R4); turnTree(w, b, R4, w[b * 7 + 4], w[b * 7 + 5], w[b * 7 + 6]); }
  }
  // AIMING BY WHAT YOU SEE (as the sim picks the sprites' twists, sim/player/gun.js aimErr): the twist that puts the barrel's
  // SCREEN direction (the body squashed as the sprite camera saw it) on the line from the muzzle to the cursor. A secant
  // search on the screen-angle error, from the last answer (4 passes: the muzzle orbits the spine as it turns)
  const TW_TMP = new Float64Array(NB * 7), SO = [0, 0, 0];
  function screenErr(w, d) {
    TW_TMP.set(w); spineTwist(TW_TMP, d); barrel(TW_TMP);
    const o = GUN * 7; screenOf(MUZ[0], MUZ[1], MUZ[2], SC); const mx = SC[0], my = SC[1];
    screenOf(TW_TMP[o + 4], TW_TMP[o + 5], TW_TMP[o + 6], SO);
    return wrap(Math.atan2(CUR[1] - my, CUR[0] - mx) - Math.atan2(my - SO[1], mx - SO[0]));
  }
  // Robust (the TRANSITIONS work): when the last answer is far off (a new pose, the cursor swung) a coarse look over the
  // whole range first, each candidate's error plus a little for straying from the last answer (AIM.stick: where the barrel
  // points into the screen, side-on, many twists look alike on screen and the bare secant hopped between them, -5 / -23 /
  // +3 / +15 deg with the cursor still); then the secant. An answer already within AIM.keep is kept unless a better one is
  // near (no swing of more than AIM.jump for a degree or two)
  const AIM = {coarse: 12 * DEG, steps: 10, stick: .12, tol: .5 * DEG, keep: 4 * DEG, jump: 20 * DEG, gain: 3 * DEG};
  function aimTwist(w, d0, LIM = 110 * DEG) {
    cursor();
    const c0 = d0 === d0 ? Math.max(-LIM, Math.min(LIM, d0)) : 0, e0 = screenErr(w, c0);
    let a = c0, ea = e0;
    if (Math.abs(e0) > AIM.coarse) {
      let best = Math.abs(e0);
      for (let k = 0; k <= AIM.steps; k++) {
        const x = -LIM + 2 * LIM * k / AIM.steps, e = screenErr(w, x), c = Math.abs(e) + AIM.stick * Math.abs(x - c0);
        if (c < best) { best = c; a = x; ea = e; }
      }
    }
    let b = Math.max(-LIM, Math.min(LIM, a + (ea > 0 ? -1 : 1) * 8 * DEG)), eb = screenErr(w, b);
    for (let it = 0; it < 5 && Math.abs(eb) > AIM.tol; it++) {
      const den = eb - ea; let c = Math.abs(den) < 1e-6 ? b + 6 * DEG : b - eb * (b - a) / den;
      c = Math.max(-LIM, Math.min(LIM, c)); a = b; ea = eb; b = c; eb = screenErr(w, b);
    }
    const r = Math.abs(eb) <= Math.abs(ea) ? b : a, er = Math.min(Math.abs(eb), Math.abs(ea));
    if (Math.abs(e0) < AIM.keep && Math.abs(r - c0) > AIM.jump) return c0;   // (good enough: no long swing for a degree or two)
    return er < Math.abs(e0) - AIM.gain || Math.abs(r - c0) < 2 * DEG ? r : c0;   // (it moves for a clear gain only)
  }
  // hysteresis: v follows target only when it moved more than K.hyst degrees (0: always)
  const hystOf = (shown, target) => !(shown === shown) || !K.hyst || Math.abs(wrap(target - shown)) > K.hyst * DEG ? target : shown;
  // two-bone IK: the right wrist onto body-space point T, the elbow bending in the plane it bends in now
  function ikRight(w, Tx, Ty, Tz) {
    const s = ARM_R * 7, e = FARM_R * 7, h = HAND_R * 7;
    const Sx = w[s + 4], Sy = w[s + 5], Sz = w[s + 6], L1 = LEN[ARM_R], L2 = LEN[FARM_R];
    let dx = Tx - Sx, dy = Ty - Sy, dz = Tz - Sz; const d0 = Math.hypot(dx, dy, dz) || 1e-6, d = Math.max(Math.abs(L1 - L2) + 1e-3, Math.min(L1 + L2 - 1e-3, d0));
    dx /= d0; dy /= d0; dz /= d0;
    let px = w[e + 4] - Sx, py = w[e + 5] - Sy, pz = w[e + 6] - Sz; const pd = px * dx + py * dy + pz * dz;   // the pole: the elbow now
    px -= dx * pd; py -= dy * pd; pz -= dz * pd; let pl = Math.hypot(px, py, pz);
    if (pl < 1e-4) { px = 0; py = 1; pz = -.3; pl = Math.hypot(py, pz); }   // (straight: the elbow back and down)
    px /= pl; py /= pl; pz /= pl;
    const ca = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))), sa = Math.sqrt(1 - ca * ca);
    const Ex = Sx + L1 * (dx * ca + px * sa), Ey = Sy + L1 * (dy * ca + py * sa), Ez = Sz + L1 * (dz * ca + pz * sa);
    fromTo(w[e + 4] - Sx, w[e + 5] - Sy, w[e + 6] - Sz, Ex - Sx, Ey - Sy, Ez - Sz, R4); turnTree(w, ARM_R, R4, Sx, Sy, Sz);
    const Wx = Sx + dx * d, Wy = Sy + dy * d, Wz = Sz + dz * d;
    fromTo(w[h + 4] - w[e + 4], w[h + 5] - w[e + 5], w[h + 6] - w[e + 6], Wx - w[e + 4], Wy - w[e + 5], Wz - w[e + 6], R4); turnTree(w, FARM_R, R4, w[e + 4], w[e + 5], w[e + 6]);
  }
  // two-bone IK on a leg: bone a's head (the hip) stays, b's head (the knee) bends in the plane it bends in now (straight: toward
  // -y, his front), c's head (the ankle) onto body-space point T; c's subtree keeps the world rotation it had (the foot as posed)
  const QC = new Float64Array(4), QD = new Float64Array(4);
  function ikLeg(w, a, b, c, Tx, Ty, Tz) {
    const s = a * 7, e = b * 7, h = c * 7, Sx = w[s + 4], Sy = w[s + 5], Sz = w[s + 6];
    const L1 = Math.hypot(w[e + 4] - Sx, w[e + 5] - Sy, w[e + 6] - Sz), L2 = Math.hypot(w[h + 4] - w[e + 4], w[h + 5] - w[e + 5], w[h + 6] - w[e + 6]);
    QC[0] = w[h]; QC[1] = w[h + 1]; QC[2] = w[h + 2]; QC[3] = w[h + 3];
    let dx = Tx - Sx, dy = Ty - Sy, dz = Tz - Sz; const d0 = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, d = Math.max(Math.abs(L1 - L2) + 1e-3, Math.min(L1 + L2 - 1e-4, d0));
    dx /= d0; dy /= d0; dz /= d0;
    let px = w[e + 4] - Sx, py = w[e + 5] - Sy, pz = w[e + 6] - Sz; const pd = px * dx + py * dy + pz * dz;   // the pole: the knee now
    px -= dx * pd; py -= dy * pd; pz -= dz * pd; let pl = Math.sqrt(px * px + py * py + pz * pz);
    if (pl < 1e-4) { px = 0; py = -1; pz = 0; const k = py * dy; px -= dx * k; py -= dy * k; pz -= dz * k; pl = Math.sqrt(px * px + py * py + pz * pz) || 1; }
    px /= pl; py /= pl; pz /= pl;
    const ca = Math.max(-1, Math.min(1, (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d))), sa = Math.sqrt(1 - ca * ca);
    const Ex = Sx + L1 * (dx * ca + px * sa), Ey = Sy + L1 * (dy * ca + py * sa), Ez = Sz + L1 * (dz * ca + pz * sa);
    fromTo(w[e + 4] - Sx, w[e + 5] - Sy, w[e + 6] - Sz, Ex - Sx, Ey - Sy, Ez - Sz, R4); turnTree(w, a, R4, Sx, Sy, Sz);
    const Wx = Sx + dx * d, Wy = Sy + dy * d, Wz = Sz + dz * d;
    fromTo(w[h + 4] - w[e + 4], w[h + 5] - w[e + 5], w[h + 6] - w[e + 6], Wx - w[e + 4], Wy - w[e + 5], Wz - w[e + 6], R4); turnTree(w, b, R4, w[e + 4], w[e + 5], w[e + 6]);
    QI[0] = -w[h]; QI[1] = -w[h + 1]; QI[2] = -w[h + 2]; QI[3] = w[h + 3]; qmul(QC, 0, QI, 0, QD, 0); turnTree(w, c, QD, w[h + 4], w[h + 5], w[h + 6]);
  }
  // FEET ON THE GROUND (K.feet): the atlas's poses stand on flat ground, and he is drawn at the ground's height under his
  // anchor, so on a slope, a step or the stairs one foot sinks in and the other floats. Each foot follows the ground under it
  // instead (the middle of its ankle and ball, by the drawn facing and anchor): the body goes down by the lower foot's ground
  // (relative to the anchor's; up by the higher if both are higher) and the other leg bends to its own (ikLeg), the swing foot
  // as high over its ground as the pose has it. A foot whose ground is more than FEET.reach off (over a drop, in a rock face) is
  // left as posed. On while he's on his feet (FEET_ON), eased in and out over FEET.fade s (a landing, a roll's end)
  // A foot on the ground (lifted less than FEET.tilt m over where it stands in idle.0) also tilts with the ground's slope under
  // it (at most FEET.slope; none across a step's edge, where the ground under it isn't a plane), less the higher it is lifted
  const FEET = {reach: .4, drop: .4, fade: .1, tilt: .06, slope: .6, e: .1};
  const FEET_ON = new Set(['idle', 'move', 'draw', 'release', 'pose', 'land', 'knock', 'hold', 'backstep', 'slide']);
  const FT = Int16Array.of(FOOT_L, FOOT_R), FB = Int16Array.of(TOE_L, TOE_R), FU = Int16Array.of(UPLEG_L, UPLEG_R), FL = Int16Array.of(LEG_L, LEG_R);
  const FD = new Float64Array(2), FG = new Float64Array(4), FW = new Float64Array(2), F0 = new Float64Array(4);   // (per foot: offset, slope in body x / y, tilt weight; idle.0's ankle and ball heights)
  const FEET_OK = FOOT_L >= 0 && FOOT_R >= 0 && TOE_L >= 0 && TOE_R >= 0 && UPLEG_L >= 0 && UPLEG_R >= 0 && LEG_L >= 0 && LEG_R >= 0;
  let feetK = 0, f0 = false;
  function feet(w, P, dt) {
    const want = K.feet && FEET_ON.has(P.state) && !P.sink ? 1 : 0;
    feetK = dt > 0 ? (want > feetK ? Math.min(want, feetK + dt / FEET.fade) : Math.max(want, feetK - dt / FEET.fade)) : want;
    stats.drop = 0; if (feetK <= 0 || !FEET_OK) return;
    if (!f0) { const I = poseOf('idle.0'); if (!I) return; for (let k = 0; k < 2; k++) { F0[k * 2] = I.w[FT[k] * 7 + 6]; F0[k * 2 + 1] = I.w[FB[k] * 7 + 6]; } f0 = true; }
    let drop = 9;
    for (let k = 0; k < 2; k++) {
      const a = FT[k] * 7, b = FB[k] * 7, bx = (w[a + 4] + w[b + 4]) / 2, by = (w[a + 5] + w[b + 5]) / 2, X = fc * bx - fs * by + AX, Z = -fs * bx - fc * by + AZ;
      // the ground's slope there (world x, z -> his body x, y); not a plane (a step's edge under the foot): the foot rests on the
      // higher of the ground under its heel and its ball (a foot over a step's edge stands on the tread, not into the riser)
      const e0 = elev(X, Z), E = FEET.e, xp = elev(X + E, Z) - e0, xm = e0 - elev(X - E, Z), zp = elev(X, Z + E) - e0, zm = e0 - elev(X, Z - E);
      const plane = Math.abs(xp - xm) <= .02 && Math.abs(zp - zm) <= .02;
      const g = (plane ? e0 : Math.max(elev(fc * w[a + 4] - fs * w[a + 5] + AX, -fs * w[a + 4] - fc * w[a + 5] + AZ),
        elev(fc * w[b + 4] - fs * w[b + 5] + AX, -fs * w[b + 4] - fc * w[b + 5] + AZ))) - AY, out = Math.abs(g) > FEET.reach;
      FD[k] = out ? 0 : g * feetK; if (FD[k] < drop) drop = FD[k];
      const lift = Math.max(0, Math.min(w[a + 6] - F0[k * 2], w[b + 6] - F0[k * 2 + 1]));   // (how much of the slope the foot takes)
      FW[k] = out || !plane ? 0 : Math.max(0, 1 - lift / FEET.tilt) * feetK;
      const gx = (xp + xm) / (2 * E), gz = (zp + zm) / (2 * E);
      FG[k * 2] = Math.max(-FEET.slope, Math.min(FEET.slope, gx * fc - gz * fs)); FG[k * 2 + 1] = Math.max(-FEET.slope, Math.min(FEET.slope, -gx * fs - gz * fc));
    }
    drop = Math.max(-FEET.drop, Math.min(FEET.drop, drop));
    if (drop !== 0) for (let i = 0; i < NB; i++) w[i * 7 + 6] += drop;
    for (let k = 0; k < 2; k++) {
      const dz = FD[k] - drop, a = FT[k] * 7;
      if (dz > 1e-4) ikLeg(w, FU[k], FL[k], FT[k], w[a + 4], w[a + 5], w[a + 6] + dz);
      const sx = FG[k * 2] * FW[k], sy = FG[k * 2 + 1] * FW[k];   // (the foot turned from level onto the slope, about the ankle)
      if (sx * sx + sy * sy > 4e-4) { fromTo(0, 0, 1, -sx, -sy, 1, R4); turnTree(w, FT[k], R4, w[a + 4], w[a + 5], w[a + 6]); }
    }
    stats.drop = drop;
  }
  // the reload's frame for the gun's phase + progress (sim/player/gun.js reloadFrame, as a fraction for the smooth path)
  function reloadAt(S) {
    const C = CL.gun_reload, M = C && C.marks, k = S.reloadK; if (!M) return 0;
    let a, b, back = false;
    switch (S.rph) {
      case 'up': a = M.up; b = M.eject - 1; break;
      case 'eject': a = M.eject; b = M.first - 1; break;
      case 'fetch': if (S.rfirst) { a = M.first; b = M.fetch; } else { a = M.fetch; b = M.load - 1; back = true; } break;
      case 'load': a = M.fetch + 1; b = M.load; break;
      default: a = M.close; b = C.frames - 1;
    }
    const x = Math.min(b - a, k * (b - a + 1));
    return back ? b - x : a + x;
  }
  // ---- the demos: the lasso spun overhead (IK hand + the rope's loop), hanging from a rope and swinging
  const LASSO = {r: .17, up: .28, side: -.12, fwd: .05, hz: 1.4, loop: .72, n: 14}, SWING = {amp: 32 * DEG, rope: 1.25, lift: .45, lag: .35};
  const ROPE = new Float64Array(3 * 18), ROPE_C = [.79, .64, .42];
  let ropeN = 0;
  function lasso(w, tt) {
    const ang = tt * TAU * LASSO.hz, h = HEAD * 7;
    const cx = w[h + 4] + LASSO.side, cy = w[h + 5] - LASSO.fwd, cz = w[h + 6] + LASSO.up + .1;
    const Tx = cx + LASSO.r * Math.cos(ang), Ty = cy + LASSO.r * Math.sin(ang), Tz = cz;
    ikRight(w, Tx, Ty, Tz);
    // the loop: a ring round the hand's circle's centre, the hand on it (the honda), plus the spoke
    // (a lasso's loop: its centre across the hand's circle from the hand, so the loop passes through the hand and swings round with it)
    const n = LASSO.n, o = HAND_R * 7, hx = w[o + 4], hy = w[o + 5], hz = w[o + 6] + .03;
    const lx = cx - (LASSO.loop - LASSO.r) * Math.cos(ang), ly = cy - (LASSO.loop - LASSO.r) * Math.sin(ang), lz = cz + .06;
    for (let i = 0; i <= n; i++) {
      const a = ang + i / n * TAU, e = i === 0 || i === n;
      ROPE[i * 3] = e ? hx : lx + LASSO.loop * Math.cos(a); ROPE[i * 3 + 1] = e ? hy : ly + LASSO.loop * Math.sin(a); ROPE[i * 3 + 2] = e ? hz : lz + .05 * Math.sin(a);
    }
    ropeN = n + 1;
  }
  function swing(w, th, dth) {
    const l = HAND_L * 7, r = HAND_R * 7;
    const px = (w[l + 4] + w[r + 4]) / 2, py = (w[l + 5] + w[r + 5]) / 2, pz = (w[l + 6] + w[r + 6]) / 2 + SWING.rope;
    for (let k = 0; k < 2; k++) { const b = k ? UPLEG_R : UPLEG_L; if (b >= 0) { axisAngle(0, 1, 0, -dth * SWING.lag, R4); turnTree(w, b, R4, w[b * 7 + 4], w[b * 7 + 5], w[b * 7 + 6]); } }   // the legs trail
    axisAngle(0, 1, 0, th, R4);
    for (let i = 0; i < NB; i++) if (PI[i] < 0) turnTree(w, i, R4, px, py, pz);   // the whole body about the rope's top
    for (let i = 0; i < NB; i++) w[i * 7 + 6] += SWING.lift;
    ROPE[0] = px; ROPE[1] = py; ROPE[2] = pz + SWING.lift;
    ROPE[3] = (w[l + 4] + w[r + 4]) / 2; ROPE[4] = (w[l + 5] + w[r + 5]) / 2; ROPE[5] = (w[l + 6] + w[r + 6]) / 2 + .05;
    ropeN = 2;
  }

  // ---------------------------------------------------------------- TRANSITIONS: his pose in his frame turned by the facing
  // w (his body space) -> locals with the roots turned by phi about the vertical (the children's locals don't change)
  const QZ = new Float64Array(4);
  function toLocalTurned(w, phi, out) {
    toLocal(w, out); axisAngle(0, 0, 1, phi, QZ);
    for (let i = 0; i < NB; i++) {
      if (PI[i] >= 0) continue;
      const o = i * 7; qmul(QZ, 0, out, o, out, o); qrot(QZ, 0, out[o + 4], out[o + 5], out[o + 6], V3, 0); out[o + 4] = V3[0]; out[o + 5] = V3[1]; out[o + 6] = V3[2];
    }
  }
  // the TB_PARTS of w turned by phi -> out (x, y, z each); -> the most any moved from `prev` (m), if given
  function turnedParts(w, phi, out, prev) {
    const c = Math.cos(phi), s = Math.sin(phi); let d = 0;
    for (let k = 0; k < TB_PARTS.length; k++) {
      const o = TB_PARTS[k] * 7, x = c * w[o + 4] - s * w[o + 5], y = s * w[o + 4] + c * w[o + 5], z = w[o + 6];
      if (prev) d = Math.max(d, Math.hypot(x - prev[k * 3], y - prev[k * 3 + 1], z - prev[k * 3 + 2]));
      out[k * 3] = x; out[k * 3 + 1] = y; out[k * 3 + 2] = z;
    }
    return d;
  }
  // a turned pose (world-like, after FK) back into his body space at the facing phi
  function unturn(w, phi) {
    axisAngle(0, 0, 1, -phi, QZ);
    for (let i = 0; i < NB; i++) { const o = i * 7; qmul(QZ, 0, w, o, w, o); qrot(QZ, 0, w[o + 4], w[o + 5], w[o + 6], V3, 0); w[o + 4] = V3[0]; w[o + 5] = V3[1]; w[o + 6] = V3[2]; }
  }

  // ---------------------------------------------------------------- FLOW (K.flow): gunplay that moves (body space, in w)
  // the aim as a WORLD angle (the facing + the twist) springs toward the held one, so legs that re-plant or turn don't jolt
  // it; stepped: what shows is the spring at the procedural ticks. -> the twist to draw
  function aimFlow(phi, tw, dt, sample, restart) {
    const target = phi + tw;
    if (!aimOn || restart) { aimOn = true; aimX = aimShow = target; aimV = aimVShow = 0; return tw; }   // (a switch: the blend carries it)
    const n = Math.max(1, Math.ceil(dt / .008)), h = dt / n, W2 = FLOW.w * FLOW.w, Z2 = 2 * FLOW.z * FLOW.w;
    for (let i = 0; i < n; i++) { aimV += (W2 * wrap(target - aimX) - Z2 * aimV) * h; aimX += aimV * h; }
    if (Math.abs(wrap(target - aimX)) < .4 * DEG && Math.abs(aimV) < .3) { aimX = target; aimV = 0; }   // (settled: on it, still)
    if (!K.step || sample) { aimShow = aimX; aimVShow = aimV; }
    return wrap(aimShow - phi);
  }
  // the head ahead of the chest (lag: the held twist - the shown one), the gun arm trailing the swing (its speed)
  function lead(w, lag) {
    const a = Math.max(-FLOW.headMax, Math.min(FLOW.headMax, lag * FLOW.head / DEG)) * DEG;
    if (NECK >= 0 && Math.abs(a) > .5 * DEG) { axisAngle(0, 0, 1, a, R4); turnTree(w, NECK, R4, w[NECK * 7 + 4], w[NECK * 7 + 5], w[NECK * 7 + 6]); }
    const d = Math.max(-FLOW.dragMax, Math.min(FLOW.dragMax, -aimVShow * FLOW.drag / DEG)) * DEG;
    if (ARM_R >= 0 && Math.abs(d) > .5 * DEG) { axisAngle(0, 0, 1, d, R4); turnTree(w, ARM_R, R4, w[ARM_R * 7 + 4], w[ARM_R * 7 + 5], w[ARM_R * 7 + 6]); }
  }
  // the free (left) arm on the move: swung against the left leg (its foot forward: the arm back), about the chest's side
  function pump(w, run) {
    if (ARM_L < 0 || FOOT_L < 0 || FOOT_R < 0 || SPINE2 < 0) return;
    const s = (w[FOOT_L * 7 + 5] - w[FOOT_R * 7 + 5]) / FLOW.stride, a = -Math.max(-1, Math.min(1, s)) * (run ? FLOW.pump.run : FLOW.pump.walk) * DEG;
    if (Math.abs(a) < .5 * DEG) return;
    qrot(w, SPINE2 * 7, 1, 0, 0, V3, 0); axisAngle(V3[0], V3[1], V3[2], a, R4);
    turnTree(w, ARM_L, R4, w[ARM_L * 7 + 4], w[ARM_L * 7 + 5], w[ARM_L * 7 + 6]);
  }
  // the chest leans into his acceleration (smoothed): sideways into a strafe's change, forward as he sets off. P's velocity
  // is in the view's frame (his facing there: phiV = his facing - the yaw); a turn of the camera turns it too: that frame skipped
  let lyaw = NaN;
  function lean(w, P, dt, phiV, yaw) {
    const vx = P.vx || 0, vy = P.vy || 0;
    if (!(lvx === lvx) || yaw !== lyaw || dt <= 0) { lvx = vx; lvy = vy; lyaw = yaw; return; }
    const k = 1 - Math.exp(-dt / FLOW.lean.tau); accX += ((vx - lvx) / dt - accX) * k; accY += ((vy - lvy) / dt - accY) * k; lvx = vx; lvy = vy;
    const c = Math.cos(phiV), s = Math.sin(phiV), bx = c * accX - s * accY, by = -s * accX - c * accY, M = FLOW.lean.max;   // (into his frame)
    const roll = Math.max(-M, Math.min(M, bx * FLOW.lean.k)), pitch = Math.max(-M, Math.min(M, -by * FLOW.lean.k));
    if (SPINE < 0 || (Math.abs(roll) < .5 && Math.abs(pitch) < .5)) return;
    const o = SPINE * 7;
    axisAngle(0, 1, 0, roll * DEG, R4); turnTree(w, SPINE, R4, w[o + 4], w[o + 5], w[o + 6]);    // (top toward +x: his left)
    axisAngle(1, 0, 0, pitch * DEG, R4); turnTree(w, SPINE, R4, w[o + 4], w[o + 5], w[o + 6]);   // (top toward -y: ahead)
  }
  // a shot (the sim's count went up): a kick drawn from RECOIL. Its shape: up to the peak in the first 18 %, eased out;
  // about the barrel's side axis (d x up: + lifts the barrel and tips the chest and the head back), stepped at kickHz
  function startKick(S) {
    let r = Math.random() * RECOIL_W, i = 0; while (i < RECOIL.length - 1 && (r -= RECOIL[i].w) > 0) i++;
    rc = RECOIL[i]; rcT = 0;
    rcK = (.85 + .3 * Math.random()) * (LOADOUTS[hero.loadI]?.[2] === 'brass_navy' ? 1.25 : 1) * (S.lastHow === 'fan' ? .5 : 1);
  }
  function kick(w, dt) {
    const S = app.PL.gun?.S;
    if (S) { if (rcN >= 0 && S.shotN > rcN) startKick(S); rcN = S.shotN; }
    if (!rc) return;
    rcT += dt; if (rcT >= rc.dur) { rc = null; return; }
    if (GUN < 0 || !gunNear(w)) return;
    const tq = K.step ? Math.floor(rcT * FLOW.kickHz) / FLOW.kickHz : rcT, u = tq / rc.dur, e = (u < .18 ? u / .18 : ((1 - u) / .82) ** 2) * rcK;
    barrel(w); const l = Math.hypot(V3[0], V3[1]); if (l < 1e-4) return;
    const ax = V3[1] / l, ay = -V3[0] / l;
    if (SPINE >= 0 && rc.chest) { const o = SPINE * 7; axisAngle(ax, ay, 0, rc.chest * e * DEG, R4); turnTree(w, SPINE, R4, w[o + 4], w[o + 5], w[o + 6]); }
    if (ARM_R >= 0 && rc.arm) { const o = ARM_R * 7; axisAngle(ax, ay, 0, rc.arm * e * DEG, R4); turnTree(w, ARM_R, R4, w[o + 4], w[o + 5], w[o + 6]); }
    if (rc.wrist) { const o = GUN * 7; axisAngle(ax, ay, 0, rc.wrist * e * DEG, R4); turnTree(w, GUN, R4, w[o + 4], w[o + 5], w[o + 6]); }
    if (NECK >= 0 && rc.head) { const o = NECK * 7; axisAngle(ax, ay, 0, rc.head * e * DEG, R4); turnTree(w, NECK, R4, w[o + 4], w[o + 5], w[o + 6]); }
  }

  // ---------------------------------------------------------------- COMBAT STYLE (K.flow and the cb_* clips)
  const CBS = Object.keys(COMBAT.w).filter(k => CL['cb_st_' + k]), CB = CBS.length ? {} : null;
  let cbSt = '', cbDraw = '', cbT = 0, cbStill = 0, cbN = 0, cbMove = false, cbDist = 5;
  const SCR = {x: 0, y: 0, ppm: 0};   // (his anchor on screen and px a metre there: the last frame's, for the target's distance)
  function cbPick(avoid) {
    const band = cbDist < COMBAT.near ? 0 : cbDist > COMBAT.far ? 2 : 1;
    let sum = 0; for (const k of CBS) if (k !== avoid) sum += COMBAT.w[k][band];
    let r = Math.random() * sum;
    for (const k of CBS) { if (k === avoid) continue; r -= COMBAT.w[k][band]; if (r <= 0) return k; }
    return CBS.includes('aim') ? 'aim' : CBS[0];
  }
  const cbMovePick = () => { const m = COMBAT.move.filter(k => CBS.includes(k)); return m[Math.floor(Math.random() * m.length)] || 'aim'; };
  // the stance's frame now (its breath looped) / the draw's frame by the sim's draw progress
  const cbFrame = st => { const C = CL['cb_st_' + st]; return nm('cb_st_' + st + '.', Math.floor(t * C.fps) % C.frames); };
  function drawFrame() {
    const C = CL[cbDraw], G0 = CL.gun_draw, w = WEAPONS[LOADOUTS[hero.loadI]?.[2]];
    const total = (G0 ? G0.frames / G0.fps : .25) / (w?.draw || 1), u = Math.min(1, cbT / total);
    return nm(cbDraw + '.', Math.min(C.frames - 1, Math.floor(u * C.frames)));
  }
  // -> null (the sim's frame as it is) or {base: the pose to draw instead, aim: aimed by the twist, upper: a pose whose upper
  // body goes over the gait's legs (on the move), key: the cross-fade's identity}
  const CBR = {base: '', aim: false, upper: '', key: ''};
  function combat(f, p, P, S, dt) {
    if (!CB || !S) return null;
    const out = S.out || S.act === 'draw' || S.act === 'hip';
    if (!out || S.act === 'turn' || S.act === 'whip') { if (!out) cbSt = stats.cb = ''; return null; }
    const moving = !!p.loco;   // (any gait frame: aiming on it, reloading on it)
    if (!cbSt) {   // the gun coming out: a stance for how far he is and whether he moves, and a draw into it
      cursor(); const D = SCR.ppm > 0 ? Math.hypot(CUR[0] - SCR.x, CUR[1] - SCR.y) / SCR.ppm : 5; cbDist = D;
      cbSt = moving ? cbMovePick() : cbPick(''); cbMove = moving; cbStill = 0; cbN = S.shotN; cbT = 0;
      const ds = (COMBAT.draws[cbSt] || ['']).filter(d => !d || CL[d]); cbDraw = S.act === 'draw' ? ds[Math.floor(Math.random() * ds.length)] || '' : '';
    }
    if (S.act === 'draw') cbT += dt; else cbDraw = '';
    // the fight goes on: he sets off (a standing stance gives way to one for the move), stops (a standing one comes back
    // after COMBAT.settle s), a shot from the 2nd after a pick may change it
    if (moving) { cbStill = 0; if (!COMBAT.move.includes(cbSt)) cbSt = cbMovePick(); cbMove = true; }
    else if (cbMove) { cbStill += dt; if (cbStill > COMBAT.settle) { cbMove = false; cbSt = cbPick(''); cbN = S.shotN; } }
    if (S.shotN !== cbN && !moving) {
      if (S.shotN - cbN >= 2 && Math.random() < COMBAT.shift) { cbSt = cbPick(cbSt); cbN = S.shotN; }
      else if (S.shotN < cbN) cbN = S.shotN;
    }
    CBR.base = ''; CBR.aim = false; CBR.upper = ''; CBR.key = moving ? 'cb:' + cbSt + ':m' : 'cb:' + cbSt;   // (setting off / stopping: a fade too)
    stats.cb = S.act === 'draw' && cbDraw ? cbDraw : cbSt;
    if (S.act === 'draw' && !moving && cbDraw && f.startsWith('gun_draw')) { CBR.base = drawFrame(); CBR.key = 'cb:' + cbDraw; return CBR; }
    if (f.startsWith('gun_hipfire')) { if (CL.cb_st_hip) { CBR.base = cbFrame('hip'); CBR.aim = true; CBR.key = 'cb:hip'; return CBR; } return null; }
    if (!moving && (f.startsWith('gun_aim') || f.startsWith('gun_fire') || f.startsWith('gaim_'))) { CBR.base = cbFrame(cbSt); CBR.aim = true; return CBR; }
    if (!moving && f.startsWith('gun_reload') && cbSt !== 'aim') { CBR.base = cbFrame(cbSt); CBR.upper = f; return CBR; }   // (reloading IN the stance: its legs, the reload's hands)
    if (moving && cbSt !== 'aim' && CL['cb_st_' + cbSt] && (p.fam === 'gws' || p.fam === 'grs') && !XFAMS.has(p.tw)) { CBR.upper = cbFrame(cbSt); return CBR; }
    return moving ? CBR : null;   // (on the move with the aim: the gait's own twist-0 pose; the key keeps the fade quiet)
  }
  // the drawn muzzle (the world: arena x, y, height), for the shot's flash (host.playerMuzzle): the last drawn frame's
  const MW = {x: 0, y: 0, h: 0, ok: false};

  // ---------------------------------------------------------------- THE RUNTIME CLOTH (the duster's long panel)
  // set up the first time this loadout's atlas is there (hero.rig: the sprite path's ClothRig, its idx = the atlas's poses
  // .json, whose sim.cloths are the cloths' grids in their bones' frames): a ClothRig of our own on the same cloths; each
  // capsule's ends as offsets in its bone's frame, from the atlas's idle.0 capsules against the live model's idle.0 bones
  const CLO = {rig: null, D: null, tried: false, sim: null, capB: null, capL: null, matB: null, hip: -1, cn: 0, g: [0, 0], lx: NaN, ly: 0, lyaw: NaN};
  function clothSetup() {
    const R0 = hero.rig, idx = R0?.idx;
    if (!R0?.active || !idx || idx.model !== J.meta.loadout) return;   // (another loadout's atlas still: try again next frame)
    CLO.tried = true;
    const ref = hero.SP?.['idle.0']?.sim, live0 = poseOf('idle.0'), hip = J.segs.findIndex(sg => sg.bone === 'Hips');
    if (!ref || !live0 || hip < 0) return;
    const names = idx.sim.capsule_names || [], nc = names.length;
    CLO.capB = Int16Array.from(names, n => IX[n] ?? -1); CLO.capL = new Float64Array(nc * 7);
    for (let i = 0; i < nc; i++) {
      const b = CLO.capB[i], c = ref.caps[i]; if (b < 0 || !c) continue;
      const o = b * 7; QI[0] = -live0.w[o]; QI[1] = -live0.w[o + 1]; QI[2] = -live0.w[o + 2]; QI[3] = live0.w[o + 3];
      for (let e = 0; e < 2; e++) {
        qrot(QI, 0, c[e * 3] - live0.w[o + 4], c[e * 3 + 1] - live0.w[o + 5], c[e * 3 + 2] - live0.w[o + 6], V3, 0);
        CLO.capL[i * 7 + e * 3] = V3[0]; CLO.capL[i * 7 + e * 3 + 1] = V3[1]; CLO.capL[i * 7 + e * 3 + 2] = V3[2];
      }
      CLO.capL[i * 7 + 6] = c[6];
    }
    const rig2 = new ClothRig(idx); if (!rig2.active) return;
    const fams = [], corners = rig2.cloths.reduce((a, C) => a + (C.rows - 1) * (C.cols - 1) * 6, 0);
    for (const C of rig2.cloths) {
      const f = J.families.find(x => x.name === C.def.fam); if (!f) return;   // (its family's ramp: the live model's own)
      fams.push(f);
    }
    // a striped cloth (its def's bands [first cell row, last, family, bias]: the outlaw's poncho): those families after
    // the cloths' own, and each cell row's family index and bias (a band whose family the model lacks keeps the cloth's)
    const rowFam = rig2.cloths.map((C, ci) => {
      if (!C.def.bands) return null;
      const rf = new Int16Array(C.rows - 1).fill(ci), rb = new Float64Array(C.rows - 1).fill(C.def.bias ?? 0);
      for (const [r0, r1, fn, bias] of C.def.bands) {
        const f = J.families.find(x => x.name === fn); if (!f) continue;
        const fi = fams.push(f) - 1;
        for (let r = r0; r <= r1 && r < C.rows - 1; r++) { rf[r] = fi; rb[r] = bias ?? C.def.bias ?? 0; }
      }
      return {rf, rb};
    });
    CLO.sim = {mats: {}, caps: Array.from({length: nc}, () => [0, 0, 0, 0, 0, 0, 0])};
    CLO.matB = rig2.cloths.map(C => { CLO.sim.mats[C.def.bone] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0]; return IX[C.def.bone] ?? -1; });
    if (CLO.matB.some(b => b < 0)) return;
    CLO.D = rig.attach(model, corners, fams); CLO.rig = rig2; CLO.hip = hip; CLO.cn = corners; CLO.fams = fams; CLO.rowFam = rowFam;
    // the corners' fixed info: the hips' segment, a part of its own a cloth (after the model's), its family, shaded
    let k = 0;
    const bias100 = b => Math.max(-127, Math.min(127, Math.round(b * 100)));
    rig2.cloths.forEach((C, ci) => {
      const part = 255 - ci, bias = bias100(C.def.bias ?? 0), R = rowFam[ci], per = (C.cols - 1) * 6;   // (corners a cell row)   // (part: from 255 down, clear of the parts view/dress.js adds)
      for (let i = 0; i < (C.rows - 1) * (C.cols - 1) * 6; i++, k++) {
        const r = R ? Math.floor(i / per) : 0;
        CLO.D.info[k * 4] = hip; CLO.D.info[k * 4 + 1] = part; CLO.D.info[k * 4 + 2] = CLO.D.fam[R ? R.rf[r] : ci]; CLO.D.info[k * 4 + 3] = 0;
        CLO.D.nrm[k * 4 + 3] = R ? bias100(R.rb[r]) : bias;
      }
    });
    if (GEAR.cloth) clothPaint();
  }
  // a step of the cloth on the drawn pose w (his body space, at the facing phi), then its triangles into the attached mesh.
  // (no allocation: the scratch below, plain loops)
  const CT = new Float64Array(4 * 3);
  let clC = 1, clS = 0, clO = null, clW = null, clH = 0, clV = 0;
  function clLocal(p, j) {   // a point in the rig's world -> his body space (its facing's turn undone) -> the hips' frame, CT[j..]
    const dx = p[0] - clO[0], dy = p[1] - clO[1], bx = clC * dx + clS * dy, by = -clS * dx + clC * dy;
    qrot(QI, 0, bx - clW[clH + 4], by - clW[clH + 5], p[2] - clW[clH + 6], V3, 0); CT[j] = V3[0]; CT[j + 1] = V3[1]; CT[j + 2] = V3[2];
  }
  function clTri(D, a, b, c) {   // a facet of CT's corners a, b, c with its flat normal
    const ux = CT[b * 3] - CT[a * 3], uy = CT[b * 3 + 1] - CT[a * 3 + 1], uz = CT[b * 3 + 2] - CT[a * 3 + 2];
    const wx = CT[c * 3] - CT[a * 3], wy = CT[c * 3 + 1] - CT[a * 3 + 1], wz = CT[c * 3 + 2] - CT[a * 3 + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx; const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;   // (not Math.hypot: it boxes)
    nx = Math.round(nx / nl * 127); ny = Math.round(ny / nl * 127); nz = Math.round(nz / nl * 127);
    for (let e = 0; e < 3; e++) {
      const j = (e === 0 ? a : e === 1 ? b : c) * 3, v = clV++;
      D.pos[v * 3] = CT[j]; D.pos[v * 3 + 1] = CT[j + 1]; D.pos[v * 3 + 2] = CT[j + 2];
      D.nrm[v * 4] = nx; D.nrm[v * 4 + 1] = ny; D.nrm[v * 4 + 2] = nz;
    }
  }
  function cloth(w, phi, yaw, dt, P) {
    if (!CLO.tried) clothSetup();
    const R = CLO.rig; if (!R) return;
    // his motion in the view's frame, without the camera's turns (hero.js's clothPos)
    if (yaw === CLO.lyaw && CLO.lx === CLO.lx) { CLO.g[0] += P.x - CLO.lx; CLO.g[1] += P.y - CLO.ly; }
    CLO.lx = P.x; CLO.ly = P.y; CLO.lyaw = yaw;
    // the bones the cloths hang from (rows of 3x4) and the capsules, off the drawn pose
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
    const N = R.N, k = wrap(phi - yaw) / (TAU / N);   // his facing from the camera, in the atlas's facing steps (fractional)
    R.update(dt, CLO.sim, k, CLO.g);
    // the triangles: two facets a grid cell, in the hips' frame (the segment the corners name)
    const a = (R.idx.cam.yaw0 + 360 / N * k) * DEG;
    clC = Math.cos(a); clS = Math.sin(a); clO = R.origin; clW = w; clH = SEG[CLO.hip] * 7; clV = 0;
    QI[0] = -w[clH]; QI[1] = -w[clH + 1]; QI[2] = -w[clH + 2]; QI[3] = w[clH + 3];
    for (let ci = 0; ci < R.cloths.length; ci++) {
      const C = R.cloths[ci], pts = C.pos, cols = C.cols; if (!pts) continue;
      for (let r = 0; r < C.rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
        const i00 = r * cols + c;   // CT corners: 0 = (r, c), 1 = (r, c + 1), 2 = (r + 1, c), 3 = (r + 1, c + 1)
        clLocal(pts[i00], 0); clLocal(pts[i00 + 1], 3); clLocal(pts[i00 + cols], 6); clLocal(pts[i00 + cols + 1], 9);
        clTri(CLO.D, 0, 2, 1); clTri(CLO.D, 1, 2, 3);
      }
    }
    CLO.D.update(GEAR.cloth === 'off' ? 0 : clV);   // (GEAR: a piece that hides the panel: still stepped, not drawn)
  }

  // ---------------------------------------------------------------- GEAR: the model as worn (view/dress.js, docs/GEAR.md)
  // The export's own json + bin stay (J, bin: every pose, clip and bone above reads J); the rig draws the dressed corners.
  // Made on a change of set only (a few ms), never per frame. The runtime cloth panel takes the set's colour, or hides.
  const GEAR = {key: '', cloth: null};
  function clothPaint() {
    const D = CLO.D; if (!D) return;
    let k = 0;
    const g = GEAR.cloth && GEAR.cloth !== 'off' ? D.famRow(GEAR.cloth) : -1;   // (none: each cell row its own, a striped cloth's bands)
    CLO.rig.cloths.forEach((C, ci) => {
      const R = CLO.rowFam[ci], per = (C.cols - 1) * 6;
      for (let i = 0; i < (C.rows - 1) * (C.cols - 1) * 6; i++, k++) D.info[k * 4 + 2] = g >= 0 ? g : D.fam[R ? R.rf[Math.floor(i / per)] : ci];
    });
    D.infoChanged();
  }
  function wear(pieces, key) {   // pieces: content/gear.js entries in SLOTS order; key: the set's (content/gear.js setKey)
    if (key === GEAR.key) return false;
    const was = GEAR.cloth;
    if (!pieces.length) { rig.restyle(model, J, bin); GEAR.cloth = null; }
    else { const D = dressModel(J, bin, pieces); rig.restyle(model, D.J, D.bin); GEAR.cloth = D.cloth; }
    GEAR.key = key;
    if (GEAR.cloth !== was) clothPaint();
    return true;
  }

  // ---------------------------------------------------------------- body space -> the render's world (render/rigmesh.js matrices)
  let fc = 1, fs = 0, AX = 0, AY = 0, AZ = 0, FX = 0, FZ = -1;
  function toWorld(x, y, z, o, k) { o[k] = fc * x - fs * y + AX; o[k + 1] = z + AY; o[k + 2] = -fs * x - fc * y + AZ; }
  const WP = new Float64Array(3);
  function screenOf(x, y, z, out) {   // body space -> view px, the sprite camera's squash applied
    toWorld(x, y, z, WP, 0);
    const dd = (WP[0] - AX) * FX + (WP[2] - AZ) * FZ, X = WP[0] - FX * dd * (1 - K_UP), Z = WP[2] - FZ * dd * (1 - K_UP);
    return G.toScreenInto(X, WP[1], Z, out);
  }
  function tips(w, out) {   // each bone's head and tail on screen, relative to the anchor's (px)
    screenOf(0, 0, 0, SC); const ax = SC[0], ay = SC[1];
    for (let i = 0; i < NB; i++) {
      const o = i * 7; screenOf(w[o + 4], w[o + 5], w[o + 6], SC); out[i * 4] = SC[0] - ax; out[i * 4 + 1] = SC[1] - ay;
      qrot(w, o, 0, LEN[i], 0, V3, 0); screenOf(w[o + 4] + V3[0], w[o + 5] + V3[1], w[o + 6] + V3[2], SC); out[i * 4 + 2] = SC[0] - ax; out[i * 4 + 3] = SC[1] - ay;
    }
  }
  function mats(w, hide = null) {
    for (let s = 0; s < NS; s++) {
      const o = SEG[s] * 7, m = s * 12, x = w[o], y = w[o + 1], z = w[o + 2], q = w[o + 3];
      // the bone's rotation (rows), Blender axes
      const r00 = 1 - 2 * (y * y + z * z), r01 = 2 * (x * y - z * q), r02 = 2 * (x * z + y * q);
      const r10 = 2 * (x * y + z * q), r11 = 1 - 2 * (x * x + z * z), r12 = 2 * (y * z - x * q);
      const r20 = 2 * (x * z - y * q), r21 = 2 * (y * z + x * q), r22 = 1 - 2 * (x * x + y * y);
      MATS[m] = fc * r00 - fs * r10; MATS[m + 1] = fc * r01 - fs * r11; MATS[m + 2] = fc * r02 - fs * r12;
      MATS[m + 4] = r20; MATS[m + 5] = r21; MATS[m + 6] = r22;
      MATS[m + 8] = -fs * r00 - fc * r10; MATS[m + 9] = -fs * r01 - fc * r11; MATS[m + 10] = -fs * r02 - fc * r12;
      toWorld(w[o + 4], w[o + 5], w[o + 6], WP, 0); MATS[m + 3] = WP[0]; MATS[m + 7] = WP[1]; MATS[m + 11] = WP[2];
    }
    if (hide) for (let s = 0; s < NS; s++) if (hide[s]) MATS.fill(0, s * 12, s * 12 + 12);   // (a zero matrix draws nothing)
  }
  // SMEAR: a segment whose bone tail jumped > SMEAR.px on screen since the last drawn frame: stretched back along its move.
  // The stretch scales the whole piece along the move by (1 + k) about the tail, so k is the smear's length over the
  // piece's OWN extent that way (its box projected on the move), not its bone's length: the hat's bone is 5 cm under a
  // 1 m brim (k came out at ~6: the brim drawn several times its width)
  function smear(w) {
    let n = 0; stats.smearK = 0;
    screenOf(0, 0, 0, SC); const ax = SC[0], ay = SC[1];
    for (let s = 0; s < NS; s++) {
      if (!SMEARS[s]) continue;
      const b = SEG[s], o = b * 7; qrot(w, o, 0, LEN[b] || .05, 0, V3, 0);
      const tx = w[o + 4] + V3[0], ty = w[o + 5] + V3[1], tz = w[o + 6] + V3[2];
      if (prevOk) {
        screenOf(tx, ty, tz, SC); const sx = SC[0] - ax, sy = SC[1] - ay; screenOf(PREV[b * 3], PREV[b * 3 + 1], PREV[b * 3 + 2], SC);
        const jp = Math.hypot(sx - (SC[0] - ax), sy - (SC[1] - ay));
        if (jp > SMEAR.px) {
          toWorld(tx, ty, tz, WP, 0); const qx = WP[0], qy = WP[1], qz = WP[2]; toWorld(PREV[b * 3], PREV[b * 3 + 1], PREV[b * 3 + 2], WP, 0);
          let vx = qx - WP[0], vy = qy - WP[1], vz = qz - WP[2]; const vl = Math.hypot(vx, vy, vz) || 1; vx /= vl; vy /= vl; vz /= vl;
          const m = s * 12, e = Math.abs(vx * MATS[m] + vy * MATS[m + 4] + vz * MATS[m + 8]) * BOX[s * 3]
            + Math.abs(vx * MATS[m + 1] + vy * MATS[m + 5] + vz * MATS[m + 9]) * BOX[s * 3 + 1]
            + Math.abs(vx * MATS[m + 2] + vy * MATS[m + 6] + vz * MATS[m + 10]) * BOX[s * 3 + 2];   // its extent along v
          const k = Math.min(SMEAR.kmax, Math.min(SMEAR.max, vl * SMEAR.k) / Math.max(e, .03));
          if (k > stats.smearK) stats.smearK = k;
          // M' = S M about q: S = I + k v v^T; t' = S t - k v (v . q)
          for (let c = 0; c < 4; c++) {
            const a0 = MATS[m + c], a1 = MATS[m + 4 + c], a2 = MATS[m + 8 + c], dv = vx * a0 + vy * a1 + vz * a2 - (c === 3 ? vx * qx + vy * qy + vz * qz : 0);
            MATS[m + c] = a0 + k * vx * dv; MATS[m + 4 + c] = a1 + k * vy * dv; MATS[m + 8 + c] = a2 + k * vz * dv;
          }
          n++;
        }
      }
    }
    for (let b = 0; b < NB; b++) { const o = b * 7; qrot(w, o, 0, LEN[b] || .05, 0, V3, 0); PREV[b * 3] = w[o + 4] + V3[0]; PREV[b * 3 + 1] = w[o + 5] + V3[1]; PREV[b * 3 + 2] = w[o + 6] + V3[2]; }
    prevOk = true;
    return n;
  }

  // ---------------------------------------------------------------- MOTION (K.move): the live movement clips
  // The jumps made for the live model (western.py MOVE_LIVE: mv_*), their frames picked from the sim's state and how far
  // through it he is, instead of the atlas's leap / fall / land frames the sim names (the sprites keep those):
  //   leap         mv_leap by the leap's progress (push off, rise, the top, coming down, reaching for the ground)
  //   fall         mv_fall's first three frames back and forth (MV.fallHz), its reach once the ground is MV.near m under him
  //                (after the first MV.off s)
  //   land         after a fall of more than MV.hard m: mv_land_hard (deep into the knees, up again) by its own time; else
  //                mv_land_soft by the landing's time (he lands running)
  //   vault        over a breach: mv_vault by its progress (VAULT_OVER_T); up a ledge: mv_climb (VAULT_T)
  //   (the vault over ends running: mv_land_soft's frames for its length after, while he is on his feet again)
  // A model without them (or K.move off) draws the sim's frames as before
  const MV = {fallHz: 8, near: 1.2, off: .08, hard: 1.2};
  const HAS_MV = !!(CL.mv_leap && CL.mv_fall && CL.mv_land_soft && CL.mv_land_hard && CL.mv_vault && CL.mv_climb);
  let mvPrev = '', mvTop = 0, mvHard = false, mvT = 0, mvAfter = 0, mvOver = false, mvLast = '';
  const MV_FRAMES = new Set(['land', 'fall', 'leap.0', 'leap.1', 'leap.2', 'leap.3', 'mantle.0', 'reach_up', 'crouch', 'lunge']);   // (the atlas's, while a move of ours ends)
  const mvAt = (clip, k) => nm(clip + '.', Math.max(0, Math.min(CL[clip].frames - 1, Math.floor(k * CL[clip].frames))));
  function motion(P, dt) {
    const st = P.state, prev = mvPrev; mvPrev = st; toolUp = '';   // (TOOL: set again by toolMotion while he steps and swings)
    if (st !== prev) {
      if (st === 'fall') mvTop = P.z;
      if (st === 'land') { mvHard = prev === 'fall' && mvTop - P.z > MV.hard; mvT = 0; }
      if (prev === 'vault' && mvOver && st !== 'fall' && HAS_MV) mvAfter = CL.mv_land_soft.frames / CL.mv_land_soft.fps;   // (over a breach: lands running)
    }
    mvT += dt; if (st === 'vault') mvOver = P.vault?.top !== undefined && (P.vault.kind || 'tuck') === 'tuck';   // (the hop runs on in its own last frame)
    if (!HAS_MV || !K.move) return null;
    const rw = ropeMotion(P); if (rw) return rw;   // ROPEWALL: the rope wall's and the ladder's live clips (docs/exp/ropeclimb.md)
    const tz = toolMotion(P); if (tz) return tz;   // TOOL: a tool's swing (docs/GATHERING.md)
    const fz = fistsMotion(P); if (fz) return fz;   // FISTS: the guard, the punches, the slip, the clinch (docs/exp/fists.md)
    const bz = brawlMotion(P); if (bz) return bz;   // BRAWL: the boot, the barge, lifting, carrying, throwing (docs/exp/brawl.md)
    const lz = lassoMotion(P, dt); if (lz) return lz;   // LASSO: the rope work's live clips (docs/exp/lasso.md)
    switch (st) {
      case 'leap': return P.leap ? mvLast = mvAt(P.leap.kind === 'long' && CL.mv_long ? 'mv_long' : 'mv_leap', P.t / P.leap.dur) : null;   // (ADAPTIVE JUMPS: a long jump's own)
      case 'fall': {
        const h = P.z - elev(app.player.x, app.player.y);
        if (h < MV.near && P.t > MV.off) return mvLast = nm('mv_fall.', h < MV.near * .4 ? 4 : 3);   // (stepping off an edge, the ground under him is still the edge's)
        const s = Math.floor(P.t * MV.fallHz) % 4; return mvLast = nm('mv_fall.', s === 3 ? 1 : s);   // (0 1 2 1 0 1 2 ...)
      }
      case 'land': return mvLast = mvHard ? mvAt('mv_land_hard', mvT * CL.mv_land_hard.fps / CL.mv_land_hard.frames) : mvAt('mv_land_soft', mvT * CL.mv_land_soft.fps / CL.mv_land_soft.frames);
      case 'vault': { const V = P.vault; if (!V) return null; const c = vaultClip(V); return mvLast = mvAt(c, P.t / (V.dur || (V.top !== undefined ? VAULT_OVER_T : VAULT_T))); }   // (ADAPTIVE JUMPS: by its kind)
    }
    if (MV_FRAMES.has(P.frame) && mvLast) return mvLast;   // (the step a move ends on still names its atlas frame: the last of ours held)
    mvLast = '';
    if (mvAfter > 0) { const C = CL.mv_land_soft, k = 1 - mvAfter * C.fps / C.frames; mvAfter -= dt; if (st === 'idle' || st === 'move') return mvAt('mv_land_soft', k); }
    return null;
  }

  // ---------------------------------------------------------------- BRAWL (docs/exp/brawl.md; K.move): the clips made for the moves
  // (western.py BRAWL_LIVE) by the sim's state and its progress (sim/player/brawl.js): mv_kick, mv_barge, mv_lift, mv_throw; while he
  // carries something, mv_carry standing and mv_carry_walk / mv_carry_run for the walk's and the run's frames (the same timing:
  // the sim's gait frame by index). A model without one keeps the sim's stand-in
  const BRAWL_CLIP = {kick: 'mv_kick', barge: 'mv_barge', lift: 'mv_lift', throw: 'mv_throw'};
  function brawlMotion(P) {
    const b = app.PL.brawl; if (!b) return null;
    const c = BRAWL_CLIP[P.state];
    if (c) return CL[c] ? mvAt(c, b.progress) : null;
    if (P.state === 'rope' && CL.mv_zip && app.PL.lasso?.mode === 'zip' && app.PL.lasso.S.zp?.ph === 'ride') return nm('mv_zip.', Math.floor(t * (CL.mv_zip.fps || 4)) % CL.mv_zip.frames);   // (the zip line: hanging by both hands)
    if (!b.carrying || !CL.mv_carry) return null;
    if (P.state === 'move') {
      const q = parse(P.frame), c2 = q.clip === 'walk' ? 'mv_carry_walk' : q.clip === 'run' || q.clip === 'sprint' || q.clip === 'drive' ? 'mv_carry_run' : '';
      if (c2 && CL[c2]) return nm(c2 + '.', Math.min(q.i, CL[c2].frames - 1));
    }
    if (P.state === 'idle' || P.state === 'pose' || P.state === 'move') return nm('mv_carry.', Math.floor(t * (CL.mv_carry.fps || 3)) % CL.mv_carry.frames);
    return null;
  }

  // ---------------------------------------------------------------- TOOL (docs/GATHERING.md; K.move): a tool's swing (sim/player/tool.js;
  // content/woodcut.js TUNE.swing is the truth). The chop's own clip (tl_chop) once it exists; until then a STAND-IN: the gun whip
  // (the gunslinger) or the lasso's snare (the outlaw), time-warped so its contact frame shows at the sim's blow (the fists' way),
  // with what those clips hold that isn't the tool (the revolver, the coil) hidden while it plays (toolHide). Stepping while he
  // swings (the sim's footwork: TUNE.swing.move), the swing is his UPPER body over stepping legs (compose's 'upper' layer):
  // the fists' footwork clips by the sim's way and phase (fs_step_<f|b|l|r>), a model without them its walk
  const TOOL_CLIP = ['tl_chop', 'gun_whip', 'ls_snare'].find(c => CL[c]) || '', TOOL_MARK = {tl_chop: 'hit', gun_whip: 'hit', ls_snare: 'cinch'};
  const TOOL_HIDE = new Uint8Array(J.segs.length), TOOL_HIDES = J.segs.map(s => s.kind === 'gun' || s.kind === 'coil');
  let toolSwing = false, toolUp = '';
  function toolLegs(P, T) {
    const c = 'fs_step_' + (T.S.stepDir || 'f'), C = CL[c] || CL.walk, n = C ? (CL[c] ? c : 'walk') : '';
    return n ? nm(n + '.', Math.floor((P.ph || 0) * C.frames) % C.frames) : '';
  }
  function toolMotion(P) {
    const T = app.PL.tool; toolSwing = false; toolUp = '';
    if (!T || !T.S.on || P.state !== 'chop' || !TOOL_CLIP) return null;
    const C = CL[TOOL_CLIP], Tm = timing(TOOL_CLIP); if (!Tm) return null;
    const hitF = fsStep(Tm, C.marks?.[TOOL_MARK[TOOL_CLIP]] ?? Math.floor(C.frames / 2)), ah = Tm.at[hitF], ae = Tm.at[Tm.n] - 1e-4, W = T.swing || WOOD.swing;   // (the tool's own swing: the axe's, the pick's)
    const ct = T.S.t < W.hit ? ah * (T.S.t / W.hit) : ah + (ae - ah) * Math.min(1, (T.S.t - W.hit) / Math.max(.01, W.dur - W.hit));
    const ft = frameAt(Tm, ct), fr = nm(TOOL_CLIP + '.', ft < 0 ? C.frames - 1 : ft); toolSwing = TOOL_CLIP !== 'tl_chop';
    if (Math.hypot(P.vx, P.vy) > .3) { const legs = toolLegs(P, T); if (legs && poseOf(legs)) { toolUp = fr; return legs; } }   // (on the move: the swing over his steps)
    return fr;
  }
  function toolHide(h) { for (let s = 0; s < TOOL_HIDE.length; s++) TOOL_HIDE[s] = (h && h[s]) || TOOL_HIDES[s] ? 1 : 0; return TOOL_HIDE; }

  // ---------------------------------------------------------------- FISTS (docs/exp/fists.md; K.move): the fs_* clips (western.py
  // FISTS_LIVE) by the sim's move, its phase and its time (sim/player/fists.js S; content/fists.js MOVES is the truth):
  //   the WIND (the press held) holds frame 0; a heavy's CHARGE plays its load frames (FS.load s each) then its two-frame tremble
  //   (marks.loop, faster as it fills); the THROW is time-warped: the clip's own time from its first throw frame (1; a heavy's
  //   marks.throw) to its `hit` frame onto the move's 0..hit, from there to its end onto hit..dur, so the contact frame shows
  //   exactly at the sim's blow (the hitstop then holds it); the guard: fs_guard, on the move fs_step_<f|b|l|r> by the sim's
  //   phase (one cycle a .9 m), a block fs_block; a slip fs_slip_<l|r|b>; holding a clinch fs_clinch. Between fs_ clips the
  //   TRANSITIONS blend is FS.blend s at most (a string flows). A model without a clip keeps the sim's stand-in
  const FS = {load: .08, blend: .06, trem: [8, 18], smear: .05};
  const fsStep = (T, fr) => { if (!T.play) return Math.min(fr, T.n - 1); for (let i = 0; i < T.n; i++) if (T.play[i] === fr) return i; return Math.min(fr, T.n - 1); };
  function fsAt(c, k) {   // a one-shot by its progress 0..1 (its own timing)
    const T = timing(c); if (!T) return null;
    const ft = frameAt(T, Math.max(0, Math.min(T.at[T.n] - 1e-4, k * T.at[T.n])));
    return nm(c + '.', ft < 0 ? CL[c].frames - 1 : ft);
  }
  // the punch's smear (the runtime smear, SMEAR, on for the move's wind, charge and throw up to FS.smear s past its contact; ?fsmear=0 off)
  const FS_SMEAR = flags.get('fsmear') !== '0';
  function fsSmear() {
    const S = FS_SMEAR && app.PL.fists?.S; if (!S || !S.on || !S.mv) return false;
    const m = FISTS_MOVES[S.mv]; return S.ph === 'wind' || S.ph === 'charge' || (S.ph === 'throw' && !!m && S.t < m.hit + FS.smear);
  }
  function fistsMotion(P) {
    const F = app.PL.fists; if (!F || !F.S.on) return null;
    const S = F.S, st = P.state;
    if (st === 'guard') {
      if (S.blockT > 0 && CL.fs_block) return fsAt('fs_block', 1 - S.blockT / FISTS_TUNE.guard.show);
      if (Math.hypot(P.vx, P.vy) > .3) { const c = 'fs_step_' + S.stepDir; if (CL[c]) return nm(c + '.', Math.floor(P.ph * CL[c].frames) % CL[c].frames); }
      return CL.fs_guard ? nm('fs_guard.', Math.floor(t * (CL.fs_guard.fps || 6)) % CL.fs_guard.frames) : null;
    }
    if (st === 'slip') { const c = 'fs_slip_' + (S.slip || 'b'); return CL[c] ? fsAt(c, S.t / FISTS_TUNE.slip.dur) : null; }
    if (st !== 'fist' && st !== 'clinch') return null;
    if (!S.mv) return CL.fs_clinch ? nm('fs_clinch.', Math.floor(t * (CL.fs_clinch.fps || 3)) % CL.fs_clinch.frames) : null;
    const m = FISTS_MOVES[S.mv], c = m && m.clip, C = c && CL[c]; if (!C) return null;
    const mk = C.marks || {}, T = timing(c); if (!T) return null;
    const hit = fsStep(T, mk.hit ?? Math.floor(C.frames / 2));
    if (S.ph === 'wind') return nm(c + '.', 0);
    if (S.ph === 'charge') {
      const lp = mk.loop ?? 1, k = S.t / FS.load;
      if (k < lp) return nm(c + '.', Math.floor(k));
      const hz = FS.trem[0] + (FS.trem[1] - FS.trem[0]) * S.k;
      return nm(c + '.', lp + (Math.floor((S.t - lp * FS.load) * hz) % 2));
    }
    const th = fsStep(T, m.heavy ? (mk.throw ?? Math.max(1, hit - 1)) : 1), a0 = T.at[th], ah = T.at[Math.max(th, hit)], ae = T.at[T.n] - 1e-4;
    const ct = S.t < m.hit ? a0 + (ah - a0) * (S.t / m.hit) : ah + (ae - ah) * Math.min(1, (S.t - m.hit) / Math.max(.01, m.dur - m.hit));
    const ft = frameAt(T, ct);
    return nm(c + '.', ft < 0 ? C.frames - 1 : ft);
  }

  // ---------------------------------------------------------------- ROPEWALL (docs/exp/ropeclimb.md; K.move): the rope wall, the ladder
  // The controllable climbs (sim/player/ropewall.js, sim/player/ladder.js) live (western.py RW_LIVE): the clip by the climb's technique
  // and how far he has moved (the sim's S.foot: a boot step is half a cycle, so the boots don't skate), squared to the face (rwFace)
  // and the boots' soles put on it at the sim's point (rwPlace: the keys are posed in the wall's frame, the body is moved, not bent).
  // A model without the clips keeps the sim's stand-ins (the atlas's hang / climb / run frames)
  const HAS_RW = !!(CL.rw_stand && CL.rw_up && CL.rw_side), RWS = ROPEWALL.walk.step;
  const rwLoop = (clip, ph) => CL[clip] ? mvAt(clip, ph - Math.floor(ph)) : null;
  const rwOn = () => { const R = app.PL.ropewall; return HAS_RW && app.P.state === 'rope' && R?.active ? R.S : null; };
  function ropeMotion(P) {
    if (!HAS_RW) return null;
    if (P.state === 'climb') {   // the ladder: a cycle every two rungs (a hand and a boot up a rung by turns); the slide its own
      const Ld = app.PL.ladder; if (!Ld?.on || Ld.ph !== 'on' || !CL.ladder_up) return null;
      return Ld.slide && CL.ladder_slide ? 'ladder_slide.0' : rwLoop('ladder_up', Ld.z / (2 * LADDER.rung));
    }
    const S = rwOn(); if (!S) return null;
    switch (S.tech) {
      case 'walk':
        if (S.mv === 'up' || S.mv === 'down') return rwLoop('rw_up', S.foot / (2 * RWS));
        if (S.mv === 'side') return rwLoop(S.dir > 0 ? 'rw_side_r' : 'rw_side', S.foot / (2 * RWS));   // (+u is to his right, facing the face)
        return S.rest && CL.rw_rest ? 'rw_rest.0' : 'rw_stand.0';
      case 'swing': return rwLoop('rw_run', S.foot / (2.4 * RWS));
      case 'bound': return mvAt('rw_bound', Math.min(.999, S.t / ROPEWALL.bound.t));
      case 'free': return S.mv ? rwLoop('rope_lock', S.foot / ROPEWALL.lock.cycle) : 'rope_lock.0';
      case 'top': return CL.rw_top ? mvAt('rw_top', Math.min(.999, S.t / ROPEWALL.top.t)) : null;
      case 'line': return S.mv ? rwLoop('hand_line', S.foot / 1.1) : 'hand_line.0';
    }
    return null;
  }
  const RW_FACE = new Set(['walk', 'swing', 'bound', 'free']), RW_PLACE = new Set(['walk', 'swing', 'bound']);
  // squared to the face: his front along its inward normal (exact: no facing steps while he is on it)
  function rwFace(phi) { const S = rwOn(); return S && RW_FACE.has(S.tech) ? Math.atan2(-S.nx, -S.ny) : phi; }
  // the boots onto the face (compose's anchor moved): the balls of both boots (the toes' heads, body space) at the sim's boot point on
  // it, a sole's thickness out (pushed off it in a bound: the sim's lean out past the walk's)
  function rwPlace(w) {
    const S = rwOn(); if (!S || !RW_PLACE.has(S.tech) || TOE_L < 0 || TOE_R < 0) return;
    const a = TOE_L * 7, b = TOE_R * 7, bx = (w[a + 4] + w[b + 4]) / 2, by = (w[a + 5] + w[b + 5]) / 2, bz = (w[a + 6] + w[b + 6]) / 2;
    const out = .06 + Math.max(0, S.off - ROPEWALL.walk.off), tx = S.px - S.ny * S.u + S.nx * out, ty = S.py + S.nx * S.u + S.ny * out;
    AX = tx - (fc * bx - fs * by); AZ = ty - (-fs * bx - fc * by); AY = S.h - bz;
  }

  // ---------------------------------------------------------------- LASSO (docs/exp/lasso.md "Live"; K.move, K.proc)
  // The rope work drawn with the live clips (western.py LASSO_LIVE: ls_*), picked by the lasso's state (sim/player/lasso.js:
  // PL.lasso.S) and its progress. The throw, the yank and the snare are WARPED onto the sim's own timing: the clip's mark (release,
  // pull, cinch) lands on the step the sim acts at, the stretch before and after it each scaled to fit. The standing spin's frame
  // follows the loop's turn (S.spinPh: the clip's key i has the wrist at -90 + 45 i deg round the circle); held, the catch (ls_take,
  // a strong one's ls_jerk), then the hold, the strain while it pulls on him (ls_strain; ls_dragged while it drags him), the hold's
  // walk (ls_haul_walk, backward when he backs away). PROCEDURAL (K.proc): spinning (standing or on the move) the right wrist is
  // IK'd onto the spin circle (LS: rest space, carried by the chest) at the loop's turn in LS.steps steps, so the loop the view
  // draws (features/equip/lassolook.js) turns with his hand. The drawn rope hands (RopeHand0 / 1) and the circle are published for
  // it (ropeHand(): host.playerRopeHand). A model without the clips keeps the sim's atlas frames (the IK and the hands still run).
  // (c, r: the wrist's circle in rest space, carried by the chest: FITTED below from the model's ls_spin keys; these are the atlas
  // spin's, western.py _spin_point. steps: the turn's steps for the IK hand, 0: smooth. up: a throw this steep is ls_throw_up.
  // drag: m/s the rope drags him at for ls_dragged)
  const LS = {c: [-.36, -.12, 1.71], r: .12, steps: 0, up: 22 * DEG, drag: .5};
  const HAS_LS = !!(CL.ls_spin && CL.ls_throw), ROPE0 = B_('RopeHand0'), ROPE1 = B_('RopeHand1');
  const LSM = new Map();   // clip -> its timing (timing() below) and its marks as times
  function lsClip(c) {
    let M = LSM.get(c); if (M) return M;
    const T = timing(c); if (!T) return null;
    const C = CL[c], mk = {};
    for (const [k, v] of Object.entries(C.marks || {})) { const st = T.play ? T.play.indexOf(v) : v; if (st >= 0) mk[k] = T.at[st]; }
    LSM.set(c, M = {T, mk, end: T.at[T.n]}); return M;
  }
  // its frame at clip time x (a loop wraps; a one-shot holds its last frame)
  function lsAt(c, x, loop) {
    const M = lsClip(c); if (!M) return null;
    const T = M.T, end = M.end; x = loop ? ((x % end) + end) % end : Math.min(Math.max(0, x), end - 1e-6);
    let st = 0; while (st < T.n - 1 && T.at[st + 1] <= x) st++;
    return nm(c + '.', T.play ? T.play[st] : st);
  }
  // sim time u -> clip time, so the sim's mark (rel of tot s) falls on the clip's (cr of ce s)
  const warp = (u, rel, tot, cr, ce) => u < rel ? (rel > 0 ? u / rel * cr : cr) : cr + (u - rel) / Math.max(1e-3, tot - rel) * (ce - cr);
  let lsMode = '', lsT = 0, lsPh = 0;
  function lassoMotion(P, dt) {
    const Z = app.PL.lasso; if (!Z || !HAS_LS) return null;
    const S = Z.S, m = S.mode;
    if (m !== lsMode) { lsMode = m; lsT = 0; } else lsT += dt;
    stats.ls = '';
    switch (m) {
      case 'spin': {   // standing: the frame by the loop's turn (on the move: the sim's lws_ / lrs_ frames, the hand IK'd)
        if (P.state !== 'idle') return null;
        const n = CL.ls_spin.frames, ph = ((S.spinPh % 1) + 1) % 1;
        return stats.ls = nm('ls_spin.', Math.round(ph * n) % n);
      }
      case 'throw': {   // up at a high anchor: ls_throw_up (by the angle from his hand to the target)
        const pl = app.player, up = CL.ls_throw_up && Math.atan2(S.th - (P.z + 1.6), Math.hypot(S.tx - pl.x, S.ty - pl.y)) > LS.up;
        const c = up ? 'ls_throw_up' : 'ls_throw', M = lsClip(c), TL = Z.tls().throw;
        return stats.ls = lsAt(c, warp(S.t, TL.rel, TL.total, M.mk.release ?? M.end * .4, M.end), false);
      }
      case 'yank': {
        const M = CL.ls_yank && lsClip('ls_yank'); if (!M) return null;
        const TL = Z.tls().yank; return stats.ls = lsAt('ls_yank', warp(S.t, TL.rel, TL.total, M.mk.pull ?? 0, M.end), false);
      }
      case 'snare': {
        const M = CL.ls_snare && lsClip('ls_snare'); if (!M) return null;
        const N = LASSO_TUNE.snare; return stats.ls = lsAt('ls_snare', warp(S.t, N.cinch, N.clip, M.mk.cinch ?? M.end * .4, M.end), false);
      }
      case 'hammer': return CL.ls_strain ? stats.ls = lsAt('ls_strain', lsT * 1.5, true) : null;
      case 'haul': {
        const tk = S.cls === 'strong' && CL.ls_jerk ? 'ls_jerk' : 'ls_take', M = CL[tk] && lsClip(tk);
        if (M && S.t < M.end && P.state !== 'move') return stats.ls = lsAt(tk, S.t, false);   // the catch: the rope goes taut
        if (S.tug || S.dragV > LS.drag) {   // it pulls on him: the strain; dragging him along: skidding
          const c = S.dragV > LS.drag && CL.ls_dragged ? 'ls_dragged' : CL.ls_strain ? 'ls_strain' : '';
          if (c) return stats.ls = lsAt(c, lsT, true);
        }
        if (P.state === 'move' && CL.ls_haul_walk) {   // walking with it: the hold over the walk, backward when he backs away
          const C = CL.ls_haul_walk, pl = app.player, a = app.yaw, c = Math.cos(a), s = Math.sin(a);
          const vx = P.vx * c + P.vy * s, vy = -P.vx * s + P.vy * c, sp = Math.hypot(vx, vy), back = vx * (S.tx - pl.x) + vy * (S.ty - pl.y) < 0;
          lsPh += (back ? -1 : 1) * sp * dt / (C.stride || 1.3);
          const n = C.frames; return stats.ls = nm('ls_haul_walk.', ((Math.floor(lsPh * n) % n) + n) % n);
        }
        return CL.ls_hold ? stats.ls = lsAt('ls_hold', lsT, true) : null;
      }
    }
    return null;
  }
  // a rest-space point carried by bone b as w poses it (the rest matrix: J.bones[b].rest, row-major, its head in [3], [7], [11])
  function carriedBy(w, b, x, y, z, out) {
    const R = J.bones[BN[b]].rest, dx = x - R[3], dy = y - R[7], dz = z - R[11], o = b * 7;
    qrot(w, o, R[0] * dx + R[4] * dy + R[8] * dz, R[1] * dx + R[5] * dy + R[9] * dz, R[2] * dx + R[6] * dy + R[10] * dz, out, 0);
    out[0] += w[o + 4]; out[1] += w[o + 5]; out[2] += w[o + 6]; return out;
  }
  // THE PUBLISHED HANDS (the world: arena x, y, height): RopeHand0 (x, y, h), RopeHand1 (ux, uy, uh), and spinning the circle's
  // centre (cx, cy, ch) and radius (r) the wrist goes round
  const LH = {ok: false, x: 0, y: 0, h: 0, ux: 0, uy: 0, uh: 0, spin: false, cx: 0, cy: 0, ch: 0, r: LS.r};
  const LV = new Float64Array(3);
  let lsSpin = false;
  // carriedBy's inverse: a point where w poses it -> the rest-space point bone b carries there
  function restOf(w, b, x, y, z, out) {
    const R = J.bones[BN[b]].rest, o = b * 7;
    QI[0] = -w[o]; QI[1] = -w[o + 1]; QI[2] = -w[o + 2]; QI[3] = w[o + 3];
    qrot(QI, 0, x - w[o + 4], y - w[o + 5], z - w[o + 6], out, 0);
    const lx = out[0], ly = out[1], lz = out[2];
    out[0] = R[3] + R[0] * lx + R[1] * ly + R[2] * lz; out[1] = R[7] + R[4] * lx + R[5] * ly + R[6] * lz; out[2] = R[11] + R[8] * lx + R[9] * ly + R[10] * lz;
    return out;
  }
  // THE SPIN'S CIRCLE from the model's ls_spin keys (their frames evenly round it from -90 deg: western.py LASSO_LIVE): the wrists
  // (the right hand's head) in the chest's rest space, their mean the centre, their mean distance across the radius
  if (CL.ls_spin && SPINE2 >= 0 && HAND_R >= 0) {
    const n = CL.ls_spin.frames, V0 = new Float64Array(3); let sx = 0, sy = 0, sz = 0, k = 0; const pts = [];
    for (let i = 0; i < n; i++) { const Q = poseOf('ls_spin.' + i); if (!Q) continue; const h = HAND_R * 7; restOf(Q.w, SPINE2, Q.w[h + 4], Q.w[h + 5], Q.w[h + 6], V0); pts.push(V0[0], V0[1]); sx += V0[0]; sy += V0[1]; sz += V0[2]; k++; }
    if (k >= 4) { LS.c = [sx / k, sy / k, sz / k]; let r = 0; for (let i = 0; i < k; i++) r += Math.hypot(pts[i * 2] - LS.c[0], pts[i * 2 + 1] - LS.c[1]); LS.r = r / k; }
  }
  function lassoIK(w) {   // (compose: after the feet, the plants and the seat; before the aim)
    const Z = app.PL.lasso; lsSpin = false;
    if (!Z || Z.S.mode !== 'spin' || !K.proc || SPINE2 < 0 || ARM_R < 0 || HAND_R < 0) return;
    const ph = ((Z.S.spinPh % 1) + 1) % 1, a = -Math.PI / 2 + TAU * (LS.steps ? Math.round(ph * LS.steps) / LS.steps : ph);
    carriedBy(w, SPINE2, LS.c[0] + LS.r * Math.cos(a), LS.c[1] + LS.r * Math.sin(a), LS.c[2], LV);
    ikRight(w, LV[0], LV[1], LV[2]); lsSpin = true;
  }
  function ropeHands(show) {   // (compose: on the pose as shown)
    LH.ok = ROPE0 >= 0; if (!LH.ok) return;
    toWorld(show[ROPE0 * 7 + 4], show[ROPE0 * 7 + 5], show[ROPE0 * 7 + 6], WP, 0); LH.x = WP[0]; LH.y = WP[2]; LH.h = WP[1];
    const u = ROPE1 >= 0 ? ROPE1 : ROPE0; toWorld(show[u * 7 + 4], show[u * 7 + 5], show[u * 7 + 6], WP, 0); LH.ux = WP[0]; LH.uy = WP[2]; LH.uh = WP[1];
    LH.spin = lsSpin && SPINE2 >= 0;
    if (LH.spin) { carriedBy(show, SPINE2, LS.c[0], LS.c[1], LS.c[2], LV); toWorld(LV[0], LV[1], LV[2], WP, 0); LH.cx = WP[0]; LH.cy = WP[2]; LH.ch = WP[1]; }
  }
  const lsBusy = () => !!app.PL.lasso?.mode;
  function lsReset() { lsMode = ''; lsT = 0; lsPh = 0; lsSpin = false; LH.ok = false; }

  // ---------------------------------------------------------------- ADAPTIVE JUMPS (docs/exp/livereact.md; K.move)
  // The vault's kind (sim/player/player.js JUMP) picks its clip (western.py JUMP_LIVE); a kind the model lacks falls back
  // to the tuck vault / the climb. While one plays, PLANTS fits the body to the real obstacle (the clips are posed for a
  // typical height): the clip's marks say when the hands are on it (plant .. free: the hand its `side` names, both for
  // hands 2) and from when the lead foot stands on the top (step); a planted hand goes onto the surface under it (the
  // wall's top where it is over the stones, else the ground: two-bone IK, the hand's own turn kept), a stepping foot onto
  // the top, and no foot is left in the ground or the stones.
  const VCLIP = {step: 'mv_step', knee: 'mv_knee', climb: 'mv_climb', catch: 'mv_catch', hop: 'mv_hop', tuck: 'mv_vault', over: 'mv_over'};
  function vaultClip(V) {
    const k = V.kind || (V.top !== undefined ? 'tuck' : 'climb'), c = VCLIP[k], r = V.side < 0 && CL[c + '_r'] ? c + '_r' : c;
    return CL[r] ? r : V.top !== undefined ? 'mv_vault' : 'mv_climb';
  }
  const FARM_L = B_('LeftForeArm'), PLANT = {hand: .04, slack: .05};
  let F0A = NaN;   // (the ankle's height over the sole: idle.0's)
  // the surface under body-space point (bx, by) during vault V: the stones' top where it is over the wall (V.near .. + V.thick
  // along the vault from where it began), else the ground (its world height, over his anchor's: body space)
  function surfaceAt(bx, by, V) {
    const X = fc * bx - fs * by + AX, Z = -fs * bx - fc * by + AZ, e = elev(X, Z) - AY;
    if (V.top === undefined) return e;
    const a = app.yaw, c = Math.cos(a), s = Math.sin(a), vx = X * c - Z * s, vy = X * s + Z * c;   // (the world -> his view frame, viewxf's)
    const along = (vx - V.x0) * V.dx + (vy - V.y0) * V.dy;
    return along > V.near - PLANT.slack && along < V.near + V.thick + PLANT.slack ? Math.max(e, V.top - AY) : e;
  }
  function plants(w, P, f) {
    const V = P.vault; if (!V || P.state !== 'vault' || !K.move) return;
    const pc = parse(f), C = CL[pc.clip], M = C && C.marks; if (!M) return;
    const right = pc.clip.endsWith('_r'), fi = pc.i;
    if (M.plant !== undefined && fi >= M.plant && fi < (M.free ?? 99)) {
      for (let h = 0; h < 2; h++) {
        const left = h === 0; if (M.hands !== 2 && left === right) continue;
        const a = left ? ARM_L : ARM_R, b = left ? FARM_L : FARM_R, c = left ? HAND_L : HAND_R; if (a < 0 || b < 0 || c < 0) continue;
        const o = c * 7, z = surfaceAt(w[o + 4], w[o + 5], V) + PLANT.hand; if (!(Math.abs(z - w[o + 6]) < .6)) continue;   // (more than .6 m off: not over what it was posed for)
        const held = !left && holstered(), g0 = GUN * 7, gn = held ? (END[GUN] - GUN) * 7 : 0;   // (the holstered revolver is the right hand's child: it stays put)
        if (held) for (let i = 0; i < gn && i < GSAVE.length; i++) GSAVE[i] = w[g0 + i];
        ikLeg(w, a, b, c, w[o + 4], w[o + 5], z);
        if (held) for (let i = 0; i < gn && i < GSAVE.length; i++) w[g0 + i] = GSAVE[i];
      }
    }
    if (!(F0A === F0A)) { const I = poseOf('idle.0'); F0A = I && FOOT_L >= 0 ? I.w[FOOT_L * 7 + 6] : .08; }
    for (let k = 0; k < 2 && FEET_OK; k++) {
      const ft = FT[k], o = ft * 7, lead = (k === 0) !== right, g = surfaceAt(w[o + 4], w[o + 5], V) + F0A;
      const want = M.step !== undefined && lead && fi >= M.step && g - F0A > V.z0 - AY + .15 ? g : Math.max(g, w[o + 6]);   // (planted on the top / out of the ground)
      if (Math.abs(want - w[o + 6]) > .01 && Math.abs(want - w[o + 6]) < .7) ikLeg(w, FU[k], FL[k], ft, w[o + 4], w[o + 5], want);
    }
  }

  // ---------------------------------------------------------------- the emotes (K.demo = one of EMOTES)
  // While he stands still (the sim's idle, his gun holstered and idle) the clip's frame replaces the sim's, by the clip's
  // own timing (its play order and ms, else its fps), from the start each time he stops. After the last step it loops
  // from marks.loop (a step of play: the squat rests there), else he stands EMOTE_REST s and it plays again. View only:
  // the sim still says idle (a moving or a drawn gun cancels it at once). A step showing a frame its marks name shot,
  // shot2, ... fires the shot's look and sound as it begins (shot(): compose, off the drawn barrel); hit, ... a body hit's
  // sound (the pistol whip); nothing of the sim's.
  const EMOTE_REST = 1.6, EMO = {};
  for (const c of EMOTES) {
    const C = CL[c], n = C.play ? C.play.length : C.frames, at = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) at[i + 1] = at[i] + (C.ms ? C.ms[i] / 1000 : 1 / C.fps);
    EMO[c] = {n, at, loop: C.marks?.loop ?? -1, play: C.play || null,
      shots: new Set(Object.entries(C.marks || {}).filter(([k]) => /^shot/.test(k)).map(([, v]) => v)),
      hits: new Set(Object.entries(C.marks || {}).filter(([k]) => /^hit/.test(k)).map(([, v]) => v))};
  }
  let emT = 0, emC = '', emS = -1, shotWant = false;
  function emote(f, P, dt) {
    const E = EMO[K.demo]; if (!E) return f;
    if (K.demo !== emC) { emC = K.demo; emT = 0; emS = -1; }   // (another emote: from its start)
    const S = app.PL.gun?.S;
    if (P.state !== 'idle' || (S && (S.out || S.act))) { emT = 0; emS = -1; return f; }
    emT += dt;
    const end = E.at[E.n]; let x = emT;
    if (x >= end) {
      if (E.loop >= 0) x = E.at[E.loop] + (x - end) % (end - E.at[E.loop]);
      else { x %= end + EMOTE_REST; if (x >= end) { emS = -1; return f; } }
    }
    let s = 0; while (s < E.n - 1 && E.at[s + 1] <= x) s++;
    const fr = E.play ? E.play[s] : s;
    if (s !== emS) {
      emS = s; if (E.shots.has(fr)) shotWant = true;
      if (E.hits.has(fr)) app.feat('audio')?.AU?.play('hit', {mat: 'body'});   // (the gun's butt on a body: the bullets' body hit)
    }
    return nm(K.demo + '.', fr);
  }
  // an emote's shot: a muzzle flash (render/flashes.js, the rig's shared one) at the drawn muzzle along the barrel on screen
  // for SHOT_FX.life s, and his gun's sound (the audio feature's play: at the listener)
  const SHOT = {t: 0, x: 0, y: 0, h: 0, a: 0, len: 0, v: 0};
  function shot() {   // (after compose's aim: MUZ the muzzle, aim.mx / my it on screen, SC the gun's hold on screen)
    toWorld(MUZ[0], MUZ[1], MUZ[2], WP, 0); SHOT.x = WP[0]; SHOT.y = WP[2]; SHOT.h = WP[1];
    const pxm = Math.hypot(aim.mx - SC[0], aim.my - SC[1]) / (Math.hypot(MZ[0], MZ[1], MZ[2]) || .2) / (app.zoom || 1);   // art px a metre along it
    SHOT.a = aim.a; SHOT.len = SHOT_FX.len * pxm; SHOT.v = (Math.random() * 3) | 0; SHOT.t = SHOT_FX.life;
    app.feat('audio')?.AU?.play('gunshot', {gun: LOADOUTS[hero.loadI]?.[2]});
  }
  function flash(dt) {
    if (SHOT.t > 0) { const k = SHOT.t / SHOT_FX.life; flashes.put(SHOT.x, SHOT.y, SHOT.h, SHOT.len * (.7 + .3 * k), SHOT.a, k, SHOT.v, 1); SHOT.t -= dt; }
    flashes.frame();
  }

  // ---------------------------------------------------------------- REACTIONS (K.look, K.hit, K.mlean; docs/exp/livereact.md)
  // What he notices (features/senses.js, a view-only feature: app.feat('senses').S) moves him, over the pose:
  //   LOOK   his head turns to what he looks at (a gunman aiming at him, a shot, an explosion, the nearest hunter, a bird):
  //          a spring toward the held target, drawn at the procedural ticks; the neck up to LOOK.neck deg, the chest the
  //          rest (Spine1 + Spine2, the holstered gun left where it hangs); further round than LOOK.max he doesn't look.
  //          Not while he aims (FLOW's lead has the head), an emote plays, or off his feet
  //   FLINCH a hit bends him along its push (the chest, the head more, the arms flung the other way), stepped at
  //          FLINCH.hz; a knock (the sim's: a brute, a blast) harder and longer; a hit from nowhere (a blast) hunches him
  //   MLEAN  on the move with his gun away: the chest leans into his acceleration (into a turn, forward setting off, back
  //          stopping), as FLOW's lean does while he aims; drawn at the procedural ticks
  // View only: reads the senses and P (state, velocity), writes only this body's own state.
  let SEN = null;
  const LOOK_ON = new Set(['idle', 'move', 'land', 'pose', 'hold', 'backstep', 'draw', 'release', 'slide', 'knock']);
  let lkK = 0, lkY = 0, lkP = 0, lkVY = 0, lkVP = 0, lkTY = 0, lkTP = 0, lkSY = 0, lkSP = 0, lkHave = false;
  // the revolver in his hand or on its way (the gun's own state: drawn, or drawing / holstering / reloading ...), else in its
  // holster (the idle's right hand rests on it there: its distance to the hand can't tell)
  const gunOut = () => { const S = app.PL.gun?.S; return !!S && !!(S.out || S.act); }, holstered = () => GUN >= 0 && !gunOut();
  const GSAVE = new Float64Array(7 * 4), CHEST = Int16Array.of(SPINE1, SPINE2), ARMS2 = Int16Array.of(ARM_L, ARM_R), ARMS1 = Int16Array.of(ARM_L);
  // a turn of the chest (Spine1 + Spine2, half each, about their heads) that leaves a holstered gun where it hangs (the
  // gun is the right hand's child: the hand swings with the chest, the holster doesn't)
  function chestTurn(w, ax, ay, az, a) {
    const held = holstered(), g0 = GUN * 7, gn = held ? (END[GUN] - GUN) * 7 : 0;
    if (held) for (let i = 0; i < gn && i < GSAVE.length; i++) GSAVE[i] = w[g0 + i];
    for (let j = 0; j < 2; j++) { const o = CHEST[j] * 7; axisAngle(ax, ay, az, a / 2, R4); turnTree(w, CHEST[j], R4, w[o + 4], w[o + 5], w[o + 6]); }
    if (held) for (let i = 0; i < gn && i < GSAVE.length; i++) w[g0 + i] = GSAVE[i];
  }
  function look(w, P, dt, sample, free) {
    const L = SEN && SEN.S.look; let want = 0;
    if (K.look && free && L && L.on && LOOK_ON.has(P.state) && NECK >= 0) {
      // where he looks, in his body space (the world -> his frame: the facing's turn is its own inverse), from his neck
      const dx = L.x - AX, dz = L.y - AZ, bx = fc * dx - fs * dz, by = -fs * dx - fc * dz, o = NECK * 7;
      const hx = bx - w[o + 4], hy = by - w[o + 5], d = Math.hypot(hx, hy), ty = Math.atan2(hx, -hy);   // (his front is -y, his left +x)
      if (d > .4 && Math.abs(ty) <= LOOK.max * DEG) {
        const M = (LOOK.neck + LOOK.chest) * DEG, H = LOOK.hyst * DEG, tyc = Math.max(-M, Math.min(M, ty));
        const tp = Math.max(-LOOK.down * DEG, Math.min(LOOK.up * DEG, Math.atan2(L.h - AY - w[o + 6], d)));
        if (!lkHave || Math.abs(tyc - lkTY) > H || Math.abs(tp - lkTP) > H) { lkTY = tyc; lkTP = tp; lkHave = true; }   // (held within hyst)
        want = 1;
      }
    }
    lkK = dt > 0 ? (want > lkK ? Math.min(want, lkK + dt / LOOK.fade) : Math.max(want, lkK - dt / LOOK.fade)) : want;
    if (lkK <= 0) { lkY = lkP = lkVY = lkVP = lkSY = lkSP = 0; lkHave = false; return; }
    const lw = LOOK.danger.has(L.kind) ? LOOK.fast : LOOK.w, n = Math.max(1, Math.ceil(dt / .008)), h = dt / n, W2 = lw * lw, Z2 = 2 * LOOK.z * lw;
    for (let i = 0; i < n; i++) { lkVY += (W2 * (lkTY - lkY) - Z2 * lkVY) * h; lkY += lkVY * h; lkVP += (W2 * (lkTP - lkP) - Z2 * lkVP) * h; lkP += lkVP * h; }
    if (!K.step || sample) { lkSY = lkY; lkSP = lkP; }
    const k = lkK * lkK * (3 - 2 * lkK), Y = lkSY * k, Pp = lkSP * k, N = LOOK.neck * DEG;
    const ny = Math.max(-N, Math.min(N, Y)), cy = Y - ny, o = NECK * 7;
    // the neck: its pitch about his side first (+ up), then its turn about his up; then the chest's share turns them all
    if (Math.abs(Pp) > .3 * DEG) { axisAngle(1, 0, 0, -Pp, R4); turnTree(w, NECK, R4, w[o + 4], w[o + 5], w[o + 6]); }
    if (Math.abs(ny) > .3 * DEG) { axisAngle(0, 0, 1, ny, R4); turnTree(w, NECK, R4, w[o + 4], w[o + 5], w[o + 6]); }
    if (Math.abs(cy) > .3 * DEG && SPINE1 >= 0 && SPINE2 >= 0) chestTurn(w, 0, 0, 1, cy);
  }
  let flN = -1, flT = 99, flDur = 1, flK = 0, flX = 0, flY = 0;
  function flinch(w, P, dt, aiming) {
    const H = SEN && SEN.S.hit;
    if (H && flN >= 0 && H.n !== flN && K.hit) {
      const kn = P.state === 'knock';
      flT = 0; flK = H.k * (kn ? FLINCH.knock : 1); flDur = FLINCH.dur * (kn ? 1.3 : 1);
      flX = fc * H.dx - fs * H.dy; flY = -fs * H.dx - fc * H.dy;   // (the push into his frame)
    }
    if (H) flN = H.n;
    if (flT >= flDur) return;
    flT += dt;
    const r = FLINCH.rise / flDur, tq = K.step ? Math.floor(flT * FLINCH.hz) / FLINCH.hz : flT, u = Math.min(1, tq / flDur);
    const e = (u < r ? u / r : ((1 - u) / (1 - r)) ** 2) * flK;
    if (e <= .01) return;
    // the axis that takes his top along the push (up x push); no push: about his side, the top forward (a hunch)
    let ax = -flY, ay = flX; const l = Math.hypot(ax, ay);
    if (l < 1e-3) { ax = 1; ay = 0; } else { ax /= l; ay /= l; }
    if (SPINE >= 0) { const o = SPINE * 7; axisAngle(ax, ay, 0, FLINCH.chest * e * DEG, R4); turnTree(w, SPINE, R4, w[o + 4], w[o + 5], w[o + 6]); }
    if (NECK >= 0) { const o = NECK * 7; axisAngle(ax, ay, 0, FLINCH.head * e * DEG, R4); turnTree(w, NECK, R4, w[o + 4], w[o + 5], w[o + 6]); }
    const held = holstered(), g0 = GUN * 7, gn = held ? (END[GUN] - GUN) * 7 : 0;
    if (held) for (let i = 0; i < gn && i < GSAVE.length; i++) GSAVE[i] = w[g0 + i];
    const AR = aiming ? ARMS1 : ARMS2;
    for (let j = 0; j < AR.length; j++) {   // (the arms lag: flung the other way; the aiming arm stays on the aim)
      const b = AR[j]; if (b < 0) continue; const o = b * 7; axisAngle(ax, ay, 0, -FLINCH.arm * e * DEG, R4); turnTree(w, b, R4, w[o + 4], w[o + 5], w[o + 6]);
    }
    if (held) for (let i = 0; i < gn && i < GSAVE.length; i++) w[g0 + i] = GSAVE[i];
  }
  let mlvx = NaN, mlvy = 0, mlax = 0, mlay = 0, mlyaw = NaN, mlK = 0, mlR = 0, mlP = 0;
  function mlean(w, P, dt, phiV, yaw, free, sample) {
    const vx = P.vx || 0, vy = P.vy || 0;
    if (!(mlvx === mlvx) || yaw !== mlyaw || dt <= 0) { mlvx = vx; mlvy = vy; mlyaw = yaw; return; }   // (a camera turn turns P's velocity: skipped)
    const k = 1 - Math.exp(-dt / MLEAN.tau); mlax += ((vx - mlvx) / dt - mlax) * k; mlay += ((vy - mlvy) / dt - mlay) * k; mlvx = vx; mlvy = vy;
    const want = K.mlean && free && (P.state === 'move' || P.state === 'idle') ? 1 : 0;
    mlK = want > mlK ? Math.min(want, mlK + dt / MLEAN.fade) : Math.max(want, mlK - dt / MLEAN.fade);
    if (mlK <= 0 || SPINE < 0) { mlR = mlP = 0; return; }
    if (!K.step || sample) {
      const c = Math.cos(phiV), s = Math.sin(phiV), bx = c * mlax - s * mlay, by = -s * mlax - c * mlay;   // (into his frame)
      mlR = Math.max(-MLEAN.side, Math.min(MLEAN.side, bx * MLEAN.k)); mlP = Math.max(-MLEAN.back, Math.min(MLEAN.fwd, -by * MLEAN.k));
    }
    const R = mlR * mlK, Pt = mlP * mlK; if (Math.abs(R) < .5 && Math.abs(Pt) < .5) return;
    const o = SPINE * 7;
    axisAngle(0, 1, 0, R * DEG, R4); turnTree(w, SPINE, R4, w[o + 4], w[o + 5], w[o + 6]);    // (top toward +x: his left)
    axisAngle(1, 0, 0, Pt * DEG, R4); turnTree(w, SPINE, R4, w[o + 4], w[o + 5], w[o + 6]);   // (top toward -y: ahead)
  }
  // (the hold's extra test: two points .2 m off the head across its length, carried by it, on screen: a turn of the head
  // about its own length (the look) moves no bone's tip, but the face and the hat's brim turn with it)
  const HT = new Float64Array(3), HA = [0, 0, 0], HB = [0, 0, 0];
  function headTurned(a, b) {
    if (HEAD < 0 || !(lkK > 0 || flT < flDur)) return false;
    const o = HEAD * 7;
    for (let k = 0; k < 2; k++) {
      qrot(a, o, k ? 0 : .2, 0, k ? .2 : 0, HT, 0); screenOf(a[o + 4] + HT[0], a[o + 5] + HT[1], a[o + 6] + HT[2], HA);
      qrot(b, o, k ? 0 : .2, 0, k ? .2 : 0, HT, 0); screenOf(b[o + 4] + HT[0], b[o + 5] + HT[1], b[o + 6] + HT[2], HB);
      if (Math.abs(HA[0] - HB[0]) >= 1 || Math.abs(HA[1] - HB[1]) >= 1) return true;
    }
    return false;
  }
  // (TRANSITIONS: a holstered revolver is the right hand's child, so blending the bones' local turns flew it along with a
  // big swing of the arm (a leap into a hang): held in the holster in both, it rides the blended hips as it sits on the
  // target's (gun world = blended hips x target hips^-1 x target gun))
  const HQ = new Float64Array(4), HQ2 = new Float64Array(4), HV = new Float64Array(3);
  function holster(tgt, w) {
    if (HIPS < 0 || !holstered()) return;
    const h = HIPS * 7;
    QI[0] = -tgt[h]; QI[1] = -tgt[h + 1]; QI[2] = -tgt[h + 2]; QI[3] = tgt[h + 3]; qmul(w, h, QI, 0, HQ, 0);   // (the hips' turn from the target to the blend)
    for (let b = GUN; b < END[GUN]; b++) {
      const o = b * 7; qmul(HQ, 0, tgt, o, HQ2, 0); qrot(HQ, 0, tgt[o + 4] - tgt[h + 4], tgt[o + 5] - tgt[h + 5], tgt[o + 6] - tgt[h + 6], HV, 0);
      w[o] = HQ2[0]; w[o + 1] = HQ2[1]; w[o + 2] = HQ2[2]; w[o + 3] = HQ2[3]; w[o + 4] = w[h + 4] + HV[0]; w[o + 5] = w[h + 5] + HV[1]; w[o + 6] = w[h + 6] + HV[2];
    }
  }
  // ---- WEATHER (K.wx): the weather at his spot (the senses' S.wx) on his body: a hand on the hat in a gust and a lean into
  // the wind, the rain's hunch and a hand over the eyes, the cold's hug and shivers. Not while he aims or plays an emote;
  // the hand on the hat while he runs too, the others standing or walking
  const SHOULDER_L = B_('LeftShoulder'), SHOULDER_R = B_('RightShoulder'), HAT = B_('HatHold0');
  const HDL = new Float64Array(9), HDW = new Float64Array(9);
  let hdOk = false, hatK = 0, hatOn = false, hatT = 0, rainK = 0, shadeK = 0, coldK = 0, hugK = 0, shivT = 0, shivNext = 3, windK = 0;
  const WX_ON = new Set(['idle', 'move', 'pose', 'land', 'backstep', 'hold']);
  const ease = (k, want, dt, fade) => want > k ? Math.min(want, k + dt / fade) : Math.max(want, k - dt / fade);
  // the head's front, left and up now (body space): idle.0's head frame calibrates them once (the head's own axes)
  function headFrame(w) {
    const o = HEAD * 7;
    if (!hdOk) { const I = poseOf('idle.0'); if (!I) return false; const q = I.w; QI[0] = -q[o]; QI[1] = -q[o + 1]; QI[2] = -q[o + 2]; QI[3] = q[o + 3];
      qrot(QI, 0, 0, -1, 0, HDL, 0); qrot(QI, 0, 1, 0, 0, HDL, 3); qrot(QI, 0, 0, 0, 1, HDL, 6); hdOk = true; }
    for (let k = 0; k < 3; k++) qrot(w, o, HDL[k * 3], HDL[k * 3 + 1], HDL[k * 3 + 2], HDW, k * 3);
    return true;
  }
  // an arm's hand onto body-space point T, k of the way from where it is posed (two-bone IK; a holstered revolver kept)
  function reachTo(w, left, Tx, Ty, Tz, k) {
    const a = left ? ARM_L : ARM_R, b = left ? FARM_L : FARM_R, c = left ? HAND_L : HAND_R; if (a < 0 || b < 0 || c < 0 || k <= .01) return;
    const o = c * 7, x = w[o + 4] + (Tx - w[o + 4]) * k, y = w[o + 5] + (Ty - w[o + 5]) * k, z = w[o + 6] + (Tz - w[o + 6]) * k;
    const held = !left && holstered(), g0 = GUN * 7, gn = held ? (END[GUN] - GUN) * 7 : 0;
    if (held) for (let i = 0; i < gn && i < GSAVE.length; i++) GSAVE[i] = w[g0 + i];
    ikLeg(w, a, b, c, x, y, z);
    if (held) for (let i = 0; i < gn && i < GSAVE.length; i++) w[g0 + i] = GSAVE[i];
  }
  // the shoulders up by a deg (each clavicle about his front axis at its root; a holstered revolver kept)
  function shrug(w, a) {
    if (SHOULDER_L < 0 || SHOULDER_R < 0 || Math.abs(a) < .2) return;
    const held = holstered(), g0 = GUN * 7, gn = held ? (END[GUN] - GUN) * 7 : 0;
    if (held) for (let i = 0; i < gn && i < GSAVE.length; i++) GSAVE[i] = w[g0 + i];
    let o = SHOULDER_L * 7; axisAngle(0, 1, 0, -a * DEG, R4); turnTree(w, SHOULDER_L, R4, w[o + 4], w[o + 5], w[o + 6]);
    o = SHOULDER_R * 7; axisAngle(0, 1, 0, a * DEG, R4); turnTree(w, SHOULDER_R, R4, w[o + 4], w[o + 5], w[o + 6]);
    if (held) for (let i = 0; i < gn && i < GSAVE.length; i++) w[g0 + i] = GSAVE[i];
  }
  // ---- THE TRIP (features/trip.js: the fly agaric broth, its F.k 0..1): a slow drunken sway through the chest and the head while
  // it lasts. Friends see it as well: they are sent the drawn pose's bones (features/coop.js)
  let tripT = 0, TRIP = null;
  function wobble(w, dt) {
    TRIP ??= app.feat('trip'); const k = TRIP?.k || 0;
    if (k <= .01 || SPINE < 0) { tripT = 0; return; }
    tripT += dt; const o = SPINE * 7, n = NECK * 7;
    axisAngle(0, 1, 0, Math.sin(tripT * 1.3) * 6 * k * DEG, R4); turnTree(w, SPINE, R4, w[o + 4], w[o + 5], w[o + 6]);   // (rolled about his front)
    axisAngle(1, 0, 0, Math.sin(tripT * .8 + 1) * 3 * k * DEG, R4); turnTree(w, SPINE, R4, w[o + 4], w[o + 5], w[o + 6]);
    if (NECK >= 0) { axisAngle(0, 1, 0, Math.sin(tripT * 1.7 + 2) * 7 * k * DEG, R4); turnTree(w, NECK, R4, w[n + 4], w[n + 5], w[n + 6]); }
  }
  // ---- HICCUPS (features/meals.js: something odd off the Try stick; its F.hicN counts them): each one a little hop of the whole
  // body (m up, s) with the head jerking back. Friends see it too (the drawn pose's bones)
  const HIC = {h: .05, dur: .22, head: 9};
  let hicN = -1, hicT = HIC.dur, MEALS_F = null;
  function hiccup(w, dt) {
    MEALS_F ??= app.feat('meals'); const n = MEALS_F?.hicN ?? 0;
    if (n !== hicN) { if (hicN >= 0) hicT = 0; hicN = n; }
    if (hicT >= HIC.dur) return;
    hicT += dt; const e = Math.sin(Math.PI * Math.min(1, hicT / HIC.dur));
    if (NECK >= 0) { const o = NECK * 7; axisAngle(1, 0, 0, -HIC.head * e * DEG, R4); turnTree(w, NECK, R4, w[o + 4], w[o + 5], w[o + 6]); }
    for (let i = 6; i < w.length; i += 7) w[i] += HIC.h * e;
  }
  function weather(w, P, dt, sample, free) {
    const X = SEN && SEN.S.wx, on = !!(K.wx && free && X && WX_ON.has(P.state) && HEAD >= 0), slow = Math.hypot(P.vx || 0, P.vy || 0) < 2.3 && P.state !== 'land';
    // the hat: held through a gust, let go a while after it has eased
    if (on && X.wind > WX.hat.on) { hatOn = true; hatT = 0; } else if (hatOn && (!on || X.wind < WX.hat.off) && (hatT += dt) > WX.hat.hold) hatOn = false;
    hatK = ease(hatK, on && hatOn ? 1 : 0, dt, WX.hat.fade);
    windK = ease(windK, on ? Math.max(0, Math.min(1, (X.wind - 1.2) / 1.8)) : 0, dt, .4);
    rainK = ease(rainK, on ? Math.max(0, Math.min(1, (X.rain - WX.rain.on) / (WX.rain.full - WX.rain.on))) : 0, dt, WX.rain.fade);
    shadeK = ease(shadeK, on && slow && hatK < .05 && X.rain > WX.rain.shade ? 1 : 0, dt, WX.rain.fade);
    coldK = ease(coldK, on ? Math.max(0, Math.min(1, (X.cold - WX.cold.on) / (WX.cold.full - WX.cold.on))) : 0, dt, WX.cold.fade);
    hugK = ease(hugK, on && slow && hatK < .05 && shadeK < .05 && !gunOut() && coldK > .3 ? 1 : 0, dt, WX.cold.fade);
    stats.wx = hatK > .5 ? 'hat' : shadeK > .5 ? 'shade' : hugK > .5 ? 'hug' : rainK > .3 ? 'hunch' : '';
    if (hatK + windK + rainK + shadeK + coldK + hugK <= 0 || !headFrame(w)) return;
    const o = SPINE * 7, n = NECK * 7;
    // into the wind: the chest's top against the way it blows, the head down in a gust
    if (windK > 0 && SPINE >= 0) {
      const bx = -(fc * X.wdx - fs * X.wdy), by = -(-fs * X.wdx - fc * X.wdy), l = Math.hypot(bx, by);
      if (l > .1) { axisAngle(-by / l, bx / l, 0, WX.lean.max * windK * DEG, R4); turnTree(w, SPINE, R4, w[o + 4], w[o + 5], w[o + 6]); }
    }
    // the rain's hunch (and the cold's): shoulders up, the chest forward, the head down (and in a gust)
    const hunch = Math.max(rainK, coldK * .7);
    if (hunch > 0) { shrug(w, WX.rain.shoulder * hunch); if (SPINE >= 0) { axisAngle(1, 0, 0, WX.rain.chest * hunch * DEG, R4); turnTree(w, SPINE, R4, w[o + 4], w[o + 5], w[o + 6]); } }
    const down = WX.rain.head * hunch + WX.lean.head * hatK;
    if (down > .3 && NECK >= 0) { axisAngle(1, 0, 0, down * DEG, R4); turnTree(w, NECK, R4, w[n + 4], w[n + 5], w[n + 6]); }
    headFrame(w);   // (after the chest and the neck moved: the head's axes now)
    const F = HDW, h = (HAT >= 0 ? HAT : HEAD) * 7;
    // the left hand on the brim: before the band, to his left, a little over it
    if (hatK > 0) reachTo(w, true, w[h + 4] + F[0] * WX.hat.fwd + F[3] * WX.hat.side + F[6] * WX.hat.up, w[h + 5] + F[1] * WX.hat.fwd + F[4] * WX.hat.side + F[7] * WX.hat.up,
      w[h + 6] + F[2] * WX.hat.fwd + F[5] * WX.hat.side + F[8] * WX.hat.up, hatK);
    // the left hand over the eyes: before the brow, under the brim
    const e = HEAD * 7;
    if (shadeK > 0) reachTo(w, true, w[e + 4] + F[0] * .17 + F[3] * .03 + F[6] * .1, w[e + 5] + F[1] * .17 + F[4] * .03 + F[7] * .1, w[e + 6] + F[2] * .17 + F[5] * .03 + F[8] * .1, shadeK);
    // the hug: each hand on the other arm, before the chest
    if (hugK > 0 && ARM_L >= 0 && ARM_R >= 0) {
      const L = ARM_L * 7, R = ARM_R * 7, fx = F[0] * .11, fy = F[1] * .11;
      reachTo(w, true, w[R + 4] * .6 + w[L + 4] * .1 + fx, w[R + 5] * .6 + w[L + 5] * .1 + fy + w[o + 5] * .3, w[R + 6] - .14, hugK);
      reachTo(w, false, w[L + 4] * .6 + w[R + 4] * .1 + fx, w[L + 5] * .6 + w[R + 5] * .1 + fy + w[o + 5] * .3, w[L + 6] - .16, hugK);
    }
    // the shivers: bursts while he stands in the cold, stepped at the shiver's own rate
    if (coldK > .3 && P.state === 'idle') {
      shivT += dt; if (shivT > shivNext + WX.cold.burst) { shivT = 0; shivNext = WX.cold.every[0] + Math.random() * (WX.cold.every[1] - WX.cold.every[0]); }
      if (shivT > shivNext) { const sg = Math.floor((shivT - shivNext) * WX.cold.hz) % 2 ? 1 : -1; shrug(w, WX.cold.deg * sg * coldK); stats.wx = 'shiver';
        if (SPINE1 >= 0) { const q = SPINE1 * 7; axisAngle(0, 1, 0, WX.cold.chest * sg * coldK * DEG, R4); turnTree(w, SPINE1, R4, w[q + 4], w[q + 5], w[q + 6]); } }
    } else shivT = 0;
  }
  // ---------------------------------------------------------------- IDLES (K.idle; docs/exp/livereact.md)
  // Standing still and calm (the sim's idle, the gun holstered, no emote, nothing dangerous the senses know of, no weather on
  // him), he does something of his own, by the clip's own timing (play / ms; looping from marks.loop):
  //   after IDLE.spot s, a context move where there is a place for one within reach (the senses' spot()): cx_sit on a seat,
  //     cx_lean against a wall, cx_drink at the water. The body is drawn there: its origin eased onto the spot (the sim keeps
  //     him where he stopped: at most the spot's reach away), turned the spot's way once halfway (the TRANSITIONS blend turns
  //     him); seated, the hips stay on the seat and the legs reach the ground; drinking, the hand goes into the water at
  //     marks.dip
  //   else after IDLE.shift s, the weight shift (id_shift) as his idle, and every 6-12 s a fidget (IDLE.fidgets) once
  // Anything else (a move, a draw, a hit, danger, rain or cold on him) ends it at once; the body eases back.
  const CLT = new Map();   // (a clip's timing: its steps' start times, its loop's step)
  function timing(name) {
    let T = CLT.get(name); if (T) return T;
    const C = CL[name]; if (!C) return null;
    const n = C.play ? C.play.length : C.frames, at = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) at[i + 1] = at[i] + (C.ms ? C.ms[i] / 1000 : 1 / C.fps);
    T = {n, at, loop: C.marks?.loop ?? -1, play: C.play || null}; CLT.set(name, T); return T;
  }
  // the clip's frame at time t (looping from its loop step); a one-shot past its end: -1
  function frameAt(T, t) {
    const end = T.at[T.n];
    if (t >= end) { if (T.loop < 0) return -1; t = T.at[T.loop] + (t - end) % (end - T.at[T.loop]); }
    let st = 0; while (st < T.n - 1 && T.at[st + 1] <= t) st++;
    return T.play ? T.play[st] : st;
  }
  const CX = {kind: '', x: 0, y: 0, h: 0, face: 0, wx: 0, wy: 0, wh: 0, d: 0, px: 0, py: 0};   // (the spot he took: the senses' copied; px, py: where the sim had him then)
  let idK = '', idClip = '', idT = 0, idCalm = 0, idSpotT = 0, idNext = 8, cxK = 0, cxOn = false, hipSit = NaN;
  const rnd = (a, b) => a + Math.random() * (b - a);
  function calmNow(P) {
    if (!K.idle || P.state !== 'idle' || gunOut() || K.demo || !SEN || lsBusy()) return false;   // (LASSO: the rope work isn't idling)
    const S = SEN.S; if (S.aimedAt > 0 || S.hit.t < IDLE.calm || (S.look.on && LOOK.danger.has(S.look.kind))) return false;
    return hatK < .05 && shadeK < .05 && hugK < .05;
  }
  function idles(f, P, dt) {
    SEN ??= app.feat('senses');
    const pl = app.player, moved = idK === 'cx' && Math.hypot(pl.x - CX.px, pl.y - CX.py) > .25;   // (put somewhere else: a teleport, a respawn)
    const calm = calmNow(P) && !moved;
    idCalm = calm ? idCalm + dt : 0;
    if (!calm) { idK = ''; idClip = ''; cxOn = false; idSpotT = 0; }
    cxK = cxOn ? Math.min(1, cxK + dt / IDLE.ease) : Math.max(0, cxK - dt / (IDLE.ease * .4));
    if (!cxK && !cxOn) CX.kind = '';
    if (!calm) return f;
    if ((!idK || idK === 'shift') && idCalm > IDLE.spot && (idSpotT -= dt) <= 0) {   // a place for a context move?
      idSpotT = IDLE.retry;
      const sp = SEN.spot && SEN.spot(), clip = sp ? sp.kind === 'sit' ? 'cx_sit' : sp.kind === 'lean' ? 'cx_lean' : 'cx_drink' : '';
      if (sp && CL[clip]) { Object.assign(CX, sp); CX.px = pl.x; CX.py = pl.y; idK = 'cx'; idClip = clip; idT = 0; cxOn = true; }
    }
    if (!idK && idCalm > IDLE.shift && CL.id_shift) { idK = 'shift'; idClip = 'id_shift'; idT = 0; idNext = rnd(IDLE.every[0], IDLE.every[1]); }
    if (idK === 'shift' && (idNext -= dt) <= 0) {   // a fidget, once
      let c = '', n = 0; do c = IDLE.fidgets[(Math.random() * IDLE.fidgets.length) | 0]; while (!CL[c] && ++n < 8);
      if (CL[c]) { idK = 'fidget'; idClip = c; idT = 0; }
      idNext = rnd(IDLE.every[0], IDLE.every[1]);
    }
    stats.idle = idK ? idClip : '';   // (dev)
    if (!idK) return f;
    idT += dt;
    const T = timing(idClip); if (!T) { idK = ''; return f; }
    let fr = frameAt(T, idT);
    if (fr < 0) { idK = 'shift'; idClip = 'id_shift'; idT = 0; const T2 = timing(idClip); if (!T2) { idK = ''; return f; } fr = frameAt(T2, 0); }   // (a fidget's end: back to the shift)
    return nm(idClip + '.', fr);
  }
  // the drawn facing: the spot's once the move is halfway in (snapped to the knobs' facings, as facing() does)
  function cxFace(phi, yaw) {
    if (!(cxK > .5) || !CX.kind) return phi;
    if (!K.face) return CX.face;
    const q = TAU / K.face; return yaw + Math.round((CX.face - yaw) / q) * q;
  }
  // the body's origin onto the spot (AX / AY / AZ: compose's anchor), eased: seated, the hips at the seat's top
  function cxPlace() {
    if (!(cxK > 0) || !CX.kind) return;
    const e = cxK * cxK * (3 - 2 * cxK);
    let h = CX.h;
    if (CX.kind === 'sit') { if (!(hipSit === hipSit)) { const S = poseOf('cx_sit.4'); hipSit = S && HIPS >= 0 ? S.w[HIPS * 7 + 6] : .47; } h = CX.h - hipSit; }
    AX += (CX.x - AX) * e; AZ += (CX.y - AZ) * e; AY += (h - AY) * e;
  }
  // after the feet: seated, the hips stay on the seat (feet() lowered the body to the lower foot's ground) and each leg
  // reaches the ground; drinking, the right hand into the water at the dip
  function cxBody(w, f) {
    if (!(cxK > 0) || !CX.kind) return;
    if (CX.kind === 'sit' && FEET_OK) {
      const d = stats.drop || 0; if (d) for (let i = 0; i < NB; i++) w[i * 7 + 6] -= d;
      if (!(F0A === F0A)) { const I = poseOf('idle.0'); F0A = I && FOOT_L >= 0 ? I.w[FOOT_L * 7 + 6] : .08; }
      for (let k = 0; k < 2; k++) {
        const ft = FT[k], o = ft * 7, X = fc * w[o + 4] - fs * w[o + 5] + AX, Z = -fs * w[o + 4] - fc * w[o + 5] + AZ, g = elev(X, Z) - AY + F0A;
        if (Math.abs(g - w[o + 6]) > .01 && Math.abs(g - w[o + 6]) < .5) ikLeg(w, FU[k], FL[k], ft, w[o + 4], w[o + 5], g);
      }
    }
    if (CX.kind === 'drink' && cxK > .9) {
      const pc = parse(f), M = CL[pc.clip]?.marks;
      if (M && M.dip === pc.i) {
        const dx = CX.wx - AX, dz = CX.wy - AZ;
        reachTo(w, false, fc * dx - fs * dz, -fs * dx - fc * dz, CX.wh - AY + .03, 1);
      }
    }
  }
  function reactReset() { idK = ''; idClip = ''; idCalm = 0; cxK = 0; cxOn = false; CX.kind = ''; hatK = hatT = rainK = shadeK = coldK = hugK = shivT = windK = 0; hatOn = false; lkK = 0; lkHave = false; lkY = lkP = lkVY = lkVP = lkSY = lkSP = 0; flT = 99; flN = -1; mlvx = NaN; mlK = 0; mlR = mlP = 0; }

  // ---------------------------------------------------------------- the frame
  // the facing: his facing in the world without the camera's 16-step rounding ((P.face + faceRest) steps + yaw), eased
  // (smooth) or as the sim has it (step), then snapped relative to the camera (K.face) or left free
  function facing(P, yaw, dt) {
    const ND = hero.ND, st = TAU / ND, rest = pa.faceRest ?? 0, tru = (P.face + rest) * st + yaw;
    if (K.step || !(wf === wf)) wf = tru;
    else { const d = wrap(tru - wf), m = TURN * dt; wf = Math.abs(d) <= m ? tru : wf + Math.sign(d) * m; }
    if (!K.face) return wf;
    const q = TAU / K.face; return yaw + Math.round((wf - yaw) / q) * q;
  }
  const SPRO = {img: null, nrm: null, px: 0, py: 0, x: 0, y: 0, h: 0, frame: '', face: 0};
  function compose(PX, PY, perf) {
    const t0 = performance.now(), P = app.P, yaw = app.yaw, dt = lastT < 0 ? 0 : Math.min(.05, Math.max(0, (t0 - lastT) / 1000));
    perf?.begin('live.pose', 'char');
    hero.card.setVisible(false);
    t += dt; lastT = t0;   // (the view's own clock: the frame's real time)
    const sinkPx = Math.round((P.sink || 0) * 22);
    // 1) the frame and its clip, the time it has shown
    const mv = motion(P, dt), f = emote(idles(mv || (poseOf(P.frame) ? P.frame : 'idle.0'), P, dt), P, dt), p = parse(f);   // (MOTION: the live movement clips; IDLES)
    if (f !== frameNow) { frameNow = f; frameT = 0; } else frameT += dt;
    const S = app.PL.gun?.S, proc = K.proc, flowOn = K.flow && proc;
    const cb = flowOn ? combat(f, p, P, S, dt) : null, ck = cb ? cb.key : p.clip;   // (COMBAT STYLE: its stance / draw)
    if (ck !== clipNow) {   // a clip change cross-fades (smooth); a stance's change always (COMBAT.fade); with TRANSITIONS
      // on, neither: the blend after the aim carries it (a fade here would have the aim solved on a half-blended pose)
      const cbf = flowOn && (ck.startsWith('cb:') || clipNow.startsWith('cb:'));
      if (haveShow && (!K.step || cbf) && !(flowOn && K.blend)) { Lfrom.set(Ll); fadeT = 0; fadeDur = cbf ? COMBAT.fade : FADE; }
      clipNow = ck;
    }
    // 2) the base pose (world, body space) into Wt
    let baseName = f, layer = '', upper = -1, aiming = false, upName = '';
    if (cb && cb.base) { baseName = cb.base; aiming = cb.aim; if (cb.upper) { layer = 'upper'; upName = cb.upper; } }   // COMBAT STYLE: the stance / the draw (/ a reload over its legs)
    else if (toolUp) { layer = 'upper'; upName = toolUp; }   // TOOL: a swing over his steps (toolMotion)
    else if (proc && p.fam && (p.fam === 'gws' || p.fam === 'grs') && XFAMS.has(p.tw)) { aiming = true; }   // an angle (over the shoulder, across): itself, trimmed
    else if (proc && p.fam && (p.fam === 'gws' || p.fam === 'grs')) { baseName = nm(p.fam + '_0_', p.i); aiming = true; if (cb && cb.upper) { layer = 'upper'; upName = cb.upper; } }   // aim on the move: the twist-0 pose (and a stance's upper body)
    else if (proc && (f.startsWith('gun_aim') || (K.flow && f.startsWith('gun_fire')))) { baseName = 'gun_aim'; aiming = true; }   // the standing twists (and with FLOW the kick): gun_aim
    else if (proc && p.fam && (p.fam === 'gwr' || p.fam === 'grr') && S) { baseName = nm(p.loco + '.', p.i); layer = 'reload'; upper = reloadAt(S); }
    if (K.demo === 'swing') baseName = poseOf('reach_up') ? 'reach_up' : 'idle.0';
    const A = poseOf(baseName) || poseOf(f);
    // TRANSITIONS: has what is drawn switched? (parse()'s clip names are cached strings: no allocation)
    const tbPrev = tbClip;   // (FISTS: the clip before, for the string's short blend)
    const tbOn = flowOn && K.blend, bclip = parse(baseName).clip, uclip = upName ? parse(upName).clip : '', swap = tbOn && tbHave &&
      (bclip !== tbClip || layer !== tbLayer || uclip !== tbUp || aiming !== tbAim);
    tbClip = bclip; tbLayer = layer; tbUp = uclip; tbAim = aiming;
    if (!K.step) {   // smooth: toward the next frame
      const nx = next(baseName === f ? p : parse(baseName), P, f), B = nx.name && poseOf(nx.name);
      if (B) blendLocal(A.l, B.l, nx.u, Ll); else Ll.set(A.l);
    } else Ll.set(A.l);
    if (fadeT < 1) { fadeT = Math.min(1, fadeT + dt / fadeDur); blendLocal(Lfrom, Ll, fadeT * fadeT * (3 - 2 * fadeT), Ltmp); Ll.set(Ltmp); }
    fk(Ll, Wt);
    if (GUN >= 0 && !K.step) {   // the gun held away from the hand (the holster) blends in body space, not along the arm
      const nx = NX.name ? poseOf(NX.name) : null;
      if (nx && !(gunNear(A.w) && gunNear(nx.w))) { const o = GUN * 7; slerp(A.w, o, nx.w, o, NX.u, Wt, o); for (let k = 4; k < 7; k++) Wt[o + k] = A.w[o + k] + (nx.w[o + k] - A.w[o + k]) * NX.u; }
    }
    // the procedural time: sampled at STEP_HZ (step) or every frame
    const tk = Math.floor(t * STEP_HZ), sample = !K.step || tk !== stepK; if (sample) { stepK = tk; sampT = K.step ? tk / STEP_HZ : t; }
    // 3) layering: the reload's upper body (Spine and up, as posed in the stand) over these legs, the spine's base on theirs
    if (layer === 'reload' || layer === 'upper') {   // (or a combat stance's upper body over the gait)
      const a = Math.floor(upper), u = K.step || layer === 'upper' ? 0 : upper - a, RA = layer === 'upper' ? poseOf(upName) : poseOf(nm('gun_reload.', a)),
        RB = layer === 'upper' ? null : poseOf(nm('gun_reload.', Math.min(a + 1, (CL.gun_reload?.frames || 13) - 1)));
      if (RA && SPINE >= 0) {
        if (RB && u > 0) { blendLocal(RA.l, RB.l, u, Ltmp); fk(Ltmp, Wb); } else Wb.set(RA.w);
        const o = SPINE * 7, dx = Wt[o + 4] - Wb[o + 4], dy = Wt[o + 5] - Wb[o + 5], dz = Wt[o + 6] - Wb[o + 6];
        for (let i = SPINE; i < END[SPINE]; i++) { const k = i * 7; for (let j = 0; j < 4; j++) Wt[k + j] = Wb[k + j]; Wt[k + 4] = Wb[k + 4] + dx; Wt[k + 5] = Wb[k + 5] + dy; Wt[k + 6] = Wb[k + 6] + dz; }
        if (p.loco === 'run') { axisAngle(1, 0, 0, 6 * DEG, R4); turnTree(Wt, SPINE, R4, Wt[o + 4], Wt[o + 5], Wt[o + 6]); }   // the run's lean (western.py _on_legs)
      }
    }
    // 4) the facing and the anchor
    const phi = rwFace(cxFace(facing(P, yaw, dt), yaw));   // (IDLES: a context move's own facing; ROPEWALL: square to the face)
    fc = Math.cos(phi); fs = Math.sin(phi); AX = PX; AY = P.z - sinkPx / ctxO.PPMH; AZ = PY; FX = -Math.sin(yaw); FZ = -Math.cos(yaw);
    cxPlace();   // (IDLES: the body onto the spot)
    rwPlace(Wt);   // ROPEWALL: the boots' soles on the face
    feet(Wt, P, dt);   // FEET ON THE GROUND: each foot on the ground under it, the body down by the lower one
    plants(Wt, P, f);   // ADAPTIVE JUMPS: the hands and the feet on the real obstacle
    cxBody(Wt, f);   // IDLES: seated, the hips on the seat; drinking, the hand in the water
    lassoIK(Wt);   // LASSO: the spinning hand on the loop's circle
    // 5) aim at any angle: the twist onto the cursor (held by the hysteresis, sampled with the step)
    if (aiming && GUN >= 0) {   // (and at once when the legs re-plant or turn: a stale twist on new legs points anywhere)
      if (sample || !(twistHeld === twistHeld) || phi !== aimPhi || baseName !== aimBase) {
        twist = aimTwist(Wt, twist, XFAMS.has(p.tw) ? XLIM : undefined); twistHeld = phi !== aimPhi || baseName !== aimBase ? twist : hystOf(twistHeld, twist); aimPhi = phi; aimBase = baseName;
      }
      const bigTurn = Math.abs(wrap(phi - aimSpringPhi)) > 60 * DEG; aimSpringPhi = phi;   // (a pivot: the spring restarts there too)
      twistShown = flowOn ? Math.max(-110 * DEG, Math.min(110 * DEG, aimFlow(phi, twistHeld, dt, sample, swap || bigTurn))) : twistHeld;
      spineTwist(Wt, twistShown);
      if (flowOn) {   // FLOW: the head leads, the arm trails, the free arm pumps on the move, the chest leans into it
        lead(Wt, twistHeld - twistShown);
        if (p.fam === 'gws' || p.fam === 'grs') pump(Wt, p.fam === 'grs');
        lean(Wt, P, dt, phi - yaw, yaw);
      }
    } else { twistShown = twistHeld = NaN; aimOn = false; lvx = NaN; }
    if (flowOn) kick(Wt, dt); else rc = null;   // (any gun pose: the hip shot's, the fan's too)
    // REACTIONS: the lean on the move and the head's look while he doesn't aim (nor plays an emote, nor hangs from the swing's
    // rope), a hit's flinch always
    SEN ??= app.feat('senses');
    const free = proc && !aiming && emS < 0 && K.demo !== 'swing' && idK !== 'fidget' && !lsBusy();   // (a fidget has the head itself; the rope work its own)
    mlean(Wt, P, dt, phi - yaw, yaw, free && flowOn, sample); look(Wt, P, dt, sample, free); weather(Wt, P, dt, sample, free); wobble(Wt, dt); hiccup(Wt, dt); flinch(Wt, P, dt, aiming);
    stats.look = lkK > 0 ? (SEN?.S.look.kind || '') : ''; stats.flinch = flT < flDur ? flT / flDur : -1;   // (dev)
    // 6) the demos
    ropeN = 0;
    if (K.demo === 'lasso' && !(S && S.out)) {
      const ang = sampT * TAU * LASSO.hz, a = hystOf(demoA, wrap(ang)); demoA = a;
      lasso(Wt, a / (TAU * LASSO.hz));
    } else if (K.demo === 'swing') {
      const w0 = Math.sqrt(9.81 / (SWING.rope + 1.0)), th = SWING.amp * Math.sin(w0 * sampT), dth = SWING.amp * Math.cos(w0 * sampT);
      const a = hystOf(demoA, th); demoA = a; swing(Wt, a, dth);
    } else demoA = NaN;
    // 7) hold until it changes by a pixel
    stats.frames++; stats.base = baseName; stats.layer = layer; stats.key = clipNow; stats.fade = fadeT;   // (dev: what this frame drew)
    stats.tw = twistShown; stats.twH = twistHeld; stats.twS = twist; stats.kick = rc ? rcT : -1; stats.tb = tbT < tbDur ? tbT / tbDur : 1; stats.tbDur = tbDur;
    let show = Wt;
    if (K.hold && haveShow) {
      tips(Wt, TIPS); tips(Wshow, TIPS2);
      let mx = 0; for (let i = 0; i < NB * 4; i++) { const d = Math.abs(TIPS[i] - TIPS2[i]); if (d > mx) mx = d; }
      if (mx < 1 && !headTurned(Wt, Wshow)) { show = Wshow; stats.held++; } else Wshow.set(Wt);
    } else Wshow.set(Wt);
    haveShow = true;
    if (show !== Wt) toLocal(Wshow, Ll);   // (Ll: the shown local pose, a clip change's cross-fade starts from it)
    // 7b) TRANSITIONS: a switch or a facing step blends from what was drawn (turned by its facing) to this
    if (tbOn) {
      if (tbHave && (swap || Math.abs(wrap(phi - tbPhi)) > 4 * DEG)) {   // (a step: not the smooth facing's easing)
        const far = turnedParts(show, phi, TBQ, TBP) * (SCR.ppm || 30) / TB.speed;   // (s the biggest travel takes at TB.speed)
        const hd = GUN >= 0 && gunNear(show) ? barrel(show) + phi : NaN, turn = hd === hd && tbGun === tbGun ? Math.abs(wrap(hd - tbGun)) / DEG / TB.turn : 0;
        TBF.set(LW); tbT = 0; tbDur = Math.min(TB.max, Math.max(swap ? TB.dur : TB.face, far, turn));
        if (swap && bclip.startsWith('fs_') && tbPrev.startsWith('fs_')) tbDur = Math.min(tbDur, FS.blend);   // (FISTS: a string flows)
      }
      tbPhi = phi;
      if (tbT < tbDur) {
        tbT += dt; const u = Math.min(1, tbT / tbDur), e = u * u * (3 - 2 * u);
        toLocalTurned(show, phi, LTB); blendLocal(TBF, LTB, e, LTB); fk(LTB, WTB); unturn(WTB, phi); holster(show, WTB); show = WTB;
      }
      toLocalTurned(show, phi, LW); turnedParts(show, phi, TBP, null); tbHave = true;
      tbGun = GUN >= 0 && gunNear(show) ? barrel(show) + phi : NaN;
    } else tbHave = false;
    // THROWN: the ragdoll's pose instead (and drawn as far down as it lies); his own animation again as he gets up
    show = HR.frame(show, P, phi, AX, AY, AZ, dt); PR.k = HR.k; PR.pitch = HR.pitch;
    ropeHands(show);   // LASSO: the rope hands as drawn (host.playerRopeHand)
    perf?.end('live.pose'); perf?.begin('cloth.sim', 'char');
    cloth(show, phi, yaw, dt, P);   // THE RUNTIME CLOTH on the drawn pose (the sprite's own sim rests meanwhile: loop.js)
    perf?.end('cloth.sim'); perf?.begin('live.pose', 'char');
    // 8) the segments' matrices, the smear, the rig
    aim.ok = GUN >= 0 && gunNear(show);
    if (aim.ok) { barrel(show); screenOf(MUZ[0], MUZ[1], MUZ[2], SC); aim.mx = SC[0]; aim.my = SC[1]; const o = GUN * 7; screenOf(show[o + 4], show[o + 5], show[o + 6], SC); aim.a = Math.atan2(aim.my - SC[1], aim.mx - SC[0]); }
    if (shotWant) { shotWant = false; if (aim.ok) shot(); }   // (an emote's shot: the gun in his hand)
    MW.ok = aim.ok; if (aim.ok) { toWorld(MUZ[0], MUZ[1], MUZ[2], WP, 0); MW.x = WP[0]; MW.y = WP[2]; MW.h = WP[1]; }
    screenOf(0, 0, 0, SC); SCR.x = SC[0]; SCR.y = SC[1]; G.toScreenInto(AX + 1, AY, AZ, SO); SCR.ppm = Math.abs(SO[0] - SC[0]) || SCR.ppm;
    flash(dt);
    HELD.show(app.PL.tool?.S.on ? app.PL.tool.S.id : '', P.state === 'chop' ? 'swing' : 'carry', show, HELD_O);   // TOOL: the axe in his fist while it's out (hanging from it; gripped at the knob to swing)
    mats(show, toolSwing ? toolHide(A.hide) : A.hide);
    DRAWN.w = show; DRAWN.phi = phi; DRAWN.x = AX; DRAWN.h = AY; DRAWN.z = AZ; DRAWN.n++;
    stats.smears += K.smear || fsSmear() ? smear(show) : (prevOk = false, 0);   // (FISTS: a punch's snap smears, from its wind to just past its contact)
    const blinkOff = P.blink && Math.floor(P.blink * 12) % 2;
    PR.x = AX; PR.y = AY; PR.z = AZ; PR.sx = PX; PR.sy = P.z; PR.sz = PY; PR.snap = K.snap ? 1 : 0; PR.alpha = 1;
    if (!blinkOff) rig.put(model, 0, MATS, PR);
    for (let i = 0; i < ropeN - 1; i++) {   // the rope (the demos): pixel lines in the world
      toWorld(ROPE[i * 3], ROPE[i * 3 + 1], ROPE[i * 3 + 2], WP, 0); const x0 = WP[0], y0 = WP[1], z0 = WP[2];
      toWorld(ROPE[i * 3 + 3], ROPE[i * 3 + 4], ROPE[i * 3 + 5], WP, 0); G.line(x0, y0, z0, WP[0], WP[1], WP[2], ROPE_C);
    }
    lineupDraw();
    perf?.end('live.pose');
    const t1 = performance.now();
    rig.noXray = !!app.PL.brawl?.carrying || sinkPx > 6;   // (BRAWL: what he carries is in front of him: no x-ray outline of him through it; in the water, swimming: the water hides his body, not an outline of it)
    perf?.begin('live.rig', 'render'); rig.render(); perf?.end('live.rig');
    G.setPlayer(DRAWN.x, P.z + .9, DRAWN.z, PLAYER_SUN);   // (his one sun-shadow test, past his own 3D body: it cast onto the point and flickered; where he is drawn: IDLES' spot)
    stats.ms = stats.ms * .95 + (t1 - t0) * .05; stats.msRender = stats.msRender * .95 + (performance.now() - t1) * .05;
    return sinkPx;
  }

  // ---------------------------------------------------------------- the lineup (dev: the look test puts poses beside sprites)
  let lineup = [];
  const LP = {x: 0, y: 0, z: 0, k: K_UP, alpha: 1, flash: 0, pitch: 20 * DEG, sx: 0, sy: 0, sz: 0, snap: 1, type: 4};
  function lineupDraw() {
    for (let i = 0; i < lineup.length && i < slots - 1; i++) {
      const L = lineup[i], A = poseOf(L.pose); if (!A) continue;
      fc = Math.cos(L.face); fs = Math.sin(L.face); AX = L.x; AY = L.z; AZ = L.y;
      mats(A.w, A.hide);
      LP.x = AX; LP.y = AY; LP.z = AZ; LP.sx = L.x; LP.sy = L.z; LP.sz = L.y; LP.snap = L.snap ?? 1;
      rig.put(model, i + 1, MATS, LP);
    }
  }

  // ---------------------------------------------------------------- host.playerSprite's object while live: the atlas frame
  // (contact shadows measure his feet from it, flow's afterimages and depth's reflections copy it), filled when read
  const cv = document.createElement('canvas'), cn = document.createElement('canvas'); cv.width = cn.width = 192; cv.height = cn.height = 160;
  const cq = cv.getContext('2d', {willReadFrequently: true}), nq = cn.getContext('2d'); cq.imageSmoothingEnabled = nq.imageSmoothingEnabled = false;
  let drawnKey = '', drawnFace = -1;
  function fill() {
    const P = app.P, A = hero.atlas, f = A.SP[P.frame] ? P.frame : 'idle.0';
    if (f === drawnKey && P.face === drawnFace) return;
    drawnKey = f; drawnFace = P.face; cq.clearRect(0, 0, 192, 160); nq.clearRect(0, 0, 192, 160);
    const sp = A.SP[f]; if (sp.img) cq.drawImage(sp.img, P.face * A.FW, 0, A.FW, A.FH, 48, 40, A.FW, A.FH); if (sp.nrm) nq.drawImage(sp.nrm, P.face * A.FW, 0, A.FW, A.FH, 48, 40, A.FW, A.FH);
  }
  Object.defineProperty(SPRO, 'img', {get() { fill(); return cv; }}); Object.defineProperty(SPRO, 'nrm', {get() { fill(); return cn; }});
  function sprite() {
    const P = app.P, pl = app.player, A = hero.atlas; SPRO.px = A.PIV[0] + 48; SPRO.py = A.PIV[1] + 40; SPRO.x = pl.x; SPRO.y = pl.y; SPRO.h = P.z; SPRO.frame = P.frame; SPRO.face = P.face;
    if (cxK > 0 && CX.kind) { SPRO.x = DRAWN.x; SPRO.y = DRAWN.z; SPRO.h = DRAWN.h; if (cxK > .5 && CX.kind !== 'lean' && A.SP?.crouch) SPRO.frame = 'crouch'; }   // (IDLES: where he is drawn, low when seated or kneeling)
    return SPRO;
  }

  const live = {
    stats, model, poseOf, BN, J,
    wear, get worn() { return GEAR.key; },   // GEAR (docs/GEAR.md)
    // (a knob changed, the body (re)shown: no history carried over)
    reset() { haveShow = false; prevOk = false; wf = NaN; twistShown = NaN; demoA = NaN; lastT = -1; t = 0; stepK = -1; SHOT.t = 0; shotWant = false;
      twistHeld = NaN; aimOn = false; rc = null; lvx = NaN; cbSt = ''; MW.ok = false; tbHave = false; tbT = tbDur = 1; CLO.rig?.reset(); CLO.lx = NaN; feetK = 0; mvPrev = ''; mvAfter = 0; },
    muzzle: () => MW.ok ? MW : null,
    ropeHand: () => LH.ok ? LH : null,   // (LASSO: the drawn rope hands, the spin's circle: host.playerRopeHand)
    setLineup(items) { lineup = items || []; },
    aim, drawn: DRAWN,
    // (dev: the shimmer meter draws several knob sets off ONE sim step, each from its own history)
    snapshot: () => ({v: [t, lastT, clipNow, frameNow, frameT, fadeT, haveShow, wf, twist, twistShown, demoA, stepK, sampT, prevOk, on, aimPhi, aimBase],
      a: [Ll.slice(), Lfrom.slice(), Wshow.slice(), PREV.slice()], K: {...K}}),
    restore(S) { [t, lastT, clipNow, frameNow, frameT, fadeT, haveShow, wf, twist, twistShown, demoA, stepK, sampT, prevOk, on, aimPhi, aimBase] = S.v; Ll.set(S.a[0]); Lfrom.set(S.a[1]); Wshow.set(S.a[2]); PREV.set(S.a[3]); Object.assign(K, S.K); },
    demos, emotes: EMOTES,
    compose, sprite,
    rag: HR,   // (THROWN: his ragdoll, view/herorag.js; tests)
  };
  const reset0 = live.reset; live.reset = () => { reset0(); reactReset(); };   // (REACTIONS: no history carried over either)
  const reset1 = live.reset; live.reset = () => { reset1(); HR.reset(); };   // (THROWN: nor a ragdoll)
  const reset2 = live.reset; live.reset = () => { reset2(); lsReset(); };   // (LASSO: nor the rope work's clocks)
  return live;
}

// THE LIVE HERO: the body of the loadout he wears (MODELS), loaded on first wear; the shared rig, knobs and switch.
// o.only: the loadouts drawn live (main.js: the gunslinger by default; null: every one in MODELS); the others stay
// sprites. The rig (its render targets, its passes) is made, and its shaders compiled, when the first body loads: a
// Ranger who never wears a live loadout costs nothing, and the switch to one shows the sprite until the body is ready.
export async function createLiveHero(o) {
  const slots = o.slots ?? 17, hero = o.hero, only = o.only ?? null;
  const K = {...(PRESETS[flags.get('livek')] || PRESETS.all), demo: ''}, want = flags.get('livedemo') || '';
  const bodies = {}, loading = {};
  let on = true, shown = null, rig = null, flashes = null, warmed = null, look = null;   // (look: the gear worn, every body dressed in it)
  const lives = n => n in MODELS && (!only || only.includes(n));   // this loadout is drawn live
  function load(name) {
    rig ??= createRigMesh(o.G, {slots, xray: true}); flashes ??= createFlashes(o.G, 2);
    return loading[name] ??= createLiveBody({...o, url: MODELS[name], rig, flashes, K, slots}).then(async b => {
      await (warmed ??= rig.warm().catch(e => console.warn('live hero: shaders not warmed', e)));   // (compiled off the frame: no hitch on his first live frame)
      bodies[name] = b;
      if (want && !K.demo && b.demos.includes(want)) K.demo = want;
      if (look) b.wear(look.pieces, look.key);
      return b;
    }).catch(e => { console.warn('live hero: no body for', name, e); });
  }
  // the body he wears now (a body not loaded yet starts loading: null meanwhile); a switch starts it with no history
  function cur() {
    const n = hero.loadName; if (!lives(n)) return null;
    const b = bodies[n]; if (!b) { load(n); return null; }
    if (b !== shown) { shown = b; b.reset(); }
    return b;
  }
  const NOSTATS = {held: 0, frames: 0, smears: 0, smearK: 0, ms: 0, msRender: 0};
  if (lives(hero.loadName)) await load(hero.loadName);
  const live = {
    K, get rig() { return rig; },
    get on() { return on && !!cur(); },
    get available() { return lives(hero.loadName); },
    toggle(v = !on) { on = !!v; shown = null; flashes?.frame(); if (!on) hero.rig?.reset(); return on; },   // (no flash left armed: compose stops; the sprite's cloth, idle while he was live, starts over)
    set(x) { Object.assign(K, x); cur()?.reset(); return K; },
    preset(name) { return live.set(PRESETS[name]); },
    get presetName() { for (const [n, v] of Object.entries(PRESETS)) if (Object.keys(v).every(k => v[k] === K[k])) return n; return 'custom'; },
    presets: Object.keys(PRESETS),
    get demos() { return cur()?.demos ?? DEMOS; }, get emotes() { return cur()?.emotes ?? []; },
    get stats() { return cur()?.stats ?? NOSTATS; }, get aim() { return cur()?.aim; }, get drawn() { return cur()?.drawn; },
    muzzle: () => on ? cur()?.muzzle() ?? null : null,   // (the drawn muzzle: host.playerMuzzle, the shot's flash)
    ropeHand: () => on ? cur()?.ropeHand() ?? null : null,   // (LASSO: the drawn rope hands: host.playerRopeHand)
    get rag() { return cur()?.rag ?? null; },
    get model() { return cur()?.model; }, get J() { return cur()?.J; }, get BN() { return cur()?.BN; }, poseOf: n => cur()?.poseOf(n),
    setLineup(items) { cur()?.setLineup(items); },
    snapshot: () => cur().snapshot(), restore: S => cur().restore(S),
    compose: (PX, PY, perf) => cur().compose(PX, PY, perf), sprite: () => cur().sprite(),
    get bytes() { return rig?.bytes ?? 0; },
    get atlas() { return hero.atlas; },
    load,   // (dev / tests: a loadout's body now)
    // GEAR (docs/GEAR.md): every body (loaded now or later) drawn in these pieces (content/gear.js entries, SLOTS order;
    // key: their setKey). A change of set only: a few ms, never per frame.
    dress(pieces, key) { look = {pieces, key}; for (const b of Object.values(bodies)) b.wear(pieces, key); },
    get worn() { return look?.key ?? ''; },
    // (dev: the model re-exported (tools/blender/live_export.mjs): its body made again from the files now, shown at once with
    // no history; the old one's model stays in the rig, never put again (rigmesh has no removal; a dev session's leak))
    modelUrl: n => lives(n) ? MODELS[n] : null,   // (dev: the folder a loadout's live model is read from, the page's relative URL)
    async reload(name = hero.loadName) {
      if (!(name in MODELS)) return null;
      const b = await createLiveBody({...o, url: MODELS[name], rig, flashes, K, slots, bust: '?v=' + Date.now()});
      bodies[name] = b; loading[name] = Promise.resolve(b); shown = null;
      if (look) b.wear(look.pieces, look.key);
      if (want && !K.demo && b.demos.includes(want)) K.demo = want;
      return b;
    },
  };
  return live;
}
