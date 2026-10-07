// Pure training logic. No DOM, no network. Loaded by index.html and tested in node.
// One ladder. Steps 0-5: a cue while she watches. 6-12: cues while she is behind the closed door. 13 and up: seconds spent outside.
const DUR = [null,null,null,null,null,null,null,null,null,null,null,null,0,2,4,7,10,15,20,30,45,60,90,120,180,240,300,420,600,900,1200,1800,2700,3600,5400,7200,10800,14400];
const TOP = DUR.length - 1;
const FIRST_OUT = 13;
const LAST_CUE = FIRST_OUT - 1;      // open and close the front door
const QUICK_CEILING = 15;            // cues and out-steps up to 60 s
function isQuick(i){ return i <= 21; }
const MILESTONES = {21:'bins out',26:'parcel pickup',31:'a quick grocery run',33:'a full grocery shop',35:'a drink with friends',37:'a concert'};
const POCKETS = [[2,'2 min'],[5,'5 min'],[15,'15 min'],[30,'30 min'],[60,'1 h'],[120,'2 h'],[270,'4 h+']];
const STEP_NAMES = [
  'Coat, she watches','Shoes, she watches','Bag, she watches','Keys, she watches','Bolt, she watches','Coat, shoes, bag, keys, bolt, she watches',
  'Coat, behind the door','Shoes, behind the door','Bag, behind the door','Keys, behind the door','Bolt, behind the door','Coat, shoes, bag, keys, bolt, behind the door',
  'Open and close the front door'];
// Stable names for every step, so history survives any future change to the ladder.
const CUE_IDS = ['watch.coat','watch.shoes','watch.bag','watch.keys','watch.bolt','watch.stack',
  'door.coat','door.shoes','door.bag','door.keys','door.bolt','door.stack','door.open'];
function idOf(i){ return i < FIRST_OUT ? CUE_IDS[i] : 'out.' + DUR[i]; }
function indexOfId(id){
  if(!id) return -1;
  const c = CUE_IDS.indexOf(id);
  if(c >= 0) return c;
  if(id.indexOf('out.') === 0){ const s = parseInt(id.slice(4), 10); return DUR.indexOf(s); }
  return -1;
}

function fmtSec(s){
  if(s === 0) return '0 s';
  if(s < 60) return s + ' s';
  if(s < 3600){
    const m = Math.floor(s/60), r = s % 60;
    return r ? (m + ' min ' + r + ' s') : (m + ' min');
  }
  const h = s/3600;
  return (Number.isInteger(h) ? h : h.toFixed(1)) + ' h';
}
function stepLabel(i){ return i < FIRST_OUT ? STEP_NAMES[i] : 'Out for ' + fmtSec(DUR[i]); }
function stepTag(i){ return i <= 5 ? 'She watches' : i <= 12 ? 'Behind the door' : 'You leave'; }
function stepEst(i){ return i < FIRST_OUT ? 60 : DUR[i] + 90; }       // seconds one rep takes, including setup
function gapSec(i){ return i < FIRST_OUT ? 120 : i <= 21 ? 180 : i <= 26 ? 600 : i <= 29 ? 1200 : 1800; } // calm-rep recovery gap
function fits(i, minutes){ return stepEst(i) <= minutes * 60; }
function need(level){ return level <= 2 ? 2 : level <= 12 ? 3 : level <= 25 ? 2 : 3; }
function capFor(level){ return level <= 12 ? 3 : level <= 25 ? 2 : 1; }

