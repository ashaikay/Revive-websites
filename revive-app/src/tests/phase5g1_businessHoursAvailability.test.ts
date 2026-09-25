import { describe, expect, it, vi } from 'vitest';
import { calculateAvailability, type AvailabilityRequest } from '@/services/calendarAvailabilityService';
import { buildBusinessHoursAvailabilityWindows } from '../../supabase/functions/rev-calendar-availability/businessHoursPolicy';
import {
  CALENDAR_AVAILABILITY_ENVIRONMENT,
  createTrustedCalendarAvailabilityResolver,
} from '../../supabase/functions/rev-calendar-availability/trustedCalendarAvailabilityResolver';

const configuration = {
  workingDays: '1,2,3,4,5',
  businessStartLocal: '09:00',
  businessEndLocal: '17:00',
  timezone: 'Europe/London',
};

function windows(start: string, end: string) {
  return buildBusinessHoursAvailabilityWindows(configuration, start, end);
}

function availabilityRequest(overrides: Partial<AvailabilityRequest> = {}): AvailabilityRequest {
  const searchStartAt = '2026-09-25T00:00:00.000Z';
  const searchEndAt = '2026-09-26T00:00:00.000Z';
  return {
    workspaceId: 'workspace-1', selectedCalendarId: 'calendar-1',
    selectedCalendar: { id: 'calendar-1', workspaceId: 'workspace-1', connectionId: 'connection-1', provider: 'microsoft_graph', providerCalendarReference: 'trusted', timezone: 'Europe/London' },
    timezone: 'Europe/London', requestedDurationMinutes: 30,
    searchStartAt, searchEndAt, now: '2026-09-24T00:00:00.000Z',
    policy: { minimumNoticeMinutes: 0, beforeBufferMinutes: 0, afterBufferMinutes: 0, availabilityWindows: windows(searchStartAt, searchEndAt) },
    busyIntervals: [],
    ...overrides,
  };
}

