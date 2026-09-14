import { CommercialRecommendation } from '@/domain/commercialIntelligence';
import { ApprovalRecord, REVActionRecord } from '@/domain/models';
import { DataProvider } from '@/domain/repositories';
import { ApprovalService } from './approvalService';
import { REVActionService } from './revActionService';

const actionTypeFor: Record<CommercialRecommendation['route'], string> = {
  find: 'research_prospects',
  audience: 'research_partnerships',
  recover: 'review_recovery_opportunities',
};

export interface ProposedCommercialAction {
  action: REVActionRecord;
  approval: ApprovalRecord;
  alreadyProposed: boolean;
}

export class CommercialActionService {
  private readonly actions: REVActionService;
  private readonly approvals: ApprovalService;

  constructor(private readonly provider: DataProvider) {
    this.actions = new REVActionService(provider);
    this.approvals = new ApprovalService(provider);
  }

  propose(recommendation: CommercialRecommendation): ProposedCommercialAction {
    if (recommendation.route === 'audience' && recommendation.audienceSafety !== 'allowed') {
      throw new Error('Audience recommendation requires safety review before an action can be proposed.');
    }
    const existing = this.actions.list(recommendation.workspaceId).find((action) => action.rationale?.includes(`recommendation:${recommendation.id}`));
    if (existing) {
      const approval = this.approvals.list(recommendation.workspaceId).find((item) => item.revActionId === existing.id);
      if (!approval) throw new Error('Existing commercial action has no approval record.');
      return { action: existing, approval, alreadyProposed: true };
    }

    const action = this.actions.propose({
      workspaceId: recommendation.workspaceId,
      goalId: recommendation.goalId,
      actionType: actionTypeFor[recommendation.route],
      title: recommendation.recommendedAction,
      description: `${recommendation.whatRevFound} External effect: NONE. Execution is disabled in this phase.`,
      rationale: `recommendation:${recommendation.id} | ${recommendation.whyItMatters} Potential value: ${recommendation.potentialValue || 'not yet assessed'}; confidence: ${Math.round(recommendation.confidence * 100)}%.`,
      requiresApproval: true,
      proposedAt: new Date().toISOString(),
    });
    const approval = this.provider.approvals.save({
      id: `approval-${Date.now()}`,
      workspaceId: action.workspaceId,
      revActionId: action.id,
      requestedAt: new Date().toISOString(),
    });
    return { action, approval, alreadyProposed: false };
  }
}
