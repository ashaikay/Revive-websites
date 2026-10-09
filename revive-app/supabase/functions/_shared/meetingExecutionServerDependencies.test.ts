import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMeetingExecutionServerBoundary, type MeetingServerDependencies } from './meetingExecutionServerDependencies.ts';
const request = { requestId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333' };
const userId = '44444444-4444-4444-8444-444444444444';
function fixture(opts: { user?: string | null; membership?: object | null } = {}) {
  const calls: string[] = [];
  const query = (table: string) => ({ select: (_columns: string) => ({ eq: (_field: string, _value: string) => ({ eq: (_f: string, _v: string) => ({ maybeSingle: async () => {
    calls.push(table);
    return { data: opts.membership === undefined ? { user_id: userId, role: 'owner', status: 'active' } : opts.membership, error: null };
  } }) }) }) });
  const caller = { auth: { getUser: async () => { calls.push('getUser'); return { data: { user: opts.user === undefined ? { id: userId } : opts.user ? { id: opts.user } : null }, error: null }; } },
    from: query, rpc: async (_name: string, args: Record<string, unknown>) => {
      calls.push('rpc'); assert.deepEqual(args, { target_request_id: request.requestId, target_workspace_id: request.workspaceId, target_action_id: request.actionId });
      return { data: { id: '55555555-5555-4555-8555-555555555555', correlation_id: request.requestId, workspace_id: request.workspaceId, action_id: request.actionId,
        capability: 'CREATE_APPROVED_MEETING_EVENT', status: 'prepared', mode: 'dry_run', provider_outcome: 'provider_not_invoked' }, error: null };
    } };
  const deps = { callerClient: caller } as MeetingServerDependencies;
  return { calls, run: createMeetingExecutionServerBoundary(deps) };
}
test('verified owner reaches caller-scoped selected-calendar RPC with identifiers only', async () => {
  const { calls, run } = fixture();
  const result = await run(request);
  assert.equal(result.status, 'provider_disabled');
  assert.equal(result.providerInvoked, false);
  assert.deepEqual(calls, ['getUser', 'workspace_members', 'rpc']);
});
test('invalid session and inactive/member status stop before reservation RPC', async () => {
  for (const opts of [{ user: null }, { membership: { user_id: userId, role: 'owner', status: 'inactive' } }, { membership: { user_id: userId, role: 'member', status: 'active' } }]) {
    const { calls, run } = fixture(opts);
    await assert.rejects(run(request));
    assert.ok(!calls.includes('rpc'));
  }
});
test('injected input never reaches the RPC', async () => {
  const injected = fixture();
  await assert.rejects(injected.run({ ...request, actorUserId: userId }));
  assert.deepEqual(injected.calls, []);
});
