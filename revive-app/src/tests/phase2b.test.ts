import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMockDataProvider } from '@/data/mockProvider';
import { seedData } from '@/data/seedFixtures';
import { ApprovalService } from '@/services/approvalService';
import { ContactService } from '@/services/contactService';
import { GoalService } from '@/services/goalService';
import { BusinessMemoryService } from '@/services/businessMemoryService';
import { authProvider } from '@/services/authService';
import { dataProviderMode } from '@/data/provider';
import { supabaseAdapter } from '@/data/supabaseAdapter';
import { supabaseReadProvider } from '@/data/supabaseProvider';

function createProvider() {
  return createMockDataProvider(seedData);
}

function migrationSql() {
  return readFileSync(new URL('../../supabase/migrations/20260912162730_rev_core.sql', import.meta.url), 'utf8');
}

function aclRemediationSql() {
  return readFileSync(new URL('../../supabase/migrations/20260912170332_rev_function_acl_hardening.sql', import.meta.url), 'utf8');
}

describe('Phase 2B tenant isolation', () => {
  it('keeps workspace records isolated through repository calls', () => {
    const provider = createProvider();
    const reviveContacts = provider.contacts.list('workspace-1');
    const familyContacts = provider.contacts.list('workspace-2');

    expect(reviveContacts.every((contact) => contact.workspaceId === 'workspace-1')).toBe(true);
    expect(familyContacts.every((contact) => contact.workspaceId === 'workspace-2')).toBe(true);
    expect(reviveContacts.some((contact) => contact.id === 'contact-3')).toBe(false);
    expect(provider.contacts.get('workspace-1', 'contact-3')).toBeUndefined();
    expect(provider.goals.list('workspace-1').some((goal) => goal.workspaceId === 'workspace-2')).toBe(false);
  });

  it('keeps memory events scoped by workspace and entity', () => {
    const memory = new BusinessMemoryService(createProvider());
    expect(memory.recent('workspace-1').every((event) => event.workspaceId === 'workspace-1')).toBe(true);
    expect(memory.forContact('workspace-1', 'contact-3')).toHaveLength(0);
    expect(memory.forContact('workspace-2', 'contact-3')).toHaveLength(1);
  });

  it('allows active members to see only their authorised workspaces', () => {
    const data = structuredClone(seedData);
    data.members.push({ workspaceId: 'workspace-2', userId: 'user-2', role: 'member', status: 'active', joinedAt: '2024-12-20T09:00:00.000Z' });
    const provider = createMockDataProvider(data);

    expect(provider.workspaces.listForUser('user-1').map((workspace) => workspace.id)).toEqual(['workspace-1', 'workspace-2']);
    expect(provider.workspaces.listForUser('user-2').map((workspace) => workspace.id)).toEqual(['workspace-2']);
  });

  it('denies inactive membership and cross-tenant service access', () => {
    const data = structuredClone(seedData);
    data.members.push({ workspaceId: 'workspace-2', userId: 'user-2', role: 'member', status: 'suspended', joinedAt: '2024-12-20T09:00:00.000Z' });
    const provider = createMockDataProvider(data);
    const contactService = new ContactService(provider);
    const approvalService = new ApprovalService(provider);

    expect(provider.workspaces.listForUser('user-2')).toHaveLength(0);
    expect(provider.workspaces.getMembership('workspace-2', 'user-2')).toBeUndefined();
    expect(() => contactService.update('workspace-1', 'contact-3', { company: 'Escalation attempt' })).toThrow(/workspace-1/);
    expect(() => approvalService.decide('workspace-1', 'approval-2', 'approved', 'user-1')).toThrow(/workspace-1/);
  });

  it('does not expose cross-tenant memory writes through scoped retrieval', () => {
    const provider = createProvider();
    const memory = new BusinessMemoryService(provider);
    memory.record({
      workspaceId: 'workspace-2', eventType: 'TEST', entityType: 'contact', entityId: 'contact-3',
      title: 'Family Legacy test', summary: 'Tenant-scoped test event', structuredData: {},
      occurredAt: '2024-12-20T12:00:00.000Z', createdByType: 'system',
    });

    expect(memory.recent('workspace-1').some((event) => event.title === 'Family Legacy test')).toBe(false);
    expect(memory.recent('workspace-2').some((event) => event.title === 'Family Legacy test')).toBe(true);
  });
});

