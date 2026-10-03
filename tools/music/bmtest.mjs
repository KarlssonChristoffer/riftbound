// BATTLE MUSIC TESTS (headless Chrome over CDP, no dependencies): the file-music player + director in a real page.
//   node tools/music/bmtest.mjs offline [--sec 150] [--scenario death]   an OfflineAudioContext render of dev/bmusic.js's scripted fight through
//                                                     the real player + director: <out>/offline.wav + offline.json (the
//                                                     player's log checked against the cue sheets, the director's notes)
//   node tools/music/bmtest.mjs live [--sec 150]      the GAME in real time (a run: waves, the champion, its phases, low
//                                                     health, the kill, the pick, the portal), the music's answers logged
//                                                     and checked: <out>/live.json (+ per-frame cost, decoded bytes)
//   node tools/music/bmtest.mjs decode                the browser's decode of each song against the cue's file length
//   options: --path src/ (the page folder) --port 8181 --dbg 9386 --out tmp/bmusic
// The page is served by serve.py from the repo root (the songs: ../assets/src/cowboygameboy/music_ogg, git-ignored).
import {spawn} from 'node:child_process';
import {mkdirSync, writeFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const MODE = process.argv[2] || 'offline';
const PAGE = arg('path', 'src/').replace(/^\/|\/?$/g, '') + '/', PORT = +arg('port', 8181), DBG = +arg('dbg', 9386);
const OUT = arg('out', join(ROOT, 'tmp', 'bmusic')), SEC = +arg('sec', 150), SERVE_ROOT = arg('root', ROOT);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
if ([9342, 9351, 9352, 9354, 9372, 9373].includes(DBG)) { console.log('that debug port belongs to another tool'); process.exit(2); }
try { await fetch(`http://127.0.0.1:${DBG}/json`); console.log(`debug port ${DBG} busy`); process.exit(2); } catch {}
mkdirSync(OUT, {recursive: true});
const server = spawn('python', [join(SERVE_ROOT, 'serve.py'), String(PORT)], {stdio: 'ignore', cwd: SERVE_ROOT});
const PROFILE = mkdtempSync(join(tmpdir(), 'bmtest-'));
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,900',
  '--autoplay-policy=no-user-gesture-required', `--remote-debugging-port=${DBG}`, '--user-data-dir=' + PROFILE, 'about:blank'], {stdio: 'ignore'});
const quit = async c => {
  try { chrome.kill(); } catch {} try { server.kill(); } catch {}
  for (let k = 0; k < 20; k++) { try { rmSync(PROFILE, {recursive: true, force: true}); break; } catch { await sleep(250); } }
  process.exit(c);
};
let tabs; for (let k = 0; k < 80; k++) { try { tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}, logs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 600));
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) logs.push(m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 400)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 1500)); return r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
const nav = async url => { await send('Page.navigate', {url}); await sleep(1500); };

function wav(path, i16, sr) {
  const n = i16.byteLength, b = Buffer.alloc(44 + n);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(2, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 4, 28); b.writeUInt16LE(4, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n, 40);
  Buffer.from(i16.buffer, i16.byteOffset, n).copy(b, 44); writeFileSync(path, b);
}

