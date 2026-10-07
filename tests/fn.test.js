const fs=require('fs'),assert=require('assert');
const src=fs.readFileSync(__dirname+'/../supabase/functions/pt-send-due/index.ts','utf8');
const body=src.split('// ==== HELPERS START (pure, unit-tested) ====')[1].split('// ==== HELPERS END ====')[0];
const js=require('node:module').stripTypeScriptTypes(body);
const L=new Function(js+';return {localParts,inQuiet,recurringDue,queueAction};')();
// Zurich is UTC+2 in Oct (CEST) and +1 in winter
assert.deepStrictEqual(L.localParts(new Date('2026-10-07T05:00:00Z'),'Europe/Zurich'),{date:'2026-10-07',minutes:420});
assert.deepStrictEqual(L.localParts(new Date('2026-12-07T05:00:00Z'),'Europe/Zurich'),{date:'2026-12-07',minutes:360});
assert.strictEqual(L.localParts(new Date('2026-10-06T22:30:00Z'),'Europe/Zurich').date,'2026-10-07'); // 00:30 local
assert.strictEqual(L.localParts(new Date('2026-10-06T22:30:00Z'),'Europe/Zurich').minutes,30);
assert(L.inQuiet(22*60+30)&&L.inQuiet(0)&&L.inQuiet(6*60+59)&&!L.inQuiet(7*60)&&!L.inQuiet(22*60+29));
const r=(o)=>L.recurringDue(Object.assign({minutes:0,date:'d',dayType:null,medicated:false,liveReps:0},o));
assert.strictEqual(r({minutes:420}).length,1); assert.strictEqual(r({minutes:420})[0].open,'day');
assert.strictEqual(r({minutes:420,dayType:'home'}).length,0);
assert.strictEqual(r({minutes:419}).length,0);
assert.strictEqual(r({minutes:9*60+30,dayType:'home'})[0].key,'remind:d');
assert.strictEqual(r({minutes:9*60+30,dayType:'home',liveReps:2}).length,0);
assert.strictEqual(r({minutes:17*60+30,dayType:'sitter'}).length,1);
assert.strictEqual(r({minutes:22*60,dayType:'home',liveReps:3})[0].open,'eod');
assert.strictEqual(r({minutes:22*60,dayType:'home',liveReps:0}).length,0);
const q=(o)=>L.queueAction(Object.assign({now:1e12,fireAt:1e12-1000,urgent:false,minutes:600},o));
assert.strictEqual(q({fireAt:1e12+5}),'wait');
assert.strictEqual(q({}),'send');
assert.strictEqual(q({fireAt:1e12-16*60000}),'skip');
assert.strictEqual(q({minutes:23*60}),'skip');
assert.strictEqual(q({minutes:23*60,urgent:true}),'send');
// new recurring pings
assert.strictEqual(r({minutes:420,yesterdayUpset:true})[0].open,'day');
assert(r({minutes:420,yesterdayUpset:true}).length===1);
const rs=r({minutes:9*60+30,dayType:'home',daysSinceRep:2}); assert.strictEqual(rs.length,1); assert.strictEqual(rs[0].key,'remind:d');
assert.strictEqual(r({minutes:10*60,daysSinceRep:4}).length,1);               // no day type, restart at 10:00
assert.strictEqual(r({minutes:10*60,daysSinceRep:3}).length,0);
assert.strictEqual(r({minutes:10*60,daysSinceRep:2,liveReps:1}).length,0);
const wk=r({minutes:19*60,weekday:0,repsThisWeek:3,dayType:'home',liveReps:1}); assert(wk.some(x=>x.key==='weekly:d'&&x.open==='more'));
assert(!r({minutes:19*60,weekday:1,repsThisWeek:3,dayType:'home'}).some(x=>x.key==='weekly:d'));
assert(!r({minutes:19*60,weekday:0,repsThisWeek:0,dayType:'home'}).some(x=>x.key==='weekly:d'));
console.log('fn tests ok');
