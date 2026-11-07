// MUD (view; living-animals.md slice 1 "Tracks in the mud", docs/FAUNA.md "Tracks"): after rain the forest's soft ground takes a
// print of everything that walks on it. This is only the GROUND's part: the prints themselves are features/prints.js's (the one
// owner of footprints, depth-shared.md), which already walks you, your friends and the ground animals; this feature adds its
// surfaces and a rule for it (prints.rule: where the ground is wet and soft, a step goes into the mud) and wears them out.
//   WHERE    soft patches of the forest floor (a noise of MUD.patch m, plus the puddles' hollows: features/puddles.js F.ready);
//            the moss and needles between them take none, nor rock, sand, the fell's bare top, water or the cave. By a puddle the
//            print goes in deep ('mud_deep', darker)
//   WHEN     the ground's wetness (sim/env.js E.wet) at MUD.wet or more and no lying snow (the snow is prints.js's own); ?mud=1 or
//            Esc > Sandbox: wet now, whatever the weather
//   WEAR     a mud print lasts content/prints.js SURF.mud's hours; heavy rain washes the rest out within MUD.washH hours, the
//            ground drying out fades it within MUD.dryH (prints.wear: one clock a surface)
// API: F.at(x, y) -> 'mud' | 'mud_deep' | null (the surface a step here goes into now), F.takes(x, y) -> 0 | 1 | 2 (the ground
//   alone, wet or not: none / a print / a deep one), F.wet() (is it wet enough now), F.wetNow(on).
// OWNS: the mud flag, its surfaces' wear. READS: host.env (wet, snowCover, sky.rain, t), host.layout.forest (the fell, the strand,
//   the lake, the streams, the rock), host.world.cave, puddles (F.ready), prints (rule, surface, wear). EMITS: nothing.
// BUDGET: view ~.002 ms (the wear); the rule a step: a few lookups (no scan over props: the forest's few outcrops).
import {flags} from '../core/flags.js';
import {vnoise} from '../core/mathx.js';
import {MUD} from '../content/animals.js';
import {SURF} from '../content/prints.js';

// ORDER (core/features.js): before prints (its rule and surfaces are in place for the first steps)
export const order = {after: ['puddles'], before: ['prints']};

export async function create(host) {
  const F = {name: 'mud', label: 'Mud (the forest\'s tracks)', ambient: true, on: flags.get('tracks') !== '0'};
  let flag = flags.get('mud') === '1', hooked = null, pud = null;
  const FO = () => host.layout?.forest || null;
  const o = {};
  // 0: no print here, 1: a print, 2: a deep one by a puddle
  function takes(x, y) {
    const P = FO(); if (!P || y > -1.5) return 0;
    if (P.fellK(x, y) > .5 || P.strand?.(x, y) || P.inLake(x, y, .4)) return 0;
    P.at(x, y, o); if (o.d < o.hw + .25) return 0;
    for (const q of P.outcrops) if (Math.abs(q.x - x) < q.r + 1 && Math.hypot(q.x - x, q.y - y) < q.r + .3) return 0;
    if (P.boulders && Math.hypot(P.boulders.x - x, P.boulders.y - y) < P.boulders.r) return 0;
    if (host.world?.cave?.inBand?.(x, y)) return 0;
    const ready = (pud ??= host.feature('puddles'))?.ready?.(x, y) ?? 0;
    const soft = vnoise(x / MUD.patch, y / MUD.patch, 731) * .75 + vnoise(x / (MUD.patch * .4), y / (MUD.patch * .4), 732) * .25 + ready * .8;
    return soft < MUD.soft ? 0 : ready > MUD.deep ? 2 : 1;
  }
  const wet = () => flag || ((host.env?.wet ?? 0) >= MUD.wet && (host.env?.snowCover ?? 0) < .3);
  const at = (x, y) => { if (!F.on || !wet()) return null; const d = takes(x, y); return d === 2 ? 'mud_deep' : d ? 'mud' : null; };
  F.takes = takes; F.wet = wet; F.at = at;
  F.wetNow = on => { flag = !!on; return flag; };

  // the print system's side: the deep mud's surface (SURF.mud's own, darker) and the rule, once prints is there
  function hook() {
    const Pr = host.feature('prints'); if (!Pr?.rule) return null;
    Pr.surface('mud_deep', {...SURF.mud, col: MUD.deepCol});
    Pr.rule((x, y) => at(x, y));
    return Pr;
  }
  let lastT = NaN;
  F.view = () => {
    const E = host.env; if (!F.on || !E) return;
    hooked ??= hook(); if (!hooked) return;
    const t = E.t ?? 0, dh = lastT === lastT ? Math.max(0, Math.min(1, t - lastT)) : 0; lastT = t;
    if (!(dh > 0)) return;
    const k = (E.sky?.rain ?? 0) > MUD.wash ? dh / MUD.washH : !flag && (E.wet ?? 0) < MUD.dry ? dh / MUD.dryH : 0;
    if (k > 0) { hooked.wear('mud', k); hooked.wear('mud_deep', k); }
  };
  F.menu = () => host.feature('game')?.mode !== 'sandbox' || !F.on ? [] : [
    {label: `Tracks: the ground wet now (${flag ? 'on' : 'off'}; as ?mud=1)`, run: () => F.wetNow(!flag)},
  ];
  F.dbg = () => ({on: F.on, wet: wet(), flag, hooked: !!hooked});
  return F;
}
