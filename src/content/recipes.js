// RECIPES (data + small builders): the world's smaller things, each written as a few plain shapes (world/recipe3d.js grows the
// geometry; the asset lab, dev/assetlab.js, shows them: ?mode=sandbox&lab=1). A recipe:
//   about    one line: what it is
//   likes    where it grows (a hint for whoever places it: the forest's growth): ground, shade 0..1, near, cluster [min, max]
//   params   {key: [default, min, max]}: the knobs the lab's sliders turn (whole numbers stay whole when all three are)
//   build(b, p, r, ctx)   draws it with the builder b (world/recipe3d.js: tube, cone, ball, cap, box, disc, at, onDome), the params
//            p and the seeded random r (r(), r.range, r.int, r.pick, r.sign, r.chance); ctx = {biome, seed}. Frame: x east, y up,
//            z south (toward the camera), metres, origin = its ground point. Sizes are the game's, not nature's: a real
//            chanterelle would be two pixels, so the forest floor is drawn about twice life size.
// Families: the world's (wood, bark, leaf, rock, deadwood ...: world.js FAMS) or a paint (content/paints.js). Moss and snow
// settle on what faces up by themselves (the biome's cover).
// Pure functions, no imports, no Math.random: the same seed grows the same thing on every machine.
export const RECIPES = {
  stump: {
    about: 'A spruce stump: snapped by the wind or rotting soft and hollow; sawn flat only where people cut wood',
    likes: {ground: 'forest', shade: .5, near: 'spruce or a fallen log (style 2, sawn: by the settlement and its woodpiles)', cluster: [1, 1]},
    // style: -1 the woods' own (snapped or rotten, by seed), 0 snapped by the wind, 1 rotten, 2 sawn by people
    params: {r: [.32, .18, .5], h: [.45, .15, 1], roots: [5, 3, 8], style: [-1, -1, 2], fungus: [.4, 0, 1]},
    build(b, p, r) {
      const style = p.style >= 0 ? p.style : r.chance(.5) ? 0 : 1, rot = style === 1;
      const h = rot ? p.h * .7 : style === 0 ? p.h * 1.2 : p.h, lx = r.range(-.03, .03), lz = r.range(-.03, .03), top = [lx, h, lz];
      b.tube(rot && r.chance(.4) ? 'deadwood' : 'bark', [0, -.05, 0], rot ? [lx, h * .72, lz] : top, p.r * (rot ? 1.14 : 1.08), p.r * (rot ? 1.02 : 1), {sides: 9});
      if (style === 2) b.disc('sawn', [lx, h - .015, lz], p.r * .9, .03, {sides: 9});
      else if (style === 0) {   // snapped: the break slants, tall splinters on the side away from where the tree fell, pale wood inside
        const fa = r.range(0, Math.PI * 2), n = r.int(12, 16);
        b.disc('rotwood', [lx, h - .035, lz], p.r * .9, .04, {sides: 9});
        for (let i = 0; i < n; i++) {
          const a = (i / n + r.range(-.03, .03)) * Math.PI * 2, back = (1 - Math.cos(a - fa)) / 2, rr = p.r * r.range(.55, .92);
          const x = lx + Math.cos(a) * rr, z = lz + Math.sin(a) * rr, tall = p.r * (.2 + back * back * r.range(1.4, 2.6));
          b.cone(rr > p.r * .8 && r.chance(.5) ? 'bark' : r.chance(.5) ? 'deadwood' : 'rotwood', [x, h - .03, z],
            [x + Math.cos(a) * r.range(-.02, .05), h + tall, z + Math.sin(a) * r.range(-.02, .05)], p.r * r.range(.13, .22), {sides: 4});
        }
        if (r.chance(.6)) {   // a long sliver still hanging on: the hinge where the trunk tore away
          const a = fa + Math.PI + r.range(-.4, .4), x = lx + Math.cos(a) * p.r * .8, z = lz + Math.sin(a) * p.r * .8;
          b.at([x, 0, z], 90 - a / Math.PI * 180, 1, () => b.box('deadwood', [0, h + p.r * 1.1, 0], [p.r * .22, p.r * 2.4, p.r * .1], [-10, 0, 0]));
        }
      } else {   // rotten: soft and sunk, a dark hollow inside a ragged rim of bark plates, moss and crumbs
        b.disc('rotwood', [lx, h * .72 - .03, lz], p.r * .96, .04, {sides: 9, fixed: 2});   // (fixed: unlit and never mossed, a hole stays dark)
        b.disc('rotwood', [lx + r.range(-.03, .03), h * .72 - .024, lz + r.range(-.03, .03)], p.r * .5, .04, {sides: 7, fixed: 3});
        const n = r.int(7, 10);
        for (let i = 0; i < n; i++) {
          if (r.chance(.2)) continue;   // a gap where a plate fell off
          const a = (i / n + r.range(-.04, .04)) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), ph = p.r * r.range(.4, 1.1), lean = r.range(4, 22);
          b.at([lx + c * p.r * .98, 0, lz + s * p.r * .98], 90 - a / Math.PI * 180, 1, () =>
            b.box(r.chance(.25) ? 'deadwood' : 'bark', [0, h * .72 + ph * .3, 0], [p.r * r.range(.5, .75), ph, p.r * .14], [lean, 0, 0]));
        }
        for (let i = r.int(2, 4); i > 0; i--) {   // plates that fell, leaning on the foot
          const a = r.range(0, Math.PI * 2), c = Math.cos(a), s = Math.sin(a), d = p.r * r.range(1.15, 1.4);
          b.at([c * d, 0, s * d], 90 - a / Math.PI * 180, 1, () => b.box('bark', [0, .04, 0], [p.r * .5, p.r * .7, .03], [70, 0, 0]));
        }
        for (let i = r.int(4, 8); i > 0; i--) {   // crumbs of rotten wood in the hollow and spilled at the foot
          const a = r.range(0, Math.PI * 2), d = i % 2 ? p.r * r.range(0, .6) : p.r * r.range(1.1, 1.6), y = i % 2 ? h * .7 : 0;
          b.ball('rotwood', [lx * (i % 2) + Math.cos(a) * d, y, lz * (i % 2) + Math.sin(a) * d], p.r * r.range(.1, .2), {detail: 0, lump: .3});
        }
        for (let i = r.int(2, 5); i > 0; i--) {   // moss clumps on the rim and down one side
          const a = r.range(0, Math.PI * 2), y = h * r.range(.35, .8);
          b.ball('cover', [lx + Math.cos(a) * p.r * 1.02, y, lz + Math.sin(a) * p.r * 1.02], [p.r * .32, p.r * .2, p.r * .32], {detail: 0, lump: .25});
        }
      }
      for (let i = 0; i < p.roots; i++) {   // roots flare out and dive in (rotten ones lower, half sunk)
        // (short and thick, bending down fast: long straight roots read as spikes)
        const a = (i / p.roots + r.range(-.07, .07)) * Math.PI * 2, L = p.r * r.range(.45, 1.05), c = Math.cos(a), s = Math.sin(a), k = rot ? .75 : 1;
        const mid = [c * (p.r + L * .35), .03 * k, s * (p.r + L * .35)], w = r.range(.85, 1.15);
        b.tube(rot && r.chance(.3) ? 'deadwood' : 'bark', [c * p.r * .6, h * r.range(.25, .4) * k, s * p.r * .6], mid, p.r * .42 * k * w, p.r * .28 * k * w, {sides: 5});
        b.tube('bark', mid, [c * (p.r + L * .75), -.1, s * (p.r + L * .75)], p.r * .28 * k * w, p.r * .12, {sides: 5});
      }
      if (r.chance(rot ? Math.min(1, p.fungus * 1.8) : p.fungus)) {   // shelf fungus stacked up one side
        const a = r.range(0, Math.PI * 2), n = r.int(2, 4);
        for (let i = 0; i < n; i++) {
          const y = h * r.range(.25, .85), aa = a + r.range(-.5, .5), rr = p.r * 1.04;
          b.cap('bracket', [lx + Math.cos(aa) * rr, y, lz + Math.sin(aa) * rr], r.range(.07, .12), r.range(.025, .04), {under: 'mushwhite'});
        }
      }
    },
  },

  log: {
    about: 'A fallen tree: fresh bark and sawn ends, or old, grey and broken, sinking into the moss',
    likes: {ground: 'forest', shade: .4, cluster: [1, 1]},
    params: {len: [2.4, 1.2, 4], r: [.22, .12, .36], stubs: [4, 0, 8], old: [0, 0, 1]},
    build(b, p, r) {
      const old = p.old >= .5, skin = old ? 'deadwood' : 'bark', y0 = p.r * .8, x0 = -p.len / 2, x1 = p.len / 2, sag = r.range(-.04, .02);
      b.tube(skin, [x0, y0, 0], [0, y0 + sag, r.range(-.05, .05)], p.r, p.r * .93, {sides: 9, part: 1});
      b.tube(skin, [0, y0 + sag, 0], [x1, y0 - .02, r.range(-.08, .08)], p.r * .93, p.r * .82, {sides: 9, part: 1});
      if (!old) { b.tube('sawn', [x0 - .012, y0, 0], [x0 + .012, y0, 0], p.r * .9, p.r * .9, {sides: 9}); }
      else for (let i = 0; i < 6; i++) {   // the broken end: splinters
        const a = i / 6 * Math.PI * 2, y = y0 + Math.sin(a) * p.r * .6, z = Math.cos(a) * p.r * .6;
        b.cone('deadwood', [x0 + .02, y, z], [x0 - r.range(.06, .22), y + r.range(-.03, .03), z], p.r * .2, {sides: 4});
      }
      b.tube(old ? 'char' : 'sawn', [x1 - .012, y0 - .02, 0], [x1 + .012, y0 - .02, 0], p.r * .78, p.r * .78, {sides: 9});
      for (let i = 0; i < p.stubs; i++) {   // the stubs of broken branches, mostly on top and the sides
        const t = r.range(-.4, .45), a = r.range(-1.4, 1.4) + (r.chance(.5) ? 0 : Math.PI * .5 * r.sign()), x = t * p.len;
        const rr = p.r * (1 - (t + .5) * .18), y = y0 + Math.cos(a) * rr, z = Math.sin(a) * rr, L = r.range(.12, .4);
        b.cone(skin, [x, y, z], [x + r.range(-.08, .08), y + Math.cos(a) * L, z + Math.sin(a) * L], p.r * r.range(.16, .26), {sides: 5});
      }
    },
  },

  fly_agaric: {
    about: 'Fly agaric: red caps with white warts on white stems, a young closed one beside the open ones',
    likes: {ground: 'forest', shade: .6, near: 'birch', cluster: [1, 4]},
    params: {n: [3, 1, 5], size: [1.6, .8, 2.4]},
    build(b, p, r) {
      for (let i = 0; i < p.n; i++) {
        const s = p.size * r.range(.75, 1.15), young = i > 0 && r.chance(.35), x = i ? r.range(-.28, .28) : 0, z = i ? r.range(-.22, .22) : 0;
        const h = (young ? .14 : r.range(.24, .36)) * s, lean = [x + r.range(-.03, .03), h, z + r.range(-.03, .03)];
        b.ball('mushwhite', [x, .02 * s, z], .045 * s, {detail: 0});
        b.tube('mushwhite', [x, 0, z], lean, .032 * s, .026 * s, {sides: 6});
        if (!young) b.disc('mushwhite', [x + (lean[0] - x) * .7, h * .7, z + (lean[2] - z) * .7], .04 * s, .012 * s, {sides: 7, bias: -.1});
        const cr = (young ? .075 : r.range(.13, .17)) * s, ch = (young ? .07 : cr * r.range(.32, .42));
        if (young) b.ball('agaric', [lean[0], h + ch * .3, lean[2]], [cr, ch, cr], {detail: 1});
        else b.cap('agaric', lean, cr, ch, {under: 'mushwhite', droop: .012 * s});
        const warts = young ? 4 : r.int(9, 14);
        for (let k = 0; k < warts; k++) {
          const q = b.onDome(young ? [lean[0], h + ch * .3, lean[2]] : lean, cr * 1.0, ch * (young ? 1.0 : 1.04), r(), r.range(.3, .95));
          b.ball('mushwhite', q, r.range(.018, .026) * s, {detail: 0, bias: .15});
        }
      }
    },
  },

  chanterelles: {
    about: 'A ring of chanterelles: small golden funnels in the moss',
    likes: {ground: 'moss', shade: .7, near: 'spruce', cluster: [4, 10]},
    params: {n: [7, 3, 12], size: [1.8, 1, 2.6]},
    build(b, p, r) {
      for (let i = 0; i < p.n; i++) {
        const s = p.size * r.range(.7, 1.15), a = r.range(0, Math.PI * 2), d = r.range(.03, .26), x = Math.cos(a) * d, z = Math.sin(a) * d * .8;
        const h = r.range(.04, .07) * s, top = [x + r.range(-.01, .01), h, z];
        b.tube('chanterelle', [x, 0, z], top, .016 * s, .028 * s, {sides: 5, bias: -.1});
        b.cap('chanterelle', top, r.range(.04, .065) * s, .022 * s, {funnel: .85, droop: .008 * s, under: 'chanterelle', sides: 8});
      }
    },
  },

  anthill: {
    about: 'A wood-ant hill: a heaped dome of spruce needles and twigs, as tall as your knee',
    likes: {ground: 'forest', shade: .3, near: 'spruce', cluster: [1, 1]},
    params: {r: [.45, .3, .9], h: [.5, .3, .9], twigs: [14, 0, 30]},
    build(b, p, r) {
      b.ball('needles', [0, 0, 0], [p.r, p.h * .55, p.r], {detail: 2, lump: .08, part: 1});   // the wide foot
      b.ball('needles', [0, p.h * .25, 0], [p.r * .62, p.h * .75, p.r * .62], {detail: 2, lump: .1, part: 1, bias: .05});   // the heap
      const n = r.int(8, 14);
      for (let i = 0; i < n; i++) {   // little heaps on the dome
        const q = b.onDome([0, 0, 0], p.r * .7, p.h * .95, r(), r.range(.15, .8));
        b.ball('needles', q, r.range(.05, .09), {detail: 0, bias: r.range(-.25, .2), part: 2 + i});
      }
      for (let i = 0; i < p.twigs; i++) {   // twigs lying on it
        const u = r(), v = r.range(.1, .8), q = b.onDome([0, 0, 0], p.r * (1 - v * .4), p.h * 1.0, u, v), a = r.range(0, Math.PI * 2), L = r.range(.08, .18);
        b.tube('deadwood', [q[0] - Math.cos(a) * L, q[1] + r.range(-.02, .02), q[2] - Math.sin(a) * L], [q[0] + Math.cos(a) * L, q[1], q[2] + Math.sin(a) * L], .016, .012, {sides: 4, bias: .1});
      }
    },
  },

  blueberry: {
    about: 'A patch of blueberry shrubs: knee-high green twigs, small leaves, dark blue berries in late summer',
    likes: {ground: 'forest', shade: .5, near: 'pine', cluster: [1, 3]},
    params: {n: [7, 3, 14], spread: [.5, .25, .9], berries: [.6, 0, 1]},
    build(b, p, r) {
      for (let i = 0; i < p.n; i++) {
        const a = r.range(0, Math.PI * 2), d = Math.sqrt(r()) * p.spread, x = Math.cos(a) * d, z = Math.sin(a) * d * .8, h = r.range(.18, .32);
        const twigs = r.int(2, 4);
        for (let k = 0; k < twigs; k++) {
          const tip = [x + r.range(-.08, .08), h * r.range(.75, 1), z + r.range(-.06, .06)];
          b.tube('leaf', [x, 0, z], tip, .012, .008, {sides: 3, bias: -.25});
          b.ball('leaf', tip, [r.range(.05, .075), r.range(.035, .05), r.range(.05, .075)], {detail: 0, lump: .2, bias: r.range(-.05, .1)});
          const mid = [x + (tip[0] - x) * .55 + r.range(-.04, .04), tip[1] * .55, z + (tip[2] - z) * .55];
          b.ball('leaf', mid, [.045, .03, .045], {detail: 0, lump: .2, bias: -.1});
          if (r.chance(p.berries)) b.ball('blueberry', [tip[0] + r.range(-.03, .03), tip[1] + .01, tip[2] + .045], .03, {detail: 0, bias: .1});
          if (r.chance(p.berries * .7)) b.ball('blueberry', [mid[0] + .03, mid[1] + .01, mid[2] + .04], .026, {detail: 0, bias: .1});
        }
      }
    },
  },

  watcher: {
    about: 'Weird: a pale toadstool with one eye under its cap, the kind that is always looking your way',
    likes: {ground: 'forest', shade: .8, cluster: [1, 1]},
    // eye 0: the body alone (features/watcher.js draws the eye and the pupil apart, to roll them: watcher_eye, watcher_pupil)
    params: {h: [.7, .4, 1.3], eye: [1, 0, 1.5], bend: [.12, 0, .3]},
    // where the parts sit (the frame above): the cap's rim centre, its size, the eye's centre and radius, the way it looks out
    anchors(p) {
      const top = [p.bend, p.h, 0], cr = .27, ch = .12, n = [0, .62, .78], e = .11 * (p.eye || 1);
      return {top, cr, ch, n, e, eye: [top[0] + n[0] * (cr * .45), top[1] + ch * .6, top[2] + n[2] * (cr * .45)]};
    },
    build(b, p, r) {
      const {top, cr, ch, n, e, eye: ey} = this.anchors(p), mid = [p.bend * .4, p.h * .5, 0];
      b.ball('mushwhite', [0, .03, 0], .07, {detail: 0, lump: .15});
      b.tube('mushwhite', [0, 0, 0], mid, .055, .045, {sides: 7, part: 1});
      b.tube('mushwhite', mid, top, .045, .04, {sides: 7, part: 1});
      b.cap('shroom', top, cr, ch, {under: 'mushwhite', droop: .04});
      for (let k = 0; k < 5; k++) b.ball('mushwhite', b.onDome(top, cr * 1.01, ch * 1.03, r.range(.55, 1.2), r.range(.3, .8)), .022, {detail: 0, bias: -.1});   // (round the back: the eye has the front)
      if (!p.eye) return;
      // the eye stares out of the cap's front, up at you (the camera looks down from the south)
      b.ball('eye', ey, e, {detail: 1});
      b.ball('pupil', [ey[0], ey[1] + n[1] * e * .72, ey[2] + n[2] * e * .72], e * .48, {detail: 1});
    },
  },
  // the watcher's eye and pupil on their own (origin = the eye's centre; the pupil looks down +z), for features/watcher.js
  watcher_eye: {lab: false, about: "The watcher's eyeball", params: {eye: [1, .6, 1.5]}, build(b, p) { b.ball('eye', [0, 0, 0], .11 * p.eye, {detail: 1}); }},
  watcher_pupil: {lab: false, about: "The watcher's pupil", params: {eye: [1, .6, 1.5]}, build(b, p) { const e = .11 * p.eye; b.ball('pupil', [0, 0, e * .72], [e * .48, e * .48, e * .3], {detail: 1}); }},
};
