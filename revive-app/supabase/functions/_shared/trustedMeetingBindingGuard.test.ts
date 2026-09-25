import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrustedMeetingReservation, TrustedMeetingBindingMismatch, type TrustedMeetingBindingDependencies } from './trustedMeetingBindingGuard.ts';

const input = { requestId: '11111111-1111-4111-8111-111111111111', workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333', actorUserId: 'user-1' };
const configured = { selectedCalendar: { workspaceId: input.workspaceId, provider: 'microsoft_graph' as const, providerCalendarReference: 'owner@example.test', timezone: 'Europe/London' }, primaryMailboxUserPrincipalName: 'owner@example.test' };
const binding = { workspace_id: input.workspaceId, provider_key: 'microsoft_graph', calendar_reference: 'owner@example.test', timezone: 'Europe/London', enabled: true, version: 1 };
const result = { executionId: '44444444-4444-4444-8444-444444444444', correlationId: input.requestId, providerOutcome: 'provider_not_invoked' as const };
function fixture(overrides: Partial<TrustedMeetingBindingDependencies> = {}) {
  const calls: string[] = [];
  const deps: TrustedMeetingBindingDependencies = {
    getConfiguredCalendar: async () => { calls.push('configured'); return configured; },
    loadPersistedBinding: async () => { calls.push('binding'); return binding; },
    reserveDurably: async (received, expected) => {
      calls.push('reserve');
      assert.deepEqual(received, input);
      assert.deepEqual(expected, { calendarReference: binding.calendar_reference, timezone: binding.timezone, bindingVersion: binding.version });
      return result;
    },
    ...overrides,
  };
  return { calls, deps };
}
test('matching workspace, provider, mailbox and timezone are checked on both sides of reservation', async () => {
  const { calls, deps } = fixture();
  assert.deepEqual(await createTrustedMeetingReservation(deps)(input), result);
  assert.deepEqual(calls, ['configured', 'binding', 'reserve', 'binding']);
});
test('missing, disabled, cross-tenant, mailbox and timezone mismatches stop before reservation', async () => {
  for (const bad of [null, { ...binding, enabled: false }, { ...binding, workspace_id: 'other' }, { ...binding, calendar_reference: 'other@example.test' }, { ...binding, timezone: 'UTC' }]) {
    const { calls, deps } = fixture({ loadPersistedBinding: async () => { calls.push('binding'); return bad; } });
    await assert.rejects(createTrustedMeetingReservation(deps)(input), TrustedMeetingBindingMismatch);
    assert.ok(!calls.includes('reserve'));
  }
});
test('drift during reservation fails closed after one durable provider-not-invoked row', async () => {
  let reads = 0;
  const { calls, deps } = fixture({ loadPersistedBinding: async () => { calls.push('binding'); return ++reads === 1 ? binding : { ...binding, version: 2, calendar_reference: 'other@example.test' }; } });
  await assert.rejects(createTrustedMeetingReservation(deps)(input), TrustedMeetingBindingMismatch);
  assert.deepEqual(calls, ['configured', 'binding', 'reserve', 'binding']);
});
test('configuration failure, resolver mismatch and binding read failure fail closed', async () => {
  for (const overrides of [
    { getConfiguredCalendar: async () => ({ ...configured, primaryMailboxUserPrincipalName: 'wrong@example.test' }) },
    { getConfiguredCalendar: async () => { throw new Error('config missing'); } },
    { loadPersistedBinding: async () => { throw new Error('database unavailable'); } },
  ]) {
    const { calls, deps } = fixture(overrides);
    await assert.rejects(createTrustedMeetingReservation(deps)(input), TrustedMeetingBindingMismatch);
    assert.ok(!calls.includes('reserve'));
  }
});
