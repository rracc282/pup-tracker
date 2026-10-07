# Churro alone-time training (PWA)

Static site on GitHub Pages + Supabase (auth, database, realtime, push queue).

- `index.html`, `app.js`, `logic.js` (pure training logic), `sw.js`, `manifest.webmanifest`, `icons/`
- `config.js`: public Supabase URL, publishable key, VAPID public key
- `supabase/schema.sql`: tables and row-level security
- `supabase/functions/pt-send-due/index.ts`: sends push notifications (run every minute by `supabase/cron.sql`)
- `tests/`: `node tests/logic.test.js`, `node tests/fn.test.js`

No secrets live in this repo. The VAPID private key and CRON_SECRET are Supabase function secrets.
