-- Run AFTER deploying the pt-send-due function and setting CRON_SECRET.
-- Replace YOUR_CRON_SECRET (same value as the function secret).
create extension if not exists pg_cron;
create extension if not exists pg_net;
select cron.unschedule('pt-send-due') where exists (select 1 from cron.job where jobname='pt-send-due');
select cron.schedule('pt-send-due', '* * * * *', $$
  select net.http_post(
    url := 'https://qcjtzjtkmothocfiwgxf.supabase.co/functions/v1/pt-send-due',
    headers := '{"Content-Type":"application/json","x-cron-secret":"YOUR_CRON_SECRET"}'::jsonb,
    body := '{}'::jsonb
  );
$$);
