import { describe, expect, it, vi } from 'vitest';
import {
  type AuthorizedCalendarEventExecution,
  type CalendarEventExecutionAuthority,
  type CalendarEventProvider,
  CREATE_CALENDAR_EVENT_CAPABILITY,
} from '@/domain/calendarEventExecution';
import { CALENDAR_CAPABILITIES } from '@/services/calendarAvailabilityService';
import { CalendarEventExecutionService } from '@/services/calendarEventExecutionService';

const request = {
  requestId: 'request-5m',
  workspaceId: 'workspace-1',
  actionId: 'action-1',
};

const actor = { actorUserId: 'owner-1' };
const fingerprint = 'a'.repeat(64);

function authorization(
  overrides: Partial<AuthorizedCalendarEventExecution> = {},
): AuthorizedCalendarEventExecution {
  return {
    executionId: 'execution-1',
    correlationId: 'correlation-1',
    workspaceId: request.workspaceId,
    actionId: request.actionId,
    approvalId: 'approval-1',
    proposalId: 'proposal-1',
    actorUserId: actor.actorUserId,
    actorRole: 'owner',
    membershipStatus: 'active',
    sourceActionType: 'meeting_proposal',
    capability: CREATE_CALENDAR_EVENT_CAPABILITY,
    actionVersion: 1,
    approvalActionVersion: 1,
    proposalVersion: 1,
    approvedProposalVersion: 1,
    approvalDecision: 'approved',
    approvalStillValid: true,
    currentActionFingerprint: fingerprint,
    approvedActionFingerprint: fingerprint,
    requestFingerprint: 'b'.repeat(64),
    requestFingerprintScope: 'approved_meeting_snapshot',
    durableIdempotencyKey:
      'calendar:action-1:1:approved-fingerprint',
    idempotencyScope: 'approved_action_version',
    durable: true,
    replayed: false,
    workspaceExecutionEnabled: true,
    snapshot: {
      title: 'Approved discovery call',
      attendeeEmail: 'customer@example.com',
      startAt: '2026-10-07T14:00:00.000Z',
      endAt: '2026-10-07T14:30:00.000Z',
      timezone: 'Europe/London',
      meetingMethod: 'online',
      locationDetails: '',
      notes: '',
    },
    ...overrides,
  };
}

function harness(
  overrides: Partial<AuthorizedCalendarEventExecution> = {},
) {
  const authorizeAndReserve = vi.fn(
    async () => authorization(overrides),
  );

  const createApprovedEvent = vi.fn(async () => ({
    providerEventReference: 'must-not-exist',
    actualCost: 1,
  }));

  const authority: CalendarEventExecutionAuthority = {
    authorizeAndReserve,
  };

  const provider: CalendarEventProvider = {
    identifier: 'future-provider',
    createApprovedEvent,
  };

  return {
    service: new CalendarEventExecutionService(
      authority,
      provider,
    ),
    authorizeAndReserve,
    createApprovedEvent,
  };
}

describe('Phase 5M disabled calendar event execution gateway', () => {
  it.each(['owner', 'admin'] as const)(
    'validates an eligible %s and stops before the provider',
    async (actorRole) => {
      const instance = harness({ actorRole });

      await expect(
        instance.service.requestExecution(request, actor),
      ).resolves.toEqual(
        expect.objectContaining({
          status: 'gateway_disabled',
          providerInvoked: false,
          eventCreated: false,
          invitationSent: false,
          providerCost: 0,
          executionEnabled: false,
          durableIdempotency: true,
        }),
      );

      expect(
        instance.authorizeAndReserve,
      ).toHaveBeenCalledWith(request, actor);

      expect(
        instance.createApprovedEvent,
      ).not.toHaveBeenCalled();
    },
  );

  it.each(['member', 'viewer'] as const)(
    'denies %s authority',
    async (actorRole) => {
      await expect(
        harness({ actorRole }).service.requestExecution(
          request,
          actor,
        ),
      ).rejects.toThrow(/owner or admin/);
    },
  );

  it('denies cross-tenant and mismatched-action evidence', async () => {
    await expect(
      harness({
        workspaceId: 'workspace-2',
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/workspace and action/);

    await expect(
      harness({
        actionId: 'action-2',
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/workspace and action/);
  });

  it('denies stale action or proposal versions', async () => {
    await expect(
      harness({
        approvalActionVersion: 2,
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/versions/);

    await expect(
      harness({
        approvedProposalVersion: 2,
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/versions/);
  });

  it('denies invalidated approval and altered fingerprints', async () => {
    await expect(
      harness({
        approvalStillValid: false as true,
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/stale or has been modified/);

    await expect(
      harness({
        currentActionFingerprint: 'c'.repeat(64),
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/stale or has been modified/);
  });

  it('requires a trusted fingerprint and durable reservation', async () => {
    await expect(
      harness({
        requestFingerprint: 'invalid',
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/request fingerprint/);

    await expect(
      harness({
        durable: false as true,
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/durable/);
  });

  it('validates the approved meeting snapshot', async () => {
    const base = authorization().snapshot;

    await expect(
      harness({
        snapshot: {
          ...base,
          attendeeEmail: 'invalid',
        },
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/attendee/);

    await expect(
      harness({
        snapshot: {
          ...base,
          endAt: base.startAt,
        },
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/UTC/);

    await expect(
      harness({
        snapshot: {
          ...base,
          timezone: 'Not/AZone',
        },
      }).service.requestExecution(request, actor),
    ).rejects.toThrow(/timezone/);
  });

  it('replays safely without invoking the provider', async () => {
    const instance = harness({ replayed: true });

    const result =
      await instance.service.requestExecution(request, actor);

    expect(result.replayed).toBe(true);
    expect(
      instance.createApprovedEvent,
    ).not.toHaveBeenCalled();
  });

  it('keeps event creation disabled with zero external effect', async () => {
    const instance = harness();

    const result =
      await instance.service.requestExecution(request, actor);

    expect(
      CALENDAR_CAPABILITIES.CREATE_CALENDAR_EVENT,
    ).toBe(false);

    expect(result).toEqual(
      expect.objectContaining({
        providerInvoked: false,
        eventCreated: false,
        invitationSent: false,
        providerCost: 0,
      }),
    );

    expect(
      instance.createApprovedEvent,
    ).not.toHaveBeenCalled();
  });
});