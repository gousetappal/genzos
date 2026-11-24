-- GENZ FILMS OS - Migration 003: published video records (feeds deliverable counts)
-- This table is the seed of the full production pipeline; Phase 2 adds status stages, script/editor/shoot columns.
create table videos (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  title text not null,
  status text not null default 'published' check (status in ('planned','published','cancelled')),
  published_url text,
  published_on date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  -- a published video must always have a link and a date, so counts can't be inflated by blanks
  constraint published_needs_link check (status <> 'published' or (published_url is not null and published_on is not null))
);
create index on videos(client_id, published_on);
alter table videos enable row level security;
create policy videos_staff on videos for all
  using (is_staff() and can_access_client(client_id)) with check (is_staff() and can_access_client(client_id));
create trigger audit_videos after insert or update or delete on videos for each row execute function log_activity();
