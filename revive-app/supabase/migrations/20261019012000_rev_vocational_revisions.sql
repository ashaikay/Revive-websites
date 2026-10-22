-- Run in LOCAL Supabase Studio first. Additive; no reset or destructive migration.
begin;
alter table public.programme_hub_vocational_templates
  add column if not exists revises_template_id uuid;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rev_vocational_revises_fk') then
    alter table public.programme_hub_vocational_templates
      add constraint rev_vocational_revises_fk
      foreign key (workspace_id,revises_template_id)
      references public.programme_hub_vocational_templates(workspace_id,id);
  end if;
end $$;
create unique index if not exists rev_vocational_one_draft_per_parent
  on public.programme_hub_vocational_templates(workspace_id,revises_template_id)
  where revises_template_id is not null and status = 'draft';

create or replace function public.rev_vocational_create_revision(
  target_workspace_id uuid, target_template_id uuid, expected_version bigint
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  actor uuid := auth.uid();
  original public.programme_hub_vocational_templates;
  existing public.programme_hub_vocational_templates;
  created public.programme_hub_vocational_templates;
begin
  if actor is null or target_workspace_id is null or target_template_id is null
    or not public.has_workspace_role(target_workspace_id,array['owner','admin'])
    or not public.can_use_rev_module(target_workspace_id,'programme') then
    raise exception 'Programme manager required' using errcode='42501';
  end if;
  perform 1 from public.workspaces where id=target_workspace_id and status='active';
  if not found then raise exception 'Workspace unavailable' using errcode='42501'; end if;
  select * into original from public.programme_hub_vocational_templates
    where workspace_id=target_workspace_id and id=target_template_id for update;
  if not found or original.status <> 'published' or original.version <> expected_version then
    raise exception 'Published version unavailable or changed' using errcode='40001';
  end if;
  if original.programme_id is not null and not exists (
    select 1 from public.programme_hub_programmes
    where workspace_id=target_workspace_id and id=original.programme_id and active
  ) then raise exception 'Programme unavailable' using errcode='42501'; end if;
  select * into existing from public.programme_hub_vocational_templates
    where workspace_id=target_workspace_id and revises_template_id=target_template_id
      and status='draft' for update;
  if found then
    return jsonb_build_object('id',existing.id,'version',existing.version,'status',existing.status);
  end if;
  insert into public.programme_hub_vocational_templates
    (workspace_id,programme_id,title,description,status,version,sections,
     created_by_user_id,updated_by_user_id,revises_template_id)
  values (target_workspace_id,original.programme_id,original.title,original.description,
    'draft',original.version+1,original.sections,actor,actor,original.id)
  returning * into created;
  return jsonb_build_object('id',created.id,'version',created.version,'status',created.status);
end;
$$;
revoke all on function public.rev_vocational_create_revision(uuid,uuid,bigint) from public,anon;
grant execute on function public.rev_vocational_create_revision(uuid,uuid,bigint) to authenticated;
commit;
