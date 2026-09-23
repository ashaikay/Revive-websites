import { describe, expect, it, vi } from 'vitest';

import {
  persistInboundEmail,
  type InboundEmailPersistenceClient,
} from '../../supabase/functions/rev-email-inbound/inboundEmailPersistence';

import type { MicrosoftGraphInboxMessage } from '../../supabase/functions/rev-email-inbound/microsoftGraphInbox';

const message: MicrosoftGraphInboxMessage = {
  providerMessageId: 'graph-message-1',
  providerConversationId: 'graph-conversation-1',
  internetMessageId: '<message-1@example.com>',
  subject: 'Re: A quick check-in',
  bodyText: 'Yes, I would like to know more.',
  senderEmail: 'customer@example.com',
  recipientEmails: ['support@example.com'],
  receivedAt: '2026-09-23T00:30:00Z',
  isRead: false,
};

function createQuery(result: unknown) {
  const query: any = {
    eq: vi.fn(() => query),
    select: vi.fn(() => query),
    single: vi.fn(async () => result),
    maybeSingle: vi.fn(async () => result),
    then: (
      resolve: (value: unknown) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(resolve, reject),
  };

  return query;
}

function createClient(options?: {
  existingMessage?: unknown;
  existingThread?: unknown;
}) {
  const existingMessage =
    options?.existingMessage ?? {
      data: null,
      error: null,
    };

  const existingThread =
    options?.existingThread ?? {
      data: null,
      error: null,
    };

  const messageCheck = createQuery(existingMessage);
  const threadCheck = createQuery(existingThread);

  const threadInsert = createQuery({
    data: { id: 'thread-new' },
    error: null,
  });

  const threadUpdate = createQuery({
    data: null,
    error: null,
  });

  const messageInsert = createQuery({
    data: { id: 'message-new' },
    error: null,
  });

  let messageSelectCount = 0;

  const client: InboundEmailPersistenceClient = {
    from: vi.fn((table: string) => {
      if (table === 'rev_email_messages') {
        return {
          select: vi.fn(() => {
            messageSelectCount += 1;

            return messageSelectCount === 1
              ? messageCheck
              : messageInsert;
          }),
          insert: vi.fn(() => messageInsert),
          update: vi.fn(() => messageInsert),
        };
      }

      if (table === 'rev_email_threads') {
        return {
          select: vi.fn(() => threadCheck),
          insert: vi.fn(() => threadInsert),
          update: vi.fn(() => threadUpdate),
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    }),
  };

  return {
    client,
    messageCheck,
    threadCheck,
    threadInsert,
    threadUpdate,
    messageInsert,
  };
}

describe('Phase 4G.3 inbound email persistence', () => {
  it('stores a matched inbound message', async () => {
    const { client } = createClient();

    const result = await persistInboundEmail(client, {
      workspaceId: 'workspace-a',
      message,
      contactMatch: {
        status: 'matched',
        contactId: 'contact-1',
      },
    });

    expect(result).toEqual({
      status: 'stored',
      messageId: 'message-new',
      threadId: 'thread-new',
      processingStatus: 'matched',
    });
  });

  it('stores unmatched inbound email as needs_review', async () => {
    const { client } = createClient();

    const result = await persistInboundEmail(client, {
      workspaceId: 'workspace-a',
      message,
      contactMatch: {
        status: 'needs_review',
        reason: 'no_match',
      },
    });

    expect(result.processingStatus).toBe('needs_review');
  });

  it('stores ambiguous contact matches as needs_review', async () => {
    const { client } = createClient();

    const result = await persistInboundEmail(client, {
      workspaceId: 'workspace-a',
      message,
      contactMatch: {
        status: 'needs_review',
        reason: 'ambiguous_match',
      },
    });

    expect(result.processingStatus).toBe('needs_review');
  });

  it('returns already_stored when provider message already exists', async () => {
    const { client } = createClient({
      existingMessage: {
        data: {
          id: 'existing-message',
          thread_id: 'existing-thread',
          processing_status: 'matched',
        },
        error: null,
      },
    });

    const result = await persistInboundEmail(client, {
      workspaceId: 'workspace-a',
      message,
      contactMatch: {
        status: 'matched',
        contactId: 'contact-1',
      },
    });

    expect(result).toEqual({
      status: 'already_stored',
      messageId: 'existing-message',
      threadId: 'existing-thread',
      processingStatus: 'matched',
    });
  });

  it('reuses an existing provider conversation thread', async () => {
    const { client, threadUpdate } = createClient({
      existingThread: {
        data: {
          id: 'existing-thread',
        },
        error: null,
      },
    });

    const result = await persistInboundEmail(client, {
      workspaceId: 'workspace-a',
      message,
      contactMatch: {
        status: 'matched',
        contactId: 'contact-1',
      },
    });

    expect(result.threadId).toBe('existing-thread');
    expect(threadUpdate.eq).toHaveBeenCalledWith(
      'workspace_id',
      'workspace-a',
    );
  });

  it('fails closed when workspace ID is empty', async () => {
    const { client } = createClient();

    await expect(
      persistInboundEmail(client, {
        workspaceId: '',
        message,
        contactMatch: {
          status: 'matched',
          contactId: 'contact-1',
        },
      }),
    ).rejects.toThrow('Workspace ID is required.');
  });

  it('fails closed when provider message ID is empty', async () => {
    const { client } = createClient();

    await expect(
      persistInboundEmail(client, {
        workspaceId: 'workspace-a',
        message: {
          ...message,
          providerMessageId: '',
        },
        contactMatch: {
          status: 'matched',
          contactId: 'contact-1',
        },
      }),
    ).rejects.toThrow('Provider message ID is required.');
  });

  it('fails when the idempotency check fails', async () => {
    const { client } = createClient({
      existingMessage: {
        data: null,
        error: {
          message: 'database unavailable',
        },
      },
    });

    await expect(
      persistInboundEmail(client, {
        workspaceId: 'workspace-a',
        message,
        contactMatch: {
          status: 'matched',
          contactId: 'contact-1',
        },
      }),
    ).rejects.toThrow(
      'Failed to check inbound message idempotency',
    );
  });
});