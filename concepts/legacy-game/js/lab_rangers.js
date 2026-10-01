// Ranger concepts for the character lab (lab.html). Each builds on the shared humanoid toy body; the chosen one moves
// into toys.js. Every concept carries its own bow, which follows the left hand and draws its string during the 'bow' clip.
import {THREE, V} from './core.js';
import {Bx, Sp, Cy, Co, dome, mesh, piv, humanoid, eyes} from './toys.js';

const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
const between = (m, a, b) => { const d = b.clone().sub(a), L = d.length(); m.position.copy(a).addScaledVector(d, .5); m.quaternion.setFromUnitVectors(Y, d.normalize()); m.scale.set(1, L, 1); };
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const drawAmount = D => { if (D.cur !== 'bow') return 0; const p = D.t / .8; return p < .72 ? sm(.05, .45, p) : 0; };

// a bow along a curve in the y-z plane, bulging forward; the string runs through a nock point that is pulled back to draw
export function makeBow(B, P, o) {
  const g = piv(B.model), L = o.len;
  const shape = o.recurve ? [[-.5, -.05], [-.44, .03], [-.25, .12], [0, .15], [.25, .12], [.44, .03], [.5, -.05]] : [[-.5, 0], [-.3, .11], [0, .15], [.3, .11], [.5, 0]];
  const pts = shape.map(([y, z]) => V(0, y * L, z * L)), curve = new THREE.CatmullRomCurve3(pts);
  mesh(g, new THREE.TubeGeometry(curve, 18, o.thick || .05, 5), P.M(o.wood)); // at least a pixel thick at game size
  mesh(g, Bx(.09, .16, .1), P.M(o.grip), 0, 0, .15 * L);
  for (const t of o.runes || []) { const p = curve.getPoint(t); mesh(g, Bx(.04, .05, .04), P.L(o.rune, 3), p.x, p.y, p.z); }
  for (const t of o.leaves || []) { const p = curve.getPoint(t); mesh(g, Bx(.07, .03, .05), P.M(o.leaf), p.x + .02, p.y, p.z, 0, 0, .6); }
  const sMat = o.stringGlow ? P.L(o.string, 2) : P.M(o.string);
  const s1 = mesh(g, Bx(.022, 1, .022), sMat), s2 = mesh(g, Bx(.022, 1, .022), sMat);
  const arrow = piv(g);
  mesh(arrow, Bx(.018, .018, .7), P.M('#8a6a4a'), 0, 0, .33);
  mesh(arrow, Co(.03, .08, 4), o.tipGlow ? P.L(o.tipGlow, 3) : P.M('#c8ccd4'), 0, 0, .71, Math.PI / 2);
  mesh(arrow, Bx(.06, .04, .1), P.M(o.fletch || '#c0392b'), 0, 0, .02);
  if (o.tips) for (const t of [pts[0], pts[pts.length - 1]]) mesh(g, Bx(.08, .09, .08), P.M(o.tips), t.x, t.y, t.z);
  const A = pts[0], E = pts[pts.length - 1], nock = V(), grip = V(0, 0, .15 * L);
  // k = how far the string is drawn; with drawHand (world position) the string goes to that hand instead of straight back
  const set = (k, drawHand) => {
    if (drawHand && k > 0) { g.updateMatrixWorld(); g.worldToLocal(nock.copy(drawHand)).multiplyScalar(k); } else nock.set(0, 0, -.32 * k * L);
    between(s1, A, nock); between(s2, nock, E);
    arrow.visible = k > .05; arrow.position.copy(nock); arrow.quaternion.setFromUnitVectors(Z, tmp2.copy(grip).sub(nock).normalize());
  };
  set(0);
  return {g, set, follow: () => { g.position.copy(B.model.worldToLocal(B.points.L_Hand.getWorldPosition(tmp))); g.position.z -= .15 * L; }};
}
// a cape hanging from the shoulders that swings back when running
function cape(B, P, col, w = .42, h = .7, hem) {
  const c = piv(B.torso, 0, .56, -.13); mesh(c, Bx(w, h, .035), P.M(col), 0, -h / 2, 0);
  if (hem) [-1, 0, 1].forEach((s, k) => mesh(c, Bx(w / 3.2, .08 + k % 2 * .05, .035), P.M(col), s * w / 3, -h - .04 - k % 2 * .025, 0));
  return c;
}
const swing = (c, D, ent) => { c.rotation.x = ent.moving ? .45 + Math.sin(D.phase * 2) * .08 : .06 + Math.sin(D.clock * 1.6) * .03; };

