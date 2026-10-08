export interface OAuthTokenConfiguration { clientId: string; clientSecret: string; authority: string; redirectUri: string; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type CalendarOAuthAccessMode = 'read' | 'write';
export interface CalendarOAuthTransaction { verifier: string; accessMode: CalendarOAuthAccessMode; expectedRevision: number; }
export interface CalendarOAuthCredential { refreshToken: string; grantedCalendarScopes: string[]; }
export function validateOAuthTokenConfiguration(config: OAuthTokenConfiguration): void {
  if (!uuid.test(config.clientId) || !config.clientSecret?.trim() || !(uuid.test(config.authority) || ['common','organizations','consumers'].includes(config.authority))) throw new Error('OAuth configuration unavailable');
  const redirect = new URL(config.redirectUri);
  if (redirect.username || redirect.password || redirect.search || redirect.hash || (redirect.protocol !== 'https:' && !(redirect.protocol === 'http:' && ['localhost','127.0.0.1'].includes(redirect.hostname)))) throw new Error('OAuth configuration unavailable');
}
export async function exchangeCalendarOAuthCode(config: OAuthTokenConfiguration, code: string, verifier: string, accessMode: CalendarOAuthAccessMode = 'read', fetchImpl: typeof fetch = fetch): Promise<CalendarOAuthCredential> {
  validateOAuthTokenConfiguration(config);
  if (!code || code.length > 8192 || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) throw new Error('OAuth exchange unavailable');
  // One exchange only. Never retry a consumed authorization code automatically.
  if (accessMode !== 'read' && accessMode !== 'write') throw new Error('OAuth exchange unavailable');
  const requestedScope = accessMode === 'write'
    ? 'offline_access https://graph.microsoft.com/Calendars.ReadWrite'
    : 'offline_access https://graph.microsoft.com/Calendars.Read';
  const response = await fetchImpl(`https://login.microsoftonline.com/${config.authority}/oauth2/v2.0/token`, {
    method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: new URL(config.redirectUri).href, scope: requestedScope }),
  });
  if (!response.ok) throw new Error('OAuth exchange unavailable');
  const body = await response.json();
  const scopes = typeof body.scope === 'string' ? body.scope.split(/\s+/).map((s: string) => s.toLowerCase()) : [];
  const hasRead = scopes.includes('https://graph.microsoft.com/calendars.read') || scopes.includes('calendars.read');
  const hasWrite = scopes.includes('https://graph.microsoft.com/calendars.readwrite') || scopes.includes('calendars.readwrite');
  if (body.token_type?.toLowerCase() !== 'bearer' || typeof body.access_token !== 'string' || !body.access_token.trim() || typeof body.refresh_token !== 'string' || !body.refresh_token.trim() || body.refresh_token.length > 32768 || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || (accessMode === 'read' ? !hasRead || hasWrite : !hasWrite)) throw new Error('OAuth exchange unavailable');
  const grantedCalendarScopes = [
    ...(hasRead ? ['https://graph.microsoft.com/calendars.read'] : []),
    ...(hasWrite ? ['https://graph.microsoft.com/calendars.readwrite'] : []),
  ];
  return { refreshToken: body.refresh_token, grantedCalendarScopes };
}
export interface CalendarOAuthCompletionDependencies {
  allowedOrigin?: string;
  getUserId(authorization: string): Promise<string | null>;
  canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
  validateConfiguration(): void;
  consume(input: { target_workspace_id: string; target_connection_id: string; initiating_user_id: string; raw_state: string }): Promise<CalendarOAuthTransaction>;
  exchange(code: string, verifier: string, accessMode: CalendarOAuthAccessMode): Promise<CalendarOAuthCredential>;
  store(input: { target_workspace_id: string; target_connection_id: string; initiating_user_id: string; refresh_token: string; expected_revision: number; requested_access_mode: CalendarOAuthAccessMode; granted_calendar_scopes: string[] }): Promise<{ credential_reference: string; revision: number; connection_status: string }>;
}
export async function handleCalendarOAuthCompletion(request: Request, deps: CalendarOAuthCompletionDependencies): Promise<Response> {
  if (!deps.allowedOrigin || request.headers.get('Origin') !== deps.allowedOrigin) return new Response(null,{status:403});
  const headers = { 'Access-Control-Allow-Origin': deps.allowedOrigin, Vary:'Origin', 'Cache-Control':'no-store','Content-Type':'application/json' };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body),{status,headers});
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:{...headers,'Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Allow-Headers':'authorization, content-type, apikey, x-client-info'}});
  if (request.method !== 'POST') return reply(405,{error:'Method not allowed.'});
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401,{error:'Authentication required.'});
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') return reply(415,{error:'JSON required.'});
  try {
    const text = await request.text(); if (text.length > 12000) return reply(400,{error:'Invalid request.'});
    const body = JSON.parse(text);
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).sort().join(',') !== 'code,connectionId,state,workspaceId' || !uuid.test(body.workspaceId) || !uuid.test(body.connectionId) || typeof body.code !== 'string' || !body.code.trim() || body.code.length > 8192 || typeof body.state !== 'string' || !/^[A-Za-z0-9_-]{43,128}$/.test(body.state)) return reply(400,{error:'Invalid request.'});
    const userId = await deps.getUserId(authorization);
    if (!userId || !uuid.test(userId)) return reply(401,{error:'Authentication required.'});
    if (!await deps.canManage(authorization,body.workspaceId,userId)) return reply(403,{error:'Calendar authorization unavailable. Start a new connection attempt.'});
    deps.validateConfiguration();
    const bound = {target_workspace_id:body.workspaceId,target_connection_id:body.connectionId,initiating_user_id:userId};
    const transaction = await deps.consume({...bound,raw_state:body.state});
    if (!transaction || !/^[A-Za-z0-9._~-]{43,128}$/.test(transaction.verifier) || !['read','write'].includes(transaction.accessMode) || !Number.isSafeInteger(transaction.expectedRevision) || transaction.expectedRevision < 0) throw new Error('Invalid OAuth transaction');
    const credential = await deps.exchange(body.code,transaction.verifier,transaction.accessMode);
    if (!credential || typeof credential.refreshToken !== 'string' || !credential.refreshToken.trim() || credential.refreshToken.length > 32768 || !Array.isArray(credential.grantedCalendarScopes)) throw new Error('Invalid credential');
    const stored = await deps.store({...bound,refresh_token:credential.refreshToken,expected_revision:transaction.expectedRevision,requested_access_mode:transaction.accessMode,granted_calendar_scopes:credential.grantedCalendarScopes});
    const expectedStatus=transaction.accessMode==='write'?'connected':'disconnected';
    if (!uuid.test(stored.credential_reference) || !Number.isSafeInteger(stored.revision) || stored.revision !== transaction.expectedRevision + 1 || stored.connection_status!==expectedStatus) throw new Error('Invalid credential result');
    const result = {status:'authorization_saved',connectionId:body.connectionId,connectionStatus:stored.connection_status};
    return reply(200,transaction.accessMode === 'write' ? {...result,calendarWriteConsentGranted:true} : result);
  } catch { return reply(403,{error:'Calendar authorization unavailable. Start a new connection attempt.'}); }
}
