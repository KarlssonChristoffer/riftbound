// EQUIPMENT (an experiment; OFF by default): Risk of Rain's equipment in the game. One active gadget in a slot on F with
// its own cooldown, for the bow and the gun loadouts alike: hold F to aim (the arc and where it lands show), let go to
// throw it at the cursor's ground point; a tap throws at once.
//   Fire Flask     a pool of burning oil: damage over time, an afterburn, wood in it catches (lights.js's own fire)
//   Dynamite       a lit bundle that bounces and rolls, then combat's explosion: crates break, props fly, kegs chain
//   Bear Trap      snaps shut on the first enemy that steps in: a hard bite and a long hold
//   Scarecrow      every enemy near it goes for it instead of you, and whacks it till it falls apart
//   Smoke Bomb     a cloud: inside, the enemies lose you (they wander) and you run faster
//   Grappling Hook hook an enemy, a tree, a rock or the ground and get pulled there (an enemy at the end: a flying kick)
// GETTING ONE: in a run, every stage has an equipment cache by the spawn ring (E: buy it with gold) and now and then a chest
// holds one; taking one drops the one you had (its cooldown runs on, on the ground: E takes it back). In the sandbox:
// menu > Game > "Gadget: ..." cycles it (or Dev > Features > Gadget), Shift+F cycles it too, and "Spawn a pack of
// brutes" gives it something to work on.
// TURNING IT ON: ?equip=1 (or ?equip=<gadget id>: that one in the slot, a run starts with it), or menu > Dev > Features >
// Equipment (remembered on this machine); ?equip=0 forces it off.
//   equip/sim.js     the truth: the slot, the throws, every gadget out there, pickups, the run's cache (its own generator)
//   equip/look.js    the view: sprites, particles, the preview, the pools' ground and flames, the clouds, lights
//   equip/art.js     the pixel art (painted once)          ui/equipslot.js   the HD slot right of the ability bar
//   content/gadgets.js   the numbers
// API: F.sim / F.look (tests), F.give(id), F.claims(k) (core/input.js: F reaches it outside dev mode while it's on).
// OWNS: through equip/sim.js and equip/look.js.  READS: flags ('equip'), localStorage (the switch, remembered).
// EMITS: equip.* (equip/sim.js).  BUDGET: sim + view + hd, see the two modules (all off: nothing at all runs).
import {createEquipSim} from './equip/sim.js';
import {createLook} from './equip/look.js';
import {createEquipSlot} from '../ui/equipslot.js';
import {createAnchors} from './equip/anchors.js';
import {GADGETS, GADGET_IDS, fits} from '../content/gadgets.js';
import {flags} from '../core/flags.js';

const KEY = 'riftbound.equip';   // localStorage: the switch, as the menu last left it
const remembered = () => { try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; } };
const remember = on => { try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) { /* (private mode: not remembered) */ } };

