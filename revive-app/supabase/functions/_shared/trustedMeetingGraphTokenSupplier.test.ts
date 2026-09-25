import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrustedMeetingGraphTokenSupplier } from './trustedMeetingGraphTokenSupplier.ts';
import { createTrustedMeetingProviderComposition } from './trustedMeetingProviderComposition.ts';

const config = () => ({
  tenantId: '11111111-1111-4111-8111-111111111111',
  clientId: '22222222-2222-4222-8222-222222222222',
  clientSecret: 'test-secret-never-sent-to-Graph',
});

test('disabled composition never reads configuration or contacts Microsoft token endpoint', async () => {
  const calls: string[] = [];
  const tokenSupplier = createTrustedMeetingGraphTokenSupplier(
    () => { calls.push('credential configuration'); return config(); },
    (async () => { calls.push('token HTTP'); throw new Error('HTTP reached'); }) as typeof fetch,
  );
  const execute = createTrustedMeetingProviderComposition({
    trustedClient: { from: () => { calls.push('database'); throw new Error('read reached'); }, rpc: () => { calls.push('RPC'); throw new Error('RPC reached'); } } as never,
    trustedWorkspaceId: '11111111-1111-4111-8111-111111111111',
    primaryMailboxUserPrincipalName: 'owner@example.test',
    getAccessToken: tokenSupplier,
    invokeGraph: async () => { calls.push('Graph'); throw new Error('Graph reached'); },
  });
  await assert.rejects(execute({
    executionId: '33333333-3333-4333-8333-333333333333',
    correlationId: '44444444-4444-4444-8444-444444444444',
    requestFingerprint: 'a'.repeat(64), bindingVersion: 1,
  }), /disabled/);
  assert.deepEqual(calls, []);
});

test('existing Microsoft auth helper acquires a token through intercepted HTTP only', async () => {
  let calls = 0;
  const getAccessToken = createTrustedMeetingGraphTokenSupplier(config, (async () => {
    calls++;
    return new Response(JSON.stringify({
      access_token: 'test-token', token_type: 'Bearer', expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
  assert.equal(await getAccessToken(), 'test-token');
  assert.equal(calls, 1);
});
