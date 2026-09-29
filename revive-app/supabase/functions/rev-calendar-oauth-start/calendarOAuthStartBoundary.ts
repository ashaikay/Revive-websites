export interface CalendarOAuthStartDependencies {
  allowedOrigin?: string;
  clientId?: string;
  authority?: string;
  redirectUri?: string;
  getUserId(authorization: string): Promise<string | null>;
  canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
  hasConnection(authorization: string, workspaceId: string, connectionId: string): Promise<boolean>;
  begin(input: { target_workspace_id: string; target_connection_id: string; initiating_user_id: string; raw_state: string; pkce_verifier: string }): Promise<string>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function handleCalendarOAuthStart(request: Request, deps: CalendarOAuthStartDependencies): Promise<Response> {
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
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'connectionId,workspaceId' || !uuid.test(body.workspaceId) || !uuid.test(body.connectionId)) return reply(400, { error: 'Invalid request.' });
    const userId = await deps.getUserId(authorization);
    if (!userId || !uuid.test(userId)) return reply(401, { error: 'Authentication required.' });
    if (!await deps.canManage(authorization, body.workspaceId, userId) || !await deps.hasConnection(authorization, body.workspaceId, body.connectionId)) return reply(403, { error: 'Calendar connection unavailable.' });
    if (!deps.clientId || !uuid.test(deps.clientId) || !deps.authority || !(uuid.test(deps.authority) || ['common', 'organizations', 'consumers'].includes(deps.authority)) || !deps.redirectUri) throw new Error('Configuration unavailable');
    const redirect = new URL(deps.redirectUri);
    if (redirect.username || redirect.password || redirect.hash || redirect.search || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(redirect.hostname)))) throw new Error('Invalid callback');
    const state = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)));
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const url = new URL(`https://login.microsoftonline.com/${deps.authority}/oauth2/v2.0/authorize`);
    url.search = new URLSearchParams({ client_id: deps.clientId, response_type: 'code', redirect_uri: redirect.href, response_mode: 'query', scope: 'offline_access https://graph.microsoft.com/Calendars.Read', state, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account' }).toString();
    const transactionId = await deps.begin({ target_workspace_id: body.workspaceId, target_connection_id: body.connectionId, initiating_user_id: userId, raw_state: state, pkce_verifier: verifier });
    if (!uuid.test(transactionId)) throw new Error('Invalid transaction');
    return reply(200, { authorizationUrl: url.href });
  } catch { return reply(403, { error: 'Calendar connection unavailable.' }); }
}
