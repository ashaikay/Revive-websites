import type { ClaimedMeetingAttempt, MeetingProviderOutcome, RecordedMeetingAttempt } from './trustedMeetingProviderAttempt.ts';
import type { MicrosoftGraphCalendarEventRequest, MicrosoftGraphCalendarEventResult } from './microsoftGraphCalendarEvent.ts';

/** Phase 5Y remains unwired. No HTTP entrypoint imports this workflow. */
export const MEETING_GRAPH_WORKFLOW_ENABLED = false as boolean;
export interface MeetingProviderWorkflowDependencies {
  loadGraphRequest: () => Promise<MicrosoftGraphCalendarEventRequest>;
  claim: (attempt: ClaimedMeetingAttempt) => Promise<ClaimedMeetingAttempt>;
  invokeGraph: (request: MicrosoftGraphCalendarEventRequest) => Promise<MicrosoftGraphCalendarEventResult>;
  record: (input: { executionId: string; outcome: MeetingProviderOutcome; providerReference: string | null }) => Promise<RecordedMeetingAttempt>;
}
export class MeetingProviderResultUnavailable extends Error {
  constructor() { super('Meeting provider result could not be recorded; do not retry the provider call.'); this.name = 'MeetingProviderResultUnavailable'; }
}
/** Only a definite Graph rejection is recorded as rejected. Any other error,
 * including timeout after possible acceptance, is unknown and prohibits retry. */
export function classifyMeetingGraphError(error: unknown): Exclude<MeetingProviderOutcome, 'accepted_by_provider'> {
  if (error && typeof error === 'object' &&
    (error as { name?: unknown }).name === 'MicrosoftGraphCalendarEventError' &&
    (error as { kind?: unknown }).kind === 'provider_rejected') return 'rejected_by_provider';
  return 'provider_outcome_unknown';
}
/** Trusted backend operation, deliberately separate from the disabled HTTP service.
 * The hard default gate and the database gate must both be reviewed before wiring.
 * Tests may inject enabled=true with fake Graph and fake durable RPCs only. */
export function createMeetingProviderWorkflow(
  deps: MeetingProviderWorkflowDependencies,
  enabled: boolean = MEETING_GRAPH_WORKFLOW_ENABLED,
) {
  return async (attempt: ClaimedMeetingAttempt): Promise<RecordedMeetingAttempt> => {
    if (!enabled) throw new Error('Meeting Graph workflow is disabled.');
    // Resolve trusted provider material only after the hard gate and before the claim.
    const graphRequest = await deps.loadGraphRequest();
    // Durable claim happens before the sole provider call. A retry must fail claim.
    const claimed = await deps.claim(attempt);
    let outcome: MeetingProviderOutcome;
    let providerReference: string | null = null;
    try {
      const result = await deps.invokeGraph(graphRequest);
      if (result.provider !== 'microsoft_graph' || result.outcome !== 'created' ||
        typeof result.providerEventReference !== 'string' || !result.providerEventReference.trim() ||
        result.providerEventReference.length > 300) {
        outcome = 'provider_outcome_unknown';
      } else {
        outcome = 'accepted_by_provider';
        providerReference = result.providerEventReference;
      }
    } catch (error) {
      outcome = classifyMeetingGraphError(error);
    }
    try {
      const recorded = await deps.record({ executionId: claimed.executionId, outcome, providerReference });
      if (recorded.executionId !== claimed.executionId || recorded.outcome !== outcome ||
        recorded.status !== (outcome === 'accepted_by_provider' ? 'succeeded' : 'failed')) {
        throw new Error('Invalid durable provider result.');
      }
      return recorded;
    } catch { throw new MeetingProviderResultUnavailable(); }
  };
}
