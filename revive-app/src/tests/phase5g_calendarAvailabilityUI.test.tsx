import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CalendarAvailabilityPanel } from '@/components/CalendarAvailabilityPanel';
import {
  CalendarAvailabilityClientError,
  requestCalendarAvailability,
} from '@/services/calendarAvailabilityClient';
import { businessDateToUtcRange, formatAvailabilitySlot } from '@/utils/calendarAvailabilityTime';

const request = {
  workspaceId: 'workspace-1',
  searchStartAt: '2026-09-24T00:00:00.000Z',
  searchEndAt: '2026-09-25T00:00:00.000Z',
  requestedDurationMinutes: 30 as const,
  timezone: 'Europe/London',
};

const availableResult = {
  status: 'available' as const,
  timezone: 'Europe/London',
  slots: [{ startAt: '2026-09-24T09:00:00.000Z', endAt: '2026-09-24T09:30:00.000Z' }],
};

describe('Phase 5G read-only calendar availability UI and client', () => {
  it('does not request availability on render and exposes only an explicit check control', () => {
    const requestAvailability = vi.fn();
    const markup = renderToStaticMarkup(<CalendarAvailabilityPanel workspaceId="workspace-1" requestAvailability={requestAvailability} />);
    expect(requestAvailability).not.toHaveBeenCalled();
    expect(markup).toContain('CALENDAR AVAILABILITY');
    expect(markup).toContain('READ-ONLY');
    expect(markup).toContain('Checks the connected business calendar for available times. No event will be created.');
    expect(markup).toContain('CHECK AVAILABILITY');
    expect(markup).not.toMatch(/<button[^>]*>[^<]*(?:Book|Schedule|Create|Send|Execute|Event)[^<]*<\/button>/i);
    const source = readFileSync(new URL('../components/CalendarAvailabilityPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('onClick={handleCheckAvailability}');
    expect(source).toContain('if (checking) return;');
    expect(source).toContain('disabled={checking}');
  });

  it('makes exactly one explicit client request with no mailbox, calendar, provider, or credential fields', async () => {
    const invoke = vi.fn().mockResolvedValue({ data: availableResult, error: null });
    const result = await requestCalendarAvailability(request, invoke);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(request);
    expect(Object.keys(invoke.mock.calls[0][0]).sort()).toEqual(['requestedDurationMinutes', 'searchEndAt', 'searchStartAt', 'timezone', 'workspaceId']);
    expect(result).toEqual(availableResult);
  });

  it('formats returned normalized slots in the authorised business timezone and keeps empty availability truthful', () => {
    expect(formatAvailabilitySlot('2026-09-24T09:00:00.000Z', '2026-09-24T09:30:00.000Z', 'Europe/London')).toBe('10:00 - 10:30');
    const markup = renderToStaticMarkup(<CalendarAvailabilityPanel workspaceId="workspace-1" />);
    expect(markup).toContain('Workspace timezone: Europe/London');
    expect(markup).not.toContain('No available times were returned for this date.');
  });

  it('converts selected business dates to UTC ranges across London DST boundaries', () => {
    expect(businessDateToUtcRange('2026-03-29', 'Europe/London')).toEqual({ searchStartAt: '2026-03-29T00:00:00.000Z', searchEndAt: '2026-03-29T23:00:00.000Z' });
    expect(businessDateToUtcRange('2026-10-25', 'Europe/London')).toEqual({ searchStartAt: '2026-10-24T23:00:00.000Z', searchEndAt: '2026-10-26T00:00:00.000Z' });
  });

  it.each([
    [401, 'Sign in is required to check calendar availability.'],
    [403, 'You do not have access to this workspace calendar.'],
    [429, 'Calendar availability is temporarily rate limited. Try again later.'],
    [502, 'Calendar provider authentication or availability is unavailable.'],
    [503, 'Calendar availability is currently disabled or unavailable. No event will be created.'],
  ])('maps HTTP %s to a safe message', async (status, message) => {
    await expect(requestCalendarAvailability(request, vi.fn().mockResolvedValue({ data: null, error: { context: { status } } }))).rejects.toMatchObject({
      name: 'CalendarAvailabilityClientError', message, status,
    });
  });

  it('fails closed for malformed provider responses and preserves no event details in the UI/client source', async () => {
    await expect(requestCalendarAvailability(request, vi.fn().mockResolvedValue({ data: { status: 'available', timezone: 'Europe/London', slots: [{ startAt: 'bad' }] }, error: null }))).rejects.toBeInstanceOf(CalendarAvailabilityClientError);
    const source = [
      '../components/CalendarAvailabilityPanel.tsx',
      '../services/calendarAvailabilityClient.ts',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8')).join('\n');
    expect(source).not.toMatch(/mailbox|calendarId|accessToken|Calendars\.ReadWrite|createEvent|updateEvent|deleteEvent|send invitation|accept|decline/i);
    expect(source).not.toContain('FatherLegacy');
  });

  it('keeps existing email-send safeguards unchanged', () => {
    const source = readFileSync(new URL('../components/REVInterface.tsx', import.meta.url), 'utf8');
    expect(source).toContain('EMAIL SENDING DISABLED');
    expect(source).not.toMatch(/<button[^>]*>\s*Send\s*<\/button>/i);
  });
});