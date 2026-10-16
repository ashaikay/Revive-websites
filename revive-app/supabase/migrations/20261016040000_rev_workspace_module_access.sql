-- Additive module entitlements. Roles and programme/caseload authority remain separate.
begin;
create table public.workspace_module_access (
 workspace_id uuid not null, user_id uuid not null,
 modules text[] not null check (modules <@ array['programme','scheduling','rev','customers','growth','business']::text[] and array_position(modules,null) is null),
 version bigint not null default 1 check(version>0), updated_at timestamptz not null default now(),
 primary key(workspace_id,user_id), foreign key(workspace_id,user_id) references public.workspace_members(workspace_id,user_id) on delete cascade
);
alter table public.workspace_module_access enable row level security;
revoke all on public.workspace_module_access from public, anon, authenticated;
grant all on public.workspace_module_access to service_role;
create function public.has_rev_module_access(target_workspace_id uuid, target_user_id uuid, target_module text)
returns boolean language sql stable security definer set search_path='' as $$
 select target_module = any(array['programme','scheduling','rev','customers','growth','business']) and exists(
 select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id
 left join public.workspace_module_access a on a.workspace_id=m.workspace_id and a.user_id=m.user_id
 where m.workspace_id=target_workspace_id and m.user_id=target_user_id and m.status='active' and w.status='active'
 and (m.role in ('owner','admin') or a.user_id is null or target_module=any(a.modules)));
$$;
-- The browser may ask only about itself. Explicit-actor helper is service-only;
-- RLS uses the self helper and trusted writes pass their server-bound actor.
revoke all on function public.has_rev_module_access(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.has_rev_module_access(uuid,uuid,text) to service_role;
create function public.can_use_rev_module(target_workspace_id uuid,target_module text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.has_rev_module_access(target_workspace_id,auth.uid(),target_module);
$$;
revoke all on function public.can_use_rev_module(uuid,text) from public, anon;
grant execute on function public.can_use_rev_module(uuid,text) to authenticated;
create function public.get_rev_workspace_module_access(target_workspace_id uuid, target_user_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); subject uuid:=coalesce(target_user_id,auth.uid()); row_value public.workspace_module_access; member_role text; member_status text;
begin
 if not exists(select 1 from public.workspace_members m join public.workspaces w on w.id=m.workspace_id where m.workspace_id=target_workspace_id and m.user_id=actor and m.status='active' and w.status='active') or (subject<>actor and not public.has_workspace_role(target_workspace_id,array['owner','admin'])) then raise exception 'Access unavailable' using errcode='42501'; end if;
 select role,status into member_role,member_status from public.workspace_members where workspace_id=target_workspace_id and user_id=subject;
 if not found then raise exception 'Member unavailable' using errcode='42501'; end if;
 select * into row_value from public.workspace_module_access where workspace_id=target_workspace_id and user_id=subject;
 return jsonb_build_object('workspaceId',target_workspace_id,'userId',subject,'modules',case when member_role in ('owner','admin') or row_value.user_id is null then array['programme','scheduling','rev','customers','growth','business'] else row_value.modules end,'version',coalesce(row_value.version,0),'managed',member_role in ('owner','admin'));
end;
$$;
create function public.save_rev_workspace_module_access(target_workspace_id uuid,target_user_id uuid,target_modules text[],expected_version bigint,target_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); old_version bigint; target_role text; result_value jsonb; fingerprint_value bytea; prior rev_workspace_team_private.requests;
begin
 perform 1 from public.workspaces where id=target_workspace_id and status='active' for update;
 if not found or not public.has_workspace_role(target_workspace_id,array['owner','admin']) then raise exception 'Manager required' using errcode='42501'; end if;
 if target_request_id is null or target_user_id is null or target_modules is null or expected_version is null or expected_version<0 or not(target_modules <@ array['programme','scheduling','rev','customers','growth','business']::text[]) or array_position(target_modules,null) is not null or cardinality(target_modules)<> (select count(distinct value) from unnest(target_modules) value) then raise exception 'Valid module selection required' using errcode='22023'; end if;
 select role into target_role from public.workspace_members where workspace_id=target_workspace_id and user_id=target_user_id and status in ('active','suspended') for update;
 if not found or target_role not in ('member','viewer') or target_user_id=actor then raise exception 'Protected member' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 fingerprint_value:=pg_catalog.sha256(pg_catalog.convert_to(jsonb_build_object('operation','module_access','userId',target_user_id,'modules',target_modules,'expectedVersion',expected_version)::text,'UTF8'));
 select * into prior from rev_workspace_team_private.requests where request_id=target_request_id;
 if found then
  if prior.workspace_id<>target_workspace_id or prior.actor_id<>actor or prior.fingerprint<>fingerprint_value then raise exception 'Request changed' using errcode='40001'; end if;
  return prior.result;
 end if;
 select version into old_version from public.workspace_module_access where workspace_id=target_workspace_id and user_id=target_user_id;
 if coalesce(old_version,0)<>expected_version then raise exception 'Access changed; reload' using errcode='40001'; end if;
 insert into public.workspace_module_access(workspace_id,user_id,modules) values(target_workspace_id,target_user_id,target_modules)
 on conflict(workspace_id,user_id) do update set modules=excluded.modules,version=public.workspace_module_access.version+1,updated_at=now()
 returning jsonb_build_object('workspaceId',workspace_id,'userId',user_id,'modules',modules,'version',version,'managed',false) into result_value;
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata) values(target_workspace_id,actor,'user','workspace.team.module_access','workspace',target_workspace_id,jsonb_build_object('requestId',target_request_id,'targetUserId',target_user_id,'modules',target_modules));
 insert into rev_workspace_team_private.requests(request_id,workspace_id,actor_id,fingerprint,result) values(target_request_id,target_workspace_id,actor,fingerprint_value,result_value);
 return result_value;
end;
$$;
revoke all on function public.get_rev_workspace_module_access(uuid,uuid), public.save_rev_workspace_module_access(uuid,uuid,text[],bigint,uuid) from public,anon;
grant execute on function public.get_rev_workspace_module_access(uuid,uuid), public.save_rev_workspace_module_access(uuid,uuid,text[],bigint,uuid) to authenticated;

create policy rev_module_access_guard on public.business_profiles as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'business') or public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'growth')) with check (public.can_use_rev_module(workspace_id,'business') or public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'growth'));

create policy rev_module_access_guard on public.business_services as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'business') or public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'growth')) with check (public.can_use_rev_module(workspace_id,'business') or public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'growth'));

create policy rev_module_access_guard on public.goals as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'growth') or public.can_use_rev_module(workspace_id,'business')) with check (public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'growth') or public.can_use_rev_module(workspace_id,'business'));

create policy rev_module_access_guard on public.contacts as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'customers') or public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'growth')) with check (public.can_use_rev_module(workspace_id,'customers') or public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'growth'));

create policy rev_module_access_guard on public.rev_actions as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.approvals as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.business_memory_events as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'business') or public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'business') or public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.audit_log as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'business') or public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'business') or public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.opportunities as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'growth') or public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'growth') or public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.contact_suppressions as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'growth') or public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'growth') or public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.workspace_execution_policies as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.rev_action_executions as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.provider_usage_events as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.rev_email_threads as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.rev_email_messages as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.workspace_email_mailboxes as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.meeting_proposals as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.rev_meeting_calendar_bindings as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.rev_meeting_provider_gate as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.workspace_calendar_connections as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.workspace_calendars as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'rev') or public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.workspace_calendar_business_hours as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling') or public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'scheduling') or public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.workspace_bank_holidays as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.rev_meeting_execution_calendar_targets as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.meeting_outcomes as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.meeting_reminder_drafts as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'rev')) with check (public.can_use_rev_module(workspace_id,'rev'));

create policy rev_module_access_guard on public.scheduling_workers as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.scheduling_worker_patterns as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.scheduling_worker_unavailability as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.scheduling_jobs as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.scheduling_assignments as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.annual_leave_policies as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.annual_leave_accounts as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.annual_leave_adjustments as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.annual_leave_absences as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.annual_leave_calculation_segments as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.annual_leave_postings as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.annual_leave_calendars as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.annual_leave_worker_calendars as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.annual_leave_calendar_years as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.programme_hub_programmes as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_advisers as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_employers as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_employer_contacts as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_vacancies as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_participants as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_participant_advisers as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_contracts as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_participant_notes as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.scheduling_job_documents as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.scheduling_job_document_analyses as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.scheduling_job_requirement_reviews as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'scheduling')) with check (public.can_use_rev_module(workspace_id,'scheduling'));

create policy rev_module_access_guard on public.programme_hub_employer_discovery_searches as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_outreach_settings as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_employer_engagements as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_employer_engagement_events as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_employer_outreach_attempts as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_employer_outreach_drafts as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create policy rev_module_access_guard on public.programme_hub_participant_contacts as restrictive for all to authenticated using (public.can_use_rev_module(workspace_id,'programme')) with check (public.can_use_rev_module(workspace_id,'programme'));

