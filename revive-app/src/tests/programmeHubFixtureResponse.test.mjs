import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeFixtureResponse, workspaceIdFromCreateResponse } from './programmeHubFixtureResponse.mjs';

const workspaceId = '11111111-1111-4111-8111-111111111111';

test('extracts the documented one-row create_workspace_with_owner result', () => {
  assert.equal(workspaceIdFromCreateResponse({
    status: 200,
    payload: [{
      created_workspace_id: workspaceId,
      created_workspace_name: 'Programme Hub fixture',
      created_workspace_slug: 'programme-hub-fixture',
    }],
  }), workspaceId);
});

test('reports only status, response type and keys for a rejected RPC', () => {
  const response = { status: 400, payload: { code: '22023', message: 'sensitive database detail' } };
  assert.throws(
    () => workspaceIdFromCreateResponse(response),
    /status=400 responseType=object responseKeys=code,message/,
  );
  const summary = summarizeFixtureResponse(response.status, response.payload);
  assert.equal(summary.includes('sensitive database detail'), false);
});

test('refuses malformed successful response shapes and identifiers', () => {
  assert.throws(
    () => workspaceIdFromCreateResponse({ status: 200, payload: { created_workspace_id: workspaceId } }),
    /responseType=object/,
  );
  assert.throws(
    () => workspaceIdFromCreateResponse({
      status: 200,
      payload: [{ created_workspace_id: 'not-a-uuid', created_workspace_name: 'Name', created_workspace_slug: 'slug' }],
    }),
    /responseKeys=created_workspace_id,created_workspace_name,created_workspace_slug/,
  );
});
