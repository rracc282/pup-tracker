const LOGIC_VERSION = '74';
// Pure training logic. No DOM, no network. Loaded by index.html and tested in node.
// One ladder. Steps 0-5: a cue while she watches. 6-12: cues while she is behind the closed door. 13 and up: seconds spent outside.
// Time outside per step. Every step has a stable id ('out.<seconds>'), so inserting steps never changes saved history.
// Jumps between steps are mostly 25-40% (from 12% to 50% at the extremes) so the ladder moves in small increments.
const DUR = [null,null,null,null,null,null,null,null,null,null,null,null,0,2,3,4,5,7,10,12,15,20,25,30,40,50,60,75,90,120,150,180,240,300,360,420,480,600,750,900,1200,1500,1800,2220,2700,3600,4500,5400,7200,9000,10800,14400];
// The ladder before the extra steps were added. Only used to read old saved step numbers that have no step name.
const OLD_DUR = [null,null,null,null,null,null,null,null,null,null,null,null,0,2,4,7,10,15,20,30,45,60,90,120,180,240,300,420,600,900,1200,1800,2700,3600,5400,7200,10800,14400];
function fromOldIndex(i){ return i < 14 ? i : (OLD_DUR[i] != null ? DUR.indexOf(OLD_DUR[i]) : i); }
const TOP = DUR.length - 1;
const FIRST_OUT = 13;
const LAST_CUE = FIRST_OUT - 1;      // open and close the front door
const QUICK_CEILING = 15;            // cues and out-steps up to 60 s
function isQuick(i){ return i < FIRST_OUT || DUR[i] <= 60; }
const MILESTONES = {};
[[60,'bins out'],[300,'parcel pickup'],[1800,'a quick grocery run'],[3600,'a full grocery shop'],[7200,'a drink with friends'],[14400,'a concert']].forEach(([sec, name]) => { MILESTONES[DUR.indexOf(sec)] = name; });
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
function isTiny(i){ return i >= LAST_CUE && DUR[i] <= 7; }   // the front door and the first departures, up to 7 s
function gapSec(i){ return isTiny(i) ? 90 : i < FIRST_OUT ? 120 : DUR[i] <= 60 ? 180 : DUR[i] <= 300 ? 600 : DUR[i] <= 900 ? 1200 : 1800; } // calm-rep recovery gap
function fits(i, minutes){ return stepEst(i) <= minutes * 60; }
// Calm reps in a row needed to move up from this step, and the most step-ups allowed per day.
// Slow where it matters most: the front-door step and the first real departures (steps up to 60 s).
const GATE = 12;      // "Open and close the front door": the last step before real departures
const GATE_DAYS = 2;  // calm reps there must come from at least this many different days
function need(level){ return level <= 2 ? 2 : level <= 11 ? 3 : level === GATE ? 4 : 3; }
// Until 22 Oct 2026, departures from 75 s to 4 min needed only 2 calm reps. Reps logged on those days are still replayed that way.
function needV2a(level){ return level <= 2 ? 2 : level <= 11 ? 3 : level === GATE ? 4 : DUR[level] <= 60 ? 3 : DUR[level] <= 240 ? 2 : 3; }
function capFor(level){ return level <= 11 ? 3 : level > GATE && DUR[level] <= 10 ? 2 : DUR[level] <= 60 ? 1 : DUR[level] <= 240 ? 2 : 1; }
// Until 23 Oct 2026, the steps behind the door allowed only 2 step-ups a day. Reps from those days are still replayed that way.
const CAP3_FROM = '2026-10-24';
// From this day: a wobble or alert on a rep tagged "Restless before" says more about the start than about the step. It is kept in the log but does not count against her.
const RESTLESS_FROM = '2026-10-30';
function restlessSkip(e){ return !!e && e.date >= RESTLESS_FROM && (e.tags || []).includes('Restless before') && (e.outcome === 'mild' || e.outcome === 'alert'); }
function capV2a(level){ return level <= 5 ? 3 : level <= 11 ? 2 : level > GATE && DUR[level] <= 10 ? 2 : DUR[level] <= 60 ? 1 : DUR[level] <= 240 ? 2 : 1; }
// The stricter rules above apply from this day on. Reps logged before it are replayed under the rules she trained with,
// so changing the rules never rewrites her history or moves her back.
// From the front door on, a calm rep while she is asleep does not teach her about the cue. At least this many of the calm reps must be awake.
// A day counts toward the front door step only with at least this many calm reps while she was awake or dozing.
const GATE_DAY_REPS = 2;
function gateDays(dayAw){ return Object.keys(dayAw).filter(d => dayAw[d] >= GATE_DAY_REPS).length; }
function awakeNeed(n){ return Math.min(2, n - 1); }
const RULES_V2_FROM = '2026-10-13';
// From this day a small wobble no longer blocks step-ups for the rest of the day (it only restarts the count). An upset still does.
const WOBBLE_OK_FROM = '2026-10-18';
// From this day, a day's climb on departure steps is limited: she can end the day at most this many times higher than the step she
// started it on, and only 1 step-up on the first day back after 2 or more days without training (departure steps only, never the cues).
const CLIMB_FROM = '2026-10-23', CLIMB_RATIO = 1.5, AWAY_DAYS = 2;
// From this day: 3 calm reps on every departure step, and after 7 or more days without training at Home she starts one step easier.
const NEED3_FROM = '2026-10-23', BREAK_FROM = '2026-10-23', BREAK_DAYS = 7;
function dayNum(d){ return Math.round(Date.parse(d + 'T00:00:00Z') / 86400000); }
// Version of the step list. Every rep records the step list it was logged on. If steps are ever inserted, bump this number:
// reps from an older list then keep the step they were actually on, so her position never shifts.
const LADDER_VER = 4;
function needV1(level){ return level <= 2 ? 2 : level <= 12 ? 3 : (DUR[level] <= 240) ? 2 : 3; }
function capV1(level){ return level <= 12 ? 3 : (DUR[level] <= 240) ? 2 : 1; }

