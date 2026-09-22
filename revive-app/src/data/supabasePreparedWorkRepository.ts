import { SupabaseClient } from '@supabase/supabase-js';
import {
  ApprovalDecision,
  BusinessMemoryEventRecord,
  BusinessProfileRecord,
  BusinessServiceRecord,
  ContactRecord,
  GoalRecord,
  MemberRole,
  OpportunityRecord,
  REVActionRecord,
  WorkspaceMemberRecord,
} from '@/domain/models';
import { PreparedFollowUpArtifact } from '@/domain/preparedWork';
import { RecoveryCandidate, RecoverySignalType } from '@/domain/recovery';
import { supabaseClient } from './supabaseClient';
import { buildPreparedFollowUpDraft } from '@/services/preparedFollowUpDraft';
import { analyzeRecovery } from '@/services/recoveryService';
import { deterministicUuid, fingerprintREVAction } from '@/services/revActionFingerprint';

const PREPARED_EVENT = 'FOLLOW_UP_PREPARED';

export interface LiveREVAction extends REVActionRecord {
  actionVersion: number;
}

export interface LiveApproval {
  id: string;
  workspaceId: string;
  revActionId: string;
  requestedAt: string;
  decision?: ApprovalDecision;
  decidedAt?: string;
}

export interface StoredPreparedFollowUp {
  recoveryCandidateId: string;
  recoveryType: RecoverySignalType;
  approvalId: string;
  recoveryReason: string;
  objective: string;
  suggestedChannel: PreparedFollowUpArtifact['suggestedChannel'];
  evidenceContext: PreparedFollowUpArtifact['evidenceContext'];
  missingInformation: string[];
}

export interface PreparedMemory {
  id: string;
  workspaceId: string;
  entityId: string;
  occurredAt: string;
  stored: StoredPreparedFollowUp;
}

export interface LivePreparedWorkContext {
  membership?: WorkspaceMemberRecord;
  profile?: BusinessProfileRecord;
  services: BusinessServiceRecord[];
  goals: GoalRecord[];
  contacts: ContactRecord[];
  opportunities: OpportunityRecord[];
}

export interface LivePreparedWorkState {
  actions: LiveREVAction[];
  approvals: LiveApproval[];
  memories: PreparedMemory[];
}

export interface LivePreparedWorkGateway {
  loadContext(workspaceId: string, actorUserId: string): Promise<LivePreparedWorkContext>;
  loadPreparedState(workspaceId: string): Promise<LivePreparedWorkState>;
  insertAction(action: LiveREVAction): Promise<void>;
  insertApproval(approval: LiveApproval): Promise<void>;
  insertMemory(event: BusinessMemoryEventRecord): Promise<void>;
  updateAction(workspaceId: string, actionId: string, actionVersion: number, title: string, description: string): Promise<void>;
  decideApproval(input: {
    approvalId: string;
    actionVersion: number;
    actionFingerprint: string;
    decision: 'approved' | 'rejected';
  }): Promise<void>;
}

export interface LivePrepareFollowUpResult {
  artifact: PreparedFollowUpArtifact;
  alreadyPrepared: boolean;
}

function requiredClient(): SupabaseClient {
  if (!supabaseClient) throw new Error('Supabase mode requires browser-safe public client configuration.');
  return supabaseClient;
}

function throwOnError(error: { message: string } | null): void {
  if (error) throw new Error(error.message);
}

function mapMembership(row: Record<string, unknown> | null): WorkspaceMemberRecord | undefined {
  if (!row) return undefined;
  return {
    workspaceId: String(row.workspace_id), userId: String(row.user_id), role: row.role as MemberRole,
    status: 'active', joinedAt: String(row.joined_at),
  };
}

function mapProfile(row: Record<string, unknown> | null): BusinessProfileRecord | undefined {
  if (!row) return undefined;
  return {
    workspaceId: String(row.workspace_id), businessName: String(row.business_name), description: String(row.description ?? ''),
    website: row.website ? String(row.website) : undefined, industry: row.industry ? String(row.industry) : undefined,
    targetCustomers: String(row.target_customers ?? ''), serviceAreas: Array.isArray(row.service_areas) ? row.service_areas.map(String) : [],
    openingHours: row.opening_hours && typeof row.opening_hours === 'object' ? row.opening_hours as Record<string, string> : {},
    differentiators: Array.isArray(row.differentiators) ? row.differentiators.map(String) : [], brandVoice: String(row.brand_voice ?? ''),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapService(row: Record<string, unknown>): BusinessServiceRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), name: String(row.name), description: String(row.description ?? ''),
    priceInformation: row.price_information ? String(row.price_information) : undefined, active: Boolean(row.active),
  };
}

