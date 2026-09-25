import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { requestCalendarAvailability } from '@/services/calendarAvailabilityClient';
import {
  handleCalendarAvailability,
  type CalendarAvailabilityDependencies,
} from '../../supabase/functions/rev-calendar-availability/calendarAvailabilityBoundary';

const request = {
  workspaceId: 'workspace-1',
  searchStartAt: '2026-09-26T00:00:00.000Z',
  searchEndAt: '2026-09-27T00:00:00.000Z',
  requestedDurationMinutes: 30 as const,
  timezone: 'Europe/London',
};

function post(body: unknown = request): Request {
  return new Request('https://example.test/functions/v1/rev-calendar-availability', {
    method: 'POST',
    headers: { Authorization: 'Bearer user-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function dependencies(availabilityWindows: { startAt: string; endAt: string }[]): CalendarAvailabilityDependencies {
  return {
    isCalendarAvailabilityEnabled: () => true,
    getAuthenticatedUserId: vi.fn().mockResolvedValue('user-1'),
    hasActiveWorkspaceMembership: vi.fn().mockResolvedValue(true),
    resolveTrustedCalendarAvailability: vi.fn().mockResolvedValue({
      selectedCalendar: { id: 'calendar-1', workspaceId: request.workspaceId, connectionId: 'connection-1', provider: 'microsoft_graph', providerCalendarReference: 'trusted', timezone: request.timezone },
      primaryMailboxUserPrincipalName: 'trusted@example.test', accessToken: 'server-only-token',
      policy: { minimumNoticeMinutes: 0, beforeBufferMinutes: 0, afterBufferMinutes: 0, availabilityWindows },
    }),
    readBusyIntervals: vi.fn().mockResolvedValue([]),
    calculateAvailability: vi.fn().mockReturnValue({
      status: 'available',
      slots: [{ workspaceId: request.workspaceId, selectedCalendarId: 'calendar-1', startAt: '2026-09-28T08:00:00.000Z', endAt: '2026-09-28T08:30:00.000Z' }],
    }),
    now: () => '2026-09-25T00:00:00.000Z',
  };
}

describe('Phase 5H.1 truthful non-working-day availability', () => {
  it('returns the fixed empty non-working-day result before Graph or the calculator', async () => {
    const deps = dependencies([]);
    const response = await handleCalendarAvailability(post(), deps);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ status: 'unavailable', slots: [], code: 'outside_business_hours', timezone: 'Europe/London' });
    expect(deps.readBusyIntervals).not.toHaveBeenCalled();
    expect(deps.calculateAvailability).not.toHaveBeenCalled();
    expect(JSON.stringify(body)).not.toContain('At least one availability window is required.');
  });

  it('accepts only the fixed safe code and preserves normal weekday availability', async () => {
    const nonWorkingDay = await requestCalendarAvailability(request, vi.fn().mockResolvedValue({
      data: { status: 'unavailable', slots: [], code: 'outside_business_hours', timezone: 'Europe/London' }, error: null,
    }));
    expect(nonWorkingDay).toEqual({ status: 'unavailable', slots: [], code: 'outside_business_hours', timezone: 'Europe/London' });
    await expect(requestCalendarAvailability(request, vi.fn().mockResolvedValue({
      data: { status: 'unavailable', slots: [], code: 'untrusted_reason', timezone: 'Europe/London' }, error: null,
    }))).rejects.toThrow('Calendar availability returned an invalid response.');

    const deps = dependencies([{ startAt: request.searchStartAt, endAt: request.searchEndAt }]);
    const response = await handleCalendarAvailability(post({ ...request, searchStartAt: '2026-09-28T00:00:00.000Z', searchEndAt: '2026-09-29T00:00:00.000Z' }), deps);
    expect(response.status).toBe(200);
    expect((await response.json()).slots).toEqual([{ startAt: '2026-09-28T08:00:00.000Z', endAt: '2026-09-28T08:30:00.000Z' }]);
    expect(deps.readBusyIntervals).toHaveBeenCalledTimes(1);
    expect(deps.calculateAvailability).toHaveBeenCalledTimes(1);
  });

  it('shows the exact working-day guidance, clears prior selection, and retains read-only selectable slots', () => {
    const panel = readFileSync(new URL('../components/CalendarAvailabilityPanel.tsx', import.meta.url), 'utf8');
    const boundary = readFileSync(new URL('../../supabase/functions/rev-calendar-availability/calendarAvailabilityBoundary.ts', import.meta.url), 'utf8');
    expect(panel).toContain('No business hours are configured for this date. Please choose a working day.');
    expect(panel).toMatch(/if \(nextResult\.code === 'outside_business_hours'\) \{\s+clearSelection\(\);/);
    expect(panel).toContain('aria-pressed={selected}');
    expect(panel).toContain('onClick={() => { setSelectedSlot({ startAt: slot.startAt, endAt: slot.endAt }); clearProposal(); }}');
    expect(panel).not.toMatch(/\bBook\b|\bSchedule\b|Create event|Send invitation|Confirm booking|\.rpc\(|localStorage|sessionStorage|\/events|createEvent|updateEvent|deleteEvent/i);
    expect(boundary).not.toMatch(/At least one availability window is required\.|createEvent|updateEvent|deleteEvent|\.rpc\(/i);
  });
});