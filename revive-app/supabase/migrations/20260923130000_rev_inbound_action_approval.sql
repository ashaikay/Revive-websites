-- Phase 4G.4: bind inbound durable REV actions to the existing approval control plane.

-- Backfill approval bindings for existing inbound durable actions.
insert into public.approvals (
  workspace_id,
  rev_action_id,
  action_version,
  action_fingerprint
)
select
  a.workspace_id,
  a.id,
  a.action_version,
  public.rev_action_material_fingerprint(a)
from public.rev_actions a
join public.rev_email_messages m
  on m.workspace_id = a.workspace_id
 and m.rev_action_id = a.id
where a.requires_approval is true
  and a.status = 'awaiting_approval'
  and a.execution_status = 'not_executed'
  and not exists (
    select 1
    from public.approvals ap
    where ap.workspace_id = a.workspace_id
      and ap.rev_action_id = a.id
      and ap.decision is null
  );

-- Preserve approval history while allowing only one pending review per REV action.
create unique index if not exists approvals_one_pending_per_action_idx
  on public.approvals (workspace_id, rev_action_id)
  where decision is null;


create or replace function public.create_inbound_rev_action(
  target_workspace_id uuid,
  target_message_id uuid
)
returns table (
  action_id uuid,
  created boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  locked_message public.rev_email_messages%rowtype;
  new_action public.rev_actions%rowtype;
  action_fingerprint text;
begin
  if current_user <> 'service_role' then
    raise exception 'service_role required';
  end if;

  select *
  into locked_message
  from public.rev_email_messages
  where workspace_id = target_workspace_id
    and id = target_message_id
  for update;

  if not found then
    raise exception 'Inbound message not found';
  end if;

  if locked_message.rev_action_id is not null then
    return query select locked_message.rev_action_id, false;
    return;
  end if;

  if locked_message.direction <> 'inbound' then
    raise exception 'Message is not inbound';
  end if;

  if locked_message.contact_id is null
     or locked_message.opportunity_id is null then
    raise exception 'Matched contact and opportunity required';
  end if;

  if locked_message.classification <> 'customer_opportunity' then
    raise exception 'Customer opportunity classification required';
  end if;

  if locked_message.recommended_action is null
     or locked_message.recommended_action_requires_approval is not true then
    raise exception 'Approval-required recommendation required';
  end if;

  if locked_message.recommended_action not in (
    'schedule_call',
    'prepare_follow_up',
    'prepare_answer',
    'stop_outreach',
    'human_review'
  ) then
    raise exception 'Unsupported recommended action';
  end if;

  insert into public.rev_actions (
    workspace_id,
    goal_id,
    contact_id,
    opportunity_id,
    action_type,
    title,
    description,
    rationale,
    requires_approval,
    status,
    execution_status,
    action_version
  )
  values (
    target_workspace_id,
    null,
    locked_message.contact_id,
    locked_message.opportunity_id,
    locked_message.recommended_action,
    'Customer reply: ' || locked_message.recommended_action,
    coalesce(
      nullif(btrim(locked_message.subject), ''),
      'Inbound customer reply from ' || locked_message.sender_email
    ),
    locked_message.recommended_action_reason,
    true,
    'awaiting_approval',
    'not_executed',
    1
  )
  returning * into new_action;

  action_fingerprint :=
    public.rev_action_material_fingerprint(new_action);

  insert into public.approvals (
    workspace_id,
    rev_action_id,
    action_version,
    action_fingerprint
  )
  values (
    target_workspace_id,
    new_action.id,
    new_action.action_version,
    action_fingerprint
  );

  update public.rev_email_messages
  set rev_action_id = new_action.id
  where workspace_id = target_workspace_id
    and id = target_message_id;

  insert into public.audit_log (
    workspace_id,
    actor_user_id,
    actor_type,
    action,
    resource_type,
    resource_id,
    metadata
  )
  values (
    target_workspace_id,
    null,
    'rev',
    'rev_action.proposed_from_inbound_email',
    'rev_action',
    new_action.id,
    pg_catalog.jsonb_build_object(
      'inbound_message_id', target_message_id,
      'contact_id', locked_message.contact_id,
      'opportunity_id', locked_message.opportunity_id,
      'recommended_action', locked_message.recommended_action,
      'requires_approval', true,
      'action_version', new_action.action_version,
      'action_fingerprint', action_fingerprint
    )
  );

  return query select new_action.id, true;
end;
$$;

revoke all on function public.create_inbound_rev_action(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.create_inbound_rev_action(uuid, uuid)
to service_role;