function mapGoal(row: Record<string, unknown>): GoalRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), title: String(row.title), objective: String(row.objective),
    metric: String(row.metric), targetValue: Number(row.target_value), currentValue: Number(row.current_value),
    startDate: String(row.start_date), targetDate: String(row.target_date), priority: row.priority as GoalRecord['priority'],
    status: row.status as GoalRecord['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapContact(row: Record<string, unknown>, suppressions: Map<string, ContactRecord['suppressionReason']>): ContactRecord {
  const id = String(row.id);
  return {
    id, workspaceId: String(row.workspace_id), lifecycle: row.lifecycle as ContactRecord['lifecycle'], name: String(row.name),
    company: row.company ? String(row.company) : undefined, email: row.email ? String(row.email) : undefined,
    phone: row.phone ? String(row.phone) : undefined, source: row.source ? String(row.source) : undefined,
    estimatedValue: row.estimated_value === null ? undefined : Number(row.estimated_value),
    score: row.score === null ? undefined : Number(row.score), lastInteractionAt: row.last_interaction_at ? String(row.last_interaction_at) : undefined,
    nextActionAt: row.next_action_at ? String(row.next_action_at) : undefined, ownerUserId: row.owner_user_id ? String(row.owner_user_id) : undefined,
    doNotContact: suppressions.has(id), suppressionReason: suppressions.get(id), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapOpportunity(row: Record<string, unknown>): OpportunityRecord {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), contactId: String(row.contact_id), title: String(row.title),
    description: row.description ? String(row.description) : undefined, opportunityType: row.opportunity_type as OpportunityRecord['opportunityType'],
    stage: row.stage as OpportunityRecord['stage'], source: row.source as OpportunityRecord['source'],
    estimatedValue: row.estimated_value === null ? undefined : Number(row.estimated_value), currency: String(row.currency),
    probability: row.probability === null ? undefined : Number(row.probability), attribution: row.attribution as OpportunityRecord['attribution'],
    createdByType: row.created_by_type as OpportunityRecord['createdByType'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    lastActivityAt: row.last_activity_at ? String(row.last_activity_at) : undefined,
    nextActionAt: row.next_action_at ? String(row.next_action_at) : undefined,
    wonAt: row.won_at ? String(row.won_at) : undefined, lostAt: row.lost_at ? String(row.lost_at) : undefined,
    lostReason: row.lost_reason ? String(row.lost_reason) : undefined,
  };
}

function mapAction(row: Record<string, unknown>): LiveREVAction {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), goalId: row.goal_id ? String(row.goal_id) : undefined,
    contactId: row.contact_id ? String(row.contact_id) : undefined, opportunityId: row.opportunity_id ? String(row.opportunity_id) : undefined,
    actionType: String(row.action_type), title: String(row.title), description: String(row.description),
    rationale: row.rationale ? String(row.rationale) : undefined, requiresApproval: Boolean(row.requires_approval),
    status: row.status as REVActionRecord['status'], executionStatus: row.execution_status as REVActionRecord['executionStatus'],
    proposedAt: String(row.proposed_at), approvedAt: row.approved_at ? String(row.approved_at) : undefined,
    executedAt: row.executed_at ? String(row.executed_at) : undefined, outcomeSummary: row.outcome_summary ? String(row.outcome_summary) : undefined,
    actionVersion: Number(row.action_version),
  };
}

function mapApproval(row: Record<string, unknown>): LiveApproval {
  return {
    id: String(row.id), workspaceId: String(row.workspace_id), revActionId: String(row.rev_action_id), requestedAt: String(row.requested_at),
    decision: row.decision ? row.decision as ApprovalDecision : undefined, decidedAt: row.decided_at ? String(row.decided_at) : undefined,
  };
}

