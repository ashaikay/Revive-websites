-- Do not run this rollback after meeting proposal evidence exists; use a forward fix.
do $$
begin
  if exists (select 1 from public.meeting_proposals) then
    raise exception 'Phase 5J data exists; use a forward-fix instead of dropping evidence.';
  end if;
end;
$$;
drop policy if exists rev_actions_meeting_proposal_select_restrict on public.rev_actions;
drop policy if exists rev_actions_meeting_proposal_update_restrict on public.rev_actions;
drop policy if exists rev_actions_meeting_proposal_insert_restrict on public.rev_actions;
drop function if exists public.submit_meeting_proposal(uuid, uuid, text, text, timestamptz, timestamptz, text, text, text, text, text);
drop policy if exists meeting_proposals_select on public.meeting_proposals;
drop table if exists public.meeting_proposals;