const assert=require('assert'), L=require('../logic.js');
L.setWinFrom('2026-10-31'); L.setPlanFrom('2026-11-02');
const lvl=sec=>{ for(let i=L.FIRST_OUT;i<=L.TOP;i++) if(L.DUR[i]>=sec) return i; return L.TOP; };
const W=lvl(60);
const T=(d,h,m)=>new Date(d+'T'+String(h).padStart(2,'0')+':'+String(m||0).padStart(2,'0')+':00').getTime();
let n=0;
const dep=(date,step,outcome,ts,extra)=>Object.assign({id:'x'+(n++),kind:'dep',place:'home',date,step,outcome,createdAt:ts,tags:[],v:3},extra||{});
const base=[{id:'b0',kind:'baseline',place:'home',date:'2026-10-31',createdAt:T('2026-10-31',8),level:W,from:0,outcome:'baseline',v:3},dep('2026-11-01',W,'calm',T('2026-11-01',9))];
// Plan shape
for(const d of ['2026-11-02','2026-11-03','2026-11-04','2026-11-05','2026-11-06']){
  const s=L.planSlots(d,null,60);
  assert.strictEqual(s.length,10); assert.strictEqual(s[0].role,'warm');
  assert.notStrictEqual(s[s.length-1].role,'T'); assert.strictEqual(s[s.length-1].role,'final');
  assert.strictEqual(s.filter(x=>x.role==='T').length,3); assert.strictEqual(s.filter(x=>x.role==='N').length,2);
  let run=0; s.slice(1,-1).forEach(x=>{ run=x.role==='E'?0:run+1; assert(run<=2); });
  assert.strictEqual(JSON.stringify(s),JSON.stringify(L.planSlots(d,null,60)));
}
// Sitter cap 5: 5 longer reps + warm-up
const sc=L.planSlots('2026-11-02',5,60); assert.strictEqual(sc.filter(x=>x.role!=='warm'&&x.f*60>60).length<=5,true);
assert.strictEqual(sc[0].role,'warm'); assert.strictEqual(sc[sc.length-1].role,'final');
// Walk a day: plan holds the starting time, no rep above it, no session break, done after 10
let list=base.slice(), now=T('2026-11-02',10);
const steps=[];
for(let i=0;i<10;i++){
  const nx=L.pickFor(list,'home',now,600,null);
  assert(nx.plan && !nx.plan.done,'plan open at '+i);
  assert(nx.step<=W,'never above start '+i);
  steps.push(nx.step);
  list.push(dep('2026-11-02',nx.step,'calm',now,nx.kind==='warmup'?{warm:true}:{}));
  now+=3*60000;
}
assert(steps.length===10 && steps[0]<W && steps[9]<W, 'warm-up and final easier: '+steps);
const fin=L.pickFor(list,'home',now,600,null); assert(fin.plan.done && fin.plan.reason==='complete');
// five near-working reps calm -> next day starts higher
const nextDay=L.stateFrom(list,'home','2026-11-03'); assert(nextDay.level>W,'moves up for tomorrow: '+nextDay.level+' vs '+W);
const upDay=L.planFor(list.filter(e=>e.date<'2026-11-03'),'home',T('2026-11-03',9),null); assert(upDay.eff>W);
// Wobble mid-plan: next rep easy, lower; upset: light rep then done
let l2=base.slice(); let t2=T('2026-11-02',10);
for(let i=0;i<3;i++){ const nx=L.pickFor(l2,'home',t2,600,null); l2.push(dep('2026-11-02',nx.step,'calm',t2)); t2+=180000; }
l2.push(dep('2026-11-02',L.pickFor(l2,'home',t2,600,null).step,'escalated',t2)); t2+=3*3600000;
const lt=L.pickFor(l2,'home',t2,600,null); assert(lt.light && lt.step<W,'light rep after upset');
l2.push(dep('2026-11-02',lt.step,'calm',t2)); t2+=180000;
assert(L.pickFor(l2,'home',t2,600,null).plan.done,'plan ends after the light rep');
// Short reps: 1-2 min gap; longer reps unchanged; no session break
const e=dep('2026-11-02',lvl(30),'calm',T('2026-11-02',10)); const c=L.cooldownMs(e); assert(c>=60000&&c<=120000);
const w=L.waitUntil(Array.from({length:8},(_,i)=>dep('2026-11-02',lvl(30),'calm',T('2026-11-02',10)+i*120000))); assert.strictEqual(w.reason,'settle');
// Before the start date nothing changes
assert.strictEqual(L.planFor(base,'home',T('2026-11-01',12),null),null);
console.log('plan tests ok');
// each day is judged on its own: 2 good reps yesterday + 3 today do not move her up
{
  let l=base.slice(); let t=T('2026-11-02',10);
  for(let i=0;i<3;i++){ l.push(dep('2026-11-02',W,'calm',t)); t+=180000; }
  for(let i=0;i<3;i++){ l.push(dep('2026-11-03',W,'calm',T('2026-11-03',10)+i*180000)); }
  assert.strictEqual(L.stateFrom(l,'home','2026-11-04').level,W,'no carry-over');
  assert.strictEqual(L.ceilingFor(new Date('2026-11-04T10:00:00'),'sitter'),10);
}
console.log('plan day tests ok');
{
  let l=base.slice(); const t=T('2026-11-02',10);
  l.push(dep('2026-11-02',W,'calm',t,{tags:['Asleep before']}));
  const pl=L.planFor(l,'home',t+600000,null); assert.strictEqual(pl.idx,0,'asleep rep keeps the slot');
}
console.log('asleep slot ok');
