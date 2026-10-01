// Game flow: menu -> run through four generated biomes -> victory or death. Input, camera, HUD.
import {THREE, G, V, rand, randi, pick, dist2, camera, render, newScene, updateFX, parts, after, fx, add, glow, glowSprite, shockwave, toScreen, C} from './core.js';
import {loadAssets} from './assets.js';
import {GameMap, CS} from './map.js';
import {BIOMES} from './biomes.js';
import {spawnMob, killEnemy, enemyUpdate, rollMob, MOBS, weakText} from './mobs.js';
import {CLASSES, createHero, heroUpdate, castSlot, dodge, updateDrops, updateHazards, dropGold, skillDef, sigDef, secondaryDown, secondaryUp, usePotion, UNLOCK, SLOT_LEVEL, xpNeed} from './entities.js';
import {SKILLS} from './skills.js';
import {alive, center, nearest, ELEM, isUnstoppable} from './combat.js';
import {rollCards, applyCard, rollUnlock, rollPoint, PASSIVES, ITEMS, AUGS} from './cards.js';
import {SIGS, RUNES, CLASS_SIGS} from './sigs.js';
import {initAudio, sfx, setDrone, toggleMute, audioBlocked} from './audio.js';
import * as Hub from './hub.js';
import {pollPad, pressed, released, held, anyInput, rumble, glyph, BTN, Pad} from './gamepad.js';
import './gfxmenu.js';

const $ = s => document.querySelector(s);
const canvas = $('#c');
G.hazards = []; G.partyScale = 1; G.inputMode = 'mouse';
G.diff = () => 1 + G.run.biome * .6 + G.run.biomeTime / 60 * .1;

