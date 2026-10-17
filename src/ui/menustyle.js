// THE MENU'S PIXEL LOOK (Escape; ui/menu.js): the same frames, font and colours as the player's window (ui/book.js), laid over
// the menu's plain-text style in src/index.html (that stays as the fallback, and its layout rules: the fixed height, the
// value boxes). One style element, added once; --u (css px per UI pixel) is set on #pause each time the menu shows.
//   styleMenu(root) (once, from createMenu)
// OWNS: its style element and #pause's --m-* frame variables.
import {FRAMES, uiUnit} from './pixelframe.js';
import {loadPixelFont} from './pixelfont.js';

const CSS = `
#pause { --u: 2px; --ink: #efe6cf; --dim: #a39478; --key: #f2c95c; color: var(--ink); text-shadow: none;
  font: calc(10 * var(--u)) / calc(11 * var(--u)) RiftPixel, ui-monospace, Consolas, monospace; font-synthesis: none; background: rgba(8, 6, 4, .45); }
#pause #menu { width: min(calc(250 * var(--u)), 100%); height: min(calc(300 * var(--u)), 100%); padding: calc(4 * var(--u)) calc(5 * var(--u));
  box-sizing: border-box; image-rendering: pixelated; border: calc(3 * var(--u)) solid transparent; border-image: var(--m-panel) 3 fill / calc(3 * var(--u)); }
#pause #menu header { padding-bottom: calc(3 * var(--u)); }
#pause .m-title { font-size: calc(20 * var(--u)); line-height: calc(20 * var(--u)); font-weight: 400; letter-spacing: var(--u); color: var(--key); text-shadow: var(--u) var(--u) 0 #0c0907; }
#pause .m-sub { font-size: inherit; color: var(--dim); opacity: 1; }
#pause .m-close { top: 0; font: inherit; color: var(--dim); opacity: 1; text-shadow: none; }
#pause .m-close:hover, #pause .m-close:focus-visible { color: var(--ink); }
#pause #menu nav { gap: var(--u); padding: 0 0 calc(3 * var(--u)); margin-bottom: calc(3 * var(--u)); border-bottom: var(--u) solid #4a3826; }
#pause .m-tab { padding: var(--u) calc(4 * var(--u)) 0; font: inherit; color: var(--dim); opacity: 1; text-shadow: none; text-decoration: none;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--m-card) 2 fill / calc(2 * var(--u)); }
#pause .m-tab:hover, #pause .m-tab:focus-visible { color: var(--ink); border-image-source: var(--m-hot); }
#pause .m-tab.on { color: var(--key); text-decoration: none; border-image-source: var(--m-on); text-shadow: var(--u) var(--u) 0 #0c0907; }
#pause .m-cats { gap: var(--u); padding: 0 0 calc(3 * var(--u)); }
#pause .m-cat { padding: 0 calc(3 * var(--u)); font: inherit; color: var(--dim); opacity: 1; text-shadow: none; background: none; border-radius: 0;
  border: calc(2 * var(--u)) solid transparent; border-image: var(--m-card) 2 fill / calc(2 * var(--u)); }
#pause .m-cat:hover, #pause .m-cat:focus-visible { color: var(--ink); background: none; border-image-source: var(--m-hot); }
#pause .m-cat.on { color: var(--key); background: none; border-image-source: var(--m-on); }
#pause .m-body { scrollbar-color: #7a5f3e #15100c; }
#pause .m-body h4 { margin: calc(5 * var(--u)) calc(2 * var(--u)) var(--u); font: inherit; font-weight: 400; letter-spacing: 0; color: var(--dim); opacity: 1; }
#pause .m-row, #pause .m-act { gap: calc(6 * var(--u)); padding: var(--u) calc(3 * var(--u)); margin-bottom: var(--u); font: inherit; color: var(--ink); opacity: 1; text-shadow: none;
  border-radius: 0; border: calc(2 * var(--u)) solid transparent; }
#pause .m-row:hover, #pause .m-row:focus-visible, #pause .m-act:hover, #pause .m-act:focus-visible { background: none; border-image: var(--m-hot) 2 fill / calc(2 * var(--u)); }
#pause .m-act { border-image: var(--m-btn) 2 fill / calc(2 * var(--u)); }
#pause .m-act.main { color: var(--key); }
#pause .m-act.tool { font: inherit; }
#pause .m-row small { font-size: inherit; color: var(--dim); opacity: 1; margin-left: calc(3 * var(--u)); }
#pause .m-row.sub { padding-left: calc(10 * var(--u)); font: inherit; }
#pause .m-val { color: var(--key); }
#pause .m-val i { color: var(--dim); opacity: 1; padding: 0 calc(3 * var(--u)); }
#pause .m-val i:hover { color: var(--ink); }
#pause .m-keys > div { grid-template-columns: calc(64 * var(--u)) 1fr; gap: calc(4 * var(--u)); padding: var(--u) calc(3 * var(--u)); font: inherit; }
#pause .m-keys > div > span:first-child { color: var(--key); opacity: 1; }
#pause .m-note { font: inherit; color: var(--dim); opacity: 1; margin: calc(5 * var(--u)) calc(3 * var(--u)) 0; }
#pause .m-hint { font: inherit; color: var(--dim); opacity: .8; text-shadow: var(--u) var(--u) 0 #0c0907; }`;

let done = false;
export function styleMenu(root) {
  if (!done) { done = true; const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st); loadPixelFont(); }
  for (const k of ['panel', 'card', 'hot', 'on', 'btn']) root.style.setProperty('--m-' + k, FRAMES[k]());
  return () => root.style.setProperty('--u', uiUnit() + 'px');   // (call it when the menu shows: the window may have been resized)
}
