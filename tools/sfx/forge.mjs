// SOUND FORGE CLI: render recipes to WAV + spectrogram PNG + metrics, check pass criteria, compare with references.
// See docs/AUDIO.md §4. No dependencies (Node 24+).
//
//   node tools/sfx/forge.mjs [ids | all] [--case wood] [--seeds 6] [--sr 48000] [--out audio/forge/out]
//   node tools/sfx/forge.mjs --refs          measure the reference takes named in recipes' `refs` (decoded by headless
//                                            Chrome over CDP, needs the dev server) -> audio/forge/refs/<name>.{json,png,wav}
//
// Writes, per recipe/case/seed: <out>/<id>/<case>_<seed>.wav, .png, and <out>/<id>/summary.json, plus <out>/index.html
// (a contact sheet with audio players, spectrograms, metrics, pass/fail, and the reference next to each case).
// Prints one line per variant: pass/fail, key metrics, and the variant-to-variant similarity range per case.

import {writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
import {spawn} from 'node:child_process';
import {dirname, join, relative, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FORGE = join(ROOT, 'audio/forge');
const imp = p => import(pathToFileURL(join(FORGE, p)).href);
const {bake} = await imp('forge.js'), {analyze, spectrumProfile, similarity} = await imp('metrics.js'), {spectrogramImage} = await imp('spectro.js');
const {RECIPES, loadRecipes} = await imp('recipes/index.js');

const args = process.argv.slice(2), opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const flags = new Set(args.filter(a => a.startsWith('--'))), ids = args.filter((a, i) => !a.startsWith('--') && !(i && args[i - 1].startsWith('--') && !['--refs'].includes(args[i - 1])));
const SEEDS = +opt('seeds', 4), SR = +opt('sr', 48000), OUT = resolve(ROOT, opt('out', 'audio/forge/out')), ONLY_CASE = opt('case', null);

// ---------------------------------------------------------------- file writers
export function wav(ch, sr) {   // 16-bit PCM WAV
  const chans = Array.isArray(ch) ? ch : [ch], n = chans[0].length, nc = chans.length, b = Buffer.alloc(44 + n * nc * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * nc * 2, 4); b.write('WAVEfmt ', 8); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(nc, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * nc * 2, 28); b.writeUInt16LE(nc * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * nc * 2, 40);
  for (let i = 0; i < n; i++) for (let c = 0; c < nc; c++) b.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(chans[c][i] * 32767))), 44 + (i * nc + c) * 2);
  return b;
}
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = buf => { let c = -1; for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
export function png({width, height, data}) {   // RGBA -> PNG (filter 0, zlib)
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 4 + 1)] = 0; Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1); }
  const chunk = (type, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(tb)); return Buffer.concat([len, tb, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, {level: 6})), chunk('IEND', Buffer.alloc(0))]);
}
const imgW = sec => Math.round(Math.min(900, Math.max(360, sec * 900)));

