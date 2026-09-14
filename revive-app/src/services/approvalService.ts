import { DataProvider } from '@/domain/repositories';
import { ApprovalDecision, ApprovalRecord } from '@/domain/models';
import { BusinessMemoryService } from './businessMemoryService';
import { recordAudit } from './auditService';

export class ApprovalService {
  private readonly memory: BusinessMemoryService;

  constructor(private readonly provider: DataProvider) {
    this.memory = new BusinessMemoryService(provider);
  }

  list(workspaceId: string): ApprovalRecord[] { return this.provider.approvals.list(workspaceId); }

  decide(workspaceId: string, approvalId: string, decision: ApprovalDecision, decidedBy: string, notes?: string): ApprovalRecord {
    const approval = this.provider.approvals.get(workspaceId, approvalId);
    if (!approval) throw new Error(`Approval ${approvalId} was not found in workspace ${workspaceId}`);
    const action = this.provider.actions.get(workspaceId, approval.revActionId);
    if (!action) throw new Error(`REV action ${approval.revActionId} was not found in workspace ${workspaceId}`);

    const decidedAt = new Date().toISOString();
    const updatedApproval = this.provider.approvals.save({ ...approval, decision, decidedBy, decidedAt, notes });
    this.provider.actions.save({ ...action, status: decision === 'approved' || decision === 'edited' ? 'approved' : 'rejected', executionStatus: 'not_executed', approvedAt: decision === 'approved' || decision === 'edited' ? decidedAt : undefined });
    this.memory.record({
      workspaceId, eventType: decision === 'rejected' ? 'ACTION_REJECTED' : 'ACTION_APPROVED', entityType: 'rev_action', entityId: action.id,
      title: `REV action ${decision}`, summary: `${action.title} was ${decision}.`, structuredData: { approvalId, decision, notes }, occurredAt: decidedAt, createdByType: 'user', createdById: decidedBy,
    });
    recordAudit(this.provider, { workspaceId, actorUserId: decidedBy, actorType: 'user', action: `approval.${decision}`, resourceType: 'approval', resourceId: approvalId, metadata: { revActionId: action.id } });
    return updatedApproval;
  }
}
