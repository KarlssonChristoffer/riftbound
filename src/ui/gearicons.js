// GEAR ICONS: a pixel icon of every piece of gear (content/gear.js), for the wardrobe (dev/wardrobe.js) and the gear panel
// (ui/gearpanel.js). An icon is drawn in code at 16 x 16 from a few shapes in the piece's own materials (MATERIALS: 4 tones
// hi, base, shade, dark), shaded like the game's pixel art (the top-left rim lit, the bottom-right rim in shade) and outlined
// in ink, on an 18 x 18 canvas (the 1 px round it is the outline's). Drawn once a piece, as a data URL.
//   shapes: r [x, y, w, h] (cells) | e [cx, cy, rx, ry] | p [x, y, x, y ...] (a polygon) | l [x0, y0, x1, y1, width] (a thick
//   line) | px [[x, y] ...] (single cells); coordinates on the cells' edges (8 is the middle). Each: m (the index of its
//   material in the icon's mats), and optionally t (a fixed tone 0..3: unshaded), clip [x, y, w, h] (only there), on (only
//   over the cells of that earlier shape: a band, a trim), tex ('check' | 'rows' | 'cols': a weave in the shade tone).
// API: gearIcon(g) -> data URL (null: no drawing for it: slotIcon is the fallback); slotIcon(slot, col) -> data URL (the slot's
//   silhouette, 10 x 10, for "his own"). READS: content/gear.js MATERIALS. OWNS: its cache. BUDGET: ~0.2 ms an icon, once.
import {MATERIALS} from '../content/gear.js';

const N = 16, INK = '#100b08';

// ---------------------------------------------------------------- shapes shared by several pieces
const dome = (m, y = 10, extra = {}) => ({e: [8, y, 6, 7], m, clip: [0, 0, 16, y + 1], ...extra});
const shirt = (m, {sleeves = 'long', len = 14} = {}) => [
  ...(sleeves === 'long' ? [{l: [4.5, 3, 2, 12, 3], m}, {l: [11.5, 3, 14, 12, 3], m}] : sleeves === 'short' ? [{l: [4.5, 3, 2.5, 8, 3], m}, {l: [11.5, 3, 13.5, 8, 3], m}] : []),
  {r: [4, 2, 8, len - 2], m}, {e: [8, 2, 2, 1.4], m, t: 3},
];
const robe = (m, sleeve = m) => [{l: [5.5, 3, 2, 11, 4], m: sleeve}, {l: [10.5, 3, 14, 11, 4], m: sleeve}, {p: [5, 1, 11, 1, 14, 15, 2, 15], m}, {e: [8, 1.5, 2, 1.3], m, t: 3}];
const cloak = m => [{p: [6, 1, 10, 1, 14.5, 15, 1.5, 15], m}, {p: [7, 4, 9, 4, 10, 15, 6, 15], m, t: 2}];
const trousers = m => [{r: [4, 1, 8, 3], m}, {r: [4, 3, 3, 12], m}, {r: [9, 3, 3, 12], m}, {r: [7, 3, 2, 2], m}];
const boot = (m, {top = 1} = {}) => [{r: [4, top, 5, 10 - top], m}, {p: [4, 9, 9, 9, 13, 10.5, 14.5, 12.5, 14.5, 15, 4, 15], m}];
const glove = m => [{r: [4, 3, 2, 6], m}, {r: [6, 2, 2, 7], m}, {r: [8, 2, 2, 7], m}, {r: [10, 3, 2, 6], m}, {l: [4.5, 10, 2, 6.5, 2.2], m}, {r: [4, 7, 8, 5], m}, {r: [4, 12, 8, 3], m}];

