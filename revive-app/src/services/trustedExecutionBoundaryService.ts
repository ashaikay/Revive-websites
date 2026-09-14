import {
  TrustedActorContext,
  TrustedDryRunEnvelope,
  TrustedExecutionConfiguration,
  TrustedExecutionRequest,
} from '@/domain/execution';
import { ApprovalRecord, REVActionRecord } from '@/domain/models';
import { DataProvider } from '@/domain/repositories';
import { CostGovernor } from './discoveryFoundationService';
import { capabilityForAction, createDryRunPlan } from './executionPolicyService';

export interface TrustedExecutionConfigurationSource {
  resolve(workspaceId: string, action: REVActionRecord): TrustedExecutionConfiguration | undefined;
}

interface IdempotencyEntry {
  requestSignature: string;
  envelope: TrustedDryRunEnvelope;
}

const IDEMPOTENCY_LIMITATION = 'Process-local only; retries after restart or across instances are not deduplicated.';

function canonicalPart(value: string | boolean | undefined): string {
  return encodeURIComponent(value === undefined ? '' : String(value));
}

export function fingerprintActionForApproval(action: REVActionRecord): string {
  return [
    'rev-action-v1', action.id, action.workspaceId, action.goalId, action.contactId, action.opportunityId,
    action.actionType, action.title, action.description, action.rationale, action.requiresApproval,
  ].map(canonicalPart).join('|');
}

function selectedApproval(approvals: ApprovalRecord[], actionId: string): ApprovalRecord | undefined {
  return approvals
    .filter((approval) => approval.revActionId === actionId && (approval.decision === 'approved' || approval.decision === 'edited'))
    .sort((left, right) => (right.decidedAt ?? right.requestedAt).localeCompare(left.decidedAt ?? left.requestedAt))[0];
}

function trustedCapabilityForAction(action: REVActionRecord): string {
  if (action.actionType === 'outreach' || action.actionType === 'send_email') return 'SEND_EMAIL';
  if (action.actionType === 'send_sms') return 'SEND_SMS';
  if (action.actionType === 'financial_action') return 'FINANCIAL_ACTION';
  if (action.actionType === 'high_risk_action') return 'HIGH_RISK_ACTION';
  return capabilityForAction(action);
}

export class InMemoryExecutionIdempotencyStore {
  private readonly entries = new Map<string, IdempotencyEntry>();

  get(key: string): IdempotencyEntry | undefined { return this.entries.get(key); }
  save(key: string, entry: IdempotencyEntry): void { this.entries.set(key, entry); }
}

export class TrustedExecutionBoundaryService {
  constructor(
    private readonly provider: DataProvider,
    private readonly configuration: TrustedExecutionConfigurationSource,
    private readonly governor: CostGovernor = new CostGovernor(),
    private readonly idempotency: InMemoryExecutionIdempotencyStore = new InMemoryExecutionIdempotencyStore(),
  ) {}

  prepareDryRun(request: TrustedExecutionRequest, actor: TrustedActorContext): TrustedDryRunEnvelope {
    if (!request.requestId || !request.workspaceId || !request.actionId || !actor.actorUserId) {
      throw new Error('Trusted execution request requires request, workspace, action, and authenticated actor identifiers.');
    }

    const idempotencyKey = `${actor.actorUserId}:${request.workspaceId}:${request.requestId}`;
    const requestSignature = `${request.workspaceId}:${request.actionId}`;
    const previous = this.idempotency.get(idempotencyKey);
    if (previous) {
      if (previous.requestSignature !== requestSignature) throw new Error('Idempotency key was already used for a different execution request.');
      return { ...structuredClone(previous.envelope), idempotency: { ...previous.envelope.idempotency, replayed: true } };
    }

    const membership = this.provider.workspaces.getMembership(request.workspaceId, actor.actorUserId);
    if (!membership) throw new Error('Active workspace membership is required.');
    if (!['owner', 'admin', 'member'].includes(membership.role)) throw new Error('The active workspace role cannot prepare execution.');

    const action = this.provider.actions.get(request.workspaceId, request.actionId);
    if (!action) throw new Error('The requested action was not found in the active workspace.');
    const settings = this.configuration.resolve(request.workspaceId, action);
    if (!settings) throw new Error('Trusted workspace execution configuration is unavailable.');

    const approval = selectedApproval(this.provider.approvals.list(request.workspaceId), action.id);
    const currentFingerprint = fingerprintActionForApproval(action);
    const approvalFingerprintValid = Boolean(approval?.actionFingerprint && approval.actionFingerprint === currentFingerprint);
    const approvalState = approval ? 'approved' : 'pending';
    const plan = createDryRunPlan({
      action,
      capability: trustedCapabilityForAction(action),
      actorUserId: actor.actorUserId,
      actorRole: membership.role,
      workspaceId: request.workspaceId,
      workspaceExecutionEnabled: settings.workspaceExecutionEnabled,
      approvalId: approval?.id,
      approvalState,
      approvalFingerprintValid,
      audienceSafety: settings.audienceSafety,
      estimatedExternalCost: settings.estimatedExternalCost,
      providerConfigured: settings.providerConfigured,
      countryCode: settings.countryCode,
      jurisdiction: settings.jurisdiction,
      autonomyMode: settings.autonomyMode,
      usagePlan: settings.usagePlan,
    }, this.governor);

    const envelope: TrustedDryRunEnvelope = {
      requestId: request.requestId,
      workspaceId: request.workspaceId,
      actionId: action.id,
      actorUserId: actor.actorUserId,
      actorRole: membership.role,
      approvalId: approval?.id,
      approvalFingerprint: currentFingerprint,
      approvalFingerprintValid,
      plan,
      providerInvoked: false,
      executionEnabled: false,
      idempotency: { replayed: false, durable: false, limitation: IDEMPOTENCY_LIMITATION },
    };
    this.idempotency.save(idempotencyKey, { requestSignature, envelope: structuredClone(envelope) });
    return envelope;
  }
}