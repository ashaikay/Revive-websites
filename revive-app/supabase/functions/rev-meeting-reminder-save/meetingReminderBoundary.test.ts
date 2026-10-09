import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleMeetingReminderSave,
  type MeetingReminderDependencies,
  type MeetingReminderSaveInput,
} from './meetingReminderBoundary.ts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const proposalId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const draftId = '55555555-5555-4555-8555-555555555555';
const origin = 'http://localhost:5180';
const body = {
  workspaceId,
  requestId,
  meetingProposalId: proposalId,
  body: 'A plain-text reminder draft for the confirmed meeting.',
  expectedVersion: 0,
};

function request(value: unknown = body, headers: Record<string, string> = {}, method = 'POST') {
  return new Request('https://example.test', {
    method,
    headers: {
      Origin: origin,
      Authorization: 'Bearer test-token',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: ['OPTIONS', 'GET'].includes(method) ? undefined : JSON.stringify(value),
  });
}

function fixture() {
  const calls: MeetingReminderSaveInput[] = [];
  let authCalls = 0;
  let roleCalls = 0;
  const dependencies: MeetingReminderDependencies = {
    allowedOrigin: origin,
    getUserId: async () => {
      authCalls += 1;
      return actorId;
    },
    canManage: async () => {
      roleCalls += 1;
      return true;
    },
    save: async (input) => {
      calls.push(input);
      return {
        id: draftId,
        workspace_id: input.target_workspace_id,
        meeting_proposal_id: input.target_meeting_proposal_id,
        body: input.target_body,
        prepared_by_user_id: input.initiating_user_id,
        version: input.expected_version + 1,
        created_at: '2026-10-09T12:00:00+00:00',
        updated_at: '2026-10-09T12:00:00+00:00',
        private_value: 'never return',
      };
    },
  };
  return { dependencies, calls, counts: () => ({ authCalls, roleCalls }) };
}

test('verified owner/admin save forwards the exact draft contract and returns a sanitized result', async () => {
  const value = fixture();
  const response = await handleMeetingReminderSave(request(), value.dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(value.calls[0], {
    target_workspace_id: workspaceId,
    initiating_user_id: actorId,
    target_request_id: requestId,
    target_meeting_proposal_id: proposalId,
    target_body: body.body,
    expected_version: 0,
  });
  const result = await response.json();
  assert.equal(result.private_value, undefined);
  assert.equal(result.body, body.body);
});

test('blank, padded, oversized, invalid-version and injected input stops before authority', async () => {
  for (const patch of [
    { body: '' },
    { body: ' padded ' },
    { body: 'x'.repeat(2001) },
    { expectedVersion: -1 },
    { expectedVersion: 1.5 },
    { channel: 'email' },
  ]) {
    const value = fixture();
    assert.equal((await handleMeetingReminderSave(request({ ...body, ...patch }), value.dependencies)).status, 400);
    assert.equal(value.calls.length, 0);
    assert.deepEqual(value.counts(), { authCalls: 0, roleCalls: 0 });
  }
});

test('invalid sessions and denied manager authority never save', async () => {
  const invalid = fixture();
  invalid.dependencies.getUserId = async () => null;
  assert.equal((await handleMeetingReminderSave(request(), invalid.dependencies)).status, 401);
  assert.equal(invalid.calls.length, 0);

  const denied = fixture();
  denied.dependencies.canManage = async () => false;
  assert.equal((await handleMeetingReminderSave(request(), denied.dependencies)).status, 403);
  assert.equal(denied.calls.length, 0);
});

test('origin, method, bearer and content type refuse writes and preflight is side-effect free', async () => {
  for (const response of [
    handleMeetingReminderSave(request(body, { Origin: 'https://foreign.test' }), fixture().dependencies),
    handleMeetingReminderSave(request(body, {}, 'GET'), fixture().dependencies),
    handleMeetingReminderSave(request(body, { Authorization: '' }), fixture().dependencies),
    handleMeetingReminderSave(request(body, { 'Content-Type': 'text/plain' }), fixture().dependencies),
  ]) {
    assert.ok((await response).status >= 400);
  }
  const value = fixture();
  const preflight = await handleMeetingReminderSave(request(undefined, {}, 'OPTIONS'), value.dependencies);
  assert.equal(preflight.status, 204);
  assert.deepEqual(value.counts(), { authCalls: 0, roleCalls: 0 });
  assert.equal(value.calls.length, 0);
});

test('database failures and mismatched results never become success-shaped replies', async () => {
  const failure = fixture();
  failure.dependencies.save = async () => {
    throw new Error('private database detail');
  };
  const failed = await handleMeetingReminderSave(request(), failure.dependencies);
  assert.equal(failed.status, 403);
  assert.ok(!(await failed.text()).includes('private'));

  const mismatch = fixture();
  const save = mismatch.dependencies.save;
  mismatch.dependencies.save = async (input) => ({
    ...await save(input) as object,
    body: 'different draft',
  });
  assert.equal((await handleMeetingReminderSave(request(), mismatch.dependencies)).status, 403);
});