// ---------------------------------------------------------------- references (decoded by headless Chrome)
async function decodeRefs(files) {
  const port = 9400 + Math.floor(Math.random() * 90), dir = join(process.env.TEMP || '/tmp', 'forge_cdp_' + port);
  const chrome = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, '--no-first-run', 'about:blank'], {stdio: 'ignore'});
  const sleep = ms => new Promise(r => setTimeout(r, ms)); let ws, id = 0; const pend = new Map();
  const send = (m, p = {}) => new Promise(ok => { const i = ++id; pend.set(i, ok); ws.send(JSON.stringify({id: i, method: m, params: p})); });
  try {
    let u; for (let i = 0; i < 50 && !u; i++) { try { u = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === 'page')?.webSocketDebuggerUrl; } catch {} await sleep(200); }
    ws = new WebSocket(u); await new Promise(r => ws.onopen = r);
    ws.onmessage = m => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
    const base = opt('server', 'http://localhost:8126');
    await send('Page.navigate', {url: base + '/audio/forge/'}); await sleep(800);
    const out = {};
    for (const f of files) {
      const r = await send('Runtime.evaluate', {awaitPromise: true, returnByValue: true, expression: `(async () => {
        const ab = await (await fetch('/${f}')).arrayBuffer(), b = await new OfflineAudioContext(1, 1, ${SR}).decodeAudioData(ab);
        const L = b.getChannelData(0), R = b.numberOfChannels > 1 ? b.getChannelData(1) : L, m = new Float32Array(L.length);
        for (let i = 0; i < L.length; i++) m[i] = (L[i] + R[i]) * .5;
        const u8 = new Uint8Array(m.buffer); let s = ''; for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode(...u8.subarray(i, i + 8192));
        return {sr: b.sampleRate, pcm: btoa(s)};
      })()`});
      const v = r.result?.result?.value; if (!v) { console.log('  could not decode', f); continue; }
      const bytes = Buffer.from(v.pcm, 'base64'); out[f] = {sr: v.sr, x: new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4)};
    }
    return out;
  } finally { ws?.close(); chrome.kill(); }
}
function sliceOnsets(x, sr) {   // split a run of footsteps into single steps at the onsets
  const on = analyze(x, sr).onsets, parts = [];
  for (let i = 0; i < on.length; i++) { const a = Math.max(0, Math.round((on[i] - .01) * sr)), b = Math.round((on[i + 1] ?? on[i] + .45) * sr) - Math.round(.01 * sr); parts.push(x.slice(a, Math.min(x.length, b))); }
  return parts;
}
async function refsMode(recipes) {
  // every take listed in assets/sfx/index.json, plus anything a recipe names in `refs`
  const want = new Set(); for (const r of Object.values(recipes)) for (const list of Object.values(r.refs || {})) for (const f of [].concat(list)) want.add(f);
  const idx = JSON.parse(readFileSync(join(ROOT, 'assets/sfx/index.json'), 'utf8')).sounds;
  for (const e of Object.values(idx)) if (!e.loop) for (const f of e.files) want.add('assets/sfx/' + f);
  if (!want.size) return console.log('no reference takes found');
  const manifest = JSON.parse(readFileSync(join(ROOT, 'assets/sfx/manifest.json'), 'utf8')), sliced = new Set(manifest.sounds.filter(s => s.slice).map(s => s.id));
  const dec = await decodeRefs([...want]), dir = join(FORGE, 'refs'); mkdirSync(dir, {recursive: true});
  const {lufsMomentaryMax} = await imp('metrics.js'), {dbToGain} = await imp('dsp.js');
  for (const [f, {sr, x}] of Object.entries(dec)) {
    const name = f.split('/').pop().replace(/\.mp3$/, ''), id = name.replace(/_\d+$/, '');
    const parts = sliced.has(id) ? sliceOnsets(x, sr).slice(0, 4).map((p, i) => [`${name}.s${i + 1}`, p]) : [[name, x]];
    for (const [nm, p] of parts) {
      let g = dbToGain(-20 - lufsMomentaryMax(p, sr)), pk = 0; for (const v of p) pk = Math.max(pk, Math.abs(v));
      if (pk * g > dbToGain(-1.2)) g = dbToGain(-1.2) / pk;   // same loudness and peak rule as forge.bake
      const y = p.map(v => v * g);
      const m = analyze(y, sr);
      writeFileSync(join(dir, nm + '.json'), JSON.stringify({file: f, sr, metrics: m, profile: [...spectrumProfile(y, sr)]}, null, 1));
      writeFileSync(join(dir, nm + '.png'), png(spectrogramImage(y, sr, {width: imgW(y.length / sr), height: 300})));
      writeFileSync(join(dir, nm + '.wav'), wav(y, sr));
      console.log(`ref ${nm.padEnd(26)} ${fmt(m)}`);
    }
  }
}

