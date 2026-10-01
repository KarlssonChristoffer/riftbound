// PROMPT: "E  open" / "E  climb" over the thing you can interact with (features' prompt() can name it and colour it),
// on the HD overlay. READS: the player adapter (nearest interactable, climb spot), features' prompt().
import {BUSY} from '../sim/player/player.js';
export function drawPrompt(hq, sc, {host, pa, features, G}) {
  const P = pa.P, player = pa.player;
  let at = null, txt = '';
  if (host.lock) return;
  let col = '#f0c060';
  const p = pa.nearProp(); if (p && !BUSY.has(P.state)) {
    const r = features.map(f => f.prompt?.(p)).find(Boolean);
    at = [p.x, p.y, (p.z || 0) + 1.1]; txt = r?.text ?? r ?? 'E  open'; col = r?.color ?? col;
  }
  else if (!BUSY.has(P.state) && pa.climbSpotW()) { at = [player.x, player.y, P.z + 2]; txt = P.z > .1 ? 'E  climb down' : 'E  climb'; }
  if (!at) return;
  const [sx, sy] = G.toScreen(at[0], at[2], at[1]);
  hq.font = `${Math.round(11 * (devicePixelRatio || 1))}px ui-monospace, Consolas, monospace`; hq.textAlign = 'center';
  const w = hq.measureText(txt).width + 12 * (devicePixelRatio || 1);
  hq.fillStyle = 'rgba(14,16,15,.8)'; hq.fillRect(sx * sc - w / 2, sy * sc - 16 * (devicePixelRatio || 1), w, 18 * (devicePixelRatio || 1));
  hq.fillStyle = col; hq.fillText(txt, sx * sc, sy * sc - 3 * (devicePixelRatio || 1));
}