// ---------- run / biome setup ----------
function startRun(clsId) {
  G.run = {cls: clsId, biome: 0, time: 0, biomeTime: 0, rerolls: 0};
  G.hero = createHero(clsId); Hub.runStart(G.hero);
  startBiome(0);
  $('#menu').classList.add('hidden'); $('#hud').classList.remove('hidden'); G.state = 'play';
  toast(BIOMES[0].name);
}
function startBiome(i) {
  const h = G.hero; if (G.scene) G.scene.remove(h.g);
  codexQ = []; codexT = 0;
  const scene = newScene(); G.hazards = []; G.flow = null; G.portal = null; G.bossSpawned = false; G.boss = null; G.interact = []; G.pending = []; G.events = []; $('#event').classList.remove('show');
  G.run.biome = i; G.run.biomeTime = 0; G.biome = BIOMES[i]; G.map = new GameMap();
  document.documentElement.style.setProperty('--accent', G.biome.accent);
  G.biome.build(scene, G.map); G.map.buildFog(scene); setDrone(i);
  const sp = G.map.roomCenter(G.map.spawn); h.g.position.copy(sp); h.path = []; h.attackTarget = null; h.secondWind = true; scene.add(h.g);
  camera.position.set(sp.x, 14.5, sp.z + 9.5);
  populate();
  G.reticle = add(scene, new THREE.RingGeometry(.55, .7, 40), glow(0xffffff, 2, {add: true, ds: true}), 0, .08, 0, {rx: -Math.PI / 2}); G.reticle.visible = false;
  { const gm = new THREE.PlaneGeometry(.14, 2.2); gm.rotateX(-Math.PI / 2); G.aimLine = new THREE.Mesh(gm, glow(0xffffff, 1.5, {add: true, ds: true})); G.aimLine.material.opacity = .35; scene.add(G.aimLine); G.aimLine.visible = false; }
  $('#bname').textContent = G.biome.name; $('#bossbar').classList.add('hidden');
  // spawn portal effect
  shockwave(sp, 0xffffff, 3, .6, 3); parts.burst(V(sp.x, 1, sp.z), 60, {col: C.white, b: 3, speed: 4, life: .6, size: .25});
}
// a pack mixes the biome's mob types; at most one healer / summoner / turret per pack, swarms come in groups
function packIds(n) {
  const B = G.biome, out = []; let guard = 0;
  while (out.length < n && guard++ < 50) {
    const id = rollMob(B), D = MOBS[id];
    if (['healer', 'summoner', 'turret'].includes(D.beh) && out.some(x => MOBS[x].beh === D.beh)) continue;
    const g = D.group ? randi(D.group[0], D.group[1]) : 1; for (let k = 0; k < g; k++) out.push(id);
  }
  return out;
}
function populate() {
  const M = G.map, B = G.biome, solo = B.roster.filter(r => !MOBS[r[0]].group && MOBS[r[0]].beh !== 'turret');
  for (const r of M.rooms) {
    const n = Math.max(2, Math.round(r.w * r.h / 18));
    const pack = (ids, tier = 'normal', name) => { for (const id of ids) G.pending.push({id, pos: M.randomIn(r, 1.5), tier, name, room: r}); };
    if (r.kind === 'spawn') continue;
    if (r.kind === 'pack') pack(packIds(randi(4, 4 + n)));
    if (r.kind === 'elite') { pack([rollMob(B, solo)], 'elite'); pack(packIds(randi(3, 5))); }
    if (r.kind === 'mini') { G.pending.push({id: rollMob(B, solo), pos: M.roomCenter(r), tier: 'mini', name: B.mini, room: r}); pack(packIds(2)); }
    if (r.kind === 'chest') { pack(packIds(randi(2, 3))); addChest(M.roomCenter(r)); }
    if (r.kind === 'shrine') addShrine(M.roomCenter(r));
    if (r.kind === 'ambush') G.events.push({kind: 'ambush', room: r, state: 'idle'});
    if (r.kind === 'cursed') { addCursed(M.roomCenter(r)); pack(packIds(2)); }
  }
}
function addChest(p) {
  const g = new THREE.Group(); g.position.copy(p); G.scene.add(g);
  const wood = new THREE.MeshStandardMaterial({color: 0x6a4222, roughness: .8}), gold = new THREE.MeshStandardMaterial({color: 0xd4a640, metalness: .9, roughness: .3});
  add(g, new THREE.BoxGeometry(1.1, .6, .75), wood, 0, .3, 0); const lid = add(g, new THREE.BoxGeometry(1.14, .25, .79), wood, 0, .72, 0); add(g, new THREE.BoxGeometry(1.16, .1, .1), gold, 0, .6, .38);
  const s = glowSprite(0xffc84a, 1.5, 2.2); s.position.y = .8; g.add(s);
  G.interact.push({kind: 'chest', g, lid, glow: s, used: false});
}
function addShrine(p) {
  const g = new THREE.Group(); g.position.copy(p); G.scene.add(g);
  const st = new THREE.MeshStandardMaterial({color: 0x6d7686, roughness: .85, flatShading: true});
  add(g, new THREE.CylinderGeometry(.7, .9, .4, 8), st, 0, .2, 0); add(g, new THREE.CylinderGeometry(.25, .35, 1.4, 8), st, 0, 1.1, 0);
  const kind = pick(['haste', 'power', 'renew']), col = {haste: 0x7fffd4, power: 0xff5a3a, renew: 0x5aff7a}[kind];
  const orb = add(g, new THREE.SphereGeometry(.28, 16, 12), glow(col, 3), 0, 2.1, 0); const s = glowSprite(col, 2, 2.5); s.position.y = 2.1; g.add(s);
  G.interact.push({kind: 'shrine', shrine: kind, g, orb, glow: s, col, used: false});
}
function spawnPortal(p) {
  const g = new THREE.Group(); g.position.set(p.x, 0, p.z); G.scene.add(g);
  add(g, new THREE.TorusGeometry(1.4, .1, 10, 48), glow(0xffffff, 3), 0, 1.6, 0);
  const s = glowSprite(G.biome.accent, 2.5, 4); s.position.y = 1.6; g.add(s);
  G.portal = {g}; sfx('portal');
  toast(G.run.biome < 3 ? 'A portal opens' : 'The Rift is sealed');
}
// ---------- events ----------
function addCursed(p) {
  const g = new THREE.Group(); g.position.copy(p); G.scene.add(g);
  const st = new THREE.MeshStandardMaterial({color: 0x1a1016, roughness: .4, metalness: .5, flatShading: true});
  add(g, new THREE.CylinderGeometry(.8, 1, .3, 6), st, 0, .15, 0); add(g, new THREE.OctahedronGeometry(.5), st, 0, 1.5, 0, {s: [.7, 2.2, .7]});
  const eye = add(g, new THREE.SphereGeometry(.18, 12, 10), glow(0xff2a3a, 4), 0, 1.6, .33); const s = glowSprite(0xff2a3a, 2, 3); s.position.y = 1.5; g.add(s);
  G.interact.push({kind: 'cursed', g, eye, glow: s, used: false});
}
function eventSpawn(ev, ids, tier = 'normal') {
  const r = ev.room || G.map.roomAt(ev.at.x, ev.at.z);
  for (const id of ids) { let q = null; for (let k = 0; k < 12 && !q; k++) { const c = G.map.randomIn(r, 1); if (dist2(c, G.hero.g.position) > 3.5) q = c; } q = q || G.map.randomIn(r, 1);
    parts.burst(V(q.x, .5, q.z), 30, {col: C.red, b: 3, speed: 4, life: .5, size: .3, up: 2}); const e = spawnMob(id, q, tier); e.aggro = true; e.event = ev; }
}
const eventLeft = ev => G.enemies.filter(e => e.event === ev && e.dead <= 0).length;
function setEvent(text) { const el = $('#event'); if (text) { el.innerHTML = text; el.classList.add('show'); } else el.classList.remove('show'); }
function updateEvents(dt) {
  const h = G.hero;
  for (const ev of G.events) {
    if (ev.kind === 'ambush') {
      if (ev.state === 'idle' && G.map.roomAt(h.g.position.x, h.g.position.z) === ev.room) { ev.state = 'w1'; toast('Ambush!'); rumble(.5, .5, 250); G.shake = .3; eventSpawn(ev, packIds(4)); }
      else if (ev.state === 'w1') { setEvent(`<b>Ambush</b> Wave 1 of 2 · ${eventLeft(ev)} left`); if (!eventLeft(ev)) { ev.state = 'w2'; toast('Wave 2'); eventSpawn(ev, packIds(5)); } }
      else if (ev.state === 'w2') { setEvent(`<b>Ambush</b> Wave 2 of 2 · ${eventLeft(ev)} left`); if (!eventLeft(ev)) { ev.state = 'done'; setEvent(''); dropGold(h.g.position, randi(30, 50)); after(.8, () => openCards('silver', 'Ambush survived')); } }
    }
    if (ev.kind === 'cursed' && ev.state === 'active') {
      ev.t -= dt; setEvent(`<b>Cursed Shrine</b> Kill them all · <span class="${ev.t < 8 ? 'hot' : ''}">${Math.ceil(ev.t)}s</span> · ${eventLeft(ev)} left`);
      if (!eventLeft(ev)) { ev.state = 'done'; setEvent(''); toast('Curse lifted'); dropGold(ev.at, randi(40, 70)); after(.8, () => openCards('gold', 'Cursed Shrine cleansed')); }
      else if (ev.t <= 0) { ev.state = 'done'; setEvent(''); toast('The curse fades…'); for (const e of G.enemies) if (e.event === ev) e.event = null; }
    }
  }
}
function updateInteract(dt, t) {
  const h = G.hero; if (h.dead) return;
  for (const o of G.interact) {
    if (o.used) continue; const d = dist2(o.g.position, h.g.position);
    if (o.kind === 'shrine') o.orb.position.y = 2.1 + Math.sin(t * 2) * .1;
    if (d > 1.9) continue; o.used = true;
    if (o.kind === 'cursed') {
      o.glow.visible = false; o.eye.material.color.setRGB(.3, .05, .08); shockwave(o.g.position, 0xff2a3a, 6, .6, 4); G.shake = .3; rumble(.6, .5, 300);
      const ev = {kind: 'cursed', state: 'active', t: 30, at: o.g.position.clone()}; G.events.push(ev); toast('Cursed Shrine: survive the onslaught!');
      const B = G.biome, solo = B.roster.filter(r => !MOBS[r[0]].group && MOBS[r[0]].beh !== 'turret'); eventSpawn(ev, [rollMob(B, solo)], 'elite'); eventSpawn(ev, packIds(4));
    } else if (o.kind === 'chest') {
      fx(.4, k => { o.lid.rotation.x = -k * 1.6; o.lid.position.z = -k * .3; }); o.glow.visible = false;
      dropGold(o.g.position, randi(25, 45)); parts.burst(V(o.g.position.x, 1, o.g.position.z), 60, {col: C.gold, b: 4, speed: 5, life: .7, size: .25, up: 2});
      after(.6, () => openCards('silver', 'Treasure chest'));
    } else {
      o.glow.visible = false; o.orb.visible = false; shockwave(o.g.position, o.col, 4, .6, 3);
      const b = {haste: ['haste', 'Shrine of Haste: +40% speed'], power: ['power', 'Shrine of Power: +50% damage'], renew: ['renew', 'Shrine of Renewal: full heal']}[o.shrine];
      if (o.shrine === 'renew') h.hp = h.maxHp; else h.buffs.push({kind: b[0], t: 30});
      toast(b[1]);
    }
  }
  if (G.portal && dist2(G.portal.g.position, h.g.position) < 1.8) {
    const next = G.run.biome + 1; G.portal = null;
    if (next >= BIOMES.length) return endRun(true);
    Hub.offerExtract(next, () => { startBiome(next); toast(BIOMES[next].name); }, () => endRun('extract'));
  }
}

