create schema if not exists rev_programme_hub_private;
revoke all on schema rev_programme_hub_private from public, anon, authenticated;

create function rev_programme_hub_private.valid_tags(tags text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select tags is not null
    and cardinality(tags) <= 50
    and (cardinality(tags) = 0 or array_ndims(tags) = 1)
    and not exists (
      select 1 from unnest(tags) value
      where value is null or length(value) not between 1 and 120 or value <> btrim(value)
    )
    and (select count(distinct value) from unnest(tags) value) = cardinality(tags);
$$;
revoke all on function rev_programme_hub_private.valid_tags(text[]) from public, anon, authenticated;

create table public.programme_hub_programmes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  name text not null check (length(name) between 1 and 160 and name = btrim(name)),
  timezone text not null check (length(timezone) between 1 and 100 and timezone = btrim(timezone)),
  branding_name text check (branding_name is null or (length(branding_name) between 1 and 160 and branding_name = btrim(branding_name))),
  sender_display_name text check (sender_display_name is null or (length(sender_display_name) between 1 and 160 and sender_display_name = btrim(sender_display_name))),
  sender_reply_to text check (sender_reply_to is null or (length(sender_reply_to) between 3 and 320 and sender_reply_to = lower(btrim(sender_reply_to)))),
  active boolean not null default true,
  version bigint not null default 1 check (version >= 1),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, updated_by_user_id) references public.workspace_members(workspace_id, user_id)
);

create table public.programme_hub_advisers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  user_id uuid not null,
  active boolean not null default true,
  version bigint not null default 1 check (version >= 1),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, programme_id, user_id),
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id) references public.programme_hub_programmes(workspace_id, id),
  foreign key (workspace_id, user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, updated_by_user_id) references public.workspace_members(workspace_id, user_id)
);

create table public.programme_hub_employers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  employer_key text not null check (length(employer_key) between 1 and 120 and employer_key = btrim(employer_key)),
  display_name text not null check (length(display_name) between 1 and 200 and display_name = btrim(display_name)),
  sector_key text check (sector_key is null or (length(sector_key) between 1 and 120 and sector_key = btrim(sector_key))),
  primary_geography_key text check (primary_geography_key is null or (length(primary_geography_key) between 1 and 120 and primary_geography_key = btrim(primary_geography_key))),
  active boolean not null default true,
  version bigint not null default 1 check (version >= 1),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, programme_id, employer_key),
  unique (workspace_id, id),
  unique (workspace_id, programme_id, id),
  foreign key (workspace_id, programme_id) references public.programme_hub_programmes(workspace_id, id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, updated_by_user_id) references public.workspace_members(workspace_id, user_id)
);

create table public.programme_hub_employer_contacts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  employer_id uuid not null,
  contact_key text not null check (length(contact_key) between 1 and 120 and contact_key = btrim(contact_key)),
  preferred_name text not null check (length(preferred_name) between 1 and 160 and preferred_name = btrim(preferred_name)),
  role_title text check (role_title is null or (length(role_title) between 1 and 160 and role_title = btrim(role_title))),
  business_email text check (business_email is null or (length(business_email) between 3 and 320 and business_email = lower(btrim(business_email)))),
  business_phone text check (business_phone is null or (length(business_phone) between 3 and 40 and business_phone = btrim(business_phone))),
  suppressed boolean not null default false,
  suppression_reason_key text check (suppression_reason_key is null or (length(suppression_reason_key) between 1 and 120 and suppression_reason_key = btrim(suppression_reason_key))),
  active boolean not null default true,
  version bigint not null default 1 check (version >= 1),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, employer_id, contact_key),
  unique (workspace_id, id),
  unique (workspace_id, programme_id, employer_id, id),
  foreign key (workspace_id, programme_id) references public.programme_hub_programmes(workspace_id, id),
  foreign key (workspace_id, programme_id, employer_id) references public.programme_hub_employers(workspace_id, programme_id, id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, updated_by_user_id) references public.workspace_members(workspace_id, user_id)
);

