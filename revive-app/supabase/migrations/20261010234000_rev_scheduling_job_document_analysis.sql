create function rev_scheduling_private.valid_document_evidence(value jsonb)
returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(value)='object'
 and (select array_agg(key order by key) from jsonb_object_keys(value) keys(key))=array['references','value']
 and jsonb_typeof(value->'value')='string' and length(value->>'value') between 1 and 500 and value->>'value'=trim(value->>'value')
 and jsonb_typeof(value->'references')='array' and jsonb_array_length(value->'references') between 1 and 20
 and not exists(
  select 1 from jsonb_array_elements(value->'references') reference
  where jsonb_typeof(reference)<>'object'
   or (select array_agg(key order by key) from jsonb_object_keys(reference) keys(key))<>array['page','section']
   or (reference->'page'<>'null'::jsonb and case when jsonb_typeof(reference->'page')='number' then (reference->>'page')::numeric<>pg_catalog.trunc((reference->>'page')::numeric) or (reference->>'page')::numeric not between 1 and 10000 else true end)
   or (reference->'section'<>'null'::jsonb and (jsonb_typeof(reference->'section')<>'string' or length(reference->>'section') not between 1 and 200 or reference->>'section'<>trim(reference->>'section')))
   or (reference->'page'='null'::jsonb and reference->'section'='null'::jsonb)
 )
$$;
revoke all on function rev_scheduling_private.valid_document_evidence(jsonb) from public,anon,authenticated,service_role;

create function rev_scheduling_private.valid_document_evidence_list(value jsonb,max_items integer)
returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(value)='array' and jsonb_array_length(value)<=max_items
 and not exists(select 1 from jsonb_array_elements(value) item where not rev_scheduling_private.valid_document_evidence(item))
$$;
revoke all on function rev_scheduling_private.valid_document_evidence_list(jsonb,integer) from public,anon,authenticated,service_role;

