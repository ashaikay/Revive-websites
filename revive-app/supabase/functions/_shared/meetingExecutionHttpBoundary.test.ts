import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleMeetingExecutionHttp } from './meetingExecutionHttpBoundary.ts';
const origin = 'https://revive.example.test';
const ids = { requestId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333' };
const disabled = { status: 'provider_disabled', displayStatus: 'DRY RUN — NOTHING BOOKED', executionEnabled: false, providerInvoked: false, eventCreated: false, executionId: '44444444-4444-4444-8444-444444444444', correlationId: ids.requestId, providerOutcome: 'provider_not_invoked' } as const;
function req(body: unknown, headers: Record<string, string> = {}, method = 'POST') {
  return new Request('https://functions.example.test/rev-meeting-execute', { method, headers: { Origin: origin, Authorization: 'Bearer token', 'Content-Type': 'application/json', ...headers }, body: method === 'POST' ? JSON.stringify(body) : undefined });
}
test('disabled result crosses HTTP with no-store; only identifiers reach server service', async () => {
  let count = 0;
  const response = await handleMeetingExecutionHttp(req(ids), { allowedOrigin: origin, execute: async (input, auth) => {
    count++; assert.deepEqual(input, ids); assert.equal(auth, 'Bearer token'); return disabled;
  } });
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), disabled);
  assert.equal(response.headers.get('Cache-Control'), 'no-store'); assert.equal(count, 1);
});
test('origin, method, bearer and content type deny before service construction', async () => {
  let count = 0;
  const deps = { allowedOrigin: origin, execute: async () => { count++; return disabled; } };
  for (const [request, status] of [
    [req(ids, { Origin: 'https://evil.test' }), 403], [req(ids, {}, 'GET'), 405],
    [req(ids, { Authorization: '' }), 401], [req(ids, { 'Content-Type': 'text/plain' }), 415],
    [req(ids, { 'Content-Length': '2000' }), 413],
  ] as const) assert.equal((await handleMeetingExecutionHttp(request, deps)).status, status);
  assert.equal(count, 0);
});
test('server failure and unexpected enabled outcome never produce successful response', async () => {
  for (const execute of [async () => { throw new Error('private database error'); }, async () => ({ ...disabled, providerInvoked: true })]) {
    const response = await handleMeetingExecutionHttp(req(ids), { allowedOrigin: origin, execute: execute as never });
    assert.equal(response.status, 403); assert.deepEqual(await response.json(), { error: 'Meeting execution unavailable.' });
  }
});
test('preflight allows only configured origin and does not invoke service', async () => {
  const response = await handleMeetingExecutionHttp(req(ids, {}, 'OPTIONS'), { allowedOrigin: origin, execute: async () => { throw new Error('unreachable'); } });
  assert.equal(response.status, 204); assert.equal(response.headers.get('Access-Control-Allow-Origin'), origin);
});
test('default HTTP gate rejects a live result even if an executor returns one', async () => {
  const response = await handleMeetingExecutionHttp(req(ids), { allowedOrigin: origin,
    execute: async () => ({ status: 'event_created', executionId: disabled.executionId,
      providerOutcome: 'accepted_by_provider', providerInvoked: true, eventCreated: true, invitationSent: false }) });
  assert.equal(response.status, 403);
});
test('test enabled HTTP contract distinguishes accepted, rejected and unknown outcomes', async () => {
  for (const [status, outcome, created, invited, httpStatus] of [
    ['event_created', 'accepted_by_provider', true, false, 200],
    ['provider_rejected', 'rejected_by_provider', false, false, 409],
    ['outcome_unknown', 'provider_outcome_unknown', null, null, 202],
  ] as const) {
    const body = { status, executionId: disabled.executionId, providerOutcome: outcome,
      providerInvoked: true as const, eventCreated: created, invitationSent: invited };
    const response = await handleMeetingExecutionHttp(req(ids), { allowedOrigin: origin,
      execute: async () => body }, true);
    assert.equal(response.status, httpStatus);
    assert.deepEqual(await response.json(), body);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
  }
});
