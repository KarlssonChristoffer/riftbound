// AUTUMN (the model of how a 3D crown turns): one set of numbers for the renderer (render/gfx.js MESH_FS and the shadow's
// SHADOW_SWAY_FS) and for the falling leaves (features/wind.js), so a leaf that lets go is the colour of the spray it left.
//
// A tree does not turn as one colour (the user's photos): it turns in patches the size of a spray, the sun side and the top
// first and furthest, the shaded inside and the lower crown last. Every leaf CLUMP (a spray) has
//   k  how early it turns, 0..1: where it hangs (world frame: toward the noon sun, south and up, so the reddest side faces
//      the default camera whichever way the tree is turned), its own random (baked into the geometry: aSpray.w, shifted per
//      tree by where the tree stands), and a per-tree offset (some trees are early)
//   m  = lo + (hi - lo) k, how fast it turns
// and the season gives how far autumn has got (env.autumn 0 green .. 1 turned, gfx U.autumn). A fragment of the spray has
//   v  = autumn x (m + a little noise + a little of its own sun-facing + the withering of a nearly bare crown)
//        (0 in summer, whatever else: green stays green)
// quantised to a STAGE: 0 the species' green (the leaf ramp row), 1..4 the species' autumn ramps (B.autumn, trees3d.js:
// [s1, s2, s3, s4], each ['#hi', '#base', '#shade'], in the order the leaves turn; s4 is the dying brown). Whole steps, no
// gradients. The sprays that turned first fall first: the thinning (uLeafK) ranks a fragment by noise + drop x autumn x (m - mid),
// so in late autumn the red sun side is bare while a few green and yellow sprays hang on in the shade.
export const AUTUMN = {
  sun: [0, .72, .69],        // toward the noon sun, world frame (x east, y up, z south), fixed: the colours never move with the day
  expo: .7,                  // k: the weight of (the spray's place in the crown, world frame) . sun
  rnd: .65,                  // k: the spray's own random
  tree: .5,                  // k: the tree's own offset (some trees turn early, some late)
  lo: .15, hi: 1.8,          // m = lo + (hi - lo) k
  noise: .1,                 // v: a 3D noise on the fragment (flecks of the next stage inside a spray)
  face: .1,                  // v: the fragment's own normal . sun (the sun side of a spray turns a little further)
  cuts: [.42, .68, .98, 1.4],// v where stage 1, 2, 3, 4 begin (fitted to the stage mix over the oaks: ~65 % green at autumn .3, ~15 % at .69)
  drop: .55,                 // thinning: how much "turned further" ranks a fragment to fall earlier
  wither: [.1, .3, 1.4],     // what still hangs on a nearly bare crown has withered: v + 1.4 where uLeafK is below .1, none above .3 (smoothstep between)
};
export const AUTUMN_MID = (AUTUMN.lo + AUTUMN.hi) / 2;
// the stage of a turn value v (the shader's step function)
export const stageOf = v => { const c = AUTUMN.cuts; return v < c[0] ? 0 : v < c[1] ? 1 : v < c[2] ? 2 : v < c[3] ? 3 : 4; };
// the stage a leaf that lets go now has come from, for u in 0..1: the sprays that turned first fall first, so the draw is
// tilted toward the early ones (k near 1). 0 = a green one (the caller keeps its own green)
export const fallStage = (autumn, u) => stageOf(autumn * (AUTUMN.lo + (AUTUMN.hi - AUTUMN.lo) * (1 - u * u)));
