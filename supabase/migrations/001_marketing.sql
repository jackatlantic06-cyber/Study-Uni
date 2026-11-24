-- Study-Uni marketing system — tables for briefs, the post queue, stats,
-- comments, weekly learnings and an audit log.
--
-- Access model: Row Level Security is ON for every table and there are NO
-- policies for the anon or authenticated roles, so the public site key can
-- read or write nothing. Only the service role (GitHub Actions jobs and the
-- owner-checked /api/admin-stats endpoint) can touch these tables.
--
-- Run once in Supabase → SQL Editor. Safe to re-run.

create extension if not exists pgcrypto;

-- ── Weekly research brief ────────────────────────────────────────────────
create table if not exists public.mkt_briefs (
  id          uuid primary key default gen_random_uuid(),
  week        text not null unique,              -- e.g. 2026-w48
  summary     text,                              -- short human-readable brief
  questions   jsonb not null default '[]'::jsonb, -- top questions / pain points
  exam_dates  jsonb not null default '[]'::jsonb, -- upcoming dates
  engagement  jsonb not null default '[]'::jsonb, -- what got engagement
  sources     jsonb not null default '[]'::jsonb, -- links used
  created_at  timestamptz not null default now()
);

-- ── Posts (the approval queue) ───────────────────────────────────────────
-- status flow:
--   draft → pending_review → approved → publishing → published
--                          ↘ rejected            ↘ failed
-- Nothing is ever sent to Postiz unless status = 'approved' and an owner
-- set approved_by. 'draft' = still being rendered; not shown as actionable.
create table if not exists public.mkt_posts (
  id              uuid primary key default gen_random_uuid(),
  post_key        text not null unique,          -- used as utm_content, e.g. w48-tt-01
  week            text not null,                 -- utm_campaign, e.g. 2026-w48
  platform        text not null check (platform in ('tiktok','instagram')),
  format          text not null check (format in ('video','carousel')),
  status          text not null default 'draft'
                  check (status in ('draft','pending_review','approved','publishing','published','rejected','failed')),
  title           text,                          -- internal label
  hook            text,
  script          jsonb,                         -- scenes / slides / voiceover text
  caption         text,
  link            text,                          -- full tracked link
  media           jsonb not null default '[]'::jsonb, -- [{kind:'video'|'image', url, postiz_path}]
  ai_label        boolean not null default true, -- AI-generated content disclosure
  compliance      jsonb,                         -- {passed, issues[], checked_at}
  scheduled_for   timestamptz,                   -- when to go out (null = as soon as approved)
  approved_by     text,
  approved_at     timestamptz,
  rejected_reason text,
  postiz_post_id  text,
  release_url     text,
  published_at    timestamptz,
  error           text,
  is_demo         boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists mkt_posts_status_idx on public.mkt_posts (status, scheduled_for);
create index if not exists mkt_posts_week_idx   on public.mkt_posts (week);

-- ── Stats snapshots per post ─────────────────────────────────────────────
create table if not exists public.mkt_post_stats (
  id           bigint generated always as identity primary key,
  post_id      uuid not null references public.mkt_posts(id) on delete cascade,
  captured_at  timestamptz not null default now(),
  views        integer,
  likes        integer,
  comments     integer,
  shares       integer,
  saves        integer,
  signups      integer                         -- sign-ups with utm_content = post_key
);
create index if not exists mkt_post_stats_post_idx on public.mkt_post_stats (post_id, captured_at desc);

-- ── Comments on our posts and replies ────────────────────────────────────
create table if not exists public.mkt_comments (
  id              uuid primary key default gen_random_uuid(),
  platform        text not null check (platform in ('tiktok','instagram')),
  external_id     text not null,                 -- platform comment id
  post_id         uuid references public.mkt_posts(id) on delete set null,
  author          text,
  body            text not null,
  commented_at    timestamptz,
  category        text check (category in ('safe_question','needs_jack','spam','other')),
  reply_draft     text,
  status          text not null default 'new'
                  check (status in ('new','auto_replied','draft','needs_jack','done','ignored')),
  replied_at      timestamptz,
  emailed_at      timestamptz,
  created_at      timestamptz not null default now(),
  unique (platform, external_id)
);
create index if not exists mkt_comments_status_idx on public.mkt_comments (status, created_at desc);

-- ── Sunday "what worked" summaries ───────────────────────────────────────
create table if not exists public.mkt_learnings (
  id          uuid primary key default gen_random_uuid(),
  week        text not null unique,
  summary     text not null,                     -- read by Monday's CREATE step
  ranking     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now()
);

-- ── Audit log: every approve / schedule / reject / publish / reply ───────
create table if not exists public.mkt_audit (
  id       bigint generated always as identity primary key,
  at       timestamptz not null default now(),
  actor    text not null,                        -- owner email or job name
  action   text not null,
  post_id  uuid,
  detail   jsonb
);
create index if not exists mkt_audit_at_idx on public.mkt_audit (at desc);

-- ── updated_at trigger ───────────────────────────────────────────────────
create or replace function public.mkt_touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
drop trigger if exists mkt_posts_touch on public.mkt_posts;
create trigger mkt_posts_touch before update on public.mkt_posts
  for each row execute function public.mkt_touch_updated_at();

-- ── Lock everything down ─────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['mkt_briefs','mkt_posts','mkt_post_stats','mkt_comments','mkt_learnings','mkt_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;
revoke all on function public.mkt_touch_updated_at() from anon, authenticated;
