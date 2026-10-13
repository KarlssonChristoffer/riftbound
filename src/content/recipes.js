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
    about: 'A spruce stump: snapped by the wind (split staves of torn wood) or rotting soft and hollow; sawn flat only where people cut wood',
    likes: {ground: 'forest', shade: .5, near: 'spruce or a fallen log (style 2, sawn: by the settlement and its woodpiles)', cluster: [1, 1]},
    // style: -1 the woods' own (snapped or rotten, by seed), 0 snapped by the wind, 1 rotten, 2 sawn by people
    params: {r: [.32, .18, .5], h: [.45, .15, 1], roots: [5, 3, 8], style: [-1, -1, 2], fungus: [.4, 0, 1]},
    build(b, p, r) {
      const style = p.style >= 0 ? p.style : r.chance(.5) ? 0 : 1, rot = style === 1;
      const h = rot ? p.h * .7 : style === 0 ? p.h * 1.2 : p.h, lx = r.range(-.03, .03), lz = r.range(-.03, .03), top = [lx, h, lz], h0 = h * r.range(.25, .4);   // (h0: where a snapped trunk's split begins)
      b.tube(rot && r.chance(.4) ? 'deadwood' : 'bark', [0, -.05, 0], rot ? [lx, h * .72, lz] : style === 0 ? [lx, h0, lz] : top, p.r * (rot ? 1.14 : 1.08), p.r * (rot ? 1.02 : 1), {sides: 9});
      if (style === 2) b.disc('sawn', [lx, h - .015, lz], p.r * .9, .03, {sides: 9});
      else if (style === 0) {   // snapped: the trunk split into a few staves down to a third of its height, splayed apart, the tallest
        // on the side away from where the tree fell (fa); bark outside, pale torn wood inside, a dark crack between them
        const fa = r.range(0, Math.PI * 2), n = r.int(4, 6);
        b.tube('rotwood', [lx, h0 - .02, lz], [lx, h0 + (h - h0) * .5, lz], p.r * .5, p.r * .4, {sides: 6, fixed: 3});   // (the crack's dark)
        for (let i = 0; i < n; i++) {
          const a = (i / n + r.range(-.04, .04)) * Math.PI * 2, back = (1 - Math.cos(a - fa)) / 2, w = 2 * p.r * Math.sin(Math.PI / n);
          const H = Math.max(h0 + .06, h * r.range(.55, .8) + back * back * p.r * r.range(.9, 1.8)), lean = r.range(3, 7) + (H - h0) * 14;
          b.at([lx + Math.cos(a) * p.r * .05, h0, lz + Math.sin(a) * p.r * .05], 90 - a / Math.PI * 180, 1, () => {
            const m = r.int(2, 3), sw = w / m;   // each stave torn again into narrow strips of their own heights: fibres, not planks
            for (let j = 0; j < m; j++) {
              const ox = (j - (m - 1) / 2) * sw, L = Math.max(.05, (H - h0) * r.range(.45, 1)), ln = lean + r.range(-3, 5);
              b.box('bark', [ox, L / 2, p.r * .86], [sw * .92, L, p.r * .22], [ln, 0, 0]);
              b.box(r.chance(.3) ? 'deadwood' : 'splinter', [ox, L / 2 - .01, p.r * .55], [sw * .85, L * r.range(.85, 1.08), p.r * .42], [ln, 0, 0], {bias: back > .6 ? 0 : -.1});
            }
          });
        }
        for (let i = r.int(2, 4); i > 0; i--) {   // chips of torn wood on the ground
          const a = fa + r.range(-1, 1), d = p.r * r.range(1.3, 2.4);
          b.box('splinter', [Math.cos(a) * d, .02, Math.sin(a) * d], [r.range(.08, .2), .03, r.range(.03, .06)], [0, r.range(0, 180), 0]);
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

  windthrow: {
    about: 'A rotvälta: a spruce the wind tipped over, its root plate torn up on edge, a wall of earth and roots and stones, a pit before it',
    likes: {ground: 'forest', shade: .4, near: 'spruce on thin soil over rock (shallow roots), boulders', cluster: [1, 1]},
    params: {R: [1.1, .7, 1.6], len: [4, 2.5, 6], r: [.24, .15, .35], roots: [16, 8, 24], stones: [3, 0, 6], old: [0, 0, 1]},
    // frame: the root plate stands at x = 0 facing -x (its torn underside, toward the pit), the trunk lies along +x
    // the bare earth it leaves (for whoever places it: paint the ground there as earth, no grass or tufts; the mesh's own flat
    // layers only sit right on flat ground): ellipses in this frame
    ground: p => [{x: -p.R * .62, z: 0, rx: p.R * 1.1, rz: p.R * 1.3}, {x: p.R * .1, z: 0, rx: p.R * .5, rz: p.R * 1.1}],
    build(b, p, r) {
      const old = p.old >= .5, R = p.R, cy = R * r.range(.15, .3), th = R * .3, tilt = r.range(-.12, .05);   // (cy: the plate's middle, low: its lower half is still in the ground it tore from)
      // the pit it tore out of: a dark hollow of bare earth on the -x side (water may stand in it)
      // the hole it tore out of, right before the plate and round its foot: no grass left, bare earth stepping down to a dark
      // middle (flat layers just over the ground: the ground can't be dug, so the dark reads as depth from above), torn sod at its
      // edge, clods thrown out, a few roots still reaching down into it
      const hx = -R * .62, ha = R * .8, hc = R * 1.05, L = [[1.3, 1.22, 0, 1], [1, 1, .012, 2], [.62, .66, .022, 3]];   // (fixed tones: unlit, and no moss settles on them)
      for (const [kx, kz, y, f] of L) {   // each layer a cluster of overlapping blobs: a ragged edge, not an oval
        const cx = hx + (1 - kx) * R * .12, n = f === 3 ? 3 : 6;
        b.ball('soil', [cx, y, 0], [ha * kx * .8, .02, hc * kz * .8], {detail: 2, lump: .12, fixed: f});
        for (let i = 0; i < n; i++) {
          const a = (i / n + r.range(-.06, .06)) * Math.PI * 2, d = r.range(.3, .5);
          b.ball('soil', [cx + Math.cos(a) * ha * kx * d, y + .001 * i, Math.sin(a) * hc * kz * d], [ha * kx * r.range(.4, .6), .02, hc * kz * r.range(.4, .6)], {detail: 1, lump: .2, fixed: f});
        }
      }
      b.ball('soil', [R * .12, .01, 0], [th * 1.6, .02, R * 1.05], {detail: 1, lump: .1, fixed: 1});   // (round the plate's foot too)
      for (let i = r.int(7, 11); i > 0; i--) {   // the rim: torn sod (a flap of the forest floor) or a clod of earth
        const a = r.range(0, Math.PI * 2), c = Math.cos(a), s = Math.sin(a), at = [hx + c * ha * r.range(1.1, 1.4), 0, s * hc * r.range(1.05, 1.3)];
        if (c > .3 && Math.abs(s) < .6) continue;   // (not under the plate)
        if (r.chance(.45)) b.at(at, 90 - a / Math.PI * 180, 1, () => b.box('cover', [0, .04, 0], [R * r.range(.18, .3), .05, R * r.range(.12, .2)], [r.range(15, 50), 0, r.range(-10, 10)]));
        else b.ball('soil', at, [R * r.range(.07, .14), R * r.range(.05, .1), R * r.range(.07, .14)], {detail: 0, lump: .3});
      }
      // the plate: a thick lumpy slab of earth, nearly on edge, torn ragged at the rim (a few lumps hang off it)
      b.at([0, cy, 0], 0, 1, () => {
        b.ball('soil', [0, 0, 0], [th, R, R * r.range(.9, 1.05)], {detail: 2, lump: .18});
        for (let i = r.int(3, 5); i > 0; i--) {
          const a = r.range(0, Math.PI * 2), d = R * r.range(.7, .9);
          b.ball('soil', [r.range(-.05, .05), Math.sin(a) * d, Math.cos(a) * d], [th * .8, R * r.range(.25, .4), R * r.range(.25, .4)], {detail: 1, lump: .25});
        }
        b.ball('cover', [th * .35, R * .72, 0], [th * 1.05, R * .36, R * .8], {detail: 1, lump: .2});   // (the forest floor still on its top)
      });
      // roots: a tangle over the torn face, curving out from the middle, thick near it, most pressed flat to the earth; a few
      // torn ends past the rim bend back toward the trunk; thin rootlets fill between them
      const skinR = old ? 'deadwood' : 'bark', face = -th * .75;
      for (let i = 0; i < p.roots; i++) {
        let a = (i / p.roots + r.range(-.05, .05)) * Math.PI * 2;
        const bend = r.range(-.5, .5), past = r.chance(.25), reach = past ? r.range(1.02, 1.2) : r.range(.55, .92), w0 = p.r * r.range(.32, .5);
        let pr = R * r.range(.08, .18), prev = [face + .03, cy + Math.sin(a) * pr, Math.cos(a) * pr], w = w0;
        for (let k = 1; k <= 3; k++) {
          a += bend / 3; const d = R * reach * k / 3, last = k === 3;
          const pt = [face - r.range(0, .06) + (last && past ? th * .5 : 0), cy + Math.sin(a) * d - (Math.sin(a) < -.3 ? r.range(0, .08) : 0), Math.cos(a) * d];
          b.tube(skinR, prev, pt, w, w * .7, {sides: k === 1 ? 5 : 4});
          prev = pt; w *= .7;
        }
      }
      for (let i = Math.round(p.roots * 1.4); i > 0; i--) {   // rootlets
        const a = r.range(0, Math.PI * 2), d0 = R * r.range(.2, .7), d1 = d0 + R * r.range(.15, .35), a1 = a + r.range(-.4, .4);
        b.tube(skinR, [face - .01, cy + Math.sin(a) * d0, Math.cos(a) * d0], [face - r.range(0, .08), cy + Math.sin(a1) * d1, Math.cos(a1) * d1], p.r * .1, p.r * .04, {sides: 3});
      }
      for (let i = r.int(3, 5); i > 0; i--) {   // roots from the plate's foot still reaching down into the hole
        const z0 = r.range(-.6, .6) * R, y0 = cy - R * r.range(.55, .8), end = [hx + r.range(-.2, .3) * ha, .03, z0 * r.range(.6, 1.1)];
        const w = p.r * r.range(.25, .4); b.tube(skinR, [face, Math.max(.06, y0), z0], end, w, w * .3, {sides: 4});
      }
      for (let i = r.int(2, 4); i > 0; i--) {   // clumps of earth still caught in the roots
        const a = r.range(0, Math.PI * 2), d = R * r.range(.3, .8);
        b.ball('soil', [face - .05, cy + Math.sin(a) * d, Math.cos(a) * d], R * r.range(.08, .14), {detail: 0, lump: .3});
      }
      for (let i = 0; i < p.stones; i++) {   // stones the roots lifted with them
        const a = r.range(0, Math.PI * 2), d = R * r.range(.2, .85);
        b.ball('rock', [face + .02, cy + Math.sin(a) * d, Math.cos(a) * d], R * r.range(.1, .2), {detail: 0, lump: .25});
      }
      // the trunk lying away from it, sinking toward its crown end, a few stubs
      const t0 = [th * .4, Math.max(cy, p.r * 1.1), 0], t1 = [p.len * .5, p.r * .95, tilt * p.len * .5], t2 = [p.len, p.r * .8, tilt * p.len];
      const skin = old ? 'deadwood' : 'bark';
      b.tube(skin, t0, t1, p.r * 1.15, p.r, {sides: 9, part: 63});
      b.tube(skin, t1, t2, p.r, p.r * .8, {sides: 9, part: 63});
      b.tube(old ? 'char' : 'splinter', [t2[0] - .01, t2[1], t2[2]], [t2[0] + .03, t2[1], t2[2]], p.r * .76, p.r * .76, {sides: 9});   // (where the crown broke off)
      for (let i = r.int(2, 5); i > 0; i--) {
        const t = r.range(.25, .95), x = t * p.len, y = t < .5 ? t0[1] + (t1[1] - t0[1]) * (t / .5) : t1[1] + (t2[1] - t1[1]) * ((t - .5) / .5), z = tilt * x, a = r.range(-1.3, 1.3);
        const L = r.range(.15, .45);
        b.cone(skin, [x, y + Math.cos(a) * p.r * .9, z + Math.sin(a) * p.r * .9], [x + r.range(.02, .12), y + Math.cos(a) * (p.r + L), z + Math.sin(a) * (p.r + L)], p.r * .2, {sides: 5});
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

  lingonberry: {
    about: 'A patch of lingonberry: ankle-high evergreen sprigs, small glossy dark leaves, clusters of bright red berries',
    likes: {ground: 'forest', shade: .25, near: 'pine on dry thin soil, rock, the esker', cluster: [1, 4]},
    params: {n: [9, 4, 16], spread: [.45, .2, .8], berries: [.7, 0, 1]},
    build(b, p, r) {
      for (let i = 0; i < p.n; i++) {
        const a = r.range(0, Math.PI * 2), d = Math.sqrt(r()) * p.spread, x = Math.cos(a) * d, z = Math.sin(a) * d * .8, h = r.range(.08, .15);
        const tip = [x + r.range(-.03, .03), h, z + r.range(-.03, .03)];
        b.tube('lingonleaf', [x, 0, z], tip, .008, .006, {sides: 3, bias: -.2});
        for (let k = 0; k < 3; k++) {   // the leaves up the sprig: small, dense, glossy (a lit top)
          const t = .35 + k * .3, q = [x + (tip[0] - x) * t + r.range(-.025, .025), h * t, z + (tip[2] - z) * t + r.range(-.025, .025)];
          b.ball('lingonleaf', q, [r.range(.035, .05), r.range(.022, .032), r.range(.035, .05)], {detail: 0, lump: .15, bias: k === 2 ? .12 : -.05});
        }
        if (r.chance(p.berries)) {   // a nodding cluster of berries at the tip
          for (let k = r.int(2, 4); k > 0; k--) b.ball('lingon', [tip[0] + r.range(-.03, .03), tip[1] - r.range(0, .03), tip[2] + .03 + r.range(-.015, .02)], r.range(.018, .024), {detail: 0, bias: .15});
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

  // ---- THE UNCANNY FOREST (features/uncanny.js, docs/UNCANNY.md). The creatures face +z (south) in their frame; their moving
  // parts are recipes of their own (origin at the joint they turn about), so the feature can turn a head or swing a leg
  // HERON: a grey heron standing at the water, everything but its head (heron_head sits on the neck's top: anchors().neck).
  // shade 1: every part in one dark family (its shadow lying on the ground, the night ring's trick)
  heron: {
    about: 'Weird: a grey heron that stands perfectly still by the water (its head is heron_head: it turns all the way round)',
    likes: {ground: 'a lake shore', shade: 0, cluster: [1, 1]},
    params: {s: [1, .7, 1.4], shade: [0, 0, 1]},
    anchors(p) { return {neck: [0, 1.1 * p.s, .17 * p.s]}; },
    build(b, p, r) {
      const s = p.s, f = n => p.shade >= .5 ? 'pupil' : n, sh = p.shade >= .5 ? {fixed: 3} : {};
      for (const x of [-.055, .055]) {   // the long legs, the feet splayed on the ground
        b.tube(f('beak'), [x * s, .64 * s, -.03 * s], [x * 1.15 * s, .02, .01 * s], .02 * s, .016 * s, {sides: 5, part: 1, ...sh});
        for (const a of [-25, 0, 25]) b.box(f('beak'), [x * 1.15 * s + Math.sin(a * Math.PI / 180) * .05 * s, .01, .01 * s + Math.cos(a * Math.PI / 180) * .05 * s], [.012 * s, .012 * s, .1 * s], [0, a, 0], {part: 1, ...sh});
      }
      b.ball(f('heron'), [0, .8 * s, -.02 * s], [.15 * s, .16 * s, .3 * s], {detail: 1, ...sh});                                 // the body
      for (const x of [-1, 1]) b.ball(f('herondark'), [x * .07 * s, .84 * s, -.06 * s], [.1 * s, .1 * s, .28 * s], {detail: 1, bias: -.05, ...sh});   // the folded wings
      b.cone(f('herondark'), [0, .8 * s, -.24 * s], [0, .74 * s, -.42 * s], .08 * s, {sides: 5, ...sh});                         // the tail's flight feathers
      b.ball(f('heronwhite'), [0, .9 * s, .16 * s], [.09 * s, .1 * s, .1 * s], {detail: 1, ...sh});                              // the breast
      b.tube(f('heronwhite'), [0, .9 * s, .18 * s], [0, 1.1 * s, .17 * s], .06 * s, .05 * s, {sides: 6, part: 2, ...sh});       // the lower neck
      for (let i = 0; i < 4; i++) b.box(f('herondark'), [0, (.95 + i * .045) * s, .225 * s], [.02 * s, .03 * s, .012 * s], [0, 0, 0], {part: 2, ...sh});   // the dark streak down its throat
      if (r.chance(.5)) b.box(f('heronwhite'), [0, .78 * s, .14 * s], [.12 * s, .05 * s, .04 * s], [20, 0, 0], {bias: .1, ...sh});   // (breast plumes)
    },
  },
  heron_head: {
    lab: false, about: "The heron's head and upper neck: origin = the neck's top (it turns about its y axis)",
    params: {s: [1, .7, 1.4], shade: [0, 0, 1]},
    build(b, p) {
      const s = p.s, f = n => p.shade >= .5 ? 'pupil' : n, sh = p.shade >= .5 ? {fixed: 3} : {};
      b.tube(f('heronwhite'), [0, -.02 * s, 0], [0, .13 * s, .03 * s], .05 * s, .045 * s, {sides: 6, part: 1, ...sh});
      b.ball(f('heronwhite'), [0, .17 * s, .05 * s], [.055 * s, .05 * s, .075 * s], {detail: 1, part: 1, ...sh});
      b.box(f('pupil'), [0, .2 * s, -.06 * s], [.014 * s, .014 * s, .2 * s], [-12, 0, 0], {...sh});                           // the black plume
      for (const x of [-1, 1]) b.box(f('pupil'), [x * .04 * s, .185 * s, .05 * s], [.012 * s, .018 * s, .09 * s], [0, 0, 0], {part: 1, ...sh});   // the black brow stripes
      for (const x of [-1, 1]) b.ball(f('beak'), [x * .047 * s, .175 * s, .085 * s], .012 * s, {detail: 0, bias: .2, ...sh}); // the eyes
      b.cone(f('beak'), [0, .165 * s, .1 * s], [0, .145 * s, .36 * s], .022 * s, {sides: 5, ...sh});                         // the bill
    },
  },
  // ELK: an elk in parts: elk_body (origin = the middle of its body), four elk_leg (origin = the hip / shoulder, 1 m long down -y:
  // scaled to the leg's length), elk_neck (origin = the top of its shoulders; neck, head, the antlers' palms)
  elk_body: {
    lab: false, about: "An elk's body: barrel, hump, rump (origin its middle; the legs hang at anchors().legs)",
    params: {s: [1, .7, 1.4]},
    anchors(p) { const s = p.s; return {legs: [[-.17 * s, -.22 * s, .5 * s], [.17 * s, -.22 * s, .5 * s], [-.17 * s, -.22 * s, -.52 * s], [.17 * s, -.22 * s, -.52 * s]], neck: [0, .22 * s, .6 * s]}; },
    build(b, p) {
      const s = p.s;
      b.ball('elk', [0, 0, 0], [.3 * s, .34 * s, .75 * s], {detail: 1, lump: .05});
      b.ball('elk', [0, .17 * s, .42 * s], [.29 * s, .32 * s, .34 * s], {detail: 1, bias: -.05});   // the hump over its shoulders
      b.ball('elk', [0, .04 * s, -.55 * s], [.27 * s, .3 * s, .3 * s], {detail: 1});
      b.ball('elkleg', [0, -.2 * s, .05 * s], [.22 * s, .12 * s, .5 * s], {detail: 0, bias: -.25});    // the paler belly
      b.cone('elk', [0, .1 * s, -.8 * s], [0, -.02 * s, -.9 * s], .06 * s, {sides: 5});                // a stub of a tail
    },
  },
  elk_leg: {
    lab: false, about: "An elk's leg, 1 m long down from its hip (origin): dark above the knee, pale below, a hoof",
    params: {s: [1, .7, 1.4]},
    build(b, p) {
      const s = p.s;
      b.tube('elk', [0, .02, 0], [0, -.48, .03], .085 * s, .055 * s, {sides: 6, part: 1});
      b.tube('elkleg', [0, -.48, .03], [0, -.97, 0], .045 * s, .036 * s, {sides: 6, part: 2});
      b.box('pupil', [0, -.98, .015], [.07 * s, .04, .1 * s], [0, 0, 0], {bias: .1});
    },
  },
  elk_neck: {
    lab: false, about: "An elk's neck, head and antlers (origin = the top of its shoulders; it faces +z)",
    params: {s: [1, .7, 1.4], antler: [1, 0, 1.5]},
    build(b, p, r) {
      const s = p.s;
      b.tube('elk', [0, -.08 * s, -.04 * s], [0, .34 * s, .3 * s], .19 * s, .12 * s, {sides: 7, part: 1});
      b.box('elk', [0, .2 * s, .1 * s], [.06 * s, .1 * s, .36 * s], [-38, 0, 0], {bias: -.2});         // the mane along its neck
      b.ball('elk', [0, .4 * s, .42 * s], [.12 * s, .14 * s, .17 * s], {detail: 1, part: 2});
      b.ball('elk', [0, .3 * s, .68 * s], [.1 * s, .12 * s, .17 * s], {detail: 1, part: 2, bias: -.08}); // the long, heavy muzzle
      b.ball('elkleg', [0, .26 * s, .82 * s], [.07 * s, .07 * s, .05 * s], {detail: 0, bias: -.3});
      b.cone('elk', [0, .22 * s, .4 * s], [0, -.04 * s, .42 * s], .05 * s, {sides: 5, bias: -.1});     // the bell under its throat
      for (const x of [-1, 1]) {
        b.cone('elk', [x * .09 * s, .5 * s, .36 * s], [x * .2 * s, .62 * s, .32 * s], .04 * s, {sides: 4});   // the ears
        b.ball('pupil', [x * .09 * s, .43 * s, .5 * s], .018 * s, {detail: 0});
        if (p.antler <= 0) continue;
        const k = p.antler;   // the antlers: a beam out of the skull, a broad palm, tines along its edge
        b.tube('antler', [x * .06 * s, .5 * s, .4 * s], [x * .26 * k * s, .6 * s, .36 * s], .03 * s, .025 * s, {sides: 5, part: 3});
        b.box('antler', [x * .38 * k * s, .66 * s, .34 * s], [.26 * k * s, .03 * s, .2 * k * s], [0, 0, x * 22], {part: 3});
        for (let i = 0; i < 4; i++) b.cone('antler', [x * (.3 + i * .05) * k * s, .69 * s + i * .012 * s, (.26 + r.range(0, .05)) * s], [x * (.33 + i * .06) * k * s, .82 * s + i * .01 * s, (.22 + r.range(-.03, .03)) * s], .018 * s, {sides: 4, part: 3});
      }
    },
  },
  // the NIGHT RING: pale mushrooms in a ring that rise where the heron stood (their caps glow: features/uncanny.js setGlow).
  // lift: each one's height over the ring's middle (m; the feature measures the ground)
  glowring: {
    about: 'Weird: a ring of pale mushrooms (a fairy ring) whose caps glow at night; where the heron stood by day',
    likes: {ground: 'a lake shore, at night', cluster: [1, 1]},
    params: {r: [1.5, .8, 2.5], n: [13, 6, 20]},
    build(b, p, r) {
      for (let i = 0; i < p.n; i++) {
        const a = (i + r.range(-.25, .25)) / p.n * Math.PI * 2, d = p.r + r.range(-.1, .1), x = Math.cos(a) * d, z = Math.sin(a) * d, y0 = p.lift?.[i] || 0;
        for (let k = r.chance(.35) ? 2 : 1; k > 0; k--) {
          const ox = k > 1 ? r.range(-.09, .09) : 0, oz = k > 1 ? r.range(-.09, .09) : 0, h = r.range(.1, .24) * (k > 1 ? .6 : 1), c = r.range(.05, .085) * (k > 1 ? .7 : 1);
          const top = [x + ox + r.range(-.03, .03), y0 + h, z + oz + r.range(-.03, .03)];
          b.tube('mushwhite', [x + ox, y0 - .02, z + oz], top, c * .28, c * .22, {sides: 5});
          b.cap('paleglow', top, c, c * r.range(.45, .7), {under: 'mushwhite', droop: .01, sides: 8});
        }
      }
    },
  },
  // the QUIET STONES: low lichen-grey stones in a ring in a glade (inside it your steps make no sound). lift as glowring's
  ringstones: {
    about: 'Weird: a ring of low grey stones in a glade; inside it your footsteps go quiet',
    likes: {ground: 'a glade in the woods', cluster: [1, 1]},
    params: {r: [2.3, 1.5, 3.5], n: [7, 5, 11]},
    build(b, p, r) {
      for (let i = 0; i < p.n; i++) {
        const a = (i + r.range(-.12, .12)) / p.n * Math.PI * 2, d = p.r + r.range(-.12, .12), x = Math.cos(a) * d, z = Math.sin(a) * d, y0 = p.lift?.[i] || 0;
        const w = r.range(.2, .3), h = r.range(.16, .3), l = r.range(.2, .32);
        b.ball('rock', [x, y0 + h * .35, z], [w, h, l], {detail: 1, lump: .3});
        if (r.chance(.7)) b.ball('lichen', [x + r.range(-.05, .05), y0 + h * 1.25, z + r.range(-.05, .05)], [w * .5, .03, l * .5], {detail: 0, lump: .3, bias: .05});
      }
    },
  },
};

// ---------------------------------------------------------------- THE FOREST'S ANIMALS (features/fauna.js, docs/FAUNA.md)
// Each animal is a few parts the feature poses every frame (a body, a head on its neck, legs, wings, a tail), so each part is
// its own recipe (lab: false) with its origin at its PIVOT; the whole animal in its rest pose is the lab's (roe, fox ...).
// The frame: the animal faces +x (east), y up, its left side +z; the body's origin is the ground under its middle (a bird's:
// the body's centre). FAUNA_RIG says where each part's pivot sits on the body (and a leg's length), for the feature.
export const FAUNA_RIG = {
  roe: {neck: [.34, .86, 0], legs: [[.26, .66, .075], [.26, .66, -.075], [-.3, .7, .075], [-.3, .7, -.075]], h: 1.05},
  fox: {neck: [.24, .4, 0], legs: [[.17, .3, .06], [.17, .3, -.06], [-.18, .31, .06], [-.18, .31, -.06]], h: .55},
  hare: {neck: [.12, .27, 0], h: .55},
  squirrel: {tail: [-.13, .16, 0], h: .45},
  raven: {wing: [.02, .03, .06], stand: .14, h: .3},
  capercaillie: {wing: [.04, .05, .1], stand: .2, h: .45},
};
const leg = (b, fam, len, r0, r1, hoof) => {   // a leg hanging from its pivot (0, 0, 0) to the ground (0, -len, 0): thigh, shank, foot
  b.tube(fam, [0, .02, 0], [-.012, -len * .5, 0], r0, (r0 + r1) / 2, {sides: 6, part: 1});
  b.tube(fam, [-.012, -len * .5, 0], [0, -len + .02, 0], (r0 + r1) / 2 * .9, r1, {sides: 6, part: 1});
  if (hoof) b.box(hoof, [.01, -len + .02, 0], [r1 * 2.4, .04, r1 * 2], [0, 0, 0]);
};
const PARTS = {
  roe_body(b, p) {
    b.ball('roe', [0, .74, 0], [.42, .2, .15], {detail: 2, part: 1});
    b.ball('roe', [.26, .76, 0], [.2, .22, .15], {detail: 1, part: 1});   // (the chest, deeper than the belly)
    b.ball('roe', [-.28, .78, 0], [.18, .19, .15], {detail: 1, part: 1});   // (the haunch)
    b.ball(p.winter ? 'harefur' : 'roe', [0, .62, 0], [.3, .08, .12], {detail: 1, bias: .15});   // (a paler belly)
    b.ball('mushwhite', [-.44, .78, 0], [.05, .13, .12], {detail: 1});   // the white rump patch: what you see bounding away
  },
  roe_head(b, p) {
    b.tube('roe', [-.02, -.02, 0], [.15, .38, 0], .085, .055, {sides: 7, part: 1});   // the neck
    b.ball('roe', [.2, .42, 0], [.11, .075, .07], {detail: 1, part: 1});
    b.ball('roe', [.31, .39, 0], [.07, .05, .045], {detail: 1, part: 1});   // the muzzle
    b.ball('furdark', [.37, .385, 0], .026, {detail: 0});
    b.ball('mushwhite', [.33, .36, 0], [.035, .02, .04], {detail: 0});   // (the pale chin)
    for (const z of [.055, -.055]) {
      b.ball('pupil', [.24, .44, z], .016, {detail: 0});
      b.cone('roe', [.16, .46, z * .9], [.1, .58, z * 1.6], .04, {sides: 5});   // the big ears
    }
    if (p.buck) for (const z of [.032, -.032]) {   // short antlers, a tine forward
      b.tube('sawn', [.17, .48, z], [.15, .64, z * 1.4], .014, .01, {sides: 5});
      b.tube('sawn', [.155, .57, z * 1.3], [.2, .62, z * 1.3], .009, .007, {sides: 4});
    }
  },
  roe_leg(b, p) { leg(b, 'roe', p.len, .045, .02, 'furdark'); },
  fox_body(b) {
    b.ball('russet', [0, .33, 0], [.27, .115, .1], {detail: 2, part: 1});
    b.ball('russet', [.17, .34, 0], [.12, .12, .1], {detail: 1, part: 1});
    b.ball('mushwhite', [.22, .3, 0], [.08, .09, .08], {detail: 1});   // the white chest
    b.tube('russet', [-.22, .36, 0], [-.48, .29, 0], .05, .085, {sides: 7, part: 2});   // the brush, thick at its end
    b.tube('russet', [-.48, .29, 0], [-.62, .22, 0], .085, .07, {sides: 7, part: 2});
    b.ball('mushwhite', [-.66, .2, 0], [.06, .055, .06], {detail: 1});   // its white tip
  },
  fox_head(b) {
    b.tube('russet', [-.03, -.03, 0], [.07, .08, 0], .065, .055, {sides: 7, part: 1});
    b.ball('russet', [.11, .1, 0], [.085, .07, .075], {detail: 1, part: 1});
    b.cone('russet', [.15, .085, 0], [.29, .065, 0], .04, {sides: 6, part: 1});   // the snout
    b.ball('furdark', [.29, .066, 0], .018, {detail: 0});
    b.ball('mushwhite', [.14, .06, 0], [.07, .035, .07], {detail: 1});   // white cheeks and chin
    for (const z of [.045, -.045]) {
      b.ball('pupil', [.18, .11, z * .9], .012, {detail: 0});
      b.cone('russet', [.09, .15, z], [.07, .25, z * 1.3], .034, {sides: 4});
      b.cone('furdark', [.075, .22, z * 1.25], [.07, .26, z * 1.32], .016, {sides: 4});
    }
  },
  fox_leg(b, p) { leg(b, 'furdark', p.len, .028, .018, null); },
  hare_body(b, p) {
    const fur = p.winter ? 'mushwhite' : 'harefur';
    b.ball(fur, [-.03, .18, 0], [.2, .14, .12], {detail: 2, part: 1});
    for (const z of [.075, -.075]) {
      b.ball(fur, [-.1, .13, z], [.13, .11, .05], {detail: 1, part: 1});   // the haunches
      b.box(fur, [-.04, .02, z * 1.05], [.18, .035, .05], [0, 0, 0], {part: 1});   // the long hind feet
      b.tube(fur, [.12, .16, z * .55], [.14, .01, z * .55], .024, .02, {sides: 5, part: 1});   // the front legs
    }
    b.ball('mushwhite', [-.22, .2, 0], .045, {detail: 0});   // the scut
  },
  hare_head(b, p) {
    const fur = p.winter ? 'mushwhite' : 'harefur';
    b.ball(fur, [.05, .04, 0], [.085, .07, .065], {detail: 1, part: 1});
    b.ball(fur, [.12, .02, 0], [.045, .04, .04], {detail: 0, part: 1});
    for (const z of [.028, -.028]) {
      b.ball('pupil', [.09, .06, z * 2], .014, {detail: 0});
      b.tube(fur, [.03, .09, z], [-.04, .26, z * 1.5], .024, .02, {sides: 5});   // the long ears
      b.cone('furdark', [-.035, .245, z * 1.5], [-.045, .28, z * 1.55], .02, {sides: 4});   // their black tips (summer and winter)
    }
  },
  squirrel_body(b) {
    b.at([0, 0, 0], 0, 1.5, () => {   // (drawn 1.5x: at life size it would be two pixels)
      b.ball('russet', [0, .08, 0], [.09, .06, .05], {detail: 1, part: 1});
      b.ball('mushwhite', [.03, .065, 0], [.06, .035, .04], {detail: 0});   // the white belly
      b.ball('russet', [.09, .1, 0], [.045, .042, .04], {detail: 1, part: 1});
      b.ball('pupil', [.115, .11, .03], .01, {detail: 0}); b.ball('pupil', [.115, .11, -.03], .01, {detail: 0});
      for (const z of [.02, -.02]) b.cone('russet', [.08, .135, z], [.075, .175, z * 1.3], .014, {sides: 4});   // the ear tufts
      for (const z of [.035, -.035]) b.box('russet', [-.01, .02, z], [.09, .03, .02], [0, 0, 0]);   // the haunches and feet
      b.box('russet', [.06, .02, 0], [.025, .03, .05], [0, 0, 0]);
    });
  },
  squirrel_tail(b) {   // a big bushy curl from its pivot (the rump) up over the back
    b.at([0, 0, 0], 0, 1.5, () => {
      const pts = [[0, 0], [-.04, .05], [-.05, .11], [-.03, .16], [.01, .18]];
      for (let i = 1; i < pts.length; i++) b.tube('russet', [pts[i - 1][0], pts[i - 1][1], 0], [pts[i][0], pts[i][1], 0], .02 + i * .006, .024 + i * .006, {sides: 6, part: 1});
      b.ball('russet', [.015, .18, 0], .034, {detail: 0, part: 1});
    });
  },
  raven_body(b) {
    b.ball('plumage', [0, 0, 0], [.19, .075, .075], {detail: 1, part: 1});
    b.ball('plumage', [.19, .045, 0], .058, {detail: 1, part: 1});
    b.cone('furdark', [.22, .04, 0], [.33, .025, 0], .026, {sides: 5});   // the heavy bill
    b.box('plumage', [-.25, -.005, 0], [.18, .018, .1], [0, 0, 4]);         // the wedge tail
    b.ball('pupil', [.22, .06, .04], .01, {detail: 0}); b.ball('pupil', [.22, .06, -.04], .01, {detail: 0});
    for (const z of [.03, -.03]) b.tube('furdark', [.02, -.05, z], [.03, -.14, z], .012, .01, {sides: 4});
  },
  raven_wing(b, p) {   // from its shoulder (0, 0, 0) out along +z: the arm, the hand, the fingered tip (brown: a capercaillie hen's)
    const s = p.span, f = p.brown ? 'roe' : 'plumage';
    b.box(f, [-.03, 0, s * .22], [.17, .02, s * .45], [0, 0, 0], {part: 1});
    b.box(f, [-.07, 0, s * .66], [.14, .016, s * .45], [0, 8, 0], {part: 1});
    for (let i = 0; i < 4; i++) b.box(f, [-.12 + i * .03, 0, s * .93], [.025, .012, s * .14], [0, 10 - i * 6, 0], {part: 1});
  },
  capercaillie_body(b, p) {
    const hen = p.hen, fam = hen ? 'roe' : 'plumage', s = hen ? .8 : 1;
    b.at([0, 0, 0], 0, s, () => {
      b.ball(fam, [0, 0, 0], [.26, .13, .12], {detail: 1, part: 1});
      b.ball(hen ? 'russet' : 'lingonleaf', [.15, -.01, 0], [.12, .1, .1], {detail: 1});   // the breast: a cock's green sheen, a hen's rust
      b.ball(fam, [.27, .14, 0], .075, {detail: 1, part: 1});
      b.tube(fam, [.17, .05, 0], [.26, .12, 0], .07, .06, {sides: 6, part: 1});
      b.cone('mushwhite', [.31, .13, 0], [.39, .1, 0], .032, {sides: 5});   // the pale hooked bill
      if (!hen) { b.ball('furdark', [.3, .07, 0], [.04, .05, .035], {detail: 0}); for (const z of [.05, -.05]) b.box('agaric', [.29, .17, z], [.05, .02, .012], [0, 0, 0]); }   // the beard, the red brows
      b.ball('pupil', [.3, .15, .055], .011, {detail: 0}); b.ball('pupil', [.3, .15, -.055], .011, {detail: 0});
      if (hen) b.box(fam, [-.33, .01, 0], [.24, .03, .16], [0, 0, 6]);   // the tail, folded
      else {   // a cock's tail half fanned and cocked up (the lek's display: his silhouette), white spots at the feathers' ends, a white shoulder
        for (let i = 0; i < 7; i++) {   // the feathers fan out from the rump in an upright half circle behind him
          const a = (i / 6 - .5) * 1.9, L = .3, e = [-.24 - L * .35, .05 + Math.cos(a) * L, Math.sin(a) * L];
          b.tube(fam, [-.22, .04, 0], e, .022, .04, {sides: 4, part: 3});
          b.ball('mushwhite', e, .02, {detail: 0});
        }
        b.ball('mushwhite', [-.2, -.06, 0], [.06, .03, .06], {detail: 0});   // white under the tail
        for (const z of [.11, -.11]) b.ball('mushwhite', [.1, .06, z], .025, {detail: 0});
      }
      for (const z of [.045, -.045]) b.tube('furdark', [.02, -.1, z], [.03, -.2, z], .018, .014, {sides: 4});
    });
  },
};
Object.assign(RECIPES, {
  roe_body: {lab: false, about: 'A roe deer: its body', params: {winter: [0, 0, 1]}, build: (b, p) => PARTS.roe_body(b, p)},
  roe_head: {lab: false, about: 'A roe deer: its neck and head (antlers on a buck)', params: {buck: [0, 0, 1]}, build: (b, p) => PARTS.roe_head(b, p)},
  roe_leg: {lab: false, about: 'A roe deer: a leg', params: {len: [.68, .3, 1]}, build: (b, p) => PARTS.roe_leg(b, p)},
  fox_body: {lab: false, about: 'A fox: body and brush', params: {}, build: b => PARTS.fox_body(b)},
  fox_head: {lab: false, about: 'A fox: its head', params: {}, build: b => PARTS.fox_head(b)},
  fox_leg: {lab: false, about: 'A fox: a leg', params: {len: [.3, .2, .5]}, build: (b, p) => PARTS.fox_leg(b, p)},
  hare_body: {lab: false, about: 'A mountain hare: its body', params: {winter: [0, 0, 1]}, build: (b, p) => PARTS.hare_body(b, p)},
  hare_head: {lab: false, about: 'A mountain hare: its head and ears', params: {winter: [0, 0, 1]}, build: (b, p) => PARTS.hare_head(b, p)},
  squirrel_body: {lab: false, about: 'A red squirrel', params: {}, build: b => PARTS.squirrel_body(b)},
  squirrel_tail: {lab: false, about: "A red squirrel's tail", params: {}, build: b => PARTS.squirrel_tail(b)},
  raven_body: {lab: false, about: 'A raven: body, head, bill, tail', params: {}, build: b => PARTS.raven_body(b)},
  raven_wing: {lab: false, about: 'A raven or capercaillie wing', params: {span: [.5, .3, .8], brown: [0, 0, 1]}, build: (b, p) => PARTS.raven_wing(b, p)},
  capercaillie_body: {lab: false, about: 'A capercaillie: a cock (black, a green breast, red brows) or a hen (brown)', params: {hen: [0, 0, 1]}, build: (b, p) => PARTS.capercaillie_body(b, p)},
  // the whole animals in their rest pose, for the asset lab (?mode=sandbox&lab=roe)
  roe: {about: 'A roe deer (rådjur), a buck or a doe', likes: {ground: 'forest edge, glades', shade: .3, cluster: [2, 3]}, params: {buck: [1, 0, 1], winter: [0, 0, 1]},
    build(b, p) { const R = FAUNA_RIG.roe; PARTS.roe_body(b, p); b.at(R.neck, 0, 1, () => PARTS.roe_head(b, p)); for (const l of R.legs) b.at(l, 0, 1, () => PARTS.roe_leg(b, {len: l[1]})); }},
  fox: {about: 'A red fox (räv)', likes: {ground: 'forest, a den under rock', shade: .5, cluster: [1, 1]}, params: {},
    build(b) { const R = FAUNA_RIG.fox; PARTS.fox_body(b); b.at(R.neck, 0, 1, () => PARTS.fox_head(b)); for (const l of R.legs) b.at(l, 0, 1, () => PARTS.fox_leg(b, {len: l[1]})); }},
  hare: {about: 'A mountain hare (skogshare), white in winter', likes: {ground: 'open ground with some cover, the fell', shade: .1, cluster: [1, 1]}, params: {winter: [0, 0, 1]},
    build(b, p) { PARTS.hare_body(b, p); b.at(FAUNA_RIG.hare.neck, 0, 1, () => PARTS.hare_head(b, p)); }},
  squirrel: {about: 'A red squirrel (ekorre)', likes: {ground: 'pine woods, on the trunks', shade: .6, cluster: [1, 1]}, params: {},
    build(b) { PARTS.squirrel_body(b); b.at(FAUNA_RIG.squirrel.tail, 0, 1, () => PARTS.squirrel_tail(b)); }},
  raven: {about: 'A raven (korp)', likes: {ground: 'high rock, the fell', shade: 0, cluster: [2, 2]}, params: {},
    build(b) { const R = FAUNA_RIG.raven; b.at([0, R.stand, 0], 0, 1, () => { PARTS.raven_body(b); for (const s of [1, -1]) b.at([R.wing[0], R.wing[1], R.wing[2] * s], s > 0 ? 0 : 180, 1, () => b.at([0, 0, 0], 0, 1, () => PARTS.raven_wing(b, {span: .14}))); }); }},
  capercaillie: {about: 'A capercaillie (tjäder): a cock or a hen', likes: {ground: 'old pine woods, the floor', shade: .6, cluster: [1, 1]}, params: {hen: [0, 0, 1]},
    build(b, p) { b.at([0, FAUNA_RIG.capercaillie.stand * (p.hen ? .8 : 1), 0], 0, 1, () => PARTS.capercaillie_body(b, p)); }},
});
