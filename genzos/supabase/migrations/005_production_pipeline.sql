-- GENZ FILMS OS - Migration 005: production pipeline
-- projects, content ideas, scripts (+versions), video pipeline stages, approvals, revisions, comments,
-- shoots (with double-booking protection), editing, publishing calendar, notification helpers.
create extension if not exists btree_gist;

-- HELPERS ---------------------------------------------------------------------
create or replace function is_manager() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(current_role_name() in ('admin','project_manager'), false) $$;

-- notifications: dedupe key lets scheduled reminders run repeatedly without spamming
alter table notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe on notifications(user_id, dedupe_key) where dedupe_key is not null;

create or replace function notify(uid uuid, t text, b text, l text, dk text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if uid is null then return; end if;
  insert into notifications(user_id, title, body, link, dedupe_key) values (uid, t, b, l, dk) on conflict do nothing;
end $$;

create or replace function notify_admins(t text, b text, l text, dk text default null) returns void
language plpgsql security definer set search_path = public as $$
declare r record;
begin
  for r in select id from profiles where role = 'admin' and is_active loop
    perform notify(r.id, t, b, l, case when dk is null then null else dk || ':' || r.id end);
  end loop;
end $$;

-- notify the client's project manager and all admins
create or replace function notify_managers(cid uuid, t text, b text, l text, dk text default null) returns void
language plpgsql security definer set search_path = public as $$
declare pm uuid;
begin
  select project_manager_id into pm from clients where id = cid;
  perform notify(pm, t, b, l, dk);
  perform notify_admins(t, b, l, dk);
end $$;

-- PROJECTS -------------------------------------------------------------------
create table projects (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  name text not null,
  description text,
  status text not null default 'active' check (status in ('planned','active','on_hold','completed')),
  start_date date,
  end_date date,
  manager_id uuid references profiles(id),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index on projects(client_id);

-- VIDEOS: extend the 003 table into the full 15-stage pipeline ---------------------
create sequence video_code_seq;
alter table videos
  add column code text unique default ('GF-' || lpad(nextval('video_code_seq')::text, 5, '0')),
  add column stage text not null default 'idea_created' check (stage in (
    'idea_created','research_completed','script_writing','script_review','script_approved','shoot_scheduled',
    'shoot_completed','footage_uploaded','editing','internal_review','client_review','revision_required',
    'approved','scheduled_for_posting','published')),
  add column project_id uuid references projects(id) on delete set null,
  add column content_category text,
  add column scriptwriter_id uuid references profiles(id),
  add column videographer_id uuid references profiles(id),
  add column editor_id uuid references profiles(id),
  add column shoot_date date,
  add column shoot_location text,
  add column editing_deadline date,
  add column internal_review_deadline date,
  add column client_approved_at timestamptz,
  add column posting_date timestamptz,
  add column final_video_url text,
  add column updated_at timestamptz not null default now();
alter table videos alter column status set default 'planned';
update videos set stage = 'published' where status = 'published';
create index on videos(client_id, stage);
create index on videos(editor_id);

create or replace function stage_rank(s text) returns int language sql immutable as $$
  select array_position(array['idea_created','research_completed','script_writing','script_review','script_approved','shoot_scheduled',
    'shoot_completed','footage_uploaded','editing','internal_review','client_review','revision_required','approved',
    'scheduled_for_posting','published'], s) $$;

-- keeps the deliverable-count column (status) and the pipeline column (stage) consistent
create or replace function videos_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'published' then new.stage := 'published'; end if;
  else
    if new.stage is distinct from old.stage then
      new.status := case when new.stage = 'published' then 'published' else 'planned' end;
    elsif new.status is distinct from old.status and new.status = 'published' then
      new.stage := 'published';
    end if;
  end if;
  if new.stage = 'published' and new.published_on is null then
    new.published_on := (now() at time zone 'Asia/Kolkata')::date;
  end if;
  if new.stage = 'published' and new.published_url is null and new.final_video_url is not null then
    new.published_url := new.final_video_url;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_videos_sync before insert or update on videos for each row execute function videos_sync();

-- Only managers (or the decide() function) may move a video into approval/publishing stages.
-- Employees may submit for review and, once the client approved, schedule/publish.
create or replace function guard_video_stage() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.decide', true), '') = '1' or is_manager() then return new; end if;
  if tg_op = 'INSERT' then
    if new.stage in ('script_approved','client_review','approved','scheduled_for_posting','published') or new.status = 'published' then
      raise exception 'Only admins or project managers can create videos in the % stage', new.stage;
    end if;
  elsif new.stage is distinct from old.stage then
    if new.stage in ('script_approved','client_review','approved') then
      raise exception 'Only admins, project managers or the client can approve (%)', new.stage;
    elsif new.stage in ('scheduled_for_posting','published') and old.stage not in ('approved','scheduled_for_posting') then
      raise exception 'A video must be client-approved before it can be scheduled or published';
    end if;
  end if;
  return new;
end $$;
create trigger trg_guard_video_stage before insert or update on videos for each row execute function guard_video_stage();

-- CONTENT IDEAS & SCRIPTS ---------------------------------------------------------
create table content_ideas (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  title text not null,
  category text,
  objective text,
  platform text default 'instagram',
  notes text,
  status text not null default 'idea' check (status in ('idea','scripted','rejected')),
  ai_generated boolean not null default false,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index on content_ideas(client_id, status);

create table scripts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  video_id uuid references videos(id) on delete set null,
  idea_id uuid references content_ideas(id) on delete set null,
  title text not null,
  category text,
  objective text,
  target_audience text,
  platform text not null default 'instagram',
  language text not null default 'english',
  tone text not null default 'conversational',
  hook text,
  intro text,
  main_content text,
  supporting text,
  cta text,
  caption text,
  hashtags text,
  scriptwriter_id uuid references profiles(id),
  status text not null default 'draft' check (status in ('draft','in_review','changes_requested','approved','client_review','client_approved')),
  version int not null default 1,
  ai_generated boolean not null default false,
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on scripts(client_id, status);
create index on scripts(scriptwriter_id);

create table script_versions (
  id uuid primary key default gen_random_uuid(),
  script_id uuid not null references scripts(id) on delete cascade,
  version int not null,
  snapshot jsonb not null,
  saved_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (script_id, version)
);

-- every content edit snapshots the previous text as a version and bumps the counter
create or replace function scripts_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.title, new.hook, new.intro, new.main_content, new.supporting, new.cta, new.caption, new.hashtags, new.language, new.tone)
     is distinct from (old.title, old.hook, old.intro, old.main_content, old.supporting, old.cta, old.caption, old.hashtags, old.language, old.tone) then
    insert into script_versions(script_id, version, snapshot, saved_by)
    values (old.id, old.version, jsonb_build_object('title', old.title, 'hook', old.hook, 'intro', old.intro, 'main_content', old.main_content,
            'supporting', old.supporting, 'cta', old.cta, 'caption', old.caption, 'hashtags', old.hashtags, 'language', old.language, 'tone', old.tone), auth.uid())
    on conflict do nothing;
    new.version := old.version + 1;
    -- editing approved text invalidates the approval
    if old.status in ('approved','client_review','client_approved') and coalesce(current_setting('app.decide', true), '') <> '1' then
      new.status := 'draft'; new.approved_by := null; new.approved_at := null;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_scripts_version before update on scripts for each row execute function scripts_version();

create or replace function guard_script_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('app.decide', true), '') = '1' or is_manager() then return new; end if;
  if (tg_op = 'INSERT' and new.status in ('approved','client_review','client_approved'))
     or (tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('approved','client_review','client_approved')) then
    raise exception 'Only admins or project managers can approve scripts';
  end if;
  return new;
end $$;
create trigger trg_guard_script_status before insert or update on scripts for each row execute function guard_script_status();

-- APPROVALS, REVISIONS, COMMENTS -----------------------------------------------------
create table approvals (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  entity_type text not null check (entity_type in ('script','video')),
  entity_id uuid not null,
  decision text not null check (decision in ('approved','changes_requested','send_to_client')),
  feedback text,
  decided_by uuid references profiles(id),
  decided_by_role app_role,
  created_at timestamptz not null default now()
);
create index on approvals(entity_type, entity_id);
create index on approvals(client_id, created_at desc);

create table revisions (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  entity_type text not null check (entity_type in ('script','video')),
  entity_id uuid not null,
  notes text,
  requested_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create index on revisions(entity_type, entity_id);

create table comments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('script','video','task','shoot','editing','client')),
  entity_id uuid not null,
  client_id uuid references clients(id) on delete cascade,
  author_id uuid references profiles(id),
  body text not null check (length(trim(body)) > 0),
  internal boolean not null default true,
  created_at timestamptz not null default now()
);
create index on comments(entity_type, entity_id, created_at);

