// CUT: the cutaway's test, shared by every shader that draws the world into the gbuffer (gfx.js MESH_FS / SURF_FS / the points,
// render/flora.js's plants, render/grass.js's blades) and by the composite's cap (gfx.js COMP_FS). features/cutaway.js decides when and
// how far it is open; G.setCut puts it on the screen every frame (gfx.js cutFrame). The uniforms are G.U.cut / cutB / cutM / cutP.
// A fragment goes when it lies inside the cut's SHAPE on screen, IN FRONT of the player and OVER HIS FLOOR (uCutB.w: his feet + a
// little: the ground he stands on stays). Two shapes:
//   CAPSULE (uCutM.x 0: a roof over him): round his body from his feet to over his head, uCutB.y px out; in front = nearer the camera
//           along its line (uCut.z: his depth less a margin), so the roof right over him goes
//   BAND    (uCutM.x > 0: he is down in the ground): the whole height of the view, uCutM.x px either side of him; in front = on the
//           camera's side of the upright plane through him (uCutP: his x, z and the way toward the camera, level; .6 m off him), so a
//           gorge's whole near rim, the ridge behind it and what grows on them go as one piece while its far wall and the land behind
//           stand (along the camera's line the far rim's top lies nearer than his feet down in the gorge)
// Its rim is an ordered dither uCutB.z px wide (pixel art); it opens with uCut.w (0 = shut: one compare).
//   cutIn(q) -> px: how far inside the shape the view pixel q lies (<= 0: outside)    cutAway(w) -> bool: drop this fragment (w: its
//   world position, m; the plants and blades pass their root's)
export const CUT = `
uniform vec4 uCut, uCutB, uCutM, uCutP;   // (feet px x, y, his depth, open) (capsule px, radius px, rim px, floor m) (band px) (his x, z, toward x, z)
float cutIn(vec2 q) {
  vec2 p = q - uCut.xy;
  if (uCutM.x > 0.) return uCutM.x * uCut.w - abs(p.x);
  p.y -= clamp(p.y, 0., uCutB.x);
  return uCutB.y * uCut.w - length(p);
}
bool cutAway(vec3 w) {
  if (uCut.w <= 0. || w.y < uCutB.w) return false;
  if (uCutM.x > 0. ? dot(w.xz - uCutP.xy, uCutP.zw) < .6 : gl_FragCoord.z >= uCut.z) return false;
  float d = cutIn(gl_FragCoord.xy);
  if (d <= 0.) return false;
  const float B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
  return d / uCutB.z > (B[(int(gl_FragCoord.x) & 3) + (int(gl_FragCoord.y) & 3) * 4] + .5) / 16.;
}
`;
// the uniforms a material passes on (U: G.U)
export const cutU = U => ({uCut: U.cut, uCutB: U.cutB, uCutM: U.cutM, uCutP: U.cutP});
