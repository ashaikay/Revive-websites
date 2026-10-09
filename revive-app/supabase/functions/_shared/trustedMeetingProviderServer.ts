import { createTrustedMeetingProviderComposition, type TrustedMeetingProviderCompositionDependencies } from './trustedMeetingProviderComposition.ts';
import { createTrustedMeetingDelegatedGraphTokenSupplier } from './trustedMeetingDelegatedGraphTokenSupplier.ts';

type ServerInput = Pick<TrustedMeetingProviderCompositionDependencies, 'trustedClient' | 'invokeGraph'> & {
  liveWorkspaceId: string;
  getEnvironment: (key: string) => string | undefined;
  tokenFetch?: typeof fetch;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const required = (value: string | undefined) => value?.trim() || '';

/** Reads existing server configuration. Microsoft secrets are accessed lazily,
 * only after the hard provider workflow gate and trusted snapshot checks. */
export function createTrustedMeetingProviderServer(input: ServerInput) {
  const workspaceId = required(input.getEnvironment('REV_CALENDAR_AVAILABILITY_WORKSPACE_ID')).toLowerCase();
  if (!uuid.test(workspaceId)) {
    throw new Error('Trusted meeting provider configuration unavailable.');
  }
  return createTrustedMeetingProviderComposition({
    trustedClient: input.trustedClient,
    trustedWorkspaceId: workspaceId,
    liveWorkspaceId: input.liveWorkspaceId,
    getAccessToken: createTrustedMeetingDelegatedGraphTokenSupplier(input.trustedClient, () => ({
      clientId: required(input.getEnvironment('REV_CALENDAR_OAUTH_CLIENT_ID')),
      clientSecret: required(input.getEnvironment('REV_CALENDAR_OAUTH_CLIENT_SECRET')),
      authority: required(input.getEnvironment('REV_CALENDAR_OAUTH_AUTHORITY')),
      redirectUri: required(input.getEnvironment('REV_CALENDAR_OAUTH_REDIRECT_URI')),
    }), input.tokenFetch),
    invokeGraph: input.invokeGraph,
  });
}
