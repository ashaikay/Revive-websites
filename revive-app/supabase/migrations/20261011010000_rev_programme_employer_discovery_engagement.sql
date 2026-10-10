create table public.programme_hub_employer_discovery_searches (
  id uuid primary key,
  workspace_id uuid not null,
  programme_id uuid not null,
  actor_user_id uuid not null,
  provider text not null check (provider = 'companies_house'),
  filters jsonb not null,
  status text not null check (status in ('claimed', 'succeeded', 'failed')),
  results jsonb,
  error_code text check (error_code in ('provider_authentication', 'provider_rate_limited', 'provider_unavailable', 'invalid_response')),
  provider_call_count integer not null default 1 check (provider_call_count = 1),
  retrieved_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id) references public.programme_hub_programmes(workspace_id, id),
  foreign key (workspace_id, actor_user_id) references public.workspace_members(workspace_id, user_id),
  check (
    (status = 'claimed' and results is null and error_code is null and provider_call_count = 1 and completed_at is null)
    or (status = 'succeeded' and jsonb_typeof(results) = 'array' and error_code is null and provider_call_count = 1 and retrieved_at is not null and completed_at is not null)
    or (status = 'failed' and results is null and error_code is not null and provider_call_count = 1 and completed_at is not null)
  )
);

alter table public.programme_hub_employers
  add column source_provider text check (source_provider is null or source_provider = 'companies_house'),
  add column source_identity text check (source_identity is null or (length(source_identity) between 1 and 120 and source_identity = btrim(source_identity))),
  add column source_url text check (source_url is null or (length(source_url) between 1 and 1000 and source_url = btrim(source_url))),
  add column source_retrieved_at timestamptz,
  add column source_address text check (source_address is null or (length(source_address) between 1 and 500 and source_address = btrim(source_address))),
  add column source_evidence jsonb;

create unique index programme_hub_employers_source_identity_unique
  on public.programme_hub_employers(workspace_id, programme_id, source_provider, source_identity)
  where source_provider is not null and source_identity is not null;

create table public.programme_hub_outreach_settings (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  offer_summary text not null check (length(offer_summary) between 20 and 2000 and offer_summary = btrim(offer_summary)),
  version bigint not null default 1 check (version >= 1),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, programme_id),
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id) references public.programme_hub_programmes(workspace_id, id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, updated_by_user_id) references public.workspace_members(workspace_id, user_id)
);

create table public.programme_hub_employer_engagements (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  employer_id uuid not null,
  stage text not null check (stage in ('to_review', 'ready_to_contact', 'contacted', 'conversation_underway', 'opportunity_identified', 'not_pursuing')),
  responsible_adviser_user_id uuid,
  next_action text check (next_action is null or (length(next_action) between 1 and 500 and next_action = btrim(next_action))),
  follow_up_date date,
  version bigint not null default 1 check (version >= 1),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, programme_id, employer_id),
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id, employer_id) references public.programme_hub_employers(workspace_id, programme_id, id),
  foreign key (workspace_id, responsible_adviser_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id),
  foreign key (workspace_id, updated_by_user_id) references public.workspace_members(workspace_id, user_id)
);

create table public.programme_hub_employer_engagement_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  programme_id uuid not null,
  employer_id uuid not null,
  employer_contact_id uuid,
  event_type text not null check (event_type in ('manual_contact', 'note', 'stage_change', 'draft_prepared', 'draft_revised')),
  channel text check (channel is null or channel in ('email', 'phone', 'meeting', 'in_person', 'other')),
  summary text not null check (length(summary) between 1 and 2000 and summary = btrim(summary)),
  origin text not null default 'manual' check (origin in ('manual', 'rev_prepared_not_sent')),
  actor_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id, employer_id) references public.programme_hub_employers(workspace_id, programme_id, id),
  foreign key (workspace_id, programme_id, employer_id, employer_contact_id) references public.programme_hub_employer_contacts(workspace_id, programme_id, employer_id, id),
  foreign key (workspace_id, actor_user_id) references public.workspace_members(workspace_id, user_id)
);

