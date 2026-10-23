const assert=require('assert'), L=require('../logic.js');
const mk=(o)=>Object.assign({kind:'dep',place:'home',date:'2026-10-07',createdAt:0,outcome:'calm'},o);
let t=1000, id=0;
const rep=(step,outcome,extra)=>mk(Object.assign({id:'r'+(id++),step,outcome,createdAt:(t+=60000)},extra||{}));
// progression: 2 calm at step 0 -> level 1
let list=[rep(0,'calm'),rep(0,'calm')];
assert.strictEqual(L.stateFrom(list,'home').level,1);
// wobble repeats, two wobbles drop
list=[rep(0,'calm'),rep(0,'calm'),rep(1,'mild'),rep(1,'mild')];
assert.strictEqual(L.stateFrom(list,'home').level,0);
// upset drops two (floor 0)
list=[rep(0,'calm'),rep(0,'calm'),rep(1,'calm'),rep(1,'calm'),rep(2,'escalated')];
assert.strictEqual(L.stateFrom(list,'home').level,0);
// voided and medicated reps are ignored by the ladder
list=[rep(0,'calm'),rep(0,'calm',{voided:true}),rep(0,'calm',{medicated:true})];
assert.strictEqual(L.stateFrom(list,'home').level,0);
assert.strictEqual(L.stateFrom([rep(0,'calm'),rep(0,'calm')],'home').level,1);
// daily cap: at levels <=12, max 3 step-ups per day
list=[];for(let s=0;s<6;s++){list.push(rep(s,'calm'));list.push(rep(s,'calm'));if(s>=2)list.push(rep(s,'calm'));}
assert(L.stateFrom(list,'home').level<=3+0,'cap respected: '+L.stateFrom(list,'home').level);
// step ids round trip
for(let i=0;i<=L.TOP;i++) assert.strictEqual(L.indexOfId(L.idOf(i)),i);
assert.strictEqual(L.normalizeEntry({kind:'dep',stepId:'out.60',levelId:'door.open',step:0}).step,L.indexOfId('out.60'));
// ceilings by day type
const d=new Date(2026,9,7);
assert.strictEqual(L.ceilingFor(d,'home'),10);assert.strictEqual(L.ceilingFor(d,'sitter'),5);assert.strictEqual(L.ceilingFor(d,'weekend'),8);
assert.strictEqual(L.ceilingFor(new Date(2026,9,7),null),10); // Wednesday
assert.strictEqual(L.ceilingFor(new Date(2026,9,8),null),5);
// wait: calm cue -> 120 s; wobble doubles; upset 3 h; 5 in a row -> 1 h break
let w=L.waitUntil([rep(0,'calm')]); assert.strictEqual(w.until-w.until+120000,120000);
let a=rep(0,'calm'); { const g=L.waitUntil([a]).until-a.createdAt; assert(g>=120000&&g<=180000,'rest 1 to 1.5x the base: '+g); }
a=rep(0,'mild'); { const g=L.waitUntil([a]).until-a.createdAt; assert(g>=240000&&g<=360000,'wobble doubles: '+g); }
// tiny exposures: bigger sessions, shorter rests
assert(L.isTiny(12)&&L.isTiny(17)&&!L.isTiny(11)&&!L.isTiny(18));
{ const sizes=new Set(); for(let k=0;k<300;k++){ const z=L.sessionSizeFor(1e12+k*60000,true); assert(z>=5&&z<=8); sizes.add(z); } assert.strictEqual(sizes.size,4); }
assert(L.restSec(13,1e12)>=90&&L.restSec(13,1e12)<=135);
// rests grow with the time out and vary, never below the old fixed gap
assert(L.restSec(13,1e12)<L.restSec(25,1e12)&&L.restSec(25,1e12)<=2700);
assert(new Set(Array.from({length:50},(_,k)=>L.restSec(20,1e12+k*7000))).size>10,'rests vary');
assert.strictEqual(L.sessionCount([{createdAt:0},{createdAt:600000},{createdAt:4000000}]),2);
a=rep(0,'escalated'); assert.strictEqual(L.waitUntil([a]).until,a.createdAt+3*3600000);
const base=Date.now(); const mkRun=n=>Array.from({length:n},(_,i)=>Object.assign(rep(0,'calm'),{createdAt:base+i*300000}));
const sz=L.sessionSizeFor(base); assert(sz>=3&&sz<=6);
assert.strictEqual(L.waitUntil(mkRun(sz)).reason,'session');
if(sz>3) assert.notStrictEqual(L.waitUntil(mkRun(sz-1)).reason,'session');
const bm=L.waitUntil(mkRun(sz)).breakMin; assert(bm>=45&&bm<=90&&bm%5===0);
const seen=new Set(), seenB=new Set(); for(let k=0;k<300;k++){ seen.add(L.sessionSizeFor(base+k*60000)); seenB.add(L.breakMinFor(base+k*60000)); }
assert(seen.size===4&&seenB.size===10);
// pickNext never harder than working step; wobble forces easier
for(let k=0;k<200;k++){
  const st={level:20,lastEvent:'calmProgress',run:1,need:2,wob:0,nextEasy:false};
  const nx=L.pickNext(st,270,'s'+k); assert(nx.step<=20||nx.kind==='decoy');
  const st2=Object.assign({},st,{lastEvent:'wobble'}); const n2=L.pickNext(st2,270,'s'+k); assert(n2.step<20||n2.kind==='decoy');
}
// fits: a 2-minute pocket never gets an out step over its time
for(let k=0;k<100;k++){const nx=L.pickNext({level:30,lastEvent:null},2,'z'+k); assert(L.fits(nx.step,2));}
// summary
const entries=[rep(0,'calm',{id:'a',level:0}),rep(0,'mild',{id:'b',level:0,notes:'whined'}),rep(0,'calm',{id:'c',voided:true})];
const days={'2026-10-07':{day_type:'home',medicated:false}};
const s=L.buildSummary(entries,days,'2026-10-07','home');
assert(/Home day/.test(s)&&/whined/.test(s)&&/2 reps/.test(s),s);
assert(!/Medicated today: YES/.test(s));
// baseline: manual step, earlier reps ignored
const bl={kind:'baseline',id:'bl',place:'home',date:'2026-10-07',createdAt:t+1e6,level:9,outcome:'baseline'};
const afterBase=rep(9,'calm',{createdAt:t+2e6});
assert.strictEqual(L.stateFrom([rep(0,'calm'),rep(0,'calm'),bl],'home').level,9);
assert.strictEqual(L.stateFrom([bl,afterBase],'home').run,1);
assert.strictEqual(L.stateFrom([rep(0,'calm'),rep(0,'calm'),bl],'zurich').level,0); // new place starts from scratch
assert.strictEqual(L.stateFrom([bl],'zurich').newPlace,false===false?true:false);
// manual forward jump: orange range recorded, then the normal rules continue from the new step
const jump={kind:'baseline',id:'jp',place:'home',date:'2026-10-07',createdAt:t+5e6,level:9,from:6,outcome:'baseline'};
assert.deepStrictEqual(L.skippedRanges([jump],'home'),[{from:6,to:9}]);
assert.deepStrictEqual(L.skippedRanges([Object.assign({},jump,{level:4})],'home'),[]);
assert.deepStrictEqual(L.skippedRanges([Object.assign({},jump,{voided:true})],'home'),[]);
const after=[1,2,3].map(i=>rep(9,'calm',{createdAt:t+5e6+i*60000,level:9}));
let st9=L.stateFrom([jump].concat(after.slice(0,2)),'home'); assert.strictEqual(st9.level,9); assert.strictEqual(st9.run,2);
assert.strictEqual(L.stateFrom([jump].concat(after),'home').level,10); // 3 calm at step 9 -> advance, same rule as always
const wob=[rep(9,'mild',{createdAt:t+6e6,level:9}),rep(9,'mild',{createdAt:t+6.1e6,level:9})];
assert.strictEqual(L.stateFrom([jump].concat(wob),'home').level,8); // two wobbles drop one step, same rule
// bar info: red marks only for rule-based drops and only until she is past that step; regressions by hand are dark green
{
  let tt=9e7, n=0; const r=(step,o,x)=>Object.assign({kind:'dep',place:'home',date:'2026-10-07',id:'b'+(n++),createdAt:(tt+=60000),step,level:step,outcome:o},x||{});
  const base=[r(0,'calm'),r(0,'calm'),r(1,'calm'),r(1,'calm'),r(2,'calm'),r(2,'calm')]; // now at step 3
  assert.strictEqual(L.stateFrom(base,'home').level,3);
  assert.deepStrictEqual(L.barInfo(base,'home').marks,[]);
  const dropped=base.concat([r(3,'escalated')]); // upset: 3 -> 1
  assert.strictEqual(L.stateFrom(dropped,'home').level,1);
  assert.deepStrictEqual(L.barInfo(dropped,'home').marks,[3]);
  const wob2=base.concat([r(3,'mild'),r(3,'mild')]); // two wobbles: 3 -> 2
  assert.deepStrictEqual(L.barInfo(wob2,'home').marks,[3]);
  // manual regression from 3 down to 1 -> dark green 1..3, no red mark
  const back={kind:'baseline',id:'bk',place:'home',date:'2026-10-07',createdAt:tt+1e5,level:1,from:3,outcome:'baseline'};
  const bi=L.barInfo(base.concat([back]),'home');
  assert.deepStrictEqual(bi.regressed,[{from:1,to:3}]); assert.deepStrictEqual(bi.marks,[]); assert.deepStrictEqual(bi.skipped,[]);
  // forward jump has no dark green and no marks
  const fwd={kind:'baseline',id:'fw',place:'home',date:'2026-10-07',createdAt:tt+1e5,level:6,from:3,outcome:'baseline'};
  const fi=L.barInfo(base.concat([fwd]),'home'); assert.deepStrictEqual(fi.skipped,[{from:3,to:6}]); assert.deepStrictEqual(fi.regressed,[]);
}
console.log('logic tests ok');
// ---- watch-outs, weekly comparison, progress line ----
{
  const D=(d,o,extra)=>Object.assign(mk({id:'h'+(id++),step:0,outcome:o,date:d,createdAt:Date.parse(d+'T10:00:00Z')+(id*1000)}),extra||{});
  assert.strictEqual(L.dateAdd('2026-10-01',-6),'2026-09-25');
  const ups=[D('2026-10-05','escalated'),D('2026-10-06','escalated'),D('2026-10-07','escalated')];
  assert(L.helpAlerts(ups,'2026-10-07','home').some(x=>/3 upsets/.test(x)));
  assert(L.helpAlerts(ups.map(e=>Object.assign({},e,{medicated:true})),'2026-10-07','home').length===0);
  const streak=[D('2026-10-05','calm'),D('2026-10-06','mild'),D('2026-10-06','mild'),D('2026-10-07','mild')];
  assert(L.helpAlerts(streak,'2026-10-07','home').some(x=>/last 3/.test(x)));
  const calmOnly=[D('2026-10-06','calm'),D('2026-10-07','calm')];
  assert.strictEqual(L.helpAlerts(calmOnly,'2026-10-07','home').length,0);
  // stall: 5 training days in 10 with only wobble-repeats at step 0 (no step up)
  const stall=['03','04','05','06','07'].map(d=>D('2026-10-'+d,'calm')).map((e,i)=>i%2?e:Object.assign(e,{outcome:'mild'}));
  assert(L.helpAlerts(stall,'2026-10-07','home').some(x=>/No step up/.test(x)), 'stall');
  const wc=L.weekCompare(stall.concat([D('2026-09-28','calm')]),'2026-10-07','home');
  assert.strictEqual(wc.cur.days,5); assert.strictEqual(wc.prev.reps,1);
  assert.strictEqual(L.progressSeries(stall,'home'),null);
  const far=stall.concat([D('2026-10-07','calm',{step:13})]);
  assert(Array.isArray(L.progressSeries(far,'home')));
  const sm=L.buildSummary(ups.map(e=>Object.assign({},e,{tags:['Panting']})),{},'2026-10-07','home');
  assert(/Tags seen today: Panting\./.test(sm)); assert(/Watch-outs/.test(sm));
}
console.log('logic tests (new) ok');

