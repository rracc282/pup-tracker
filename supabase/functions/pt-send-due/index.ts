// Churro tracker: sends due push notifications. Called every minute by pg_cron.
// Secrets needed: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, CRON_SECRET
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.)
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

// ==== HELPERS START (pure, unit-tested) ====
const QUIET_START = 22 * 60 + 30; // 22:30
const QUIET_END = 7 * 60;         // 07:00

function localParts(now: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hour12: false, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(now)) p[x.type] = x.value;
  const hour = Number(p.hour) % 24;
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: hour * 60 + Number(p.minute) };
}
function inQuiet(minutes: number) { return minutes >= QUIET_START || minutes < QUIET_END; }

const REMINDER_AT: Record<string, number> = { home: 9 * 60 + 30, weekend: 10 * 60 + 30, sitter: 17 * 60 + 30 };

type Msg = [string, string];
const MORNING: Msg[] = [
  ["Good morning! ☀️", "What kind of day is it for Churro, and where will you be? Tap to pick."],
  ["Rise and shine, team Churro 🐶", "Tell me about today: day type and where you'll be."],
  ["New day, fresh ladder 🪜", "Quick tap to set today's type and place."],
  ["Morning, coach! ☕", "Home, weekend or sitter day? And where? Two taps."],
  ["Sausage report, please 🌭", "What's today's plan for Churro?"],
  ["Day starts here 🌅", "Pick today's day type and location so I can set the right pace."],
  ["Churro is up (probably 😴)", "Tell me what today looks like and I'll tune the training."],
  ["Hello, sunshine ☀️", "Before the day gets busy: day type and place?"],
];
const MORNING_AFTER_UPSET: Msg[] = [
  ["Fresh start today 🌅", "Yesterday was tough. Start easy, and tell me the day type and place."],
  ["New day 🧡", "Take it gently today. What kind of day is it, and where will you be?"],
  ["Easy does it ☀️", "A calmer day today. Pick day type and place."],
];
const RESTART: Msg[] = [
  ["Ready when you are 🐾", "No reps for a couple of days. One easy rep is a fine restart."],
  ["Back to it, gently 🌱", "A short, easy rep is all it takes."],
  ["Small restart? 🐶", "She won't lose ground from a short break, so start easy."],
];
const WEEKLY: Msg[] = [
  ["Week done 📈", "See how this week compares with last in More."],
  ["Weekly check-in 🗓️", "Your progress comparison is ready."],
  ["Sunday summary ✨", "This week vs last week is waiting in More."],
];
const REMIND: Record<string, Msg[]> = {
  home: [
    ["Ready to train? 🐾", "No reps yet today. Even one quick one counts."],
    ["Tiny step, big win 🏆", "Home day, so a good moment for a short rep."],
    ["Churro's waiting 🐶", "No reps yet. One calm departure is all it takes."],
    ["Quiet moment? 🚪", "Perfect time for a quick rep at home."],
  ],
  weekend: [
    ["Weekend rep? 🌤️", "Slow day, so one or two short reps fit nicely."],
    ["Easy does it 🛋️", "No reps yet. A quick one between coffee and cuddles?"],
    ["Little and light 🐾", "Weekend pace: one gentle rep keeps the streak going."],
  ],
  sitter: [
    ["Sitter day, one rep please 🧡", "Even on a sitter day, try to fit in at least one short, easy rep."],
    ["Just one today 🌿", "Keep it tiny, but let's get at least one rep in with the sitter around."],
    ["Gentle nudge 🐾", "At least one short rep today keeps the ladder moving. You've got this!"],
    ["One small rep, big payoff 🏅", "Sitter days still count. Aim for one easy rep."],
  ],
};
const EOD: Msg[] = [
  ["Day done! 🌙", "Tap for today's summary to share with Claude."],
  ["Great work today 🐾", "Your summary is ready to share with Claude."],
  ["Lights out soon 💤", "Tap to grab today's summary."],
  ["Churro is snoozing 😴", "Time to wrap up. Tap for the summary."],
  ["That's a wrap! 🎬", "Today's reps are ready to share with Claude."],
  ["Proud of you both 🧡", "Tap for today's summary before bed."],
  ["End of day check-in 🌙", "Summary's ready whenever you are."],
];
function pick<T>(a: T[]): T { return a[Math.floor(Math.random() * a.length)]; }

