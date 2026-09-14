import { DataProvider } from '@/domain/repositories';
import { GoalRecord, GoalStatus } from '@/domain/models';
import { BusinessMemoryService } from './businessMemoryService';
import { recordAudit } from './auditService';

export class GoalService {
  private readonly memory: BusinessMemoryService;

  constructor(private readonly provider: DataProvider) {
    this.memory = new BusinessMemoryService(provider);
  }

  list(workspaceId: string): GoalRecord[] {
    return this.provider.goals.list(workspaceId);
  }

  create(input: Omit<GoalRecord, 'id' | 'createdAt' | 'updatedAt'>): GoalRecord {
    const timestamp = new Date().toISOString();
    const goal = this.provider.goals.save({ ...input, id: `goal-${Date.now()}`, createdAt: timestamp, updatedAt: timestamp });
    recordAudit(this.provider, { workspaceId: goal.workspaceId, actorType: 'user', action: 'goal.created', resourceType: 'goal', resourceId: goal.id });
    return goal;
  }

  update(workspaceId: string, goalId: string, changes: Partial<Pick<GoalRecord, 'title' | 'objective' | 'targetValue' | 'targetDate' | 'priority'>>): GoalRecord {
    const goal = this.requireGoal(workspaceId, goalId);
    const updated = this.provider.goals.save({ ...goal, ...changes, updatedAt: new Date().toISOString() });
    recordAudit(this.provider, { workspaceId, actorType: 'user', action: 'goal.updated', resourceType: 'goal', resourceId: goalId });
    return updated;
  }

  activate(workspaceId: string, goalId: string): GoalRecord { return this.setStatus(workspaceId, goalId, 'active'); }
  pause(workspaceId: string, goalId: string): GoalRecord { return this.setStatus(workspaceId, goalId, 'paused'); }
  complete(workspaceId: string, goalId: string): GoalRecord { return this.setStatus(workspaceId, goalId, 'completed'); }

  updateProgress(workspaceId: string, goalId: string, currentValue: number, actorUserId?: string): GoalRecord {
    const goal = this.requireGoal(workspaceId, goalId);
    const updated = this.provider.goals.save({ ...goal, currentValue, updatedAt: new Date().toISOString() });
    this.memory.record({
      workspaceId, eventType: 'GOAL_PROGRESS_UPDATED', entityType: 'goal', entityId: goalId,
      title: `Goal progress updated: ${goal.title}`, summary: `${currentValue} of ${goal.targetValue}`,
      structuredData: { previousValue: goal.currentValue, currentValue }, occurredAt: new Date().toISOString(), createdByType: actorUserId ? 'user' : 'system', createdById: actorUserId,
    });
    recordAudit(this.provider, { workspaceId, actorUserId, actorType: actorUserId ? 'user' : 'system', action: 'goal.progress_updated', resourceType: 'goal', resourceId: goalId, metadata: { currentValue } });
    return updated;
  }

  private setStatus(workspaceId: string, goalId: string, status: GoalStatus): GoalRecord {
    const goal = this.requireGoal(workspaceId, goalId);
    const updated = this.provider.goals.save({ ...goal, status, updatedAt: new Date().toISOString() });
    recordAudit(this.provider, { workspaceId, actorType: 'user', action: `goal.${status}`, resourceType: 'goal', resourceId: goalId });
    return updated;
  }

  private requireGoal(workspaceId: string, goalId: string): GoalRecord {
    const goal = this.provider.goals.get(workspaceId, goalId);
    if (!goal) throw new Error(`Goal ${goalId} was not found in workspace ${workspaceId}`);
    return goal;
  }
}
