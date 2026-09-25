import type { ApprovedCalendarEventSnapshot } from '../../../src/domain/calendarEventExecution.ts';
import type { MicrosoftGraphCalendarEventRequest } from './microsoftGraphCalendarEvent.ts';
import type { TrustedMeetingExecutionSnapshot } from './trustedMeetingExecutionReadModel.ts';

const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const utc = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const fail = () => { throw new Error('Trusted meeting Graph request unavailable.'); };

/** Maps only the database-approved proposal. Caller payload cannot set event material.
 * The token must be acquired on the trusted server after the disabled gateway check. */
export function buildTrustedMeetingGraphRequest(
  durable: TrustedMeetingExecutionSnapshot,
  trusted: { workspaceId: string; primaryMailboxUserPrincipalName: string; accessToken: string },
): MicrosoftGraphCalendarEventRequest {
  const proposal = durable.proposal;
  if (durable.workspaceId !== trusted.workspaceId ||
    durable.calendarReference !== trusted.primaryMailboxUserPrincipalName ||
    !trusted.accessToken?.trim() ||
    typeof proposal.title !== 'string' || !proposal.title.trim() || proposal.title.length > 120 ||
    typeof proposal.attendeeEmail !== 'string' || !email.test(proposal.attendeeEmail.trim()) ||
    typeof proposal.startAt !== 'string' || !utc.test(proposal.startAt) ||
    typeof proposal.endAt !== 'string' || !utc.test(proposal.endAt) ||
    !Number.isFinite(Date.parse(proposal.startAt)) || !Number.isFinite(Date.parse(proposal.endAt)) ||
    Date.parse(proposal.startAt) <= Date.now() || Date.parse(proposal.endAt) <= Date.parse(proposal.startAt) ||
    proposal.timezone !== durable.timezone ||
    !['online', 'phone', 'in_person'].includes(String(proposal.meetingMethod)) ||
    typeof proposal.locationDetails !== 'string' || proposal.locationDetails.length > 240 ||
    typeof proposal.notes !== 'string' || proposal.notes.length > 1000 ||
    !/^[0-9a-f]{64}$/.test(durable.requestFingerprint) ||
    !durable.semanticIdempotencyKey.startsWith(`create-approved-meeting-event:${durable.actionId}:v`)) fail();
  const snapshot: ApprovedCalendarEventSnapshot = {
    title: proposal.title as string,
    attendeeEmail: proposal.attendeeEmail as string,
    startAt: proposal.startAt as string,
    endAt: proposal.endAt as string,
    timezone: proposal.timezone as string,
    meetingMethod: proposal.meetingMethod as ApprovedCalendarEventSnapshot['meetingMethod'],
    locationDetails: proposal.locationDetails as string,
    notes: proposal.notes as string,
  };
  return {
    accessToken: trusted.accessToken,
    workspaceId: durable.workspaceId,
    trustedWorkspaceId: trusted.workspaceId,
    mailboxUserPrincipalName: durable.calendarReference,
    trustedMailboxUserPrincipalName: trusted.primaryMailboxUserPrincipalName,
    idempotencyKey: durable.requestFingerprint,
    snapshot,
  };
}
