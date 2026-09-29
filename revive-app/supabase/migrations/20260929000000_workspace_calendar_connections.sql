-- Phase 5 calendar connection foundation. Metadata only; no OAuth or provider access.
create table public.workspace_calendar_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_key text not null check (provider_key = 'microsoft_graph'),
  connection_status text not null default 'disconnected'
    check (connection_status in ('disconnected', 'connected', 'expired', 'revoked', 'error')),
  provider_account_reference text,
  credential_reference text,
  authorized_by_user_id uuid,
  authorized_at timestamptz,
  revoked_at timestamptz,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, authorized_by_user_id)
    references public.workspace_members(workspace_id, user_id)
    on delete set null (authorized_by_user_id),
  constraint workspace_calendar_connections_account_check
    check (provider_account_reference is null or pg_catalog.length(pg_catalog.btrim(provider_account_reference)) > 0),
  constraint workspace_calendar_connections_credential_check
    check (credential_reference is null or pg_catalog.length(pg_catalog.btrim(credential_reference)) > 0),
  constraint workspace_calendar_connections_disconnected_check
    check (connection_status <> 'disconnected' or credential_reference is null)
);

create unique index workspace_calendar_connections_provider_account_unique
  on public.workspace_calendar_connections(workspace_id, provider_key, provider_account_reference)
  where provider_account_reference is not null;

create index workspace_calendar_connections_workspace_idx
  on public.workspace_calendar_connections(workspace_id);

create table public.workspace_calendars (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  connection_id uuid not null,
  provider_calendar_reference text not null
    check (pg_catalog.length(pg_catalog.btrim(provider_calendar_reference)) > 0),
  display_name text not null
    check (pg_catalog.length(pg_catalog.btrim(display_name)) > 0),
  timezone text not null
    check (pg_catalog.length(pg_catalog.btrim(timezone)) > 0),
  is_selected boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  unique (workspace_id, connection_id, provider_calendar_reference),
  foreign key (workspace_id, connection_id)
    references public.workspace_calendar_connections(workspace_id, id)
    on delete cascade,
  constraint workspace_calendars_selected_active_check
    check (not is_selected or active)
);

create unique index workspace_calendars_one_selected_active
  on public.workspace_calendars(workspace_id)
  where is_selected and active;

create index workspace_calendars_connection_idx
  on public.workspace_calendars(workspace_id, connection_id);

alter table public.workspace_calendar_connections enable row level security;
alter table public.workspace_calendars enable row level security;

create policy workspace_calendar_connections_owner_admin_read
  on public.workspace_calendar_connections
  for select
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

create policy workspace_calendars_owner_admin_read
  on public.workspace_calendars
  for select
  to authenticated
  using (public.has_workspace_role(workspace_id, array['owner', 'admin']));

revoke all on table public.workspace_calendar_connections from public, anon, authenticated;
revoke all on table public.workspace_calendars from public, anon, authenticated;

grant select (
  id,
  workspace_id,
  provider_key,
  connection_status,
  provider_account_reference,
  authorized_by_user_id,
  authorized_at,
  revoked_at,
  last_verified_at,
  created_at,
  updated_at
) on public.workspace_calendar_connections to authenticated;
grant select on table public.workspace_calendars to authenticated;

grant select, insert, update, delete on table public.workspace_calendar_connections to service_role;
grant select, insert, update, delete on table public.workspace_calendars to service_role;
