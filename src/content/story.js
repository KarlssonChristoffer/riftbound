// THE STORY (data; docs/STORY.md): what has happened, told in the game's own pictures, and Hilma's places. Pure data and pure
// rules (features/story.js plays and counts them; nothing on the server: each player's own, in their save).
//   THE PREMISE  The night the sky tore over the valley, Hilma (who kept the almanac before you) went down under the hill after the
//                sound and didn't come back. You wake by the tear with her almanac in your bag. Her voice is the almanac's: the
//                chapters' leads (content/almanac.js CHAPTERS lead), the margin notes at her places, the films' last lines.
//   BEATS        the films: {id: [SHOT]}; SHOT = {at: 'tear' | 'player' | 'forest' (where the camera looks: the tear, him
//                (followed), the forest's edge north of the spawn), a (rad round it, 0 = from the south; null: the game's heading),
//                turn, d, p, m, lh?, side? (features/cinema.js play: the director's orbit), lines: [LINE]}
//                LINE = {s (the words), say?: true (Hilma's own: in her colour)}. A shot lasts its lines' reading time.
//   PLACES       [{id, name, r (m: how near counts as found), at(X) -> {x, y} | null (X: the world's places, features/story.js),
//                note (Hilma's margin note: shown when found, kept in the Journal), hint (the Lead line before it's found)}].
//                A place whose at() is null in this world (no forest, the uncanny forest off) is left out: not counted, not led to.
//                The Lead is the first one in this order not found yet (near the spawn first, out to the mire).
//   readT(s)     s a line stays up; compass(dx, dy) 'NE'; farWord(d) 'near' | 'a walk' | 'far'
export const NAME = 'Hilma';

export const BEATS = {
  intro: [
    {at: 'tear', a: null, turn: .14, d: [34, 25], p: [34, 40], m: [1.1, 1.6], lh: [1.2], lines: [
      {s: 'The night the sky tore, nobody in the valley slept.'},
      {s: 'By morning it was still there. Humming, a step above the grass.'},
    ]},
    {at: 'forest', a: 0, turn: .1, d: [44, 48], p: [35, 33], m: [.95, .9], lh: [1], lines: [
      {s: 'The forest had moved in the night. Not much. A stone here. A tree there.'},
      {s: 'And under the hill, something had started to hum back.'},
    ]},
    {at: 'player', a: null, turn: .15, d: [38, 25], p: [36, 43], m: [1.05, 1.55], lh: [1], lines: [
      {s: 'You woke beside it, with a stranger\'s almanac in your bag.'},
      {s: 'If you are reading this, I did not come back. Start small. Make smoke. Then follow my pages. - Hilma', say: true},
    ]},
  ],
  tear: [
    {at: 'tear', a: null, turn: .2, d: [30, 22], p: [36, 42], m: [1.3, 1.8], lh: [1.2], lines: [
      {s: 'In the dark light the tear goes still.'},
      {s: 'Then it looks back. Not at you. Past you, at the hill, at what sleeps under it.'},
    ]},
    {at: 'forest', a: 0, turn: -.1, d: [46, 50], p: [33, 31], m: [.9, .85], lh: [1], lines: [
      {s: 'Far off, past the trees, a second one opens. Then a third.'},
      {s: 'The almanac has no more pages. The rest is yours to write.', say: true},
    ]},
  ],
};

// what the Lead says once every place is found, and once the almanac is full (the card's lead then)
export const ALL_FOUND = 'Every place I knew. The rest I never saw.';
export const AFTER = 'More tears are opening out there. (The next chapter isn\'t written yet.)';

const nearest = (list, o) => { let b = null, bd = 1e18; for (const p of list || []) { const d = (p.x - o.x) ** 2 + (p.y - o.y) ** 2; if (d < bd) { bd = d; b = p; } } return b; };

export const PLACES = [
  {id: 'tear', name: 'The Tear', r: 9, at: X => X.tear,
    note: 'It hums when nobody talks. Don\'t put your hand in it. I did.', hint: 'the tear, where you woke'},
  {id: 'stone', name: 'A Stone with a Face', r: 5, at: X => nearest(X.trolls?.stones, X.spawn),
    note: 'It faced the other way yesterday. Don\'t knock. Whatever you do, don\'t knock three times.', hint: 'a stone with a face, at the forest\'s edge'},
  {id: 'mouth', name: 'The Mouth Under the Hill', r: 6, at: X => X.cave,
    note: 'Warm air breathes out of it at night. That is where the humming comes from.', hint: 'warm air breathing out of a hill'},
  {id: 'quiet', name: 'The Quiet Stones', r: 5, at: X => X.uncanny?.on ? X.uncanny.U?.stones : null,   // (only with the uncanny forest on)
    note: 'No bird lands inside the ring. Stand in it long enough at night and you\'ll know why.', hint: 'a ring of stones where no bird lands'},
  {id: 'lake', name: 'The Still Lake', r: 11, at: X => X.forest?.lake,
    note: 'Fish rise here at dusk. Some of them have been somewhere else first. Look at their eyes.', hint: 'a still lake among the pines'},
  {id: 'clearing', name: 'The Clearing', r: 7, at: X => X.forest?.clearing,
    note: 'The trees around it all lean the same way. Away from the middle.', hint: 'a clearing the trees lean away from'},
  {id: 'spring', name: 'The Spring', r: 5, at: X => X.forest?.spring,
    note: 'The water comes up warm even in winter, and it tastes of pennies.', hint: 'water that comes up warm out of the ground'},
  {id: 'boulders', name: 'The Boulder Field', r: 8, at: X => X.forest?.boulders,
    note: 'Somebody carried these here. Count them by day, and again by night.', hint: 'a field of boulders somebody carried'},
  {id: 'gully', name: 'The Gully', r: 7, at: X => X.forest?.canyon?.pts?.[0] ? {x: X.forest.canyon.pts[0][0], y: X.forest.canyon.pts[0][1]} : null,
    note: 'The ground split here first. I heard it from the house, like a door slamming under the earth.', hint: 'where the ground split first'},
  {id: 'windthrow', name: 'The Windthrow', r: 12, at: X => X.forest?.storm,
    note: 'One gale, one night, and every tree fell the same way. The wind came from the tear.', hint: 'a strip of forest blown flat in one night'},
  {id: 'tors', name: 'The Tors', r: 7, at: X => X.forest?.tors?.[0] || X.forest?.mountain,
    note: 'From up here the forest looks like it is turning, slowly, around the tear.', hint: 'the rocks on top of the mountain'},
  {id: 'mire', name: 'The Mire', r: 13, at: X => X.forest?.mire,
    note: 'Lights walk here at night. Only one of them is honest. I followed the wrong one twice.', hint: 'the bog in the far north'},
];
export const PLACE_BY_ID = Object.fromEntries(PLACES.map(p => [p.id, p]));

export const readT = s => 1.8 + s.length * .048;
const DIRS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (dx, dy) => DIRS[((Math.round(Math.atan2(dx, -dy) / (Math.PI / 4)) % 8) + 8) % 8];   // (y grows south)
export const farWord = d => d < 35 ? 'near' : d < 90 ? 'a walk' : 'far';
