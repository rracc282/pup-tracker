const L=require('../logic.js'), assert=require('assert');
let seed=12345; const rnd=()=>{seed=(seed*1664525+1013904223)>>>0;return seed/4294967296;};
const TOP=L.TOP; let fails=[]; let n=0;
function check(c,msg,ctx){ if(!c){ fails.push(msg+' '+JSON.stringify(ctx||{})); } n++; }
for(let run=0;run<600;run++){
  const start=Math.floor(rnd()*(TOP+1)); const pFail=[0.05,0.2,0.4][run%3]; const pUp=0.1*rnd();
  let list=[]; let t=Date.parse('2026-10-01T08:00:00Z'); let day=0; let prevSt=L.computeState([],start);
  const advToday={};
  for(let i=0;i<120;i++){
    const st=L.computeState(list,start);
    const pk=L.pickNext(st,[2,5,15,30,60,120,270][Math.floor(rnd()*7)],'s'+run+'_'+i);
    // invariants on suggestion
    check(pk.step<=st.level,'suggestion above working step',{lvl:st.level,step:pk.step});
    if(st.badStep!=null) check(pk.step<=st.badStep,'suggestion above step that wobbled',{bad:st.badStep,step:pk.step,ev:st.lastEvent});
    if((st.lastEvent==='wobble'||st.lastEvent==='wobbleDrop')&&st.level>=2) check(pk.step<st.level,'not easier than working step after wobble',{lvl:st.level,step:pk.step,k:pk.kind,ev:st.lastEvent});
    check(st.level>=0&&st.level<=TOP,'level out of range',{lvl:st.level});
    if(i%15===14){ t+=86400000; }
    t+=600000+Math.floor(rnd()*3000000);
    const r=rnd(); const out=r<pFail?(rnd()<pUp*5?'escalated':'mild'):'calm';
    const e={id:'f'+run+'_'+i,kind:'dep',place:'home',date:new Date(t).toISOString().slice(0,10),step:pk.step,outcome:out,createdAt:t};
    list.push(e);
    const nx=L.computeState(list,start);
    if(out!=='calm') check(nx.level<=st.level,'level rose on a non-calm rep',{from:st.level,to:nx.level,out});
    if(out==='calm') check(nx.level<=st.level+1,'jumped more than one step',{from:st.level,to:nx.level});
    if(out==='calm'&&pk.step<st.level) check(nx.level===st.level,'advanced on an easier rep',{lvl:st.level,step:pk.step,to:nx.level});
    if(out==='escalated') check(nx.level===Math.max(0,st.level-2),'upset drop not 2',{from:st.level,to:nx.level});
    if(out==='mild'&&nx.lastEvent==='wobbleDrop'){ check(st.level===0?nx.level===0:(nx.level<=st.level-1&&nx.level>=Math.max(0,st.level-2)),'wobble drop outside 1-2',{from:st.level,to:nx.level}); check(nx.level<=Math.max(0,pk.step)||nx.level===st.level-2||nx.level===0,'working step above where she wobbled (beyond the 2-step cap)',{lvl:nx.level,step:pk.step,from:st.level}); }
    if(out==='mild'&&nx.lastEvent==='wobble') check(nx.level===st.level,'single wobble changed level',{from:st.level,to:nx.level});
    // need
    check(nx.need===L.need(nx.level),'need mismatch',{lvl:nx.level});
    // wait
    const w=L.waitUntil(list); check(w&&w.until>=e.createdAt,'wait before rep',{});
    if(out==='escalated') check(w.until-e.createdAt>=3*3600000,'no 3h pause after upset',{});
    if(out==='mild') check(w.until-e.createdAt>=2*L.gapSec(e.step)*1000,'wobble wait not doubled',{});
    check(w.size>=3&&w.size<=6,'session size range',{size:w.size});
  }
  // step-ups per day cap
  const st=L.computeState(list,start);
  const perDay={}; let lvlPrev=start; const lv=L.levelsAfter(list,start);
  list.forEach((e,i)=>{ const p=i?lv[i-1]:start; if(lv[i]>p) perDay[e.date]=(perDay[e.date]||0)+1; });
  Object.keys(perDay).forEach(d=>check(perDay[d]<=3,'more than 3 step-ups in a day',{d,n:perDay[d]}));
}
if(fails.length){ console.log(fails.slice(0,8).join('\n')); process.exit(1); } console.log('fuzz tests ok (' + n + ' checks)');
