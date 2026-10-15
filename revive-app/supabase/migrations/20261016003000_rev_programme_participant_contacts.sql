-- Optional programme-scoped contact details. No changes to participant identity or existing policies.
create table public.programme_hub_participant_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  participant_id uuid not null,
  phone text check (phone is null or (length(phone) between 1 and 40 and phone = btrim(phone) and phone !~ '[[:cntrl:]]')),
  email text check (email is null or (length(email) between 1 and 320 and email = btrim(email) and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
  address_line_1 text check (address_line_1 is null or (length(address_line_1) between 1 and 200 and address_line_1 = btrim(address_line_1) and address_line_1 !~ '[[:cntrl:]]')),
  address_line_2 text check (address_line_2 is null or (length(address_line_2) between 1 and 200 and address_line_2 = btrim(address_line_2) and address_line_2 !~ '[[:cntrl:]]')),
  town text check (town is null or (length(town) between 1 and 120 and town = btrim(town) and town !~ '[[:cntrl:]]')),
  postcode text check (postcode is null or postcode ~ '^([A-Z]{1,2}[0-9][A-Z0-9]?|GIR) [0-9][A-Z]{2}$'),
  version bigint not null default 1 check (version >= 1),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, programme_id, participant_id),
  foreign key (workspace_id, programme_id, participant_id) references public.programme_hub_participants(workspace_id, programme_id, id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, updated_by_user_id) references public.workspace_members(workspace_id, user_id)
);
alter table public.programme_hub_participant_contacts enable row level security;
revoke all on public.programme_hub_participant_contacts from public, anon, authenticated;
grant select on public.programme_hub_participant_contacts to authenticated;
grant select, insert, update on public.programme_hub_participant_contacts to service_role;
create policy programme_hub_participant_contacts_read on public.programme_hub_participant_contacts
  for select to authenticated using (public.can_access_rev_participant(workspace_id, participant_id));

create function public.save_rev_programme_hub_participant_contact(
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
revoke all on function public.save_rev_programme_hub_participant_contact(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.save_rev_programme_hub_participant_contact(uuid,uuid,uuid,uuid,uuid,bigint,jsonb) to service_role;
