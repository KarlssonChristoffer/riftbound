// PROTOCOL: the co-op wire format (docs/MULTIPLAYER.md), shared by the browser (net/client.js, features/coop.js) and the server
// (server/room.mjs): plain data and pure functions, no DOM and no node, so both sides import this one file.
// Messages are JSON objects {k: kind, ...}. The transport under them (net/transport.js: a WebSocket today) only carries text.
//
// client -> server
//   hello    {v, name, key, xp, made?}                   the first message; the server answers with welcome. key = the browser's
//            random player key (32 hex: game/playerkey.js; the server keeps a player's records by it, server/players.mjs), xp = his
//            skills' XP as his own save has it {id: n} (read only on a key the room hasn't seen, capped), made = the save's
//            copy of his made things' records (features/workshop.js: at most 64; the server's own win)
//   st       {x, y, z, phi, s, pose, rig, w?, wn?, ls?, tp?, lt, md, bd}   the local player 20 times a second: world metres (x east, y south,
//            z up), facing phi (rad, the arena's atan2(x, y)), s = his state (idle, move, roll, ...), pose = the frame drawn,
//            rig = the live model he wears (gunslinger | outlaw | ''), w = the drawn pose's bones (encodePose) when it changed
//            (wn: its bone names, once per rig), ls = the lasso [phase, x, y, h, r] or absent, tp = a respawn / teleport,
//            lt = 1 his lantern burns in the cave (2: a burnt eel's shining eyes, only the soot things take it), md = the meal in him
//            (content/meals.js codeOf: 'fish_lingon', 'pike_stew!' burnt, 'smoked_eel~' underdone; '' none), bd = his body's look
//            (content/body.js packBody: wet, cold, sunk, knocked down), an = the animal on his rope [id, x, y, heading, mode] or
//            absent (features/rope.js; the server keeps it only while it's his claim: server/animals.mjs)
//   act      {a, id}                                      ask the server to change the shared world: a 'fell' (id: a forest tree),
//            'secret' (id: one of the forest's secrets whose own condition holds for this player: sim/uncanny.js), 'time' (id:
//            dawn | day | dusk | night: dev, the world's clock to the next such hour), 'ignite' (id: a tree he touched a burning
//            brand to: ?firestart=1, docs/WEATHER.md), 'wood' (id: a struck tree whose splinter of thunderwood he took), 'hole' ({x, y, b}: a hole
//            in the lake ice: a pick's or an axe's last blow, b 1: he went through; docs/WINTER.md), 'dig' (id: 'w' + the
//            night: he dug at the night's find where the true wisp stopped, docs/MIRE.md), 'cloud' (id: 'x' + the wrong
//            weather's event, w: ask | pass | lose, to: a friend's id; the following cloud, docs/WEATHER.md). The workshop's (docs/WORKSHOP.md):
//            'make' {id: the anvil's build id ('' by hand), r: the recipe (content/workshop.js SMITH / HAND), haft, inlay, dev?};
//            a 'fell' and a 'mine' carry u (the tool's record) and a 'fell' old (1: an old oak) for the counts. The animals
//            (server/animals.mjs): 'rope' (id: the plan's animal id: claim it, first wins), 'free' {x, y, how}, 'calm' {at: the
//            hour} (a roe), 'find' (id: 'fur:' + hare + ':' + day). The skills'
//            (docs/SKILLS.md): 'crystal' (id: 'c' + a cave crystal's index in
//            the cave plan's props: broken under his pick, its Mining XP), 'mine' (rh: 1 a rhythm blow: the chain, docs/SKILLS.md),
//            'title' (id: a title of his to wear, '' none), 'dev' (id: next | reset | titles | notitles: a --dev server's Skills rows)
//   gear     {g: [id]}                                    what you want to wear (content/gear.js ids); the server checks it
//   fish     {a: 'cast', n, x, y, w, deep, rain, perfect, lvl, spot, bait, meal}   a cast fell on water (docs/FISHING.md): n = his
//            cast count, w = lake | stream | river, deep = m from the shore, lvl = his Fishing level, spot = on a fishing spot
//            (the server checks it), bait / meal = the bait on the hook, the meal eaten (ids); the server rolls what bites. {a: 'land', n}: he
//            landed it (told to everyone); {a: 'lost', n}: it got away. {a: 'grab', n, x, y, w}: a fish grabbed by hand (the
//            lingon's school: content/fishing.js COME; the server checks the meal codes and answers {a: 'grabbed', n, id, cm, kg})
//            {a: 'jab', n, x, y, w, lvl}: the Heron Feather's jab
//            into the shallows at his feet (docs/KEEPSAKES.md; n = his jab count), rolled at once
//   ping     {c}                                         c = the client's clock (ms), echoed
//   snow     {id, vx, vy, hat}                            his snowball hit player id (the thrower decides: docs/WINTER.md), pushing
//            them (vx, vy m/s), hat 1: their hat flies off
// server -> client
//   welcome  {v, id, name, color, seed, t, world, peers, clock, unc, made}   world = {id: state} (what's been done to the world so far),
//            peers = [peer], clock (below), unc = {sec: {id: {s, by, n}}, shift} (the uncanny forest: its secrets' states, the
//            night shift's strength: docs/UNCANNY.md; null when the server runs without it), made = his records (server/workshop.mjs)
//   join     {p: peer}   leave {id}                      peer = {id, name, color, ...st's fields, wn, g (the gear worn), t (his title)}
//   ptitle   {id, t}                                     the title a peer wears now ('' none; content/skills.js TITLES)
//   snap     {t, p: [[id, x, y, z, phi, s, pose, rig, w|0, ls|0, lt, md, bd, an|0], ...], c?}   every tick; w only when it changed since the last snap;
//            c = the night elk [x, y, phi, mode, quarry id] (sim/uncanny.js createStalker: the server runs it)
//   wn       {id, wn}                                    a peer's bone names (its rig changed)
//   world    {id, s, by}                                 a change to the shared world (s: 'felled'), by = who did it; a fell's dx, dy:
//            the way it falls (unit: away from the feller as the server saw him). A tree the
//            lightning struck: id 'z' + its fid, s 'burning' {t0, t1 (s of the server's clock), tw} | 'charred' {at (the hour it's whole
//            again: the next spring), tw (1: a splinter of thunderwood at its foot)} | 'grown'. A hole in the lake ice: id 'i' + n, s 'hole' {x, y, r, at (the hour it's frozen over)}.
//            A dig at the mire's find: id 'w' + the night, s 'dug', by (the digger gets the night's find: content/mire.js findOf; not kept)
//   bolt     {a: 'mark', n, kind, id, x, y, h, tele}     natural lightning (docs/WEATHER.md; the server aims it in a storm): bolt n will
//            strike (x, y) at height h in tele s (kind: tree | tor | ground | player, id: the tree's fid or the player's id).
//            {a: 'strike', n, kind, id, x, y, h}: it struck (a player under it hurts himself: where he stands now)
//   skills   {xp: {id: n}, d?: {id: n}, ml?, ti?}        to one player: his XP as the server keeps it (all of it after the welcome,
//            then each skill a grant raised; d = what this grant gave: the "+n xp"); ml = the server's --movelvl; ti = his titles
//            {titles: [id], title (worn), got: [id] (just earned)}
//   clock    {t, h, rate}                                the world's clock (the server owns it): at server time t (ms) it was h
//            in-game hours since the start (sim/env.js E.t), going on at rate hours per ms (0: stopped). In welcome too
//   sec      {id, s, by, n}                              a secret's state changed (sleeping / awake / triggered / spent), by =
//            who opened it (ids), n = on which night
//   ev       {a: 'knock', id, vx, vy}                    the night elk knocked player id down (vx, vy m/s): they drop something;
//            {a: 'rope', id, by} / {a: 'free', id, by, x, y, how}: animal id is on player by's rope / let go there (server/animals.mjs)
//   deny     {a, id, why}                                an act refused
//   gear     {id, g}                                     what a player wears now (to everyone, the wearer too: his set as
//                                                        the server took it; docs/GEAR.md)
//   fish     {a: 'bite', n, id, cm, kg, wait, nibbles, two}   to the caster: what bites cast n (content/fishing.js roll), when
//            (wait s, the nibbles' s before it), two = a double catch, sh = nose | spook (a cast at a fish shadow: Fishing 5). {a: 'caught', id, name, c, cm, kg, two}: to everyone,
//            player id landed catch c. {a: 'jabbed', n, id, cm, kg}: to the jabber, what jab n came up with (id '': nothing)
//   snow     {by, id, vx, vy, hat}                       player by's snowball hit player id (to everyone but the thrower)
//   made     {rec, dev?}                                 to the maker: the record of a thing he made (the client pays when it hears it)
//   rec      {u, counts, marks}                          to its owner: what his tool has done since (at most every 2 s)
//   fix      {x, y, z}                                   the server didn't accept your position: you are here
//   fish     {a: 'jabbed', n, id, cm, kg}                to the jabber: what jab n came up with (id '': nothing)
//   pong     {c, t}                                      t = the server's clock (ms)
export const VERSION = 3;   // (3: the player key, server-owned XP: docs/SKILLS.md)
export const TICK_HZ = 20;          // the server's snapshot rate; a client sends its state at the same rate
export const INTERP_MS = 110;       // remote players are drawn this far behind the newest snapshot (two ticks and a little)
export const PATH = '/mp';          // the WebSocket's path on the server, and the HTTP session endpoint (PATH + '/session')
export const PORT = 8320;           // the server's default port
// the server's movement check (room.mjs): faster than MAX_SPEED over a tick (+ SLACK m) is refused and the client put back
export const MOVE = {maxSpeed: 26, slack: 2.5};
// what an act may reach: a tree is felled from within REACH m of it
export const REACH = 4;
// the world's clock when a server starts (in-game hours since the start; 9: the first morning) and real minutes per in-game day
// (sim/env.js TUNE.dayMinutes; node server/server.mjs --hour / --daymin)
export const CLOCK = {hour: 9, daymin: 20};
export const COLORS = ['#f0c060', '#7ec8e3', '#e98aa8', '#9ad07a', '#c9a0ff', '#ff9f5a', '#6fe0c0', '#e0e070'];

