// THE PLAYER KEY (docs/SKILLS.md): who this browser's player is to a co-op server, without accounts: 16 random bytes made once
// and kept in localStorage (rb.player.key), sent in the hello (features/coop.js); the server keeps his record by it
// (server/players.mjs). Storage blocked (a private window): a key for this page's life only.
//   playerKey() -> 32 hex characters
let key = null;
export function playerKey() {
  if (key) return key;
  try { key = localStorage.getItem('rb.player.key'); } catch {}
  if (!/^[0-9a-f]{32}$/.test(key || '')) {
    const b = new Uint8Array(16); crypto.getRandomValues(b);
    key = [...b].map(v => v.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('rb.player.key', key); } catch {}
  }
  return key;
}
