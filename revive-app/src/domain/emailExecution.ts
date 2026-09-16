import { Id, MemberRole } from './models';

export const SEND_APPROVED_EMAIL_CAPABILITY = 'SEND_APPROVED_EMAIL' as const;

export interface EmailExecutionRequest {
  requestId: Id;
  workspaceId: Id;
  actionId: Id;
}

export interface EmailExecutionActor {
  actorUserId: Id;
}

export interface ApprovedEmailSnapshot {
  recipient: string;
  subject: string;
  body: string;
}

export interface AuthorizedEmailExecution {
  executionId: Id;
  correlationId: Id;
  workspaceId: Id;
  actionId: Id;
  approvalId: Id;
  actorUserId: Id;
  actorRole: MemberRole;
  membershipStatus: 'active';
  sourceActionType: 'prepare_follow_up';
  capability: typeof SEND_APPROVED_EMAIL_CAPABILITY;
  actionVersion: number;
  approvalActionVersion: number;
  approvalDecision: 'approved';
  approvalStillValid: true;
  currentActionFingerprint: string;
  approvedActionFingerprint: string;
  requestFingerprint: string;
  requestFingerprintScope: 'approved_email_snapshot';
  durableIdempotencyKey: string;
  idempotencyScope: 'approved_action_version';
  durable: true;
  replayed: boolean;
  workspaceExecutionEnabled: boolean;
  audienceSafety: 'allowed' | 'review_required' | 'prohibited';
  jurisdiction: string;
  estimatedProviderCost: number;
  costDecision: 'allow' | 'deny';
  recipientSource: 'workspace_contact';
  recipientVerified: true;
  suppressionChecked: true;
  email: ApprovedEmailSnapshot;
}

export interface EmailExecutionAuthority {
  authorizeAndReserve(
    request: EmailExecutionRequest,
    actor: EmailExecutionActor,
  ): Promise<AuthorizedEmailExecution>;
}

export interface EmailProviderRequest extends ApprovedEmailSnapshot {
  executionId: Id;
  correlationId: Id;
  idempotencyKey: string;
}

export interface EmailProviderResult {
  providerMessageId: string;
  acceptedAt: string;
  actualCost: number;
}

export interface EmailProvider {
  readonly identifier: string;
  sendApprovedEmail(request: EmailProviderRequest): Promise<EmailProviderResult>;
}

export interface EmailExecutionResult {
  requestId: Id;
  workspaceId: Id;
  actionId: Id;
  executionId: Id;
  status: 'gateway_disabled';
  displayStatus: 'DRY RUN — NOTHING SENT';
  providerIdentifier?: string;
  providerInvoked: false;
  emailSent: false;
  providerCost: 0;
  executionEnabled: false;
  durableIdempotency: true;
  replayed: boolean;
}