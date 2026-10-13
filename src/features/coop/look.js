// CO-OP LOOK: the other players, drawn (features/coop.js is the connection; docs/MULTIPLAYER.md). VIEW only: it reads the net
// client's snapshots (interpolated INTERP_MS in the past) and writes its own state and its rig.
//   body     each peer is a LIVE body (view/livebody.js through render/rigmesh.js, as the desert's gunmen) of the model it wears
//            (view/livehero.js MODELS: gunslinger, outlaw; anyone else as the gunslinger). A peer drawn live sends its DRAWN
//            pose's bones (aim twist, lean, flow, ragdoll and all: protocol.js packPose), which this body shows as they are, in
//            its own bone order (by name); a peer without one (a sprite loadout) shows the named frame it plays, if the model has
//            it. Until a model has loaded: a stick figure in the peer's colour
//   gear     a peer's body is its model DRESSED in the gear it wears (the server's word: q.gear; view/dress.js, docs/GEAR.md):
//            a model per look (rig + set), shared by the peers who look alike; a look nobody wears any more is restyled into
//            the next one needed (rigmesh can't remove a model). Made when a peer's set changes (a few ms), never per frame
//   name     its name over its head in its colour (HD overlay, hung on the world like the prompts)
//   lasso    the rope from its hand to the loop (spinning overhead, flying, lying, round what it holds, on a swing's anchor)
// OWNS: the rig, the models, the bodies. READS: the net client (peers, sample), G, host.yaw.
// BUDGET: view; per peer and frame a sample + a body draw (~.005 ms, the matrices only when the pose changed); render: rigmesh's
//   A + S per model on screen, one B.
import {createRigMesh} from '../../render/rigmesh.js';
import {liveModel, createLiveBody} from '../../view/livebody.js';
import {MODELS} from '../../view/livehero.js';
import {unpackPose} from '../../net/protocol.js';
import {dress} from '../../view/dress.js';
import {gearById, setKey} from '../../content/gear.js';

