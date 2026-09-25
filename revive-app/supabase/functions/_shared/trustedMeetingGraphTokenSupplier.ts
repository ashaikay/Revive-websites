import { acquireMicrosoftGraphAccessToken, type MicrosoftGraphAuthConfig } from './microsoftGraphAuth.ts';

/** Construct on a trusted server. Configuration must never come from request JSON.
 * The supplier is called only after the disabled workflow gate and snapshot checks. */
export function createTrustedMeetingGraphTokenSupplier(
  getTrustedConfig: () => MicrosoftGraphAuthConfig,
  fetchImpl: typeof fetch = fetch,
): () => Promise<string> {
  return async () => {
    const token = await acquireMicrosoftGraphAccessToken(getTrustedConfig(), fetchImpl);
    if (typeof token.tokenType !== 'string' || token.tokenType.toLowerCase() !== 'bearer' ||
      typeof token.accessToken !== 'string' || !token.accessToken.trim() ||
      !Number.isFinite(token.expiresIn) || token.expiresIn <= 0) {
      throw new Error('Microsoft Graph credential unavailable.');
    }
    return token.accessToken;
  };
}
