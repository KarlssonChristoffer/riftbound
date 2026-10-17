// SKILLS: XP and levels (docs/GATHERING.md: skills by doing). A skill's level is a few notes in host.mods (source
// 'skills'): content/skills.js `per` says which, the owner of each stat reads it (woodcut.power: features/woodcut.js).
//   const sk = createSkills(SKILLS, CURVE, mods)
//   sk.gain(id, n) -> the new level if this XP raised it, else 0 / sk.level(id) / sk.xp(id) / sk.span(id) -> {at, next}:
//   the XP the level began at and the next one's (next = at: the last level)
//   sk.levelAt(xp) / sk.toJSON() -> {id: xp} / sk.load(o) / sk.ver (bumps on every gain: caches)
//   sk.set(id, xp) -> the new level if it went up, else 0 (co-op: the server's word on his XP, server/players.mjs)
// OWNS: the XP, the source 'skills' in host.mods.
export function createSkills(SKILLS, CURVE, mods) {
  const xp = {};
  for (const id in SKILLS) xp[id] = 0;
  let ver = 0;
  const need = L => Math.round(CURVE.k * Math.pow(L - 1, CURVE.p));   // the XP a level begins at
  function levelAt(x) { let L = 1; while (L < CURVE.max && x >= need(L + 1)) L++; return L; }
  function apply() {
    const notes = [];
    for (const id in SKILLS) {
      const L = levelAt(xp[id]) - 1; if (!L) continue;
      for (const n of SKILLS[id].per || []) notes.push(n.mul !== undefined ? {stat: n.stat, mul: 1 + n.mul * L} : {stat: n.stat, add: n.add * L});
    }
    if (notes.length) mods.set('skills', notes); else mods.clear('skills');
  }
  return {
    gain(id, n) {
      if (!(id in xp) || !(n > 0)) return 0;
      const L0 = levelAt(xp[id]); xp[id] += n; ver++;
      const L1 = levelAt(xp[id]); if (L1 === L0) return 0;
      apply(); return L1;
    },
    set(id, n) {
      if (!(id in xp) || !(n >= 0) || n === xp[id]) return 0;
      const L0 = levelAt(xp[id]); xp[id] = n; ver++;
      const L1 = levelAt(n); if (L1 !== L0) apply();
      return L1 > L0 ? L1 : 0;
    },
    level: id => levelAt(xp[id] || 0),
    xp: id => xp[id] || 0,
    span(id) { const L = levelAt(xp[id] || 0); return {at: need(L), next: L < CURVE.max ? need(L + 1) : need(L)}; },
    levelAt, get ver() { return ver; },
    toJSON: () => ({...xp}),
    load(o) { for (const id in SKILLS) xp[id] = Math.max(0, +(o?.[id]) || 0); ver++; apply(); },
  };
}
