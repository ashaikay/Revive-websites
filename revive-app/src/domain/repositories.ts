import {
  ApprovalRecord,
  AuditLogRecord,
  BusinessMemoryEventRecord,
  BusinessProfileRecord,
  BusinessServiceRecord,
  ContactRecord,
  GoalRecord,
  OpportunityRecord,
  REVActionRecord,
  WorkspaceMemberRecord,
  WorkspaceRecord,
} from './models';

export interface WorkspaceRepository {
  listForUser(userId: string): WorkspaceRecord[];
  get(workspaceId: string): WorkspaceRecord | undefined;
  getMembership(workspaceId: string, userId: string): WorkspaceMemberRecord | undefined;
}

export interface BusinessRepository {
  getProfile(workspaceId: string): BusinessProfileRecord | undefined;
  listServices(workspaceId: string): BusinessServiceRecord[];
}

export interface GoalRepository {
  list(workspaceId: string): GoalRecord[];
  get(workspaceId: string, goalId: string): GoalRecord | undefined;
  save(goal: GoalRecord): GoalRecord;
}

export interface ContactRepository {
  list(workspaceId: string): ContactRecord[];
  get(workspaceId: string, contactId: string): ContactRecord | undefined;
  save(contact: ContactRecord): ContactRecord;
}

export interface REVActionRepository {
  list(workspaceId: string): REVActionRecord[];
  get(workspaceId: string, actionId: string): REVActionRecord | undefined;
  save(action: REVActionRecord): REVActionRecord;
}

export interface OpportunityRepository {
  list(workspaceId: string): OpportunityRecord[];
  get(workspaceId: string, opportunityId: string): OpportunityRecord | undefined;
  save(opportunity: OpportunityRecord): OpportunityRecord;
}

export interface ApprovalRepository {
  list(workspaceId: string): ApprovalRecord[];
  get(workspaceId: string, approvalId: string): ApprovalRecord | undefined;
  save(approval: ApprovalRecord): ApprovalRecord;
}

export interface BusinessMemoryRepository {
  list(workspaceId: string): BusinessMemoryEventRecord[];
  findByContact(workspaceId: string, contactId: string): BusinessMemoryEventRecord[];
  findByGoal(workspaceId: string, goalId: string): BusinessMemoryEventRecord[];
  listUpcomingFollowUps(workspaceId: string): BusinessMemoryEventRecord[];
  save(event: BusinessMemoryEventRecord): BusinessMemoryEventRecord;
}

export interface AuditRepository {
  list(workspaceId: string): AuditLogRecord[];
  save(event: AuditLogRecord): AuditLogRecord;
}

export interface DataProvider {
  workspaces: WorkspaceRepository;
  business: BusinessRepository;
  goals: GoalRepository;
  contacts: ContactRepository;
  actions: REVActionRepository;
  opportunities: OpportunityRepository;
  approvals: ApprovalRepository;
  memory: BusinessMemoryRepository;
  audit: AuditRepository;
}
