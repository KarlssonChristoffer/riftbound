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
  // the revolver (sim/player/gun.js, a gun loadout); gun = the weapon's id (content/weapons.js: peacemaker | brass_navy)
  'player.draw':        ['sim/player/gun.js',     'x, y, z, gun, hip (the first shot leaves from the hip)', 'audio'],
  'player.shoot':       ['sim/player/gun.js',     'x, y, h (the muzzle), z, vx, vy (unit: the way it flies), gun, fan, hip, left (rounds)', 'gunfx, flow (the camera kick), audio, wildlife, music'],
  'player.dryfire':     ['sim/player/gun.js',     'x, y, z, gun (the hammer falls on an empty chamber)', 'audio'],
  'player.reload':      ['sim/player/gun.js',     'x, y, z, gun, phase (start | eject | round | done), n (spent cases on eject, rounds in after)', 'gunfx (cases), audio'],
  'player.holster':     ['sim/player/gun.js',     'x, y, z, gun (the twirl ends in the holster)', 'audio'],
  'player.melee':       ['sim/player/gun.js',     'x, y, z, vx, vy (unit: the way of the blow), reach (m), arc (deg), dmg, push, gun (the pistol whip lands its blow)', 'gun (lands it through combat: combat.hit by melee)'],
  'player.hit':         ['features/combat/core.js, features/foes/sim.js, sim/hazards.js', 'x, y, vx, vy, player: true (a brute landed on him; a gunman\'s bullet hit him; a hazard went off on him)', 'atmos, wildlife, audio, music'],
  'player.hurt':        ['features/combat/core.js, features/foes/sim.js, sim/hazards.js', 'dmg, by (the brute | \'blast\' | the gunman | the enemy a hazard or a drain is from), x, y', 'game, battlemusic, affixes (an affix\'s blow: Glacial chills, Vampiric heals)'],
  // the desert sandbox's stakes (game/game.js, while features/foes.js says a fight is on)
  'player.down':        ['game/game.js',          'x, y (your health ran out in the desert sandbox: the gang stops shooting)', 'foes'],
  'player.respawn':     ['game/game.js',          'x, y (up again at the fort: the gunmen are gone, the next gang comes later)', 'foes'],
  'arrow.hit':          ['sim/projectiles.js',    'x, y (the prop), vx, vy (the arrow; a bullet: x its push), prop, kind? (bullet)', 'game, wind, props, atmos, wildlife, audio, music, gunfx'],
  'arrow.splash':       ['sim/projectiles.js',    'x, y, small: true (an arrow or a bullet into the stream)', 'atmos, wildlife, audio'],
  'bullet.impact':      ['sim/projectiles.js, features/foes/sim.js', 'x, y, h (where it ended), x0, y0, h0 (where it was as that step began), surf (hit | ground | water | tree | prop | air | player: a gunman\'s bullet in you), gun, dx, dy, foe? (the gunman\'s type)', 'gunfx, audio, wildlife, battlemusic'],
  'bullet.pierce':      ['sim/projectiles.js',    'x, y, h (where it leaves the body), vx, vy (unit: the way it flies on), who (the body it went through: a gunman, a brute), gun (the weapon id)', 'blood, audio (a through-shot)'],
  'bullet.ricochet':    ['sim/projectiles.js',    'x, y, h (where it glanced off), x0, y0, h0 (where it was as that step began), dx, dy, dh (unit: its way on), mat (metal | stone), gun, n (its ricochets so far), who (the solid): only while ricochets are on (the trick-shot range, ?rico=1)', 'gunfx (sparks, the streak, a scar), audio (the whine), trickshot (the plate rings, the count)'],
  'prop.break':         ['features/combat/core.js', 'x, y, kind, who (the prop), ash (burnt through)', 'props, atmos, wildlife, audio, music'],
  'prop.tip':           ['features/combat/props.js', 'x, y, kind, prop: true', 'wildlife, audio'],
  'prop.kick':          ['features/combat/props.js', 'x, y, kind, prop: true', 'wildlife, audio'],
  'prop.scrape':        ['features/combat/props.js', 'x, y, prop: true', 'wildlife, audio'],
  'prop.impact':        ['features/combat/props.js', 'x, y, kind, speed, prop: true', 'wildlife, audio'],
  'prop.land':          ['features/combat/props.js', 'x, y, kind, prop: true (off the plateau, hard)', 'atmos (also footprints: as before), wildlife, audio'],
  'prop.splash':        ['features/combat/props.js', 'x, y, prop: true (into the stream)', 'atmos, wildlife, audio'],
  'prop.respawn':       ['features/combat/props.js', 'x, y, prop: true (drifted / reset home)', 'audio, music (the same sound + stinger as a brute\'s)'],
  'brute.respawn':      ['features/combat/core.js', 'x, y (a sparring brute is back)', 'audio, music'],
  'enemy.kill':         ['features/combat/core.js', 'x, y, who (the enemy)', 'game, gun, battlemusic'],
  // the desert's gunmen (features/foes/sim.js); foe = their type (bandit | sheriff | bruiser), gun = the sound of their gun
  // (content/foes.js gun.sound: peacemaker = the revolver recipe's shot, coach = the bruiser's coach gun, its own recipe)
  'foe.draw':           ['features/foes/sim.js',  'x, y, z, foe (out of the holster)', 'audio'],
  'foe.aim':            ['features/foes/sim.js',  'x, y, z, foe, gun (the hammer back: the shot\'s telegraph begins)', 'audio'],
  'foe.shoot':          ['features/foes/sim.js',  'x, y, h (the muzzle), z, vx, vy (unit: the way it flies), foe, gun, who, n (rounds left)', 'gunfx, audio, wildlife'],
  'foe.reload':         ['features/foes/sim.js',  'x, y, z, foe, gun, phase (start | eject | round | done), n (spent cases on eject, rounds in after)', 'gunfx (cases), audio'],
  'foe.holster':        ['features/foes/sim.js',  'x, y, z, foe', 'audio'],
  'foe.ground':         ['features/foes/look.js (a view: nothing in the sim listens)', 'x, y, z, foe (a dead gunman hits the ground: the death clip\'s ground mark; a ragdoll (the default): its torso first touching it)', 'audio'],
  'foe.clip':           ['features/foes/look.js (a view: nothing in the sim listens)', 'x, y, z, foe, gun, mark (dump | load | close: the reload you see drops the spent shells, seats a shell, snaps shut)', 'audio'],
  'frontier.read':      ['features/frontier.js',  'x, y, what (wanted | sign), name (the poster\'s outlaw, or null)', 'foes (a bounty gang)'],
  'combat.hit':         ['features/combat/core.js', 'x, y, h, who (the target), kind, dmg, crit, broke, quiet (every damage: an enemy, a prop, a dummy); by (arrow | bullet | impact: a hit through the arrow chain; melee: the pistol whip; else undefined), hx, hy, hh (where the shot met it; else the target\'s x, y, h), dx, dy (unit: the shot\'s way; 0 without one)', 'audio (a gunman\'s flesh hit, a crit heavier; the player\'s hit-confirm on an enemy), gunfx (the hit marker), flow (the camera kick), blood'],
  // telegraphed ground zones (sim/hazards.js: features/affixes.js's burning ground, frost novas, lightning strikes)
  'hazard.burst':       ['sim/hazards.js',        'x, y, z, r, style (fire | frost | strike | blast | ring), col, by, data, src (the kit\'s name): a zone went off', 'its look (view/hazards.js)'],
  'combat.explode':     ['features/combat/core.js', 'x, y, r', 'wind, lights, garden, grass, props, atmos, flow, wildlife, audio, music'],
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
  'tumbleweed.bounce':  ['features/tumbleweed.js', 'x, y, k (0..1: how hard it came down / was knocked; near the player, on screen)', 'audio'],
  // the shrines experiment (features/shrines.js, ?shrines=1); its sounds ride on chest.open / combat.coin / combat.loot / combat.trap /
  // player.dryfire, emitted with it
  'shrine.use':         ['features/shrines.js',   'x, y, kind (chance | combat | blood | mountain | exchange | trader), what (pay | win | lose | bleed | call | clear | wake | yield | offer | trade | buy | spent), n (gold, health or foes), who (its prop)', 'shrines (its particles)'],
  // stage omens (features/omens.js: an omen turns the world's weather, wind and light into a stage's rules)
  'omen.begin':         ['features/omens.js',     'id (content/omens.js), stage (the run\'s stage index, -1 in the sandbox)', '(none yet)'],
  'omen.end':           ['features/omens.js',     'id', '(none yet)'],
  'omen.strike':        ['features/omens/storm.js', 'x, y, r (m: what it hurts), h (where the bolt ends: a rod\'s top), rod (what drew it: arrow | lead | a prop kind | \'\')', '(none yet)'],
  // the equipment experiment (features/equip/sim.js; gadget = a content/gadgets.js id)
  'equip.throw':        ['features/equip/sim.js', 'x, y, h (the hand), gadget (thrown: F let go)', 'audio'],
  'equip.bounce':       ['features/equip/sim.js', 'x, y, gadget, speed (m/s: off the ground, a prop, a wall or a body)', 'equip (view), audio'],
  'equip.land':         ['features/equip/sim.js', 'x, y, gadget (it comes to rest: a trap set, a scarecrow planted, dynamite stopped rolling)', 'equip (view), audio'],
  'equip.shatter':      ['features/equip/sim.js', 'x, y, z, h (where it broke): the fire flask, a burning pool there', 'equip (view), audio'],
  'equip.puff':         ['features/equip/sim.js', 'x, y, z, h, r: the smoke bomb pops, a cloud r m round', 'equip (view), audio'],
  'equip.blast':        ['features/equip/sim.js', 'x, y, z, wet (under water): dynamite goes off (combat.explode follows at once)', 'equip (view)'],
  'equip.fizzle':       ['features/equip/sim.js', 'x, y, gadget, sunk: it fell in the stream (the flask goes out, a trap sinks, dynamite sinks lit)', 'equip (view), audio'],
  'equip.snap':         ['features/equip/sim.js', 'x, y, who (a bear trap shuts on an enemy)', 'equip (view), audio'],
  'equip.hit':          ['features/equip/sim.js', 'x, y, gadget, who (an enemy whacks the scarecrow)', 'equip (view), audio'],
  'equip.break':        ['features/equip/sim.js', 'x, y, gadget (a scarecrow falls apart; an unsprung trap rusts away)', 'equip (view), audio'],
  'equip.latch':        ['features/equip/sim.js', 'x, y, h, who, prop (the grappling hook bites: an enemy, a prop, else the ground)', 'equip (view), audio'],
  'equip.pick':         ['features/equip/sim.js', 'x, y, gadget, bought (you take a gadget: a pickup, or a stage cache for gold)', 'equip (view), audio'],
  // the lasso (the equipment experiment's gun gadget): the cowboy's side (sim/player/lasso.js: x, y in the view frame, turned
  // by the loop), the loop's (features/equip/lasso.js), the look's (features/equip/lassolook.js: a view, nothing in the sim listens)
  'lasso.loose':        ['sim/player/lasso.js',   'x, y, z (the throw clip release mark: the loop leaves the hand)', 'equip (lasso)'],
  'lasso.pull':         ['sim/player/lasso.js',   'x, y, z (the yank clip pull mark: what he holds comes off its feet now)', 'equip (lasso)'],
  'lasso.drop':         ['sim/player/lasso.js',   'x, y, z, why (roll | knock | gun | ...: he lost the rope)', 'equip (lasso)'],
  'lasso.letgo':        ['sim/player/lasso.js',   'x, y, z, vx, vy, vz, why (key | water | bump | time | ground: off a swing)', 'equip (lasso), audio'],
  'lasso.bump':         ['sim/player/lasso.js',   'x, y, z (a swing ran into a wall, a trunk, a cliff face)', 'equip (lasso), audio'],
  'lasso.throw':        ['features/equip/lasso.js', 'x, y, h (the hand), at (enemy | prop | anchor | ground: what it goes for)', 'audio'],
  'lasso.catch':        ['features/equip/lasso.js', 'x, y, h, what (enemy | prop | anchor), who (the body / prop, or the prop the anchor is on)', 'audio'],
  'lasso.miss':         ['features/equip/lasso.js', 'x, y, h (the loop lands on the ground)', 'audio'],
  'lasso.yank':         ['features/equip/lasso.js', 'x, y, who, ok (false: a champion held against it)', 'audio'],
  'lasso.slam':         ['features/equip/lasso.js', 'x, y, who (a yanked body comes down)', 'audio'],
  'lasso.slip':         ['features/equip/lasso.js', 'x, y, who, why (slip | gone | drop | gun | jolt: the rope lets go of it)', 'audio'],
  'lasso.swing':        ['features/equip/lasso.js', 'x, y, h (the anchor: he swings)', 'audio'],
  'lasso.home':         ['features/equip/lasso.js', 'x, y (the loop is back in the hand)', '(none yet)'],
  'lasso.swish':        ['features/equip/lassolook.js (a view)', 'x, y (a turn of the loop overhead)', 'audio'],
  'lasso.creak':        ['features/equip/lassolook.js (a view)', 'x, y, k (the rope strains)', 'audio'],
  'combat.bowl':        ['features/combat/core.js', 'x, y, who, by (a flung body bowls another over: combat fling)', 'audio'],
  // the trick-shot range (features/trickshot/sim.js, ?trick=1: the sandbox only); who = its prop (a bottle, a can)
  'trick.shatter':      ['features/trickshot/sim.js', 'x, y, h, dx, dy (unit: the shot\'s way; 0 without one), by (bullet | arrow | blast | melee), who (the bottle), glass (amber | green | clear): a bottle breaks', 'trickshot (view: the glass), audio'],
  'trick.ping':         ['features/trickshot/sim.js', 'x, y, h, dx, dy, by, who (the can), air (it was in the air), n (the juggle so far: its airborne hits in a row): a can is hit', 'trickshot (view: the spin, the count), audio'],
  'trick.toss':         ['features/trickshot/sim.js', 'x, y, h, who (the can): a can tossed up out of the hand', 'audio'],
  'trick.clink':        ['features/trickshot/sim.js', 'x, y, k (0..1: how hard), who (the can), n (a juggle that ended here, else 0), best (it was a new best): a can bounces or lands', 'trickshot (view), audio'],
  'trick.ding':         ['features/trickshot/sim.js', 'x, y, h, k (0..1), who (the steel plate), edge (it met the edge of the plate: bullet.impact / bullet.ricochet sound it): a shot, a blast or the whip rings the plate', 'trickshot (view: the swing), audio (not an edge)'],
  'trick.reset':        ['features/trickshot/sim.js', 'x, y (the fence): the bottles and the stacked cans are set up again', 'trickshot (view), audio'],
  'trick.clear':        ['features/trickshot/sim.js', 'x, y (the fence), t (s: the run against the clock), shots, best (a new best time): the fence is cleared', 'trickshot (view: the banner), audio'],
};

const warned = new Set();
// dev mode: each type not in the catalog warns once (the loop calls it on every step's queue)
export function check(evs) {
  for (let i = 0; i < evs.length; i++) {
    const t = evs[i].type;
    if (!(t in EVENTS) && !warned.has(t)) { warned.add(t); console.warn(`event '${t}' is not in the catalog (core/events.js)`); }
  }
}
