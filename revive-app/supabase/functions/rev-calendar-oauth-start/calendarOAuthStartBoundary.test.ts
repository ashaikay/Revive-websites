import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleCalendarOAuthStart, type CalendarOAuthStartDependencies } from './calendarOAuthStartBoundary.ts';
const workspaceId = 'fdce6c53-d1cb-48bc-b35a-7f57674d80f6';
const connectionId = '4d2b4b34-9f79-496b-82b0-663e71cd3b5a';
const userId = 'baf67b40-2fdf-4496-9c1d-1ac1aa5e9892';
const origin = 'http://127.0.0.1:5180';
function fixture(overrides: Partial<CalendarOAuthStartDependencies> = {}) {
  const calls: string[] = []; const stored: Parameters<CalendarOAuthStartDependencies['begin']>[0][] = [];
  const deps: CalendarOAuthStartDependencies = {
    allowedOrigin: origin, clientId: userId, authority: 'organizations', redirectUri: 'http://127.0.0.1:55321/functions/v1/rev-calendar-oauth-callback',
    getUserId: async () => { calls.push('auth'); return userId; },
    canManage: async () => { calls.push('membership'); return true; },
    hasConnection: async () => { calls.push('connection'); return true; },
    begin: async (input) => { calls.push('store'); stored.push(input); return connectionId; }, ...overrides,
  };
  return { deps, calls, stored };
}
function request(body: unknown = { workspaceId, connectionId }, headers: Record<string,string> = {}, method = 'POST') {
  return new Request('https://example.test/start', { method, headers: { Origin: origin, Authorization: 'Bearer fake-session', 'Content-Type': 'application/json', ...headers }, ...(method === 'OPTIONS' ? {} : { body: JSON.stringify(body) }) });
}
test('authorized start stores actor-bound state and S256 verifier before returning only authorization URL', async () => {
  const f = fixture(); const response = await handleCalendarOAuthStart(request(), f.deps);
  assert.equal(response.status, 200); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const body = await response.json(); assert.deepEqual(Object.keys(body), ['authorizationUrl']);
  assert.deepEqual(f.calls, ['auth','membership','connection','store']);
  const url = new URL(body.authorizationUrl); const s = f.stored[0];
  assert.equal(url.origin, 'https://login.microsoftonline.com');
  assert.equal(s.initiating_user_id, userId); assert.equal(s.target_workspace_id, workspaceId); assert.equal(s.target_connection_id, connectionId);
  assert.equal(url.searchParams.get('state'), s.raw_state); assert.notEqual(s.raw_state, s.pkce_verifier);
  assert.match(s.raw_state, /^[A-Za-z0-9_-]{43}$/); assert.match(s.pkce_verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(url.searchParams.get('code_challenge'), createHash('sha256').update(s.pkce_verifier).digest('base64url'));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('scope'), 'offline_access https://graph.microsoft.com/Calendars.Read');
  assert.ok(!JSON.stringify(body).includes(s.pkce_verifier));
});
test('each attempt has independent random state and verifier', async () => {
  const f = fixture(); await handleCalendarOAuthStart(request(), f.deps); await handleCalendarOAuthStart(request(), f.deps);
  assert.notEqual(f.stored[0].raw_state, f.stored[1].raw_state); assert.notEqual(f.stored[0].pkce_verifier, f.stored[1].pkce_verifier);
});
test('origin, preflight, bearer and injected inputs stop before storage', async () => {
  for (const [req, status] of [[request(undefined,{Origin:'https://evil.test'}),403], [request(undefined,{Authorization:''}),401], [request({workspaceId,connectionId,actorUserId:userId}),400], [request({workspaceId:'bad',connectionId}),400], [request(undefined,{'Content-Type':'text/plain'}),415]] as const) {
    const f = fixture(); assert.equal((await handleCalendarOAuthStart(req,f.deps)).status,status); assert.deepEqual(f.calls,[]);
  }
  const f = fixture(); const response = await handleCalendarOAuthStart(request(undefined,{},'OPTIONS'),f.deps);
  assert.equal(response.status,204); assert.match(response.headers.get('Access-Control-Allow-Headers')!,/x-client-info/); assert.deepEqual(f.calls,[]);
});
test('unverified caller, denied role and wrong tenant connection stop before service storage', async () => {
  for (const overrides of [{getUserId:async()=>null},{canManage:async()=>false},{hasConnection:async()=>false}]) {
    const f = fixture(overrides); assert.ok((await handleCalendarOAuthStart(request(),f.deps)).status >= 400); assert.equal(f.stored.length,0);
  }
});
test('missing config and unsafe redirects fail closed without storage', async () => {
  for (const overrides of [{clientId:undefined},{authority:'evil.test/path'},{redirectUri:'https://evil.test/path#fragment'},{redirectUri:'http://evil.test/callback'}]) {
    const f = fixture(overrides); assert.equal((await handleCalendarOAuthStart(request(),f.deps)).status,403); assert.equal(f.stored.length,0);
  }
});
test('storage failure never reveals private details or returns an authorization URL', async () => {
  const f = fixture({begin:async()=>{throw new Error('private verifier details');}});
  const response = await handleCalendarOAuthStart(request(),f.deps); assert.equal(response.status,403);
  assert.deepEqual(await response.json(),{error:'Calendar connection unavailable.'});
});
