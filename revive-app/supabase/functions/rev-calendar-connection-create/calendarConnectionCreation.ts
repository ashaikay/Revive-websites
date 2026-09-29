export interface CalendarConnectionCreationDependencies {
  allowedOrigin?: string;
  getUserId(authorization: string): Promise<string | null>;
  canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
  create(input: { target_workspace_id: string; initiating_user_id: string; target_request_id: string }): Promise<{ connection_id: string; connection_status: string }>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export async function handleCalendarConnectionCreation(request: Request, deps: CalendarConnectionCreationDependencies): Promise<Response> {
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
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'requestId,workspaceId' || !uuid.test(body.workspaceId) || !uuid.test(body.requestId)) return reply(400, { error: 'Invalid request.' });
    const userId = await deps.getUserId(authorization);
    if (!userId || !uuid.test(userId)) return reply(401, { error: 'Authentication required.' });
    if (!await deps.canManage(authorization, body.workspaceId, userId)) return reply(403, { error: 'Calendar connection unavailable.' });
    const row = await deps.create({ target_workspace_id: body.workspaceId, initiating_user_id: userId, target_request_id: body.requestId });
    if (row.connection_id !== body.requestId || !['disconnected','connected','expired','revoked','error'].includes(row.connection_status)) throw new Error('Invalid connection result');
    return reply(200, { connectionId: row.connection_id, connectionStatus: row.connection_status });
  } catch { return reply(403, { error: 'Calendar connection unavailable.' }); }
}
