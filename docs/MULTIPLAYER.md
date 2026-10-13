# Co-op: playing in one world with friends

Status: 2026-10-11, first slice. Two or more players (8 by default) walk the same world: they see each other move and animate
(the live gunslinger's own drawn pose), the forest comes from the server's seed, and changes to the shared world (a felled tree)
are decided by the server and seen by everyone, late joiners included. The lasso shows on other players. Everything else (the
Proving Grounds' crates, brutes, fires, gunfire, the weather) still runs per client and is not shared yet: see "Not yet".

## Run it

```
node server/server.mjs                     (random seed; --seed 1234 for a fixed forest; --port 8320 is the default;
                                            --hour 22 starts at night, --daymin 20 real minutes a day, --nshift 1)
```

It prints a URL: open `http://localhost:8320/src/?mp=1` in two windows (or two machines on the LAN:
`http://<host-ip>:8320/src/?mp=1`). `&name=Ann` sets the name over your head. The server serves the game's files itself (no
`serve.py` needed). From a git worktree, which lacks the git-ignored renders, add `--assets D:/Game` (files the repo doesn't have
are read from there). A page served from elsewhere joins with `?mp=host:port`.

On Windows, `play-coop.bat` does both: the server in its own window, then two separate Chrome windows that join it (put them
side by side: a tab in the background pauses, and its player stands still for the other). `play-coop.bat --seed 1234` keeps the
same forest from run to run.

In the menu's Sandbox tab, "Co-op: fell the nearest forest tree (test)" asks the server to fell the forest tree nearest you
(within 4 m): it goes for every player. The woodcutting slice will call the same (`host.feature('coop').act('fell', tree)`).

## How it works

```
 browser (each player)                                       server/server.mjs (node, no dependencies)
 core/session.js   GET /mp/session -> seed  ───────────────▶  the seed (--seed, RIFT_SEED or random)
   (before the world is built: layout.js reads the seed)
 world/forest.js   the forest from the seed  ─ same code ─▶   room.mjs knows every tree (forestTrees(seed))
 features/coop.js  ── st 20 Hz (place, facing, pose) ──────▶  room.mjs: checks the move, keeps the latest
                   ◀── snap 20 Hz (everyone's) ────────────   (a fix if it was too fast)
                   ── act {fell, id} ─────────────────────▶   checks it (exists, in reach, not gone): world[id]
                   ◀── world {id, felled} (to all) ────────   late joiners get the whole world in their welcome
 features/gear.js  ── gear {g: [ids]} ─────────────────────▶  checks the set (content/gear.js), keeps it as the player's
                   ◀── gear {id, g} (to all) ──────────────   late joiners get everyone's in their welcome (docs/GEAR.md)
 features/coop/look.js  the others drawn live, interpolated 110 ms behind the newest snapshot
```

- **Authority.** The server owns who is in the room, the seed and the shared world's state; a client asks (`act`), the server
  decides and tells everyone, and only then does any client change its world. Each player's own body is simulated by its own
  client (no input lag, the game's sim untouched) and the server checks it: a move faster than `MOVE.maxSpeed` (26 m/s, +2.5 m
  slack) is refused and the client put back where the server last accepted it (`fix`). A respawn or teleport (a jump over 4 m in
  one send) is flagged as one and accepted. Moving the player's sim onto the server is possible later (the sim is already a
  fixed-step function of input: core/loop.js), but it is not needed for co-op among friends and would add input lag.
