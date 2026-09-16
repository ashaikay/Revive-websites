import { describe, expect, it } from 'vitest';
import { TrustedExecutionConfiguration } from '@/domain/execution';
import { REVActionRecord } from '@/domain/models';
import { createMockDataProvider } from '@/data/mockProvider';
import { seedData, SeedData } from '@/data/seedFixtures';
import { CostGovernor, InMemoryUsageLedger } from '@/services/discoveryFoundationService';
import { ApprovalService } from '@/services/approvalService';
import {
  fingerprintActionForApproval,
  InMemoryExecutionIdempotencyStore,
  TrustedExecutionBoundaryService,
  TrustedExecutionConfigurationSource,
} from '@/services/trustedExecutionBoundaryService';

const actionId = 'action-trusted-boundary';
const approvalId = 'approval-trusted-boundary';

function approvedAction(overrides: Partial<REVActionRecord> = {}): REVActionRecord {
  return {
    id: actionId, workspaceId: 'workspace-1', goalId: 'goal-1', actionType: 'review_recovery_opportunities',
    title: 'Prepare a recovery review', description: 'Prepare an internal review only.',
    rationale: 'recommendation:trusted-test', requiresApproval: true, status: 'approved',
    executionStatus: 'not_executed', proposedAt: '2026-09-14T00:00:00.000Z', approvedAt: '2026-09-14T01:00:00.000Z', ...overrides,
  };
}

function fixture(action: REVActionRecord = approvedAction()): SeedData {
  const data = structuredClone(seedData);
  data.actions.push(action);
  data.approvals.push({
    id: approvalId, workspaceId: action.workspaceId, revActionId: action.id, requestedAt: action.proposedAt,
    decidedAt: '2026-09-14T01:00:00.000Z', decidedBy: 'user-1', decision: 'approved',
    actionFingerprint: fingerprintActionForApproval(action),
  });
  return data;
}

function settings(overrides: Partial<TrustedExecutionConfiguration> = {}): TrustedExecutionConfiguration {
  return {
    workspaceExecutionEnabled: true, providerConfigured: false, estimatedExternalCost: 0,
    countryCode: 'GB', jurisdiction: 'GB', autonomyMode: 'always_ask', audienceSafety: 'allowed', usagePlan: 'free', ...overrides,
  };
}

function harness(data = fixture(), configuration = settings(), governor = new CostGovernor()) {
  const provider = createMockDataProvider(data);
  const source: TrustedExecutionConfigurationSource = { resolve: () => configuration };
  const service = new TrustedExecutionBoundaryService(provider, source, governor, new InMemoryExecutionIdempotencyStore());
  const prepare = (requestId = 'request-1', workspaceId = 'workspace-1', requestedActionId = actionId, actorUserId = 'user-1') =>
    service.prepareDryRun({ requestId, workspaceId, actionId: requestedActionId }, { actorUserId });
  return { provider, service, prepare };
}

