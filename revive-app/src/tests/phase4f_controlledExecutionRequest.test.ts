import { describe, expect, it } from 'vitest';
import { TrustedExecutionConfiguration } from '@/domain/execution';
import { ApprovalRecord, MemberRole, REVActionRecord } from '@/domain/models';
import { createMockDataProvider } from '@/data/mockProvider';
import { seedData } from '@/data/seedFixtures';
import { ControlledExecutionRequestService } from '@/services/controlledExecutionRequestService';
import { CostGovernor, InMemoryUsageLedger } from '@/services/discoveryFoundationService';
import { PLATFORM_EXECUTION_ENABLED } from '@/services/executionPolicyService';
import {
  fingerprintActionForApproval,
  InMemoryExecutionIdempotencyStore,
  TrustedExecutionBoundaryService,
} from '@/services/trustedExecutionBoundaryService';

const workspaceId = 'workspace-1';
const actionId = 'phase4f-action';
const approvalId = 'phase4f-approval';

function action(overrides: Partial<REVActionRecord> = {}): REVActionRecord {
  return {
    id: actionId, workspaceId, goalId: 'goal-1', actionType: 'prepare_follow_up', title: 'Approved follow-up',
    description: 'Reviewed internal draft.', rationale: 'prepared-follow-up:phase4f', requiresApproval: true,
    status: 'approved', executionStatus: 'not_executed', proposedAt: '2026-09-16T00:00:00.000Z',
    approvedAt: '2026-09-16T01:00:00.000Z', ...overrides,
  };
}

function approval(target: REVActionRecord, overrides: Partial<ApprovalRecord> = {}): ApprovalRecord {
  return {
    id: approvalId, workspaceId: target.workspaceId, revActionId: target.id, requestedAt: target.proposedAt,
    decidedAt: '2026-09-16T01:00:00.000Z', decidedBy: 'user-1', decision: 'approved',
    actionFingerprint: fingerprintActionForApproval(target), ...overrides,
  };
}

function configuration(overrides: Partial<TrustedExecutionConfiguration> = {}): TrustedExecutionConfiguration {
  return {
    workspaceExecutionEnabled: true, providerConfigured: false, estimatedExternalCost: 0, countryCode: 'GB',
    jurisdiction: 'GB', autonomyMode: 'always_ask', audienceSafety: 'allowed', usagePlan: 'free', ...overrides,
  };
}

function harness(role: MemberRole = 'owner', config = configuration(), target = action()) {
  const data = structuredClone(seedData);
  data.actions.push(target);
  data.approvals.push(approval(target));
  const member = data.members.find((item) => item.workspaceId === workspaceId && item.userId === 'user-1')!;
  member.role = role;
  const provider = createMockDataProvider(data);
  const ledger = new InMemoryUsageLedger();
  const boundary = new TrustedExecutionBoundaryService(
    provider,
    { resolve: () => config },
    new CostGovernor(ledger),
    new InMemoryExecutionIdempotencyStore(),
  );
  const service = new ControlledExecutionRequestService(boundary, provider);
  const request = (requestId = 'phase4f-request', requestedWorkspaceId = workspaceId, requestedActionId = actionId) =>
    service.requestDryRun({ requestId, workspaceId: requestedWorkspaceId, actionId: requestedActionId }, { actorUserId: 'user-1' });
  return { provider, ledger, request };
}

describe('Phase 4F controlled execution request', () => {
  it.each(['owner', 'admin'] as const)('allows an %s dry-run request and audits the result', (role) => {
    const instance = harness(role);
    const result = instance.request();
    expect(result).toEqual(expect.objectContaining({
      status: 'dry_run_nothing_sent', displayStatus: 'DRY RUN — NOTHING SENT', externalSend: false,
      providerInvoked: false, providerCost: 0, executionEnabled: false, replayed: false,
    }));
    expect(instance.provider.audit.list(workspaceId).filter((event) => event.action.startsWith('execution_request.'))).toHaveLength(2);
  });

  it.each(['member', 'viewer'] as const)('denies a %s execution request', (role) => {
    expect(() => harness(role).request()).toThrow(/owner or admin/);
  });

  it('denies cross-tenant execution requests', () => {
    expect(() => harness().request('phase4f-cross-tenant', 'workspace-2')).toThrow(/membership|not found/);
  });

  it('denies stale approval fingerprints', () => {
    const stale = action({ description: 'Materially changed after approval.' });
    const instance = harness('owner', configuration(), stale);
    const stored = instance.provider.approvals.get(workspaceId, approvalId)!;
    instance.provider.approvals.save({ ...stored, actionFingerprint: fingerprintActionForApproval(action()) });
    expect(() => instance.request()).toThrow(/approval no longer matches/i);
  });

  it('replays duplicate requests without duplicate audit records', () => {
    const instance = harness();
    expect(instance.request().replayed).toBe(false);
    expect(instance.request().replayed).toBe(true);
    expect(instance.provider.audit.list(workspaceId).filter((event) => event.action.startsWith('execution_request.'))).toHaveLength(2);
  });

  it('enforces disabled workspace execution preparation', () => {
    expect(() => harness('owner', configuration({ workspaceExecutionEnabled: false })).request()).toThrow(/workspace execution preparation is disabled/i);
  });

  it('keeps platform execution disabled with no provider use or cost', () => {
    const instance = harness();
    const result = instance.request();
    expect(PLATFORM_EXECUTION_ENABLED).toBe(false);
    expect(result.envelope.plan.externalCommunication).toBe(false);
    expect(result.envelope.plan.externalProvider).toBeUndefined();
    expect(instance.ledger.list(workspaceId)).toEqual([]);
  });

  it('rejects provider-backed and nonzero-cost requests', () => {
    expect(() => harness('owner', configuration({ providerConfigured: true })).request()).toThrow(/provider invocation is prohibited/i);
    expect(() => harness('owner', configuration({ estimatedExternalCost: 1 })).request()).toThrow(/cost governor|zero provider cost/i);
  });
});