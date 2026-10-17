// RECORDS across runs, in localStorage (the page works without it: private windows, blocked storage).
const KEY = 'riftbound3d.save.v1';
const BLANK = {runs: 0, wins: 0, kills: 0, bestStage: 0, bestTime: 0, fastestWin: 0};

export function loadSave() {
  try { return {...BLANK, ...JSON.parse(localStorage.getItem(KEY) || '{}')}; } catch { return {...BLANK}; }
}
function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage blocked: records live for this page only */ } }

// a finished run: r = {stage (reached, 1-based), time (s), kills, won}
export function recordRun(save, r) {
  save.runs++; save.kills += r.kills;
  if (r.won) { save.wins++; save.fastestWin = save.fastestWin ? Math.min(save.fastestWin, r.time) : r.time; }
  if (r.stage > save.bestStage || (r.stage === save.bestStage && r.time > save.bestTime)) { save.bestStage = r.stage; save.bestTime = r.time; }
  write(save);
  return save;
}

// THE WORLD (docs/GATHERING.md: the persistent world): what the player carries and has learned, and what each system keeps
// of the world (features/pack.js holds it: pack.store(name) is a system's own part). A separate key: the run records
// above stay as they are. -> the saved object, or null (none yet, or storage blocked)
const WORLD_KEY = 'riftbound3d.world.v1';
export function loadWorld() {
  try { const o = JSON.parse(localStorage.getItem(WORLD_KEY) || 'null'); return o && typeof o === 'object' ? o : null; } catch { return null; }
}
export function saveWorld(o) { try { localStorage.setItem(WORLD_KEY, JSON.stringify(o)); return true; } catch { return false; } }
// a save the game can't read (a version it has no step for): kept aside under its own key before a new world replaces it
export function stashWorld(o) { try { localStorage.setItem(WORLD_KEY + '.unread', JSON.stringify(o)); return true; } catch { return false; } }
export function clearWorld() { try { localStorage.removeItem(WORLD_KEY); } catch { /* blocked */ } }

export const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
