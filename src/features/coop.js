// CO-OP (docs/MULTIPLAYER.md): playing in one world with friends. ?mp=1 (the page served by node server/server.mjs) or
// ?mp=host:port joins the server's room; without it this feature is an empty shell that costs nothing.
//   the others   each player's own client simulates its body (no input lag) and sends where it is 20 times a second: place,
//                facing, state, the frame it plays and, drawn live, the drawn pose's bones; the room passes everyone's on.
//                The others are drawn from those, a little in the past, interpolated (features/coop/look.js)
//   the world    the server's seed built this forest (core/session.js, world/forest.js), so every client has the same trees
//                with the same ids. Changing the shared world is an ACT: asked of the server, which checks it (the tree is
//                there, the player in reach) and tells everyone, a late joiner included: then (and only then) each client
//                makes it so. Felling a tree today (act('fell', tree)); the woodcutting slice calls the same
//   checks       the server refuses a move faster than a body can go (protocol.js MOVE) and puts this client back (fix)
//   the clock    the server owns the world's clock: the page's (sim/env.js) follows it (set when it comes, put right when it
//                drifts more than a game minute) and isn't saved as the page's own while borrowed. A ?time= asks the server
//   the uncanny  the forest's secrets and the night elk are the server's too (docs/UNCANNY.md): their messages (sec, ev) are
//                handed on in F.mail for features/uncanny.js (refilled each step: it reads them in its own update, after this)
//   gear         what each player wears is the server's to say (docs/GEAR.md): features/gear.js asks (wear(ids)), the
//                server checks the set and tells everyone; yours comes back here (F.gear: {ver, ids}), the others' look.js dresses
//   fishing      the server rolls each cast's catch (docs/FISHING.md): features/fishing.js asks (fish(o)); its answer and the
//                others' catches (fish) are handed on in F.mail
//   foraging     the server keeps the picked patches (docs/FORAGING.md): features/forage.js asks (act('pick', id, {lvl})); the
//                server's word on a patch (world: picked, grown) is handed on in F.mail
//   mining       the server keeps the veins' blows left and the spent veins (docs/MINING.md): features/mining.js sends each blow
//                (act('mine', id, {pow, lvl, tier})); its word on a vein (world: struck, spent, grown) is handed on in F.mail
//   building     the server keeps what players put down (docs/BUILDING.md): features/builds.js asks (act('build', kind, {x, y}),
//                'stoke', 'unbuild'); its word (world: built, stoked, gone) is handed on in F.mail
//   workshop     the server keeps the furnaces' charges and heat and every made thing's record (docs/WORKSHOP.md):
//                features/workshop.js asks (act 'load', 'pump', 'fit', 'make', 'take'); its word (smith, made, rec) is handed on
//                in F.mail. The hello carries this browser's KEY (game/playerkey.js: the server keeps a player's records by it,
//                server/players.mjs) and the workshop's records. F.tag(a, fn): a feature adds its fields to an act (fn(p) -> {}:
//                the workshop puts the tool's record on a 'fell' and a 'mine')
//   animals      the bag Lasso on the forest's animals (docs/FAUNA.md "The Lasso"): features/rope.js claims the animal on its
//                rope (act('rope', id), 'free'), calms a roe ('calm') and takes a find ('find'); the animal on your rope goes
//                in the state message (an), the server's word (ev: rope, free; world: calm, found; a deny of a rope) in F.mail
//   skills       the server owns each player's XP (docs/SKILLS.md): the hello carries this browser's player key (game/playerkey.js)
//                and the pack's XP (read by the server only for a key it hasn't seen); its word on your XP (skills) is handed on in
//                F.mail for features/pack.js; a cave crystal broken under the pick asks for its XP (act('crystal', 'c' + i))
// SIM vs VIEW: the shared world's changes (a felled tree, a fix) are applied in update, at a step, in the order the server sent
// them; what the others look like is view (look.js). Sending reads the player and the drawn pose after the frame's steps.
// OWNS: the connection (net/client.js), the send clock, the look. READS: host.player, host.playerPose (the drawn live pose),
//   the equipment's lasso (features/equip/lasso.js L), host.entities (the forest's trees by their fid). WRITES: host.env's clock
//   (setT, setDayMinutes, borrowed: its API for this).
// EMITS: nothing. BUDGET: update ~0 (a queue); frame: a send 20 times a second (~.02 ms: a pose packed only when it changed),
//   the look's.
import {SESSION} from '../core/session.js';
import {flags} from '../core/flags.js';
import {TICK_HZ, packPose, worldFlags} from '../net/protocol.js';
import {wsTransport} from '../net/transport.js';
import {createNetClient, b64} from '../net/client.js';
import {createPeerLook} from './coop/look.js';
import {playerKey} from '../game/playerkey.js';

