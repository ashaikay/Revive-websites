import { describe, expect, it } from 'vitest';
import { createMockDataProvider } from '@/data/mockProvider';
import { seedData } from '@/data/seedFixtures';
import { CostGovernor, InMemoryUsageLedger } from '@/services/discoveryFoundationService';
import {
  buildOwnerControlCentre,
  buildUnavailableOwnerControlCentre,
} from '@/services/ownerControlCentreService';

function build(workspaceId = 'workspace-1') {
  return buildOwnerControlCentre({
    provider: createMockDataProvider(structuredClone(seedData)),
    workspaceId,
    actorUserId: 'user-1',
    now: new Date('2026-09-14T00:00:00.000Z').getTime(),
  });
}

describe('Phase 4A Owner Control Centre read model', () => {
  it('aggregates only records belonging to the requested workspace', () => {
    const workspaceOne = build('workspace-1');
    const workspaceTwo = build('workspace-2');
    expect(JSON.stringify(workspaceOne)).not.toContain('Thompson Group');
    expect(JSON.stringify(workspaceTwo)).not.toContain('Sarah Chen');
    expect(workspaceOne.workspaceId).toBe('workspace-1');
    expect(workspaceTwo.workspaceId).toBe('workspace-2');
  });

  it('surfaces only unresolved approvals linked to workspace actions', () => {
    const model = build();
    expect(model.approvals).toHaveLength(1);
    expect(model.approvals[0].id).toBe('approval-1');
    expect(model.approvals[0].title).toContain('Sarah Chen');
  });

  it('derives blocked and ready-for-dry-run states without storing a new lifecycle', () => {
    const provider = createMockDataProvider(structuredClone(seedData));
    const pending = provider.actions.get('workspace-1', 'action-1')!;
    provider.actions.save({ ...pending, id: 'action-ready', status: 'approved', executionStatus: 'not_executed' });
    provider.approvals.save({ id: 'approval-ready', workspaceId: 'workspace-1', revActionId: 'action-ready', requestedAt: pending.proposedAt, decision: 'approved' });
    const model = buildOwnerControlCentre({ provider, workspaceId: 'workspace-1', actorUserId: 'user-1' });
    expect(model.readiness.find((item) => item.id === 'action-1')?.state).toBe('blocked');
    expect(model.readiness.find((item) => item.id === 'action-ready')?.state).toBe('ready_for_dry_run');
    expect(model.readiness.find((item) => item.id === 'action-ready')?.detail).toMatch(/real execution is disabled/i);
  });

  it('keeps execution disabled throughout the read model', () => {
    const model = build();
    expect(model.systemStatus.find((item) => item.label === 'REV execution')?.value).toBe('Disabled');
    expect(model.readiness.every((item) => item.executionEnabled === false)).toBe(true);
  });

  it('keeps Money REV Found separate from pipeline, won, and explicit REV attribution', () => {
    const model = build();
    expect(model.money.potentialValue).toBeGreaterThan(0);
    expect(model.money.potentialValue).not.toBe(model.money.wonRevenue);
    expect(model.money.pipelineValue).not.toBe(model.money.revRecovered);
    expect(model.money.revRecovered).toBe(22000);
    expect(model.money.revGenerated).toBe(0);
  });

  it('shows results without treating completion as revenue', () => {
    const provider = createMockDataProvider(structuredClone(seedData));
    provider.actions.save({
      ...provider.actions.get('workspace-1', 'action-1')!,
      id: 'action-complete',
      status: 'completed',
      executionStatus: 'succeeded',
      outcomeSummary: 'Internal review prepared.',
    });
    const model = buildOwnerControlCentre({ provider, workspaceId: 'workspace-1', actorUserId: 'user-1' });
    expect(model.results[0].detail).toBe('Internal review prepared.');
    expect(model.money.wonRevenue).toBe(22000);
  });

  it('uses Cost Governor usage only when a ledger is explicitly supplied', () => {
    const ledger = new InMemoryUsageLedger();
    ledger.record({ workspaceId: 'workspace-1', providerKey: 'mock', operation: 'research', units: 1, estimatedCost: 0, actualCost: 0, timestamp: '2026-09-14T00:00:00.000Z', correlationId: 'test' });
    const model = buildOwnerControlCentre({ provider: createMockDataProvider(structuredClone(seedData)), workspaceId: 'workspace-1', actorUserId: 'user-1', costGovernor: new CostGovernor(ledger) });
    expect(model.usage).toMatchObject({ available: true, used: 1, allowance: 3, remaining: 2 });
    expect(build().usage.available).toBe(false);
  });

  it('returns truthful unavailable states in live mode with no mock leakage', () => {
    const model = buildUnavailableOwnerControlCentre('live-workspace');
    expect(model.mode).toBe('live');
    expect(model.today).toEqual([]);
    expect(model.approvals).toEqual([]);
    expect(model.money.available).toBe(false);
    expect(model.usage.available).toBe(false);
    expect(JSON.stringify(model)).not.toMatch(/Sarah Chen|Webb Logistics|22000/);
  });
});