export const encode = m => JSON.stringify(m);
export function decode(text) { try { const m = JSON.parse(text); return m && typeof m.k === 'string' ? m : null; } catch { return null; } }
export const num = (v, d = 0) => typeof v === 'number' && Number.isFinite(v) ? v : d;
export const str = (v, n = 32) => typeof v === 'string' ? v.slice(0, n) : '';

// THE POSE: a live body's drawn bones (view/livehero.js DRAWN.w: 7 numbers a bone, quaternion x y z w then position x y z in
// body space, metres) as 16-bit integers (the quaternion x 32767, the position x POS_Q: +-4 m at .12 mm), base64 in the JSON.
// b64 / unb64 are the side's own (btoa / atob in the browser, Buffer on the server: it never decodes one, it only forwards it)
const POS_Q = 8000;
export function packPose(w, nb, out) {   // -> Int16Array (out reused when it fits)
  const a = out && out.length === nb * 7 ? out : new Int16Array(nb * 7);
  for (let i = 0; i < nb * 7; i++) { const k = i % 7, v = k < 4 ? w[i] * 32767 : w[i] * POS_Q; a[i] = v > 32767 ? 32767 : v < -32768 ? -32768 : Math.round(v); }
  return a;
}
export function unpackPose(a, w) {   // Int16Array -> w (Float64Array, nb x 7)
  const n = Math.min(a.length, w.length);
  for (let i = 0; i < n; i++) w[i] = i % 7 < 4 ? a[i] / 32767 : a[i] / POS_Q;
  return w;
}