// ORDER (core/features.js): before lights: its frame draws flames through lights' F.flame before lights' own frame closes
// the flames' frame; its F key (and Shift+F) comes before lights' dev key F (the flames' look) while it's on
export const order = {before: ['lights']};
export async function create(host) {
  const sim = createEquipSim(host), look = createLook(host, sim), slot = createEquipSlot();
  const anchors = createAnchors(host);   // the lasso's own anchors (snags over the stream), there while the lasso is
  sim.setAnchors(() => anchors.list);
  const q = flags.get('equip');
  if (q && GADGETS[q]) sim.S.start = q;
  let tU = 0, tF = 0;
  const now = () => performance.now();
  const game = () => host.feature('game');
  const names = GADGET_IDS.map(id => GADGETS[id].name);
  // F let go: the throw (core/input.js hands features keydowns only; a held key the menu clears sends no keyup: no throw)
  addEventListener('keyup', e => { if (F.on && e.key.toLowerCase() === 'f') sim.S.fUp = true; });
  function set(on) {
    F.on = on; sim.setOn(on);
    if (on) look.load(); else { look.clear(); anchors.clear(); anchors.dropMeshes(); }
  }
  function cycle(d = 1) {   // (only what this loadout can carry: the lasso is a gun's)
    let i = sim.S.slot ? GADGET_IDS.indexOf(sim.S.slot.id) : -1;
    for (let k = 0; k < GADGET_IDS.length; k++) { i = ((i + d) % GADGET_IDS.length + GADGET_IDS.length) % GADGET_IDS.length; if (fits(GADGET_IDS[i], host.weapon)) break; }
    sim.give(GADGET_IDS[i]);
  }
  // the names over the cache and the pickups near you (HD), its price (fonts made when the scale changes, not per frame)
  const PV = [0, 0, 0];
  let fSc = 0, fBig = '', fSmall = '', lw = 2;
  function label(q2, sc, x, y, h, txt, col, small) {
    const P = host.player, d = Math.hypot(x - P.x, y - P.y); if (d > 5.5) return;
    host.G.toScreenInto(x, h, y, PV);
    q2.globalAlpha = Math.min(1, (5.5 - d) / 1.5); q2.font = small ? fSmall : fBig;
    q2.lineWidth = lw; q2.strokeStyle = 'rgba(10,8,12,.9)'; q2.strokeText(txt, PV[0] * sc, PV[1] * sc); q2.fillStyle = col; q2.fillText(txt, PV[0] * sc, PV[1] * sc);
  }
  // the gadget's glyph in a small dark box over its name (the slot's glyph: ui/equipslot.js)
  function badge(q2, sc, x, y, h, id) {
    const P = host.player, d = Math.hypot(x - P.x, y - P.y); if (d > 5.5) return;
    host.G.toScreenInto(x, h, y, PV);
    const r = Math.max(7, 5 * sc), bx = PV[0] * sc, by = PV[1] * sc - r;
    q2.globalAlpha = Math.min(1, (5.5 - d) / 1.5);
    q2.fillStyle = 'rgba(16,14,20,.85)'; q2.fillRect(bx - r * 1.4, by - r * 1.4, r * 2.8, r * 2.8);
    q2.strokeStyle = GADGETS[id].col; q2.lineWidth = 1; q2.strokeRect(bx - r * 1.4 + .5, by - r * 1.4 + .5, r * 2.8 - 1, r * 2.8 - 1);
    slot.glyph(q2, id, bx, by, r, GADGETS[id].col);
    q2.globalAlpha = 1;
  }
  // the pose preview's name over the cowboy (the sandbox's "Lasso: preview poses")
  function previewLabel(q2, sc) {
    const Z = host.PL.lasso; if (Z?.mode !== 'preview') return;
    const P = host.player; host.G.toScreenInto(P.x, P.z + 2.5, P.y, PV);
    if (sc !== fSc) { const u = Math.max(.8, sc / 2.4); fSc = sc; fBig = `700 ${Math.round(12 * u)}px "Segoe UI", system-ui, sans-serif`; fSmall = `600 ${Math.round(10 * u)}px "Segoe UI", system-ui, sans-serif`; lw = Math.max(2, 2.4 * u); }
    q2.font = fBig; q2.textAlign = 'center'; q2.textBaseline = 'alphabetic'; q2.lineJoin = 'round'; q2.globalAlpha = 1;
    const txt = `${Z.S.pvName || ''}  ·  ${host.PL.P.frame}`;
    q2.lineWidth = lw; q2.strokeStyle = 'rgba(10,8,12,.9)'; q2.strokeText(txt, PV[0] * sc, PV[1] * sc); q2.fillStyle = '#e0c084'; q2.fillText(txt, PV[0] * sc, PV[1] * sc);
  }
  // the lasso's hints (HD, the first few times in a session): what F does while you hold something / hang on a rope
  const HINT = {hold: 'tap F: yank  ·  hold F: swing it round', swing: 'hold F: climb  ·  let go of F / Space: drop'};
  let hintPh = '', hintN = {hold: 0, swing: 0}, hintT = 0;
  function lassoHint(q2, sc) {
    const ph = sim.lasso.L.phase, k = ph === 'hold' || ph === 'swing' ? ph : '';
    if (k !== hintPh) { if (k) hintN[k]++; hintPh = k; hintT = performance.now(); }
    if (!k || hintN[k] > 3 || (k === 'hold' && sim.lasso.L.kind === 'prop')) return;
    const a = Math.min(1, (performance.now() - hintT) / 250); if (a <= 0) return;
    const P = host.player; host.G.toScreenInto(P.x, P.z + 2.3, P.y, PV);
    const c = hintCanvas(k, sc);
    q2.globalAlpha = a * .9; q2.drawImage(c, Math.round(PV[0] * sc - c.width / 2), Math.round(PV[1] * sc - c.height)); q2.globalAlpha = 1;
  }
  const hintC = {}, hintS = {};   // the hint's text, painted once per scale (no text drawn per frame)
  function hintCanvas(k, sc) {
    let c = hintC[k]; if (c && hintS[k] === sc) return c; hintS[k] = sc;
    const u = Math.max(.8, sc / 2.4), font = `600 ${Math.round(10 * u)}px "Segoe UI", system-ui, sans-serif`, w0 = Math.max(2, 2.4 * u);
    c ??= hintC[k] = document.createElement('canvas'); let q = c.getContext('2d'); q.font = font;
    c.width = Math.ceil(q.measureText(HINT[k]).width + w0 * 2 + 4); c.height = Math.round(10 * u * 1.5) + 4;
    q = c.getContext('2d'); q.font = font; q.textAlign = 'center'; q.textBaseline = 'middle'; q.lineJoin = 'round';
    q.lineWidth = w0; q.strokeStyle = 'rgba(10,8,12,.9)'; q.strokeText(HINT[k], c.width / 2, c.height / 2); q.fillStyle = '#e0c084'; q.fillText(HINT[k], c.width / 2, c.height / 2);
    return c;
  }
  function labels(q2, sc) {
    const c = sim.cache; if (!(c && !c.spent) && !sim.drops.length) return;
    if (sc !== fSc) { const u = Math.max(.8, sc / 2.4); fSc = sc; fBig = `700 ${Math.round(12 * u)}px "Segoe UI", system-ui, sans-serif`; fSmall = `600 ${Math.round(10 * u)}px "Segoe UI", system-ui, sans-serif`; lw = Math.max(2, 2.4 * u); }
    q2.textAlign = 'center'; q2.textBaseline = 'alphabetic'; q2.lineJoin = 'round';
    if (c && !c.spent) {
      const G = GADGETS[c.id], ok = (host.feature('combat')?.core.gold ?? 0) >= c.cost;
      badge(q2, sc, c.p.x, c.p.y, 2.05, c.id); label(q2, sc, c.p.x, c.p.y, 1.75, G.name, G.col, false); label(q2, sc, c.p.x, c.p.y, 1.55, c.price, ok ? '#f2d27a' : '#e0604a', true);
    }
    for (const d of sim.drops) { badge(q2, sc, d.p.x, d.p.y, 1.25, d.id); label(q2, sc, d.p.x, d.p.y, .95, GADGETS[d.id].name, GADGETS[d.id].col, false); }
    q2.globalAlpha = 1;
  }

  const F = {
    name: 'equip', label: 'Equipment', on: false, sim, look, GADGETS, ms: 0,
    claims: k => F.on && k === 'f',
    give: id => sim.give(id),
    update(dt, evs) { if (!F.on) return; const t0 = now(); anchors.update(host.weapon?.kind === 'gun'); sim.update(dt, evs); tU += now() - t0; },
    view(dt, evs) { const t0 = now(); look.view(dt, evs); tU += now() - t0; },
    frame() { const t0 = now(); anchors.draw(); look.frame(); tF = now() - t0; },
    lights: () => look.lights(),
    hd(q2, sc) {
      const t0 = now();
      // (the labels hang on the world: slid with the pixel image, G.hdShift, the sub-pixel camera; the slot stays put)
      if (!host.hudOff && (game()?.mode === 'run' || game()?.mode === 'sandbox')) { slot.draw(q2, host.hudScale, sim.S); q2.save(); host.G.hdShift?.(q2, sc); labels(q2, sc); previewLabel(q2, sc); lassoHint(q2, sc); q2.restore(); }
      const ms = tU + tF + now() - t0; tU = 0; F.ms = F.ms * .95 + ms * .05;
    },
    onKey(k, e) {
      if (F.on && k === ' ' && sim.lasso.space()) return true;   // swinging on the lasso: Space lets go
      if (!F.on || k !== 'f') return false;
      if (e?.shiftKey) { if (host.dev && game()?.mode !== 'run') cycle(1); return true; }   // the sandbox: the next gadget
      sim.press(); return true;
    },
    interact: p => sim.interact(p),
    prompt: p => sim.prompt(p),
    toggle() { set(!F.on); remember(F.on); return F.on; },
    settings: () => F.on ? [{label: 'Gadget', options: [...names, 'none'], get: () => sim.S.slot ? GADGETS[sim.S.slot.id].name : 'none',
      set: v => sim.give(GADGET_IDS[names.indexOf(v)] || '')}] : [],
    menu() {
      if (!F.on || game()?.mode !== 'sandbox') return [];
      const G = sim.S.slot ? GADGETS[sim.S.slot.id] : null;
      const Z = host.PL.lasso, gun = host.weapon?.kind === 'gun';
      return [{label: `Gadget: ${G ? G.name : 'none'} (next)`, run: () => cycle(1)},
        ...(gun && Z ? [{label: `Lasso: preview poses (${Z.mode === 'preview' ? 'on' : 'off'}; WASD stops it)`, run: () => Z.preview(Z.mode !== 'preview')}] : []),
        {label: 'Spawn a pack of brutes (gadget test)', run: () => { const P = host.player, a = host.yaw; sim.spawnPack(6, P.x - Math.sin(a) * 6, P.y - Math.cos(a) * 6); }}];
    },
    biomeChanged() { sim.clearWorld(); look.clear(); anchors.biomeChanged(); },
    hud: () => {
      if (!F.on) return '';
      const S = sim.S, sl = S.slot;
      const Lp = sim.lasso.L.phase;
      return `equip ${sl ? sl.id + (sl.cd > 0 ? ' ' + sl.cd.toFixed(1) + 's' : ' ready') : 'none'}${S.aiming ? ' aiming' : ''}${Lp ? ' · lasso ' + Lp + (Lp === 'spin' ? ' at ' + sim.lasso.L.aim.kind : '') : ''} · air ${sim.air.length} pools ${sim.pools.length} traps ${sim.traps.length} crows ${sim.crows.length} clouds ${sim.clouds.length}${S.inSmoke ? ' (in smoke)' : ''} drops ${sim.drops.length}${sim.cache ? ' cache ' + sim.cache.id : ''}`;
    },
  };
  set(q === '0' ? false : q ? true : remembered());
  return F;
}