-- Single entry point for approving / rejecting / sending to client. Checks role and current state server-side.
create or replace function decide(p_type text, p_id uuid, p_decision text, p_feedback text default null) returns void
language plpgsql security definer set search_path = public as $$
declare
  r app_role := current_role_name(); cid uuid; cur text; ttl text; owner uuid; mgr boolean; new_state text; link text;
begin
  if r is null then raise exception 'Not signed in'; end if;
  mgr := r in ('admin','project_manager');
  if p_decision not in ('approved','changes_requested','send_to_client') then raise exception 'Unknown decision'; end if;
  if p_type = 'script' then
    select client_id, status, title, coalesce(scriptwriter_id, created_by) into cid, cur, ttl, owner from scripts where id = p_id for update;
    link := '/scripts/' || p_id;
  elsif p_type = 'video' then
    select client_id, stage, title, coalesce(editor_id, created_by) into cid, cur, ttl, owner from videos where id = p_id for update;
    link := '/production?video=' || p_id;
  else raise exception 'Unknown item type';
  end if;
  if cid is null then raise exception 'Item not found'; end if;
  if not can_access_client(cid) then raise exception 'Not allowed'; end if;
  perform set_config('app.decide', '1', true);

  if r = 'client' then
    if p_decision = 'send_to_client' then raise exception 'Not allowed'; end if;
    if cur <> 'client_review' then raise exception 'This item is not awaiting your approval'; end if;
    if p_decision = 'changes_requested' and coalesce(trim(p_feedback), '') = '' then raise exception 'Please tell us what to change'; end if;
    if p_type = 'script' then
      update scripts set status = case p_decision when 'approved' then 'client_approved' else 'changes_requested' end where id = p_id;
    else
      update videos set stage = case p_decision when 'approved' then 'approved' else 'revision_required' end,
             client_approved_at = case p_decision when 'approved' then now() end where id = p_id;
    end if;
  elsif mgr then
    if p_type = 'script' then
      if cur in ('client_approved') then raise exception 'Already approved by the client'; end if;
      new_state := case p_decision
        when 'approved' then 'approved'
        when 'send_to_client' then 'client_review'
        else 'changes_requested' end;
      if p_decision = 'send_to_client' and cur not in ('approved','client_review') then raise exception 'Approve the script internally first'; end if;
      update scripts set status = new_state,
        approved_by = case when p_decision = 'approved' then auth.uid() else approved_by end,
        approved_at = case when p_decision = 'approved' then now() else approved_at end where id = p_id;
    else
      if p_decision = 'send_to_client' and cur not in ('internal_review','client_review','revision_required','approved') then
        raise exception 'Finish the internal review before sending to the client'; end if;
      update videos set stage = case p_decision when 'approved' then 'approved' when 'send_to_client' then 'client_review' else 'revision_required' end,
             client_approved_at = case when p_decision = 'approved' then now() else client_approved_at end where id = p_id;
    end if;
  else
    raise exception 'Only admins, project managers or the client can approve';
  end if;

  insert into approvals(client_id, entity_type, entity_id, decision, feedback, decided_by, decided_by_role)
  values (cid, p_type, p_id, p_decision, nullif(trim(p_feedback), ''), auth.uid(), r);
  if p_decision = 'changes_requested' then
    insert into revisions(client_id, entity_type, entity_id, notes, requested_by) values (cid, p_type, p_id, nullif(trim(p_feedback), ''), auth.uid());
  end if;

  if r = 'client' then
    perform notify_managers(cid, case p_decision when 'approved' then 'Client approved: ' else 'Client requested changes: ' end || ttl, p_feedback, link);
  end if;
  if owner is not null and owner is distinct from auth.uid() then
    perform notify(owner, case p_decision when 'approved' then 'Approved: ' when 'send_to_client' then 'Sent to client: ' else 'Revision required: ' end || ttl, p_feedback, link);
  end if;
