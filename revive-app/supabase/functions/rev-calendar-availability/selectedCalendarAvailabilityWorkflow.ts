import type { MicrosoftGraphAvailabilityRequest, BusyInterval } from '../_shared/microsoftGraphAvailability.ts';

/** Server-only rows. Never serialize credential fields to browser responses or logs. */
export interface SelectedCalendarCredential {
  calendar_id: string; connection_id: string; provider_calendar_reference: string;
  timezone: string; provider_account_reference: string; credential_reference: string;
  revision: number; refresh_token: string;
}
export interface SelectedAvailabilityQuery {
  workspaceId: string; userId: string; searchStartAt: string; searchEndAt: string; timezone: string;
}
export interface SelectedAvailabilityDependencies {
  load(workspaceId: string, userId: string): Promise<SelectedCalendarCredential>;
  refresh(refreshToken: string): Promise<{ accessToken: string; refreshToken: string }>;
  rotate(workspaceId: string, userId: string, snapshot: SelectedCalendarCredential, refreshToken: string): Promise<{ credential_reference: string; revision: number }>;
  read(request: MicrosoftGraphAvailabilityRequest): Promise<BusyInterval[]>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function unavailable(): never { throw new Error('Selected calendar availability unavailable.'); }
function utc(value: string): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
}
function validate(row: SelectedCalendarCredential, timezone: string): void {
  if (!row || !uuid.test(row.calendar_id) || !uuid.test(row.connection_id) || !uuid.test(row.credential_reference) ||
    typeof row.provider_calendar_reference !== 'string' || !row.provider_calendar_reference.trim() || row.provider_calendar_reference.length > 2048 ||
    typeof row.provider_account_reference !== 'string' || !row.provider_account_reference.includes('@') ||
    row.timezone !== timezone || !Number.isSafeInteger(row.revision) || row.revision < 1 ||
    typeof row.refresh_token !== 'string' || !row.refresh_token.trim() || row.refresh_token.length > 32768) unavailable();
}
function sameSelection(first: SelectedCalendarCredential, next: SelectedCalendarCredential, revision: number): boolean {
  return ['calendar_id','connection_id','provider_calendar_reference','timezone','provider_account_reference','credential_reference'].every(key => first[key as keyof SelectedCalendarCredential] === next[key as keyof SelectedCalendarCredential]) && next.revision === revision;
}
export async function runSelectedCalendarAvailability(query: SelectedAvailabilityQuery, deps: SelectedAvailabilityDependencies): Promise<BusyInterval[]> {
  if (!uuid.test(query.workspaceId) || !uuid.test(query.userId) || !utc(query.searchStartAt) || !utc(query.searchEndAt) ||
    Date.parse(query.searchEndAt) <= Date.parse(query.searchStartAt) || Date.parse(query.searchEndAt)-Date.parse(query.searchStartAt) > 7*86400000) unavailable();
  try { Intl.DateTimeFormat('en-GB', {timeZone: query.timezone}); } catch { unavailable(); }
  if (!query.timezone?.trim()) unavailable();
  const first = await deps.load(query.workspaceId, query.userId);
  validate(first, query.timezone);
  const token = await deps.refresh(first.refresh_token);
  if (typeof token?.accessToken !== 'string' || !token.accessToken.trim() || /[\r\n]/.test(token.accessToken) ||
    typeof token.refreshToken !== 'string' || !token.refreshToken.trim() || token.refreshToken.length > 32768) unavailable();
  const rotated = await deps.rotate(query.workspaceId, query.userId, first, token.refreshToken);
  if (rotated?.credential_reference !== first.credential_reference || rotated.revision !== first.revision+1) unavailable();
  const beforeRead = await deps.load(query.workspaceId, query.userId);
  validate(beforeRead, query.timezone);
  if (!sameSelection(first, beforeRead, rotated.revision)) unavailable();
  const busy = await deps.read({accessToken: token.accessToken, workspaceId: query.workspaceId, selectedCalendarId: first.calendar_id,
    selectedCalendar: {id:first.calendar_id,workspaceId:query.workspaceId,connectionId:first.connection_id,provider:'microsoft_graph',providerCalendarReference:first.provider_calendar_reference,timezone:first.timezone},
    mailboxUserPrincipalName:first.provider_account_reference,searchStartAt:query.searchStartAt,searchEndAt:query.searchEndAt,timezone:first.timezone});
  const afterRead = await deps.load(query.workspaceId, query.userId);
  validate(afterRead, query.timezone);
  if (!sameSelection(first, afterRead, rotated.revision)) unavailable();
  if (!Array.isArray(busy) || busy.some(interval => !interval || !utc(interval.startAt) || !utc(interval.endAt) || Date.parse(interval.endAt) <= Date.parse(interval.startAt))) unavailable();
  return busy.map(({startAt,endAt}) => ({startAt,endAt}));
}
