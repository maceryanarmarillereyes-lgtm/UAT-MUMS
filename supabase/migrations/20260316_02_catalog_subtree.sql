-- Support Catalog: Add sub-item / tree hierarchy support
-- Adds parent_id FK so items can have children (sub-items / series variants)

alter table support_catalog
  add column if not exists parent_id uuid
  references support_catalog(id)
  on delete cascade;

-- Index for fast child lookups
create index if not exists idx_catalog_parent_id on support_catalog(parent_id);

-- Update existing items to ensure parent_id is null (clean state)
update support_catalog set parent_id = null where parent_id is null;
