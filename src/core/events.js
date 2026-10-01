// EVENTS: the catalog of every event the game emits: its name, who emits it, what it carries, who listens.
// Names are namespaced by what the event is about (`player.land` is the Ranger, `prop.land` a barrel dropping off the
// plateau): a listener reads the name, never a payload flag, to know whose event it is. A new event type goes here
// first, in the same commit as its emitter. In dev mode the loop warns once for a type that isn't listed (check()).
//
// THE QUEUE (host.events, one array): an emitter pushes {type, ...payload}. Each sim step the loop hands the whole queue
// to every feature's update(dt, evs) and empties it, so:
//   - what the player and the arrows emit inside the step reaches every feature in the SAME step (they run first);
//   - what a feature emits in its update reaches the others NEXT step (combat hands its own to the prop physics at once);
//   - a key handler's event (interact, jump) arrives with the next step;
//   - while paused only the ambient features get the queue (ui/pause.js); during hitstop it waits (F.always get []).
// Payload objects are the emitter's and are read in that step only: don't keep them (a prop / who reference is live).
// Positions are world metres (x east, y south, z / h up), turned from the player's view frame by the adapter.
//
//   name                 emitter                   payload                                  listeners
export const EVENTS = {
  'player.step':        ['sim/player/player.js',  'x, y, z, foot (L|R), big (0 walk, 1 turn)', 'atmos, flow, audio'],
  'player.land':        ['sim/player/player.js',  'x, y, z, foot?, big (2 sprint footfall / landing foot, 3 a drop > 1.2 m)', 'atmos, flow, wildlife, audio'],
  'player.jump':        ['sim/player/player.js',  'x, y, z (emitted from the Space key handler, turned there)', 'atmos, flow, wildlife, audio'],
  'player.splash':      ['sim/player/player.js',  'x, y', 'atmos, flow, wildlife, audio'],
  'player.roll':        ['(reserved: not emitted yet)', 'x, y', 'atmos (frost puff)'],
  'player.hit':         ['features/combat/core.js', 'x, y, vx, vy, player: true (a brute landed on him)', 'atmos, wildlife, audio, music'],
  'player.hurt':        ['features/combat/core.js', 'dmg, by (the brute | \'blast\'), x, y', 'game'],
  'arrow.hit':          ['sim/projectiles.js',    'x, y (the prop), vx, vy (the arrow), prop', 'game, wind, props, atmos, wildlife, audio, music'],
  'arrow.splash':       ['sim/projectiles.js',    'x, y, small: true', 'atmos, wildlife, audio'],
  'prop.break':         ['features/combat/core.js', 'x, y, kind, who (the prop), ash (burnt through)', 'props, atmos, wildlife, audio, music'],
  'prop.tip':           ['features/combat/props.js', 'x, y, kind, prop: true', 'wildlife, audio'],
  'prop.kick':          ['features/combat/props.js', 'x, y, kind, prop: true', 'wildlife, audio'],
  'prop.scrape':        ['features/combat/props.js', 'x, y, prop: true', 'wildlife, audio'],
  'prop.impact':        ['features/combat/props.js', 'x, y, kind, speed, prop: true', 'wildlife, audio'],
  'prop.land':          ['features/combat/props.js', 'x, y, kind, prop: true (off the plateau, hard)', 'atmos (also footprints: as before), wildlife, audio'],
  'prop.splash':        ['features/combat/props.js', 'x, y, prop: true (into the stream)', 'atmos, wildlife, audio'],
  'prop.respawn':       ['features/combat/props.js', 'x, y, prop: true (drifted / reset home)', 'audio, music (the same sound + stinger as a brute\'s)'],
  'brute.respawn':      ['features/combat/core.js', 'x, y (a sparring brute is back)', 'audio, music'],
  'enemy.kill':         ['features/combat/core.js', 'x, y, who (the enemy)', 'game'],
  'combat.explode':     ['features/combat/core.js', 'x, y, r', 'wind, lights, garden, props, atmos, flow, wildlife, audio, music'],
  'combat.loot':        ['features/combat/core.js', 'x, y, n (coins spilled)', 'wildlife, audio, music'],
  'combat.coin':        ['features/combat/core.js', 'x, y (the player: every 5th coin picked up)', 'audio, music'],
  'combat.trap':        ['features/combat/core.js', 'x, y (a vault trap bursts)', 'audio, music'],
  'chest.open':         ['features/combat/core.js', 'x, y', 'wildlife, audio, music'],
  'fire.ignite':        ['features/lights.js',    'x, y, kind', '(none yet)'],
  'fire.crackle':       ['features/lights.js',    'x, y, big', '(none yet)'],
  'fire.logFall':       ['features/lights.js',    'x, y', '(none yet)'],
  'fire.addWood':       ['features/lights.js',    'x, y', '(none yet)'],
  'garden.talk':        ['features/garden.js',    'x, y (the merchant)', '(none yet)'],
  'wildlife.birds_scatter': ['features/wildlife.js', 'x, y, n', 'wildlife, audio'],
  'wildlife.wings':     ['features/wildlife.js',  'x, y', 'audio'],
  'wildlife.caw':       ['features/wildlife.js',  'x, y', 'audio'],
  'wildlife.fish_jump': ['features/wildlife.js',  'x, y', 'audio'],
  'wildlife.frog_jump': ['features/wildlife.js',  'x, y', 'audio'],
  'wildlife.critter_dash': ['features/wildlife.js', 'x, y', 'audio'],
  'wildlife.splash':    ['features/wildlife.js',  'x, y, small: true, wl: true', 'atmos, wildlife, audio'],
  'wildlife.bird_perch': ['features/wildlife.js', 'x, y, h, prop, off, big, scared (a bird lands on / leaves a top)', 'wind'],
};

const warned = new Set();
// dev mode: each type not in the catalog warns once (the loop calls it on every step's queue)
export function check(evs) {
  for (let i = 0; i < evs.length; i++) {
    const t = evs[i].type;
    if (!(t in EVENTS) && !warned.has(t)) { warned.add(t); console.warn(`event '${t}' is not in the catalog (core/events.js)`); }
  }
}
