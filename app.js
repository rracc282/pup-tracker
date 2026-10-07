// Churro tracker app. Uses logic.js (pure) and Supabase (sync + push queue).
'use strict';
const APP_VERSION = '12';
const CFG = window.PT_CONFIG || {};
const $ = id => document.getElementById(id);
const esc = s => String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
function lsGet(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
function lsSet(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }
function lsDel(k){ try{ localStorage.removeItem(k); }catch(e){} }
function pad(n){ return String(n).padStart(2,'0'); }
function todayStr(){ const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth()+1) + '-' + pad(d.getDate()); }
function fmtDate(iso){
  const [y,m,d] = iso.split('-').map(Number);
  return new Date(y, m-1, d).toLocaleDateString('en-GB',{weekday:'short'}) + ' ' + pad(d) + '/' + pad(m);
}
function fmtTime(ms){ const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function clockStr(sec){
  sec = Math.max(0, Math.floor(sec));
  const h = Math.floor(sec/3600), m = Math.floor((sec%3600)/60), s = sec % 60;
  return h ? (h + ':' + pad(m) + ':' + pad(s)) : (m + ':' + pad(s));
}
function uuid(){
  if(crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random()*16|0; return (c === 'x' ? r : (r&3|8)).toString(16); });
}

const PLACES = [['home','Home'],['zurich','Zurich'],['other','Elsewhere']];
const PLACE_NAME = { home:'Home', zurich:'Zurich', other:'Elsewhere' };
const OUT_NAME = { calm:'Calm', mild:'Wobble', escalated:'Upset' };
const POCKET_TAGS = ['Coffee','Shower','Bins','Cooking','Call','Evening','Other'];
const REACTION_TAGS = ['Asleep before','Awake before','Head up','Stood up','Followed me','Went to the door','Vocalised','Settled under 10 s','Settled under 1 min','Took over 1 min','Outside noise'];
const SPOTS = ['Sofa','Bed','Crate','Floor'];
const DAY_TYPES = [['home','Home','Most of the day at home. Room for up to 10 longer reps.'],['sitter','Sitter','Sitter has her. Up to 5 longer reps, plenty of quick ones.'],['weekend','Weekend','We may be out a lot. Up to 8 longer reps. Gentle.']];

// ---------- state ----------
let sb = null, session = null;
let repMap = new Map();         // id -> entry (flat)
let entries = [];               // derived, sorted
let days = {};                  // date -> {day_type, medicated}
let outbox = [];                // [{t:'rep'|'day', row}]
let online = navigator.onLine;
let place = 'home';   // today's place, set from the day sheet
let pocket = parseInt(lsGet('pt-pocket'), 10) || 15;
let spot = lsGet('pt-spot') || '';
let ui = { mode:'idle', rep:null, feedback:null, showAll:false, confirmDel:null, editId:null, override:false, alone:null };
// "How long do you have?" only matters once the working step no longer fits the shortest option.
function pocketMatters(st){ return !fits(st.level, POCKETS[0][0]); }
function effPocket(st){ return pocketMatters(st) ? pocket : POCKETS[POCKETS.length - 1][0]; }
let tickTimer = null, wakeLock = null, audio = null, pushOn = false;

// ---------- data mapping ----------
function entryOf(row){
  const e = Object.assign({}, row.data || {});
  e.id = row.id; e.date = row.date; e.kind = row.kind; e.createdAt = Date.parse(row.created_at);
  return normalizeEntry(e);
}
function rowOf(e){
  const data = Object.assign({}, e);
  delete data.id; delete data.date; delete data.kind; delete data.createdAt;
  if(e.kind === 'dep'){ data.stepId = idOf(e.step); if(e.level != null) data.levelId = idOf(e.level); }
  return { id: e.id, user_id: session.user.id, date: e.date, kind: e.kind, created_at: new Date(e.createdAt).toISOString(), data, updated_at: new Date().toISOString() };
}
function rebuild(){ entries = sortedByDate(Array.from(repMap.values())); }
function liveEntries(){ return entries.filter(isLive); }
function cacheSave(){
  lsSet('pt-cache', JSON.stringify({ reps: Array.from(repMap.values()), days }));
  lsSet('pt-outbox', JSON.stringify(outbox));
}
function cacheLoad(){
  try{
    const c = JSON.parse(lsGet('pt-cache') || 'null');
    if(c){ (c.reps || []).forEach(e => repMap.set(e.id, e)); days = c.days || {}; }
    outbox = JSON.parse(lsGet('pt-outbox') || '[]');
  }catch(e){}
  rebuild();
}

// ---------- sync ----------
function setSync(){
  const el = $('syncDot'); if(!el) return;
  const n = outbox.length;
  el.className = 'sync' + ((!online || n) ? ' off' : '');
  el.textContent = !sb ? '· not configured' : !online ? '· offline' : n ? '· saving ' + n : '· synced';
}
async function flushOutbox(){
  if(!sb || !session || !online || !outbox.length) return;
  const batch = outbox.slice();
  for(const op of batch){
    try{
      const q = op.t === 'rep'
        ? sb.from('pt_reps').upsert(op.row, { onConflict:'id' })
        : op.t === 'daydel' ? sb.from('pt_reps').delete().eq('id', op.row.id)
        : sb.from('pt_daystate').upsert(op.row, { onConflict:'user_id,date' });
      let { error } = await q;
      if(error && op.t === 'day' && /place/i.test(error.message || '')){ const r = Object.assign({}, op.row); delete r.place; ({ error } = await sb.from('pt_daystate').upsert(r, { onConflict:'user_id,date' })); }
      if(error) throw error;
      outbox = outbox.filter(o => o !== op);
    }catch(e){ setStatus('Waiting to sync: ' + (e && e.message || 'offline')); break; }
  }
  cacheSave(); setSync();
}
function queueOp(op){
  // collapse earlier ops for the same row so only the newest state is sent
  outbox = outbox.filter(o => op.t === 'day' ? !(o.t === 'day' && o.row.date === op.row.date) : !(o.t !== 'day' && o.row.id === op.row.id));
  outbox.push(op); cacheSave(); setSync(); flushOutbox();
}
function putEntry(e){ repMap.set(e.id, e); rebuild(); queueOp({ t:'rep', row: rowOf(e) }); }
function removeEntry(id){ repMap.delete(id); rebuild(); queueOp({ t:'daydel', row:{ id } }); }
function putDay(date, patch){
  days[date] = Object.assign({}, days[date] || {}, patch);
  const d = days[date];
  queueOp({ t:'day', row:{ user_id: session.user.id, date, day_type: d.day_type || null, medicated: !!d.medicated, place: d.place || null, updated_at: new Date().toISOString() } });
}
async function pullAll(){
  if(!sb || !session || !online) return;
  try{
    const since = new Date(Date.now() - 400*86400000).toISOString().slice(0,10);
    const [r, d] = await Promise.all([
      sb.from('pt_reps').select('*').gte('date', since).order('created_at', { ascending:true }).limit(5000),
      sb.from('pt_daystate').select('*').gte('date', since)
    ]);
    if(r.error) throw r.error; if(d.error) throw d.error;
    const m = new Map(); r.data.forEach(row => { const e = entryOf(row); m.set(e.id, e); });
    // keep what is still waiting in the outbox
    outbox.forEach(o => { if(o.t === 'rep') m.set(o.row.id, entryOf(o.row)); if(o.t === 'daydel') m.delete(o.row.id); });
    repMap = m; rebuild();
    const dd = {}; d.data.forEach(x => { dd[x.date] = { day_type:x.day_type, medicated:x.medicated, place:x.place }; });
    outbox.forEach(o => { if(o.t === 'day') dd[o.row.date] = { day_type:o.row.day_type, medicated:o.row.medicated, place:o.row.place }; });
    days = dd; cacheSave(); setStatus('Synced. ' + entries.length + ' entries.'); setSync(); render();
    maybeDeepLink();
  }catch(e){ setStatus('Could not read saved reps: ' + (e && e.message || 'unknown error')); }
}
function subscribeRealtime(){
  sb.channel('pt-live')
    .on('postgres_changes', { event:'*', schema:'public', table:'pt_reps' }, p => {
      if(p.eventType === 'DELETE'){ repMap.delete(p.old.id); }
      else { const e = entryOf(p.new); if(!outbox.some(o => o.t === 'rep' && o.row.id === e.id)) repMap.set(e.id, e); }
      rebuild(); cacheSave(); render();
    })
    .on('postgres_changes', { event:'*', schema:'public', table:'pt_daystate' }, p => {
      if(p.eventType === 'DELETE') delete days[p.old.date];
      else if(!outbox.some(o => o.t === 'day' && o.row.date === p.new.date)) days[p.new.date] = { day_type:p.new.day_type, medicated:p.new.medicated, place:p.new.place };
      cacheSave(); render();
    })
    .subscribe();
}

