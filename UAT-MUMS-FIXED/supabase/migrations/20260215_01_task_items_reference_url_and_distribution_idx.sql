-- 2026-02-15: Task orchestration high-volume support
-- 1) Add optional reference_url to task_items for OneDrive/SharePoint links.
-- 2) Ensure distribution_id has an index for faster grouping/aggregation.

alter table if exists public.task_items
  add column if not exists reference_url text;

create index if not exists task_items_distribution_id_idx
  on public.task_items (distribution_id);
