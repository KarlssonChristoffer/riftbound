// Base body: a stylised humanoid with a real skeleton, meant to be dressed.
// Skeleton (all pivots, facing +z, the character's left on +x):
//   body (pelvis) ─ legs ─ legL/legR (hip) ─ .shin (knee) ─ .foot (ankle)
//                 └ torso (chest, bends at the waist) ─ head (neck), armL/armR (shoulder) ─ .fore (elbow) ─ hand point
// It returns the part names the toy poses and PROPS use (body, legs, legL, torso, head, armL, arm.fore, points...),
// so it animates with the existing clips, plus B.segs (every body segment, which clothes are built from) and B.designH.
// Proportions come from a style: at ~40 px tall a figure reads as a person through its head, face and hair, colour
// blocks and limbs a few pixels thick, so none of the styles are realistic.
import {THREE} from './core.js';
import {piv, mesh} from './toys.js';

export const STYLES = {
  chibi: {headR: .24, neck: .03, chestH: .3, chestW: .17, waist: .14, hipW: .15, sx: .17, arm: [.2, .18], armR: [.06, .055, .055, .05], handR: .07, leg: [.22, .2], legR: [.085, .075, .072, .062], foot: [.12, .1, .28]},
  hero: {headR: .17, neck: .06, chestH: .4, chestW: .2, waist: .145, hipW: .16, sx: .23, arm: [.27, .25], armR: [.07, .06, .062, .052], handR: .068, leg: [.36, .34], legR: [.095, .075, .075, .062], foot: [.12, .1, .27]},
  lean: {headR: .14, neck: .08, chestH: .42, chestW: .185, waist: .13, hipW: .15, sx: .21, arm: [.3, .27], armR: [.058, .05, .05, .042], handR: .058, leg: [.42, .4], legR: [.08, .062, .062, .048], foot: [.1, .085, .25]},
};
const lathe = (pts, n = 10, flat = .74) => { const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), n); g.scale(1, 1, flat); return g; };
const taper = (r0, r1, h, n = 9) => new THREE.CylinderGeometry(r0, r1, h, n);
const ball = (r, sx = 1, sy = 1, sz = 1) => { const g = new THREE.SphereGeometry(r, 10, 7); g.scale(sx, sy, sz); return g; };