// ---------------------------------------------------------------- the icons: id -> {mats, shapes}
const ICON = {
  // head
  wool_cap: {mats: ['wool_blue', 'wool_cream'], s: [dome(0, 11, {tex: 'cols'}), {r: [2, 10, 12, 3], m: 1, tex: 'cols'}, {e: [8, 3, 2.2, 2.2], m: 1}]},
  straw_hat: {mats: ['straw', 'red_cloth'], s: [{e: [8, 11.5, 7.8, 2.6], m: 0}, {r: [4, 5, 8, 6], m: 0}, {e: [8, 5.5, 4, 2], m: 0}, {r: [4, 8, 8, 2], m: 1}]},
  kettle_helm: {mats: ['iron', 'brass'], s: [dome(0, 10), {e: [8, 11, 7.8, 2.2], m: 0}, {px: [[4, 8], [8, 6], [11, 8]], m: 1, t: 0}, {e: [8, 3.4, 1.2, 1.2], m: 1}]},
  tomte_cap: {mats: ['felt_red', 'wool_cream'], s: [{p: [2.5, 13, 13.5, 13, 12, 7, 9.5, 3, 7, 1.5, 5, 3, 4, 8], m: 0}, {l: [8.5, 2.5, 13, 5.5, 2.4], m: 0}, {r: [2, 11, 12, 4], m: 1, tex: 'cols'}, {e: [13.6, 7, 1.9, 1.9], m: 1}]},
  lamp_cap: {mats: ['leather', 'leather_dk', 'brass', 'glass'], s: [dome(0, 11), {r: [2, 10, 12, 3], m: 1}, {e: [8, 7, 3, 3], m: 2}, {e: [8, 7, 1.8, 1.8], m: 3, t: 0}]},
  wizard_hat: {mats: ['velvet_blue', 'gold'], s: [{e: [8, 13, 7.8, 2.2], m: 0}, {p: [4, 13, 12, 13, 10, 5, 11.5, 0.5, 7, 4], m: 0}, {r: [5, 10, 7, 2], m: 1}, {px: [[8, 6], [7, 7], [9, 7], [8, 8]], m: 1, t: 0}]},
  hood: {mats: ['wool_grey'], s: [{p: [8, 0, 13, 4, 14.5, 15, 1.5, 15, 3, 4], m: 0}, {e: [8, 10, 3.6, 4.5], m: 0, t: 3}, {l: [8, 1, 8, 5, 1], m: 0, t: 2}]},
  horned_helm: {mats: ['iron', 'black_iron', 'bone'], s: [{l: [3.5, 9, 1.5, 4, 2.4], m: 2}, {l: [1.5, 4.5, 2, 1, 1.6], m: 2}, {l: [12.5, 9, 14.5, 4, 2.4], m: 2}, {l: [14.5, 4.5, 14, 1, 1.6], m: 2},
    dome(0, 12), {r: [3, 10, 10, 3], m: 1}, {r: [7, 12, 2, 3], m: 1}]},
  great_helm: {mats: ['steel', 'black_iron', 'gold'], s: [{r: [3, 3, 10, 12], m: 0}, {e: [8, 3.5, 5, 2.5], m: 0}, {r: [4, 7, 8, 1], m: 1, t: 3}, {r: [7, 9, 2, 5], m: 2}, {r: [5, 10, 6, 1], m: 2},
    {px: [[5, 12], [10, 12], [5, 13], [10, 13]], m: 1, t: 3}]},
  crown: {mats: ['gold', 'velvet_red'], s: [{e: [8, 9, 4.5, 4], m: 1, tex: 'check'}, {p: [2, 9, 2, 4, 4.5, 7, 6, 3, 8, 6.5, 10, 3, 11.5, 7, 14, 4, 14, 9], m: 0}, {r: [2, 9, 12, 4], m: 0},
    {px: [[4, 10], [8, 10], [11, 10]], m: 1, t: 0}, {px: [[2, 3], [6, 2], [10, 2], [13, 3]], m: 0, t: 0}]},
  headscarf: {mats: ['red_cloth'], s: [dome(0, 11), {r: [2, 9, 12, 3], m: 0, t: 2}, {p: [11, 10, 15, 13, 14, 15, 10, 12], m: 0}, {px: [[5, 5], [9, 4], [7, 7], [11, 7]], m: 0, t: 0}]},
  feathered_cap: {mats: ['green_cloth', 'feather'], s: [{e: [7, 10, 6, 4.5], m: 0, clip: [0, 0, 16, 11]}, {p: [1, 10, 13, 10, 15, 12, 1, 12], m: 0}, {l: [9, 9, 14.5, 1.5, 2.6], m: 1}, {l: [10, 8, 14, 2.5, .8], m: 1, t: 2}]},
  leather_cap: {mats: ['leather_dk', 'hide_tan'], s: [dome(0, 11), {r: [2, 10, 12, 3], m: 1}, {l: [8, 4, 8, 10, 1], m: 0, t: 3}]},
  // body
  wool_sweater: {mats: ['wool_cream'], s: [...shirt(0), {r: [4, 12, 8, 2], m: 0, tex: 'cols'}, {r: [1, 11, 3, 2], m: 0, t: 2}, {r: [12, 11, 3, 2], m: 0, t: 2}]},
  mail_shirt: {mats: ['mail'], s: [...shirt(0, {sleeves: 'short'}).map(o => ({...o, tex: o.t === undefined ? 'check' : undefined}))]},
  smith_apron: {mats: ['leather_dk', 'leather'], s: [{l: [5, 1, 4, 7, 1], m: 0}, {l: [11, 1, 12, 7, 1], m: 0}, {r: [5, 2, 6, 5], m: 1}, {p: [4, 6, 12, 6, 13, 15, 3, 15], m: 1}, {r: [6, 9, 4, 3], m: 0}]},
  leather_jerkin: {mats: ['leather', 'linen', 'leather_dk'], s: [{l: [4.5, 3, 2, 12, 3], m: 1}, {l: [11.5, 3, 14, 12, 3], m: 1}, {r: [4, 2, 8, 12], m: 0}, {e: [8, 2, 2, 1.4], m: 0, t: 3},
    {px: [[7, 4], [8, 5], [7, 6], [8, 7], [7, 8]], m: 2, t: 3}, {r: [4, 10, 8, 1], m: 2}]},
  gambeson: {mats: ['linen'], s: shirt(0).map(o => ({...o, tex: o.t === undefined ? 'rows' : undefined}))},
  chain_hauberk: {mats: ['mail'], s: [...shirt(0, {len: 16}).map(o => ({...o, tex: o.t === undefined ? 'check' : undefined}))]},
  plate_cuirass: {mats: ['steel', 'black_iron'], s: [{e: [8, 8, 5, 6.5], m: 0}, {e: [3.5, 4, 3, 2.6], m: 0}, {e: [12.5, 4, 3, 2.6], m: 0}, {l: [8, 3, 8, 12, 1], m: 0, t: 0},
    {r: [4, 12, 8, 2], m: 1}, {r: [7, 12, 2, 2], m: 0, t: 1}]},
  mage_robe: {mats: ['velvet_blue', 'gold'], s: [...robe(0), {l: [8, 3, 8, 15, 1.4], m: 1}, {r: [3, 14, 10, 1], m: 1}, {px: [[2, 11], [13, 11]], m: 1}]},
  monk_robe: {mats: ['robe_brown', 'wool_cream'], s: [...robe(0), {l: [8, 3, 8, 15, 1], m: 0, t: 2}, {r: [4, 7, 8, 1], m: 1}, {l: [6, 8, 5.5, 12, 1], m: 1}, {px: [[5, 12]], m: 1, t: 0}]},
  noble_doublet: {mats: ['velvet_red', 'linen', 'gold', 'leather_dk'], s: [...shirt(0), {e: [8, 2, 3.5, 1.6], m: 1}, {px: [[8, 4], [8, 6], [8, 8]], m: 2, t: 0}, {r: [4, 10, 8, 1], m: 3}, {r: [1, 11, 3, 1], m: 2}, {r: [12, 11, 3, 1], m: 2}]},
  tunic: {mats: ['green_cloth', 'leather_dk'], s: [...shirt(0, {sleeves: 'short', len: 15}), {r: [4, 9, 8, 1], m: 1}, {px: [[8, 9]], m: 1, t: 0}]},
  // back
  fur_cloak: {mats: ['fur'], s: [...cloak(0), {e: [8, 2.5, 5, 2.4], m: 0, tex: 'check'}, {px: [[3, 15], [6, 15], [9, 15], [12, 15]], m: 0, t: 2}]},
  bark_pack: {mats: ['birchbark', 'leather', 'leather_dk'], s: [{r: [3, 3, 10, 12], m: 0}, {px: [[5, 9], [6, 9], [10, 11], [11, 11], [4, 13], [8, 7]], m: 0, t: 3}, {r: [3, 2, 10, 4], m: 1}, {r: [5, 5, 1, 9], m: 2}, {r: [10, 5, 1, 9], m: 2}]},
  traveller_cloak: {mats: ['green_cloth'], s: [...cloak(0), {e: [8, 2.5, 4.5, 2], m: 0}, {e: [8, 3.4, 1, 1], m: 0, t: 0}]},
  royal_mantle: {mats: ['velvet_red', 'ermine', 'gold'], s: [...cloak(0), {r: [2, 13, 12, 2], m: 1, clip: [0, 13, 16, 3]}, {e: [8, 3, 6, 2.8], m: 1}, {px: [[4, 3], [8, 2], [11, 4], [5, 14], [10, 14]], m: 1, t: 3}, {e: [8, 4.5, 1.2, 1.2], m: 2}]},
  quiver: {mats: ['leather', 'feather', 'red_cloth'], s: [{l: [9, 4, 12, 0.5, 1], m: 1}, {l: [11, 5, 14, 2, 1], m: 1}, {l: [7, 4, 8.5, 0.5, 1], m: 1}, {l: [5, 14.5, 10, 4, 4], m: 0}, {l: [6.4, 11.3, 8.6, 12.3, 1.6], m: 2}, {l: [8.6, 6.8, 10.8, 7.8, 1.6], m: 2}]},
  bedroll: {mats: ['wool_grey', 'leather_dk'], s: [{r: [2, 5, 11, 8], m: 0, tex: 'rows'}, {e: [13, 9, 2.3, 4], m: 0}, {e: [13, 9, 1, 2], m: 0, t: 3}, {r: [5, 4, 1, 10], m: 1}, {r: [10, 4, 1, 10], m: 1}]},
  // hands
  leather_gloves: {mats: ['leather_dk'], s: [...glove(0), {r: [4, 12, 8, 1], m: 0, t: 0}]},
  iron_gauntlets: {mats: ['steel'], s: [...glove(0), {p: [3, 12, 13, 12, 14, 15, 2, 15], m: 0}, {r: [4, 7, 8, 1], m: 0, t: 0}, {r: [4, 9, 8, 1], m: 0, t: 2}]},
  mage_wraps: {mats: ['linen'], s: [...glove(0).map(o => ({...o, tex: 'rows'}))]},
  // legs
  wool_trousers: {mats: ['wool_grey'], s: trousers(0)},
  leather_chaps: {mats: ['hide_tan'], s: [...trousers(0), {px: [[3, 6], [3, 8], [3, 10], [3, 12], [12, 6], [12, 8], [12, 10], [12, 12]], m: 0}]},
  plate_greaves: {mats: ['steel', 'black_iron'], s: [...trousers(1), {r: [4, 5, 3, 10], m: 0}, {r: [9, 5, 3, 10], m: 0}, {e: [5.5, 8, 2, 1.6], m: 0, t: 0}, {e: [10.5, 8, 2, 1.6], m: 0, t: 0}]},
  linen_trousers: {mats: ['linen'], s: [...trousers(0), {r: [4, 1, 8, 1], m: 0, t: 2}]},
  // feet
  moose_boots: {mats: ['hide_tan'], s: [...boot(0), {r: [3, 1, 7, 2], m: 0, tex: 'check'}]},
  bark_shoes: {mats: ['birchbark'], s: [{r: [3, 7, 5, 4], m: 0}, {p: [2, 10, 9, 9, 13.5, 11, 14.5, 15, 2, 15], m: 0, tex: 'check'}, {l: [3, 10.5, 8, 10.5, 1], m: 0, t: 3}]},
  iron_boots: {mats: ['iron'], s: [...boot(0), {r: [4, 4, 5, 1], m: 0, t: 2}, {r: [4, 14, 11, 1], m: 0, t: 3}]},
  plate_sabatons: {mats: ['steel'], s: [...boot(0, {top: 3}), {l: [9, 10, 9, 15, 1], m: 0, t: 2}, {l: [11.5, 11, 11.5, 15, 1], m: 0, t: 2}, {r: [4, 6, 5, 1], m: 0, t: 2}]},
  riding_boots: {mats: ['leather_dk'], s: [{r: [3, 0, 7, 3], m: 0, t: 0}, ...boot(0, {top: 2}), {r: [4, 14, 11, 1], m: 0, t: 3}, {px: [[3, 12], [2, 12]], m: 0, t: 0}]},
  fur_boots: {mats: ['fur'], s: [...boot(0, {top: 4}), {e: [6.5, 4, 4, 3], m: 0, tex: 'check'}]},
  // main hand: from the bottom left to the top right
  arming_sword: {mats: ['steel', 'brass', 'leather_dk'], s: [{l: [5.5, 10.5, 14.5, 1.5, 2.2], m: 0}, {l: [6.5, 9.5, 13.5, 2.5, .6], m: 0, t: 0}, {l: [2.5, 7.5, 8.5, 13.5, 1.8], m: 1}, {l: [2.5, 13.5, 5, 11, 2], m: 2}, {e: [2, 14, 1.4, 1.4], m: 1}]},
  greatsword: {mats: ['steel', 'black_iron', 'leather_dk'], s: [{l: [5, 11, 15, 1, 3.2], m: 0}, {l: [6, 10, 14, 2, .8], m: 0, t: 2}, {l: [2, 7.5, 8.5, 14, 2], m: 1}, {l: [2, 14, 4.5, 11.5, 2], m: 2}, {e: [1.6, 14.4, 1.4, 1.4], m: 1}]},
  battle_axe: {mats: ['oak', 'steel'], s: [{l: [2, 15, 12, 2, 1.8], m: 0}, {p: [9, 1, 13, 1.5, 15.5, 6, 14.5, 10, 11, 8, 10, 5], m: 1}, {l: [12, 2, 15, 7, 1], m: 1, t: 0}]},
  mace: {mats: ['oak', 'black_iron'], s: [{l: [2, 15, 9.5, 6.5, 2], m: 0}, {e: [11, 4.5, 3.6, 3.6], m: 1}, {px: [[11, 0], [15, 4], [7, 4], [11, 8], [14, 1], [8, 1]], m: 1}, {l: [2, 15, 4, 13, 2.4], m: 1}]},
  spear: {mats: ['oak', 'steel'], s: [{l: [1, 15, 11, 5, 1.6], m: 0}, {p: [10, 6, 11, 3, 15.5, 0.5, 13, 5], m: 1}, {l: [9, 7.5, 11, 5.5, 2.2], m: 1, t: 2}]},
  quarterstaff: {mats: ['oak', 'black_iron'], s: [{l: [1.5, 14.5, 14.5, 1.5, 2.2], m: 0}, {l: [1.5, 14.5, 3.5, 12.5, 2.6], m: 1}, {l: [12.5, 3.5, 14.5, 1.5, 2.6], m: 1}, {l: [7, 9, 9, 7, 2.4], m: 0, t: 2}]},
  wizard_staff: {mats: ['oak', 'gold', 'gem_blue'], s: [{l: [2, 15, 10, 6, 2], m: 0}, {p: [9, 7, 9, 3, 11, 5, 13, 1.5, 14.5, 3, 12.5, 7, 15, 7, 12, 9], m: 1}, {e: [12, 4, 2.6, 2.6], m: 2}, {px: [[11, 3]], m: 2, t: 0}]},
  // off hand
  round_shield: {mats: ['black_iron', 'oak', 'iron'], s: [{e: [8, 8, 7.5, 7.5], m: 0}, {e: [8, 8, 6.3, 6.3], m: 1, tex: 'cols'}, {e: [8, 8, 2.4, 2.4], m: 2}]},
  kite_shield: {mats: ['steel', 'velvet_red', 'gold'], s: [{p: [1.5, 1, 14.5, 1, 14.5, 7, 8, 15.5, 1.5, 7], m: 0}, {p: [3, 2.5, 13, 2.5, 13, 6.8, 8, 13.5, 3, 6.8], m: 1}, {r: [7, 3, 2, 9], m: 2}, {r: [4, 5, 8, 2], m: 2}]},
  buckler: {mats: ['steel', 'brass'], s: [{e: [8, 8, 6, 6], m: 0}, {e: [8, 8, 4, 4], m: 1, on: 0}, {e: [8, 8, 3, 3], m: 0}, {e: [8, 8, 1.5, 1.5], m: 1, t: 0}]},
  lantern: {mats: ['brass', 'glass'], s: [{e: [8, 1.5, 2, 1.5], m: 0}, {p: [4, 5, 12, 5, 10, 2.5, 6, 2.5], m: 0}, {r: [4, 5, 8, 9], m: 0}, {r: [5, 6, 6, 7], m: 1, t: 0}, {r: [6, 7, 4, 5], m: 1, t: 1}, {r: [3, 13, 10, 2], m: 0}, {r: [7, 5, 2, 9], m: 0, t: 2, on: 3}]},
  torch: {mats: ['oak', 'black_iron', 'flame'], s: [{l: [4, 15, 9, 7, 2.2], m: 0}, {e: [9.5, 6, 2.6, 1.6], m: 1}, {p: [7, 6, 12, 6, 12.5, 3, 11, 1.5, 10.5, 0, 9, 2, 7.5, 3], m: 2}, {p: [8.5, 5.5, 11, 5.5, 10.5, 3, 9.6, 2], m: 2, t: 0}]},
  spellbook: {mats: ['leather_dk', 'linen', 'gold'], s: [{r: [11, 3, 3, 11], m: 1, tex: 'rows'}, {r: [2, 2, 11, 12], m: 0}, {e: [7.5, 8, 2.4, 2.4], m: 2}, {e: [7.5, 8, 1.1, 1.1], m: 0, t: 3}, {px: [[2, 2], [12, 2], [2, 13], [12, 13]], m: 2}]},
  // fishing gear (docs/FISHING.md): rods from the bottom left to the top right, the line hanging off the tip
  willow_rod: {mats: ['willow', 'netting'], s: [{l: [1.5, 14.5, 14, 2, 1.6], m: 0}, {l: [9, 6.5, 14, 2, 1], m: 0, t: 0}, {l: [14.5, 2, 14.5, 11, .8], m: 1, t: 1}, {px: [[14, 11], [13, 10]], m: 1, t: 2}]},
  cane_rod: {mats: ['cane', 'cork', 'brass', 'netting'], s: [{l: [1.5, 14.5, 14.5, 1.5, 1.6], m: 0}, {l: [1.5, 14.5, 4.5, 11.5, 2.4], m: 1}, {e: [6.5, 10.5, 2, 2], m: 2}, {e: [6.5, 10.5, .8, .8], m: 2, t: 3},
    {l: [14.5, 1.5, 14.5, 10, .8], m: 3, t: 1}]},
  pike_rod: {mats: ['black_iron', 'cork', 'leather_dk', 'steel'], s: [{l: [1.5, 14.5, 14.5, 1.5, 2], m: 0}, {l: [8, 8, 14.5, 1.5, 1.4], m: 2}, {l: [1.5, 14.5, 4.5, 11.5, 2.8], m: 1}, {e: [6.5, 10.5, 2.4, 2.4], m: 0},
    {l: [14.5, 1.5, 14.5, 9, .8], m: 3, t: 0}, {px: [[14, 9], [13, 10], [14, 10]], m: 3, t: 2}]},
  fly_rod: {mats: ['oak', 'cork', 'red_cloth', 'linen'], s: [{l: [1.5, 14.5, 15, 1, 1.4], m: 0}, {l: [1.5, 14.5, 4, 12, 2.4], m: 1}, {p: [9, 3, 12, 7, 15, 9, 13, 5], m: 3, t: 1},
    {e: [8.5, 4, 1.5, 1.5], m: 2}, {px: [[9, 2], [7, 3]], m: 3, t: 0}]},
  nacken_bow: {mats: ['leather_dk', 'rosin', 'gold'], s: [{l: [2, 14, 14.5, 1.5, 1.6], m: 0}, {l: [3.5, 14.5, 15, 3, .9], m: 1, t: 0}, {r: [1, 12, 3, 3], m: 2}, {px: [[13, 7], [11, 10], [8, 12], [12, 12]], m: 1, t: 1}]},
  bucket_hat: {mats: ['canvas', 'red_cloth', 'feather', 'green_cloth'], s: [{p: [1, 12, 15, 12, 13, 9, 3, 9], m: 0}, {r: [4, 4, 8, 6], m: 0}, {e: [8, 4.5, 4, 1.6], m: 0},
    {r: [4, 8, 8, 1], m: 0, t: 2}, {px: [[5, 8]], m: 1, t: 1}, {px: [[8, 8]], m: 2, t: 0}, {px: [[11, 8]], m: 3, t: 1}]},
  souwester: {mats: ['oilskin'], s: [dome(0, 10), {p: [1, 10, 15, 10, 15.5, 14, 11, 12.5, 5, 12.5, .5, 13], m: 0}, {l: [8, 4, 8, 9, 1], m: 0, t: 2}]},
  angler_vest: {mats: ['canvas', 'linen'], s: [{l: [4.5, 3, 2.5, 8, 2.5], m: 1}, {l: [11.5, 3, 13.5, 8, 2.5], m: 1}, {r: [4, 2, 8, 13], m: 0}, {r: [7, 2, 2, 13], m: 1}, {e: [8, 2, 2, 1.4], m: 1, t: 3},
    {r: [4, 5, 3, 3], m: 0, t: 2}, {r: [9, 5, 3, 3], m: 0, t: 2}, {r: [4, 10, 3, 3], m: 0, t: 2}, {r: [9, 10, 3, 3], m: 0, t: 2}]},
  waders: {mats: ['rubber', 'leather_dk'], s: [{r: [4, 0, 8, 5], m: 0}, ...trousers(0).map(o => ({...o, r: o.r && [o.r[0], o.r[1] + 3, o.r[2], Math.min(o.r[3], 13 - o.r[1])]})),
    {r: [3, 13, 5, 2], m: 0}, {r: [8, 13, 5, 2], m: 0}, {l: [5, 0, 5, 3, 1], m: 1}, {l: [11, 0, 11, 3, 1], m: 1}]},
  felt_boots: {mats: ['felt'], s: [...boot(0), {r: [4, 14, 11, 1], m: 0, t: 3}, {r: [4, 3, 5, 1], m: 0, t: 2}]},
  angler_mitts: {mats: ['wool_grey', 'hide_tan'], s: [...glove(0).map(o => o.r && o.r[1] <= 3 ? {...o, r: [o.r[0], o.r[1] + 2, o.r[2], o.r[3] - 2]} : o), {r: [4, 4, 8, 1], m: 0, t: 2},
    {px: [[4, 4], [6, 3], [8, 3], [10, 4]], m: 1}]},
  landing_net: {mats: ['oak', 'netting'], s: [{l: [1.5, 15, 7, 9.5, 1.8], m: 0}, {e: [10, 6, 5.5, 5.5], m: 1, tex: 'check'}, {e: [10, 6, 4.3, 4.3], m: 1, t: 3, on: 1}, {e: [10, 6, 4.3, 4.3], m: 1, tex: 'check', on: 2}]},
};

