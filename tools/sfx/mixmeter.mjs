// MIX METER (Phase 4): drives the live arena in headless Chrome, taps the forge engine buses, prints loudness per bus
// per scenario (rms dB / momentary-max LUFS). Needs the dev server on :8126. Usage: node tools/sfx/mixmeter.mjs [seconds per scenario]
import {spawn} from 'node:child_process';
import {rmSync} from 'node:fs';
const port = 9100 + Math.floor(Math.random() * 90), dir = process.env.TEMP + '/cdp_p4_' + port, SEC = +(process.argv[2] || 8);
const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,800', 'about:blank'], {stdio: 'ignore'});
// the throwaway profile (100+ MB in %TEMP%) goes with Chrome, which lets go of its files a moment after the kill; if a
// Chrome child process is slow to die (a busy machine), a detached node keeps trying for two minutes. 'exit' also
// covers an uncaught error, and Ctrl+C
const rmProfile = () => { for (let k = 0; k < 20; k++) { try { return rmSync(dir, {recursive: true, force: true}); } catch {} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
  spawn(process.execPath, ['-e', 'for (let k = 0; k < 120; k++) { try { require("fs").rmSync(process.argv[1], {recursive: true, force: true}); break; } catch {} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); }', dir], {detached: true, stdio: 'ignore', windowsHide: true}).unref(); };
let stopped = false;
const stop = () => { if (stopped) return; stopped = true; try { chrome.kill(); } catch {} rmProfile(); };
process.on('exit', stop); process.on('SIGINT', () => { stop(); process.exit(130); });
const sleep = ms => new Promise(r => setTimeout(r, ms)); let ws, id = 0; const pend = new Map(), logs = [];
const send = (m, p = {}) => new Promise(ok => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({id: i, method: m, params: p})); });
const ev = async e => { const r = await send('Runtime.evaluate', {expression: e, awaitPromise: true, returnByValue: true}); return r.result?.result?.value ?? r.result?.exceptionDetails?.exception?.description; };
const tap = async (k, code, ms = 60) => { await send('Input.dispatchKeyEvent', {type: 'keyDown', key: k, code}); await sleep(ms); await send('Input.dispatchKeyEvent', {type: 'keyUp', key: k, code}); };
try {
  let u; for (let i = 0; i < 50 && !u; i++) { try { u = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === 'page')?.webSocketDebuggerUrl; } catch {} await sleep(200); }
  ws = new WebSocket(u); await new Promise(r => ws.onopen = r);
  ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') logs.push('EXC ' + (d.params.exceptionDetails.exception?.description || d.params.exceptionDetails.text)); };
  await send('Runtime.enable');
  await send('Page.navigate', {url: 'http://localhost:8126/concepts/sprites/arena.html'});
  for (let i = 0; i < 60; i++) { await sleep(1000); if (await ev(`!document.getElementById('load')`) === true) break; }
  await tap('w', 'KeyW', 100); await sleep(9000);   // gesture + let everything bake
  // install bus taps: ScriptProcessor recorders on master output + buses
  await ev(`(async () => {
    const M = await import('/audio/forge/metrics.js'); window.__M = M;
    const RT = __audio.forge, EN = RT.EN, ac = RT.ac, sink = ac.createGain(); sink.gain.value = 0; sink.connect(ac.destination);
    window.__taps = {};
    const taps = {out: EN.output, amb: EN.bus('amb'), beds: EN.bus('amb.beds'), spots: EN.bus('amb.spots'), emitters: EN.bus('amb.emitters'), sfx: EN.bus('sfx'), music: EN.bus('music'), reverb: EN.bus('reverb')};
    for (const [k, node] of Object.entries(taps)) {
      const sp = ac.createScriptProcessor(4096, 2, 2), rec = {L: [], R: [], on: false};
      sp.onaudioprocess = e => { if (!rec.on) return; rec.L.push(e.inputBuffer.getChannelData(0).slice()); rec.R.push(e.inputBuffer.getChannelData(1).slice()); };
      node.connect(sp); sp.connect(sink); __taps[k] = rec;
    }
    // the legacy chain (old bed etc.) enters the forge master: tap it too via E.out
    if (__audio.E?.out) { const sp = ac.createScriptProcessor(4096, 2, 2), rec = {L: [], R: [], on: false}; sp.onaudioprocess = e => { if (!rec.on) return; rec.L.push(e.inputBuffer.getChannelData(0).slice()); rec.R.push(e.inputBuffer.getChannelData(1).slice()); }; __audio.E.out.connect(sp); sp.connect(sink); __taps.legacy = rec; }
    window.__measure = async (sec) => {
      for (const r of Object.values(__taps)) { r.L = []; r.R = []; r.on = true; }
      await new Promise(r => setTimeout(r, sec * 1000));
      const out = {};
      for (const [k, r] of Object.entries(__taps)) {
        r.on = false; const cat = a => { const n = a.reduce((s, x) => s + x.length, 0), o = new Float32Array(n); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };
        const L = cat(r.L), R = cat(r.R); if (!L.length) { out[k] = null; continue; }
        let pk = 0, ss = 0; for (let i = 0; i < L.length; i++) { pk = Math.max(pk, Math.abs(L[i]), Math.abs(R[i])); ss += L[i] * L[i] + R[i] * R[i]; }
        const lufs = M.lufsMomentaryMax([L, R], ac.sampleRate);
        out[k] = {lufsMmax: +lufs.toFixed(1), rmsDb: +(10 * Math.log10(ss / L.length / 2 + 1e-12)).toFixed(1), peakDb: +(20 * Math.log10(pk + 1e-9)).toFixed(1)};
      }
      return out;
    };
    return 'ok';
  })()`);
  const show = (name, o) => console.log(name.padEnd(28), Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k} ${v.rmsDb}rms/${v.lufsMmax}M`).join('  '));
  const scen = async (name, js) => { await ev(js); await sleep(1500); show(name, await ev(`__measure(${SEC})`)); };
  await scen('ruins day centre idle', `__demo.setBiome(0); __demo.setTime(0)`);
  await scen('ruins day by the stream', `__demo.P.x = 38.2; __demo.P.y = 16`);
  await scen('ruins day light garden', `__demo.P.x = 29; __demo.P.y = 15.5`);
  await scen('ruins night centre', `__demo.P.x = 20; __demo.P.y = 15.5; __demo.setTime(2)`);
  await scen('ember day', `__demo.setBiome(1); __demo.setTime(0)`);
  await scen('frost night', `__demo.setBiome(2); __demo.setTime(2)`);
  await scen('rift day', `__demo.setBiome(3); __demo.setTime(0)`);
  // combat reference: hits on the range dummies in ruins
  await ev(`__demo.setBiome(0); __demo.setTime(0); __demo.P.x = 12; __demo.P.y = 9`); await sleep(1500);
  const m = ev(`__measure(${SEC})`);
  for (let i = 0; i < 5; i++) { await send('Input.dispatchMouseEvent', {type: 'mousePressed', x: 1000, y: 260, button: 'left', clickCount: 1}); await sleep(650); await send('Input.dispatchMouseEvent', {type: 'mouseReleased', x: 1000, y: 260, button: 'left', clickCount: 1}); await sleep(300); }
  show('combat (ruins, shooting)', await m);
  for (const l of logs.slice(0, 8)) console.log(l);
} finally { ws?.close(); stop(); }
