-- Workspace staff names and identity-bound invitations. No email sending or role promotion.
begin;
create schema if not exists rev_workspace_team_private;
revoke all on schema rev_workspace_team_private from public, anon, authenticated;

create table public.workspace_staff_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  user_id uuid not null,
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  updated_at timestamptz not null default now(),
  version bigint not null default 1 check (version >= 1),
  unique (workspace_id, user_id),
  foreign key (workspace_id, user_id) references public.workspace_members(workspace_id, user_id) on delete cascade
);
create table public.workspace_staff_invitations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  email text not null check (email = lower(btrim(email)) and char_length(email) between 3 and 320),
  display_name text not null check (char_length(btrim(display_name)) between 1 and 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'revoked')),
  accepted_by uuid references auth.users(id),
  accepted_at timestamptz,
  check ((status = 'accepted') = (accepted_by is not null and accepted_at is not null))
);
create index workspace_staff_invitations_scope on public.workspace_staff_invitations(workspace_id, created_at desc);
create table rev_workspace_team_private.requests (
  request_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  actor_id uuid not null references auth.users(id),
  fingerprint bytea not null,
  result jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.workspace_staff_profiles enable row level security;
alter table public.workspace_staff_invitations enable row level security;
revoke all on public.workspace_staff_profiles, public.workspace_staff_invitations from public, anon, authenticated;
revoke all on rev_workspace_team_private.requests from public, anon, authenticated;
grant select on public.workspace_staff_profiles to authenticated;
grant all on public.workspace_staff_profiles, public.workspace_staff_invitations to service_role;
create policy workspace_staff_profiles_read on public.workspace_staff_profiles for select to authenticated
using (public.is_active_workspace_member(workspace_id) and exists (select 1 from public.workspace_members m where m.workspace_id = workspace_staff_profiles.workspace_id and m.user_id = workspace_staff_profiles.user_id and m.status = 'active'));

create function public.list_rev_workspace_staff_names(target_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.is_active_workspace_member(target_workspace_id) then raise exception 'Team access unavailable' using errcode = '42501'; end if;
  if (select count(*) from public.workspace_staff_profiles p where p.workspace_id = target_workspace_id) > 5000 then raise exception 'Team directory unavailable'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('userId', p.user_id, 'displayName', p.display_name) order by p.user_id)
    from public.workspace_staff_profiles p join public.workspace_members m on m.workspace_id = p.workspace_id and m.user_id = p.user_id
    where p.workspace_id = target_workspace_id and m.status = 'active'), '[]'::jsonb);
end;
$$;

create function public.list_rev_workspace_team(target_workspace_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or not public.has_workspace_role(target_workspace_id, array['owner','admin']) then raise exception 'Team access unavailable' using errcode = '42501'; end if;
  if (select count(*) from public.workspace_members m where m.workspace_id = target_workspace_id) > 5000 then raise exception 'Team directory unavailable'; end if;
  return jsonb_build_object('workspaceId', target_workspace_id,
    'members', coalesce((select jsonb_agg(jsonb_build_object('userId', m.user_id, 'role', m.role, 'status', m.status, 'displayName', p.display_name, 'nameVersion', coalesce(p.version,0)) order by m.user_id)
      from public.workspace_members m left join public.workspace_staff_profiles p on p.workspace_id = m.workspace_id and p.user_id = m.user_id where m.workspace_id = target_workspace_id), '[]'::jsonb),
    'invitations', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'email', i.email, 'displayName', i.display_name, 'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end, 'expiresAt', i.expires_at, 'createdAt', i.created_at) order by i.created_at desc)
      from (select * from public.workspace_staff_invitations where workspace_id = target_workspace_id order by created_at desc, id limit 100) i), '[]'::jsonb));
end;
$$;

create function public.manage_rev_workspace_team(target_workspace_id uuid, target_operation text, target_request_id uuid, target_payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); actor_role text; target_role text; target_status text; target_user uuid;
  email_address text; name_value text; invite_id uuid; invitation public.workspace_staff_invitations%rowtype;
  name_version bigint; old_request rev_workspace_team_private.requests%rowtype; fingerprint_value bytea; result_value jsonb;
