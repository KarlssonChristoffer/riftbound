// WINTER (data; docs/WINTER.md): the knobs of lying snow you wade in and of snowballs. Pure. The tracks' knobs are
// content/prints.js (one owner shared with other builds); the lake ice's are content/ice.js.
//   TUNE.snow      DEPTH: the lying snow (env.snowCover 0..1) is snowCover x depth m deep; at full it slows the walk by slow
//                  (a mul on 'player.speed') and sinks the sprite by sink (P.sink's units: 22 art px each). Notes change only
//                  when the depth crosses a step (q). Gear's 'soft.slow' note (mul) scales both: the moose-hide boots' 0
//   TUNE.ball      SNOWBALLS: hold E on lying snow with empty hands for make s, then LMB throws it at the cursor (speed m/s,
//                  up: the lob, reach m at most). A hit (within hit m of a body, at its height) staggers (push m/s for a moment),
//                  leaves a white splat on the sprite for splat s, and knocks the hat off one time in hat (it lands; walk over
//                  it to put it back on). Gentle: no damage, ever
// Gear (content/gear.js mods): 'soft.slow' (mul: how much deep snow and soft ground slow and sink him: the moose-hide boots' 0)
export function statWords(m) {
  if (m.stat === 'soft.slow' && m.mul !== undefined) return m.mul <= 0 ? 'snow and soft ground don\'t slow you' : `snow and soft ground slow you ${Math.round((1 - m.mul) * 100)}% less`;
  return '';
}
export const TUNE = {
  snow: {depth: .45, slow: .25, sink: .3, q: .1, need: .05},
  ball: {make: .5, speed: 13, up: 3.2, reach: 18, g: 9.8, hit: .55, push: 2.4, splat: 10, hat: .2, life: 3, cd: .35},
};