// ---------- kills & rewards ----------
G.onKill = e => {
  if (e.dead > 0) return; killEnemy(e); if (e.elite) rumble(e.boss ? 1 : .35, e.boss ? .7 : .25, e.boss ? 450 : 150);
  Hub.onKill(e);
  if (e.tier === 'elite') after(.8, () => openCards('silver', 'Elite slain'));
  if (e.tier === 'mini') after(1, () => openCards('gold', `${e.name} defeated`));
  if (e.tier === 'boss') { after(1.4, () => openCards('prismatic', `${e.name} defeated`)); after(1.6, () => spawnPortal(e.g.position)); $('#bossbar').classList.add('hidden'); G.boss = null; }
};
G.onLevelUp = (h, lvl) => {
  toast(`Level ${lvl}`); rumble(.4, .4, 200);
  const slot = UNLOCK[lvl];
  if (slot !== undefined) after(.6, () => openCards(null, `Level ${lvl}: unlock ${slot === 3 ? 'your ultimate' : 'a skill'} on {k${slot}}`, () => rollUnlock(h, slot), 'Choose a new skill'));
  else after(.6, () => openCards(null, `Level ${lvl}: skill point`, () => rollPoint(h), 'Level up'));
};
// ---------- pause / character sheet ----------
function togglePause() {
  if (G.state !== 'play' || G.cards || G.hero.dead) return;
  const el = $('#pause'), open = el.classList.contains('hidden');
  if (!open) { el.classList.add('hidden'); G.paused = false; return; }
  G.paused = true; const h = G.hero, row = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;
  const sig = i => { const s = h.sig[i], S = SIGS[s.id], E = ELEM[s.elem]; return `<div class="it"><i class="ti ti-${S.icon}" style="color:${E.css}"></i><div><b>${S.name}</b> <em>rank ${s.rank}/5 · <span style="color:${E.css}">${E.name}</span></em><small>${s.runes.length ? s.runes.map(r => RUNES[r].name).join(' · ') : 'No runes yet'}</small></div></div>`; };
  const sk = k => { const d = skillDef(h, k); return d ? `<div class="it"><i class="ti ti-${d.icon}" style="color:${d.color}"></i><div><b>${d.name}</b> <em>${keyText('{k' + k + '}')}</em><small>${d.desc}</small></div></div>` : `<div class="it off"><i class="ti ti-lock"></i><div><b>${k === 3 ? 'Ultimate' : 'Skill slot'}</b><small>Unlocks at level ${SLOT_LEVEL[k]}</small></div></div>`; };
  const pas = PASSIVES[h.id].filter(p => h.pas[p.id]).map(p => `<div class="it"><i class="ti ti-${p.icon}" style="color:${h.cls.color}"></i><div><b>${p.name}</b><small>${p.text}</small></div></div>`).join('') || '<p class="none">No passives yet. They come from level-ups and rewards.</p>';
  const nm = (L, k) => (L.find(x => x.id === k) || {name: k}).name, pct = (v, sign) => (v === 0 ? '' : sign) + Math.abs(v) + '%';
  const items = Object.entries(h.items).map(([k, v]) => `<span class="chip">${nm(ITEMS, k)}${v > 1 ? ' ×' + v : ''}</span>`).join('') + Object.keys(h.aug).map(k => `<span class="chip aug">${nm(AUGS, k)}</span>`).join('') + Hub.relicChips(h) + Hub.synChips(h);
  $('#pausebody').innerHTML = `<div class="col"><h3>${h.cls.name} · level ${h.level}</h3>${row('Health', Math.round(h.hp) + ' / ' + Math.round(h.maxHp))}${row('Damage', pct(Math.round((h.stats.dmg - 1) * 100), '+'))}${row('Crit chance', Math.round(h.stats.crit * 100) + '%')}${row('Move speed', Math.round(h.stats.speed * 100) + '%')}${row('Cooldowns', pct(Math.round((1 - h.stats.cdr) * 100), '-'))}${row('Damage taken', pct(Math.round(h.stats.armor * 100), '-'))}${row('Kills · Gold', h.kills + ' · ' + h.gold)}<h4>Items and augments</h4><div class="chips">${items || '<p class="none">None yet.</p>'}</div></div>
    <div class="col"><h4>Signature spells</h4>${sig(0)}${sig(1)}<h4>Skills</h4>${[0, 1, 2, 3].map(sk).join('')}</div><div class="col"><h4>Passives</h4>${pas}</div>`;
  el.classList.remove('hidden');
}
let codexQ = [], codexT = 0;
G.onNewMob = (D, id) => { G.run.seen = G.run.seen || new Set(); if (G.run.seen.has(id)) return; G.run.seen.add(id); codexQ.push(D); };
function updateCodex(dt) {
  codexT -= dt; const el = $('#codex');
  if (codexT <= 0 && codexQ.length) { const D = codexQ.shift(), w = weakText({elem: D.elem}); el.innerHTML = `<div class="ck">New enemy</div><b>${D.name}</b><span>${w}</span><p>${D.tip}</p>`; el.classList.add('show'); codexT = 7; }
  else if (codexT <= 0) el.classList.remove('show');
}
let queue = [];
function openCards(min, why, roll, title = 'Choose your reward') {
  if (G.hero.dead) return;
  if (G.paused) { queue.push([min, why, roll, title]); return; }
  G.roll = roll || (() => rollCards(G.hero, min));
  G.paused = true; G.cardMin = min; cardIdx = 0; $('#cards h2').textContent = title; G.cardWhy = why; $('#cardsub').innerHTML = keyText(why); drawCards(G.roll());
  $('#cards').classList.remove('hidden');
}
function drawCards(cards, fast = false) {
  // Cards are dealt face down, flip, roll through decoys like a slot machine and land one by one.
  // Nothing can be picked until every card has landed, so stray clicks from combat never choose anything.
  if (G.cardTimers) G.cardTimers.forEach(t => { clearTimeout(t); clearInterval(t); });
  const row = $('#cardrow'); row.innerHTML = ''; row.classList.remove('ready'); G.cards = cards; G.cardsReady = false;
  const tyName = {passive: 'Passive', unlock: 'Unlock', skill: 'Swap skill', ultimate: 'Ultimate', mutation: 'Mutation', augment: 'Augment', item: 'Item', imbue: 'Imbue'};
  const decoys = [...G.roll(), ...G.roll(), ...G.roll()];
  const face = c => `<div class="ty">${c.rarity} · ${c.label || tyName[c.type]}</div><div class="ic"><i class="ti ti-${c.icon}"></i></div><h3>${c.name}</h3><p>${keyText(c.text)}</p>`;
  const sp = fast ? .6 : 1, timers = G.cardTimers = [];
  const later = (ms, fn) => timers.push(setTimeout(fn, ms * sp));
  cards.forEach((c, i) => {
    let fake = decoys.filter(x => x.name !== c.name); if (!fake.length) fake = [{rarity: 'silver', type: c.type, icon: 'question-mark', color: '#888', name: '???', text: ''}];
    const d = document.createElement('div'); d.className = 'card deal'; d.style.setProperty('--r', '#6a6470'); d.style.setProperty('--c', c.color);
    d.innerHTML = `<div class="front">${face(fake[(i * 5 + 1) % fake.length])}<div class="k"></div></div><div class="back"><span>?</span></div>`; // never the real card until it lands
    d.card = c; d.addEventListener('pointerdown', () => { d.armed = G.cardsReady; });
    d.onclick = () => { if (d.armed) chooseCard(i); };
    row.appendChild(d);
    const front = d.querySelector('.front');
    later(60 + i * 110, () => d.classList.replace('deal', 'down'));
    const flipAt = 420 + i * 230, rollFor = 420 + i * 170;
    later(flipAt, () => {
      d.classList.remove('down'); d.classList.add('rolling'); sfx('flip', {}, .02); let k = 0;
      const spin = setInterval(() => { const x = fake[(k++ * 7 + i * 3) % fake.length]; front.innerHTML = face(x) + '<div class="k"></div>'; d.style.setProperty('--c', x.color); }, 55);
      timers.push(spin);
      later(rollFor, () => {
        clearInterval(spin); front.innerHTML = face(c) + '<div class="k"></div>'; d.style.setProperty('--c', c.color); d.style.setProperty('--r', `var(--${c.rarity})`);
        d.classList.remove('rolling'); d.classList.add('land', 'r-' + c.rarity);
        sfx('land', {rarity: c.rarity}, .02); if (c.rarity !== 'silver') rumble(c.rarity === 'prismatic' ? .6 : .3, .3, 160);
      });
    });
  });
  const done = 420 + (cards.length - 1) * 230 + 420 + (cards.length - 1) * 170 + 320;
  later(done, () => {
    G.cardsReady = true; row.classList.add('ready');
    row.querySelectorAll('.card .k').forEach((k, i) => { k.textContent = G.inputMode === 'pad' ? glyph(BTN.a) + ' to pick' : 'Click or press ' + (i + 1); });
    focusUI();
  });
  focusUI();
  const cost = 20 + G.run.rerolls * 15; const rb = $('#reroll'); rb.textContent = `${G.inputMode === 'pad' ? glyph(BTN.x) + '  ' : ''}Reroll (${cost} gold)`; rb.disabled = G.hero.gold < cost;
  rb.onclick = () => { if (!G.cardsReady || G.hero.gold < cost) return; G.hero.gold -= cost; G.run.rerolls++; drawCards(G.roll(), true); };
}
function chooseCard(i) {
  if (!G.cardsReady) return;
  const c = G.cards && G.cards[i]; if (!c) return; sfx('pick'); applyCard(G.hero, c); G.cards = null; G.cardsReady = false;
  $('#cards').classList.add('hidden'); G.paused = false; buildBar(); toast(c.name);
  if (queue.length) { const q = queue.shift(); after(.3, () => openCards(...q)); }
}
function endRun(won) {
  G.state = 'over'; G.paused = true; const h = G.hero, r = G.run;
  $('#overtitle').textContent = won === 'extract' ? 'Extracted' : won ? 'Victory' : 'Defeated';
  const m = Math.floor(r.time / 60), s = Math.floor(r.time % 60);
  const build = [0, 1, 2, 3].map(k => skillDef(h, k)).filter(Boolean).map(d => d.name).join(', ');
  $('#overstats').innerHTML = `${won === 'extract' ? 'Made it home from ' + G.biome.name : won ? 'You sealed the Rift' : 'Fell in ' + G.biome.name}<br>Time ${m}:${String(s).padStart(2, '0')} · Kills ${h.kills} · Gold ${h.gold}<br>Build: ${build}<br>Items: ${Object.entries(h.items).map(([k, v]) => (ITEMS.find(x => x.id === k) || {name: k}).name + (v > 1 ? ' ×' + v : '')).join(', ') || 'none'}<br>Passives: ${PASSIVES[h.id].filter(p => h.pas[p.id]).map(p => p.name).join(', ') || 'none'}`;
  $('#overstats').insertAdjacentHTML('beforeend', Hub.bankRun(won === 'extract' ? 'extract' : won ? 'win' : 'death'));
  $('#over').classList.remove('hidden');
}
G.onHeroDeath = () => endRun(false);
G.onHeroHurt = () => { rumble(.55, .35, 140); const e = $('#hurt'); e.style.opacity = 1; setTimeout(() => e.style.opacity = 0, 180); };
let toastT = 0;
function toast(msg) { const e = $('#toast'); e.textContent = msg; e.style.opacity = 1; toastT = 2.2; }
G.toast = toast;

