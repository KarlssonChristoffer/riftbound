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
  'player.step':        ['sim/player/player.js',  'x, y, z, foot (L|R), big (0 walk, 1 turn), pace (m/s as the authored speeds put it: the sound\'s weight)', 'atmos, flow, audio'],
  'player.land':        ['sim/player/player.js',  'x, y, z, foot?, big (2 sprint footfall / landing foot, 3 a drop > 1.2 m), pace? (a footfall\'s: as player.step)', 'atmos, flow, wildlife, audio'],
  'player.jump':        ['sim/player/player.js',  'x, y, z (emitted from the Space key handler, turned there)', 'atmos, flow, wildlife, audio'],
  'player.splash':      ['sim/player/player.js',  'x, y, small? (his legs in the water: a leap that came up short caught the far bank)', 'atmos, flow, wildlife, audio'],
  'player.roll':        ['(reserved: not emitted yet)', 'x, y', 'atmos (frost puff)'],
  // thrown by a blast (sim/player/launch.js, a live loadout): flying, into a wall, down, up
  'player.launch':      ['sim/player/launch.js',  'x, y, vx, vy (m/s along the ground), up (m/s)', '(none yet: view/herorag.js follows P.state)'],
  'player.slam':        ['sim/player/launch.js',  'x, y, vx, vy (his speed into what stopped him), speed (m/s)', 'combat (hitstop, grit), audio'],
  'player.floored':     ['sim/player/launch.js',  'x, y (the body came to rest, lying)', 'audio'],
  'player.getup':       ['sim/player/launch.js',  'x, y', '(none yet)'],
  // the revolver (sim/player/gun.js, a gun loadout); gun = the weapon's id (content/weapons.js: peacemaker | brass_navy)
  'player.draw':        ['sim/player/gun.js',     'x, y, z, gun, hip (the first shot leaves from the hip)', 'audio'],
  'player.shoot':       ['sim/player/gun.js',     'x, y, h (the muzzle), z, vx, vy (unit: the way it flies), gun, fan, hip, left (rounds)', 'gunfx, flow (the camera kick), audio, wildlife, music'],
  'player.dryfire':     ['sim/player/gun.js',     'x, y, z, gun (the hammer falls on an empty chamber)', 'audio'],
  'player.reload':      ['sim/player/gun.js',     'x, y, z, gun, phase (start | eject | round | done), n (spent cases on eject, rounds in after)', 'gunfx (cases), audio'],
  'player.holster':     ['sim/player/gun.js',     'x, y, z, gun (the twirl ends in the holster)', 'audio'],
  'player.melee':       ['sim/player/gun.js',     'x, y, z, vx, vy (unit: the way of the blow), reach (m), arc (deg), dmg, push, gun (the pistol whip lands its blow)', 'gun (lands it through combat: combat.hit by melee)'],
  'player.hit':         ['features/combat/core.js, features/foes/sim.js, sim/hazards.js', 'x, y, vx, vy, player: true (a brute landed on him; a gunman\'s bullet hit him; a hazard went off on him)', 'atmos, wildlife, audio, music'],
  'player.hurt':        ['features/combat/core.js, features/foes/sim.js, sim/hazards.js, sim/player/launch.js', 'dmg, by (\'slam\': thrown into a wall | the brute | \'blast\' | the gunman | the enemy a hazard or a drain is from), x, y', 'game, battlemusic, affixes (an affix\'s blow: Glacial chills, Vampiric heals), fists (the guard up)'],
  // the desert sandbox's stakes (game/game.js, while features/foes.js says a fight is on)
  'player.down':        ['game/game.js',          'x, y (your health ran out in the desert sandbox: the gang stops shooting)', 'foes'],
  'player.respawn':     ['game/game.js',          'x, y (up again at the fort: the gunmen are gone, the next gang comes later)', 'foes'],
  'arrow.hit':          ['sim/projectiles.js',    'x, y (the prop), vx, vy (the arrow; a bullet: x its push), prop, kind? (bullet)', 'game, wind, props, atmos, wildlife, audio, music, gunfx'],
  'arrow.splash':       ['sim/projectiles.js',    'x, y, small: true (an arrow or a bullet into the stream)', 'atmos, wildlife, audio'],
  'bullet.impact':      ['sim/projectiles.js, features/foes/sim.js', 'x, y, h (where it ended), x0, y0, h0 (where it was as that step began), surf (hit | ground | water | tree | prop | air | player: a gunman\'s bullet in you), gun, dx, dy, foe? (the gunman\'s type)', 'gunfx, audio, wildlife, battlemusic'],
  'bullet.pierce':      ['sim/projectiles.js',    'x, y, h (where it leaves the body), vx, vy (unit: the way it flies on), who (the body it went through: a gunman, a brute), gun (the weapon id)', 'blood, audio (a through-shot)'],
  'bullet.ricochet':    ['sim/projectiles.js',    'x, y, h (where it glanced off), x0, y0, h0 (where it was as that step began), dx, dy, dh (unit: its way on), mat (metal | stone), gun, n (its ricochets so far), who (the solid): only while ricochets are on (the trick-shot range, ?rico=1); or off a deflector (features/bells.js, always): defl (plate | bell), shot (the bullet: live while it flies), mat metal', 'gunfx (sparks, the streak, a scar), audio (the whine), trickshot (the plate rings, the count), bells (rings, chains)'],
  'arrow.deflect':      ['sim/projectiles.js',    'x, y, h (where it glanced off), dx, dy, dh (unit: its way on), v (m/s), n (its glances so far), who (the deflector\'s prop), defl (plate | bell), shot (the arrow): an arrow off a deflector (features/bells.js)', 'bells (rings, chains, sparks), audio (a glance)'],
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
  'wildlife.howl':      ['features/wildlife/coyotes.js (a view)', 'x, y, kind (coyote | fox | wolf), call (howl | yips | bark): a canid at night calls, one howls and the pack answers', 'audio'],
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
  // gear (features/gear.js, docs/GEAR.md): what the player wears changed (offline at once; in co-op when the server took it)
  'gear.wear':          ['features/gear.js',      'x, y, ids (the set worn now, content/gear.js SLOTS order), kg, armor, speed (its numbers: setStats)', '(none yet)'],
  // the lasso (the equipment experiment's gun gadget): the cowboy's side (sim/player/lasso.js: x, y in the view frame, turned
  // by the loop), the loop's (features/equip/lasso.js), the look's (features/equip/lassolook.js: a view, nothing in the sim listens)
  'lasso.loose':        ['sim/player/lasso.js',   'x, y, z (the throw clip release mark: the loop leaves the hand)', 'equip (lasso)'],
  'lasso.pull':         ['sim/player/lasso.js',   'x, y, z (the yank clip pull mark: what he holds comes off its feet now)', 'equip (lasso)'],
  'lasso.drop':         ['sim/player/lasso.js',   'x, y, z, why (roll | knock | gun | ...: he lost the rope)', 'equip (lasso)'],
  'lasso.letgo':        ['sim/player/lasso.js',   'x, y, z, vx, vy, vz, why (key | water | bump | time | ground: off a swing)', 'equip (lasso), audio'],
  'lasso.bump':         ['sim/player/lasso.js',   'x, y, z (a swing ran into a wall, a trunk, a cliff face)', 'equip (lasso), audio'],
  'lasso.cinch':        ['sim/player/lasso.js',   'x, y, z (the snare clip: the rope snapped down onto the legs of what he holds)', 'equip (lasso), audio'],
  'lasso.throw':        ['features/equip/lasso.js', 'x, y, h (the hand), at (enemy | prop | anchor | ground: what it goes for)', 'audio'],
  'lasso.catch':        ['features/equip/lasso.js', 'x, y, h, what (enemy | prop | anchor), who (the body / prop, or the prop the anchor is on), cls (light | even | heavy | strong: its STRENGTH)', 'audio'],
  'lasso.miss':         ['features/equip/lasso.js', 'x, y, h (the loop lands on the ground)', 'audio'],
  'lasso.yank':         ['features/equip/lasso.js', 'x, y, who, ok (false: a strong one held against it), trip (it only tripped)', 'audio'],
  'lasso.slam':         ['features/equip/lasso.js', 'x, y, who (a yanked body comes down)', 'audio'],
  'lasso.slip':         ['features/equip/lasso.js', 'x, y, who, why (slip | gone | drop | gun | jolt | reeled | free: the rope lets go of it)', 'audio'],
  'lasso.swing':        ['features/equip/lasso.js', 'x, y, h (the anchor: he swings)', 'audio'],
  'lasso.home':         ['features/equip/lasso.js', 'x, y (the loop is back in the hand)', '(none yet)'],
  'lasso.snare':        ['features/equip/lasso.js', 'x, y, who, dur (too heavy to pull: its legs snared, rooted dur s)', 'audio'],
  'lasso.stones':       ['features/equip/lasso.js', 'x, y, z, who (the wall segment): a yank brought the top course of a broken wall down (world.pullWall; docs/exp/brawl.md)', 'audio'],
  // the ROPE WALL (sim/player/ropewall.js, docs/exp/ropeclimb.md) and the ladder under control (sim/player/ladder.js); also lasso.letgo
  // {why: top | ground | key | jump} at the rope wall's end (its rope comes back)
  'rope.step':          ['sim/player/ropewall.js, sim/player/ladder.js', 'x, y, z, big? (a bound lands), kind? (rung: a ladder): a boot on the face', ''],
  'rope.slip':          ['sim/player/ropewall.js', 'x, y, z: the boots slip off the face, he swings', ''],
  'rope.bound':         ['sim/player/ropewall.js', 'x, y, z: Space on the face, pushed off it', ''],
  'rope.top':           ['sim/player/ropewall.js', 'x, y, z: up and over the lip onto the top', ''],
  'lasso.swish':        ['features/equip/lassolook.js (a view)', 'x, y (a turn of the loop overhead)', 'audio'],
  'lasso.creak':        ['features/equip/lassolook.js (a view)', 'x, y, k (the rope strains)', 'audio'],
  'combat.bowl':        ['features/combat/core.js, features/foes/sim.js', 'x, y, who, by (a flung or kicked body bowls another over: combat fling, a body thrown by sim/bodyfly.js)', 'audio'],
  // BRAWL (docs/exp/brawl.md): the live cowboys' boot, barge, lift and throw (sim/player/brawl.js: x, y in the view frame, turned by
  // the loop; features/brawl.js does what they do), bodies thrown by them (sim/bodyfly.js: combat's brutes, the gunmen), and the
  // gunmen's called shots (features/calls.js says where a shot met him; features/foes/sim.js reacts)
  'player.kick':        ['sim/player/brawl.js',   'x, y, z, vx, vy (unit: the way of the blow), barge (the shoulder barge: every step of its blow, n its count)', 'brawl (lands it)'],
  'player.lift':        ['sim/player/brawl.js',   'x, y, z, phase (start | grab: it leaves the ground | put: set down | drop: let fall), vx, vy', 'brawl, audio'],
  'player.throw':       ['sim/player/brawl.js',   'x, y, z, vx, vy (unit: the way), d (m to where it should land), h (the hands)', 'brawl (launches it), audio'],
  'kick.hit':           ['features/brawl.js',     'x, y, who (the body / prop, or null), kind (body | a prop kind | hat | gun | air: a swing at nothing), barge', 'audio'],
  'carry.throw':        ['features/brawl.js',     'x, y, who (the prop, or null: a loose hat / gun), kind, heavy', 'audio'],
  'body.slam':          ['features/combat/core.js, features/foes/sim.js', 'x, y, z?, who, n (m/s into the wall): a thrown body hits a wall', 'audio'],
  'body.land':          ['features/combat/core.js, features/foes/sim.js', 'x, y, z?, who, n (m of drop): a thrown body comes down', 'audio'],
  'body.splash':        ['features/combat/core.js, features/foes/sim.js', 'x, y, z?, who: a thrown body lands in the water (arrow.splash follows for its look)', 'audio'],
  'body.fall':          ['features/foes/sim.js',  'x, y, z, who: a thrown gunman goes over the rim of the canyon', 'audio'],
  'foe.hat':            ['features/foes/sim.js',  'x, y, z, who, foe: his hat shot (or kicked) off', 'audio'],
  'foe.disarm':         ['features/foes/sim.js',  'x, y, z, who, foe, gun: the gun shot (or kicked) out of his hand', 'audio'],
  'foe.stagger':        ['features/foes/sim.js',  'x, y, z, who, foe: shot in the leg', 'audio'],
  'foe.pickup':         ['features/foes/sim.js',  'x, y, z, who, foe (hat | gun: what he picked up)', 'audio'],
  'foe.loose':          ['features/foes/sim.js',  'x, y, z, foe (hat | gun), n (0..1: how hard): a loose hat or gun bounces', 'audio'],
  // FISTS (docs/exp/fists.md): the live cowboys' unarmed fighting (sim/player/fists.js: x, y in the view frame, turned by the loop;
  // features/fists.js lands the blows) and the unarmed gunmen who box back (features/foes/brawler.js)
  'player.punch':       ['sim/player/fists.js',   'x, y, z, mv (content/fists.js MOVES), hand (L | R | B both | V kick), vx, vy (unit: the blow way), k (a heavy charge 0..1), n (the string count), counter, clinch (on the held foe)', 'fists (lands it)'],
  'player.grab':        ['sim/player/fists.js',   'x, y, z, vx, vy, reach, arc (the clinch hands close: what is in reach is held)', 'fists'],
  'player.toss':        ['sim/player/fists.js',   'x, y, z, vx, vy (unit: the throw way: the cursor): the held foe leaves his hands', 'fists'],
  'player.shove':       ['sim/player/fists.js',   'x, y, z, vx, vy (unit): the held foe shoved off', 'fists, audio'],
  'player.fist':        ['sim/player/fists.js',   'x, y, z, phase (charge: a heavy starts charging | throw: a move goes | slip | counter: the counter window opens), mv, hand, k, vx?, vy?', 'audio'],
  'fist.hit':           ['features/fists.js',     'x, y, h (the contact), who, kind (body | block | straw | prop | thing), mv, hand, power (0..1), counter, ko, dx, dy (unit: the blow way), kick (the camera px)', 'flow (the camera kick), audio'],
  'fist.whiff':         ['features/fists.js',     'x, y, h, mv, power, hand: a blow at nothing', 'audio'],
  'fist.grab':          ['features/fists.js',     'x, y, who, ok (the grab caught him)', 'audio'],
  'foe.fwind':          ['features/foes/brawler.js', 'x, y, z, who, foe, n (1 a jab, 2 a haymaker): his punch telegraph begins', 'audio'],
  'foe.punch':          ['features/foes/brawler.js', 'x, y, z, who, foe, n (1 jab, 2 haymaker), phase (hit | block | slip | miss)', 'audio'],
  // the trick-shot range (features/trickshot/sim.js, ?trick=1: the sandbox only); who = its prop (a bottle, a can)
  'trick.shatter':      ['features/trickshot/sim.js', 'x, y, h, dx, dy (unit: the shot\'s way; 0 without one), by (bullet | arrow | blast | melee), who (the bottle), glass (amber | green | clear): a bottle breaks', 'trickshot (view: the glass), audio'],
  'trick.ping':         ['features/trickshot/sim.js', 'x, y, h, dx, dy, by, who (the can), air (it was in the air), n (the juggle so far: its airborne hits in a row): a can is hit', 'trickshot (view: the spin, the count), audio'],
  'trick.toss':         ['features/trickshot/sim.js', 'x, y, h, who (the can): a can tossed up out of the hand', 'audio'],
  'trick.clink':        ['features/trickshot/sim.js', 'x, y, k (0..1: how hard), who (the can), n (a juggle that ended here, else 0), best (it was a new best): a can bounces or lands', 'trickshot (view), audio'],
  'trick.ding':         ['features/trickshot/sim.js', 'x, y, h, k (0..1), who (the steel plate), edge (it met the edge of the plate: bullet.impact / bullet.ricochet sound it): a shot, a blast or the whip rings the plate', 'trickshot (view: the swing), audio (not an edge)'],
  'trick.reset':        ['features/trickshot/sim.js', 'x, y (the fence): the bottles and the stacked cans are set up again', 'trickshot (view), audio'],
  'trick.clear':        ['features/trickshot/sim.js', 'x, y (the fence), t (s: the run against the clock), shots, best (a new best time): the fence is cleared', 'trickshot (view: the banner), audio'],
  // the bells and ricochet plates (features/bells/sim.js: the sandbox, ?bells=0 off); who = its prop (a bell, a plate's)
  // the uncanny forest (features/uncanny.js, docs/UNCANNY.md)
  'uncanny.hum':        ['features/uncanny.js',   'x, y, id (a secret opened there: heron | stones | marks)', 'audio'],
  'uncanny.slide':      ['features/uncanny.js',   'x, y, kind (tree | rock): one of the night\'s walkers near the player starts its slide (at dusk, or home at dawn)', 'audio'],
  'uncanny.knock':      ['features/uncanny.js',   'x, y, vx, vy (m/s), drop (the item id they lost, or null): the night elk knocked the player down', '(none yet)'],
  'bells.ring':         ['features/bells/sim.js', 'x, y, h (the bell\'s middle), k (0..1: how hard), note (0..6: its step on the scale, sim TUNE.notes), who (the bell), by (bullet | arrow | blast | melee | can), dx, dy (unit: the blow\'s way; 0 without one)', 'bells (view: the swing, the clapper), audio (its note)'],
  'bells.ping':         ['features/bells/sim.js', 'x, y, h (where it was hit), k (0..1), who (the plate), by (bullet | arrow | blast): a steel plate rung', 'bells (view: a glint), audio (the plate\'s ping)'],
  'bells.chain':        ['features/bells/sim.js', 'x, y, h (its last glance), bells (rung by the one shot / blast), plates, n (glances in all), by (bullet | arrow | blast), best (a new best of the session), rec (the best so far)', 'bells (view: the floating text)'],
  // the persistent world (docs/GATHERING.md): what the player carries and learns (features/pack.js)
  'pack.add':           ['features/pack.js',      'x, y, id (content/items.js), n: things went into the pouch or the bag', 'audio'],
  'pack.reset':         ['features/pack.js',      '(none): a new world (the Sandbox menu): the pack and every system\'s saved part cleared', 'woodcut'],
  'skill.level':        ['features/pack.js',      'x, y (the player), skill (content/skills.js), level: a skill reached a new level', 'audio'],
  // woodcutting (sim/player/tool.js the swing, features/woodcut.js what it meets); who = the tree prop
  'player.chop':        ['sim/player/tool.js',    'x, y, z, vx, vy (unit: the blow\'s way), tool (content/items.js): a tool\'s swing lands', 'woodcut'],
  'tree.chop':          ['features/woodcut.js',   'x, y, h (the bite), who, k (0 a glance off wood too hard for the axe, else 0..1: how hard it shakes), left (blows), dx, dy (unit: him to the trunk)', 'wind (the crown shudders, leaves), woodcut (view: chips), audio'],
  'tree.fell':          ['features/woodcut.js',   'x, y, who, vx, vy (unit: the way it falls), species, scale: the last bite; it starts to fall', 'audio'],
  'tree.land':          ['features/woodcut.js',   'x, y (where the crown comes down), who, r (the crown\'s radius)', 'woodcut (view: leaves, dust, the shake), audio'],
  'tree.logs':          ['features/woodcut.js',   'x, y, who, n: the fallen trunk breaks into n logs', 'woodcut (view: dust), audio'],
  'tree.grow':          ['features/woodcut.js',   'x, y, who: a stump has grown back into its tree', '(none yet)'],
  'tool.hit':           ['features/woodcut.js',   'x, y, who, kind (body | a prop kind): a tool\'s swing meets a foe or a dummy', 'audio'],
  'tool.whiff':         ['features/woodcut.js',   'x, y: a tool\'s swing at nothing', 'audio'],
  'bells.toll':         ['features/bells/view.js (a view: nothing in the sim listens)', 'x, y, h, k (0..1), note, who (the bell): its clapper strikes it again as it swings', 'audio (its note, softer)'],
};

const warned = new Set();
// dev mode: each type not in the catalog warns once (the loop calls it on every step's queue)
export function check(evs) {
  for (let i = 0; i < evs.length; i++) {
    const t = evs[i].type;
    if (!(t in EVENTS) && !warned.has(t)) { warned.add(t); console.warn(`event '${t}' is not in the catalog (core/events.js)`); }
  }
}
