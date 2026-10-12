// STAGE: the wardrobe's studio set (dev/wardrobe.js): a little stage under the character and a backdrop behind him, built in
// code (view/rigkit.js) and drawn as pixel-art 3D like the characters (render/rigmesh.js, view/livebody.js), with the world
// itself left out of the frame (G.isolate: only his rig and this one are drawn, on the backdrop's background colour).
// The set turns with the camera (its facing is the camera's yaw), so the backdrop always stands behind him: a drag that
// turns the camera spins him in front of it.
//   STAGES     what he stands on: a stone plinth, a wooden drum, a rug, a tuft of meadow, nothing
//   BACKDROPS  what stands behind: a velvet curtain, a paper sweep, a stone wall, a night sky, open sky, nothing; each with
//              the background colour of the rest of the frame
// API: const st = createStage(host, liveRig); st.set({stage, back}); st.draw(t) (every frame while shown: places and renders
//   the set at his feet); st.isolate(on) (the world left out, or back); st.stages / st.backs (the names).
// OWNS: its rig, models and bodies, the isolate it asks of G while shown. READS: host.player, host.P, host.yaw, the live
//   hero's rig (kept in the frame). BUDGET: shown: two bodies (A + S + B: 3 draws) and a pass over G's scenes' children a
//   frame (G.isolate); shut: nothing.
import {createRigMesh} from '../render/rigmesh.js';
import {liveModel, createLiveBody} from '../view/livebody.js';
import {rigKit} from '../view/rigkit.js';

const DEG = Math.PI / 180;
const T = {
  stone: ['#b7b2a6', '#918c80', '#6c685f', '#3c3a35'], stoneDk: ['#8d887d', '#6d695f', '#4f4c45', '#2a2925'],
  wood: ['#c99a62', '#a3773f', '#7a552b', '#43301a'], woodDk: ['#8f6a40', '#6e4f2c', '#4f381e', '#2b1e10'],
  rug: ['#c8564a', '#a13b33', '#782a26', '#3e1513'], rugHem: ['#e8c46a', '#c79c3e', '#94702a', '#5a4218'],
  grass: ['#8fbf62', '#6e9d45', '#507a31', '#2c4519'], soil: ['#8a6a4a', '#6b5038', '#4d3927', '#2a1f15'],
  velvet: ['#b8404a', '#8f2c37', '#6a1f29', '#3a0f16'], velvetDk: ['#93303a', '#6f212b', '#50171f', '#2b0b10'], gold: ['#f2d070', '#c89a3a', '#8e6a26', '#5a4018'],
  paper: ['#efeae0', '#d9d3c6', '#bdb6a8', '#7c776d'],
  wall: ['#aaa395', '#878073', '#655f55', '#37342e'], wallDk: ['#8c8578', '#6c665b', '#4e4a42', '#2a2824'],
  night: ['#3a4a78', '#2a375e', '#1d2747', '#0f1528'], star: ['#fffbe0', '#fff1a8', '#f2d36a', '#9c7a2a'],
};
export const STAGES = ['stone', 'wood', 'rug', 'meadow', 'none'];
export const STAGE_SW = {stone: '#918c80', wood: '#a3773f', rug: '#a13b33', meadow: '#6e9d45', none: null};   // (their swatches: the wardrobe's chips)
export const BACKS = {   // bg: the rest of the frame (G.isolate); sw: the swatch
  curtain: {bg: [.1, .04, .06], sw: '#8f2c37'},
  paper: {bg: [.55, .53, .5], sw: '#d9d3c6'},
  'stone wall': {bg: [.12, .12, .11], sw: '#878073'},
  'night sky': {bg: [.03, .04, .09], sw: '#2a375e'},
  'open sky': {bg: [.55, .72, .9], sw: '#8cb8e6'},
  'dark': {bg: [.05, .055, .055], sw: '#151716'},
  'grey': {bg: [.32, .33, .32], sw: '#545654'},
};