create or replace function public.can_access_rev_programme(target_workspace_id uuid, target_programme_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
 select public.has_rev_module_access(target_workspace_id,auth.uid(),'programme') and (exists (
    select 1 from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = auth.uid()
      and member.status = 'active'
      and member.role in ('owner', 'admin')
  ) or exists (
    select 1
    from public.workspace_members member
    join public.programme_hub_advisers adviser
      on adviser.workspace_id = member.workspace_id
      and adviser.user_id = member.user_id
      and adviser.programme_id = target_programme_id
      and adviser.active
    where member.workspace_id = target_workspace_id
      and member.user_id = auth.uid()
      and member.status = 'active'
  ));
$$;

create or replace function public.can_access_rev_participant(target_workspace_id uuid, target_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
 select public.has_rev_module_access(target_workspace_id,auth.uid(),'programme') and (exists (
    select 1 from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = auth.uid()
      and member.status = 'active'
      and member.role in ('owner', 'admin')
  ) or exists (
    select 1
    from public.workspace_members member
    join public.programme_hub_participant_advisers assignment
      on assignment.workspace_id = member.workspace_id
      and assignment.adviser_user_id = member.user_id
      and assignment.participant_id = target_participant_id
      and assignment.active
    join public.programme_hub_advisers adviser
      on adviser.workspace_id = assignment.workspace_id
      and adviser.programme_id = assignment.programme_id
      and adviser.user_id = assignment.adviser_user_id
      and adviser.active
    where member.workspace_id = target_workspace_id
      and member.user_id = auth.uid()
      and member.status = 'active'
  ));
$$;

create or replace function public.save_rev_programme_hub_record(
  target_operation text,
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_programme_id uuid,
  target_record_id uuid,
  expected_version bigint,
  target_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior rev_programme_hub_private.write_requests;
  request_input jsonb;
  result jsonb;
  saved_id uuid;
  saved_programme_id uuid;
  saved_version bigint;
  current_version bigint;
  is_manager boolean;
  is_adviser boolean;
  participant_id uuid;
  target_user_id uuid;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  if target_operation not in ('programme', 'adviser', 'employer', 'contact', 'vacancy', 'participant', 'participant_adviser')
    or target_workspace_id is null or initiating_user_id is null or target_request_id is null
    or expected_version is null or expected_version < 0 or jsonb_typeof(target_payload) <> 'object'
    or (target_record_id is null and expected_version <> 0)
    or (target_record_id is not null and expected_version = 0)
  then
    raise exception 'Valid programme record required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text, 0));
  perform 1 from public.workspaces workspace where workspace.id = target_workspace_id for update;
  if not found then raise exception 'Workspace unavailable'; end if;

  select exists (
    select 1 from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = initiating_user_id
      and member.status = 'active'
      and member.role in ('owner', 'admin')
  ) into is_manager;

  request_input = pg_catalog.jsonb_build_object(
    'operation', target_operation,
    'programme_id', target_programme_id,
    'record_id', target_record_id,
    'expected_version', expected_version,
    'payload', target_payload
  );

  select request.* into prior
  from rev_programme_hub_private.write_requests request
  where request.request_id = target_request_id;
  if found then
    if prior.workspace_id <> target_workspace_id
      or prior.actor_user_id <> initiating_user_id
      or prior.operation <> target_operation
      or prior.input <> request_input
    then
      raise exception 'Programme request unavailable';
    end if;
    return prior.result;
  end if;

  if target_operation = 'programme' then
    if not is_manager or target_programme_id is not null then raise exception 'Programme manager required'; end if;
    if coalesce(length(target_payload->>'name'), 0) not between 1 and 160
      or target_payload->>'name' <> btrim(target_payload->>'name')
      or coalesce(length(target_payload->>'timezone'), 0) not between 1 and 100
      or target_payload->>'timezone' <> btrim(target_payload->>'timezone')
      or jsonb_typeof(target_payload->'active') <> 'boolean'
    then raise exception 'Valid programme details required'; end if;
    if target_record_id is null then
      insert into public.programme_hub_programmes (
        workspace_id, name, timezone, branding_name, sender_display_name, sender_reply_to,
        active, created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_payload->>'name', target_payload->>'timezone',
        nullif(target_payload->>'brandingName', ''), nullif(target_payload->>'senderDisplayName', ''),
        nullif(lower(target_payload->>'senderReplyTo'), ''), (target_payload->>'active')::boolean,
        initiating_user_id, initiating_user_id
      ) returning id, id, version into saved_id, saved_programme_id, saved_version;
    else
      select version into current_version from public.programme_hub_programmes
      where workspace_id = target_workspace_id and id = target_record_id for update;
      if not found or current_version <> expected_version then raise exception 'Programme unavailable or changed'; end if;
      update public.programme_hub_programmes set
        name = target_payload->>'name',
        timezone = target_payload->>'timezone',
        branding_name = nullif(target_payload->>'brandingName', ''),
        sender_display_name = nullif(target_payload->>'senderDisplayName', ''),
        sender_reply_to = nullif(lower(target_payload->>'senderReplyTo'), ''),
        active = (target_payload->>'active')::boolean,
        version = version + 1,
        updated_by_user_id = initiating_user_id,
        updated_at = now()
      where workspace_id = target_workspace_id and id = target_record_id
      returning id, id, version into saved_id, saved_programme_id, saved_version;
    end if;
  else
    if target_programme_id is null then raise exception 'Programme required'; end if;
    perform 1 from public.programme_hub_programmes programme
    where programme.workspace_id = target_workspace_id and programme.id = target_programme_id and programme.active
    for share;
    if not found then raise exception 'Programme unavailable'; end if;
    select exists (
      select 1 from public.workspace_members member
      join public.programme_hub_advisers adviser
        on adviser.workspace_id = member.workspace_id
        and adviser.programme_id = target_programme_id
        and adviser.user_id = member.user_id
        and adviser.active
      where member.workspace_id = target_workspace_id
        and member.user_id = initiating_user_id
        and member.status = 'active'
    ) into is_adviser;
  end if;

  if target_operation = 'adviser' then
    if not is_manager then raise exception 'Programme manager required'; end if;
    target_user_id = (target_payload->>'userId')::uuid;
    perform 1 from public.workspace_members member
    where member.workspace_id = target_workspace_id and member.user_id = target_user_id and member.status = 'active';
    if not found or jsonb_typeof(target_payload->'active') <> 'boolean' then raise exception 'Active workspace member required'; end if;
    if target_record_id is null then
      insert into public.programme_hub_advisers (
        workspace_id, programme_id, user_id, active, created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_programme_id, target_user_id,
        (target_payload->>'active')::boolean, initiating_user_id, initiating_user_id
      ) returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    else
      select version into current_version from public.programme_hub_advisers
      where workspace_id = target_workspace_id and id = target_record_id and programme_id = target_programme_id
        and user_id = target_user_id for update;
      if not found or current_version <> expected_version then raise exception 'Adviser unavailable or changed'; end if;
      update public.programme_hub_advisers set
        active = (target_payload->>'active')::boolean,
        version = version + 1, updated_by_user_id = initiating_user_id, updated_at = now()
      where workspace_id = target_workspace_id and id = target_record_id
      returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    end if;
  elsif target_operation = 'employer' then
    if not (is_manager or is_adviser) then raise exception 'Programme adviser required'; end if;
    if coalesce(length(target_payload->>'employerKey'), 0) not between 1 and 120
      or coalesce(length(target_payload->>'displayName'), 0) not between 1 and 200
      or jsonb_typeof(target_payload->'active') <> 'boolean'
    then raise exception 'Valid employer details required'; end if;
    if target_record_id is null then
      insert into public.programme_hub_employers (
        workspace_id, programme_id, employer_key, display_name, sector_key, primary_geography_key,
        active, created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_programme_id, target_payload->>'employerKey',
        target_payload->>'displayName', nullif(target_payload->>'sectorKey', ''),
        nullif(target_payload->>'primaryGeographyKey', ''), (target_payload->>'active')::boolean,
        initiating_user_id, initiating_user_id
      ) returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    else
      select version into current_version from public.programme_hub_employers
      where workspace_id = target_workspace_id and id = target_record_id and programme_id = target_programme_id for update;
      if not found or current_version <> expected_version then raise exception 'Employer unavailable or changed'; end if;
      update public.programme_hub_employers set
        employer_key = target_payload->>'employerKey', display_name = target_payload->>'displayName',
        sector_key = nullif(target_payload->>'sectorKey', ''),
        primary_geography_key = nullif(target_payload->>'primaryGeographyKey', ''),
        active = (target_payload->>'active')::boolean, version = version + 1,
        updated_by_user_id = initiating_user_id, updated_at = now()
      where workspace_id = target_workspace_id and id = target_record_id
      returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    end if;
  elsif target_operation = 'contact' then
    if not (is_manager or is_adviser) then raise exception 'Programme adviser required'; end if;
    if coalesce(length(target_payload->>'contactKey'), 0) not between 1 and 120
      or coalesce(length(target_payload->>'preferredName'), 0) not between 1 and 160
      or jsonb_typeof(target_payload->'suppressed') <> 'boolean'
      or jsonb_typeof(target_payload->'active') <> 'boolean'
    then raise exception 'Valid employer contact required'; end if;
    perform 1 from public.programme_hub_employers employer
    where employer.workspace_id = target_workspace_id and employer.programme_id = target_programme_id
      and employer.id = (target_payload->>'employerId')::uuid for share;
    if not found then raise exception 'Employer unavailable'; end if;
    if target_record_id is null then
      insert into public.programme_hub_employer_contacts (
        workspace_id, programme_id, employer_id, contact_key, preferred_name, role_title,
        business_email, business_phone, suppressed, suppression_reason_key, active, created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_programme_id, (target_payload->>'employerId')::uuid,
        target_payload->>'contactKey', target_payload->>'preferredName', nullif(target_payload->>'roleTitle', ''),
        nullif(lower(target_payload->>'businessEmail'), ''), nullif(target_payload->>'businessPhone', ''),
        (target_payload->>'suppressed')::boolean, nullif(target_payload->>'suppressionReasonKey', ''),
        (target_payload->>'active')::boolean,
        initiating_user_id, initiating_user_id
      ) returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    else
      select version into current_version from public.programme_hub_employer_contacts
      where workspace_id = target_workspace_id and id = target_record_id and programme_id = target_programme_id for update;
      if not found or current_version <> expected_version then raise exception 'Employer contact unavailable or changed'; end if;
      update public.programme_hub_employer_contacts set
        employer_id = (target_payload->>'employerId')::uuid, contact_key = target_payload->>'contactKey',
        preferred_name = target_payload->>'preferredName', role_title = nullif(target_payload->>'roleTitle', ''),
        business_email = nullif(lower(target_payload->>'businessEmail'), ''),
        business_phone = nullif(target_payload->>'businessPhone', ''),
        suppressed = (target_payload->>'suppressed')::boolean,
        suppression_reason_key = nullif(target_payload->>'suppressionReasonKey', ''),
        active = (target_payload->>'active')::boolean,
        version = version + 1, updated_by_user_id = initiating_user_id, updated_at = now()
      where workspace_id = target_workspace_id and id = target_record_id
      returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    end if;
  elsif target_operation = 'vacancy' then
    if not (is_manager or is_adviser) then raise exception 'Programme adviser required'; end if;
    if coalesce(length(target_payload->>'vacancyKey'), 0) not between 1 and 120
      or coalesce(length(target_payload->>'title'), 0) not between 1 and 200
      or not rev_programme_hub_private.valid_tags(array(select jsonb_array_elements_text(target_payload->'requiredSkillKeys')))
      or not rev_programme_hub_private.valid_tags(array(select jsonb_array_elements_text(target_payload->'desiredSkillKeys')))
      or jsonb_typeof(target_payload->'active') <> 'boolean'
    then raise exception 'Valid vacancy details required'; end if;
    perform 1 from public.programme_hub_employers employer
    where employer.workspace_id = target_workspace_id and employer.programme_id = target_programme_id
      and employer.id = (target_payload->>'employerId')::uuid for share;
    if not found then raise exception 'Employer unavailable'; end if;
    if nullif(target_payload->>'employerContactId', '') is not null then
      perform 1 from public.programme_hub_employer_contacts contact
      where contact.workspace_id = target_workspace_id and contact.programme_id = target_programme_id
        and contact.employer_id = (target_payload->>'employerId')::uuid
        and contact.id = (target_payload->>'employerContactId')::uuid for share;
      if not found then raise exception 'Employer contact unavailable'; end if;
    end if;
    if target_record_id is null then
      insert into public.programme_hub_vacancies (
        workspace_id, programme_id, employer_id, employer_contact_id, vacancy_key, title,
        work_geography_key, required_skill_keys, desired_skill_keys, active,
        created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_programme_id, (target_payload->>'employerId')::uuid,
        nullif(target_payload->>'employerContactId', '')::uuid, target_payload->>'vacancyKey',
        target_payload->>'title', nullif(target_payload->>'workGeographyKey', ''),
        array(select jsonb_array_elements_text(target_payload->'requiredSkillKeys')),
        array(select jsonb_array_elements_text(target_payload->'desiredSkillKeys')),
        (target_payload->>'active')::boolean, initiating_user_id, initiating_user_id
      ) returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    else
      select version into current_version from public.programme_hub_vacancies
      where workspace_id = target_workspace_id and id = target_record_id and programme_id = target_programme_id for update;
      if not found or current_version <> expected_version then raise exception 'Vacancy unavailable or changed'; end if;
      update public.programme_hub_vacancies set
        employer_id = (target_payload->>'employerId')::uuid,
        employer_contact_id = nullif(target_payload->>'employerContactId', '')::uuid,
        vacancy_key = target_payload->>'vacancyKey', title = target_payload->>'title',
        work_geography_key = nullif(target_payload->>'workGeographyKey', ''),
        required_skill_keys = array(select jsonb_array_elements_text(target_payload->'requiredSkillKeys')),
        desired_skill_keys = array(select jsonb_array_elements_text(target_payload->'desiredSkillKeys')),
        active = (target_payload->>'active')::boolean, version = version + 1,
        updated_by_user_id = initiating_user_id, updated_at = now()
      where workspace_id = target_workspace_id and id = target_record_id
      returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    end if;
  elsif target_operation = 'participant' then
    if target_record_id is null and not is_manager then raise exception 'Programme manager required'; end if;
    if target_record_id is not null and not is_manager then
      perform 1 from public.programme_hub_participant_advisers assignment
      where assignment.workspace_id = target_workspace_id and assignment.programme_id = target_programme_id
        and assignment.participant_id = target_record_id and assignment.adviser_user_id = initiating_user_id
        and assignment.active for share;
      if not found then raise exception 'Assigned adviser required'; end if;
    end if;
    if coalesce(length(target_payload->>'participantKey'), 0) not between 1 and 120
      or coalesce(length(target_payload->>'preferredName'), 0) not between 1 and 160
      or coalesce(length(target_payload->>'caseReference'), 0) not between 1 and 120
      or not rev_programme_hub_private.valid_tags(array(select jsonb_array_elements_text(target_payload->'desiredRoleKeys')))
      or not rev_programme_hub_private.valid_tags(array(select jsonb_array_elements_text(target_payload->'skillKeys')))
      or not rev_programme_hub_private.valid_tags(array(select jsonb_array_elements_text(target_payload->'vacancySearchGeographyKeys')))
      or jsonb_typeof(target_payload->'active') <> 'boolean'
    then raise exception 'Valid participant details required'; end if;
    if target_record_id is null then
      insert into public.programme_hub_participants (
        workspace_id, programme_id, participant_key, preferred_name, case_reference,
        desired_role_keys, skill_keys, vacancy_search_geography_keys, residency_evidence_reference,
        active, created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_programme_id, target_payload->>'participantKey',
        target_payload->>'preferredName', target_payload->>'caseReference',
        array(select jsonb_array_elements_text(target_payload->'desiredRoleKeys')),
        array(select jsonb_array_elements_text(target_payload->'skillKeys')),
        array(select jsonb_array_elements_text(target_payload->'vacancySearchGeographyKeys')),
        nullif(target_payload->>'residencyEvidenceReference', ''),
        (target_payload->>'active')::boolean, initiating_user_id, initiating_user_id
      ) returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    else
      select version into current_version from public.programme_hub_participants
      where workspace_id = target_workspace_id and id = target_record_id and programme_id = target_programme_id for update;
      if not found or current_version <> expected_version then raise exception 'Participant unavailable or changed'; end if;
      update public.programme_hub_participants set
        participant_key = target_payload->>'participantKey', preferred_name = target_payload->>'preferredName',
        case_reference = target_payload->>'caseReference',
        desired_role_keys = array(select jsonb_array_elements_text(target_payload->'desiredRoleKeys')),
        skill_keys = array(select jsonb_array_elements_text(target_payload->'skillKeys')),
        vacancy_search_geography_keys = array(select jsonb_array_elements_text(target_payload->'vacancySearchGeographyKeys')),
        residency_evidence_reference = nullif(target_payload->>'residencyEvidenceReference', ''),
        active = (target_payload->>'active')::boolean, version = version + 1,
        updated_by_user_id = initiating_user_id, updated_at = now()
      where workspace_id = target_workspace_id and id = target_record_id
      returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    end if;
  elsif target_operation = 'participant_adviser' then
    if not is_manager then raise exception 'Programme manager required'; end if;
    participant_id = (target_payload->>'participantId')::uuid;
    target_user_id = (target_payload->>'adviserUserId')::uuid;
    perform 1 from public.programme_hub_participants participant
    where participant.workspace_id = target_workspace_id and participant.programme_id = target_programme_id
      and participant.id = participant_id for share;
    if not found then raise exception 'Participant unavailable'; end if;
    perform 1 from public.programme_hub_advisers adviser
    join public.workspace_members member
      on member.workspace_id = adviser.workspace_id and member.user_id = adviser.user_id
    where adviser.workspace_id = target_workspace_id and adviser.programme_id = target_programme_id
      and adviser.user_id = target_user_id and adviser.active and member.status = 'active' for share;
    if not found or jsonb_typeof(target_payload->'active') <> 'boolean' then raise exception 'Active adviser required'; end if;
    if target_record_id is null then
      insert into public.programme_hub_participant_advisers (
        workspace_id, programme_id, participant_id, adviser_user_id, active,
        created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_programme_id, participant_id, target_user_id,
        (target_payload->>'active')::boolean, initiating_user_id, initiating_user_id
      ) returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    else
      select assignment.version into current_version from public.programme_hub_participant_advisers assignment
      where assignment.workspace_id = target_workspace_id and assignment.id = target_record_id
        and assignment.programme_id = target_programme_id
        and assignment.participant_id = participant_id and assignment.adviser_user_id = target_user_id for update;
      if not found or current_version <> expected_version then raise exception 'Caseload assignment unavailable or changed'; end if;
      update public.programme_hub_participant_advisers set
        active = (target_payload->>'active')::boolean, version = version + 1,
        updated_by_user_id = initiating_user_id, updated_at = now()
      where workspace_id = target_workspace_id and id = target_record_id
      returning id, programme_id, version into saved_id, saved_programme_id, saved_version;
    end if;
  end if;

  result = pg_catalog.jsonb_build_object(
    'operation', target_operation,
    'record_id', saved_id,
    'workspace_id', target_workspace_id,
    'programme_id', saved_programme_id,
    'version', saved_version
  );

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    target_workspace_id, initiating_user_id, 'user',
    'programme_hub.' || target_operation || case when target_record_id is null then '.created' else '.updated' end,
    'programme_hub_' || target_operation, saved_id,
    pg_catalog.jsonb_build_object(
      'request_id', target_request_id,
      'programme_id', saved_programme_id,
      'previous_version', expected_version,
      'version', saved_version
    )
  );

  insert into rev_programme_hub_private.write_requests (
    request_id, workspace_id, actor_user_id, operation, input, result
  ) values (
    target_request_id, target_workspace_id, initiating_user_id, target_operation, request_input, result
  );

  return result;
end;
$$;

create or replace function public.save_rev_programme_hub_participant_note(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_programme_id uuid,
  target_participant_id uuid,
  note_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior rev_programme_hub_private.write_requests;
  request_input jsonb;
  result jsonb;
  saved public.programme_hub_participant_notes;
  is_manager boolean;
  is_assigned_adviser boolean;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  if target_workspace_id is null or initiating_user_id is null or target_request_id is null
    or target_programme_id is null or target_participant_id is null
    or note_body is null or length(note_body) not between 1 and 2000 or note_body <> btrim(note_body)
  then
    raise exception 'Valid participant note required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text, 0));

  request_input = pg_catalog.jsonb_build_object(
    'programme_id', target_programme_id,
    'participant_id', target_participant_id,
    'body', note_body
  );

  select request.* into prior
  from rev_programme_hub_private.write_requests request
  where request.request_id = target_request_id;
  if found then
    if prior.workspace_id <> target_workspace_id
      or prior.actor_user_id <> initiating_user_id
      or prior.operation <> 'participant_note'
      or prior.input <> request_input
    then
      raise exception 'Programme request unavailable';
    end if;
    return prior.result;
  end if;

  perform 1
  from public.programme_hub_participants participant
  join public.programme_hub_programmes programme
    on programme.workspace_id = participant.workspace_id
    and programme.id = participant.programme_id
    and programme.active
  where participant.workspace_id = target_workspace_id
    and participant.programme_id = target_programme_id
    and participant.id = target_participant_id
    and participant.active
  for share of participant;
  if not found then raise exception 'Participant unavailable'; end if;

  select exists (
    select 1
    from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = initiating_user_id
      and member.status = 'active'
      and member.role in ('owner', 'admin')
  ) into is_manager;

  select exists (
    select 1
    from public.workspace_members member
    join public.programme_hub_advisers adviser
      on adviser.workspace_id = member.workspace_id
      and adviser.programme_id = target_programme_id
      and adviser.user_id = member.user_id
      and adviser.active
    join public.programme_hub_participant_advisers assignment
      on assignment.workspace_id = adviser.workspace_id
      and assignment.programme_id = adviser.programme_id
      and assignment.adviser_user_id = adviser.user_id
      and assignment.participant_id = target_participant_id
      and assignment.active
    where member.workspace_id = target_workspace_id
      and member.user_id = initiating_user_id
      and member.status = 'active'
  ) into is_assigned_adviser;

  if not (is_manager or is_assigned_adviser) then
    raise exception 'Participant note authority required';
  end if;

  insert into public.programme_hub_participant_notes (
    workspace_id, programme_id, participant_id, body, author_user_id
  ) values (
    target_workspace_id, target_programme_id, target_participant_id, note_body, initiating_user_id
  )
  returning * into saved;

  result = pg_catalog.jsonb_build_object(
    'operation', 'participant_note',
    'record_id', saved.id,
    'workspace_id', saved.workspace_id,
    'programme_id', saved.programme_id,
    'version', saved.version
  );

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    target_workspace_id, initiating_user_id, 'user',
    'programme_hub.participant_note.created', 'programme_hub_participant_note', saved.id,
    pg_catalog.jsonb_build_object(
      'request_id', target_request_id,
      'programme_id', target_programme_id,
      'participant_id', target_participant_id,
      'version', saved.version
    )
  );

  insert into rev_programme_hub_private.write_requests (
    request_id, workspace_id, actor_user_id, operation, input, result
  ) values (
    target_request_id, target_workspace_id, initiating_user_id, 'participant_note', request_input, result
  );

  return result;
end;
$$;

create or replace function public.claim_rev_programme_employer_discovery(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_programme_id uuid,
  target_filters jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare existing public.programme_hub_employer_discovery_searches;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  if target_workspace_id is null or initiating_user_id is null or target_request_id is null
    or target_programme_id is null or jsonb_typeof(target_filters) <> 'object'
  then raise exception 'Valid employer discovery required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text, 0));
  perform rev_programme_hub_private.assert_programme_adviser(target_workspace_id, target_programme_id, initiating_user_id);
  perform 1 from public.programme_hub_programmes programme
    where programme.workspace_id = target_workspace_id and programme.id = target_programme_id and programme.active for share;
  if not found then raise exception 'Programme unavailable'; end if;
  select * into existing from public.programme_hub_employer_discovery_searches search
    where search.id = target_request_id;
  if found then
    if existing.workspace_id <> target_workspace_id or existing.programme_id <> target_programme_id
      or existing.actor_user_id <> initiating_user_id or existing.filters <> target_filters
    then raise exception 'Discovery request unavailable'; end if;
    return pg_catalog.jsonb_build_object(
      'search_id', existing.id, 'status', existing.status, 'should_attempt', false,
      'results', existing.results, 'error_code', existing.error_code, 'retrieved_at', existing.retrieved_at
    );
  end if;
  insert into public.programme_hub_employer_discovery_searches (
    id, workspace_id, programme_id, actor_user_id, provider, filters, status
  ) values (
    target_request_id, target_workspace_id, target_programme_id, initiating_user_id,
    'companies_house', target_filters, 'claimed'
  );
  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    target_workspace_id, initiating_user_id, 'user', 'programme_hub.employer_discovery.claimed',
    'programme_hub_employer_discovery', target_request_id,
    pg_catalog.jsonb_build_object('programme_id', target_programme_id, 'provider', 'companies_house')
  );
  return pg_catalog.jsonb_build_object(
    'search_id', target_request_id, 'status', 'claimed', 'should_attempt', true,
    'results', null, 'error_code', null, 'retrieved_at', null
  );
end;
$$;

create or replace function public.complete_rev_programme_employer_discovery(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_results jsonb,
  target_retrieved_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare saved public.programme_hub_employer_discovery_searches;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  if jsonb_typeof(target_results) <> 'array' or jsonb_array_length(target_results) > 50 or target_retrieved_at is null
  then raise exception 'Valid discovery result required'; end if;
  update public.programme_hub_employer_discovery_searches search set
    status = 'succeeded', results = target_results, provider_call_count = 1,
    retrieved_at = target_retrieved_at, completed_at = now()
  where search.id = target_request_id and search.workspace_id = target_workspace_id
    and search.actor_user_id = initiating_user_id and search.status = 'claimed'
  returning * into saved;
  if not found then raise exception 'Discovery completion unavailable'; end if;
  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    target_workspace_id, initiating_user_id, 'user', 'programme_hub.employer_discovery.completed',
    'programme_hub_employer_discovery', target_request_id,
    pg_catalog.jsonb_build_object('programme_id', saved.programme_id, 'result_count', jsonb_array_length(target_results))
  );
  return pg_catalog.jsonb_build_object(
    'search_id', saved.id, 'status', saved.status, 'should_attempt', false,
    'results', saved.results, 'error_code', null, 'retrieved_at', saved.retrieved_at
  );
end;
$$;

create or replace function public.fail_rev_programme_employer_discovery(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare saved public.programme_hub_employer_discovery_searches;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  if target_error_code not in ('provider_authentication', 'provider_rate_limited', 'provider_unavailable', 'invalid_response')
  then raise exception 'Valid discovery failure required'; end if;
  update public.programme_hub_employer_discovery_searches search set
    status = 'failed', error_code = target_error_code, provider_call_count = 1, completed_at = now()
  where search.id = target_request_id and search.workspace_id = target_workspace_id
    and search.actor_user_id = initiating_user_id and search.status = 'claimed'
  returning * into saved;
  if not found then raise exception 'Discovery completion unavailable'; end if;
  return pg_catalog.jsonb_build_object(
    'search_id', saved.id, 'status', saved.status, 'should_attempt', false,
    'results', null, 'error_code', saved.error_code, 'retrieved_at', null
  );
end;
$$;

create or replace function public.save_rev_programme_employer_engagement(
  target_operation text,
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_programme_id uuid,
  target_record_id uuid,
  expected_version bigint,
  target_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior rev_programme_hub_private.write_requests;
  request_input jsonb;
  result jsonb;
  saved_id uuid;
  saved_version bigint;
  candidate jsonb;
  existing_employer public.programme_hub_employers;
  employer public.programme_hub_employers;
  engagement public.programme_hub_employer_engagements;
  current_draft public.programme_hub_employer_outreach_drafts;
  responsible_user_id uuid;
  duplicate_result boolean := false;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  if target_operation not in ('discovery_employer', 'outreach_settings', 'engagement', 'engagement_event', 'draft_revision')
    or target_workspace_id is null or initiating_user_id is null or target_request_id is null
    or target_programme_id is null or expected_version is null or expected_version < 0
    or jsonb_typeof(target_payload) <> 'object'
  then raise exception 'Valid employer engagement change required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text, 0));
  perform rev_programme_hub_private.assert_programme_adviser(
    target_workspace_id, target_programme_id, initiating_user_id, target_operation = 'outreach_settings'
  );
  request_input = pg_catalog.jsonb_build_object(
    'programme_id', target_programme_id, 'record_id', target_record_id,
    'expected_version', expected_version, 'payload', target_payload
  );
  select request.* into prior from rev_programme_hub_private.write_requests request
    where request.request_id = target_request_id;
  if found then
    if prior.workspace_id <> target_workspace_id or prior.actor_user_id <> initiating_user_id
      or prior.operation <> target_operation or prior.input <> request_input
    then raise exception 'Programme request unavailable'; end if;
    return prior.result;
  end if;

  if target_operation = 'discovery_employer' then
    if target_record_id is not null or expected_version <> 0 then raise exception 'New discovered employer required'; end if;
    select item into candidate
    from public.programme_hub_employer_discovery_searches search,
      lateral jsonb_array_elements(search.results) item
    where search.id = (target_payload->>'searchId')::uuid
      and search.workspace_id = target_workspace_id and search.programme_id = target_programme_id
      and search.status = 'succeeded' and item->>'sourceIdentity' = target_payload->>'sourceIdentity';
    if candidate is null then raise exception 'Discovery result unavailable'; end if;
    select * into existing_employer from public.programme_hub_employers value
      where value.workspace_id = target_workspace_id and value.programme_id = target_programme_id
        and value.source_provider = 'companies_house' and value.source_identity = candidate->>'sourceIdentity';
    if found then
      saved_id = existing_employer.id; saved_version = existing_employer.version; duplicate_result = true;
    else
      insert into public.programme_hub_employers (
        workspace_id, programme_id, employer_key, display_name, sector_key, primary_geography_key,
        source_provider, source_identity, source_url, source_retrieved_at, source_address, source_evidence,
        active, created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_programme_id, 'CH-' || (candidate->>'sourceIdentity'),
        candidate->>'name', nullif(candidate->>'sector', ''), nullif(candidate->>'location', ''),
        'companies_house', candidate->>'sourceIdentity', candidate->>'sourceUrl',
        (candidate->>'retrievedAt')::timestamptz, nullif(candidate->>'address', ''),
        candidate->'evidence', true, initiating_user_id, initiating_user_id
      ) returning id, version into saved_id, saved_version;
      insert into public.programme_hub_employer_engagements (
        workspace_id, programme_id, employer_id, stage, created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_programme_id, saved_id, 'to_review', initiating_user_id, initiating_user_id
      );
    end if;
  elsif target_operation = 'outreach_settings' then
    if coalesce(length(target_payload->>'offerSummary'), 0) not between 20 and 2000
      or target_payload->>'offerSummary' <> btrim(target_payload->>'offerSummary')
    then raise exception 'Programme offer summary required'; end if;
    if target_record_id is null then
      if expected_version <> 0 then raise exception 'New outreach settings required'; end if;
      insert into public.programme_hub_outreach_settings (
        workspace_id, programme_id, offer_summary, created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_programme_id, target_payload->>'offerSummary', initiating_user_id, initiating_user_id
      ) returning id, version into saved_id, saved_version;
    else
      update public.programme_hub_outreach_settings settings set
        offer_summary = target_payload->>'offerSummary', version = version + 1,
        updated_by_user_id = initiating_user_id, updated_at = now()
      where settings.workspace_id = target_workspace_id and settings.programme_id = target_programme_id
        and settings.id = target_record_id and settings.version = expected_version
      returning id, version into saved_id, saved_version;
      if not found then raise exception 'Outreach settings unavailable or changed'; end if;
    end if;
  elsif target_operation = 'engagement' then
    select * into employer from public.programme_hub_employers value
      where value.workspace_id = target_workspace_id and value.programme_id = target_programme_id
        and value.id = (target_payload->>'employerId')::uuid and value.active for share;
    if not found or target_payload->>'stage' not in ('to_review', 'ready_to_contact', 'contacted', 'conversation_underway', 'opportunity_identified', 'not_pursuing')
    then raise exception 'Employer engagement unavailable'; end if;
    responsible_user_id = nullif(target_payload->>'responsibleAdviserUserId', '')::uuid;
    if responsible_user_id is not null and not exists (
      select 1 from public.workspace_members member
      join public.programme_hub_advisers adviser on adviser.workspace_id = member.workspace_id
        and adviser.programme_id = target_programme_id and adviser.user_id = member.user_id and adviser.active
      where member.workspace_id = target_workspace_id and member.user_id = responsible_user_id and member.status = 'active'
    ) then raise exception 'Responsible Employment Specialist unavailable'; end if;
    select * into engagement from public.programme_hub_employer_engagements value
      where value.workspace_id = target_workspace_id and value.programme_id = target_programme_id
        and value.employer_id = employer.id for update;
    if target_record_id is null then
      if found or expected_version <> 0 then raise exception 'Employer engagement already exists'; end if;
      insert into public.programme_hub_employer_engagements (
        workspace_id, programme_id, employer_id, stage, responsible_adviser_user_id,
        next_action, follow_up_date, created_by_user_id, updated_by_user_id
      ) values (
        target_workspace_id, target_programme_id, employer.id, target_payload->>'stage',
        responsible_user_id, nullif(target_payload->>'nextAction', ''),
        nullif(target_payload->>'followUpDate', '')::date, initiating_user_id, initiating_user_id
      ) returning id, version into saved_id, saved_version;
    else
      if not found or engagement.id <> target_record_id or engagement.version <> expected_version
      then raise exception 'Employer engagement unavailable or changed'; end if;
      update public.programme_hub_employer_engagements value set
        stage = target_payload->>'stage', responsible_adviser_user_id = responsible_user_id,
        next_action = nullif(target_payload->>'nextAction', ''),
        follow_up_date = nullif(target_payload->>'followUpDate', '')::date,
        version = version + 1, updated_by_user_id = initiating_user_id, updated_at = now()
      where value.id = engagement.id
      returning id, version into saved_id, saved_version;
    end if;
    insert into public.programme_hub_employer_engagement_events (
      workspace_id, programme_id, employer_id, event_type, summary, actor_user_id
    ) values (
      target_workspace_id, target_programme_id, employer.id, 'stage_change',
      'Engagement stage set to ' || replace(target_payload->>'stage', '_', ' ') || '.', initiating_user_id
    );
  elsif target_operation = 'engagement_event' then
    if target_record_id is not null or expected_version <> 0
      or target_payload->>'eventType' not in ('manual_contact', 'note')
      or coalesce(length(target_payload->>'summary'), 0) not between 1 and 2000
    then raise exception 'Valid engagement history required'; end if;
    select * into employer from public.programme_hub_employers value
      where value.workspace_id = target_workspace_id and value.programme_id = target_programme_id
        and value.id = (target_payload->>'employerId')::uuid and value.active for share;
    if not found then raise exception 'Employer unavailable'; end if;
    insert into public.programme_hub_employer_engagement_events (
      workspace_id, programme_id, employer_id, employer_contact_id, event_type, channel, summary, actor_user_id
    ) values (
      target_workspace_id, target_programme_id, employer.id,
      nullif(target_payload->>'contactId', '')::uuid, target_payload->>'eventType',
      nullif(target_payload->>'channel', ''), target_payload->>'summary', initiating_user_id
    ) returning id, 1 into saved_id, saved_version;
  else
    select * into current_draft from public.programme_hub_employer_outreach_drafts value
      where value.workspace_id = target_workspace_id and value.programme_id = target_programme_id
        and value.id = target_record_id and value.current for update;
    if not found or current_draft.revision <> expected_version
      or coalesce(length(target_payload->>'subject'), 0) not between 1 and 200
      or coalesce(length(target_payload->>'body'), 0) not between 20 and 5000
    then raise exception 'Outreach draft unavailable or changed'; end if;
    update public.programme_hub_employer_outreach_drafts set current = false where id = current_draft.id;
    insert into public.programme_hub_employer_outreach_drafts (
      id, workspace_id, programme_id, employer_id, employer_contact_id, root_draft_id,
      revision, subject, body, evidence_snapshot, programme_snapshot, created_by_user_id
    ) values (
      gen_random_uuid(), target_workspace_id, target_programme_id, current_draft.employer_id,
      current_draft.employer_contact_id, current_draft.root_draft_id, current_draft.revision + 1,
      target_payload->>'subject', target_payload->>'body', current_draft.evidence_snapshot,
      current_draft.programme_snapshot, initiating_user_id
    ) returning id, revision into saved_id, saved_version;
    insert into public.programme_hub_employer_engagement_events (
      workspace_id, programme_id, employer_id, employer_contact_id, event_type, summary, origin, actor_user_id
    ) values (
      target_workspace_id, target_programme_id, current_draft.employer_id, current_draft.employer_contact_id,
      'draft_revised', 'Employer outreach draft revised. Prepared — not sent.',
      'rev_prepared_not_sent', initiating_user_id
    );
  end if;

  result = pg_catalog.jsonb_build_object(
    'operation', target_operation, 'record_id', saved_id, 'workspace_id', target_workspace_id,
    'programme_id', target_programme_id, 'version', saved_version, 'duplicate', duplicate_result
  );
  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    target_workspace_id, initiating_user_id, 'user', 'programme_hub.' || target_operation,
    'programme_hub_employer_engagement', saved_id,
    pg_catalog.jsonb_build_object('request_id', target_request_id, 'programme_id', target_programme_id, 'version', saved_version)
  );
  insert into rev_programme_hub_private.write_requests (
    request_id, workspace_id, actor_user_id, operation, input, result
  ) values (
    target_request_id, target_workspace_id, initiating_user_id, target_operation, request_input, result
  );
  return result;
end;
$$;

create or replace function public.claim_rev_programme_employer_outreach_draft(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_programme_id uuid,
  target_employer_id uuid,
  target_contact_id uuid,
  expected_employer_version bigint,
  expected_settings_version bigint,
  expected_contact_version bigint,
  daily_limit integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  prior public.programme_hub_employer_outreach_attempts;
  employer public.programme_hub_employers;
  programme public.programme_hub_programmes;
  settings public.programme_hub_outreach_settings;
  contact public.programme_hub_employer_contacts;
  input_value jsonb;
  saved_draft public.programme_hub_employer_outreach_drafts;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  if daily_limit not between 1 and 50 then raise exception 'Valid outreach limit required'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text, 0));
  perform rev_programme_hub_private.assert_programme_adviser(target_workspace_id, target_programme_id, initiating_user_id);
  input_value = pg_catalog.jsonb_build_object(
    'employer_id', target_employer_id, 'contact_id', target_contact_id,
    'employer_version', expected_employer_version, 'settings_version', expected_settings_version,
    'contact_version', expected_contact_version
  );
  select * into prior from public.programme_hub_employer_outreach_attempts attempt where attempt.id = target_request_id;
  if found then
    if prior.workspace_id <> target_workspace_id or prior.programme_id <> target_programme_id
      or prior.actor_user_id <> initiating_user_id or prior.input <> input_value
    then raise exception 'Outreach request unavailable'; end if;
    if prior.draft_id is not null then
      select * into saved_draft from public.programme_hub_employer_outreach_drafts where id = prior.draft_id;
    end if;
    return pg_catalog.jsonb_build_object(
      'attempt_id', prior.id, 'status', prior.status, 'should_attempt', false,
      'error_code', prior.error_code, 'draft', case when saved_draft.id is null then null else
        pg_catalog.jsonb_build_object('draftId', saved_draft.id, 'rootDraftId', saved_draft.root_draft_id,
          'revision', saved_draft.revision, 'subject', saved_draft.subject, 'body', saved_draft.body,
          'status', saved_draft.status, 'createdAt', saved_draft.created_at) end
    );
  end if;
  if (
    select count(*) from public.programme_hub_employer_outreach_attempts attempt
    where attempt.workspace_id = target_workspace_id and attempt.created_at >= date_trunc('day', now())
  ) >= daily_limit then raise exception 'Daily outreach draft limit reached'; end if;
  select * into programme from public.programme_hub_programmes value
    where value.workspace_id = target_workspace_id and value.id = target_programme_id and value.active for share;
  select * into employer from public.programme_hub_employers value
    where value.workspace_id = target_workspace_id and value.programme_id = target_programme_id
      and value.id = target_employer_id and value.active for share;
  select * into settings from public.programme_hub_outreach_settings value
    where value.workspace_id = target_workspace_id and value.programme_id = target_programme_id for share;
  if programme.id is null or employer.id is null or settings.id is null
    or programme.branding_name is null or programme.sender_display_name is null or programme.sender_reply_to is null
    or employer.version <> expected_employer_version or settings.version <> expected_settings_version
    or employer.source_evidence is null
  then raise exception 'Outreach evidence or programme offer unavailable or changed'; end if;
  if target_contact_id is not null then
    select * into contact from public.programme_hub_employer_contacts value
      where value.workspace_id = target_workspace_id and value.programme_id = target_programme_id
        and value.employer_id = target_employer_id and value.id = target_contact_id and value.active for share;
    if contact.id is null or contact.version <> expected_contact_version or contact.suppressed
    then raise exception 'Employer contact unavailable or suppressed'; end if;
  elsif expected_contact_version is not null then
    raise exception 'Employer contact unavailable or changed';
  end if;
  insert into public.programme_hub_employer_outreach_attempts (
    id, workspace_id, programme_id, employer_id, employer_contact_id, actor_user_id,
    employer_version, settings_version, contact_version, input, status
  ) values (
    target_request_id, target_workspace_id, target_programme_id, target_employer_id, target_contact_id,
    initiating_user_id, expected_employer_version, expected_settings_version, expected_contact_version,
    input_value, 'claimed'
  );
  return pg_catalog.jsonb_build_object(
    'attempt_id', target_request_id, 'status', 'claimed', 'should_attempt', true,
    'error_code', null, 'draft', null,
    'source', pg_catalog.jsonb_build_object(
      'programmeName', programme.name, 'brandingName', programme.branding_name,
      'senderDisplayName', programme.sender_display_name, 'senderReplyTo', programme.sender_reply_to,
      'offerSummary', settings.offer_summary, 'employerName', employer.display_name,
      'sector', employer.sector_key, 'location', employer.primary_geography_key,
      'sourceUrl', employer.source_url, 'evidence', employer.source_evidence,
      'contactName', contact.preferred_name, 'contactRole', contact.role_title
    )
  );
end;
$$;

create or replace function public.complete_rev_programme_employer_outreach_draft(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_subject text,
  target_body text,
  target_model text,
  target_provider_response_id text,
  target_input_tokens integer,
  target_output_tokens integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare attempt public.programme_hub_employer_outreach_attempts;
declare employer public.programme_hub_employers;
declare settings public.programme_hub_outreach_settings;
declare contact public.programme_hub_employer_contacts;
declare saved public.programme_hub_employer_outreach_drafts;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  if coalesce(length(target_subject), 0) not between 1 and 200
    or coalesce(length(target_body), 0) not between 20 and 5000
    or coalesce(length(target_model), 0) not between 1 and 100
    or coalesce(length(target_provider_response_id), 0) not between 1 and 200
    or target_input_tokens < 0 or target_output_tokens < 0
  then raise exception 'Valid outreach draft required'; end if;
  select * into attempt from public.programme_hub_employer_outreach_attempts value
    where value.id = target_request_id and value.workspace_id = target_workspace_id
      and value.actor_user_id = initiating_user_id and value.status = 'claimed' for update;
  if not found then raise exception 'Outreach completion unavailable'; end if;
  select * into employer from public.programme_hub_employers value where value.id = attempt.employer_id for share;
  select * into settings from public.programme_hub_outreach_settings value
    where value.workspace_id = attempt.workspace_id and value.programme_id = attempt.programme_id for share;
  if attempt.employer_contact_id is not null then
    select * into contact from public.programme_hub_employer_contacts value where value.id = attempt.employer_contact_id for share;
  end if;
  if employer.version <> attempt.employer_version or settings.version <> attempt.settings_version
    or (attempt.employer_contact_id is not null and (contact.version <> attempt.contact_version or contact.suppressed))
  then
    update public.programme_hub_employer_outreach_attempts set
      status = 'failed', error_code = 'stale_evidence', provider_call_count = 1,
      provider_response_id = target_provider_response_id, input_tokens = target_input_tokens,
      output_tokens = target_output_tokens, completed_at = now()
    where id = attempt.id;
    return pg_catalog.jsonb_build_object(
      'attempt_id', attempt.id, 'status', 'failed', 'should_attempt', false,
      'error_code', 'stale_evidence', 'draft', null
    );
  end if;
  insert into public.programme_hub_employer_outreach_drafts (
    id, workspace_id, programme_id, employer_id, employer_contact_id, root_draft_id,
    revision, subject, body, evidence_snapshot, programme_snapshot, provider, model,
    source_attempt_id, created_by_user_id
  ) values (
    target_request_id, attempt.workspace_id, attempt.programme_id, attempt.employer_id,
    attempt.employer_contact_id, target_request_id, 1, target_subject, target_body,
    employer.source_evidence,
    pg_catalog.jsonb_build_object('settingsVersion', settings.version, 'offerSummary', settings.offer_summary),
    'openai', target_model, attempt.id, initiating_user_id
  ) returning * into saved;
  update public.programme_hub_employer_outreach_attempts set
    status = 'succeeded', provider_call_count = 1, provider_response_id = target_provider_response_id,
    input_tokens = target_input_tokens, output_tokens = target_output_tokens,
    draft_id = saved.id, completed_at = now()
  where id = attempt.id;
  insert into public.programme_hub_employer_engagement_events (
    workspace_id, programme_id, employer_id, employer_contact_id, event_type, summary, origin, actor_user_id
  ) values (
    attempt.workspace_id, attempt.programme_id, attempt.employer_id, attempt.employer_contact_id,
    'draft_prepared', 'Employer outreach draft prepared. Prepared — not sent.',
    'rev_prepared_not_sent', initiating_user_id
  );
  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    attempt.workspace_id, initiating_user_id, 'user', 'programme_hub.employer_outreach.prepared',
    'programme_hub_employer_outreach_draft', saved.id,
    pg_catalog.jsonb_build_object('request_id', attempt.id, 'model', target_model,
      'input_tokens', target_input_tokens, 'output_tokens', target_output_tokens)
  );
  return pg_catalog.jsonb_build_object(
    'attempt_id', attempt.id, 'status', 'succeeded', 'should_attempt', false, 'error_code', null,
    'draft', pg_catalog.jsonb_build_object('draftId', saved.id, 'rootDraftId', saved.root_draft_id,
      'revision', saved.revision, 'subject', saved.subject, 'body', saved.body,
      'status', saved.status, 'createdAt', saved.created_at)
  );
end;
$$;

create or replace function public.fail_rev_programme_employer_outreach_draft(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_error_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare saved public.programme_hub_employer_outreach_attempts;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  if target_error_code not in ('provider_refused', 'provider_unavailable', 'invalid_response')
  then raise exception 'Valid outreach failure required'; end if;
  update public.programme_hub_employer_outreach_attempts attempt set
    status = 'failed', error_code = target_error_code, provider_call_count = 1, completed_at = now()
  where attempt.id = target_request_id and attempt.workspace_id = target_workspace_id
    and attempt.actor_user_id = initiating_user_id and attempt.status = 'claimed'
  returning * into saved;
  if not found then raise exception 'Outreach completion unavailable'; end if;
  return pg_catalog.jsonb_build_object(
    'attempt_id', saved.id, 'status', saved.status, 'should_attempt', false,
    'error_code', saved.error_code, 'draft', null
  );
end;
$$;

create or replace function public.save_rev_programme_hub_participant_contact(
  target_workspace_id uuid, initiating_user_id uuid, target_request_id uuid,
  target_programme_id uuid, target_record_id uuid, expected_version bigint, target_payload jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  prior rev_programme_hub_private.write_requests;
  request_input jsonb;
  result jsonb;
  contact_participant_id uuid;
  actor_role text;
  saved public.programme_hub_participant_contacts;
  field_name text;
  max_length integer;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  if target_workspace_id is null or initiating_user_id is null or target_request_id is null
    or target_programme_id is null or expected_version is null or expected_version < 0
    or expected_version >= 9007199254740991
    or (target_record_id is null and expected_version <> 0)
    or (target_record_id is not null and expected_version = 0)
    or target_payload is null or jsonb_typeof(target_payload) <> 'object'
  then raise exception 'Valid contact details required' using errcode = '22023'; end if;
  if (select array_agg(key order by key) from jsonb_object_keys(target_payload) as keys(key))
    is distinct from array['addressLine1','addressLine2','email','participantId','phone','postcode','town']::text[]
  then raise exception 'Valid contact details required' using errcode = '22023'; end if;
  foreach field_name in array array['phone','email','addressLine1','addressLine2','town','postcode'] loop
    max_length = case field_name when 'phone' then 40 when 'email' then 320 when 'town' then 120 when 'postcode' then 8 else 200 end;
    if jsonb_typeof(target_payload->field_name) is distinct from 'string'
      or length(target_payload->>field_name) > max_length
      or target_payload->>field_name <> btrim(target_payload->>field_name)
      or target_payload->>field_name ~ '[[:cntrl:]]'
    then raise exception 'Valid contact details required' using errcode = '22023'; end if;
  end loop;
  if jsonb_typeof(target_payload->'participantId') is distinct from 'string'
  then raise exception 'Participant unavailable' using errcode = '22023'; end if;
  contact_participant_id = (target_payload->>'participantId')::uuid;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text, 0));

  -- Recheck authority even for an exact replay; suspension cannot recover a prior response.
  select member.role into actor_role from public.workspace_members member
    where member.workspace_id = target_workspace_id and member.user_id = initiating_user_id and member.status = 'active'
    for share;
  if not found or actor_role not in ('owner','admin','member') then raise exception 'Programme contact authority required' using errcode = '42501'; end if;
  perform 1 from public.programme_hub_participants participant
    join public.programme_hub_programmes programme on programme.workspace_id = participant.workspace_id and programme.id = participant.programme_id and programme.active
    where participant.workspace_id = target_workspace_id and participant.programme_id = target_programme_id and participant.id = contact_participant_id and participant.active
    for share of participant, programme;
  if not found then raise exception 'Participant unavailable'; end if;
  if actor_role not in ('owner','admin') then
    perform 1 from public.programme_hub_advisers adviser
      join public.programme_hub_participant_advisers assignment
        on assignment.workspace_id = adviser.workspace_id and assignment.programme_id = adviser.programme_id
        and assignment.adviser_user_id = adviser.user_id and assignment.active and assignment.participant_id = contact_participant_id
      where adviser.workspace_id = target_workspace_id and adviser.programme_id = target_programme_id and adviser.user_id = initiating_user_id and adviser.active
      for share of adviser, assignment;
    if not found then raise exception 'Programme contact authority required' using errcode = '42501'; end if;
  end if;

  request_input = pg_catalog.jsonb_build_object('programme_id',target_programme_id,'record_id',target_record_id,'expected_version',expected_version,'payload',target_payload);
  select request.* into prior from rev_programme_hub_private.write_requests request where request.request_id = target_request_id;
  if found then
    if prior.workspace_id <> target_workspace_id or prior.actor_user_id <> initiating_user_id or prior.operation <> 'participant_contact'
      or prior.input is distinct from request_input then raise exception 'Programme request unavailable'; end if;
    return prior.result;
  end if;

  if target_record_id is null then
    insert into public.programme_hub_participant_contacts(workspace_id,programme_id,participant_id,phone,email,address_line_1,address_line_2,town,postcode,created_by_user_id,updated_by_user_id)
    values(target_workspace_id,target_programme_id,contact_participant_id,nullif(target_payload->>'phone',''),nullif(target_payload->>'email',''),nullif(target_payload->>'addressLine1',''),nullif(target_payload->>'addressLine2',''),nullif(target_payload->>'town',''),nullif(target_payload->>'postcode',''),initiating_user_id,initiating_user_id)
    returning * into saved;
  else
    select contact.* into saved from public.programme_hub_participant_contacts contact
      where contact.workspace_id = target_workspace_id and contact.programme_id = target_programme_id and contact.participant_id = contact_participant_id and contact.id = target_record_id for update;
    if not found or saved.version <> expected_version then raise exception 'Participant contact unavailable or changed'; end if;
    update public.programme_hub_participant_contacts contact set
      phone = nullif(target_payload->>'phone',''), email = nullif(target_payload->>'email',''),
      address_line_1 = nullif(target_payload->>'addressLine1',''), address_line_2 = nullif(target_payload->>'addressLine2',''),
      town = nullif(target_payload->>'town',''), postcode = nullif(target_payload->>'postcode',''),
      version = contact.version + 1, updated_by_user_id = initiating_user_id, updated_at = now()
      where contact.id = target_record_id returning contact.* into saved;
  end if;
  result = pg_catalog.jsonb_build_object('operation','participant_contact','record_id',saved.id,'workspace_id',saved.workspace_id,'programme_id',saved.programme_id,'version',saved.version);
  insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
    values(target_workspace_id,initiating_user_id,'user','programme_hub.participant_contact.saved','programme_hub_participant_contact',saved.id,
      pg_catalog.jsonb_build_object('request_id',target_request_id,'programme_id',target_programme_id,'participant_id',contact_participant_id,'version',saved.version));
  insert into rev_programme_hub_private.write_requests(request_id,workspace_id,actor_user_id,operation,input,result)
    values(target_request_id,target_workspace_id,initiating_user_id,'participant_contact',request_input,result);
  return result;
end;
$$;

create or replace function public.submit_meeting_proposal(
  target_workspace_id uuid,
  target_submitted_by uuid,
  target_title text,
  target_attendee_email text,
  target_start_at timestamptz,
  target_end_at timestamptz,
  target_timezone text,
  target_meeting_method text,
  target_location_details text,
  target_notes text,
  target_semantic_fingerprint text
)
returns table (action_id uuid, approval_id uuid, action_status text, execution_status text, created boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.meeting_proposals%rowtype;
  existing_action public.rev_actions%rowtype;
  existing_approval public.approvals%rowtype;
  new_action public.rev_actions%rowtype;
  new_approval public.approvals%rowtype;
  action_fingerprint text;
  payload jsonb;
begin
  if not public.has_rev_module_access(target_workspace_id,target_submitted_by,'rev') then raise exception 'Module access required' using errcode='42501'; end if;
  if target_workspace_id is null or target_submitted_by is null then raise exception 'valid workspace and actor required'; end if;
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = target_workspace_id
      and user_id = target_submitted_by
      and status = 'active'
  ) then raise exception 'active workspace membership required'; end if;
  if target_title is null or char_length(btrim(target_title)) not between 1 and 120 then raise exception 'valid title required'; end if;
  if target_attendee_email is null or btrim(target_attendee_email) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'valid attendee email required'; end if;
  if target_start_at is null or target_end_at is null or target_start_at >= target_end_at or target_start_at <= now() then raise exception 'valid future interval required'; end if;
  if extract(epoch from (target_end_at - target_start_at)) / 60 not in (30, 60) then raise exception 'valid meeting duration required'; end if;
  if target_timezone is null or char_length(btrim(target_timezone)) = 0 then raise exception 'valid timezone required'; end if;
  if target_meeting_method not in ('online', 'phone', 'in_person') then raise exception 'valid meeting method required'; end if;
  if coalesce(char_length(btrim(target_location_details)), 0) > 240 or coalesce(char_length(btrim(target_notes)), 0) > 1000 then raise exception 'proposal text is too long'; end if;
  if target_semantic_fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'valid semantic fingerprint required'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_workspace_id::text || ':' || target_semantic_fingerprint, 0));
  select * into existing from public.meeting_proposals
  where workspace_id = target_workspace_id and semantic_fingerprint = target_semantic_fingerprint;
  if found then
    select * into existing_action from public.rev_actions
    where workspace_id = target_workspace_id and id = existing.rev_action_id;
    select * into existing_approval from public.approvals
    where workspace_id = target_workspace_id and rev_action_id = existing.rev_action_id and id = existing.approval_id;
    if not found or existing_action.workspace_id is null then raise exception 'existing meeting proposal binding is invalid'; end if;
    return query select existing_action.id, existing_approval.id, existing_action.status, existing_action.execution_status, false;
    return;
  end if;

  payload := jsonb_build_object(
    'version', 1, 'title', btrim(target_title), 'attendeeEmail', lower(btrim(target_attendee_email)),
    'startAt', to_char(target_start_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'endAt', to_char(target_end_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'timezone', btrim(target_timezone), 'meetingMethod', target_meeting_method,
    'locationDetails', btrim(coalesce(target_location_details, '')), 'notes', btrim(coalesce(target_notes, ''))
  );
  insert into public.rev_actions (workspace_id, action_type, title, description, rationale, requires_approval, status, execution_status, action_version)
  values (target_workspace_id, 'meeting_proposal', btrim(target_title), 'Meeting proposal awaiting owner approval.', 'meeting-proposal:v1:' || target_semantic_fingerprint, true, 'awaiting_approval', 'not_executed', 1)
  returning * into new_action;
  action_fingerprint := public.rev_action_material_fingerprint(new_action);
  insert into public.approvals (workspace_id, rev_action_id, action_version, action_fingerprint)
  values (target_workspace_id, new_action.id, new_action.action_version, action_fingerprint)
  returning * into new_approval;
  insert into public.meeting_proposals (workspace_id, rev_action_id, approval_id, submitted_by, proposal_version, semantic_fingerprint, proposal_payload)
  values (target_workspace_id, new_action.id, new_approval.id, target_submitted_by, 1, target_semantic_fingerprint, payload);
  insert into public.audit_log (workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata)
  values (target_workspace_id, target_submitted_by, 'user', 'meeting_proposal.submitted', 'meeting_proposal', new_action.id, jsonb_build_object('proposal_version', 1));
  return query select new_action.id, new_approval.id, new_action.status, new_action.execution_status, true;
end;
$$;

create or replace function rev_programme_hub_private.assert_programme_adviser(
  target_workspace_id uuid,
  target_programme_id uuid,
  initiating_user_id uuid,
  managers_only boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare allowed boolean;
begin
  if not public.has_rev_module_access(target_workspace_id,initiating_user_id,'programme') then raise exception 'Module access required' using errcode='42501'; end if;
  select exists (
    select 1 from public.workspace_members member
    where member.workspace_id = target_workspace_id
      and member.user_id = initiating_user_id
      and member.status = 'active'
      and member.role in ('owner', 'admin')
  ) or (
    not managers_only and exists (
      select 1
      from public.workspace_members member
      join public.programme_hub_advisers adviser
        on adviser.workspace_id = member.workspace_id
        and adviser.programme_id = target_programme_id
        and adviser.user_id = member.user_id
        and adviser.active
      where member.workspace_id = target_workspace_id
        and member.user_id = initiating_user_id
        and member.status = 'active'
    )
  ) into allowed;
  if not allowed then raise exception 'Programme adviser required'; end if;
end;
$$;

create or replace function public.accept_rev_workspace_invitation(target_invitation_id uuid)
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
  if existing_status is null then
    insert into public.workspace_module_access(workspace_id,user_id,modules) values(scope,actor,array['programme']);
  end if;
  insert into public.workspace_staff_profiles(workspace_id,user_id,display_name) values(scope,actor,invitation.display_name) on conflict(workspace_id,user_id) do nothing;
  update public.workspace_staff_invitations set status='accepted',accepted_by=actor,accepted_at=now() where id=target_invitation_id;
  insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata) values(scope,actor,'user','workspace.team.invitation_accepted','workspace',scope,jsonb_build_object('invitationId',target_invitation_id));
  return jsonb_build_object('workspaceId',scope,'role',coalesce(existing_role,'member'),'accepted',true);
end;
$$;
commit;
