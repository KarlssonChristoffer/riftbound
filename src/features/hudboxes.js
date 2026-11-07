// HUD BOXES: the info boxes on the screen's left can be hidden in one go (Shift+H, or Esc > Game > HUD > Info boxes): the
// almanac's card and its pointer (features/almanac.js), the night surprises' chips (features/surprises.js: "2 fish flopping
// about", "Dizzy 4s"), the meal's chip (features/meals.js) and the weapon's damage type (features/mods.js: "STORM").
// Health, the belt, prompts and toasts stay. Remembered on this machine ('rb.hudboxes'); ?hudboxes=0 starts them hidden.
//   host.feature('hudboxes')?.on === false   -> a box's owner doesn't draw it (the boxes read this; nothing else changes)
// OWNS: on (shown or not), 'rb.hudboxes'. READS: host.lock. EMITS: nothing. BUDGET: none (no update, no draw).
import {flags} from '../core/flags.js';

const STORE = 'rb.hudboxes';
// (after panels: a plain H is the window's Map; Shift+H is this, as in photo mode H hides its bar)
export const order = {after: ['panels']};

export async function create(host) {
  let saved = null; try { saved = localStorage.getItem(STORE); } catch (e) {}
  const q = flags.get('hudboxes');
  const F = {
    name: 'hudboxes', label: 'Info boxes', on: q != null ? q !== '0' : saved !== '0',
    toggle() {
      F.on = !F.on;
      try { localStorage.setItem(STORE, F.on ? '1' : '0'); } catch (e) {}
    },
    onKey(k, e) {
      if (k !== 'h' || !e?.shiftKey || host.lock) return false;
      F.toggle(); host.uiSound?.(F.on ? 'open' : 'back');
      host.feature('game')?.ui?.toast(F.on ? 'Info boxes shown' : 'Info boxes hidden', 'Shift+H brings them back', '#d8cfb8');
      return true;
    },
  };
  return F;
}
