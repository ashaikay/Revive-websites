export interface MicrosoftGraphAuthConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
}

export interface MicrosoftGraphAccessToken {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
}

export class MicrosoftGraphAuthError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'MicrosoftGraphAuthError';
    this.status = status;
  }
}

function requireConfigValue(
  value: string,
  name: string,
): string {
  const normalized = value?.trim();

  if (!normalized) {
    throw new MicrosoftGraphAuthError(
      `Microsoft Graph ${name} is not configured.`,
    );
  }

  return normalized;
}

/*
 * Acquire a Microsoft Graph application access token.
 *
 * IMPORTANT:
 * - Server-side use only.
 * - Credentials must never enter browser/Vite code.
 * - This obtains authentication only; it does NOT send email.
 * - The caller should acquire/validate the token BEFORE claiming
 *   the irreversible SEND_APPROVED_EMAIL provider attempt.
 */
export async function acquireMicrosoftGraphAccessToken(
  config: MicrosoftGraphAuthConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<MicrosoftGraphAccessToken> {
  const tenantId = requireConfigValue(
    config.tenantId,
    'tenant ID',
  );

  const clientId = requireConfigValue(
    config.clientId,
    'client ID',
  );

  const clientSecret = requireConfigValue(
    config.clientSecret,
    'client secret',
  );

  const tokenUrl =
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}` +
    '/oauth2/v2.0/token';

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  let response: Response;

  try {
    response = await fetchImpl(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
  } catch {
    throw new MicrosoftGraphAuthError(
      'Microsoft Graph authentication request failed before email execution.',
    );
  }

  if (!response.ok) {
    throw new MicrosoftGraphAuthError(
      'Microsoft Graph authentication was rejected.',
      response.status,
    );
  }

  let payload: unknown;

  try {
    payload = await response.json();
  } catch {
    throw new MicrosoftGraphAuthError(
      'Microsoft Graph authentication returned an invalid response.',
      response.status,
    );
  }

  if (
    !payload ||
    typeof payload !== 'object'
  ) {
    throw new MicrosoftGraphAuthError(
      'Microsoft Graph authentication returned an invalid response.',
      response.status,
    );
  }

  const tokenPayload = payload as Record<string, unknown>;

  const accessToken =
    typeof tokenPayload.access_token === 'string'
      ? tokenPayload.access_token.trim()
      : '';

  const tokenType =
    typeof tokenPayload.token_type === 'string'
      ? tokenPayload.token_type.trim()
      : '';

  const expiresIn = Number(tokenPayload.expires_in);

  if (
    !accessToken ||
    !tokenType ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new MicrosoftGraphAuthError(
      'Microsoft Graph authentication response is incomplete.',
      response.status,
    );
  }

  return {
    accessToken,
    tokenType,
    expiresIn,
  };
}