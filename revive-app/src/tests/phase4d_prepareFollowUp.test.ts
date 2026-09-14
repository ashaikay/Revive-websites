import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMockDataProvider } from '@/data/mockProvider';
import { seedData, SeedData } from '@/data/seedFixtures';
import { RecoveryCandidate } from '@/domain/recovery';
import { FollowUpPreparationService } from '@/services/followUpPreparationService';
import { fingerprintActionForApproval } from '@/services/trustedExecutionBoundaryService';

function fixture(): SeedData {
  return structuredClone(seedData);
}

function candidate(overrides: Partial<RecoveryCandidate> = {}): RecoveryCandidate {
  return {
    id: 'recovery-dormant-opportunity-6',
    workspaceId: 'workspace-1',
    signalType: 'dormant_lead',
    supportStatus: 'supported',
    opportunityId: 'opportunity-6',
    contactId: 'contact-6',
    goalId: 'goal-1',
    estimatedRecoverableValue: 9000,
    confidence: 0.82,
    evidence: [{ type: 'fact', summary: 'Opportunity stage is dormant.', source: 'Opportunity record' }],
    reason: 'Dormant opportunity with recorded value and no active next step.',
    ageDays: 74,
    relationshipWarmth: 0.78,
    recommendedCapability: 'REVIEW_DORMANT_LEAD',
    safety: 'allowed',
    source: 'opportunity',
    ...overrides,
  };
}

