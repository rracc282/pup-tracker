// Time-based departures (ladder with small steps, rules from 31 Oct 2026). Run on the real ladder.
const assert=require('assert'), L=require('../logic.js');
L.setPlanFrom('2999-01-01');
L.setWinFrom('2026-10-31');
const mk=(o)=>Object.assign({kind:'dep',place:'home',date:'2026-11-03',createdAt:0,outcome:'calm'},o);
let n=0,T=Date.UTC(2026,10,3,8);
const R=(step,outcome,tags,date)=>mk({id:'w'+(n++),date:date||'2026-11-03',step,level:step,outcome,tags:tags||[],createdAt:(T+=900000)});
const ix=s=>L.DUR.indexOf(s), D=i=>L.DUR[i], a=['Awake before'], z=['Asleep before'];
// ladder: every old step is still there, no gap above 10% after 8 s, ids unchanged
L.BASE_DUR.forEach((s,i)=>{ if(i>=13) assert(ix(s)>=0,'old step kept '+s); });
for(let i=ix(10);i<L.DUR.length-1;i++) assert(L.DUR[i+1]/L.DUR[i]<=(L.DUR[i]<30?1.13:1.1001),'gap '+L.DUR[i]+' to '+L.DUR[i+1]);
assert.strictEqual(L.idOf(ix(40)),'out.40'); assert.strictEqual(L.indexOfId('out.40'),ix(40));
for(let i=1;i<L.DUR.length;i++) if(i>13) assert(L.DUR[i]>L.DUR[i-1],'sorted');
const s=ix(40), s1=s+1;
let st;
// five-rep window as before, but one small step up
st=L.computeState([1,2,3,4].map(()=>R(s,'calm',a)),0,'2026-11-03'); assert.strictEqual(st.level,s,'4 reps are not enough');
st=L.computeState([1,2,3,4,5].map(()=>R(s,'calm',a)),0,'2026-11-03'); assert.strictEqual(st.level,s1,'5 calm awake reps move up one small step'); assert(D(s1)/D(s)<=1.1001);
st=L.computeState([R(s,'calm',a),R(s,'mild'),R(s,'calm',a),R(s,'calm',a),R(s,'calm',a)],0,'2026-11-03');
// a hard-rep wobble takes the working time down a quarter, so she is no longer at s
assert(D(st.level)<=0.75*D(s)+1e-9,'wobble takes a quarter off'); assert(D(st.level)>=0.6*D(s));
st=L.computeState([R(s,'calm',a),R(s,'calm',z),R(s,'calm',z),R(s,'calm',a),R(s,'calm',a),R(s,'calm',a),R(s,'calm',a)],0,'2026-11-03'); assert.strictEqual(st.level,s1,'sliding window');
st=L.computeState([R(s,'calm',a),R(s,'alert'),R(s,'calm',a),R(s,'calm',a),R(s,'calm',a)],0,'2026-11-03'); assert.strictEqual(st.level,s1,'one alert is the allowed slip');
// reps within 90% of the working time count as working reps; easier ones do not
const near=ix(37); assert(D(near)>=0.9*D(s)); assert(L.countsAsHard(mk({step:near,date:'2026-11-03'}),s));
const far=ix(30); assert(!L.countsAsHard(mk({step:far,date:'2026-11-03'}),s));
st=L.computeState([R(s,'calm',a),R(near,'calm',a),R(s,'calm',a),R(near,'calm',a),R(s,'calm',a)],0,'2026-11-03'); assert.strictEqual(st.level,s1,'reps at 90 to 100% count');
st=L.computeState([R(s,'calm',a),R(s,'calm',a),R(far,'calm',a),R(s,'calm',a),R(s,'calm',a)],0,'2026-11-03'); assert.strictEqual(st.level,s,'easier rep did not count');
// two wobbles in a row: about half the original time; upset: half
st=L.computeState([R(s,'mild'),R(L.computeState([R(s,'mild')],0,'2026-11-03').level,'mild')],0,'2026-11-03'); assert(D(st.level)<=0.55*D(s)+1e-9,'two wobbles about half'); assert(st.lastEvent==='wobbleDrop');
st=L.computeState([R(s,'calm',a),R(s,'escalated')],0,'2026-11-03'); assert(D(st.level)<=0.5*D(s)+1e-9&&D(st.level)>=0.4*D(s),'upset halves'); assert.strictEqual(st.lastEvent,'upset');
// after an upset: one light, easy rep
let pk=L.pickNext(st,60,'x1'); assert.strictEqual(pk.light,true); assert(D(pk.step)<=0.55*D(st.level)+1e-9);
// daily climb: at most about 20%
{ let list=[],lvl=s; const day='2026-11-04';
  for(let k=0;k<40;k++){ const cur=L.computeState(list,0,day); list.push(R(cur.level,'calm',a,day)); }
  const end=L.computeState(list,0,day).level; assert(D(end)<=1.2*D(s)+1e-9,'at most +20% a day: '+D(s)+' to '+D(end)); }
// before the start date nothing changes: 3 calm in a row moves up one old step
L.setWinFrom('2026-10-31');
st=L.computeState([R(ix(40),'calm',a,'2026-10-29'),R(ix(40),'calm',a,'2026-10-29'),R(ix(40),'calm',a,'2026-10-29')],0,'2026-10-29'); assert.strictEqual(st.level,ix(50),'old rule: next old step');
st=L.computeState([R(ix(40),'mild',a,'2026-10-29'),R(ix(40),'mild',a,'2026-10-29')],0,'2026-10-29'); assert.strictEqual(st.level,ix(30),'old rule: wobbles drop an old step');
st=L.computeState([R(ix(40),'calm',a,'2026-10-29'),R(ix(40),'escalated',a,'2026-10-29')],0,'2026-10-29'); assert.strictEqual(st.level,ix(25),'old rule: upset drops two old steps');
// pickNext: working reps stay within 90-100%, easier reps 60-80%, warm-ups 50-75%
{ let st0=L.computeState([R(s,'calm',a)],0,'2026-11-03');
  for(let k=0;k<200;k++){ const p=L.pickNext(st0,120,'k'+k); if(p.kind==='hard') assert(D(p.step)>=0.9*D(s)-1e-9&&p.step<=s,'hard 90-100%'); if(p.kind==='easy') assert(D(p.step)<=0.8*D(s)+1e-9,'easy <=80%');
    const w=L.pickNext(st0,120,'w'+k,{warm:{no:1,of:1}}); assert(D(w.step)<=0.76*D(s)+1e-9&&D(w.step)>=0.4*D(s),'warm-up 50-75%: '+D(w.step)); } }
// break of 7+ days: start about 20% easier
st=L.computeState([R(s,'calm',a,'2026-11-03')],0,'2026-11-12'); assert(D(st.level)<=0.8*D(s)+1e-9&&D(st.level)>=0.6*D(s),'break easing');
assert(/calm and awake/.test(L.runText(L.computeState([R(s,'calm',a)],0,'2026-11-03'))));
L.setWinFrom('2999-01-01'); console.log('time tests ok');
