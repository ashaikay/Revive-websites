import { CommercialEvidence } from '@/domain/commercialIntelligence';
import { MemberRole, REVActionRecord } from '@/domain/models';
import {
  PreparedFollowUpApprovalState,
  PreparedFollowUpArtifact,
  PreparedFollowUpChannel,
} from '@/domain/preparedWork';
import { RecoveryCandidate, RecoverySignalType } from '@/domain/recovery';
import { DataProvider } from '@/domain/repositories';
import { ApprovalService } from './approvalService';
import { CommercialActionService } from './commercialActionService';
import { buildPreparedFollowUpDraft } from './preparedFollowUpDraft';

const PREPARED_EVENT = 'FOLLOW_UP_PREPARED';

interface StoredPreparedFollowUp {
  recoveryCandidateId: string;
  recoveryType: RecoverySignalType;
  approvalId: string;
  recoveryReason: string;
  objective: string;
  suggestedChannel: PreparedFollowUpChannel;
  evidenceContext: CommercialEvidence[];
  missingInformation: string[];
}

export interface PrepareFollowUpResult {
  artifact: PreparedFollowUpArtifact;
  alreadyPrepared: boolean;
}

function approvalState(decision: string | undefined): PreparedFollowUpApprovalState {
  if (decision === 'approved' || decision === 'edited') return 'approved_not_sent';
  if (decision === 'rejected') return 'rejected';
  return 'pending';
}

function isStoredFollowUp(value: unknown): value is StoredPreparedFollowUp {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<StoredPreparedFollowUp>;
  return typeof record.recoveryCandidateId === 'string'
    && typeof record.recoveryType === 'string'
    && typeof record.approvalId === 'string'
    && typeof record.recoveryReason === 'string'
    && typeof record.objective === 'string'
    && typeof record.suggestedChannel === 'string'
    && Array.isArray(record.evidenceContext)
    && Array.isArray(record.missingInformation);
}

export class FollowUpPreparationService {
  private readonly commercialActions: CommercialActionService;
  private readonly approvals: ApprovalService;

  constructor(private readonly provider: DataProvider) {
    this.commercialActions = new CommercialActionService(provider);
    this.approvals = new ApprovalService(provider);
  }

  list(workspaceId: string): PreparedFollowUpArtifact[] {
    const actions = this.provider.actions.list(workspaceId);
    const approvals = this.provider.approvals.list(workspaceId);
    return this.provider.memory.list(workspaceId)
      .filter((event) => event.eventType === PREPARED_EVENT && event.entityType === 'rev_action' && event.entityId)
      .flatMap((event) => {
        const action = actions.find((item) => item.id === event.entityId);
        const stored = event.structuredData.preparedFollowUp;
        if (!action || !isStoredFollowUp(stored)) return [];
        const approval = approvals.find((item) => item.id === stored.approvalId && item.revActionId === action.id);
        if (!approval) return [];
        return [this.toArtifact(event.id, event.occurredAt, action, stored, approval.decision)];
      });
  }

  prepare(candidate: RecoveryCandidate, actorUserId: string, now = new Date().toISOString()): PrepareFollowUpResult {
    const role = this.requireRole(candidate.workspaceId, actorUserId, ['owner', 'admin', 'member']);
    void role;

    const opportunity = candidate.opportunityId
      ? this.provider.opportunities.get(candidate.workspaceId, candidate.opportunityId)
      : undefined;
    if (candidate.opportunityId && !opportunity) throw new Error('Recovery opportunity was not found in the active workspace.');
    const contactId = candidate.contactId ?? opportunity?.contactId;
    const contact = contactId ? this.provider.contacts.get(candidate.workspaceId, contactId) : undefined;
    if (contactId && !contact) throw new Error('Recovery contact was not found in the active workspace.');
    const existing = this.list(candidate.workspaceId).find((artifact) => artifact.recoveryCandidateId === candidate.id);
    if (existing) return { artifact: existing, alreadyPrepared: true };

    const draft = buildPreparedFollowUpDraft(candidate, {
      profile: this.provider.business.getProfile(candidate.workspaceId),
      services: this.provider.business.listServices(candidate.workspaceId),
      goal: candidate.goalId ? this.provider.goals.get(candidate.workspaceId, candidate.goalId) : undefined,
      contact,
      opportunity,
    });
    const proposed = this.commercialActions.proposePreparedFollowUp({
      workspaceId: candidate.workspaceId,
      goalId: candidate.goalId,
      contactId: draft.contactId,
      opportunityId: candidate.opportunityId,
      title: draft.subject,
      description: draft.draftMessage,
      rationale: draft.rationale,
      deduplicationKey: candidate.id,
      proposedAt: now,
    });
    if (proposed.alreadyProposed) {
      const artifact = this.list(candidate.workspaceId).find((item) => item.revActionId === proposed.action.id);
      if (!artifact) throw new Error('Existing prepared follow-up is missing its structured context.');
      return { artifact, alreadyPrepared: true };
    }

    const stored: StoredPreparedFollowUp = {
      recoveryCandidateId: candidate.id,
      recoveryType: candidate.signalType,
      approvalId: proposed.approval.id,
      recoveryReason: draft.recoveryReason,
      objective: draft.objective,
      suggestedChannel: draft.suggestedChannel,
      evidenceContext: draft.evidenceContext,
      missingInformation: draft.missingInformation,
    };
    const event = this.provider.memory.save({
      id: `prepared-follow-up-${proposed.action.id}`,
      workspaceId: candidate.workspaceId,
      eventType: PREPARED_EVENT,
      entityType: 'rev_action',
      entityId: proposed.action.id,
      title: 'REV prepared a follow-up draft',
      summary: 'Internal draft prepared for owner/admin review. Nothing was sent.',
      structuredData: { preparedFollowUp: stored },
      occurredAt: now,
      createdByType: 'rev',
    });
    return {
      artifact: this.toArtifact(event.id, event.occurredAt, proposed.action, stored, proposed.approval.decision),
      alreadyPrepared: false,
    };
  }