describe('Phase 4D Prepare Follow-Up', () => {
  it('prepares a conservative internal draft from workspace evidence only', () => {
    const provider = createMockDataProvider(fixture());
    const result = new FollowUpPreparationService(provider).prepare(candidate(), 'user-1', '2026-09-15T10:00:00.000Z');

    expect(result.alreadyPrepared).toBe(false);
    expect(result.artifact).toEqual(expect.objectContaining({
      recoveryType: 'dormant_lead',
      suggestedChannel: 'email',
      approvalState: 'pending',
      externalSend: false,
      providerInvoked: false,
      estimatedCost: 0,
    }));
    expect(result.artifact.draftMessage).toContain('Marcus');
    expect(result.artifact.draftMessage).toContain('AI business growth platform');
    expect(result.artifact.evidenceContext).toEqual(expect.arrayContaining([
      expect.objectContaining({ summary: 'Opportunity stage is dormant.' }),
      expect.objectContaining({ source: 'Business Brain' }),
    ]));
    expect(result.artifact.draftMessage).not.toMatch(/guarantee|discount|deadline|previous conversation/i);
  });

  it('prepares a supported draft for a stale opportunity', () => {
    const provider = createMockDataProvider(fixture());
    const artifact = new FollowUpPreparationService(provider).prepare(candidate({
      id: 'recovery-stale-opportunity-1',
      signalType: 'stale_opportunity',
      opportunityId: 'opportunity-1',
      contactId: 'contact-1',
      reason: 'No recorded activity for 21 days.',
      evidence: [{ type: 'fact', summary: 'Last activity is 21 days old.', source: 'Opportunity record' }],
      recommendedCapability: 'PREPARE_FOLLOW_UP',
    }), 'user-1').artifact;
    expect(artifact.recoveryType).toBe('stale_opportunity');
    expect(artifact.draftMessage).toContain('Sarah');
    expect(artifact.approvalState).toBe('pending');
  });

  it('creates one canonical REV action and approval, then deduplicates the recovery candidate', () => {
    const provider = createMockDataProvider(fixture());
    const service = new FollowUpPreparationService(provider);
    const first = service.prepare(candidate(), 'user-1');
    const replay = service.prepare(candidate(), 'user-1');

    expect(replay.alreadyPrepared).toBe(true);
    expect(replay.artifact.id).toBe(first.artifact.id);
    expect(provider.actions.list('workspace-1').filter((action) => action.actionType === 'prepare_follow_up')).toHaveLength(1);
    expect(provider.approvals.list('workspace-1').filter((approval) => approval.revActionId === first.artifact.revActionId)).toHaveLength(1);
    expect(provider.memory.list('workspace-1').filter((event) => event.eventType === 'FOLLOW_UP_PREPARED')).toHaveLength(1);
  });

  it('does not invoke a provider or network operation during preparation', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const provider = createMockDataProvider(fixture());
    new FollowUpPreparationService(provider).prepare(candidate(), 'user-1');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('keeps candidate, contact, opportunity, action, and memory workspace-scoped', () => {
    const provider = createMockDataProvider(fixture());
    const service = new FollowUpPreparationService(provider);
    expect(() => service.prepare(candidate({ opportunityId: 'opportunity-3', contactId: 'contact-3' }), 'user-1')).toThrow(/active workspace/);
    expect(service.list('workspace-2')).toHaveLength(0);
  });

  it('blocks suppressed, safety-review, and unsupported recovery work', () => {
    const provider = createMockDataProvider(fixture());
    const service = new FollowUpPreparationService(provider);
    expect(() => service.prepare(candidate({ id: 'suppressed', opportunityId: 'opportunity-2', contactId: 'contact-2' }), 'user-1')).toThrow(/Suppressed/);
    expect(() => service.prepare(candidate({ id: 'review', safety: 'review_required' }), 'user-1')).toThrow(/safety review/);
    expect(() => service.prepare(candidate({ id: 'invoice', signalType: 'unpaid_invoice' }), 'user-1')).toThrow(/not supported/);
  });

  it('records missing information instead of inventing it', () => {
    const data = fixture();
    data.profiles = data.profiles.filter((profile) => profile.workspaceId !== 'workspace-1');
    data.services = data.services.filter((service) => service.workspaceId !== 'workspace-1');
    data.contacts.find((contact) => contact.id === 'contact-6')!.email = undefined;
    data.contacts.find((contact) => contact.id === 'contact-6')!.phone = undefined;
    const artifact = new FollowUpPreparationService(createMockDataProvider(data)).prepare(candidate(), 'user-1').artifact;
    expect(artifact.suggestedChannel).toBe('owner_choice');
    expect(artifact.missingInformation).toEqual(expect.arrayContaining([
      'Business identity is not available.',
      'No active service is recorded for this workspace.',
      'No contact channel is recorded; the owner must choose how to follow up.',
    ]));
    expect(artifact.draftMessage).toContain('our team');
  });

  it('allows owner/admin review but rejects member/viewer write authority', () => {
    const data = fixture();
    data.members.push(
      { workspaceId: 'workspace-1', userId: 'admin-1', role: 'admin', status: 'active', joinedAt: '2024-12-20T09:00:00.000Z' },
      { workspaceId: 'workspace-1', userId: 'member-1', role: 'member', status: 'active', joinedAt: '2024-12-20T09:00:00.000Z' },
      { workspaceId: 'workspace-1', userId: 'viewer-1', role: 'viewer', status: 'active', joinedAt: '2024-12-20T09:00:00.000Z' },
    );
    const provider = createMockDataProvider(data);
    const service = new FollowUpPreparationService(provider);
    const prepared = service.prepare(candidate(), 'member-1').artifact;
    const edited = service.edit('workspace-1', prepared.id, 'admin-1', 'Owner-approved subject', 'Owner-approved draft');
    expect(edited.subject).toBe('Owner-approved subject');
    expect(() => service.edit('workspace-1', prepared.id, 'member-1', 'No', 'No')).toThrow(/not authorised/);
    expect(() => service.decide('workspace-1', prepared.id, 'member-1', 'approved')).toThrow(/not authorised/);
    expect(() => service.decide('workspace-1', prepared.id, 'viewer-1', 'approved')).toThrow(/not authorised/);
    expect(() => service.prepare(candidate({ id: 'viewer-attempt' }), 'viewer-1')).toThrow(/not authorised/);
    expect(service.decide('workspace-1', prepared.id, 'admin-1', 'approved').approvalState).toBe('approved_not_sent');
  });

  it('binds edited content to approval and remains approved but not sent', () => {
    const provider = createMockDataProvider(fixture());
    const service = new FollowUpPreparationService(provider);
    const prepared = service.prepare(candidate(), 'user-1').artifact;
    service.edit('workspace-1', prepared.id, 'user-1', 'A careful check-in', 'Hi Marcus,\n\nWould a brief conversation be useful?\n\nBest,\nRevive');
    const approved = service.decide('workspace-1', prepared.id, 'user-1', 'approved');
    const action = provider.actions.get('workspace-1', approved.revActionId)!;
    const approval = provider.approvals.get('workspace-1', approved.approvalId)!;

    expect(approved.approvalState).toBe('approved_not_sent');
    expect(action.status).toBe('approved');
    expect(action.executionStatus).toBe('not_executed');
    expect(action.executedAt).toBeUndefined();
    expect(approval.actionFingerprint).toBe(fingerprintActionForApproval(action));
    expect(() => service.decide('workspace-1', prepared.id, 'user-1', 'approved')).toThrow(/already been reviewed/);
  });

  it('rejects without commercial or execution side effects', () => {
    const provider = createMockDataProvider(fixture());
    const before = provider.opportunities.list('workspace-1');
    const service = new FollowUpPreparationService(provider);
    const prepared = service.prepare(candidate(), 'user-1').artifact;
    const rejected = service.decide('workspace-1', prepared.id, 'user-1', 'rejected');
    expect(rejected.approvalState).toBe('rejected');
    expect(provider.actions.get('workspace-1', rejected.revActionId)?.executionStatus).toBe('not_executed');
    expect(provider.opportunities.list('workspace-1')).toEqual(before);
  });

  it('does not use the protected legacy public.quotes system', () => {
    const source = readFileSync(new URL('../services/followUpPreparationService.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('public.quotes');
    expect(source).not.toContain('quotes-telegram-alert');
  });
});