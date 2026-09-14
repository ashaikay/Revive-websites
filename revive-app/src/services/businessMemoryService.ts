import { DataProvider } from '@/domain/repositories';
import { BusinessMemoryEventRecord } from '@/domain/models';

export class BusinessMemoryService {
  constructor(private readonly provider: DataProvider) {}

  recent(workspaceId: string): BusinessMemoryEventRecord[] {
    return this.provider.memory.list(workspaceId).sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
  }

  forContact(workspaceId: string, contactId: string): BusinessMemoryEventRecord[] {
    return this.provider.memory.findByContact(workspaceId, contactId);
  }

  forGoal(workspaceId: string, goalId: string): BusinessMemoryEventRecord[] {
    return this.provider.memory.findByGoal(workspaceId, goalId);
  }

  unresolvedFollowUps(workspaceId: string): BusinessMemoryEventRecord[] {
    return this.provider.memory.listUpcomingFollowUps(workspaceId);
  }

  record(input: Omit<BusinessMemoryEventRecord, 'id'>): BusinessMemoryEventRecord {
    return this.provider.memory.save({ ...input, id: `memory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` });
  }
}
