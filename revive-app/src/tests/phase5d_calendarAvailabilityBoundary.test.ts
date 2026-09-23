import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_CAPABILITIES } from '@/services/calendarAvailabilityService';
import {
  CALENDAR_AVAILABILITY_ENABLED,
  handleCalendarAvailability,
  type CalendarAvailabilityDependencies,
} from '../../supabase/functions/rev-calendar-availability/calendarAvailabilityBoundary';

const mailboxSecret = 'calendar-pilot@internal.example';
const token = 'calendar-access-token';
const validPayload = {
  workspaceId: 'workspace-1',
  searchStartAt: '2026-09-24T09:00:00.000Z',
  searchEndAt: '2026-09-24T12:00:00.000Z',
  requestedDurationMinutes: 30,
  timezone: 'Europe/London',
};

function dependencies(): CalendarAvailabilityDependencies {
  return {
    getAuthenticatedUserId: vi.fn().mockResolvedValue('user-1'),
    hasActiveWorkspaceMembership: vi.fn().mockResolvedValue(true),
    resolveTrustedCalendarAvailability: vi.fn().mockResolvedValue({
      selectedCalendar: {
        id: 'calendar-1', workspaceId: 'workspace-1', connectionId: 'connection-1', provider: 'microsoft_graph',
        providerCalendarReference: mailboxSecret, timezone: 'Europe/London',
      },
      primaryMailboxUserPrincipalName: mailboxSecret,
      accessToken: token,
      policy: { minimumNoticeMinutes: 0, beforeBufferMinutes: 0, afterBufferMinutes: 0, availabilityWindows: [] },
    }),
    readBusyIntervals: vi.fn(),
    now: () => '2026-09-24T08:00:00.000Z',
  };
}

function post(body: unknown, authorization = 'Bearer user-token'): Request {
  return new Request('https://example.test/functions/v1/rev-calendar-availability', {
    method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
}

describe('Phase 5D controlled calendar availability boundary', () => {
  it('returns a truthful disabled response before resolver or Graph access', async () => {
    const deps = dependencies();
    const response = await handleCalendarAvailability(post(validPayload), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'disabled', providerCalls: 0, externalEffect: 'none' });
    expect(deps.resolveTrustedCalendarAvailability).not.toHaveBeenCalled();
    expect(deps.readBusyIntervals).not.toHaveBeenCalled();
  });

  it('allows OPTIONS and rejects unsupported methods without provider access', async () => {
    const deps = dependencies();
    expect((await handleCalendarAvailability(new Request('https://example.test', { method: 'OPTIONS' }), deps)).status).toBe(204);
    expect((await handleCalendarAvailability(new Request('https://example.test', { method: 'GET' }), deps)).status).toBe(405);
    expect(deps.readBusyIntervals).not.toHaveBeenCalled();
  });

  it('fails closed for missing or invalid authentication and inactive membership', async () => {
    const deps = dependencies();
    expect((await handleCalendarAvailability(post(validPayload, ''), deps)).status).toBe(401);
    (deps.getAuthenticatedUserId as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    expect((await handleCalendarAvailability(post(validPayload), deps)).status).toBe(401);
    (deps.hasActiveWorkspaceMembership as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    expect((await handleCalendarAvailability(post(validPayload), deps)).status).toBe(403);
    expect(deps.readBusyIntervals).not.toHaveBeenCalled();
  });

  it('rejects client mailbox or calendar selection and invalid timezone/date ranges before provider access', async () => {
    const deps = dependencies();
    const alternateMailbox = await handleCalendarAvailability(post({ ...validPayload, mailboxUserPrincipalName: 'other@example.com' }), deps);
    const alternateCalendar = await handleCalendarAvailability(post({ ...validPayload, selectedCalendarId: 'other-calendar' }), deps);
    const invalidTimezone = await handleCalendarAvailability(post({ ...validPayload, timezone: 'not/a-timezone' }), deps);
    const invertedRange = await handleCalendarAvailability(post({ ...validPayload, searchStartAt: validPayload.searchEndAt }), deps);
    expect([alternateMailbox.status, alternateCalendar.status, invalidTimezone.status, invertedRange.status]).toEqual([400, 400, 400, 400]);
    expect(deps.hasActiveWorkspaceMembership).not.toHaveBeenCalled();
    expect(deps.resolveTrustedCalendarAvailability).not.toHaveBeenCalled();
    expect(deps.readBusyIntervals).not.toHaveBeenCalled();
  });

  it('keeps provider errors and confidential values out of safe responses', async () => {
    const deps = dependencies();
    (deps.hasActiveWorkspaceMembership as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(`${token} ${mailboxSecret} provider body stack`));
    const response = await handleCalendarAvailability(post(validPayload), deps);
    const body = await response.text();
    expect(response.status).toBe(403);
    expect(body).not.toContain(token);
    expect(body).not.toContain(mailboxSecret);
    expect(body).not.toContain('stack');
  });

  it('has only disabled availability and event-creation capabilities with no mutation endpoint', () => {
    const source = readFileSync(new URL('../../supabase/functions/rev-calendar-availability/calendarAvailabilityBoundary.ts', import.meta.url), 'utf8');
    expect(CALENDAR_AVAILABILITY_ENABLED).toBe(false);
    expect(CALENDAR_CAPABILITIES.READ_CALENDAR_AVAILABILITY).toBe(false);
    expect(CALENDAR_CAPABILITIES.CREATE_CALENDAR_EVENT).toBe(false);
    expect(source).not.toMatch(/\/events|createEvent|updateEvent|deleteEvent|accept|decline|\.patch\(|\.delete\(/i);
  });
});