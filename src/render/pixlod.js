// PIXEL LOD (the perspective cameras: features/chasecam.js third / first person, features/cinema.js): the game's pixel look kept
// when the camera comes down among things. In the top-down view every metre is PPM art px wherever it stands, so the procedural
// detail painted in metres (the crowns' leaf clusters: gfx.js MESH_FS uLeaf, render/flora.js) is always ~4 art px a cluster. A
// perspective camera magnifies what is near: a crown 2 m off showed its clusters 20 px wide, a bush as a few big flat facets.
// Here the detail's size follows the distance in whole OCTAVES (x 1/2, 1/4 ... near; up to x 4 far), so a cluster stays about as
// many art px across as in the game's view; between two octaves the two patterns are blended (their contrast kept), so no seam
// sweeps across a crown as he walks. Only in the shaders' CINE variant (the top-down view is untouched, bit for bit).
// uCineP: xyz the camera (world m), w = PPM x cineK / (the projection's px per m at 1 m): distance x w = how many times bigger than
// the game's view a metre shows there, inverted (0: off, ?cinepix=0). Set by gfx.js cineView.
// Needs above it: uLeaf (vec4), vn3(vec3), leafCell(vec3, out vec3) (gfx.js MESH_FS / flora.js MESH_FS have them).
export const PIX_LOD = `
uniform vec4 uCineP;
float pixOct(vec3 w) { return uCineP.w > 0. ? clamp(log2(max(distance(w, uCineP.xyz) * uCineP.w, 1e-4)), -5., 2.) : 0.; }
// the leaf clusters' shaping (MESH_FS's: a little blotchy noise, each cluster's top lit, a crescent under it) at s x their size
float leafAt(vec3 pl, vec3 sd, float s, out bool cres) {
  float jn = vn3(pl * (7.5 / s) + vec3(sd.x, 0., sd.z)); vec3 rel; float b = leafCell(pl / (uLeaf.x * s) + sd * .31, rel);
  cres = b < uLeaf.z && rel.y < -.05; return (jn - .5) * .2 + rel.y * uLeaf.y;
}
float leafLod(vec3 pl, vec3 w, vec3 sd, out bool cres) {
  float o = pixOct(w), o0 = floor(o), t = o - o0, s = exp2(o0);
  float a = leafAt(pl, sd, s, cres); if (t < .02) return a;
  bool c2; float b = leafAt(pl, sd, s * 2., c2); if (t > .5) cres = c2;
  return (a * (1. - t) + b * t) / sqrt((1. - t) * (1. - t) + t * t);   // (two unrelated patterns: their contrast kept through the blend)
}
`;
