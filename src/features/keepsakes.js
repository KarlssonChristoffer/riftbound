// KEEPSAKES (docs/KEEPSAKES.md): the finds that do something. Each odd thing the forest's and the cave's secrets leave you
// (content/keepsakes.js KEEPSAKE_IDS: pouch materials, content/items.js) can be worn in one of two charm slots (content/gear.js
// slot 'charm'; features/gear.js: worn only while the pouch holds it), and while it is worn it bends one rule of the world.
// Nothing says which: no stat line, no toast; the rule shows itself the moment it happens.
//   THE NOTES   a worn keepsake's modifier notes (content/keepsakes.js NOTES, source 'keepsakes'), applied by their owners:
//               the animals (fauna.loud, fauna.lure), the cave (cave.shun, cave.kin, cave.relight), the watcher (watcher.every)
//   THE HERON FEATHER  stand still (HERON.still s, slower than HERON.speed) in the shallows (fishing.shallow: the lake's shelf,
//               the stream outside its deep pools) and fish shadows rise round your feet (fishing.come: fishing draws them);
//               E jabs (fishing.grab: rolled like a cast with HERON's limits, the server's online). A jab, hit or miss, or a
//               step scatters them for HERON.back s. A friend's feather: their shadows on your screen too (view only)
// MULTIPLAYER: what you wear is in your gear set, which is the server's to say (features/gear.js, server/room.mjs wear): everyone
//   sees the charms on you, and the server and your friends' clients read your set for the rules that touch them (the soot
//   things: server/room.mjs; the animals: features/fauna.js reads a peer's q.gear).
// SIM vs VIEW: the worn set and its notes change in update (a step), on a change of the gear's set only. The heron's stillness,
//   its shadows' rise and the jab are the sim's; how far up the shadows are drawn (eased) and a friend's are the view's.
// OWNS: the modifier source 'keepsakes', F.worn (the keepsakes in your set now), the heron's state (HS). READS: gear (S.worn,
//   S.ver), pack (give: the dev row), fishing (shallow, come, grab, fishing), coop (peers: their gear, where they are), flags
//   ('keepsakes'), host.player, host.PL (hold, useE, nearInteract).
// EMITS: nothing of its own (the jab: fishing's fish.jab / fish.catch / fish.miss). BUDGET: update: a compare a step (the set's
//   version); with the feather worn one waterSample a step (fishing.shallow); view: one ask a frame per feather near you.
import {flags} from '../core/flags.js';
import {KEEPSAKE_IDS, NOTES, HERON, isKeepsake} from '../content/keepsakes.js';
import {hdUnit, hdPrompt} from '../ui/hdpixel.js';

const ON = flags.get('keepsakes') !== '0';

