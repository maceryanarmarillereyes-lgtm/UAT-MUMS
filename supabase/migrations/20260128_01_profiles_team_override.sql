-- MUMS: SUPER_ADMIN team override
-- Allows SUPER_ADMIN to optionally assign themselves to a shift team while defaulting to Developer Access.

alter table if exists public.mums_profiles
  add column if not exists team_override boolean not null default false;

-- Backfill: SUPER roles infer override from whether a team_id is set.
update public.mums_profiles
set team_override = (team_id is not null)
where upper(coalesce(role,'')) in ('SUPER_ADMIN','SUPER_USER');

-- Enforce default Developer Access for SUPER roles without override.
update public.mums_profiles
set team_id = null
where upper(coalesce(role,'')) in ('SUPER_ADMIN','SUPER_USER')
  and team_override = false;
