import type { AvailabilityWindow } from '../../../src/services/calendarAvailabilityService.ts';

export interface BusinessHoursConfiguration {
  workingDays: string | undefined;
  businessStartLocal: string | undefined;
  businessEndLocal: string | undefined;
  timezone: string;
}

type LocalDate = { year: number; month: number; day: number };

function validTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat('en-GB', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function parseWorkingDays(value: string | undefined): Set<number> | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const parts = normalized.split(',');
  const days = new Set<number>();
  for (const part of parts) {
    if (!/^[1-7]$/.test(part)) return null;
    const day = Number(part);
    if (days.has(day)) return null;
    days.add(day);
  }
  return days.size > 0 ? days : null;
}

function parseTime(value: string | undefined): number | null {
  if (!value || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function localParts(timestamp: number, timezone: string): LocalDate {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp)).reduce<Record<string, number>>((result, part) => {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
    return result;
  }, {});
  return { year: parts.year, month: parts.month, day: parts.day };
}

function timezoneOffsetAt(timestamp: number, timezone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp)).reduce<Record<string, number>>((result, part) => {
    if (part.type !== 'literal') result[part.type] = Number(part.value);
    return result;
  }, {});
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - timestamp;
}

function localDateTimeToUtc(date: LocalDate, minutes: number, timezone: string): string {
  const localTimestamp = Date.UTC(date.year, date.month - 1, date.day, Math.floor(minutes / 60), minutes % 60);
  let timestamp = localTimestamp;
  for (let attempt = 0; attempt < 3; attempt += 1) timestamp = localTimestamp - timezoneOffsetAt(timestamp, timezone);
  return new Date(timestamp).toISOString();
}

function isoWeekday(date: LocalDate): number {
  const day = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return day === 0 ? 7 : day;
}

function nextDate(date: LocalDate): LocalDate {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function sameDate(left: LocalDate, right: LocalDate): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

export function buildBusinessHoursAvailabilityWindows(
  configuration: BusinessHoursConfiguration,
  searchStartAt: string,
  searchEndAt: string,
): AvailabilityWindow[] {
  const searchStart = Date.parse(searchStartAt);
  const searchEnd = Date.parse(searchEndAt);
  const workingDays = parseWorkingDays(configuration.workingDays);
  const startMinutes = parseTime(configuration.businessStartLocal);
  const endMinutes = parseTime(configuration.businessEndLocal);
  if (!Number.isFinite(searchStart) || !Number.isFinite(searchEnd) || searchStart >= searchEnd
    || !workingDays || startMinutes === null || endMinutes === null || startMinutes >= endMinutes
    || !validTimezone(configuration.timezone)) {
    throw new Error('Trusted business-hours configuration is invalid.');
  }

  const endLocalDate = localParts(searchEnd - 1, configuration.timezone);
  const windows: AvailabilityWindow[] = [];
  for (let date = localParts(searchStart, configuration.timezone); ; date = nextDate(date)) {
    if (workingDays.has(isoWeekday(date))) {
      const localStartAt = localDateTimeToUtc(date, startMinutes, configuration.timezone);
      const localEndAt = localDateTimeToUtc(date, endMinutes, configuration.timezone);
      const windowStart = Math.max(Date.parse(localStartAt), searchStart);
      const windowEnd = Math.min(Date.parse(localEndAt), searchEnd);
      if (Date.parse(localStartAt) >= Date.parse(localEndAt)) throw new Error('Trusted business-hours configuration is invalid.');
      if (windowStart < windowEnd) {
        windows.push({ startAt: new Date(windowStart).toISOString(), endAt: new Date(windowEnd).toISOString() });
      }
    }
    if (sameDate(date, endLocalDate)) break;
  }
  return windows;
}