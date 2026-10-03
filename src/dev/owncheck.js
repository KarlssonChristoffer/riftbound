// OWNERSHIP CHECK (dev only, ?owncheck=1): who writes which field of the world's entities (docs/ARCHITECTURE.md: "one
// owner per piece of state"). The fields in OWNERS become accessors on every entity as it joins the world; a write by
// anyone but the field's owner is recorded with its file:line and warned once per field + writer. The writer is read off
// the stack: the first frame outside this file, by folder (features/combat/* = combat, sim/projectiles.js =
// projectiles, ...), so an API call is the owner's write (lights calling combat's breakProp is combat breaking a prop).
// Writes before an entity joins (its creator filling it in) are free; '@creator' lets the system that added it go on
// writing that field. Fields not in OWNERS that appear on an entity after it joined are reported too (free-form flags).
// It costs a stack trace per changed write: for a check run (tools/test, a probe), never for play.
//   installOwnCheck(ents) once, before the features are made; window.__r3d.owncheck() -> {violations, added}
//
// THE TABLE: field -> the systems that may write it once the entity is in the world.
const C = ['combat'], CC = ['combat', '@creator'], L = ['lights'];
export const OWNERS = {
  // identity: what it is, set by whoever made it (layout, a feature's spawn), nobody else
  kind: ['@creator'], variant: ['@creator'], rect: ['@creator'], outside: ['@creator'], wall: ['@creator'], target: ['@creator'],
  breakable: ['@creator'], explode: ['@creator'], occluder: ['@creator'], light: ['@creator'], rail: ['@creator'], sparring: ['@creator'],
  home: CC, maxHp: CC, hunter: ['@creator'], interact: ['@creator'], t: ['@creator'], a: ['@creator'], lineup: ['@creator'], seed: ['@creator'],
  painted: ['@creator'],
  // the body: where it is, how big its collider is. Combat simulates what moves (brutes, the prop physics); the registry
  // draws it between sim steps (lerpBegin / lerpEnd: written back before anything else runs) and, as one joins, writes
  // x / y / z / h / r back unchanged (their storage: entities.js refNumbers)
  x: [...CC, 'entities'], y: [...CC, 'entities'], z: [...CC, 'entities'], h: [...CC, 'entities'], r: [...CC, 'entities'],
  // combat: damage, breaking, respawns, brutes, chests, the prop physics, the hit feedback
  hp: C, stage: C, broken: C, r0: C, respawnAt: C, resetAt: C, lit: C, dead: C, retired: C, faceW: C, squash: C, air: C, rooted: C,
  face: C, hpShow: C, opened: CC, lid: C, tip: C, tilt: C, vh: C, vx: C, vy: C, sink: C, sinkT: C, float: C, slide: C, stone: C,
  goneBroken: C, wasBroken: C, pushT: C, pushSnd: C, home3: C, push: C, idle: C, wob: C, flash: C,
  // in or out of the world (hidden, kept for a reset): the registry's (world/entities.js hide)
  gone: ['entities'],
  // lights: what burns and glows
  unlit: L, fx: L, model: L, mesh: L, meshes: L, sconce: L, mount: L, lightable: L, n: L,
  garden: ['garden'],
};
const OWNER_OF_PATH = [   // the stack frame's path (after /src/) -> the system
  [/^features\/combat(\.js|\/)/, 'combat'], [/^features\/(firesim|lights)\.js/, 'lights'], [/^features\/depth(\.js|\/)/, 'depth'],
  [/^features\/(rainaudio|windaudio|audio)\.js/, 'audio'], [/^features\/(\w+)\.js/, 1],
  [/^world\/(entities|spatial)\.js/, 'entities'], [/^world\/(\w+)\.js/, 1], [/^sim\/player\//, 'player'], [/^sim\/(\w+)\.js/, 1],
  [/^(game|ui|audio|view|render|core|dev)\//, 1], [/^main\.js/, 'boot'],
];
function writerOf(stack) {
  for (const line of stack.split('\n').slice(1)) {
    const m = line.match(/\/src\/([^?:)]+\.js)/); if (!m || m[1] === 'dev/owncheck.js') continue;
    for (const [re, who] of OWNER_OF_PATH) { const k = m[1].match(re); if (k) return {who: typeof who === 'number' ? k[who] : who, at: m[1] + (line.match(/:(\d+):\d+\)?$/)?.[0].replace(/:\d+\)?$/, '') || '')}; }
    return {who: m[1], at: m[1]};
  }
  return {who: 'unknown', at: ''};
}

export function installOwnCheck(ents) {
  const violations = new Map(), added = new Map(), creatorOf = new WeakMap(), store = new WeakMap(), keysAt = new WeakMap();
  function record(map, key, info) { const v = map.get(key); if (v) { v.n++; return; } map.set(key, {...info, n: 1}); console.warn('owncheck:', key, info.at); }
  function instrument(p, creator) {
    creatorOf.set(p, creator); const vals = {}; store.set(p, vals);
    for (const k of Object.keys(OWNERS)) {
      const had = Object.prototype.hasOwnProperty.call(p, k);
      vals[k] = p[k];
      Object.defineProperty(p, k, {configurable: true, enumerable: had, get: () => vals[k], set(v) {
        if (vals[k] === v) return;
        vals[k] = v;
        const owners = OWNERS[k], w = writerOf(new Error().stack);
        if (!owners.includes(w.who) && !(owners.includes('@creator') && w.who === creatorOf.get(p))) record(violations, `${k}: ${w.who} (owner ${owners.join(' / ').replace('@creator', `creator ${creatorOf.get(p)}`)})`, {field: k, writer: w.who, at: w.at, kind: p.kind});
      }});
    }
    keysAt.set(p, new Set(Object.keys(p)));
  }
  for (const p of ents.list) instrument(p, 'layout');
  const add = ents.add;
  ents.add = p => { const w = ents.has(p) ? null : writerOf(new Error().stack).who; const r = add(p); if (w) instrument(p, w); return r; };
  // fields that appeared after an entity joined (free-form flags): checked on demand (the report) and every 2 s
  function scanAdded() {
    for (const p of ents.list) {
      const ks = keysAt.get(p); if (!ks) continue;
      for (const k of Object.keys(p)) if (!ks.has(k) && !(k in OWNERS)) { ks.add(k); record(added, `${k} on ${p.kind}`, {field: k, kind: p.kind, at: '(found by a scan)'}); }
    }
  }
  setInterval(scanAdded, 2000);
  return () => { scanAdded(); return {violations: [...violations].map(([k, v]) => ({key: k, ...v})), added: [...added].map(([k, v]) => ({key: k, ...v}))}; };
}
