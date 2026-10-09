// Local Supabase only. Synthetic employment-support fixtures; never accepts a remote URL.
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
  const email = `programme-hub-${Date.now()}-${label}-${randomBytes(4).toString('hex')}@example.test`;
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
  const slugPrefix = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const created = await rpc(owner.token, 'create_workspace_with_owner', {
    workspace_name: `${label} ${stamp}`,
    workspace_slug: `${slugPrefix}-${stamp}`,
  });
  return id(workspaceIdFromCreateResponse(created));
}
const save = (actorId, workspaceId, operation, programmeId, recordId, expectedVersion, payload, requestId = randomUUID(), token = serviceKey) =>
  rpc(token, 'save_rev_programme_hub_record', {
    target_operation: operation,
    target_workspace_id: workspaceId,
    initiating_user_id: actorId,
    target_request_id: requestId,
    target_programme_id: programmeId,
    target_record_id: recordId,
    expected_version: expectedVersion,
    target_payload: payload,
  });
const read = (token, table, workspaceId) => request(token, 'GET', `/rest/v1/${table}?workspace_id=eq.${workspaceId}&select=*`);

const owner = await identity('owner');
const adviser = await identity('adviser');
const otherMember = await identity('other-member');
const outsider = await identity('outsider');
const workspaceId = await workspace(owner, 'Programme Hub');
const otherWorkspaceId = await workspace(outsider, 'Other Programme');
for (const user of [adviser, otherMember]) {
  const added = await request(serviceKey, 'POST', '/rest/v1/workspace_members', { workspace_id: workspaceId, user_id: user.id, role: 'member', status: 'active' });
  if (added.status !== 201) throw new Error('Workspace membership fixture failed.');
}

const programmePayload = {
  name: 'Synthetic Employment Support',
  timezone: 'Europe/London',
  brandingName: '',
  senderDisplayName: '',
  senderReplyTo: '',
  active: true,
};
const programmeRequestId = randomUUID();
const programmeCreated = await Promise.all([
  save(owner.id, workspaceId, 'programme', null, null, 0, programmePayload, programmeRequestId),
  save(owner.id, workspaceId, 'programme', null, null, 0, programmePayload, programmeRequestId),
]);
check('PROGRAMME_CONCURRENT_REPLAY_ONE_RESULT', programmeCreated.every((result) => result.status === 200) && programmeCreated[0].payload?.record_id === programmeCreated[1].payload?.record_id);
const programmeId = id(programmeCreated[0].payload?.record_id);
check('PROGRAMME_VERSION_ONE', programmeCreated[0].payload?.version === 1);
check('CHANGED_PROGRAMME_REPLAY_DENIED', (await save(owner.id, workspaceId, 'programme', null, null, 0, { ...programmePayload, name: 'Changed' }, programmeRequestId)).status >= 400);

const adviserAdded = await save(owner.id, workspaceId, 'adviser', programmeId, null, 0, { userId: adviser.id, active: true });
check('OWNER_ADDS_ACTIVE_ADVISER', adviserAdded.status === 200);
check('MEMBER_CANNOT_SELF_ASSIGN_ADVISER', (await save(otherMember.id, workspaceId, 'adviser', programmeId, null, 0, { userId: otherMember.id, active: true })).status >= 400);

const employerPayload = { employerKey: 'EMP-001', displayName: 'Synthetic Employer', sectorKey: '', primaryGeographyKey: '', active: true };
const employerCreated = await save(adviser.id, workspaceId, 'employer', programmeId, null, 0, employerPayload);
check('ACTIVE_ADVISER_CREATES_EMPLOYER', employerCreated.status === 200);
const employerId = id(employerCreated.payload?.record_id);
check('NON_ADVISER_CANNOT_CREATE_EMPLOYER', (await save(otherMember.id, workspaceId, 'employer', programmeId, null, 0, { ...employerPayload, employerKey: 'EMP-002' })).status >= 400);

const contactCreated = await save(adviser.id, workspaceId, 'contact', programmeId, null, 0, {
  employerId, contactKey: 'CONTACT-001', preferredName: 'Employer Contact', roleTitle: '', businessEmail: '', businessPhone: '', suppressed: false, suppressionReasonKey: '', active: true,
});
check('ADVISER_CREATES_EMPLOYER_CONTACT', contactCreated.status === 200);
const contactId = id(contactCreated.payload?.record_id);
const vacancyCreated = await save(adviser.id, workspaceId, 'vacancy', programmeId, null, 0, {
  employerId, employerContactId: contactId, vacancyKey: 'VAC-001', title: 'Synthetic Vacancy', workGeographyKey: '',
  requiredSkillKeys: ['customer_service'], desiredSkillKeys: [], active: true,
});
check('ADVISER_CREATES_VACANCY', vacancyCreated.status === 200);