function sortedByDate(list){
  return list.slice().sort((a,b)=> (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) || ((a.createdAt||0)-(b.createdAt||0)) || (a.id > b.id ? 1 : -1));
}

// A rep that has not been voided.
function isLive(e){ return !e.voided; }
// depList: ladder entries for ONE place, already sorted. Pure and replayable from the log.
function computeState(depList, startLevel, asOf){
  let level = depList.length && depList[0].level != null ? depList[0].level : startLevel, prevDate = null, alertRun = 0, alertConv = false, eased = null, restlessRun = 0;
  const dayStart = {}, backDay = {};
  let rough = {}, dayAw = {}, run = 0, runDates = new Set(), runAwake = 0, wob = 0, wobMin = null, badStep = null, nextEasy = false, lastEvent = null, lastEasy = false;
  const adv = {}, drops = [];
  for(const e of depList){
    if((e.ladderVer == null ? LADDER_VER : e.ladderVer) !== LADDER_VER && e.level != null) level = e.level;   // reps from an older step list keep their recorded step
    // Back after a long break (Home only): start one step easier.
    if(prevDate != null && e.date !== prevDate && (e.place || 'home') === 'home' && e.date >= BREAK_FROM && dayNum(e.date) - dayNum(prevDate) >= BREAK_DAYS && level > 0){
      level--; run = 0; runDates = new Set(); runAwake = 0; dayAw = {}; wob = 0; wobMin = null; alertRun = 0;
    }
    if(dayStart[e.date] === undefined){ dayStart[e.date] = level; backDay[e.date] = prevDate != null && dayNum(e.date) - dayNum(prevDate) - 1 >= AWAY_DAYS; }
    prevDate = e.date;
    const hard = e.step >= level;
    lastEasy = !hard;
    nextEasy = false; lastEvent = null; badStep = null; alertConv = false;
    // "Alert": quiet, but early stress signs. It does not count and does not reset the count. A second one in a row counts as a wobble.
    let oc = e.outcome;
    const rsk = restlessSkip(e);
    if(rsk){ restlessRun++; } else { restlessRun = 0; }
    if(rsk){ /* restless start: no change to the counts */ }
    else if(oc === 'alert'){ alertRun++; if(alertRun >= 2){ oc = 'mild'; alertRun = 0; alertConv = true; } }
    else alertRun = 0;
    if(rsk){
      lastEvent = 'restless';
    } else if(oc === 'alert'){
      lastEvent = 'alert';
    } else if(oc === 'calm'){
      wob = 0; wobMin = null;
      if(hard){
        run++; runDates.add(e.date); if(!(e.tags||[]).includes('Asleep before')){ runAwake++; dayAw[e.date] = (dayAw[e.date] || 0) + 1; }
        const v2 = e.date >= RULES_V2_FROM, needNow = !v2 ? needV1(level) : (e.date >= NEED3_FROM ? need(level) : needV2a(level)), capNow = !v2 ? capV1(level) : (e.date >= CAP3_FROM ? capFor(level) : capV2a(level));
        if(run >= needNow){
          const used = adv[e.date] || 0;
          if(level >= TOP){ run = 0; runDates = new Set(); runAwake = 0; dayAw = {}; lastEvent = 'top'; }
          else if(v2 && level === GATE && gateDays(dayAw) < GATE_DAYS){ lastEvent = 'gate'; }   // needs awake calm reps on two different days
          else if(v2 && level > GATE && runAwake < awakeNeed(needNow)){ lastEvent = 'awake'; }   // calm, but too many asleep reps
          else if(v2 && rough[e.date]){ run = needNow; lastEvent = 'roughDay'; }   // a wobble or upset earlier today: no step-up until tomorrow
          else if(used < capNow && !(e.date >= CLIMB_FROM && ((backDay[e.date] && used >= 1 && level >= FIRST_OUT) || (level >= FIRST_OUT && DUR[dayStart[e.date]] > 0 && DUR[level + 1] > CLIMB_RATIO * DUR[dayStart[e.date]] + 1e-9)))){ level++; run = 0; runDates = new Set(); runAwake = 0; dayAw = {}; adv[e.date] = used + 1; lastEvent = 'advance'; }
          else { run = needNow; lastEvent = 'capped'; }
        } else {
          lastEvent = 'calmProgress';
          nextEasy = (run === 1 && level >= FIRST_OUT);
        }
      } else {
        lastEvent = 'easyOk';
      }
    } else if(oc === 'mild'){
      if(e.date < WOBBLE_OK_FROM) rough[e.date] = true;
      run = 0; runDates = new Set(); runAwake = 0; dayAw = {}; wob++; badStep = e.step; wobMin = wobMin == null ? e.step : Math.min(wobMin, e.step);
      // Two wobbles in a row: drop one step, or two when the wobbles happened on easier steps than the working one,
      // so the new working step is never above where she actually struggled.
      if(wob >= 2){ const f = level; level = Math.max(0, Math.min(level - 1, Math.max(level - 2, wobMin - 1))); wob = 0; wobMin = null; lastEvent = 'wobbleDrop'; if(level < f) drops.push({ from: f, to: level, why: 'wobbles' }); }
      else lastEvent = 'wobble';
    } else if(oc === 'escalated'){
      rough[e.date] = true;
      { const f = level; level = Math.max(0, level - 2); run = 0; runDates = new Set(); runAwake = 0; dayAw = {}; wob = 0; wobMin = null; badStep = e.step; lastEvent = 'upset'; if(level < f) drops.push({ from: f, to: level, why: 'upset' }); }
    }
  }
  // Today has no rep yet and the last training day was 7 or more days ago: show the easier start already.
  if(asOf && prevDate != null && asOf > prevDate && asOf >= BREAK_FROM && dayNum(asOf) - dayNum(prevDate) >= BREAK_DAYS && level > 0){
    eased = { from: level, days: dayNum(asOf) - dayNum(prevDate) };
    level--; run = 0; runDates = new Set(); runAwake = 0; dayAw = {}; wob = 0; wobMin = null; badStep = null; nextEasy = false; lastEasy = false; lastEvent = null;
  }
  return { eased, level, run, runDays: level === GATE ? gateDays(dayAw) : runDates.size, gate: level === GATE, wob, nextEasy, lastEasy, lastEvent, alertConv, restlessRun, badStep, need: need(level), drops };
}

