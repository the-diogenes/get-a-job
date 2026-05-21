-- Run in Supabase SQL Editor (re-run safe: uses IF NOT EXISTS / drop policy)

-- ========== Job tracker (existing) ==========
create table if not exists public.job_tracker (
  user_id text not null,
  job_id text not null,
  applied boolean not null default false,
  called boolean not null default false,
  interview boolean not null default false,
  bookmarked boolean not null default false,
  hidden boolean not null default false,
  notes text not null default '',
  applied_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, job_id)
);

create index if not exists job_tracker_user_id_idx on public.job_tracker (user_id);

-- ========== Message board ==========
create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  author text not null,
  body text not null,
  parent_id uuid references public.board_posts (id) on delete cascade,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists board_posts_created_idx on public.board_posts (created_at desc);

-- ========== Talk to Jack live chat ==========
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  started_by text not null,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  author text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_idx on public.chat_messages (session_id, created_at);

create table if not exists public.chat_reads (
  user_id text not null,
  session_id uuid not null references public.chat_sessions (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

-- ========== RLS (friends-only board; anon key in static site) ==========
alter table public.job_tracker enable row level security;
alter table public.board_posts enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;

drop policy if exists "job_tracker_select" on public.job_tracker;
drop policy if exists "job_tracker_insert" on public.job_tracker;
drop policy if exists "job_tracker_update" on public.job_tracker;
create policy "job_tracker_select" on public.job_tracker for select using (true);
create policy "job_tracker_insert" on public.job_tracker for insert with check (true);
create policy "job_tracker_update" on public.job_tracker for update using (true);

drop policy if exists "board_posts_all" on public.board_posts;
create policy "board_posts_all" on public.board_posts for all using (true) with check (true);

drop policy if exists "chat_sessions_all" on public.chat_sessions;
create policy "chat_sessions_all" on public.chat_sessions for all using (true) with check (true);

drop policy if exists "chat_messages_all" on public.chat_messages;
create policy "chat_messages_all" on public.chat_messages for all using (true) with check (true);

drop policy if exists "chat_reads_all" on public.chat_reads;
create policy "chat_reads_all" on public.chat_reads for all using (true) with check (true);

-- Realtime (for live chat + board updates)
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.board_posts;
exception when duplicate_object then null;
end $$;
