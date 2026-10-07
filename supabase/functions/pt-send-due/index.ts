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

// Which recurring pings are due for one user right now?
function recurringDue(o: {
  minutes: number; date: string; dayType: string | null; medicated: boolean; liveReps: number;
}): { key: string; title: string; body: string; open: string; tag: string }[] {
  const out: { key: string; title: string; body: string; open: string; tag: string }[] = [];
  const m = o.minutes;
  if (!o.dayType && m >= 7 * 60 && m < 7 * 60 + 30) {
    out.push({ key: `morning:${o.date}`, title: "Good morning! ☀️", body: "What kind of day is it for Churro, and where will you be? Tap to pick.", open: "day", tag: "morning" });
  }
  const at = o.dayType ? REMINDER_AT[o.dayType] : undefined;
  if (at !== undefined && o.liveReps === 0 && m >= at && m < at + 30) {
    out.push({ key: `remind:${o.date}`, title: "Ready to train? 🐾", body: "No reps yet today. Even one quick one counts.", open: "", tag: "remind" });
  }
  if (o.liveReps >= 1 && m >= 22 * 60 && m < 22 * 60 + 30) {
    out.push({ key: `eod:${o.date}`, title: "Day done! 🌙", body: "Tap for today's summary to share with Claude.", open: "eod", tag: "eod" });
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
      const items = recurringDue({ minutes: lp.minutes, date: lp.date, dayType: ds?.day_type || null, medicated: !!ds?.medicated, liveReps: live });
      for (const it of items) {
        const { error } = await sb.from("pt_sent").insert({ user_id: u, key: it.key });
        if (error) continue; // already sent (primary key conflict)
        sent += await pushTo(u, subs || [], { title: it.title, body: it.body, tag: it.tag, open: it.open });
      }
    }
    return new Response(JSON.stringify({ ok: true, sent, skipped }), { headers: { "Content-Type": "application/json" } });
  });
}
