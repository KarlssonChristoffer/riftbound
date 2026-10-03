// LOOP: the frame (docs/ARCHITECTURE.md rules 4 + 5). Each animation frame (dt capped at 50 ms):
//   the CAMERA turns (keys, drag, the snap ease, the climb assist), at the frame's rate
//   the SIM catches up in FIXED steps of 1/60 s (simStep: the clock, the player, arrows, every feature's update()), so
//     it plays the same at 40 fps and at 240, slow motion (host.timeScale) is exact and a seeded run replays. It runs
//     up to one step ahead of real time (alpha below), never behind; at most MAX_STEPS a frame (a stall drops the rest)
//   the VIEWS follow once (the cloak, every feature's view() with the frame's time and all its steps' events)
//   draw(t) renders the world ALPHA of the way from the last step's start to its end (entities, arrows, the player:
//     their lerpBegin / lerpEnd), so motion is smooth on a 144 / 165 Hz screen; at 60 fps alpha is 1 (no blending)
// Paused, only the views of the features that declare `ambient` run (nature goes on behind the menu); in hitstop, the
// sim steps run only the F.always updates and the views hold (a freeze frame).
// OWNS: the frame's timing (last, lastDt, fps, the HUD's refresh), the sim's clock (acc, alpha), hitstop (freeze), the
//   season's leaf ramp version.
// READS: E (main.js; E.dev: the colliders overlay + the debug HUD).  BUDGET: core/perf.js (F3).
//   const loop = createLoop(E); loop.start() / hitstop(sec) / run(n, dt) (tests: n steps + draws without rAF) / hud()
import {ROT_SPEED} from '../render/camera.js';
import {check as checkEvents} from './events.js';
import {drawPrompt} from '../ui/prompt.js';
import {clearArray} from './mathx.js';