function isStoredPreparedFollowUp(value: unknown): value is StoredPreparedFollowUp {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredPreparedFollowUp>;
  return typeof record.recoveryCandidateId === 'string' && typeof record.recoveryType === 'string'
    && typeof record.approvalId === 'string' && typeof record.recoveryReason === 'string'
    && typeof record.objective === 'string' && typeof record.suggestedChannel === 'string'
    && Array.isArray(record.evidenceContext) && Array.isArray(record.missingInformation);
}

export const browserSupabasePreparedWorkGateway: LivePreparedWorkGateway = {
  async loadContext(workspaceId, actorUserId) {
    const client = requiredClient();
    const [membership, profile, services, goals, contacts, opportunities, suppressions] = await Promise.all([
      client.from('workspace_members').select('workspace_id,user_id,role,status,joined_at').eq('workspace_id', workspaceId).eq('user_id', actorUserId).eq('status', 'active').maybeSingle(),
      client.from('business_profiles').select('*').eq('workspace_id', workspaceId).maybeSingle(),
      client.from('business_services').select('*').eq('workspace_id', workspaceId).eq('active', true).order('name'),
      client.from('goals').select('*').eq('workspace_id', workspaceId).order('created_at'),
      client.from('contacts').select('*').eq('workspace_id', workspaceId).order('created_at'),
      client.from('opportunities').select('*').eq('workspace_id', workspaceId).order('created_at'),
      client.from('contact_suppressions').select('contact_id,reason').eq('workspace_id', workspaceId),
    ]);
    for (const result of [membership, profile, services, goals, contacts, opportunities, suppressions]) throwOnError(result.error);
    const suppressionMap = new Map((suppressions.data ?? []).map((row) => [String(row.contact_id), row.reason as ContactRecord['suppressionReason']]));
    return {
      membership: mapMembership(membership.data), profile: mapProfile(profile.data),
      services: (services.data ?? []).map(mapService), goals: (goals.data ?? []).map(mapGoal),
      contacts: (contacts.data ?? []).map((row) => mapContact(row, suppressionMap)), opportunities: (opportunities.data ?? []).map(mapOpportunity),
    };
  },

  async loadPreparedState(workspaceId) {
    const client = requiredClient();
    const [actions, approvals, memories] = await Promise.all([
      client.from('rev_actions').select('*').eq('workspace_id', workspaceId).eq('action_type', 'prepare_follow_up').order('proposed_at'),
      client.from('approvals').select('id,workspace_id,rev_action_id,requested_at,decision,decided_at').eq('workspace_id', workspaceId),
      client.from('business_memory_events').select('id,workspace_id,entity_id,occurred_at,structured_data').eq('workspace_id', workspaceId).eq('event_type', PREPARED_EVENT),
    ]);
    for (const result of [actions, approvals, memories]) throwOnError(result.error);
    return {
      actions: (actions.data ?? []).map(mapAction), approvals: (approvals.data ?? []).map(mapApproval),
      memories: (memories.data ?? []).flatMap((row) => {
        const structured = row.structured_data as Record<string, unknown> | null;
        const stored = structured?.preparedFollowUp;
        return row.entity_id && isStoredPreparedFollowUp(stored)
          ? [{ id: String(row.id), workspaceId: String(row.workspace_id), entityId: String(row.entity_id), occurredAt: String(row.occurred_at), stored }]
          : [];
      }),
    };
  },

  async insertAction(action) {
    const { error } = await requiredClient().from('rev_actions').upsert({
      id: action.id, workspace_id: action.workspaceId, goal_id: action.goalId, contact_id: action.contactId,
      opportunity_id: action.opportunityId, action_type: action.actionType, title: action.title, description: action.description,
      rationale: action.rationale, requires_approval: action.requiresApproval, status: action.status,
      execution_status: action.executionStatus, proposed_at: action.proposedAt,
    }, { onConflict: 'id', ignoreDuplicates: true });
    throwOnError(error);
  },

  async insertApproval(approval) {
    const { error } = await requiredClient().from('approvals').upsert({
      id: approval.id, workspace_id: approval.workspaceId, rev_action_id: approval.revActionId, requested_at: approval.requestedAt,
    }, { onConflict: 'id', ignoreDuplicates: true });
    throwOnError(error);
  },

  async insertMemory(event) {
    const { error } = await requiredClient().from('business_memory_events').upsert({
      id: event.id, workspace_id: event.workspaceId, event_type: event.eventType, entity_type: event.entityType,
      entity_id: event.entityId, title: event.title, summary: event.summary, structured_data: event.structuredData,
      occurred_at: event.occurredAt, created_by_type: event.createdByType, created_by_id: event.createdById,
    }, { onConflict: 'id', ignoreDuplicates: true });
    throwOnError(error);
  },

  async updateAction(workspaceId, actionId, actionVersion, title, description) {
    const { data, error } = await requiredClient().from('rev_actions').update({ title, description })
      .eq('workspace_id', workspaceId).eq('id', actionId).eq('action_version', actionVersion).select('id');
    throwOnError(error);
    if (!data?.length) throw new Error('Prepared follow-up changed before the edit could be saved. Reload and review again.');
  },

  async decideApproval(input) {
    const { error } = await requiredClient().rpc('decide_rev_action_approval', {
      target_approval_id: input.approvalId, expected_action_version: input.actionVersion,
      expected_action_fingerprint: input.actionFingerprint, approval_decision: input.decision,
      decision_notes: 'Prepared follow-up reviewed. Nothing sent.',
    });
    throwOnError(error);
  },
};