create table public.programme_hub_vacancies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  employer_id uuid not null,
  employer_contact_id uuid,
  vacancy_key text not null check (length(vacancy_key) between 1 and 120 and vacancy_key = btrim(vacancy_key)),
  title text not null check (length(title) between 1 and 200 and title = btrim(title)),
  work_geography_key text check (work_geography_key is null or (length(work_geography_key) between 1 and 120 and work_geography_key = btrim(work_geography_key))),
  required_skill_keys text[] not null default '{}' check (rev_programme_hub_private.valid_tags(required_skill_keys)),
  desired_skill_keys text[] not null default '{}' check (rev_programme_hub_private.valid_tags(desired_skill_keys)),
  active boolean not null default true,
  version bigint not null default 1 check (version >= 1),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, programme_id, vacancy_key),
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id) references public.programme_hub_programmes(workspace_id, id),
  foreign key (workspace_id, programme_id, employer_id) references public.programme_hub_employers(workspace_id, programme_id, id),
  foreign key (workspace_id, programme_id, employer_id, employer_contact_id) references public.programme_hub_employer_contacts(workspace_id, programme_id, employer_id, id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, updated_by_user_id) references public.workspace_members(workspace_id, user_id)
);

create table public.programme_hub_participants (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  participant_key text not null check (length(participant_key) between 1 and 120 and participant_key = btrim(participant_key)),
  preferred_name text not null check (length(preferred_name) between 1 and 160 and preferred_name = btrim(preferred_name)),
  case_reference text not null check (length(case_reference) between 1 and 120 and case_reference = btrim(case_reference)),
  desired_role_keys text[] not null default '{}' check (rev_programme_hub_private.valid_tags(desired_role_keys)),
  skill_keys text[] not null default '{}' check (rev_programme_hub_private.valid_tags(skill_keys)),
  vacancy_search_geography_keys text[] not null default '{}' check (rev_programme_hub_private.valid_tags(vacancy_search_geography_keys)),
  residency_evidence_reference text check (residency_evidence_reference is null or (length(residency_evidence_reference) between 1 and 200 and residency_evidence_reference = btrim(residency_evidence_reference))),
  active boolean not null default true,
  version bigint not null default 1 check (version >= 1),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, programme_id, participant_key),
  unique (workspace_id, programme_id, case_reference),
  unique (workspace_id, id),
  unique (workspace_id, programme_id, id),
  foreign key (workspace_id, programme_id) references public.programme_hub_programmes(workspace_id, id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, updated_by_user_id) references public.workspace_members(workspace_id, user_id)
);

create table public.programme_hub_participant_advisers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  participant_id uuid not null,
  adviser_user_id uuid not null,
  active boolean not null default true,
  version bigint not null default 1 check (version >= 1),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, participant_id, adviser_user_id),
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id) references public.programme_hub_programmes(workspace_id, id),
  foreign key (workspace_id, programme_id, participant_id) references public.programme_hub_participants(workspace_id, programme_id, id),
  foreign key (workspace_id, programme_id, adviser_user_id) references public.programme_hub_advisers(workspace_id, programme_id, user_id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, updated_by_user_id) references public.workspace_members(workspace_id, user_id)
);

create table public.programme_hub_contracts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  contract_type text not null check (contract_type in (
    'residency_eligibility',
    'vacancy_search_geography',
    'service_delivery_geography',
    'outcome_vocabulary',
    'spreadsheet_mapping'
  )),
  contract_version text not null check (length(contract_version) between 1 and 80 and contract_version = btrim(contract_version)),
  effective_from date not null,
  effective_to date check (effective_to is null or effective_to >= effective_from),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  active boolean not null default false,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, programme_id, contract_type, contract_version),
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id) references public.programme_hub_programmes(workspace_id, id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id)
);

