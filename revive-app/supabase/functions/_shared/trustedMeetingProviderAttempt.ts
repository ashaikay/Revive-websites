/** Service-role-only provider lifecycle. No HTTP or Graph import. Never expose this
 * client to an authenticated caller, and never call claim from the disabled gateway. */
export interface MeetingProviderAttemptClient {
  rpc(name: 'claim_rev_meeting_provider_attempt', args: {
    target_execution_id: string;
    expected_request_fingerprint: string;
    expected_binding_version: number;
  }): Promise<{ data: unknown; error: unknown }>;
  rpc(name: 'record_rev_meeting_provider_result', args: {
    target_execution_id: string;
    target_provider_outcome: 'accepted_by_provider' | 'rejected_by_provider' | 'provider_outcome_unknown';
    target_provider_reference: string | null;
  }): Promise<{ data: unknown; error: unknown }>;
}
export interface ClaimedMeetingAttempt {
  executionId: string;
  correlationId: string;
  requestFingerprint: string;
  bindingVersion: number;
}
export type MeetingProviderOutcome = 'accepted_by_provider' | 'rejected_by_provider' | 'provider_outcome_unknown';
export interface RecordedMeetingAttempt {
  executionId: string;
  outcome: MeetingProviderOutcome;
  status: 'succeeded' | 'failed';
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sha256 = /^[0-9a-f]{64}$/;
function row(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Meeting attempt unavailable.');
  return data as Record<string, unknown>;
}
export function createTrustedMeetingProviderAttempt(client: MeetingProviderAttemptClient) {
  return {
    async claim(input: ClaimedMeetingAttempt): Promise<ClaimedMeetingAttempt> {
      if (!uuid.test(input.executionId) || !sha256.test(input.requestFingerprint) ||
        !Number.isSafeInteger(input.bindingVersion) || input.bindingVersion < 1) {
        throw new Error('Meeting attempt unavailable.');
      }
      const { data, error } = await client.rpc('claim_rev_meeting_provider_attempt', {
        target_execution_id: input.executionId,
        expected_request_fingerprint: input.requestFingerprint,
        expected_binding_version: input.bindingVersion,
      });
      if (error) throw new Error('Meeting attempt unavailable.');
      const claimed = row(data);
      if (claimed.id !== input.executionId || !uuid.test(String(claimed.correlation_id)) ||
        claimed.request_fingerprint !== input.requestFingerprint ||
        claimed.capability !== 'CREATE_APPROVED_MEETING_EVENT' ||
        claimed.mode !== 'live' || claimed.status !== 'in_progress' ||
        claimed.provider_outcome !== 'provider_attempt_claimed') throw new Error('Meeting attempt unavailable.');
      return { ...input, correlationId: claimed.correlation_id as string };
    },
    async record(input: { executionId: string; outcome: MeetingProviderOutcome; providerReference: string | null }): Promise<RecordedMeetingAttempt> {
      if (!uuid.test(input.executionId) ||
        !(['accepted_by_provider', 'rejected_by_provider', 'provider_outcome_unknown'] as string[]).includes(input.outcome) ||
        (input.providerReference !== null && (typeof input.providerReference !== 'string' || input.providerReference.length > 300)) ||
        (input.outcome === 'accepted_by_provider' && !input.providerReference?.trim())) {
        throw new Error('Meeting result unavailable.');
      }
      const { data, error } = await client.rpc('record_rev_meeting_provider_result', {
        target_execution_id: input.executionId,
        target_provider_outcome: input.outcome,
        target_provider_reference: input.providerReference,
      });
      if (error) throw new Error('Meeting result unavailable.');
      const recorded = row(data);
      const expectedStatus = input.outcome === 'accepted_by_provider' ? 'succeeded' : 'failed';
      if (recorded.id !== input.executionId || recorded.capability !== 'CREATE_APPROVED_MEETING_EVENT' ||
        recorded.mode !== 'live' || recorded.status !== expectedStatus ||
        recorded.provider_outcome !== input.outcome) throw new Error('Meeting result unavailable.');
      return { executionId: input.executionId, outcome: input.outcome, status: expectedStatus };
    },
  };
}
