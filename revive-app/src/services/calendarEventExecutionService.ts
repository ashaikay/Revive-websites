import {
  type AuthorizedCalendarEventExecution,
  type CalendarEventExecutionActor,
  type CalendarEventExecutionAuthority,
  type CalendarEventExecutionRequest,
  type CalendarEventExecutionResult,
  type CalendarEventProvider,
  CREATE_CALENDAR_EVENT_CAPABILITY,
} from '@/domain/calendarEventExecution';
import { CALENDAR_CAPABILITIES } from './calendarAvailabilityService';

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UTC_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function validateAuthorization(
  request: CalendarEventExecutionRequest,
  actor: CalendarEventExecutionActor,
  authorization: AuthorizedCalendarEventExecution,
): void {
  if (
    authorization.workspaceId !== request.workspaceId ||
    authorization.actionId !== request.actionId
  ) {
    throw new Error(
      'Trusted calendar authorization does not match the requested workspace and action.',
    );
  }

  if (
    authorization.actorUserId !== actor.actorUserId ||
    authorization.membershipStatus !== 'active' ||
    !['owner', 'admin'].includes(authorization.actorRole)
  ) {
    throw new Error(
      'An active owner or admin is required to authorize calendar event execution.',
    );
  }

  if (
    authorization.sourceActionType !== 'meeting_proposal' ||
    authorization.capability !== CREATE_CALENDAR_EVENT_CAPABILITY
  ) {
    throw new Error(
      'Only an approved meeting proposal may enter the calendar event gateway.',
    );
  }

  if (
    !Number.isInteger(authorization.actionVersion) ||
    authorization.actionVersion < 1 ||
    authorization.approvalActionVersion !==
      authorization.actionVersion ||
    !Number.isInteger(authorization.proposalVersion) ||
    authorization.proposalVersion < 1 ||
    authorization.approvedProposalVersion !==
      authorization.proposalVersion
  ) {
    throw new Error(
      'The approval does not bind the current action and proposal versions.',
    );
  }

  if (
    authorization.approvalDecision !== 'approved' ||
    !authorization.approvalStillValid ||
    !SHA256_PATTERN.test(
      authorization.currentActionFingerprint,
    ) ||
    authorization.currentActionFingerprint !==
      authorization.approvedActionFingerprint
  ) {
    throw new Error(
      'The approved meeting proposal is stale or has been modified.',
    );
  }

  if (
    !SHA256_PATTERN.test(authorization.requestFingerprint) ||
    authorization.requestFingerprintScope !==
      'approved_meeting_snapshot'
  ) {
    throw new Error(
      'A trusted approved-meeting request fingerprint is required.',
    );
  }

  if (
    !authorization.executionId ||
    !authorization.correlationId ||
    !authorization.approvalId ||
    !authorization.proposalId ||
    !authorization.durable ||
    !authorization.durableIdempotencyKey ||
    authorization.idempotencyScope !== 'approved_action_version'
  ) {
    throw new Error(
      'A durable approved-action-version execution reservation is required.',
    );
  }

  if (!authorization.workspaceExecutionEnabled) {
    throw new Error(
      'Workspace calendar event execution is disabled.',
    );
  }

  const snapshot = authorization.snapshot;
  const start = Date.parse(snapshot.startAt);
  const end = Date.parse(snapshot.endAt);

  if (
    !snapshot.title.trim() ||
    !EMAIL_PATTERN.test(snapshot.attendeeEmail.trim())
  ) {
    throw new Error(
      'The approved meeting snapshot requires a title and valid attendee email.',
    );
  }

  if (
    !UTC_PATTERN.test(snapshot.startAt) ||
    !UTC_PATTERN.test(snapshot.endAt) ||
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start >= end
  ) {
    throw new Error(
      'The approved meeting snapshot requires ordered UTC instants.',
    );
  }

  try {
    Intl.DateTimeFormat('en-GB', {
      timeZone: snapshot.timezone,
    });
  } catch {
    throw new Error(
      'The approved meeting snapshot requires a valid timezone.',
    );
  }
}

export class CalendarEventExecutionService {
  constructor(
    private readonly authority: CalendarEventExecutionAuthority,
    private readonly provider?: CalendarEventProvider,
  ) {}

  async requestExecution(
    request: CalendarEventExecutionRequest,
    actor: CalendarEventExecutionActor,
  ): Promise<CalendarEventExecutionResult> {
    if (
      !request.requestId ||
      !request.workspaceId ||
      !request.actionId ||
      !actor.actorUserId
    ) {
      throw new Error(
        'Calendar event execution requires request, workspace, action and actor identifiers.',
      );
    }

    const authorization =
      await this.authority.authorizeAndReserve(request, actor);

    validateAuthorization(request, actor, authorization);

    if (!CALENDAR_CAPABILITIES.CREATE_CALENDAR_EVENT) {
      return {
        requestId: request.requestId,
        workspaceId: request.workspaceId,
        actionId: request.actionId,
        executionId: authorization.executionId,
        status: 'gateway_disabled',
        displayStatus:
          'APPROVED — EVENT CREATION DISABLED',
        providerIdentifier: this.provider?.identifier,
        providerInvoked: false,
        eventCreated: false,
        invitationSent: false,
        providerCost: 0,
        executionEnabled: false,
        durableIdempotency: true,
        replayed: authorization.replayed,
      };
    }

    throw new Error(
      'Live calendar event provider invocation is not implemented in Phase 5M.',
    );
  }
}