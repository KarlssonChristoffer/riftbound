// WRONG WEATHER (docs/WEATHER.md "Wrong weather"): four weathers that break a rule, rare (about one day in three, never the
// first), each with a rule you can learn and a thing left behind. When and where is the seed's and the clock's (sim/wrongwx.js:
// every machine the same); whom the following cloud follows is the co-op server's (server/room.mjs: act 'cloud').
//   UPWARD RAIN       a column over the lake where the rain falls up: inside you stay dry and light (notes body.soak x0,
//                     player.speed x light); fish lift out of the water and hang in the air: E grabs one (a lake catch, luck +1)
//   THE CLOUD         a small low cloud picks one player and rains on them only (wet and cold build fast: body.soak / chill);
//                     sheltered (the hut, the cave, a thick crown) for lose s it loses you; walk into a friend and it's theirs
//   THE STILL STORM   heavy rain and no thunder; at every flash the world freezes for a moment (G.hold: the view, the sim runs on)
//                     and in the frozen frame figures stand among the trees, closer each flash
//   FOOTPRINTS        (winter, lying snow) fresh tracks walk from the lake toward the forest's edge as you watch, made by no one;
//                     step on them and they stop; follow them to the end
// Each leaves one thing where it ended (content/wrongwx.js: the cloud's hail, the closest figure's carving, the tracks' mitten):
// E takes it, once an event (offline kept in pack.store('wrongwx')). Only in the persistent world (the sandbox's forest).
// ?wrongwx=often one every 2 in-game hours (each kind in turn), ?wrongwx=0 none. Esc > Sandbox: Wrong weather.
// OWNS: the modifier source 'wrongwx', the event under way and its state (the fish, the cloud, the flashes, the walker), the find
//   left. READS: host.env (t, season, part, setWeather, weatherLock, TUNE), host.player, world/layout.js FOREST (the lake),
//   pack (give, store), coop (online, act, mail, net), body (soak, chill, shelter, inHut), caves (down), weather (flash),
//   prints (stamp, surfaceAt), content/fishing.js roll. EMITS: wrongwx.begin, wrongwx.end, wrongwx.flash, wrongwx.find
// API: F.ev (the event under way or null), F.left (the thing left: {x, y, kind, n} or null)
// BUDGET: sim ~.005 ms a step (a few distances); view: a column of streaks, a cloud of points, a few figures on a flash frame.
import {TUNE} from '../content/wrongwx.js';
import {eventAt, makeEvent} from '../sim/wrongwx.js';
import {roll} from '../content/fishing.js';
import {TUNE as WXT} from '../sim/wxclock.js';
import {FOREST} from '../world/layout.js';
import {flags} from '../core/flags.js';
import {mulberry32} from '../core/rng.js';
import {rgbOf} from '../core/color.js';

const FLAG = flags.get('wrongwx'), ON = flags.get('wx2') !== '0' && FLAG !== '0' && !!FOREST;
const OFTEN = FLAG === 'often';
const RU = TUNE.rainup, CL = TUNE.cloud, ST = TUNE.still, PR = TUNE.prints;
const TAKE = 1.3;   // m: E takes the thing left

// ORDER (core/features.js): after co-op (its mail: whom the cloud picked), the weather (its flash this frame) and the prints (a
// stamp this step); the body's soak and chill are calls
export const order = {after: ['coop', 'weather', 'prints']};

