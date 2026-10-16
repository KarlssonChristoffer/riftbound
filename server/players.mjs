// PLAYERS: what the server keeps of a player beyond the session (briefs/depth-shared.md: "a player's records on the server"),
// keyed by the browser's random key its hello carries (features/coop.js: localStorage rb.key), so a rejoin finds them again.
// In memory while the room runs; nothing on the disk (home-world saving is set aside). Each system keeps its own part of the
// record it gets: the workshop's made things (server/workshop.mjs: rec.made, uid -> record); a skills system its XP.
//   const players = createPlayers(); players.of(key) -> {key, made: Map} (made the first time a key is seen); players.size
// OWNS: the records by key. READS: nothing.
export function createPlayers() {
  const byKey = new Map();
  return {
    of(key) {
      if (typeof key !== 'string' || !key) return null;
      let r = byKey.get(key);
      if (!r) { r = {key, made: new Map()}; byKey.set(key, r); }
      return r;
    },
    get size() { return byKey.size; },
  };
}
