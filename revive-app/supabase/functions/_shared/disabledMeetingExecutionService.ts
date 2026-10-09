import { requestMeetingEventExecution, type ActiveOperator, type MeetingEventExecutionResult } from './meetingEventExecutionBoundary.ts';
import { createMeetingReservationAuthority, type AuthenticatedMeetingReservationClient } from './meetingReservationAuthority.ts';

/** Server-only composition. The caller supplies exactly request, workspace and action IDs.
 * Implementations must derive identity from the verified session and use a caller-JWT RPC client.
 * No provider SDK, credentials or HTTP entrypoint is constructed by this module. */
export interface DisabledMeetingExecutionServiceDependencies {
  authenticate: () => Promise<string | null>;
  getActiveOperator: (workspaceId: string, userId: string) => Promise<ActiveOperator | null>;
  getCallerScopedReservationClient: () => Promise<AuthenticatedMeetingReservationClient>;
}

export function createDisabledMeetingExecutionService(deps: DisabledMeetingExecutionServiceDependencies) {
  return async (input: unknown): Promise<MeetingEventExecutionResult> => {
    return requestMeetingEventExecution(input, {
      authenticate: deps.authenticate,
      getActiveOperator: deps.getActiveOperator,
      reserveDurably: async request => {
        const client = await deps.getCallerScopedReservationClient();
        return createMeetingReservationAuthority(client)(request);
      },
      invokeGraph: async () => { throw new Error('Meeting event provider execution is disabled.'); },
    });
  };
}
