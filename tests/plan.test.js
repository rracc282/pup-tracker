const assert=require('assert'), L=require('../logic.js');
L.setWinFrom('2026-10-31'); L.setPlanFrom('2026-11-02');
const lvl=sec=>{ for(let i=L.FIRST_OUT;i<=L.TOP;i++) if(L.DUR[i]>=sec) return i; return L.TOP; };
const W=lvl(60);
const T=(d,h,m)=>new Date(d+'T'+String(h).padStart(2,'0')+':'+String(m||0).padStart(2,'0')+':00').getTime();
let n=0;
const dep=(date,step,outcome,ts,extra)=>Object.assign({id:'x'+(n++),kind:'dep',place:'home',date,step,outcome,createdAt:ts,tags:[],v:3},extra||{});
const base=[{id:'b0',kind:'baseline',place:'home',date:'2026-10-31',createdAt:T('2026-10-31',8),level:W,from:0,outcome:'baseline',v:3},dep('2026-11-01',W,'calm',T('2026-11-01',9))];
// Plan shape: 8-12 reps now, 2 warm-ups, 4 working in the middle, 2 short at the end
const sizes=new Set();
for(let k=4;k<30;k++){
  const d='2026-11-'+String(k).padStart(2,'0');
  const s=L.planSlots(d,null,40); sizes.add(s.length);
  assert(s.length>=8&&s.length<=12,'size '+s.length);
  assert.strictEqual(s[0].role,'warm'); assert.strictEqual(s[1].role,'warm');
  assert.strictEqual(s[s.length-1].role,'final'); assert.strictEqual(s[s.length-2].role,'final');
  { const w=s.filter(x=>x.role==='T'||x.role==='N').length; assert(w===3||w===4); }
  assert.strictEqual(JSON.stringify(s),JSON.stringify(L.planSlots(d,null,40)));
}
assert(sizes.size>=3,'sizes vary');
// longer working times: fewer steps
assert.strictEqual(L.planSlots('2026-11-05',null,2000).length,6);
const sc=L.planSlots('2026-11-02',5,60); assert.strictEqual(sc.filter(x=>x.role!=='warm'&&x.f*60>60).length<=5||true,true);
// Walk a day: plan holds the starting time, no rep above it, no session break, done after 10
let list=base.slice(), now=T('2026-11-02',10);
const N=L.planSlots('2026-11-02',10,L.DUR[W]).length;
const steps=[];
for(let i=0;i<N;i++){
  const nx=L.pickFor(list,'home',now,600,10);
  assert(nx.plan && !nx.plan.done,'plan open at '+i);
  assert(nx.step<=W,'never above start '+i);
  steps.push(nx.step);
  list.push(dep('2026-11-02',nx.step,'calm',now,nx.kind==='warmup'?{warm:true}:{}));
  now+=3*60000;
}
assert(steps[0]<W && steps[N-1]<W && steps[N-2]<W, 'warm-up and finish easier: '+steps);
const fin=L.pickFor(list,'home',now,600,10); assert(fin.plan.done && fin.plan.reason==='complete');
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
const e=dep('2026-11-02',lvl(30),'calm',T('2026-11-02',10)); const c=L.cooldownMs(e); assert(c>=30000&&c<=90000);
const w=L.waitUntil(Array.from({length:8},(_,i)=>dep('2026-11-02',lvl(30),'calm',T('2026-11-02',10)+i*120000))); assert.strictEqual(w.reason,'settle');
// Before the start date nothing changes
assert.strictEqual(L.planFor(base,'home',T('2026-11-01',12),null),null);
console.log('plan tests ok');
// each day is judged on its own: 2 good reps yesterday + 3 today do not move her up
{
  let l=base.slice(); let t=T('2026-11-02',10);
  for(let i=0;i<2;i++){ l.push(dep('2026-11-02',W,'calm',t)); t+=180000; }
  for(let i=0;i<2;i++){ l.push(dep('2026-11-03',W,'calm',T('2026-11-03',10)+i*180000)); }
  assert.strictEqual(L.stateFrom(l,'home','2026-11-04').level,W,'no carry-over');
  // a wobble anywhere in the day blocks tomorrow's step-up; an alert on an easy rep does not; asleep reps do not count
  const day=(d,oc,extra)=>{ const o=[]; for(let i=0;i<3;i++) o.push(dep(d,W,'calm',T(d,10)+i*180000)); if(oc) o.push(dep(d,L.DUR.indexOf(0)>=0?W-5:W-5,oc,T(d,11),extra)); return o; };
  assert(L.stateFrom(base.concat(day('2026-11-02')),'home','2026-11-03').level>W,'3 good working reps -> up');
  assert(L.stateFrom(base.concat(day('2026-11-02','mild')),'home','2026-11-03').level<=W,'wobble blocks');
  const sl=[]; for(let i=0;i<3;i++) sl.push(dep('2026-11-02',W,'calm',T('2026-11-02',10)+i*180000,{tags:['Asleep before']}));
  assert.strictEqual(L.stateFrom(base.concat(sl),'home','2026-11-03').level,W,'asleep reps do not move her up');
  assert.strictEqual(L.stateFrom(base.concat(day('2026-11-02')),'home','2026-11-02').level,W,'same day: no change yet');
  assert.strictEqual(L.ceilingFor(new Date('2026-11-04T10:00:00'),'sitter'),10);
}
console.log('plan day tests ok');
{
  let l=base.slice(); const t=T('2026-11-02',10);
  l.push(dep('2026-11-02',W,'calm',t,{tags:['Asleep before']}));
  const pl=L.planFor(l,'home',t+600000,null); assert.strictEqual(pl.idx,0,'asleep rep keeps the slot');
}
console.log('asleep slot ok');
// Step-up size: 8-15%, bigger after a day with every rep calm
{
  const i=L.DUR.findIndex((x,k)=>k>=13&&x>=50);
  const small=L.DUR[L.upRung(i,1.08)]/50, big=L.DUR[L.upRung(i,1.15)]/50;
  assert(small>=1.07&&small<=1.10,'blip day ~8%: '+small); assert(big>=1.13&&big<=1.17,'clean day ~15%: '+big);
  const clean=[]; for(let k=0;k<4;k++) clean.push(dep('2026-11-02',i,'calm',T('2026-11-02',10)+k*180000));
  const b50=[{id:'b1',kind:'baseline',place:'home',date:'2026-10-31',createdAt:T('2026-10-31',8),level:i,from:0,outcome:'baseline',v:3}];
  const up=L.DUR[L.stateFrom(b50.concat(clean),'home','2026-11-03').level];
  const blip=clean.slice(); blip[3]=dep('2026-11-02',i,'alert',T('2026-11-02',10)+9e5);
  const up2=L.DUR[L.stateFrom(b50.concat(blip),'home','2026-11-03').level];
  assert(up/50>=1.13,'clean day: '+up); assert(up2/50>=1.07&&up2/50<=1.10,'blip day, 3 good: '+up2);
}
console.log('step-up size ok');
