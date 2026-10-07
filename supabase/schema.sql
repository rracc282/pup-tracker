-- Churro tracker schema. Run once in Supabase SQL editor.
create table if not exists pt_reps (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date text not null,
  kind text not null default 'dep',
  created_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create table if not exists pt_daystate (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date text not null,
  day_type text,
  medicated boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, date)
);
create table if not exists pt_settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  tz text not null default 'Europe/Zurich',
  data jsonb not null default '{}'::jsonb
);
create table if not exists pt_push_subs (
  id bigserial primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique,
  sub jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists pt_queue (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  fire_at timestamptz not null,
  kind text not null,
  title text not null,
  body text not null default '',
  tag text,
  urgent boolean not null default false,
  open text,
  cancelled boolean not null default false,
  sent_at timestamptz
);
create index if not exists pt_queue_due on pt_queue (fire_at) where sent_at is null and cancelled = false;
create table if not exists pt_sent (
  user_id uuid not null,
  key text not null,
  sent_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table pt_reps enable row level security;
alter table pt_daystate enable row level security;
alter table pt_settings enable row level security;
alter table pt_push_subs enable row level security;
alter table pt_queue enable row level security;
alter table pt_sent enable row level security;

do $$ declare t text; begin
  foreach t in array array['pt_reps','pt_daystate','pt_settings','pt_push_subs','pt_queue'] loop
    execute format('drop policy if exists own_all on %I', t);
    execute format('create policy own_all on %I for all using (user_id = auth.uid()) with check (user_id = auth.uid())', t);
  end loop;
end $$;
-- pt_sent: no policies = only the service role (edge function) can touch it.

alter publication supabase_realtime add table pt_reps;
alter publication supabase_realtime add table pt_daystate;