const SLOTS = 8;
export function createPeerLook(host, C) {
  const G = host.G;
  let rig = null, warm = null;
  const base = new Map();     // rig name -> [J, bin] (the export's) | null (failed) | Promise
  const models = new Map();   // look ('<rig>|<gear key>') -> LM
  const rigOf = new Map();    // LM -> its rig name (a look's model is only restyled into another look of the same rig)
  const views = new Map();    // peer id -> {LM, body, W, idx, wv, wn, key, tmp}
  const slotUsed = new Uint8Array(SLOTS);
  const S = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', w: null, ls: null};

  function model(name, gear) {
    const n = name in MODELS ? name : 'gunslinger', key = n + '|' + setKey(gear);
    const have = models.get(key); if (have) return have;
    const b = base.get(n);
    if (b === undefined) {
      rig ??= createRigMesh(G, {slots: SLOTS});
      const url = MODELS[n];
      base.set(n, Promise.all([fetch(url + 'model.json').then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }), fetch(url + 'model.bin').then(r => r.arrayBuffer())])
        .then(JB => { base.set(n, JB); })
        .catch(e => { console.warn('coop: the', n, 'model failed to load (stick figures)', e); base.set(n, null); }));
      return null;
    }
    if (!Array.isArray(b)) return null;   // (loading, or failed)
    const [J, bin] = b, pieces = gear.map(gearById).filter(Boolean);
    const D = pieces.length ? dress(J, bin, pieces) : {J, bin};
    for (const [k, LM] of models) if (rigOf.get(LM) === n && !worn(LM)) { models.delete(k); rig.restyle(LM.model, D.J, D.bin); models.set(key, LM); return LM; }
    const LM = liveModel(rig, D.J, D.bin); models.set(key, LM); rigOf.set(LM, n); warm ??= rig.warm().catch(() => {});
    return LM;
  }
  function worn(LM) { for (const v of views.values()) if (v.LM === LM) return true; return false; }
  function viewOf(q) {
    let v = views.get(q.id); const LM = v && v.gv === q.gv && v.rig === q.rig ? v.LM : model(q.rig, q.gear);
    if (!LM) return v?.LM ? v : null;
    if (!v || v.LM !== LM) {
      if (v?.body) slotUsed[v.body.slot] = 0;
      let slot = -1; for (let i = 0; i < SLOTS; i++) if (!slotUsed[i]) { slot = i; break; }
      if (slot < 0) return null;   // (more peers than slots: the rest as stick figures)
      slotUsed[slot] = 1;
      const W = new Float64Array(LM.NB * 7), idle = LM.poseOf('idle.0'); if (idle) W.set(idle.w);
      v = {LM, body: createLiveBody(LM, rig, slot, G), W, idx: null, wn: null, wv: -1, key: 1, tmp: new Float64Array(64 * 7), gv: q.gv, rig: q.rig};
      views.set(q.id, v);
    }
    v.gv = q.gv; v.rig = q.rig;
    return v;
  }
  // the peer's sent pose into the body's bone order (bones it didn't send keep the idle's)
  function takePose(v, q, w) {
    if (q.wn !== v.wn) { v.wn = q.wn; v.idx = q.wn ? Int16Array.from(q.wn, b => v.LM.IX[b] ?? -1) : null; }
    if (!v.idx || !w) return false;
    const nb = Math.min(v.idx.length, w.length / 7 | 0, 64); unpackPose(w.subarray(0, nb * 7), v.tmp);
    for (let j = 0; j < nb; j++) { const b = v.idx[j]; if (b < 0) continue; for (let k = 0; k < 7; k++) v.W[b * 7 + k] = v.tmp[j * 7 + k]; }
    v.key++; return true;
  }
  function drop(id) { const v = views.get(id); if (v?.body) slotUsed[v.body.slot] = 0; views.delete(id); }

  const D = {pose: '', w: null, key: 0, phi: 0, x: 0, y: 0, z: 0, sx: 0, sy: 0, sh: 0, aim: false, alpha: 1, flash: 0, lie: 0, type: 7};
  const HAND = [0, 0, 0], LOOP = [0, 0, 0];
  function frame(f) {
    for (const q of C.left) drop(q.id); C.left.length = 0;
    if (!C.peers.size) return;
    const t = f.t;
    let drew = false;
    for (const q of C.peers.values()) {
      const s = C.sample(q, S); if (!s) continue;
      const v = viewOf(q);
      if (!v) { stick(q, s); continue; }
      if (s.w && (s.w !== v.lastW || q.wn !== v.wn)) { v.lastW = s.w; if (takePose(v, q, s.w)) v.posed = true; }
      if (v.posed && s.w) { D.w = v.W; D.key = v.key; D.pose = ''; } else { D.w = null; D.pose = s.pose || 'idle.0'; }
      D.phi = s.phi; D.x = D.sx = s.x; D.y = D.sy = s.y; D.z = D.sh = s.z;
      v.body.draw(D, t); drew = true;
      if (s.ls) lasso(q, v, s);
    }
    if (drew) rig.render();
  }
  // until its model loads (or if it can't): a stick figure in the peer's colour, facing its way
  function stick(q, s) {
    const c = q.color || '#f0c060', fx = Math.sin(s.phi) * .18, fy = Math.cos(s.phi) * .18, x = s.x, y = s.y, z = s.z;
    host.line(x - .1, y, z, x, y, z + .9, c); host.line(x + .1, y, z, x, y, z + .9, c); host.line(x, y, z + .9, x, y, z + 1.45, c);
    host.line(x - .25, y, z + 1.2, x + .25, y, z + 1.2, c); host.line(x, y, z + 1.45, x + fx, y + fy, z + 1.6, c);
  }
  // the lasso: ls = [phase, x, y, h, r] (features/coop.js: the loop, or on a swing the anchor)
  function lasso(q, v, s) {
    const L = s.ls, ph = L[0], lx = L[1], ly = L[2], lh = L[3], r = L[4], b = v.LM.IX.LeftHand ?? v.LM.IX.RightHand;
    if (b === undefined) return;
    v.body.pointOn(b, 0, 0, 0, HAND);
    const c = '#c8a46a';
    if (ph === 'spin' || ph === 'wind' || (lx === 0 && ly === 0 && lh === 0)) {   // a loop overhead, turning (still in his hand: the
      const a0 = performance.now() / 160, cx = HAND[0], cy = HAND[1], ch = HAND[2] + .35, rr = Math.max(.3, r);   // throw's wind-up too)
      for (let i = 0; i < 12; i++) { const a = a0 + i * Math.PI / 6, e = a + Math.PI / 6; host.line(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * .8, ch, cx + Math.cos(e) * rr, cy + Math.sin(e) * rr * .8, ch, c); }
      host.line(HAND[0], HAND[1], HAND[2], cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr * .8, ch, c);
      return;
    }
    LOOP[0] = lx; LOOP[1] = ly; LOOP[2] = lh;
    const n = 10, d = Math.hypot(lx - HAND[0], ly - HAND[1]), sag = ph === 'swing' || ph === 'zip' || ph === 'ropeup' || ph === 'hold' ? .05 : Math.min(.6, d * .08);
    let px = HAND[0], py = HAND[1], ph0 = HAND[2];
    for (let i = 1; i <= n; i++) {
      const k = i / n, x = HAND[0] + (lx - HAND[0]) * k, y = HAND[1] + (ly - HAND[1]) * k, h = HAND[2] + (lh - HAND[2]) * k - Math.sin(Math.PI * k) * sag;
      host.line(px, py, ph0, x, y, h, c); px = x; py = y; ph0 = h;
    }
    if (ph !== 'swing' && ph !== 'zip' && ph !== 'ropeup' && r > 0) for (let i = 0; i < 10; i++) {   // the loop itself, flat
      const a = i * Math.PI / 5, e = a + Math.PI / 5; host.line(lx + Math.cos(a) * r, ly + Math.sin(a) * r, lh, lx + Math.cos(e) * r, ly + Math.sin(e) * r, lh, c);
    }
  }
  // names over their heads (HD overlay; hung on the world like the prompts: G.hdShift)
  function hd(q2, sc) {
    if (!C.peers.size) return;
    const dpr = devicePixelRatio || 1;
    q2.save(); G.hdShift?.(q2, sc);
    q2.font = `600 ${Math.round(11 * dpr)}px "Segoe UI", system-ui, sans-serif`; q2.textAlign = 'center'; q2.lineJoin = 'round'; q2.lineWidth = 3 * dpr;
    for (const q of C.peers.values()) {
      const s = C.sample(q, S); if (!s) continue;
      const [sx, sy] = G.toScreen(s.x, s.z + 2.05, s.y);
      q2.strokeStyle = 'rgba(10,10,12,.85)'; q2.strokeText(q.name, sx * sc, sy * sc); q2.fillStyle = q.color || '#fff'; q2.fillText(q.name, sx * sc, sy * sc);
    }
    q2.restore();
  }
  return {frame, hd, get rig() { return rig; }, views, models};
}
