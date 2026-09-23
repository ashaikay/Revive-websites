create table if not exists public.workspace_email_mailboxes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider_key text not null default 'microsoft_graph',
  mailbox_user_id text not null,
  mailbox_email text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint workspace_email_mailboxes_provider_check
    check (provider_key in ('microsoft_graph')),

  constraint workspace_email_mailboxes_workspace_provider_unique
    unique (workspace_id, provider_key)
);

create index if not exists idx_workspace_email_mailboxes_workspace
  on public.workspace_email_mailboxes(workspace_id);

alter table public.workspace_email_mailboxes enable row level security;

create policy "Active workspace members can view mailbox configuration"
on public.workspace_email_mailboxes
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_email_mailboxes.workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  )
);
