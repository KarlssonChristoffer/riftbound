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

export const clock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
