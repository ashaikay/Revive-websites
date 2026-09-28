import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveMeetingProviderLiveWorkspace } from './meetingProviderActivation.ts';

const workspace = '11111111-1111-4111-8111-111111111111';

test('live workspace activation requires an exact valid trusted workspace match', () => {
  assert.equal(resolveMeetingProviderLiveWorkspace(workspace, workspace), workspace);
  assert.equal(resolveMeetingProviderLiveWorkspace(workspace.toUpperCase(), workspace), workspace);
});

test('missing, malformed, and mismatched activation stays disabled', () => {
  assert.equal(resolveMeetingProviderLiveWorkspace(undefined, workspace), null);
  assert.equal(resolveMeetingProviderLiveWorkspace('not-a-uuid', workspace), null);
  assert.equal(resolveMeetingProviderLiveWorkspace(workspace, undefined), null);
  assert.equal(resolveMeetingProviderLiveWorkspace(workspace, '22222222-2222-4222-8222-222222222222'), null);
});