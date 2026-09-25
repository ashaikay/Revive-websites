import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMeetingExecutionServerBoundary, type MeetingServerDependencies } from './meetingExecutionServerDependencies.ts';
const request = { requestId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333' };
const userId = '44444444-4444-4444-8444-444444444444';
const binding = { workspace_id: request.workspaceId, provider_key: 'microsoft_graph', calendar_reference: 'owner@example.test', timezone: 'Europe/London', enabled: true, version: 1 };
function fixture(opts: { user?: string | null; membership?: object | null; persisted?: object | null; mailbox?: string } = {}) {
  const calls: string[] = [];
  const query = (table: string) => ({ select: (_columns: string) => ({ eq: (_field: string, _value: string) => ({ eq: (_f: string, _v: string) => ({ maybeSingle: async () => {
    calls.push(table);
    return { data: table === 'workspace_members' ? opts.membership === undefined ? { user_id: userId, role: 'owner', status: 'active' } : opts.membership : opts.persisted === undefined ? binding : opts.persisted, error: null };
  } }) }) }) });
  const caller = { auth: { getUser: async () => { calls.push('getUser'); return { data: { user: opts.user === undefined ? { id: userId } : opts.user ? { id: opts.user } : null }, error: null }; } },
    from: query, rpc: async (_name: string, args: Record<string, unknown>) => {
      calls.push('rpc'); assert.deepEqual(args, { target_request_id: request.requestId, target_workspace_id: request.workspaceId, target_action_id: request.actionId,
        expected_calendar_reference: binding.calendar_reference, expected_timezone: binding.timezone, expected_binding_version: binding.version });
      return { data: { id: '55555555-5555-4555-8555-555555555555', correlation_id: request.requestId, workspace_id: request.workspaceId, action_id: request.actionId,
        capability: 'CREATE_APPROVED_MEETING_EVENT', status: 'prepared', mode: 'dry_run', provider_outcome: 'provider_not_invoked' }, error: null };
    } };
  const deps = { callerClient: caller, trustedClient: { from: query }, getEnvironment: (key: string) => ({
    REV_CALENDAR_AVAILABILITY_WORKSPACE_ID: request.workspaceId, REV_CALENDAR_AVAILABILITY_PRIMARY_MAILBOX: opts.mailbox ?? binding.calendar_reference,
    REV_CALENDAR_AVAILABILITY_TIMEZONE: binding.timezone,
  } as Record<string, string>)[key] } as MeetingServerDependencies;
  return { calls, run: createMeetingExecutionServerBoundary(deps) };
}
test('verified owner uses current membership and trusted binding then caller-scoped bound RPC', async () => {
  const { calls, run } = fixture();
  const result = await run(request);
  assert.equal(result.status, 'provider_disabled');
  assert.equal(result.providerInvoked, false);
  assert.deepEqual(calls, ['getUser', 'workspace_members', 'rev_meeting_calendar_bindings', 'rpc', 'rev_meeting_calendar_bindings']);
});
test('invalid session and inactive/member status stop before trusted binding read', async () => {
  for (const opts of [{ user: null }, { membership: { user_id: userId, role: 'owner', status: 'inactive' } }, { membership: { user_id: userId, role: 'member', status: 'active' } }]) {
    const { calls, run } = fixture(opts);
    await assert.rejects(run(request));
    assert.ok(!calls.includes('rev_meeting_calendar_bindings') && !calls.includes('rpc'));
  }
});
test('mailbox mismatch and injected input never reach the RPC', async () => {
  const mismatch = fixture({ mailbox: 'other@example.test' });
  await assert.rejects(mismatch.run(request));
  assert.ok(!mismatch.calls.includes('rpc'));
  const injected = fixture();
  await assert.rejects(injected.run({ ...request, actorUserId: userId }));
  assert.deepEqual(injected.calls, []);
});
