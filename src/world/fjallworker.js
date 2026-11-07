// FJALLWORKER: the fjäll's heavy work off the main thread (a module worker: features/fjall.js starts it). It grows the same plan as
// the page (world/fjall.js, from the seed and the home ground along the home box's edges), bakes it (the height field, the trails, the
// scatter: ~1-2 s) and hands the result over once (plan.pack(): the page adopts it); then it paints ground on request
// (world/fjallpaint.js) and sends each rect back as an ImageBitmap (transferred: no copy).
//   in:  {type: 'plan', seed, home, edges}  |  {type: 'paint', id, x0, y0, wm, hm, ppm}
//   out: {type: 'plan', o, ms}              |  {type: 'paint', id, bmp, ms}
import {fjallPlan} from './fjall.js';
import {paintRect} from './fjallpaint.js';

let P = null;
self.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'plan') {
      const t = performance.now();
      P = fjallPlan(m.seed, {home: m.home, edges: m.edges});
      const o = P.pack();   // (copied, not transferred: the worker paints from the same field)
      self.postMessage({type: 'plan', o, ms: performance.now() - t});
    } else if (m.type === 'paint' && P) {
      const t = performance.now(), px = paintRect(P, m.x0, m.y0, m.wm, m.hm, m.ppm);
      const bmp = await createImageBitmap(new ImageData(px, Math.round(m.wm * m.ppm), Math.round(m.hm * m.ppm)));
      self.postMessage({type: 'paint', id: m.id, bmp, ms: performance.now() - t}, [bmp]);
    }
  } catch (err) { self.postMessage({type: 'error', id: m.id, msg: String(err?.stack || err)}); }
};