create function rev_scheduling_private.valid_document_requirements(value jsonb)
returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(value)='object'
 and (select array_agg(key order by key) from jsonb_object_keys(value) keys(key))=array['ambiguities','dates','duration','location','missingInformation','qualifications','requiredSkills','tasks']
 and rev_scheduling_private.valid_document_evidence_list(value->'tasks',100)
 and rev_scheduling_private.valid_document_evidence_list(value->'requiredSkills',30)
 and rev_scheduling_private.valid_document_evidence_list(value->'qualifications',30)
 and rev_scheduling_private.valid_document_evidence_list(value->'dates',30)
 and rev_scheduling_private.valid_document_evidence_list(value->'ambiguities',30)
 and (value->'location'='null'::jsonb or rev_scheduling_private.valid_document_evidence(value->'location'))
 and (value->'duration'='null'::jsonb or rev_scheduling_private.valid_document_evidence(value->'duration'))
 and jsonb_typeof(value->'missingInformation')='array' and jsonb_array_length(value->'missingInformation')<=20
 and not exists(select 1 from jsonb_array_elements(value->'missingInformation') item where jsonb_typeof(item)<>'string' or length(item#>>'{}') not between 1 and 200 or item#>>'{}'<>trim(item#>>'{}'))
 and (select count(*) from jsonb_array_elements(value->'missingInformation'))=(select count(distinct item#>>'{}') from jsonb_array_elements(value->'missingInformation') item)
$$;
revoke all on function rev_scheduling_private.valid_document_requirements(jsonb) from public,anon,authenticated,service_role;

create table public.scheduling_job_document_analyses (
 id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 job_id uuid not null,
 document_id uuid not null,
 document_version bigint not null check(document_version>=1),
 job_version bigint not null check(job_version>=1),
 provider text not null check(provider='openai'),
 model text not null check(model='gpt-4.1-mini-2025-04-14'),
 status text not null check(status in ('claimed','succeeded','failed')),
 extraction jsonb,
 error_code text check(error_code in ('provider_refused','provider_unavailable','invalid_response')),
 provider_response_id text,
 input_tokens integer check(input_tokens>=0),
 output_tokens integer check(output_tokens>=0),
 version bigint not null check(version in (1,2)),
 created_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 unique(workspace_id,id),
 foreign key(workspace_id,job_id) references public.scheduling_jobs(workspace_id,id),
 foreign key(workspace_id,document_id) references public.scheduling_job_documents(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id),
 check((status='claimed' and extraction is null and error_code is null and version=1 and completed_at is null)
  or (status='succeeded' and rev_scheduling_private.valid_document_requirements(extraction) and error_code is null and provider_response_id is not null and input_tokens is not null and output_tokens is not null and version=2 and completed_at is not null)
  or (status='failed' and extraction is null and error_code is not null and version=2 and completed_at is not null))
);
create index scheduling_job_document_analyses_document_idx on public.scheduling_job_document_analyses(workspace_id,document_id,created_at desc);
alter table public.scheduling_job_document_analyses enable row level security;
revoke all on public.scheduling_job_document_analyses from public,anon,authenticated,service_role;
grant select on public.scheduling_job_document_analyses to authenticated,service_role;
grant insert,update on public.scheduling_job_document_analyses to service_role;
create policy scheduling_job_document_analyses_managers_read on public.scheduling_job_document_analyses for select to authenticated using(public.has_workspace_role(workspace_id,array['owner','admin']));

create function public.claim_rev_scheduling_job_document_analysis(target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_job_id uuid,target_document_id uuid,expected_document_version bigint,expected_job_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing public.scheduling_job_document_analyses;document public.scheduling_job_documents;job public.scheduling_jobs;result jsonb;
begin
 if target_workspace_id is null or initiating_user_id is null or target_request_id is null or target_job_id is null or target_document_id is null or expected_document_version<1 or expected_job_version<1 then raise exception 'Valid analysis request required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspace_members member where member.workspace_id=target_workspace_id and member.user_id=initiating_user_id and member.status='active' and member.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 select analysis.* into existing from public.scheduling_job_document_analyses analysis where analysis.id=target_request_id;
 if found then
  if existing.workspace_id<>target_workspace_id or existing.created_by_user_id<>initiating_user_id or existing.job_id<>target_job_id or existing.document_id<>target_document_id or existing.document_version<>expected_document_version or existing.job_version<>expected_job_version then raise exception 'Analysis request unavailable';end if;
  return pg_catalog.jsonb_build_object('analysis_id',existing.id,'workspace_id',existing.workspace_id,'job_id',existing.job_id,'document_id',existing.document_id,'document_version',existing.document_version,'job_version',existing.job_version,'status',existing.status,'version',existing.version,'should_attempt',false,'extraction',existing.extraction,'error_code',existing.error_code);
 end if;
 select value.* into document from public.scheduling_job_documents value where value.workspace_id=target_workspace_id and value.id=target_document_id and value.job_id=target_job_id and value.status='stored' and value.version=expected_document_version for share;
 if not found then raise exception 'Document unavailable or changed';end if;
 select value.* into job from public.scheduling_jobs value where value.workspace_id=target_workspace_id and value.id=target_job_id and value.status='open' and value.version=expected_job_version for share;
 if not found then raise exception 'Job unavailable or changed';end if;
 insert into public.scheduling_job_document_analyses(id,workspace_id,job_id,document_id,document_version,job_version,provider,model,status,version,created_by_user_id)
 values(target_request_id,target_workspace_id,target_job_id,target_document_id,expected_document_version,expected_job_version,'openai','gpt-4.1-mini-2025-04-14','claimed',1,initiating_user_id) returning * into existing;
 result=pg_catalog.jsonb_build_object('analysis_id',existing.id,'workspace_id',existing.workspace_id,'job_id',existing.job_id,'document_id',existing.document_id,'document_version',existing.document_version,'job_version',existing.job_version,'status',existing.status,'version',existing.version,'should_attempt',true,'extraction',null,'error_code',null);
 return result;
end $$;
revoke all on function public.claim_rev_scheduling_job_document_analysis(uuid,uuid,uuid,uuid,uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.claim_rev_scheduling_job_document_analysis(uuid,uuid,uuid,uuid,uuid,bigint,bigint) to service_role;

create function public.complete_rev_scheduling_job_document_analysis(target_workspace_id uuid,initiating_user_id uuid,target_analysis_id uuid,target_status text,target_extraction jsonb,target_error_code text,target_provider_response_id text,target_input_tokens integer,target_output_tokens integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare saved public.scheduling_job_document_analyses;
begin
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_analysis_id::text,0));
 perform 1 from public.workspace_members member where member.workspace_id=target_workspace_id and member.user_id=initiating_user_id and member.status='active' and member.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 select analysis.* into saved from public.scheduling_job_document_analyses analysis where analysis.workspace_id=target_workspace_id and analysis.id=target_analysis_id for update;
 if not found then raise exception 'Analysis unavailable';end if;
 if saved.status<>'claimed' then return pg_catalog.jsonb_build_object('analysis_id',saved.id,'workspace_id',saved.workspace_id,'job_id',saved.job_id,'document_id',saved.document_id,'document_version',saved.document_version,'job_version',saved.job_version,'status',saved.status,'version',saved.version,'should_attempt',false,'extraction',saved.extraction,'error_code',saved.error_code);end if;
 if (target_status='succeeded' and (not rev_scheduling_private.valid_document_requirements(target_extraction) or target_error_code is not null or target_provider_response_id is null or length(target_provider_response_id) not between 1 and 200 or target_input_tokens is null or target_input_tokens<0 or target_output_tokens is null or target_output_tokens<0))
  or (target_status='failed' and (target_extraction is not null or target_error_code not in ('provider_refused','provider_unavailable','invalid_response')))
  or target_status not in ('succeeded','failed') then raise exception 'Valid analysis result required';end if;
 update public.scheduling_job_document_analyses analysis set status=target_status,extraction=target_extraction,error_code=target_error_code,provider_response_id=case when target_status='succeeded' then target_provider_response_id else null end,input_tokens=case when target_status='succeeded' then target_input_tokens else null end,output_tokens=case when target_status='succeeded' then target_output_tokens else null end,version=2,completed_at=now()
 where analysis.id=target_analysis_id returning * into saved;
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user',case when target_status='succeeded' then 'scheduling.job_document.analysis_succeeded' else 'scheduling.job_document.analysis_failed' end,'scheduling_job_document_analysis',saved.id,pg_catalog.jsonb_build_object('job_id',saved.job_id,'document_id',saved.document_id,'job_version',saved.job_version,'document_version',saved.document_version,'model',saved.model,'status',saved.status,'error_code',saved.error_code,'input_tokens',saved.input_tokens,'output_tokens',saved.output_tokens));
 return pg_catalog.jsonb_build_object('analysis_id',saved.id,'workspace_id',saved.workspace_id,'job_id',saved.job_id,'document_id',saved.document_id,'document_version',saved.document_version,'job_version',saved.job_version,'status',saved.status,'version',saved.version,'should_attempt',false,'extraction',saved.extraction,'error_code',saved.error_code);
end $$;
revoke all on function public.complete_rev_scheduling_job_document_analysis(uuid,uuid,uuid,text,jsonb,text,text,integer,integer) from public,anon,authenticated;
grant execute on function public.complete_rev_scheduling_job_document_analysis(uuid,uuid,uuid,text,jsonb,text,text,integer,integer) to service_role;

create table public.scheduling_job_requirement_reviews (
 id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 job_id uuid not null,
 analysis_id uuid not null,
 job_version bigint not null check(job_version>=1),
 requirements jsonb not null check(rev_scheduling_private.valid_document_requirements(requirements)),
 revision bigint not null check(revision>=1),
 current boolean not null,
 created_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,job_id) references public.scheduling_jobs(workspace_id,id),
 foreign key(workspace_id,analysis_id) references public.scheduling_job_document_analyses(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id)
);
create unique index scheduling_job_requirement_reviews_current_idx on public.scheduling_job_requirement_reviews(workspace_id,job_id) where current;
alter table public.scheduling_job_requirement_reviews enable row level security;
revoke all on public.scheduling_job_requirement_reviews from public,anon,authenticated,service_role;
grant select on public.scheduling_job_requirement_reviews to authenticated,service_role;

create function rev_scheduling_private.invalidate_job_requirement_review() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.version<>old.version then
  update public.scheduling_job_requirement_reviews review set current=false
  where review.workspace_id=new.workspace_id and review.job_id=new.id and review.current;
 end if;
 return new;
end $$;
revoke all on function rev_scheduling_private.invalidate_job_requirement_review() from public,anon,authenticated,service_role;
create trigger scheduling_job_requirement_review_invalidation after update of version on public.scheduling_jobs for each row execute function rev_scheduling_private.invalidate_job_requirement_review();

create function rev_scheduling_private.guard_assignment_unknown_qualifications() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' and new.status='active' and exists(
  select 1
  from public.scheduling_job_requirement_reviews review
  where review.workspace_id=new.workspace_id and review.job_id=new.job_id and review.current
   and pg_catalog.jsonb_array_length(review.requirements->'qualifications')>0
 ) then raise exception 'Worker qualification evidence required';
 end if;
 return new;
end $$;
revoke all on function rev_scheduling_private.guard_assignment_unknown_qualifications() from public,anon,authenticated,service_role;
create trigger scheduling_assignment_confirmed_qualification_guard before insert or update on public.scheduling_assignments for each row execute function rev_scheduling_private.guard_assignment_unknown_qualifications();
grant insert,update on public.scheduling_job_requirement_reviews to service_role;
create policy scheduling_job_requirement_reviews_managers_read on public.scheduling_job_requirement_reviews for select to authenticated using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table rev_scheduling_private.job_requirement_review_requests (
 request_id uuid primary key,workspace_id uuid not null references public.workspaces(id),actor_user_id uuid not null,input jsonb not null,result jsonb not null,created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.job_requirement_review_requests from public,anon,authenticated,service_role;

create function public.confirm_rev_scheduling_job_requirements(target_workspace_id uuid,initiating_user_id uuid,target_request_id uuid,target_job_id uuid,target_analysis_id uuid,expected_analysis_version bigint,target_requirements jsonb,expected_current_review_id uuid,expected_current_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare analysis public.scheduling_job_document_analyses;job public.scheduling_jobs;current_review public.scheduling_job_requirement_reviews;saved public.scheduling_job_requirement_reviews;previous rev_scheduling_private.job_requirement_review_requests;request_input jsonb;result jsonb;confirmed_skills text[];
begin
 if target_workspace_id is null or initiating_user_id is null or target_request_id is null or target_job_id is null or target_analysis_id is null or expected_analysis_version<>2 or expected_current_revision<0 or not rev_scheduling_private.valid_document_requirements(target_requirements) then raise exception 'Valid requirement confirmation required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_workspace_id::text||target_job_id::text,0));
 perform 1 from public.workspace_members member where member.workspace_id=target_workspace_id and member.user_id=initiating_user_id and member.status='active' and member.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 request_input=pg_catalog.jsonb_build_object('job_id',target_job_id,'analysis_id',target_analysis_id,'analysis_version',expected_analysis_version,'requirements',target_requirements,'current_review_id',expected_current_review_id,'current_revision',expected_current_revision);
 select request.* into previous from rev_scheduling_private.job_requirement_review_requests request where request.request_id=target_request_id;
 if found then if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Requirement review request unavailable';end if;return previous.result;end if;
 select value.* into analysis from public.scheduling_job_document_analyses value where value.workspace_id=target_workspace_id and value.id=target_analysis_id and value.job_id=target_job_id and value.status='succeeded' and value.version=expected_analysis_version for share;
 if not found then raise exception 'Successful analysis required';end if;
 select value.* into job from public.scheduling_jobs value where value.workspace_id=target_workspace_id and value.id=target_job_id and value.status='open' and value.version=analysis.job_version for update;
 if not found then raise exception 'Analysis is stale for this job';end if;
 select coalesce(pg_catalog.array_agg(skill order by skill),'{}'::text[]) into confirmed_skills
 from (select distinct pg_catalog.btrim(item->>'value') skill from pg_catalog.jsonb_array_elements(target_requirements->'requiredSkills') item) values;
 if not rev_scheduling_private.valid_tags(confirmed_skills) then raise exception 'Valid confirmed skills required';end if;
 select review.* into current_review from public.scheduling_job_requirement_reviews review where review.workspace_id=target_workspace_id and review.job_id=target_job_id and review.current for update;
 if found then
  if expected_current_review_id is distinct from current_review.id or expected_current_revision<>current_review.revision then raise exception 'Requirement review changed';end if;
  update public.scheduling_job_requirement_reviews review set current=false where review.id=current_review.id;
 else
  if expected_current_review_id is not null or expected_current_revision<>0 then raise exception 'Requirement review changed';end if;
 end if;
 if job.required_skills is distinct from confirmed_skills then
  update public.scheduling_jobs value set required_skills=confirmed_skills,version=value.version+1,updated_by_user_id=initiating_user_id,updated_at=now()
  where value.workspace_id=target_workspace_id and value.id=target_job_id returning * into job;
 end if;
 insert into public.scheduling_job_requirement_reviews(id,workspace_id,job_id,analysis_id,job_version,requirements,revision,current,created_by_user_id)
 values(target_request_id,target_workspace_id,target_job_id,target_analysis_id,job.version,target_requirements,coalesce(current_review.revision,0)+1,true,initiating_user_id) returning * into saved;
 result=pg_catalog.jsonb_build_object('review_id',saved.id,'workspace_id',saved.workspace_id,'job_id',saved.job_id,'analysis_id',saved.analysis_id,'job_version',saved.job_version,'requirements',saved.requirements,'revision',saved.revision,'current',saved.current,'created_at',saved.created_at);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata) values(target_workspace_id,initiating_user_id,'user','scheduling.job_requirements.confirmed','scheduling_job_requirement_review',saved.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'job_id',target_job_id,'analysis_id',target_analysis_id,'job_version',saved.job_version,'revision',saved.revision,'previous_review_id',current_review.id));
 insert into rev_scheduling_private.job_requirement_review_requests(request_id,workspace_id,actor_user_id,input,result) values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end $$;
revoke all on function public.confirm_rev_scheduling_job_requirements(uuid,uuid,uuid,uuid,uuid,bigint,jsonb,uuid,bigint) from public,anon,authenticated;
grant execute on function public.confirm_rev_scheduling_job_requirements(uuid,uuid,uuid,uuid,uuid,bigint,jsonb,uuid,bigint) to service_role;