let code = 0;
try {
  if (MODE === 'offline') {
    await nav(`http://localhost:${PORT}/${PAGE}content/cues.js`);   // (any page of the origin: the modules are imported)
    const SC = arg('scenario', '');
    const res = await ev(`(async () => { const m = await import('/${PAGE}dev/bmusic.js'); window.__bm = m; return m.renderScenario({sec: ${SEC}${SC ? ', script: m.SCENARIOS.' + SC : ''}}); })()`);
    console.log(`rendered ${res.frames} frames at ${res.sr} Hz in ${res.renderMs} ms (decode waits ${res.decodeWaitMs} ms), peak ${res.peak.toFixed(3)}`);
    console.log(`log: ${res.check.n} changes, ${res.check.ok} on the grid, ${res.check.bad.length} off`, res.check.bad.slice(0, 5));
    console.log('stats', JSON.stringify(res.stats));
    const size = 1 << 21, bytes = res.frames * 4, parts = [];
    for (let i = 0; i * size < bytes; i++) parts.push(Buffer.from(await ev(`window.__bm.chunk(${i}, ${size})`), 'base64'));
    const all = Buffer.concat(parts);
    const name = 'offline' + (SC ? '_' + SC : '');
    wav(join(OUT, name + '.wav'), new Int16Array(all.buffer, all.byteOffset, all.byteLength / 2), res.sr);
    writeFileSync(join(OUT, name + '.json'), JSON.stringify({...res, log: res.check.n ? res.log : []}, null, 1));
    if (res.check.bad.length) code = 1;
  } else if (MODE === 'decode') {
    await nav(`http://localhost:${PORT}/${PAGE}content/cues.js`);
    const res = await ev(`(async () => {
      const {CUES} = await import('/${PAGE}content/cues.js'), {MUSIC_BASE} = await import('/${PAGE}audio/tracks.js');
      const ac = new OfflineAudioContext(2, 48000, 48000), out = {};
      for (const [id, c] of Object.entries(CUES)) {
        const t0 = performance.now(), ab = await (await fetch(MUSIC_BASE + c.file.split('/').map(encodeURIComponent).join('/') + '.ogg')).arrayBuffer();
        const t1 = performance.now(), b = await ac.decodeAudioData(ab), t2 = performance.now();
        const d = b.getChannelData(0); let first = -1; for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > .02) { first = i; break; }
        out[id] = {sec: +b.duration.toFixed(4), cueDur: c.dur, sr: b.sampleRate, ch: b.numberOfChannels, MB: +(b.length * b.numberOfChannels * 4 / 1e6).toFixed(1),
          fetchMs: Math.round(t1 - t0), decodeMs: Math.round(t2 - t1), firstLoud: first};
      }
      return out; })()`);
    console.log(JSON.stringify(res, null, 1)); writeFileSync(join(OUT, 'decode.json'), JSON.stringify(res, null, 1));
  } else if (MODE === 'live') {
    await send('Page.navigate', {url: `http://localhost:${PORT}/${PAGE}?mode=run&weather=fair&daymin=0&bmforce=1`});
    let ok = false; for (let k = 0; k < 240; k++) { await sleep(250); try { if (await ev('!!(window.__r3d && window.__r3d.world)')) { ok = true; break; } } catch {} }
    if (!ok) throw new Error('page did not load');
    // a key press: the audio unlocks (the autoplay flag lets the context run)
    await send('Input.dispatchKeyEvent', {type: 'keyDown', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16});
    await send('Input.dispatchKeyEvent', {type: 'keyUp', key: 'Shift', code: 'ShiftLeft', windowsVirtualKeyCode: 16});
    for (let k = 0; k < 40; k++) { await sleep(250); if (await ev('!!(window.__bmusic && window.__audio?.on)')) break; }
    // the scripted player: kill an enemy every ~1.6 s (the champion in steps of 12% of its health), open the menu for 2 s,
    // hold the player's health under 30% for 10 s once the champion is under half, keep him alive otherwise, pick the
    // first augment, walk to the merchant and away, take the portal (the next stage). A probe row every 100 ms: game state + the music's state, on the audio clock.
    const res = await ev(`(async () => {
      const R = window.__r3d, g = R.game, core = R.host.feature('combat').core, B = window.__bmusic, TP = B.TP, D = B.D, ac = TP.ac;
      const probe = [], acts = [], sleep = ms => new Promise(r => setTimeout(r, ms));
      const t0 = ac.currentTime, end = t0 + ${SEC};
      const immune0 = core.immune; let pauseN = 0, killT = 0, bossT = 0, lowDone = false, lowT = -1, pickT = -1, portalT = -1, merchT = -1, leaveT = -1, stage0 = -1, frames = 0, msSum = 0, msMax = 0;
      const act = (what, x) => acts.push({t: +(ac.currentTime - t0).toFixed(3), what, x});
      const merch = () => R.host.props.find(p => p.kind === 'merchant');
      while (ac.currentTime < end) {
        await sleep(100);
        const t = ac.currentTime - t0, S = g.stats.S, d = g.director, list = core.enemies;
        const boss = list.find(b => b.boss);
        if (g.mode === 'run' && g.phase === 'wave') {
          const lowNow = lowT >= 0 && t - lowT < 10;   // 10 s under 30% health while the first champion is under half
          if (S.hp < 40 && !lowNow) { g.stats.heal(60); act('heal'); }
          if (lowNow && S.hp > S.maxHp * .28) S.hp = S.maxHp * .22;
          core.immune = lowNow ? () => true : immune0;   // (low, not dead: the test's player can't be hit meanwhile)
          if (boss && boss.hp / boss.maxHp < .5 && !lowDone) { S.hp = Math.min(S.hp, S.maxHp * .22); lowDone = true; lowT = t; act('low hp'); }
          if (t - killT > 1.6) { const b = list.find(b => !b.boss); if (b) { core.damage(b, 9999); killT = t; act('kill', b.elite ? 'elite' : 'brute'); } }
          if (boss && t - bossT > 3.2) { core.damage(boss, Math.ceil(boss.maxHp * .12)); bossT = t; act('boss hit', +(boss.hp / boss.maxHp).toFixed(2)); }
        }
        if (pauseN === 0 && t > 14) { dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); pauseN = 1; act('pause'); }   // the menu: 2 s
        if (pauseN === 1 && t > 16) { dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'})); pauseN = 2; act('resume'); }
        if (g.phase === 'pick' && pickT < 0) { pickT = t; }
        if (g.phase === 'pick' && t - pickT > 6) { document.querySelector('.gs-card')?.click(); act('pick'); pickT = 1e9; }
        if (g.phase === 'portal' && merchT < 0) { const m = merch(); if (m) { R.host.teleport(m.x - 1.5, m.y + 1.2); merchT = t; act('to the merchant'); } else merchT = t; }
        if (g.phase === 'portal' && merchT >= 0 && leaveT < 0 && t - merchT > 14) { R.host.teleport(R.host.layout.spawn.x, R.host.layout.spawn.y); leaveT = t; act('away from the merchant'); }
        if (g.phase === 'portal' && leaveT >= 0 && portalT < 0 && t - leaveT > 10) { portalT = t; act('portal'); g.enterStage(g.run.stage + 1); }
        const pf = R.perf?.stats?.('battlemusic');
        probe.push({t: +t.toFixed(3), mode: g.mode, phase: g.phase, dir: d.phase, wave: d.wave, alive: list.length, elites: list.filter(b => b.elite).length,
          boss: boss ? +(boss.hp / boss.maxHp).toFixed(3) : -1, hp: +(S.hp / S.maxHp).toFixed(2), state: D.state, role: D.role, I: +D.I.toFixed(2),
          song: TP.song, tpRole: TP.role, bar: TP.state.bar, filter: D.filter, paused: !!R.host.paused, duck: D.duck, ms: +B.F.ms.toFixed(4), proc: !!window.__audio.music?.enabled});
      }
      return {t0, probe, acts, log: B.log(), check: B.check(), stats: {...TP.stats}, featMs: B.F.ms, songs: [...TP.songs.values()].map(e => ({id: e.id, resident: !!e.buf, MB: +(e.bytes / 1e6).toFixed(1)}))};
    })()`);
    console.log(`probe rows ${res.probe.length}, actions ${res.acts.length}, log ${res.check.n} changes, ${res.check.ok} on the grid, ${res.check.bad.length} off`);
    console.log('stats', JSON.stringify(res.stats)); console.log('songs', JSON.stringify(res.songs));
    writeFileSync(join(OUT, 'live.json'), JSON.stringify(res, null, 1));
    if (res.check.bad.length) code = 1;
  }
} catch (e) { console.log('error', String(e).slice(0, 2000)); code = 1; }
if (logs.length) console.log(`console (${logs.length}):`, logs.slice(0, 12).join(' | '));
ws.close(); quit(code);