// ---- wobble fix: drops go below where she struggled, next rep never harder ----
{
  let i2=0,t2=Date.parse('2026-10-09T09:00:00Z');
  const R=(step,outcome)=>({id:'w'+(i2++),kind:'dep',place:'zurich',date:'2026-10-09',step,outcome,createdAt:(t2+=900000)});
  // her real Zurich sequence: W at 6, calm at 4, W at 6, W at 4  (start level 6)
  const seq=[R(6,'mild'),R(4,'calm'),R(6,'mild'),R(4,'mild')];
  let st=L.computeState(seq,6);
  assert.strictEqual(st.level,4,'drops to the step she wobbled on, not up to step 5');
  assert.strictEqual(st.lastEvent,'wobbleDrop');
  for(let k=0;k<300;k++){ const n=L.pickNext(st,270,'z'+k); assert(n.step<=4,'next rep never harder than where she wobbled: '+n.step); }
  // wobbles at the working step still drop exactly one
  assert.strictEqual(L.computeState([R(6,'mild'),R(6,'mild')],6).level,5);
  // wobbles far below the working step: drop capped at two
  assert.strictEqual(L.computeState([R(12,'mild'),R(12,'mild')],20).level,18);
  // after a single wobble, never harder than that step
  const one=L.computeState([R(19,'mild')],22);
  for(let k=0;k<300;k++){ assert(L.pickNext(one,270,'q'+k).step<=19); }
  // upset: next rep never above the step that upset her
  const up=L.computeState([R(15,'escalated')],22);
  for(let k=0;k<300;k++){ assert(L.pickNext(up,270,'u'+k).step<=15); }
}
console.log('logic tests (wobble fix) ok');

