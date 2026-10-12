// SESSION: which world this page plays in, settled BEFORE the world is built (world/layout.js imports it: the forest's seed).
//   ?mp=1                 join the co-op server that served this page (server/server.mjs, same origin: docs/MULTIPLAYER.md)
//   ?mp=host:port         join that server (or a full ws:// / wss:// URL)
//   ?seed=N               offline: the forest from seed N (?forest=1: on with the default seed)
// With ?mp the server's seed decides the forest: the page asks its session endpoint (GET <server>/mp/session) here, with a
// top-level await, so every module that imports this one waits for the answer (a few ms on a LAN). A server that doesn't
// answer leaves the page offline (SESSION.error says why; features/coop.js shows it).
// OWNS: SESSION (read only after load). READS: flags (mp, seed, forest), the server's session endpoint.
import {flags} from './flags.js';
import {PATH, PORT} from '../net/protocol.js';

export const DEFAULT_SEED = 1337;
export const SESSION = {mp: false, ws: '', http: '', seed: null, error: ''};

function urls(v) {
  if (typeof location === 'undefined') return null;
  if (v === '1' || v === 'true' || v === '') return {ws: (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + PATH, http: location.origin};
  let u = v.includes('://') ? v : 'ws://' + v;
  if (!/:\d+/.test(u.replace(/^\w+:\/\//, ''))) u = u.replace(/^(\w+:\/\/[^/]+)/, '$1:' + PORT);
  const base = u.replace(/\/+$/, '').replace(/\/mp$/, ''), http = base.replace(/^ws/, 'http');
  return {ws: base.replace(/^http/, 'ws') + PATH, http};
}

const mp = flags.get('mp'), seedQ = flags.get('seed');
if (seedQ !== null && Number.isFinite(+seedQ)) SESSION.seed = +seedQ >>> 0;
else if (flags.get('forest') === '1') SESSION.seed = DEFAULT_SEED;
if (mp !== null && mp !== '0') {
  const u = urls(mp);
  if (u) {
    try {
      const r = await fetch(u.http + PATH + '/session', {cache: 'no-store', signal: AbortSignal.timeout(4000)});
      const j = await r.json();
      Object.assign(SESSION, {mp: true, ws: u.ws, http: u.http, seed: j.seed >>> 0});
    } catch (e) { SESSION.error = `no co-op server at ${u.http} (${e.name === 'TimeoutError' ? 'timed out' : e.message})`; console.warn('session:', SESSION.error); }
  }
}
// (the forest is on with a seed: ?seed, ?forest=1 or a co-op server's; ?forest=0 keeps it off even then)
if (flags.get('forest') === '0') SESSION.seed = null;