describe('Phase 4B trusted execution boundary', () => {
  it('resolves authority and produces a trusted dry-run envelope only', () => {
    const envelope = harness().prepare();
    expect(envelope.actorRole).toBe('owner');
    expect(envelope.plan.status).toBe('ready_for_dry_run');
    expect(envelope.executionEnabled).toBe(false);
    expect(envelope.providerInvoked).toBe(false);
  });

  it('rejects a missing authenticated actor identifier', () => {
    expect(() => harness().prepare('request-1', 'workspace-1', actionId, '')).toThrow(/authenticated actor/);
  });

  it('rejects an actor without active workspace membership', () => {
    expect(() => harness().prepare('request-1', 'workspace-1', actionId, 'user-outsider')).toThrow(/membership/);
  });

  it('rejects a suspended workspace membership', () => {
    const data = fixture();
    data.members[0].status = 'suspended';
    expect(() => harness(data).prepare()).toThrow(/membership/);
  });

  it('rejects a viewer role', () => {
    const data = fixture();
    data.members[0].role = 'viewer';
    expect(() => harness(data).prepare()).toThrow(/role/);
  });

  it('rejects a member role', () => {
    const data = fixture();
    data.members[0].role = 'member';
    expect(() => harness(data).prepare()).toThrow(/owner or admin/);
  });

  it('cannot resolve an action through a different workspace', () => {
    expect(() => harness().prepare('request-1', 'workspace-2')).toThrow(/not found/);
  });

  it('rejects a missing action', () => {
    expect(() => harness().prepare('request-1', 'workspace-1', 'missing-action')).toThrow(/not found/);
  });

  it('requires authoritative workspace execution configuration', () => {
    const provider = createMockDataProvider(fixture());
    const service = new TrustedExecutionBoundaryService(provider, { resolve: () => undefined });
    expect(() => service.prepareDryRun({ requestId: 'request-1', workspaceId: 'workspace-1', actionId }, { actorUserId: 'user-1' })).toThrow(/configuration/);
  });

  it('enforces the workspace execution preparation switch', () => {
    expect(harness(fixture(), settings({ workspaceExecutionEnabled: false })).prepare().plan.decision).toBe('requires_configuration');
  });

  it('requires an approved action lifecycle state', () => {
    expect(harness(fixture(approvedAction({ status: 'awaiting_approval' }))).prepare().plan.decision).toBe('requires_fresh_approval');
  });

  it('blocks actions that have already entered execution', () => {
    expect(harness(fixture(approvedAction({ executionStatus: 'in_progress' }))).prepare().plan.decision).toBe('blocked');
  });

  it('requires a stored approval fingerprint', () => {
    const data = fixture();
    delete data.approvals[data.approvals.length - 1].actionFingerprint;
    expect(harness(data).prepare().plan.decision).toBe('requires_fresh_approval');
  });

  it('invalidates approval when approved action content changes', () => {
    const data = fixture();
    data.actions[data.actions.length - 1].description = 'Changed after approval.';
    const envelope = harness(data).prepare();
    expect(envelope.approvalFingerprintValid).toBe(false);
    expect(envelope.plan.decision).toBe('requires_fresh_approval');
  });

  it('captures an action fingerprint when ApprovalService decides', () => {
    const data = fixture(approvedAction({ status: 'awaiting_approval', approvedAt: undefined }));
    const pending = data.approvals[data.approvals.length - 1];
    pending.decision = undefined;
    pending.actionFingerprint = undefined;
    const provider = createMockDataProvider(data);
    const approval = new ApprovalService(provider).decide('workspace-1', approvalId, 'approved', 'user-1');
    expect(approval.actionFingerprint).toBe(fingerprintActionForApproval(provider.actions.get('workspace-1', actionId)!));
  });

  it('enforces audience safety from trusted configuration', () => {
    expect(harness(fixture(), settings({ audienceSafety: 'prohibited' })).prepare().plan.decision).toBe('blocked');
    expect(harness(fixture(), settings({ audienceSafety: 'review_required' })).prepare().plan.decision).toBe('requires_review');
  });

  it('enforces provider configuration for provider-backed capabilities', () => {
    const action = approvedAction({ actionType: 'research_prospects' });
    expect(harness(fixture(action)).prepare().plan.decision).toBe('requires_provider');
  });

  it('enforces jurisdiction constraints from trusted configuration', () => {
    const action = approvedAction({ actionType: 'research_prospects' });
    expect(harness(fixture(action), settings({ providerConfigured: true, countryCode: 'US' })).prepare().plan.decision).toBe('not_supported');
  });

  it('enforces the Cost Governor without recording usage', () => {
    const ledger = new InMemoryUsageLedger();
    const governor = new CostGovernor(ledger);
    const envelope = harness(fixture(), settings({ estimatedExternalCost: 1 }), governor).prepare();
    expect(envelope.plan.decision).toBe('blocked_by_cost');
    expect(ledger.list('workspace-1')).toEqual([]);
  });

  it('keeps disabled external and financial capabilities blocked', () => {
    const external = approvedAction({ actionType: 'outreach' });
    const financial = approvedAction({ actionType: 'financial_action' });
    const externalEnvelope = harness(fixture(external), settings({ providerConfigured: true })).prepare();
    expect(externalEnvelope.plan.capability).toBe('SEND_EMAIL');
    expect(externalEnvelope.plan.decision).toBe('blocked');
    expect(externalEnvelope.executionEnabled).toBe(false);
    expect(externalEnvelope.providerInvoked).toBe(false);
    expect(harness(fixture(financial), settings({ providerConfigured: true })).prepare().plan.decision).toBe('blocked');
  });

  it('replays the same request from process-local idempotency', () => {
    const instance = harness();
    const first = instance.prepare();
    const replay = instance.prepare();
    expect(first.idempotency.replayed).toBe(false);
    expect(replay.idempotency.replayed).toBe(true);
    expect(replay.idempotency.durable).toBe(false);
    expect(replay.plan).toEqual(first.plan);
  });

  it('rejects idempotency-key reuse for a different action', () => {
    const data = fixture();
    data.actions.push(approvedAction({ id: 'action-other' }));
    const instance = harness(data);
    instance.prepare();
    expect(() => instance.prepare('request-1', 'workspace-1', 'action-other')).toThrow(/different execution request/);
  });
});