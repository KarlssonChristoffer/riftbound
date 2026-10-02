// STAGE: which world is built and how. Owns the current biome, the built world (world/world.js: rebuilt on a biome
// switch; props keep their state across it), the props' display mode (live 3D | the 16-angle pre-renders, an A/B) and
// the trees (procedural 3D | painted cards). The wind feature sways cards and trees through the world's hooks.
// THE ENTITIES (world/entities.js): the registry over the world's props, made with the first world and kept across
// rebuilds like the props themselves (host.entities).
// OWNS: biomeI, world, ents, propMode, trees3d.  READS: flags (biome, props, trees3d), features (biomeChanged, the wind's hooks).
//   const stage = createStage({G, ctxO, PPM, PPMH, features, flags}); await stage.setBiome(stage.biomeI)
import {buildWorld, WORLD} from './world.js';
import {createEntities} from './entities.js';
import {BIOMES} from './biomes.js';
import './desert.js';   // registers the desert biome (after the four: their indices stay)
const $ = s => document.querySelector(s);

export function createStage({G, ctxO, PPM, PPMH, features, flags: Q}) {
  let biomeI = Math.max(0, BIOMES.findIndex(b => b.id === Q.get('biome')));
  let world = null, ents = null, propMode = Q.get('props') === 'yaw' ? 'yaw' : 'live';
  let trees3d = Q.get('trees3d') !== '0';   // procedural 3D trees (trees3d.js) or the painted cards (Shift+P rebuilds)
  // the wind sways painted foliage cards (per-row bend) and gives braziers / torches a live flame. (The wind feature is
  // looked up once it exists, not per card per frame: the features are made at boot and never replaced)
  let windF = null;
  const wind = () => windF ??= features.find(f => f.name === 'wind') || null;
  function cardHook(it, sp) { const w = wind(); return w?.on && w.card ? w.card(it, sp) : null; }
  // ... and leans the 3D trees (world.js leanTree: the lean at the top, whole pixels per vertex in the shader)
  function meshHook(it) { const w = wind(); return w?.on && w.mesh ? w.mesh(it) : null; }
  async function setBiome(i) {
    biomeI = ((i % BIOMES.length) + BIOMES.length) % BIOMES.length;
    $('#load').classList.remove('hidden'); $('#load').textContent = 'Building ' + BIOMES[biomeI].name + '…';
    const keep = world?.props;   // props keep their state (broken, opened, moved) across a biome switch
    world?.dispose();
    world = await buildWorld(G, {biome: BIOMES[biomeI], ctxO, PPM, PPMH, props: keep, trees3d});
    world.hooks.card = cardHook; world.hooks.mesh = meshHook;   // a rebuilt world has fresh hooks
    ents ??= createEntities(world.props, {x0: 0, y0: 0, x1: WORLD.WM, y1: WORLD.HM});
    world.setMode(propMode);
    for (const f of features) f.biomeChanged?.();
    $('#load').classList.add('hidden');
  }
  return {
    setBiome, BIOMES, cardHook,
    get world() { return world; }, get ents() { return ents; }, get biomeI() { return biomeI; }, get biome() { return BIOMES[biomeI]; },
    get propMode() { return propMode; }, set propMode(m) { propMode = m; world.setMode(m); },
    get trees3d() { return trees3d; }, set trees3d(v) { trees3d = v; setBiome(biomeI); },   // (a rebuild)
  };
}
