-- 2026-02-16: Task Orchestration Core (Distributions + Items)
--
-- Why:
-- - /api/tasks/* endpoints expect these objects to exist.
-- - Missing tables/views will cause 500s like "distribution_create_failed".
--
-- Safe to run multiple times.

--------------------------------------------------------------------------------
-- UUID generator (Supabase usually has this, but keep it safe/idempotent)
--------------------------------------------------------------------------------

create extension if not exists pgcrypto;

--------------------------------------------------------------------------------
-- task_distributions
--------------------------------------------------------------------------------

create table if not exists public.task_distributions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null,
  title text not null,
  description text,
  reference_url text,
  status text not null default 'ONGOING'
);

create index if not exists task_distributions_created_by_idx
  on public.task_distributions (created_by);

--------------------------------------------------------------------------------
-- task_items
--------------------------------------------------------------------------------

create table if not exists public.task_items (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  distribution_id uuid not null references public.task_distributions(id) on delete cascade,

  -- Work metadata
  case_number text not null,
  site text not null,

  -- Assignee
  assigned_to uuid not null,

  -- Task details
  task_description text not null,
  description text,
  remarks text,
  reference_url text,
  status text not null default 'PENDING'
);

create index if not exists task_items_distribution_id_idx
  on public.task_items (distribution_id);

create index if not exists task_items_assigned_to_idx
  on public.task_items (assigned_to);

--------------------------------------------------------------------------------
-- view: team workload matrix (optional helper)
-- NOTE: We DROP first to avoid Postgres 42P16 (cannot drop columns from view)
--------------------------------------------------------------------------------

drop view if exists public.view_team_workload_matrix;

create view public.view_team_workload_matrix
with (security_invoker=true)
as
select
  assigned_to as user_id,
  count(*) filter (where status in ('PENDING','ONGOING')) as open_tasks,
  count(*) as total_tasks,
  max(updated_at) as last_updated_at
from public.task_items
group by assigned_to;
