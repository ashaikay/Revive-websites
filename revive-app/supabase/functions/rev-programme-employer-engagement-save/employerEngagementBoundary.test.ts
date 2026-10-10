import assert from 'node:assert/strict';
import test from 'node:test';
import { handleEmployerEngagementSave, type EmployerEngagementSaveDependencies } from './employerEngagementBoundary.ts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const programmeId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const employerId = '55555555-5555-4555-8555-555555555555';
const dependencies = (patch: Partial<EmployerEngagementSaveDependencies> = {}): EmployerEngagementSaveDependencies => ({
  allowedOrigin: 'http://localhost:5180', getUserId: async () => userId, canAccessProgramme: async () => true,
  save: async (input) => ({ operation: input.target_operation, recordId: employerId, workspaceId, programmeId, version: 1, duplicate: false }),
  ...patch,
});
const request = (body: unknown) => new Request('http://localhost/functions/v1/rev-programme-employer-engagement-save', {
  method: 'POST', headers: { Origin: 'http://localhost:5180', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const body = {
  operation: 'engagement_event', workspaceId, programmeId, recordId: null, requestId, expectedVersion: 0,
  payload: { employerId, contactId: '', eventType: 'manual_contact', channel: 'email', summary: 'Spoke with the employer switchboard.' },
};

test('binds the authenticated actor and preserves the exact manual-contact payload', async () => {
  let saved: unknown;
  const response = await handleEmployerEngagementSave(request(body), dependencies({ save: async (input) => {
    saved = input;
    return { operation: input.target_operation, recordId: employerId, workspaceId, programmeId, version: 1, duplicate: false };
  } }));
  assert.equal(response.status, 200);
  assert.deepEqual(saved, {
    target_operation: 'engagement_event', target_workspace_id: workspaceId, initiating_user_id: userId,
    target_request_id: requestId, target_programme_id: programmeId, target_record_id: null,
    expected_version: 0, target_payload: body.payload,
  });
});

test('preserves the discovered-employer search UUID and text source identity', async () => {
  const searchId = '66666666-6666-4666-8666-666666666666';
  const discoveryPayload = { searchId, sourceIdentity: '12345678' };
  let saved: unknown;
  const response = await handleEmployerEngagementSave(request({
    operation: 'discovery_employer', workspaceId, programmeId, recordId: null, requestId, expectedVersion: 0,
    payload: discoveryPayload,
  }), dependencies({ save: async (input) => {
    saved = input;
    return { operation: input.target_operation, recordId: employerId, workspaceId, programmeId, version: 1, duplicate: false };
  } }));
  assert.equal(response.status, 200);
  assert.deepEqual(saved, {
    target_operation: 'discovery_employer', target_workspace_id: workspaceId, initiating_user_id: userId,
    target_request_id: requestId, target_programme_id: programmeId, target_record_id: null,
    expected_version: 0, target_payload: discoveryPayload,
  });
});

test('denies cross-programme access before service-role save', async () => {
  let saved = false;
  const response = await handleEmployerEngagementSave(request(body), dependencies({
    canAccessProgramme: async () => false,
    save: async () => { saved = true; return {}; },
  }));
  assert.equal(response.status, 403);
  assert.equal(saved, false);
});

test('rejects an invented sent event type', async () => {
  const response = await handleEmployerEngagementSave(request({ ...body, payload: { ...body.payload, eventType: 'sent' } }), dependencies());
  assert.equal(response.status, 400);
});