begin
  if actor is null or target_workspace_id is null or target_request_id is null or jsonb_typeof(target_payload) is distinct from 'object' or target_operation not in ('invite','revoke_invite','rename','suspend','restore') or target_operation is null then raise exception 'Valid team change required' using errcode = '22023'; end if;
  perform 1 from public.workspaces w where w.id = target_workspace_id and w.status = 'active' for update;
  if not found then raise exception 'Team access unavailable' using errcode = '42501'; end if;
  select m.role into actor_role from public.workspace_members m where m.workspace_id = target_workspace_id and m.user_id = actor and m.status = 'active';
  if actor_role is null or actor_role not in ('owner','admin') then raise exception 'Team access unavailable' using errcode = '42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text, 0));
  fingerprint_value := pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('operation', target_operation, 'payload', target_payload)::text, 'UTF8'));
  select * into old_request from rev_workspace_team_private.requests where request_id = target_request_id;
  if found then
    if old_request.actor_id <> actor or old_request.workspace_id <> target_workspace_id or old_request.fingerprint <> fingerprint_value then raise exception 'Request changed' using errcode = '40001'; end if;
    return old_request.result;
  end if;
  if target_operation = 'invite' then
    if (select count(*) from jsonb_object_keys(target_payload)) <> 2 or not (target_payload ?& array['email','displayName']) or jsonb_typeof(target_payload->'email') <> 'string' or jsonb_typeof(target_payload->'displayName') <> 'string' then raise exception 'Valid invitation required' using errcode = '22023'; end if;
    email_address := lower(btrim(target_payload->>'email')); name_value := btrim(target_payload->>'displayName');
    if char_length(email_address) not between 3 and 320 or email_address !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or char_length(name_value) not between 1 and 120 then raise exception 'Name and email required' using errcode = '22023'; end if;
    if exists (select 1 from public.workspace_staff_invitations i where i.workspace_id = target_workspace_id and i.email = email_address and i.status = 'pending' and i.expires_at > now()) then raise exception 'An invitation is already pending for this address' using errcode = '23505'; end if;
    if (select count(*) from public.workspace_staff_invitations i where i.workspace_id = target_workspace_id and i.created_at > now() - interval '1 day') >= 50 then raise exception 'Daily invitation limit reached' using errcode = '54000'; end if;
    insert into public.workspace_staff_invitations(workspace_id,email,display_name,created_by) values(target_workspace_id,email_address,name_value,actor) returning id into invite_id;
    result_value := jsonb_build_object('operation', target_operation, 'workspaceId', target_workspace_id, 'invitationId', invite_id);
  elsif target_operation = 'revoke_invite' then
    if (select count(*) from jsonb_object_keys(target_payload)) <> 1 or not (target_payload ? 'invitationId') then raise exception 'Valid invitation required' using errcode = '22023'; end if;
    invite_id := (target_payload->>'invitationId')::uuid;
    select * into invitation from public.workspace_staff_invitations i where i.id = invite_id and i.workspace_id = target_workspace_id for update;
    if not found or invitation.status = 'accepted' then raise exception 'Invitation unavailable' using errcode = '40001'; end if;
    update public.workspace_staff_invitations set status = 'revoked' where id = invite_id;
    result_value := jsonb_build_object('operation', target_operation, 'workspaceId', target_workspace_id, 'invitationId', invite_id);
  else
    if not (target_payload ? 'userId') or (select count(*) from jsonb_object_keys(target_payload)) <> (case when target_operation = 'rename' then 3 else 2 end) or (target_operation = 'rename' and not (target_payload ?& array['displayName','expectedVersion'])) or (target_operation <> 'rename' and not (target_payload ? 'expectedStatus')) then raise exception 'Valid team change required' using errcode = '22023'; end if;
    target_user := (target_payload->>'userId')::uuid;
    select m.role,m.status into target_role,target_status from public.workspace_members m where m.workspace_id = target_workspace_id and m.user_id = target_user for update;
    if not found then raise exception 'Team member unavailable' using errcode = '40001'; end if;
    if target_operation = 'rename' then
      if actor_role = 'admin' and target_user <> actor and target_role in ('owner','admin') then raise exception 'Owner approval required' using errcode = '42501'; end if;
      select p.version into name_version from public.workspace_staff_profiles p where p.workspace_id = target_workspace_id and p.user_id = target_user;
      if (target_payload->>'expectedVersion')::bigint is distinct from coalesce(name_version,0) then raise exception 'Name changed; reload team' using errcode = '40001'; end if;
      name_value := btrim(target_payload->>'displayName');
      if jsonb_typeof(target_payload->'displayName') <> 'string' or char_length(name_value) not between 1 and 120 then raise exception 'Display name required' using errcode = '22023'; end if;
      insert into public.workspace_staff_profiles(workspace_id,user_id,display_name) values(target_workspace_id,target_user,name_value)
        on conflict(workspace_id,user_id) do update set display_name = excluded.display_name, updated_at = now(), version = public.workspace_staff_profiles.version + 1;
    else
      if target_user = actor or target_role not in ('member','viewer') then raise exception 'Protected team member' using errcode = '42501'; end if;
      if target_status is distinct from (target_payload->>'expectedStatus') or target_status not in ('active','suspended') then raise exception 'Team member unavailable' using errcode = '40001'; end if;
      update public.workspace_members set status = case when target_operation = 'suspend' then 'suspended' else 'active' end where workspace_id = target_workspace_id and user_id = target_user;
    end if;
    result_value := jsonb_build_object('operation', target_operation, 'workspaceId', target_workspace_id, 'userId', target_user);
  end if;
  insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
    values(target_workspace_id,actor,'user','workspace.team.' || target_operation,'workspace',target_workspace_id,jsonb_build_object('requestId',target_request_id,'targetUserId',target_user,'invitationId',invite_id));
  insert into rev_workspace_team_private.requests(request_id,workspace_id,actor_id,fingerprint,result) values(target_request_id,target_workspace_id,actor,fingerprint_value,result_value);
  return result_value;