export function baseBody(P, o = {}) {
  const S = STYLES[o.style || 'hero'], skin = P.S(o.skin || '#e0b08a'), segs = [];
  const [L1, L2] = S.leg, [fw, fh, fl] = S.foot, hipY = L1 + L2 + fh * .85 + S.hipW * .15; // soles on the ground
  const model = new THREE.Group();
  const seg = (name, par, geo, x = 0, y = 0, z = 0) => { const m = mesh(par, geo, skin, x, y, z); segs.push({name, m}); return m; };
  const body = piv(model, 0, hipY, 0), legs = piv(body), torso = piv(body, 0, S.hipW * .9, 0);
  // pelvis and chest: lathed profiles (radius, height), flattened front to back
  const h = S.hipW;
  seg('pelvis', body, lathe([[0, -h * .65], [h * .7, -h * .6], [h * .97, -h * .25], [h, h * .2], [S.waist * 1.02, h * .9]]));
  const c = S.chestW, w = S.waist, H = S.chestH;
  seg('chest', torso, lathe([[w, 0], [w * 1.04, H * .15], [c * .9, H * .38], [c, H * .58], [c * 1.02, H * .72], [c * .92, H * .84], [c * .55, H * .94], [S.headR * .38, H], [0, H * 1.02]]));
  seg('neck', torso, taper(S.headR * .34, S.headR * .38, S.neck + .06), 0, H + S.neck / 2, 0);
  // head: skull, jaw, eyes
  const head = piv(torso, 0, H + S.neck, 0), r = S.headR;
  seg('head', head, ball(r, .94, 1.04, 1), 0, r * .95, 0); seg('jaw', head, ball(r * .72, .96, .8, .95), 0, r * .52, r * .2);
  const eye = new THREE.MeshBasicMaterial({color: 0x1a1020});
  for (const x of [-1, 1]) mesh(head, new THREE.BoxGeometry(r * .2, r * .3, .012), eye, x * r * .36, r * .92, r * .93);
  // arms: shoulder ball, tapered upper arm, elbow ball, tapered forearm, big mitten hand
  const [a1, a2] = S.arm, [ar0, ar1, ar2, ar3] = S.armR;
  const arm = (s, n) => {
    const a = piv(torso, s * S.sx, H * .8, 0); a.len1 = a1; a.len2 = a2 + S.handR * .6;
    seg('shoulder' + n, a, ball(ar0 * 1.25)); seg('upperArm' + n, a, taper(ar0, ar1, a1), 0, -a1 / 2, 0);
    a.fore = piv(a, 0, -a1, 0); seg('elbow' + n, a.fore, ball(ar2 * 1.02));
    seg('foreArm' + n, a.fore, taper(ar2, ar3, a2), 0, -a2 / 2, 0);
    seg('hand' + n, a.fore, ball(S.handR, .8, 1.15, .95), 0, -a2 - S.handR * .6, .005);
    return a;
  };
  const armL = arm(1, 'L'), armR = arm(-1, 'R');
  // legs: hip ball, tapered thigh, knee ball, tapered shin, big rounded boot
  const [lr0, lr1, lr2, lr3] = S.legR;
  const leg = (s, n) => {
    const l = piv(legs, s * h * .58, -h * .15, 0);
    seg('hip' + n, l, ball(lr0 * 1.02)); seg('thigh' + n, l, taper(lr0, lr1, L1), 0, -L1 / 2, 0);
    l.shin = piv(l, 0, -L1, 0); seg('knee' + n, l.shin, ball(lr2 * 1.02)); seg('shin' + n, l.shin, taper(lr2, lr3, L2), 0, -L2 / 2, 0);
    l.foot = piv(l.shin, 0, -L2, 0); seg('foot' + n, l.foot, ball(fh * .55, fw / fh, 1, fl / fh * .95), 0, -fh * .3, fl * .22);
    return l;
  };
  const legL = leg(1, 'L'), legR = leg(-1, 'R');
  const hand = a => piv(a.fore, 0, -a.len2, 0);
  const points = {L_Hand: hand(armL), L_Forearm: armL.fore, R_Hand: hand(armR), R_Forearm: armR.fore, Spine02: piv(torso, 0, H * .75, -c * .6), Head: head};
  const designH = hipY + S.hipW * .9 + H + S.neck + r * 2;
  return {model, body, legs, legL, legR, torso, head, armL, armR, points, segs, hipY, designH, style: S, kind: 'human'};
}

