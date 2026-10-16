// PANELS: the player's window and its tabs (ui/book.js draws it), the one place a feature puts something the player opens and
// looks at (dev and test tools don't go here: the Esc menu's Dev / Sandbox tabs and dev/ are theirs). Diablo-style: Tab opens
// the window where it was, a letter opens its tab (I pack, K skills, B craft, J journal, H map), the same letter again or Esc
// shuts it. The pack (features/pack.js through ui/packpanel.js) fills Pack, Skills, Craft and Journal; the gear
// (features/gear.js) puts what you wear in Pack beside the bag; the map is ui/mapview.js. Another feature adds its own:
//   const P = host.feature('panels')   (null with ?panels=0: then the old floating panels; guard with ?.)
//   P.tab({id, title, key?, order?, cols?, hint?, badge?})   a tab (key: its hotkey letter, taken in play; say so in this header)
//   P.part({id, tab, col?, order?, title?, ver?, html?, mount?, sync?, onShow?, onHide?, frame?, click?, menu?, hover?, shown?})
//   P.open(id?) / P.close() / P.toggle(id?) / P.isOpen / P.tabId / P.icon(itemId) -> a data URL (the item's pixel icon)
//   (the fields: ui/book.js's header. Clicks are DOM events between steps: a part queues what changes the sim and does it in its
//   feature's update, as the pack's recipes do)
// THE TABS (order): pack 10 (Tab / I), skills 20 (K), craft 30 (B), journal 40 (J), map 50 (H). Free for others: 15, 25, 35 ...
// KEYS: the letters are dev keys outside the sandbox (dev/devkeys.js DEV_KEYS: i j k b); claims() hands them to play. In the
// sandbox (dev mode) they win over those dev toggles (the armour, the HD bow, the air particles: in the Esc menu's Dev tab).
// OWNS: the book (ui/book.js), the map view (ui/mapview.js). READS: host.lock, host.hudOff.
// EMITS: nothing.  BUDGET: shut: a compare a frame; open: ui/book.js's (the current tab's parts on change).
import {createBook} from '../ui/book.js';
import {itemIcon} from '../ui/packpanel.js';
import {flags} from '../core/flags.js';

const ON = flags.get('panels') !== '0';
// (first in the onKey chain: before the old Tab handlers in pack / gear and atmos's K)
export const order = {before: ['pack', 'gear', 'atmos', 'workshop']};

export async function create(host) {
  if (!ON) return {name: 'panels', on: false};
  const book = createBook({sound: n => host.uiSound?.(n), icon: itemIcon, micro: flags.get('microbar') !== '0'});
  const KEYS = {};   // letter -> tab id
  const tab = t => { book.tab(t); if (t.key) KEYS[t.key] = t.id; };
  tab({id: 'pack', title: 'Pack', key: 'i', order: 10, hint: 'Click a tool: it swings for its job. Right-click a material: put it down.'});
  tab({id: 'skills', title: 'Skills', key: 'k', order: 20, cols: [130], hint: 'Pick a skill to see its moves.'});
  tab({id: 'craft', title: 'Craft', key: 'b', order: 30, cols: [86], hint: 'Pick a list, then click what to make.'});
  tab({id: 'journal', title: 'Journal', key: 'j', order: 40, cols: [86], hint: 'What you have found so far.'});
  tab({id: 'map', title: 'Map', key: 'h', order: 50, hint: 'Wheel: zoom · drag: look around'});
  // the map (ui/mapview.js): the fog lifts where you walk, shut or not
  let map = null;
  try { map = (await import('../ui/mapview.js')).createMapView(host); } catch (e) { console.warn('panels: no map', e); }   // (a broken map leaves the rest of the window)
  if (map) book.part({id: 'map', tab: 'map', order: 10, mount: el => map.mount(el), onShow: () => map.show(), onHide: () => map.hide(), frame: () => map.frame()});

  const F = {
    name: 'panels', label: 'Panels', on: true,
    tab, part(p) { book.part(p); },
    open(id) { book.open(id); }, close() { book.close(); }, toggle(id) { book.toggle(id); },
    get isOpen() { return book.isOpen; }, get tabId() { return book.tabId; },
    icon: itemIcon, redraw: id => book.redraw(id),
    update(dt) { map?.update?.(dt); },
    frame() { book.frame(!!host.hudOff || !!host.lock); },
    claims: k => k in KEYS,
    onKey(k, e) {
      if (host.lock) return false;
      if (k === 'tab') { if (e?.shiftKey) return false; book.toggle(); host.uiSound?.(book.isOpen ? 'open' : 'back'); return true; }   // (Shift+Tab: dev/wardrobe.js)
      const id = KEYS[k]; if (!id || e?.ctrlKey || e?.altKey || e?.metaKey || e?.shiftKey) return false;
      book.toggle(id); host.uiSound?.(book.isOpen ? 'open' : 'back'); return true;
    },
    // Esc (core/input.js): shut the window first, the pause menu next time
    escape() { if (!book.isOpen) return false; book.close(); host.uiSound?.('back'); return true; },
  };
  return F;
}
