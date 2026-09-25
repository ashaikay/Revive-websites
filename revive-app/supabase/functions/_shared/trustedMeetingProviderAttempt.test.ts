import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrustedMeetingProviderAttempt, type MeetingProviderAttemptClient } from './trustedMeetingProviderAttempt.ts';
const executionId = '11111111-1111-4111-8111-111111111111';
const correlationId = '22222222-2222-4222-8222-222222222222';
const fingerprint = 'a'.repeat(64);
const claimInput = { executionId, correlationId, requestFingerprint: fingerprint, bindingVersion: 2 };
const claimRow = { id: executionId, correlation_id: correlationId, request_fingerprint: fingerprint, capability: 'CREATE_APPROVED_MEETING_EVENT', mode: 'live', status: 'in_progress', provider_outcome: 'provider_attempt_claimed' };
const resultRow = { id: executionId, capability: 'CREATE_APPROVED_MEETING_EVENT', mode: 'live', status: 'succeeded', provider_outcome: 'accepted_by_provider' };
test('passes only trusted claim identifiers and verifies durable claimed state', async () => {
  let calls = 0;
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    calls++; assert.equal(name, 'claim_rev_meeting_provider_attempt');
    assert.deepEqual(args, { target_execution_id: executionId, expected_request_fingerprint: fingerprint, expected_binding_version: 2 });
    return { data: claimRow, error: null };
  } } as MeetingProviderAttemptClient;
  assert.deepEqual(await createTrustedMeetingProviderAttempt(client).claim(claimInput), claimInput);
  assert.equal(calls, 1);
});
test('invalid inputs, database refusal and mismatched claims fail closed', async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: { ...claimRow, status: 'prepared' }, error: null }; } } as unknown as MeetingProviderAttemptClient;
  const adapter = createTrustedMeetingProviderAttempt(client);
  await assert.rejects(adapter.claim({ ...claimInput, requestFingerprint: 'invalid' }));
  assert.equal(calls, 0);
  await assert.rejects(adapter.claim(claimInput));
  assert.equal(calls, 1);
});
test('records accepted event reference and verifies terminal outcome', async () => {
  const client = { rpc: async (name: string, args: Record<string, unknown>) => {
    assert.equal(name, 'record_rev_meeting_provider_result');
    assert.deepEqual(args, { target_execution_id: executionId, target_provider_outcome: 'accepted_by_provider', target_provider_reference: 'graph-event-1' });
    return { data: resultRow, error: null };
  } } as MeetingProviderAttemptClient;
  assert.deepEqual(await createTrustedMeetingProviderAttempt(client).record({ executionId, outcome: 'accepted_by_provider', providerReference: 'graph-event-1' }),
    { executionId, outcome: 'accepted_by_provider', status: 'succeeded' });
});
test('refuses accepted without event reference and mismatched terminal response', async () => {
  let calls = 0;
  const client = { rpc: async () => { calls++; return { data: resultRow, error: null }; } } as unknown as MeetingProviderAttemptClient;
  const adapter = createTrustedMeetingProviderAttempt(client);
  await assert.rejects(adapter.record({ executionId, outcome: 'accepted_by_provider', providerReference: null }));
  assert.equal(calls, 0);
  await assert.rejects(adapter.record({ executionId, outcome: 'provider_outcome_unknown', providerReference: null }));
  assert.equal(calls, 1);
});
