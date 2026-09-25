import type { DurableMeetingEventReservation, MeetingEventExecutionRequest } from './meetingEventExecutionBoundary.ts';

/** Server-created client carrying the caller's verified JWT, never a service-role RPC client. */
export interface BoundMeetingReservationClient {
  rpc(name: 'reserve_rev_meeting_event_execution_bound', args: {
    target_request_id: string;
    target_workspace_id: string;
    target_action_id: string;
    expected_calendar_reference: string;
    expected_timezone: string;
    expected_binding_version: number;
  }): Promise<{ data: unknown; error: unknown }>;
}
export interface ExpectedMeetingBinding {
  calendarReference: string;
  timezone: string;
  bindingVersion: number;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createAtomicMeetingReservationAuthority(client: BoundMeetingReservationClient) {
  return async (input: MeetingEventExecutionRequest & { actorUserId: string }, expected: ExpectedMeetingBinding): Promise<DurableMeetingEventReservation> => {
    if (!expected.calendarReference || !expected.timezone || !Number.isSafeInteger(expected.bindingVersion) || expected.bindingVersion < 1) {
      throw new Error('Trusted meeting binding unavailable.');
    }
    // Only the server-owned guard supplies expected values. The database checks them
    // while holding the binding lock and independently revalidates approval/policy.
    const { data, error } = await client.rpc('reserve_rev_meeting_event_execution_bound', {
      target_request_id: input.requestId,
      target_workspace_id: input.workspaceId,
      target_action_id: input.actionId,
      expected_calendar_reference: expected.calendarReference,
      expected_timezone: expected.timezone,
      expected_binding_version: expected.bindingVersion,
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Meeting reservation unavailable.');
    const row = data as Record<string, unknown>;
    if (row.workspace_id !== input.workspaceId || row.action_id !== input.actionId ||
      row.capability !== 'CREATE_APPROVED_MEETING_EVENT' || row.status !== 'prepared' ||
      row.mode !== 'dry_run' || row.provider_outcome !== 'provider_not_invoked' ||
      typeof row.id !== 'string' || !uuid.test(row.id) ||
      typeof row.correlation_id !== 'string' || !uuid.test(row.correlation_id)) {
      throw new Error('Meeting reservation unavailable.');
    }
    return { executionId: row.id, correlationId: row.correlation_id, providerOutcome: 'provider_not_invoked' };
  };
}
