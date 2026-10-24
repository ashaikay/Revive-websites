begin;

create table public.programme_hub_vocational_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id),
  programme_id uuid,
  title text not null check (
    length(btrim(title)) between 1 and 160
    and title = btrim(title)
  ),
  description text not null default '',
  status text not null default 'draft'
    check (status in ('draft','published','archived')),
  version bigint not null default 1 check (version >= 1),
  sections jsonb not null default '[]'::jsonb
    check (jsonb_typeof(sections) = 'array'),
  created_by_user_id uuid not null,
  updated_by_user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz,
  unique (workspace_id, id),
  foreign key (workspace_id, programme_id)
    references public.programme_hub_programmes(workspace_id,id),
  foreign key (workspace_id, created_by_user_id)
    references public.workspace_members(workspace_id,user_id),
  foreign key (workspace_id, updated_by_user_id)
    references public.workspace_members(workspace_id,user_id)
);

create table public.programme_hub_vocational_template_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  template_id uuid not null,
  version bigint not null check (version >= 1),
  title text not null,
  sections jsonb not null check (jsonb_typeof(sections) = 'array'),
  published_by_user_id uuid not null,
  published_at timestamptz not null default now(),
  unique (workspace_id, template_id, version),
  foreign key (workspace_id, template_id)
    references public.programme_hub_vocational_templates(workspace_id,id),
  foreign key (workspace_id, published_by_user_id)
    references public.workspace_members(workspace_id,user_id)
);

create index rev_vocational_templates_programme_idx
on public.programme_hub_vocational_templates(workspace_id,programme_id);

create index rev_vocational_versions_template_idx
on public.programme_hub_vocational_template_versions(workspace_id,template_id);

alter table public.programme_hub_vocational_templates
enable row level security;

alter table public.programme_hub_vocational_template_versions
enable row level security;

revoke all on public.programme_hub_vocational_templates
from public,anon,authenticated;

revoke all on public.programme_hub_vocational_template_versions
from public,anon,authenticated;

grant select on public.programme_hub_vocational_templates
to authenticated;

grant select on public.programme_hub_vocational_template_versions
to authenticated;

grant all on public.programme_hub_vocational_templates
to service_role;

grant all on public.programme_hub_vocational_template_versions
to service_role;

create policy rev_vocational_templates_read
on public.programme_hub_vocational_templates
for select to authenticated
using (
  public.can_use_rev_module(workspace_id,'programme')
  and (
    (
      programme_id is null
      and public.has_workspace_role(
        workspace_id,array['owner','admin']
      )
    )
    or (
      programme_id is not null
      and public.can_access_rev_programme(
        workspace_id,programme_id
      )
      and (
        status = 'published'
        or public.has_workspace_role(workspace_id,array['owner','admin'])
      )
    )
  )
);

create policy rev_vocational_versions_read
on public.programme_hub_vocational_template_versions
for select to authenticated
using (
  exists (
    select 1
    from public.programme_hub_vocational_templates t
    where t.workspace_id =
      programme_hub_vocational_template_versions.workspace_id
      and t.id =
      programme_hub_vocational_template_versions.template_id
  )
);

-- Published snapshots cannot be edited or deleted.
create function public.rev_vocational_versions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Published vocational template versions are immutable'
    using errcode = '42501';
end;
$$;

create trigger rev_vocational_versions_immutable
before update or delete
on public.programme_hub_vocational_template_versions
for each row
execute function public.rev_vocational_versions_immutable();

revoke all on function public.rev_vocational_versions_immutable()
from public, anon, authenticated;

commit;
