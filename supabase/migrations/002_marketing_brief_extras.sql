-- Phase C: extra brief fields used by the CREATE step. Safe to re-run.
alter table public.mkt_briefs add column if not exists pain_points jsonb not null default '[]'::jsonb;
alter table public.mkt_briefs add column if not exists angles      jsonb not null default '[]'::jsonb;
alter table public.mkt_briefs add column if not exists raw         jsonb;
