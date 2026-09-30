export const callbackPath = '/calendar/outlook/callback';
const key = 'rev-calendar-oauth-pending';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type OAuthReturn = { code: string; state: string; failed: boolean };
export function captureCalendarOAuthReturn(location: { pathname: string; search: string }, replace: (url: string) => void): OAuthReturn | null {
  if (location.pathname !== callbackPath) return null;
  const params = new URLSearchParams(location.search);
  const result = { code: params.get('code') ?? '', state: params.get('state') ?? '', failed: params.has('error') || params.getAll('code').length !== 1 || params.getAll('state').length !== 1 };
  replace(callbackPath); // Remove provider code/error before auth, rendering, or further requests.
  return result;
}
// This module is imported before createClient in supabaseClient.ts.
export const calendarOAuthReturn = typeof window === 'undefined' ? null : captureCalendarOAuthReturn(window.location, url => window.history.replaceState(null, '', url));
export interface PendingCalendarOAuth { workspaceId: string; connectionId: string; userId: string; state: string; createdAt: number; }
export type OAuthInvoke = (name: string, body: Record<string, unknown>) => Promise<unknown>;
export interface OAuthStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void; }
function row(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid calendar response');
  return value as Record<string, unknown>;
}
export async function startCalendarOAuth(workspaceId: string, userId: string, storage: OAuthStorage, invoke: OAuthInvoke, now = Date.now()): Promise<string> {
  if (!uuid.test(workspaceId) || !uuid.test(userId)) throw new Error('Invalid workspace');
  let pending: PendingCalendarOAuth | null = null;
  try { pending = JSON.parse(storage.getItem(key) ?? 'null'); } catch { storage.removeItem(key); }
  const requestId = pending && pending.workspaceId === workspaceId && pending.userId === userId && uuid.test(pending.connectionId) && pending.state === '' && Number.isSafeInteger(pending.createdAt) && now - pending.createdAt >= 0 && now - pending.createdAt < 600000 ? pending.connectionId : crypto.randomUUID();
  storage.setItem(key, JSON.stringify({ workspaceId, userId, connectionId: requestId, state: '', createdAt: now }));
  const created = row(await invoke('rev-calendar-connection-create', {workspaceId, requestId}));
  if (Object.keys(created).sort().join(',') !== 'connectionId,connectionStatus' || created.connectionId !== requestId || created.connectionStatus !== 'disconnected') throw new Error('Connection creation unavailable');
  return authorizeCalendarOAuth(workspaceId,userId,requestId,storage,invoke,now);
}

export async function completeCalendarOAuth(returned: OAuthReturn, userId: string, storage: OAuthStorage, invoke: OAuthInvoke, now = Date.now()): Promise<void> {
  let pending: PendingCalendarOAuth | null;
  try { pending = JSON.parse(storage.getItem(key) ?? 'null'); } catch { storage.removeItem(key); throw new Error('Start a new Outlook connection'); }
  if (!pending || returned.failed || !returned.code || returned.code.length > 8192 || pending.userId !== userId || !Number.isSafeInteger(pending.createdAt) || !uuid.test(pending.workspaceId) || !uuid.test(pending.connectionId) || !/^[A-Za-z0-9_-]{43,128}$/.test(pending.state) || pending.state !== returned.state || now-pending.createdAt < 0 || now-pending.createdAt >= 600000) { storage.removeItem(key); throw new Error('Start a new Outlook connection'); }
  storage.removeItem(key); // Never retry a consumed code after an uncertain response.
  const result = row(await invoke('rev-calendar-oauth-complete',{workspaceId:pending.workspaceId,connectionId:pending.connectionId,state:returned.state,code:returned.code}));
  if (Object.keys(result).sort().join(',') !== 'connectionId,connectionStatus,status' || result.status !== 'authorization_saved' || result.connectionId !== pending.connectionId || result.connectionStatus !== 'disconnected') throw new Error('Calendar authorization unavailable');
}

async function authorizeCalendarOAuth(workspaceId:string,userId:string,requestId:string,storage:OAuthStorage,invoke:OAuthInvoke,now:number):Promise<string>{
  const started = row(await invoke('rev-calendar-oauth-start', {workspaceId,connectionId:requestId}));
  if (Object.keys(started).join(',') !== 'authorizationUrl' || typeof started.authorizationUrl !== 'string') throw new Error('Authorization unavailable');
  const url = new URL(started.authorizationUrl);
  const authority = url.pathname.split('/')[1];
  const state = url.searchParams.get('state') ?? '';
  if (url.searchParams.getAll('state').length !== 1 || url.searchParams.getAll('redirect_uri').length !== 1 || !uuid.test(url.searchParams.get('client_id') ?? '') || url.origin !== 'https://login.microsoftonline.com' || url.username || url.password || url.hash || !(uuid.test(authority) || ['common','organizations','consumers'].includes(authority)) || url.pathname !== `/${authority}/oauth2/v2.0/authorize` || !/^[A-Za-z0-9_-]{43,128}$/.test(state) || url.searchParams.get('response_type') !== 'code' || url.searchParams.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(url.searchParams.get('code_challenge') ?? '') || url.searchParams.get('scope') !== 'offline_access https://graph.microsoft.com/Calendars.Read') throw new Error('Invalid authorization URL');
  const redirect = new URL(url.searchParams.get('redirect_uri') ?? '');
  if (typeof window !== 'undefined' && (redirect.origin !== window.location.origin || redirect.pathname !== callbackPath || redirect.search || redirect.hash)) throw new Error('Callback configuration does not match this app');
  storage.setItem(key,JSON.stringify({workspaceId,userId,connectionId:requestId,state,createdAt:now}));
  return url.href;
}
export async function reconnectCalendarOAuth(workspaceId:string,userId:string,connectionId:string,storage:OAuthStorage,invoke:OAuthInvoke,now=Date.now()):Promise<string>{
  if(!uuid.test(workspaceId)||!uuid.test(userId)||!uuid.test(connectionId))throw new Error('Invalid calendar identifiers');
  storage.removeItem(key); // A fresh attempt replaces any abandoned browser callback state.
  const prepared=row(await invoke('rev-calendar-reconnect',{workspaceId,connectionId}));
  if(Object.keys(prepared).sort().join(',')!=='connectionId,connectionStatus'||prepared.connectionId!==connectionId||prepared.connectionStatus!=='disconnected')throw new Error('Calendar reconnect unavailable');
  storage.setItem(key,JSON.stringify({workspaceId,userId,connectionId,state:'',createdAt:now}));
  return authorizeCalendarOAuth(workspaceId,userId,connectionId,storage,invoke,now);
}
