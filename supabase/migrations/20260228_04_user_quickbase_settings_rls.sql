-- 2026-02-28: Security Advisor fix for public.user_quickbase_settings
-- Enables RLS and adds owner-scoped policies when table exists.
-- Safe to run multiple times.

do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'user_quickbase_settings'
  ) then
    execute 'alter table public.user_quickbase_settings enable row level security';

    execute 'drop policy if exists "user_quickbase_settings_select_own" on public.user_quickbase_settings';
    execute 'create policy "user_quickbase_settings_select_own" on public.user_quickbase_settings for select using (auth.uid() = user_id)';

    execute 'drop policy if exists "user_quickbase_settings_insert_own" on public.user_quickbase_settings';
    execute 'create policy "user_quickbase_settings_insert_own" on public.user_quickbase_settings for insert with check (auth.uid() = user_id)';

    execute 'drop policy if exists "user_quickbase_settings_update_own" on public.user_quickbase_settings';
    execute 'create policy "user_quickbase_settings_update_own" on public.user_quickbase_settings for update using (auth.uid() = user_id) with check (auth.uid() = user_id)';

    execute 'drop policy if exists "user_quickbase_settings_delete_own" on public.user_quickbase_settings';
    execute 'create policy "user_quickbase_settings_delete_own" on public.user_quickbase_settings for delete using (auth.uid() = user_id)';
  end if;
end $$;
