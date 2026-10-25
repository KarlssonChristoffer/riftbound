// DAMAGE TYPES and their STATUSES (the shared combat model: /mnt/project-files/briefs/combat-shared.md; features/hits.js runs
// them). Pure data. A hit has a main part (dmg, type) and optional extra parts by type; each elemental part starts its
// type's status on the target. Physical types change how a blow lands: blunt knocks harder, pierce goes through a guard.
//   col      the number's colour (the main part's; an extra part shows its own beside it)
//   status   the status an elemental part starts: its numbers in STATUS
//   knock    x the hit's knock (blunt)        guard: true -> a gunman's block doesn't stop it (pierce)
export const TYPES = {
  slash:  {name: 'slash',  col: '#f2ead2'},
  pierce: {name: 'pierce', col: '#e8f0ff', guard: true},
  blunt:  {name: 'blunt',  col: '#e8d8b8', knock: 1.5},
  fire:   {name: 'fire',   col: '#ffa040', status: 'burn'},
  shock:  {name: 'shock',  col: '#9ad8ff', status: 'jolt'},
  frost:  {name: 'frost',  col: '#b8f0ff', status: 'chill'},
  venom:  {name: 'venom',  col: '#a8e060', status: 'poison'},
  void:   {name: 'void',   col: '#c890ff', status: 'void'},
};
export const TYPE_IDS = Object.keys(TYPES);
// STATUSES (seconds, shares of the part that started it):
//   burn     dot of the fire part per second for dur s; a new fire part refreshes it (the bigger dot stays)
//   poison   dot of the venom part per second for dur s, stacking up to max
//   chill    the target's speed share is `slow` for dur s (hits.slowOf(p): movers multiply by it)
//   jolt     stunned stun s; arcs `arc` of the shock part to the nearest other target within `reach` m (once: arcs don't arc)
//   void     the target is lifted `lift` m/s up for a floating moment (its handler's push), dur s of drifting
// tick: s between dot ticks; col: the status's particle colours (light -> dark)
export const STATUS = {
  burn:   {dot: .3, dur: 3, tick: .5, col: ['#fff4c0', '#ffc060', '#ff7a2a', '#a8341e']},
  poison: {dot: .15, dur: 6, tick: .75, max: 3, col: ['#e8ffc0', '#a8e060', '#6aa040', '#2e4a22']},
  chill:  {slow: .55, dur: 2.5, col: ['#ffffff', '#d8f8ff', '#9ad8f0', '#5a90b8']},
  jolt:   {stun: .3, arc: .5, reach: 3, col: ['#ffffff', '#d8f0ff', '#8ac0f0', '#5a88c0']},
  void:   {lift: 5.5, dur: 1.2, col: ['#f8e8ff', '#d8a8ff', '#9a60e0', '#4a2a7a']},
};
