import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDisabledMeetingExecutionService, type DisabledMeetingExecutionServiceDependencies } from './disabledMeetingExecutionService.ts';

const request = { requestId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333' };
function setup(overrides: Partial<DisabledMeetingExecutionServiceDependencies> = {}) {
  const calls: string[] = [];
  const deps: DisabledMeetingExecutionServiceDependencies = {
    authenticate: async () => { calls.push('authenticate'); return 'user-1'; },
    getActiveOperator: async (workspaceId, userId) => { calls.push('operator'); assert.equal(workspaceId, request.workspaceId); assert.equal(userId, 'user-1'); return { userId, role: 'owner' }; },
    getCallerScopedReservationClient: async () => { calls.push('client'); return { rpc: async (name, args) => {
      calls.push('rpc');
      assert.equal(name, 'reserve_rev_meeting_event_execution_selected');
      assert.deepEqual(args, { target_request_id: request.requestId, target_workspace_id: request.workspaceId, target_action_id: request.actionId });
      return { data: { id: '44444444-4444-4444-8444-444444444444', correlation_id: request.requestId, workspace_id: request.workspaceId, action_id: request.actionId, capability: 'CREATE_APPROVED_MEETING_EVENT', status: 'prepared', mode: 'dry_run', provider_outcome: 'provider_not_invoked' }, error: null };
    } }; },
    ...overrides,
  };
  return { calls, service: createDisabledMeetingExecutionService(deps) };
}
test('full server path reserves once and returns disabled without constructing provider access', async () => {
  const { calls, service } = setup();
  const result = await service(request);
  assert.deepEqual(result, { status: 'provider_disabled', displayStatus: 'DRY RUN — NOTHING BOOKED', executionEnabled: false, providerInvoked: false, eventCreated: false, executionId: '44444444-4444-4444-8444-444444444444', correlationId: request.requestId, providerOutcome: 'provider_not_invoked' });
  assert.deepEqual(calls, ['authenticate', 'operator', 'client', 'rpc']);
});
test('unverified caller and inactive or member roles stop before binding or RPC', async () => {
  for (const overrides of [
    { authenticate: async () => null },
    { getActiveOperator: async () => null },
    { getActiveOperator: async () => ({ userId: 'user-1', role: 'member' as 'owner' }) },
  ]) {
    const { calls, service } = setup(overrides);
    await assert.rejects(service(request));
    assert.ok(!calls.includes('client') && !calls.includes('rpc'));
  }
});
test('injected caller fields stop before RPC', async () => {
  const malformed = setup();
  await assert.rejects(malformed.service({ ...request, actorUserId: 'user-1' }));
  assert.deepEqual(malformed.calls, []);
});