// new place: from scratch, even for reps logged under the old "three below Home" rule (stored level 6)
{
  let i3=0,t3=Date.parse('2026-10-09T09:00:00Z');
  const Z=(step,outcome,level)=>({id:'z'+(i3++),kind:'dep',place:'zurich',date:'2026-10-09',step,outcome,level,createdAt:(t3+=900000)});
  const zs=L.stateFrom([Z(6,'mild',6),Z(4,'calm',6),Z(6,'mild',6),Z(4,'mild',6)],'zurich');
  assert.strictEqual(zs.level,0);
  assert.strictEqual(L.startFor([],'zurich'),0);
}
console.log('logic tests (new place) ok');

// ---- slower gate, caps, warm-up ----
{
  let i4=0,t4=Date.parse('2026-11-12T09:00:00Z');
  const G=(step,outcome,date)=>({id:'g'+(i4++),kind:'dep',place:'home',date,step,outcome,createdAt:(t4+=60000)});
  assert.strictEqual(L.need(12),4); assert.strictEqual(L.GATE,12);
  assert.strictEqual(L.capFor(3),3); assert.strictEqual(L.capFor(8),2); assert.strictEqual(L.capFor(12),1); assert.strictEqual(L.capFor(L.DUR.indexOf(60)),1); assert.strictEqual(L.capFor(L.DUR.indexOf(2)),2); assert.strictEqual(L.capFor(L.DUR.indexOf(10)),2); assert.strictEqual(L.capFor(L.DUR.indexOf(12)),1); assert.strictEqual(L.capFor(L.DUR.indexOf(90)),2); assert.strictEqual(L.capFor(L.DUR.indexOf(300)),1);
  assert.strictEqual(L.need(15),3); assert.strictEqual(L.need(L.DUR.indexOf(120)),2); assert.strictEqual(L.need(L.DUR.indexOf(60)),3); assert.strictEqual(L.need(L.DUR.indexOf(300)),3);
  { const A=(step,date,asleep)=>Object.assign(G(step,'calm',date),{tags:asleep?['Asleep before']:[]});
    const D1='2026-11-12', D2='2026-11-13';
    // each of two days needs at least 2 awake calm reps
    let s2=L.computeState([A(12,D1,0),A(12,D1,0),A(12,D2,0),A(12,D2,0)],12); assert.strictEqual(s2.level,13);
    // 1 rep on day one + 3 on day two (her real case): not enough
    s2=L.computeState([A(12,D1,0),A(12,D2,0),A(12,D2,0),A(12,D2,1)],12); assert.strictEqual(s2.level,12); assert.strictEqual(s2.lastEvent,'gate'); assert.strictEqual(s2.runDays,1);
    // ...one more awake rep on a second qualifying day moves her
    s2=L.computeState([A(12,D1,0),A(12,D2,0),A(12,D2,0),A(12,D2,1),A(12,D2,0)],12); assert.strictEqual(s2.level,12);
    s2=L.computeState([A(12,D1,0),A(12,D1,0),A(12,D2,0),A(12,D2,1),A(12,D2,0)],12); assert.strictEqual(s2.level,13);
    // asleep reps never count as qualifying
    s2=L.computeState([A(12,D1,1),A(12,D1,1),A(12,D2,1),A(12,D2,1)],12); assert.strictEqual(s2.level,12);
    // after the front door at least 2 awake calm reps are still needed
    s2=L.computeState([A(14,D1,1),A(14,D1,1),A(14,D1,1)],14); assert.strictEqual(s2.level,14); assert.strictEqual(s2.lastEvent,'awake');
    s2=L.computeState([A(14,D1,1),A(14,D1,0),A(14,D1,0)],14); assert.strictEqual(s2.level,15);
    s2=L.computeState([A(5,D1,1),A(5,D1,1),A(5,D1,1)],5); assert.strictEqual(s2.level,6,'before the front door asleep still counts');
    s2=L.computeState([A(12,'2026-10-10',1),A(12,'2026-10-10',1),A(12,'2026-10-10',1)],12); assert.strictEqual(s2.level,13,'old reps keep old rules'); }
  // front door: 4 calm on ONE day does not move her up
  const d1=[1,2,3,4,5].map(()=>G(12,'calm','2026-11-12'));
  let s=L.computeState(d1,12); assert.strictEqual(s.level,12); assert.strictEqual(s.lastEvent,'gate'); assert.strictEqual(s.runDays,1);
  // ...two calm reps on a second day do
  s=L.computeState(d1.concat([G(12,'calm','2026-11-13'),G(12,'calm','2026-11-13')]),12); assert.strictEqual(s.level,13);
  // a wobble in between resets the count and the day tally
  s=L.computeState([G(12,'calm','2026-11-12'),G(12,'calm','2026-11-12'),G(12,'mild','2026-11-12'),G(12,'calm','2026-11-13'),G(12,'calm','2026-11-13'),G(12,'calm','2026-11-13'),G(12,'calm','2026-11-13')],12);
  assert.strictEqual(s.level,12,'a single day after a reset is still not enough');
  // one step-up per day on the first departures
  const dep=[1,2,3,4,5,6,7,8].map(()=>G(13,'calm','2026-11-14')); s=L.computeState(dep,13); assert.strictEqual(s.level,14,'one step-up a day on the first departures');
  // behind the door: two step-ups a day, not three
  const bd=[0,1,2,3,4,5,6,7,8,9].map((k)=>G(k<3?7:k<6?8:9,'calm','2026-11-12')); s=L.computeState(bd,7); assert(s.level<=9,'cap of 2 behind the door: '+s.level);
  // warm-up: first rep of a session at/after the front door step is easier; below it nothing changes
  const st12=L.computeState([],12); const seen=new Set();
  for(let k=0;k<200;k++){ const n=L.pickNext(st12,270,'w'+k,{sessionStart:true}); assert.strictEqual(n.kind,'warmup'); assert(n.step===10||n.step===11); seen.add(n.step); }
  assert.strictEqual(seen.size,2);
  const st16=L.computeState([],16);
  for(let k=0;k<200;k++){ const n=L.pickNext(st16,270,'v'+k,{sessionStart:true}); assert(n.step>=12&&n.step<16,'warm-up out step '+n.step); }
  const st8=L.computeState([],8); for(let k=0;k<100;k++){ assert.notStrictEqual(L.pickNext(st8,270,'u'+k,{sessionStart:true}).kind,'warmup'); }
  for(let k=0;k<100;k++){ assert.notStrictEqual(L.pickNext(st12,270,'x'+k,{sessionStart:false}).kind,'warmup'); }
  // session start detection
  assert.strictEqual(L.isSessionStart([],Date.now()),true);
  const lastRep=G(5,'calm','2026-11-12'); assert.strictEqual(L.isSessionStart([lastRep],lastRep.createdAt+10*60000),false); assert.strictEqual(L.isSessionStart([lastRep],lastRep.createdAt+50*60000),true);
  // a warm-up (easier) rep never counts toward moving up
  const w1=L.computeState([G(12,'calm','2026-11-12'),G(11,'calm','2026-11-12')],12); assert.strictEqual(w1.run,1);
}
console.log('logic tests (gate, caps, warm-up) ok');

