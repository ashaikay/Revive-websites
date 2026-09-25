import type { MeetingEventExecutionResult } from './meetingEventExecutionBoundary.ts';

export interface MeetingExecutionHttpDependencies {
  execute: (input: unknown, authorization: string) => Promise<MeetingEventExecutionResult>;
  allowedOrigin: string;
}
const json = (status: number, body: object, origin: string) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin, Vary: 'Origin' },
});
/** HTTP shell only. Identity and durable authorization remain in the server service and RPC. */
export async function handleMeetingExecutionHttp(request: Request, deps: MeetingExecutionHttpDependencies): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (!deps.allowedOrigin || origin !== deps.allowedOrigin) return new Response(null, { status: 403 });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
    'Access-Control-Allow-Origin': deps.allowedOrigin, 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type, apikey',
    'Access-Control-Max-Age': '600', Vary: 'Origin',
  } });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' }, deps.allowedOrigin);
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer [^\s]+$/i.test(authorization)) return json(401, { error: 'Authentication required.' }, deps.allowedOrigin);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return json(415, { error: 'JSON required.' }, deps.allowedOrigin);
  const length = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(length) && length > 1024) return json(413, { error: 'Request too large.' }, deps.allowedOrigin);
  let body: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1024) return json(413, { error: 'Request too large.' }, deps.allowedOrigin);
    body = JSON.parse(raw);
  } catch { return json(400, { error: 'Invalid request.' }, deps.allowedOrigin); }
  try {
    const result = await deps.execute(body, authorization);
    // Assert the disabled result before crossing the HTTP boundary.
    if (result.status !== 'provider_disabled' || result.executionEnabled !== false ||
      result.providerInvoked !== false || result.eventCreated !== false || result.providerOutcome !== 'provider_not_invoked') {
      throw new Error('Invalid disabled execution response.');
    }
    return json(200, result, deps.allowedOrigin);
  } catch { return json(403, { error: 'Meeting execution unavailable.' }, deps.allowedOrigin); }
}
