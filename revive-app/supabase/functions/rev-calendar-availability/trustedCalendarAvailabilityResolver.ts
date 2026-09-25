import {
  acquireMicrosoftGraphAccessToken,
  type MicrosoftGraphAuthConfig,
  type MicrosoftGraphAccessToken,
} from '../_shared/microsoftGraphAuth.ts';
import type { TrustedCalendarAvailabilityConfig } from './calendarAvailabilityBoundary.ts';
import { buildBusinessHoursAvailabilityWindows } from './businessHoursPolicy.ts';

export const CALENDAR_AVAILABILITY_ENVIRONMENT = {
  authorizedWorkspaceId: 'REV_CALENDAR_AVAILABILITY_WORKSPACE_ID',
  primaryMailbox: 'REV_CALENDAR_AVAILABILITY_PRIMARY_MAILBOX',
  timezone: 'REV_CALENDAR_AVAILABILITY_TIMEZONE',
  workingDays: 'REV_CALENDAR_AVAILABILITY_WORKING_DAYS',
  businessStartLocal: 'REV_CALENDAR_AVAILABILITY_BUSINESS_START_LOCAL',
  businessEndLocal: 'REV_CALENDAR_AVAILABILITY_BUSINESS_END_LOCAL',
} as const;

const DEFAULT_TIMEZONE = 'Europe/London';

export class TrustedCalendarAvailabilityBindingError extends Error {
  constructor() {
    super('Trusted calendar binding is unavailable.');
    this.name = 'TrustedCalendarAvailabilityBindingError';
  }
}

export interface TrustedCalendarResolverDependencies {
  getEnvironment: (name: string) => string | undefined;
  acquireAccessToken: (config: MicrosoftGraphAuthConfig) => Promise<MicrosoftGraphAccessToken>;
}

export interface TrustedCalendarAvailabilityConfiguration {
  selectedCalendar: TrustedCalendarAvailabilityConfig['selectedCalendar'];
  primaryMailboxUserPrincipalName: string;
  policy: TrustedCalendarAvailabilityConfig['policy'];
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

export function createTrustedCalendarAvailabilityConfigurationResolver(
  getEnvironment: TrustedCalendarResolverDependencies['getEnvironment'],
) {
  return function resolveTrustedCalendarAvailabilityConfiguration(
    workspaceId: string,
    searchStartAt: string,
    searchEndAt: string,
    requestedTimezone: string,
  ): TrustedCalendarAvailabilityConfiguration {
    const configuredWorkspaceId = required(getEnvironment(
      CALENDAR_AVAILABILITY_ENVIRONMENT.authorizedWorkspaceId,
    ));
    if (workspaceId !== configuredWorkspaceId) {
      throw new TrustedCalendarAvailabilityBindingError();
    }

    const mailbox = required(getEnvironment(
      CALENDAR_AVAILABILITY_ENVIRONMENT.primaryMailbox,
    ));
    const timezone = getEnvironment(
      CALENDAR_AVAILABILITY_ENVIRONMENT.timezone,
    )?.trim() || DEFAULT_TIMEZONE;
    if (!validTimezone(timezone)) {
      throw new Error('Trusted calendar configuration is incomplete.');
    }
    if (requestedTimezone !== timezone) {
      throw new TrustedCalendarAvailabilityBindingError();
    }

    const availabilityWindows = buildBusinessHoursAvailabilityWindows({
      workingDays: getEnvironment(CALENDAR_AVAILABILITY_ENVIRONMENT.workingDays),
      businessStartLocal: getEnvironment(CALENDAR_AVAILABILITY_ENVIRONMENT.businessStartLocal),
      businessEndLocal: getEnvironment(CALENDAR_AVAILABILITY_ENVIRONMENT.businessEndLocal),
      timezone,
    }, searchStartAt, searchEndAt);

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
      policy: {
        minimumNoticeMinutes: 0,
        beforeBufferMinutes: 0,
        afterBufferMinutes: 0,
        availabilityWindows,
      },
    };
  };
}

export function createTrustedCalendarAvailabilityResolver(
  dependencies: TrustedCalendarResolverDependencies,
) {
  const resolveConfiguration = createTrustedCalendarAvailabilityConfigurationResolver(dependencies.getEnvironment);
  return async function resolveTrustedCalendarAvailability(
    workspaceId: string,
    searchStartAt: string,
    searchEndAt: string,
    requestedTimezone: string,
  ): Promise<TrustedCalendarAvailabilityConfig> {
    const configuration = resolveConfiguration(workspaceId, searchStartAt, searchEndAt, requestedTimezone);

    const auth = await dependencies.acquireAccessToken({
      tenantId: required(dependencies.getEnvironment('MICROSOFT_GRAPH_TENANT_ID')),
      clientId: required(dependencies.getEnvironment('MICROSOFT_GRAPH_CLIENT_ID')),
      clientSecret: required(dependencies.getEnvironment('MICROSOFT_GRAPH_CLIENT_SECRET')),
    });
    if (!auth.accessToken?.trim()) {
      throw new Error('Trusted calendar authentication is unavailable.');
    }

    return {
      ...configuration,
      accessToken: auth.accessToken,
    };
  };
}

export const resolveTrustedCalendarAvailability = createTrustedCalendarAvailabilityResolver({
  getEnvironment: (name) => (globalThis as { Deno?: { env: { get: (key: string) => string | undefined } } }).Deno?.env.get(name),
  acquireAccessToken: acquireMicrosoftGraphAccessToken,
});

export const resolveTrustedCalendarAvailabilityConfiguration = createTrustedCalendarAvailabilityConfigurationResolver(
  (name) => (globalThis as { Deno?: { env: { get: (key: string) => string | undefined } } }).Deno?.env.get(name),
);