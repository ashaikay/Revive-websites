import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMeetingProviderHttpService } from './meetingProviderHttpService.ts';

const request = { requestId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222', actionId: '33333333-3333-4333-8333-333333333333' };
const dryRunRequest = { ...request, intent: 'dry_run' as const };
const liveRequest = { ...request, intent: 'live' as const, confirmLiveBooking: true as const };
const reservation = { status: 'provider_disabled', displayStatus: 'DRY RUN — NOTHING BOOKED',
  executionEnabled: false, providerInvoked: false, eventCreated: false,
  providerOutcome: 'provider_not_invoked', executionId: '44444444-4444-4444-8444-444444444444',
  correlationId: request.requestId } as const;
const snapshot = { executionId: reservation.executionId, workspaceId: request.workspaceId,
  actionId: request.actionId, bindingVersion: 1, requestFingerprint: 'a'.repeat(64) };

test('dry-run intent cannot reach Graph even when the exact workspace gate is enabled', async () => {
  const calls: string[] = [];
  const run = createMeetingProviderHttpService({
    executeDisabled: async input => { calls.push('authorized reservation'); assert.deepEqual(input, request); return reservation; },
    loadSnapshot: async () => { calls.push('snapshot'); throw new Error('snapshot reached'); },
    createProvider: () => { calls.push('provider'); throw new Error('provider constructed'); },
  }, request.workspaceId);
  assert.deepEqual(await run(dryRunRequest), reservation);
  assert.deepEqual(calls, ['authorized reservation']);
});

test('live cannot run without exact explicit intent and confirmation', async () => {
  let reservations = 0;
  const run = createMeetingProviderHttpService({
    executeDisabled: async () => { reservations++; return reservation; },
    loadSnapshot: async () => { throw new Error('snapshot reached'); },
    createProvider: () => { throw new Error('provider constructed'); },
  }, request.workspaceId);
  for (const unsafe of [request, { ...request, intent: 'live' },
    { ...request, intent: 'live', confirmLiveBooking: false },
    { ...request, intent: 'dry_run', confirmLiveBooking: true }]) {
    await assert.rejects(run(unsafe), /intent unavailable/);
  }
  assert.equal(reservations, 0);
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
    }, request.workspaceId);
    const result = await run(liveRequest);
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
  }, request.workspaceId);
  await assert.rejects(run(liveRequest), /snapshot mismatch/);
  assert.equal(constructed, false);
});

test('activation for another workspace stays disabled before snapshot and provider construction', async () => {
  const calls: string[] = [];
  const run = createMeetingProviderHttpService({
    executeDisabled: async () => { calls.push('authorized reservation'); return reservation; },
    loadSnapshot: async () => { calls.push('snapshot'); throw new Error('snapshot reached'); },
    createProvider: () => { calls.push('provider'); throw new Error('provider constructed'); },
  }, '55555555-5555-4555-8555-555555555555');
  assert.deepEqual(await run(liveRequest), reservation);
  assert.deepEqual(calls, ['authorized reservation']);
});
