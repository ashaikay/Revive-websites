import type { MeetingEventExecutionResult } from './meetingEventExecutionBoundary.ts';
import type { TrustedMeetingExecutionSnapshot } from './trustedMeetingExecutionReadModel.ts';
import type { ClaimedMeetingAttempt, RecordedMeetingAttempt } from './trustedMeetingProviderAttempt.ts';

/** This is the single HTTP/provider activation gate. The database and workflow
 * gates remain independent. No runtime environment variable can override it. */
export const MEETING_PROVIDER_HTTP_ENABLED = false as boolean;
export type MeetingProviderHttpResult =
  | { status: 'event_created'; executionId: string; providerOutcome: 'accepted_by_provider'; providerInvoked: true; eventCreated: true; invitationSent: false }
  | { status: 'provider_rejected'; executionId: string; providerOutcome: 'rejected_by_provider'; providerInvoked: true; eventCreated: false; invitationSent: false }
  | { status: 'outcome_unknown'; executionId: string; providerOutcome: 'provider_outcome_unknown'; providerInvoked: true; eventCreated: null; invitationSent: null };

type Dependencies = {
  executeDisabled: (input: unknown) => Promise<MeetingEventExecutionResult>;
  loadSnapshot: (executionId: string) => Promise<TrustedMeetingExecutionSnapshot>;
  createProvider: () => (attempt: ClaimedMeetingAttempt) => Promise<RecordedMeetingAttempt>;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** First authenticates and reserves via the existing server boundary. When the
 * hard gate is off, no snapshot, credential, service-role claim or Graph is read. */
export function createMeetingProviderHttpService(deps: Dependencies, enabled: boolean = MEETING_PROVIDER_HTTP_ENABLED) {
  return async (input: unknown): Promise<MeetingEventExecutionResult | MeetingProviderHttpResult> => {
    const reservation = await deps.executeDisabled(input);
    if (reservation.status !== 'provider_disabled' || reservation.executionEnabled !== false ||
      reservation.providerInvoked !== false || reservation.providerOutcome !== 'provider_not_invoked' ||
      !uuid.test(reservation.executionId) || !uuid.test(reservation.correlationId)) {
      throw new Error('Trusted meeting reservation unavailable.');
    }
    if (!enabled) return reservation;
    const request = input as { workspaceId: string; actionId: string };
    const snapshot = await deps.loadSnapshot(reservation.executionId);
    if (snapshot.executionId !== reservation.executionId ||
      snapshot.workspaceId !== request.workspaceId || snapshot.actionId !== request.actionId ||
      !/^[0-9a-f]{64}$/.test(snapshot.requestFingerprint) ||
      !Number.isSafeInteger(snapshot.bindingVersion) || snapshot.bindingVersion < 1) {
      throw new Error('Trusted meeting provider snapshot mismatch.');
    }
    const recorded = await deps.createProvider()({
      executionId: reservation.executionId,
      correlationId: reservation.correlationId,
      requestFingerprint: snapshot.requestFingerprint,
      bindingVersion: snapshot.bindingVersion,
    });
    if (recorded.executionId !== reservation.executionId ||
      recorded.status !== (recorded.outcome === 'accepted_by_provider' ? 'succeeded' : 'failed')) {
      throw new Error('Trusted meeting provider result unavailable.');
    }
    switch (recorded.outcome) {
      case 'accepted_by_provider': return { status: 'event_created', executionId: reservation.executionId,
        providerOutcome: recorded.outcome, providerInvoked: true, eventCreated: true, invitationSent: false };
      case 'rejected_by_provider': return { status: 'provider_rejected', executionId: reservation.executionId,
        providerOutcome: recorded.outcome, providerInvoked: true, eventCreated: false, invitationSent: false };
      case 'provider_outcome_unknown': return { status: 'outcome_unknown', executionId: reservation.executionId,
        providerOutcome: recorded.outcome, providerInvoked: true, eventCreated: null, invitationSent: null };
      default: throw new Error('Trusted meeting provider result unavailable.');
    }
  };
}
