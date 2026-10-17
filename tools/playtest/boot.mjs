// PLAYTEST BOOT CHECK: load a running server's page in headless Chrome for a few seconds and list exceptions and console
// errors. The playtest server's only check before Christoffer plays it (speed over verification).
//   node tools/playtest/boot.mjs [--url http://localhost:8340/src/?mp=1] [--secs 40]
import {launch} from '../lib/chrome.mjs';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const URL_ = arg('url', 'http://localhost:8340/src/?mp=1'), SECS = +arg('secs', 40), DBG = 9361;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const chrome = launch('playtest', ['--headless=new', '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist',
  '--window-size=1475,706', `--remote-debugging-port=${DBG}`, 'about:blank']);
let stopped = false;
const stop = () => { if (stopped) return; stopped = true; chrome.kill(); };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });
let tabs; for (let i = 0; i < 80; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${DBG}/json`)).json(); if (tabs.find(t => t.type === 'page')) break; } catch {} await sleep(250); }
const ws = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl); await new Promise(r => ws.onopen = r);
let id = 0; const pend = {}, logs = [];
ws.onmessage = e => { const m = JSON.parse(e.data); if (pend[m.id]) { pend[m.id](m); delete pend[m.id]; }
  else if (m.method === 'Runtime.exceptionThrown') logs.push('EXCEPTION ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 500));
  else if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || (m.params.type === 'warning' && /failed to load/.test(m.params.args.map(a => a.value ?? '').join(' '))))) logs.push('error ' + m.params.args.map(a => a.value ?? a.description).join(' ').slice(0, 300));
  else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') logs.push('log ' + m.params.entry.text.slice(0, 200) + ' ' + (m.params.entry.url || '')); };
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend[i] = r; ws.send(JSON.stringify({id: i, method, params})); });
await send('Runtime.enable'); await send('Log.enable');
await send('Page.navigate', {url: URL_});
await sleep(SECS * 1000);
const r = await send('Runtime.evaluate', {expression: 'JSON.stringify({r3d: !!window.__r3d, frames: window.__r3d?.frame ?? null})', returnByValue: true});
console.log('page:', r.result?.result?.value);
console.log(logs.length ? logs.join('\n') : 'no errors');
stop(); process.exit(logs.some(l => l.startsWith('EXCEPTION')) ? 1 : 0);
