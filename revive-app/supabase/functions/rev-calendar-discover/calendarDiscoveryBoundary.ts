export interface CalendarDiscoveryDependencies {
  allowedOrigin?: string;
  getUserId(authorization: string): Promise<string | null>;
  canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
  discover(workspaceId: string, connectionId: string, userId: string, timezone: string): Promise<{ connectionId: string; connectionStatus: 'connected'; calendarCount: number }>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function handleCalendarDiscovery(request: Request, deps: CalendarDiscoveryDependencies): Promise<Response> {
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
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'connectionId,timezone,workspaceId' || !uuid.test(body.workspaceId) || !uuid.test(body.connectionId)) return reply(400, { error: 'Invalid request.' });
    const userId = await deps.getUserId(authorization);
    if (!userId || !uuid.test(userId)) return reply(401, { error: 'Authentication required.' });
    if (!await deps.canManage(authorization, body.workspaceId, userId)) return reply(403, { error: 'Calendar connection unavailable.' });
    if (typeof body.timezone !== 'string' || !body.timezone.trim()) return reply(400, { error: 'Timezone required.' });
    new Intl.DateTimeFormat('en-GB',{timeZone:body.timezone});
    const result = await deps.discover(body.workspaceId,body.connectionId,userId,body.timezone);
    if (result.connectionId !== body.connectionId || result.connectionStatus !== 'connected' || !Number.isSafeInteger(result.calendarCount) || result.calendarCount < 1 || result.calendarCount > 1000) throw new Error('Invalid discovery result');
    return reply(200,result);
  } catch { return reply(403, { error: 'Calendar connection unavailable.' }); }
}
