import { createTrustedMeetingProviderComposition, type TrustedMeetingProviderCompositionDependencies } from './trustedMeetingProviderComposition.ts';
import { createTrustedMeetingGraphTokenSupplier } from './trustedMeetingGraphTokenSupplier.ts';

type ServerInput = Pick<TrustedMeetingProviderCompositionDependencies, 'trustedClient' | 'invokeGraph'> & {
  getEnvironment: (key: string) => string | undefined;
  tokenFetch?: typeof fetch;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const required = (value: string | undefined) => value?.trim() || '';

/** Reads existing server configuration. Microsoft secrets are accessed lazily,
 * only after the hard provider workflow gate and trusted snapshot checks. */
export function createTrustedMeetingProviderServer(input: ServerInput) {
  const workspaceId = required(input.getEnvironment('REV_CALENDAR_AVAILABILITY_WORKSPACE_ID'));
  const mailbox = required(input.getEnvironment('REV_CALENDAR_AVAILABILITY_PRIMARY_MAILBOX'));
  if (!uuid.test(workspaceId) || !mailbox || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailbox)) {
    throw new Error('Trusted meeting provider configuration unavailable.');
  }
  return createTrustedMeetingProviderComposition({
    trustedClient: input.trustedClient,
    trustedWorkspaceId: workspaceId,
    primaryMailboxUserPrincipalName: mailbox,
    getAccessToken: createTrustedMeetingGraphTokenSupplier(() => ({
      tenantId: required(input.getEnvironment('MICROSOFT_GRAPH_TENANT_ID')),
      clientId: required(input.getEnvironment('MICROSOFT_GRAPH_CLIENT_ID')),
      clientSecret: required(input.getEnvironment('MICROSOFT_GRAPH_CLIENT_SECRET')),
    }), input.tokenFetch),
    invokeGraph: input.invokeGraph,
  });
}
