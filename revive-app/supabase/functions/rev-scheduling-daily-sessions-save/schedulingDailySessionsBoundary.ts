export interface DailySessionsInput {
  target_workspace_id: string;
  initiating_user_id: string;
  target_request_id: string;
  target_title: string;
  target_timezone: string;
  target_location: string;
  target_required_skills: string[];
  target_staffing_count: number;
  target_first_day: string;
  target_last_day: string;
  target_working_days: number[];
  target_start_local: string;
  target_end_local: string;
}

export interface DailySessionsDependencies {
  allowedOrigin?: string;
  getUserId(authorization: string): Promise<string | null>;
  canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
  save(input: DailySessionsInput): Promise<unknown>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const clock = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const requestKeys = 'endLocal,firstDay,lastDay,location,requestId,requiredSkills,staffingCount,startLocal,timezone,title,workingDays,workspaceId';
const resultKeys = 'jobs,request_id,schedule_type,workspace_id';
const jobKeys = 'end_at,job_id,location,required_skills,staffing_count,start_at,status,timezone,title,version,workspace_id';

function id(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid daily sessions.');
  return value as Record<string, unknown>;
}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1000-01-01') return false;
  const parsed = Date.parse(`${value}T12:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function validTimezone(value: unknown): value is string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > 100) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function validTags(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= 30
    && value.every(tag => typeof tag === 'string' && tag.length > 0 && tag.length <= 80 && tag === tag.trim())
    && new Set(value).size === value.length;
}

interface ExpectedSession {
  date: string;
  startAt: string;
  endAt: string;
}

function localValue(timestamp: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(item => item.type === type)?.value;
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

function uniqueLocalInstant(local: string, timezone: string): string {
  const base = Date.parse(`${local}:00.000Z`);
  if (!Number.isFinite(base) || new Date(base).toISOString().slice(0, 16) !== local) throw new Error('Invalid local time.');
  const offsets = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const probe = base + hours * 3600000;
    const parsed = Date.parse(`${localValue(probe, timezone)}:00.000Z`);
    if (Number.isFinite(parsed)) offsets.add(parsed - probe);
  }
  const matches = [...offsets].map(offset => base - offset).filter(timestamp => localValue(timestamp, timezone) === local);
  if (matches.length !== 1) throw new Error('Ambiguous or nonexistent local time.');
  return new Date(matches[0]).toISOString();
}

function selectedSessions(firstDay: string, lastDay: string, workingDays: number[], startLocal: string, endLocal: string, timezone: string): ExpectedSession[] {
  const sessions: ExpectedSession[] = [];
  const first = Date.parse(`${firstDay}T12:00:00.000Z`);
  for (let offset = 0; offset <= 30; offset += 1) {
    const day = new Date(first + offset * 86400000).toISOString().slice(0, 10);
    if (day > lastDay) break;
    const isoDay = new Date(`${day}T12:00:00.000Z`).getUTCDay() || 7;
    if (workingDays.includes(isoDay)) {
      const startAt = uniqueLocalInstant(`${day}T${startLocal}`, timezone);
      const endAt = uniqueLocalInstant(`${day}T${endLocal}`, timezone);
      if (startAt >= endAt) throw new Error('Invalid local interval.');
      sessions.push({ date: day, startAt, endAt });
    }
    if (day === lastDay) break;
  }
  return sessions;
}

function instant(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

export async function handleSchedulingDailySessionsSave(
  request: Request,
  dependencies: DailySessionsDependencies,
): Promise<Response> {
  if (!dependencies.allowedOrigin || request.headers.get('Origin') !== dependencies.allowedOrigin) return new Response(null, { status: 403 });
  const headers = {
    'Access-Control-Allow-Origin': dependencies.allowedOrigin,
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info' } });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, { error: 'Authentication required.' });
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415, { error: 'JSON required.' });

  try {
    const raw = await request.text();
    if (raw.length > 8192) return reply(400, { error: 'Invalid daily schedule.' });
    const body = object(JSON.parse(raw));
    if (Object.keys(body).sort().join(',') !== requestKeys
      || !id(body.workspaceId) || !id(body.requestId)
      || typeof body.title !== 'string' || body.title !== body.title.trim() || body.title.length < 1 || body.title.length > 160
      || typeof body.location !== 'string' || body.location !== body.location.trim() || body.location.length < 1 || body.location.length > 300
      || !validTimezone(body.timezone) || !validTags(body.requiredSkills)
      || !Number.isInteger(body.staffingCount) || (body.staffingCount as number) < 1 || (body.staffingCount as number) > 100
      || !validDate(body.firstDay) || !validDate(body.lastDay) || body.lastDay < body.firstDay
      || (Date.parse(`${body.lastDay}T12:00:00.000Z`) - Date.parse(`${body.firstDay}T12:00:00.000Z`)) / 86400000 > 30
      || !Array.isArray(body.workingDays) || body.workingDays.length < 1 || body.workingDays.length > 7
      || body.workingDays.some(day => !Number.isInteger(day) || (day as number) < 1 || (day as number) > 7)
      || new Set(body.workingDays).size !== body.workingDays.length
      || typeof body.startLocal !== 'string' || typeof body.endLocal !== 'string'
      || !clock.test(body.startLocal) || !clock.test(body.endLocal) || body.startLocal >= body.endLocal) {
      return reply(400, { error: 'Invalid daily schedule.' });
    }
    let expected: ExpectedSession[];
    try {
      expected = selectedSessions(body.firstDay, body.lastDay, body.workingDays as number[], body.startLocal, body.endLocal, body.timezone);
    } catch {
      return reply(400, { error: 'Selected hours are ambiguous or nonexistent in this timezone. Choose different daytime hours.' });
    }
    if (expected.length === 0) return reply(400, { error: 'Choose at least one scheduled day.' });
    const userId = await dependencies.getUserId(authorization);
    if (!id(userId)) return reply(401, { error: 'Authentication required.' });
    if (!await dependencies.canManage(authorization, body.workspaceId, userId)) return reply(403, { error: 'Daily sessions could not be saved.' });
    const skills = [...(body.requiredSkills as string[])].sort();
    const workingDays = [...(body.workingDays as number[])].sort((left, right) => left - right);
    const value = object(await dependencies.save({
      target_workspace_id: body.workspaceId,
      initiating_user_id: userId,
      target_request_id: body.requestId,
      target_title: body.title,
      target_timezone: body.timezone,
      target_location: body.location,
      target_required_skills: skills,
      target_staffing_count: body.staffingCount as number,
      target_first_day: body.firstDay,
      target_last_day: body.lastDay,
      target_working_days: workingDays,
      target_start_local: body.startLocal,
      target_end_local: body.endLocal,
    }));
    if (Object.keys(value).sort().join(',') !== resultKeys || value.request_id !== body.requestId
      || value.workspace_id !== body.workspaceId || value.schedule_type !== 'daily_daytime'
      || !Array.isArray(value.jobs) || value.jobs.length !== expected.length) throw new Error('Invalid result.');
    const jobIds = new Set<string>();
    const jobs = value.jobs.map((candidate, index) => {
      const row = object(candidate);
      const startAt = instant(row.start_at);
      const endAt = instant(row.end_at);
      if (Object.keys(row).sort().join(',') !== jobKeys || !id(row.job_id) || jobIds.has(row.job_id)
        || row.workspace_id !== body.workspaceId || row.title !== body.title || row.timezone !== body.timezone
        || row.location !== body.location || JSON.stringify(row.required_skills) !== JSON.stringify(skills)
        || row.staffing_count !== body.staffingCount || row.status !== 'open' || row.version !== 1
        || !startAt || !endAt || startAt >= endAt) throw new Error('Invalid result.');
      if (startAt !== expected[index].startAt || endAt !== expected[index].endAt) throw new Error('Invalid result.');
      jobIds.add(row.job_id);
      return {
        jobId: row.job_id,
        workspaceId: row.workspace_id,
        title: row.title,
        startAt,
        endAt,
        timezone: row.timezone,
        location: row.location,
        requiredSkills: row.required_skills,
        staffingCount: row.staffing_count,
        status: row.status,
        version: row.version,
      };
    });
    return reply(200, { requestId: body.requestId, workspaceId: body.workspaceId, scheduleType: 'daily_daytime', jobs });
  } catch {
    return reply(403, { error: 'Daily sessions could not be saved.' });
  }
}
