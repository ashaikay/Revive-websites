import type { MicrosoftGraphInboxMessage } from './microsoftGraphInbox.ts';
import type { InboundContactMatch } from './inboundContactMatcher.ts';
import type { InboundEmailClassificationResult } from './inboundEmailClassifier.ts';

export interface InboundEmailPersistenceClient {
  from(table: string): {
    select(columns: string): any;
    insert(values: Record<string, unknown>): any;
    update(values: Record<string, unknown>): any;
  };
}

export interface PersistInboundEmailInput {
  workspaceId: string;
  message: MicrosoftGraphInboxMessage;
  contactMatch: InboundContactMatch;
  classification: InboundEmailClassificationResult;
}

export interface PersistInboundEmailResult {
  status: 'stored' | 'already_stored';
  messageId: string;
  threadId: string;
  processingStatus: 'matched' | 'needs_review';
}

function requireValue(value: string, name: string): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new Error(`${name} is required.`);
  }

  return normalized;
}

async function findExistingMessage(
  client: InboundEmailPersistenceClient,
  workspaceId: string,
  providerMessageId: string,
) {
  const { data, error } = await client
    .from('rev_email_messages')
    .select('id, thread_id, processing_status')
    .eq('workspace_id', workspaceId)
    .eq('provider_key', 'microsoft_graph')
    .eq('provider_message_id', providerMessageId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to check inbound message idempotency: ${error.message}`,
    );
  }

  return data;
}

async function findExistingThread(
  client: InboundEmailPersistenceClient,
  workspaceId: string,
  providerConversationId: string | null,
) {
  if (!providerConversationId) {
    return null;
  }

  const { data, error } = await client
    .from('rev_email_threads')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('provider_key', 'microsoft_graph')
    .eq('provider_conversation_id', providerConversationId)
    .maybeSingle();

  if (error) {
    throw new Error(
      `Failed to find inbound email thread: ${error.message}`,
    );
  }

  return data;
}

async function createThread(
  client: InboundEmailPersistenceClient,
  input: PersistInboundEmailInput,
): Promise<string> {
  const contactId =
    input.contactMatch.status === 'matched'
      ? input.contactMatch.contactId
      : null;

  const { data, error } = await client
    .from('rev_email_threads')
    .insert({
      workspace_id: input.workspaceId,
      contact_id: contactId,
      opportunity_id: null,
      provider_key: 'microsoft_graph',
      provider_conversation_id:
        input.message.providerConversationId,
      subject: input.message.subject,
      last_message_at: input.message.receivedAt,
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(
      `Failed to create inbound email thread: ${
        error?.message ?? 'missing thread ID'
      }`,
    );
  }

  return data.id;
}

async function updateThread(
  client: InboundEmailPersistenceClient,
  threadId: string,
  input: PersistInboundEmailInput,
): Promise<void> {
  const values: Record<string, unknown> = {
    last_message_at: input.message.receivedAt,
    updated_at: new Date().toISOString(),
  };

  if (input.contactMatch.status === 'matched') {
    values.contact_id = input.contactMatch.contactId;
  }

  const { error } = await client
    .from('rev_email_threads')
    .update(values)
    .eq('workspace_id', input.workspaceId)
    .eq('id', threadId);

  if (error) {
    throw new Error(
      `Failed to update inbound email thread: ${error.message}`,
    );
  }
}

export async function persistInboundEmail(
  client: InboundEmailPersistenceClient,
  input: PersistInboundEmailInput,
): Promise<PersistInboundEmailResult> {
  const workspaceId = requireValue(
    input.workspaceId,
    'Workspace ID',
  );

  const providerMessageId = requireValue(
    input.message.providerMessageId,
    'Provider message ID',
  );

  const existingMessage = await findExistingMessage(
    client,
    workspaceId,
    providerMessageId,
  );

  if (existingMessage) {
    return {
      status: 'already_stored',
      messageId: existingMessage.id,
      threadId: existingMessage.thread_id,
      processingStatus:
        existingMessage.processing_status === 'matched'
          ? 'matched'
          : 'needs_review',
    };
  }

  const existingThread = await findExistingThread(
    client,
    workspaceId,
    input.message.providerConversationId,
  );

  let threadId: string;

  if (existingThread?.id) {
    threadId = existingThread.id;

    await updateThread(
      client,
      threadId,
      {
        ...input,
        workspaceId,
      },
    );
  } else {
    threadId = await createThread(client, {
      ...input,
      workspaceId,
    });
  }

  const contactId =
    input.contactMatch.status === 'matched'
      ? input.contactMatch.contactId
      : null;

  const processingStatus =
    input.contactMatch.status === 'matched'
      ? 'matched'
      : 'needs_review';

  const { data, error } = await client
    .from('rev_email_messages')
    .insert({
      workspace_id: workspaceId,
      thread_id: threadId,
      contact_id: contactId,
      opportunity_id: null,
      execution_id: null,
      provider_key: 'microsoft_graph',
      provider_message_id: providerMessageId,
      direction: 'inbound',
      sender_email: input.message.senderEmail,
      recipient_emails: input.message.recipientEmails,
      subject: input.message.subject,
      body_text: input.message.bodyText,
      received_at: input.message.receivedAt,
      sent_at: null,
      processing_status: processingStatus,
      classification: input.classification.classification,
      classification_confidence: input.classification.confidence,
      classification_reason: input.classification.reason,
      classified_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (error || !data?.id) {
    throw new Error(
      `Failed to store inbound email message: ${
        error?.message ?? 'missing message ID'
      }`,
    );
  }

  return {
    status: 'stored',
    messageId: data.id,
    threadId,
    processingStatus,
  };
}