// ORDER (core/features.js): after the gear (the set worn this step), the pack and co-op (their mail this step), fishing (its
// step done: a jab lands after it, its asks are drawn after its view)
export const order = {after: ['gear', 'pack', 'coop', 'fishing']};
export async function create(host) {
  const gear = () => host.feature('gear'), pack = () => host.feature('pack'), game = () => host.feature('game'), fishing = () => host.feature('fishing');
  const F = {name: 'keepsakes', label: 'Keepsakes', on: ON, worn: new Set(), ver: 0};
  F.wears = id => F.worn.has(id);
  let gearV = -1;
  const notes = [];
  function setNotes() {
    notes.length = 0;
    if (ON) for (const id of F.worn) for (const n of NOTES[id] || []) notes.push(n);
    if (notes.length) host.mods.set('keepsakes', notes.slice()); else host.mods.clear('keepsakes');
  }

  // ---------------------------------------------------------------- the Heron Feather
  // HS: the water he stands in ('' : not the shallows, or no feather), s stood still there, how far up the shadows are
  // (0..1), s before they come again after a scatter, E pressed this step
  const HS = {w: '', still: 0, k: 0, away: 0, jab: false};
  F.heron = HS;
  const free = () => { const P = host.player; return !host.lock && !host.paused && !host.BUSY.has(P.state) && !host.PL.tool?.S.mode && !host.PL.nearInteract?.(); };
  const ready = () => HS.w !== '' && HS.k >= .5;
  function scatter() { if (HS.k > 0) HS.away = HERON.back; HS.k = 0; HS.still = 0; }
  function heron(dt) {
    const P = host.player, Fi = fishing();
    HS.w = ON && F.worn.has('heron_feather') && Fi && !Fi.fishing && P.state !== 'hold' ? Fi.shallow(P.x, P.y) : '';
    if (HS.away > 0) HS.away = Math.max(0, HS.away - dt);
    if (HS.jab) {   // E: the jab (he stoops to the water), hit or miss they scatter
      HS.jab = false;
      if (ready() && free() && Fi.grab(P.x, P.y, HS.w)) { host.PL.hold('crouch', .35); scatter(); return; }
    }
    if (P.state === 'hold') return;   // (stooped: neither still nor a step)
    if (!HS.w || Math.hypot(P.vx || 0, P.vy || 0) >= HERON.speed || host.BUSY.has(P.state)) { scatter(); return; }
    if ((HS.still += dt) >= HERON.still && HS.away <= 0) HS.k = Math.min(1, HS.k + dt / HERON.rise);
  }

  F.update = dt => {
    const G = gear(), v = G?.S?.ver ?? 0;
    if (v !== gearV) {   // (the set changed: which keepsakes are worn now, their notes)
      gearV = v; F.worn.clear();
      for (const id of G?.S?.worn || []) if (isKeepsake(id)) F.worn.add(id);
      F.ver++; setNotes();
    }
    heron(dt);
  };
  F.onKey = k => {
    if (k !== 'e' || !ready() || !free()) return false;
    HS.jab = true; host.PL.useE?.(); return true;
  };

  // the view: the shadows asked of fishing (eased up as the sim's k rises, darting off fast when it drops), and a friend's
  // feather: his stillness in the shallows judged here from where he's drawn (no word from the server: it's only a look)
  const VK = {me: 0}, PEERS = new Map(), PSM = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', w: null, ls: null};
  const ease = (v, to, dt) => to > v ? Math.min(to, v + dt * 1.5) : Math.max(to, v - dt * 3);
  F.view = dt => {
    const Fi = fishing(); if (!Fi?.come) return;
    const P = host.player;
    VK.me = ease(VK.me, HS.w ? HS.k : 0, dt);
    if (VK.me > 0) Fi.come('heron:me', P.x, P.y, VK.me, HERON.n[0] + (HERON.n[1] - HERON.n[0]) * VK.me | 0);
    const C = host.feature('coop')?.net;
    if (!ON || !C?.peers?.size || dt <= 0) return;
    for (const peer of C.peers.values()) {
      let q = PEERS.get(peer.id);
      if (!peer.gear?.includes?.('heron_feather')) { if (q) q.k = 0; continue; }
      const o = C.sample(peer, PSM); if (!o) continue;
      if (!q) { q = {px: o.x, py: o.y, still: 0, k: 0, away: 0, key: 'heron:' + peer.id}; PEERS.set(peer.id, q); }
      const v = Math.hypot(o.x - q.px, o.y - q.py) / dt; q.px = o.x; q.py = o.y;
      const w = Fi.shallow(o.x, o.y), go = !w || v >= HERON.speed || o.s === 'hold';
      if (q.away > 0) q.away -= dt;
      if (go) { if (q.k > .3) q.away = HERON.back; q.still = 0; q.k = ease(q.k, 0, dt); }
      else if ((q.still += dt) >= HERON.still && q.away <= 0) q.k = Math.min(1, q.k + dt / HERON.rise);
      if (q.k > 0) Fi.come(q.key, o.x, o.y, q.k, HERON.n[0] + (HERON.n[1] - HERON.n[0]) * q.k | 0);
    }
  };
  // the HD layer: "E jab" over him while the shadows are up
  F.hd = (q, sc) => {
    if (!ready() || host.hudOff || host.playerHidden || pack()?.open || !free()) return;
    const P = host.player, s = host.G.toScreen(P.x, P.z + 2.2, P.y);
    q.save(); host.G.hdShift?.(q, sc); q.imageSmoothingEnabled = false;
    hdPrompt(q, 'E jab', s[0] * sc, s[1] * sc, hdUnit(), '#f2d27a');
    q.restore();
  };

  F.menu = () => game()?.mode !== 'sandbox' ? [] : [
    {label: 'Keepsakes: give all (one of each in the pouch)', run: () => { const pk = pack(); if (pk) for (const id of KEEPSAKE_IDS) if (!pk.count(id)) pk.give(id, 1); }},
  ];
  F.hud = () => F.worn.size ? `keepsakes worn ${[...F.worn].join(', ')}${ON ? '' : ' (rules off)'}${HS.w ? ` · heron ${HS.w} still ${HS.still.toFixed(1)} k ${HS.k.toFixed(2)}${HS.away > 0 ? ' away ' + HS.away.toFixed(0) : ''}` : ''}` : '';
  return F;
}
