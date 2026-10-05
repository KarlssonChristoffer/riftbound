// HEADLESS CHROME FOR THE TOOLS (and scratch scripts): its throwaway profile, the flags that keep that small, its removal.
// Every profile lives in %TEMP%/riftbound-chrome/<tag>-XXXXXX. A tool removes its own on exit, but a run that is killed (a
// timeout, a stopped task: no exit handler runs) leaves it behind, and scratch scripts often never remove theirs: 17 GB of
// C: in half a day on 2026-10-03. So every launch first sweeps the dead ones. A profile is dead when it has no `lockfile`
// (Chrome holds that file open while it runs, and Windows deletes it when Chrome goes, killed or not) and nothing in it
// changed for 10 minutes. The sweep also takes dead Chrome profiles lying straight in %TEMP% (older tools and scripts that
// made their own) once they are 2 hours old. LEAN keeps a fresh profile at ~12 MB instead of ~57 (Chrome otherwise fetches
// 42 MB of on-device models into every new profile).
//
//   import {launch} from '../lib/chrome.mjs';
//   const chrome = launch('golden', ['--headless=new', '--remote-debugging-port=9351', 'about:blank']);
//   ...   chrome.kill()   (Chrome and its profile: call it from the exit handler; safe to call twice)
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

export const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
export const PROFILES = join(tmpdir(), 'riftbound-chrome');
// none of these touch rendering or timing: they stop the browser's own downloads and services
const OFF = ['OptimizationHints', 'OptimizationHintsFetching', 'OptimizationGuideModelDownloading', 'OptimizationTargetPrediction',
  'OptimizationGuideOnDeviceModel', 'MediaRouter', 'Translate'];
export const LEAN = ['--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
  '--disable-sync', '--disable-breakpad', '--disable-crash-reporter', '--disable-domain-reliability', '--metrics-recording-only'];

const nap = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const dead = (dir, ageMs, now) => { try { return !existsSync(join(dir, 'lockfile')) && now - statSync(dir).mtimeMs > ageMs; } catch { return false; } };
const rm = dir => { try { rmSync(dir, {recursive: true, force: true}); } catch {} };

// remove the profiles no Chrome is using: ours after 10 minutes, any other Chrome profile in %TEMP% after 2 hours
export function sweep() {
  const now = Date.now(), tmp = tmpdir();
  try { for (const e of readdirSync(PROFILES)) { const d = join(PROFILES, e); if (dead(d, 10 * 60e3, now)) rm(d); } } catch {}
  try {
    for (const e of readdirSync(tmp, {withFileTypes: true})) {
      if (!e.isDirectory() || e.name === 'claude' || e.name === 'riftbound-chrome') continue;
      const d = join(tmp, e.name); if (existsSync(join(d, 'Local State')) && dead(d, 2 * 3600e3, now)) rm(d);
    }
  } catch {}
}

// a profile goes a moment after its Chrome is killed; if a child process is slow to let go (a busy machine), a detached
// node keeps trying for two minutes, and the next launch's sweep takes whatever is still left
export function removeProfile(dir) {
  for (let k = 0; k < 20; k++) { try { return rmSync(dir, {recursive: true, force: true}); } catch {} nap(250); }
  spawn(process.execPath, ['-e', 'for (let k = 0; k < 120; k++) { try { require("fs").rmSync(process.argv[1], {recursive: true, force: true}); break; } catch {} Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); }', dir],
    {detached: true, stdio: 'ignore', windowsHide: true}).unref();
}

// start Chrome on a fresh profile: `args` are the tool's own flags and the URL (a --disable-features list among them is
// merged with LEAN's, since Chrome keeps only the last one); returns {proc, dir, kill()}
export function launch(tag, args, {exe = CHROME, stdio = 'ignore'} = {}) {
  sweep(); mkdirSync(PROFILES, {recursive: true});
  const dir = mkdtempSync(join(PROFILES, tag + '-')), DF = '--disable-features=';
  const off = [...OFF, ...args.filter(a => a.startsWith(DF)).flatMap(a => a.slice(DF.length).split(','))];
  const proc = spawn(exe, [...LEAN, DF + off.join(','), '--user-data-dir=' + dir, ...args.filter(a => !a.startsWith(DF))], {stdio});
  let gone = false;
  return {proc, dir, kill() { if (gone) return; gone = true; try { proc.kill(); } catch {} removeProfile(dir); }};
}
