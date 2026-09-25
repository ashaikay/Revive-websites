import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMeetingProviderWorkflow, MeetingProviderResultUnavailable, type MeetingProviderWorkflowDependencies } from './meetingProviderWorkflow.ts';
const attempt = { executionId: '11111111-1111-4111-8111-111111111111', correlationId: '22222222-2222-4222-8222-222222222222', requestFingerprint: 'a'.repeat(64), bindingVersion: 1 };
const graphRequest = { accessToken: 'test-only-token', workspaceId: 'workspace', trustedWorkspaceId: 'workspace', mailboxUserPrincipalName: 'owner@example.test', trustedMailboxUserPrincipalName: 'owner@example.test', idempotencyKey: 'stable', snapshot: {} } as Awaited<ReturnType<MeetingProviderWorkflowDependencies['loadGraphRequest']>>;
function fixture() {
  const calls: string[] = [];
  const deps: MeetingProviderWorkflowDependencies = {
    loadGraphRequest: async () => { calls.push('credentials'); return graphRequest; },
    claim: async input => { calls.push('claim'); assert.deepEqual(input, attempt); return input; },
    invokeGraph: async input => { calls.push('graph'); assert.equal(input, graphRequest); return { provider: 'microsoft_graph', outcome: 'created', providerEventReference: 'graph-event-id', actualCost: 0 }; },
    record: async input => { calls.push('record'); return { executionId: input.executionId, outcome: input.outcome, status: input.outcome === 'accepted_by_provider' ? 'succeeded' : 'failed' }; },
  };
  return { calls, deps };
}
test('default hard gate stops before claim and Graph', async () => {
  const { calls, deps } = fixture();
  await assert.rejects(createMeetingProviderWorkflow(deps)(attempt), /disabled/);
  assert.deepEqual(calls, []);
});
test('simulated enabled path claims once before one Graph call then records acceptance', async () => {
  const { calls, deps } = fixture();
  assert.deepEqual(await createMeetingProviderWorkflow(deps, true)(attempt),
    { executionId: attempt.executionId, outcome: 'accepted_by_provider', status: 'succeeded' });
  assert.deepEqual(calls, ['credentials', 'claim', 'graph', 'record']);
});
test('claim refusal stops before provider', async () => {
  const { calls, deps } = fixture();
  deps.claim = async () => { calls.push('claim'); throw new Error('already claimed'); };
  await assert.rejects(createMeetingProviderWorkflow(deps, true)(attempt));
  assert.deepEqual(calls, ['credentials', 'claim']);
});
test('definite rejection records rejected; timeout and malformed success record unknown', async () => {
  for (const [error, expected] of [
    [{ name: 'MicrosoftGraphCalendarEventError', kind: 'provider_rejected' }, 'rejected_by_provider'],
    [new Error('timeout'), 'provider_outcome_unknown'],
  ] as const) {
    const { calls, deps } = fixture();
    deps.invokeGraph = async () => { calls.push('graph'); throw error; };
    deps.record = async input => { calls.push('record'); assert.equal(input.outcome, expected); assert.equal(input.providerReference, null); return { executionId: input.executionId, outcome: input.outcome, status: 'failed' }; };
    await createMeetingProviderWorkflow(deps, true)(attempt);
    assert.deepEqual(calls, ['credentials', 'claim', 'graph', 'record']);
  }
  const { calls, deps } = fixture();
  deps.invokeGraph = async () => { calls.push('graph'); return { provider: 'microsoft_graph', outcome: 'created', providerEventReference: '', actualCost: 0 }; };
  deps.record = async input => { calls.push('record'); assert.equal(input.outcome, 'provider_outcome_unknown'); return { executionId: input.executionId, outcome: input.outcome, status: 'failed' }; };
  await createMeetingProviderWorkflow(deps, true)(attempt);
  assert.deepEqual(calls, ['credentials', 'claim', 'graph', 'record']);
});
test('failed durable result never retries Graph', async () => {
  const { calls, deps } = fixture();
  deps.record = async () => { calls.push('record'); throw new Error('database unavailable'); };
  await assert.rejects(createMeetingProviderWorkflow(deps, true)(attempt), MeetingProviderResultUnavailable);
  assert.deepEqual(calls, ['credentials', 'claim', 'graph', 'record']);
});
test('credential lookup failure stops before durable claim and provider call', async () => {
  const { calls, deps } = fixture();
  deps.loadGraphRequest = async () => { calls.push('credentials'); throw new Error('credentials unavailable'); };
  await assert.rejects(createMeetingProviderWorkflow(deps, true)(attempt));
  assert.deepEqual(calls, ['credentials']);
});
