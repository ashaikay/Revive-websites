import { supabaseClient } from '@/data/supabaseClient';

export const DEFAULT_AVAILABILITY_TIMEZONE = 'Europe/London';

export interface CalendarAvailabilitySlot {
  startAt: string;
  endAt: string;
}

export interface CalendarAvailabilityResult {
  status: 'available' | 'unavailable';
  slots: CalendarAvailabilitySlot[];
  timezone: string;
}

export interface CalendarAvailabilityRequest {
  workspaceId: string;
  searchStartAt: string;
  searchEndAt: string;
  requestedDurationMinutes: 30 | 60;
  timezone: string;
}

export class CalendarAvailabilityClientError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'CalendarAvailabilityClientError';
  }
}

type InvokeResult = { data: unknown; error: unknown };
export type CalendarAvailabilityInvoker = (body: CalendarAvailabilityRequest) => Promise<InvokeResult>;

function responseStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const candidate = error as { status?: unknown; context?: { status?: unknown } };
  const status = candidate.status ?? candidate.context?.status;
  return typeof status === 'number' ? status : undefined;
}

function safeErrorMessage(status: number | undefined): string {
  switch (status) {
    case 401: return 'Sign in is required to check calendar availability.';
    case 403: return 'You do not have access to this workspace calendar.';
    case 429: return 'Calendar availability is temporarily rate limited. Try again later.';
    case 502: return 'Calendar provider authentication or availability is unavailable.';
    case 503: return 'Calendar availability is currently disabled or unavailable. No event will be created.';
    default: return 'Calendar availability could not be checked safely.';
  }
}

function validUtcInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim()) return false;
  try {
    Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function parseResult(data: unknown): CalendarAvailabilityResult {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new CalendarAvailabilityClientError('Calendar availability returned an invalid response.');
  }
  const value = data as Record<string, unknown>;
  if ((value.status !== 'available' && value.status !== 'unavailable') || !validTimezone(value.timezone) || !Array.isArray(value.slots)) {
    throw new CalendarAvailabilityClientError('Calendar availability returned an invalid response.');
  }
  const slots = value.slots.map((slot): CalendarAvailabilitySlot => {
    if (!slot || typeof slot !== 'object') throw new CalendarAvailabilityClientError('Calendar availability returned an invalid response.');
    const item = slot as Record<string, unknown>;
    if (!validUtcInstant(item.startAt) || !validUtcInstant(item.endAt)
      || Date.parse(item.startAt) >= Date.parse(item.endAt)) {
      throw new CalendarAvailabilityClientError('Calendar availability returned an invalid response.');
    }
    return { startAt: item.startAt, endAt: item.endAt };
  });
  return { status: value.status, slots, timezone: value.timezone };
}

async function invokeCalendarAvailability(body: CalendarAvailabilityRequest): Promise<InvokeResult> {
  if (!supabaseClient) throw new CalendarAvailabilityClientError('Calendar availability is not configured.');
  return supabaseClient.functions.invoke('rev-calendar-availability', { body });
}

export async function requestCalendarAvailability(
  request: CalendarAvailabilityRequest,
  invoke: CalendarAvailabilityInvoker = invokeCalendarAvailability,
): Promise<CalendarAvailabilityResult> {
  if (!request.workspaceId || !validUtcInstant(request.searchStartAt) || !validUtcInstant(request.searchEndAt)
    || Date.parse(request.searchStartAt) >= Date.parse(request.searchEndAt)
    || Date.parse(request.searchEndAt) - Date.parse(request.searchStartAt) > 7 * 24 * 60 * 60 * 1000
    || (request.requestedDurationMinutes !== 30 && request.requestedDurationMinutes !== 60) || !validTimezone(request.timezone)) {
    throw new CalendarAvailabilityClientError('Calendar availability request is invalid.');
  }
  const body: CalendarAvailabilityRequest = {
    workspaceId: request.workspaceId,
    searchStartAt: request.searchStartAt,
    searchEndAt: request.searchEndAt,
    requestedDurationMinutes: request.requestedDurationMinutes,
    timezone: request.timezone,
  };
  const { data, error } = await invoke(body);
  if (error) throw new CalendarAvailabilityClientError(safeErrorMessage(responseStatus(error)), responseStatus(error));
  return parseResult(data);
}