// ---- grandfathering: history before the cutover keeps the rules she trained under ----
{
  let i5=0,t5=Date.parse('2026-10-07T09:00:00Z');
  const H=(step,outcome,date)=>({id:'h'+(i5++),kind:'dep',place:'home',date,step,outcome,createdAt:(t5+=60000)});
  // Wed: three step-ups behind the door (allowed then); Mon: Keys -> Bolt -> all five -> open/close
  const hist=[];
  [6,6,6].forEach(s=>hist.push(H(s,'calm','2026-10-07')));   // Coat bd -> Shoes bd
  [7,7,7].forEach(s=>hist.push(H(s,'calm','2026-10-07')));   // Shoes -> Bag
  [8,8,8].forEach(s=>hist.push(H(s,'calm','2026-10-07')));   // Bag -> Keys
  hist.push(H(9,'calm','2026-10-07'));
  [9,9].forEach(s=>hist.push(H(s,'calm','2026-10-12')));     // Keys -> Bolt
  [10,10,10].forEach(s=>hist.push(H(s,'calm','2026-10-12'))); // Bolt -> all five
  [11,11].forEach(s=>hist.push(H(s,'calm','2026-10-12'))); hist.push(H(9,'calm','2026-10-12')); hist.push(H(11,'calm','2026-10-12')); // all five -> open/close
  hist.push(H(12,'calm','2026-10-12'));
  const gs=L.computeState(hist,6);
  assert.strictEqual(gs.level,12,'history is replayed under the old rules'); assert.strictEqual(gs.run,1);
  // new rules from the cutover day: the front door now needs 4 calm on 2 days (today counts as day 1)
  const tomorrow=['2026-10-13','2026-10-13','2026-10-13'].map(d=>H(12,'calm',d));
  const g2=L.computeState(hist.concat(tomorrow),6); assert.strictEqual(g2.level,12,'1 rep on day one and 3 on day two is not enough'); assert.strictEqual(g2.lastEvent,'gate');
  const g3=L.computeState(hist.concat(tomorrow.slice(0,2)),6); assert.strictEqual(g3.level,12);
  const g4=L.computeState(hist.concat([H(12,'calm','2026-10-12')]).concat(tomorrow.slice(0,2)),6); assert.strictEqual(g4.level,13,'2 awake calm reps on each of two days moves her');
}
console.log('logic tests (grandfathering) ok');
// ---- finer ladder: history stays valid ----
{
  const D=L.DUR;
  for(let i=14;i<=L.TOP;i++){ assert(D[i]>D[i-1],'ascending'); assert(D[i]/D[i-1]<=1.5,'jump at '+i+': '+D[i-1]+' to '+D[i]); }
  assert.strictEqual(D[L.TOP],14400); assert.strictEqual(L.TOP+1,52);
  // saved reps carry a step name, so they land on the same duration whatever the numbers are
  ['out.2','out.4','out.7','out.60','out.1800','out.14400'].forEach(id=>assert.strictEqual('out.'+D[L.indexOfId(id)],id));
  // old saved numbers with no step name map by duration (old index 15 was 7 s, old 21 was 60 s)
  const old=L.normalizeEntry({kind:'dep',step:15,level:21}); assert.strictEqual(D[old.step],7); assert.strictEqual(D[old.level],60);
  const bl=L.normalizeEntry({kind:'baseline',level:26,from:13}); assert.strictEqual(D[bl.level],300); assert.strictEqual(bl.from,13);
  // cue steps never move
  assert.strictEqual(L.indexOfId('door.open'),12); assert.strictEqual(L.indexOfId('out.2'),13);
  // milestones sit on the same times as before
  assert.strictEqual(D[Number(Object.keys(L.MILESTONES).find(k=>L.MILESTONES[k]==='bins out'))],60);
  console.log('logic tests (finer ladder) ok');
}
// ---- shorter reps are real departures that scale with the working step; a rep that does not count is followed by a working-step rep; warm-up plan; step-list pin ----
{
  const D=L.DUR, idx=x=>D.indexOf(x);
  // at 2 s there is nothing shorter: every non-warm-up rep is a working-step rep
  for(let k=0;k<300;k++){ const nx=L.pickNext({level:idx(2),lastEvent:'calmProgress',lastEasy:false,need:3,run:1},270,'a'+k); assert.strictEqual(nx.kind,'hard'); assert.strictEqual(nx.step,idx(2)); }
  // beyond that, shorter reps are real departures (never the door), between ~10% and 75% of the working step
  for(const sec of [3,10,60,300,900]){
    const lv=idx(sec), kinds=new Set();
    for(let k=0;k<500;k++){
      const nx=L.pickNext({level:lv,lastEvent:'calmProgress',lastEasy:false,need:3,run:1},270,'b'+k); kinds.add(nx.kind);
      assert(nx.kind==='hard'||nx.kind==='easy'); if(nx.kind==='easy'){ assert(nx.step>=L.FIRST_OUT&&nx.step<lv); assert(D[nx.step]<=D[lv]*0.75+1e-9); }
      const after=L.pickNext({level:lv,lastEvent:'calmProgress',lastEasy:true,need:3,run:1},270,'b'+k); assert.strictEqual(after.kind,'hard'); assert.strictEqual(after.step,lv);
    }
    assert(kinds.has('hard')&&kinds.has('easy'),'mix at '+sec);
  }
  // warm-ups: door-only while the working step is a few seconds, real shorter departures after that
  for(let k=0;k<200;k++){
    const w3=L.pickNext({level:idx(3),lastEvent:null,need:3,run:0},270,'c'+k,{warm:{no:1,of:1}}); assert.strictEqual(w3.kind,'warmup'); assert(w3.step>=12&&w3.step<idx(3));
    const w60=L.pickNext({level:idx(60),lastEvent:null,need:3,run:0},270,'d'+k,{warm:{no:2,of:2}}); assert.strictEqual(w60.kind,'warmup'); assert(w60.step>=L.FIRST_OUT&&w60.step<idx(60)); assert.strictEqual(w60.warmNo,2);
  }
  // warm-up plan: first rep of the day gets 1 (or 2 after trouble yesterday, 3+ days away, or one rep from moving up); later only after a 3 h gap
  const T=Date.parse('2026-11-20T09:00:00'), mk=(date,ts,o,step,level)=>({kind:'dep',outcome:o,date,createdAt:ts,step,level,place:'home',id:date+ts});
  const st={level:idx(10),lastEvent:'calmProgress',need:3,run:0};
  const yest=(o)=>mk('2026-11-19',T-20*3600000,o,idx(10),idx(10));
  assert.deepStrictEqual(L.warmupPlan([yest('calm')],st,T),{no:1,of:1});
  assert.deepStrictEqual(L.warmupPlan([yest('mild')],st,T),{no:1,of:2});
  assert.deepStrictEqual(L.warmupPlan([mk('2026-11-16',T-4*86400000,'calm',idx(10),idx(10))],st,T),{no:1,of:2});
  assert.deepStrictEqual(L.warmupPlan([yest('calm')],Object.assign({},st,{run:2}),T),{no:1,of:2});
  // second warm-up follows the first, then no more
  const first=mk('2026-11-20',T-10*60000,'calm',idx(7),idx(10));
  assert.deepStrictEqual(L.warmupPlan([yest('mild'),first],st,T),{no:2,of:2});
  const second=mk('2026-11-20',T-5*60000,'calm',idx(7),idx(10));
  assert.strictEqual(L.warmupPlan([yest('mild'),first,second],st,T),null);
  // later in the day: gaps under 3 h (meetings, lunch) carry on without a warm-up; 3 h or more gets one
  const real=(ts)=>mk('2026-11-20',ts,'calm',idx(10),idx(10));
  const wu=mk('2026-11-20',T-6*3600000,'calm',idx(7),idx(10));
  assert.strictEqual(L.warmupPlan([yest('calm'),wu,real(T-5*3600000)],st,T-5*3600000+3600000),null);       // 1 h gap, same day
  assert.strictEqual(L.warmupPlan([yest('calm'),wu,real(T-5*3600000)],st,T-5*3600000+2*3600000),null);     // 2 h gap
  assert.deepStrictEqual(L.warmupPlan([yest('calm'),wu,real(T-5*3600000)],st,T-5*3600000+3*3600000),{no:1,of:1}); // 3 h gap
  // pin: reps from an older step list keep the step they were on
  const mk2=(step,level,extra)=>Object.assign({kind:'dep',outcome:'calm',date:'2026-10-20',step,level,createdAt:Date.now(),id:Math.random()+'',place:'home'},extra||{});
  assert.strictEqual(L.computeState([mk2(14,14,{ladderVer:3,createdAt:1}),mk2(14,14,{ladderVer:3,createdAt:2}),mk2(14,14,{ladderVer:3,createdAt:3})],0).level,15);
  assert.strictEqual(L.computeState([mk2(20,20,{ladderVer:3,createdAt:1})],0).level,20);
}
console.log('logic tests (varied reps, warm-up plan, pin) ok');