// ---------- queue (push notifications) ----------
async function qInsert(row){
  if(!sb || !session || !online) return null;
  try{
    const r = Object.assign({ id: uuid(), user_id: session.user.id, cancelled:false, body:'', urgent:false }, row);
    const { error } = await sb.from('pt_queue').insert(r);
    if(error) throw error;
    return r.id;
  }catch(e){ return null; }
}
async function qCancelKind(kind){
  if(!sb || !session || !online) return;
  try{ await sb.from('pt_queue').update({ cancelled:true }).eq('kind', kind).is('sent_at', null).eq('cancelled', false); }catch(e){}
}
async function qCancelId(id){
  if(!id || !sb || !online) return;
  try{ await sb.from('pt_queue').update({ cancelled:true }).eq('id', id); }catch(e){}
}
const READY_MSGS = [
  ['Ready for the next rep! 🐾', 'Churro has had her rest. Come back, let us go!'],
  ['Rest time is over 🎉', 'Ready when you are. Next rep is waiting.'],
  ['Back to it, team Churro! 💪', 'She is rested and the next rep is ready.'],
  ['Let us go! 🐶', 'Next rep is unlocked. Come on back.'],
  ['Ding ding! 🔔', 'The break is done. Ready for round two?'],
  ['Sausage is rested 🌭', 'Come back and let us do this.'],
  ['Your turn, coach 🏅', 'The next rep is waiting for you.'],
  ['Break over ✨', 'Fresh step, calm energy. Let us go!'],
  ['Snooze button off 😴', 'Churro is recharged. Time for the next rep.'],
  ['Plot twist: more training 🎬', 'The rest is done and the door is calling.'],
  ['Tick tock, rep o\'clock ⏰', 'Rest time is up. Come on back!'],
  ['She is ready, are you? 🐕', 'Next rep unlocked. Deep breath, calm energy.'],
  ['Round two, fight! 🥊', 'Gently, of course. The next rep is ready.'],
  ['Ears up, rest over 🐾', 'Next rep is waiting. You two are doing great.'],
  ['Treat o\'clock? 🦴', 'Break finished. Come back for the next rep.'],
  ['Back to the ladder 🪜', 'One more step up. Ready when you are.']
];
const TIMEUP_MSGS = [
  ['Time is up! ⏰', 'Come back in calmly, no big hello.'],
  ['That is the timer ⏱️', 'Walk in quietly, no fuss.'],
  ['Back in, low key 🚪', 'No big greeting, just calm.'],
  ['Time! ✅', 'Stay calm, ignore the party.'],
  ['Rep complete 🎉', 'Slip back in calmly.'],
  ['Door time 🐾', 'Go in quietly, praise comes later.'],
  ['Ding! Mission done 🔔', 'Stroll in like nothing happened.'],
  ['Tail-wag timer 🐕', 'Walk back in cool and calm.'],
  ['You did it! 🙌', 'Now the hard part: a very boring entrance.'],
  ['Time to return 🚪', 'Quiet entrance, zero fanfare.'],
  ['Stopwatch says yes ✨', 'Come in softly and keep it dull.'],
  ['Nailed it 💪', 'Ninja entrance, please. No big hello.']
];
const TEST_MSGS = [
  ['Woof! 🐕 It works', 'Notifications are on. Churro approves.'],
  ['Test passed ✅', 'Sausage-approved and ready to go.'],
  ['Ta-da! 🎉', 'Notifications are working. Treats all round!'],
  ['Squeaky toy squeak! 🧸', 'That was your test. All good.']
];
function rnd(a){ return a[Math.floor(Math.random() * a.length)]; }
function scheduleReady(){
  qCancelKind('ready').then(() => {
    const live = liveEntries().filter(e => e.kind === 'dep');
    const w = waitUntil(live);
    if(!w || w.until <= Date.now() + 5000) return;
    const last = live.slice().sort((a,b) => a.createdAt - b.createdAt).pop();
    if(last.outcome === 'escalated') return;
    const st = stateFrom(liveEntries(), place);
    const nx = pickNext(st, effPocket(st), place + '|' + depsFor(liveEntries(), place).length + '|' + st.level);
    if(capReached(nx.step)) return;
    const m = READY_MSGS[Math.floor(Math.random() * READY_MSGS.length)];
    qInsert({ fire_at: new Date(w.until).toISOString(), kind:'ready', tag:'ready', title:m[0], body:m[1], open:'' });
  });
}

// ---------- day type ----------
function dayState(){ return days[todayStr()] || {}; }
function dayType(){ return dayState().day_type || null; }
function dayPlace(){ return dayState().place || 'home'; }
function isMedicated(){ return !!dayState().medicated; }
function dayChipHtml(){
  const t = dayType();
  const pl = dayPlace();
  return (t ? DAY_NAME[t] : 'Set day') + (t && pl !== 'home' ? ' · ' + PLACE_NAME[pl] : '') + (isMedicated() ? ' · medicated' : '');
}
function renderDay(){
  const chip = $('dayChip');
  chip.textContent = dayChipHtml();
  chip.classList.toggle('med', isMedicated());
  const b = $('dayBanner');
  if(!dayType()) b.innerHTML = `<div class="banner ask">What kind of day is it, and where will you be? <button class="inl" data-action="daysheet">Pick today</button> It sets today's limits.</div>`;
  else if(isMedicated()) b.innerHTML = `<div class="banner">Medicated day. Reps are logged, but they do not move your step.</div>`;
  else b.innerHTML = '';
}
function openDaySheet(){
  const cur = dayType();
  $('dayBody').innerHTML = `<h2>Today</h2>
    <div class="stack">${DAY_TYPES.map(([k,l,h]) => `<button class="out ${cur===k?'calm':''}" data-daytype="${k}"><b>${l}</b><span>${h}</span></button>`).join('')}</div>
    <span class="label" style="margin:2px 0 -4px">Where will you be?</span>
    <div class="chips">${PLACES.map(([k,l]) => `<button class="chip" data-place="${k}" aria-pressed="${dayPlace()===k}">${l}</button>`).join('')}</div>
    <div class="toggle"><div><b>Medicated today</b><span class="hint">Reps still get logged and counted for spacing, but they do not move the ladder.</span></div>
      <button class="chip" id="medToggle" data-action="medtoggle" aria-pressed="${isMedicated()}">${isMedicated() ? 'Yes' : 'No'}</button></div>
    <button class="btn" data-action="closesheet">Done</button>`;
  if(!$('daySheet').open) $('daySheet').showModal();
}

