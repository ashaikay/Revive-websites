import {resolveAnnualLeaveOrigin} from '../_shared/annualLeaveOrigins.ts';

export const bankHolidaySource = 'https://www.gov.uk/bank-holidays.json';
export const ukRegions = ['england-and-wales', 'scotland', 'northern-ireland'] as const;
export type UKRegion = typeof ukRegions[number];
export interface OfficialHoliday {date: string; title: string;}
export class ImportRefusal extends Error {
 readonly code: string;
 constructor(code: string) {super('Official holiday import refused'); this.code = code;}
}
export const importRefusals: Record<string, string> = {
 'Official holiday preview changed': 'stale_import',
 'Official holiday conflicts': 'import_conflict',
 'Official holiday request unavailable': 'request_conflict',
 'Annual leave calendar unavailable': 'missing_calendar',
 'Annual leave calendar already exists': 'calendar_exists',
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
export function validateOfficialHolidays(value: unknown, region: UKRegion, year: number): OfficialHoliday[] {
 if (!object(value) || !object(value[region])) throw Error('Malformed official holiday response');
 const division = value[region];
 if (division.division !== region || !Array.isArray(division.events) || division.events.length > 2000) throw Error('Malformed official holiday response');
 const dates = new Set<string>();
 const result: OfficialHoliday[] = [];
 for (const event of division.events) {
  if (!object(event) || typeof event.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(event.date) ||
   !Number.isFinite(Date.parse(event.date + 'T00:00:00Z')) ||
   new Date(event.date + 'T00:00:00Z').toISOString().slice(0, 10) !== event.date ||
   typeof event.title !== 'string' || event.title !== event.title.trim() || event.title.length < 1 || event.title.length > 120 ||
   typeof event.notes !== 'string' || typeof event.bunting !== 'boolean' || dates.has(event.date)) throw Error('Malformed official holiday response');
  dates.add(event.date);
  if (Number(event.date.slice(0, 4)) === year) result.push({date: event.date, title: event.title});
 }
 if (!result.length) throw Error('Official holiday year unavailable');
 return result.sort((a, b) => a.date.localeCompare(b.date));
}
export interface ImportDependencies {
 allowedOrigin?: string;
 getUserId(authorization: string): Promise<string | null>;
 canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
 fetchOfficial(): Promise<unknown>;
 now(): string;
 execute(input: Record<string, unknown>): Promise<unknown>;
}
export async function fetchOfficialHolidays(): Promise<unknown> {
 const response = await fetch(bankHolidaySource, {redirect: 'error', signal: AbortSignal.timeout(10000), headers: {Accept: 'application/json'}});
 if (!response.ok || !response.headers.get('Content-Type')?.toLowerCase().includes('application/json') || !response.body) throw Error('Official holiday source unavailable');
 const reader = response.body.getReader();
 const chunks: Uint8Array[] = [];
 let size = 0;
 try {
  for (;;) {
   const {done, value} = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > 1024 * 1024) throw Error('Official holiday response too large');
   chunks.push(value);
  }
 } finally {await reader.cancel();}
 const bytes = new Uint8Array(size);
 let offset = 0;
 for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
 return JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
}
export async function handleBankHolidayImport(request: Request, deps: ImportDependencies): Promise<Response> {
 const origin = resolveAnnualLeaveOrigin(request.headers.get('Origin'), deps.allowedOrigin);
 if (!origin) return new Response(null, {status: 403});
 const headers = {'Access-Control-Allow-Origin': origin, Vary: 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json'};
 const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), {status, headers});
 if (request.method === 'OPTIONS') return new Response(null, {status: 204, headers: {...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info'}});
 if (request.method !== 'POST') return reply(405, {error: 'Method not allowed.'});
 const authorization = request.headers.get('Authorization') ?? '';
 if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, {error: 'Authentication required.'});
 if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415, {error: 'JSON required.'});
 let body: unknown;
 try {const raw = await request.text(); if (raw.length > 4096) throw Error('Too large'); body = JSON.parse(raw);}
 catch {return reply(400, {error: 'Invalid holiday import request.'});}
 if (!object(body) || !id(body.workspaceId) || !id(body.workerId)) return reply(400, {error: 'Invalid holiday import request.'});
 const preview = body.action === 'preview';
 if (preview ? Object.keys(body).sort().join(',') !== 'action,calendarId,calendarYear,region,workerId,workspaceId' ||
  !(body.calendarId === null || id(body.calendarId)) || !ukRegions.includes(body.region as UKRegion) ||
  !Number.isSafeInteger(body.calendarYear) || Number(body.calendarYear) < 1000 || Number(body.calendarYear) > 9999
  : body.action !== 'confirm' || Object.keys(body).sort().join(',') !== 'action,previewId,requestId,workerId,workspaceId' || !id(body.previewId) || !id(body.requestId)) return reply(400, {error: 'Invalid holiday import request.'});
 try {
  const userId = await deps.getUserId(authorization);
  if (!id(userId)) return reply(401, {error: 'Authentication required.'});
  if (!await deps.canManage(authorization, body.workspaceId, userId)) return reply(403, {error: 'Only an active owner or admin can import holidays.'});
  let events: OfficialHoliday[] | null = null;
  let fetchedAt: string | null = null;
  if (preview) {
   try {events = validateOfficialHolidays(await deps.fetchOfficial(), body.region as UKRegion, Number(body.calendarYear)); fetchedAt = deps.now();}
   catch {return reply(503, {error: 'Official dates could not be loaded or this year is unavailable. Nothing was changed or confirmed. Try another year or try again later.'});}
  }
  const result = await deps.execute({
   target_action: body.action, target_workspace_id: body.workspaceId, initiating_user_id: userId,
   target_worker_id: body.workerId, target_calendar_id: preview ? body.calendarId : null,
   target_region: preview ? body.region : null, target_year: preview ? body.calendarYear : null,
   target_events: events, target_fetched_at: fetchedAt,
   target_preview_id: preview ? null : body.previewId, target_request_id: preview ? null : body.requestId,
  });
  if (!object(result) || result.workspaceId !== body.workspaceId || result.workerId !== body.workerId ||
   result.action !== body.action || !id(result.previewId) || result.source !== bankHolidaySource ||
   typeof result.fetchedAt !== 'string' || !Number.isFinite(Date.parse(result.fetchedAt))) throw Error('Invalid import result');
  if (preview) {
   if (result.region !== body.region || result.calendarYear !== body.calendarYear || !Array.isArray(result.holidays) ||
    JSON.stringify(result.holidays) !== JSON.stringify(events) || !Array.isArray(result.conflicts) ||
    result.conflicts.some(item => typeof item !== 'string') || !Array.isArray(result.preserved) || result.preserved.some(item => typeof item !== 'string') ||
    !Number.isSafeInteger(result.additions) || Number(result.additions) < 0 || !Number.isSafeInteger(result.existing) || Number(result.existing) < 0) throw Error('Invalid import preview');
  } else if (result.previewId !== body.previewId || result.requestId !== body.requestId || !id(result.calendarId) ||
   !Number.isSafeInteger(result.revision) || result.revision !== result.confirmedRevision) throw Error('Invalid import confirmation');
  return reply(200, result);
 } catch (error) {
  if (error instanceof ImportRefusal && Object.values(importRefusals).includes(error.code)) return reply(409, {status: 'refused', code: error.code, requestId: body.requestId ?? null});
  return reply(503, {error: preview ? 'Official dates could not be reviewed. Nothing was changed or confirmed.' : 'Import outcome could not be confirmed. Retry the same change.', code: 'outcome_unknown'});
 }
}
