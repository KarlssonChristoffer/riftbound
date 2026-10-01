// SMOKE: the paths the golden tour doesn't take, run once each and checked for errors (exceptions, console errors /
// warnings). Armour, HD bow, lantern, colliders, loadout switches, a biome switch, pause / resume, camera turning, a
// window resize (ultrawide), wheel zoom, the title screen, a run. Pairs with tools/test/golden.mjs (which proves the
// pixels didn't change): run both after a restructure.
//   node tools/test/smoke.mjs [--path src/] [--port 8142]
import {spawn} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const PAGE = arg('path', 'src/').replace(/^\/|\/?$/g, '') + '/', PORT = +arg('port', 8142);
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const server = spawn('python', [join(ROOT, 'serve.py'), String(PORT)], {stdio: 'ignore'});
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1920,1080',
  '--remote-debugging-port=9354', '--user-data-dir=' + mkdtempSync(join(tmpdir(), 'smoke-')), 'about:blank'], {stdio: 'ignore'});
const quit = code => { try { chrome.kill(); } catch {} try { server.kill(); } catch {} process.exit(code); };
let tabs; for (let i = 0; i < 80; i++) { try { tabs = await (await fetch('http://127.0.0.1:9354/json')).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}, logs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 400));
  else if (m.method === 'Runtime.consoleAPICalled' && /error|warn/.test(m.params.type)) logs.push(m.params.type + ' ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300)); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
const ev = async expr => { const r = await send('Runtime.evaluate', {expression: expr, awaitPromise: true, returnByValue: true}); return r.result?.exceptionDetails ? {err: JSON.stringify(r.result.exceptionDetails).slice(0, 700)} : r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
const size = (w, h) => send('Emulation.setDeviceMetricsOverride', {width: w, height: h, deviceScaleFactor: 1, mobile: false});
await size(1920, 1080);
await send('Page.addScriptToEvaluateOnNewDocument', {source: 'window.requestAnimationFrame = () => 0;'});   // (frames are stepped here)
const load = async q => { await send('Page.navigate', {url: `http://localhost:${PORT}/${PAGE}?${q}`}); for (let i = 0; i < 200; i++) { await sleep(250); if (await ev('!!(window.__r3d && window.__r3d.world)')) return true; } return false; };
const key = (k, x = {}) => `window.dispatchEvent(new KeyboardEvent('keydown', {key: '${k}', ...${JSON.stringify(x)}})); window.dispatchEvent(new KeyboardEvent('keyup', {key: '${k}', ...${JSON.stringify(x)}}));`;
const step = n => `window.__r3d.step(${n});`;
let fail = 0;
async function run(label, js, wait = 0) {
  const n0 = logs.length, r = await ev(`(() => { ${js} return 1; })()`); await sleep(wait);
  const bad = r?.err || logs.length > n0;
  if (bad) fail++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${label}${r?.err ? ' ' + r.err : ''}${logs.length > n0 ? '\n     ' + logs.slice(n0).join('\n     ') : ''}`);
}
if (!await load('mode=sandbox&windlevel=gale')) { console.log('the page did not load', logs.join('\n')); quit(2); }
await sleep(2000);
await run('frames', step(30));
await run('armour on (I)', key('i') + step(30), 800);
await run('HD bow (J) + a shot', key('j') + 'window.__r3d.PL.press();' + step(20) + 'window.__r3d.PL.release();' + step(20));
await run('lantern (L)', key('l') + step(10));
await run('colliders (Shift+G)', key('g', {shiftKey: true}) + step(5));
await run('debug views (G x7)', Array(7).fill(key('g') + step(2)).join(''));
await run('loadout (O)', key('o') + step(5), 2500);
await run('after the loadout', step(30));
await run('loadout (O) again', key('o') + step(5), 2500);
await run('biome (N)', key('n') + step(5), 3000);
await run('after the biome', step(30));
await run('pause (Esc)', key('Escape') + step(30));
await run('resume (Esc)', key('Escape') + step(30));
await run('camera turn (X)', 'window.__r3d.keys.add("x");' + step(40) + 'window.__r3d.keys.delete("x");' + step(5));
await size(2560, 1080); await run('ultrawide resize', 'window.dispatchEvent(new Event("resize"));' + step(20));
await size(1920, 1080); await run('back to 16:9', 'window.dispatchEvent(new Event("resize"));' + step(20));
await run('wheel zoom in + out', `document.querySelector('#screen').dispatchEvent(new WheelEvent('wheel', {deltaY: -100, bubbles: true, cancelable: true}));` + step(60) +
  `document.querySelector('#screen').dispatchEvent(new WheelEvent('wheel', {deltaY: 100, bubbles: true, cancelable: true}));` + step(60));
if (await load('')) { await sleep(1500); await run('title screen', step(60)); } else { fail++; console.log('FAIL title did not load'); }
if (await load('mode=run')) { await sleep(1500); await run('a run (600 frames)', step(600)); } else { fail++; console.log('FAIL run did not load'); }
console.log(fail ? `\n${fail} FAILED` : '\nall smoke checks passed');
ws.close();
quit(fail ? 1 : 0);
