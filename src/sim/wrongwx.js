// WRONG WEATHER'S SCHEDULE (sim, pure: docs/WEATHER.md "Wrong weather"): which wrong weather comes when and where, from the world's
// SEED and its CLOCK, so every machine computes the same without a message. Only whom the following cloud picks is the co-op
// server's (server/room.mjs). The browser (features/wrongwx.js) and the server read this one file.
//   eventAt(seed, hours, seasonDays, forest, often) -> the event under way at that hour or null (one record, reused):
//     {n (its number), kind (content/wrongwx.js KINDS), t0, t1 (in-game hours), x, y (where: the upward rain's column over the lake,
//      the footprints' first step on its shore), path ([[x, y] ...]: the footprints' way to the forest's edge)}
//   Never in day 0; footprints only in winter (another kind takes the day otherwise)
//   makeEvent(seed, n, kind, t0, forest) -> a new record of that kind starting at t0 (the sandbox menu's: n from 9000)
import {TUNE, KINDS} from '../content/wrongwx.js';
import {hash3} from '../core/mathx.js';
import {seasonAt} from './wxclock.js';

const R = {n: -1, kind: '', t0: 0, t1: 0, x: 0, y: 0, path: null};
function place(R, seed, n, kind, forest) {
  const L = forest?.lake, h = k => hash3(seed, n, 600 + k);
  R.x = 0; R.y = 0; R.path = null;
  if (!L) return;
  if (kind === 'rainup') { R.x = L.x + (h(1) - .5) * L.rx * .8; R.y = L.y + (h(2) - .5) * L.ry * .8; }
  else if (kind === 'prints') {   // from the shore, away from the lake toward the forest's south edge, wandering a little
    const a = Math.PI / 2 + (h(1) - .5) * 1.6, sx = L.x + Math.cos(a) * (L.rx + 1.5), sy = L.y + Math.sin(a) * (L.ry + 1.5), len = TUNE.prints.len[0] + h(2) * (TUNE.prints.len[1] - TUNE.prints.len[0]);
    const path = [[sx, sy]]; let x = sx, y = sy, d = a;
    for (let s = 0; s < len; s += 4) { d += (h(10 + s) - .5) * .5; d = d * .7 + Math.PI / 2 * .3; x += Math.cos(d) * 4; y = Math.min(-3, y + Math.sin(d) * 4); path.push([+x.toFixed(2), +y.toFixed(2)]); }
    R.x = sx; R.y = sy; R.path = path;
  }
}
export function eventAt(seed, hours, seasonDays, forest, often = false) {
  let n, kind, t0, t1;
  if (often) {
    n = Math.floor(hours / TUNE.often.every); kind = KINDS[((n % 4) + 4) % 4];
    if (kind === 'prints' && seasonAt(hours, seasonDays) !== 'winter') kind = 'rainup';
    t0 = n * TUNE.often.every; t1 = t0 + Math.min(TUNE.often.every - .1, TUNE[kind].dur);
  } else {
    const d = Math.floor(hours / 24); if (d < 1 || hash3(seed, d, 501) >= TUNE.chance) return null;
    n = d; kind = KINDS[Math.floor(hash3(seed, d, 502) * 4) % 4];
    t0 = d * 24 + TUNE.start[0] + hash3(seed, d, 503) * (TUNE.start[1] - TUNE.start[0]);
    if (kind === 'prints' && seasonAt(t0, seasonDays) !== 'winter') kind = KINDS[Math.floor(hash3(seed, d, 504) * 3) % 3];
    t1 = t0 + TUNE[kind].dur;
  }
  if (hours < t0 || hours >= t1) return null;
  if (R.n !== n || R.kind !== kind) { R.n = n; R.kind = kind; place(R, seed, n, kind, forest); }
  R.t0 = t0; R.t1 = t1;
  return R;
}
export function makeEvent(seed, n, kind, t0, forest) {
  const E = {n, kind, t0, t1: t0 + TUNE[kind].dur, x: 0, y: 0, path: null};
  place(E, seed, n, kind, forest);
  return E;
}
