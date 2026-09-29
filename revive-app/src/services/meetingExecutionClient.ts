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
) => Promise<{ data: unknown; error: { message?: string } | null }>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function requestMeetingExecution(
  workspaceId: string,
  actionId: string,
  executionIntent: MeetingExecutionIntent,
  invoke?: MeetingExecutionInvoker,
): Promise<MeetingExecutionResult> {
  if (!workspaceId || !actionId) throw new Error('Workspace and action identifiers are required.');
  const requestId = crypto.randomUUID();
  const execute = invoke ?? (async (functionName, options) => {
    if (!supabaseClient) throw new Error('Supabase is not configured.');
    return supabaseClient.functions.invoke(functionName, options);
  });
  const operation = executionIntent.intent === 'live' ? 'Live meeting execution' : 'Meeting dry-run reservation';
  const { data, error } = await execute('rev-meeting-execute', {
    body: { requestId, workspaceId, actionId, ...executionIntent },
  });
  if (error) throw new Error(error.message || `${operation} failed.`);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`${operation} returned an invalid response.`);
  }
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
  if (!validExecutionId || !validForIntent) {
    throw new Error('Meeting execution returned an unsafe response.');
  }
  return value as unknown as MeetingExecutionResult;
}