end $$;

-- SHOOTS ---------------------------------------------------------------------------
create table equipment (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  category text,
  is_active boolean not null default true
);

create table shoots (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  video_id uuid references videos(id) on delete set null,
  title text not null,
  location text,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  camera_operator_id uuid references profiles(id),
  assistant_id uuid references profiles(id),
  shot_list text,
  references_text text,
  instructions text,
  status text not null default 'planned' check (status in ('planned','confirmed','completed','cancelled')),
  reschedule_count int not null default 0,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index on shoots(client_id);
create index on shoots(starts_at);
create index on shoots(camera_operator_id);

create table shoot_equipment (
  shoot_id uuid not null references shoots(id) on delete cascade,
  equipment_id uuid not null references equipment(id) on delete restrict,
  primary key (shoot_id, equipment_id)
);

-- One row per person/equipment item per live shoot. The exclusion constraint makes double-booking impossible,
-- even if two people submit at the same moment.
create table shoot_resources (
  shoot_id uuid not null references shoots(id) on delete cascade,
  resource_id uuid not null,
  kind text not null check (kind in ('person','equipment')),
  during tstzrange not null,
  constraint no_double_booking exclude using gist (resource_id with =, during with &&)
);
create index on shoot_resources(shoot_id);

create table shoot_availability (
  shoot_id uuid not null references shoots(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  response text not null check (response in ('available','unavailable')),
  note text,
  updated_at timestamptz not null default now(),
  primary key (shoot_id, user_id)
);

create or replace function rebuild_shoot_resources(sid uuid) returns void
language plpgsql security definer set search_path = public as $$
declare s shoots;
begin
  select * into s from shoots where id = sid;
  delete from shoot_resources where shoot_id = sid;
  if s.id is null or s.status in ('cancelled','completed') then return; end if;
  insert into shoot_resources(shoot_id, resource_id, kind, during)
    select sid, p, 'person', tstzrange(s.starts_at, s.ends_at)
    from (select distinct unnest(array[s.camera_operator_id, s.assistant_id]) p) x where p is not null;
  insert into shoot_resources(shoot_id, resource_id, kind, during)
    select sid, equipment_id, 'equipment', tstzrange(s.starts_at, s.ends_at) from shoot_equipment where shoot_id = sid;
end $$;

create or replace function shoots_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare crew uuid[]; u uuid; cname text;
begin
  perform rebuild_shoot_resources(new.id);
  select business_name into cname from clients where id = new.client_id;
  crew := array[new.camera_operator_id, new.assistant_id];
  if tg_op = 'INSERT' then
    foreach u in array crew loop
      if u is not null and u is distinct from auth.uid() then
        perform notify(u, 'New shoot: ' || new.title, cname || ' - ' || to_char(new.starts_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), '/shoots'); end if;
    end loop;
  else
    if new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at then
      foreach u in array crew loop
        if u is not null and u is distinct from auth.uid() then
          perform notify(u, 'Shoot rescheduled: ' || new.title, cname || ' - now ' || to_char(new.starts_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), '/shoots'); end if;
      end loop;
    end if;
    if new.camera_operator_id is distinct from old.camera_operator_id and new.camera_operator_id is not null and new.camera_operator_id is distinct from auth.uid() then
      perform notify(new.camera_operator_id, 'You were assigned a shoot: ' || new.title, cname, '/shoots'); end if;
    if new.assistant_id is distinct from old.assistant_id and new.assistant_id is not null and new.assistant_id is distinct from auth.uid() then
      perform notify(new.assistant_id, 'You were assigned a shoot: ' || new.title, cname, '/shoots'); end if;
  end if;
  -- advance the linked video's pipeline stage (never moves it backwards)
  if new.video_id is not null then
    if new.status = 'completed' then
      update videos set stage = 'shoot_completed' where id = new.video_id and stage_rank(stage) < stage_rank('shoot_completed');
    elsif new.status in ('planned','confirmed') then
      update videos set stage = 'shoot_scheduled', shoot_date = (new.starts_at at time zone 'Asia/Kolkata')::date, shoot_location = new.location
        where id = new.video_id and stage_rank(stage) <= stage_rank('shoot_scheduled');
    end if;
  end if;
  return new;
end $$;
create trigger trg_shoots_after after insert or update on shoots for each row execute function shoots_after();

create or replace function shoots_before() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and (new.starts_at is distinct from old.starts_at or new.ends_at is distinct from old.ends_at) then
    new.reschedule_count := old.reschedule_count + 1;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_shoots_before before update on shoots for each row execute function shoots_before();

create or replace function shoot_equipment_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform rebuild_shoot_resources(coalesce(new.shoot_id, old.shoot_id));
  return null;
end $$;
create trigger trg_shoot_equipment_after after insert or delete on shoot_equipment for each row execute function shoot_equipment_after();

-- EDITING ---------------------------------------------------------------------------
create table editing_assignments (
  id uuid primary key default gen_random_uuid(),
  video_id uuid not null unique references videos(id) on delete cascade,
  client_id uuid not null references clients(id) on delete cascade,
  editor_id uuid references profiles(id),
  raw_footage_url text,
  references_url text,
  instructions text,
  deadline timestamptz,
  status text not null default 'not_started' check (status in ('not_started','in_progress','first_cut_submitted','review','revision_required','final_approved','delivered')),
  progress int not null default 0 check (progress between 0 and 100),
  final_url text,
  reviewer_feedback text,
  started_at timestamptz,
  delivered_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on editing_assignments(editor_id, status);
create index on editing_assignments(client_id);
create index on editing_assignments(deadline);

create or replace function editing_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_manager() and (tg_op = 'INSERT' or new.status is distinct from old.status) and new.status in ('final_approved','delivered','revision_required') then
    raise exception 'Only admins or project managers can approve, deliver or return an edit';
  end if;
  if new.status = 'in_progress' and new.started_at is null then new.started_at := now(); end if;
  if new.status in ('final_approved','delivered') then new.progress := 100; end if;
  if new.status = 'delivered' and new.delivered_at is null then new.delivered_at := now(); end if;
  new.updated_at := now();
  return new;
end $$;
create trigger trg_editing_guard before insert or update on editing_assignments for each row execute function editing_guard();

create or replace function editing_after() returns trigger
language plpgsql security definer set search_path = public as $$
declare v videos; target text;
begin
  select * into v from videos where id = new.video_id;
  update videos set editor_id = new.editor_id, editing_deadline = (new.deadline at time zone 'Asia/Kolkata')::date,
         final_video_url = coalesce(new.final_url, final_video_url) where id = new.video_id;
  target := case new.status
    when 'in_progress' then 'editing' when 'first_cut_submitted' then 'editing'
    when 'review' then 'internal_review' when 'revision_required' then 'revision_required' end;
  if target is not null and (tg_op = 'INSERT' or new.status is distinct from old.status) then
    -- app.decide lets the stage guard accept a manager-driven transition; employees only reach internal_review/editing here
    update videos set stage = target where id = new.video_id and (target in ('editing','internal_review') and stage_rank(stage) < stage_rank('client_review') or target = 'revision_required');
  end if;
  if tg_op = 'INSERT' and new.editor_id is not null and new.editor_id is distinct from auth.uid() then
    perform notify(new.editor_id, 'New editing assignment: ' || v.title, null, '/editing');
  elsif tg_op = 'UPDATE' then
    if new.editor_id is distinct from old.editor_id and new.editor_id is not null and new.editor_id is distinct from auth.uid() then
      perform notify(new.editor_id, 'New editing assignment: ' || v.title, null, '/editing'); end if;
    if new.deadline is distinct from old.deadline and new.editor_id is not null and new.editor_id is distinct from auth.uid() then
      perform notify(new.editor_id, 'Editing deadline changed: ' || v.title, null, '/editing'); end if;
    if new.status is distinct from old.status then
      if new.status in ('first_cut_submitted','review') then
        perform notify_managers(new.client_id, 'Edit ready for review: ' || v.title, null, '/editing');
      elsif new.status = 'revision_required' and new.editor_id is not null then
        perform notify(new.editor_id, 'Revision required: ' || v.title, new.reviewer_feedback, '/editing');
      end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_editing_after after insert or update on editing_assignments for each row execute function editing_after();

-- PUBLISHING CALENDAR ------------------------------------------------------------------
create table content_calendar (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id) on delete cascade,
  video_id uuid references videos(id) on delete set null,
  title text not null,
  platform text not null default 'instagram' check (platform in ('instagram','youtube','facebook','linkedin')),
  scheduled_at timestamptz not null,
  caption text,
  hashtags text,
  preview_url text,
  status text not null default 'scheduled' check (status in ('scheduled','published','cancelled')),
  published_url text,
  published_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  constraint cal_published_needs_url check (status <> 'published' or published_url is not null)
);
create index on content_calendar(client_id, scheduled_at);
create index on content_calendar(scheduled_at);

-- ROW LEVEL SECURITY ----------------------------------------------------------------------
-- the earlier "videos_staff" policy let any staff delete; split it so only managers delete
drop policy videos_staff on videos;
create policy videos_staff_select on videos for select using (is_staff() and can_access_client(client_id));
create policy videos_staff_insert on videos for insert with check (is_staff() and can_access_client(client_id));
create policy videos_staff_update on videos for update using (is_staff() and can_access_client(client_id)) with check (is_staff() and can_access_client(client_id));
create policy videos_manager_delete on videos for delete using (is_manager() and can_access_client(client_id));
create policy videos_client_select on videos for select using (
  current_role_name() = 'client' and can_access_client(client_id) and stage in ('client_review','approved','scheduled_for_posting','published'));

alter table projects enable row level security;
create policy projects_staff_select on projects for select using (is_staff() and can_access_client(client_id));
create policy projects_manager_write on projects for all using (is_manager() and can_access_client(client_id)) with check (is_manager() and can_access_client(client_id));

alter table content_ideas enable row level security;
create policy ideas_staff on content_ideas for all using (is_staff() and can_access_client(client_id)) with check (is_staff() and can_access_client(client_id));

alter table scripts enable row level security;
create policy scripts_staff_select on scripts for select using (is_staff() and can_access_client(client_id));
create policy scripts_staff_insert on scripts for insert with check (is_staff() and can_access_client(client_id));
create policy scripts_staff_update on scripts for update using (is_staff() and can_access_client(client_id)) with check (is_staff() and can_access_client(client_id));
create policy scripts_manager_delete on scripts for delete using (is_manager() and can_access_client(client_id));
create policy scripts_client_select on scripts for select using (
  current_role_name() = 'client' and can_access_client(client_id) and status in ('client_review','client_approved'));

alter table script_versions enable row level security;
create policy script_versions_staff on script_versions for select using (exists (select 1 from scripts s where s.id = script_id) and is_staff());

alter table approvals enable row level security;
create policy approvals_select on approvals for select using (can_access_client(client_id));   -- writes only through decide()

alter table revisions enable row level security;
create policy revisions_select on revisions for select using (can_access_client(client_id));
create policy revisions_staff_update on revisions for update using (is_manager() and can_access_client(client_id));

alter table comments enable row level security;
create policy comments_staff_select on comments for select using (is_staff() and (
  (client_id is not null and can_access_client(client_id)) or
  (entity_type = 'task' and exists (select 1 from tasks t where t.id = entity_id))));
create policy comments_client_select on comments for select using (
  current_role_name() = 'client' and not internal and client_id is not null and can_access_client(client_id));
create policy comments_staff_insert on comments for insert with check (author_id = auth.uid() and is_staff() and (
  (client_id is not null and can_access_client(client_id)) or
  (entity_type = 'task' and exists (select 1 from tasks t where t.id = entity_id))));
create policy comments_client_insert on comments for insert with check (
  author_id = auth.uid() and current_role_name() = 'client' and not internal and client_id is not null and can_access_client(client_id)
  and entity_type in ('script','video'));
create policy comments_delete_own on comments for delete using (author_id = auth.uid() or is_admin());

alter table equipment enable row level security;
create policy equipment_staff_select on equipment for select using (is_staff());
create policy equipment_manager_write on equipment for all using (is_manager()) with check (is_manager());

alter table shoots enable row level security;
create policy shoots_staff_select on shoots for select using (is_staff() and can_access_client(client_id));
create policy shoots_manager_insert on shoots for insert with check (is_manager() and can_access_client(client_id));
create policy shoots_update on shoots for update using (
  is_staff() and can_access_client(client_id) and (is_manager() or camera_operator_id = auth.uid()))
  with check (is_staff() and can_access_client(client_id) and (is_manager() or camera_operator_id = auth.uid()));
create policy shoots_manager_delete on shoots for delete using (is_manager() and can_access_client(client_id));

alter table shoot_equipment enable row level security;
create policy shoot_equipment_select on shoot_equipment for select using (is_staff() and exists (select 1 from shoots s where s.id = shoot_id));
create policy shoot_equipment_write on shoot_equipment for all using (is_manager() and exists (select 1 from shoots s where s.id = shoot_id))
  with check (is_manager() and exists (select 1 from shoots s where s.id = shoot_id));

alter table shoot_resources enable row level security;
create policy shoot_resources_select on shoot_resources for select using (is_staff());   -- written only by trigger

alter table shoot_availability enable row level security;
create policy availability_select on shoot_availability for select using (is_staff() and exists (select 1 from shoots s where s.id = shoot_id));
create policy availability_own_write on shoot_availability for insert with check (user_id = auth.uid() and exists (select 1 from shoots s where s.id = shoot_id));
create policy availability_own_update on shoot_availability for update using (user_id = auth.uid()) with check (user_id = auth.uid());

alter table editing_assignments enable row level security;
create policy editing_staff_select on editing_assignments for select using (is_staff() and can_access_client(client_id));
create policy editing_manager_insert on editing_assignments for insert with check (is_manager() and can_access_client(client_id));
create policy editing_update on editing_assignments for update using (
  is_staff() and can_access_client(client_id) and (is_manager() or editor_id = auth.uid()))
  with check (is_staff() and can_access_client(client_id) and (is_manager() or editor_id = auth.uid()));
create policy editing_manager_delete on editing_assignments for delete using (is_manager() and can_access_client(client_id));

alter table content_calendar enable row level security;
create policy calendar_staff on content_calendar for all using (is_staff() and can_access_client(client_id)) with check (is_staff() and can_access_client(client_id));
create policy calendar_client_select on content_calendar for select using (current_role_name() = 'client' and can_access_client(client_id) and status <> 'cancelled');

-- Clients must not read the full clients row (it contains internal notes). They use portal_client instead.
drop policy clients_select on clients;
create policy clients_select on clients for select using (current_role_name() <> 'client' and can_access_client(id));
create view portal_client as
  select c.id, c.business_name, c.category, c.start_date, c.contract_months, c.monthly_deliverables, c.instagram_url, c.website
  from clients c join profiles p on p.client_id = c.id where p.id = auth.uid() and p.is_active and p.role = 'client';
grant select on portal_client to authenticated;

-- AUDIT + NOTIFICATION TRIGGERS -----------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['projects','scripts','approvals','shoots','editing_assignments','content_calendar','equipment'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function log_activity()', 'audit_'||t, t);
  end loop; end $$;

-- task notifications (assignment, deadline change, submission, approval)
create or replace function tasks_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.assignee_id is not null and new.assignee_id is distinct from auth.uid() then
      perform notify(new.assignee_id, 'New task: ' || new.title, null, '/tasks'); end if;
  else
    if new.assignee_id is distinct from old.assignee_id and new.assignee_id is not null and new.assignee_id is distinct from auth.uid() then
      perform notify(new.assignee_id, 'New task: ' || new.title, null, '/tasks'); end if;
    if new.due_date is distinct from old.due_date and new.assignee_id is not null and new.assignee_id is distinct from auth.uid() then
      perform notify(new.assignee_id, 'Deadline changed: ' || new.title, null, '/tasks'); end if;
    if new.status is distinct from old.status then
      if new.status = 'review' and new.created_by is not null and new.created_by is distinct from auth.uid() then
        perform notify(new.created_by, 'Submitted for review: ' || new.title, null, '/tasks'); end if;
      if new.status = 'approved' and new.assignee_id is not null and new.assignee_id is distinct from auth.uid() then
        perform notify(new.assignee_id, 'Task approved: ' || new.title, null, '/tasks'); end if;
    end if;
  end if;
  return new;
end $$;
create trigger trg_tasks_notify after insert or update on tasks for each row execute function tasks_notify();

-- tell managers when something is submitted for review (separate functions: plpgsql cannot reference a missing NEW field)
create or replace function scripts_review_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'in_review' and (tg_op = 'INSERT' or old.status is distinct from 'in_review') then
    perform notify_managers(new.client_id, 'Script awaiting approval: ' || new.title, null, '/scripts/' || new.id);
  end if;
  return null;
end $$;
create or replace function videos_review_notify() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'internal_review' and (tg_op = 'INSERT' or old.stage is distinct from 'internal_review') then
    perform notify_managers(new.client_id, 'Video awaiting internal review: ' || new.title, null, '/production?video=' || new.id);
  end if;
  return null;
end $$;
create trigger trg_scripts_review_notify after insert or update on scripts for each row execute function scripts_review_notify();
create trigger trg_videos_review_notify after insert or update on videos for each row execute function videos_review_notify();
