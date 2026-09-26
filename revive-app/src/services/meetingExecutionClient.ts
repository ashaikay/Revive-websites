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

export type MeetingExecutionInvoker = (
  functionName: string,
  options: { body: { requestId: string; workspaceId: string; actionId: string } },
) => Promise<{ data: unknown; error: { message?: string } | null }>;

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function requestMeetingDryRun(
  workspaceId: string,
  actionId: string,
  invoke?: MeetingExecutionInvoker,
): Promise<MeetingDryRunResult> {
  if (!workspaceId || !actionId) throw new Error('Workspace and action identifiers are required.');
  const requestId = crypto.randomUUID();
  const execute = invoke ?? (async (functionName, options) => {
    if (!supabaseClient) throw new Error('Supabase is not configured.');
    return supabaseClient.functions.invoke(functionName, options);
  });
  const { data, error } = await execute('rev-meeting-execute', {
    body: { requestId, workspaceId, actionId },
  });
  if (error) throw new Error(error.message || 'Meeting dry-run reservation failed.');
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Meeting dry-run reservation returned an invalid response.');
  }
  const value = data as Record<string, unknown>;
  if (value.status !== 'provider_disabled'
    || value.displayStatus !== 'DRY RUN — NOTHING BOOKED'
    || value.executionEnabled !== false
    || value.providerInvoked !== false
    || value.eventCreated !== false
    || value.providerOutcome !== 'provider_not_invoked'
    || typeof value.executionId !== 'string'
    || !uuid.test(value.executionId)
    || value.correlationId !== requestId
    || !uuid.test(value.correlationId)) {
    throw new Error('Meeting dry-run reservation returned an unsafe response.');
  }
  return value as unknown as MeetingDryRunResult;
}