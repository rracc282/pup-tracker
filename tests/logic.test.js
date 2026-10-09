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
let a=rep(0,'calm'); assert.strictEqual(L.waitUntil([a]).until,a.createdAt+120000);
a=rep(0,'mild'); assert.strictEqual(L.waitUntil([a]).until,a.createdAt+240000);
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
assert.strictEqual(L.stateFrom([rep(0,'calm'),rep(0,'calm'),bl],'zurich').level,6);
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
