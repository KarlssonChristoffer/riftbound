// LOOP: the frame. step(dt) moves the world on in two passes (docs/ARCHITECTURE.md rule 5, sim vs view):
//   SIM: the clock, the player, arrows, then every feature's update() (the truth: always, even with its visuals off)
//   VIEW: the cloak, then every feature's view() (presentation: reads the finished sim, writes only its own state)
// Paused, only the views of the features that declare `ambient` run (nature goes on behind the menu); in hitstop, only
// the F.always updates. draw(t) renders (the camera, the hero's card, props, features' frame(), lights, the GPU
// passes, the HD overlay). One step + one draw per animation frame, dt capped at 50 ms.
// OWNS: the frame's timing (last, lastDt, fps, the HUD's refresh), hitstop (freeze), the season's leaf ramp version.
// READS: E (main.js; E.dev: the colliders overlay + the debug HUD).  BUDGET: core/perf.js (F3).
//   const loop = createLoop(E); loop.start() / hitstop(sec) / run(n, dt) (tests: n steps + draws without rAF) / hud()
import {ROT_SPEED} from '../render/camera.js';
import {check as checkEvents} from './events.js';
import {drawPrompt} from '../ui/prompt.js';

export function createLoop(E) {
  const {G, cv, pa, P, PL, player, keys, mouse, cam, events, features, host, env, proj, hero, stage, perf, opt, lighting, hq, hdc, input, pause, game} = E;
  const {drawZones, drawHud} = E.dev;
  const promptCtx = {host, pa, features, G};   // ui/prompt.js
  let last = performance.now(), fps = 60, hudT = 0, lastDt = 1 / 60, leafVer = -1, leafWorld = null, freeze = 0;
  let views = E.flags.get('views') !== '0';   // ?views=0: the sim alone (tools/test/simview.mjs: it must come out the same)
  function step(dt) {
    pa.tick();
    // camera rotation: keys / middle-drag, then (in a step mode) ease onto the nearest step once you let go.
    // A climb started at an angle eases the camera to north first, climbs, then returns.
    const rot = (keys.has('x') ? 1 : 0) - (keys.has('z') ? 1 : 0), paused = pause.paused;
    // paused: the menu's slow drift + dragging its backdrop
    const dragYaw = input.takeYaw();
    let ny = cv.yaw + (paused ? pause.pauseTurn(dt) + dragYaw : rot * ROT_SPEED * dt + dragYaw);
    if (!paused && pa.assist) ny = pa.stepAssist(dt, ny);
    else if (!paused && !rot && !input.dragging && cv.snapMode) ny = cv.snapEase(ny, dt);
    const y0 = cv.yaw; cv.setYaw(ny); pa.syncPlateaus();
    cv.stepSampling(dt, cv.yaw !== y0);
    if (paused) { pause.stepPaused(dt); return; }   // the game stands still, nature goes on
    dt *= host.timeScale; if (dt <= 0) return;   // the game's slow motion / frozen world (the camera above stays live)
    stage.ents.sync();   // the grid follows what moved last step (world/entities.js)
    perf.begin('env', 'sim'); env.step(dt); perf.end('env');   // the world clock first: everything after reads this step's time / weather
    if (freeze > 0) { freeze -= dt; for (const f of features) if (f.always) f.update?.(dt, []); return; }
    const n0 = events.length, px0 = P.x, py0 = P.y;
    perf.begin('player.step', 'sim'); PL.step(dt); perf.end('player.step');
    for (let i = n0; i < events.length; i++) pa.toWorldEvent(events[i]);   // the player's events are in the view frame
    hero.moveCloth(P.x - px0, P.y - py0);   // its motion in the view frame, without the camera's turns
    perf.begin('arrows', 'sim'); proj.step(dt); perf.end('arrows');
    if (views) hero.stepCloth(dt, perf);
    const evs = events.splice(0);
    if (host.dev) checkEvents(evs);   // a type not in the catalog warns once (dev mode)
    for (const f of features) f.update?.(dt, evs);              // SIM
    if (views) for (const f of features) if (f.on !== false) f.view?.(dt, evs);   // VIEW
    cv.stepShake(dt);
  }
  function draw(t) {
    pa.tick();
    cv.stepZoom(lastDt);
    const [PX, PY] = [player.x, player.y];
    cv.follow(lastDt, PX, PY, P, cam);   // the camera eases after him (render/camera.js)
    if (!views) return;   // (the camera follows without views too: it's the frame the cursor is read in, the sim's input)
    // the Ranger: sprite (+ runtime cloak) + pixel bow, albedo and normals, sinking when he falls in (view/hero.js)
    const sinkPx = hero.compose(PX, PY, perf);
    // props, hover pulse on the aimed target
    const hov = P.state === 'draw' ? pa.hoverTarget()?.target : null;
    for (const it of stage.world.items) it.hover = it.p === hov ? .16 + .08 * Math.sin(performance.now() / 110) : 0;
    perf.begin('world.update', 'view'); stage.world.update(cv.yaw); perf.end('world.update');
    // the season's leaves (env.leafRamp: changes a few times per season; a rebuilt world starts from the biome's own ramp)
    const lr = env.leafRamp(); if (lr && (env.ver.leaf !== leafVer || stage.world !== leafWorld)) { stage.world.setFamily?.('leaf', lr); leafVer = env.ver.leaf; leafWorld = stage.world; }
    proj.draw(host);
    for (const f of features) if (f.on !== false) f.frame?.({dt: lastDt, t});
    // the aim reticle (pixel cross at the cursor, front layer)
    if (P.state === 'draw') {
      const q = G.layer('front'), mx = Math.round(cv.VW / 2 + (mouse.x - cv.VW / 2) * cv.zoom), my = Math.round(cv.VH / 2 + (mouse.y - cv.VH / 2) * cv.zoom);
      q.fillStyle = P.t > .5 ? '#f2d27a' : '#e9e4da';
      q.fillRect(mx - 3, my, 2, 1); q.fillRect(mx + 2, my, 2, 1); q.fillRect(mx, my - 3, 1, 2); q.fillRect(mx, my + 2, 1, 2);
    }
    if (opt.zones) drawZones({G, host, world: stage.world});
    perf.begin('mood+lights', 'view'); lighting.apply(PX, PY, t); perf.end('mood+lights');
    perf.begin('G.render', 'render'); G.render(); perf.end('G.render');
    // HD overlay
    const dpr = devicePixelRatio || 1, sc = cv.scale * dpr;
    hq.setTransform(1, 0, 0, 1, 0, 0); hq.clearRect(0, 0, hdc.width, hdc.height);
    for (const f of features) if (f.on !== false && f.hd && (!host.hudOff || f === game)) { hq.save(); f.hd(hq, sc); hq.restore(); }   // hudOff: the title
    if (opt.hdBow && !sinkPx) hero.drawHDBow(hq, sc);
    drawPrompt(hq, sc, promptCtx);
    perf.draw(hq, sc);
  }
  function frame(now) {
    const dt = Math.max(0, Math.min(.05, (now - last) / 1000)); last = now; lastDt = dt;
    perf.frameStart(); step(dt); draw(now / 1000); perf.frameEnd();
    fps = fps * .95 + (dt > 0 ? 1 / dt : 60) * .05;
    if (now - hudT > 250) { hudT = now; hud(); }
    requestAnimationFrame(frame);
  }
  const hud = () => drawHud({host, opt, stage, env, hero, cv, features, G, fps, proj, PL});   // dev/devtools.js
  return {
    start: () => requestAnimationFrame(frame),
    hitstop: sec => { freeze = Math.max(freeze, sec); },   // host.hitstop: the sim holds (F.always features run on)
    run(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) { lastDt = dt; step(dt); draw(performance.now() / 1000); } },
    hud,
  };
}