create table public.programme_hub_employer_outreach_attempts (
  id uuid primary key,
  workspace_id uuid not null,
  programme_id uuid not null,
  employer_id uuid not null,
  employer_contact_id uuid,
  actor_user_id uuid not null,
  employer_version bigint not null,
  settings_version bigint not null,
  contact_version bigint,
  input jsonb not null,
  status text not null check (status in ('claimed', 'succeeded', 'failed')),
  error_code text check (error_code in ('provider_refused', 'provider_unavailable', 'invalid_response', 'stale_evidence')),
  provider_call_count integer not null default 1 check (provider_call_count = 1),
  provider_response_id text,
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  draft_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id, employer_id) references public.programme_hub_employers(workspace_id, programme_id, id),
  foreign key (workspace_id, programme_id, employer_id, employer_contact_id) references public.programme_hub_employer_contacts(workspace_id, programme_id, employer_id, id),
  foreign key (workspace_id, actor_user_id) references public.workspace_members(workspace_id, user_id),
  check (
    (status = 'claimed' and provider_call_count = 1 and error_code is null and completed_at is null)
    or (status = 'succeeded' and provider_call_count = 1 and error_code is null and draft_id is not null and completed_at is not null)
    or (status = 'failed' and provider_call_count = 1 and error_code is not null and draft_id is null and completed_at is not null)
  )
);

create table public.programme_hub_employer_outreach_drafts (
  id uuid primary key,
  workspace_id uuid not null,
  programme_id uuid not null,
  employer_id uuid not null,
  employer_contact_id uuid,
  root_draft_id uuid not null,
  revision integer not null check (revision >= 1),
  current boolean not null default true,
  subject text not null check (length(subject) between 1 and 200 and subject = btrim(subject)),
  body text not null check (length(body) between 20 and 5000 and body = btrim(body)),
  status text not null default 'prepared_not_sent' check (status = 'prepared_not_sent'),
  evidence_snapshot jsonb not null,
  programme_snapshot jsonb not null,
  provider text check (provider is null or provider = 'openai'),
  model text,
  source_attempt_id uuid,
  created_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, root_draft_id, revision),
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id, employer_id) references public.programme_hub_employers(workspace_id, programme_id, id),
  foreign key (workspace_id, programme_id, employer_id, employer_contact_id) references public.programme_hub_employer_contacts(workspace_id, programme_id, employer_id, id),
  foreign key (workspace_id, source_attempt_id) references public.programme_hub_employer_outreach_attempts(workspace_id, id),
  foreign key (workspace_id, created_by_user_id) references public.workspace_members(workspace_id, user_id)
);

alter table public.programme_hub_employer_outreach_attempts
  add foreign key (workspace_id, draft_id) references public.programme_hub_employer_outreach_drafts(workspace_id, id);

create unique index programme_hub_outreach_current_unique
  on public.programme_hub_employer_outreach_drafts(workspace_id, root_draft_id)
  where current;

create index programme_hub_discovery_programme_idx on public.programme_hub_employer_discovery_searches(workspace_id, programme_id, created_at desc);
create index programme_hub_engagement_programme_idx on public.programme_hub_employer_engagements(workspace_id, programme_id, updated_at desc);
create index programme_hub_engagement_events_timeline_idx on public.programme_hub_employer_engagement_events(workspace_id, programme_id, employer_id, created_at desc);
create index programme_hub_outreach_employer_idx on public.programme_hub_employer_outreach_drafts(workspace_id, programme_id, employer_id, created_at desc);

alter table public.programme_hub_employer_discovery_searches enable row level security;
alter table public.programme_hub_outreach_settings enable row level security;
alter table public.programme_hub_employer_engagements enable row level security;
alter table public.programme_hub_employer_engagement_events enable row level security;
alter table public.programme_hub_employer_outreach_attempts enable row level security;
alter table public.programme_hub_employer_outreach_drafts enable row level security;

