// STORY (docs/STORY.md): what has happened, and always a next thing to find. Three parts, all of them each player's own:
//   THE FILMS   (content/story.js BEATS) the intro the first time a save enters the sandbox: the tear, the forest, him, in the
//               cinema camera's scripted shots (features/cinema.js play) with lines of text in a pixel frame at the bottom;
//               Space shows the whole line / the next one, Esc skips the film. He is held still meanwhile (the 'player.stuck'
//               note, source 'story'). The tear's film when the almanac's chapter VII is done. With the cinema off
//               (?cinema=0) the lines play over the game's own view.
//   THE LEADS   each almanac chapter's lead (content/almanac.js CHAPTERS lead: Hilma's line under its name, drawn by the
//               almanac's card) and the Lead line under Today: the first of Hilma's places not found yet, its hint and its way
//               from him ('NE, a walk'), never a pointer: you go and look.
//   THE PLACES  (content/story.js PLACES) walk within r m of one and it's found: her margin note shows at the bottom middle for a while,
//               it goes into the Journal's Discoveries page , and the Lead moves on to the next. Chapter VII counts them.
// CO-OP: nothing on the server. The places are the forest plan's (the seed's: the same for everyone), the found list is his
//   save; a friend's film plays only on their screen.
// SIM vs VIEW: finding a place and starting a film are the sim (update: his position every LOOK s against <= 12 places; no
//   randomness). The film's lines, the note card and the fades are the view's.
// OWNS: its save (pack.store('story'): {seen (the intro played), found: [place ids]}), the films' text and fades, the note
//   card, the 'story' modifier source. READS: pack (store, section), game (mode), cinema (play, next, stop, scriptI, playing),
//   anomaly (spot), the forest plan (host.layout.forest), the cave (host.world.cave), trolls (plan), uncanny (on, U), host.env
//   (part), host.player. EMITS: story.found, story.beat. BUDGET: update: <= 12 distances every .5 s; hd: a frame and a few lines
//   while a film or a note shows.
import {flags} from '../core/flags.js';
import {BEATS, PLACES, ALL_FOUND, AFTER, NAME, readT, compass, farWord} from '../content/story.js';
import {hdUnit, hdFrame, hdText, hdFont} from '../ui/hdpixel.js';

const ON = flags.get('story') !== '0', INTRO = flags.get('intro');
const LOOK = .5, WAIT = 1.6, NOTE_T = 9, CPS = 38, FADE = .9;   // s between looks; s in the sandbox before the intro; s a note shows; letters a second; s the game fades back in
const INKC = '#efe6cf', SAY = '#e8c98a', GOLD = '#f2d27a', DIM = '#8c826f', W_TEXT = 300;

export const order = {after: ['pack', 'anomaly', 'cinema', 'almanac']};

