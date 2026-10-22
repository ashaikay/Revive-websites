import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleMeetingReminderDelivery,
  type ReminderDeliveryDependencies,
} from './meetingReminderDeliveryBoundary.ts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const proposalId = '44444444-4444-4444-8444-444444444444';
const deliveryId = '55555555-5555-4555-8555-555555555555';
const draftId = '66666666-6666-4666-8666-666666666666';
const instant = '2026-10-09T16:00:00.000Z';

const delivery = {
  id: deliveryId,
  workspace_id: workspaceId,
  meeting_proposal_id: proposalId,
  reminder_draft_id: draftId,
  approved_draft_version: 2,
  approved_draft_fingerprint: 'a'.repeat(64),
  status: 'approved_not_sent',
  approved_by_user_id: userId,
  approved_at: instant,
  send_authorized_by_user_id: null,
  send_authorized_at: null,
  provider_key: null,
  request_fingerprint: null,
  provider_reference: null,
  result_summary: null,
  failure_code: null,
  version: 1,
  created_at: instant,
  updated_at: instant,
};

function dependencies(overrides: Partial<ReminderDeliveryDependencies> = {}): ReminderDeliveryDependencies {
  return {
    allowedOrigin: 'http://localhost:5180',
    providerExecutionEnabled: false,
    getUserId: async () => userId,
    canManage: async () => true,
    approve: async () => delivery,
    deliver: async () => ({
      deliveryId,
      status: 'accepted_by_provider',
      providerInvoked: true,
      acceptedByProvider: true,
      deliveryConfirmed: false,
      automaticRetryAllowed: false,
      replayed: false,
    }),
    ...overrides,
  };
}

function request(body: Record<string, unknown>, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/functions/v1/rev-meeting-reminder-deliver', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:5180',
      Authorization: 'Bearer valid-token',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

test('approves the exact current reminder without invoking a provider', async () => {
  let delivered = false;
  const response = await handleMeetingReminderDelivery(request({
    operation: 'approve', workspaceId, requestId, meetingProposalId: proposalId,
  }), dependencies({ deliver: async () => { delivered = true; throw new Error('unexpected'); } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'approved_not_sent');
  assert.equal(result.displayStatus, 'Approved — not sent');
  assert.equal(result.providerInvoked, false);
  assert.equal(delivered, false);
});

test('requires separate explicit sending consent', async () => {
  const response = await handleMeetingReminderDelivery(request({
    operation: 'send', workspaceId, requestId, meetingProposalId: proposalId,
  }), dependencies());
  assert.equal(response.status, 400);
});

test('keeps the dedicated provider capability disabled before delivery dependencies', async () => {
  let delivered = false;
  const response = await handleMeetingReminderDelivery(request({
    operation: 'send', workspaceId, requestId, meetingProposalId: proposalId, sendConsent: true,
  }), dependencies({ deliver: async () => { delivered = true; throw new Error('unexpected'); } }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'provider_disabled');
  assert.equal(result.displayStatus, 'Email sending disabled — nothing sent');
  assert.equal(result.providerInvoked, false);
  assert.equal(delivered, false);
});

test('reports provider acceptance without claiming delivery confirmation', async () => {
  const response = await handleMeetingReminderDelivery(request({
    operation: 'send', workspaceId, requestId, meetingProposalId: proposalId, sendConsent: true,
  }), dependencies({ providerExecutionEnabled: true }));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.status, 'accepted_by_provider');
  assert.equal(result.displayStatus, 'Accepted by provider — delivery not confirmed');
  assert.equal(result.deliveryConfirmed, false);
  assert.equal(result.automaticRetryAllowed, false);
});

test('denies foreign origins, invalid authentication and unauthorized roles', async () => {
  const foreign = await handleMeetingReminderDelivery(request({
    operation: 'approve', workspaceId, requestId, meetingProposalId: proposalId,
  }, { Origin: 'https://foreign.test' }), dependencies());
  assert.equal(foreign.status, 403);

  const unauthenticated = await handleMeetingReminderDelivery(request({
    operation: 'approve', workspaceId, requestId, meetingProposalId: proposalId,
  }, { Authorization: '' }), dependencies());
  assert.equal(unauthenticated.status, 401);

  const unauthorized = await handleMeetingReminderDelivery(request({
    operation: 'approve', workspaceId, requestId, meetingProposalId: proposalId,
  }), dependencies({ canManage: async () => false }));
  assert.equal(unauthorized.status, 403);
});
