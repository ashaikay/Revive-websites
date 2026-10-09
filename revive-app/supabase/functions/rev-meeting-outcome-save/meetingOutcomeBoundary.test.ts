import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handleMeetingOutcomeSave,
  type MeetingOutcomeDependencies,
  type MeetingOutcomeSaveInput,
} from './meetingOutcomeBoundary.ts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const proposalId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const outcomeId = '55555555-5555-4555-8555-555555555555';
const origin = 'http://localhost:5180';
const now = Date.parse('2026-10-09T12:00:00.000Z');
const body = {
  workspaceId,
  requestId,
  meetingProposalId: proposalId,
  outcomeType: 'held',
  summary: 'Requirements confirmed; send the agreed proposal next.',
  occurredAt: '2026-10-09T11:00:00.000Z',
  expectedVersion: 0,
};

function request(value: unknown = body, headers: Record<string, string> = {}, method = 'POST') {
  return new Request('https://example.test', {
    method,
    headers: {
      Origin: origin,
      Authorization: 'Bearer local-test-token',
      'Content-Type': 'application/json',
      ...headers,
    },
    body: ['OPTIONS', 'GET'].includes(method) ? undefined : JSON.stringify(value),
  });
}

function fixture() {
  const calls: MeetingOutcomeSaveInput[] = [];
  let authCalls = 0;
  let roleCalls = 0;
  const dependencies: MeetingOutcomeDependencies = {
    allowedOrigin: origin,
    now: () => now,
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
        id: outcomeId,
        workspace_id: input.target_workspace_id,
        meeting_proposal_id: input.target_meeting_proposal_id,
        outcome_type: input.target_outcome_type,
        summary: input.target_summary,
        occurred_at: input.target_occurred_at,
        recorded_by_user_id: input.initiating_user_id,
        version: input.expected_version + 1,
        created_at: '2026-10-09T11:30:00+00:00',
        updated_at: '2026-10-09T11:30:00+00:00',
        private_value: 'never return',
      };
    },
  };
  return { dependencies, calls, counts: () => ({ authCalls, roleCalls }) };
}

test('verified owner/admin save forwards the exact contract and returns a sanitized no-store result', async () => {
  const value = fixture();
  const response = await handleMeetingOutcomeSave(request(), value.dependencies);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(value.calls[0], {
    target_workspace_id: workspaceId,
    initiating_user_id: actorId,
    target_request_id: requestId,
    target_meeting_proposal_id: proposalId,
    target_outcome_type: 'held',
    target_summary: body.summary,
    target_occurred_at: body.occurredAt,
    expected_version: 0,
  });
  const result = await response.json();
  assert.equal(result.private_value, undefined);
  assert.equal(result.outcome_type, 'held');
});

test('only held, no_show and cancelled are accepted', async () => {
  for (const outcomeType of ['held', 'no_show', 'cancelled']) {
    const value = fixture();
    assert.equal((await handleMeetingOutcomeSave(request({ ...body, outcomeType }), value.dependencies)).status, 200);
  }
  for (const outcomeType of ['rescheduled', 'sale', 'attended', '', null]) {
    const value = fixture();
    assert.equal((await handleMeetingOutcomeSave(request({ ...body, outcomeType }), value.dependencies)).status, 400);
    assert.equal(value.calls.length, 0);
    assert.deepEqual(value.counts(), { authCalls: 0, roleCalls: 0 });
  }
});

test('invalid summaries, times, versions and injected fields stop before authority or writes', async () => {
  for (const patch of [
    { summary: '' },
    { summary: ' padded ' },
    { summary: 'x'.repeat(1001) },
    { occurredAt: '2026-10-09T12:00:01.000Z' },
    { occurredAt: '2026-02-30T10:00:00.000Z' },
    { expectedVersion: -1 },
    { expectedVersion: 1.5 },
    { actorUserId: actorId },
  ]) {
    const value = fixture();
    assert.equal((await handleMeetingOutcomeSave(request({ ...body, ...patch }), value.dependencies)).status, 400);
    assert.equal(value.calls.length, 0);
    assert.deepEqual(value.counts(), { authCalls: 0, roleCalls: 0 });
  }
});

test('invalid sessions and denied manager authority never save', async () => {
  const invalid = fixture();
  invalid.dependencies.getUserId = async () => null;
  assert.equal((await handleMeetingOutcomeSave(request(), invalid.dependencies)).status, 401);
  assert.equal(invalid.calls.length, 0);

  const denied = fixture();
  denied.dependencies.canManage = async () => false;
  assert.equal((await handleMeetingOutcomeSave(request(), denied.dependencies)).status, 403);
  assert.equal(denied.calls.length, 0);
});

test('origin, method, bearer and content type refuse writes and preflight is side-effect free', async () => {
  for (const response of [
    handleMeetingOutcomeSave(request(body, { Origin: 'https://foreign.test' }), fixture().dependencies),
    handleMeetingOutcomeSave(request(body, {}, 'GET'), fixture().dependencies),
    handleMeetingOutcomeSave(request(body, { Authorization: '' }), fixture().dependencies),
    handleMeetingOutcomeSave(request(body, { 'Content-Type': 'text/plain' }), fixture().dependencies),
  ]) {
    assert.ok((await response).status >= 400);
  }
  const value = fixture();
  const preflight = await handleMeetingOutcomeSave(request(undefined, {}, 'OPTIONS'), value.dependencies);
  assert.equal(preflight.status, 204);
  assert.deepEqual(value.counts(), { authCalls: 0, roleCalls: 0 });
  assert.equal(value.calls.length, 0);
});

test('database failures and mismatched results never become success-shaped replies', async () => {
  const failure = fixture();
  failure.dependencies.save = async () => {
    throw new Error('private database detail');
  };
  const failed = await handleMeetingOutcomeSave(request(), failure.dependencies);
  assert.equal(failed.status, 403);
  assert.ok(!(await failed.text()).includes('private'));

  const mismatch = fixture();
  const save = mismatch.dependencies.save;
  mismatch.dependencies.save = async (input) => ({
    ...await save(input) as object,
    outcome_type: 'cancelled',
  });
  assert.equal((await handleMeetingOutcomeSave(request(), mismatch.dependencies)).status, 403);
});
