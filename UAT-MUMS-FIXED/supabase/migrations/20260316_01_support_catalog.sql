-- Support Catalog: Product Knowledge Base
-- Table 1: Items
create table if not exists support_catalog (
  id               uuid primary key default gen_random_uuid(),
  item_code        text not null unique,
  name             text not null,
  category         text not null default 'Controller',
  brand            text,
  part_number      text,
  specs            text,
  user_guide       text,
  troubleshooting  text,
  compatible_units text,
  status           text not null default 'Active',
  assigned_to      uuid references mums_profiles(user_id) on delete set null,
  assigned_to_name text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- Table 2: Comments
create table if not exists support_catalog_comments (
  id                uuid primary key default gen_random_uuid(),
  item_id           uuid not null references support_catalog(id) on delete cascade,
  user_id           uuid not null,
  user_name         text not null,
  comment           text not null,
  is_acknowledged   boolean not null default false,
  acknowledged_by   uuid,
  acknowledged_name text,
  acknowledged_at   timestamptz,
  created_at        timestamptz not null default now()
);

-- Table 3: Edit history
create table if not exists support_catalog_history (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references support_catalog(id) on delete cascade,
  edited_by     uuid not null,
  edited_by_name text not null,
  field_changed text not null,
  old_value     text,
  new_value     text,
  edited_at     timestamptz not null default now()
);

-- Sample data
insert into support_catalog (item_code, name, category, brand, part_number, specs, status)
values
  ('CTR-001','Product Item 1','Controller','','','','Active'),
  ('CTR-002','Product Item 2','Controller','','','','Active'),
  ('SEN-001','Product Item 3','Sensor','','','','Active'),
  ('SEN-002','Product Item 4','Sensor','','','','Active'),
  ('VLV-001','Product Item 5','Valve','','','','Active')
on conflict (item_code) do nothing;

-- RLS: allow authenticated reads, service role writes
alter table support_catalog enable row level security;
alter table support_catalog_comments enable row level security;
alter table support_catalog_history enable row level security;

create policy "catalog_read" on support_catalog for select using (true);
create policy "catalog_write" on support_catalog for all using (true);
create policy "comments_read" on support_catalog_comments for select using (true);
create policy "comments_write" on support_catalog_comments for all using (true);
create policy "history_read" on support_catalog_history for select using (true);
create policy "history_write" on support_catalog_history for all using (true);
