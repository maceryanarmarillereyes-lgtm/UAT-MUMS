-- 2026-03-03: Ensure mums_profiles.quickbase_settings exists as JSONB for multi-tab sync payloads
-- Safe to run multiple times.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'mums_profiles'
      and column_name = 'quickbase_settings'
  ) then
    if exists (
      select 1
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'mums_profiles'
        and column_name = 'quickbase_settings'
        and data_type <> 'jsonb'
    ) then
      execute 'alter table public.mums_profiles alter column quickbase_settings type jsonb using to_jsonb(quickbase_settings)';
    end if;
  else
    execute 'alter table public.mums_profiles add column quickbase_settings jsonb';
  end if;
end $$;
