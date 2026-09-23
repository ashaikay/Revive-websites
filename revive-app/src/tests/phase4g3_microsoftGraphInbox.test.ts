import { describe, expect, it, vi } from 'vitest';

import {
  MicrosoftGraphInboxError,
  readMicrosoftGraphInbox,
} from '../../supabase/functions/rev-email-inbound/microsoftGraphInbox';

describe('Phase 4G.3 Microsoft Graph inbox reader', () => {
  const config = {
    accessToken: 'test-access-token',
    mailboxUserId: 'support@fatherslegacy.net',
  };

  it('reads inbox messages using GET only', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          value: [
            {
              id: 'message-1',
              conversationId: 'conversation-1',
              internetMessageId: '<message-1@example.com>',
              subject: 'Re: A quick check-in',
              body: {
                content: 'Yes, I would like to know more.',
              },
              from: {
                emailAddress: {
                  address: 'Customer@Example.com',
                },
              },
              toRecipients: [
                {
                  emailAddress: {
                    address: 'support@fatherslegacy.net',
                  },
                },
              ],
              receivedDateTime: '2026-09-23T00:30:00Z',
              isRead: false,
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    const messages = await readMicrosoftGraphInbox(
      config,
      fetchImpl,
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, options] = fetchImpl.mock.calls[0];

    expect(String(url)).toContain(
      '/mailFolders/inbox/messages?',
    );

    expect(options.method).toBe('GET');

    expect(messages).toEqual([
      {
        providerMessageId: 'message-1',
        providerConversationId: 'conversation-1',
        internetMessageId: '<message-1@example.com>',
        subject: 'Re: A quick check-in',
        bodyText: 'Yes, I would like to know more.',
        senderEmail: 'customer@example.com',
        recipientEmails: ['support@fatherslegacy.net'],
        receivedAt: '2026-09-23T00:30:00Z',
        isRead: false,
      },
    ]);
  });

  it('requests plain-text message bodies', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await readMicrosoftGraphInbox(config, fetchImpl);

    const [, options] = fetchImpl.mock.calls[0];

    expect(options.headers.Prefer).toBe(
      'outlook.body-content-type="text"',
    );
  });

  it('uses a bounded inbox request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await readMicrosoftGraphInbox(config, fetchImpl);

    const [url] = fetchImpl.mock.calls[0];
    const parsed = new URL(String(url));

    expect(parsed.searchParams.get('$top')).toBe('25');
    expect(parsed.searchParams.get('$orderby')).toBe(
      'receivedDateTime desc',
    );
  });

  it('does not expose mailbox mutation methods', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: [] }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await readMicrosoftGraphInbox(config, fetchImpl);

    const [, options] = fetchImpl.mock.calls[0];

    expect(options.method).not.toBe('POST');
    expect(options.method).not.toBe('PATCH');
    expect(options.method).not.toBe('DELETE');
  });

  it('rejects missing configuration before calling Graph', async () => {
    const fetchImpl = vi.fn();

    await expect(
      readMicrosoftGraphInbox(
        {
          accessToken: '',
          mailboxUserId: 'support@fatherslegacy.net',
        },
        fetchImpl,
      ),
    ).rejects.toBeInstanceOf(MicrosoftGraphInboxError);

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('handles Graph authorization failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('', {
        status: 403,
      }),
    );

    await expect(
      readMicrosoftGraphInbox(config, fetchImpl),
    ).rejects.toMatchObject({
      name: 'MicrosoftGraphInboxError',
      status: 403,
    });
  });

  it('handles Graph rate limiting', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response('', {
        status: 429,
      }),
    );

    await expect(
      readMicrosoftGraphInbox(config, fetchImpl),
    ).rejects.toMatchObject({
      name: 'MicrosoftGraphInboxError',
      status: 429,
    });
  });

  it('ignores malformed messages rather than inventing identity data', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          value: [
            {
              id: 'valid-message',
              from: {
                emailAddress: {
                  address: 'valid@example.com',
                },
              },
              receivedDateTime: '2026-09-23T00:30:00Z',
            },
            {
              id: 'missing-sender',
              receivedDateTime: '2026-09-23T00:31:00Z',
            },
            {
              from: {
                emailAddress: {
                  address: 'missing-id@example.com',
                },
              },
              receivedDateTime: '2026-09-23T00:32:00Z',
            },
          ],
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
          },
        },
      ),
    );

    const messages = await readMicrosoftGraphInbox(
      config,
      fetchImpl,
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].providerMessageId).toBe(
      'valid-message',
    );
  });

  it('fails closed when Graph returns an invalid message-list payload', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ unexpected: true }), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    await expect(
      readMicrosoftGraphInbox(config, fetchImpl),
    ).rejects.toBeInstanceOf(MicrosoftGraphInboxError);
  });
});