function sortedByDate(list){
  return list.slice().sort((a,b)=> (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || ((a.createdAt||0)-(b.createdAt||0)) || (a.id > b.id ? 1 : -1));
}

// A rep that has not been voided.
function isLive(e){ return !e.voided; }
// depList: ladder entries for ONE place, already sorted. Pure and replayable from the log.
function computeState(depList, startLevel){
  let level = depList.length && depList[0].level != null ? depList[0].level : startLevel;
  let run = 0, wob = 0, nextEasy = false, lastEvent = null;
  const adv = {};
  for(const e of depList){
    const hard = e.step >= level;
    nextEasy = false; lastEvent = null;
    if(e.outcome === 'calm'){
      wob = 0;
      if(hard){
        run++;
        if(run >= need(level)){
          const used = adv[e.date] || 0;
          if(level >= TOP){ run = 0; lastEvent = 'top'; }
          else if(used < capFor(level)){ level++; run = 0; adv[e.date] = used + 1; lastEvent = 'advance'; }
          else { run = need(level); lastEvent = 'capped'; }
        } else {
          lastEvent = 'calmProgress';
          nextEasy = (run === 1 && level >= FIRST_OUT);
        }
      } else {
        lastEvent = 'easyOk';
      }
    } else if(e.outcome === 'mild'){
      run = 0; wob++;
      if(wob >= 2){ level = Math.max(0, level - 1); wob = 0; lastEvent = 'wobbleDrop'; }
      else lastEvent = 'wobble';
    } else if(e.outcome === 'escalated'){
      level = Math.max(0, level - 2); run = 0; wob = 0; lastEvent = 'upset';
    }
  }
  return { level, run, wob, nextEasy, lastEvent, need: need(level) };
}

// A "baseline" entry says: my step is N from here on (set by hand). Reps before it no longer count.
function baselineFor(list, place){
  const b = list.filter(e => e.kind === 'baseline' && isLive(e) && (e.place || 'home') === place);
  return b.length ? sortedByDate(b).pop() : null;
}
// Reps that count toward the ladder: live, a ladder rep, this place, not medicated, after the last baseline.
function depsFor(list, place){
  const b = baselineFor(list, place);
  return sortedByDate(list.filter(e => e.kind === 'dep' && isLive(e) && !e.medicated && (e.place || 'home') === place && (!b || e.createdAt > b.createdAt)));
}
function startFor(list, place){
  const b = baselineFor(list, place);
  if(b) return b.level;
  if(place === 'home') return 0;
  return Math.max(0, stateFrom(list, 'home').level - 3);
}
function stateFrom(list, place){
  const own = depsFor(list, place);
  const st = computeState(own, startFor(list, place));
  if(place !== 'home') st.newPlace = own.length === 0 && !baselineFor(list, place);
  return st;
}
// Level after each rep in a sorted list, for the end-of-day summary.
function levelsAfter(depList, startLevel){
  const out = [];
  for(let i = 0; i < depList.length; i++) out.push(computeState(depList.slice(0, i + 1), startLevel).level);
  return out;
}

function rand01(seed){
  let h = 1779033703 ^ seed.length;
  for(let i = 0; i < seed.length; i++){ h = Math.imul(h ^ seed.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
// Mix: 60% working step, 25% shorter or easier on purpose, 15% no-leave decoy. After a wobble the next one is always easier.
// Same log gives the same pick on every device, until the next rep is logged. Never harder than the working step.
function pickNext(st, minutes, seed){
  let target = st.level, kind = 'hard';
  if(st.level >= FIRST_OUT){
    const r = rand01(seed + '|a');
    if(st.lastEvent === 'wobble') kind = 'easy';
    else if(r < 0.60) kind = 'hard';
    else if(r < 0.85) kind = 'easy';
    else kind = 'decoy';
    if(kind === 'easy'){
      target = Math.max(FIRST_OUT, st.level - (1 + Math.floor(rand01(seed + '|b') * 3)));
      if(st.level === FIRST_OUT){ target = LAST_CUE; kind = 'decoy'; }
    } else if(kind === 'decoy'){ target = LAST_CUE; }
  }
  else if(st.level >= 2){
    // Cue stage: 75% working step, 25% one or two rungs easier (never harder). Easier after a wobble.
    const r = rand01(seed + '|a');
    if(st.lastEvent === 'wobble' || r < 0.25){
      kind = 'easy';
      target = Math.max(0, st.level - (1 + Math.floor(rand01(seed + '|b') * 2)));
    }
  }
  let s = target;
  while(s > 0 && !fits(s, minutes)) s--;
  return { step: s, targetStep: target, kind, easy: s < st.level, fitted: s < target, afterWobble: st.lastEvent === 'wobble' };
}

// Longer reps per day. dayType: 'home' | 'sitter' | 'weekend' | null (then the weekday decides).
function ceilingFor(dateObj, dayType){
  if(dayType === 'home') return 10;
  if(dayType === 'weekend') return 8;
  if(dayType === 'sitter') return 5;
  const d = dateObj.getDay();
  if(d === 3) return 10;
  if(d === 0 || d === 6) return 8;
  return 5;
}

// Recovery: how long she rests after a rep before the next one.
function cooldownMs(e){
  if(e.outcome === 'escalated') return 3 * 3600 * 1000;
  let sec = gapSec(e.step);
  if(e.outcome === 'mild') sec *= 2;
  return sec * 1000;
}
const SESSION_MAX = 5, SESSION_GAP_MS = 45 * 60 * 1000, SESSION_BREAK_MS = 60 * 60 * 1000;
// depAll: every live ladder rep, any place. Returns null when no rep has been done yet.
function waitUntil(depAll){
  if(!depAll.length) return null;
  const list = depAll.slice().sort((a,b)=> (a.createdAt||0) - (b.createdAt||0));
  const last = list[list.length - 1];
  let until = (last.createdAt || 0) + cooldownMs(last);
  let reason = last.outcome === 'escalated' ? 'upset' : 'settle';
  let run = 1;
  for(let i = list.length - 1; i > 0; i--){
    if((list[i].createdAt - list[i-1].createdAt) < SESSION_GAP_MS) run++; else break;
  }
  if(run >= SESSION_MAX && last.outcome !== 'escalated'){
    const brk = (last.createdAt || 0) + SESSION_BREAK_MS;
    if(brk > until){ until = brk; reason = 'session'; }
  }
  return { until, run, reason };
}

function coachMsg(ev, st){
  switch(ev){
    case 'advance': return ['Calm. Step up.', 'Next: ' + stepLabel(st.level) + '.'];
    case 'top': return ['Calm at the top step.', 'This is the goal. Keep it regular and varied.'];
    case 'calmProgress':
      return ['Calm.', (st.need - st.run) + ' more calm in a row at this step and you move up.' + (st.level >= 2 ? ' Some reps in between are easier on purpose and do not count.' : '')];
    case 'easyOk': return ['Good.', 'Easier reps keep her confident. They do not count toward moving up.'];
    case 'capped': return ['Calm, and you are at today\'s step-up limit.', 'More reps today stay at this step.'];
    case 'wobble': return ['Small wobble.', 'Repeat this step. This is what her edge looks like.'];
    case 'wobbleDrop': return ['Two wobbles in a row.', 'You drop one step and build back up.'];
    case 'upset': return ['Rough one.', 'You dropped two steps. Pause for a few hours or until tomorrow.'];
    default: return ['Logged.', ''];
  }
}

// Turn a stored entry into what the logic expects. Steps are stored by name; old rows only have a number.
function normalizeEntry(e){
  if(e.kind === 'dep'){
    const s = indexOfId(e.stepId); if(s >= 0) e.step = s;
    const l = indexOfId(e.levelId); if(l >= 0) e.level = l;
  }
  return e;
}

// ---- end-of-day summary, pasted into Claude ----
function fmtDay(iso){
  const [y,m,d] = iso.split('-').map(Number);
  const wd = new Date(y, m-1, d).toLocaleDateString('en-GB',{weekday:'short'});
  return wd + ' ' + String(d).padStart(2,'0') + '/' + String(m).padStart(2,'0') + '/' + y;
}
function hhmm(ms){ const d = new Date(ms); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); }
const DAY_NAME = { home:'Home day', sitter:'Sitter day', weekend:'Weekend' };
const OUT_LABEL = { calm:'Calm', mild:'Wobble', escalated:'Upset' };

function buildSummary(entries, days, date, place){
  const live = entries.filter(isLive);
  const dayDeps = sortedByDate(live.filter(e => e.kind === 'dep' && e.date === date));
  const rests = live.filter(e => e.kind === 'rest' && e.date === date);
  const alone = live.filter(e => e.kind === 'alone' && e.date === date);
  const ds = days[date] || {};
  const st = stateFrom(live, place);
  const all = depsFor(live, place);
  const lv = levelsAfter(all, startFor(live, place));
  const levelAfterId = {}; all.forEach((e, i) => { levelAfterId[e.id] = lv[i]; });
  const c = dayDeps.filter(e => e.outcome === 'calm').length, w = dayDeps.filter(e => e.outcome === 'mild').length, u = dayDeps.filter(e => e.outcome === 'escalated').length;
  const L = [];
  L.push('End-of-day review for my dog. Please review as the CSAT panel: what the data shows, whether to call it a day, what to change for tomorrow, and any signal that she is stalling or regressing.');
  L.push('');
  L.push('Date: ' + fmtDay(date) + ' · Day type: ' + (DAY_NAME[ds.day_type] || 'not set') + ' · Medicated today: ' + (ds.medicated ? 'YES (reps do not count)' : 'no') + ' · Place: ' + place);
  L.push('Working step now: ' + stepLabel(st.level) + ' (step ' + (st.level + 1) + ' of ' + (TOP + 1) + '), ' + st.run + ' of ' + st.need + ' calm in a row.');
  L.push('Today: ' + dayDeps.length + ' reps (' + c + ' calm, ' + w + ' wobble, ' + u + ' upset), ' + rests.length + ' rest blocks' + (rests.length ? ' (' + rests.map(r => (r.minutes != null ? r.minutes : '?') + ' min ' + (OUT_LABEL[r.outcome] || '')).join(', ') + ')' : '') + ', alone time: ' + (alone.length ? alone.map(a => a.minutes + ' min ' + (OUT_LABEL[a.outcome] || '')).join(', ') : 'none') + '.');
  L.push('');
  L.push('Reps:');
  dayDeps.forEach((e, i) => {
    const kind = e.medicated ? 'medicated' : (e.step >= (e.level != null ? e.level : e.step) ? 'working' : 'easier');
    const dur = e.step >= FIRST_OUT && e.actualSec != null ? ' (' + fmtSec(e.actualSec) + ')' : '';
    const extra = [(e.tags || []).join(', '), e.spot ? 'spot: ' + e.spot : '', e.partner ? 'both of us' : '', e.walked ? 'walked first' : ''].filter(Boolean).join('; ');
    L.push((i + 1) + '. ' + hhmm(e.createdAt) + ' · ' + stepLabel(e.step) + dur + ' [' + kind + '] · ' + (OUT_LABEL[e.outcome] || '?') + (extra ? ' · ' + extra : '') + (e.notes ? ' · "' + e.notes + '"' : ''));
  });
  rests.forEach(r => L.push('Rest block ' + hhmm(r.createdAt) + ' · ' + (r.minutes != null ? r.minutes + ' min' : '') + ' · ' + (OUT_LABEL[r.outcome] || '') + (r.notes ? ' · "' + r.notes + '"' : '')));
  alone.forEach(a => L.push('Alone time ' + hhmm(a.createdAt) + ' · ' + a.minutes + ' min · ' + (OUT_LABEL[a.outcome] || '') + (a.notes ? ' · "' + a.notes + '"' : '')));
  const moves = [];
  let prev = null;
  dayDeps.forEach(e => { const l = levelAfterId[e.id]; if(l != null && prev != null && l !== prev) moves.push(stepLabel(prev) + ' → ' + stepLabel(l)); if(l != null) prev = l; });
  L.push('');
  L.push('Step changes today: ' + (moves.length ? moves.join('; ') : 'none') + '.');
  // Last 7 days
  const dates = Array.from(new Set(live.filter(e => e.kind === 'dep').map(e => e.date))).sort().slice(-7);
  if(dates.length){
    L.push('');
    L.push('Last days (date · day type · reps calm/wobble/upset · highest working step at end of day):');
    dates.forEach(d => {
      const dd = live.filter(e => e.kind === 'dep' && e.date === d);
      const cc = dd.filter(e => e.outcome === 'calm').length, ww = dd.filter(e => e.outcome === 'mild').length, uu = dd.filter(e => e.outcome === 'escalated').length;
      const lastE = sortedByDate(dd).filter(e => (e.place || 'home') === place && !e.medicated).pop();
      const lvl = lastE && levelAfterId[lastE.id] != null ? stepLabel(levelAfterId[lastE.id]) : '—';
      L.push(fmtDay(d) + ' · ' + ((days[d] && DAY_NAME[days[d].day_type]) || 'type not set') + ' · ' + dd.length + ' reps ' + cc + '/' + ww + '/' + uu + ' · ' + lvl);
    });
  }
  return L.join('\n');
}

if(typeof module !== 'undefined') module.exports = { DUR, TOP, FIRST_OUT, LAST_CUE, QUICK_CEILING, isQuick, STEP_NAMES, CUE_IDS, idOf, indexOfId, stepLabel, stepTag, stepEst, gapSec, fits, need, capFor, sortedByDate, computeState, depsFor, stateFrom, baselineFor, startFor, levelsAfter, rand01, pickNext, ceilingFor, cooldownMs, waitUntil, coachMsg, normalizeEntry, buildSummary, fmtSec, SESSION_MAX };
