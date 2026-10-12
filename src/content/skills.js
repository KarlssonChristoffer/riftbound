// SKILLS: what the player gets better at by doing it (docs/GATHERING.md: skills by doing, gear gates). Pure data.
//   name, col    the label and its colour (the panel, the level-up toast)
//   per          the notes a level gives (game/skills.js sets them in host.mods under the source 'skills'): each
//                {stat, mul} is 1 + mul x (level - 1), each {stat, add} add x (level - 1); the system that owns the stat
//                reads it (woodcut.power: features/woodcut.js, a blow's chop)
// XP: CURVE.k x (level - 1) ^ CURVE.p to reach a level (level 2 at 40, 5 at ~560, 10 at ~2600); MAX the last level.
// Modest on purpose: a level is a few per cent; a better tool is what opens harder wood.
export const CURVE = {k: 40, p: 1.9, max: 50};

export const SKILLS = {
  woodcutting: {name: 'Woodcutting', col: '#b8d080', per: [{stat: 'woodcut.power', mul: .03}, {stat: 'woodcut.extra', add: .01}]},
};

// how much XP an action gives (the systems that give it read these)
export const XP = {
  chop: 4,         // a blow that bites into a tree
  fell: 18,        // a tree down (x its size: content/woodcut.js)
  gather: 1,       // a log picked up
};
