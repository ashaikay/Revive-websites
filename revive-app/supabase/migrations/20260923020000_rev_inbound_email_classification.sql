-- REV Phase 4G.4 — Inbound Email Intelligence classification metadata
-- Additive only. Does not enable outbound sending.

alter table public.rev_email_messages
  add column if not exists classification text,
  add column if not exists classification_confidence text,
  add column if not exists classification_reason text,
  add column if not exists classified_at timestamptz;

alter table public.rev_email_messages
  drop constraint if exists rev_email_messages_classification_check;

alter table public.rev_email_messages
  add constraint rev_email_messages_classification_check
  check (
    classification is null
    or classification in (
      'automated',
      'security_system',
      'marketing_newsletter',
      'potential_business',
      'customer_opportunity',
      'unknown'
    )
  );

alter table public.rev_email_messages
  drop constraint if exists rev_email_messages_classification_confidence_check;

alter table public.rev_email_messages
  add constraint rev_email_messages_classification_confidence_check
  check (
    classification_confidence is null
    or classification_confidence in (
      'high',
      'medium',
      'low'
    )
  );

create index if not exists rev_email_messages_classification_idx
  on public.rev_email_messages (
    workspace_id,
    classification,
    created_at desc
  );
