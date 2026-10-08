// LIVE EXPORT: re-export a loadout's LIVE model (the live hero: view/livehero.js) after its poses or clips changed in
// tools/blender/western.py, in one command. Runs ragdoll_export.py headless in Blender with the loadout's atlas (every
// atlas pose and its clips' timing) and every clip only the live model has (the model's current `live` list, plus --add),
// into the installed folder the game reads (concepts/sprites/out/live/<loadout>/), the previous files kept first in
// tmp/live-export/backup/<loadout>/. With the game open on ?livereload=1 the new body shows at once (dev/livekeys.js).
//   node tools/blender/live_export.mjs gunslinger [--add rx_flinch,rx_stagger] [--drop old_clip] [--out dir] [--dry 1]
//   node tools/blender/live_export.mjs all ...     (every live loadout: gunslinger, outlaw)
// Prints the export's RAGDOLL_OK line (segments, corners, poses) and the time. Blender: D:\Blender\blender.exe (BLENDER env).
import {spawnSync} from 'node:child_process';
import {readFileSync, existsSync, mkdirSync, copyFileSync, writeFileSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BLENDER = process.env.BLENDER || 'D:/Blender/blender.exe';
const LIVE = ['gunslinger', 'outlaw'];
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i < 0 ? d : process.argv[i + 1]; };
const which = process.argv[2];
if (!which || which.startsWith('--')) { console.log('usage: node tools/blender/live_export.mjs <gunslinger | outlaw | all> [--add a,b] [--drop c] [--out dir] [--dry 1]'); process.exit(2); }
const list = s => (s || '').split(',').map(x => x.trim()).filter(Boolean);
const ADD = list(arg('add')), DROP = new Set(list(arg('drop'))), DRY = arg('dry') === '1';

let failed = 0;
for (const name of which === 'all' ? LIVE : [which]) {
  const out = arg('out', join(ROOT, 'concepts/sprites/out/live', name)), atlas = join(ROOT, 'concepts/sprites/out/outfits', name);
  const model = join(ROOT, 'tools/blender/loadouts', name + '.py');
  if (!existsSync(model) || !existsSync(atlas)) { console.log(`${name}: no loadout (${model}) or atlas (${atlas})`); failed++; continue; }
  const cur = existsSync(join(out, 'model.json')) ? JSON.parse(readFileSync(join(out, 'model.json'), 'utf8')).live || [] : [];
  const clips = [...new Set([...cur, ...ADD])].filter(c => !DROP.has(c));
  const args = ['-b', '--factory-startup', '--python', 'tools/blender/ragdoll_export.py', '--', '--model', `tools/blender/loadouts/${name}.py`,
    '--out', out, '--atlas', atlas, ...(clips.length ? ['--clips', clips.join(',')] : [])];
  console.log(`${name}: ${clips.length} live clips -> ${out}`);
  if (DRY) { console.log(BLENDER + ' ' + args.join(' ')); continue; }
  const bak = join(ROOT, 'tmp/live-export/backup', name); mkdirSync(bak, {recursive: true});
  for (const f of ['model.json', 'model.bin']) if (existsSync(join(out, f))) copyFileSync(join(out, f), join(bak, f));
  const t0 = Date.now(), r = spawnSync(BLENDER, args, {cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20});
  const log = (r.stdout || '') + (r.stderr || ''); mkdirSync(join(ROOT, 'tmp/live-export'), {recursive: true}); writeFileSync(join(ROOT, 'tmp/live-export', name + '.log'), log);
  const ok = log.split('\n').find(l => l.startsWith('RAGDOLL_OK'));
  if (!ok || r.status !== 0) { console.log(`${name}: FAILED (status ${r.status}); tmp/live-export/${name}.log; the old model is in ${bak}`); console.log(log.split('\n').filter(l => /Error|Traceback|line \d+/.test(l)).slice(-12).join('\n')); failed++; continue; }
  console.log(`${name}: ${ok} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}
process.exit(failed ? 1 : 0);