// ---------- end of day ----------
function openEod(){
  const text = buildSummary(entries, days, todayStr(), place);
  $('eodBody').innerHTML = `<h2>End of day</h2>
    <div class="hint">Add how the day felt to you. Dictate with the mic on your keyboard. Then copy and paste it to Claude.</div>
    <textarea class="note" id="eodExtra" placeholder="How did the day feel? Anything odd? Questions for Claude?"></textarea>
    <textarea class="sumbox" id="eodText" readonly></textarea>
    <button class="btn primary" data-action="eodcopy">Copy summary</button>
    <a class="btn" style="text-align:center;text-decoration:none" href="https://claude.ai/new" target="_blank" rel="noopener">Open Claude</a>
    <div class="status" id="eodStatus"></div>
    <button class="btn" data-action="closesheet">Close</button>`;
  const upd = () => { $('eodText').value = text + ($('eodExtra').value.trim() ? '\n\nMy notes on the day: ' + $('eodExtra').value.trim() : ''); };
  upd(); $('eodExtra').addEventListener('input', upd);
  if(!$('eodSheet').open) $('eodSheet').showModal();
}
async function copyEod(){
  const t = $('eodText'); t.focus(); t.select();
  let ok = false;
  try{ await navigator.clipboard.writeText(t.value); ok = true; }catch(e){ try{ ok = document.execCommand('copy'); }catch(_){} }
  $('eodStatus').textContent = ok ? 'Copied. Paste it into a chat with Claude.' : 'Select the text and copy it by hand.';
}
function maybeDeepLink(){
  const q = new URLSearchParams(location.search).get('open');
  if(q === 'day') openDaySheet();
  else if(q === 'eod') openEod();
  if(q){ history.replaceState(null, '', location.pathname); }
}

// ---------- computed bits ----------
function todayDeps(){ const t = todayStr(); return liveEntries().filter(e => e.kind === 'dep' && e.date === t); }
function catCount(step){ return todayDeps().filter(e => isQuick(e.step) === isQuick(step)).length; }
function catLimit(step){ return isQuick(step) ? QUICK_CEILING : ceilingFor(new Date(), dayType()); }
function capReached(step){ return catCount(step) >= catLimit(step); }
function waitInfo(){
  const w = waitUntil(liveEntries().filter(e => e.kind === 'dep'));
  if(!w) return null;
  const remaining = w.until - Date.now();
  return remaining > 0 ? { remaining, until: w.until, reason: w.reason } : null;
}
function ladderEntries(){ return liveEntries(); }  // depsFor() further drops medicated reps

// ---------- rendering ----------
function renderPlace(){ /* place is chosen in the day sheet now */ }
function renderPocket(){
  $('pocketBlock').hidden = !pocketMatters(stateFrom(ladderEntries(), place));
  $('pocketChips').innerHTML = POCKETS.map(([m,l]) => `<button class="chip" data-pocket="${m}" aria-pressed="${pocket===m}" ${ui.mode!=='idle'?'disabled':''}>${l}</button>`).join('');
  $('spotChips').innerHTML = SPOTS.map(s => `<button class="chip" data-spot="${s}" aria-pressed="${spot===s}">${s}</button>`).join('');
}
function renderPos(){
  const st = stateFrom(ladderEntries(), place);
  $('posNow').textContent = stepLabel(st.level);
  $('posStep').textContent = 'Step ' + (st.level+1) + ' of ' + (TOP+1) + ' · goal 4 h';
  const pct = v => (v / TOP * 100) + '%';
  const info = barInfo(ladderEntries(), place);
  let clip = `<div id="posFill" style="width:${pct(st.level)}"></div>`;
  info.skipped.forEach(r => { const to = Math.min(r.to, st.level); if(to > r.from) clip += `<div class="seg skip" style="left:${pct(r.from)};width:${pct(to - r.from)}"></div>`; });
  info.regressed.forEach(r => { clip += `<div class="seg back" style="left:${pct(r.from)};width:${pct(r.to - r.from)}"></div>`; });
  let marks = '';
  info.marks.forEach(m => { marks += `<div class="mark" style="left:${pct(m)}" title="Dropped back from here"></div>`; });
  $('posBar').innerHTML = `<div class="barclip">${clip}</div>${marks}`;
  $('posBar').setAttribute('aria-valuenow', Math.round(st.level / TOP * 100));
  let nextM = null;
  for(let k = st.level + 1; k <= TOP; k++){ if(MILESTONES[k]){ nextM = k; break; } }
  $('posNext').textContent = nextM != null
    ? 'Next milestone: ' + fmtSec(DUR[nextM]) + ' (' + MILESTONES[nextM] + '), ' + (nextM - st.level) + ' step' + (nextM - st.level === 1 ? '' : 's') + ' away.'
    : 'You are at the top of the ladder.';
  const legend = [];
  if(info.skipped.length) legend.push('Orange: steps you set by hand, not earned by reps.');
  if(info.regressed.length) legend.push('Dark green: steps you stepped back from, still to re-earn.');
  if(info.marks.length) legend.push('Red tick: where she needed to drop back. It goes away once she is past it.');
  $('posLegend').innerHTML = legend.map(t => `<div>${esc(t)}</div>`).join('');
  const note = $('posNote');
  if(st.newPlace){ note.hidden = false; note.textContent = PLACE_NAME[place] + ' is new, so it starts three steps below your Home step. It has its own ladder from here.'; }
  else note.hidden = true;
}

const CUE_TXT_WATCH = [
  'Put your coat on, wait 5 seconds, take it off.',
  'Put your shoes on, wait 5 seconds, take them off.',
  'Pick up your bag, hold it for 3 seconds, put it down.',
  'Pick up your keys, jingle them, put them down.',
  'Press the bolt, wait 5 seconds, walk back and sit down. If she cannot see the door, that is fine: she hears it. Keep the living room door open.',
  'Coat on, shoes on, bag up, keys up, press the bolt. Then undo it all.'];
const CUE_TXT_DOOR = [
  'Put your coat on, wait 5 seconds, take it off.',
  'Put your shoes on, wait 5 seconds, take them off.',
  'Pick up your bag, hold it for 3 seconds, put it down.',
  'Pick up your keys, jingle them, put them down.',
  'Press the bolt, wait 5 seconds, then go in.',
  'Coat on, shoes on, bag up, keys up, press the bolt. Then undo it all.'];
const OUTCOME_HELP = {
  cue: {
    calm: 'Ignores the cue, or glances or lifts her head, and is resting again within about 10 seconds.',
    mild: 'Gets up, walks to you or the door, stares at it, or gives a whimper or one or two barks. Lies back down on her own within about a minute.',
    escalated: 'Keeps barking, howling or whining past a few seconds, scratches the door, paces, pants hard or trembles, or is not settled after a minute.'
  },
  out: {
    calm: 'No sound, no door-watching or pacing the whole time. She rests, chews or sleeps. A glance at the door is fine. She greets you normally when you come back. Check the Furbo recording if you could not watch live.',
    mild: 'A few seconds of whining, a bark or two, or standing at the door, then she settles by herself before you are back. Or a clearly over-excited greeting.',
    escalated: 'Barking, howling or whining that continues, scratching, pacing, heavy panting or drooling, trembling, or you came back early because it was building.'
  },
  rest: {
    calm: 'Rests, chews or sleeps. A glance or a short whimper is fine.',
    mild: 'Stands at the door or whines for a short while, then settles by herself.',
    escalated: 'Keeps barking or scratching, or does not settle.'
  }
};
function helpHtml(step){
  const h = OUTCOME_HELP[step < FIRST_OUT ? 'cue' : 'out'];
  return `<details class="help"><summary>What counts as calm, wobble, upset?</summary>
    <ul class="help-list">
      <li><b>Calm.</b> ${esc(h.calm)}</li>
      <li><b>Wobble.</b> ${esc(h.mild)}</li>
      <li><b>Upset.</b> ${esc(h.escalated)}</li>
      <li><b>Unsure?</b> Pick the harder label. It protects her progress.</li>
      <li><b>Stress signs.</b> Lip licking, yawning when not tired, whites of the eyes showing, ears pinned back, tucked tail, panting when it is not hot, trembling.</li>
    </ul></details>`;
}
function instructionsFor(step){
  if(step <= 5) return [
    'Churro is in the same room, relaxed, door open. She can see you.',
    CUE_TXT_WATCH[step],
    'Judge her in the first 10 seconds after the cue. Calm means she is back to resting by then. When unsure, tap the harder label.'];
  if(step <= 11) return [
    'Churro in the living room, door closed. You are in the hallway.',
    CUE_TXT_DOOR[step - 6],
    'Go in calmly. This rep is about her reaction, not about time. Calm means she is back to resting within about 10 seconds of each cue.'];
  if(step === LAST_CUE) return [
    'Churro in the living room, door closed. You are in the hallway.',
    'Coat on, shoes on, bag up, keys up, then unlock and open the front door and close it again. You stay inside.',
    'Everything off, go in calmly. This rep is about her reaction, not about time. Calm means she is back to resting within about 10 seconds of each cue.'];
  return [
    'Churro in the living room, door closed. Best after a walk, relaxed. If your partner is home you both leave. If one of you stays, she is not alone and it does not count.',
    'Step out, close the door, tap the button, wait out the time.',
    'Come back calmly with no greeting. End early at the first sign it is building.'];
}

