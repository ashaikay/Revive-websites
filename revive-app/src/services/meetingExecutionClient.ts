import { supabaseClient } from '@/data/supabaseClient';

export interface MeetingDryRunResult {
  status: 'provider_disabled';
  displayStatus: 'DRY RUN — NOTHING BOOKED';
  executionEnabled: false;
  providerInvoked: false;
  eventCreated: false;
  executionId: string;
  correlationId: string;
  providerOutcome: 'provider_not_invoked';
}

export type MeetingProviderResult =
  | { status: 'event_created'; executionId: string; providerOutcome: 'accepted_by_provider'; providerInvoked: true; eventCreated: true; invitationSent: null }
  | { status: 'provider_rejected'; executionId: string; providerOutcome: 'rejected_by_provider'; providerInvoked: true; eventCreated: false; invitationSent: false }
  | { status: 'outcome_unknown'; executionId: string; providerOutcome: 'provider_outcome_unknown'; providerInvoked: true; eventCreated: null; invitationSent: null };

export type MeetingExecutionResult = MeetingDryRunResult | MeetingProviderResult;
export type MeetingExecutionIntent =
  | { intent: 'dry_run' }
  | { intent: 'live'; confirmLiveBooking: true };

export type MeetingExecutionInvoker = (
  functionName: string,
  options: { body: { requestId: string; workspaceId: string; actionId: string } & MeetingExecutionIntent },
) => Promise<{ data: unknown; error: { message?: string; context?: unknown } | null }>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MeetingExecutionFailureKind =
  | 'client_unavailable'
  | 'server_refusal'
  | 'transport_failure'
  | 'malformed_success'
  | 'server_outcome_unknown';

export class MeetingExecutionClientError extends Error {
  constructor(
    readonly kind: MeetingExecutionFailureKind,
    readonly status?: number,
  ) {
    super('Meeting execution could not be confirmed.');
    this.name = 'MeetingExecutionClientError';
  }
}

function statusOf(value: unknown): number | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const candidate = value as { status?: unknown; context?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  if (candidate.context && typeof candidate.context === 'object'
    && typeof (candidate.context as { status?: unknown }).status === 'number') {
    return (candidate.context as { status: number }).status;
  }
  return undefined;
}

async function responseBody(value: unknown): Promise<unknown> {
  if (typeof Response !== 'undefined' && value instanceof Response) {
    try {
      return await value.clone().json();
    } catch {
      return null;
    }
  }
  return null;
}

function parseResult(
  data: unknown,
  requestId: string,
  executionIntent: MeetingExecutionIntent,
): MeetingExecutionResult | undefined {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const value = data as Record<string, unknown>;
  const validExecutionId = typeof value.executionId === 'string' && uuid.test(value.executionId);
  const validDisabled = value.status === 'provider_disabled'
    && value.displayStatus === 'DRY RUN — NOTHING BOOKED'
    && value.executionEnabled === false && value.providerInvoked === false
    && value.eventCreated === false && value.providerOutcome === 'provider_not_invoked'
    && value.correlationId === requestId && uuid.test(String(value.correlationId));
  const validCreated = value.status === 'event_created'
    && value.providerOutcome === 'accepted_by_provider' && value.providerInvoked === true
    && value.eventCreated === true && value.invitationSent === null;
  const validRejected = value.status === 'provider_rejected'
    && value.providerOutcome === 'rejected_by_provider' && value.providerInvoked === true
    && value.eventCreated === false && value.invitationSent === false;
  const validUnknown = value.status === 'outcome_unknown'
    && value.providerOutcome === 'provider_outcome_unknown' && value.providerInvoked === true
    && value.eventCreated === null && value.invitationSent === null;
  const validForIntent = executionIntent.intent === 'dry_run'
    ? validDisabled
    : validDisabled || validCreated || validRejected || validUnknown;
  if (!validExecutionId || !validForIntent) return undefined;
  return value as unknown as MeetingExecutionResult;
}

export function meetingExecutionFailureMessage(
  error: unknown,
  executionIntent: MeetingExecutionIntent,
): string {
  const live = executionIntent.intent === 'live';
  if (error instanceof MeetingExecutionClientError && error.kind === 'client_unavailable') {
    return 'Booking actions are unavailable in this workspace. No request was sent. Contact an administrator.';
  }
  if (!(error instanceof MeetingExecutionClientError)) {
    return live
      ? 'REV could not confirm the booking result. Check the selected Outlook calendar and contact an administrator to reconcile it. Do not retry this attempt.'
      : 'REV could not confirm the booking check. Refresh the proposal status before taking another action.';
  }
  if (error.kind === 'server_refusal') {
    if (error.status === 401) return 'Please sign in again, then refresh this proposal before continuing. No booking request was accepted.';
    return 'The booking request was refused before execution. Refresh this proposal before continuing. No event was created.';
  }
  if (!live) {
    return 'REV could not confirm the booking check. Refresh the proposal status before taking another action.';
  }
  if (error.kind === 'transport_failure') {
    return 'REV lost contact before confirming the booking result. The event may have been created. Check the selected Outlook calendar and contact an administrator to reconcile it. Do not retry this attempt.';
  }
  if (error.kind === 'malformed_success') {
    return 'REV received an unclear response to the booking request. The event may have been created. Check the selected Outlook calendar and contact an administrator to reconcile it. Do not retry this attempt.';
  }
  if (error.kind === 'server_outcome_unknown') {
    return 'The server could not confirm the booking result. The event may have been created. Check the selected Outlook calendar and contact an administrator to reconcile it. Do not retry this attempt.';
  }
  return 'REV could not confirm the booking result. Check the selected Outlook calendar and contact an administrator to reconcile it. Do not retry this attempt.';
}

export async function requestMeetingExecution(
  workspaceId: string,
  actionId: string,
  executionIntent: MeetingExecutionIntent,
  invoke?: MeetingExecutionInvoker,
): Promise<MeetingExecutionResult> {
  if (!workspaceId || !actionId) throw new MeetingExecutionClientError('server_refusal', 400);
  const requestId = crypto.randomUUID();
  const execute = invoke ?? (async (functionName, options) => {
    if (!supabaseClient) throw new MeetingExecutionClientError('client_unavailable');
    return supabaseClient.functions.invoke(functionName, options);
  });
  let response: { data: unknown; error: { message?: string; context?: unknown } | null };
  try {
    response = await execute('rev-meeting-execute', {
      body: { requestId, workspaceId, actionId, ...executionIntent },
    });
  } catch (error) {
    if (error instanceof MeetingExecutionClientError) throw error;
    const status = statusOf(error);
    throw new MeetingExecutionClientError(
      status === undefined ? 'transport_failure' : 'server_outcome_unknown',
      status,
    );
  }
  const { data, error } = response;
  if (error) {
    const status = statusOf(error);
    const errorBody = await responseBody(error.context);
    if (status === 409 && executionIntent.intent === 'live') {
      const rejected = parseResult(errorBody ?? data, requestId, executionIntent);
      if (rejected?.status === 'provider_rejected') return rejected;
    }
    if (status === 400 || status === 401 || status === 405 || status === 413 || status === 415) {
      throw new MeetingExecutionClientError('server_refusal', status);
    }
    throw new MeetingExecutionClientError(
      status === undefined ? 'transport_failure' : 'server_outcome_unknown',
      status,
    );
  }
  const result = parseResult(data, requestId, executionIntent);
  if (!result) throw new MeetingExecutionClientError('malformed_success');
  return result;
}