// ---------- input ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let mouse = {x: 0, y: 0, down: false}, repathT = 0;
function updateCursor() {
  ndc.set(mouse.x / innerWidth * 2 - 1, -(mouse.y / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); ray.ray.intersectPlane(ground, G.cursor);
  let best = null, bd = 55;
  for (const e of G.enemies) {
    if (!alive(e) || !G.map.seen(e.g.position.x, e.g.position.z)) continue;
    const s = toScreen(center(e)); const d = Math.hypot(s.x - mouse.x, s.y - mouse.y) - (e.elite ? 25 : 0); if (d < bd) { bd = d; best = e; }
  }
  G.hover = best; canvas.classList.toggle('attack', !!best);
}
let shiftDown = false, pressOnEnemy = false, holdT = 0, audioHinted = false;
const mouseAim = () => (G.hover && alive(G.hover) ? center(G.hover) : G.cursor).clone();
addEventListener('mousemove', e => { if (Math.hypot(e.clientX - mouse.x, e.clientY - mouse.y) > 4) setMode('mouse'); mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', e => {
  initAudio();
  if (G.state !== 'play' || G.paused) return; setMode('mouse'); updateCursor();
  const h = G.hero; if (!h || h.dead) return;
  if (e.button === 0) {
    mouse.down = true; holdT = 0; h.moveTo = null;
    if (shiftDown) { h.fireAt = G.cursor.clone(); h.attackTarget = null; h.path = []; pressOnEnemy = false; }
    else if (G.hover) { h.attackTarget = G.hover; pressOnEnemy = true; h.path = []; }
    else { pressOnEnemy = false; h.attackTarget = null; h.fireAt = null; h.path = G.map.path(h.g.position, G.cursor); shockwave(G.cursor.clone(), 0xffffff, .6, .35, 1.5); }
  } else if (e.button === 2) { mouse.right = true; secondaryDown(h, mouseAim); }
});
addEventListener('mouseup', e => {
  const h = G.hero;
  if (e.button === 0) { mouse.down = false; if (h) { h.fireAt = null; if (h.moveTo) { h.moveTo = null; h.path = []; } } }
  if (e.button === 2) { mouse.right = false; if (h) secondaryUp(h); }
});
canvas.addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keyup', e => { if (e.key === 'Shift') shiftDown = false; });
addEventListener('keydown', e => {
  const k = e.key.toLowerCase(); setMode('mouse'); if (e.key === 'Shift') shiftDown = true; initAudio();
  if (k === 'm' && !e.repeat) { toast(toggleMute() ? 'Sound off' : 'Sound on'); return; }
  if (k === 'tab') { e.preventDefault(); $('#mini').classList.toggle('big'); return; }
  if (k === 'escape' || k === 'p') { togglePause(); return; }
  if (G.state !== 'play') return;
  if (G.paused) { if (G.cards && !e.repeat && '123'.includes(k)) chooseCard(+k - 1); return; }
  const slot = '1234'.indexOf(k); if (slot >= 0 && !e.repeat) { updateCursor(); castSlot(G.hero, slot, mouseAim()); }
  if (k === 'q' && !e.repeat) usePotion(G.hero);
  if (k === ' ') { e.preventDefault(); updateCursor(); dodge(G.hero, G.cursor); }
});
// per-frame mouse handling: hold to follow the cursor, hold on an enemy to keep casting, Shift to stand and cast
function mouseFrame(h, dt) {
  updateCursor(); if (!mouse.down || h.dead) return; holdT += dt;
  if (shiftDown) { h.fireAt = G.cursor.clone(); h.attackTarget = null; h.moveTo = null; return; }
  h.fireAt = null;
  if (pressOnEnemy) { if (!h.attackTarget && G.hover) h.attackTarget = G.hover; if (!h.attackTarget) pressOnEnemy = false; return; }
  if (holdT > .12) { if (G.hover) { h.attackTarget = G.hover; pressOnEnemy = true; h.moveTo = null; } else h.moveTo = G.cursor.clone(); }
}

// ---------- HUD ----------
const bar = $('#bar'); let slotEls = [];
function sigTip(h, i) {
  const s = h.sig[i], S = SIGS[s.id], E = ELEM[s.elem];
  return `<b>${S.name}</b> · rank ${s.rank}/5<br><span style="color:${E.css}">${E.name}</span>: ${E.desc}<br>${S.desc}${s.runes.length ? '<br><i>Runes: ' + s.runes.map(r => RUNES[r].name).join(', ') + '</i>' : ''}`;
}
function buildBar() {
  const h = G.hero; bar.innerHTML = ''; slotEls = [];
  const mk = (cls, color, icon, key, tip, extra = '') => { const el = document.createElement('div'); el.className = cls; el.style.setProperty('--c', color); el.innerHTML = `<div class="ic"><i class="ti ti-${icon}"></i></div><div class="cd"></div><span class="key">${key}</span>${extra}<div class="tip">${tip}</div>`; bar.appendChild(el); slotEls.push(el); return el; };
  for (let i = 0; i < 2; i++) {
    const s = h.sig[i], S = SIGS[s.id], pips = `<div class="pips">${[0, 1, 2].map(k => `<i class="${s.runes[k] ? 'on' : ''}"></i>`).join('')}</div><span class="rank">${s.rank > 1 ? 'R' + s.rank : ''}</span>`;
    mk('slot sig', ELEM[s.elem].css, S.icon, G.inputMode === 'pad' ? glyph(i ? BTN.lt : BTN.rt) : (i ? 'RMB' : 'LMB'), sigTip(h, i), pips);
  }
  const sep = document.createElement('div'); sep.className = 'sep'; bar.appendChild(sep);
  for (let s = 0; s < 4; s++) {
    const d = skillDef(h, s), m = h.mods[s];
    const mods = [m.echo ? 'Echo' : '', m.dmg > 1 ? `+${Math.round((m.dmg - 1) * 100)}% dmg` : '', m.area > 1 ? `+${Math.round((m.area - 1) * 100)}% area` : '', m.cdr < 1 ? `-${Math.round((1 - m.cdr) * 100)}% cd` : ''].filter(Boolean).join(' · ');
    mk('slot' + (d ? '' : ' empty'), d ? d.color : '#555', d ? d.icon : 'lock', keyLabel(s), `<b>${d ? d.name : (s === 3 ? 'Ultimate' : 'Skill slot ' + keyLabel(s))}</b><br>${d ? d.desc : 'Unlocks at level ' + SLOT_LEVEL[s] + '. Kill enemies to gain experience.'}${mods ? '<br><i>' + mods + '</i>' : ''}`, d ? '' : `<span class="lv">Lv ${SLOT_LEVEL[s]}</span>`);
  }
  mk('slot mini', '#ffffff', 'run', G.inputMode === 'pad' ? glyph(BTN.a) : '␣', '<b>Evade</b><br>Short dash, briefly invulnerable.');
  mk('slot mini potion', '#ff4a4a', 'bottle', G.inputMode === 'pad' ? glyph(BTN.lb) : 'Q', '<b>Health potion</b><br>Restores 40% of your health. Health globes from enemies refill a charge.', '<span class="cnt"></span>');
}
const mini = $('#mini'), mg = mini.getContext('2d'); let miniT = 0;
function drawMinimap() {
  const M = G.map, W = mini.width, s = W / M.W; mg.clearRect(0, 0, W, W);
  for (let j = 0; j < M.H; j++) for (let i = 0; i < M.W; i++) {
    const e = M.explored[M.idx(i, j)]; if (e < .3) continue;
    mg.fillStyle = M.floor(i, j) ? `rgba(190,180,165,${.35 + e * .35})` : 'rgba(60,55,50,.8)'; if (!M.floor(i, j) && !nearFloor(M, i, j)) continue;
    mg.fillRect(i * s, j * s, s + .5, s + .5);
  }
  const dot = (p, col, r) => { mg.fillStyle = col; mg.beginPath(); mg.arc(p.x / CS * s, p.z / CS * s, r, 0, 7); mg.fill(); };
  for (const o of G.interact) if (!o.used && M.seen(o.g.position.x, o.g.position.z)) dot(o.g.position, o.kind === 'chest' ? '#ffc84a' : o.kind === 'cursed' ? '#ff2a3a' : '#7fffd4', 4);
  for (const e of G.enemies) if (alive(e) && M.seen(e.g.position.x, e.g.position.z)) dot(e.g.position, e.elite ? '#ff5a3a' : '#c04030', e.elite ? 4 : 2.5);
  for (const p of G.pending) if (p.tier !== 'normal' && M.seen(p.pos.x, p.pos.z)) dot(p.pos, '#ff5a3a', 4);
  const br = M.boss; if (M.explored[M.idx(br.cx, br.cy)] > .3) { mg.fillStyle = '#ff3a3a'; mg.font = 'bold 22px Inter'; mg.fillText('☠', br.cx * s - 8, br.cy * s + 8); }
  for (const ev of G.events) if (ev.kind === 'ambush' && ev.state === 'idle' && M.explored[M.idx(ev.room.cx, ev.room.cy)] > .3) { mg.fillStyle = '#ff5a3a'; mg.font = 'bold 20px Inter'; mg.fillText('!', ev.room.cx * s - 4, ev.room.cy * s + 7); }
  if (G.portal) dot(G.portal.g.position, '#ffffff', 6);
  dot(G.hero.g.position, '#5ad0ff', 5);
}
const nearFloor = (M, i, j) => M.floor(i + 1, j) || M.floor(i - 1, j) || M.floor(i, j + 1) || M.floor(i, j - 1);
function updateHUD(dt) {
  const h = G.hero; $('#orbfill').style.height = Math.max(0, h.hp / h.maxHp * 100) + '%'; $('#orbtext').innerHTML = `${Math.ceil(h.hp)} / ${Math.round(h.maxHp)}` + (h.barrier > 1 ? `<br><small>+${Math.round(h.barrier)} barrier</small>` : ''); $('#orb').classList.toggle('shielded', h.barrier > 1);
  $('#gold').innerHTML = `<i class="ti ti-coin"></i> ${h.gold}`; Hub.hudHaul();
  $('#xpfill').style.width = Math.min(100, h.xp / xpNeed(h.level) * 100) + '%'; $('#xplv').textContent = `Level ${h.level}`; $('#xpnum').textContent = `${h.xp} / ${xpNeed(h.level)} xp`;
  const m = Math.floor(G.run.biomeTime / 60), s = Math.floor(G.run.biomeTime % 60);
  $('#bsub').textContent = `Biome ${G.run.biome + 1} / 4 · ${m}:${String(s).padStart(2, '0')} · Threat ${G.diff().toFixed(1)}`;
  const cdp = (el, v) => el && el.querySelector('.cd').style.setProperty('--p', Math.max(0, v));
  cdp(slotEls[1], h.cdSec > 0 ? h.cdSec / h.cdSecMax : 0); if (slotEls[1]) slotEls[1].classList.toggle('charging', !!h.channel);
  for (let k = 0; k < 4; k++) cdp(slotEls[k + 2], h.cds[k] > 0 ? h.cds[k] / ((h.cdMax && h.cdMax[k]) || 1) : 0);
  cdp(slotEls[6], h.dodgeCd / 2.2);
  if (slotEls[7]) { slotEls[7].querySelector('.cnt').textContent = h.potions; slotEls[7].classList.toggle('empty', h.potions <= 0); }
  const tg = (G.hover && alive(G.hover) && G.hover) || (G.padTarget && alive(G.padTarget) && G.padTarget);
  if (tg && !tg.boss) { $('#target').classList.remove('hidden'); $('#tname').textContent = (tg.name || (tg.affixes.length ? tg.affixes.join(' ') + ' ' + tg.typeName : tg.typeName)) + (isUnstoppable(tg) ? ' · Unstoppable' : '') + (G.padLock === tg ? '  🔒' : ''); $('#tfill').style.width = Math.max(0, tg.hp / tg.max * 100) + '%'; $('#tweak').textContent = weakText(tg); } else $('#target').classList.add('hidden');
  if (G.boss) { const b = G.boss, sg = b.staggered > 0; $('#bossfill').style.width = Math.max(0, b.hp / b.max * 100) + '%'; $('#bossbar').classList.toggle('staggered', sg);
    $('#stagfill').style.width = (sg ? b.staggered / 4.5 : b.stag / b.stagMax) * 100 + '%'; $('#stagtxt').textContent = sg ? 'Staggered' : b.unstopAct === 'phase' ? 'Unstoppable' : ''; }
  miniT -= dt; if (miniT <= 0) { miniT = .2; drawMinimap(); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('#toast').style.opacity = 0; }
}

// ---------- controller ----------
let navT = 0, cardIdx = 0;
const keyLabel = s => G.inputMode === 'pad' ? glyph([BTN.x, BTN.y, BTN.b, BTN.rb][s]) : '1234'[s];
const keyText = t => t.replace(/\{k(\d)\}/g, (_, n) => `<b class="kb">${keyLabel(+n)}</b>`);

function setMode(m) {
  if (G.inputMode === m) return; G.inputMode = m; canvas.style.cursor = m === 'pad' ? 'none' : '';
  if (m === 'mouse') { G.padTarget = null; G.padLock = null; if (G.hero) { G.hero.stick = null; G.hero.fireAt = null; } }
  if (G.hero && G.state === 'play') buildBar(); if (G.cards && G.cardsReady) document.querySelectorAll('#cardrow .card').forEach((d, i) => { d.querySelector('.k').textContent = G.inputMode === 'pad' ? glyph(BTN.a) + ' to pick' : 'Click or press ' + (i + 1); d.querySelector('p').innerHTML = keyText(d.card.text); });
  if (G.cardWhy && !$('#cards').classList.contains('hidden')) $('#cardsub').innerHTML = keyText(G.cardWhy); updateHint(); focusUI();
}
updateHint();
function updateHint() {
  $('#hint').innerHTML = G.inputMode === 'pad'
    ? `${glyph(BTN.rt)} basic · ${glyph(BTN.lt)} core · ${glyph(BTN.x)} ${glyph(BTN.y)} ${glyph(BTN.b)} ${glyph(BTN.rb)} skills · ${glyph(BTN.a)} evade · ${glyph(BTN.lb)} potion<br>right stick aim (hold ${glyph(BTN.rt)} to move and shoot) · ${glyph(BTN.r3)} lock target · ${glyph(BTN.view)} map · Start build`
    : 'Left click: move / basic skill · Right click: core skill · Shift+click: attack in place<br>1 2 3 4 skills · Space evade · Q potion · Tab map · M sound · Esc build';
}
function focusUI() {
  const pad = G.inputMode === 'pad';
  if (!pad) Hub.clearFocus();
  document.querySelectorAll('.card').forEach((e, i) => e.classList.toggle('focus', pad && i === cardIdx));
  const row = $('#cardrow'); if (row) row.classList.toggle('padfocus', pad);
}
function navDir() { // one step per press, repeating while held
  let x = (held(BTN.right) ? 1 : 0) - (held(BTN.left) ? 1 : 0), y = (held(BTN.down) ? 1 : 0) - (held(BTN.up) ? 1 : 0);
  if (!x && Math.abs(Pad.ls.x) > .6) x = Math.sign(Pad.ls.x); if (!y && Math.abs(Pad.ls.y) > .6) y = Math.sign(Pad.ls.y);
  if (!x && !y) { navT = 0; return null; } if (navT > 0) return null; navT = .22; return {x, y};
}
// Diablo IV controller scheme: A basic, X core, Y/RB/LT/RT skills 1-4, B evade, LB potion,
// Right stick = twin-stick aim (narrow aim assist). Centred: automatic targeting in the direction you face/move, R3 locks it.
function autoTarget(p, fwd, cur, minDot = .4, maxL = 12, near = 3) {
  let best = null, bs = -9;
  for (const e of G.enemies) {
    if (!alive(e) || !G.map.seen(e.g.position.x, e.g.position.z)) continue;
    const d = V(e.g.position.x - p.x, 0, e.g.position.z - p.z), L = d.length() || 1; if (L > maxL) continue;
    const dot = d.dot(fwd) / L; if (dot < minDot && L > near) continue; // in front of you, or right next to you
    const sc = dot * 1.2 - L / 12 + (e === cur ? .45 : 0) + (e.boss ? .3 : e.elite ? .15 : 0);
    if (sc > bs) { bs = sc; best = e; }
  }
  return best;
}
function handlePad(dt) {
  navT -= dt; if (anyInput()) { setMode('pad'); initAudio(); if (!audioHinted && G.state === 'play') { audioHinted = true; after(1.5, () => { if (audioBlocked()) toast('Click once to enable sound'); }); } } if (G.inputMode !== 'pad') return;
  const vis = id => !$(id).classList.contains('hidden');
  if (vis('#menu') || vis('#over') || vis('#extract')) { Hub.padNav(navDir, pressed(BTN.a), pressed(BTN.x)); return; }
  if (vis('#pause')) { if (pressed(BTN.start) || pressed(BTN.b)) togglePause(); return; }
  if (vis('#cards')) {
    const n = navDir(), k = G.cards ? G.cards.length : 0; if (n && k) cardIdx = (cardIdx + n.x + k) % k; focusUI();
    if (pressed(BTN.a)) chooseCard(cardIdx); else if (pressed(BTN.x)) $('#reroll').click(); return;
  }
  if (G.state !== 'play' || G.paused || !G.hero) return;
  const h = G.hero, p = h.g.position; h.stick = V(Pad.ls.x, 0, Pad.ls.y);
  const moving = h.stick.lengthSq() > .02;
  const fwd = (moving ? h.stick.clone() : V(Math.sin(h.g.rotation.y), 0, Math.cos(h.g.rotation.y))).normalize();
  // twin-stick aiming: the right stick sets the direction you face and shoot, independent of movement (with a light aim assist)
  const rm = Math.hypot(Pad.rs.x, Pad.rs.y);
  if (rm > .35) h.aimDir = V(Pad.rs.x, 0, Pad.rs.y).normalize(); else if (rm < .2) h.aimDir = null;
  const S0 = sigDef(h, 0), reach = S0.kind === 'melee' ? 3.5 : S0.range + 1.5;
  // R3 locks onto the auto target (used whenever the right stick is centred)
  let lock = G.padLock; if (lock && (!alive(lock) || dist2(lock.g.position, p) > 20)) lock = G.padLock = null;
  const auto = h.aimDir ? autoTarget(p, h.aimDir, G.padTarget, .9, reach, 1.2) : autoTarget(p, fwd, G.padTarget);
  if (pressed(BTN.r3)) G.padLock = lock = lock ? null : auto;
  const target = h.aimDir ? auto : lock || auto; G.padTarget = target; G.hover = null;
  G.cursor.copy(target ? target.g.position : p.clone().addScaledVector(h.aimDir || fwd, h.aimDir ? Math.max(4, reach - 1) : 6)).setY(0);
  // RT / R2 = basic skill (hold). Aiming with the right stick or moving with the left: you keep moving and fire where you aim.
  // Standing still with no aim: Diablo-style, you walk into range of the target and attack it.
  if (held(BTN.rt)) {
    if (h.aimDir || moving) { h.attackTarget = null; h.fireAt = G.cursor.clone(); }
    else {
      if (target && dist2(target.g.position, p) - target.radius < (S0.kind === 'melee' ? 7 : S0.range + 1.5)) { h.attackTarget = target; h.fireAt = null; }
      else { h.attackTarget = null; h.fireAt = G.cursor.clone(); }
      h.stick = null;
    }
  } else if (released(BTN.rt)) { h.attackTarget = null; h.fireAt = null; }
  // LT / L2 = core skill (hold for channelled / charged ones)
  if (pressed(BTN.lt)) secondaryDown(h, () => G.cursor.clone()); else if (released(BTN.lt)) secondaryUp(h);
  [[BTN.x, 0], [BTN.y, 1], [BTN.b, 2], [BTN.rb, 3]].forEach(([b, s]) => { if (pressed(b)) castSlot(h, s, G.cursor.clone()); });
  if (pressed(BTN.a)) dodge(h, p.clone().addScaledVector(fwd, 5));
  if (pressed(BTN.lb)) usePotion(h);
  if (pressed(BTN.view)) $('#mini').classList.toggle('big');
  if (pressed(BTN.start)) togglePause();
}
addEventListener('gamepadconnected', e => { const ps = /054c|dualsense|dualshock|playstation/i.test(e.gamepad.id); if (G.state === 'play') toast(`${ps ? 'PlayStation' : 'Xbox'} controller connected`); });

// ---------- main loop ----------
const clock = new THREE.Clock(); let flowT = 0;
function tick() { requestAnimationFrame(tick); step(Math.min(clock.getDelta(), 1 / 20)); }
function step(dt) {
  if (pollPad()) handlePad(dt); else if (G.hero) G.hero.stick = null;
  if (G.state === 'play' && !G.paused) {
    G.time += dt; G.run.time += dt; G.run.biomeTime += dt; const h = G.hero, t = G.time;
    if (G.inputMode === 'mouse') { h.aimDir = null; mouseFrame(h, dt); }
    if (G.aimLine) { const on = !!h.aimDir && !h.dead; G.aimLine.visible = on; if (on) { G.aimLine.position.set(h.g.position.x + h.aimDir.x * 1.6, .07, h.g.position.z + h.aimDir.z * 1.6); G.aimLine.rotation.y = Math.atan2(h.aimDir.x, h.aimDir.z); } }
    if (G.reticle) { const tg = G.inputMode === 'pad' && G.padTarget && alive(G.padTarget) ? G.padTarget : null; G.reticle.visible = !!tg && !h.dead; if (tg) { G.reticle.position.set(tg.g.position.x, .08, tg.g.position.z); G.reticle.scale.setScalar(1 + tg.radius * 1.4); G.reticle.material.color.set(G.padLock === tg ? 0xffc84a : 0xff5a3a).multiplyScalar(2); } }
    heroUpdate(h, dt, t);
    // lazy spawning: only instantiate enemies near the hero (one per frame to avoid hitches)
    const pi = G.pending.findIndex(p => dist2(p.pos, h.g.position) < 21);
    if (pi >= 0) { const p = G.pending.splice(pi, 1)[0]; spawnMob(p.id, p.pos, p.tier, p.name); }
    // boss room trigger
    if (!G.bossSpawned && G.map.roomAt(h.g.position.x, h.g.position.z) === G.map.boss) {
      G.bossSpawned = true; const r = G.map.boss, c = G.map.roomCenter(r);
      const b = spawnMob(G.biome.bossMob, c, 'boss', G.biome.boss); sfx('roar'); G.boss = b; $('#bossname').textContent = G.biome.boss; $('#bossbar').classList.remove('hidden'); toast(G.biome.boss);
      for (const id of packIds(3)) spawnMob(id, G.map.randomIn(r, 1.5), 'normal');
    }
    if ((flowT -= dt) <= 0) { flowT = .3; const [i, j] = G.map.cellOf(h.g.position.x, h.g.position.z); G.flow = G.map.bfs(i, j, 40); }
    for (const e of G.enemies) enemyUpdate(e, dt, t);
    G.enemies = G.enemies.filter(e => !e.gone);
    updateHazards(dt); updateDrops(dt, t); updateInteract(dt, t); updateEvents(dt); Hub.update(dt, t);
    G.biome.ambient(dt, t); updateFX(dt); parts.update(dt);
    // camera follows high and angled, Diablo style
    const tgt = h.g.position, cp = V(tgt.x, 14.5, tgt.z + 9.5);
    camera.position.lerp(cp, 1 - Math.exp(-dt * 14)); camera.lookAt(camera.position.x, .8, camera.position.z - 9.5);
    if (G.shake > .001) { camera.position.x += rand(-1, 1) * G.shake; camera.position.y += rand(-1, 1) * G.shake; G.shake *= Math.exp(-dt * 7); }
    if (G.sun) { G.sun.position.copy(tgt).add(G.sun.userData.offset); G.sun.target.position.copy(tgt); }
    updateHUD(dt); updateCodex(dt);
  }
  if (G.scene) render();
}

// ---------- boot ----------
$('#again').onclick = () => { $('#over').classList.add('hidden'); $('#hud').classList.add('hidden'); Hub.showHub(); $('#menu').classList.remove('hidden'); G.paused = false; G.state = 'menu'; queue = []; };
Hub.initHub(id => { initAudio(); startRun(id); buildBar(); });
loadAssets(p => { $('#loadbar').style.width = p * 100 + '%'; }).then(() => {
  $('#load').remove(); $('#menu').classList.remove('hidden'); G.state = 'menu';
});
tick();
window.__G = G; window.__startBiome = startBiome; window.__step = step; window.__dbg = {secondaryDown, secondaryUp, castSlot, dodge}; // debug handles