const CUE_NAME = ['Coat','Shoes','Bag','Keys','Bolt','All five cues','Coat','Shoes','Bag','Keys','Bolt','All five cues','Front door'];
function cueName(i){ return 'cue: ' + CUE_NAME[i]; }
function feedbackHtml(){
  const f = ui.feedback;
  if(!f) return '';
  const [head, tail] = f.msg;
  const hasDetail = f.pocket.length || f.tags.length || f.walked || f.partner;
  let h = `<div class="feedback ${f.outcome}" role="status"><b>${esc(head)}</b>${esc(tail)}
    <div class="fb-form">
      <textarea class="note" id="fbNote" placeholder="Note: what did she do? Tap the mic on your keyboard to dictate." maxlength="800">${esc(f.note||'')}</textarea>`;
  if(f.open){
    h += `<div class="chips" role="group" aria-label="What were you doing">
        ${POCKET_TAGS.map(t => `<button class="chip" data-tag="${t}" aria-pressed="${f.pocket.includes(t)}">${t}</button>`).join('')}
        <button class="chip" data-action="walked" aria-pressed="${!!f.walked}">Walked first</button>
        <button class="chip" data-action="partner" aria-pressed="${!!f.partner}">Both of us</button>
      </div>
      <div class="chips" role="group" aria-label="What she did. Pick all that apply">
        ${REACTION_TAGS.map(t => `<button class="chip" data-rtag="${t}" aria-pressed="${f.tags.includes(t)}">${t}</button>`).join('')}
      </div>`;
  } else {
    h += `<div class="link-row"><button class="link" data-action="fbopen">${hasDetail ? 'Edit details' : 'Add details'}</button></div>`;
  }
  h += `<div class="hint" id="fbSaved"></div>
      <button class="btn primary" data-action="fbdone">Save and close</button>
      <div class="link-row"><button class="link" data-action="fbdiscard">Discard note</button></div>
    </div>
    <div class="link-row"><button class="link undo" data-action="undo">Undo this rep</button></div></div>`;
  return h;
}

function bannersHtml(step){
  let h = '';
  const todays = todayDeps();
  const last = todays.length ? todays[todays.length - 1] : null;
  if(last && last.outcome === 'escalated'){
    h += `<div class="banner upset">She had a rough rep today. Pausing until tomorrow is a good call.</div>`;
  } else if(!isMedicated() && stateFrom(ladderEntries(), place).lastEvent === 'capped' && last && last.date === todayStr()){
    h += `<div class="banner info">She has earned every step-up allowed today. Stopping here is a good call. Extra reps today only repeat this step.</div>`;
  } else if(capReached(step)){
    h += `<div class="banner info">That is enough ${isQuick(step) ? 'quick' : 'longer'} reps for today (${catLimit(step)}). More will not speed things up. Rest blocks still help.</div>`;
  }
  const w = waitInfo();
  if(w){
    const msg = w.reason === 'upset' ? 'Pause after a rough rep. A few hours or tomorrow is better.'
      : w.reason === 'session' ? 'That was a full session of 5. Take an hour off.'
      : 'Let her settle. Quiet time or a chew is fine. Skipping the wait gives her less time to recover.';
    h += `<div class="wait"><div class="wait-top"><b>Next rep in <span id="waitClock">${clockStr(w.remaining / 1000)}</span></b><span class="hint">at ${fmtTime(w.until)}</span></div><div class="hint">${msg}</div>${pushOn ? '<div class="hint">You will get a notification when it is time.</div>' : ''}</div>`;
  }
  return h;
}

function renderRep(){
  const el = $('repCard');
  const r = ui.rep;
  if(ui.mode === 'idle'){
    const live = ladderEntries();
    const st = stateFrom(live, place);
    const nx = pickNext(st, effPocket(st), place + '|' + depsFor(live, place).length + '|' + st.level);
    let sub;
    if(nx.fitted) sub = 'A shorter practice rep that fits your time. Your working step is ' + stepLabel(st.level) + '.';
    else if(nx.kind === 'decoy') sub = 'No leaving this time. These keep the cues from always meaning you are going.';
    else if(nx.afterWobble) sub = 'Easier on purpose after the wobble. Your working step is ' + stepLabel(st.level) + '.';
    else if(nx.easy) sub = 'Shorter or easier on purpose, to keep her confident. Your working step is ' + stepLabel(st.level) + '.';
    else sub = 'Working step · ' + st.run + ' of ' + st.need + ' calm in a row.';
    const capLeft = Math.max(1, catLimit(nx.step) - catCount(nx.step));
    const fitN = pocketMatters(st) ? Math.min(SESSION_MAX, capLeft, Math.max(1, Math.floor(pocket * 60 / (stepEst(nx.step) + gapSec(nx.step))))) : 1;
    const blocked = (!!waitInfo() || capReached(nx.step)) && !ui.override;
    const keep = ui.feedback ? feedbackHtml() : '';
    el.innerHTML = keep + bannersHtml(nx.step) +
      `<div class="eyebrow">Next rep · ${esc(stepTag(nx.step))}${nx.step < FIRST_OUT ? ' · ' + esc(cueName(nx.step)) : ''}</div>
       <div class="rep-label">${esc(stepLabel(nx.step))}</div>
       <div class="rep-sub">${esc(sub)}</div>
       <ul class="steps">${instructionsFor(nx.step).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
       ${helpHtml(nx.step)}
       ${fitN > 1 ? `<div class="hint" style="margin-bottom:12px">Your time fits about ${fitN} of these. The app spaces them for you.</div>` : ''}
       <button class="btn primary" data-action="start" data-step="${nx.step}" ${blocked ? 'disabled' : ''}>Start rep</button>
       ${blocked ? '<div class="link-row"><button class="link" data-action="override">Skip the wait and start now</button></div>' : ''}`;
    return;
  }
  if(!r){ ui.mode = 'idle'; renderRep(); return; }
  const label = r.kind === 'rest' ? 'Rest block' : stepLabel(r.step);
  if(ui.mode === 'prep'){
    el.innerHTML = `<div class="eyebrow">Get ready</div>
      <div class="rep-label">${esc(label)}</div>
      <ul class="steps">
        <li>Churro settled in the living room, door closed.</li>
        <li>Step out and close the front door.</li>
        <li>Tap the button once the door is shut. The count starts then.</li></ul>
      <button class="btn primary" data-action="go">Door is closed. Start counting</button>
      <div class="link-row"><button class="link" data-action="cancel">Cancel</button></div>`;
    return;
  }
  if(ui.mode === 'run'){
    const timed = r.kind === 'dep' && r.step >= FIRST_OUT;
    const reaction = r.kind === 'dep' && r.step < FIRST_OUT;
    const idleNote = r.kind === 'rest' ? 'Door closed. Do your thing, then open it calmly.'
      : r.step <= 5 ? 'No timer on this one. Do the cue, watch her, then tap Done.'
      : 'No timer on this one. Do the cues, watch Furbo, then go in and tap Done.';
    el.innerHTML = `<div class="eyebrow">${esc(label)}</div>
      ${reaction ? '<div class="rep-label">Watch her reaction</div>' : '<div class="clock" id="tClock">0:00</div>'}
      ${timed ? '<div class="tbar"><div id="tFill"></div></div>' : ''}
      <div class="tnote${timed && r.alerted ? ' alert' : ''}" id="tNote">${timed ? (r.alerted ? 'Time is up. Go back in calmly.' : 'Stay out until the beep.') : idleNote}</div>
      <button class="btn primary" data-action="back">${timed ? 'I am back' : 'Done'}</button>
      ${timed ? '<button class="btn danger" data-action="early">Back early. She is escalating</button>' : ''}`;
    tick();
    return;
  }
  if(ui.mode === 'outcome'){
    const oh = r.kind === 'rest' ? OUTCOME_HELP.rest : OUTCOME_HELP[r.step < FIRST_OUT ? 'cue' : 'out'];
    el.innerHTML = `<div class="eyebrow">${esc(label)} · ${esc(r.kind === 'rest' ? Math.round(r.actualSec/60) + ' min' : (r.step >= FIRST_OUT ? fmtSec(r.actualSec) : stepTag(r.step)))}</div>
      <h2>How was she?</h2>
      <div class="outs">
        <button class="out calm" data-out="calm"><b>Calm</b><span>${esc(oh.calm)}</span></button>
        <button class="out mild" data-out="mild"><b>Wobble</b><span>${esc(oh.mild)}</span></button>
        <button class="out escalated" data-out="escalated"><b>Upset</b><span>${esc(oh.escalated)}</span></button>
      </div>
      <div class="hint" style="margin-top:8px">Unsure between two? Pick the harder one. It protects her progress.</div>
      <div class="link-row"><button class="link" data-action="discard">Discard this rep</button></div>`;
  }
}

