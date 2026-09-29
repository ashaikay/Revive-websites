export interface CalendarSelectionDependencies {
  allowedOrigin?: string;
  getUserId(authorization: string): Promise<string | null>;
  canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
  select(input: { target_workspace_id: string; initiating_user_id: string; target_calendar_id: string }): Promise<{ calendar_id: string; connection_id: string; is_selected: boolean }>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function handleCalendarSelection(request: Request, deps: CalendarSelectionDependencies): Promise<Response> {
  if (!deps.allowedOrigin || request.headers.get('Origin') !== deps.allowedOrigin) return new Response(null, { status: 403 });
  const headers = { 'Access-Control-Allow-Origin': deps.allowedOrigin, Vary: 'Origin', 'Cache-Control': 'no-store', 'Content-Type': 'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info' } });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, { error: 'Authentication required.' });
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415, { error: 'JSON required.' });
  try {
    const raw = await request.text();
    if (raw.length > 1024) return reply(400, { error: 'Invalid request.' });
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'calendarId,workspaceId' || !uuid.test(body.workspaceId) || !uuid.test(body.calendarId)) return reply(400, { error: 'Invalid request.' });
    const userId = await deps.getUserId(authorization);
    if (!userId || !uuid.test(userId)) return reply(401, { error: 'Authentication required.' });
    if (!await deps.canManage(authorization, body.workspaceId, userId)) return reply(403, { error: 'Calendar connection unavailable.' });
    const row = await deps.select({ target_workspace_id: body.workspaceId, initiating_user_id: userId, target_calendar_id: body.calendarId });
    if (row.calendar_id !== body.calendarId || !uuid.test(row.connection_id) || row.is_selected !== true) throw new Error('Invalid connection result');
    return reply(200, { calendarId: row.calendar_id, connectionId: row.connection_id, selected: true });
  } catch { return reply(403, { error: 'Calendar connection unavailable.' }); }
}
