import { DataProvider } from '@/domain/repositories';
import { SeedData } from './seedFixtures';

function scoped<T extends { workspaceId: string }>(records: T[], workspaceId: string): T[] {
  return records.filter((record) => record.workspaceId === workspaceId).map((record) => structuredClone(record));
}

function scopedRecord<T extends { workspaceId: string }>(records: T[], workspaceId: string, id: string): T | undefined {
  return records.find((record) => record.workspaceId === workspaceId && 'id' in record && record.id === id)
    ? structuredClone(records.find((record) => record.workspaceId === workspaceId && 'id' in record && record.id === id))
    : undefined;
}

function createScopedRepository<T extends { id?: string; workspaceId: string }>(records: T[]) {
  return {
    list: (workspaceId: string) => scoped(records, workspaceId),
    get: (workspaceId: string, id: string) => scopedRecord(records, workspaceId, id),
    save: (record: T) => {
      if (!record.workspaceId) throw new Error('workspaceId is required');
      const index = records.findIndex((candidate) => candidate.id === record.id && candidate.workspaceId === record.workspaceId);
      if (index >= 0) records[index] = structuredClone(record);
      else records.push(structuredClone(record));
      return structuredClone(record);
    },
  };
}

export function createMockDataProvider(seed: SeedData): DataProvider {
  const data = structuredClone(seed);
  const goals = createScopedRepository(data.goals);
  const contacts = createScopedRepository(data.contacts);
  const actions = createScopedRepository(data.actions);
  const opportunities = createScopedRepository(data.opportunities);
  const approvals = createScopedRepository(data.approvals);
  const memory = createScopedRepository(data.memoryEvents);
  const audit = createScopedRepository(data.auditLogs);

  return {
    workspaces: {
      listForUser: (userId) => data.members
        .filter((member) => member.userId === userId && member.status === 'active')
        .map((member) => data.workspaces.find((workspace) => workspace.id === member.workspaceId))
        .filter((workspace): workspace is typeof data.workspaces[number] => Boolean(workspace))
        .map((workspace) => structuredClone(workspace)),
      get: (workspaceId) => structuredClone(data.workspaces.find((workspace) => workspace.id === workspaceId)),
      getMembership: (workspaceId, userId) => structuredClone(data.members.find((member) => member.workspaceId === workspaceId && member.userId === userId && member.status === 'active')),
    },
    business: {
      getProfile: (workspaceId) => structuredClone(data.profiles.find((profile) => profile.workspaceId === workspaceId)),
      listServices: (workspaceId) => scoped(data.services, workspaceId),
    },
    goals,
    contacts,
    actions,
    opportunities,
    approvals,
    memory: {
      ...memory,
      findByContact: (workspaceId, contactId) => memory.list(workspaceId).filter((event) => event.entityType === 'contact' && event.entityId === contactId),
      findByGoal: (workspaceId, goalId) => memory.list(workspaceId).filter((event) => event.entityType === 'goal' && event.entityId === goalId),
      listUpcomingFollowUps: (workspaceId) => memory.list(workspaceId).filter((event) => event.eventType === 'FOLLOW_UP_DUE'),
    },
    audit,
  };
}