function renderToday(){
  const t = todayStr();
  const deps = todayDeps();
  const c = deps.filter(e => e.outcome === 'calm').length;
  const w = deps.filter(e => e.outcome === 'mild').length;
  const u = deps.filter(e => e.outcome === 'escalated').length;
  const cueN = deps.filter(e => isQuick(e.step)).length;
  const outN = deps.length - cueN;
  const rests = liveEntries().filter(e => e.kind === 'rest' && e.date === t).length;
  $('todayCard').innerHTML = `<h2>Today</h2>
    <div class="stats">
      <span>Quick reps <b>${cueN}</b> of ${QUICK_CEILING}</span>
      <span>Longer reps <b>${outN}</b> of ${ceilingFor(new Date(), dayType())}</span>
      <span>Calm <b>${c}</b></span><span>Wobble <b>${w}</b></span><span>Upset <b>${u}</b></span>
      <span>Rest blocks <b>${rests}</b></span>
    </div>
    <div class="hint" style="margin-bottom:8px">Rest block: she is in the living room, door closed, while you cook, shower or take a call. Tap Done when you open it.</div>
    <button class="btn" data-action="startrest" ${ui.mode!=='idle'?'disabled':''}>Busy at home? Start a rest block</button>
    <button class="btn primary" data-action="eod">End of day summary</button>`;
}

function describeEntry(e){
  if(e.kind === 'dep'){
    return 'Step ' + (e.step+1) + ' · ' + stepLabel(e.step) + (e.step >= FIRST_OUT && e.actualSec != null ? ' (' + fmtSec(e.actualSec) + ')' : '') + ' · ' + OUT_NAME[e.outcome] + (e.medicated ? ' · medicated' : '');
  }
  if(e.kind === 'rest') return 'Rest block · ' + (e.minutes != null ? e.minutes + ' min' : '') + ' · ' + OUT_NAME[e.outcome];
  if(e.kind === 'alone') return 'Alone time · ' + (e.minutes != null ? e.minutes + ' min' : '') + ' · ' + (OUT_NAME[e.outcome] || '');
  if(e.kind === 'baseline') return 'Step set by hand · ' + stepLabel(e.level);
  if(e.kind === 'legacy') return 'Earlier version' + (e.oldStep != null ? ' · old step ' + (e.oldStep + 1) : '') + ' · ' + (OUT_NAME[e.outcome] || 'Neutral day');
  return 'Old method · ' + (e.phase ? 'Phase ' + e.phase : '') + (e.subVal ? ' · ' + e.subVal + ' min' : '') + ' · ' + (OUT_NAME[e.outcome] || 'Neutral day');
}
function renderLog(){
  const sorted = entries.slice().reverse();
  const shown = ui.showAll ? sorted : sorted.slice(0, 12);
  if(!sorted.length){ $('logList').innerHTML = '<div class="empty">No reps yet. Your first one will show here.</div>'; return; }
  let h = shown.map(e => {
    const when = fmtDate(e.date) + ' · ' + fmtTime(e.createdAt) + (e.kind === 'dep' || e.kind === 'rest' ? ' · ' + (PLACE_NAME[e.place] || 'Home') : '');
    const extra = [e.pocket, (e.tags || []).join(', '), e.spot ? 'on the ' + e.spot.toLowerCase() : '', e.walked ? 'walked first' : '', e.partner ? 'both of us' : ''].filter(Boolean).join(' · ');
    const note = [e.notes, extra].filter(Boolean).join(' — ');
    const editing = ui.editId === e.id;
    let edit = '';
    if(editing){
      const sure = ui.confirmDel === e.id;
      edit = `<div class="edit">
        <div class="chips" role="group" aria-label="Outcome">${['calm','mild','escalated'].map(o => `<button class="chip" data-setout="${o}" data-id="${esc(e.id)}" aria-pressed="${e.outcome===o}">${OUT_NAME[o]}</button>`).join('')}</div>
        <textarea class="note" id="editNote" maxlength="800">${esc(e.notes || '')}</textarea>
        <button class="btn sm primary" data-action="editsave" data-id="${esc(e.id)}">Save</button>
        <button class="btn sm" data-action="del" data-id="${esc(e.id)}">${sure ? 'Sure? Delete for good' : 'Delete for good'}</button>
      </div>`;
    }
    return `<div class="row ${e.voided ? 'voided' : ''}">
      <span class="dot ${e.outcome || ''}"></span>
      <div class="row-main"><div class="row-top">${esc(when)}${e.voided ? ' · voided' : ''}</div><div class="row-what">${esc(describeEntry(e))}</div>${note ? `<div class="row-note">${esc(note)}</div>` : ''}${edit}</div>
      <div class="rowbtns"><button class="mini" data-action="void" data-id="${esc(e.id)}">${e.voided ? 'Restore' : 'Void'}</button><button class="mini" data-action="edit" data-id="${esc(e.id)}">${editing ? 'Close' : 'Edit'}</button></div>
    </div>`;
  }).join('');
  if(sorted.length > 12) h += `<div class="link-row"><button class="link" data-action="toggleall">${ui.showAll ? 'Show fewer' : 'Show all ' + sorted.length}</button></div>`;
  $('logList').innerHTML = h;
}

