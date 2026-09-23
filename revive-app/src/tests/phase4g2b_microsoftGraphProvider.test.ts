import { describe, expect, it, vi } from 'vitest';
import { sendMicrosoftGraphEmail } from '../../supabase/functions/rev-email-execute/microsoftGraphProvider';

const email = {
  recipient: 'customer@example.com',
  subject: 'Approved subject',
  body: 'Exact approved body.',
};

const config = {
  accessToken: 'test-token',
  senderUserId: 'sender@example.com',
};

describe('Phase 4G.2B Microsoft Graph provider adapter', () => {
  it('treats Graph HTTP 202 as accepted by provider, not delivered', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 202 }));

    const result = await sendMicrosoftGraphEmail(email, config, fetchMock);

    expect(result.outcome).toBe('accepted_by_provider');
    expect(result.actualCost).toBe(0);
    expect(result).not.toHaveProperty('providerMessageId');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])(
    'rejects Graph authentication/authorization HTTP %s',
    async (status) => {
      const fetchMock = vi.fn(
        async () => new Response(null, { status }),
      );

      await expect(
        sendMicrosoftGraphEmail(email, config, fetchMock),
      ).rejects.toThrow(
        /authentication or Mail\.Send authorization failed/,
      );
    },
  );

  it('rejects Graph rate limiting', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 429 }),
    );

    await expect(
      sendMicrosoftGraphEmail(email, config, fetchMock),
    ).rejects.toThrow(/rate limit/);
  });

  it('rejects unexpected provider responses', async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 500 }),
    );

    await expect(
      sendMicrosoftGraphEmail(email, config, fetchMock),
    ).rejects.toThrow(/HTTP 500/);
  });

  it('does not call Graph when required server-side configuration is missing', async () => {
    const fetchMock = vi.fn();

    await expect(
      sendMicrosoftGraphEmail(
        email,
        { ...config, accessToken: '' },
        fetchMock,
      ),
    ).rejects.toThrow(/access token/);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies a network or lost-response failure as provider outcome unknown', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('network failure');
    });

    await expect(
      sendMicrosoftGraphEmail(
        email,
        config,
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toMatchObject({
      name: 'MicrosoftGraphOutcomeUnknownError',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});