export const RANGERS = [
  {
    name: 'Greenwood', tag: 'Classic hooded archer · pointed hood, long cape, tall longbow',
    build(P) {
      const B = humanoid(P, {skin: false, leg: '#4a3a28', boot: '#3a2a1c', arm: '#5a8a3a', hand: '#e8b48a'});
      mesh(B.torso, Bx(.34, .44, .22), P.M('#7a5634'), 0, .24, 0); // leather jerkin
      mesh(B.torso, Cy(.2, .27, .22, 8), P.M('#3f7a34'), 0, .0, 0); // green tabard skirt
      mesh(B.torso, Bx(.36, .06, .24), P.M('#3a2618'), 0, .12, 0); mesh(B.torso, Bx(.06, .06, .03), P.M('#d4a640'), 0, .12, .125); // belt
      mesh(B.torso, Bx(.06, .52, .02), P.M('#4a321f'), 0, .28, .115, 0, 0, .65); // strap across the chest
      mesh(B.torso, Bx(.09, .09, .07), P.M('#4a321f'), .13, .07, .12); // pouch
      mesh(B.armL, Bx(.13, .13, .14), P.M('#5a3a22'), 0, -.27, 0); // bracer on the bow arm
      mesh(B.torso, Cy(.26, .31, .14, 8), P.M('#3f7a34'), 0, .56, 0); // hooded mantle over the shoulders
      B.capeG = cape(B, P, '#2c5226', .42, .74, true);
      mesh(B.head, Sp(.18), P.M('#f1c29a')); eyes(P, B.head, '#2a1020');
      mesh(B.head, dome(.215, .56), P.M('#3f7a34'), 0, .02, -.015);
      mesh(B.head, Bx(.3, .05, .06), P.M('#2c5226'), 0, .1, .15); // hood rim shadow
      mesh(B.head, Co(.11, .42, 5), P.M('#3f7a34'), 0, .02, -.26, -2.1); // hood point draping back
      const q = piv(B.torso, .13, .4, -.19); q.rotation.set(.35, 0, -.35);
      mesh(q, Cy(.075, .075, .44, 6), P.M('#4a321f'), 0, 0, 0);
      for (let i = 0; i < 3; i++) { mesh(q, Bx(.016, .2, .016), P.M('#8a6a4a'), -.03 + i * .03, .3, 0); mesh(q, Bx(.05, .08, .02), P.M('#c0392b'), -.03 + i * .03, .38, 0); }
      const bow = makeBow(B, P, {len: 1.05, wood: '#8a5a30', grip: '#3a2618', string: '#e8e0d0'});
      B.tick = (D, ent) => { bow.follow(); bow.set(drawAmount(D)); swing(B.capeG, D, ent); };
      return B;
    },
  },
  {
    name: 'Storm Hunter', tag: 'Leans into the storm element · wide hat, scarf mask, long coat, glowing bow',
    build(P) {
      const B = humanoid(P, {skin: false, leg: '#2e3440', boot: '#1e222a', arm: '#4a5666', hand: '#2e3440'});
      mesh(B.torso, Bx(.34, .44, .22), P.M('#4a5666'), 0, .24, 0); // coat
      mesh(B.torso, Cy(.21, .31, .5, 8), P.M('#4a5666'), 0, -.06, 0); // coat skirt to the knees
      mesh(B.torso, Bx(.07, .44, .03), P.M('#2fb8a0'), -.07, .24, .115); mesh(B.torso, Bx(.07, .44, .03), P.M('#2fb8a0'), .07, .24, .115); // lapels
      mesh(B.torso, Bx(.36, .06, .24), P.M('#1e222a'), 0, .1, 0); mesh(B.torso, Bx(.07, .06, .03), P.L('#7ff0ff', 2.5), 0, .1, .125); // belt, charged buckle
      mesh(B.armR, Sp(.12, 6, 4), P.M('#6a4a2e'), 0, 0, 0); // leather pauldron
      B.capeG = cape(B, P, '#3a4452', .36, .6); // coat tails
      mesh(B.head, Sp(.17), P.M('#f1c29a')); eyes(P, B.head, '#7ff0ff', .03, .155, .065, 2.5);
      mesh(B.head, Bx(.3, .12, .22), P.M('#2fb8a0'), 0, -.07, .03); // scarf mask
      mesh(B.head, Cy(.29, .29, .03, 12), P.M('#2e3440'), 0, .13, 0); // wide brim
      mesh(B.head, Cy(.15, .18, .17, 8), P.M('#2e3440'), 0, .23, 0);
      mesh(B.head, Cy(.185, .185, .04, 8), P.M('#2fb8a0'), 0, .17, 0); // hat band
      mesh(B.head, Bx(.03, .22, .06), P.L('#b8ff5a', 2), .17, .27, -.03, 0, 0, -.4); // storm feather
      const q = piv(B.torso, -.2, .02, -.05); q.rotation.z = .2; mesh(q, Cy(.06, .06, .3, 6), P.M('#1e222a'));
      for (let i = 0; i < 3; i++) mesh(q, Bx(.03, .05, .03), P.L('#b8ff5a', 2.5), -.02 + i * .025, .19, 0);
      const bow = makeBow(B, P, {len: .95, recurve: true, wood: '#2e3440', grip: '#1e222a', string: '#b8ff5a', stringGlow: true, runes: [.25, .38, .62, .75], rune: '#7ff0ff', tipGlow: '#b8ff5a'});
      B.tick = (D, ent) => { bow.follow(); bow.set(drawAmount(D)); swing(B.capeG, D, ent); };
      return B;
    },
  },
  {
    name: 'Wildheart', tag: 'Druid hunter · antler crown, fur mantle, bone bow wrapped in leaves',
    build(P) {
      const B = humanoid(P, {skin: false, leg: '#6a4a2e', boot: '#4a321f', arm: '#c98f6a', hand: '#c98f6a'});
      mesh(B.torso, Bx(.32, .42, .2), P.M('#c98f6a'), 0, .24, 0); // bare chest
      mesh(B.torso, Bx(.25, .04, .21), P.M('#4f8a3c'), 0, .3, .005); mesh(B.torso, Bx(.25, .04, .21), P.M('#4f8a3c'), 0, .2, .005); // war paint
      mesh(B.torso, Cy(.22, .29, .24, 8), P.M('#6a4a2e'), 0, .0, 0); // hide kilt
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; mesh(B.torso, Bx(.07, .06, .04), P.M(i % 2 ? '#6b8f45' : '#9dbb5a'), Math.sin(a) * .27, -.12, Math.cos(a) * .27, 0, a, 0); } // leaf trim
      const fur = mesh(B.torso, Sp(.3, 8, 5), P.M('#d8c8a8'), 0, .5, -.02); fur.scale.set(1.05, .5, .85); // fur mantle
      mesh(B.torso, Sp(.1, 5, 4), P.M('#b8a888'), .2, .56, .1); mesh(B.torso, Sp(.1, 5, 4), P.M('#b8a888'), -.2, .56, .1);
      B.capeG = cape(B, P, '#5a3e26', .44, .66, true);
      for (const a of [B.armL, B.armR]) mesh(a, Bx(.115, .08, .125), P.M('#6b8f45'), 0, -.2, 0); // vine wraps
      mesh(B.head, Sp(.17), P.M('#c98f6a')); eyes(P, B.head, '#9dff5a', .02, .155, .065, 2.5);
      mesh(B.head, Sp(.2, 7, 4), P.M('#3a2618'), 0, .06, -.05).scale.set(1, .8, 1); // wild hair
      mesh(B.head, Bx(.08, .2, .08), P.M('#3a2618'), .12, -.12, -.08); mesh(B.head, Bx(.08, .2, .08), P.M('#3a2618'), -.12, -.12, -.08);
      for (const s of [1, -1]) { // antlers
        const a = piv(B.head, s * .09, .15, -.02); a.rotation.z = -s * .45;
        mesh(a, Co(.04, .46, 4), P.M('#f4ead0'), 0, .23, 0);
        mesh(a, Co(.03, .2, 4), P.M('#f4ead0'), s * .08, .22, .03, .3, 0, -s * .9);
        mesh(a, Co(.03, .18, 4), P.M('#f4ead0'), -s * .05, .36, 0, 0, 0, s * .7);
      }
      const bow = makeBow(B, P, {len: 1, wood: '#d8c8a0', grip: '#6b8f45', string: '#e8e0d0', leaves: [.18, .32, .5, .68, .82], leaf: '#6b8f45', fletch: '#9dbb5a'});
      B.tick = (D, ent) => { bow.follow(); bow.set(drawAmount(D)); swing(B.capeG, D, ent); };
      return B;
    },
  },
  {
    name: 'Falconer', tag: 'Hunter with a hawk on the shoulder · feather cloak, falconry glove',
    build(P) {
      const B = humanoid(P, {skin: false, leg: '#5a4a38', boot: '#3a2a1c', arm: '#a8742a', hand: '#e8b48a'});
      mesh(B.torso, Bx(.34, .44, .22), P.M('#a8742a'), 0, .24, 0); // ochre tunic
      mesh(B.torso, Cy(.2, .26, .2, 8), P.M('#6a4a2e'), 0, .0, 0);
      mesh(B.torso, Bx(.36, .06, .24), P.M('#3a2618'), 0, .12, 0);
      mesh(B.armR, Bx(.15, .2, .16), P.M('#5a3a22'), 0, -.33, 0); // falconry glove
      B.capeG = piv(B.torso, 0, .56, -.13); // feather cloak: rows of feathers
      for (let r = 0; r < 4; r++) for (let c = -2; c <= 2; c++) mesh(B.capeG, Bx(.09, .2, .03), P.M((r + c) % 2 ? '#8a6a4a' : '#c8b090'), c * .085, -.12 - r * .15, -r * .005, 0, 0, c * .06);
      mesh(B.head, Sp(.17), P.M('#f1c29a')); eyes(P, B.head, '#2a1020');
      mesh(B.head, dome(.19, .5), P.M('#6a4a2e'), 0, .03, 0); // leather cap
      mesh(B.head, Bx(.06, .14, .1), P.M('#6a4a2e'), .17, -.03, 0); mesh(B.head, Bx(.06, .14, .1), P.M('#6a4a2e'), -.17, -.03, 0); // ear flaps
      mesh(B.head, Bx(.22, .06, .04), P.M('#e8e0d0'), 0, -.1, .14); // moustache
      // the hawk, perched on the right shoulder
      const hk = piv(B.torso, -.29, .6, -.02), brown = P.M('#ece6da'); hk.scale.setScalar(1.35); // a pale falcon, so it reads against the brown clothes
      mesh(hk, Sp(.09, 6, 4), brown, 0, .07, 0).scale.set(1, 1.2, 1.3);
      mesh(hk, Sp(.07, 5, 4), P.M('#fffaf0'), 0, .06, .05);
      mesh(hk, Bx(.08, .02, .16), brown, 0, .02, -.14, -.5);
      const head = piv(hk, 0, .18, .03); mesh(head, Sp(.065, 6, 4), brown); mesh(head, Co(.022, .06, 4), P.M('#ffc84a'), 0, -.01, .07, Math.PI / 2);
      mesh(head, Bx(.1, .02, .02), P.M('#3a3632'), 0, .03, .045); mesh(head, Bx(.02, .02, .02), P.M('#10160f'), .035, .01, .05); mesh(head, Bx(.02, .02, .02), P.M('#10160f'), -.035, .01, .05);
      const wings = [1, -1].map(s => { const w = piv(hk, s * .085, .13, 0); mesh(w, Bx(.03, .16, .22), P.M('#9a948a'), 0, -.07, -.02); mesh(w, Bx(.032, .06, .1), P.M('#3a3632'), 0, -.13, -.1); return w; });
      const bow = makeBow(B, P, {len: .95, recurve: true, wood: '#7a4a28', grip: '#3a2618', string: '#e8e0d0', fletch: '#e8d8b8'});
      let flap = 0, look = 0;
      B.tick = (D, ent, dt) => {
        bow.follow(); bow.set(drawAmount(D)); swing(B.capeG, D, ent);
        if (D.cur === 'bow' && D.t < .1) flap = .8; if (Math.random() < dt * .15) flap = .6; flap = Math.max(0, flap - dt);
        if (Math.random() < dt * .5) look = (Math.random() - .5) * 2.2;
        head.rotation.y += (look - head.rotation.y) * Math.min(1, dt * 12);
        wings.forEach((w, k) => { w.rotation.z = (k ? -1 : 1) * (flap > 0 ? 1 + Math.sin(D.clock * 28) * .7 : .05); });
      };
      return B;
    },
  },
];

