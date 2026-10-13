// PAINTS (data): colour ramps that recipes (content/recipes.js) paint their parts with, beside the world's own families
// (world.js FAMS: wood, rock, bark, leaf, cover ...). Each paint becomes one more family: world.js appends these names to
// FAMS (after its own, so their indices stay put) and fills their row of the ramp texture, so a painted part is toned,
// outlined, seamed, mossed and snowed on like every prop. The composite keeps a family in 6 bits: 64 families in all.
//   name: {all: [hi, base, shade, dark]}                     the same in every biome
//   name: {all: [...], frost: [...], rift: [...]}            a biome's own ramp where it has one ('all' elsewhere)
// Pure data, no imports (the co-op server may read it too).
export const PAINTS = {
  agaric:      {all: ['#ec5a3e', '#c8332a', '#8e2024', '#4c1016'], rift: ['#d860e8', '#a83cc8', '#702890', '#3a1450']},   // the fly agaric's cap
  mushwhite:   {all: ['#f6f0e2', '#ded4be', '#b2a68e', '#6e6452']},                                                       // stems, the agaric's warts, gills
  chanterelle: {all: ['#f8cc62', '#e2a43a', '#b2782a', '#603e16']},
  bracket:     {all: ['#dcb87c', '#b88e54', '#88623a', '#4c341e']},                                                       // shelf fungus on old wood
  needles:     {all: ['#a47c52', '#84643f', '#62482f', '#38291c'], frost: ['#8a7a6a', '#6c5e52', '#504640', '#302a26']},   // spruce needle duff: ant hills, litter
  blueberry:   {all: ['#6478d8', '#4254ae', '#2e3880', '#1a1e48']},
  lingon:      {all: ['#f0605a', '#cc2e34', '#8c1a26', '#4a0e16']},                                                       // the lingonberry's berries
  lingonleaf:  {all: ['#7ea05a', '#4e7a3e', '#33572e', '#1a301c'], frost: ['#6a8a5a', '#46663e', '#30482e', '#18281a']},   // its evergreen leaves: darker, glossier than the biome's leaf
  lichen:      {all: ['#ccd4b4', '#acb898', '#889474', '#505a44']},                                                       // pale reindeer lichen, crust on rock
  deadwood:    {all: ['#a89e8e', '#898072', '#6a6258', '#3e3934']},                                                       // weathered grey wood, bark long gone
  rotwood:     {all: ['#94704c', '#74543a', '#563c2a', '#32221a']},                                                       // soft brown rot: a hollow stump's inside, crumbs, a fresh break
  splinter:    {all: ['#f0dcaa', '#d6bc84', '#aa8e5c', '#645034']},                                                       // torn fresh wood: a snapped trunk's staves
  soil:        {all: ['#86644a', '#664a36', '#4a3628', '#2a1e16']},                                                       // bare earth: an uprooted tree's root plate, its pit
  sawn:        {all: ['#e6c892', '#cca870', '#a08050', '#5c462a']},                                                       // a fresh cut: stump tops, log ends
  eye:         {all: ['#fbfaf4', '#e8e4d8', '#bcb6a8', '#5a5650']},                                                       // the white of an eye
  pupil:       {all: ['#3a3040', '#241c2a', '#16101a', '#08060a']},
  // the forest's animals (features/fauna.js, docs/FAUNA.md); white fur and the deer's antlers use mushwhite and sawn
  roe:         {all: ['#c08a5a', '#9a6a40', '#70492c', '#3c2618']},                                                       // a roe deer's summer red-brown
  russet:      {all: ['#ec9a4a', '#cc6e2c', '#94481e', '#4e2410']},                                                       // a fox, a red squirrel
  harefur:     {all: ['#b8a084', '#957e64', '#6e5c4a', '#3c3229']},                                                       // a mountain hare's summer grey-brown
  furdark:     {all: ['#5a4a40', '#3c302a', '#28201c', '#140f0d']},                                                       // dark legs, ear tips, noses, hooves
  plumage:     {all: ['#464a5a', '#2c2e38', '#1e1f27', '#0e0e12']},                                                       // a raven, a capercaillie cock: near black, a blue sheen
};
// a paint's ramp in a biome: ['#hi', '#base', '#shade', '#dark']
export const paintRamp = (name, biome) => { const p = PAINTS[name]; return p && (p[biome] || p.all); };
