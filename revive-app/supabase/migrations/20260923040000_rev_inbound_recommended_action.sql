-- REV Phase 4G.4 — Inbound recommended action metadata
-- Recommendation only. Does not execute external actions.

alter table public.rev_email_messages
  add column if not exists recommended_action text,
  add column if not exists recommended_action_reason text,
  add column if not exists recommended_action_requires_approval boolean,
  add column if not exists recommended_action_at timestamptz;

alter table public.rev_email_messages
  drop constraint if exists rev_email_messages_recommended_action_check;

alter table public.rev_email_messages
  add constraint rev_email_messages_recommended_action_check
  check (
    recommended_action is null
    or recommended_action in (
      'schedule_call',
      'prepare_follow_up',
      'prepare_answer',
      'stop_outreach',
      'human_review'
    )
  );

create index if not exists rev_email_messages_recommended_action_idx
  on public.rev_email_messages (
    workspace_id,
    recommended_action,
    received_at desc
  );
