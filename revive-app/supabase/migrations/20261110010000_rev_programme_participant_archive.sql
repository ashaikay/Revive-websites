begin;

create function rev_programme_hub_private.enforce_participant_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  is_manager boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Participant deletion unavailable';
  end if;

  if old.active is distinct from new.active then
    select exists (
      select 1
      from public.workspace_members member
      where member.workspace_id = old.workspace_id
        and member.user_id = new.updated_by_user_id
        and member.status = 'active'
        and member.role in ('owner', 'admin')
    ) into is_manager;
    if not is_manager then
      raise exception 'Programme manager required';
    end if;
    if row(
      old.workspace_id, old.programme_id, old.participant_key, old.preferred_name,
      old.case_reference, old.desired_role_keys, old.skill_keys,
      old.vacancy_search_geography_keys, old.residency_evidence_reference
    ) is distinct from row(
      new.workspace_id, new.programme_id, new.participant_key, new.preferred_name,
      new.case_reference, new.desired_role_keys, new.skill_keys,
      new.vacancy_search_geography_keys, new.residency_evidence_reference
    ) then
      raise exception 'Participant status change must not alter profile';
    end if;

    insert into public.audit_log (
      workspace_id, actor_user_id, actor_type, action, resource_type, resource_id, metadata
    ) values (
      old.workspace_id, new.updated_by_user_id, 'user',
      case when new.active then 'programme_hub.participant.reactivated'
        else 'programme_hub.participant.archived' end,
      'programme_hub_participant', old.id,
      pg_catalog.jsonb_build_object(
        'programme_id', old.programme_id,
        'previous_version', old.version,
        'version', new.version
      )
    );
  elsif not old.active then
    raise exception 'Archived participant is read only';
  end if;

  return new;
end;
$$;

create trigger programme_hub_participant_lifecycle_guard
before update or delete on public.programme_hub_participants
for each row execute function rev_programme_hub_private.enforce_participant_lifecycle();

create function rev_programme_hub_private.enforce_active_participant_child()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_data jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception 'Participant history deletion unavailable';
  end if;
  record_data = pg_catalog.to_jsonb(new);
  perform 1
  from public.programme_hub_participants participant
  where participant.workspace_id = (record_data->>'workspace_id')::uuid
    and participant.programme_id = (record_data->>'programme_id')::uuid
    and participant.id = (record_data->>'participant_id')::uuid
    and participant.active
  for share;
  if not found then
    raise exception 'Archived participant is read only';
  end if;
  return new;
end;
$$;

create trigger programme_hub_participant_notes_lifecycle_guard
before insert or update or delete on public.programme_hub_participant_notes
for each row execute function rev_programme_hub_private.enforce_active_participant_child();

create trigger programme_hub_participant_contacts_lifecycle_guard
before insert or update or delete on public.programme_hub_participant_contacts
for each row execute function rev_programme_hub_private.enforce_active_participant_child();

create trigger programme_hub_vocational_assessments_lifecycle_guard
before insert or update or delete on public.programme_hub_vocational_assessments
for each row execute function rev_programme_hub_private.enforce_active_participant_child();

create trigger programme_hub_action_plans_lifecycle_guard
before insert or update or delete on public.programme_hub_action_plans
for each row execute function rev_programme_hub_private.enforce_active_participant_child();

create function rev_programme_hub_private.enforce_active_assessment_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.programme_hub_vocational_assessments assessment
  join public.programme_hub_participants participant
    on participant.workspace_id = assessment.workspace_id
   and participant.programme_id = assessment.programme_id
   and participant.id = assessment.participant_id
   and participant.active
  where assessment.id = case when tg_op = 'DELETE' then old.assessment_id else new.assessment_id end
  for share of participant;
  if not found then
    raise exception 'Archived participant is read only';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger programme_hub_vocational_answers_lifecycle_guard
before insert or update or delete on public.programme_hub_vocational_assessment_answers
for each row execute function rev_programme_hub_private.enforce_active_assessment_participant();

create trigger programme_hub_vocational_restricted_answers_lifecycle_guard
before insert or update or delete on public.programme_hub_vocational_restricted_answers
for each row execute function rev_programme_hub_private.enforce_active_assessment_participant();

create function rev_programme_hub_private.enforce_archived_vocational_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  record_data jsonb;
  old_data jsonb;
  participant_is_active boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'Participant history deletion unavailable';
  end if;
  record_data = pg_catalog.to_jsonb(new);
  old_data = pg_catalog.to_jsonb(old);
  select participant.active
  into participant_is_active
  from public.programme_hub_participants participant
  where participant.workspace_id = (record_data->>'workspace_id')::uuid
    and participant.programme_id = (record_data->>'programme_id')::uuid
    and participant.id = (record_data->>'participant_id')::uuid
  for share;
  if participant_is_active then
    return new;
  end if;

  if tg_table_name = 'programme_hub_vocational_support_consents'
    and old_data->>'consent_status' = 'granted'
    and record_data->>'consent_status' = 'withdrawn'
    and old_data - array['consent_status', 'withdrawn_by_user_id', 'withdrawn_at', 'updated_at']
      = record_data - array['consent_status', 'withdrawn_by_user_id', 'withdrawn_at', 'updated_at']
    and record_data->>'withdrawn_by_user_id' is not null
    and record_data->>'withdrawn_at' is not null then
    return new;
  end if;

  if tg_table_name = 'programme_hub_vocational_restricted_access_grants'
    and old_data->>'revoked_at' is null
    and record_data->>'revoked_at' is not null
    and record_data->>'revoked_by_user_id' is not null
    and old_data - array['revoked_by_user_id', 'revoked_at']
      = record_data - array['revoked_by_user_id', 'revoked_at'] then
    return new;
  end if;

  raise exception 'Archived participant is read only';
end;
$$;

create trigger programme_hub_vocational_support_consents_lifecycle_guard
before insert or update or delete on public.programme_hub_vocational_support_consents
for each row execute function rev_programme_hub_private.enforce_archived_vocational_access();

create trigger programme_hub_vocational_access_grants_lifecycle_guard
before insert or update or delete on public.programme_hub_vocational_restricted_access_grants
for each row execute function rev_programme_hub_private.enforce_archived_vocational_access();

create function rev_programme_hub_private.enforce_active_assignment_participant()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Participant assignment deletion unavailable';
  end if;
  if tg_op = 'INSERT' or (not old.active and new.active) then
    perform 1
    from public.programme_hub_participants participant
    where participant.workspace_id = new.workspace_id
      and participant.programme_id = new.programme_id
      and participant.id = new.participant_id
      and participant.active
    for share;
    if not found then
      raise exception 'Archived participant is read only';
    end if;
  end if;
  return new;
end;
$$;

create trigger programme_hub_participant_assignment_lifecycle_guard
before insert or update or delete on public.programme_hub_participant_advisers
for each row execute function rev_programme_hub_private.enforce_active_assignment_participant();

revoke all on function
  rev_programme_hub_private.enforce_participant_lifecycle(),
  rev_programme_hub_private.enforce_active_participant_child(),
  rev_programme_hub_private.enforce_active_assessment_participant(),
  rev_programme_hub_private.enforce_archived_vocational_access(),
  rev_programme_hub_private.enforce_active_assignment_participant()
from public, anon, authenticated;

commit;
