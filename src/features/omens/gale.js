// THE GALE (an omen: features/omens.js runs it). The world clock's 'gale' weather (sim/env.js: wind 3, the strongest the
// wind feature knows) makes the whole world blow: trees, grass, cloth, leaves and snow in the air (features/wind.js and the
// others follow env.windLevel); the gale's rules ride on the same wind, along its way (host.wind.dir):
//   SIM   host.mods notes (source 'omen'): 'proj.windX' / 'proj.windY' push every arrow in flight (sim/projectiles.js:
//         TUNE.gale.arrow m/s^2, +arrowK a stage), a bullet TUNE.gale.bullet x that ('proj.windBullet'); 'player.windX' /
//         'player.windY' (sim/player/adapter.js -> player.js moveBy): moving with the wind is TUNE.gale.run faster,
//         against it slower. Aim upwind.
//   VIEW  dust and grit streaking across the view on the wind (world lines, the biome's colours), a fleck of dust off
//         every arrow in flight along its bending path.
// OWNS: its notes' numbers, its streaks (preallocated). READS: host.wind (dir), host.arrows, the view's ground centre.
// BUDGET: view ~.02 ms (90 streaks).
import {TUNE as ALL} from '../../content/omens.js';
import {viewRandom} from '../../core/rng.js';
import {C} from './kit.js';

const T = ALL.gale;
const DIR0 = [.94, .34], NS = 90;
const DUST = {ruins: [C('#d8cca4'), C('#b0a27c')], frost: [C('#f2f6ff'), C('#c4d0e4')], ember: [C('#a39a92'), C('#7c746e')],
  rift: [C('#c8a8f0'), C('#8a6ac0')], desert: [C('#f0deb0'), C('#d6ba86')]};

export function createGale(host, K) {
  const V = viewRandom('omens.gale'), vr = (a, b) => a + V() * (b - a);
  let sk = 0, k = 0;
  const dir = () => host.wind?.dir || DIR0;
  const sX = new Float32Array(NS), sY = new Float32Array(NS), sH = new Float32Array(NS), sV = new Float32Array(NS), sL = new Float32Array(NS);
  let placed = false;
  // a streak somewhere round the view's centre (the player): anywhere at first, then coming in from upwind
  function streak(i, cx, cy, any) {
    const d = dir(), ux = d[0], uy = d[1], along = any ? vr(-16, 16) : vr(-18, -14), side = vr(-14, 14);
    sX[i] = cx + ux * along - uy * side; sY[i] = cy + uy * along + ux * side; sH[i] = vr(.15, 2.6); sV[i] = vr(9, 15); sL[i] = vr(.35, .9);
  }
  const G = {
    notes(stage) {
      sk = stage;
      const d = dir(), ux = d[0], uy = d[1], a = T.arrow * (1 + T.arrowK * stage);
      return [{stat: 'proj.windX', add: ux * a}, {stat: 'proj.windY', add: uy * a}, {stat: 'proj.windBullet', mul: T.bullet},
        {stat: 'player.windX', add: ux * T.run}, {stat: 'player.windY', add: uy * T.run}];
    },
    get dir() { return dir(); },
    begin(stage) { sk = stage; placed = false; k = 0; },
    end() {},
    view(dt) {
      k = Math.min(1, k + dt / 3);
      const P = host.player, d = dir(), ux = d[0], uy = d[1];
      if (!placed) { for (let i = 0; i < NS; i++) streak(i, P.x, P.y, true); placed = true; }
      for (let i = 0; i < NS; i++) {
        sX[i] += ux * sV[i] * dt; sY[i] += uy * sV[i] * dt;
        const along = (sX[i] - P.x) * ux + (sY[i] - P.y) * uy;
        if (along > 18 || Math.abs(-(sX[i] - P.x) * uy + (sY[i] - P.y) * ux) > 16) streak(i, P.x, P.y, false);
      }
    },
    frame(t) {
      const pal = DUST[host.biome.id] || DUST.ruins, d = dir(), ux = d[0], uy = d[1], n = Math.round(NS * k);
      for (let i = 0; i < n; i++) {
        const l = sL[i], h = sH[i] + Math.sin(t * 3 + i) * .05;
        host.line(sX[i], sY[i], h, sX[i] - ux * l, sY[i] - uy * l, h - .03, pal[i & 1]);
      }
      // a fleck of dust off every arrow in flight, along its (bending) path
      for (const a of host.arrows) {
        if (a.stuck || a.kind === 'bullet' || !a.trail) continue;
        for (let j = 0; j < a.trail.length; j += 2) { const q = a.trail[j]; host.point(q[0], q[1], q[2], pal[1], K.P1); }
      }
    },
    lights() {},
  };
  return G;
}
