// KEEPSAKES (docs/KEEPSAKES.md): the finds that do something. Each odd thing the forest's and the cave's secrets leave you
// (content/keepsakes.js KEEPSAKE_IDS: pouch materials, content/items.js) can be worn in one of two charm slots (content/gear.js
// slot 'charm'; features/gear.js: worn only while the pouch holds it), and while it is worn it bends one rule of the world.
// Nothing says which: no stat line, no toast; the rule shows itself the moment it happens.
//   THE NOTES   a worn keepsake's modifier notes (content/keepsakes.js NOTES, source 'keepsakes'), applied by their owners:
//               the animals (fauna.loud, fauna.lure), the cave (cave.shun, cave.kin, cave.relight), the watcher (watcher.every)
// MULTIPLAYER: what you wear is in your gear set, which is the server's to say (features/gear.js, server/room.mjs wear): everyone
//   sees the charms on you, and the server and your friends' clients read your set for the rules that touch them (the soot
//   things: server/room.mjs; the animals: features/fauna.js reads a peer's q.gear).
// SIM vs VIEW: the worn set and its notes change in update (a step), on a change of the gear's set only.
// OWNS: the modifier source 'keepsakes', F.worn (the keepsakes in your set now). READS: gear (S.worn, S.ver), pack (give: the dev
//   row), flags ('keepsakes').
// EMITS: nothing yet. BUDGET: update: a compare a step (the set's version).
import {flags} from '../core/flags.js';
import {KEEPSAKE_IDS, NOTES, isKeepsake} from '../content/keepsakes.js';

const ON = flags.get('keepsakes') !== '0';

// ORDER (core/features.js): after the gear (the set worn this step), the pack and co-op (their mail this step)
export const order = {after: ['gear', 'pack', 'coop']};
export async function create(host) {
  const gear = () => host.feature('gear'), pack = () => host.feature('pack'), game = () => host.feature('game');
  const F = {name: 'keepsakes', label: 'Keepsakes', on: ON, worn: new Set(), ver: 0};
  F.wears = id => F.worn.has(id);
  let gearV = -1;
  const notes = [];
  function setNotes() {
    notes.length = 0;
    if (ON) for (const id of F.worn) for (const n of NOTES[id] || []) notes.push(n);
    if (notes.length) host.mods.set('keepsakes', notes.slice()); else host.mods.clear('keepsakes');
  }

  F.update = () => {
    const G = gear(), v = G?.S?.ver ?? 0;
    if (v !== gearV) {   // (the set changed: which keepsakes are worn now, their notes)
      gearV = v; F.worn.clear();
      for (const id of G?.S?.worn || []) if (isKeepsake(id)) F.worn.add(id);
      F.ver++; setNotes();
    }
  };

  F.menu = () => game()?.mode !== 'sandbox' ? [] : [
    {label: 'Keepsakes: give all (one of each in the pouch)', run: () => { const pk = pack(); if (pk) for (const id of KEEPSAKE_IDS) if (!pk.count(id)) pk.give(id, 1); }},
  ];
  F.hud = () => F.worn.size ? `keepsakes worn ${[...F.worn].join(', ')}${ON ? '' : ' (rules off)'}` : '';
  return F;
}
