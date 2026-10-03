// RAGLOOK (dev only: loaded by a test or capture script, never by the game): the ragdoll's look test. A row of pairs,
// each a gunman's SPRITE (his atlas pose at one facing, as features/foes/look.js draws it: a lit card, type 7) beside
// the LIVE MODEL (view/ragdoll.js frozen in the exported pose of the same name, facing as that facing does, drawn by
// render/rigmesh.js), so the two can be compared at any yaw, time of day and zoom.
//   const L = (await import('/src-wrag/dev/raglook.js')).attach(host);
//   L.show({type: 'bandit' | 'sheriff' | 'bruiser', pose: 'gun_aim', facings: [0, 2, 4, ...], x, y, gap: 2.4, sprite: true,
//     live: true, dy: 0}); L.clear(); L.detach()
// It wraps the foes feature's frame (the sprites are pushed each frame) and uses the foes look's ragdolls (their slots
// from 15 down).
// OWNS: nothing of the game's: its own list of pairs.  READS: the foes feature's look (sets, rag), host.yaw.
export function attach(host) {
  const F = host.feature('foes'), look = F.look, rag = look.rag, TAU = Math.PI * 2;
  if (!rag) throw new Error('raglook: no ragdolls (the page was started with ?ragdoll=0)');
  const items = [], O = {img: null, nrm: null, sx: 0, sy: 0, sw: 0, sh: 0, x: 0, y: 0, h: 0, px: 0, py: 0, type: 7, shadow: true, alpha: 1};
  let slots = [];
  const frame0 = F.frame;
  F.frame = function (f) {
    frame0.call(F, f);
    for (const it of items) {
      const set = look.sets[it.type]; if (!it.sprite || !set) continue;
      const sp = set.SP[it.pose]; if (!sp || !sp.img) continue;
      O.img = sp.img; O.nrm = sp.nrm || null; O.sx = it.f * set.FW; O.sw = set.FW; O.sh = set.FH; O.x = it.x; O.y = it.y; O.h = it.h;
      O.px = set.PIV[0]; O.py = set.PIV[1]; O.shadow = it.shadow; host.sprite(O);
    }
    O.img = O.nrm = null;
  };
  // the facings' world angles at the current yaw (features/foes/look.js worldOf); live bodies are re-made by show()
  function show({type = 'bandit', pose = 'gun_aim', facings = [0, 2, 4, 6, 8, 10, 12, 14], x = 20, y = 17, gap = 2.4, sprite = true, live = true, liveDx = 1.1, shadow = true} = {}) {
    clear();
    const set = look.sets[type], nd = set ? set.ND : 16;
    facings.forEach((f, i) => {
      const px = x + i * gap, h = host.elev(px, y);
      items.push({type, pose, f, x: px, y, h, sprite, shadow});
      if (live) {
        const s = 15 - slots.length;
        if (rag.spawn(s, type, {x: px + liveDx, y, z: host.elev(px + liveDx, y), face: f * TAU / nd + host.yaw, pose, frozen: true})) slots.push(s);
      }
    });
    return {pose: rag.poseFor(type, pose), n: facings.length, slots: slots.length};
  }
  function clear() { for (const s of slots) rag.free(s); slots = []; items.length = 0; }
  return {show, clear, items, detach() { clear(); F.frame = frame0; }};
}