// a model of one bone ('Root' at the feet): pieces made by fill(K)
function model(name, fill) {
  const K = rigKit();
  for (const [n, t] of Object.entries(T)) K.fam(n, t, {raw: true});
  K.bone('Root', null, [0, 0, 0], [0, 0, .5]);
  fill(K);
  return K.build(name);
}
// an arc of upright panels round the back (+y), radius r, from -a to +a degrees, n panels: fn(K, i, x, y, rotZ, w)
function arc(K, r, a, n, fn) {
  for (let i = 0; i < n; i++) {
    const t = -a + (2 * a) * (i + .5) / n, w = 2 * r * Math.sin(a * DEG / n) * 1.04;
    fn(K, i, Math.sin(t * DEG) * r, Math.cos(t * DEG) * r, -t * DEG, w);
  }
}
const STAGE_FILL = {
  stone: K => K.tube('Root', 'plinth', 'stone', .78, .72, .22, [0, 0, -.11], {sides: 16})
    .tube('Root', 'plinth.step', 'stoneDk', .92, .9, .1, [0, 0, -.27], {sides: 16}),
  wood: K => K.tube('Root', 'drum', 'wood', .74, .74, .26, [0, 0, -.13], {sides: 14})
    .tube('Root', 'drum.hoop', 'woodDk', .755, .755, .05, [0, 0, -.06], {sides: 14}).tube('Root', 'drum.hoop2', 'woodDk', .755, .755, .05, [0, 0, -.21], {sides: 14}),
  rug: K => K.tube('Root', 'rug', 'rug', .8, .8, .02, [0, 0, -.01], {sides: 16}).tube('Root', 'rug.hem', 'rugHem', .86, .86, .015, [0, 0, -.012], {sides: 16}),
  meadow: K => K.tube('Root', 'turf', 'grass', .82, .76, .14, [0, 0, -.07], {sides: 12}).tube('Root', 'soil', 'soil', .76, .6, .16, [0, 0, -.22], {sides: 12})
    .ball('Root', 'pebble', 'stone', [.1, .08, .05], [.52, -.3, .01], {detail: 0}).ball('Root', 'pebble', 'stone', [.07, .06, .04], [-.48, -.4, .0], {detail: 0}),
};
const BACK_FILL = {
  curtain: K => {
    arc(K, 1.7, 62, 14, (K, i, x, y, rz, w) => K.box('Root', 'fold' + (i & 1), i & 1 ? 'velvetDk' : 'velvet', [w, .08, 2.9], [x, y + (i & 1 ? .04 : 0), 1.15], {rot: [0, 0, rz]}));
    arc(K, 1.62, 62, 7, (K, i, x, y, rz, w) => K.box('Root', 'valance', 'gold', [w, .06, .12], [x, y, 2.55], {rot: [0, 0, rz], bias: .2}));
    K.tube('Root', 'boards', 'woodDk', 2.1, 2.1, .04, [0, .3, -.32], {sides: 20});
  },
  paper: K => {   // a seamless sweep: the wall curving into the floor
    arc(K, 1.8, 65, 14, (K, i, x, y, rz, w) => K.box('Root', 'sweep', 'paper', [w, .06, 3], [x, y, 1.2], {rot: [0, 0, rz]}));
    K.tube('Root', 'floor', 'paper', 2.2, 2.2, .04, [0, .2, -.32], {sides: 20});
  },
  'stone wall': K => {
    arc(K, 1.75, 60, 9, (K, i, x, y, rz, w) => {
      for (let j = 0; j < 6; j++) K.box('Root', 'stone' + ((i + j) & 1), (i + j) & 1 ? 'wallDk' : 'wall', [w * .98, .22, .44], [x, y, -.1 + j * .46], {rot: [0, 0, rz + ((i * 7 + j * 3) % 5 - 2) * DEG]});
    });
    K.tube('Root', 'flags', 'wallDk', 2.1, 2.1, .04, [0, .3, -.32], {sides: 20});
  },
  'night sky': K => {
    arc(K, 1.8, 65, 14, (K, i, x, y, rz, w) => K.box('Root', 'sky', 'night', [w, .06, 3], [x, y, 1.2], {rot: [0, 0, rz]}));
    const S = [[-.9, 2.2], [-.4, 1.7], [.2, 2.4], [.7, 1.9], [1.1, 2.3], [-1.2, 1.5], [.4, 1.4], [-.1, 2.0], [.95, 1.3], [-.7, 2.5]];
    for (const [x, z] of S) K.ball('Root', 'star', 'star', .035, [x, Math.sqrt(Math.max(0, 1.78 * 1.78 - x * x)), z], {detail: 0, fixed: 0, outline: false});
    K.tube('Root', 'floor', 'night', 2.2, 2.2, .04, [0, .2, -.32], {sides: 20});
  },
  'open sky': K => { K.tube('Root', 'field', 'grass', 2.3, 2.3, .04, [0, .2, -.32], {sides: 20}); },
};

