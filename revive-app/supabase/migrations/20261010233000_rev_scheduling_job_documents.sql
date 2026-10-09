insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('rev-scheduling-job-documents','rev-scheduling-job-documents',false,2097152,array['application/pdf','text/plain'])
on conflict (id) do nothing;
do $$
begin
 if not exists(
  select 1 from storage.buckets
  where id='rev-scheduling-job-documents'
   and name='rev-scheduling-job-documents'
   and public=false
   and file_size_limit=2097152
   and allowed_mime_types=array['application/pdf','text/plain']::text[]
 ) then raise exception 'Job document bucket configuration conflict';end if;
end;
$$;

create table public.scheduling_job_documents (
 id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 job_id uuid not null,
 original_name text not null check(length(original_name) between 1 and 180 and original_name=trim(original_name) and original_name!~ E'[\\\\/\\x00-\\x1f\\x7f]'),
 mime_type text not null check(mime_type in ('application/pdf','text/plain')),
 size_bytes integer not null check(size_bytes between 1 and 2097152),
 sha256 text not null check(sha256~'^[0-9a-f]{64}$'),
 storage_path text not null unique check(length(storage_path) between 1 and 600 and storage_path not like '%..%'),
 status text not null check(status='stored'),
 version bigint not null default 1 check(version=1),
 created_by_user_id uuid not null,
 created_at timestamptz not null default now(),
 unique(workspace_id,id),
 foreign key(workspace_id,job_id) references public.scheduling_jobs(workspace_id,id),
 foreign key(workspace_id,created_by_user_id) references public.workspace_members(workspace_id,user_id)
);
create index scheduling_job_documents_job_idx on public.scheduling_job_documents(workspace_id,job_id,created_at desc);
alter table public.scheduling_job_documents enable row level security;
revoke all on public.scheduling_job_documents from public,anon,authenticated,service_role;
grant select on public.scheduling_job_documents to authenticated,service_role;
grant insert on public.scheduling_job_documents to service_role;
create policy scheduling_job_documents_managers_read on public.scheduling_job_documents
for select to authenticated using(public.has_workspace_role(workspace_id,array['owner','admin']));

create table rev_scheduling_private.job_document_requests (
 request_id uuid primary key,
 workspace_id uuid not null references public.workspaces(id),
 actor_user_id uuid not null,
 input jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 foreign key(workspace_id,actor_user_id) references public.workspace_members(workspace_id,user_id)
);
revoke all on rev_scheduling_private.job_document_requests from public,anon,authenticated,service_role;

create function public.save_rev_scheduling_job_document(
 target_workspace_id uuid,
 initiating_user_id uuid,
 target_request_id uuid,
 target_job_id uuid,
 target_original_name text,
 target_mime_type text,
 target_size_bytes integer,
 target_sha256 text,
 target_storage_path text
) returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
 previous rev_scheduling_private.job_document_requests;
 saved public.scheduling_job_documents;
 request_input jsonb;
 result jsonb;
begin
 if target_workspace_id is null or initiating_user_id is null or target_request_id is null or target_job_id is null
  or target_original_name is null or length(target_original_name) not between 1 and 180 or target_original_name<>trim(target_original_name) or target_original_name~E'[\\\\/\\x00-\\x1f\\x7f]'
  or target_mime_type not in ('application/pdf','text/plain')
  or target_size_bytes not between 1 and 2097152
  or target_sha256 is null or target_sha256!~'^[0-9a-f]{64}$'
  or target_storage_path is null or length(target_storage_path) not between 1 and 600 or target_storage_path like '%..%'
  or target_storage_path not like target_workspace_id::text||'/'||target_job_id::text||'/'||target_request_id::text||'/%'
 then raise exception 'Valid job document required';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(target_request_id::text,0));
 perform 1 from public.workspaces workspace where workspace.id=target_workspace_id for update;
 if not found then raise exception 'Workspace unavailable';end if;
 perform 1 from public.workspace_members member where member.workspace_id=target_workspace_id and member.user_id=initiating_user_id and member.status='active' and member.role in ('owner','admin') for share;
 if not found then raise exception 'Active owner or admin required';end if;
 perform 1 from public.scheduling_jobs job where job.workspace_id=target_workspace_id and job.id=target_job_id and job.status='open' for share;
 if not found then raise exception 'Open job required';end if;
 request_input=pg_catalog.jsonb_build_object('job_id',target_job_id,'original_name',target_original_name,'mime_type',target_mime_type,'size_bytes',target_size_bytes,'sha256',target_sha256,'storage_path',target_storage_path);
 select request.* into previous from rev_scheduling_private.job_document_requests request where request.request_id=target_request_id;
 if found then
  if previous.workspace_id<>target_workspace_id or previous.actor_user_id<>initiating_user_id or previous.input<>request_input then raise exception 'Job document request unavailable';end if;
  return previous.result;
 end if;
 insert into public.scheduling_job_documents(id,workspace_id,job_id,original_name,mime_type,size_bytes,sha256,storage_path,status,created_by_user_id)
 values(target_request_id,target_workspace_id,target_job_id,target_original_name,target_mime_type,target_size_bytes,target_sha256,target_storage_path,'stored',initiating_user_id)
 returning * into saved;
 result=pg_catalog.jsonb_build_object('document_id',saved.id,'workspace_id',saved.workspace_id,'job_id',saved.job_id,'original_name',saved.original_name,'mime_type',saved.mime_type,'size_bytes',saved.size_bytes,'sha256',saved.sha256,'status',saved.status,'version',saved.version,'created_at',saved.created_at);
 insert into public.audit_log(workspace_id,actor_user_id,actor_type,action,resource_type,resource_id,metadata)
 values(target_workspace_id,initiating_user_id,'user','scheduling.job_document.uploaded','scheduling_job_document',saved.id,pg_catalog.jsonb_build_object('request_id',target_request_id,'job_id',target_job_id,'mime_type',target_mime_type,'size_bytes',target_size_bytes,'sha256',target_sha256));
 insert into rev_scheduling_private.job_document_requests(request_id,workspace_id,actor_user_id,input,result)
 values(target_request_id,target_workspace_id,initiating_user_id,request_input,result);
 return result;
end;
$$;
revoke all on function public.save_rev_scheduling_job_document(uuid,uuid,uuid,uuid,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.save_rev_scheduling_job_document(uuid,uuid,uuid,uuid,text,text,integer,text,text) to service_role;