export function createLoop(E) {
  const {G, cv, pa, P, PL, player, keys, mouse, cam, events, features, host, env, proj, hero, stage, perf, opt, lighting, hq, hdc, input, pause, game} = E;
  const {drawZones, drawHud} = E.dev;
  const promptCtx = {host, pa, features, G};   // ui/prompt.js
  let last = performance.now(), fps = 60, hudT = 0, lastDt = 1 / 60, leafVer = -1, leafWorld = null, freeze = 0;
  let views = E.flags.get('views') !== '0';   // ?views=0: the sim alone (tools/test/simview.mjs: it must come out the same)
  const BENCH = E.flags.get('bench') === '1';   // (the bench reads the counts: render/glstats.js -> perf.counts)
  const SIM_DT = 1 / 60, MAX_STEPS = 4;
  let acc = 0, alpha = 1;   // acc: real time the sim is behind (<= 0: ahead); alpha: where the draw sits in the last step
  let hovIt = null;         // the world item with the hover pulse on (the aimed target)
  const frameEvs = [];      // every event of this frame's sim steps, for the views
  // ONE fixed sim step
  function simStep(dt) {
    stage.ents.sync(); pa.snap();   // the grid follows what moved; where everything was at the step's start (the draw)
    perf.begin('env', 'sim'); env.step(dt); perf.end('env');   // the world clock first: everything after reads this step's time / weather
    if (freeze > 0) { freeze -= dt; for (const f of features) if (f.always) f.update?.(dt, []); return; }
    const n0 = events.length, px0 = P.x, py0 = P.y;
    perf.begin('player.step', 'sim'); PL.step(dt); perf.end('player.step');
    for (let i = n0; i < events.length; i++) pa.toWorldEvent(events[i]);   // the player's events are in the view frame
    hero.moveCloth(P.x - px0, P.y - py0);   // its motion in the view frame, without the camera's turns
    perf.begin('arrows', 'sim'); proj.step(dt); perf.end('arrows');
    const evs = events.splice(0);
    if (host.dev) checkEvents(evs);   // a type not in the catalog warns once (dev mode)
    for (const f of features) f.update?.(dt, evs);
    for (let i = 0; i < evs.length; i++) frameEvs.push(evs[i]);
  }
  // ONE frame: the camera, the sim's fixed steps, the views
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
    const sdt = dt * host.timeScale; if (sdt <= 0) return;   // the game's slow motion / frozen world (the camera above stays live)
    const held = freeze > 0;   // hitstop: the sim steps run the F.always updates only, the views hold
    acc += sdt; clearArray(frameEvs);
    for (let n = 0; acc > 1e-9 && n < MAX_STEPS; n++) { simStep(SIM_DT); acc -= SIM_DT; }
    if (acc > 0) acc = 0;   // still behind after MAX_STEPS (a stall): let it go rather than spiral
    alpha = 1 + acc / SIM_DT;
    if (!views || held) return;
    hero.stepCloth(sdt, perf);
    for (const f of features) if (f.on !== false) f.view?.(sdt, frameEvs);   // VIEW
    cv.stepShake(sdt);
  }
  // the draw: the world alpha of the way through the last sim step (put back after)
  function draw(t) {
    pa.tick();
    pa.lerpBegin(alpha); stage.ents.lerpBegin(alpha); proj.lerpBegin(alpha);
    try { render(t); } finally { proj.lerpEnd(); stage.ents.lerpEnd(); pa.lerpEnd(); }
  }
  function render(t) {
    cv.stepZoom(lastDt);
    const PX = player.x, PY = player.y;
    cv.follow(lastDt, PX, PY, P, cam);   // the camera eases after him (render/camera.js)
    if (!views) return;   // (the camera follows without views too: it's the frame the cursor is read in, the sim's input)
    // the Ranger: sprite (+ runtime cloak) + pixel bow, albedo and normals, sinking when he falls in (view/hero.js); or,
    // with ?live=1 and the live hero on, his live 3D body (view/livehero.js)
    const sinkPx = E.live?.on ? E.live.compose(PX, PY, perf) : hero.compose(PX, PY, perf);
    // props, hover pulse on the aimed target
    const hov = P.state === 'draw' ? pa.hoverTarget()?.target : null, hi = hov ? stage.world.itemOf(hov) : null;
    if (hovIt && hovIt !== hi) hovIt.hover = 0;   // (only the aimed item's pulse is ever on: no write per item per frame)
    if (hi) hi.hover = .16 + .08 * Math.sin(performance.now() / 110);
    hovIt = hi;
    perf.begin('world.update', 'view'); stage.world.update(cv.yaw); perf.end('world.update');
    // the season's leaves (env.leafRamp: changes a few times per season; a rebuilt world starts from the biome's own ramp)
    const lr = env.leafRamp(); if (lr && (env.ver.leaf !== leafVer || stage.world !== leafWorld)) { stage.world.setFamily?.('leaf', lr); leafVer = env.ver.leaf; leafWorld = stage.world; }
    proj.draw(host);
    for (const f of features) if (f.on !== false) f.frame?.({dt: lastDt, t});
    // the aim reticle (pixel cross at the cursor, front layer; drawn by the GPU: the layer's 2D canvas went up whole every
    // frame a gun was out for these 4 pixels' rects)
    if (P.state === 'draw') {
      const q = G.glayer('front'), mx = Math.round(cv.VW / 2 + (mouse.x - cv.VW / 2) * cv.zoom), my = Math.round(cv.VH / 2 + (mouse.y - cv.VH / 2) * cv.zoom);
      q.fillStyle = P.t > .5 ? '#f2d27a' : '#e9e4da';
      q.fillRect(mx - 3, my, 2, 1); q.fillRect(mx + 2, my, 2, 1); q.fillRect(mx, my - 3, 1, 2); q.fillRect(mx, my + 2, 1, 2);
    }
    if (opt.zones) drawZones({G, host, world: stage.world});
    perf.begin('mood+lights', 'view'); lighting.apply(PX, PY, t); perf.end('mood+lights');
    perf.begin('G.render', 'render'); G.render(); perf.end('G.render');
    const cnt = perf.on || BENCH; G.glStats.enable(cnt); if (cnt) perf.counts(G.glStats.take());   // (draws, uploads... while F3 is up)
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
