import { DataProvider } from '@/domain/repositories';
import { ActionStatus, ContactRecord, OpportunityRecord, OutreachStatus } from '@/domain/models';
import { REVActionService } from './revActionService';

/**
 * Phase 3E outreach preparation. Reuses the existing REVAction/Approval architecture rather than
 * a parallel execution engine, so the APPROVED — NOT EXECUTED invariant is preserved automatically.
 * No message is ever sent; there is no send integration in this phase.
 */
export class OutreachService {
  private readonly actions: REVActionService;

  constructor(private readonly provider: DataProvider) {
    this.actions = new REVActionService(provider);
  }

  /** Suppression must be checked before any draft is ever prepared. */
  canPrepareOutreach(contact: ContactRecord): { allowed: boolean; reason?: string } {
    if (contact.doNotContact) return { allowed: false, reason: contact.suppressionReason ?? 'do_not_contact' };
    return { allowed: true };
  }

  prepareDraft(workspaceId: string, opportunity: OpportunityRecord, contact: ContactRecord, rationale: string): { actionId: string; approvalId: string } {
    const permission = this.canPrepareOutreach(contact);
    if (!permission.allowed) {
      throw new Error(`Outreach is suppressed for ${contact.name}: ${permission.reason}`);
    }
    const action = this.actions.propose({
      workspaceId,
      contactId: contact.id,
      opportunityId: opportunity.id,
      actionType: 'outreach',
      title: `Prepare outreach for ${contact.name}`,
      description: `Personalised outreach for ${opportunity.title}.`,
      rationale,
      requiresApproval: true,
      proposedAt: new Date().toISOString(),
    });
    const approval = this.provider.approvals.save({
      id: `approval-${action.id}`,
      workspaceId,
      revActionId: action.id,
      requestedAt: new Date().toISOString(),
    });
    return { actionId: action.id, approvalId: approval.id };
  }
}

/** Maps the existing REVAction/Approval state to the outreach queue vocabulary. Only states reachable
 * by the current architecture are ever returned; queued/sent/replied/follow_up_due/converted/suppressed
 * require a future send integration and are never fabricated here. */
export function deriveOutreachStatus(actionStatus: ActionStatus, isSuppressed: boolean): OutreachStatus {
  if (isSuppressed) return 'suppressed';
  switch (actionStatus) {
    case 'proposed':
      return 'draft';
    case 'awaiting_approval':
      return 'ready_for_approval';
    case 'approved':
      return 'approved';
    case 'rejected':
    case 'cancelled':
    case 'completed':
    case 'failed':
    default:
      return 'closed';
  }
}