end;
$$;

create function public.accept_rev_workspace_invitation(target_invitation_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); actor_email text; scope uuid; invitation public.workspace_staff_invitations%rowtype; existing_status text; existing_role text;
begin
  if actor is null or target_invitation_id is null then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  select lower(btrim(u.email)) into actor_email from auth.users u where u.id = actor and u.email_confirmed_at is not null;
  if actor_email is null then raise exception 'Confirm your email before accepting this invitation' using errcode = '42501'; end if;
  select i.workspace_id into scope from public.workspace_staff_invitations i where i.id = target_invitation_id and i.email = actor_email;
  if scope is null then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  perform 1 from public.workspaces w where w.id = scope and w.status = 'active' for update;
  if not found then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  select * into invitation from public.workspace_staff_invitations i where i.id = target_invitation_id for update;
  select m.status,m.role into existing_status,existing_role from public.workspace_members m where m.workspace_id = scope and m.user_id = actor;
  if invitation.status = 'accepted' and invitation.accepted_by = actor and existing_status = 'active' then return jsonb_build_object('workspaceId',scope,'role',existing_role,'accepted',true); end if;
  if invitation.status <> 'pending' or invitation.expires_at <= now() or not exists(select 1 from public.workspace_members m where m.workspace_id = scope and m.user_id = invitation.created_by and m.status = 'active' and m.role in ('owner','admin')) or (existing_status is not null and existing_status <> 'active') then raise exception 'Invitation unavailable' using errcode = '42501'; end if;
  insert into public.workspace_members(workspace_id,user_id,role,status) values(scope,actor,'member','active') on conflict(workspace_id,user_id) do nothing;
  insert into public.workspace_staff_profiles(workspace_id,user_id,display_name) values(scope,actor,invitation.display_name) on conflict(workspace_id,user_id) do nothing;
  update public.workspace_staff_invitations set status='accepted',accepted_by=actor,accepted_at=now() where id=target_invitation_id;
  insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata) values(scope,actor,'user','workspace.team.invitation_accepted','workspace',scope,jsonb_build_object('invitationId',target_invitation_id));
  return jsonb_build_object('workspaceId',scope,'role',coalesce(existing_role,'member'),'accepted',true);
end;
$$;
revoke all on function public.list_rev_workspace_staff_names(uuid), public.list_rev_workspace_team(uuid), public.manage_rev_workspace_team(uuid,text,uuid,jsonb), public.accept_rev_workspace_invitation(uuid) from public, anon;
grant execute on function public.list_rev_workspace_staff_names(uuid), public.list_rev_workspace_team(uuid), public.manage_rev_workspace_team(uuid,text,uuid,jsonb), public.accept_rev_workspace_invitation(uuid) to authenticated;
commit;
