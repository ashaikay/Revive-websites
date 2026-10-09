import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createTrustedMeetingProviderServer } from './trustedMeetingProviderServer.ts';

const workspace = '11111111-1111-4111-8111-111111111111';
const attempt = {
  executionId: '22222222-2222-4222-8222-222222222222',
  correlationId: '33333333-3333-4333-8333-333333333333',
  requestFingerprint: 'a'.repeat(64), bindingVersion: 1,
};
test('trusted workspace setting configures the composed provider; disabled gate reads no credential or durable records', async () => {
  const reads: string[] = [];
  const run = createTrustedMeetingProviderServer({
    liveWorkspaceId: '44444444-4444-4444-8444-444444444444',
    getEnvironment: key => {
      reads.push(key);
      return ({
        REV_CALENDAR_AVAILABILITY_WORKSPACE_ID: workspace,
      } as Record<string, string>)[key];
    },
    trustedClient: {
      from: () => { reads.push('database read'); throw new Error('read reached'); },
      rpc: () => { reads.push('provider claim'); throw new Error('claim reached'); },
    } as never,
    tokenFetch: (async () => { reads.push('token HTTP'); throw new Error('token endpoint reached'); }) as typeof fetch,
    invokeGraph: async () => { reads.push('Graph HTTP'); throw new Error('Graph reached'); },
  });
  await assert.rejects(run(attempt), /disabled/);
  assert.deepEqual(reads, [
    'REV_CALENDAR_AVAILABILITY_WORKSPACE_ID',
  ]);
});

test('missing trusted workspace fails before provider workflow construction', () => {
  assert.throws(() => createTrustedMeetingProviderServer({
    liveWorkspaceId: workspace,
    getEnvironment: () => undefined,
    trustedClient: {} as never,
  }), /configuration unavailable/);
});
