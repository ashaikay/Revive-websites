import { requestMeetingEventExecution, type ActiveOperator, type MeetingEventExecutionResult } from './meetingEventExecutionBoundary.ts';
import { createTrustedMeetingReservation, type ConfiguredMeetingCalendar, type PersistedMeetingBinding } from './trustedMeetingBindingGuard.ts';
import { createAtomicMeetingReservationAuthority, type BoundMeetingReservationClient } from './atomicMeetingReservationAuthority.ts';

/** Server-only composition. The caller supplies exactly request, workspace and action IDs.
 * Implementations must derive identity from the verified session and use a caller-JWT RPC client.
 * No provider SDK, credentials or HTTP entrypoint is constructed by this module. */
export interface DisabledMeetingExecutionServiceDependencies {
  authenticate: () => Promise<string | null>;
  getActiveOperator: (workspaceId: string, userId: string) => Promise<ActiveOperator | null>;
  getConfiguredCalendar: (workspaceId: string) => Promise<ConfiguredMeetingCalendar>;
  loadPersistedBinding: (workspaceId: string) => Promise<PersistedMeetingBinding | null>;
  getCallerScopedReservationClient: () => Promise<BoundMeetingReservationClient>;
}

export function createDisabledMeetingExecutionService(deps: DisabledMeetingExecutionServiceDependencies) {
  return async (input: unknown): Promise<MeetingEventExecutionResult> => {
    return requestMeetingEventExecution(input, {
      authenticate: deps.authenticate,
      getActiveOperator: deps.getActiveOperator,
      reserveDurably: createTrustedMeetingReservation({
        getConfiguredCalendar: deps.getConfiguredCalendar,
        loadPersistedBinding: deps.loadPersistedBinding,
        reserveDurably: async (request, expected) => {
          const client = await deps.getCallerScopedReservationClient();
          return createAtomicMeetingReservationAuthority(client)(request, expected);
        },
      }),
      invokeGraph: async () => { throw new Error('Meeting event provider execution is disabled.'); },
    });
  };
}
