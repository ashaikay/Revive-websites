import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MicrosoftGraphOutcomeUnknownError,
  MicrosoftGraphRejectedError,
} from '../rev-email-execute/microsoftGraphProvider.ts';
import {
  executeClaimedMeetingReminderEmail,
  type ClaimedMeetingReminderEmail,
} from './meetingReminderEmailOrchestrator.ts';

const claim: ClaimedMeetingReminderEmail = {
  deliveryId: '11111111-1111-4111-8111-111111111111',
  requestFingerprint: 'a'.repeat(64),
  status: 'provider_attempt_claimed',
  replayed: false,
  email: {
    recipient: 'customer@example.test',
    subject: 'Reminder: Discovery call',
    body: 'Please remember our meeting.',
  },
};

test('invokes the fake provider once and records acceptance without delivery confirmation', async () => {
  let sends = 0;
  const records: unknown[] = [];
  const result = await executeClaimedMeetingReminderEmail(claim, {
    sendEmail: async () => {
      sends += 1;
      return { outcome: 'accepted_by_provider', acceptedAt: new Date().toISOString(), actualCost: 0 };
    },
    recordResult: async (value) => { records.push(value); },
  });
  assert.equal(sends, 1);
  assert.equal(records.length, 1);
  assert.equal(result.status, 'accepted_by_provider');
  assert.equal(result.deliveryConfirmed, false);
  assert.equal(result.automaticRetryAllowed, false);
});

test('records known rejection and uncertain provider outcomes without retry', async () => {
  for (const [error, status] of [
    [new MicrosoftGraphRejectedError(403, 'denied'), 'rejected_by_provider'],
    [new MicrosoftGraphOutcomeUnknownError(), 'provider_outcome_unknown'],
  ] as const) {
    const records: Array<{ providerOutcome: string }> = [];
    const result = await executeClaimedMeetingReminderEmail(claim, {
      sendEmail: async () => { throw error; },
      recordResult: async (value) => { records.push(value); },
    });
    assert.equal(result.status, status);
    assert.equal(result.automaticRetryAllowed, false);
    assert.equal(records[0].providerOutcome, status);
  }
});

test('never invokes the provider when the exact request is replayed after claim', async () => {
  let sends = 0;
  const result = await executeClaimedMeetingReminderEmail({
    ...claim,
    replayed: true,
    email: undefined,
  }, {
    sendEmail: async () => {
      sends += 1;
      return { outcome: 'accepted_by_provider', acceptedAt: new Date().toISOString(), actualCost: 0 };
    },
    recordResult: async () => undefined,
  });
  assert.equal(sends, 0);
  assert.equal(result.status, 'provider_attempt_claimed');
  assert.equal(result.automaticRetryAllowed, false);
});
