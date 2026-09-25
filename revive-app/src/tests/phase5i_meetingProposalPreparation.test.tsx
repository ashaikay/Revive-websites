import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CalendarAvailabilityPanel } from '@/components/CalendarAvailabilityPanel';
import {
  prepareMeetingProposal,
  type MeetingProposalInput,
} from '@/services/meetingProposalService';

const selectedSlot = { startAt: '2026-09-28T08:00:00.000Z', endAt: '2026-09-28T08:30:00.000Z' };
const validInput: MeetingProposalInput = {
  title: '  Discovery call  ', attendeeEmail: '  HELLO@EXAMPLE.TEST ', meetingMethod: 'online', locationDetails: '  Video call  ', notes: '  Discuss requirements.  ',
};

describe('Phase 5I local supervised meeting proposal preparation', () => {
  it('normalizes valid local input and uses only the selected instants and trusted timezone', () => {
    expect(prepareMeetingProposal(validInput, selectedSlot, 'Europe/London')).toEqual({
      valid: true,
      proposal: { title: 'Discovery call', attendeeEmail: 'hello@example.test', meetingMethod: 'online', locationDetails: 'Video call', notes: 'Discuss requirements.', ...selectedSlot, timezone: 'Europe/London' },
    });
  });

  it.each([
    [{ ...validInput, title: '' }, 'title', 'Meeting title is required.'],
    [{ ...validInput, attendeeEmail: '' }, 'attendeeEmail', 'Attendee email is required.'],
    [{ ...validInput, attendeeEmail: 'not-an-email' }, 'attendeeEmail', 'Enter a valid attendee email address.'],
    [{ ...validInput, title: 'x'.repeat(121) }, 'title', 'Meeting title must be 120 characters or fewer.'],
    [{ ...validInput, locationDetails: 'x'.repeat(241) }, 'locationDetails', 'Location/details must be 240 characters or fewer.'],
    [{ ...validInput, notes: 'x'.repeat(1001) }, 'notes', 'Notes must be 1,000 characters or fewer.'],
  ] as const)('rejects invalid local %s input', (input, field, message) => {
    const result = prepareMeetingProposal(input, selectedSlot, 'Europe/London');
    expect(result).toEqual({ valid: false, errors: { [field]: message } });
  });

  it('accepts optional fields and every supported local meeting method', () => {
    for (const meetingMethod of ['online', 'phone', 'in_person'] as const) {
      const result = prepareMeetingProposal({ ...validInput, meetingMethod, locationDetails: '', notes: '' }, selectedSlot, 'Europe/London');
      expect(result.valid).toBe(true);
      if (result.valid) expect(result.proposal).toMatchObject({ meetingMethod, locationDetails: '', notes: '' });
    }
  });

  it('keeps preparation local with an explicit availability action and no request on render', () => {
    const requestAvailability = vi.fn();
    const markup = renderToStaticMarkup(<CalendarAvailabilityPanel workspaceId="workspace-1" requestAvailability={requestAvailability} />);
    expect(requestAvailability).not.toHaveBeenCalled();
    expect(markup).toContain('CHECK AVAILABILITY');
    const source = readFileSync(new URL('../components/CalendarAvailabilityPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('PREPARE MEETING PROPOSAL');
    expect(source).toContain('PREPARED — NOT BOOKED');
    expect(source).toContain('Owner approval and controlled execution are required before any calendar event or invitation can be created.');
    expect(source).toContain('EDIT PROPOSAL');
    expect(source).toContain('DISCARD PROPOSAL');
    expect(source).toContain('{selectedSlot && !preparedProposal && (');
    expect(source).toContain('{preparedProposal && !submittedProposal && (');
    expect(source).toContain('onClick={() => { setPreparedProposal(null); setProposalErrors({}); setSubmissionConfirmation(false); setSubmissionError(null); }}>EDIT PROPOSAL');
    expect(source).toContain('onClick={clearProposal}>DISCARD PROPOSAL');
    expect(source).toMatch(/setDate\(event\.target\.value\); clearSelection\(\);/);
    expect(source).toMatch(/setDuration\(Number\(event\.target\.value\) as 30 \| 60\); clearSelection\(\);/);
    expect(source).toMatch(/setSelectedSlot\(\{ startAt: slot\.startAt, endAt: slot\.endAt \}\); clearProposal\(\);/);
    expect(source).toMatch(/setResult\(null\);\s+clearSelection\(\);/);
    expect(source).toMatch(/catch \(requestError\) \{\s+clearSelection\(\);/);
    expect(source.match(/requestAvailability\(/g)).toHaveLength(1);
    expect(source).not.toMatch(/\bApproved\b|\bExecute\b|\bBook\b|\bSchedule\b|Create event|Send invitation|Confirm booking|\.rpc\(|localStorage|sessionStorage|window\.location|mailto:|\/events|createEvent|updateEvent|deleteEvent/i);
  });
});