function renderMore(){
  const a = ui.alone;
  const perm = ('Notification' in window) ? Notification.permission : 'unsupported';
  let alone;
  if(!a) alone = `<button class="btn sm" data-action="aloneopen">Log time she was really alone</button>`;
  else alone = `<div class="stack"><b>Real alone time</b><div class="hint">For absences outside training (a sitter cancelled, an errand). It never changes your step.</div>
      <input class="txt" id="aloneMin" type="number" inputmode="numeric" min="1" placeholder="Minutes" value="${esc(a.minutes || '')}">
      <div class="chips">${['calm','mild','escalated'].map(o => `<button class="chip" data-aout="${o}" aria-pressed="${a.outcome===o}">${OUT_NAME[o]}</button>`).join('')}</div>
      <textarea class="note" id="aloneNote" placeholder="What happened? Dictate if you like.">${esc(a.notes || '')}</textarea>
      <button class="btn sm primary" data-action="alonesave">Save</button><button class="link" data-action="aloneclose">Cancel</button></div>`;
  $('moreList').innerHTML = `
    ${alone}
    <div class="stack"><b>Set my step</b>
      <div class="hint">Use this once to start where she really is, or to move by hand. Earlier reps stop counting toward the ladder.</div>
      <select class="txt" id="baseSel">${Array.from({length:TOP+1},(_,i) => `<option value="${i}" ${i===stateFrom(ladderEntries(), place).level?'selected':''}>${i+1}. ${esc(stepLabel(i))}</option>`).join('')}</select>
      <button class="btn sm" data-action="setbase">Set step for ${esc(PLACE_NAME[place])}</button></div>
    <div class="stack"><b>Notifications</b>
      <div class="hint">${pushOn ? 'On for this device.' : perm === 'denied' ? 'Blocked in iOS settings for this app.' : perm === 'unsupported' ? 'Open this from the Home Screen icon to turn them on.' : 'Off on this device.'}</div>
      ${pushOn ? '<button class="btn sm" data-action="pushtest">Send a test notification</button>' : (perm === 'denied' || perm === 'unsupported' ? '' : '<button class="btn sm primary" data-action="pushon">Turn on notifications</button>')}
    </div>
    <div class="stack"><b>Backup and import</b>
      <button class="btn sm" data-action="export">Download backup</button>
      <label class="btn sm" style="text-align:center">Import a backup file<input type="file" id="importFile" accept="application/json,.json" hidden></label>
    </div>
    <div class="status" id="dbStatus"></div>
    <div class="status">App version ${APP_VERSION}</div>
    <button class="btn sm" data-action="signout">Sign out</button>`;
}

function render(opts){
  if(!session) return;
  if(ui.mode === 'idle') place = dayPlace();
  renderDay(); renderPlace(); renderPocket(); renderPos(); renderToday(); renderLog();
  if(!ui.alone || !document.activeElement || !$('moreList').contains(document.activeElement)) renderMore();
  if(ui.mode !== 'run' || (opts && opts.rep)){
    // do not wipe a note the user is typing
    const typing = document.activeElement && document.activeElement.id === 'fbNote';
    if(!typing || (opts && opts.rep)) renderRep();
  }
  setSync();
}
function setStatus(t){ const s = $('dbStatus'); if(s) s.textContent = t; }

// ---------- timer ----------
function saveActive(){
  if(ui.mode === 'idle') lsDel('pt-active');
  else lsSet('pt-active', JSON.stringify({ mode: ui.mode, rep: ui.rep }));
}
function loadActive(){
  try{
    const a = JSON.parse(lsGet('pt-active') || 'null');
    if(a && a.rep && ['prep','run','outcome'].includes(a.mode)){ ui.mode = a.mode; ui.rep = a.rep; place = a.rep.place || place; }
  }catch(e){}
}
function tick(){
  const r = ui.rep;
  if(ui.mode !== 'run' || !r) return;
  const el = (Date.now() - r.startedAt) / 1000;
  const clock = $('tClock');
  if(!clock) return;
  const timed = r.kind === 'dep' && r.step >= FIRST_OUT;
  if(timed){
    const target = DUR[r.step];
    const remaining = target - el;
    if(remaining > 0){ clock.textContent = clockStr(Math.ceil(remaining)); clock.classList.remove('over'); }
    else {
      clock.textContent = '+' + clockStr(-remaining); clock.classList.add('over');
      if(!r.alerted){
        r.alerted = true; saveActive(); beep();
        const n = $('tNote'); if(n){ n.textContent = 'Time is up. Go back in calmly.'; n.classList.add('alert'); }
      }
    }
    const f = $('tFill'); if(f) f.style.width = Math.min(100, el / target * 100) + '%';
  } else clock.textContent = clockStr(el);
}
function startTicking(){ stopTicking(); tickTimer = setInterval(tick, 250); acquireWake(); }
function stopTicking(){ if(tickTimer){ clearInterval(tickTimer); tickTimer = null; } releaseWake(); }
function acquireWake(){ try{ if(navigator.wakeLock) navigator.wakeLock.request('screen').then(l => { wakeLock = l; }).catch(()=>{}); }catch(e){} }
function releaseWake(){ try{ if(wakeLock){ wakeLock.release(); wakeLock = null; } }catch(e){} }
function beep(){
  try{
    if(!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    [0, 0.3, 0.6].forEach(o => { const os = audio.createOscillator(), g = audio.createGain(); os.frequency.value = 880; g.gain.value = 0.15; os.connect(g); g.connect(audio.destination); os.start(t + o); os.stop(t + o + 0.18); });
  }catch(e){}
  try{ if(navigator.vibrate) navigator.vibrate([200,100,200]); }catch(e){}
}
function primeAudio(){ try{ if(!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if(audio.state === 'suspended') audio.resume(); }catch(e){} }
let lastWaitUntil = 0, notifiedFor = 0, baseTitle = document.title;
function readyAlert(){
  beep();
  try{ document.title = 'Ready: next rep'; setTimeout(() => { document.title = baseTitle; }, 60000); }catch(e){}
}

// ---------- actions ----------
async function flushNote(){
  const f = ui.feedback;
  if(!f || !f.id) return;
  const noteEl = $('fbNote');
  if(noteEl) f.note = noteEl.value;
  const e = repMap.get(f.id); if(!e) return;
  const patch = {};
  const note = (f.note || '').trim();
  if(note !== (e.notes || '')) patch.notes = note;
  const pk = f.pocket.join(', ');
  if(pk !== (e.pocket || '')) patch.pocket = pk;
  if(JSON.stringify(f.tags) !== JSON.stringify(e.tags || [])) patch.tags = f.tags.slice();
  if(!!f.walked !== !!e.walked) patch.walked = !!f.walked;
  if(!!f.partner !== !!e.partner) patch.partner = !!f.partner;
  if(!Object.keys(patch).length) return;
  putEntry(Object.assign({}, e, patch));
  const s = $('fbSaved'); if(s) s.textContent = 'Saved.';
}
let noteTimer = null;
function noteChanged(){ clearTimeout(noteTimer); noteTimer = setTimeout(flushNote, 700); }

async function saveRep(outcome){
  const r = ui.rep;
  if(!r) return;
  await flushNote();
  const date = todayStr();
  const live = ladderEntries();
  const before = stateFrom(live, r.place);
  const base = { v:3, id: uuid(), place:r.place, date, actualSec:r.actualSec, outcome, notes:'', createdAt: Date.now() };
  if(spot) base.spot = spot;
  if(isMedicated()) base.medicated = true;
  let data, msg;
  if(r.kind === 'rest'){
    data = Object.assign(base, { kind:'rest', minutes: Math.round(r.actualSec/60) });
    msg = outcome === 'escalated' ? ['Rest block was rough.', 'Shorten the next one or do it with the door open.'] : ['Logged.', 'Rest blocks do not change your step.'];
  } else {
    data = Object.assign(base, { kind:'dep', level: before.level, step:r.step, early: !!r.early });
    if(DUR[r.step] != null) data.targetSec = DUR[r.step];
    if(data.medicated) msg = ['Logged as medicated.', 'It does not move your step.'];
    else {
      const after = stateFrom(live.concat([data]), r.place);
      msg = coachMsg(after.lastEvent, after);
    }
  }
  ui.feedback = { outcome, msg, id:data.id, open:false, note:'', pocket:[], tags:[], walked:false, partner:false };
  const timeId = r.queueId;
  ui.mode = 'idle'; ui.rep = null; saveActive(); stopTicking();
  putEntry(data);
  qCancelId(timeId);
  render({ rep:true });
  if(r.kind === 'dep') scheduleReady();
}

function startRep(step){
  flushNote();
  ui.feedback = null; ui.override = false;
  qCancelKind('ready');
  const rep = { kind:'dep', step, place, startedAt:null, alerted:false };
  if(step >= FIRST_OUT){ ui.mode = 'prep'; ui.rep = rep; }
  else { rep.startedAt = Date.now(); ui.mode = 'run'; ui.rep = rep; primeAudio(); startTicking(); }
  saveActive(); render({ rep:true });
}
async function goOut(){
  primeAudio();
  const r = ui.rep;
  r.startedAt = Date.now(); ui.mode = 'run';
  saveActive(); startTicking(); render({ rep:true });
  const target = DUR[r.step];
  if(target > 300){
    const tm = rnd(TIMEUP_MSGS);
    const id = await qInsert({ fire_at: new Date(r.startedAt + target * 1000).toISOString(), kind:'timeup', tag:'timeup', urgent:true, title:tm[0], body:tm[1] + ' ' + stepLabel(r.step) + ' done.', open:'' });
    if(id && ui.rep){ ui.rep.queueId = id; saveActive(); }
  }
}
function startRest(){
  flushNote(); ui.feedback = null; primeAudio();
  ui.rep = { kind:'rest', place, startedAt: Date.now(), alerted:false };
  ui.mode = 'run'; saveActive(); startTicking(); render({ rep:true });
}
function finishRun(early){
  const r = ui.rep; if(!r) return;
  r.actualSec = Math.round((Date.now() - r.startedAt) / 1000);
  stopTicking();
  if(early){ r.early = true; saveRep('escalated'); return; }
  qCancelId(r.queueId);
  ui.mode = 'outcome'; saveActive(); render({ rep:true });
}
function cancelRep(){
  if(ui.rep) qCancelId(ui.rep.queueId);
  ui.mode = 'idle'; ui.rep = null; saveActive(); stopTicking(); render({ rep:true });
  scheduleReady();
}
function undoLast(){
  const f = ui.feedback; if(!f || !f.id) return;
  const e = repMap.get(f.id);
  if(e) putEntry(Object.assign({}, e, { voided:true }));
  ui.feedback = null; render({ rep:true }); scheduleReady();
}

// ---------- push ----------
function b64ToU8(s){
  const p = '='.repeat((4 - s.length % 4) % 4), b = (s + p).replace(/-/g,'+').replace(/_/g,'/'), raw = atob(b);
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}
async function swReg(){ if(!('serviceWorker' in navigator)) return null; try{ return await navigator.serviceWorker.ready; }catch(e){ return null; } }
async function checkPush(){
  try{
    const reg = await swReg();
    const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
    pushOn = !!sub && Notification.permission === 'granted';
    if(pushOn && sub && session) savePushSub(sub);
  }catch(e){ pushOn = false; }
}
async function savePushSub(sub){
  if(!sb || !session || !online) return;
  try{ await sb.from('pt_push_subs').upsert({ user_id: session.user.id, endpoint: sub.endpoint, sub: sub.toJSON() }, { onConflict:'endpoint' }); }catch(e){}
}
async function enablePush(){
  try{
    const perm = await Notification.requestPermission();
    if(perm !== 'granted'){ setStatus('Notifications were not allowed.'); renderMore(); return; }
    const reg = await swReg();
    if(!reg){ setStatus('Notifications need the Home Screen app.'); return; }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: b64ToU8(CFG.VAPID_PUBLIC) });
    await savePushSub(sub);
    pushOn = true; renderMore(); setStatus('Notifications are on. Send a test to check.');
  }catch(e){ setStatus('Could not turn on notifications: ' + (e && e.message || e)); }
}
async function testPush(){
  const tt = rnd(TEST_MSGS);
  const id = await qInsert({ fire_at: new Date().toISOString(), kind:'test', tag:'test', urgent:true, title:tt[0], body:tt[1], open:'' });
  setStatus(id ? 'Test queued. It should arrive within a minute.' : 'Could not queue the test. Are you online?');
}

