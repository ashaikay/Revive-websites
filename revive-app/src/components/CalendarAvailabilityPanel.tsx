import React, { useState } from 'react';
import {
  DEFAULT_AVAILABILITY_TIMEZONE,
  requestCalendarAvailability,
  type CalendarAvailabilityResult,
} from '@/services/calendarAvailabilityClient';
import { businessDateToUtcRange, formatAvailabilitySlot } from '@/utils/calendarAvailabilityTime';

export interface CalendarAvailabilityPanelProps {
  workspaceId: string;
  requestAvailability?: typeof requestCalendarAvailability;
  initialTimezone?: string;
}

export interface SelectedCalendarSlot {
  startAt: string;
  endAt: string;
}

export function selectedSlotMatches(
  selectedSlot: SelectedCalendarSlot | null,
  slot: SelectedCalendarSlot,
): boolean {
  return selectedSlot?.startAt === slot.startAt && selectedSlot.endAt === slot.endAt;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export const CalendarAvailabilityPanel: React.FC<CalendarAvailabilityPanelProps> = ({
  workspaceId,
  requestAvailability = requestCalendarAvailability,
  initialTimezone = DEFAULT_AVAILABILITY_TIMEZONE,
}) => {
  const [date, setDate] = useState(today);
  const [duration, setDuration] = useState<30 | 60>(30);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [result, setResult] = useState<CalendarAvailabilityResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<SelectedCalendarSlot | null>(null);

  const clearSelection = () => setSelectedSlot(null);

  const handleCheckAvailability = async () => {
    if (checking) return;
    setChecking(true);
    setError(null);
    setResult(null);
    clearSelection();
    try {
      const range = businessDateToUtcRange(date, timezone);
      const nextResult = await requestAvailability({ workspaceId, ...range, requestedDurationMinutes: duration, timezone });
      setTimezone(nextResult.timezone);
      setResult(nextResult);
      if (nextResult.code === 'outside_business_hours') {
        clearSelection();
      } else {
        setSelectedSlot((current) => current && nextResult.slots.some((slot) => selectedSlotMatches(current, slot)) ? current : null);
      }
    } catch (requestError) {
      clearSelection();
      setError(requestError instanceof Error ? requestError.message : 'Calendar availability could not be checked safely.');
    } finally {
      setChecking(false);
    }
  };

  return (
    <section aria-labelledby="calendar-availability-heading" className="rev-motion-in">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 id="calendar-availability-heading" className="text-xl font-bold text-neutral-900">CALENDAR AVAILABILITY</h2>
        <span className="badge-neutral">READ-ONLY</span>
      </div>
      <div className="card p-5">
        <p className="text-sm text-neutral-700">Checks the connected business calendar for available times. No event will be created.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
          <label className="grid gap-1 text-sm font-medium text-neutral-800" htmlFor="calendar-availability-date">
            Date
            <input id="calendar-availability-date" className="input-field" type="date" value={date} onChange={(event) => { setDate(event.target.value); clearSelection(); }} disabled={checking} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-neutral-800" htmlFor="calendar-availability-duration">
            Meeting duration
            <select id="calendar-availability-duration" className="input-field" value={duration} onChange={(event) => { setDuration(Number(event.target.value) as 30 | 60); clearSelection(); }} disabled={checking}>
              <option value={30}>30 minutes</option>
              <option value={60}>60 minutes</option>
            </select>
          </label>
          <button className="btn-primary text-sm" type="button" disabled={checking} onClick={handleCheckAvailability}>
            {checking ? 'CHECKING AVAILABILITY...' : 'CHECK AVAILABILITY'}
          </button>
        </div>
        <p className="mt-3 text-xs text-neutral-500">Workspace timezone: {timezone}</p>
        {error && <p className="mt-4 text-sm text-red-700" role="alert">{error}</p>}
        {checking && <p className="mt-4 text-sm text-neutral-600" role="status">Checking calendar availability...</p>}
        {result?.code === 'outside_business_hours' && <p className="mt-4 text-sm text-neutral-700" role="status">No business hours are configured for this date. Please choose a working day.</p>}
        {result?.status === 'unavailable' && result.code !== 'outside_business_hours' && <p className="mt-4 text-sm text-neutral-700" role="status">No availability can be confirmed for this request.</p>}
        {result?.status === 'available' && result.slots.length === 0 && <p className="mt-4 text-sm text-neutral-700" role="status">No available times were returned for this date.</p>}
        {selectedSlot && (
          <div className="mt-4 border border-primary-200 bg-primary-50 px-4 py-3 text-sm text-primary-900" role="status">
            <p className="font-semibold">SELECTED — NOT BOOKED</p>
            <p className="mt-1">{new Intl.DateTimeFormat('en-GB', { timeZone: timezone, weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(selectedSlot.startAt))}</p>
            <p>{formatAvailabilitySlot(selectedSlot.startAt, selectedSlot.endAt, timezone)} ({timezone})</p>
            <p className="mt-1">No calendar event or invitation has been created.</p>
            <button className="btn-ghost mt-3 text-sm" type="button" onClick={clearSelection}>CLEAR SELECTION</button>
          </div>
        )}
        {result?.slots.length ? (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Available times">
            {result.slots.map((slot) => {
              const selected = selectedSlotMatches(selectedSlot, slot);
              return <li key={`${slot.startAt}-${slot.endAt}`}><button className={selected ? 'w-full border border-primary-500 bg-primary-50 px-3 py-2 text-left text-sm font-medium text-primary-900' : 'w-full border border-neutral-200 bg-neutral-50 px-3 py-2 text-left text-sm font-medium text-neutral-800'} type="button" aria-pressed={selected} onClick={() => setSelectedSlot({ startAt: slot.startAt, endAt: slot.endAt })}>{formatAvailabilitySlot(slot.startAt, slot.endAt, result.timezone)}</button></li>;
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
};