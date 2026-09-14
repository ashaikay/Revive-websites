-- Phase 2B rollback script. Review against the existing frozen project before use.
-- This script is intentionally not executed by the application.

drop policy if exists audit_log_tenant on public.audit_log;
drop policy if exists memory_events_tenant on public.business_memory_events;
drop policy if exists approvals_tenant on public.approvals;
drop policy if exists rev_actions_tenant on public.rev_actions;
drop policy if exists contacts_tenant on public.contacts;
drop policy if exists goals_tenant on public.goals;
drop policy if exists business_services_tenant on public.business_services;
drop policy if exists business_profiles_tenant on public.business_profiles;
drop policy if exists workspace_members_manage on public.workspace_members;
drop policy if exists workspace_members_select on public.workspace_members;
drop policy if exists workspaces_update on public.workspaces;
drop policy if exists workspaces_select on public.workspaces;

drop function if exists public.create_workspace_with_owner(text, text);
drop function if exists public.has_workspace_role(uuid, text[]);
drop function if exists public.is_active_workspace_member(uuid);

drop table if exists public.audit_log;
drop table if exists public.business_memory_events;
drop table if exists public.approvals;
drop table if exists public.rev_actions;
drop table if exists public.contacts;
drop table if exists public.goals;
drop table if exists public.business_services;
drop table if exists public.business_profiles;
drop table if exists public.workspace_members;
drop table if exists public.workspaces;