export async function create(host) {
  const game = () => host.feature('game'), pack = () => host.feature('pack'), ui = () => game()?.ui || null;
  const active = () => ON && host.biome?.id === 'ruins' && game()?.mode === 'sandbox';
  const F = {name: 'wrongwx', label: 'Wrong weather', on: true, ev: null, left: null};
  if (!ON) return F;
  const seed = FOREST.seed >>> 0, L = FOREST.lake;
  let coop = null, body = null, caves = null, weather = null, prints = null, live = false, forced = null, wasOnline = false;
  const online = () => !!coop?.online, myId = () => coop?.net?.id ?? 0;
  const seasonDays = () => host.env?.TUNE?.seasonDays ?? WXT.seasonDays;
  const hourS = () => (host.env?.TUNE?.dayMinutes ?? 20) * 60 / 24;   // real s an in-game hour
  const elev = (x, y) => host.elev(x, y);

  // ---- the event under way: begun when the schedule (or the menu) starts one, ended when it's over
  const cur = {n: -1, kind: '', t0: 0, t1: 0, x: 0, y: 0, path: null};
  let modsKey = '';
  function notes(k) {
    if (k === modsKey) return; modsKey = k;
    if (k === 'up') host.mods.set('wrongwx', [{stat: 'body.soak', mul: 0}, {stat: 'player.speed', mul: RU.light}]); else host.mods.clear('wrongwx');
  }
  function begin(E) {
    cur.n = E.n; cur.kind = E.kind; cur.t0 = E.t0; cur.t1 = E.t1; cur.x = E.x; cur.y = E.y; cur.path = E.path;
    F.ev = cur;
    const R = mulberry32((seed ^ Math.imul(E.n + 1, 2654435761)) >>> 0);
    if (E.kind === 'rainup') beginRain(R);
    else if (E.kind === 'cloud') beginCloud();
    else if (E.kind === 'still') beginStill(R);
    else if (E.kind === 'prints') beginPrints();
    host.events.push({type: 'wrongwx.begin', kind: E.kind, n: E.n});
  }
  function end() {
    const k = cur.kind;
    if (k === 'cloud') leave(cl.x, cl.y, CL.find);
    else if (k === 'still') { endStill(); if (st.k > 0) leave(st.fx, st.fy, ST.find); }
    notes('');
    host.events.push({type: 'wrongwx.end', kind: k, n: cur.n});
    cur.n = -1; cur.kind = ''; F.ev = null; forced = null;
  }

  // ---- what it leaves: one thing, E takes it (once an event)
  const got = new Set();
  const store = () => pack()?.store?.('wrongwx');
  let restored = false, leftSaid = -1;
  function restore() { restored = true; got.clear(); const s = store(); if (s && s.seed === seed) for (const n of s.got || []) got.add(n); }
  function save() { if (online()) return; const s = store(); if (!s) return; s.seed = seed; s.got = [...got].filter(n => n < 9000).slice(-16); pack()?.dirty?.(); }
  function leave(x, y, kind) {
    if (got.has(cur.n)) return;
    F.left = {x, y, kind, n: cur.n, until: (host.env?.t ?? 0) + 24};
    host.events.push({type: 'wrongwx.find', kind, x, y, n: cur.n});
  }
  function take() {
    const T = F.left; F.left = null; got.add(T.n); save();
    pack()?.give(T.kind, 1, {x: T.x, y: T.y, h: elev(T.x, T.y) + .4});
  }

  // ---- UPWARD RAIN: the column, the fish in the air
  const ru = {r: 0, fish: []};   // fish: {x, y, h, id, got}
  function beginRain(R) {
    ru.r = RU.r[0] + R() * (RU.r[1] - RU.r[0]); ru.fish.length = 0;
    const E = host.env, inLake = FOREST.inLake || (() => true);
    for (let i = 0, t = 0; i < RU.fish && t < 60; t++) {
      const a = R() * Math.PI * 2, q = Math.sqrt(R()) * ru.r * .9, x = cur.x + Math.cos(a) * q, y = cur.y + Math.sin(a) * q;
      if (!inLake(x, y)) continue;
      const c = roll(R, {water: 'lake', part: E?.part || 'day', season: E?.season, luck: 1});
      ru.fish.push({x, y, h: RU.h[0] + R() * (RU.h[1] - RU.h[0]), id: c.id, got: false, ph: R() * 6.28}); i++;
    }
  }
  const inColumn = P => cur.kind === 'rainup' && Math.hypot(P.x - cur.x, P.y - cur.y) < ru.r;
  function nearFish(P) {
    let best = null, bd = RU.grab;
    for (const f of ru.fish) { if (f.got) continue; const d = Math.hypot(f.x - P.x, f.y - P.y); if (d < bd) { bd = d; best = f; } }
    return best;
  }

  // ---- THE CLOUD: whom it follows (offline him; online the server's pick), where it is, how long he's been under a roof
  const cl = {x: 0, y: 0, who: 0, lost: false, shelT: 0, asked: false, passT: 0};
  const SMP = {x: 0, y: 0, z: 0, phi: 0};
  function beginCloud() {
    const P = host.player; cl.x = P.x + 6; cl.y = P.y - 4; cl.lost = false; cl.shelT = 0; cl.asked = false; cl.passT = 0;
    cl.who = online() ? 0 : -1;   // (-1: him, offline)
  }
  const mine = () => cl.who === -1 || (cl.who !== 0 && cl.who === myId());
  function targetOf(out) {
    if (cl.lost || cl.who === 0) return false;
    if (mine()) { out.x = host.player.x; out.y = host.player.y; return true; }
    const C = coop?.net, q = C?.peers?.get(cl.who); return !!(q && C.sample(q, out));
  }
  function cloudStep(dt) {
    if (online() && !cl.asked) { cl.asked = true; coop.act('cloud', 'x' + cur.n, {w: 'ask'}); }
    const T = SMP;
    if (targetOf(T)) { const dx = T.x - cl.x, dy = T.y - cl.y, d = Math.hypot(dx, dy), v = Math.min(d, (d > 3 ? 5 : 2.5) * dt); if (d > .01) { cl.x += dx / d * v; cl.y += dy / d * v; } }
    else { cl.x += .4 * dt; cl.y += .25 * dt; }   // (lost: it drifts off and rains itself out)
    if (!mine()) return;
    const P = host.player, under = Math.hypot(P.x - cl.x, P.y - cl.y) < 1.6;
    const shel = !!caves?.down || !!body?.inHut || (body?.shelter ?? 0) > .85;
    if (shel) {
      if ((cl.shelT += dt) >= CL.lose) { cl.shelT = 0; if (online()) coop.act('cloud', 'x' + cur.n, {w: 'lose'}); else cl.lost = true; ui()?.float(P.x, P.y, 2, 'it lost you', '#c8d4e0'); }
    } else {
      cl.shelT = Math.max(0, cl.shelT - dt);
      if (under) { body?.soak?.(CL.soak * dt); body?.chill?.(CL.chill * dt); }
    }
    // a friend walked into: it's theirs (the server checks the distance)
    if (online() && (cl.passT -= dt) <= 0) {
      const C = coop.net;
      for (const [id, q] of C.peers) { if (!q.n || !C.sample(q, SMP)) continue; if (Math.hypot(SMP.x - P.x, SMP.y - P.y) < CL.pass) { coop.act('cloud', 'x' + cur.n, {w: 'pass', to: id}); cl.passT = 1.5; break; } }
    }
  }
  function mail(m) {
    if (m.k !== 'world' || typeof m.id !== 'string' || m.id[0] !== 'x' || m.s !== 'cloud') return;
    if (cur.kind !== 'cloud' || 'x' + cur.n !== m.id) return;
    const was = cl.who; cl.who = m.who | 0; cl.lost = !cl.who;
    if (cl.who && cl.who === myId() && was !== cl.who) ui()?.float(host.player.x, host.player.y, 2, 'a cloud found you', '#c8d4e0');
  }

  // ---- THE STILL STORM: the rain held, the flashes, the figures (where the closest stood: the find)
  const st = {next: 0, k: 0, held: null, mine: null, R: null, fx: 0, fy: 0, flashN: 0, figs: []};   // figs: [x, y] of this flash
  function beginStill(R) {
    const E = host.env; st.R = R; st.k = 0; st.flashN = 0; st.figs.length = 0;
    st.next = ST.flash[0] + R() * (ST.flash[1] - ST.flash[0]);
    st.held = E?.weatherLock ?? null; st.mine = 'rain'; E?.setWeather?.('rain', 8);
  }
  function endStill() { const E = host.env; if (E && st.mine && E.weatherLock === st.mine) E.setWeather(st.held, 12); st.mine = null; }
  function stillStep(dt) {
    if ((st.next -= dt) > 0) return;
    const R = st.R, P = host.player;
    st.next = ST.flash[0] + R() * (ST.flash[1] - ST.flash[0]);
    const near = ST.near[0] + (ST.near[1] - ST.near[0]) * Math.min(1, st.k / 8), n = ST.n[0] + Math.floor(R() * (ST.n[1] - ST.n[0] + 1));
    st.figs.length = 0; let best = Infinity;
    const a0 = R() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + (R() - .5) * .8, d = near * (i === 0 ? 1 : 1 + R() * .6), x = P.x + Math.cos(a) * d, y = P.y + Math.sin(a) * d;
      st.figs.push([x, y]); if (d < best) { best = d; st.fx = x; st.fy = y; }
    }
    st.k++; st.flashN++;
    host.events.push({type: 'wrongwx.flash', k: st.k, near});
  }

  // ---- FOOTPRINTS FROM NOBODY: the walker along its path, stamped as it goes; stepped on, it stops
  const pr = {len: 0, cum: null, s: 0, stopped: false, done: false};
  function beginPrints() {
    const p = cur.path; pr.s = 0; pr.stopped = false; pr.done = false; pr.cum = [0]; pr.len = 0;
    if (!p) { pr.done = true; return; }
    for (let i = 1; i < p.length; i++) { pr.len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]); pr.cum.push(pr.len); }
  }
  const AT = {x: 0, y: 0, dx: 1, dy: 0};
  function along(s) {
    const p = cur.path, c = pr.cum; let k = 1; while (k < c.length - 1 && c[k] < s) k++;
    const l = c[k] - c[k - 1] || 1, f = Math.max(0, Math.min(1, (s - c[k - 1]) / l)), dx = p[k][0] - p[k - 1][0], dy = p[k][1] - p[k - 1][1];
    AT.x = p[k - 1][0] + dx * f; AT.y = p[k - 1][1] + dy * f; AT.dx = dx / l; AT.dy = dy / l; return AT;
  }
  function printsStep() {
    if (pr.done || pr.stopped || !cur.path) return;
    const want = Math.min(pr.len, ((host.env?.t ?? 0) - cur.t0) * hourS() * PR.speed), stride = .45;
    const P = host.player;
    while (pr.s + stride <= want) {
      pr.s += stride; const a = along(pr.s), foot = (Math.round(pr.s / stride) & 1) ? 1 : -1, px = a.x + a.dy * .09 * foot, py = a.y - a.dx * .09 * foot;
      if (prints?.surfaceAt?.(px, py, elev(px, py)) === 'snow') prints.stamp(px, py, elev(px, py), a.dx, a.dy, 'boot', 'snow');
    }
    // stepped on: within PR.on of the track already made (not at its very start, where he may be standing to watch)
    for (let s = 1; s < pr.s; s += .5) { const a = along(s); if (Math.hypot(a.x - P.x, a.y - P.y) < PR.on) { pr.stopped = true; ui()?.float(P.x, P.y, 2, 'the tracks stop', '#e8eef4'); return; } }
    if (pr.s + stride > pr.len) { pr.done = true; const e = cur.path[cur.path.length - 1]; leave(e[0], e[1], PR.find); }
  }

  // ---- the step
  F.onKey = k => {
    if (k !== 'e' || !live || host.lock) return false;
    const P = host.player;
    if (F.left && Math.hypot(F.left.x - P.x, F.left.y - P.y) < TAKE) { take(); return true; }
    if (cur.kind === 'rainup') { const f = nearFish(P); if (f) { f.got = true; pack()?.give(f.id, 1, {x: f.x, y: f.y, h: elev(f.x, f.y) + f.h}); return true; } }
    return false;
  };
  F.update = dt => {
    live = active();
    if (!live) { if (cur.n >= 0) end(); return; }
    coop ??= host.feature('coop') || false; body ??= host.feature('body') || false; caves ??= host.feature('caves') || false;
    weather ??= host.feature('weather') || false; prints ??= host.feature('prints') || false;
    const ol = online(); if (ol !== wasOnline || (!ol && !restored)) { wasOnline = ol; if (!ol) restore(); else got.clear(); }
    const E = host.env, t = E?.t ?? 0;
    if (forced && t >= forced.t1) forced = null;
    const ev = forced || eventAt(seed, t, seasonDays(), FOREST, OFTEN);
    if (cur.n >= 0 && (!ev || ev.n !== cur.n || ev.kind !== cur.kind)) end();
    if (ev && cur.n < 0) begin(ev);
    if (ol && coop.mail) for (const m of coop.mail) mail(m);
    if (F.left && (t > F.left.until || got.has(F.left.n))) F.left = null;
    const P = host.player;
    if (cur.kind === 'rainup') notes(inColumn(P) ? 'up' : '');
    else if (cur.kind === 'cloud') cloudStep(dt);
    else if (cur.kind === 'still') stillStep(dt);
    else if (cur.kind === 'prints') printsStep();
    if (F.left && leftSaid !== F.left.n && Math.hypot(F.left.x - P.x, F.left.y - P.y) < 4) { leftSaid = F.left.n; ui()?.float(F.left.x, F.left.y, 1, 'E  take', '#e8eef4'); }
  };

  // ---------------------------------------------------------------- VIEW
  // the upward rain's streaks (a pool, recycled), the still storm's flash and freeze (frames: 1 the flash asked, 2 the figures
  // drawn with it, 3 the hold: the screen keeps frame 2)
  const UN = 160, uX = new Float32Array(UN), uY = new Float32Array(UN), uH = new Float32Array(UN), uV = new Float32Array(UN);
  let un = 0, seenFlash = 0, ph = 0, vt = 0;
  const CN = 48, cX = new Float32Array(CN), cY = new Float32Array(CN), cH = new Float32Array(CN);
  let cn = 0;
  F.view = dt => {
    vt += dt;
    if (!live || cur.n < 0) { un = 0; cn = 0; ph = 0; return; }
    const surf = L ? L.bed - .18 : 0;
    if (cur.kind === 'rainup') {   // streaks rise from the water and the ground in the column, faster as they go
      for (let k = 0; k < 6 && un < UN; k++) { const a = Math.random() * 6.283, q = Math.sqrt(Math.random()) * ru.r, x = cur.x + Math.cos(a) * q, y = cur.y + Math.sin(a) * q; uX[un] = x; uY[un] = y; uH[un] = Math.max(surf, elev(x, y)); uV[un] = 3 + Math.random() * 3; un++; }
      for (let i = 0; i < un; i++) { uV[i] += 6 * dt; uH[i] += uV[i] * dt; if (uH[i] > surf + 14) { un--; uX[i] = uX[un]; uY[i] = uY[un]; uH[i] = uH[un]; uV[i] = uV[un]; i--; } }
    } else un = 0;
    if (cur.kind === 'cloud') {   // rain under the cloud: short streaks falling from it
      for (let k = 0; k < 4 && cn < CN; k++) { const a = Math.random() * 6.283, q = Math.sqrt(Math.random()) * 1.2; cX[cn] = cl.x + Math.cos(a) * q; cY[cn] = cl.y + Math.sin(a) * q; cH[cn] = elev(cl.x, cl.y) + CL.h - .4; cn++; }
      for (let i = 0; i < cn; i++) { cH[i] -= 9 * dt; if (cH[i] < elev(cX[i], cY[i])) { cn--; cX[i] = cX[cn]; cY[i] = cY[cn]; cH[i] = cH[cn]; i--; } }
    } else cn = 0;
    if (cur.kind === 'still') {
      if (st.flashN !== seenFlash) { seenFlash = st.flashN; weather?.flash?.(1); ph = 1; }
      else if (ph === 1) ph = 2;
      else if (ph === 2) { host.G.hold?.(ST.hold); ph = 0; }
    } else ph = 0;
  };
  const UP = rgbOf('#cfe4f4'), UP2 = rgbOf('#8fb4d4'), FISH = rgbOf('#c8d0d8'), FISHD = rgbOf('#6a7a88'), CLD = [rgbOf('#9aa4b0'), rgbOf('#7a8490'), rgbOf('#b8c0ca')],
    RAIN = rgbOf('#a8c0d8'), FIG = rgbOf('#0a0a0e'), LEFT = rgbOf('#f4f8ff');
  const PT = {emit: false, size: 2, alpha: 1}, PE = {emit: true, size: 2, alpha: 1};
  const pt = (x, y, h, c, size, alpha, emit) => { const o = emit ? PE : PT; o.size = size; o.alpha = alpha; host.point(x, y, h, c, o); };
  F.frame = f => {
    if (!live) return;
    const t = f?.t ?? vt;
    for (let i = 0; i < un; i++) host.line(uX[i], uY[i], uH[i], uX[i], uY[i], uH[i] + .3, i & 1 ? UP2 : UP);
    if (cur.kind === 'rainup') for (const fi of ru.fish) {   // lifted out over the first seconds, turning slowly in the air
      if (fi.got) continue;
      const lift = Math.min(1, ((host.env?.t ?? 0) - cur.t0) * hourS() / 8), h = (L ? L.bed - .18 : 0) + fi.h * lift + Math.sin(t * 1.4 + fi.ph) * .06, a = t * .5 + fi.ph, dx = Math.cos(a) * .12, dy = Math.sin(a) * .12;
      pt(fi.x - dx, fi.y - dy, h, FISHD, 2, 1); pt(fi.x, fi.y, h, FISH, 3, 1); pt(fi.x + dx, fi.y + dy, h, FISH, 2, 1); pt(fi.x + dx * 2, fi.y + dy * 2, h + .03, FISHD, 2, 1);
    }
    if (cur.kind === 'cloud') {
      const h = elev(cl.x, cl.y) + CL.h;
      for (let i = 0; i < 26; i++) { const a = i * 2.39996, q = Math.sqrt(i / 26) * 1.5, wob = Math.sin(t * .7 + i) * .08; pt(cl.x + Math.cos(a) * q + wob, cl.y + Math.sin(a) * q * .8, h + Math.cos(i * 1.7) * .25 + (1.5 - q) * .3, CLD[i % 3], 7, .85); }
      for (let i = 0; i < cn; i++) host.line(cX[i], cY[i], cH[i], cX[i], cY[i], cH[i] + .35, RAIN);
    }
    if (cur.kind === 'still' && ph === 2) for (const [x, y] of st.figs) {   // the figures: tall, thin, dark, still
      const g = elev(x, y);
      for (let z = 0; z < 2.1; z += .1) { const w = z > 1.75 ? .1 : .16; pt(x - w, y, g + z, FIG, 3, 1); pt(x + w, y, g + z, FIG, 3, 1); pt(x, y, g + z, FIG, 3, 1); }
    }
    if (F.left) { const T = F.left, a = .55 + .45 * Math.sin(t * 3); pt(T.x, T.y, elev(T.x, T.y) + .15, LEFT, 2, a, true); pt(T.x, T.y, elev(T.x, T.y) + .15, LEFT, 4, a * .25, true); }
  };
  const remaining = () => cur.n >= 0 ? Math.max(0, cur.t1 - (host.env?.t ?? 0)) : 0;
  F.hud = () => live && (cur.n >= 0 || F.left) ? `wrong weather: ${cur.n >= 0 ? `${cur.kind} (${cur.n}) · ${remaining().toFixed(2)} h left` : 'none'}${cur.kind === 'cloud' ? ` · who ${cl.who}${cl.lost ? ' (lost)' : ''} · roof ${cl.shelT.toFixed(0)} s` : ''}${cur.kind === 'still' ? ` · flash ${st.k}` : ''}${cur.kind === 'prints' ? ` · ${pr.s.toFixed(0)}/${pr.len.toFixed(0)} m${pr.stopped ? ' stopped' : ''}` : ''}${F.left ? ` · left ${F.left.kind}` : ''}` : '';
  let devN = 9000;
  const start = kind => () => { if (cur.n >= 0) end(); forced = makeEvent(seed, devN++, kind, host.env?.t ?? 0, FOREST); };
  F.menu = () => live ? [
    {label: 'Wrong weather: upward rain now', run: start('rainup')},
    {label: 'Wrong weather: the cloud now', run: start('cloud')},
    {label: 'Wrong weather: the still storm now', run: start('still')},
    {label: 'Wrong weather: footprints now (winter)', run: start('prints')},
    {label: 'Wrong weather: take me to it', run: () => { if (cur.kind === 'rainup') host.teleport(cur.x + ru.r * .5, cur.y + (L ? L.ry : 4) + 2); else if (cur.kind === 'prints' && cur.path) host.teleport(cur.path[0][0] - 1.5, cur.path[0][1] - 1.5); else if (F.left) host.teleport(F.left.x + 1, F.left.y); }},
  ] : [];
  F.state = () => ({kind: cur.kind, n: cur.n, t0: cur.t0, t1: cur.t1, x: cur.x, y: cur.y, fish: ru.fish.filter(f => !f.got).length, cloud: {x: cl.x, y: cl.y, who: cl.who, lost: cl.lost, shelT: cl.shelT},
    still: {k: st.k, figs: st.figs.length, fx: st.fx, fy: st.fy}, prints: {s: pr.s, len: pr.len, stopped: pr.stopped, done: pr.done}, left: F.left, got: [...got]});
  return F;
}
