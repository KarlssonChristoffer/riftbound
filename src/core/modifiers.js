// MODIFIERS: game effects as notes on stats, never overwrites (docs/ARCHITECTURE.md rule 3). Items, augments and a run's
// rules SET notes ({stat, add, mul}) under their source's name; the system that owns a stat turns its own authored base
// into the value whenever the notes change: value = (base + every add) x every mul, in the order the notes were set.
// Dropping a source drops its notes, so nothing ever needs restoring: no snapshots of other systems' numbers.
// Stat names are the owner's: 'combat.crit', 'combat.cd.2', 'player.speed' (the owners list the ones they read).
// OWNS: the notes.  Changes are rare (an item, a run starting): owners recompute on watch(), not per frame.
//   const mods = createModifiers()   (host.mods)
//   mods.set(source, [{stat, add?, mul?}, ...]) (replaces that source's notes) / mods.clear(source)
//   mods.value(stat, base) -> number / mods.watch(fn) (fn() after every change) / mods.ver / mods.list() (dev: the notes)
export function createModifiers() {
  const bySource = new Map(), watchers = [];
  let ver = 0;
  const changed = () => { ver++; for (const fn of watchers) fn(); };
  return {
    set(source, notes) { bySource.set(source, notes.filter(n => n.add || n.mul !== undefined)); changed(); },
    clear(source) { if (bySource.delete(source)) changed(); },
    value(stat, base) {
      let add = 0; const muls = [];
      for (const notes of bySource.values()) for (const n of notes) if (n.stat === stat) { if (n.add) add += n.add; if (n.mul !== undefined) muls.push(n.mul); }
      let v = base + add; for (const m of muls) v *= m;
      return v;
    },
    watch(fn) { watchers.push(fn); },
    get ver() { return ver; },
    list: () => [...bySource].map(([source, notes]) => ({source, notes})),
  };
}