// ---------- import / export ----------
function exportBackup(){
  const payload = { exportedAt: new Date().toISOString(), reps: entries.map(e => Object.assign({}, e, e.kind === 'dep' ? { stepId: idOf(e.step), levelId: e.level != null ? idOf(e.level) : undefined } : {})), days };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'churro-backup-' + todayStr() + '.json';
  document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}
async function importFile(file){
  try{
    const j = JSON.parse(await file.text());
    const byLegacy = new Map();
    repMap.forEach(e => { if(e.legacyId) byLegacy.set(e.legacyId, e); });
    let n = 0;
    (j.reps || []).forEach(x => {
      const lid = x.legacyId || x.id;
      const e = normalizeEntry(Object.assign({}, x));
      e.legacyId = lid;
      if(!e.date || !e.kind) return;
      if(!e.createdAt) e.createdAt = Date.parse(e.date + 'T12:00:00');
      const ex = lid && byLegacy.get(lid);
      if(ex){
        // same entry imported before: update it in place (so a corrected file never makes duplicates)
        if(JSON.stringify(rowOf(Object.assign({}, e, { id: ex.id })).data) === JSON.stringify(rowOf(ex).data) && ex.kind === e.kind) return;
        e.id = ex.id; if(ex.voided) e.voided = true;
      } else e.id = uuid();
      repMap.set(e.id, e); outbox.push({ t:'rep', row: rowOf(e) }); n++;
    });
    if(j.days){ Object.keys(j.days).forEach(d => { if(!days[d]) putDay(d, j.days[d]); }); }
    rebuild(); cacheSave(); flushOutbox(); render();
    setStatus(n ? 'Imported or updated ' + n + ' entries.' : 'Nothing new to import. Everything in the file is already here.');
  }catch(e){ setStatus('That file could not be read.'); }
}

