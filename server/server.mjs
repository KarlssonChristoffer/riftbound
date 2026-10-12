// THE CO-OP SERVER (docs/MULTIPLAYER.md): one process that serves the game's files and hosts the room.
//   node server/server.mjs [--port 8320] [--seed 1234] [--host 0.0.0.0] [--assets D:/Game] [--quiet]
// then open http://localhost:8320/src/?mp=1 in two (or more) windows: everyone who opens it joins the same world.
//   GET  /mp/session   {v, seed, players}: the world's seed, read by the page BEFORE it builds the world (core/session.js)
//   WS   /mp           the room (room.mjs): join, state, acts, snapshots
//   GET  anything else a file under the repo (no cache, like serve.py); --assets: a second root for files the repo doesn't
//        have (the git-ignored renders in concepts/sprites/out and audio/forge/out when running from a git worktree)
// No dependencies: node's http server + server/ws.mjs. The seed is random unless given (--seed or RIFT_SEED); it lives as long
// as the process, so a restart is a new forest unless the seed is passed again.
import http from 'node:http';
import {readFile, stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {attachWs} from './ws.mjs';
import {createRoom} from './room.mjs';
import {VERSION, PATH, PORT} from '../src/net/protocol.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, d) => { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const port = +arg('port', process.env.PORT || PORT), host = arg('host', '0.0.0.0');
const seed = (+arg('seed', process.env.RIFT_SEED ?? NaN) >>> 0) || (Math.random() * 4294967296 >>> 0) || 1;
const assets = arg('assets', null), quiet = process.argv.includes('--quiet');
const log = quiet ? () => {} : (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

// the forest's trees (src/world/forest.js, the same generator the clients run): the room checks a felled tree exists and is in reach
let trees = null;
try { const F = await import('../src/world/forest.js'); trees = F.forestTrees(seed); log(`forest ${seed}: ${trees.size} trees`); }
catch (e) { log('forest: not loaded (acts are not checked against the trees):', e.message); }

const room = createRoom({seed, trees, log});
const TYPES = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.css': 'text/css',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.glb': 'model/gltf-binary',
  '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8'};

async function file(root, rel) {
  const p = path.resolve(root, '.' + rel);
  if (p !== root && !p.startsWith(root + path.sep)) return null;   // (no way out of the root)
  try { let s = await stat(p), q = p; if (s.isDirectory()) { q = path.join(p, 'index.html'); s = await stat(q); } return s.isFile() ? {data: await readFile(q), ext: path.extname(q).toLowerCase()} : null; }
  catch { return null; }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x'), rel = decodeURIComponent(url.pathname);
  const head = {'Cache-Control': 'no-store, must-revalidate', 'Access-Control-Allow-Origin': '*'};
  if (rel === PATH + '/session') { res.writeHead(200, {...head, 'Content-Type': 'application/json'}); res.end(JSON.stringify({v: VERSION, seed, players: room.size})); return; }
  if (rel === '/') { res.writeHead(302, {Location: '/src/?mp=1'}); res.end(); return; }
  const f = await file(ROOT, rel) || (assets ? await file(path.resolve(assets), rel) : null);
  if (!f) { res.writeHead(404, head); res.end('not found'); return; }
  res.writeHead(200, {...head, 'Content-Type': TYPES[f.ext] || 'application/octet-stream'}); res.end(f.data);
});
attachWs(server, PATH, conn => room.connect(conn));
server.listen(port, host, () => {
  console.log(`Riftbound co-op server · seed ${seed} · http://localhost:${port}/src/?mp=1 (open it in two windows)${assets ? ' · assets from ' + assets : ''}`);
});
const stop = () => { room.stop(); server.close(); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
