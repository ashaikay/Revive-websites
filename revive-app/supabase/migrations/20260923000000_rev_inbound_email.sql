-- REV Phase 4G.3 — Inbound Email & Reply Intelligence
-- Foundation storage only.
-- This migration does NOT enable Microsoft Graph mailbox reading,
-- polling, subscriptions, AI replies, or outbound sending.

create table if not exists public.rev_email_threads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid,
  opportunity_id uuid,

  provider_key text not null default 'microsoft_graph',
  provider_conversation_id text,

  subject text,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (workspace_id, id),

  foreign key (workspace_id, contact_id)
    references public.contacts(workspace_id, id),

  foreign key (workspace_id, opportunity_id)
    references public.opportunities(workspace_id, id)
);

create table if not exists public.rev_email_messages (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  thread_id uuid not null,
  contact_id uuid,
  opportunity_id uuid,
  execution_id uuid,

  provider_key text not null default 'microsoft_graph',
  provider_message_id text not null,

  direction text not null
    check (direction in ('inbound', 'outbound')),

  sender_email text not null,
  recipient_emails text[] not null default '{}'::text[],

  subject text,
  body_text text,

  received_at timestamptz,
  sent_at timestamptz,

  processing_status text not null default 'stored'
    check (
      processing_status in (
        'stored',
        'matched',
        'needs_review',
        'processed',
        'ignored',
        'failed'
      )
    ),

  created_at timestamptz not null default now(),

  unique (workspace_id, id),
  unique (workspace_id, provider_key, provider_message_id),

  foreign key (workspace_id, thread_id)
    references public.rev_email_threads(workspace_id, id)
    on delete cascade,

  foreign key (workspace_id, contact_id)
    references public.contacts(workspace_id, id),

  foreign key (workspace_id, opportunity_id)
    references public.opportunities(workspace_id, id),

  foreign key (workspace_id, execution_id)
    references public.rev_action_executions(workspace_id, id),

  check (
    (direction = 'inbound' and received_at is not null)
    or
    (direction = 'outbound' and sent_at is not null)
  )
);

create index if not exists rev_email_threads_workspace_contact_idx
  on public.rev_email_threads(workspace_id, contact_id);

create index if not exists rev_email_threads_workspace_opportunity_idx
  on public.rev_email_threads(workspace_id, opportunity_id);

create index if not exists rev_email_threads_provider_conversation_idx
  on public.rev_email_threads(
    workspace_id,
    provider_key,
    provider_conversation_id
  );

create index if not exists rev_email_messages_thread_time_idx
  on public.rev_email_messages(
    workspace_id,
    thread_id,
    created_at desc
  );

create index if not exists rev_email_messages_contact_idx
  on public.rev_email_messages(
    workspace_id,
    contact_id,
    created_at desc
  );

create index if not exists rev_email_messages_processing_idx
  on public.rev_email_messages(
    workspace_id,
    processing_status,
    created_at
  );

alter table public.rev_email_threads enable row level security;
alter table public.rev_email_messages enable row level security;

-- Read access follows existing workspace membership.
-- No direct client INSERT/UPDATE/DELETE policies are created here.
-- Inbound ingestion will later occur through a trusted server-side boundary.

create policy "Workspace members can read REV email threads"
on public.rev_email_threads
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = rev_email_threads.workspace_id
      and wm.user_id = auth.uid()
      and wm.status = 'active'
  )
);

create policy "Workspace members can read REV email messages"
on public.rev_email_messages
for select
to authenticated
using (
  exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = rev_email_messages.workspace_id
  and wm.user_id = auth.uid()
  and wm.status = 'active'

  )
);