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
