import test from 'node:test';
import assert from 'node:assert/strict';
import { handleProgrammeHubSave, type ProgrammeHubSaveInput } from './programmeHubBoundary.ts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';
const programmeId = '44444444-4444-4444-8444-444444444444';
const recordId = '55555555-5555-4555-8555-555555555555';
const origin = 'http://localhost:5180';
const programmeBody = {
  operation: 'programme',
  workspaceId,
  programmeId: null,
  recordId: null,
  requestId,
  expectedVersion: 0,
  payload: {
    name: 'Employment Support',
    timezone: 'Europe/London',
    brandingName: '',
    senderDisplayName: '',
    senderReplyTo: '',
    active: true,
  },
};
const request = (body: unknown, patch: RequestInit = {}) => new Request('http://local/functions/v1/rev-programme-hub-save', {
  method: 'POST',
  headers: { Origin: origin, Authorization: 'Bearer test', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  ...patch,
});
const dependencies = (save?: (input: ProgrammeHubSaveInput) => Promise<unknown>) => ({
  allowedOrigin: origin,
  getUserId: async () => userId,
  canWriteWorkspace: async () => true,
  save: save ?? (async (input: ProgrammeHubSaveInput) => ({
    operation: input.target_operation,
    record_id: recordId,
    workspace_id: workspaceId,
    programme_id: input.target_programme_id ?? recordId,
    version: input.expected_version + 1,
  })),
});

test('accepts a tenant-neutral programme save and binds actor identity on the server', async () => {
  let captured: ProgrammeHubSaveInput | undefined;
  const response = await handleProgrammeHubSave(request(programmeBody), dependencies(async (input) => {
    captured = input;
    return { operation: 'programme', record_id: recordId, workspace_id: workspaceId, programme_id: recordId, version: 1 };
  }));
  assert.equal(response.status, 200);
  assert.equal(captured?.initiating_user_id, userId);
  assert.equal(captured?.target_workspace_id, workspaceId);
  assert.deepEqual(await response.json(), {
    operation: 'programme', recordId, workspaceId, programmeId: recordId, version: 1,
  });
});

test('accepts minimal participant employment data without clinical or outcome fields', async () => {
  const body = {
    operation: 'participant',
    workspaceId,
    programmeId,
    recordId: null,
    requestId,
    expectedVersion: 0,
    payload: {
      participantKey: 'participant-001',
      preferredName: 'Alex',
      caseReference: 'CASE-001',
      desiredRoleKeys: ['retail'],
      skillKeys: ['customer_service'],
      vacancySearchGeographyKeys: ['configured-area-a'],
      residencyEvidenceReference: '',
      active: true,
    },
  };
  assert.equal((await handleProgrammeHubSave(request(body), dependencies())).status, 200);
  assert.equal((await handleProgrammeHubSave(request({ ...body, payload: { ...body.payload, diagnosis: 'not allowed' } }), dependencies())).status, 400);
});

test('requires exact vacancy fields and refuses invented or malformed geography input', async () => {
  const body = {
    operation: 'vacancy',
    workspaceId,
    programmeId,
    recordId: null,
    requestId,
    expectedVersion: 0,
    payload: {
      employerId: recordId,
      employerContactId: '',
      vacancyKey: 'vacancy-001',
      title: 'Retail assistant',
      workGeographyKey: '',
      requiredSkillKeys: [],
      desiredSkillKeys: [],
      active: true,
    },
  };
  assert.equal((await handleProgrammeHubSave(request(body), dependencies())).status, 200);
  assert.equal((await handleProgrammeHubSave(request({ ...body, payload: { ...body.payload, postcodeProvesEligibility: true } }), dependencies())).status, 400);
});

test('denies foreign origins, missing authentication and inactive workspace access', async () => {
  const foreign = request(programmeBody, { headers: { Origin: 'https://example.invalid', Authorization: 'Bearer test', 'Content-Type': 'application/json' } });
  assert.equal((await handleProgrammeHubSave(foreign, dependencies())).status, 403);
  const unauthenticated = request(programmeBody, { headers: { Origin: origin, 'Content-Type': 'application/json' } });
  assert.equal((await handleProgrammeHubSave(unauthenticated, dependencies())).status, 401);
  assert.equal((await handleProgrammeHubSave(request(programmeBody), { ...dependencies(), canWriteWorkspace: async () => false })).status, 403);
});

test('fails closed when the trusted result does not match the request', async () => {
  const response = await handleProgrammeHubSave(request(programmeBody), dependencies(async () => ({
    operation: 'employer', record_id: recordId, workspace_id: workspaceId, programme_id: recordId, version: 1,
  })));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: 'Programme record could not be saved.' });
});

test('accepts an append-only participant note and binds its author on the server', async () => {
  let captured: ProgrammeHubSaveInput | undefined;
  const body = {
    operation: 'participant_note',
    workspaceId,
    programmeId,
    recordId: null,
    requestId,
    expectedVersion: 0,
    payload: { participantId: recordId, body: 'Agreed action recorded.' },
  };
  const response = await handleProgrammeHubSave(request(body), dependencies(async (input) => {
    captured = input;
    return { operation: 'participant_note', record_id: recordId, workspace_id: workspaceId, programme_id: programmeId, version: 1 };
  }));
  assert.equal(response.status, 200);
  assert.equal(captured?.initiating_user_id, userId);
  assert.deepEqual(captured?.target_payload, { participantId: recordId, body: 'Agreed action recorded.' });
});

test('rejects participant note author timestamps, blank notes and correction attempts', async () => {
  const body = {
    operation: 'participant_note',
    workspaceId,
    programmeId,
    recordId: null,
    requestId,
    expectedVersion: 0,
    payload: { participantId: recordId, body: 'Employment-support fact.' },
  };
  assert.equal((await handleProgrammeHubSave(request({ ...body, payload: { ...body.payload, authorUserId: userId } }), dependencies())).status, 400);
  assert.equal((await handleProgrammeHubSave(request({ ...body, payload: { ...body.payload, createdAt: new Date().toISOString() } }), dependencies())).status, 400);
  assert.equal((await handleProgrammeHubSave(request({ ...body, payload: { ...body.payload, body: ' ' } }), dependencies())).status, 400);
  assert.equal((await handleProgrammeHubSave(request({ ...body, recordId, expectedVersion: 1 }), dependencies())).status, 400);
});