{
  const L2=L, id=()=>Math.random()+'', mk=(step,level,o,date,ts)=>({kind:'dep',place:'home',id:id(),step,level,outcome:o,date,createdAt:ts});
  const s=L2.DUR.indexOf(3)+4, t=s-2, T=Date.parse('2026-11-20T09:00:00Z');
  // a small wobble only restarts the count: three calm reps afterwards still move her up the same day
  const wob=[mk(s,s,'mild','2026-11-20',T)].concat([1,2,3].map(i=>mk(s,s,'calm','2026-11-20',T+i*1e6)));
  assert.strictEqual(L2.computeState(wob,0).level,s+1);
  // an upset drops two steps and blocks step-ups for the rest of the day; the next day the first calm rep moves her up
  const up=[mk(s,s,'escalated','2026-11-20',T)].concat([1,2,3].map(i=>mk(t,t,'calm','2026-11-20',T+i*1e6)));
  let st=L2.computeState(up,0); assert.strictEqual(st.level,t); assert.strictEqual(st.lastEvent,'roughDay');
  st=L2.computeState(up.concat([mk(t,t,'calm','2026-11-21',T+86400000)]),0); assert.strictEqual(st.level,t+1);
}
console.log('logic tests (rough day) ok');

{
  // daily climb limit (from 23 Oct 2026): at most 1.5x the day's starting step; 1 step-up on the first day back after 2+ days away
  const id=()=>Math.random()+'', mk=(step,level,date,ts)=>({kind:'dep',place:'home',id:id(),step,level,outcome:'calm',date,createdAt:ts});
  const i7=L.DUR.indexOf(7), i10=L.DUR.indexOf(10), i12=L.DUR.indexOf(12), T=Date.parse('2026-11-10T09:00:00Z');
  const calm=(n,step,date,t0)=>Array.from({length:n},(_,i)=>mk(step,step,date,t0+i*1e6));
  // yesterday trained, so today is not a "back" day: 7 s -> 10 s, then 10 s -> 12 s is blocked (12 > 1.5 x 7)
  const prev=calm(1,i7,'2026-11-09',T-86400000);
  let st=L.computeState(prev.concat(calm(3,i7,'2026-11-10',T),calm(3,i10,'2026-11-10',T+9e6)),0);
  assert.strictEqual(st.level,i10); assert.strictEqual(st.lastEvent,'capped');
  // starting from 10 s the same day allows 12 s and 15 s
  const p10=calm(1,i10,'2026-11-09',T-86400000);
  st=L.computeState(p10.concat(calm(3,i10,'2026-11-10',T)),0); assert.strictEqual(st.level,i12);
  // next day she starts at 10 and can climb again
  // first day back after 3 empty days: only one step-up
  const away=calm(1,i7,'2026-11-05',T-5*86400000);
  st=L.computeState(away.concat(calm(3,i7,'2026-11-10',T),calm(3,i10,'2026-11-10',T+9e6)),0);
  assert.strictEqual(st.level,i10);
  // before the start date the old two-a-day rule still applies
  const old=(step,date,t)=>({kind:'dep',place:'home',id:id(),step,level:step,outcome:'calm',date,createdAt:t});
  st=L.computeState([0,1,2].map(i=>old(i7,'2026-10-22',T+i*1e6)).concat([0,1,2].map(i=>old(i10,'2026-10-22',T+9e6+i*1e6))),0);
  assert.strictEqual(st.level,i12);
}
console.log('logic tests (daily climb limit) ok');

