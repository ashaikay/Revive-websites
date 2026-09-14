import { DataProvider } from '@/domain/repositories';
import { ActionStatus, REVActionRecord } from '@/domain/models';
import { recordAudit } from './auditService';

export class REVActionService {
  constructor(private readonly provider: DataProvider) {}

  list(workspaceId: string): REVActionRecord[] { return this.provider.actions.list(workspaceId); }

  propose(input: Omit<REVActionRecord, 'id' | 'status' | 'executionStatus'>): REVActionRecord {
    const action = this.provider.actions.save({ ...input, id: `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, status: input.requiresApproval ? 'awaiting_approval' : 'proposed', executionStatus: 'not_executed' });
    recordAudit(this.provider, { workspaceId: action.workspaceId, actorType: 'rev', action: 'rev_action.proposed', resourceType: 'rev_action', resourceId: action.id, metadata: { requiresApproval: action.requiresApproval } });
    return action;
  }

  cancel(workspaceId: string, actionId: string): REVActionRecord { return this.setStatus(workspaceId, actionId, 'cancelled'); }

  private setStatus(workspaceId: string, actionId: string, status: ActionStatus): REVActionRecord {
    const action = this.provider.actions.get(workspaceId, actionId);
    if (!action) throw new Error(`REV action ${actionId} was not found in workspace ${workspaceId}`);
    const updated = this.provider.actions.save({ ...action, status });
    recordAudit(this.provider, { workspaceId, actorType: 'user', action: `rev_action.${status}`, resourceType: 'rev_action', resourceId: actionId });
    return updated;
  }
}
