-- GENZ FILMS OS - Migration 002: research, competitors, strategy (+RLS)
create table business_research (client_id uuid primary key references clients(id) on delete cascade,
  business_model text, products_services text, best_sellers text, high_value_services text, pricing text, usp text,
  positioning text, strengths text, weaknesses text, objectives text, updated_by uuid references profiles(id), updated_at timestamptz default now());
create table audience_research (client_id uuid primary key references clients(id) on delete cascade,
  age_groups text, gender text, geography text, interests text, problems text, buying_behaviour text,
  motivations text, objections text, expectations text, updated_by uuid references profiles(id), updated_at timestamptz default now());
create table instagram_audits (client_id uuid primary key references clients(id) on delete cascade,
  followers int check (followers >= 0), avg_reel_views int check (avg_reel_views >= 0), posting_frequency text, engagement text,
  profile_quality text, branding text, bio_highlights text, content_quality text, content_gaps text, opportunities text,
  updated_by uuid references profiles(id), updated_at timestamptz default now());
create table market_opportunities (client_id uuid primary key references clients(id) on delete cascade,
  local_market text, seasonal text, competitor_gaps text, customer_needs text, marketing text,
  updated_by uuid references profiles(id), updated_at timestamptz default now());
create table content_strategies (client_id uuid primary key references clients(id) on delete cascade,
  primary_objective text, target_audience text, brand_positioning text, content_direction text, marketing_strategy text,
  content_pillars text, kpis text, expected_outcomes text, updated_by uuid references profiles(id), updated_at timestamptz default now());
create table competitors (id uuid primary key default gen_random_uuid(), client_id uuid not null references clients(id) on delete cascade,
  name text not null, website text, instagram_url text, followers int check (followers >= 0), content_style text, best_content text,
  strengths text, weaknesses text, offers text, positioning text, opportunities text, notes text,
  created_by uuid references profiles(id), created_at timestamptz not null default now());
create index on competitors(client_id);

do $$ declare t text; begin
  foreach t in array array['business_research','audience_research','instagram_audits','market_opportunities','content_strategies','competitors'] loop
    execute format('alter table %I enable row level security', t);
    -- staff only (clients never see internal research) and only for clients they can access
    execute format('create policy %I on %I for all using (is_staff() and can_access_client(client_id)) with check (is_staff() and can_access_client(client_id))', t||'_staff', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function log_activity()', 'audit_'||t, t);
  end loop; end $$;
