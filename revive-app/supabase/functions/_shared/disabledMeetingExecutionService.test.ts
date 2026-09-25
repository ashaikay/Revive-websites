import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDisabledMeetingExecutionService, type DisabledMeetingExecutionServiceDependencies } from './disabledMeetingExecutionService.ts';

const request = { requestId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333' };
const binding = { workspace_id: request.workspaceId, provider_key: 'microsoft_graph', calendar_reference: 'owner@example.test', timezone: 'Europe/London', enabled: true, version: 3 };
function setup(overrides: Partial<DisabledMeetingExecutionServiceDependencies> = {}) {
  const calls: string[] = [];
  const deps: DisabledMeetingExecutionServiceDependencies = {
    authenticate: async () => { calls.push('authenticate'); return 'user-1'; },
    getActiveOperator: async (workspaceId, userId) => { calls.push('operator'); assert.equal(workspaceId, request.workspaceId); assert.equal(userId, 'user-1'); return { userId, role: 'owner' }; },
    getConfiguredCalendar: async () => { calls.push('configured'); return { selectedCalendar: { workspaceId: request.workspaceId, provider: 'microsoft_graph', providerCalendarReference: binding.calendar_reference, timezone: binding.timezone }, primaryMailboxUserPrincipalName: binding.calendar_reference }; },
    loadPersistedBinding: async () => { calls.push('binding'); return binding; },
    getCallerScopedReservationClient: async () => { calls.push('client'); return { rpc: async (name, args) => {
      calls.push('rpc');
      assert.equal(name, 'reserve_rev_meeting_event_execution_bound');
      assert.deepEqual(args, { target_request_id: request.requestId, target_workspace_id: request.workspaceId, target_action_id: request.actionId, expected_calendar_reference: binding.calendar_reference, expected_timezone: binding.timezone, expected_binding_version: binding.version });
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
  assert.deepEqual(calls, ['authenticate', 'operator', 'configured', 'binding', 'client', 'rpc', 'binding']);
});
test('unverified caller and inactive or member roles stop before binding or RPC', async () => {
  for (const overrides of [
    { authenticate: async () => null },
    { getActiveOperator: async () => null },
    { getActiveOperator: async () => ({ userId: 'user-1', role: 'member' as 'owner' }) },
  ]) {
    const { calls, service } = setup(overrides);
    await assert.rejects(service(request));
    assert.ok(!calls.includes('binding') && !calls.includes('client') && !calls.includes('rpc'));
  }
});
test('injected caller fields and binding mismatch stop before RPC', async () => {
  const malformed = setup();
  await assert.rejects(malformed.service({ ...request, actorUserId: 'user-1' }));
  assert.deepEqual(malformed.calls, []);
  const changed = setup({ loadPersistedBinding: async () => ({ ...binding, calendar_reference: 'other@example.test' }) });
  await assert.rejects(changed.service(request));
  assert.ok(!changed.calls.includes('rpc'));
});