// ---------------------------------------------------------------- drawing
function cells(o, put) {
  if (o.r) { const [x, y, w, h] = o.r; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(i, j); return; }
  if (o.px) { for (const [i, j] of o.px) put(i, j); return; }
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i + .5, y = j + .5;
    if (o.e) { const [cx, cy, rx, ry] = o.e, a = (x - cx) / rx, b = (y - cy) / ry; if (a * a + b * b <= 1) put(i, j); }
    else if (o.p) { let inside = false; const P = o.p; for (let k = 0, m = P.length - 2; k < P.length; m = k, k += 2) { const yi = P[k + 1], yj = P[m + 1]; if ((yi > y) !== (yj > y) && x < (P[m] - P[k]) * (y - yi) / (yj - yi) + P[k]) inside = !inside; } if (inside) put(i, j); }
    else if (o.l) {
      const [x0, y0, x1, y1, w] = o.l, dx = x1 - x0, dy = y1 - y0, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L)) : 0, ex = x0 + t * dx - x, ey = y0 + t * dy - y;
      if (ex * ex + ey * ey <= w * w / 4) put(i, j);
    }
  }
}
function draw(def) {
  const part = new Int16Array(N * N).fill(-1);
  def.s.forEach((o, k) => cells(o, (i, j) => {
    if (i < 0 || j < 0 || i >= N || j >= N) return;
    if (o.clip) { const [x, y, w, h] = o.clip; if (i < x || j < y || i >= x + w || j >= y + h) return; }
    if (o.on !== undefined && part[j * N + i] !== o.on) return;
    part[j * N + i] = k;
  }));
  const c = document.createElement('canvas'); c.width = c.height = N + 2; const q = c.getContext('2d');
  const at = (i, j) => i < 0 || j < 0 || i >= N || j >= N ? -1 : part[j * N + i];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = part[j * N + i];
    if (k < 0) { if (at(i - 1, j) >= 0 || at(i + 1, j) >= 0 || at(i, j - 1) >= 0 || at(i, j + 1) >= 0) { q.fillStyle = INK; q.fillRect(i + 1, j + 1, 1, 1); } continue; }
    const o = def.s[k], tones = MATERIALS[def.mats[o.m]] || MATERIALS.leather;
    let t = o.t;
    if (t === undefined) {
      const lit = at(i, j - 1) !== k || at(i - 1, j) !== k, dim = at(i, j + 1) !== k || at(i + 1, j) !== k;
      t = lit && !dim ? 0 : dim && !lit ? 2 : 1;
      if (t === 1 && o.tex && (o.tex === 'check' ? (i + j) % 2 : o.tex === 'rows' ? j % 3 === 0 : i % 3 === 0)) t = 2;
    }
    q.fillStyle = tones[t]; q.fillRect(i + 1, j + 1, 1, 1);
  }
  return c.toDataURL();
}

