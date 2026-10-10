// Local Supabase only. Synthetic Programme Hub employer fixtures; never accepts a remote URL.
import { randomBytes, randomUUID } from 'node:crypto';
import { workspaceIdFromCreateResponse } from './programmeHubFixtureResponse.mjs';

const baseUrl = 'http://127.0.0.1:55321';
const anonKey = process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const serviceKey = process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey) throw new Error('Local Supabase test keys are required.');

let failures = 0;
const check = (name, condition) => {
  console.log(`${name}=${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures++;
};
async function request(token, method, path, body) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: { apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, rows: Array.isArray(payload) ? payload : [] };
}
const rpc = (token, name, body) => request(token, 'POST', `/rest/v1/rpc/${name}`, body);
const id = (value) => {
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value)) throw new Error('Invalid local fixture identifier.');
  return value;
};
async function identity(label) {
  const email = `programme-employer-${Date.now()}-${label}-${randomBytes(4).toString('hex')}@example.test`;
  const password = `Local-${randomBytes(24).toString('base64url')}`;
  const created = await request(serviceKey, 'POST', '/auth/v1/admin/users', { email, password, email_confirm: true });
  if (created.status !== 200) throw new Error('Local user fixture failed.');
  const userId = id(created.payload.id);
  const login = await request(anonKey, 'POST', '/auth/v1/token?grant_type=password', { email, password });
  if (login.status !== 200 || !login.payload?.access_token) throw new Error('Local login fixture failed.');
  return { id: userId, token: login.payload.access_token };
}
async function workspace(owner, label) {
  const stamp = `${Date.now()}-${randomBytes(4).toString('hex')}`;
  const created = await rpc(owner.token, 'create_workspace_with_owner', {
    workspace_name: `${label} ${stamp}`,
    workspace_slug: `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${stamp}`,
  });
  return id(workspaceIdFromCreateResponse(created));
}
const saveFoundation = (actorId, workspaceId, operation, programmeId, recordId, expectedVersion, payload, requestId = randomUUID()) =>
  rpc(serviceKey, 'save_rev_programme_hub_record', {
    target_operation: operation, target_workspace_id: workspaceId, initiating_user_id: actorId,
    target_request_id: requestId, target_programme_id: programmeId, target_record_id: recordId,
    expected_version: expectedVersion, target_payload: payload,
  });
const saveEngagement = (actorId, workspaceId, operation, programmeId, recordId, expectedVersion, payload, requestId = randomUUID()) =>
  rpc(serviceKey, 'save_rev_programme_employer_engagement', {
    target_operation: operation, target_workspace_id: workspaceId, initiating_user_id: actorId,
    target_request_id: requestId, target_programme_id: programmeId, target_record_id: recordId,
    expected_version: expectedVersion, target_payload: payload,
  });
const read = (token, table, workspaceId, programmeId) =>
  request(token, 'GET', `/rest/v1/${table}?workspace_id=eq.${workspaceId}&programme_id=eq.${programmeId}&select=*`);

const owner = await identity('owner');
const adviser = await identity('adviser');
const unrelated = await identity('unrelated');
const outsider = await identity('outsider');
const workspaceId = await workspace(owner, 'Employer Engagement');
const otherWorkspaceId = await workspace(outsider, 'Other Workspace');
for (const user of [adviser, unrelated]) {
  const added = await request(serviceKey, 'POST', '/rest/v1/workspace_members', { workspace_id: workspaceId, user_id: user.id, role: 'member', status: 'active' });
  if (added.status !== 201) throw new Error('Membership fixture failed.');
}
const programmePayload = {
  name: 'Synthetic Employment Support', timezone: 'Europe/London', brandingName: 'Synthetic Programme',
  senderDisplayName: 'Employment Team', senderReplyTo: 'employment@example.test', active: true,
};
const programmeCreated = await saveFoundation(owner.id, workspaceId, 'programme', null, null, 0, programmePayload);
const programmeId = id(programmeCreated.payload?.record_id);
await saveFoundation(owner.id, workspaceId, 'adviser', programmeId, null, 0, { userId: adviser.id, active: true });

const filters = { location: 'Birmingham / West Midlands', sectors: ['construction', 'retail'], excludeTerms: ['barbering'] };
const discoveryRequestId = randomUUID();
const discoveryClaims = await Promise.all([
  rpc(serviceKey, 'claim_rev_programme_employer_discovery', {
    target_workspace_id: workspaceId, initiating_user_id: adviser.id, target_request_id: discoveryRequestId,
    target_programme_id: programmeId, target_filters: filters,
  }),
  rpc(serviceKey, 'claim_rev_programme_employer_discovery', {
    target_workspace_id: workspaceId, initiating_user_id: adviser.id, target_request_id: discoveryRequestId,
    target_programme_id: programmeId, target_filters: filters,
  }),
]);
check('DISCOVERY_CONCURRENT_EXACT_REPLAY', discoveryClaims.every((value) => value.status === 200) &&
  discoveryClaims.filter((value) => value.payload?.should_attempt === true).length === 1 &&
  discoveryClaims.filter((value) => value.payload?.should_attempt === false).length === 1);
check('DISCOVERY_CHANGED_RETRY_DENIED', (await rpc(serviceKey, 'claim_rev_programme_employer_discovery', {
  target_workspace_id: workspaceId, initiating_user_id: adviser.id, target_request_id: discoveryRequestId,
  target_programme_id: programmeId, target_filters: { ...filters, location: 'Coventry' },
})).status >= 400);
check('UNAUTHORISED_MEMBER_DISCOVERY_DENIED', (await rpc(serviceKey, 'claim_rev_programme_employer_discovery', {
  target_workspace_id: workspaceId, initiating_user_id: unrelated.id, target_request_id: randomUUID(),
  target_programme_id: programmeId, target_filters: filters,
})).status >= 400);
check('CROSS_WORKSPACE_DISCOVERY_DENIED', (await rpc(serviceKey, 'claim_rev_programme_employer_discovery', {
  target_workspace_id: otherWorkspaceId, initiating_user_id: outsider.id, target_request_id: randomUUID(),
  target_programme_id: programmeId, target_filters: filters,
})).status >= 400);

const retrievedAt = new Date().toISOString();
const candidate = {
  sourceIdentity: '12345678', name: 'SYNTHETIC BUILDERS LTD', sector: 'Construction',
  location: 'Birmingham, West Midlands', address: '1 Test Street, Birmingham, B1 1AA',
  sourceUrl: 'https://find-and-update.company-information.service.gov.uk/company/12345678',
  retrievedAt,
  evidence: [
    { kind: 'verified_fact', label: 'Companies House identity', value: 'Synthetic registry fixture.' },
    { kind: 'unknown', label: 'Vacancies and contacts', value: 'Not established by registry evidence.' },
  ],
};
const completedSearch = await rpc(serviceKey, 'complete_rev_programme_employer_discovery', {
  target_workspace_id: workspaceId, initiating_user_id: adviser.id, target_request_id: discoveryRequestId,
  target_results: [candidate], target_retrieved_at: retrievedAt,
});
check('DISCOVERY_COMPLETES_ONCE', completedSearch.status === 200 && completedSearch.payload?.status === 'succeeded');

const saveRequestId = randomUUID();
const savedEmployers = await Promise.all([
  saveEngagement(adviser.id, workspaceId, 'discovery_employer', programmeId, null, 0, { searchId: discoveryRequestId, sourceIdentity: candidate.sourceIdentity }, saveRequestId),
  saveEngagement(adviser.id, workspaceId, 'discovery_employer', programmeId, null, 0, { searchId: discoveryRequestId, sourceIdentity: candidate.sourceIdentity }, saveRequestId),
]);
const discoveredEmployerConcurrentReplay = savedEmployers.every((value) => value.status === 200) &&
  savedEmployers[0].payload?.record_id === savedEmployers[1].payload?.record_id;
if (!discoveredEmployerConcurrentReplay) {
  const diagnostics = savedEmployers.map(({ status, payload }) => {
    const responseType = payload === null ? 'null' : Array.isArray(payload) ? 'array' : typeof payload;
    const response = responseType === 'object' ? payload : null;
    const errorCode = typeof response?.code === 'string'
      ? response.code
      : typeof response?.error_code === 'string' ? response.error_code : null;
    return {
      status,
      errorCode,
      responseType,
      topLevelKeys: response ? Object.keys(response).sort() : [],
      recordIdIsValidUuid: typeof response?.record_id === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(response.record_id),
    };
  });
  console.error('DISCOVERED_EMPLOYER_CONCURRENT_REPLAY_DIAGNOSTICS=' + JSON.stringify(diagnostics));
}
check('DISCOVERED_EMPLOYER_CONCURRENT_REPLAY', discoveredEmployerConcurrentReplay);
const employerId = id(savedEmployers[0].payload?.record_id);
check('DISCOVERED_EMPLOYER_CHANGED_RETRY_DENIED', (await saveEngagement(
  adviser.id, workspaceId, 'discovery_employer', programmeId, null, 0,
  { searchId: discoveryRequestId, sourceIdentity: '99999999' }, saveRequestId,
)).status >= 400);
const duplicateSave = await saveEngagement(adviser.id, workspaceId, 'discovery_employer', programmeId, null, 0, { searchId: discoveryRequestId, sourceIdentity: candidate.sourceIdentity });
check('RELIABLE_SOURCE_DUPLICATE_NOT_MERGED', duplicateSave.status === 200 && duplicateSave.payload?.duplicate === true && duplicateSave.payload?.record_id === employerId);

const engagements = await read(serviceKey, 'programme_hub_employer_engagements', workspaceId, programmeId);
const engagementId = id(engagements.rows[0]?.id);
const engagementRequestId = randomUUID();
const engagementPayload = {
  employerId, stage: 'ready_to_contact', responsibleAdviserUserId: adviser.id,
  nextAction: 'Review the employer evidence.', followUpDate: '2026-10-20',
};
const engagementSaved = await saveEngagement(adviser.id, workspaceId, 'engagement', programmeId, engagementId, 1, engagementPayload, engagementRequestId);
check('AUTHORISED_SPECIALIST_UPDATES_ENGAGEMENT', engagementSaved.status === 200 && engagementSaved.payload?.version === 2);
check('ENGAGEMENT_CHANGED_RETRY_DENIED', (await saveEngagement(adviser.id, workspaceId, 'engagement', programmeId, engagementId, 1, { ...engagementPayload, nextAction: 'Changed' }, engagementRequestId)).status >= 400);
check('UNAUTHORISED_RESPONSIBLE_SPECIALIST_DENIED', (await saveEngagement(adviser.id, workspaceId, 'engagement', programmeId, engagementId, 2, { ...engagementPayload, responsibleAdviserUserId: unrelated.id })).status >= 400);

const manualEventRequestId = randomUUID();
const eventPayload = { employerId, contactId: '', eventType: 'manual_contact', channel: 'phone', summary: 'Synthetic manual contact record.' };
const eventsSaved = await Promise.all([
  saveEngagement(adviser.id, workspaceId, 'engagement_event', programmeId, null, 0, eventPayload, manualEventRequestId),
  saveEngagement(adviser.id, workspaceId, 'engagement_event', programmeId, null, 0, eventPayload, manualEventRequestId),
]);
check('MANUAL_HISTORY_EXACT_REPLAY_ONE_EVENT', eventsSaved.every((value) => value.status === 200) &&
  eventsSaved[0].payload?.record_id === eventsSaved[1].payload?.record_id);

const contactCreated = await saveFoundation(adviser.id, workspaceId, 'contact', programmeId, null, 0, {
  employerId, contactKey: 'CONTACT-001', preferredName: 'Suppressed Contact', roleTitle: 'Manager',
  businessEmail: 'contact@example.test', businessPhone: '', suppressed: true,
  suppressionReasonKey: 'do_not_contact', active: true,
});
const contactId = id(contactCreated.payload?.record_id);
const settingsCreated = await saveEngagement(owner.id, workspaceId, 'outreach_settings', programmeId, null, 0, {
  offerSummary: 'We provide practical recruitment support to local employers through this programme.',
});
const settingsId = id(settingsCreated.payload?.record_id);
check('NON_MANAGER_SETTINGS_DENIED', (await saveEngagement(adviser.id, workspaceId, 'outreach_settings', programmeId, settingsId, 1, {
  offerSummary: 'An adviser must not replace the approved programme offer summary.',
})).status >= 400);
check('SUPPRESSED_CONTACT_DRAFT_DENIED', (await rpc(serviceKey, 'claim_rev_programme_employer_outreach_draft', {
  target_workspace_id: workspaceId, initiating_user_id: adviser.id, target_request_id: randomUUID(),
  target_programme_id: programmeId, target_employer_id: employerId, target_contact_id: contactId,
  expected_employer_version: 1, expected_settings_version: 1, expected_contact_version: 1, daily_limit: 10,
})).status >= 400);

const draftRequestId = randomUUID();
const draftClaimBody = {
  target_workspace_id: workspaceId, initiating_user_id: adviser.id, target_request_id: draftRequestId,
  target_programme_id: programmeId, target_employer_id: employerId, target_contact_id: null,
  expected_employer_version: 1, expected_settings_version: 1, expected_contact_version: null, daily_limit: 10,
};
const draftClaims = await Promise.all([
  rpc(serviceKey, 'claim_rev_programme_employer_outreach_draft', draftClaimBody),
  rpc(serviceKey, 'claim_rev_programme_employer_outreach_draft', draftClaimBody),
]);
check('DRAFT_CONCURRENT_CLAIM_ONE_PROVIDER_ATTEMPT', draftClaims.every((value) => value.status === 200) &&
  draftClaims.filter((value) => value.payload?.should_attempt === true).length === 1);
const completedDraft = await rpc(serviceKey, 'complete_rev_programme_employer_outreach_draft', {
  target_workspace_id: workspaceId, initiating_user_id: adviser.id, target_request_id: draftRequestId,
  target_subject: 'Local recruitment support', target_body: 'We would welcome a conversation about your current recruitment priorities.',
  target_model: 'test-model', target_provider_response_id: 'test-response', target_input_tokens: 100, target_output_tokens: 30,
});
check('DRAFT_COMPLETES_PREPARED_NOT_SENT', completedDraft.status === 200 && completedDraft.payload?.draft?.status === 'prepared_not_sent');
const replayedDraft = await rpc(serviceKey, 'claim_rev_programme_employer_outreach_draft', draftClaimBody);
check('DRAFT_EXACT_REPLAY_NO_PROVIDER', replayedDraft.status === 200 && replayedDraft.payload?.should_attempt === false && replayedDraft.payload?.draft?.draftId === draftRequestId);

const staleRequestId = randomUUID();
const staleClaim = await rpc(serviceKey, 'claim_rev_programme_employer_outreach_draft', { ...draftClaimBody, target_request_id: staleRequestId });
check('STALE_DRAFT_CLAIMED', staleClaim.status === 200 && staleClaim.payload?.should_attempt === true);
const employerUpdated = await saveFoundation(adviser.id, workspaceId, 'employer', programmeId, employerId, 1, {
  employerKey: 'CH-12345678', displayName: 'SYNTHETIC BUILDERS LTD', sectorKey: 'Construction',
  primaryGeographyKey: 'Birmingham, West Midlands', active: true,
});
check('EMPLOYER_VERSION_ADVANCED', employerUpdated.status === 200 && employerUpdated.payload?.version === 2);
const staleCompletion = await rpc(serviceKey, 'complete_rev_programme_employer_outreach_draft', {
  target_workspace_id: workspaceId, initiating_user_id: adviser.id, target_request_id: staleRequestId,
  target_subject: 'Stale draft', target_body: 'This stale result must not replace the current employer evidence.',
  target_model: 'test-model', target_provider_response_id: 'stale-response', target_input_tokens: 80, target_output_tokens: 20,
});
check('STALE_PROVIDER_RESULT_REJECTED_DURABLY', staleCompletion.status === 200 && staleCompletion.payload?.status === 'failed' && staleCompletion.payload?.error_code === 'stale_evidence');

check('ADVISER_CAN_READ_PROGRAMME_ENGAGEMENT', (await read(adviser.token, 'programme_hub_employer_engagements', workspaceId, programmeId)).rows.length === 1);
check('UNRELATED_MEMBER_CANNOT_READ_PROGRAMME_ENGAGEMENT', (await read(unrelated.token, 'programme_hub_employer_engagements', workspaceId, programmeId)).rows.length === 0);
check('OUTSIDER_CANNOT_READ_PROGRAMME_ENGAGEMENT', (await read(outsider.token, 'programme_hub_employer_engagements', workspaceId, programmeId)).rows.length === 0);
check('DIRECT_AUTHENTICATED_ENGAGEMENT_WRITE_DENIED', (await request(adviser.token, 'POST', '/rest/v1/programme_hub_employer_engagement_events', {
  workspace_id: workspaceId, programme_id: programmeId, employer_id: employerId, event_type: 'note',
  summary: 'Direct write must fail.', actor_user_id: adviser.id,
})).status >= 400);

if (failures) throw new Error(`${failures} Programme Hub employer engagement checks failed.`);
console.log('PROGRAMME_EMPLOYER_ENGAGEMENT_LOCAL_VALIDATION=PASS');
