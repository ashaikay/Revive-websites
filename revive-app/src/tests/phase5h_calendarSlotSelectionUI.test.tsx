import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  CalendarAvailabilityPanel,
  selectedSlotMatches,
} from '@/components/CalendarAvailabilityPanel';

const firstSlot = { startAt: '2026-09-25T09:00:00.000Z', endAt: '2026-09-25T09:30:00.000Z' };
const secondSlot = { startAt: '2026-09-25T10:00:00.000Z', endAt: '2026-09-25T10:30:00.000Z' };

describe('Phase 5H read-only calendar slot selection', () => {
  it('renders availability as accessible buttons without making a request on render', () => {
    const requestAvailability = vi.fn();
    const markup = renderToStaticMarkup(<CalendarAvailabilityPanel workspaceId="workspace-1" requestAvailability={requestAvailability} />);
    expect(requestAvailability).not.toHaveBeenCalled();
    expect(markup).toContain('CHECK AVAILABILITY');
    const source = readFileSync(new URL('../components/CalendarAvailabilityPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('aria-pressed={selected}');
    expect(source).toContain('onClick={() => setSelectedSlot({ startAt: slot.startAt, endAt: slot.endAt })}');
    expect(source).toContain('SELECTED — NOT BOOKED');
    expect(source).toContain('No calendar event or invitation has been created.');
  });

  it('selects one returned slot at a time and clears or replaces selection locally', () => {
    expect(selectedSlotMatches(null, firstSlot)).toBe(false);
    expect(selectedSlotMatches(firstSlot, firstSlot)).toBe(true);
    expect(selectedSlotMatches(firstSlot, secondSlot)).toBe(false);
    const replacement = secondSlot;
    expect(selectedSlotMatches(replacement, firstSlot)).toBe(false);
    expect(selectedSlotMatches(null, secondSlot)).toBe(false);
  });

  it('clears selection for date, duration, a new check, failures, and returned slot replacement without extra requests', () => {
    const source = readFileSync(new URL('../components/CalendarAvailabilityPanel.tsx', import.meta.url), 'utf8');
    expect(source).toContain('setDate(event.target.value); clearSelection();');
    expect(source).toContain('setDuration(Number(event.target.value) as 30 | 60); clearSelection();');
    expect(source).toMatch(/setResult\(null\);\s+clearSelection\(\);/);
    expect(source).toMatch(/catch \(requestError\) \{\s+clearSelection\(\);/);
    expect(source).toContain('nextResult.slots.some((slot) => selectedSlotMatches(current, slot)) ? current : null');
    expect(source).toContain('onClick={clearSelection}');
    expect(source.match(/requestAvailability\(/g)).toHaveLength(1);
  });

  it('contains no booking, persistence, provider mutation, or execution controls', () => {
    const source = readFileSync(new URL('../components/CalendarAvailabilityPanel.tsx', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\bBook\b|\bSchedule\b|Create event|Send invitation|Confirm booking|\.rpc\(|localStorage|sessionStorage|window\.location|mailto:|\/events|createEvent|updateEvent|deleteEvent|acceptEvent|declineEvent/i);
  });
});