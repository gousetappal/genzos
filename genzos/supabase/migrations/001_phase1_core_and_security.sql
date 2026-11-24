-- GENZ FILMS OS - Migration 001: Phase 1 core schema + RLS
-- Run in Supabase SQL editor or via `supabase db push`.

create extension if not exists "pgcrypto";

-- ENUMS ---------------------------------------------------------------
create type app_role as enum ('admin', 'project_manager', 'employee', 'client');
create type client_status as enum ('lead','prospect','onboarding','active','on_hold','completed','lost');
create type task_priority as enum ('low','medium','high','urgent');
create type task_status as enum ('todo','in_progress','review','done','approved');
create type designation as enum ('video_editor','videographer','content_strategist','scriptwriter','graphic_designer','social_media_manager','project_manager');

-- PROFILES (no money columns here; employees can read colleagues' basic info) ----
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text not null unique,
  phone text,
  avatar_url text,
  role app_role not null default 'employee',
  designation designation,
  joining_date date,
  skills text[] default '{}',
  is_active boolean not null default true,
  -- for client-portal users: which client they belong to
  client_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- CLIENTS (operational data only; NO financial columns) ---------------
create table clients (
  id uuid primary key default gen_random_uuid(),
  business_name text not null,
  category text,
  owner_name text,
  phone text,
  email text,
  location text,
  instagram_url text,
  website text,
  google_business_url text,
  description text,
  start_date date,
  contract_months int check (contract_months > 0),
  monthly_deliverables int not null default 0 check (monthly_deliverables >= 0),
  project_manager_id uuid references profiles(id),
  status client_status not null default 'lead',
  internal_notes text,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table profiles add constraint profiles_client_fk foreign key (client_id) references clients(id) on delete set null;
create index on clients(status);
create index on clients(project_manager_id);

-- Money lives in a separate table: RLS is row-level, so isolating columns
-- into an admin-only table is the only reliable way to hide them.
create table client_finance (
  client_id uuid primary key references clients(id) on delete cascade,
  monthly_package_amount numeric(12,2) not null default 0 check (monthly_package_amount >= 0),
  gstin text,
  billing_address text,
  updated_at timestamptz not null default now()
);

create table client_assignments (
  client_id uuid references clients(id) on delete cascade,
  employee_id uuid references profiles(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  primary key (client_id, employee_id)
);
create index on client_assignments(employee_id);

-- Salaries: admin only, never joined to profiles
create table salaries (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references profiles(id),
  month date not null,
  base_salary numeric(12,2) not null check (base_salary >= 0),
  advance numeric(12,2) not null default 0,
  deductions numeric(12,2) not null default 0,
  amount_payable numeric(12,2) generated always as (base_salary - advance - deductions) stored,
  paid_on date,
  unique (employee_id, month)
);

-- TASKS ---------------------------------------------------------------
create table tasks (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references clients(id) on delete set null,
  title text not null,
  description text,
  priority task_priority not null default 'medium',
  status task_status not null default 'todo',
  assignee_id uuid references profiles(id),
  created_by uuid references profiles(id),
  due_date timestamptz,
  completed_at timestamptz,
  approved_by uuid references profiles(id),
  parent_task_id uuid references tasks(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on tasks(assignee_id, status);
create index on tasks(client_id);
create index on tasks(due_date);

-- NOTIFICATIONS & AUDIT ------------------------------------------------
create table notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index on notifications(user_id, read_at);

create table activity_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id),
  action text not null,           -- INSERT / UPDATE / DELETE
  table_name text not null,
  record_id text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);

-- HELPER FUNCTIONS (SECURITY DEFINER avoids RLS recursion on profiles) ---
create or replace function current_role_name() returns app_role
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and is_active $$;

create or replace function is_admin() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(current_role_name() = 'admin', false) $$;

create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(current_role_name() in ('admin','project_manager','employee'), false) $$;

create or replace function can_access_client(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select case current_role_name()
    when 'admin' then true
    when 'project_manager' then exists (select 1 from clients c where c.id = cid and c.project_manager_id = auth.uid())
    when 'employee' then exists (select 1 from client_assignments a where a.client_id = cid and a.employee_id = auth.uid())
    when 'client' then exists (select 1 from profiles p where p.id = auth.uid() and p.client_id = cid)
    else false end
$$;

-- Prevent users escalating their own role / client link
create or replace function protect_profile_fields() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() and (new.role <> old.role or new.client_id is distinct from old.client_id or new.is_active <> old.is_active) then
    raise exception 'Only admins can change role, client link or active status';
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger trg_protect_profile before update on profiles
  for each row execute function protect_profile_fields();

-- AUDIT TRIGGER ---------------------------------------------------------
create or replace function log_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into activity_logs(actor_id, action, table_name, record_id, old_data, new_data)
  values (auth.uid(), tg_op, tg_table_name,
          coalesce((to_jsonb(new)->>'id'), (to_jsonb(old)->>'id'), (to_jsonb(new)->>'client_id')),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger audit_clients after insert or update or delete on clients for each row execute function log_activity();
create trigger audit_client_finance after insert or update or delete on client_finance for each row execute function log_activity();
create trigger audit_salaries after insert or update or delete on salaries for each row execute function log_activity();
create trigger audit_profiles after update or delete on profiles for each row execute function log_activity();

-- AUTO-CREATE PROFILE ON SIGNUP (always 'employee'; admin promotes) ---------
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles(id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1)), new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- ROW LEVEL SECURITY ----------------------------------------------------
alter table profiles          enable row level security;
alter table clients           enable row level security;
alter table client_finance    enable row level security;
alter table client_assignments enable row level security;
alter table salaries          enable row level security;
alter table tasks             enable row level security;
alter table notifications     enable row level security;
alter table activity_logs     enable row level security;

-- profiles: staff see staff; clients see only themselves; users edit self; admin all
create policy profiles_select on profiles for select using (
  id = auth.uid() or is_staff());
create policy profiles_update_self on profiles for update using (id = auth.uid() or is_admin());
create policy profiles_admin_insert on profiles for insert with check (is_admin());
create policy profiles_admin_delete on profiles for delete using (is_admin());

-- clients
create policy clients_select on clients for select using (can_access_client(id));
create policy clients_insert on clients for insert with check (is_admin());
create policy clients_update on clients for update using (is_admin() or (current_role_name()='project_manager' and project_manager_id = auth.uid()));
create policy clients_delete on clients for delete using (is_admin());

-- finance: admin only, full stop
create policy client_finance_admin on client_finance for all using (is_admin()) with check (is_admin());
create policy salaries_admin on salaries for all using (is_admin()) with check (is_admin());

-- assignments
create policy assignments_select on client_assignments for select using (is_admin() or employee_id = auth.uid() or can_access_client(client_id));
create policy assignments_write on client_assignments for all using (is_admin()) with check (is_admin());

-- tasks: staff see tasks they're assigned/created or tasks for clients they can access
create policy tasks_select on tasks for select using (
  is_staff() and (is_admin() or assignee_id = auth.uid() or created_by = auth.uid()
                  or (client_id is not null and can_access_client(client_id) and current_role_name() = 'project_manager')));
create policy tasks_insert on tasks for insert with check (
  is_admin() or (current_role_name() in ('project_manager','employee') and created_by = auth.uid()));
create policy tasks_update on tasks for update using (
  is_admin() or assignee_id = auth.uid() or created_by = auth.uid()
  or (current_role_name()='project_manager' and client_id is not null and can_access_client(client_id)));
create policy tasks_delete on tasks for delete using (is_admin());

-- notifications: own only
create policy notif_select on notifications for select using (user_id = auth.uid());
create policy notif_update on notifications for update using (user_id = auth.uid());
create policy notif_insert on notifications for insert with check (is_staff());

-- audit log: admin read only; written only by trigger (security definer)
create policy logs_admin_read on activity_logs for select using (is_admin());

-- Employees must not be able to approve their own tasks
create or replace function guard_task_approval() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.status = 'approved' or new.approved_by is distinct from old.approved_by)
     and current_role_name() not in ('admin','project_manager') then
    raise exception 'Only admins or project managers can approve tasks';
  end if;
  new.updated_at = now();
  return new;
end $$;
create trigger trg_guard_task_approval before update on tasks
  for each row execute function guard_task_approval();
