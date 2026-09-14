-- REV Phase 2B core schema.
-- Preparation only: do not apply to the frozen Revive Supabase project yet.

create extension if not exists pgcrypto;

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  status text not null default 'active' check (status in ('active', 'paused', 'archived')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active' check (status in ('invited', 'active', 'suspended')),
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.business_profiles (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  business_name text not null,
  description text not null default '',
  website text,
  industry text,
  target_customers text not null default '',
  service_areas jsonb not null default '[]'::jsonb,
  opening_hours jsonb not null default '{}'::jsonb,
  differentiators jsonb not null default '[]'::jsonb,
  brand_voice text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.business_services (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  description text not null default '',
  price_information text,
  active boolean not null default true,
  unique (workspace_id, id)
);

create table if not exists public.goals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  objective text not null,
  metric text not null,
  target_value numeric not null check (target_value >= 0),
  current_value numeric not null default 0 check (current_value >= 0),
  start_date date not null,
  target_date date not null,
  priority text not null check (priority in ('high', 'medium', 'low')),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'completed', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  lifecycle text not null check (lifecycle in ('prospect', 'lead', 'customer', 'former_customer')),
  name text not null,
  company text,
  email text,
  phone text,
  source text,
  estimated_value numeric,
  score numeric check (score >= 0 and score <= 100),
  last_interaction_at timestamptz,
  next_action_at timestamptz,
  owner_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id)
);

create table if not exists public.rev_actions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  goal_id uuid,
  contact_id uuid,
  action_type text not null,
  title text not null,
  description text not null,
  rationale text,
  requires_approval boolean not null default true,
  status text not null default 'proposed' check (status in ('proposed', 'awaiting_approval', 'approved', 'rejected', 'cancelled', 'completed', 'failed')),
  execution_status text not null default 'not_started' check (execution_status in ('not_started', 'not_executed', 'in_progress', 'succeeded', 'failed')),
  proposed_at timestamptz not null default now(),
  approved_at timestamptz,
  executed_at timestamptz,
  outcome_summary text,
  unique (workspace_id, id),
  foreign key (workspace_id, goal_id) references public.goals(workspace_id, id),
  foreign key (workspace_id, contact_id) references public.contacts(workspace_id, id)
);

create table if not exists public.approvals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rev_action_id uuid not null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users(id),
  decision text check (decision in ('approved', 'rejected', 'edited')),
  notes text,
  unique (workspace_id, id),
  foreign key (workspace_id, rev_action_id) references public.rev_actions(workspace_id, id)
);

create table if not exists public.business_memory_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null,
  entity_type text not null,
  entity_id uuid,
  title text not null,
  summary text not null,
  structured_data jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null,
  created_by_type text not null check (created_by_type in ('user', 'rev', 'system')),
  created_by_id uuid,
  unique (workspace_id, id)
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_user_id uuid references auth.users(id),
  actor_type text not null check (actor_type in ('user', 'rev', 'system')),
  action text not null,
  resource_type text not null,
  resource_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  timestamp timestamptz not null default now(),
  unique (workspace_id, id)
);

create index if not exists goals_workspace_idx on public.goals(workspace_id);
create index if not exists contacts_workspace_idx on public.contacts(workspace_id);
create index if not exists actions_workspace_idx on public.rev_actions(workspace_id);
create index if not exists memory_workspace_occurred_idx on public.business_memory_events(workspace_id, occurred_at desc);
create index if not exists audit_workspace_timestamp_idx on public.audit_log(workspace_id, timestamp desc);

create or replace function public.is_active_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
  );
$$;

create or replace function public.has_workspace_role(target_workspace_id uuid, allowed_roles text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = auth.uid()
      and status = 'active'
      and role = any(allowed_roles)
  );
$$;