const cache = new Map();
export function gearIcon(g) {
  if (!g) return null;
  let u = cache.get(g.id);
  if (u === undefined) { const def = ICON[g.id]; u = def ? draw(def) : null; cache.set(g.id, u); }
  return u;
}

// the slots' silhouettes (9 x 9): "his own" (the slot empty), and the fallback for a piece with no drawing yet
const SLOT_ICONS = {
  head: ['.........', '...###...', '..#####..', '..#####..', '..#####..', '#########', '.#######.', '.........', '.........'],
  body: ['..##.##..', '.#######.', '#########', '##.###.##', '#..###..#', '...###...', '...###...', '...###...', '.........'],
  back: ['..#####..', '.##...##.', '.#######.', '.#######.', '#########', '#########', '#########', '#.#.#.#.#', '.........'],
  legs: ['.#######.', '.#######.', '.###.###.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.##...##.', '.........'],
  feet: ['..###....', '..###....', '..###....', '..###....', '..######.', '.#######.', '.########', '.########', '.........'],
  hands: ['..#.#.#..', '..#.#.#..', '.#######.', '.#######.', '.######..', '..#####..', '..#####..', '..#####..', '.........'],
  main: ['.......##', '......###', '.....###.', '....###..', '.#.###...', '..###....', '..##.....', '.#..#....', '#........'],
  off: ['.#######.', '#########', '#########', '#########', '.#######.', '.#######.', '..#####..', '...###...', '....#....'],
};
const slotCache = new Map();
export function slotIcon(slot, col) {   // a data URL: the silhouette in col, with a one-pixel ink shadow down-right
  const key = slot + col; let u = slotCache.get(key); if (u) return u;
  const c = document.createElement('canvas'); c.width = c.height = 10; const q = c.getContext('2d'), rows = SLOT_ICONS[slot] || SLOT_ICONS.body;
  for (const [d, f] of [[1, INK], [0, col]]) { q.fillStyle = f; rows.forEach((r, y) => { for (let x = 0; x < 9; x++) if (r[x] === '#') q.fillRect(x + d, y + d, 1, 1); }); }
  u = c.toDataURL(); slotCache.set(key, u); return u;
}
export const hasIcon = id => !!ICON[id];