function approvalState(decision: ApprovalDecision | undefined): PreparedFollowUpArtifact['approvalState'] {
  if (decision === 'approved' || decision === 'edited') return 'approved_not_sent';
  if (decision === 'rejected') return 'rejected';
  return 'pending';
}

function toArtifact(action: LiveREVAction, approval: LiveApproval, memory: PreparedMemory): PreparedFollowUpArtifact {
  return {
    id: memory.id, workspaceId: action.workspaceId, revActionId: action.id, approvalId: approval.id,
    recoveryCandidateId: memory.stored.recoveryCandidateId, recoveryType: memory.stored.recoveryType,
    contactId: action.contactId, opportunityId: action.opportunityId, recoveryReason: memory.stored.recoveryReason,
    objective: memory.stored.objective, suggestedChannel: memory.stored.suggestedChannel, subject: action.title,
    draftMessage: action.description, evidenceContext: memory.stored.evidenceContext,
    missingInformation: memory.stored.missingInformation, ownerEditable: true, approvalState: approvalState(approval.decision),
    externalSend: false, providerInvoked: false, estimatedCost: 0, createdAt: memory.occurredAt,
    updatedAt: action.approvedAt ?? memory.occurredAt,
  };
}

export class SupabasePreparedWorkRepository {
  constructor(private readonly gateway: LivePreparedWorkGateway = browserSupabasePreparedWorkGateway) {}

  loadContext(workspaceId: string, actorUserId: string): Promise<LivePreparedWorkContext> {
    return this.gateway.loadContext(workspaceId, actorUserId);
  }

  async list(workspaceId: string): Promise<PreparedFollowUpArtifact[]> {
    const state = await this.gateway.loadPreparedState(workspaceId);

    const latestMemories = [...state.memories]
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
      .filter(
        (memory, index, memories) =>
          memories.findIndex((item) => item.entityId === memory.entityId) === index,
      );

    return latestMemories.flatMap((memory) => {
      const action = state.actions.find((item) => item.id === memory.entityId);
      const approval = state.approvals.find(
        (item) =>
          item.id === memory.stored.approvalId &&
          item.revActionId === memory.entityId,
      );
      return action && approval ? [toArtifact(action, approval, memory)] : [];
    });
  }

