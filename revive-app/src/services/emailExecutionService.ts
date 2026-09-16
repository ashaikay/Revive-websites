import {
  AuthorizedEmailExecution,
  EmailExecutionActor,
  EmailExecutionAuthority,
  EmailExecutionRequest,
  EmailExecutionResult,
  EmailProvider,
  SEND_APPROVED_EMAIL_CAPABILITY,
} from '@/domain/emailExecution';
import { PLATFORM_EXECUTION_ENABLED } from './executionPolicyService';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateAuthorization(
  request: EmailExecutionRequest,
  actor: EmailExecutionActor,
  authorization: AuthorizedEmailExecution,
): void {
  if (authorization.workspaceId !== request.workspaceId || authorization.actionId !== request.actionId) {
    throw new Error('Trusted email authorization does not match the requested workspace and action.');
  }
  if (authorization.actorUserId !== actor.actorUserId || authorization.membershipStatus !== 'active'
    || !['owner', 'admin'].includes(authorization.actorRole)) {
    throw new Error('An active owner or admin is required to authorize email execution.');
  }
  if (authorization.sourceActionType !== 'prepare_follow_up') {
    throw new Error('Only approved PREPARE_FOLLOW_UP actions may enter the email execution gateway.');
  }
  if (authorization.capability !== SEND_APPROVED_EMAIL_CAPABILITY) {
    throw new Error('Trusted authorization must grant SEND_APPROVED_EMAIL.');
  }
  if (!Number.isInteger(authorization.actionVersion) || authorization.actionVersion < 1
    || authorization.approvalActionVersion !== authorization.actionVersion) {
    throw new Error('The approval does not bind the current action version.');
  }
  if (authorization.approvalDecision !== 'approved' || !authorization.approvalStillValid
    || !SHA256_PATTERN.test(authorization.currentActionFingerprint)
    || authorization.currentActionFingerprint !== authorization.approvedActionFingerprint) {
    throw new Error('The approved email content is stale or has been modified.');
  }
  if (!SHA256_PATTERN.test(authorization.requestFingerprint)
    || authorization.requestFingerprintScope !== 'approved_email_snapshot') {
    throw new Error('A trusted request fingerprint is required.');
  }
  if (!authorization.executionId || !authorization.correlationId || !authorization.approvalId
    || !authorization.durable || !authorization.durableIdempotencyKey
    || authorization.idempotencyScope !== 'approved_action_version') {
    throw new Error('A durable Phase 4C execution reservation is required.');
  }
  if (!authorization.workspaceExecutionEnabled) throw new Error('Workspace email execution is disabled.');
  if (authorization.audienceSafety !== 'allowed') throw new Error('Audience safety does not permit email execution.');
  if (authorization.jurisdiction !== 'GB') throw new Error('Email execution is not supported in this jurisdiction.');
  if (authorization.costDecision !== 'allow' || authorization.estimatedProviderCost < 0) {
    throw new Error('Cost Governor did not authorize email execution.');
  }
  if (authorization.recipientSource !== 'workspace_contact'
    || !authorization.recipientVerified || !authorization.suppressionChecked) {
    throw new Error('The recipient must be verified from an unsuppressed workspace contact.');
  }
  if (!EMAIL_PATTERN.test(authorization.email.recipient.trim())) throw new Error('A valid approved recipient is required.');
  if (!authorization.email.subject.trim()) throw new Error('An approved email subject is required.');
  if (!authorization.email.body.trim()) throw new Error('An approved email body is required.');
}

export class EmailExecutionService {
  constructor(
    private readonly authority: EmailExecutionAuthority,
    private readonly provider?: EmailProvider,
  ) {}

  async requestExecution(request: EmailExecutionRequest, actor: EmailExecutionActor): Promise<EmailExecutionResult> {
    if (!request.requestId || !request.workspaceId || !request.actionId || !actor.actorUserId) {
      throw new Error('Email execution requires request, workspace, action, and authenticated actor identifiers.');
    }

    const authorization = await this.authority.authorizeAndReserve(request, actor);
    validateAuthorization(request, actor, authorization);

    if (!PLATFORM_EXECUTION_ENABLED) {
      return {
        requestId: request.requestId,
        workspaceId: request.workspaceId,
        actionId: request.actionId,
        executionId: authorization.executionId,
        status: 'gateway_disabled',
        displayStatus: 'DRY RUN — NOTHING SENT',
        providerIdentifier: this.provider?.identifier,
        providerInvoked: false,
        emailSent: false,
        providerCost: 0,
        executionEnabled: false,
        durableIdempotency: true,
        replayed: authorization.replayed,
      };
    }

    throw new Error('Live email provider invocation is not implemented in Phase 4G.1.');
  }
}