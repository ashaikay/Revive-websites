import { describe, expect, it } from 'vitest';
import { REVActionRecord } from '@/domain/models';
import { CostGovernor } from '@/services/discoveryFoundationService';
import { createDryRunPlan, evaluateExecutionPolicy, getCapability, listCapabilities } from '@/services/executionPolicyService';

function action(overrides: Partial<REVActionRecord> = {}): REVActionRecord {
  return {
    id: 'action-execution-test', workspaceId: 'workspace-1', actionType: 'review_recovery_opportunities', title: 'Review recovery opportunities', description: 'Prepare an internal review.', rationale: 'recommendation:recommendation-test | Existing warm relationships.', requiresApproval: true, status: 'approved', executionStatus: 'not_executed', proposedAt: '2026-09-14T00:00:00.000Z', ...overrides,
  };
}

const approved = { action: action(), capability: 'PREPARE_FOLLOW_UP', actorUserId: 'user-1', workspaceId: 'workspace-1', approvalId: 'approval-1', approvalState: 'approved' as const, audienceSafety: 'allowed' as const, estimatedExternalCost: 0, providerConfigured: false, countryCode: 'GB' };

describe('Phase 3G.2 execution readiness policy', () => {
  it('allows an approved prepare-only action for dry run only', () => {
    const result = evaluateExecutionPolicy(approved);
    const plan = createDryRunPlan(approved);
    expect(result.decision).toBe('eligible_for_dry_run');
    expect(plan.status).toBe('ready_for_dry_run');
    expect(plan.executionEnabled).toBe(false);
    expect(plan.externalCommunication).toBe(false);
    expect(plan.expectedSideEffects).toEqual(['Draft-only internal plan; no external effect.']);
  });

  it('requires fresh approval for an unapproved action', () => {
    expect(evaluateExecutionPolicy({ ...approved, approvalState: 'pending' }).decision).toBe('requires_fresh_approval');
    expect(createDryRunPlan({ ...approved, approvalState: 'pending' }).status).toBe('execution_blocked');
  });

  it('blocks external communication, financial, high-risk, and disabled capabilities', () => {
    expect(evaluateExecutionPolicy({ ...approved, capability: 'SEND_EMAIL' }).decision).toBe('blocked');
    expect(evaluateExecutionPolicy({ ...approved, capability: 'FINANCIAL_ACTION' }).decision).toBe('blocked');
    expect(evaluateExecutionPolicy({ ...approved, capability: 'HIGH_RISK_ACTION' }).decision).toBe('blocked');
    expect(evaluateExecutionPolicy({ ...approved, capability: 'SEND_SMS' }).decision).toBe('blocked');
  });

  it('propagates audience safety and blocks review-required or prohibited actions', () => {
    expect(evaluateExecutionPolicy({ ...approved, audienceSafety: 'review_required' }).decision).toBe('requires_review');
    expect(evaluateExecutionPolicy({ ...approved, audienceSafety: 'prohibited' }).decision).toBe('blocked');
  });

  it('blocks cross-workspace action evaluation', () => {
    expect(evaluateExecutionPolicy({ ...approved, workspaceId: 'workspace-2' }).decision).toBe('blocked');
    expect(evaluateExecutionPolicy({ ...approved, action: action({ workspaceId: 'workspace-2' }) }).decision).toBe('blocked');
  });

  it('requires a provider for provider-backed research and applies cost governance', () => {
    expect(evaluateExecutionPolicy({ ...approved, capability: 'RESEARCH_PROSPECTS' }).decision).toBe('requires_provider');
    const governor = new CostGovernor();
    expect(evaluateExecutionPolicy({ ...approved, estimatedExternalCost: 1 }, governor).decision).toBe('blocked_by_cost');
  });

  it('blocks non-GB jurisdiction-sensitive policy paths', () => {
    expect(evaluateExecutionPolicy({ ...approved, capability: 'SEND_EMAIL', countryCode: 'US' }).decision).toBe('blocked');
  });

  it('exposes a small disabled-by-default capability registry', () => {
    expect(listCapabilities().map((capability) => capability.name)).toContain('PREPARE_FOLLOW_UP');
    expect(getCapability('SEND_EMAIL').enabled).toBe(false);
    expect(getCapability('SEND_EMAIL').allowedAutonomy).toEqual([]);
  });
});
