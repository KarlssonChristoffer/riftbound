// Dev-only autopilot for balance testing. Eval on the game page, then: bot.start(classIndexOrId); bot.chunk(3000) until s !== 'running'; bot.restore() afterwards.
// start() backs up the save and resets it (clean=true) so talents/relics from earlier runs don't skew the numbers; restore() puts the real save back.
window.run=n=>{for(let i=0;i<n;i++)__step(1/60)};
window.bot={log:[],errs:[],minHp:1,stag:0,start(ci,clean=true){import('/game/js/audio.js').then(A=>{if(!A.toggleMute())A.toggleMute()}); // bot runs are silent
 const K='riftbound.save.v1';if(clean){try{const v=localStorage.getItem(K);if(v!==null&&localStorage.getItem(K+'.botbackup')===null)localStorage.setItem(K+'.botbackup',v)}catch(x){}__meta.resetSave()}this.log=[];this.errs=[];this.minHp=1;this.bt=0;this.stag=0;this.lastBiome=0;__hub.autoPush=true;__hub.start(ci);run(5)},
 restore(){const K='riftbound.save.v1';try{const v=localStorage.getItem(K+'.botbackup');if(v!==null){localStorage.setItem(K,v);localStorage.removeItem(K+'.botbackup');return 'restored - reload the page'}}catch(x){}return 'no backup'},
 chunk(n=900){const G=__G;for(let i=0;i<n;i++){if(G.state==='over')return this.report('over');const h=G.hero;
  if(G.cards){G.cardsReady=true;dispatchEvent(new KeyboardEvent('keydown',{key:String(1+Math.floor(Math.random()*G.cards.length))}))}
  if(!G.paused&&!h.dead){const p=h.g.position;
   if(h.hp<h.maxHp*.45&&h.potions>0&&h.potCd<=0)dispatchEvent(new KeyboardEvent('keydown',{key:'q'}));
   const al=G.enemies.filter(e=>e.dead<=0&&e.active&&G.map.seen(e.g.position.x,e.g.position.z)).sort((a,b)=>a.g.position.distanceTo(p)-b.g.position.distanceTo(p));const e=al[0];
   if(e&&e.g.position.distanceTo(p)<16){h.moveTo=null;if(h.attackTarget!==e)h.attackTarget=e;if(i%40===0){for(let s=0;s<4;s++)if(h.cds[s]<=0&&(s<3?h.skills[s]:h.ult)){__dbg.castSlot(h,s,e.g.position.clone());break}}if(i%90===0&&h.cdSec<=0)__dbg.secondaryDown(h,()=>e.g.position.clone());if(i%90===45)__dbg.secondaryUp(h);if(i%150===75&&h.hp<h.maxHp*.6)__dbg.dodge(h,p.clone().multiplyScalar(2).sub(e.g.position))}
   else{h.attackTarget=null;let tgt=null;if(G.portal)tgt=G.portal.g.position;else{const it=G.interact.find(o=>!o.used&&o.kind!=='shrine');const pend=G.pending.slice().sort((a,b)=>a.pos.distanceTo(p)-b.pos.distanceTo(p))[0];tgt=pend?pend.pos:it?it.g.position:G.map.roomCenter(G.map.boss)}if(i%20===0)h.moveTo=tgt.clone()}}
  try{__step(1/60)}catch(x){this.errs.push(String(x.stack).slice(0,200));if(this.errs.length>3)return this.report('errors')}
  if(!G.hero.dead)this.minHp=Math.min(this.minHp,G.hero.hp/G.hero.maxHp);if(G.boss&&!this.bt)this.bt=G.run.time;if(!G.boss&&this.bt){this.log.push('boss'+Math.round(G.run.time-this.bt)+'s');this.bt=0}if(G.boss&&G.boss.staggered>4.49)this.stag++;
  if(G.run.biome!==this.lastBiome){this.log.push('b'+G.run.biome+'@'+Math.round(G.run.time)+'s lv'+G.hero.level);this.lastBiome=G.run.biome}}
  return this.report('running')},
 report(s){const G=__G,h=G.hero;return JSON.stringify({s,minHp:+this.minHp.toFixed(2),stag:this.stag,biome:G.biome.name,time:Math.round(G.run.time),lv:h.level,hp:Math.round(h.hp)+'/'+Math.round(h.maxHp),kills:h.kills,skills:h.skills,ult:h.ult,pas:Object.keys(h.pas),log:this.log,events:G.events.map(e=>e.kind+':'+e.state),errs:this.errs})}}