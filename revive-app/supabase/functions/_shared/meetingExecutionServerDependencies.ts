import { createDisabledMeetingExecutionService } from './disabledMeetingExecutionService.ts';
import type { BoundMeetingReservationClient } from './atomicMeetingReservationAuthority.ts';

/** Construct these clients on the server: callerClient carries the verified user's JWT;
 * trustedClient is server-only and is never returned to the caller. */
export interface MeetingServerClient {
  auth: { getUser: () => Promise<{ data: { user: { id: string } | null }; error: unknown }> };
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        eq: (column: string, value: string) => {
          maybeSingle: () => Promise<{ data: unknown; error: unknown }>
        }
      }
    }
  };
}
export interface MeetingServerDependencies {
  callerClient: MeetingServerClient & BoundMeetingReservationClient;
  trustedClient: Pick<MeetingServerClient, 'from'>;
  getEnvironment: (key: string) => string | undefined;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const required = (value: string | undefined) => value?.trim() || '';

/** Server-only dependency adapter for the disabled service; no Graph credential reads. */
export function createMeetingExecutionServerBoundary(deps: MeetingServerDependencies) {
  return (input: unknown) => {
    let verifiedUserId: string | null = null;
    const service = createDisabledMeetingExecutionService({
    authenticate: async () => {
      const result = await deps.callerClient.auth.getUser();
      verifiedUserId = !result.error && result.data?.user?.id && uuid.test(result.data.user.id) ? result.data.user.id : null;
      return verifiedUserId;
    },
    getActiveOperator: async (workspaceId, userId) => {
      if (!verifiedUserId || verifiedUserId !== userId) return null;
      const result = await deps.callerClient.from('workspace_members').select('user_id,role,status')
        .eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
      const row = result.data as Record<string, unknown> | null;
      return !result.error && row?.user_id === userId && row.status === 'active' &&
        (row.role === 'owner' || row.role === 'admin') ? { userId, role: row.role } : null;
    },
    getConfiguredCalendar: async workspaceId => {
      const configuredWorkspace = required(deps.getEnvironment('REV_CALENDAR_AVAILABILITY_WORKSPACE_ID'));
      const mailbox = required(deps.getEnvironment('REV_CALENDAR_AVAILABILITY_PRIMARY_MAILBOX'));
      const timezone = required(deps.getEnvironment('REV_CALENDAR_AVAILABILITY_TIMEZONE')) || 'Europe/London';
      if (!configuredWorkspace || workspaceId !== configuredWorkspace || !mailbox) throw new Error('Calendar unavailable.');
      try { Intl.DateTimeFormat('en-GB', { timeZone: timezone }); } catch { throw new Error('Calendar unavailable.'); }
      return { selectedCalendar: { workspaceId: configuredWorkspace, provider: 'microsoft_graph' as const,
        providerCalendarReference: mailbox, timezone }, primaryMailboxUserPrincipalName: mailbox };
    },
    loadPersistedBinding: async workspaceId => {
      const result = await deps.trustedClient.from('rev_meeting_calendar_bindings')
        .select('workspace_id,provider_key,calendar_reference,timezone,enabled,version')
        .eq('workspace_id', workspaceId).eq('provider_key', 'microsoft_graph').maybeSingle();
      if (result.error) throw new Error('Calendar binding unavailable.');
      return result.data as Awaited<ReturnType<Parameters<typeof createDisabledMeetingExecutionService>[0]['loadPersistedBinding']>>;
    },
    getCallerScopedReservationClient: async () => deps.callerClient,
  });
    return service(input);
  };
}
