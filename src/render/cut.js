// CUT: the cutaway's test, shared by every shader that draws the world into the gbuffer (gfx.js MESH_FS / SURF_FS / the points,
// render/flora.js's plants, render/grass.js's blades) and by the composite's cap (gfx.js COMP_FS). features/cutaway.js decides when and
// how far it is open; G.setCut puts it on the screen every frame (gfx.js cutFrame). The uniforms are G.U.cut / cutB / cutM / cutP.
// A fragment goes when it lies inside the cut's SHAPE, IN FRONT of the player and OVER HIS FLOOR (uCutB.w: his feet + a little: the
// ground he stands on stays). Two shapes:
//   CAPSULE (uCutM.y 0: a roof over him): on screen, round his body from his feet to over his head, uCutB.y px out; in front = nearer
//           the camera along its line (uCut.z: his depth less a margin), so the roof right over him goes
//   WELL    (uCutM.y > 0: he is down in the ground): in the world, an upright oval round him, uCutM.y m out toward the wall that hides
//           him (uCutP.zw: that way, level) and uCutM.x m across it, its rim dithered over uCutM.z m; only on that wall's side of him
//           (.6 m off him), so a gorge's near rim and the ground close behind it go while its far wall stands and nothing far off is
//           touched. The composite lays a CAP where a view ray crosses the slice (y = uCutB.w) inside the well: the cut earth, flat at
//           his level, like a diorama sawn open
// It opens with uCut.w (0 = shut: one compare).
//   cutIn(q) -> px: how far inside the capsule the view pixel q lies (<= 0: outside)    cutWell(p) -> m: how far inside the well the
//   level point p (x, z) lies (<= 0: outside)    cutAway(w) -> bool: drop this fragment (w: its world position, m; the plants and
//   blades pass their root's)
export const CUT = `
uniform vec4 uCut, uCutB, uCutM, uCutP;   // (feet px x, y, his depth, open) (capsule px, radius px, rim px, floor m) (well across m, out m, rim m, -) (his x, z, side x, z)
const float CUT_B[16] = float[16](0., 8., 2., 10., 12., 4., 14., 6., 3., 11., 1., 9., 15., 7., 13., 5.);
float cutBayer() { return (CUT_B[(int(gl_FragCoord.x) & 3) + (int(gl_FragCoord.y) & 3) * 4] + .5) / 16.; }
float cutIn(vec2 q) {
  vec2 p = q - uCut.xy;
  p.y -= clamp(p.y, 0., uCutB.x);
  return uCutB.y * uCut.w - length(p);
}
float cutWell(vec2 p) {
  vec2 o = p - uCutP.xy, s = uCutP.zw;
  float along = dot(o, s), across = dot(o, vec2(-s.y, s.x));
  if (along < .6) return -1.;
  float k = length(vec2(along / (uCutM.y * uCut.w), across / (uCutM.x * uCut.w)));
  return (1. - k) * min(uCutM.x, uCutM.y) * uCut.w;
}
bool cutAway(vec3 w) {
  if (uCut.w <= 0. || w.y < uCutB.w) return false;
  if (uCutM.y > 0.) { float d = cutWell(w.xz); return d > 0. && d / uCutM.z > cutBayer(); }
  if (gl_FragCoord.z >= uCut.z) return false;
  float d = cutIn(gl_FragCoord.xy);
  return d > 0. && d / uCutB.z > cutBayer();
}
`;
// the uniforms a material passes on (U: G.U)
export const cutU = U => ({uCut: U.cut, uCutB: U.cutB, uCutM: U.cutM, uCutP: U.cutP});
