-- REV Phase 3E proposed Opportunity domain schema.
-- PROPOSAL ONLY: do not apply to the frozen Revive Supabase project without explicit approval.
-- This migration is not referenced by any deployment step in this phase.
-- Revised after the Phase 3E.1 architecture/security review (see PHASE_3E_OPPORTUNITY_DOMAIN.md).

create table if not exists public.opportunities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null,
  title text not null,
  description text,
  opportunity_type text not null check (opportunity_type in ('commercial_lead', 'tender', 'contract', 'grant', 'partnership')),
  stage text not null default 'new' check (stage in ('new', 'qualified', 'contacted', 'conversation', 'appointment', 'quote', 'follow_up', 'won', 'lost', 'dormant')),
  source text not null check (source in ('existing_customer', 'referral', 'website_enquiry', 'manual_lead', 'rev_prospect_discovery', 'rev_reactivation', 'tender', 'grant', 'campaign', 'social', 'partner', 'other')),
  estimated_value numeric(12, 2) check (estimated_value is null or estimated_value >= 0),
  currency text not null default 'GBP' check (currency ~ '^[A-Z]{3}$'),
  probability numeric(3, 2) check (probability is null or (probability >= 0 and probability <= 1)),
  attribution text not null default 'unattributed' check (attribution in ('owner_generated', 'rev_generated', 'rev_assisted', 'rev_recovered', 'unattributed')),
  created_by_type text not null check (created_by_type in ('user', 'rev', 'system')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_activity_at timestamptz,
  next_action_at timestamptz,
  won_at timestamptz,
  lost_at timestamptz,
  lost_reason text,
  metadata jsonb not null default '{}'::jsonb,
  unique (workspace_id, id),
  foreign key (workspace_id, contact_id) references public.contacts(workspace_id, id)
);

-- Link REV actions (outreach drafts etc.) to the opportunity they progress, in addition to the
-- existing goal/contact linkage. Nullable and additive; does not change existing rev_actions rows.
alter table public.rev_actions add column if not exists opportunity_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'rev_actions_opportunity_fk') then
    alter table public.rev_actions add constraint rev_actions_opportunity_fk
      foreign key (workspace_id, opportunity_id) references public.opportunities(workspace_id, id);
  end if;
end $$;

-- Compliance/suppression concept. One row per contact per workspace; presence of a row means
-- outreach must not be prepared for that contact until the row is removed by an authorised user.
-- V1 is a single suppression per contact (not per-channel). A future per-channel preference model
-- (e.g. email unsubscribed but SMS/phone still permitted) would need a `channel` column added here
-- and the primary key widened to (workspace_id, contact_id, channel); this table is deliberately
-- kept simple for now rather than over-built ahead of a real send/reply integration.
create table if not exists public.contact_suppressions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  contact_id uuid not null,
  reason text not null check (reason in ('do_not_contact', 'unsubscribed', 'bounced', 'invalid_contact', 'frequency_cap')),
  recorded_at timestamptz not null default now(),
  primary key (workspace_id, contact_id),
  foreign key (workspace_id, contact_id) references public.contacts(workspace_id, id)
);

create index if not exists opportunities_workspace_idx on public.opportunities(workspace_id);
create index if not exists opportunities_contact_idx on public.opportunities(workspace_id, contact_id);
create index if not exists opportunities_stage_idx on public.opportunities(workspace_id, stage);
create index if not exists opportunities_next_action_idx on public.opportunities(workspace_id, next_action_at);
create index if not exists rev_actions_opportunity_idx on public.rev_actions(workspace_id, opportunity_id);

alter table public.opportunities enable row level security;
alter table public.contact_suppressions enable row level security;

-- Reuses the existing is_active_workspace_member() helper from 20260912162730_rev_core.sql;
-- no new SECURITY DEFINER function is introduced by this proposal.
--
-- Split into separate select/insert/update policies (no delete policy) rather than a single
-- `for all` policy: commercial/attribution history must not be casually destroyed, so opportunities
-- support only a restricted, no-hard-delete lifecycle (mark 'lost'/'dormant' instead of deleting).
create policy opportunities_select on public.opportunities for select
  using (public.is_active_workspace_member(workspace_id));
create policy opportunities_insert on public.opportunities for insert
  with check (public.is_active_workspace_member(workspace_id));
create policy opportunities_update on public.opportunities for update
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

-- Suppression rows may legitimately be removed by an authorised member (e.g. un-suppressing a
-- contact), so this table keeps the standard all-operations tenant policy.
create policy contact_suppressions_tenant on public.contact_suppressions for all
  using (public.is_active_workspace_member(workspace_id))
  with check (public.is_active_workspace_member(workspace_id));

-- Defense in depth beyond RLS: block mutation of identity/provenance fields even by a member who
-- belongs to more than one workspace (RLS alone permits an update whose USING and WITH CHECK both
-- pass membership, which does not by itself prevent moving a row between two workspaces the same
-- user belongs to). This is a plain trigger function (not SECURITY DEFINER); it runs with the
-- caller's own privileges and does not bypass RLS.
create or replace function public.prevent_opportunity_identity_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.workspace_id is distinct from old.workspace_id then
    raise exception 'workspace_id is immutable on public.opportunities';
  end if;
  if new.contact_id is distinct from old.contact_id then
    raise exception 'contact_id is immutable on public.opportunities';
  end if;
  if new.created_at is distinct from old.created_at then
    raise exception 'created_at is immutable on public.opportunities';
  end if;
  if new.created_by_type is distinct from old.created_by_type then
    raise exception 'created_by_type is immutable on public.opportunities';
  end if;
  return new;
end;
$$;

-- Explicit hardening rather than relying on default privileges (per the Phase 2D function-ACL
-- lesson): this is a plain trigger function, never intended to be callable directly by any role.
-- Postgres invokes trigger functions internally regardless of a role's own EXECUTE grants, so
-- revoking EXECUTE here cannot break the trigger itself; it only removes any direct-call surface.
revoke all on function public.prevent_opportunity_identity_mutation() from public;
revoke all on function public.prevent_opportunity_identity_mutation() from anon;
revoke all on function public.prevent_opportunity_identity_mutation() from authenticated;

drop trigger if exists opportunities_identity_immutable on public.opportunities;
create trigger opportunities_identity_immutable
  before update on public.opportunities
  for each row execute function public.prevent_opportunity_identity_mutation();