- **Transport.** `net/transport.js` is the only code that knows it's a WebSocket: a transport is `{send(text), close(), open,
  onopen, onmessage, onclose}`. The server side is the same shape (`server/ws.mjs`), and `server/room.mjs` never sees a socket.
  Electron / Steam networking / WebRTC can come in as another transport module without touching the room or the game.
- **Protocol.** `net/protocol.js`, shared by both sides: JSON messages `{k: kind, ...}` (the list is at the top of that file).
  The drawn pose (31 bones x 7 numbers) goes as 16-bit integers in base64 (~580 characters), sent only when it changed.
  Per player ~20 messages a second each way; ~10-15 KB/s per player while moving.
- **What the others look like.** A player drawn live (the gunslinger, the default in co-op) sends the pose his body is DRAWN in
  (view/livehero.js DRAWN: the aim twist, the lean, the combat stances, a ragdoll), which the receiver shows bone for bone on the
  same model (view/livebody.js through render/rigmesh.js, as the desert's gunmen). A player in a sprite loadout sends only his
  frame's name; he is drawn as the gunslinger playing that frame. His name floats over his head in his colour.
- **The clock and the uncanny forest** (2026-10-12, protocol 2; docs/UNCANNY.md). The server owns the world's clock (`--hour`,
  `--daymin`): it sends `clock {t, h, rate}` in the welcome and on every change, and each client's clock (sim/env.js) follows it
  (put right when it drifts more than a game minute; not saved as the page's own). It also owns the forest's secrets (their
  states and who opened them: `sec`, all of them in the welcome) and the night elk (in every snapshot as `c`; its knocks as
  `ev`). Clients ask with `act secret` (a secret whose condition holds for them) and, for tests, `act time` (`?time=night`
  asks it). Which trees walk at night needs nothing sent: it comes from the seed and the clock. The uncanny forest is off unless the server
  runs with `--uncanny` (the welcome's `unc` is then set and every client turns it on; without it, null and off).
- **Sim vs view.** Shared-world changes and fixes are applied in the feature's `update` (a sim step); the others' bodies are view.
  Without `?mp` the feature is an empty shell: the game, golden, smoke and simview are unchanged.

## Files

| file | what |
|---|---|
| `server/server.mjs` | the process: static files + `/mp/session` + the WebSocket at `/mp` |
| `server/ws.mjs` | a small RFC 6455 WebSocket server on node's http (no npm) |
| `server/room.mjs` | the room: join / leave, names and colours, the movement check, acts, the world state, the 20 Hz snapshots |
| `src/net/protocol.js` | the messages, rates, limits, the pose packing (shared with the server) |
| `src/net/transport.js` | the browser's WebSocket transport |
| `src/net/client.js` | the client: hello / welcome, the peers' snapshot rings, interpolation, the clock offset |
| `src/core/session.js` | `?mp` / `?seed`: which world, settled before the world is built (a top-level await) |
| `src/features/coop.js` | the feature: sends the player, applies the world's changes, `act()`, HUD, menu row |
| `src/features/coop/look.js` | the others: live bodies (dressed in their gear), name tags, the lasso's rope |
| `src/features/gear.js` | what you wear: asks the server in co-op, wears its answer (docs/GEAR.md) |

## Tested (2026-10-11, headless)

A scripted run with the server and three headless pages: all three got seed 1337 and the same 314 trees and lake; each saw the
others' positions and live poses (31 bones); a walk on one was seen on the other; a 30 m jump was refused and put back; a felled
tree vanished on both and was already gone for the third player who joined after it. golden (16/16 identical), smoke and simview
pass without `?mp`. Two visible windows on one machine were not tried (the project's rule: no visible windows from tools).

## Not yet

- Collisions between players (you walk through each other), and players' footsteps and gunshots for the others (no sound of them).
- Shared combat, props and enemies: crates pushed, barrels exploding, brutes and gunmen are each client's own. The lasso shows on
  the others, but what it catches is only in its thrower's world.
- The weather is each client's own (it starts the same way but drifts). The clock is the server's (see above).
- A hidden tab (or a minimized browser) stops sending: its player stands still for the others. Electron can keep it running
  (`backgroundThrottling: false`).
- Reconnecting: a dropped connection shows "disconnected"; reload to rejoin (a new id).
- Chopping: the woodcutting slice is not on main yet; it should call `coop.act('fell', tree)` and fell the tree on the `world`
  message, not on the swing.
