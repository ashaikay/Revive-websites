create table public.programme_hub_participant_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  participant_id uuid not null,
  body text not null check (length(body) between 1 and 2000 and body = btrim(body)),
  author_user_id uuid not null,
  version bigint not null default 1 check (version = 1),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id) references public.programme_hub_programmes(workspace_id, id),
  foreign key (workspace_id, programme_id, participant_id) references public.programme_hub_participants(workspace_id, programme_id, id),
  foreign key (workspace_id, author_user_id) references public.workspace_members(workspace_id, user_id)
);

create index programme_hub_participant_notes_timeline_idx
  on public.programme_hub_participant_notes(workspace_id, programme_id, participant_id, created_at desc);

alter table public.programme_hub_participant_notes enable row level security;
revoke all on public.programme_hub_participant_notes from public, anon, authenticated;
grant select on public.programme_hub_participant_notes to authenticated;
grant select, insert on public.programme_hub_participant_notes to service_role;

create policy programme_hub_participant_notes_read on public.programme_hub_participant_notes
  for select to authenticated
  using (public.can_access_rev_participant(workspace_id, participant_id));

create function public.save_rev_programme_hub_participant_note(
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

revoke all on function public.save_rev_programme_hub_participant_note(uuid, uuid, uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.save_rev_programme_hub_participant_note(uuid, uuid, uuid, uuid, uuid, text)
  to service_role;
