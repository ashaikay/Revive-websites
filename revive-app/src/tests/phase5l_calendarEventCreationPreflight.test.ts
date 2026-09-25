import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CALENDAR_CAPABILITIES } from '@/services/calendarAvailabilityService';

const architecture = readFileSync(
  new URL(
    '../../../REVIVE_AI_MASTER/02_PHASES/PHASE_5L_CALENDAR_EVENT_CREATION_PREFLIGHT.md',
    import.meta.url,
  ),
  'utf8',
);

const availabilityAdapter = readFileSync(
  new URL(
    '../../supabase/functions/_shared/microsoftGraphAvailability.ts',
    import.meta.url,
  ),
  'utf8',
);

const availabilityBoundary = readFileSync(
  new URL(
    '../../supabase/functions/rev-calendar-availability/calendarAvailabilityBoundary.ts',
    import.meta.url,
  ),
  'utf8',
);

describe('Phase 5L controlled calendar event creation preflight', () => {
  it('keeps calendar event creation disabled', () => {
    expect(CALENDAR_CAPABILITIES.CREATE_CALENDAR_EVENT).toBe(false);
    expect(architecture).toContain(
      '`CREATE_CALENDAR_EVENT` remains `false`',
    );
    expect(architecture).toContain(
      'does **not** authorize `Calendars.ReadWrite`',
    );
  });

  it('requires approval binding and durable idempotency', () => {
    for (const requirement of [
      'exact approved action version',
      'current material action fingerprint',
      'proposal version',
      'durable execution attempt',
      'idempotency key',
      'outcome_unknown',
    ]) {
      expect(architecture).toContain(requirement);
    }
  });

  it('requires scoped permission preflight without changing availability', () => {
    expect(architecture).toContain('Application Calendars.ReadWrite');
    expect(architecture).toContain(
      'support-mailbox-only management scope',
    );

    expect(availabilityAdapter).toContain('/calendar/getSchedule');
    expect(availabilityAdapter).not.toMatch(/\/events\b/);

    expect(availabilityBoundary).not.toMatch(
      /Calendars\.ReadWrite|createEvent|\/events\b/,
    );
  });

  it('forbids browser authority and unapproved mutation families', () => {
    expect(architecture).toContain(
      'No browser-supplied mailbox',
    );
    expect(architecture).toContain(
      'No event update, cancellation, RSVP handling, recurrence',
    );
    expect(architecture).toContain(
      'No raw token, provider response, attendee details, notes',
    );
  });
});