// ---------- clothing ----------
// A garment covers some body segments: each covered segment gets a slightly larger copy in the garment's colour, on the
// same joint, so clothes bend with the body. Extra shapes (hoods, belts, capes) attach to a named joint.
const COVER = {
  shirt: ['chest', 'shoulderL', 'shoulderR', 'upperArmL', 'upperArmR'],
  sleeves: ['elbowL', 'elbowR', 'foreArmL', 'foreArmR'],
  pants: ['pelvis', 'hipL', 'hipR', 'thighL', 'thighR', 'kneeL', 'kneeR', 'shinL', 'shinR'],
  shorts: ['pelvis', 'hipL', 'hipR', 'thighL', 'thighR'],
  boots: ['shinL', 'shinR', 'footL', 'footR'],
  gloves: ['handL', 'handR'],
  bracers: ['foreArmL', 'foreArmR'],
};
export function garment(B, P, kind, col, grow = 1.1) {
  const mat = P.S(col), out = [];
  for (const s of B.segs) if (COVER[kind].includes(s.name)) {
    const m = s.m.clone(); m.material = mat; m.scale.multiplyScalar(kind === 'boots' ? grow + .12 : grow); s.m.parent.add(m); out.push(m);
  }
  return out;
}
// shaped pieces sized from the body's style
const PIECES = {
  hair: (B, col) => { const r = B.style.headR, g = new THREE.SphereGeometry(r * 1.1, 10, 7, 0, Math.PI * 2, 0, Math.PI * .56); const m = new THREE.Mesh(g); m.position.set(0, r * .98, -r * .06); m.rotation.x = -.42; return [B.head, m]; },
  fringe: (B, col) => { const r = B.style.headR, m = new THREE.Mesh(new THREE.BoxGeometry(r * 1.5, r * .3, r * .5)); m.position.set(0, r * 1.52, r * .6); m.rotation.x = .5; return [B.head, m]; },
  hood: (B, col) => { const r = B.style.headR, m = new THREE.Mesh(new THREE.SphereGeometry(r * 1.22, 10, 7, 0, Math.PI * 2, 0, Math.PI * .6)); m.position.set(0, r * .98, -r * .08); m.rotation.x = -.25; return [B.head, m]; },
  skirt: (B, col) => { const h = B.style.hipW, m = new THREE.Mesh(lathe([[h * 1.08, 0], [h * 1.25, -h * .8], [h * 1.4, -h * 1.6]])); m.position.y = h * .5; return [B.body, m]; },
  belt: (B, col) => { const h = B.style.hipW, m = new THREE.Mesh(taper(h * 1.08, h * 1.1, h * .3, 12)); m.scale.z = .8; m.position.y = h * .55; return [B.body, m]; },
  cape: (B, col) => { const s = B.style, m = new THREE.Mesh(new THREE.BoxGeometry(s.sx * 1.8, s.chestH * 1.5, .025)); m.position.set(0, s.chestH * .1, -s.chestW * .8); return [B.torso, m]; },
  pauldrons: (B, col) => { const s = B.style; return [-1, 1].map(x => { const m = new THREE.Mesh(new THREE.SphereGeometry(s.armR[0] * 1.9, 8, 6, 0, Math.PI * 2, 0, Math.PI * .55)); m.position.set(x * s.sx, s.chestH * .82, 0); return [B.torso, m]; }); },
};
// wear an outfit: [{kind, col}] for garments or pieces; replaces what was worn before
export function wear(B, P, outfit) {
  (B.worn || []).forEach(m => m.parent && m.parent.remove(m));
  B.worn = outfit.flatMap(g => {
    if (COVER[g.kind]) return garment(B, P, g.kind, g.col, g.grow);
    const made = PIECES[g.kind](B, g.col), list = Array.isArray(made[0]) ? made : [made], mat = P.S(g.col);
    return list.map(([par, m]) => { m.material = mat; m.castShadow = m.receiveShadow = true; par.add(m); return m; });
  });
  return B.worn;
}
export const OUTFITS = {
  adventurer: [{kind: 'hair', col: '#3a2618'}, {kind: 'fringe', col: '#3a2618'}, {kind: 'shirt', col: '#5a6f8a'}, {kind: 'skirt', col: '#5a6f8a'}, {kind: 'pants', col: '#4a3a2c'},
    {kind: 'boots', col: '#2e2218'}, {kind: 'belt', col: '#6b4a30'}],
  traveler: [{kind: 'hood', col: '#2c3a28'}, {kind: 'shirt', col: '#3f5a3a'}, {kind: 'sleeves', col: '#3f5a3a'}, {kind: 'skirt', col: '#3f5a3a'}, {kind: 'pants', col: '#5a4632'},
    {kind: 'boots', col: '#2e2218'}, {kind: 'gloves', col: '#4a3422'}, {kind: 'belt', col: '#2e2218'}, {kind: 'cape', col: '#2c3a28'}],
  mercenary: [{kind: 'hair', col: '#8a4a22'}, {kind: 'shirt', col: '#6a3a2e'}, {kind: 'bracers', col: '#4a3422', grow: 1.18}, {kind: 'pants', col: '#2e3440'}, {kind: 'boots', col: '#1e222a'},
    {kind: 'pauldrons', col: '#8a8f98'}, {kind: 'belt', col: '#8a6a3a'}],
};
