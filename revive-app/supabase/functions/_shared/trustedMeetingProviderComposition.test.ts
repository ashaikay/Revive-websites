import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrustedMeetingProviderComposition } from './trustedMeetingProviderComposition.ts';

test('composed real adapters remain unreachable behind the hard default gate', async () => {
  const calls: string[] = [];
  const client = {
    from: () => { calls.push('database-read'); throw new Error('read reached'); },
    rpc: () => { calls.push('provider-claim-or-result'); throw new Error('RPC reached'); },
  };
  const execute = createTrustedMeetingProviderComposition({
    trustedClient: client as never,
    trustedWorkspaceId: '11111111-1111-4111-8111-111111111111',
    liveWorkspaceId: '44444444-4444-4444-8444-444444444444',
    primaryMailboxUserPrincipalName: 'owner@example.test',
    getAccessToken: async () => { calls.push('credential'); throw new Error('token reached'); },
    invokeGraph: async () => { calls.push('Graph'); throw new Error('Graph reached'); },
  });
  await assert.rejects(execute({
    executionId: '22222222-2222-4222-8222-222222222222',
    correlationId: '33333333-3333-4333-8333-333333333333',
    requestFingerprint: 'a'.repeat(64), bindingVersion: 1,
  }), /disabled/);
  assert.deepEqual(calls, []);
});

test('matching workspace reaches fake Graph after durable claim while mismatch remains blocked', async () => {
  const workspaceId = '11111111-1111-4111-8111-111111111111';
  const executionId = '22222222-2222-4222-8222-222222222222';
  const actionId = '33333333-3333-4333-8333-333333333333';
  const approvalId = '44444444-4444-4444-8444-444444444444';
  const correlationId = '55555555-5555-4555-8555-555555555555';
  const fingerprint = 'a'.repeat(64);
  const attempt = { executionId, correlationId, requestFingerprint: fingerprint, bindingVersion: 1 };
  const rows: Record<string, Record<string, unknown>> = {
    rev_action_executions: { workspace_id: workspaceId, action_id: actionId, approval_id: approvalId,
      status: 'prepared', mode: 'dry_run', provider_outcome: 'provider_not_invoked', request_fingerprint: fingerprint,
      idempotency_key: `create-approved-meeting-event:${actionId}:v1`, action_version: 1, approval_fingerprint: fingerprint },
    rev_actions: { action_type: 'meeting_proposal', status: 'approved', execution_status: 'not_executed', action_version: 1 },
    approvals: { rev_action_id: actionId, decision: 'approved', action_version: 1, action_fingerprint: fingerprint },
    meeting_proposals: { approval_id: approvalId, proposal_version: 1, proposal_payload: { version: 1,
      title: 'Approved meeting', attendeeEmail: 'attendee@example.test', startAt: '2040-09-30T09:00:00.000Z',
      endAt: '2040-09-30T09:30:00.000Z', timezone: 'Europe/London', meetingMethod: 'online',
      locationDetails: '', notes: '' } },
  };
  const target = { execution_id: executionId, workspace_id: workspaceId,
    calendar_id: '77777777-7777-4777-8777-777777777777',
    connection_id: '88888888-8888-4888-8888-888888888888',
    credential_reference: '99999999-9999-4999-8999-999999999999', credential_revision: 1,
    provider_account_reference: 'owner@example.test', provider_calendar_reference: 'calendar-1',
    timezone: 'Europe/London', consent_version: 1, workspace_binding_version: 1,
    target_fingerprint: 'b'.repeat(64) };

  for (const liveWorkspaceId of [
    workspaceId,
    '66666666-6666-4666-8666-666666666666',
  ]) {
    const calls: string[] = [];
    const client = {
      from: (table: string) => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => {
        calls.push(`read:${table}`); return { data: rows[table], error: null };
      } }) }) }) }),
      rpc: async (name: string) => {
        if (name === 'load_rev_meeting_execution_calendar_target') {
          calls.push('target'); return { data: [target], error: null };
        }
        if (name === 'claim_rev_meeting_provider_attempt') {
          calls.push('claim'); return { data: { id: executionId, correlation_id: correlationId,
            request_fingerprint: fingerprint, capability: 'CREATE_APPROVED_MEETING_EVENT', mode: 'live',
            status: 'in_progress', provider_outcome: 'provider_attempt_claimed' }, error: null };
        }
        calls.push('record'); return { data: { id: executionId, capability: 'CREATE_APPROVED_MEETING_EVENT',
          mode: 'live', status: 'succeeded', provider_outcome: 'accepted_by_provider' }, error: null };
      },
    };
    const execute = createTrustedMeetingProviderComposition({
      trustedClient: client as never, trustedWorkspaceId: workspaceId, liveWorkspaceId,
      getAccessToken: async targetSnapshot => {
        assert.equal(targetSnapshot.executionId, executionId);
        assert.equal(targetSnapshot.calendarId, target.calendar_id);
        calls.push('token');
        return 'fake-token';
      },
      invokeGraph: async () => { calls.push('graph'); return { provider: 'microsoft_graph', outcome: 'created',
        providerEventReference: 'fake-event', actualCost: 0 }; },
    });
    if (liveWorkspaceId === workspaceId) {
      assert.deepEqual(await execute(attempt), { executionId, outcome: 'accepted_by_provider', status: 'succeeded' });
      assert.deepEqual(calls, ['read:rev_action_executions', 'read:rev_actions', 'read:approvals',
        'read:meeting_proposals', 'target', 'token', 'claim', 'graph', 'record']);
    } else {
      await assert.rejects(execute(attempt), /disabled/);
      assert.deepEqual(calls, []);
    }
  }
});