describe('Phase 5G.1 trusted business-hours availability policy', () => {
  it('generates Friday slots only from 09:00 to 17:00 local, with the last 30-minute slot ending at close', () => {
    const result = calculateAvailability(availabilityRequest());
    expect(result.status).toBe('available');
    expect(result.slots).toHaveLength(16);
    expect(result.slots[0]).toMatchObject({ startAt: '2026-09-25T08:00:00.000Z', endAt: '2026-09-25T08:30:00.000Z' });
    expect(result.slots.at(-1)).toMatchObject({ startAt: '2026-09-25T15:30:00.000Z', endAt: '2026-09-25T16:00:00.000Z' });
    expect(result.slots.every((slot) => slot.startAt >= '2026-09-25T08:00:00.000Z' && slot.endAt <= '2026-09-25T16:00:00.000Z')).toBe(true);
  });

  it('returns no weekend windows or overnight slots for the configured weekdays', () => {
    expect(windows('2026-09-26T00:00:00.000Z', '2026-09-27T00:00:00.000Z')).toEqual([]);
    expect(windows('2026-09-27T00:00:00.000Z', '2026-09-28T00:00:00.000Z')).toEqual([]);
    const saturday = calculateAvailability(availabilityRequest({
      searchStartAt: '2026-09-26T00:00:00.000Z', searchEndAt: '2026-09-27T00:00:00.000Z',
      policy: { minimumNoticeMinutes: 0, beforeBufferMinutes: 0, afterBufferMinutes: 0, availabilityWindows: [] },
    }));
    expect(saturday.slots).toEqual([]);
  });

  it('removes busy intervals and retains minimum notice inside configured hours', () => {
    const result = calculateAvailability(availabilityRequest({
      now: '2026-09-25T08:30:00.000Z',
      policy: { minimumNoticeMinutes: 60, beforeBufferMinutes: 0, afterBufferMinutes: 0, availabilityWindows: windows('2026-09-25T00:00:00.000Z', '2026-09-26T00:00:00.000Z') },
      busyIntervals: [{ startAt: '2026-09-25T10:00:00.000Z', endAt: '2026-09-25T11:00:00.000Z' }],
    }));
    expect(result.slots.map((slot) => slot.startAt)).toEqual([
      '2026-09-25T09:30:00.000Z', '2026-09-25T11:00:00.000Z', '2026-09-25T11:30:00.000Z',
      '2026-09-25T12:00:00.000Z', '2026-09-25T12:30:00.000Z', '2026-09-25T13:00:00.000Z', '2026-09-25T13:30:00.000Z',
      '2026-09-25T14:00:00.000Z', '2026-09-25T14:30:00.000Z', '2026-09-25T15:00:00.000Z', '2026-09-25T15:30:00.000Z',
    ]);
  });

  it('generates only permitted weekdays across a multi-day search and converts BST/GMT local hours correctly', () => {
    expect(windows('2026-09-25T00:00:00.000Z', '2026-09-29T00:00:00.000Z')).toEqual([
      { startAt: '2026-09-25T08:00:00.000Z', endAt: '2026-09-25T16:00:00.000Z' },
      { startAt: '2026-09-28T08:00:00.000Z', endAt: '2026-09-28T16:00:00.000Z' },
    ]);
    expect(windows('2026-03-27T00:00:00.000Z', '2026-03-31T00:00:00.000Z')).toEqual([
      { startAt: '2026-03-27T09:00:00.000Z', endAt: '2026-03-27T17:00:00.000Z' },
      { startAt: '2026-03-30T08:00:00.000Z', endAt: '2026-03-30T16:00:00.000Z' },
    ]);
    expect(windows('2026-10-23T00:00:00.000Z', '2026-10-27T00:00:00.000Z')).toEqual([
      { startAt: '2026-10-23T08:00:00.000Z', endAt: '2026-10-23T16:00:00.000Z' },
      { startAt: '2026-10-26T09:00:00.000Z', endAt: '2026-10-26T17:00:00.000Z' },
    ]);
  });

  it.each([
    { ...configuration, workingDays: undefined },
    { ...configuration, workingDays: '1,1' },
    { ...configuration, workingDays: '0,1' },
    { ...configuration, workingDays: '1,8' },
    { ...configuration, businessStartLocal: undefined },
    { ...configuration, businessStartLocal: '9:00' },
    { ...configuration, businessEndLocal: '17:60' },
    { ...configuration, businessStartLocal: '17:00', businessEndLocal: '17:00' },
    { ...configuration, businessStartLocal: '17:00', businessEndLocal: '09:00' },
  ])('fails closed for invalid business-hours configuration', (invalidConfiguration) => {
    expect(() => buildBusinessHoursAvailabilityWindows(invalidConfiguration, '2026-09-25T00:00:00.000Z', '2026-09-26T00:00:00.000Z')).toThrow('Trusted business-hours configuration is invalid.');
  });

  it('does not acquire a token or reach a provider when policy configuration is missing', async () => {
    const acquireAccessToken = vi.fn();
    const resolver = createTrustedCalendarAvailabilityResolver({
      getEnvironment: (name) => ({
        [CALENDAR_AVAILABILITY_ENVIRONMENT.authorizedWorkspaceId]: 'workspace-1',
        [CALENDAR_AVAILABILITY_ENVIRONMENT.primaryMailbox]: 'trusted@example.test',
        [CALENDAR_AVAILABILITY_ENVIRONMENT.timezone]: 'Europe/London',
        MICROSOFT_GRAPH_TENANT_ID: 'tenant', MICROSOFT_GRAPH_CLIENT_ID: 'client', MICROSOFT_GRAPH_CLIENT_SECRET: 'secret',
      })[name],
      acquireAccessToken,
    });
    await expect(resolver('workspace-1', '2026-09-25T00:00:00.000Z', '2026-09-26T00:00:00.000Z', 'Europe/London')).rejects.toThrow('Trusted business-hours configuration is invalid.');
    expect(acquireAccessToken).not.toHaveBeenCalled();
  });
});