export function createStage(host) {
  const G = host.G;
  let rig = null, ready = false, failed = false, live = null, cur = {stage: 'stone', back: 'curtain'}, isoOn = false;
  const models = {}, D = {w: null, key: 1, phi: 0, x: 0, y: 0, z: 0, sx: 0, sy: 0, sh: 0, aim: false, alpha: 1, flash: 0, lie: 0, type: 7, hide: null};
  const D2 = {...D};
  let bodyS = null, bodyB = null, W = null, noShadow = null;
  function setup() {
    try {
      rig = createRigMesh(G, {slots: 2});
      let M0 = null;
      for (const [k, fill] of [...Object.entries(STAGE_FILL).map(([n, f]) => ['s:' + n, f]), ...Object.entries(BACK_FILL).map(([n, f]) => ['b:' + n, f])]) {
        const M = model(k, fill); M0 ??= M; models[k] = liveModel(rig, M.J, M.bin);
      }
      const t = M0.turns();
      W = D.w = D2.w = new Float64Array(M0.NB * 7); M0.reset(t); M0.pose(W, t, null, null);
      rig.warm().then(() => { ready = true; }, () => { ready = true; });
    } catch (e) { failed = true; console.warn('stage: no studio set', e); }
  }
  function bodies() {
    const ms = models['s:' + cur.stage], mb = models['b:' + cur.back];
    bodyS = ms ? createLiveBody(ms, rig, 0, G) : null;
    bodyB = mb ? createLiveBody(mb, rig, 1, G) : null;
    noShadow = mb?.model?.mS ?? null;
  }
  // what the frame keeps: his rig's meshes and the set's (the backdrop casts no shadow: the sun behind it would put him in the dark)
  const keep = o => (live?.owns(o)) || (rig?.owns(o) && o !== noShadow);
  const st = {
    stages: STAGES, backs: Object.keys(BACKS),
    get ready() { return ready; },
    set({stage = cur.stage, back = cur.back} = {}) {
      cur = {stage: STAGES.includes(stage) ? stage : 'stone', back: back in BACKS ? back : 'curtain'};
      if (rig) bodies();
      if (isoOn) G.isolate(keep, BACKS[cur.back].bg);
    },
    // the world left out of the frame (on), or back; liveRig: the live hero's rig (render/rigmesh.js), kept in
    isolate(on, liveRig) {
      isoOn = !!on; live = liveRig || null;
      if (on && !rig && !failed) { setup(); if (rig) bodies(); }
      G.isolate(on ? keep : null, BACKS[cur.back].bg);
    },
    // the set at his feet, turned to the camera (every frame while shown)
    draw(t) {
      if (failed || !rig || !ready) return;
      const P = host.player, z = host.P.z || 0;
      for (const [B, d] of [[bodyS, D], [bodyB, D2]]) {
        if (!B) continue;
        d.phi = host.yaw; d.x = d.sx = P.x; d.y = d.sy = P.y; d.z = d.sh = z;
        B.draw(d, t);
      }
      rig.render();
    },
  };
  return st;
}
