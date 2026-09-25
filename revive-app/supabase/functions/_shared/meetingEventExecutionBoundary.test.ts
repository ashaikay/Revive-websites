import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MeetingEventExecutionDenied, requestMeetingEventExecution, type MeetingEventExecutionDependencies } from './meetingEventExecutionBoundary.ts';
const request = { requestId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333' };
const reservation = { executionId: '44444444-4444-4444-8444-444444444444', correlationId: '55555555-5555-4555-8555-555555555555', providerOutcome: 'provider_not_invoked' as const };
function fixture() {
  const calls: string[] = [];
  const deps: MeetingEventExecutionDependencies = {
    authenticate: async () => { calls.push('authenticate'); return 'user-1'; },
    getActiveOperator: async (workspaceId, userId) => { calls.push('membership'); assert.equal(workspaceId, request.workspaceId); assert.equal(userId, 'user-1'); return { userId, role: 'owner' }; },
    reserveDurably: async input => { calls.push('reserve'); assert.deepEqual(input, { ...request, actorUserId: 'user-1' }); return reservation; },
    invokeGraph: async () => { calls.push('graph'); throw new Error('Graph must not run'); },
  };
  return { calls, deps };
}
test('active owner gets durable disabled result and Graph is never invoked', async () => {
  const { calls, deps } = fixture();
  assert.deepEqual(await requestMeetingEventExecution(request, deps), { status: 'provider_disabled', displayStatus: 'DRY RUN — NOTHING BOOKED', executionEnabled: false, providerInvoked: false, eventCreated: false, executionId: reservation.executionId, correlationId: reservation.correlationId, providerOutcome: 'provider_not_invoked' });
  assert.deepEqual(calls, ['authenticate', 'membership', 'reserve']);
});
test('active admin is permitted; inactive, member and mismatched actors stop before reservation', async () => {
  for (const role of ['admin', 'member', 'inactive'] as const) {
    const { calls, deps } = fixture();
    deps.getActiveOperator = async () => { calls.push('membership'); return role === 'inactive' ? null : { userId: 'user-1', role: role as 'admin' }; };
    if (role === 'admin') await requestMeetingEventExecution(request, deps);
    else await assert.rejects(requestMeetingEventExecution(request, deps), MeetingEventExecutionDenied);
    assert.equal(calls.includes('reserve'), role === 'admin');
    assert.ok(!calls.includes('graph'));
  }
  const { calls, deps } = fixture();
  deps.getActiveOperator = async () => ({ userId: 'another-user', role: 'owner' });
  await assert.rejects(requestMeetingEventExecution(request, deps), MeetingEventExecutionDenied);
  assert.deepEqual(calls, ['authenticate']);
});
test('unauthenticated and malformed or injected requests stop before reservation', async () => {
  for (const input of [{ ...request, attendeeEmail: 'target@example.test' }, { ...request, eventId: 'event' }, { ...request, actionId: 'bad' }, null]) {
    const { calls, deps } = fixture();
    await assert.rejects(requestMeetingEventExecution(input, deps), MeetingEventExecutionDenied);
    assert.deepEqual(calls, []);
  }
  const { calls, deps } = fixture();
  deps.authenticate = async () => null;
  await assert.rejects(requestMeetingEventExecution(request, deps), MeetingEventExecutionDenied);
  assert.deepEqual(calls, []);
});
test('authority refusal and malformed reservation fail closed before Graph', async () => {
  for (const bad of [null, { ...reservation, providerOutcome: 'claimed' }]) {
    const { calls, deps } = fixture();
    deps.reserveDurably = async () => { calls.push('reserve'); if (!bad) throw new Error('stale approval'); return bad as typeof reservation; };
    await assert.rejects(requestMeetingEventExecution(request, deps));
    assert.ok(!calls.includes('graph'));
  }
});
