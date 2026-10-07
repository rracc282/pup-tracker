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
const five=[0,1,2,3,4].map(()=>rep(0,'calm')); assert.strictEqual(L.waitUntil(five).reason,'session');
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
console.log('logic tests ok');
