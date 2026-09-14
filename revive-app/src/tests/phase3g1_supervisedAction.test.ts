import { describe, expect, it } from 'vitest';
import { seedData } from '@/data/seedFixtures';
import { createMockDataProvider } from '@/data/mockProvider';
import { CommercialRecommendation } from '@/domain/commercialIntelligence';
import { CommercialActionService } from '@/services/commercialActionService';
import { ApprovalService } from '@/services/approvalService';
import { computeOpportunityRevenue } from '@/services/opportunityService';

function recommendation(route: CommercialRecommendation['route'] = 'recover'): CommercialRecommendation {
  return { id: `recommendation-test-${route}`, workspaceId: 'workspace-1', route, rank: 1, title: 'Follow up dormant opportunities', whatRevFound: 'Four dormant opportunities have recorded potential value.', whyItMatters: 'Existing relationships may be faster to recover.', potentialValue: 2300, confidence: 0.8, priorityScore: 82, evidence: [{ type: 'fact', summary: 'Dormant opportunity found.', source: 'Opportunity record' }], recommendedAction: 'Prepare recovery review for owner approval.', approvalRequired: true, signalIds: ['signal-test'], goalId: 'goal-1', audienceSafety: route === 'audience' ? 'allowed' : undefined };
}

function provider() { return createMockDataProvider(structuredClone(seedData)); }

describe('Phase 3G.1 supervised action workflow', () => {
  it('proposes eligible FIND, AUDIENCE, and RECOVER recommendations through existing action architecture', () => {
    const dataProvider = provider();
    const service = new CommercialActionService(dataProvider);
    for (const route of ['find', 'audience', 'recover'] as const) {
      const result = service.propose(recommendation(route));
      expect(result.action.status).toBe('awaiting_approval');
      expect(result.action.executionStatus).toBe('not_executed');
      expect(result.approval.decision).toBeUndefined();
    }
    expect(dataProvider.actions.list('workspace-1')).toHaveLength(4);
  });

  it('is idempotent for the same recommendation and does not execute', () => {
    const dataProvider = provider();
    const service = new CommercialActionService(dataProvider);
    const first = service.propose(recommendation());
    const second = service.propose(recommendation());
    expect(second.alreadyProposed).toBe(true);
    expect(second.action.id).toBe(first.action.id);
    expect(dataProvider.actions.list('workspace-1').filter((action) => action.rationale?.includes('recommendation-test'))).toHaveLength(1);
    expect(second.action.executionStatus).toBe('not_executed');
  });

  it('approval records intent only and preserves potential value without revenue', () => {
    const dataProvider = provider();
    const proposed = new CommercialActionService(dataProvider).propose(recommendation());
    const approval = new ApprovalService(dataProvider);
    const decided = approval.decide('workspace-1', proposed.approval.id, 'approved', 'user-1');
    const action = dataProvider.actions.get('workspace-1', proposed.action.id)!;
    expect(decided.decision).toBe('approved');
    expect(action.status).toBe('approved');
    expect(action.executionStatus).toBe('not_executed');
    expect(computeOpportunityRevenue(dataProvider.opportunities.list('workspace-1')).revRecovered).toBe(computeOpportunityRevenue(seedData.opportunities.filter((opportunity) => opportunity.workspaceId === 'workspace-1')).revRecovered);
    expect(dataProvider.memory.list('workspace-1').some((event) => event.entityId === action.id)).toBe(true);
  });

  it('rejection has no commercial side effect', () => {
    const dataProvider = provider();
    const proposed = new CommercialActionService(dataProvider).propose(recommendation());
    const beforeOpportunities = dataProvider.opportunities.list('workspace-1');
    new ApprovalService(dataProvider).decide('workspace-1', proposed.approval.id, 'rejected', 'user-1');
    expect(dataProvider.opportunities.list('workspace-1')).toEqual(beforeOpportunities);
    expect(dataProvider.actions.get('workspace-1', proposed.action.id)?.status).toBe('rejected');
  });

  it('does not allow prohibited or review-required audience recommendations to become actions', () => {
    const dataProvider = provider();
    const service = new CommercialActionService(dataProvider);
    expect(() => service.propose({ ...recommendation('audience'), audienceSafety: 'prohibited' })).toThrow(/safety review/);
    expect(() => service.propose({ ...recommendation('audience'), audienceSafety: 'review_required' })).toThrow(/safety review/);
  });
});