// Which recurring pings are due for one user right now?
function recurringDue(o: {
  minutes: number; date: string; dayType: string | null; medicated: boolean; liveReps: number;
  yesterdayUpset?: boolean; daysSinceRep?: number | null; repsThisWeek?: number; weekday?: number;
}): { key: string; title: string; body: string; open: string; tag: string }[] {
  const out: { key: string; title: string; body: string; open: string; tag: string }[] = [];
  const m = o.minutes;
  if (!o.dayType && m >= 7 * 60 && m < 7 * 60 + 30) {
    const mm = pick(o.yesterdayUpset ? MORNING_AFTER_UPSET : MORNING);
    out.push({ key: `morning:${o.date}`, title: mm[0], body: mm[1], open: "day", tag: "morning" });
  }
  const at = o.dayType ? REMINDER_AT[o.dayType] : undefined;
  if (at !== undefined && o.liveReps === 0 && m >= at && m < at + 30) {
    const restart = o.daysSinceRep === 2 || o.daysSinceRep === 4;
    const rm = pick(restart ? RESTART : (REMIND[o.dayType as string] || REMIND.home));
    out.push({ key: `remind:${o.date}`, title: rm[0], body: rm[1], open: "", tag: "remind" });
  }
  // no day type chosen and she has had a quiet spell: still send the restart nudge once, at 10:00
  if (!o.dayType && o.liveReps === 0 && (o.daysSinceRep === 2 || o.daysSinceRep === 4) && m >= 10 * 60 && m < 10 * 60 + 30) {
    const rs = pick(RESTART);
    out.push({ key: `remind:${o.date}`, title: rs[0], body: rs[1], open: "", tag: "remind" });
  }
  if (o.weekday === 0 && (o.repsThisWeek || 0) >= 1 && m >= 19 * 60 && m < 19 * 60 + 30) {
    const wk = pick(WEEKLY);
    out.push({ key: `weekly:${o.date}`, title: wk[0], body: wk[1], open: "more", tag: "weekly" });
  }
  if (o.liveReps >= 1 && m >= 22 * 60 && m < 22 * 60 + 30) {
    const em = pick(EOD);
    out.push({ key: `eod:${o.date}`, title: em[0], body: em[1], open: "eod", tag: "eod" });
  }
  return out;
}
// A queued item: send / skip (quiet hours or stale) / wait
function queueAction(o: { fireAt: number; now: number; urgent: boolean; minutes: number }): "send" | "skip" | "wait" {
  if (o.fireAt > o.now) return "wait";
  if (o.now - o.fireAt > 15 * 60 * 1000) return "skip";
  if (!o.urgent && inQuiet(o.minutes)) return "skip";
  return "send";
}
// ==== HELPERS END ====

// deno-lint-ignore no-explicit-any
declare const Deno: any;