// A "baseline" entry says: my step is N from here on (set by hand). Reps before it no longer count.
function baselineFor(list, place){
  const b = list.filter(e => e.kind === 'baseline' && isLive(e) && (e.place || 'home') === place);
  return b.length ? sortedByDate(b).pop() : null;
}
// Reps that count toward the ladder: live, a ladder rep, this place, not medicated, after the last baseline.
function depsFor(list, place){
  const b = baselineFor(list, place);
  const out = sortedByDate(list.filter(e => e.kind === 'dep' && isLive(e) && !e.medicated && (e.place || 'home') === place && (!b || e.createdAt > b.createdAt)));
  // A new place starts from scratch: ignore the starting step stored on its first rep by the older "three below Home" rule.
  if(place !== 'home' && !b && out.length && out[0].level != null) out[0] = Object.assign({}, out[0], { level: undefined });
  return out;
}
// Step ranges that were set forward by hand (not earned by reps). Each baseline remembers the step she was on before.
function skippedRanges(list, place){
  return list.filter(e => e.kind === 'baseline' && isLive(e) && (e.place || 'home') === place && e.from != null && e.level > e.from)
    .map(e => ({ from: e.from, to: e.level }));
}

// Everything the progress bar needs besides the current step:
//  skipped: steps set forward by hand (orange), regressed: steps she stepped back from by hand (dark green, until re-earned),
//  marks: steps where she dropped back by the rules (wobbles or an upset) and has not yet got past again (red).
function barInfo(list, place){
  const st = stateFrom(list, place);
  const bl = list.filter(e => e.kind === 'baseline' && isLive(e) && (e.place || 'home') === place).sort((a, b) => (a.createdAt||0) - (b.createdAt||0));
  const skipped = skippedRanges(list, place);
  const regressed = bl.filter(e => e.from != null && e.level < e.from).map(e => ({ from: e.level, to: e.from }))
    .map(r => ({ from: Math.max(r.from, st.level), to: r.to })).filter(r => r.to > r.from);
  const deps = sortedByDate(list.filter(e => e.kind === 'dep' && isLive(e) && !e.medicated && (e.place || 'home') === place));
  const drops = [];
  let seg = [];
  const flush = (start) => { if(seg.length){ const s = computeState(seg, start); (s.drops || []).forEach(d => drops.push(d)); } seg = []; };
  const bounds = bl.map(b => b.createdAt || 0);
  let startLevel = deps.length && deps[0].level != null ? deps[0].level : 0, bi = 0;
  deps.forEach(e => {
    while(bi < bounds.length && (e.createdAt || 0) > bounds[bi]){ flush(startLevel); startLevel = bl[bi].level; bi++; }
    seg.push(e);
  });
  flush(startLevel);
  const marks = Array.from(new Set(drops.filter(d => d.from >= st.level).map(d => d.from))).sort((a, b) => a - b);
  return { skipped, regressed, marks };
}
function startFor(list, place){
  const b = baselineFor(list, place);
  if(b) return b.level;
  return 0; // every place, including a new one, starts from the first step
}
function stateFrom(list, place, asOf){
  const own = depsFor(list, place);
  const st = computeState(own, startFor(list, place), place === 'home' ? asOf : null);
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
// Mix at the departure steps: after a working-step rep there is a 40% chance the next is shorter on purpose (about 3 in 10 reps overall). After a wobble the next one is easier.
// "Shorter" is always a real, shorter departure and scales with the working step: from about a tenth to three quarters of it.
// (At 2 s there is nothing shorter than 2 s, so those reps stay at the working step.)
// A rep that does not count (warm-up or shorter) is always followed by a working-step rep, so she never gets stuck on easy ones.
// Warm-ups: 1 or 2 per session (see warmupPlan). While the working step is a few seconds, a warm-up may be just opening and closing the door.
// Same log gives the same pick on every device, until the next rep is logged. Never harder than the working step.
function shorterStep(level, f){
  const t = DUR[level] * f; let s = level > FIRST_OUT ? FIRST_OUT : level;   // a shorter rep is always a real departure
  for(let i = FIRST_OUT; i < level; i++) if(DUR[i] <= t) s = i;
  return s;
}
function localDateOf(ms){ const d = new Date(ms); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
// Is the next rep a warm-up, and which one? deps: this place's live ladder reps, sorted. Returns { no, of } or null.
// Warm-ups start the day: one or two before her first rep of the day, then at most one more after a gap of 3 hours or more.
// Shorter gaps (a meeting, lunch) carry on as normal reps. Two warm-ups instead of one when: the last training day had a wobble or
// upset, she has been away from training for 3+ days, her working step is new (no rep at it yet), or she is one calm rep from moving up (so the deciding rep comes after she has settled in).
const WARM_GAP_MS = 3 * 3600 * 1000;
function warmupPlan(deps, st, now){
  if(st.level < GATE || st.lastEvent === 'wobble' || st.lastEvent === 'wobbleDrop') return null;
  const today = localDateOf(now);
  const todays = deps.filter(e => e.date === today), before = deps.filter(e => e.date < today);
  let two = st.need >= 2 && st.run === st.need - 1;
  if(before.length){
    const lastDate = before[before.length - 1].date;
    if(before.some(e => e.date === lastDate && e.outcome !== 'calm')) two = true;
    if((Date.parse(today + 'T12:00:00Z') - Date.parse(lastDate + 'T12:00:00Z')) / 86400000 >= 3) two = true;
  }
  // a step she has never done a rep at (the first day after a step-up): two warm-ups
  if(!deps.some(e => e.step >= st.level)) two = true;
  const of = two ? 2 : 1;
  if(!todays.length) return { no: 1, of };
  const warmedUp = todays.every(e => e.level != null && e.step < e.level);
  if(warmedUp && todays.length < of) return { no: todays.length + 1, of };
  const last = deps[deps.length - 1];
  if(now - (last.createdAt || 0) >= WARM_GAP_MS) return { no: 1, of: 1 };
  return null;
}
function pickNext(st, minutes, seed, opts){
  let target = st.level, kind = 'hard', warmNo = 0, warmOf = 0;
  const plan = opts && (opts.warm || (opts.sessionStart ? { no: 1, of: 1 } : null));
  const warm = !!plan && st.level >= GATE && st.lastEvent !== 'wobble' && st.lastEvent !== 'wobbleDrop';
  if(warm){
    // Warm-up: one or two steps easier, so she settles in before the real test.
    kind = 'warmup'; warmNo = plan.no; warmOf = plan.of;
    const back = 2 + Math.floor(rand01(seed + '|w') * 2);
    const floor = DUR[st.level] <= 7 ? LAST_CUE : FIRST_OUT;   // door-only warm-ups until she is past a few seconds
    target = st.level === GATE ? 10 + Math.floor(rand01(seed + '|w') * 2) : Math.max(floor, st.level - back);
  }
  else if(st.level >= FIRST_OUT){
    const r = rand01(seed + '|a');
    const wob = st.lastEvent === 'wobble' || st.lastEvent === 'wobbleDrop';
    if(wob) kind = 'easy';
    else if(st.lastEasy || st.lastEvent === 'alert' || st.lastEvent === 'restless') kind = 'hard';   // after an alert, repeat the working step
    else kind = r < 0.60 ? 'hard' : 'easy';
    if(kind === 'easy'){
      target = shorterStep(st.level, 0.10 + 0.65 * rand01(seed + '|b'));
      if(target >= st.level) kind = 'hard';   // nothing shorter to offer: repeat the working step
    }
  }
  else if(st.level >= 2){
    // Cue stage: 75% working step, 25% one or two rungs easier (never harder). Easier after a wobble.
    const r = rand01(seed + '|a');
    if(st.lastEvent === 'wobble' || st.lastEvent === 'wobbleDrop' || (!st.lastEasy && st.lastEvent !== 'alert' && st.lastEvent !== 'restless' && r < 0.25)){
      kind = 'easy';
      target = Math.max(0, st.level - (1 + Math.floor(rand01(seed + '|b') * 2)));
    }
  }
  // Never harder than the step that just wobbled or upset her.
  if(st.badStep != null && target > st.badStep){ target = st.badStep; if(kind === 'hard') kind = 'easy'; }
  let s = target;
  while(s > 0 && !fits(s, minutes)) s--;
  return { step: s, targetStep: target, kind, easy: s < st.level, fitted: s < target, afterWobble: st.lastEvent === 'wobble' || st.lastEvent === 'wobbleDrop', warmNo, warmOf };
}

// True when this would be the first rep of a session: no ladder rep yet, or the last one was 45+ minutes before `at`.
function isSessionStart(entries, at){
  const deps = entries.filter(e => e.kind === 'dep' && isLive(e));
  if(!deps.length) return true;
  const last = Math.max.apply(null, deps.map(e => e.createdAt || 0));
  return (at - last) >= SESSION_GAP_MS;
}
// Longer reps per day. dayType: 'home' | 'sitter' | 'weekend' | null (then the weekday decides).
function ceilingFor(dateObj, dayType){
  if(dayType === 'home') return 10;
  if(dayType === 'weekend') return 8;
  if(dayType === 'sitter') return 5;
  if(dayType === 'rest') return 5;
  const d = dateObj.getDay();
  if(d === 3) return 10;
  if(d === 0 || d === 6) return 8;
  return 5;
}

// Recovery: how long she rests after a rep before the next one.
// The rest between reps grows smoothly with the time she was out, and varies by 0 to 50% so it is never a fixed script.
// Never shorter than the old fixed gap. Derived from the rep's timestamp, so every device agrees.
function restSec(step, ts){
  const base = gapSec(step);
  const grown = (step < FIRST_OUT || isTiny(step)) ? base : Math.min(1800, 120 + 150 * Math.sqrt((DUR[step] || 0) / 60));
  return Math.round(Math.max(base, grown) * (1 + 0.5 * hash01((ts || 0) + 31)));
}
function cooldownMs(e){
  if(e.outcome === 'escalated') return 3 * 3600 * 1000;
  let sec = restSec(e.step, e.createdAt);
  if(restlessSkip(e)) sec *= 1.5;
  else if(e.outcome === 'mild') sec *= 2;
  else if(e.outcome === 'alert') sec *= 1.5;
  return sec * 1000;
}
// Sessions vary on purpose so the day is not a fixed script: 3 to 6 reps, then a 45 to 90 min break.
// Both are derived from timestamps, so every device agrees and a reload does not change them.
const SESSION_MIN = 3, SESSION_MAX = 6, SESSION_GAP_MS = 45 * 60 * 1000;
function hash01(n){ let x = (Math.floor(n / 1000) ^ 0x9e3779b9) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0; x = Math.imul(x ^ (x >>> 16), 0x45d9f3b) >>> 0; x = (x ^ (x >>> 16)) >>> 0; return x / 4294967296; }
// Tiny exposures (front door up to 7 s) are short and low-stakes, so a session can hold more of them: 5 to 8.
function sessionSizeFor(startTs, tiny){ const lo = tiny ? 5 : SESSION_MIN, hi = tiny ? 8 : SESSION_MAX; return lo + Math.floor(hash01(startTs) * (hi - lo + 1)); }
function breakMinFor(lastTs){ return 45 + 5 * Math.floor(hash01(lastTs + 7919) * 10); }
// How many separate sessions (reps less than 45 min apart belong together) are in this list of reps.
function sessionCount(reps){
  const t = reps.map(e => e.createdAt || 0).sort((a, b) => a - b);
  let n = 0;
  t.forEach((x, i) => { if(i === 0 || x - t[i - 1] >= SESSION_GAP_MS) n++; });
  return n;
}
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
  const size = sessionSizeFor(list[list.length - run].createdAt || 0, isTiny(last.step));
  const breakMin = breakMinFor(last.createdAt || 0);
  if(run >= size && last.outcome !== 'escalated'){
    const brk = (last.createdAt || 0) + breakMin * 60 * 1000;
    if(brk > until){ until = brk; reason = 'session'; }
  }
  return { until, run, reason, size, breakMin };
}

function coachMsg(ev, st){
  switch(ev){
    case 'advance': return ['Calm. Step up.', 'Next: ' + stepLabel(st.level) + '.'];
    case 'top': return ['Calm at the top step.', 'This is the goal. Keep it regular and varied.'];
    case 'calmProgress':
      return ['Calm.', (st.need - st.run) + ' more calm in a row at this step and you move up.' + (st.level >= 2 ? ' Some reps in between are easier on purpose and do not count.' : '')];
    case 'easyOk': return ['Good.', 'Easier reps keep her confident. They do not count toward moving up.'];
    case 'roughDay': return ['Calm, but not a step-up day.', 'She had an upset earlier today, so you stay at this step and move up tomorrow.'];
    case 'capped': return ['Calm. No more step-ups today.', 'More reps at this step are fine, up to today\'s limit. Some will be shorter on purpose.'];
    case 'awake': return ['Calm, but she was asleep.', 'From the front door on, some of the calm reps need to happen while she is awake, so she actually notices the cue. Do the next rep while she is awake or dozing.'];
    case 'gate': return ['Calm, but not yet.', 'The front door is the last step before real departures. It needs at least 2 calm reps with her awake or dozing on each of two different days, so come back tomorrow.'];
    case 'restless': return st && st.restlessRun >= 2
      ? ['Restless again. Stop for now.', 'Two reps in a row started with her restless. Neither counts against her. Meet her needs first (a sniff walk, a chew, some play), then try again later when she settles on her own.']
      : ['She was restless before this rep.', 'It does not count against her and your count stays. Wait until she lies down and settles on her own before the next rep. If it happens again, stop for now.'];
    case 'alert': return ['Alert.', 'Quiet, but she showed early stress signs. This rep does not count and your count stays. Repeat this step. A second alert in a row counts as a wobble.'];
    case 'wobble': return st && st.alertConv ? ['Second alert in a row.', 'That counts as a wobble: the count restarts and the next rep is easier. This is what her edge looks like.'] : ['Small wobble.', 'Repeat this step. This is what her edge looks like.'];
    case 'wobbleDrop': return [st && st.alertConv ? 'Second alert, and two wobbles in a row.' : 'Two wobbles in a row.', 'You drop a step or two, to below where she struggled, and build back up. The next rep is easier.'];
    case 'upset': return ['Rough one.', 'You dropped two steps. Pause for a few hours or until tomorrow.'];
    default: return ['Logged.', ''];
  }
}

// Turn a stored entry into what the logic expects. Steps are stored by name; old rows only have a number.
function normalizeEntry(e){
  if(e.kind === 'dep'){
    const s = indexOfId(e.stepId); if(s >= 0) e.step = s; else if(e.step != null) e.step = fromOldIndex(e.step);
    const l = indexOfId(e.levelId); if(l >= 0) e.level = l; else if(e.level != null) e.level = fromOldIndex(e.level);
  } else if(e.kind === 'baseline'){
    const l = indexOfId(e.levelId); if(l >= 0) e.level = l; else if(e.level != null) e.level = fromOldIndex(e.level);
    const f = indexOfId(e.fromId); if(f >= 0) e.from = f; else if(e.from != null) e.from = fromOldIndex(e.from);
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
const PLACE_LABEL = { home:'Home (Geneva)', zurich:'Zurich', other:'Elsewhere' };
const DAY_NAME = { home:'Home day', sitter:'Sitter day', weekend:'Weekend', rest:'Rest day' };
const OUT_LABEL = { calm:'Calm', alert:'Alert', mild:'Wobble', escalated:'Upset' };

// ---------- watch-outs, weekly comparison, progress line ----------
function dateAdd(ds, n){ const d = new Date(ds + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
// "Get help" triggers. They never change the ladder. Medicated, voided and rest reps are ignored.
function helpAlerts(entries, date, place){
  const deps = sortedByDate(entries.filter(e => e.kind === 'dep' && isLive(e) && !e.medicated));
  const out = [];
  const from7 = dateAdd(date, -6);
  const ups = deps.filter(e => e.outcome === 'escalated' && e.date >= from7 && e.date <= date).length;
  if(ups >= 3) out.push(ups + ' upsets in the last 7 days.');
  const last3 = deps.slice(-3);
  if(last3.length === 3 && last3.every(e => e.outcome === 'mild' || e.outcome === 'escalated')) out.push('The last 3 reps were all wobbles or upsets.');
  const from10 = dateAdd(date, -9);
  const mine = depsFor(entries, place);
  if(mine.length){
    const lv = levelsAfter(mine, startFor(entries, place));
    const inWin = []; let upStep = false;
    mine.forEach((e, i) => {
      if(e.date >= from10 && e.date <= date){
        inWin.push(e.date);
        const prev = i > 0 ? lv[i - 1] : startFor(entries, place);
        if(lv[i] > prev) upStep = true;
      }
    });
    const days = new Set(inWin).size;
    if(days >= 5 && !upStep && lv[lv.length - 1] < TOP) out.push('No step up in 10 days, even with training on ' + days + ' of them.');
  }
  return out;
}
function windowStats(entries, place, from, to){
  const deps = sortedByDate(entries.filter(e => e.kind === 'dep' && isLive(e) && e.date >= from && e.date <= to));
  const calm = deps.filter(e => e.outcome === 'calm').length, alert = deps.filter(e => e.outcome === 'alert').length, mild = deps.filter(e => e.outcome === 'mild').length, esc = deps.filter(e => e.outcome === 'escalated').length;
  const mine = depsFor(entries, place);
  const lv = levelsAfter(mine, startFor(entries, place));
  let start = startFor(entries, place), end = null, high = null;
  mine.forEach((e, i) => {
    if(e.date < from) start = lv[i];
    else if(e.date <= to){ end = lv[i]; high = high == null ? lv[i] : Math.max(high, lv[i]); }
  });
  return { reps: deps.length, calm, alert, mild, esc, days: new Set(deps.map(e => e.date)).size, start, end: end == null ? start : end, high: high == null ? start : high, trained: end != null };
}
function weekCompare(entries, date, place){
  return { cur: windowStats(entries, place, dateAdd(date, -6), date), prev: windowStats(entries, place, dateAdd(date, -13), dateAdd(date, -7)) };
}
// One point per training day, only once real departures have started.
// start = the working step she began the day on (what she was asked to do), end = where she finished it (after any step-up).
function progressSeries(entries, place){
  if(!entries.some(e => e.kind === 'dep' && isLive(e) && e.step >= FIRST_OUT)) return null;
  const mine = depsFor(entries, place);
  if(!mine.length) return null;
  const first = mine[0].level != null ? mine[0].level : startFor(entries, place);
  const lv = levelsAfter(mine, startFor(entries, place));
  const byDay = new Map();
  mine.forEach((e, i) => {
    const d = byDay.get(e.date) || { date: e.date, start: i ? computeState(mine.slice(0, i), startFor(entries, place), place === 'home' ? e.date : null).level : first, level: 0, end: 0, maxCalm: null, reps: 0, calm: 0, alert: 0, mild: 0, esc: 0 };
    d.level = d.end = lv[i]; d.low = Math.min(d.low == null ? d.start : d.low, d.start, lv[i]); d.high = Math.max(d.high == null ? d.start : d.high, d.start, lv[i]);
    { const pe = i ? mine[i - 1] : null, pl = i ? lv[i - 1] : null; if(pe && pe.date === e.date && lv[i] < pl){ d.dropFrom = Math.max(d.dropFrom == null ? -1 : d.dropFrom, pl); d.dropTo = d.dropTo == null ? lv[i] : Math.min(d.dropTo, lv[i]); } }
    d.reps++; if(e.outcome === 'calm') d.calm++; else if(e.outcome === 'alert') d.alert++; else if(e.outcome === 'mild') d.mild++; else if(e.outcome === 'escalated') d.esc++;
    // longest time outside that she managed calmly that day (0 = only the front door)
    if(e.outcome === 'calm' && e.step >= LAST_CUE && DUR[e.step] != null) d.maxCalm = Math.max(d.maxCalm == null ? 0 : d.maxCalm, DUR[e.step]);
    byDay.set(e.date, d);
  });
  // The graph starts on the first day she actually did the front door step (or beyond), not with the early cue work.
  const firstDoor = mine.find(e => e.step >= LAST_CUE);
  const all = Array.from(byDay.values());
  const out = firstDoor ? all.filter(d => d.date >= firstDoor.date) : all;
  // easier: she started this day on a lower step than where she finished the day before ('break', after a long break)
  // or lower than the step she started the day before on ('drop', after a wobble or upset).
  out.forEach((d, k) => { d.easier = null; if(k){ const q = out[k - 1]; if(d.start < q.end) d.easier = 'break'; else if(d.start < q.start) d.easier = 'drop'; } });
  // dropped: she stepped back during this day (wobbles or an upset). dropFrom/dropTo are the steps.
    out.forEach((d, k) => { d.dropped = d.dropFrom != null; });
  return out;
}

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
  const c = dayDeps.filter(e => e.outcome === 'calm').length, al = dayDeps.filter(e => e.outcome === 'alert').length, w = dayDeps.filter(e => e.outcome === 'mild').length, u = dayDeps.filter(e => e.outcome === 'escalated').length;
  const L = [];
  L.push('End-of-day review for my dog. Please review as the CSAT panel: what the data shows, whether to call it a day, what to change for tomorrow, and any signal that she is stalling or regressing.');
  L.push('');
  L.push('Date: ' + fmtDay(date) + ' · Day type: ' + (DAY_NAME[ds.day_type] || 'not set') + ' · Medicated today: ' + (ds.medicated ? 'YES (reps do not count)' : 'no') + ' · Place: ' + place);
  L.push('Working step now, by place:');
  const placesUsed = Array.from(new Set(live.filter(e => (e.kind === 'dep' || e.kind === 'baseline')).map(e => e.place || 'home')));
  if(placesUsed.indexOf(place) < 0) placesUsed.unshift(place);
  placesUsed.forEach(p => {
    const sp = stateFrom(live, p);
    L.push('- ' + (PLACE_LABEL[p] || p) + (p === place ? ' (today)' : '') + ': ' + stepLabel(sp.level) + ' (step ' + (sp.level + 1) + ' of ' + (TOP + 1) + '), ' + sp.run + ' of ' + sp.need + ' calm in a row' + (sp.level === GATE ? ', on ' + sp.runDays + ' of ' + GATE_DAYS + ' days needed' : '') + '.');
  });
  L.push('Today: ' + dayDeps.length + ' reps (' + c + ' calm, ' + al + ' alert, ' + w + ' wobble, ' + u + ' upset), ' + rests.length + ' rest blocks' + (rests.length ? ' (' + rests.map(r => (r.minutes != null ? r.minutes : '?') + ' min ' + (OUT_LABEL[r.outcome] || '')).join(', ') + ')' : '') + ', alone time: ' + (alone.length ? alone.map(a => a.minutes + ' min ' + (OUT_LABEL[a.outcome] || '') + (a.trazodone ? ' (trazodone given)' : '')).join(', ') : 'none') + '.');
  const cuesOf = d => { const c = live.find(e => e.kind === 'cues' && e.date === d); return c ? (c.count || 0) : 0; };
  const anyCues = live.some(e => e.kind === 'cues' && (e.count || 0) > 0);
  if(anyCues) L.push('Cues without leaving today (coat, keys, bag, door, no departure): ' + cuesOf(date) + '.');
  L.push('');
  L.push('Reps:');
  dayDeps.forEach((e, i) => {
    const kind = e.medicated ? 'medicated' : (e.step >= (e.level != null ? e.level : e.step) ? 'working' : 'easier');
    const dur = e.step >= FIRST_OUT && e.actualSec != null ? ' (' + fmtSec(e.actualSec) + (e.byPlan ? ', as planned' : '') + ')' : '';
    const extra = [(e.tags || []).join(', '), e.spot ? 'spot: ' + e.spot : '', e.partner ? 'both of us' : '', e.walked ? 'walked first' : ''].filter(Boolean).join('; ');
    L.push((i + 1) + '. ' + hhmm(e.createdAt) + ' · ' + stepLabel(e.step) + dur + ' [' + kind + '] · ' + (OUT_LABEL[e.outcome] || '?') + (restlessSkip(e) ? ' (restless start, not counted against her)' : '') + (extra ? ' · ' + extra : '') + (e.notes ? ' · "' + e.notes + '"' : ''));
  });
  rests.forEach(r => L.push('Rest block ' + hhmm(r.createdAt) + ' · ' + (r.minutes != null ? r.minutes + ' min' : '') + ' · ' + (OUT_LABEL[r.outcome] || '') + (r.notes ? ' · "' + r.notes + '"' : '')));
  alone.forEach(a => L.push('Alone time ' + hhmm(a.createdAt) + ' · ' + a.minutes + ' min · ' + (OUT_LABEL[a.outcome] || '') + (a.trazodone ? ' · trazodone given' : '') + (a.notes ? ' · "' + a.notes + '"' : '')));
  const moves = [];
  let prev = null;
  dayDeps.forEach(e => { const l = levelAfterId[e.id]; if(l != null && prev != null && l !== prev) moves.push(stepLabel(prev) + ' → ' + stepLabel(l)); if(l != null) prev = l; });
  L.push('');
  L.push('Step changes today: ' + (moves.length ? moves.join('; ') : 'none') + '.');
  const tagCount = {}; dayDeps.forEach(e => (e.tags || []).forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
  const tagList = Object.keys(tagCount).map(t => t + (tagCount[t] > 1 ? ' x' + tagCount[t] : ''));
  if(tagList.length) L.push('Tags seen today: ' + tagList.join(', ') + '.');
  const alerts = helpAlerts(live, date, place);
  if(alerts.length) L.push('Watch-outs: ' + alerts.join(' ') + ' Worth discussing with a behaviourist or vet.');
  // Last 7 days, with the highest working step reached in each place that day
  const dates = Array.from(new Set(live.filter(e => e.kind === 'dep').map(e => e.date))).sort().slice(-7);
  if(dates.length){
    L.push('');
    L.push('Last days (date · day type · reps calm/alert/wobble/upset · working step at end of day, per place):');
    const perPlace = {};
    placesUsed.forEach(p => { const al = depsFor(live, p); perPlace[p] = { all: al, lv: levelsAfter(al, startFor(live, p)) }; });
    dates.forEach(d => {
      const dd = live.filter(e => e.kind === 'dep' && e.date === d);
      const cc = dd.filter(e => e.outcome === 'calm').length, aa = dd.filter(e => e.outcome === 'alert').length, ww = dd.filter(e => e.outcome === 'mild').length, uu = dd.filter(e => e.outcome === 'escalated').length;
      const steps = [];
      placesUsed.forEach(p => {
        const { all: al, lv: lvs } = perPlace[p];
        let idx = -1; al.forEach((e, i) => { if(e.date <= d) idx = i; });
        if(al.some(e => e.date === d)) steps.push((PLACE_LABEL[p] || p) + ': ' + (idx >= 0 ? stepLabel(lvs[idx]) : '-'));
      });
      L.push(fmtDay(d) + ' · ' + ((days[d] && DAY_NAME[days[d].day_type]) || 'type not set') + ' · ' + dd.length + ' reps ' + cc + '/' + aa + '/' + ww + '/' + uu + ' · ' + (steps.join('; ') || '-') + (anyCues ? ' · cues ' + cuesOf(d) : ''));
    });
  }
  // Step history: every step touched in each place, with the days she did it and when she moved on
  const hist = [];
  placesUsed.forEach(p => {
    const al = depsFor(live, p); if(!al.length) return;
    const lvs = levelsAfter(al, startFor(live, p));
    const info = {};
    al.forEach((e, i) => {
      const o = info[e.step] || (info[e.step] = { calm: 0, alert: 0, mild: 0, esc: 0, days: {}, cleared: null });
      if(e.outcome === 'calm') o.calm++; else if(e.outcome === 'alert') o.alert++; else if(e.outcome === 'mild') o.mild++; else o.esc++;
      o.days[e.date] = (o.days[e.date] || 0) + 1;
      const prev = i ? lvs[i - 1] : startFor(live, p);
      if(lvs[i] > prev && info[prev] === undefined) info[prev] = { calm: 0, alert: 0, mild: 0, esc: 0, days: {}, cleared: null };
      if(lvs[i] > prev) info[prev].cleared = e.date;
    });
    hist.push('- ' + (PLACE_LABEL[p] || p) + ':');
    Object.keys(info).map(Number).sort((x, y) => x - y).forEach(k => {
      const o = info[k];
      if(o.calm + o.alert + o.mild + o.esc === 0) return;
      const ds = Object.keys(o.days).sort().map(d => d.slice(8) + '/' + d.slice(5, 7) + (o.days[d] > 1 ? ' x' + o.days[d] : '')).join(', ');
      hist.push('   ' + stepLabel(k) + ': ' + o.calm + ' calm, ' + (o.alert ? o.alert + ' alert, ' : '') + o.mild + ' wobble, ' + o.esc + ' upset' + (ds ? ' · days ' + ds : '') + (o.cleared ? ' · moved on ' + o.cleared.slice(8) + '/' + o.cleared.slice(5, 7) : (k === lvs[lvs.length - 1] ? ' · working step now' : '')));
    });
  });
  if(hist.length){
    L.push('');
    L.push('Step history (reps per step, the days they happened, and when she moved up; excludes medicated and voided reps):');
    hist.forEach(h => L.push(h));
  }
  return L.join('\n');
}

if(typeof module !== 'undefined') module.exports = { MILESTONES, DUR, TOP, FIRST_OUT, LAST_CUE, QUICK_CEILING, isQuick, STEP_NAMES, CUE_IDS, idOf, indexOfId, stepLabel, stepTag, stepEst, gapSec, fits, need, capFor, sortedByDate, computeState, depsFor, stateFrom, baselineFor, startFor, skippedRanges, barInfo, levelsAfter, rand01, pickNext, ceilingFor, cooldownMs, waitUntil, coachMsg, normalizeEntry, buildSummary, fmtSec, sessionCount, isTiny, restSec, SESSION_MIN, SESSION_MAX, sessionSizeFor, breakMinFor, isSessionStart, warmupPlan, restlessSkip, RESTLESS_FROM, RULES_V2_FROM, CLIMB_FROM, CAP3_FROM, LADDER_VER, shorterStep, GATE, GATE_DAYS, GATE_DAY_REPS, dateAdd, helpAlerts, windowStats, weekCompare, progressSeries };
