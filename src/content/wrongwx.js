// WRONG WEATHER (data; docs/WEATHER.md "Wrong weather"): the four weathers that break a rule, rare, each with a rule you can learn.
// Pure: the browser (features/wrongwx.js), the schedule both sides run (sim/wrongwx.js) and the co-op server (server/room.mjs:
// whom the cloud follows) read this one file. Times are in-game hours (an in-game hour is ~50 s at the default day).
//   chance   the odds an in-game day has one (never day 0); its start between start[0] and start[1] o'clock
//   rainup   UPWARD RAIN: a column r [min, max] m across over the lake where the rain falls up; inside it you stay dry and light
//            (speed x light); over the water fish lift out and hang in the air (fish of them), E grabs one (a catch of the lake,
//            luck +1 step). dur h
//   cloud    THE FOLLOWING CLOUD: a small low cloud picks one player (online the server's pick) and rains on them only (wet and
//            cold build fast: soak, chill a second); under a roof, in the hut or the cave for lose s it loses you; touch a friend
//            (within pass m) and it's theirs. When it rains itself out (dur h) it leaves a find where it ends (find)
//   still    THE STILL STORM: a storm with no thunder; every flash [min, max] s the world freezes for hold ms (the view: the sim
//            runs on), and in the frozen frame figures stand among the trees, near [first, last] m off and closer each flash;
//            when it ends one thing is left where the closest stood (find). dur h
//   prints   FOOTPRINTS FROM NOBODY (winter, lying snow): fresh tracks walk from the lake toward the forest's edge at speed m/s,
//            made as you watch; follow them and they end at a find (len [min, max] m); walk on them (within on m) and they stop
//   often    ?wrongwx=often: one every every in-game hours, each the next kind in turn
export const TUNE = {
  chance: .35, start: [9, 17],
  rainup: {dur: 1.2, r: [6, 9], light: 1.2, fish: 6, grab: 1.3, h: [1, 2.6]},
  cloud: {dur: 6, soak: .08, chill: .03, lose: 20, pass: .9, h: 4.2, find: 'unmelting_hail'},
  still: {dur: 1.5, flash: [6, 11], hold: 450, near: [14, 3.5], n: [3, 5], find: 'carved_figure'},
  prints: {dur: 3, speed: 1.1, len: [40, 60], on: .55, snow: .5, find: 'old_mitten'},
  often: {every: 2},
};
export const KINDS = ['rainup', 'cloud', 'still', 'prints'];
