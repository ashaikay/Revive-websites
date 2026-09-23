-- REV Phase 4G.4 — Customer reply intent metadata
-- Additive only. Does not enable outbound sending.

alter table public.rev_email_messages
  add column if not exists reply_intent text,
  add column if not exists reply_intent_confidence text,
  add column if not exists reply_intent_reason text,
  add column if not exists intent_detected_at timestamptz;

alter table public.rev_email_messages
  drop constraint if exists rev_email_messages_reply_intent_check;

alter table public.rev_email_messages
  add constraint rev_email_messages_reply_intent_check
  check (
    reply_intent is null
    or reply_intent in (
      'interested',
      'question',
      'wants_contact',
      'not_interested',
      'complaint',
      'unknown'
    )
  );

alter table public.rev_email_messages
  drop constraint if exists rev_email_messages_reply_intent_confidence_check;

alter table public.rev_email_messages
  add constraint rev_email_messages_reply_intent_confidence_check
  check (
    reply_intent_confidence is null
    or reply_intent_confidence in ('high', 'medium', 'low')
  );

create index if not exists rev_email_messages_reply_intent_idx
  on public.rev_email_messages (
    workspace_id,
    reply_intent,
    received_at desc
  );
