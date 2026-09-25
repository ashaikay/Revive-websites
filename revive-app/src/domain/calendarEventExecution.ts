import type { Id, MemberRole } from './models.ts';

export const CREATE_CALENDAR_EVENT_CAPABILITY =
  'CREATE_CALENDAR_EVENT' as const;

export interface CalendarEventExecutionRequest {
  requestId: Id;
  workspaceId: Id;
  actionId: Id;
}

export interface CalendarEventExecutionActor {
  actorUserId: Id;
}

export interface ApprovedCalendarEventSnapshot {
  title: string;
  attendeeEmail: string;
  startAt: string;
  endAt: string;
  timezone: string;
  meetingMethod: 'online' | 'phone' | 'in_person';
  locationDetails: string;
  notes: string;
}

export interface AuthorizedCalendarEventExecution {
  executionId: Id;
  correlationId: Id;
  workspaceId: Id;
  actionId: Id;
  approvalId: Id;
  proposalId: Id;
  actorUserId: Id;
  actorRole: MemberRole;
  membershipStatus: 'active';
  sourceActionType: 'meeting_proposal';
  capability: typeof CREATE_CALENDAR_EVENT_CAPABILITY;
  actionVersion: number;
  approvalActionVersion: number;
  proposalVersion: number;
  approvedProposalVersion: number;
  approvalDecision: 'approved';
  approvalStillValid: true;
  currentActionFingerprint: string;
  approvedActionFingerprint: string;
  requestFingerprint: string;
  requestFingerprintScope: 'approved_meeting_snapshot';
  durableIdempotencyKey: string;
  idempotencyScope: 'approved_action_version';
  durable: true;
  replayed: boolean;
  workspaceExecutionEnabled: boolean;
  snapshot: ApprovedCalendarEventSnapshot;
}

export interface CalendarEventExecutionAuthority {
  authorizeAndReserve(
    request: CalendarEventExecutionRequest,
    actor: CalendarEventExecutionActor,
  ): Promise<AuthorizedCalendarEventExecution>;
}

export interface CalendarEventProvider {
  readonly identifier: string;

  createApprovedEvent(input: {
    executionId: Id;
    correlationId: Id;
    idempotencyKey: string;
    snapshot: ApprovedCalendarEventSnapshot;
  }): Promise<{
    providerEventReference: string;
    actualCost: number;
  }>;
}

export interface CalendarEventExecutionResult {
  requestId: Id;
  workspaceId: Id;
  actionId: Id;
  executionId: Id;
  status: 'gateway_disabled';
  displayStatus: 'APPROVED — EVENT CREATION DISABLED';
  providerIdentifier?: string;
  providerInvoked: false;
  eventCreated: false;
  invitationSent: false;
  providerCost: 0;
  executionEnabled: false;
  durableIdempotency: true;
  replayed: boolean;
}