  edit(workspaceId: string, artifactId: string, actorUserId: string, subject: string, draftMessage: string): PreparedFollowUpArtifact {
    this.requireRole(workspaceId, actorUserId, ['owner', 'admin']);
    if (!subject.trim() || !draftMessage.trim()) throw new Error('Subject and draft message are required.');
    const artifact = this.requireArtifact(workspaceId, artifactId);
    if (artifact.approvalState !== 'pending') throw new Error('Only a pending prepared follow-up can be edited.');
    this.provider.actions.save({
      ...this.requireAction(workspaceId, artifact.revActionId),
      title: subject.trim(),
      description: draftMessage.trim(),
    });
    return this.requireArtifact(workspaceId, artifactId);
  }

  decide(workspaceId: string, artifactId: string, actorUserId: string, decision: 'approved' | 'rejected'): PreparedFollowUpArtifact {
    this.requireRole(workspaceId, actorUserId, ['owner', 'admin']);
    const artifact = this.requireArtifact(workspaceId, artifactId);
    if (artifact.approvalState !== 'pending') throw new Error('This prepared follow-up has already been reviewed.');
    this.approvals.decide(workspaceId, artifact.approvalId, decision, actorUserId, 'Prepared follow-up reviewed. Nothing sent.');
    return this.requireArtifact(workspaceId, artifactId);
  }

  private requireRole(workspaceId: string, actorUserId: string, allowedRoles: MemberRole[]): MemberRole {
    const membership = this.provider.workspaces.getMembership(workspaceId, actorUserId);
    if (!membership || !allowedRoles.includes(membership.role)) throw new Error('The active workspace role is not authorised for this operation.');
    return membership.role;
  }

  private requireAction(workspaceId: string, actionId: string): REVActionRecord {
    const action = this.provider.actions.get(workspaceId, actionId);
    if (!action) throw new Error('Prepared follow-up action was not found in the active workspace.');
    return action;
  }

  private requireArtifact(workspaceId: string, artifactId: string): PreparedFollowUpArtifact {
    const artifact = this.list(workspaceId).find((item) => item.id === artifactId);
    if (!artifact) throw new Error('Prepared follow-up was not found in the active workspace.');
    return artifact;
  }

  private toArtifact(
    id: string,
    occurredAt: string,
    action: REVActionRecord,
    stored: StoredPreparedFollowUp,
    decision: string | undefined,
  ): PreparedFollowUpArtifact {
    return {
      id,
      workspaceId: action.workspaceId,
      revActionId: action.id,
      approvalId: stored.approvalId,
      recoveryCandidateId: stored.recoveryCandidateId,
      recoveryType: stored.recoveryType,
      contactId: action.contactId,
      opportunityId: action.opportunityId,
      recoveryReason: stored.recoveryReason,
      objective: stored.objective,
      suggestedChannel: stored.suggestedChannel,
      subject: action.title,
      draftMessage: action.description,
      evidenceContext: stored.evidenceContext,
      missingInformation: stored.missingInformation,
      ownerEditable: true,
      approvalState: approvalState(decision),
      externalSend: false,
      providerInvoked: false,
      estimatedCost: 0,
      createdAt: occurredAt,
      updatedAt: action.approvedAt ?? occurredAt,
    };
  }
}