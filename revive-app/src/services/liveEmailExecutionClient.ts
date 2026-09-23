import { supabaseClient } from '@/data/supabaseClient';

export interface LiveEmailExecutionResult {
  status: string;
  displayStatus?: string;
  executionEnabled: boolean;
  providerInvoked: boolean | 'unknown';
  emailSent?: boolean | 'unknown';
  acceptedByProvider?: boolean;
  deliveryConfirmed?: boolean;
  automaticRetryAllowed?: boolean;
  executionId?: string;
  correlationId?: string;
  workspaceId?: string;
  actionId?: string;
  actionVersion?: number;
  providerOutcome?: string;
  durableReservation?: boolean;
  suppressionChecked?: boolean;
}

export async function requestLiveEmailExecution(
  workspaceId: string,
  actionId: string,
): Promise<LiveEmailExecutionResult> {
  if (!supabaseClient) {
    throw new Error('Supabase is not configured.');
  }

  if (!workspaceId || !actionId) {
    throw new Error('Workspace and action identifiers are required.');
  }

  const { data, error } = await supabaseClient.functions.invoke(
    'rev-email-execute',
    {
      body: {
        workspaceId,
        actionId,
      },
    },
  );

  if (error) {
    throw new Error(error.message || 'Trusted email execution request failed.');
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Trusted email execution returned an invalid response.');
  }

  if ('error' in data && typeof data.error === 'string') {
    throw new Error(data.error);
  }

  return data as LiveEmailExecutionResult;
}
