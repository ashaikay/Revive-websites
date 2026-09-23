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
  new_action_id uuid;
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
    return query
      select locked_message.rev_action_id, false;
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
  returning id into new_action_id;

  update public.rev_email_messages
  set rev_action_id = new_action_id
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
    new_action_id,
    jsonb_build_object(
      'inbound_message_id', target_message_id,
      'contact_id', locked_message.contact_id,
      'opportunity_id', locked_message.opportunity_id,
      'recommended_action', locked_message.recommended_action,
      'requires_approval', true
    )
  );

  return query
    select new_action_id, true;
end;
$$;

revoke all on function public.create_inbound_rev_action(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.create_inbound_rev_action(uuid, uuid)
to service_role;