if (typeof Deno !== "undefined" && Deno.serve) {
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT") || "mailto:rarealv@gmail.com",
    Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!,
  );

  // deno-lint-ignore no-explicit-any
  async function pushTo(userId: string, subs: any[], payload: Record<string, unknown>) {
    let n = 0;
    for (const s of subs.filter((x) => x.user_id === userId)) {
      try {
        await webpush.sendNotification(s.sub, JSON.stringify(payload), { TTL: 600, urgency: payload.urgent ? "high" : "normal" });
        n++;
      } catch (e) {
        // deno-lint-ignore no-explicit-any
        const code = (e as any)?.statusCode;
        if (code === 404 || code === 410) await sb.from("pt_push_subs").delete().eq("id", s.id);
        else console.error("push error", code, String(e));
      }
    }
    return n;
  }

  Deno.serve(async (req: Request) => {
    if (req.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) return new Response("no", { status: 401 });
    const now = new Date();
    const { data: subs } = await sb.from("pt_push_subs").select("id,user_id,sub");
    const { data: sets } = await sb.from("pt_settings").select("user_id,tz");
    const tzOf = (u: string) => sets?.find((s) => s.user_id === u)?.tz || "Europe/Zurich";
    let sent = 0, skipped = 0;

    // 1. Queue
    const { data: due } = await sb.from("pt_queue").select("*").is("sent_at", null).eq("cancelled", false).lte("fire_at", now.toISOString());
    for (const q of due || []) {
      const lp = localParts(now, tzOf(q.user_id));
      const act = queueAction({ fireAt: Date.parse(q.fire_at), now: now.getTime(), urgent: q.urgent, minutes: lp.minutes });
      if (act === "wait") continue;
      // claim first so overlapping runs don't double-send
      const { data: claimed } = await sb.from("pt_queue").update({ sent_at: now.toISOString() }).eq("id", q.id).is("sent_at", null).select("id");
      if (!claimed?.length) continue;
      if (act === "skip") { skipped++; continue; }
      sent += await pushTo(q.user_id, subs || [], { title: q.title, body: q.body, tag: q.tag, open: q.open, urgent: q.urgent });
    }

    // 2. Recurring
    const users = [...new Set((subs || []).map((s) => s.user_id))];
    for (const u of users) {
      const lp = localParts(now, tzOf(u));
      if (inQuiet(lp.minutes)) continue;
      const { data: ds } = await sb.from("pt_daystate").select("day_type,medicated").eq("user_id", u).eq("date", lp.date).maybeSingle();
      const { data: reps } = await sb.from("pt_reps").select("id,data").eq("user_id", u).eq("date", lp.date).eq("kind", "dep");
      const live = (reps || []).filter((r) => !r.data?.voided).length;
      // recent history: last 14 days of ladder reps (not voided)
      const since = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
      const { data: recent } = await sb.from("pt_reps").select("date,data").eq("user_id", u).eq("kind", "dep").gte("date", since);
      const liveRecent = (recent || []).filter((r) => !r.data?.voided);
      const dates = liveRecent.map((r) => r.date as string).sort();
      const lastDate = dates.length ? dates[dates.length - 1] : null;
      const dayDiff = (a: string, b: string) => Math.round((Date.parse(a + "T12:00:00Z") - Date.parse(b + "T12:00:00Z")) / 86400000);
      const yday = new Date(Date.parse(lp.date + "T12:00:00Z") - 86400000).toISOString().slice(0, 10);
      const items = recurringDue({
        minutes: lp.minutes, date: lp.date, dayType: ds?.day_type || null, medicated: !!ds?.medicated, liveReps: live,
        yesterdayUpset: liveRecent.some((r) => r.date === yday && r.data?.outcome === "escalated" && !r.data?.medicated),
        daysSinceRep: lastDate ? dayDiff(lp.date, lastDate) : null,
        repsThisWeek: liveRecent.filter((r) => dayDiff(lp.date, r.date as string) <= 6).length,
        weekday: new Date(lp.date + "T12:00:00Z").getUTCDay(),
      });
      for (const it of items) {
        const { error } = await sb.from("pt_sent").insert({ user_id: u, key: it.key });
        if (error) continue; // already sent (primary key conflict)
        sent += await pushTo(u, subs || [], { title: it.title, body: it.body, tag: it.tag, open: it.open });
      }
    }
    return new Response(JSON.stringify({ ok: true, sent, skipped }), { headers: { "Content-Type": "application/json" } });
  });
}