const participantPayload = {
  participantKey: 'PART-001', preferredName: 'Alex', caseReference: 'CASE-001',
  desiredRoleKeys: ['retail'], skillKeys: ['customer_service'], vacancySearchGeographyKeys: [],
  residencyEvidenceReference: '', active: true,
};
const participantCreated = await save(owner.id, workspaceId, 'participant', programmeId, null, 0, participantPayload);
check('OWNER_CREATES_MINIMAL_PARTICIPANT', participantCreated.status === 200);
const participantId = id(participantCreated.payload?.record_id);
const unassignedCreated = await save(owner.id, workspaceId, 'participant', programmeId, null, 0, { ...participantPayload, participantKey: 'PART-002', caseReference: 'CASE-002', preferredName: 'Sam' });
const unassignedId = id(unassignedCreated.payload?.record_id);
check('ADVISER_CANNOT_CREATE_PARTICIPANT', (await save(adviser.id, workspaceId, 'participant', programmeId, null, 0, { ...participantPayload, participantKey: 'PART-003', caseReference: 'CASE-003' })).status >= 400);

const assignmentCreated = await save(owner.id, workspaceId, 'participant_adviser', programmeId, null, 0, { participantId, adviserUserId: adviser.id, active: true });
check('OWNER_ASSIGNS_CASELOAD', assignmentCreated.status === 200);
check('ASSIGNED_ADVISER_READS_PARTICIPANT', (await read(adviser.token, 'programme_hub_participants', workspaceId)).rows.length === 1);
check('UNASSIGNED_MEMBER_READS_NO_PARTICIPANTS', (await read(otherMember.token, 'programme_hub_participants', workspaceId)).rows.length === 0);
check('OUTSIDER_READS_NO_PARTICIPANTS', (await read(outsider.token, 'programme_hub_participants', workspaceId)).rows.length === 0);
check('OWNER_READS_PROGRAMME_WIDE_PARTICIPANTS', (await read(owner.token, 'programme_hub_participants', workspaceId)).rows.length === 2);
check('ADVISER_READS_PROGRAMME_EMPLOYERS', (await read(adviser.token, 'programme_hub_employers', workspaceId)).rows.length === 1);
check('NON_ADVISER_READS_NO_EMPLOYERS', (await read(otherMember.token, 'programme_hub_employers', workspaceId)).rows.length === 0);

const adviserUpdate = await save(adviser.id, workspaceId, 'participant', programmeId, participantId, 1, { ...participantPayload, skillKeys: ['customer_service', 'stock_control'] });
check('ASSIGNED_ADVISER_UPDATES_PROFILE', adviserUpdate.status === 200 && adviserUpdate.payload?.version === 2);
check('ADVISER_CANNOT_UPDATE_OTHER_CASELOAD', (await save(adviser.id, workspaceId, 'participant', programmeId, unassignedId, 1, { ...participantPayload, participantKey: 'PART-002', caseReference: 'CASE-002', preferredName: 'Sam' })).status >= 400);
check('STALE_PARTICIPANT_UPDATE_DENIED', (await save(adviser.id, workspaceId, 'participant', programmeId, participantId, 1, participantPayload)).status >= 400);

const employerRace = await Promise.all([
  save(adviser.id, workspaceId, 'employer', programmeId, employerId, 1, { ...employerPayload, displayName: 'Synthetic Employer A' }),
  save(adviser.id, workspaceId, 'employer', programmeId, employerId, 1, { ...employerPayload, displayName: 'Synthetic Employer B' }),
]);
check('CONCURRENT_EMPLOYER_UPDATE_ONCE', employerRace.filter((result) => result.status === 200).length === 1 && employerRace.filter((result) => result.status >= 400).length === 1);

check('DIRECT_BROWSER_INSERT_DENIED', (await request(owner.token, 'POST', '/rest/v1/programme_hub_employers', {
  workspace_id: workspaceId, programme_id: programmeId, employer_key: 'DIRECT', display_name: 'Direct',
  created_by_user_id: owner.id, updated_by_user_id: owner.id,
})).status >= 400);
check('AUTHENTICATED_RPC_DENIED', (await save(owner.id, workspaceId, 'programme', null, null, 0, programmePayload, randomUUID(), owner.token)).status >= 400);
check('CROSS_WORKSPACE_ACTOR_DENIED', (await save(owner.id, otherWorkspaceId, 'programme', null, null, 0, programmePayload)).status >= 400);

const contracts = await read(owner.token, 'programme_hub_contracts', workspaceId);
check('NO_FABRICATED_PROGRAMME_CONTRACTS', contracts.status === 200 && contracts.rows.length === 0);
const audits = await request(owner.token, 'GET', `/rest/v1/audit_log?workspace_id=eq.${workspaceId}&action=like.programme_hub.*&select=action,resource_type,metadata`);
check('AUDIT_HISTORY_RECORDED', audits.status === 200 && audits.rows.length >= 8 && audits.rows.every((row) => row.metadata?.request_id && row.metadata?.version));

await request(serviceKey, 'PATCH', `/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${adviser.id}`, { status: 'suspended' });
check('SUSPENDED_ADVISER_WRITE_DENIED', (await save(adviser.id, workspaceId, 'employer', programmeId, null, 0, { ...employerPayload, employerKey: 'EMP-003' })).status >= 400);
check('SUSPENDED_ADVISER_READ_DENIED', (await read(adviser.token, 'programme_hub_participants', workspaceId)).rows.length === 0);

if (failures) throw new Error(`${failures} Programme Hub validation check(s) failed.`);
console.log('PROGRAMME_HUB_LOCAL_VALIDATION=PASS');
