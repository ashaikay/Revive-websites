import assert from 'node:assert/strict';
import test from 'node:test';
import { handleEmployerOutreachDraft, type EmployerOutreachDependencies } from './employerOutreachBoundary.ts';
import { EmployerOutreachProviderError } from './openAiEmployerOutreachProvider.ts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const programmeId = '22222222-2222-4222-8222-222222222222';
const employerId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const userId = '55555555-5555-4555-8555-555555555555';
const source = {
  programmeName: 'Employment Support', brandingName: 'Programme Brand', senderDisplayName: 'Employment Team',
  senderReplyTo: 'team@example.test', offerSummary: 'We provide practical recruitment support to local employers.',
  employerName: 'Example Ltd', sector: 'Construction', location: 'Birmingham', sourceUrl: 'https://example.test',
  evidence: [{ kind: 'verified_fact', value: 'Registered company.' }], contactName: null, contactRole: null,
};
const draft = { draftId: requestId, rootDraftId: requestId, revision: 1, subject: 'Local recruitment support', body: 'We would welcome a conversation about your recruitment needs.', status: 'prepared_not_sent' as const, createdAt: '2026-10-10T00:00:00.000Z' };
const claimed = { attemptId: requestId, status: 'claimed' as const, shouldAttempt: true, errorCode: null, draft: null, source };
const succeeded = { attemptId: requestId, status: 'succeeded' as const, shouldAttempt: false, errorCode: null, draft };
const deps = (patch: Partial<EmployerOutreachDependencies> = {}): EmployerOutreachDependencies => ({
  allowedOrigin: 'http://localhost:5180', providerConfigured: true, model: 'gpt-4.1-mini-2025-04-14', dailyLimit: 10,
  getUserId: async () => userId, canAccessProgramme: async () => true, claim: async () => claimed,
  prepare: async () => ({ subject: draft.subject, body: draft.body, model: 'gpt-4.1-mini-2025-04-14', providerResponseId: 'resp_test', inputTokens: 100, outputTokens: 40 }),
  complete: async () => succeeded,
  fail: async (input) => ({ ...claimed, status: 'failed', shouldAttempt: false, errorCode: input.errorCode, source: undefined }),
  ...patch,
});
const request = (body: unknown) => new Request('http://localhost/functions/v1/rev-programme-employer-outreach-draft', {
  method: 'POST', headers: { Origin: 'http://localhost:5180', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});
const body = { action: 'prepare', workspaceId, programmeId, employerId, contactId: null, requestId, employerVersion: 1, settingsVersion: 1, contactVersion: null };

test('reports disabled capability without preparing a draft', async () => {
  let prepared = false;
  const response = await handleEmployerOutreachDraft(request({ action: 'status', workspaceId, programmeId }), deps({ providerConfigured: false, prepare: async () => { prepared = true; throw new Error(); } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: false, model: null });
  assert.equal(prepared, false);
});

test('prepares one evidence-backed draft and returns not-sent state', async () => {
  let calls = 0;
  const response = await handleEmployerOutreachDraft(request(body), deps({ prepare: async () => {
    calls++;
    return { subject: draft.subject, body: draft.body, model: 'gpt-4.1-mini-2025-04-14', providerResponseId: 'resp_test', inputTokens: 100, outputTokens: 40 };
  } }));
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal((await response.json()).draft.status, 'prepared_not_sent');
});

test('replays a completed draft without another provider call', async () => {
  let calls = 0;
  const response = await handleEmployerOutreachDraft(request(body), deps({ claim: async () => succeeded, prepare: async () => { calls++; throw new Error(); } }));
  assert.equal(response.status, 200);
  assert.equal(calls, 0);
});

test('preserves a provider failure and does not return a draft', async () => {
  let errorCode = '';
  const response = await handleEmployerOutreachDraft(request(body), deps({
    prepare: async () => { throw new EmployerOutreachProviderError('provider_refused'); },
    fail: async (input) => { errorCode = input.errorCode; return { ...claimed, status: 'failed', shouldAttempt: false, errorCode: input.errorCode, source: undefined }; },
  }));
  assert.equal(response.status, 502);
  assert.equal(errorCode, 'provider_refused');
});

test('denies cross-workspace access before a provider claim', async () => {
  let claimedCalled = false;
  const response = await handleEmployerOutreachDraft(request(body), deps({ canAccessProgramme: async () => false, claim: async () => { claimedCalled = true; return claimed; } }));
  assert.equal(response.status, 403);
  assert.equal(claimedCalled, false);
});

test('preserves an unknown durable completion without claiming the provider failed', async () => {
  let failed = false;
  const response = await handleEmployerOutreachDraft(request(body), deps({
    complete: async () => { throw new Error('database response lost'); },
    fail: async () => { failed = true; return claimed; },
  }));
  assert.equal(response.status, 409);
  assert.equal(failed, false);
  assert.equal((await response.json()).requestId, requestId);
});
