-- Phase 4G.4: bind an inbound email message to at most one durable REV action.
-- This creates approval-required work only. It does not execute any action.

alter table public.rev_email_messages
  add column if not exists rev_action_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'rev_email_messages_rev_action_fk'
      and conrelid = 'public.rev_email_messages'::regclass
  ) then
    alter table public.rev_email_messages
      add constraint rev_email_messages_rev_action_fk
      foreign key (workspace_id, rev_action_id)
      references public.rev_actions(workspace_id, id);
  end if;
end;
$$;

create unique index if not exists rev_email_messages_rev_action_unique
  on public.rev_email_messages(workspace_id, rev_action_id)
  where rev_action_id is not null;