export async function create(host) {
  const pack = () => host.feature('pack'), game = () => host.feature('game'), cinema = () => host.feature('cinema');
  const sandbox = () => game()?.mode === 'sandbox';
  let ver = 0, lookT = 0, waitT = 0, introAsked = false;

  function S() {
    const s = pack()?.store('story'); if (!s) return null;
    s.seen ??= false; s.found ??= [];
    return s;
  }

  // ---------------------------------------------------------------- the places (where they are in this world: looked up again
  // every look until all are known; a world build makes them all new)
  const POS = {}; for (const p of PLACES) POS[p.id] = {x: 0, y: 0, ok: false};
  let posWorld = null, posAll = false;
  const X = {get tear() { return host.feature('anomaly')?.spot || null; }, get forest() { return host.layout?.forest || null; },
    get cave() { return host.world?.cave?.mouth || null; }, get trolls() { return host.feature('trolls')?.plan || null; },
    get uncanny() { return host.feature('uncanny') || null; }, get spawn() { return host.layout?.spawn || host.player; }};
  function resolve() {
    if (posWorld !== host.world) { posWorld = host.world; posAll = false; for (const id in POS) POS[id].ok = false; ver++; }
    if (posAll) return;
    posAll = true;
    for (const p of PLACES) {
      const o = POS[p.id]; if (o.ok) continue;
      const a = p.at(X);
      if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) { o.x = a.x; o.y = a.y; o.ok = true; ver++; } else posAll = false;
    }
  }

  // ---------------------------------------------------------------- finding them (the sim)
  const notes = [];   // (the view's: places just found, for the note card)
  const evq = [];     // (events to push in the next update: a film's end comes from the view)
  function look(s) {
    const P = host.player;
    for (const p of PLACES) {
      const o = POS[p.id]; if (!o.ok || s.found.includes(p.id)) continue;
      if (Math.hypot(o.x - P.x, o.y - P.y) > p.r) continue;
      s.found.push(p.id); pack().dirty(); ver++;
      host.events.push({type: 'story.found', x: P.x, y: P.y, id: p.id, n: s.found.length});
      notes.push(p);
    }
  }
  // the Lead: the first place not found yet (in PLACES's order) that this world has, with its way from him
  const SIDE = {text: '', dir: ''};
  let sideId = '', sideDir = '';
  function lead(s) {
    let next = null;
    for (const p of PLACES) if (POS[p.id].ok && !s.found.includes(p.id)) { next = p; break; }
    if (!next) { if (sideId !== '*') { sideId = '*'; sideDir = ''; SIDE.text = ALL_FOUND; SIDE.dir = ''; ver++; } return; }
    const P = host.player, o = POS[next.id], dx = o.x - P.x, dy = o.y - P.y, d = Math.hypot(dx, dy);
    const dir = d < 8 ? 'here' : compass(dx, dy) + ', ' + farWord(d);
    if (next.id !== sideId || dir !== sideDir) { sideId = next.id; sideDir = dir; SIDE.text = next.hint; SIDE.dir = dir; ver++; }
  }

  // ---------------------------------------------------------------- the films
  const B = {id: '', shots: null, cam: false, i: -1, line: 0, t: 0, shown: 0, lines: null, end: false};
  let fadeIn = 0, still = false;
  const hold = on => { if (on === still) return; still = on; if (on) host.mods.set('story', [{stat: 'player.stuck', add: 1}]); else host.mods.clear('story'); };
  const shotDur = sh => sh.lines.reduce((t, l) => t + readT(l.s), 0) + .4;
  function subject(at) {
    if (at === 'tear' && POS.tear.ok) return {x: POS.tear.x, y: POS.tear.y, h: host.elev(POS.tear.x, POS.tear.y) || 0};
    if (at === 'forest') { const sp = X.spawn, x = sp.x - 4, y = Math.min(sp.y - 26, -8); return {x, y, h: host.elev(x, y) || 0}; }
    return null;   // (him: followed)
  }
  function play(id) {
    const shots = BEATS[id]; if (!shots || B.id) return false;
    Object.assign(B, {id, shots, i: -1, line: 0, t: 0, shown: 0, lines: null, end: false});
    hold(true);
    const cv = cinema();
    B.cam = !!(cv?.on && cv.play);
    if (B.cam) cv.play(shots.map(sh => ({c: subject(sh.at), a: sh.a, turn: sh.turn, d: sh.d, p: sh.p, m: sh.m, lh: sh.lh, side: sh.side, dur: shotDur(sh)})), done => end(done));
    else { B.i = 0; B.lines = shots[0].lines; }
    ver++;
    return true;
  }
  function end(done) {
    if (!B.id) return;
    const id = B.id; B.id = ''; B.shots = null; B.lines = null;
    hold(false); fadeIn = B.cam ? FADE : 0;
    evq.push({type: 'story.beat', id, done: !!done});
  }
  function skip() { if (!B.id) return; if (B.cam) cinema()?.stop(); end(false); }   // (cinema.stop calls end too: the second does nothing)
  function nextLine() {
    if (!B.lines) return;
    const L = B.lines[B.line];
    if (L && B.shown < L.s.length) { B.shown = L.s.length; return; }   // the whole line first
    if (B.line < B.lines.length - 1) { B.line++; B.t = 0; B.shown = 0; return; }
    if (B.cam) cinema()?.next();
    else nextShot();
  }
  function nextShot() {
    if (++B.i >= B.shots.length) { end(true); return; }
    B.lines = B.shots[B.i].lines; B.line = 0; B.t = 0; B.shown = 0;
  }

  // ---------------------------------------------------------------- the Journal's page
  const esc0 = s => s;
  function sectionHTML(esc = esc0) {
    const s = S(); if (!s) return '';
    const have = PLACES.filter(p => POS[p.id].ok);
    let h = `<div class="p-skill"><div class="p-move"><b style="color:#f2d27a">${NAME}'s places: ${s.found.length} of ${have.length}</b><small>The margins of the almanac. Walk to a place and it's found; the Lead line points at the next.</small></div>`;
    for (const p of have) {
      if (s.found.includes(p.id)) h += `<div class="p-move"><b style="color:#9ad878">${esc(p.name)}</b><small>"${esc(p.note)}"</small></div>`;
      else h += `<div class="p-move p-next">${p.id === sideId ? 'Lead: ' + esc(p.hint) + (sideDir ? ` (${esc(sideDir)})` : '') : '...'}</div>`;
    }
    return h + '</div>';
  }
  let sectionAdded = false;

  // ---------------------------------------------------------------- dev
  const queue = [];
  function dev(what) {
    const s = S(); if (!s) return;
    if (what === 'intro') play('intro');
    else if (what === 'tear') play('tear');
    else if (what === 'all') { for (const p of PLACES) if (POS[p.id].ok && !s.found.includes(p.id)) s.found.push(p.id); ver++; }
    else if (what === 'reset') { s.found = []; s.seen = false; introAsked = false; ver++; }
    else if (what === 'go') { const id = sideId && sideId !== '*' ? sideId : ''; const o = POS[id]; if (o?.ok) host.teleport(o.x + 3, o.y + 3); }
    pack().dirty();
  }

  // ---------------------------------------------------------------- the note card's and the film's lines, wrapped (laid out again
  // on a new text or a new unit only)
  const wrapC = {key: '', lines: []};
  function wrapped(q, u, s, wd) {
    const key = u + '|' + wd + '|' + s; if (wrapC.key === key) return wrapC.lines;
    q.font = hdFont(u); const out = []; let cur = '';
    for (const w of s.split(' ')) { const t = cur ? cur + ' ' + w : w; if (q.measureText(t).width / u > wd && cur) { out.push(cur); cur = w; } else cur = t; }
    if (cur) out.push(cur);
    wrapC.key = key; wrapC.lines = out; return out;
  }
  const noteC = {key: '', lines: []};
  let note = null, noteT = 0;

  const F = {
    name: 'story', label: 'Story', on: ON, cineHd: true,
    get ver() { return ver; },
    get found() { return S()?.found.length || 0; },
    get side() { return ON && sandbox() && SIDE.text ? SIDE : null; },
    get after() { return AFTER; },
    get beat() { return B.id; },
    place: id => POS[id]?.ok ? POS[id] : null,
    near(id, r) { const o = POS[id], P = host.player; return !!o?.ok && Math.hypot(o.x - P.x, o.y - P.y) <= r; },
    play: id => queue.push(() => play(id)),
    escape() { if (!B.id) return false; skip(); return true; },   // Esc skips a film
    onKey(k) {
      if (!B.id) return false;
      if (k === ' ' || k === 'enter') { nextLine(); return true; }
      return true;   // (a film holds the keys)
    },
    lmb(down) { if (!B.id) return false; if (down) nextLine(); return true; },
    update(dt, evs) {
      if (!ON) return;
      const s = S(); if (!s) return;
      if (!sectionAdded) { sectionAdded = true; pack().section({id: 'story', title: 'Discoveries', order: 1, ver: () => ver, html: esc => sectionHTML(esc)}); }
      while (queue.length) queue.shift()();
      while (evq.length) host.events.push(evq.shift());
      if (!sandbox()) { waitT = 0; if (B.id) skip(); return; }
      if ((lookT -= dt) <= 0) { lookT = LOOK; resolve(); if (!B.id) look(s); lead(s); }
      // the intro: the first time this save is in the sandbox (?intro=1: again, once a page load; ?intro=0, the tour, ?chapter: never)
      const want = INTRO === '1' ? !introAsked : !s.seen;
      if (want && INTRO !== '0' && !flags.get('tour') && !flags.get('chapter') && !B.id && !host.lock && !host.paused) {
        waitT += dt;
        if (waitT > WAIT && (POS.tear.ok || waitT > WAIT + 3)) { introAsked = true; s.seen = true; pack().dirty(); play('intro'); }
      }
      if (evs) for (let i = 0; i < evs.length; i++) if (evs[i].type === 'almanac.chapter' && evs[i].ch === 'tear') play('tear');
    },
    view(dt) {
      if (!ON) return;
      if (fadeIn > 0) fadeIn = Math.max(0, fadeIn - dt);
      while (notes.length) { note = notes.shift(); noteT = NOTE_T; host.uiSound?.('confirm'); }
      if (noteT > 0) { noteT = Math.max(0, noteT - dt); if (!noteT) note = null; }
      if (!B.id) return;
      if (B.cam) {   // the shot on now is the camera's: its lines from the start of it
        const cv = cinema(), si = cv?.scriptI ?? -1;
        if (si !== B.i) { B.i = si; B.lines = si >= 0 && si < B.shots.length ? B.shots[si].lines : null; B.line = 0; B.t = 0; B.shown = 0; }
      }
      const L = B.lines?.[B.line]; if (!L) return;
      B.t += dt; B.shown = Math.min(L.s.length, B.shown + dt * CPS);
      if (B.t >= readT(L.s)) {
        if (B.line < B.lines.length - 1) { B.line++; B.t = 0; B.shown = 0; }
        else if (!B.cam && B.t >= readT(L.s) + .4) nextShot();   // (the camera's shot ends by itself: its length is the lines')
      }
    },
    hd(q) {
      if (!ON) return;
      const W = q.canvas.width, H = q.canvas.height, u = hdUnit();
      if (fadeIn > 0) { q.fillStyle = '#000'; q.globalAlpha = Math.min(1, fadeIn / FADE); q.fillRect(0, 0, W, H); q.globalAlpha = 1; }
      if (B.id) {   // the film's line: a frame at the bottom middle, the words appearing
        const L = B.lines?.[B.line]; if (!L) return;
        const wd = Math.min(W_TEXT, Math.floor(W / u) - 40), lines = wrapped(q, u, L.s, wd), fw = (wd + 12) * u, fh = (lines.length * 12 + 16) * u;
        const x0 = Math.round((W - fw) / 2), y0 = Math.round(H - fh - Math.max(10 * u, H * .07));
        q.save(); q.imageSmoothingEnabled = false;
        hdFrame(q, x0, y0, fw, fh, u);
        let n = Math.floor(B.shown);
        for (let i = 0; i < lines.length; i++) {
          const s = lines[i], k = Math.max(0, Math.min(s.length, n)); n -= s.length + 1;
          if (k > 0) hdText(q, k < s.length ? s.slice(0, k) : s, x0 + 6 * u, y0 + (12 * i + 13) * u, u, L.say ? SAY : INKC);
        }
        hdText(q, 'Space  next     Esc  skip', x0 + fw - 6 * u, y0 + fh - 3 * u, u, DIM, 'right');
        q.restore();
        return;
      }
      if (!note || host.hudOff || host.G.cine || !sandbox()) return;
      // a place just found: its name and her note, top middle
      const wd = Math.min(220, Math.floor(W / u) - 40), key = u + '|' + note.id;
      if (noteC.key !== key) { noteC.key = key; noteC.lines = wrapped(q, u, '"' + note.note + '"', wd).slice(); }
      const lines = noteC.lines, fw = (wd + 12) * u, fh = (lines.length * 12 + 30) * u, x0 = Math.round((W - fw) / 2), y0 = Math.round(H - fh - Math.max(24 * u, H * .17));   // (bottom middle, over the HUD's belt: the almanac's card has the top left)
      q.save(); q.imageSmoothingEnabled = false;
      q.globalAlpha = Math.min(1, noteT / .6, (NOTE_T - noteT) / .3 + .2);
      hdFrame(q, x0, y0, fw, fh, u);
      hdText(q, 'Found: ' + note.name, x0 + 6 * u, y0 + 13 * u, u, GOLD);
      for (let i = 0; i < lines.length; i++) hdText(q, lines[i], x0 + 6 * u, y0 + (12 * i + 27) * u, u, SAY);
      q.restore();
    },
    dev: {group: 'Gathering'},
    menu() {
      if (!ON || !sandbox()) return [];
      return [
        {label: 'Story: play the intro', run: () => queue.push(() => dev('intro'))},
        {label: 'Story: play the tear\'s film', run: () => queue.push(() => dev('tear'))},
        {label: 'Story: go to the Lead\'s place', run: () => queue.push(() => dev('go'))},
        {label: 'Story: find every place', run: () => queue.push(() => dev('all'))},
        {label: 'Story: forget the places and the intro', run: () => queue.push(() => dev('reset'))},
      ];
    },
    hud() { const s = S(); return ON && s ? `story ${s.found.length}/${PLACES.filter(p => POS[p.id].ok).length} found · lead ${sideId || '-'} ${sideDir}${B.id ? ` · film ${B.id} shot ${B.i} line ${B.line}` : ''}` : ''; },
  };
  return F;
}
