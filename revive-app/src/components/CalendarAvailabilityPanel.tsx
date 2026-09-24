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

  const handleCheckAvailability = async () => {
    if (checking) return;
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const range = businessDateToUtcRange(date, timezone);
      const nextResult = await requestAvailability({ workspaceId, ...range, requestedDurationMinutes: duration, timezone });
      setTimezone(nextResult.timezone);
      setResult(nextResult);
    } catch (requestError) {
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
            <input id="calendar-availability-date" className="input-field" type="date" value={date} onChange={(event) => setDate(event.target.value)} disabled={checking} />
          </label>
          <label className="grid gap-1 text-sm font-medium text-neutral-800" htmlFor="calendar-availability-duration">
            Meeting duration
            <select id="calendar-availability-duration" className="input-field" value={duration} onChange={(event) => setDuration(Number(event.target.value) as 30 | 60)} disabled={checking}>
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
        {result?.status === 'unavailable' && <p className="mt-4 text-sm text-neutral-700" role="status">No availability can be confirmed for this request.</p>}
        {result?.status === 'available' && result.slots.length === 0 && <p className="mt-4 text-sm text-neutral-700" role="status">No available times were returned for this date.</p>}
        {result?.slots.length ? (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label="Available times">
            {result.slots.map((slot) => <li key={`${slot.startAt}-${slot.endAt}`} className="border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm font-medium text-neutral-800">{formatAvailabilitySlot(slot.startAt, slot.endAt, result.timezone)}</li>)}
          </ul>
        ) : null}
      </div>
    </section>
  );
};