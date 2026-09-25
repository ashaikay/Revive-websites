import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMeetingReservationAuthority, type AuthenticatedMeetingReservationClient } from './meetingReservationAuthority.ts';
const input = { requestId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333', actorUserId: 'user-1' };
const row = { id: '44444444-4444-4444-8444-444444444444', correlation_id: input.requestId, workspace_id: input.workspaceId, action_id: input.actionId, capability: 'CREATE_APPROVED_MEETING_EVENT', status: 'prepared', mode: 'dry_run', provider_outcome: 'provider_not_invoked' };
test('passes only identifiers to caller-scoped trusted RPC', async () => {
  const client: AuthenticatedMeetingReservationClient = { rpc: async (name, args) => {
    assert.equal(name, 'reserve_rev_meeting_event_execution');
    assert.deepEqual(args, { target_request_id: input.requestId, target_workspace_id: input.workspaceId, target_action_id: input.actionId });
    return { data: row, error: null };
  } };
  assert.deepEqual(await createMeetingReservationAuthority(client)(input), { executionId: row.id, correlationId: input.requestId, providerOutcome: 'provider_not_invoked' });
});
test('rejects cross-workspace, nonmeeting, provider-claimed, and failed reservations', async () => {
  for (const data of [{ ...row, workspace_id: 'another' }, { ...row, capability: 'SEND_APPROVED_EMAIL' }, { ...row, provider_outcome: 'provider_attempt_claimed' }, { ...row, status: 'failed' }, null]) {
    const client: AuthenticatedMeetingReservationClient = { rpc: async () => ({ data, error: null }) };
    await assert.rejects(createMeetingReservationAuthority(client)(input), /unavailable/);
  }
});
