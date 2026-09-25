import type { DurableMeetingEventReservation, MeetingEventExecutionRequest } from './meetingEventExecutionBoundary.ts';

/** Only a server-created, caller-JWT-scoped client is suitable here. */
export interface AuthenticatedMeetingReservationClient {
  rpc(name: 'reserve_rev_meeting_event_execution', args: {
    target_request_id: string;
    target_workspace_id: string;
    target_action_id: string;
  }): Promise<{ data: unknown; error: unknown }>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function createMeetingReservationAuthority(client: AuthenticatedMeetingReservationClient) {
  return async (input: MeetingEventExecutionRequest & { actorUserId: string }): Promise<DurableMeetingEventReservation> => {
    // The actor identity is derived afresh by auth.uid() inside the RPC. Never send actorUserId.
    const { data, error } = await client.rpc('reserve_rev_meeting_event_execution', {
      target_request_id: input.requestId,
      target_workspace_id: input.workspaceId,
      target_action_id: input.actionId,
    });
    if (error || !data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Meeting reservation unavailable.');
    const row = data as Record<string, unknown>;
    if (row.workspace_id !== input.workspaceId || row.action_id !== input.actionId
      || row.capability !== 'CREATE_APPROVED_MEETING_EVENT' || row.status !== 'prepared'
      || row.mode !== 'dry_run' || row.provider_outcome !== 'provider_not_invoked'
      || typeof row.id !== 'string' || !uuid.test(row.id)
      || typeof row.correlation_id !== 'string' || !uuid.test(row.correlation_id)) {
      throw new Error('Meeting reservation unavailable.');
    }
    return { executionId: row.id, correlationId: row.correlation_id, providerOutcome: 'provider_not_invoked' };
  };
}
