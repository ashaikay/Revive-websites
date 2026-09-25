/** Phase 5O: server-only orchestration contract. No HTTP entrypoint or provider wiring. */
export const MEETING_EVENT_EXECUTION_ENABLED = false as boolean;

export type MeetingEventExecutionRequest = Readonly<{
  requestId: string;
  workspaceId: string;
  actionId: string;
}>;
export type ActiveOperator = Readonly<{ userId: string; role: 'owner' | 'admin' }>;
export type DurableMeetingEventReservation = Readonly<{
  executionId: string;
  correlationId: string;
  providerOutcome: 'provider_not_invoked';
}>;
export type MeetingEventExecutionResult = Readonly<{
  status: 'provider_disabled';
  displayStatus: 'DRY RUN — NOTHING BOOKED';
  executionEnabled: false;
  providerInvoked: false;
  eventCreated: false;
  executionId: string;
  correlationId: string;
  providerOutcome: 'provider_not_invoked';
}>;

export interface MeetingEventExecutionDependencies {
  /** Derived from a verified server session, never from request fields. */
  authenticate: () => Promise<string | null>;
  /** Must read current membership in the target workspace; no cached role. */
  getActiveOperator: (workspaceId: string, userId: string) => Promise<ActiveOperator | null>;
  /** Trusted authority revalidates approved action/version, exact snapshot, policy,
   * binding, safety and semantic idempotency atomically before reserving. */
  reserveDurably: (input: MeetingEventExecutionRequest & { actorUserId: string }) => Promise<DurableMeetingEventReservation>;
  /** Future server-only provider seam; must never run while gateway is disabled. */
  invokeGraph: (reservation: DurableMeetingEventReservation) => Promise<unknown>;
}

export class MeetingEventExecutionDenied extends Error {
  constructor() { super('Meeting execution is unavailable or unauthorized.'); this.name = 'MeetingEventExecutionDenied'; }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseRequest(input: unknown): MeetingEventExecutionRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new MeetingEventExecutionDenied();
  const value = input as Record<string, unknown>;
  if (Object.keys(value).length !== 3 || !['requestId', 'workspaceId', 'actionId'].every(key => Object.hasOwn(value, key) && typeof value[key] === 'string' && uuid.test(value[key] as string))) {
    throw new MeetingEventExecutionDenied();
  }
  return { requestId: value.requestId as string, workspaceId: value.workspaceId as string, actionId: value.actionId as string };
}

export async function requestMeetingEventExecution(input: unknown, deps: MeetingEventExecutionDependencies): Promise<MeetingEventExecutionResult> {
  const request = parseRequest(input);
  const userId = await deps.authenticate().catch(() => null);
  if (!userId) throw new MeetingEventExecutionDenied();
  const operator = await deps.getActiveOperator(request.workspaceId, userId).catch(() => null);
  if (!operator || operator.userId !== userId || !['owner', 'admin'].includes(operator.role)) throw new MeetingEventExecutionDenied();

  // The authority owns all durable state checks and must reject stale or conflicting retries.
  // A reservation is permitted while disabled; provider credentials and Graph are not touched.
  const reserved = await deps.reserveDurably({ ...request, actorUserId: userId });
  if (!reserved || !uuid.test(reserved.executionId) || !uuid.test(reserved.correlationId) || reserved.providerOutcome !== 'provider_not_invoked') {
    throw new MeetingEventExecutionDenied();
  }
  if (!MEETING_EVENT_EXECUTION_ENABLED) {
    return { status: 'provider_disabled', displayStatus: 'DRY RUN — NOTHING BOOKED', executionEnabled: false,
      providerInvoked: false, eventCreated: false, executionId: reserved.executionId,
      correlationId: reserved.correlationId, providerOutcome: reserved.providerOutcome };
  }
  // Deliberately no enabled path in Phase 5O. Enabling requires a separate reviewed implementation.
  throw new MeetingEventExecutionDenied();
}