describe('Phase 2D.0 local migration security guards', () => {
  it('uses composite workspace foreign keys for child records', () => {
    const sql = migrationSql();
    expect(sql).toContain('foreign key (workspace_id, goal_id) references public.goals(workspace_id, id)');
    expect(sql).toContain('foreign key (workspace_id, contact_id) references public.contacts(workspace_id, id)');
    expect(sql).toContain('foreign key (workspace_id, rev_action_id) references public.rev_actions(workspace_id, id)');
  });

  it('restricts security-definer helpers and keeps audit records append-only', () => {
    const sql = migrationSql();
    expect(sql).toContain("set search_path = ''");
    expect(sql).toContain('revoke all on function public.is_active_workspace_member(uuid) from public');
    expect(sql).toContain('grant execute on function public.is_active_workspace_member(uuid) to authenticated');
    expect(sql).toContain('create policy audit_log_select on public.audit_log for select');
    expect(sql).toContain('create policy audit_log_insert on public.audit_log for insert');
    expect(sql).not.toContain('create policy audit_log_tenant on public.audit_log for all');
    expect(sql).not.toContain('create policy workspace_members_manage');
  });

  it('defines an authenticated-only atomic workspace bootstrap contract', () => {
    const sql = migrationSql();
    const start = sql.indexOf('create or replace function public.create_workspace_with_owner');
    const end = sql.indexOf('revoke all on function public.create_workspace_with_owner');
    const bootstrap = sql.slice(start, end);

    expect(bootstrap).toContain('create or replace function public.create_workspace_with_owner(workspace_name text, workspace_slug text)');
    expect(bootstrap).toContain('language plpgsql');
    expect(bootstrap).toContain('security definer');
    expect(bootstrap).toContain("set search_path = ''");
    expect(bootstrap).toContain('creator_user_id := auth.uid()');
    expect(bootstrap).toContain('raise exception \'authenticated user required\'');
    expect(bootstrap).toContain('values (new_workspace_id, creator_user_id, \'owner\', \'active\')');
    expect(bootstrap).toContain('workspace.created');
    expect(bootstrap).toContain('return query select new_workspace_id');
    expect(bootstrap).not.toContain('owner_user_id');
    expect(bootstrap).not.toContain('role text');
    expect(bootstrap).not.toContain('dynamic');
    expect(sql).toContain('revoke all on function public.create_workspace_with_owner(text, text) from public');
    expect(sql).toContain('grant execute on function public.create_workspace_with_owner(text, text) to authenticated');
  });

  it('does not alter the protected quote and Telegram workflow', () => {
    const sql = migrationSql();
    expect(sql).not.toMatch(/drop\s+(table|policy|index|trigger)\s+.*quotes/i);
    expect(sql).not.toMatch(/alter\s+table\s+.*quotes/i);
    expect(sql).not.toContain('quotes-telegram-alert');
    expect(sql).not.toContain('telegram-alert-ts');
  });

  it('explicitly removes anonymous execution from every REV security-definer helper', () => {
    const sql = aclRemediationSql();
    const statements = sql.replace(/--.*$/gm, '');
    expect(statements).toContain('revoke all on function public.is_active_workspace_member(uuid) from anon');
    expect(statements).toContain('revoke all on function public.has_workspace_role(uuid, text[]) from anon');
    expect(statements).toContain('revoke all on function public.create_workspace_with_owner(text, text) from anon');
    expect((statements.match(/from anon/g) ?? [])).toHaveLength(3);
    expect((statements.match(/to authenticated/g) ?? [])).toHaveLength(3);
    expect(statements).not.toMatch(/create\s+function|replace\s+function|alter\s+table|create\s+policy|quotes|telegram/i);
  });
});

describe('Phase 2B domain services', () => {
  it('updates goal progress and records memory plus audit entries', () => {
    const provider = createProvider();
    const service = new GoalService(provider);
    const goal = service.updateProgress('workspace-1', 'goal-1', 3, 'user-1');

    expect(goal.currentValue).toBe(3);
    expect(provider.memory.list('workspace-1').some((event) => event.eventType === 'GOAL_PROGRESS_UPDATED')).toBe(true);
    expect(provider.audit.list('workspace-1').some((event) => event.action === 'goal.progress_updated')).toBe(true);
  });

  it('changes contact lifecycle and records an operational event', () => {
    const provider = createProvider();
    const service = new ContactService(provider);
    const contact = service.changeLifecycle('workspace-1', 'contact-1', 'customer');

    expect(contact.lifecycle).toBe('customer');
    expect(provider.memory.findByContact('workspace-1', 'contact-1').some((event) => event.eventType === 'CONTACT_CUSTOMER')).toBe(true);
  });

  it('updates only the correct workspace action during approval', () => {
    const provider = createProvider();
    const service = new ApprovalService(provider);
    service.decide('workspace-1', 'approval-1', 'approved', 'user-1', 'Reviewed locally');

    const approved = provider.actions.get('workspace-1', 'action-1');
    const untouched = provider.actions.get('workspace-2', 'action-2');
    expect(approved?.status).toBe('approved');
    expect(approved?.executionStatus).toBe('not_executed');
    expect(untouched?.status).toBe('awaiting_approval');
    expect(provider.audit.list('workspace-1').some((event) => event.action === 'approval.approved')).toBe(true);
  });
});

describe('Phase 2B provider safeguards', () => {
  it('uses clearly labeled mock authentication and mock data', () => {
    expect(authProvider.getSession()?.mode).toBe('mock-development');
    expect(dataProviderMode).toBe('mock-development');
  });

  it('does not create a Supabase connection or make network calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    expect(() => supabaseAdapter.create()).toThrow(/frozen and not connected/);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('keeps live repository reads explicitly workspace-scoped', () => {
    expect(supabaseReadProvider.getBusinessProfile.length).toBe(1);
    expect(supabaseReadProvider.listBusinessServices.length).toBe(1);
    expect(supabaseReadProvider.listAuthorizedWorkspaces.length).toBe(1);
  });

  it('keeps privileged credentials outside the browser client module', () => {
    const clientSource = readFileSync(new URL('../data/supabaseClient.ts', import.meta.url), 'utf8');
    expect(clientSource).not.toContain('SUPABASE_SECRET_KEY');
    expect(clientSource).not.toContain('service_role');
  });
});
