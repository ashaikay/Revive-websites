function dateParts(date: Date, timezone: string): Record<string, number> {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).reduce<Record<string, number>>((parts, part) => {
    if (part.type !== 'literal') parts[part.type] = Number(part.value);
    return parts;
  }, {});
}

function timezoneOffsetAt(timestamp: number, timezone: string): number {
  const parts = dateParts(new Date(timestamp), timezone);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - timestamp;
}

function zonedMidnightToUtc(year: number, month: number, day: number, timezone: string): string {
  const localMidnight = Date.UTC(year, month - 1, day);
  let timestamp = localMidnight;
  for (let attempt = 0; attempt < 3; attempt += 1) timestamp = localMidnight - timezoneOffsetAt(timestamp, timezone);
  return new Date(timestamp).toISOString();
}

export function businessDateToUtcRange(date: string, timezone: string): { searchStartAt: string; searchEndAt: string } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new Error('A valid business date is required.');
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) {
    throw new Error('A valid business date is required.');
  }
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return {
    searchStartAt: zonedMidnightToUtc(year, month, day, timezone),
    searchEndAt: zonedMidnightToUtc(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timezone),
  };
}

export function formatAvailabilitySlot(startAt: string, endAt: string, timezone: string): string {
  const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  return `${formatter.format(new Date(startAt))} - ${formatter.format(new Date(endAt))}`;
}