export type CalendarProvider = 'microsoft_graph' | 'google_calendar';

export interface SelectedCalendar {
  id: string;
  workspaceId: string;
  connectionId: string;
  provider: CalendarProvider;
  providerCalendarReference: string;
  timezone: string;
}

export interface AvailabilityWindow {
  startAt: string;
  endAt: string;
}

export interface BusyInterval {
  startAt: string;
  endAt: string;
}

export interface AvailabilityPolicy {
  minimumNoticeMinutes: number;
  beforeBufferMinutes: number;
  afterBufferMinutes: number;
  availabilityWindows: AvailabilityWindow[];
}

export interface AvailableSlot {
  workspaceId: string;
  selectedCalendarId: string;
  startAt: string;
  endAt: string;
}

export interface AvailabilityRequest {
  workspaceId: string;
  selectedCalendarId: string;
  selectedCalendar: SelectedCalendar;
  timezone: string;
  requestedDurationMinutes: number;
  searchStartAt: string;
  searchEndAt: string;
  now: string;
  policy: AvailabilityPolicy;
  busyIntervals: BusyInterval[];
}

export interface AvailabilityResult {
  status: 'available' | 'unavailable';
  slots: AvailableSlot[];
  reason?: string;
}

export const CALENDAR_CAPABILITIES = {
  READ_CALENDAR_AVAILABILITY: false,
  CREATE_CALENDAR_EVENT: false,
} as const;

interface MillisecondInterval {
  start: number;
  end: number;
}

function unavailable(reason: string): AvailabilityResult {
  return { status: 'unavailable', slots: [], reason };
}

function parseUtcInstant(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}

function isTimezone(value: string): boolean {
  try {
    Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validNonNegativeMinutes(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}

function mergeIntervals(intervals: MillisecondInterval[]): MillisecondInterval[] {
  const ordered = [...intervals].sort((left, right) => left.start - right.start || left.end - right.end);
  return ordered.reduce<MillisecondInterval[]>((merged, interval) => {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      merged.push({ ...interval });
    }
    return merged;
  }, []);
}

function subtractBusy(window: MillisecondInterval, busyIntervals: MillisecondInterval[]): MillisecondInterval[] {
  const free: MillisecondInterval[] = [];
  let cursor = window.start;
  for (const busy of busyIntervals) {
    if (busy.end <= cursor) continue;
    if (busy.start >= window.end) break;
    if (busy.start > cursor) free.push({ start: cursor, end: Math.min(busy.start, window.end) });
    cursor = Math.max(cursor, busy.end);
    if (cursor >= window.end) break;
  }
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
}

export function calculateAvailability(request: AvailabilityRequest): AvailabilityResult {
  const calendar = request.selectedCalendar;
  if (!request.workspaceId || calendar.workspaceId !== request.workspaceId) {
    return unavailable('Selected calendar is outside the requested workspace.');
  }
  if (!request.selectedCalendarId || calendar.id !== request.selectedCalendarId || !calendar.connectionId) {
    return unavailable('Selected calendar identity is invalid.');
  }
  if (!request.timezone || request.timezone !== calendar.timezone || !isTimezone(request.timezone)) {
    return unavailable('A valid selected-calendar timezone is required.');
  }
  if (!Number.isInteger(request.requestedDurationMinutes) || request.requestedDurationMinutes <= 0) {
    return unavailable('Requested duration must be a positive whole number of minutes.');
  }
  if (!validNonNegativeMinutes(request.policy.minimumNoticeMinutes)
    || !validNonNegativeMinutes(request.policy.beforeBufferMinutes)
    || !validNonNegativeMinutes(request.policy.afterBufferMinutes)) {
    return unavailable('Availability policy minutes must be non-negative whole numbers.');
  }

  const searchStart = parseUtcInstant(request.searchStartAt);
  const searchEnd = parseUtcInstant(request.searchEndAt);
  const now = parseUtcInstant(request.now);
  if (searchStart === null || searchEnd === null || now === null || searchStart >= searchEnd) {
    return unavailable('Search range and current time must be valid ordered UTC instants.');
  }

  const availabilityWindows: MillisecondInterval[] = [];
  for (const window of request.policy.availabilityWindows) {
    const start = parseUtcInstant(window.startAt);
    const end = parseUtcInstant(window.endAt);
    if (start === null || end === null || start >= end) {
      return unavailable('Availability windows must be valid ordered UTC instants.');
    }
    availabilityWindows.push({ start: Math.max(start, searchStart), end: Math.min(end, searchEnd) });
  }
  if (availabilityWindows.length === 0) return unavailable('At least one availability window is required.');

  const bufferBeforeMs = request.policy.beforeBufferMinutes * 60_000;
  const bufferAfterMs = request.policy.afterBufferMinutes * 60_000;
  const busyIntervals: MillisecondInterval[] = [];
  for (const interval of request.busyIntervals) {
    const start = parseUtcInstant(interval.startAt);
    const end = parseUtcInstant(interval.endAt);
    if (start === null || end === null || start >= end) {
      return unavailable('Busy intervals must be valid ordered UTC instants.');
    }
    busyIntervals.push({ start: start - bufferBeforeMs, end: end + bufferAfterMs });
  }

  const minimumStart = Math.max(searchStart, now + request.policy.minimumNoticeMinutes * 60_000);
  const durationMs = request.requestedDurationMinutes * 60_000;
  const mergedBusy = mergeIntervals(busyIntervals);
  const slots: AvailableSlot[] = [];

  for (const window of mergeIntervals(availabilityWindows)) {
    if (window.end <= minimumStart) continue;
    for (const free of subtractBusy({ start: Math.max(window.start, minimumStart), end: window.end }, mergedBusy)) {
      for (let start = free.start; start + durationMs <= free.end; start += durationMs) {
        slots.push({
          workspaceId: request.workspaceId,
          selectedCalendarId: request.selectedCalendarId,
          startAt: new Date(start).toISOString(),
          endAt: new Date(start + durationMs).toISOString(),
        });
      }
    }
  }

  return { status: 'available', slots };
}