// ---------- events ----------
document.addEventListener('click', ev => {
  const t = ev.target.closest('button');
  if(!t) return;
  if(t.id === 'dayChip'){ openDaySheet(); return; }
  if(t.dataset.daytype){ putDay(todayStr(), { day_type: t.dataset.daytype, place: dayState().place || 'home' }); openDaySheet(); render(); return; }
  if(t.dataset.place){ putDay(todayStr(), { place: t.dataset.place }); if(ui.mode === 'idle') place = t.dataset.place; ui.feedback = null; openDaySheet(); render({ rep:true }); return; }
  if(t.dataset.pocket){ if(ui.mode === 'idle'){ pocket = parseInt(t.dataset.pocket, 10); lsSet('pt-pocket', String(pocket)); render({ rep:true }); } return; }
  if(t.dataset.spot){ spot = spot === t.dataset.spot ? '' : t.dataset.spot; lsSet('pt-spot', spot); renderPocket(); return; }
  if(t.dataset.out){ saveRep(t.dataset.out); return; }
  if(t.dataset.tag){ if(ui.feedback){ const f = ui.feedback; f.note = ($('fbNote') && $('fbNote').value) || f.note; const k = t.dataset.tag; f.pocket = f.pocket.includes(k) ? f.pocket.filter(x => x !== k) : f.pocket.concat(k); flushNote(); renderRep(); } return; }
  if(t.dataset.rtag){ if(ui.feedback){ const f = ui.feedback; f.note = ($('fbNote') && $('fbNote').value) || f.note; const k = t.dataset.rtag; f.tags = f.tags.includes(k) ? f.tags.filter(x => x !== k) : f.tags.concat(k); flushNote(); renderRep(); } return; }
  if(t.dataset.setout){ const e = repMap.get(t.dataset.id); if(e){ putEntry(Object.assign({}, e, { outcome: t.dataset.setout })); render({ rep:true }); } return; }
  if(t.dataset.aout){ ui.alone.outcome = t.dataset.aout; ui.alone.minutes = $('aloneMin').value; ui.alone.notes = $('aloneNote').value; renderMore(); return; }
  switch(t.dataset.action){
    case 'start': startRep(parseInt(t.dataset.step, 10)); break;
    case 'go': goOut(); break;
    case 'back': finishRun(false); break;
    case 'early': finishRun(true); break;
    case 'cancel': case 'discard': cancelRep(); break;
    case 'startrest': startRest(); break;
    case 'override': ui.override = true; renderRep(); break;
    case 'fbopen': if(ui.feedback){ ui.feedback.note = ($('fbNote') && $('fbNote').value) || ui.feedback.note; ui.feedback.open = true; renderRep(); } break;
    case 'walked': if(ui.feedback){ ui.feedback.note = ($('fbNote') && $('fbNote').value) || ui.feedback.note; ui.feedback.walked = !ui.feedback.walked; flushNote(); renderRep(); } break;
    case 'partner': if(ui.feedback){ ui.feedback.note = ($('fbNote') && $('fbNote').value) || ui.feedback.note; ui.feedback.partner = !ui.feedback.partner; flushNote(); renderRep(); } break;
    case 'undo': undoLast(); break;
    case 'fbdone': flushNote().then(() => { ui.feedback = null; renderRep(); }); break;
    case 'fbdiscard': {
      const f = ui.feedback; const e = f && f.id && repMap.get(f.id);
      if(e){ const c = Object.assign({}, e); c.notes = ''; delete c.pocket; delete c.tags; delete c.walked; delete c.partner; putEntry(c); }
      ui.feedback = null; renderRep(); break;
    }
    case 'toggleall': ui.showAll = !ui.showAll; renderLog(); break;
    case 'void': { const e = repMap.get(t.dataset.id); if(e){ putEntry(Object.assign({}, e, { voided: !e.voided })); render({ rep:true }); scheduleReady(); } break; }
    case 'edit': ui.editId = ui.editId === t.dataset.id ? null : t.dataset.id; ui.confirmDel = null; renderLog(); break;
    case 'editsave': { const e = repMap.get(t.dataset.id); const n = $('editNote'); if(e && n) putEntry(Object.assign({}, e, { notes: n.value.trim() })); ui.editId = null; render({ rep:true }); break; }
    case 'del': { const id = t.dataset.id; if(ui.confirmDel !== id){ ui.confirmDel = id; renderLog(); } else { ui.confirmDel = null; ui.editId = null; removeEntry(id); render({ rep:true }); } break; }
    case 'daysheet': openDaySheet(); break;
    case 'medtoggle': putDay(todayStr(), { medicated: !isMedicated() });
      // stamp today's existing reps so the ladder ignores (or counts) them consistently
      liveEntries().filter(e => e.kind === 'dep' && e.date === todayStr()).forEach(e => { const m = isMedicated(); if(!!e.medicated !== m) putEntry(Object.assign({}, e, { medicated: m })); });
      openDaySheet(); render({ rep:true }); break;
    case 'closesheet': $('daySheet').close(); $('eodSheet').close(); break;
    case 'eod': openEod(); break;
    case 'eodcopy': copyEod(); break;
    case 'aloneopen': ui.alone = { minutes:'', outcome:'calm', notes:'' }; renderMore(); break;
    case 'aloneclose': ui.alone = null; renderMore(); break;
    case 'alonesave': {
      const m = parseInt($('aloneMin').value, 10);
      if(!m){ setStatus('Enter the minutes.'); break; }
      putEntry({ v:3, id: uuid(), kind:'alone', date: todayStr(), createdAt: Date.now(), minutes: m, outcome: ui.alone.outcome, notes: $('aloneNote').value.trim() });
      ui.alone = null; render({ rep:true }); setStatus('Logged.'); break;
    }
    case 'setbase': { const lv = parseInt($('baseSel').value, 10); if(!confirm('Set your step for ' + PLACE_NAME[place] + ' to: ' + stepLabel(lv) + '? Reps before now stop counting toward the ladder.')) break; putEntry({ v:3, id: uuid(), kind:'baseline', place, date: todayStr(), createdAt: Date.now(), level: lv, from: stateFrom(ladderEntries(), place).level, outcome:'baseline', notes:'' }); render({ rep:true }); setStatus('Step set.'); break; }
    case 'pushon': enablePush(); break;
    case 'pushtest': testPush(); break;
    case 'export': exportBackup(); break;
    case 'signout': if(sb) sb.auth.signOut(); break;
  }
});
document.addEventListener('input', ev => { if(ev.target.id === 'fbNote' && ui.feedback){ ui.feedback.note = ev.target.value; noteChanged(); } });
document.addEventListener('focusout', ev => { if(ev.target.id === 'fbNote') flushNote(); });
document.addEventListener('change', ev => { if(ev.target.id === 'importFile' && ev.target.files[0]) importFile(ev.target.files[0]); });
window.addEventListener('online', () => { online = true; setSync(); flushOutbox().then(pullAll); });
window.addEventListener('offline', () => { online = false; setSync(); });
document.addEventListener('visibilitychange', () => {
  if(document.visibilityState === 'visible'){ if(ui.mode === 'run') { acquireWake(); tick(); } flushOutbox().then(pullAll); checkPush(); }
});
if('serviceWorker' in navigator){
  navigator.serviceWorker.addEventListener('message', ev => {
    if(ev.data && ev.data.open === 'day') openDaySheet();
    if(ev.data && ev.data.open === 'eod') openEod();
  });
}

// ---------- boot ----------
function showLogin(msg){ $('app').hidden = true; $('loginView').hidden = false; $('loginErr').textContent = msg || ''; }
async function onSession(s){
  session = s;
  if(!s){ showLogin(); return; }
  $('loginView').hidden = true; $('app').hidden = false;
  cacheLoad(); render({ rep:true });
  try{ await sb.from('pt_settings').upsert({ user_id: s.user.id, tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Zurich' }, { onConflict:'user_id' }); }catch(e){}
  await flushOutbox(); await pullAll(); subscribeRealtime(); checkPush();
}
async function boot(){
  loadActive();
  if('serviceWorker' in navigator){ try{ navigator.serviceWorker.register('sw.js'); }catch(e){} }
  if(!CFG.SUPABASE_URL || !CFG.SUPABASE_KEY || /PASTE/.test(CFG.SUPABASE_KEY)){ showLogin('This app is not configured yet (config.js).'); return; }
  sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
  $('loginForm').addEventListener('submit', async ev => {
    ev.preventDefault(); $('loginErr').textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
    if(error) $('loginErr').textContent = error.message;
  });
  sb.auth.onAuthStateChange((_e, s) => { if(!session || !s || s.user.id !== session.user.id) onSession(s); else session = s; });
  const { data } = await sb.auth.getSession();
  if(data && data.session && !session) onSession(data.session);
  else if(!data.session) showLogin();
  if(ui.mode === 'run') startTicking();
  setInterval(() => {
    if(!session || ui.mode !== 'idle') return;
    const w = waitInfo(), c = $('waitClock');
    if(w){ lastWaitUntil = w.until; if(c) c.textContent = clockStr(w.remaining / 1000); }
    else if(c){ renderRep(); }
    if(!w && lastWaitUntil && lastWaitUntil !== notifiedFor){ notifiedFor = lastWaitUntil; readyAlert(); }
  }, 1000);
}
boot();