  async prepare(candidate: RecoveryCandidate, actorUserId: string, now = new Date().toISOString()): Promise<LivePrepareFollowUpResult> {
    const context = await this.gateway.loadContext(candidate.workspaceId, actorUserId);
    if (!context.membership || !['owner', 'admin', 'member'].includes(context.membership.role)) {
      throw new Error('The active workspace role is not authorised to prepare follow-up work.');
    }
    const existing = (await this.list(candidate.workspaceId)).find((artifact) => artifact.recoveryCandidateId === candidate.id);
    if (existing) return { artifact: existing, alreadyPrepared: true };

    const opportunity = candidate.opportunityId ? context.opportunities.find((item) => item.id === candidate.opportunityId) : undefined;
    if (candidate.opportunityId && !opportunity) throw new Error('Recovery opportunity was not found in the active workspace.');
    const contactId = candidate.contactId ?? opportunity?.contactId;
    const contact = contactId ? context.contacts.find((item) => item.id === contactId) : undefined;
    if (contactId && !contact) throw new Error('Recovery contact was not found in the active workspace.');
    const draft = buildPreparedFollowUpDraft(candidate, {
      profile: context.profile, services: context.services,
      goal: candidate.goalId ? context.goals.find((item) => item.id === candidate.goalId) : undefined,
      contact, opportunity,
    });

    const actionId = await deterministicUuid(`prepared-action:${candidate.workspaceId}:${candidate.id}`);
    const approvalId = await deterministicUuid(`prepared-approval:${candidate.workspaceId}:${candidate.id}`);
    const memoryId = await deterministicUuid(`prepared-memory:${candidate.workspaceId}:${candidate.id}`);
    const action: LiveREVAction = {
      id: actionId, workspaceId: candidate.workspaceId, goalId: candidate.goalId, contactId: draft.contactId,
      opportunityId: candidate.opportunityId, actionType: 'prepare_follow_up', title: draft.subject,
      description: draft.draftMessage, rationale: `prepared-follow-up:${candidate.id} | ${draft.rationale}`,
      requiresApproval: true, status: 'awaiting_approval', executionStatus: 'not_executed', proposedAt: now, actionVersion: 1,
    };
    const stored: StoredPreparedFollowUp = {
      recoveryCandidateId: candidate.id, recoveryType: candidate.signalType, approvalId,
      recoveryReason: draft.recoveryReason, objective: draft.objective, suggestedChannel: draft.suggestedChannel,
      evidenceContext: draft.evidenceContext, missingInformation: draft.missingInformation,
    };
    await this.gateway.insertAction(action);
    await this.gateway.insertApproval({ id: approvalId, workspaceId: candidate.workspaceId, revActionId: actionId, requestedAt: now });
    await this.gateway.insertMemory({
      id: memoryId, workspaceId: candidate.workspaceId, eventType: PREPARED_EVENT, entityType: 'rev_action', entityId: actionId,
      title: 'REV prepared a follow-up draft', summary: 'Internal draft prepared for owner/admin review. Nothing was sent.',
      structuredData: { preparedFollowUp: stored }, occurredAt: now, createdByType: 'user', createdById: actorUserId,
    });
    const artifact = (await this.list(candidate.workspaceId)).find((item) => item.recoveryCandidateId === candidate.id);
    if (!artifact) throw new Error('Prepared follow-up could not be reloaded after persistence.');
    return { artifact, alreadyPrepared: false };
  }

  async refreshContext(
    workspaceId: string,
    artifactId: string,
    actorUserId: string,
    now = new Date().toISOString(),
  ): Promise<PreparedFollowUpArtifact> {
    const context = await this.gateway.loadContext(workspaceId, actorUserId);

    if (!context.membership || !['owner', 'admin'].includes(context.membership.role)) {
      throw new Error('Owner or admin role is required to refresh prepared work.');
    }

    const state = await this.gateway.loadPreparedState(workspaceId);
    const memory = state.memories.find((item) => item.id === artifactId);
    const action = memory
      ? state.actions.find((item) => item.id === memory.entityId)
      : undefined;
    const approval = memory
      ? state.approvals.find(
          (item) =>
            item.id === memory.stored.approvalId &&
            item.revActionId === memory.entityId,
        )
      : undefined;

    if (!memory || !action || !approval) {
      throw new Error('Prepared follow-up was not found in the active workspace.');
    }

    if (
      approval.decision ||
      action.status !== 'awaiting_approval' ||
      action.executionStatus !== 'not_executed'
    ) {
      throw new Error('Only pending, unexecuted prepared work can have its context refreshed.');
    }

    const primaryGoal =
      context.goals.find((goal) => goal.status === 'active') ??
      context.goals[0];

    const recovery = analyzeRecovery({
      workspaceId,
      goal: primaryGoal,
      profile: context.profile,
      services: context.services,
      contacts: context.contacts,
      opportunities: context.opportunities,
      discoveryCandidates: [],
    });

    const candidate = recovery.candidates.find(
      (item) => item.id === memory.stored.recoveryCandidateId,
    );

    if (!candidate) {
      throw new Error('The original recovery opportunity is no longer available.');
    }

    const opportunity = candidate.opportunityId
      ? context.opportunities.find((item) => item.id === candidate.opportunityId)
      : undefined;

    const contactId = candidate.contactId ?? opportunity?.contactId;
    const contact = contactId
      ? context.contacts.find((item) => item.id === contactId)
      : undefined;

    const draft = buildPreparedFollowUpDraft(candidate, {
      profile: context.profile,
      services: context.services,
      goal: candidate.goalId
        ? context.goals.find((item) => item.id === candidate.goalId)
        : undefined,
      contact,
      opportunity,
    });

    const stored: StoredPreparedFollowUp = {
      recoveryCandidateId: candidate.id,
      recoveryType: candidate.signalType,
      approvalId: approval.id,
      recoveryReason: draft.recoveryReason,
      objective: draft.objective,
      suggestedChannel: draft.suggestedChannel,
      evidenceContext: draft.evidenceContext,
      missingInformation: draft.missingInformation,
    };

    const memoryId = await deterministicUuid(
      `prepared-memory-refresh:${workspaceId}:${action.id}:${now}`,
    );

    await this.gateway.insertMemory({
      id: memoryId,
      workspaceId,
      eventType: PREPARED_EVENT,
      entityType: 'rev_action',
      entityId: action.id,
      title: 'REV refreshed prepared follow-up context',
      summary: 'Evidence context refreshed for owner/admin review. Draft content was preserved. Nothing was sent.',
      structuredData: { preparedFollowUp: stored },
      occurredAt: now,
      createdByType: 'user',
      createdById: actorUserId,
    });

    return this.requireArtifact(workspaceId, memoryId);
  }

