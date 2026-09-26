import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMeetingProviderHttpService } from './meetingProviderHttpService.ts';

const request = { requestId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333' };
const reservation = { status: 'provider_disabled', displayStatus: 'DRY RUN — NOTHING BOOKED',
  executionEnabled: false, providerInvoked: false, eventCreated: false,
  providerOutcome: 'provider_not_invoked', executionId: '44444444-4444-4444-8444-444444444444',
  correlationId: request.requestId } as const;
const snapshot = { executionId: reservation.executionId, workspaceId: request.workspaceId,
  actionId: request.actionId, bindingVersion: 1, requestFingerprint: 'a'.repeat(64) };

test('default HTTP service only performs authenticated disabled reservation', async () => {
  const calls: string[] = [];
  const run = createMeetingProviderHttpService({
    executeDisabled: async input => { calls.push('authorized reservation'); assert.equal(input, request); return reservation; },
    loadSnapshot: async () => { calls.push('snapshot'); throw new Error('snapshot reached'); },
    createProvider: () => { calls.push('provider'); throw new Error('provider constructed'); },
  });
  assert.deepEqual(await run(request), reservation);
  assert.deepEqual(calls, ['authorized reservation']);
});

test('test enabled path forwards only durable attempt material and maps all terminal outcomes', async () => {
  for (const [outcome, status, eventCreated, invitationSent] of [
    ['accepted_by_provider', 'event_created', true, null],
    ['rejected_by_provider', 'provider_rejected', false, false],
    ['provider_outcome_unknown', 'outcome_unknown', null, null],
  ] as const) {
    const calls: string[] = [];
    const run = createMeetingProviderHttpService({
      executeDisabled: async () => { calls.push('authorized reservation'); return reservation; },
      loadSnapshot: async executionId => { calls.push('snapshot'); assert.equal(executionId, reservation.executionId); return snapshot as never; },
      createProvider: () => { calls.push('provider'); return async attempt => {
        assert.deepEqual(attempt, { executionId: reservation.executionId, correlationId: reservation.correlationId,
          requestFingerprint: snapshot.requestFingerprint, bindingVersion: 1 });
        return { executionId: reservation.executionId, outcome,
          status: outcome === 'accepted_by_provider' ? 'succeeded' : 'failed' };
      }; },
    }, true);
    const result = await run(request);
    assert.equal(result.status, status);
    assert.equal(result.eventCreated, eventCreated);
    assert.equal(result.invitationSent, invitationSent);
    assert.deepEqual(calls, ['authorized reservation', 'snapshot', 'provider']);
  }
});

test('test enabled path refuses mismatched durable snapshot before provider construction', async () => {
  let constructed = false;
  const run = createMeetingProviderHttpService({
    executeDisabled: async () => reservation,
    loadSnapshot: async () => ({ ...snapshot, workspaceId: 'other-workspace' }) as never,
    createProvider: () => { constructed = true; throw new Error('provider constructed'); },
  }, true);
  await assert.rejects(run(request), /snapshot mismatch/);
  assert.equal(constructed, false);
});
