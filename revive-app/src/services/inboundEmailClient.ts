import { supabaseClient } from '@/data/supabaseClient';

export interface InboundEmailReadResult {
  status: string;
  mailboxMutation: boolean;
  messagesRead: number;
  stored: number;
  alreadyStored: number;
  matched: number;
  needsReview: number;
}

export async function requestInboundEmailRead(
  workspaceId: string,
): Promise<InboundEmailReadResult> {
  if (!supabaseClient) {
    throw new Error('Supabase is not configured.');
  }

  if (!workspaceId) {
    throw new Error('Workspace identifier is required.');
  }

  const { data, error } = await supabaseClient.functions.invoke(
    'rev-email-inbound',
    {
      body: { workspaceId },
    },
  );

  if (error) {
    throw new Error(error.message || 'Inbound email read failed.');
  }

  if (!data || typeof data !== 'object') {
    throw new Error('Inbound email read returned an invalid response.');
  }

  if ('error' in data && typeof data.error === 'string') {
    throw new Error(data.error);
  }

  return data as InboundEmailReadResult;
}