  async edit(workspaceId: string, artifactId: string, actorUserId: string, subject: string, draftMessage: string): Promise<PreparedFollowUpArtifact> {
    const context = await this.gateway.loadContext(workspaceId, actorUserId);
    if (!context.membership || !['owner', 'admin'].includes(context.membership.role)) throw new Error('Owner or admin role is required to edit prepared work.');
    if (!subject.trim() || !draftMessage.trim()) throw new Error('Subject and draft message are required.');
    const state = await this.gateway.loadPreparedState(workspaceId);
    const memory = state.memories.find((item) => item.id === artifactId);
    const action = memory ? state.actions.find((item) => item.id === memory.entityId) : undefined;
    const approval = memory ? state.approvals.find((item) => item.id === memory.stored.approvalId) : undefined;
    if (!memory || !action || !approval) throw new Error('Prepared follow-up was not found in the active workspace.');
    if (approval.decision || action.status !== 'awaiting_approval') throw new Error('Only pending prepared work can be edited.');
    await this.gateway.updateAction(workspaceId, action.id, action.actionVersion, subject.trim(), draftMessage.trim());
    return this.requireArtifact(workspaceId, artifactId);
  }

  async decide(workspaceId: string, artifactId: string, actorUserId: string, decision: 'approved' | 'rejected'): Promise<PreparedFollowUpArtifact> {
    const context = await this.gateway.loadContext(workspaceId, actorUserId);
    if (!context.membership || !['owner', 'admin'].includes(context.membership.role)) throw new Error('Owner or admin role is required to review prepared work.');
    const state = await this.gateway.loadPreparedState(workspaceId);
    const memory = state.memories.find((item) => item.id === artifactId);
    const action = memory ? state.actions.find((item) => item.id === memory.entityId) : undefined;
    const approval = memory ? state.approvals.find((item) => item.id === memory.stored.approvalId && item.revActionId === memory.entityId) : undefined;
    if (!memory || !action || !approval) throw new Error('Prepared follow-up was not found in the active workspace.');
    if (approval.decision || action.status !== 'awaiting_approval') throw new Error('This prepared follow-up has already been reviewed.');
    await this.gateway.decideApproval({
      approvalId: approval.id, actionVersion: action.actionVersion,
      actionFingerprint: await fingerprintREVAction(action), decision,
    });
    return this.requireArtifact(workspaceId, artifactId);
  }

  private async requireArtifact(workspaceId: string, artifactId: string): Promise<PreparedFollowUpArtifact> {
    const artifact = (await this.list(workspaceId)).find((item) => item.id === artifactId);
    if (!artifact) throw new Error('Prepared follow-up could not be reloaded.');
    return artifact;
  }
}
