import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleCalendarAvailability,
  type CalendarAvailabilityDependencies,
} from '../../supabase/functions/rev-calendar-availability/calendarAvailabilityBoundary';

const secret = 'never-log-this-calendar-secret';
const payload = {
  workspaceId: 'workspace-1',
  searchStartAt: '2026-09-25T09:00:00.000Z',
  searchEndAt: '2026-09-25T12:00:00.000Z',
  requestedDurationMinutes: 30,
  timezone: 'Europe/London',
};

function post(): Request {
  return new Request('https://example.test/functions/v1/rev-calendar-availability', {
    method: 'POST', headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
}

function dependencies(overrides: Partial<CalendarAvailabilityDependencies> = {}): CalendarAvailabilityDependencies {
  return {
    isCalendarAvailabilityEnabled: () => true,
    getAuthenticatedUserId: vi.fn().mockResolvedValue('user-1'),
    hasActiveWorkspaceMembership: vi.fn().mockResolvedValue(true),
    resolveTrustedCalendarAvailability: vi.fn().mockResolvedValue({
      selectedCalendar: { id: 'calendar-secret', workspaceId: 'workspace-1', connectionId: 'connection-secret', provider: 'microsoft_graph', providerCalendarReference: 'mailbox-secret@example.test', timezone: 'Europe/London' },
      primaryMailboxUserPrincipalName: 'mailbox-secret@example.test', accessToken: secret,
      policy: { minimumNoticeMinutes: 0, beforeBufferMinutes: 0, afterBufferMinutes: 0, availabilityWindows: [{ startAt: payload.searchStartAt, endAt: payload.searchEndAt }] },
    }),
    readBusyIntervals: vi.fn().mockResolvedValue([]),
    now: () => '2026-09-25T08:00:00.000Z',
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('Phase 5G.2 calendar availability diagnostics', () => {
  it.each([
    ['resolve_trusted_configuration', (deps: CalendarAvailabilityDependencies) => {
      (deps.resolveTrustedCalendarAvailability as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(`${secret} resolver failure`));
    }],
    ['read_busy_intervals', (deps: CalendarAvailabilityDependencies) => {
      (deps.readBusyIntervals as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error(`${secret} provider failure`));
    }],
    ['calculate_availability', (deps: CalendarAvailabilityDependencies) => {
      deps.now = () => { throw new Error(`${secret} calculation failure`); };
    }],
  ] as const)('logs only the fixed %s diagnostic stage for unexpected failures', async (stage, arrange) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = dependencies();
    arrange(deps);
    const response = await handleCalendarAvailability(post(), deps);
    const responseBody = await response.json();
    expect(response.status).toBe(503);
    expect(responseBody).toEqual({
      error: 'Calendar availability is unavailable.',
      code: 'unexpected_calendar_failure',
      stage,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalledWith(JSON.stringify({
      event: 'calendar_availability_failure',
      stage,
      errorName: 'Error',
    }));
    const diagnostic = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(Object.keys(diagnostic)).toEqual(['event', 'stage', 'errorName']);
    expect(JSON.stringify(diagnostic)).not.toContain(secret);
    expect(JSON.stringify(responseBody)).not.toContain('errorName');
  });

  it('keeps disabled requests silent with no resolver or provider access', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const deps = dependencies({ isCalendarAvailabilityEnabled: () => false });
    const response = await handleCalendarAvailability(post(), deps);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: 'disabled', providerCalls: 0, externalEffect: 'none' });
    expect(deps.resolveTrustedCalendarAvailability).not.toHaveBeenCalled();
    expect(deps.readBusyIntervals).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});