// ---------------------------------------------------------------- render mode
const fmt = m => `lufs ${m.lufsM} tp ${m.truePeakDb} atk ${m.attackMs}ms t60 ${m.t60Ms ?? '-'}ms cen ${m.centroidHz} band ${m.lowHz}-${m.highHz} flat ${m.flatness} hf4k ${m.hf4kDb}dB ons ${m.onsets.length} dur ${m.durMs}ms`;
function refsFor(recipe, cs) {
  const list = [].concat(recipe.refs?.[cs] || []), dir = join(FORGE, 'refs'), out = [];
  for (const f of list) {
    const name = f.split('/').pop().replace(/\.mp3$/, '');
    for (const j of existsSync(dir) ? readdirSync(dir).filter(x => x.startsWith(name) && x.endsWith('.json')) : []) out.push({name: j.replace(/\.json$/, ''), ...JSON.parse(readFileSync(join(dir, j), 'utf8'))});
  }
  return out;
}
async function renderMode(recipes) {
  mkdirSync(OUT, {recursive: true});
  const sheet = [];
  for (const [id, r] of Object.entries(recipes)) {
    const dir = join(OUT, id); mkdirSync(dir, {recursive: true});
    const summary = {id, version: r.version, sr: SR, cases: {}};
    for (const cs of Object.keys(r.cases || {default: {}})) {
      if (ONLY_CASE && cs !== ONLY_CASE) continue;
      const rows = [], profiles = [], refs = refsFor(r, cs);
      for (let s = 1; s <= SEEDS; s++) {
        const t0 = performance.now(), res = bake(r, cs, s, SR), ms = performance.now() - t0;
        const base = `${cs}_${s}`, sec = (Array.isArray(res.ch) ? res.ch[0] : res.ch).length / SR;
        writeFileSync(join(dir, base + '.wav'), wav(res.ch, SR));
        writeFileSync(join(dir, base + '.png'), png(spectrogramImage(res.ch, SR, {width: imgW(sec), height: 300})));
        profiles.push(spectrumProfile(res.ch, SR));
        const refSim = refs.length ? Math.max(...refs.map(x => similarity(profiles.at(-1), Float32Array.from(x.profile)))) : null;
        rows.push({seed: s, file: base, ms: +ms.toFixed(1), gainDb: res.gainDb, metrics: res.metrics, pass: res.check.pass, fails: res.check.fails, refSim: refSim === null ? null : +refSim.toFixed(2)});
        console.log(`${res.check.pass ? 'PASS' : 'FAIL'} ${id}/${base}`.padEnd(30) + ` ${fmt(res.metrics)}  render ${ms.toFixed(0)}ms` + (refSim !== null ? `  refSim ${refSim.toFixed(2)}` : '') + (res.check.pass ? '' : `  <- ${res.check.fails.join('; ')}`));
      }
      const sims = []; for (let i = 0; i < profiles.length; i++) for (let j = i + 1; j < profiles.length; j++) sims.push(similarity(profiles[i], profiles[j]));
      const simRange = sims.length ? [+Math.min(...sims).toFixed(2), +Math.max(...sims).toFixed(2)] : null;
      if (simRange) console.log(`     ${id}/${cs} variant similarity ${simRange[0]}..${simRange[1]} (1 = identical)`);
      for (const x of refs) console.log(`     ref ${x.name.padEnd(22)} ${fmt(x.metrics)}`);
      summary.cases[cs] = {rows, simRange, criteria: r.criteria?.[cs] || r.criteria?.['*'] || {}, refs: refs.map(x => ({name: x.name, metrics: x.metrics}))};
      sheet.push({id, cs, rows, simRange, refs, criteria: summary.cases[cs].criteria});
    }
    writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 1));
  }
  writeFileSync(join(OUT, 'index.html'), contactSheet(sheet));
  console.log(`\ncontact sheet: ${relative(ROOT, join(OUT, 'index.html')).replace(/\\/g, '/')} (serve the project root and open /audio/forge/out/index.html)`);
}
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
function contactSheet(sheet) {
  const cell = (src, png, title, m, pass, extra = '') => `<figure class="${pass === false ? 'fail' : ''}"><figcaption>${esc(title)}${pass === undefined ? '' : pass ? ' <b class="ok">pass</b>' : ' <b class="no">fail</b>'}</figcaption><img src="${png}" loading="lazy"><audio controls preload="none" src="${src}"></audio><small>${esc(fmt(m))}${extra}</small></figure>`;
  const body = sheet.map(({id, cs, rows, simRange, refs, criteria}) => `<section><h2>${esc(id)} / ${esc(cs)}</h2><p>criteria ${esc(JSON.stringify(criteria))} · variant similarity ${simRange ? simRange.join('..') : '-'}</p><div class="row">`
    + refs.map(x => cell(`../refs/${x.name}.wav`, `../refs/${x.name}.png`, 'reference ' + x.name, x.metrics)).join('')
    + rows.map(r => cell(`${id}/${r.file}.wav`, `${id}/${r.file}.png`, `seed ${r.seed}`, r.metrics, r.pass, (r.fails.length ? ' · ' + esc(r.fails.join('; ')) : '') + (r.refSim !== null ? ` · refSim ${r.refSim}` : ''))).join('') + '</div></section>').join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Forge Contact Sheet</title><style>
:root{--bg:#111014;--panel:#1a1920;--line:#34323d;--text:#e9e4da;--muted:#9a94a6;--accent:#c9a45a}
body{margin:0;background:var(--bg);color:var(--text);font:13px/1.4 system-ui,Segoe UI,sans-serif}main{padding:16px}h1{color:var(--accent);font-size:18px}
section{background:var(--panel);border:1px solid var(--line);border-radius:8px;margin:0 0 14px;padding:10px 12px}h2{font:600 14px ui-monospace,Consolas,monospace;margin:0}p{color:var(--muted);margin:2px 0 8px;font-size:12px}
.row{display:flex;flex-wrap:wrap;gap:10px}figure{margin:0;width:min(100%,420px);border:1px solid var(--line);border-radius:6px;padding:6px;background:#141319}figure.fail{border-color:#e07a5f}
figcaption{font-size:12px;margin-bottom:4px}img{width:100%;image-rendering:pixelated;display:block}audio{width:100%;height:28px;margin-top:4px}small{color:var(--muted);font:11px/1.3 ui-monospace,Consolas,monospace;display:block;margin-top:3px}
.ok{color:#8fc98f}.no{color:#e07a5f}</style></head><body><main><h1>Sound Forge contact sheet</h1><p>Loudness-matched at -20 LUFS (momentary max). Spectrograms: waveform on top, then log frequency 30 Hz..Nyquist with guides at 100 Hz / 1 kHz / 10 kHz, colour = absolute dBFS (-100..-10).</p>${body}</main></body></html>`;
}

// ---------------------------------------------------------------- main
const want = !ids.length || ids.includes('all') ? RECIPES : ids;
const recipes = await loadRecipes(want);
if (flags.has('--refs')) await refsMode(recipes); else await renderMode(recipes);
