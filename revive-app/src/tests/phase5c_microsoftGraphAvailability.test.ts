import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CALENDAR_CAPABILITIES } from '@/services/calendarAvailabilityService';
import {
  MicrosoftGraphAvailabilityError,
  readMicrosoftGraphPrimaryCalendarAvailability,
} from '../../supabase/functions/_shared/microsoftGraphAvailability';

const token = 'test-access-token';
const request = {
  accessToken: token,
  workspaceId: 'workspace-1',
  selectedCalendarId: 'calendar-1',
  selectedCalendar: {
    id: 'calendar-1', workspaceId: 'workspace-1', connectionId: 'connection-1', provider: 'microsoft_graph' as const,
    providerCalendarReference: 'support@fatherslegacy.net', timezone: 'Europe/London',
  },
  mailboxUserPrincipalName: 'support@fatherslegacy.net',
  searchStartAt: '2026-09-24T09:00:00.000Z',
  searchEndAt: '2026-09-24T12:00:00.000Z',
  timezone: 'Europe/London',
};

function response(scheduleItems: unknown[]) {
  return new Response(JSON.stringify({ value: [{ scheduleItems }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

describe('Phase 5C disabled Microsoft Graph free/busy adapter', () => {
  it('posts only free/busy request fields to the selected primary calendar boundary', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response([]));
    await readMicrosoftGraphPrimaryCalendarAvailability(request, fetchImpl);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe('https://graph.microsoft.com/v1.0/users/support%40fatherslegacy.net/calendar/getSchedule');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe(`Bearer ${token}`);
    expect(JSON.parse(options.body)).toEqual({
      schedules: ['support@fatherslegacy.net'],
      startTime: { dateTime: '2026-09-24T09:00:00.000Z', timeZone: 'UTC' },
      endTime: { dateTime: '2026-09-24T12:00:00.000Z', timeZone: 'UTC' },
      availabilityViewInterval: 30,
    });
  });

  it('normalizes busy, tentative, out-of-office, and working-elsewhere as unavailable while ignoring free', async () => {
    const intervals = await readMicrosoftGraphPrimaryCalendarAvailability(request, vi.fn().mockResolvedValue(response([
      { status: 'free', start: { dateTime: '2026-09-24T09:00:00.000', timeZone: 'UTC' }, end: { dateTime: '2026-09-24T09:30:00.000', timeZone: 'UTC' } },
      { status: 'tentative', start: { dateTime: '2026-09-24T09:30:00.000', timeZone: 'UTC' }, end: { dateTime: '2026-09-24T10:00:00.000', timeZone: 'UTC' } },
      { status: 'busy', start: { dateTime: '2026-09-24T10:00:00.000', timeZone: 'UTC' }, end: { dateTime: '2026-09-24T10:30:00.000', timeZone: 'UTC' } },
      { status: 'oof', start: { dateTime: '2026-09-24T10:30:00.000', timeZone: 'UTC' }, end: { dateTime: '2026-09-24T11:00:00.000', timeZone: 'UTC' } },
      { status: 'workingElsewhere', start: { dateTime: '2026-09-24T11:00:00.000', timeZone: 'UTC' }, end: { dateTime: '2026-09-24T11:30:00.000', timeZone: 'UTC' } },
    ])));
    expect(intervals).toEqual([
      { startAt: '2026-09-24T09:30:00.000Z', endAt: '2026-09-24T10:00:00.000Z' },
      { startAt: '2026-09-24T10:00:00.000Z', endAt: '2026-09-24T10:30:00.000Z' },
      { startAt: '2026-09-24T10:30:00.000Z', endAt: '2026-09-24T11:00:00.000Z' },
      { startAt: '2026-09-24T11:00:00.000Z', endAt: '2026-09-24T11:30:00.000Z' },
    ]);
  });

  it.each([[401, 'provider_rejected'], [403, 'provider_rejected'], [429, 'rate_limited'], [500, 'provider_rejected']] as const)(
    'classifies Graph HTTP %s safely',
    async (status, kind) => {
      await expect(readMicrosoftGraphPrimaryCalendarAvailability(request, vi.fn().mockResolvedValue(new Response('', { status })))).rejects.toMatchObject({ kind, status });
    },
  );

  it('fails closed for network failures and malformed Graph payloads without exposing tokens', async () => {
    await expect(readMicrosoftGraphPrimaryCalendarAvailability(request, vi.fn().mockRejectedValue(new Error('network')))).rejects.toMatchObject({ kind: 'read_outcome_unknown' });
    await expect(readMicrosoftGraphPrimaryCalendarAvailability(request, vi.fn().mockResolvedValue(new Response(JSON.stringify({ value: [{}] }), { status: 200 })))).rejects.toMatchObject({ kind: 'invalid_payload' });
    await expect(readMicrosoftGraphPrimaryCalendarAvailability(request, vi.fn().mockResolvedValue(response([
      { status: 'unrecognized-status', start: { dateTime: '2026-09-24T10:00:00.000', timeZone: 'UTC' }, end: { dateTime: '2026-09-24T10:30:00.000', timeZone: 'UTC' } },
    ])))).rejects.toMatchObject({ kind: 'invalid_payload' });
    await expect(readMicrosoftGraphPrimaryCalendarAvailability(request, vi.fn().mockResolvedValue(response([
      { status: 'busy', start: { dateTime: 'bad', timeZone: 'UTC' }, end: { dateTime: '2026-09-24T10:30:00.000', timeZone: 'UTC' } },
    ])))).rejects.toMatchObject({ kind: 'invalid_payload' });
    await expect(readMicrosoftGraphPrimaryCalendarAvailability(request, vi.fn().mockResolvedValue(new Response('', { status: 401 })))).rejects.not.toThrow(token);
    await expect(readMicrosoftGraphPrimaryCalendarAvailability({ ...request, accessToken: '' }, vi.fn())).rejects.not.toThrow(token);
  });

  it('fails before fetch for workspace/calendar binding or invalid UTC range', async () => {
    const fetchImpl = vi.fn();
    await expect(readMicrosoftGraphPrimaryCalendarAvailability({ ...request, workspaceId: 'workspace-2' }, fetchImpl)).rejects.toBeInstanceOf(MicrosoftGraphAvailabilityError);
    await expect(readMicrosoftGraphPrimaryCalendarAvailability({ ...request, selectedCalendarId: 'calendar-2' }, fetchImpl)).rejects.toBeInstanceOf(MicrosoftGraphAvailabilityError);
    await expect(readMicrosoftGraphPrimaryCalendarAvailability({ ...request, searchStartAt: 'not-utc' }, fetchImpl)).rejects.toBeInstanceOf(MicrosoftGraphAvailabilityError);
    await expect(readMicrosoftGraphPrimaryCalendarAvailability({ ...request, searchStartAt: request.searchEndAt }, fetchImpl)).rejects.toBeInstanceOf(MicrosoftGraphAvailabilityError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('has no mutation endpoint, disabled capabilities, or production entrypoint import', () => {
    const adapter = readFileSync(new URL('../../supabase/functions/_shared/microsoftGraphAvailability.ts', import.meta.url), 'utf8');
    const entrypoints = [
      '../../supabase/functions/rev-email-inbound/index.ts',
      '../../supabase/functions/rev-email-execute/index.ts',
      '../../supabase/functions/rev-business-verify/index.ts',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));
    expect(adapter).not.toMatch(/\/events|createEvent|updateEvent|deleteEvent|\.patch\(|\.delete\(/i);
    expect(entrypoints.join('\n')).not.toContain('microsoftGraphAvailability');
    expect(CALENDAR_CAPABILITIES.READ_CALENDAR_AVAILABILITY).toBe(false);
    expect(CALENDAR_CAPABILITIES.CREATE_CALENDAR_EVENT).toBe(false);
  });
});