// LIVELOOK (dev only: loaded by a capture script, never by the game): the live hero's look test (as dev/raglook.js is the
// ragdoll's). A row of figures in the world, each a pose at one facing, drawn as the player's SPRITE (the atlas frame as
// a character card, type 4, with its normals: what the hero's card shows) or as his LIVE body (view/livehero.js's lineup:
// the same pose's bone matrices through rigmesh) at the same spot, so the two can be captured apart and compared at any
// yaw, time of day and zoom (tmp/exp-livehero: look parity).
//   const L = (await import('/src-xlive/dev/livelook.js')).attach(R.host, R.live);
//   L.show({pose, facings: [0, 4, 8, 12], x, y, gap, sprite: true, live: false}); L.clear(); L.detach()
// It wraps the contact feature's frame (the sprites are pushed each frame, before the draw).
// OWNS: nothing of the game's: its own list of figures.  READS: live.atlas, host.yaw / elev.
export function attach(host, live) {
  const F = host.feature('contact'), TAU = Math.PI * 2, items = [];
  const O = {img: null, nrm: null, sx: 0, sy: 0, sw: 0, sh: 0, x: 0, y: 0, h: 0, px: 0, py: 0, type: 4, shadow: false, alpha: 1};
  const frame0 = F.frame;
  F.frame = function (f) {
    frame0.call(F, f);
    const A = live.atlas;
    for (const it of items) {
      if (!it.sprite) continue;
      const sp = A.SP[it.pose]; if (!sp || !sp.img) continue;
      O.img = sp.img; O.nrm = sp.nrm || null; O.sx = it.f * A.FW; O.sw = A.FW; O.sh = A.FH; O.x = it.x; O.y = it.y; O.h = it.h;
      O.px = A.PIV[0]; O.py = A.PIV[1]; host.sprite(O);
    }
    O.img = O.nrm = null;
  };
  function show({pose = 'idle.0', facings = [0, 4, 8, 12], x = 20, y = 13, gap = 3.3, sprite = true, live: lv = false} = {}) {
    items.length = 0;
    const L = [];
    facings.forEach((f, i) => {
      const px = x + i * gap, h = host.elev(px, y);
      items.push({pose, f, x: px, y, h, sprite});
      if (lv) L.push({pose, face: f * TAU / live.atlas.ND + host.yaw, x: px, y, z: h});
    });
    live.setLineup(L);
    return items.length;
  }
  function clear() { items.length = 0; live.setLineup([]); }
  return {show, clear, items, detach() { clear(); F.frame = frame0; }};
}
