import type { DurableMeetingEventReservation, MeetingEventExecutionRequest } from './meetingEventExecutionBoundary.ts';

/** Server-owned values only. Never construct these from the caller's payload. */
export interface ConfiguredMeetingCalendar {
  selectedCalendar: {
    workspaceId: string;
    provider: 'microsoft_graph';
    providerCalendarReference: string;
    timezone: string;
  };
  primaryMailboxUserPrincipalName: string;
}
export interface PersistedMeetingBinding {
  workspace_id: string;
  provider_key: string;
  calendar_reference: string;
  timezone: string;
  enabled: boolean;
  version: number;
}
export interface TrustedMeetingBindingDependencies {
  /** Read the configured availability calendar without fetching Graph credentials. */
  getConfiguredCalendar: (workspaceId: string) => Promise<ConfiguredMeetingCalendar>;
  /** Trusted server-only database read; binding table is not exposed to authenticated clients. */
  loadPersistedBinding: (workspaceId: string) => Promise<PersistedMeetingBinding | null>;
  /** Caller-JWT-scoped meeting reservation RPC. */
  reserveDurably: (input: MeetingEventExecutionRequest & { actorUserId: string }, expected: {
    calendarReference: string;
    timezone: string;
    bindingVersion: number;
  }) => Promise<DurableMeetingEventReservation>;
}
export class TrustedMeetingBindingMismatch extends Error {
  constructor() { super('Trusted meeting calendar binding is unavailable.'); this.name = 'TrustedMeetingBindingMismatch'; }
}
function compare(workspaceId: string, configured: ConfiguredMeetingCalendar, binding: PersistedMeetingBinding | null): PersistedMeetingBinding {
  const selected = configured.selectedCalendar;
  if (!binding || !binding.enabled || !Number.isSafeInteger(binding.version) || binding.version < 1 ||
    selected.workspaceId !== workspaceId || binding.workspace_id !== workspaceId ||
    selected.provider !== 'microsoft_graph' || binding.provider_key !== 'microsoft_graph' ||
    !selected.providerCalendarReference || !selected.timezone ||
    configured.primaryMailboxUserPrincipalName !== selected.providerCalendarReference ||
    selected.providerCalendarReference !== binding.calendar_reference ||
    selected.timezone !== binding.timezone) throw new TrustedMeetingBindingMismatch();
  return binding;
}

/** A comparison before and after the RPC detects drift while the disabled gateway
 * prevents external effects. The database still rechecks its own binding under lock.
 * The bound RPC atomically checks the expected binding under its row lock. */
export function createTrustedMeetingReservation(deps: TrustedMeetingBindingDependencies) {
  return async (input: MeetingEventExecutionRequest & { actorUserId: string }): Promise<DurableMeetingEventReservation> => {
    let configured: ConfiguredMeetingCalendar;
    let before: PersistedMeetingBinding;
    try {
      configured = await deps.getConfiguredCalendar(input.workspaceId);
      before = compare(input.workspaceId, configured, await deps.loadPersistedBinding(input.workspaceId));
    } catch { throw new TrustedMeetingBindingMismatch(); }
    const reserved = await deps.reserveDurably(input, {
      calendarReference: before.calendar_reference,
      timezone: before.timezone,
      bindingVersion: before.version,
    });
    try {
      const after = compare(input.workspaceId, configured, await deps.loadPersistedBinding(input.workspaceId));
      if (before.version !== after.version || before.calendar_reference !== after.calendar_reference ||
        before.timezone !== after.timezone) throw new TrustedMeetingBindingMismatch();
    } catch { throw new TrustedMeetingBindingMismatch(); }
    return reserved;
  };
}