revoke all on public.programme_hub_employer_discovery_searches, public.programme_hub_outreach_settings,
  public.programme_hub_employer_engagements, public.programme_hub_employer_engagement_events,
  public.programme_hub_employer_outreach_attempts, public.programme_hub_employer_outreach_drafts
  from public, anon, authenticated;
grant select on public.programme_hub_employer_discovery_searches, public.programme_hub_outreach_settings,
  public.programme_hub_employer_engagements, public.programme_hub_employer_engagement_events,
  public.programme_hub_employer_outreach_attempts, public.programme_hub_employer_outreach_drafts
  to authenticated;
grant select, insert, update on public.programme_hub_employer_discovery_searches, public.programme_hub_outreach_settings,
  public.programme_hub_employer_engagements, public.programme_hub_employer_engagement_events,
  public.programme_hub_employer_outreach_attempts, public.programme_hub_employer_outreach_drafts
  to service_role;

create policy programme_hub_discovery_read on public.programme_hub_employer_discovery_searches
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));
create policy programme_hub_outreach_settings_read on public.programme_hub_outreach_settings
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));
create policy programme_hub_engagements_read on public.programme_hub_employer_engagements
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));
create policy programme_hub_engagement_events_read on public.programme_hub_employer_engagement_events
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));
create policy programme_hub_outreach_attempts_read on public.programme_hub_employer_outreach_attempts
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));
create policy programme_hub_outreach_drafts_read on public.programme_hub_employer_outreach_drafts
  for select to authenticated using (public.can_access_rev_programme(workspace_id, programme_id));

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
revoke all on function rev_programme_hub_private.assert_programme_adviser(uuid, uuid, uuid, boolean) from public, anon, authenticated, service_role;

create function public.claim_rev_programme_employer_discovery(
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

create function public.complete_rev_programme_employer_discovery(
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

create function public.fail_rev_programme_employer_discovery(
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

create function public.save_rev_programme_employer_engagement(
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

create function public.claim_rev_programme_employer_outreach_draft(
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

create function public.complete_rev_programme_employer_outreach_draft(
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

create function public.fail_rev_programme_employer_outreach_draft(
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

revoke all on function public.claim_rev_programme_employer_discovery(uuid, uuid, uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.complete_rev_programme_employer_discovery(uuid, uuid, uuid, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.fail_rev_programme_employer_discovery(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.save_rev_programme_employer_engagement(text, uuid, uuid, uuid, uuid, uuid, bigint, jsonb) from public, anon, authenticated;
revoke all on function public.claim_rev_programme_employer_outreach_draft(uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint, bigint, integer) from public, anon, authenticated;
revoke all on function public.complete_rev_programme_employer_outreach_draft(uuid, uuid, uuid, text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.fail_rev_programme_employer_outreach_draft(uuid, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.claim_rev_programme_employer_discovery(uuid, uuid, uuid, uuid, jsonb) to service_role;
grant execute on function public.complete_rev_programme_employer_discovery(uuid, uuid, uuid, jsonb, timestamptz) to service_role;
grant execute on function public.fail_rev_programme_employer_discovery(uuid, uuid, uuid, text) to service_role;
grant execute on function public.save_rev_programme_employer_engagement(text, uuid, uuid, uuid, uuid, uuid, bigint, jsonb) to service_role;
grant execute on function public.claim_rev_programme_employer_outreach_draft(uuid, uuid, uuid, uuid, uuid, uuid, bigint, bigint, bigint, integer) to service_role;
grant execute on function public.complete_rev_programme_employer_outreach_draft(uuid, uuid, uuid, text, text, text, text, integer, integer) to service_role;
grant execute on function public.fail_rev_programme_employer_outreach_draft(uuid, uuid, uuid, text) to service_role;