create table rev_programme_hub_private.write_requests (
  request_id uuid primary key,
  workspace_id uuid not null references public.workspaces(id),
  actor_user_id uuid not null,
  operation text not null,
  input jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key (workspace_id, actor_user_id) references public.workspace_members(workspace_id, user_id)
);
revoke all on rev_programme_hub_private.write_requests from public, anon, authenticated, service_role;

create index programme_hub_advisers_user_idx on public.programme_hub_advisers(workspace_id, user_id, active);
create index programme_hub_employers_programme_idx on public.programme_hub_employers(workspace_id, programme_id, active);
create index programme_hub_contacts_employer_idx on public.programme_hub_employer_contacts(workspace_id, employer_id, active);
create index programme_hub_vacancies_programme_idx on public.programme_hub_vacancies(workspace_id, programme_id, active);
create index programme_hub_participants_programme_idx on public.programme_hub_participants(workspace_id, programme_id, active);
create index programme_hub_caseload_idx on public.programme_hub_participant_advisers(workspace_id, adviser_user_id, active);

create function public.can_access_rev_programme(target_workspace_id uuid, target_programme_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
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
  );
$$;

create function public.can_access_rev_participant(target_workspace_id uuid, target_participant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
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
  );
$$;

revoke all on function public.can_access_rev_programme(uuid, uuid) from public, anon;
grant execute on function public.can_access_rev_programme(uuid, uuid) to authenticated;
revoke all on function public.can_access_rev_participant(uuid, uuid) from public, anon;
grant execute on function public.can_access_rev_participant(uuid, uuid) to authenticated;

alter table public.programme_hub_programmes enable row level security;
alter table public.programme_hub_advisers enable row level security;
alter table public.programme_hub_employers enable row level security;
alter table public.programme_hub_employer_contacts enable row level security;
alter table public.programme_hub_vacancies enable row level security;
alter table public.programme_hub_participants enable row level security;
alter table public.programme_hub_participant_advisers enable row level security;
alter table public.programme_hub_contracts enable row level security;

revoke all on public.programme_hub_programmes, public.programme_hub_advisers,
  public.programme_hub_employers, public.programme_hub_employer_contacts,
  public.programme_hub_vacancies, public.programme_hub_participants,
  public.programme_hub_participant_advisers, public.programme_hub_contracts
  from public, anon, authenticated;
grant select on public.programme_hub_programmes, public.programme_hub_advisers,
  public.programme_hub_employers, public.programme_hub_employer_contacts,
  public.programme_hub_vacancies, public.programme_hub_participants,
  public.programme_hub_participant_advisers, public.programme_hub_contracts
  to authenticated;
grant select, insert, update on public.programme_hub_programmes, public.programme_hub_advisers,
  public.programme_hub_employers, public.programme_hub_employer_contacts,
  public.programme_hub_vacancies, public.programme_hub_participants,
  public.programme_hub_participant_advisers, public.programme_hub_contracts
  to service_role;

create policy programme_hub_programmes_read on public.programme_hub_programmes
  for select to authenticated using (public.can_access_rev_programme(workspace_id, id));
create policy programme_hub_advisers_read on public.programme_hub_advisers
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));
create policy programme_hub_employers_read on public.programme_hub_employers
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));
create policy programme_hub_contacts_read on public.programme_hub_employer_contacts
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));
create policy programme_hub_vacancies_read on public.programme_hub_vacancies
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));
create policy programme_hub_participants_read on public.programme_hub_participants
  for select to authenticated using (public.can_access_rev_participant(workspace_id, id));
create policy programme_hub_participant_advisers_read on public.programme_hub_participant_advisers
  for select to authenticated using (public.can_access_rev_participant(workspace_id, participant_id));
create policy programme_hub_contracts_read on public.programme_hub_contracts
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));

create function public.save_rev_programme_hub_record(
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

revoke all on function public.save_rev_programme_hub_record(text, uuid, uuid, uuid, uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_rev_programme_hub_record(text, uuid, uuid, uuid, uuid, uuid, bigint, jsonb)
  to service_role;
