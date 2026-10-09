import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrustedMeetingDelegatedGraphTokenSupplier, type TrustedMeetingCredentialClient } from './trustedMeetingDelegatedGraphTokenSupplier.ts';
import type { TrustedMeetingExecutionSnapshot } from './trustedMeetingExecutionReadModel.ts';

const snapshot: TrustedMeetingExecutionSnapshot = {
  executionId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  actionId: '33333333-3333-4333-8333-333333333333',
  approvalId: '44444444-4444-4444-8444-444444444444',
  requestFingerprint: 'a'.repeat(64),
  bindingVersion: 3,
  calendarId: '55555555-5555-4555-8555-555555555555',
  connectionId: '66666666-6666-4666-8666-666666666666',
  credentialReference: '77777777-7777-4777-8777-777777777777',
  credentialRevision: 4,
  consentVersion: 2,
  calendarReference: 'customer@example.test',
  providerCalendarReference: 'calendar-secret-id',
  targetFingerprint: 'b'.repeat(64),
  timezone: 'Europe/London',
  semanticIdempotencyKey: 'create-approved-meeting-event:action:v1',
  proposal: {},
};
const credential = {
  execution_id: snapshot.executionId,
  workspace_id: snapshot.workspaceId,
  calendar_id: snapshot.calendarId,
  connection_id: snapshot.connectionId,
  credential_reference: snapshot.credentialReference,
  credential_revision: snapshot.credentialRevision,
  consent_version: snapshot.consentVersion,
  provider_account_reference: snapshot.calendarReference,
  provider_calendar_reference: snapshot.providerCalendarReference,
  timezone: snapshot.timezone,
  consent_version: 2,
  workspace_binding_version: snapshot.bindingVersion,
  target_fingerprint: snapshot.targetFingerprint,
  consent_by_user_id: '88888888-8888-4888-8888-888888888888',
  refresh_token: 'vault-refresh-token-test-only',
};
const oauthConfig = {
  clientId: '99999999-9999-4999-8999-999999999999',
  clientSecret: 'server-client-secret-test-only',
  authority: 'organizations',
  redirectUri: 'http://localhost:5180/calendar/outlook/callback',
};

test('loads only the reserved credential, requires write scope, and persists refresh rotation by CAS', async () => {
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client: TrustedMeetingCredentialClient = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'load_rev_meeting_calendar_credential') return { data: [credential], error: null };
      return { data: [{ credential_reference: snapshot.credentialReference, revision: 5 }], error: null };
    },
  };
  const token = await createTrustedMeetingDelegatedGraphTokenSupplier(client, () => oauthConfig, async (input, init) => {
    assert.equal(String(input), 'https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
    const body = new URLSearchParams(String(init?.body));
    assert.equal(body.get('grant_type'), 'refresh_token');
    assert.equal(body.get('refresh_token'), credential.refresh_token);
    assert.equal(body.get('scope'), 'offline_access https://graph.microsoft.com/Calendars.ReadWrite');
    return Response.json({
      access_token: 'delegated-write-access-token',
      refresh_token: 'rotated-vault-token-test-only',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'https://graph.microsoft.com/Calendars.ReadWrite',
    });
  })(snapshot);
  assert.equal(token, 'delegated-write-access-token');
  assert.deepEqual(calls, [
    { name: 'load_rev_meeting_calendar_credential', args: { target_execution_id: snapshot.executionId } },
    { name: 'rotate_rev_meeting_calendar_credential', args: {
      target_execution_id: snapshot.executionId,
      expected_revision: snapshot.credentialRevision,
      target_refresh_token: 'rotated-vault-token-test-only',
    } },
  ]);
});

test('mismatched reserved binding and read-only grant stop before refresh or rotation', async () => {
  let refreshCalls = 0;
  let rotationCalls = 0;
  const changedTargetClient: TrustedMeetingCredentialClient = {
    rpc: async name => {
      if (name === 'load_rev_meeting_calendar_credential') return {
        data: [{ ...credential, provider_calendar_reference: 'another-calendar' }], error: null,
      };
      rotationCalls++;
      return { data: [], error: null };
    },
  };
  await assert.rejects(createTrustedMeetingDelegatedGraphTokenSupplier(
    changedTargetClient, () => oauthConfig, async () => {
      refreshCalls++;
      return Response.json({});
    })(snapshot), /credential unavailable/);
  assert.equal(refreshCalls, 0);
  assert.equal(rotationCalls, 0);

  const readOnlyGrantClient: TrustedMeetingCredentialClient = {
    rpc: async name => name === 'load_rev_meeting_calendar_credential'
      ? { data: [credential], error: null }
      : { data: [], error: new Error('rotation must not be called') },
  };
  await assert.rejects(createTrustedMeetingDelegatedGraphTokenSupplier(
    readOnlyGrantClient, () => oauthConfig, async () => {
      refreshCalls++;
      return Response.json({
        access_token: 'read-only-access-token',
        token_type: 'Bearer',
        expires_in: 3600,
        scope: 'https://graph.microsoft.com/Calendars.Read',
      });
    })(snapshot), /authentication unavailable/);
  assert.equal(refreshCalls, 1);
});

test('stale credential rotation fails closed before an event request can be returned', async () => {
  let calls = 0;
  const client: TrustedMeetingCredentialClient = {
    rpc: async name => {
      calls++;
      return name === 'load_rev_meeting_calendar_credential'
        ? { data: [credential], error: null }
        : { data: [{ credential_reference: snapshot.credentialReference, revision: snapshot.credentialRevision }], error: null };
    },
  };
  await assert.rejects(createTrustedMeetingDelegatedGraphTokenSupplier(client, () => oauthConfig, async () =>
    Response.json({
      access_token: 'delegated-write-access-token',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'https://graph.microsoft.com/Calendars.ReadWrite',
    }))(snapshot), /credential unavailable/);
  assert.equal(calls, 2);
});
