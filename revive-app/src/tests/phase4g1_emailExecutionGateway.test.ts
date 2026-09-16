import { describe, expect, it, vi } from 'vitest';
import {
  AuthorizedEmailExecution,
  EmailExecutionAuthority,
  EmailProvider,
  SEND_APPROVED_EMAIL_CAPABILITY,
} from '@/domain/emailExecution';
import { EmailExecutionService } from '@/services/emailExecutionService';
import { getCapability, PLATFORM_EXECUTION_ENABLED } from '@/services/executionPolicyService';

const request = { requestId: 'request-4g1', workspaceId: 'workspace-1', actionId: 'action-1' };
const actor = { actorUserId: 'user-1' };
const fingerprint = 'a'.repeat(64);

function authorization(overrides: Partial<AuthorizedEmailExecution> = {}): AuthorizedEmailExecution {
  return {
    executionId: 'execution-1', correlationId: 'correlation-1', workspaceId: request.workspaceId,
    actionId: request.actionId, approvalId: 'approval-1', actorUserId: actor.actorUserId, actorRole: 'owner',
    membershipStatus: 'active', sourceActionType: 'prepare_follow_up', capability: SEND_APPROVED_EMAIL_CAPABILITY,
    actionVersion: 3, approvalActionVersion: 3, approvalDecision: 'approved', approvalStillValid: true,
    currentActionFingerprint: fingerprint, approvedActionFingerprint: fingerprint,
    requestFingerprint: 'b'.repeat(64), requestFingerprintScope: 'approved_email_snapshot',
    durableIdempotencyKey: 'email:action-1:3:approved-fingerprint',
    idempotencyScope: 'approved_action_version', durable: true, replayed: false,
    workspaceExecutionEnabled: true, audienceSafety: 'allowed', jurisdiction: 'GB',
    estimatedProviderCost: 0, costDecision: 'allow', recipientSource: 'workspace_contact',
    recipientVerified: true, suppressionChecked: true,
    email: { recipient: 'customer@example.com', subject: 'Approved subject', body: 'Exact approved body.' },
    ...overrides,
  };
}

function harness(overrides: Partial<AuthorizedEmailExecution> = {}) {
  const authorizeAndReserve = vi.fn(async () => authorization(overrides));
  const sendApprovedEmail = vi.fn(async () => ({
    providerMessageId: 'must-not-exist', acceptedAt: new Date().toISOString(), actualCost: 1,
  }));
  const authority: EmailExecutionAuthority = { authorizeAndReserve };
  const provider: EmailProvider = { identifier: 'future-provider', sendApprovedEmail };
  return { service: new EmailExecutionService(authority, provider), authorizeAndReserve, sendApprovedEmail };
}

describe('Phase 4G.1 provider-independent email execution gateway', () => {
  it.each(['owner', 'admin'] as const)('revalidates an eligible %s and stops before the provider', async (actorRole) => {
    const instance = harness({ actorRole });
    await expect(instance.service.requestExecution(request, actor)).resolves.toEqual(expect.objectContaining({
      status: 'gateway_disabled', displayStatus: 'DRY RUN — NOTHING SENT', providerInvoked: false,
      emailSent: false, providerCost: 0, executionEnabled: false, durableIdempotency: true,
    }));
    expect(instance.authorizeAndReserve).toHaveBeenCalledWith(request, actor);
    expect(instance.sendApprovedEmail).not.toHaveBeenCalled();
  });

  it.each(['member', 'viewer'] as const)('denies %s authority', async (actorRole) => {
    await expect(harness({ actorRole }).service.requestExecution(request, actor)).rejects.toThrow(/owner or admin/);
  });

  it('denies cross-tenant authorization evidence', async () => {
    await expect(harness({ workspaceId: 'workspace-2' }).service.requestExecution(request, actor)).rejects.toThrow(/workspace and action/);
  });

  it('denies a stale approval action version', async () => {
    await expect(harness({ approvalActionVersion: 2 }).service.requestExecution(request, actor)).rejects.toThrow(/action version/);
  });

  it('denies an invalidated approval', async () => {
    await expect(harness({ approvalStillValid: false as true }).service.requestExecution(request, actor)).rejects.toThrow(/stale or has been modified/);
  });

  it('denies content modified after approval', async () => {
    await expect(harness({ currentActionFingerprint: 'c'.repeat(64) }).service.requestExecution(request, actor)).rejects.toThrow(/stale or has been modified/);
  });

  it.each(['', 'not-an-email', 'missing-domain@'] as const)('denies missing or invalid recipient %j', async (recipient) => {
    await expect(harness({ email: { ...authorization().email, recipient } }).service.requestExecution(request, actor)).rejects.toThrow(/valid approved recipient/);
  });

  it('denies missing approved subject or body', async () => {
    await expect(harness({ email: { ...authorization().email, subject: ' ' } }).service.requestExecution(request, actor)).rejects.toThrow(/subject/);
    await expect(harness({ email: { ...authorization().email, body: '' } }).service.requestExecution(request, actor)).rejects.toThrow(/body/);
  });

  it('requires trusted recipient and suppression verification', async () => {
    await expect(harness({ suppressionChecked: false as true }).service.requestExecution(request, actor)).rejects.toThrow(/unsuppressed workspace contact/);
  });

  it('requires durable approved-action-version idempotency', async () => {
    await expect(harness({ idempotencyScope: 'request' as 'approved_action_version' }).service.requestExecution(request, actor)).rejects.toThrow(/durable Phase 4C/);
  });

  it('replays a duplicate durable reservation without invoking the provider twice', async () => {
    const instance = harness({ replayed: true });
    const result = await instance.service.requestExecution(request, actor);
    expect(result.replayed).toBe(true);
    expect(instance.sendApprovedEmail).toHaveBeenCalledTimes(0);
  });

  it('keeps the capability and platform disabled with zero provider usage and cost', async () => {
    const instance = harness({ estimatedProviderCost: 2, costDecision: 'allow' });
    const result = await instance.service.requestExecution(request, actor);
    expect(getCapability(SEND_APPROVED_EMAIL_CAPABILITY).enabled).toBe(false);
    expect(PLATFORM_EXECUTION_ENABLED).toBe(false);
    expect(result).toEqual(expect.objectContaining({ providerInvoked: false, providerCost: 0, emailSent: false }));
    expect(instance.sendApprovedEmail).not.toHaveBeenCalled();
  });

  it('denies unsafe, unsupported-jurisdiction, and cost-blocked authorization', async () => {
    await expect(harness({ audienceSafety: 'prohibited' }).service.requestExecution(request, actor)).rejects.toThrow(/safety/);
    await expect(harness({ jurisdiction: 'US' }).service.requestExecution(request, actor)).rejects.toThrow(/jurisdiction/);
    await expect(harness({ costDecision: 'deny' }).service.requestExecution(request, actor)).rejects.toThrow(/Cost Governor/);
  });
});