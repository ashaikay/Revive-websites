import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAtomicMeetingReservationAuthority, type BoundMeetingReservationClient } from './atomicMeetingReservationAuthority.ts';
import { createTrustedMeetingReservation } from './trustedMeetingBindingGuard.ts';

const input = { requestId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333', actorUserId: 'user-1' };
const binding = { workspace_id: input.workspaceId, provider_key: 'microsoft_graph', calendar_reference: 'owner@example.test', timezone: 'Europe/London', enabled: true, version: 7 };
const configured = { selectedCalendar: { workspaceId: input.workspaceId, provider: 'microsoft_graph' as const, providerCalendarReference: binding.calendar_reference, timezone: binding.timezone }, primaryMailboxUserPrincipalName: binding.calendar_reference };
const row = { id: '44444444-4444-4444-8444-444444444444', correlation_id: input.requestId, workspace_id: input.workspaceId, action_id: input.actionId, capability: 'CREATE_APPROVED_MEETING_EVENT', mode: 'dry_run', status: 'prepared', provider_outcome: 'provider_not_invoked' };
test('guard passes only server-matched binding to atomic RPC and never sends actor identity', async () => {
  let calls = 0;
  const client: BoundMeetingReservationClient = { rpc: async (name, args) => {
    calls++;
    assert.equal(name, 'reserve_rev_meeting_event_execution_bound');
    assert.deepEqual(args, {
      target_request_id: input.requestId, target_workspace_id: input.workspaceId, target_action_id: input.actionId,
      expected_calendar_reference: binding.calendar_reference, expected_timezone: binding.timezone,
      expected_binding_version: 7,
    });
    return { data: row, error: null };
  } };
  const reserve = createTrustedMeetingReservation({
    getConfiguredCalendar: async () => configured,
    loadPersistedBinding: async () => binding,
    reserveDurably: createAtomicMeetingReservationAuthority(client),
  });
  assert.deepEqual(await reserve(input), { executionId: row.id, correlationId: input.requestId, providerOutcome: 'provider_not_invoked' });
  assert.equal(calls, 1);
});
test('mismatched binding stops before RPC; provider-claimed response fails closed', async () => {
  let calls = 0;
  const client: BoundMeetingReservationClient = { rpc: async () => { calls++; return { data: { ...row, provider_outcome: 'provider_attempt_claimed' }, error: null }; } };
  const reserveWith = (reference: string) => createTrustedMeetingReservation({
    getConfiguredCalendar: async () => configured,
    loadPersistedBinding: async () => ({ ...binding, calendar_reference: reference }),
    reserveDurably: createAtomicMeetingReservationAuthority(client),
  })(input);
  await assert.rejects(reserveWith('wrong@example.test'));
  assert.equal(calls, 0);
  await assert.rejects(reserveWith(binding.calendar_reference), /unavailable/);
  assert.equal(calls, 1);
});
