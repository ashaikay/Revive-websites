import { describe, expect, it } from 'vitest';
import { createMockDataProvider } from '@/data/mockProvider';
import { seedData } from '@/data/seedFixtures';
import { GoalService } from '@/services/goalService';
import { REVActionService } from '@/services/revActionService';
import { ApprovalService } from '@/services/approvalService';
import { qualityGateLabel } from '@/components/REVInterface';
import { REVActionRecord } from '@/domain/models';

function createProvider() {
  return createMockDataProvider(structuredClone(seedData));
}

describe('Phase 3C REV workspace data boundary', () => {
  it('keeps goals, actions, and approvals scoped to their own workspace', () => {
    const provider = createProvider();
    const goals = new GoalService(provider);
    const actions = new REVActionService(provider);
    const approvals = new ApprovalService(provider);

    expect(goals.list('workspace-1').every((goal) => goal.workspaceId === 'workspace-1')).toBe(true);
    expect(actions.list('workspace-2').every((action) => action.workspaceId === 'workspace-2')).toBe(true);
    expect(approvals.list('workspace-1').every((approval) => approval.workspaceId === 'workspace-1')).toBe(true);
  });

  it('approving a REV action never marks it executed', () => {
    const provider = createProvider();
    const approvals = new ApprovalService(provider);
    const actions = new REVActionService(provider);

    const updated = approvals.decide('workspace-1', 'approval-1', 'approved', 'user-1');
    expect(updated.decision).toBe('approved');

    const action = actions.list('workspace-1').find((item) => item.id === 'action-1');
    expect(action?.status).toBe('approved');
    expect(action?.executionStatus).toBe('not_executed');
  });

  it('rejecting a REV action never marks it executed', () => {
    const provider = createProvider();
    const approvals = new ApprovalService(provider);
    const actions = new REVActionService(provider);

    approvals.decide('workspace-2', 'approval-2', 'rejected', 'user-1');
    const action = actions.list('workspace-2').find((item) => item.id === 'action-2');
    expect(action?.status).toBe('rejected');
    expect(action?.executionStatus).toBe('not_executed');
  });

  it('flags an action without a rationale as needing evidence rather than fabricating one', () => {
    const provider = createProvider();
    const actions = new REVActionService(provider);
    const action = actions.list('workspace-1')[0];
    expect(qualityGateLabel(action)).not.toBe('Needs evidence');

    const unsupported: REVActionRecord = { ...action, id: 'action-unsupported', rationale: undefined };
    expect(qualityGateLabel(unsupported)).toBe('Needs evidence');
  });
});