// ---------- round 2: one direction, the rift ranger ----------
// Grounded and rough: dark long coat, short cape over one shoulder, visible quiver, gloves, a big simple bow.
// The only glow is the rift accent in the eyes and arrowheads.
const riftRanger = (accent, o = {}) => P => {
  const coatC = o.coat || '#34402c';
  const B = humanoid(P, {skin: false, elbows: true, armW: .12, legW: .14, handR: .075, leg: '#4a3a2c', boot: '#2a2018', arm: coatC, fore: '#3a2a1c', hand: '#2e2218', headY: .72});
  const coat = P.M(coatC), leather = P.M('#5a3e26'), leatherD = P.M('#3a2818'), hoodM = P.M(o.hood || '#2c3a28');
  mesh(B.torso, Bx(.38, .46, .25), coat, 0, .25, 0);
  mesh(B.torso, Cy(.22, .33, .5, 8), coat, 0, -.08, 0); // long coat to the knees
  mesh(B.torso, Bx(.4, .07, .27), leatherD, 0, .06, 0); // belt
  mesh(B.torso, Bx(.08, .6, .03), leather, 0, .3, .135, 0, 0, -.7); // quiver strap across the chest
  const cp = piv(B.torso, -.14, .6, 0); cp.rotation.z = -.35; // short cape over the right shoulder only
  mesh(cp, Bx(.36, .38, .32), P.M(o.cape || '#4a3a28'), -.04, -.16, -.02);
  const q = piv(B.torso, .1, .36, -.2); q.rotation.set(.25, 0, -.45); // quiver on the back, fletching above the left shoulder
  mesh(q, Cy(.085, .07, .52, 6), leather); mesh(q, Cy(.095, .095, .05, 6), leatherD, 0, .24, 0);
  for (let i = 0; i < 4; i++) { const x = (i - 1.5) * .038; mesh(q, Bx(.022, .2, .022), P.M('#8a6a4a'), x, .34, 0); mesh(q, Bx(.065, .1, .025), P.M('#d8cdb8'), x, .44, 0); }
  mesh(B.head, Sp(.18), P.M('#d8a47e'));
  eyes(P, B.head, accent, .015, .16, .065, 1.4);
  if (o.hoodDown) {
    mesh(B.head, dome(.2, .55), P.M('#2a1e16'), 0, .02, -.02); // hair
    mesh(B.head, Bx(.08, .22, .08), P.M('#2a1e16'), 0, -.1, -.19); // tied back
    mesh(B.torso, Cy(.25, .29, .14, 8), hoodM, 0, .6, -.03); // lowered hood around the neck
  } else {
    mesh(B.head, dome(.225, .6), hoodM, 0, .02, -.02);
    mesh(B.head, Bx(.32, .06, .07), P.M('#1a2016'), 0, .1, .15); // hood rim shades the eyes
    mesh(B.head, Co(.09, .26, 5), hoodM, 0, -.02, -.22, -2.2);
    mesh(B.torso, Cy(.25, .3, .13, 8), hoodM, 0, .6, 0);
  }
  const bow = makeBow(B, P, {len: 1.15, thick: .06, recurve: true, wood: '#8a5a34', grip: '#2a1a10', string: '#d8d0c0', tips: '#d8cdb8', tipGlow: accent, fletch: '#d8cdb8'});
  B.tick = (D, ent) => { bow.follow(); bow.set(drawAmount(D), B.points.R_Hand.getWorldPosition(tmp)); cp.rotation.x = ent.moving ? .25 : .03 + Math.sin(D.clock * 1.6) * .02; };
  return B;
};
export const RIFT = [
  {name: 'Rift Ranger', tag: 'Cold cyan rift glow, only in the eyes and arrowheads', build: riftRanger('#5ff2ff')},
  {name: 'Rift Ranger', tag: 'The same figure with a magenta rift glow', build: riftRanger('#ff4fd8')},
  {name: 'Alt outfit', tag: 'Same base figure: hood down, brown coat, green cape', build: riftRanger('#5ff2ff', {hoodDown: true, cape: '#2c3a28', coat: '#4a3a2c'})},
];