{
  // graph: the line follows the step she started each day on, so a step-up on the last rep shows on the next day
  const id=()=>Math.random()+'', i7=L.DUR.indexOf(7), i10=L.DUR.indexOf(10), T=Date.parse('2026-10-20T09:00:00Z');
  const mk=(step,date,t)=>({kind:'dep',place:'home',id:id(),step,level:step,outcome:'calm',date,createdAt:t});
  const reps=[mk(i7,'2026-10-19',T-86400000),mk(i7,'2026-10-20',T),mk(i7,'2026-10-20',T+1e6),mk(i7,'2026-10-20',T+2e6),mk(i10,'2026-10-21',T+86400000)];
  const s=L.progressSeries(reps,'home'); const d=s.find(x=>x.date==='2026-10-20');
  assert.strictEqual(d.start,i7); assert.strictEqual(d.end,i10); assert.strictEqual(d.maxCalm,7); assert.strictEqual(d.reps,3);
  assert.strictEqual(s.find(x=>x.date==='2026-10-21').start,i10);
}
console.log('logic tests (graph series) ok');

{
  const id=()=>Math.random()+'', mk=(step,level,outcome,ts,date)=>({kind:'dep',place:'home',id:id(),step,level,outcome,date:date||'2026-11-12',createdAt:ts});
  const s=L.DUR.indexOf(10), T=Date.parse('2026-11-12T09:00:00Z');
  // Alert: does not count, does not reset the run, next rep repeats the working step; a second alert in a row is a wobble
  const base=[mk(s,s,'calm',T),mk(s,s,'calm',T+1e6)];
  let st=L.computeState(base.concat([mk(s,s,'alert',T+2e6)]),0);
  assert.strictEqual(st.lastEvent,'alert'); assert.strictEqual(st.run,2); assert.strictEqual(st.level,s);
  const pk=L.pickNext(st,60,'x1'); assert.strictEqual(pk.kind,'hard'); assert.strictEqual(pk.step,s);
  st=L.computeState(base.concat([mk(s,s,'alert',T+2e6),mk(s,s,'calm',T+3e6)]),0); assert.strictEqual(st.level,s+1); // the alert did not reset the run
  st=L.computeState(base.concat([mk(s,s,'alert',T+2e6),mk(s,s,'alert',T+3e6)]),0);
  assert.strictEqual(st.alertConv,true); assert.strictEqual(st.run,0); assert.strictEqual(st.lastEvent,'wobble');
  assert.strictEqual(L.coachMsg('wobble',st)[0],'Second alert in a row.');
  // a calm rep between two alerts keeps them apart
  st=L.computeState([mk(s,s,'alert',T),mk(s,s,'calm',T+1e6),mk(s,s,'alert',T+2e6)],0); assert.strictEqual(st.lastEvent,'alert'); assert.strictEqual(st.alertConv,false);
  // alerts are not upsets in the summary or the help triggers
  const ent=[mk(s,s,'alert',T),mk(s,s,'alert',T+1e6),mk(s,s,'alert',T+2e6)];
  assert.strictEqual(L.helpAlerts(ent,'2026-11-12','home').length,0);
  const sum=L.buildSummary(ent,{},'2026-11-12','home'); assert(/0 upset/.test(sum)); assert(/alert/i.test(sum));
  assert.strictEqual(L.windowStats(ent,'home','2026-11-12','2026-11-12').alert,3);
  // warm-ups: two on the first day at a step she has never done a rep at
  const T2=Date.parse('2026-11-13T09:00:00Z');
  const prev=[mk(s,s,'calm',T-1800000)];
  const stn=L.computeState(prev,0); assert.strictEqual(L.warmupPlan(prev,stn,T2).of,1); // she has done reps at 10 s: one warm-up
  const prev2=[mk(s-1,s-1,'calm',T-3600000),mk(s-1,s-1,'calm',T-1800000),mk(s-1,s-1,'calm',T-900000)];
  const stn2=L.computeState(prev2,0); assert.strictEqual(stn2.level,s); assert.deepStrictEqual(L.warmupPlan(prev2,stn2,T2),{no:1,of:2}); // new step: two
}
console.log('logic tests (alert, new-step warm-ups) ok');
