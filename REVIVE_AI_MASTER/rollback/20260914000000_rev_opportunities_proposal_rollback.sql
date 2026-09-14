-- Rollback for the PROPOSED (not applied) 20260914000000_rev_opportunities_proposal.sql.
-- Only relevant if that migration is ever approved and applied in the future.

drop trigger if exists opportunities_identity_immutable on public.opportunities;
drop function if exists public.prevent_opportunity_identity_mutation();

drop policy if exists contact_suppressions_tenant on public.contact_suppressions;
drop policy if exists opportunities_update on public.opportunities;
drop policy if exists opportunities_insert on public.opportunities;
drop policy if exists opportunities_select on public.opportunities;

drop index if exists public.rev_actions_opportunity_idx;
drop index if exists public.opportunities_next_action_idx;
drop index if exists public.opportunities_stage_idx;
drop index if exists public.opportunities_contact_idx;
drop index if exists public.opportunities_workspace_idx;

drop table if exists public.contact_suppressions;

alter table public.rev_actions drop constraint if exists rev_actions_opportunity_fk;
alter table public.rev_actions drop column if exists opportunity_id;

drop table if exists public.opportunities;
