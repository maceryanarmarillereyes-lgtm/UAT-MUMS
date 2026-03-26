-- -----------------------------------------------------------------------------
-- 2026-02-17: Phase 1 Foundation — Task Distribution & Monitoring
--
-- Why:
-- - Support richer per-task tracking (status enum, problem notes, audit fields)
-- - Support distribution-level opt-in for daily reminders
--
-- Safe to run multiple times.
-- -----------------------------------------------------------------------------

-- Distribution-level toggle
alter table if exists public.task_distributions
  add column if not exists enable_daily_alerts boolean not null default false;

-- Canonical task status enum
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_item_status') then
    create type public.task_item_status as enum ('Pending', 'Ongoing', 'Completed', 'With Problem');
  end if;
end $$;

-- New audit/problem fields
alter table if exists public.task_items
  add column if not exists problem_notes text,
  add column if not exists assigned_by uuid,
  add column if not exists transferred_from uuid;

-- Ensure task_items.status uses the enum (migrates legacy values safely)
do $$
declare
  current_udt text;
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_items'
      and column_name = 'status'
  ) then
    select udt_name into current_udt
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'task_items'
      and column_name = 'status'
    limit 1;

    if current_udt is distinct from 'task_item_status' then
      -- Remove default before type cast
      begin
        alter table public.task_items alter column status drop default;
      exception when others then
        -- ignore
      end;

      alter table public.task_items
        alter column status type public.task_item_status
        using (
          case upper(status::text)
            when 'PENDING' then 'Pending'::public.task_item_status
            when 'IN_PROGRESS' then 'Ongoing'::public.task_item_status
            when 'ONGOING' then 'Ongoing'::public.task_item_status
            when 'DONE' then 'Completed'::public.task_item_status
            when 'COMPLETED' then 'Completed'::public.task_item_status
            when 'WITH_PROBLEM' then 'With Problem'::public.task_item_status
            when 'WITH PROBLEM' then 'With Problem'::public.task_item_status
            else 'Pending'::public.task_item_status
          end
        );
    end if;
  else
    alter table public.task_items
      add column status public.task_item_status not null default 'Pending';
  end if;
end $$;

-- Backfill + enforce defaults
update public.task_items set status = 'Pending' where status is null;

alter table public.task_items
  alter column status set default 'Pending',
  alter column status set not null;

-- Workload matrix view (matches /api/tasks/workload_matrix expectations)
drop view if exists public.view_team_workload_matrix;

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'mums_profiles'
  )
  or exists (
    select 1
    from information_schema.views
    where table_schema = 'public'
      and table_name = 'mums_profiles'
  ) then
    execute $$
      create view public.view_team_workload_matrix
      with (security_invoker = true)
      as
      select
        ti.id as task_item_id,
        ti.status as task_status,
        td.title as distribution_title,
        coalesce(mp.name, mp.username, mp.user_id::text) as member_name,
        mp.duty as member_shift,
        coalesce(ti.updated_at, ti.created_at) as last_update
      from public.task_items ti
      join public.task_distributions td on td.id = ti.distribution_id
      left join public.mums_profiles mp on mp.user_id = ti.assigned_to;
    $$;
  else
    execute $$
      create view public.view_team_workload_matrix
      with (security_invoker = true)
      as
      select
        ti.id as task_item_id,
        ti.status as task_status,
        td.title as distribution_title,
        ti.assigned_to::text as member_name,
        null::text as member_shift,
        coalesce(ti.updated_at, ti.created_at) as last_update
      from public.task_items ti
      join public.task_distributions td on td.id = ti.distribution_id;
    $$;
  end if;
end $$;
