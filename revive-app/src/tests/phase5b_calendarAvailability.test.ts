import { describe, expect, it, vi } from 'vitest';
import {
  AvailabilityRequest,
  CALENDAR_CAPABILITIES,
  calculateAvailability,
} from '@/services/calendarAvailabilityService';

function request(overrides: Partial<AvailabilityRequest> = {}): AvailabilityRequest {
  return {
    workspaceId: 'workspace-1',
    selectedCalendarId: 'calendar-1',
    selectedCalendar: {
      id: 'calendar-1', workspaceId: 'workspace-1', connectionId: 'connection-1', provider: 'microsoft_graph',
      providerCalendarReference: 'calendar-reference', timezone: 'Europe/London',
    },
    timezone: 'Europe/London',
    requestedDurationMinutes: 30,
    searchStartAt: '2026-09-24T09:00:00.000Z',
    searchEndAt: '2026-09-24T12:00:00.000Z',
    now: '2026-09-24T08:00:00.000Z',
    policy: {
      minimumNoticeMinutes: 0, beforeBufferMinutes: 0, afterBufferMinutes: 0,
      availabilityWindows: [{ startAt: '2026-09-24T09:00:00.000Z', endAt: '2026-09-24T12:00:00.000Z' }],
    },
    busyIntervals: [],
    ...overrides,
  };
}

describe('Phase 5B provider-independent calendar availability', () => {
  it('calculates chronological deterministic slots inside allowed windows', () => {
    const input = request({ busyIntervals: [{ startAt: '2026-09-24T10:00:00.000Z', endAt: '2026-09-24T10:30:00.000Z' }] });
    const first = calculateAvailability(input);
    const second = calculateAvailability(input);
    expect(first).toEqual(second);
    expect(first.slots.map((slot) => slot.startAt)).toEqual([
      '2026-09-24T09:00:00.000Z', '2026-09-24T09:30:00.000Z', '2026-09-24T10:30:00.000Z',
      '2026-09-24T11:00:00.000Z', '2026-09-24T11:30:00.000Z',
    ]);
  });

  it('merges overlapping or adjacent busy intervals', () => {
    const result = calculateAvailability(request({ busyIntervals: [
      { startAt: '2026-09-24T09:30:00.000Z', endAt: '2026-09-24T10:00:00.000Z' },
      { startAt: '2026-09-24T09:45:00.000Z', endAt: '2026-09-24T10:30:00.000Z' },
      { startAt: '2026-09-24T10:30:00.000Z', endAt: '2026-09-24T11:00:00.000Z' },
    ] }));
    expect(result.slots.map((slot) => slot.startAt)).toEqual([
      '2026-09-24T09:00:00.000Z', '2026-09-24T11:00:00.000Z', '2026-09-24T11:30:00.000Z',
    ]);
  });

  it('enforces before/after buffers and minimum notice', () => {
    const result = calculateAvailability(request({
      now: '2026-09-24T08:45:00.000Z',
      policy: {
        minimumNoticeMinutes: 30, beforeBufferMinutes: 15, afterBufferMinutes: 15,
        availabilityWindows: [{ startAt: '2026-09-24T09:00:00.000Z', endAt: '2026-09-24T12:00:00.000Z' }],
      },
      busyIntervals: [{ startAt: '2026-09-24T10:00:00.000Z', endAt: '2026-09-24T10:30:00.000Z' }],
    }));
    expect(result.slots.map((slot) => slot.startAt)).toEqual([
      '2026-09-24T09:15:00.000Z', '2026-09-24T10:45:00.000Z', '2026-09-24T11:15:00.000Z',
    ]);
  });

  it('uses multiple availability windows without creating crossing slots', () => {
    const result = calculateAvailability(request({ policy: {
      minimumNoticeMinutes: 0, beforeBufferMinutes: 0, afterBufferMinutes: 0,
      availabilityWindows: [
        { startAt: '2026-09-24T09:00:00.000Z', endAt: '2026-09-24T10:00:00.000Z' },
        { startAt: '2026-09-24T11:00:00.000Z', endAt: '2026-09-24T12:00:00.000Z' },
      ],
    } }));
    expect(result.slots.map((slot) => slot.startAt)).toEqual([
      '2026-09-24T09:00:00.000Z', '2026-09-24T09:30:00.000Z', '2026-09-24T11:00:00.000Z', '2026-09-24T11:30:00.000Z',
    ]);
  });

  it('fails closed for workspace/calendar mismatch, invalid timezone, and malformed or inverted ranges', () => {
    expect(calculateAvailability(request({ workspaceId: 'workspace-2' })).status).toBe('unavailable');
    expect(calculateAvailability(request({ selectedCalendarId: 'calendar-2' })).status).toBe('unavailable');
    expect(calculateAvailability(request({ timezone: 'Invalid/Timezone' })).status).toBe('unavailable');
    expect(calculateAvailability(request({ timezone: '' })).status).toBe('unavailable');
    expect(calculateAvailability(request({ searchStartAt: 'not-a-timestamp' })).status).toBe('unavailable');
    expect(calculateAvailability(request({ searchStartAt: '2026-09-24T12:00:00.000Z' })).status).toBe('unavailable');
  });

  it('keeps read and event creation capabilities disabled without provider, browser, or mutation code', async () => {
    const source = await import('node:fs/promises').then(({ readFile }) => readFile(
      new URL('../services/calendarAvailabilityService.ts', import.meta.url), 'utf8',
    ));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    calculateAvailability(request());
    expect(CALENDAR_CAPABILITIES.READ_CALENDAR_AVAILABILITY).toBe(false);
    expect(CALENDAR_CAPABILITIES.CREATE_CALENDAR_EVENT).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(source).not.toMatch(/supabase|oauth|fetch\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.rpc\(/i);
    fetchSpy.mockRestore();
  });
});