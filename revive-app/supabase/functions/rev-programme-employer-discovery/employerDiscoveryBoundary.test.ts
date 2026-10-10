import assert from 'node:assert/strict';
import test from 'node:test';
import { handleEmployerDiscovery, type EmployerDiscoveryDependencies } from './employerDiscoveryBoundary.ts';
import { CompaniesHouseDiscoveryError } from './companiesHouseEmployerDiscovery.ts';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const programmeId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const filters = { location: 'Birmingham / West Midlands', sectors: ['construction'], excludeTerms: ['barbering'] };
const result = {
  sourceIdentity: '12345678', name: 'EXAMPLE BUILDERS LTD', sector: 'Construction',
  location: 'Birmingham', address: '1 Test Street, Birmingham', sourceUrl: 'https://find-and-update.company-information.service.gov.uk/company/12345678',
  retrievedAt: '2026-10-10T00:00:00.000Z',
  evidence: [{ kind: 'verified_fact' as const, label: 'Companies House identity', value: 'Recorded company.' }],
};
const claimed = { searchId: requestId, status: 'claimed' as const, shouldAttempt: true, results: null, errorCode: null, retrievedAt: null };
const succeeded = { searchId: requestId, status: 'succeeded' as const, shouldAttempt: false, results: [result], errorCode: null, retrievedAt: result.retrievedAt };
const deps = (patch: Partial<EmployerDiscoveryDependencies> = {}): EmployerDiscoveryDependencies => ({
  allowedOrigin: 'http://localhost:5180', providerConfigured: true,
  getUserId: async () => userId, canAccessProgramme: async () => true,
  claim: async () => claimed, search: async () => [result], complete: async () => succeeded,
  fail: async (input) => ({ ...claimed, status: 'failed', shouldAttempt: false, errorCode: input.errorCode }),
  ...patch,
});
const request = (body: unknown) => new Request('http://localhost/functions/v1/rev-programme-employer-discovery', {
  method: 'POST', headers: { Origin: 'http://localhost:5180', Authorization: 'Bearer test', 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

test('reports missing provider configuration without making a search', async () => {
  let searched = false;
  const response = await handleEmployerDiscovery(request({ action: 'status', workspaceId, programmeId }), deps({ providerConfigured: false, search: async () => { searched = true; return []; } }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { available: false, provider: 'Companies House' });
  assert.equal(searched, false);
});

test('claims and completes one authorised discovery call', async () => {
  let calls = 0;
  const response = await handleEmployerDiscovery(request({ action: 'search', workspaceId, programmeId, requestId, filters }), deps({ search: async () => { calls++; return [result]; } }));
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.deepEqual(await response.json(), { searchId: requestId, status: 'succeeded', results: [result], errorCode: null, retrievedAt: result.retrievedAt });
});

test('replays a completed result without another provider call', async () => {
  let calls = 0;
  const response = await handleEmployerDiscovery(request({ action: 'search', workspaceId, programmeId, requestId, filters }), deps({
    claim: async () => succeeded,
    search: async () => { calls++; return [result]; },
  }));
  assert.equal(response.status, 200);
  assert.equal(calls, 0);
});

test('denies cross-programme access before claim', async () => {
  let claimedCalled = false;
  const response = await handleEmployerDiscovery(request({ action: 'search', workspaceId, programmeId, requestId, filters }), deps({
    canAccessProgramme: async () => false,
    claim: async () => { claimedCalled = true; return claimed; },
  }));
  assert.equal(response.status, 403);
  assert.equal(claimedCalled, false);
});

test('records provider failures and never returns invented results', async () => {
  let failed = '';
  const response = await handleEmployerDiscovery(request({ action: 'search', workspaceId, programmeId, requestId, filters }), deps({
    search: async () => { throw new CompaniesHouseDiscoveryError('provider_rate_limited'); },
    fail: async (input) => { failed = input.errorCode; return { ...claimed, status: 'failed', shouldAttempt: false, errorCode: input.errorCode }; },
  }));
  assert.equal(response.status, 429);
  assert.equal(failed, 'provider_rate_limited');
  assert.equal((await response.json()).requestId, requestId);
});

test('preserves an unknown completion without converting it to a provider failure', async () => {
  let failed = false;
  const response = await handleEmployerDiscovery(request({ action: 'search', workspaceId, programmeId, requestId, filters }), deps({
    complete: async () => { throw new Error('database response lost'); },
    fail: async () => { failed = true; return claimed; },
  }));
  assert.equal(response.status, 409);
  assert.equal(failed, false);
  assert.equal((await response.json()).requestId, requestId);
});
