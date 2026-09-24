import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_CAPABILITIES } from '@/services/calendarAvailabilityService';
import {
  handleCalendarAvailability,
  isCalendarAvailabilityEnabled,
  MAXIMUM_AVAILABLE_SLOTS,
  type CalendarAvailabilityDependencies,
} from '../../supabase/functions/rev-calendar-availability/calendarAvailabilityBoundary';
import { MicrosoftGraphAvailabilityError } from '../../supabase/functions/_shared/microsoftGraphAvailability';
import { createTrustedCalendarAvailabilityResolver } from '../../supabase/functions/rev-calendar-availability/trustedCalendarAvailabilityResolver';

const workspaceId = 'fatherlegacy-workspace';
const mailbox = 'support@fatherslegacy.net';
const token = 'access-token-that-must-not-leak';
const payload = {
  workspaceId,
  searchStartAt: '2026-09-24T09:00:00.000Z',
  searchEndAt: '2026-09-24T12:00:00.000Z',
  requestedDurationMinutes: 30,
  timezone: 'Europe/London',
};

function post(body: unknown): Request {
  return new Request('https://example.test/functions/v1/rev-calendar-availability', {
    method: 'POST', headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

function trustedConfig(overrides: Partial<CalendarAvailabilityDependencies> = {}): CalendarAvailabilityDependencies {
  return {
    isCalendarAvailabilityEnabled: () => true,
    getAuthenticatedUserId: vi.fn().mockResolvedValue('user-1'),
    hasActiveWorkspaceMembership: vi.fn().mockResolvedValue(true),
    resolveTrustedCalendarAvailability: vi.fn().mockResolvedValue({
      selectedCalendar: {
        id: 'configured-primary-calendar', workspaceId, connectionId: 'connection-1', provider: 'microsoft_graph',
        providerCalendarReference: mailbox, timezone: 'Europe/London',
      },
      primaryMailboxUserPrincipalName: mailbox,
      accessToken: token,
      policy: { minimumNoticeMinutes: 0, beforeBufferMinutes: 0, afterBufferMinutes: 0, availabilityWindows: [{ startAt: payload.searchStartAt, endAt: payload.searchEndAt }] },
    }),
    readBusyIntervals: vi.fn().mockResolvedValue([]),
    now: () => '2026-09-24T08:00:00.000Z',
    ...overrides,
  };
}

describe('Phase 5F controlled FatherLegacy availability activation', () => {
  it.each([undefined, '', 'false', 'TRUE', 'True', '1', ' true', 'true ', 'enabled', 'yes'])('treats %j as disabled', (value) => {
    expect(isCalendarAvailabilityEnabled(value)).toBe(false);
  });

  it('enables only the exact lowercase server value while event creation stays disabled', () => {
    expect(isCalendarAvailabilityEnabled('true')).toBe(true);
    expect(CALENDAR_CAPABILITIES.CREATE_CALENDAR_EVENT).toBe(false);
  });

  it('keeps disabled requests before resolver, token, and provider access', async () => {
    const deps = trustedConfig({ isCalendarAvailabilityEnabled: () => false });
    const response = await handleCalendarAvailability(post(payload), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'disabled', providerCalls: 0, externalEffect: 'none' });
    expect(deps.resolveTrustedCalendarAvailability).not.toHaveBeenCalled();
    expect(deps.readBusyIntervals).not.toHaveBeenCalled();
  });

  it('fails closed on wrong workspace or timezone before token and provider access', async () => {
    const acquireAccessToken = vi.fn();
    const resolveTrustedCalendarAvailability = createTrustedCalendarAvailabilityResolver({
      getEnvironment: (name) => ({
        REV_CALENDAR_AVAILABILITY_WORKSPACE_ID: workspaceId,
        REV_CALENDAR_AVAILABILITY_PRIMARY_MAILBOX: mailbox,
        REV_CALENDAR_AVAILABILITY_TIMEZONE: 'Europe/London',
        REV_CALENDAR_AVAILABILITY_WORKING_DAYS: '1,2,3,4,5',
        REV_CALENDAR_AVAILABILITY_BUSINESS_START_LOCAL: '09:00',
        REV_CALENDAR_AVAILABILITY_BUSINESS_END_LOCAL: '17:00',
        MICROSOFT_GRAPH_TENANT_ID: 'tenant', MICROSOFT_GRAPH_CLIENT_ID: 'client', MICROSOFT_GRAPH_CLIENT_SECRET: 'secret',
      })[name],
      acquireAccessToken,
    });
    const deps = trustedConfig({ resolveTrustedCalendarAvailability });
    expect((await handleCalendarAvailability(post({ ...payload, workspaceId: 'other-workspace' }), deps)).status).toBe(403);
    expect(acquireAccessToken).not.toHaveBeenCalled();
    expect(deps.readBusyIntervals).not.toHaveBeenCalled();
    expect((await handleCalendarAvailability(post({ ...payload, timezone: 'America/New_York' }), deps)).status).toBe(403);
    expect(acquireAccessToken).not.toHaveBeenCalled();
    expect(deps.readBusyIntervals).not.toHaveBeenCalled();
  });

  it('rejects browser provider identity overrides and sends exactly one trusted mailbox to the adapter', async () => {
    const deps = trustedConfig();
    expect((await handleCalendarAvailability(post({ ...payload, mailbox: 'other@example.com' }), deps)).status).toBe(400);
    expect((await handleCalendarAvailability(post({ ...payload, calendarId: 'other-calendar' }), deps)).status).toBe(400);
    expect((await handleCalendarAvailability(post({ ...payload, provider: 'google_calendar' }), deps)).status).toBe(400);
    await handleCalendarAvailability(post(payload), deps);
    expect(deps.readBusyIntervals).toHaveBeenCalledWith(expect.objectContaining({
      mailboxUserPrincipalName: mailbox,
      selectedCalendar: expect.objectContaining({ providerCalendarReference: mailbox }),
    }));
    expect((deps.readBusyIntervals as ReturnType<typeof vi.fn>).mock.calls[0][0].mailboxUserPrincipalName).toBe(mailbox);
  });

  it('returns slots only and preserves query and output caps', async () => {
    const deps = trustedConfig();
    const tooLong = await handleCalendarAvailability(post({ ...payload, searchEndAt: '2026-10-02T09:00:00.000Z' }), deps);
    expect(tooLong.status).toBe(400);
    expect(deps.readBusyIntervals).not.toHaveBeenCalled();
    const response = await handleCalendarAvailability(post({
      ...payload, searchStartAt: '2026-09-24T00:00:00.000Z', searchEndAt: '2026-09-25T00:00:00.000Z', requestedDurationMinutes: 1,
    }), deps);
    const body = await response.json();
    expect(body.slots).toHaveLength(MAXIMUM_AVAILABLE_SLOTS);
    expect(JSON.stringify(body)).not.toMatch(/subject|location|attendees|body|raw/i);
  });

  it('returns categorized safe provider failures without confidential values or mutation capabilities', async () => {
    const source = [
      '../../supabase/functions/rev-calendar-availability/calendarAvailabilityBoundary.ts',
      '../../supabase/functions/rev-calendar-availability/index.ts',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
    const deps = trustedConfig({ readBusyIntervals: vi.fn().mockRejectedValue(new MicrosoftGraphAvailabilityError('rate_limited', `${token} ${mailbox} raw stack`, 429)) });
    const response = await handleCalendarAvailability(post(payload), deps);
    const body = await response.text();
    expect(response.status).toBe(429);
    expect(JSON.parse(body)).toEqual({ error: 'Calendar provider is rate limited.', code: 'provider_rate_limited' });
    expect(body).not.toMatch(new RegExp(`${token}|${mailbox}|raw|stack`));
    expect(source).not.toMatch(/Calendars\.ReadWrite|\/events|createEvent|updateEvent|deleteEvent|send|accept|decline|\.patch\(|\.delete\(/i);
  });
});