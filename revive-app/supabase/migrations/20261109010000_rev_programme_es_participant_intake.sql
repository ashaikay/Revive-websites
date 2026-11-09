create function public.save_rev_programme_hub_es_participant_intake(
  target_workspace_id uuid,
  initiating_user_id uuid,
  target_request_id uuid,
  target_programme_id uuid,
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
  participant_id uuid;
  participant_version bigint;
begin
  if target_workspace_id is null or initiating_user_id is null or target_request_id is null
    or target_programme_id is null or jsonb_typeof(target_payload) <> 'object'
    or not (target_payload ?& array[
      'participantKey', 'preferredName', 'caseReference', 'desiredRoleKeys',
      'skillKeys', 'vacancySearchGeographyKeys', 'residencyEvidenceReference', 'active'
    ])
    or (select count(*) from pg_catalog.jsonb_object_keys(target_payload)) <> 8
    or coalesce(length(target_payload->>'participantKey'), 0) not between 1 and 120
    or target_payload->>'participantKey' <> btrim(target_payload->>'participantKey')
    or coalesce(length(target_payload->>'preferredName'), 0) not between 1 and 160
    or target_payload->>'preferredName' <> btrim(target_payload->>'preferredName')
    or coalesce(length(target_payload->>'caseReference'), 0) not between 1 and 120
    or target_payload->>'caseReference' <> btrim(target_payload->>'caseReference')
    or not rev_programme_hub_private.valid_tags(array(select pg_catalog.jsonb_array_elements_text(target_payload->'desiredRoleKeys')))
    or not rev_programme_hub_private.valid_tags(array(select pg_catalog.jsonb_array_elements_text(target_payload->'skillKeys')))
    or not rev_programme_hub_private.valid_tags(array(select pg_catalog.jsonb_array_elements_text(target_payload->'vacancySearchGeographyKeys')))
    or coalesce(length(target_payload->>'residencyEvidenceReference'), 0) > 200
    or target_payload->>'residencyEvidenceReference' <> btrim(target_payload->>'residencyEvidenceReference')
    or jsonb_typeof(target_payload->'active') <> 'boolean'
    or not (target_payload->>'active')::boolean
  then
    raise exception 'Valid participant details required';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text, 0));
  perform 1 from public.workspaces workspace
  where workspace.id = target_workspace_id
  for update;
  if not found then raise exception 'Workspace unavailable'; end if;

  perform 1
  from public.programme_hub_programmes programme
  where programme.workspace_id = target_workspace_id
    and programme.id = target_programme_id
    and programme.active
  for share;
  if not found then raise exception 'Programme unavailable'; end if;

  perform 1
  from public.workspace_members member
  join public.programme_hub_advisers adviser
    on adviser.workspace_id = member.workspace_id
    and adviser.programme_id = target_programme_id
    and adviser.user_id = member.user_id
    and adviser.active
  where member.workspace_id = target_workspace_id
    and member.user_id = initiating_user_id
    and member.status = 'active'
  for share of member, adviser;
  if not found then raise exception 'Programme adviser required'; end if;

  request_input = pg_catalog.jsonb_build_object(
    'operation', 'participant_intake',
    'programme_id', target_programme_id,
    'record_id', null,
    'expected_version', 0,
    'payload', target_payload
  );

  select request.* into prior
  from rev_programme_hub_private.write_requests request
  where request.request_id = target_request_id;
  if found then
    if prior.workspace_id <> target_workspace_id
      or prior.actor_user_id <> initiating_user_id
      or prior.operation <> 'participant_intake'
      or prior.input <> request_input
    then
      raise exception 'Programme request unavailable';
    end if;
    return prior.result;
  end if;

  insert into public.programme_hub_participants (
    workspace_id, programme_id, participant_key, preferred_name, case_reference,
    desired_role_keys, skill_keys, vacancy_search_geography_keys, residency_evidence_reference,
    active, created_by_user_id, updated_by_user_id
  ) values (
    target_workspace_id, target_programme_id, target_payload->>'participantKey',
    target_payload->>'preferredName', target_payload->>'caseReference',
    array(select pg_catalog.jsonb_array_elements_text(target_payload->'desiredRoleKeys')),
    array(select pg_catalog.jsonb_array_elements_text(target_payload->'skillKeys')),
    array(select pg_catalog.jsonb_array_elements_text(target_payload->'vacancySearchGeographyKeys')),
    nullif(target_payload->>'residencyEvidenceReference', ''),
    true, initiating_user_id, initiating_user_id
  ) returning id, version into participant_id, participant_version;

  insert into public.programme_hub_participant_advisers (
    workspace_id, programme_id, participant_id, adviser_user_id, active,
    created_by_user_id, updated_by_user_id
  ) values (
    target_workspace_id, target_programme_id, participant_id, initiating_user_id, true,
    initiating_user_id, initiating_user_id
  );

  result = pg_catalog.jsonb_build_object(
    'operation', 'participant_intake',
    'record_id', participant_id,
    'workspace_id', target_workspace_id,
    'programme_id', target_programme_id,
    'version', participant_version
  );

  insert into public.audit_log (
    workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
  ) values (
    target_workspace_id, initiating_user_id, 'user',
    'programme_hub.participant_intake.created',
    'programme_hub_participant', participant_id,
    pg_catalog.jsonb_build_object(
      'request_id', target_request_id,
      'programme_id', target_programme_id,
      'version', participant_version,
      'self_assigned', true
    )
  );

  insert into rev_programme_hub_private.write_requests (
    request_id, workspace_id, actor_user_id, operation, input, result
  ) values (
    target_request_id, target_workspace_id, initiating_user_id,
    'participant_intake', request_input, result
  );

  return result;
end;
$$;

revoke all on function public.save_rev_programme_hub_es_participant_intake(uuid, uuid, uuid, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_rev_programme_hub_es_participant_intake(uuid, uuid, uuid, uuid, jsonb)
  to service_role;
