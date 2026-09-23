import {
  acquireMicrosoftGraphAccessToken,
  type MicrosoftGraphAuthConfig,
  type MicrosoftGraphAccessToken,
} from '../_shared/microsoftGraphAuth.ts';
import type { TrustedCalendarAvailabilityConfig } from './calendarAvailabilityBoundary.ts';

export const CALENDAR_AVAILABILITY_ENVIRONMENT = {
  authorizedWorkspaceId: 'REV_CALENDAR_AVAILABILITY_WORKSPACE_ID',
  primaryMailbox: 'REV_CALENDAR_AVAILABILITY_PRIMARY_MAILBOX',
  timezone: 'REV_CALENDAR_AVAILABILITY_TIMEZONE',
} as const;

const DEFAULT_TIMEZONE = 'Europe/London';

export interface TrustedCalendarResolverDependencies {
  getEnvironment: (name: string) => string | undefined;
  acquireAccessToken: (config: MicrosoftGraphAuthConfig) => Promise<MicrosoftGraphAccessToken>;
}

function required(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error('Trusted calendar configuration is incomplete.');
  return normalized;
}

function validTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export function createTrustedCalendarAvailabilityResolver(
  dependencies: TrustedCalendarResolverDependencies,
) {
  return async function resolveTrustedCalendarAvailability(
    workspaceId: string,
    searchStartAt: string,
    searchEndAt: string,
  ): Promise<TrustedCalendarAvailabilityConfig> {
    const configuredWorkspaceId = required(dependencies.getEnvironment(
      CALENDAR_AVAILABILITY_ENVIRONMENT.authorizedWorkspaceId,
    ));
    if (workspaceId !== configuredWorkspaceId) {
      throw new Error('Trusted calendar binding is unavailable.');
    }

    const mailbox = required(dependencies.getEnvironment(
      CALENDAR_AVAILABILITY_ENVIRONMENT.primaryMailbox,
    ));
    const timezone = dependencies.getEnvironment(
      CALENDAR_AVAILABILITY_ENVIRONMENT.timezone,
    )?.trim() || DEFAULT_TIMEZONE;
    if (!validTimezone(timezone)) {
      throw new Error('Trusted calendar configuration is incomplete.');
    }

    const auth = await dependencies.acquireAccessToken({
      tenantId: required(dependencies.getEnvironment('MICROSOFT_GRAPH_TENANT_ID')),
      clientId: required(dependencies.getEnvironment('MICROSOFT_GRAPH_CLIENT_ID')),
      clientSecret: required(dependencies.getEnvironment('MICROSOFT_GRAPH_CLIENT_SECRET')),
    });
    if (!auth.accessToken?.trim()) {
      throw new Error('Trusted calendar authentication is unavailable.');
    }

    return {
      selectedCalendar: {
        id: 'configured-primary-calendar',
        workspaceId: configuredWorkspaceId,
        connectionId: 'configured-microsoft-graph-application',
        provider: 'microsoft_graph',
        providerCalendarReference: mailbox,
        timezone,
      },
      primaryMailboxUserPrincipalName: mailbox,
      accessToken: auth.accessToken,
      policy: {
        minimumNoticeMinutes: 0,
        beforeBufferMinutes: 0,
        afterBufferMinutes: 0,
        availabilityWindows: [{ startAt: searchStartAt, endAt: searchEndAt }],
      },
    };
  };
}

export const resolveTrustedCalendarAvailability = createTrustedCalendarAvailabilityResolver({
  getEnvironment: (name) => (globalThis as { Deno?: { env: { get: (key: string) => string | undefined } } }).Deno?.env.get(name),
  acquireAccessToken: acquireMicrosoftGraphAccessToken,
});