create or replace function public.create_workspace_with_owner(workspace_name text, workspace_slug text)
returns table (created_workspace_id uuid, created_workspace_name text, created_workspace_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  creator_user_id uuid;
  new_workspace_id uuid;
  safe_workspace_name text;
  safe_workspace_slug text;
begin
  creator_user_id := auth.uid();
  if creator_user_id is null then
    raise exception 'authenticated user required';
  end if;

  safe_workspace_name := pg_catalog.btrim(workspace_name);
  safe_workspace_slug := pg_catalog.btrim(workspace_slug);
  if safe_workspace_name is null or pg_catalog.char_length(safe_workspace_name) not between 1 and 120 then
    raise exception 'workspace name must be between 1 and 120 characters';
  end if;
  if safe_workspace_slug is null or safe_workspace_slug !~ '^[a-z0-9]+(?:-[a-z0-9]+)*$' or pg_catalog.char_length(safe_workspace_slug) not between 1 and 80 then
    raise exception 'workspace slug must use lowercase letters, numbers, and single hyphens';
  end if;

  insert into public.workspaces (name, slug, created_by)
    values (safe_workspace_name, safe_workspace_slug, creator_user_id)
    returning id into new_workspace_id;

  insert into public.workspace_members (workspace_id, user_id, role, status)
    values (new_workspace_id, creator_user_id, 'owner', 'active');

  insert into public.audit_log (workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata)
    values (new_workspace_id, creator_user_id, 'user', 'workspace.created', 'workspace', new_workspace_id, '{"source":"bootstrap"}'::jsonb);

  return query select new_workspace_id, safe_workspace_name, safe_workspace_slug;
end;
$$;

revoke all on function public.is_active_workspace_member(uuid) from public;
grant execute on function public.is_active_workspace_member(uuid) to authenticated;
revoke all on function public.has_workspace_role(uuid, text[]) from public;
grant execute on function public.has_workspace_role(uuid, text[]) to authenticated;
revoke all on function public.create_workspace_with_owner(text, text) from public;
grant execute on function public.create_workspace_with_owner(text, text) to authenticated;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.business_profiles enable row level security;
alter table public.business_services enable row level security;
alter table public.goals enable row level security;
alter table public.contacts enable row level security;
alter table public.rev_actions enable row level security;
alter table public.approvals enable row level security;
alter table public.business_memory_events enable row level security;
alter table public.audit_log enable row level security;

create policy workspaces_select on public.workspaces for select using (public.is_active_workspace_member(id));
create policy workspaces_update on public.workspaces for update using (public.has_workspace_role(id, array['owner', 'admin']));
create policy workspace_members_select on public.workspace_members for select using (public.is_active_workspace_member(workspace_id));

create policy business_profiles_tenant on public.business_profiles for all using (public.is_active_workspace_member(workspace_id)) with check (public.is_active_workspace_member(workspace_id));
create policy business_services_tenant on public.business_services for all using (public.is_active_workspace_member(workspace_id)) with check (public.is_active_workspace_member(workspace_id));
create policy goals_tenant on public.goals for all using (public.is_active_workspace_member(workspace_id)) with check (public.is_active_workspace_member(workspace_id));
create policy contacts_tenant on public.contacts for all using (public.is_active_workspace_member(workspace_id)) with check (public.is_active_workspace_member(workspace_id));
create policy rev_actions_tenant on public.rev_actions for all using (public.is_active_workspace_member(workspace_id)) with check (public.is_active_workspace_member(workspace_id));
create policy approvals_tenant on public.approvals for all using (public.is_active_workspace_member(workspace_id)) with check (public.is_active_workspace_member(workspace_id));
create policy memory_events_tenant on public.business_memory_events for all using (public.is_active_workspace_member(workspace_id)) with check (public.is_active_workspace_member(workspace_id));
create policy audit_log_select on public.audit_log for select using (public.is_active_workspace_member(workspace_id));
create policy audit_log_insert on public.audit_log for insert with check (public.is_active_workspace_member(workspace_id));
