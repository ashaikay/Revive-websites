import {
  calculateAvailability,
  type AvailabilityPolicy,
  type BusyInterval,
  type SelectedCalendar,
} from '../../../src/services/calendarAvailabilityService.ts';
import {
  MicrosoftGraphAvailabilityError,
  readMicrosoftGraphPrimaryCalendarAvailability,
} from '../_shared/microsoftGraphAvailability.ts';
import { MicrosoftGraphAuthError } from '../_shared/microsoftGraphAuth.ts';
import { TrustedCalendarAvailabilityBindingError } from './trustedCalendarAvailabilityResolver.ts';

export const MAXIMUM_AVAILABILITY_QUERY_RANGE_MS = 7 * 24 * 60 * 60 * 1000;
export const MAXIMUM_AVAILABLE_SLOTS = 100;

export function isCalendarAvailabilityEnabled(value: string | undefined): boolean {
  return value === 'true';
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export interface TrustedCalendarAvailabilityConfig {
  selectedCalendar: SelectedCalendar & { provider: 'microsoft_graph' };
  primaryMailboxUserPrincipalName: string;
  accessToken: string;
  policy: AvailabilityPolicy;
}

export interface CalendarAvailabilityDependencies {
  getAuthenticatedUserId: (authorization: string) => Promise<string | null>;
  hasActiveWorkspaceMembership: (authorization: string, workspaceId: string, userId: string) => Promise<boolean>;
  isCalendarAvailabilityEnabled: () => boolean;
  resolveTrustedCalendarAvailability: (workspaceId: string, searchStartAt: string, searchEndAt: string, timezone: string) => Promise<TrustedCalendarAvailabilityConfig>;
  readBusyIntervals: typeof readMicrosoftGraphPrimaryCalendarAvailability;
  now: () => string;
}

type CalendarAvailabilityPayload = {
  workspaceId: string;
  searchStartAt: string;
  searchEndAt: string;
  requestedDurationMinutes: number;
  timezone: string;
};

type CalendarAvailabilityStage =
  | 'resolve_trusted_configuration'
  | 'read_busy_intervals'
  | 'calculate_availability';

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function validUtcInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parsePayload(value: unknown): CalendarAvailabilityPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  const allowedKeys = new Set(['workspaceId', 'searchStartAt', 'searchEndAt', 'requestedDurationMinutes', 'timezone']);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) return null;
  if (typeof payload.workspaceId !== 'string' || !payload.workspaceId.trim()
    || !validUtcInstant(payload.searchStartAt) || !validUtcInstant(payload.searchEndAt)
    || Date.parse(payload.searchStartAt) >= Date.parse(payload.searchEndAt)
    || Date.parse(payload.searchEndAt) - Date.parse(payload.searchStartAt) > MAXIMUM_AVAILABILITY_QUERY_RANGE_MS
    || typeof payload.requestedDurationMinutes !== 'number'
    || !Number.isInteger(payload.requestedDurationMinutes) || payload.requestedDurationMinutes <= 0
    || !validTimezone(payload.timezone)) return null;
  return {
    workspaceId: payload.workspaceId.trim(),
    searchStartAt: payload.searchStartAt,
    searchEndAt: payload.searchEndAt,
    requestedDurationMinutes: payload.requestedDurationMinutes,
    timezone: payload.timezone,
  };
}

export async function handleCalendarAvailability(
  request: Request,
  dependencies: CalendarAvailabilityDependencies,
): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });

  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Authentication required.' });

  let userId: string | null;
  try {
    userId = await dependencies.getAuthenticatedUserId(authorization);
  } catch {
    return json(401, { error: 'Authentication failed.' });
  }
  if (!userId) return json(401, { error: 'Authentication failed.' });

  const rawPayload = await request.json().catch(() => null);
  const payload = parsePayload(rawPayload);
  if (!payload) return json(400, { error: 'Invalid availability request.' });

  try {
    if (!await dependencies.hasActiveWorkspaceMembership(authorization, payload.workspaceId, userId)) {
      return json(403, { error: 'Workspace access denied.' });
    }
  } catch {
    return json(403, { error: 'Workspace access denied.' });
  }

  if (!dependencies.isCalendarAvailabilityEnabled()) {
    return json(503, { status: 'disabled', providerCalls: 0, externalEffect: 'none' });
  }

  let stage: CalendarAvailabilityStage = 'resolve_trusted_configuration';
  try {
    const trusted = await dependencies.resolveTrustedCalendarAvailability(
      payload.workspaceId,
      payload.searchStartAt,
      payload.searchEndAt,
      payload.timezone,
    );
    if (trusted.selectedCalendar.workspaceId !== payload.workspaceId
      || trusted.selectedCalendar.timezone !== payload.timezone
      || trusted.selectedCalendar.provider !== 'microsoft_graph') {
      return json(403, { error: 'Trusted calendar binding is unavailable.' });
    }
    stage = 'read_busy_intervals';
    const busyIntervals: BusyInterval[] = await dependencies.readBusyIntervals({
      accessToken: trusted.accessToken,
      workspaceId: payload.workspaceId,
      selectedCalendarId: trusted.selectedCalendar.id,
      selectedCalendar: trusted.selectedCalendar,
      mailboxUserPrincipalName: trusted.primaryMailboxUserPrincipalName,
      searchStartAt: payload.searchStartAt,
      searchEndAt: payload.searchEndAt,
      timezone: trusted.selectedCalendar.timezone,
    });
    stage = 'calculate_availability';
    const availability = calculateAvailability({
      workspaceId: payload.workspaceId,
      selectedCalendarId: trusted.selectedCalendar.id,
      selectedCalendar: trusted.selectedCalendar,
      timezone: trusted.selectedCalendar.timezone,
      requestedDurationMinutes: payload.requestedDurationMinutes,
      searchStartAt: payload.searchStartAt,
      searchEndAt: payload.searchEndAt,
      now: dependencies.now(),
      policy: trusted.policy,
      busyIntervals,
    });
    return json(200, {
      ...availability,
      slots: availability.slots.slice(0, MAXIMUM_AVAILABLE_SLOTS).map((slot) => ({
        startAt: slot.startAt,
        endAt: slot.endAt,
      })),
      timezone: trusted.selectedCalendar.timezone,
    });
  } catch (error) {
    if (error instanceof TrustedCalendarAvailabilityBindingError) {
      return json(403, { error: 'Trusted calendar binding is unavailable.' });
    }
    if (error instanceof MicrosoftGraphAuthError) {
      return json(502, { error: 'Calendar authentication is unavailable.', code: 'authentication_failed' });
    }
    if (error instanceof MicrosoftGraphAvailabilityError) {
      if (error.kind === 'rate_limited') {
        return json(429, { error: 'Calendar provider is rate limited.', code: 'provider_rate_limited' });
      }
      if (error.kind === 'read_outcome_unknown') {
        return json(503, { error: 'Calendar availability outcome is unknown.', code: 'provider_outcome_unknown' });
      }
      return json(502, { error: 'Calendar provider rejected the availability request.', code: 'provider_rejected' });
    }
    const diagnostic = {
      event: 'calendar_availability_failure',
      stage,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    };
    console.error(JSON.stringify(diagnostic));
    return json(503, {
      error: 'Calendar availability is unavailable.',
      code: 'unexpected_calendar_failure',
      stage,
    });
  }
}