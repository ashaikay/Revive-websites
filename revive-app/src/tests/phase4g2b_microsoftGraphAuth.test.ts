import { describe, expect, it, vi } from 'vitest';

import {
  acquireMicrosoftGraphAccessToken,
  MicrosoftGraphAuthError,
} from '../../supabase/functions/_shared/microsoftGraphAuth';

const validConfig = {
  tenantId: 'test-tenant',
  clientId: 'test-client',
  clientSecret: 'test-secret',
};

function mockResponse(
  status: number,
  payload: unknown,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: vi.fn().mockResolvedValue(payload),
  } as unknown as Response;
}

describe('Phase 4G.2B Microsoft Graph authentication', () => {
  it('acquires an application access token using client credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        access_token: 'mock-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    );

    const result = await acquireMicrosoftGraphAccessToken(
      validConfig,
      fetchMock as unknown as typeof fetch,
    );

    expect(result).toEqual({
      accessToken: 'mock-access-token',
      tokenType: 'Bearer',
      expiresIn: 3600,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0];

    expect(url).toBe(
      'https://login.microsoftonline.com/test-tenant/oauth2/v2.0/token',
    );

    expect(options.method).toBe('POST');

    expect(options.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
    });

    const requestBody = options.body as URLSearchParams;

    expect(requestBody.get('client_id')).toBe('test-client');
    expect(requestBody.get('client_secret')).toBe('test-secret');

    expect(requestBody.get('scope')).toBe(
      'https://graph.microsoft.com/.default',
    );

    expect(requestBody.get('grant_type')).toBe(
      'client_credentials',
    );
  });

  it('rejects missing tenant ID before any network request', async () => {
    const fetchMock = vi.fn();

    await expect(
      acquireMicrosoftGraphAccessToken(
        {
          ...validConfig,
          tenantId: '',
        },
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(MicrosoftGraphAuthError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing client ID before any network request', async () => {
    const fetchMock = vi.fn();

    await expect(
      acquireMicrosoftGraphAccessToken(
        {
          ...validConfig,
          clientId: '',
        },
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(MicrosoftGraphAuthError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects missing client secret before any network request', async () => {
    const fetchMock = vi.fn();

    await expect(
      acquireMicrosoftGraphAccessToken(
        {
          ...validConfig,
          clientSecret: '',
        },
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(MicrosoftGraphAuthError);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('classifies Microsoft authentication rejection safely', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(401, {
        error: 'invalid_client',
      }),
    );

    try {
      await acquireMicrosoftGraphAccessToken(
        validConfig,
        fetchMock as unknown as typeof fetch,
      );

      throw new Error('Expected authentication to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(MicrosoftGraphAuthError);
      expect((error as MicrosoftGraphAuthError).status).toBe(401);
    }
  });

  it('classifies token endpoint network failure before email execution', async () => {
    const fetchMock = vi.fn().mockRejectedValue(
      new Error('network unavailable'),
    );

    await expect(
      acquireMicrosoftGraphAccessToken(
        validConfig,
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      'Microsoft Graph authentication request failed before email execution.',
    );
  });

  it('rejects an incomplete token response', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(200, {
        token_type: 'Bearer',
        expires_in: 3600,
      }),
    );

    await expect(
      acquireMicrosoftGraphAccessToken(
        validConfig,
        fetchMock as unknown as typeof fetch,
      ),
    ).rejects.toThrow(
      'Microsoft Graph authentication response is incomplete.',
    );
  });
});