// ORDER (core/features.js): after the equipment (the lasso's phase this step) and the combat (a felled tree's world is settled)
export const order = {after: ['equip', 'combat']};
export async function create(host) {
  if (!SESSION.mp) return SESSION.error ? offline(host) : {name: 'coop', on: false, online: false, act: () => false, tag() {}};
  let name = flags.get('name') || ''; try { name ||= localStorage.getItem('rb.coop.name') || ''; } catch {}
  const C = createNetClient({transport: wsTransport(SESSION.ws), name, hello: () => ({wf: worldFlags(k => flags.get(k)), key: playerKey(), xp: host.feature('pack')?.skills?.toJSON() || {}, made: host.feature('workshop')?.records?.() || []})});
  const look = createPeerLook(host, C);
  const msgs = [], mail = [], WH = Math.PI * 2;
  // THE CLOCK: the server's last word {t: its ms, h, rate}; the page's env follows it
  const clk = {t: 0, h: NaN, rate: 0}, env = host.env;
  let clkCheck = 0, askedTime = false;
  const clockNow = () => clk.h + (C.serverNow() - clk.t) * clk.rate;
  function follow(force) {
    if (!env || !isFinite(clk.h)) return;
    const h = clockNow();
    if (force || Math.abs(h - env.t) > 1 / 60) env.setT(h);
  }
  // the forest's trees by id (world/forest.js gives each its fid): a live list, a map made on a change
  const trees = host.entities.query('coop.trees', p => typeof p.fid === 'string');
  let byFid = null, byVer = -1;
  const treeOf = id => { if (byVer !== host.propsVersion || !byFid) { byFid = new Map(trees.map(p => [p.fid, p])); byVer = host.propsVersion; } return byFid.get(id) || null; };
  function fell(id) {
    const p = treeOf(id); if (!p) return;
    host.world.removeItem?.(p); host.entities.remove(p);
  }
  const gear = {ver: 0, ids: null};   // your set as the server last took it (features/gear.js wears it)
  let note = '', noteT = 0;
  const BYS = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', w: null, ls: null};   // (where the one who felled a tree is: its fall's way)
  const say = (t, s = 4) => { note = t; noteT = s; };

  // ---------------------------------------------------------------- sending: 20 times a second, after the frame's steps
  let sendT = 0, lastN = -1, lastRig = '', lastX = NaN, lastY = NaN, packed = null, sentW = null, pinged = 0;
  let ngVer = -1, ng = false;   // (the Nightglass Lantern worn: 'light.nightglass', read again when the notes change)
  const nightglass = () => { const m = host.mods; if (!m) return false; if (m.ver !== ngVer) { ngVer = m.ver; ng = m.value('light.nightglass', 0) > 0; } return ng; };
  const ST = {x: 0, y: 0, z: 0, phi: 0, s: '', pose: '', rig: '', w: undefined, wn: undefined, ls: undefined, tp: undefined, lt: 0, md: '', bd: 0, an: undefined, sc: ''};
  // his scene (the game's mode + the biome: the forest, a run's level): the server sends each scene's players to that scene only
  let scMode = null, scBiome = null;
  function scene() {
    const mode = host.feature('game')?.mode || '', biome = host.biome?.id || '';
    if (mode !== scMode || biome !== scBiome) { scMode = mode; scBiome = biome; ST.sc = mode + ':' + biome; }
  }
  const LS = ['', 0, 0, 0, 0];
  function send(now) {
    if (C.status !== 'online' || now - sendT < 1000 / TICK_HZ) return;
    sendT = now; scene();
    const P = host.player, pp = host.playerPose?.() || null;
    ST.x = +P.x.toFixed(3); ST.y = +P.y.toFixed(3); ST.z = +(P.z - P.sink * 22 / host.PPMH).toFixed(3);   // (in the water, swimming: as sunk as the views draw him, 22 px per 1)
    ST.phi = +((pp ? pp.phi : P.faceAngle) % WH).toFixed(3); ST.s = P.state; ST.pose = P.frame || 'idle.0';
    ST.rig = pp ? pp.rig : ''; ST.w = ST.wn = ST.ls = ST.tp = undefined;
    if (ST.rig !== lastRig) { lastRig = ST.rig; lastN = -1; sentW = null; if (pp) ST.wn = pp.BN; }
    if (pp && pp.n !== lastN) {   // a new drawn frame: its bones, if they changed from what was sent
      lastN = pp.n; packed = packPose(pp.w, pp.BN.length, packed);
      if (!sentW || !same(packed, sentW)) { sentW = (sentW && sentW.length === packed.length) ? sentW : new Int16Array(packed.length); sentW.set(packed); ST.w = b64(packed); }
    }
    ST.bd = host.feature('body')?.bits?.() ?? 0;   // (his body's look: wet, cold, sunk, knocked down; content/body.js packBody: friends see it, features/body.js)
    const cv = host.feature('caves'), ml = host.feature('meals');
    ST.lt = (cv?.lit && !nightglass()) || host.feature('workshop')?.torch ? 1 : ml?.eyes && cv?.down ? 2 : 0;   // (his lantern burns in the cave, or a lit pine haft: features/workshop.js; the server's soot things go for it, friends' night veins hide; 2: a burnt eel's eyes, only the soot things; a Nightglass Lantern's light is dark light, none of that: docs/ALMANAC.md)
    ST.md = ml?.code || '';   // (the meal in him: friends see its mood, content/meals.js)
    if (Math.hypot(ST.x - lastX, ST.y - lastY) > 4) ST.tp = 1;   // (a respawn, a teleport: the server lets that one through)
    lastX = ST.x; lastY = ST.y;
    const rope = host.feature('rope'), L = (rope?.lasso?.busy ? rope.lasso.L : null) || host.feature('equip')?.sim?.lasso?.L, ph = L?.phase;   // (the bag Lasso's or the equipment's)
    ST.an = rope?.an?.();   // (the animal on your rope: features/rope.js)
    if (ph) {
      const sw = ph === 'swing' || ph === 'zip' || ph === 'ropeup', A = sw ? L.anchor : L.loop;
      LS[0] = ph; LS[1] = +A.x.toFixed(2); LS[2] = +A.y.toFixed(2); LS[3] = +A.h.toFixed(2); LS[4] = sw ? 0 : +(L.loop.r * (L.loop.open ?? 1)).toFixed(2); ST.ls = LS;
    }
    C.sendState(ST);
    if (now - pinged > 2000) { pinged = now; C.pingNow(); }
  }
  const same = (a, b) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 2) return false; return true; };

  // the woodcutting slice (and the test row below) asks for a tree to come down: true when asked. features/uncanny.js asks
  // for a secret (p: its id) when its condition holds; 'time' (p: dawn | day | dusk | night) sets the server's clock (dev)
  // features/forage.js asks for a patch ('pick', p: its id 'd' + decor index, o: {lvl}: his Foraging level); features/mining.js
  // sends a blow on a vein ('mine', p: 'v' + its index in the cave's plan, o: {pow, lvl, tier})
  // features/builds.js puts a build down ('build', p: its kind, o: {x, y}), adds a log to a fire ('stoke', p: the build's id) and
  // takes its own lamp back ('unbuild', p: the id), puts a shared pot on a fire ('pot', p: the fire's id, o: {dish, q}) and takes
  // a spoon from it ('spoon', p: the fire's id); features/thunder.js sets a tree alight with a brand ('ignite', p: its fid) and
  // takes a struck tree's thunderwood ('wood', p: its fid); features/workshop.js loads a furnace, pumps it, fits a bellows, takes a bar
  // ('load', 'pump', 'fit', 'take', p: the furnace's build id) and makes a thing ('make', p: the anvil's id). features/pack.js: the title
  // he wears ('title', p: its id, '' none) and a --dev server's Skills rows ('dev', p: next | reset | titles | notitles); docs/SKILLS.md
  // features/wrongwx.js asks about the following cloud ('cloud', p: 'x' + the event, o: {w: ask | pass | lose, to})
  const tags = {};   // act -> [fn(p) -> its extra fields] (F.tag)
  const tagged = (a, p, o) => { const T = tags[a]; if (!T) return o; o = {...o}; for (const f of T) Object.assign(o, f(p)); return o; };
  function act(a, p, o) {
    if (C.status !== 'online') return false;
    if (a === 'secret' || a === 'time') { if (typeof p !== 'string') return false; C.act(a, p); return true; }
    if (a === 'pick' || a === 'mine' || a === 'build' || a === 'stoke' || a === 'unbuild' || a === 'pot' || a === 'spoon' || a === 'ignite' || a === 'wood' || a === 'hole' || a === 'load' || a === 'pump' || a === 'fit' || a === 'make' || a === 'take' || a === 'crystal' || a === 'title' || a === 'dev' || a === 'dig' || a === 'cloud') { if (typeof p !== 'string') return false; C.act(a, p, tagged(a, p, o)); return true; }
    if (a === 'rope' || a === 'free' || a === 'calm' || a === 'find') { if (typeof p !== 'string') return false; C.act(a, p, o); return true; }   // (features/rope.js)
    if (a === 'leave' || a === 'take' || a === 'den' || a === 'drop') { if (typeof p !== 'string') return false; C.act(a, p, o); return true; }   // (features/foxden.js)
    if (a !== 'fell' || !p || typeof p.fid !== 'string') return false;
    C.act('fell', p.fid, tagged('fell', p, o)); return true;
  }
  function nearestTree() {
    const P = host.player; let best = null, bd = 1e9;
    for (const p of trees) { const d = Math.hypot(p.x - P.x, p.y - P.y); if (d < bd) { bd = d; best = p; } }
    return best;
  }

  const F = {
    name: 'coop', label: 'Co-op', on: true, net: C, look, act, gear, get key() { return playerKey(); },
    tag(a, fn) { (tags[a] ??= []).push(fn); },
    get online() { return C.status === 'online'; },
    wear(ids) { if (C.status !== 'online') return false; C.wear(ids); return true; },   // (features/gear.js: ask for a set)
    fish(o) { if (C.status !== 'online') return false; C.fish(o); return true; },       // (features/fishing.js: the server rolls the catch)
    snow(o) { if (C.status !== 'online') return false; C.snow(o); return true; },       // (features/winter.js: his snowball hit a friend; the server tells everyone)
    mail, clockNow,
    // a friend's lit lantern in the cave within r m of (x, y) (their latest snapshot: features/mining.js's night veins hide from it)
    litNear(x, y, r) {
      for (const q of C.peers.values()) { if (!q.lt || !q.n) continue; const i = (q.head - 1 + q.X.length) % q.X.length; if (Math.hypot(q.X[i] - x, q.Y[i] - y) < r) return true; }
      return false;
    },
    update(dt) {
      mail.length = 0;
      if ((clkCheck -= dt) <= 0) { clkCheck = 2; follow(false); }
      C.drain(msgs);
      for (const m of msgs) {
        if (m.k === 'world' && m.s === 'felled') {   // the woodcutting fells it (its fall, stump, logs), else it just goes
          const p = treeOf(m.id), by = C.peers.get(m.by), o = by ? C.sample(by, BYS) : null;
          const way = typeof m.dx === 'number' && typeof m.dy === 'number' ? m : null;   // (the server's word on the fall's way: the same on every client)
          if (!p || !host.feature('woodcut')?.fellShared?.(p, m.by === C.id, !!m.late, o?.x, o?.y, way?.dx, way?.dy)) fell(m.id);
        }
        else if (m.k === 'clock') {
          clk.t = m.t; clk.h = m.h; clk.rate = m.rate;
          if (env) { env.borrowed = true; env.setDayMinutes(m.rate > 0 ? 24 / (m.rate * 60000) : 0); env.setKeep?.(m.season); follow(true); }   // (season: the one the server keeps the world in; none: its year turns)
          const want = flags.get('time');   // (dev: a ?time= asks the server's clock for it, once)
          if (want && !askedTime) { askedTime = true; C.act('time', want); }
        }
        else if (m.k === 'sec' || m.k === 'ev' || m.k === 'fish' || m.k === 'world' || m.k === 'bolt' || m.k === 'snow' || m.k === 'smith' || m.k === 'made' || m.k === 'rec' || m.k === 'skills') mail.push(m);   // (world: a patch picked or grown back, features/forage.js; a vein struck, spent or back, features/mining.js; a build put down, stoked or gone, features/builds.js)
        else if (m.k === 'fix') { host.teleport(m.x, m.y); say('the server put you back (moving too fast)'); }
        else if (m.k === 'deny') { say(`the server said no: ${m.a} ${m.id || ''} (${m.why})`); if (m.a === 'pot' || m.a === 'rope' || m.a === 'find' || m.a === 'leave') mail.push(m); }   // (a pot refused: features/builds.js gives its food back; features/rope.js, features/animalfinds.js: someone had it first)
        else if (m.k === 'gear') { gear.ids = m.g; gear.ver++; }
      }
      msgs.length = 0;
      for (const q of C.joined) say(`${q.name} joined`); C.joined.length = 0;
    },
    frame(f) {
      send(performance.now());
      if (noteT > 0) noteT -= f.dt;
      look.frame(f);
    },
    hd(q2, sc) {
      look.hd(q2, sc);
      const msg = C.status === 'online' ? (noteT > 0 ? note : '') : C.status === 'connecting' ? 'co-op: connecting…' : `co-op: disconnected (${C.why})`;
      if (msg) banner(q2, host.hudScale, msg);
    },
    hud: () => `co-op ${C.status} · you #${C.id} ${C.name} · ${C.peers.size + 1} in the world · seed ${SESSION.seed} · ping ${C.ping | 0} ms`,
    menu: () => [{label: `Co-op: fell the nearest forest tree (test; ${C.peers.size + 1} players)`, run: () => { const p = nearestTree(); if (!p) say('no forest trees here'); else if (!act('fell', p)) say('not online'); }}],
    dispose() { C.close(); },
  };
  addEventListener('pagehide', () => C.close());
  return F;
}

// asked for co-op but no server answered: say so for a while (the page plays offline)
function offline(host) {
  let t = 12;
  return {name: 'coop', on: true, online: false, act: () => false, tag() {},
    frame(f) { t -= f.dt; },
    hd(q2) { if (t > 0) banner(q2, host.hudScale, 'co-op: ' + SESSION.error + ' · playing offline'); },
    hud: () => 'co-op: offline (' + SESSION.error + ')'};
}
function banner(q2, s, text) {
  q2.save(); q2.setTransform(1, 0, 0, 1, 0, 0);
  q2.font = `600 ${Math.round(6 * s)}px "Segoe UI", system-ui, sans-serif`; q2.textAlign = 'center'; q2.textBaseline = 'top';
  const w = q2.measureText(text).width + 16 * s / 2.4, x = q2.canvas.width / 2, y = 10 * s / 2.4;
  q2.fillStyle = 'rgba(14,16,15,.78)'; q2.fillRect(x - w / 2, y, w, 9 * s); q2.fillStyle = '#f0e2c0'; q2.fillText(text, x, y + 1.5 * s);
  q2.restore();
}
