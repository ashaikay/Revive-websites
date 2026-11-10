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
  operation === 'participant_intake'
    ? rpc(token, 'save_rev_programme_hub_es_participant_intake', {
        target_workspace_id: workspaceId,
        initiating_user_id: actorId,
        target_request_id: requestId,
        target_programme_id: programmeId,
        target_payload: payload,
      })
    : rpc(token, 'save_rev_programme_hub_record', {
        target_operation: operation,
        target_workspace_id: workspaceId,
        initiating_user_id: actorId,
        target_request_id: requestId,
        target_programme_id: programmeId,
        target_record_id: recordId,
        expected_version: expectedVersion,
        target_payload: payload,
      });
const saveNote = (actorId, workspaceId, programmeId, participantId, body, requestId = randomUUID(), token = serviceKey) =>
  rpc(token, 'save_rev_programme_hub_participant_note', {
    target_workspace_id: workspaceId,
    initiating_user_id: actorId,
    target_request_id: requestId,
    target_programme_id: programmeId,
    target_participant_id: participantId,
    note_body: body,
  });
const saveJobAdvert = (actorId, workspaceId, programmeId, payload, requestId = randomUUID(), token = serviceKey) =>
  rpc(token, 'save_rev_programme_hub_job_advert_import', {
    target_workspace_id: workspaceId,
    initiating_user_id: actorId,
    target_request_id: requestId,
    target_programme_id: programmeId,
    target_payload: payload,
  });
const read = (token, table, workspaceId) => request(token, 'GET', `/rest/v1/${table}?workspace_id=eq.${workspaceId}&select=*`);
const hasExactRecordIds = (rows, expectedIds) =>
  rows.length === expectedIds.length &&
  rows.map((row) => row.id).sort().join(',') === [...expectedIds].sort().join(',');

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
const otherEmployerCreated = await save(adviser.id, workspaceId, 'employer', programmeId, null, 0, {
  ...employerPayload, employerKey: 'EMP-OTHER', displayName: 'Other Synthetic Employer',
});
const otherEmployerId = id(otherEmployerCreated.payload?.record_id);
const otherEmployerContactCreated = await save(adviser.id, workspaceId, 'contact', programmeId, null, 0, {
  employerId: otherEmployerId, contactKey: 'CONTACT-OTHER', preferredName: 'Other Employer Contact',
  roleTitle: '', businessEmail: '', businessPhone: '', suppressed: false, suppressionReasonKey: '', active: true,
});
const otherEmployerContactId = id(otherEmployerContactCreated.payload?.record_id);
const vacancyCreated = await save(adviser.id, workspaceId, 'vacancy', programmeId, null, 0, {
  employerId, employerContactId: contactId, vacancyKey: 'VAC-001', title: 'Synthetic Vacancy', workGeographyKey: '',
  requiredSkillKeys: ['customer_service'], desiredSkillKeys: [], active: true,
});
check('ADVISER_CREATES_VACANCY', vacancyCreated.status === 200);
const importedAdvertPayload = {
  employerId,
  employerContactId: contactId,
  vacancyKey: 'VAC-IMPORT-001',
  title: 'Reviewed warehouse role',
  workGeographyKey: 'Birmingham',
  publishedPay: '£12.50 per hour',
  publishedShifts: '',
  requiredSkillKeys: ['forklift certificate'],
  closingDate: '2026-12-01',
  sourceText: 'Reviewed warehouse role in Birmingham. Pay £12.50 per hour. Forklift certificate required.',
  sourceUrl: 'https://jobs.example.test/vac-import-001',
};
const importedAdvertRequestId = randomUUID();
const adviserImport = await saveJobAdvert(adviser.id, workspaceId, programmeId, importedAdvertPayload, importedAdvertRequestId);
check('VALID_SELECTED_EMPLOYER_CONTACT_IMPORT_SUCCEEDS', adviserImport.status === 200);
check('ADVISER_IMPORT_EXACT_REPLAY', (await saveJobAdvert(adviser.id, workspaceId, programmeId, importedAdvertPayload, importedAdvertRequestId)).payload?.record_id === adviserImport.payload?.record_id);
check('OTHER_EMPLOYER_CONTACT_IMPORT_REJECTED', (await saveJobAdvert(adviser.id, workspaceId, programmeId, {
  ...importedAdvertPayload,
  employerContactId: otherEmployerContactId,
  vacancyKey: 'VAC-IMPORT-FOREIGN-CONTACT',
})).status >= 400);
check('ADVISER_IMPORT_CHANGED_REPLAY_DENIED', (await saveJobAdvert(adviser.id, workspaceId, programmeId, { ...importedAdvertPayload, title: 'Changed role' }, importedAdvertRequestId)).status >= 400);
check('NON_ADVISER_IMPORT_DENIED', (await saveJobAdvert(otherMember.id, workspaceId, programmeId, { ...importedAdvertPayload, vacancyKey: 'VAC-IMPORT-002' })).status >= 400);
check('DUPLICATE_JOB_REFERENCE_DENIED', (await saveJobAdvert(owner.id, workspaceId, programmeId, importedAdvertPayload)).status === 409);
const ownerImport = await saveJobAdvert(owner.id, workspaceId, programmeId, {
  ...importedAdvertPayload,
  employerContactId: '',
  vacancyKey: 'VAC-IMPORT-003',
  title: 'Manager reviewed warehouse role',
  sourceUrl: '',
});
check('NO_CONTACT_IMPORT_SUCCEEDS', ownerImport.status === 200);
const importedRows = (await read(serviceKey, 'programme_hub_vacancies', workspaceId)).rows.filter((row) => row.vacancy_key.startsWith('VAC-IMPORT-'));
check('EXACT_RETRY_CREATES_NO_DUPLICATE', importedRows.filter((row) => row.vacancy_key === importedAdvertPayload.vacancyKey).length === 1);
check('IMPORTED_SOURCE_WORDING_PRESERVED', importedRows.length === 2 && importedRows.some((row) =>
  row.id === adviserImport.payload?.record_id
  && row.source_text === importedAdvertPayload.sourceText
  && row.source_url === importedAdvertPayload.sourceUrl
  && row.source_added_at
  && row.published_shifts === null
));

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

const adviserIntakePayload = { ...participantPayload, participantKey: 'PART-ES-001', caseReference: 'CASE-ES-001', preferredName: 'Jordan' };
const adviserIntakeRequestId = randomUUID();
const adviserIntake = await Promise.all([
  save(adviser.id, workspaceId, 'participant_intake', programmeId, null, 0, adviserIntakePayload, adviserIntakeRequestId),
  save(adviser.id, workspaceId, 'participant_intake', programmeId, null, 0, adviserIntakePayload, adviserIntakeRequestId),
]);
check('ACTIVE_ADVISER_INTAKE_EXACT_REPLAY', adviserIntake.every((value) => value.status === 200) && adviserIntake[0].payload?.record_id === adviserIntake[1].payload?.record_id);
const adviserIntakeId = id(adviserIntake[0].payload?.record_id);
const intakeParticipants = await request(serviceKey, 'GET', `/rest/v1/programme_hub_participants?workspace_id=eq.${workspaceId}&id=eq.${adviserIntakeId}&select=id,created_by_user_id`);
const intakeAssignments = await request(serviceKey, 'GET', `/rest/v1/programme_hub_participant_advisers?workspace_id=eq.${workspaceId}&participant_id=eq.${adviserIntakeId}&select=participant_id,adviser_user_id,active`);
check('ACTIVE_ADVISER_INTAKE_ATOMIC_SELF_ASSIGNMENT', intakeParticipants.rows.length === 1 && intakeParticipants.rows[0].created_by_user_id === adviser.id && intakeAssignments.rows.length === 1 && intakeAssignments.rows[0].adviser_user_id === adviser.id && intakeAssignments.rows[0].active === true);
check('CHANGED_ADVISER_INTAKE_REPLAY_DENIED', (await save(adviser.id, workspaceId, 'participant_intake', programmeId, null, 0, { ...adviserIntakePayload, preferredName: 'Changed' }, adviserIntakeRequestId)).status >= 400);
check('DUPLICATE_ADVISER_INTAKE_DENIED', (await save(adviser.id, workspaceId, 'participant_intake', programmeId, null, 0, adviserIntakePayload)).status >= 400);
check('NON_ADVISER_INTAKE_DENIED', (await save(otherMember.id, workspaceId, 'participant_intake', programmeId, null, 0, { ...adviserIntakePayload, participantKey: 'PART-ES-002', caseReference: 'CASE-ES-002' })).status >= 400);
const otherProgrammeCreated = await save(owner.id, workspaceId, 'programme', null, null, 0, { ...programmePayload, name: 'Other Synthetic Programme' });
const otherProgrammeId = id(otherProgrammeCreated.payload?.record_id);
check('CROSS_PROGRAMME_ADVISER_INTAKE_DENIED', (await save(adviser.id, workspaceId, 'participant_intake', otherProgrammeId, null, 0, { ...adviserIntakePayload, participantKey: 'PART-ES-003', caseReference: 'CASE-ES-003' })).status >= 400);
check('AUTHENTICATED_ADVISER_INTAKE_RPC_DENIED', (await save(adviser.id, workspaceId, 'participant_intake', programmeId, null, 0, { ...adviserIntakePayload, participantKey: 'PART-ES-004', caseReference: 'CASE-ES-004' }, randomUUID(), adviser.token)).status >= 400);

const assignmentCreated = await save(owner.id, workspaceId, 'participant_adviser', programmeId, null, 0, { participantId, adviserUserId: adviser.id, active: true });
check('OWNER_ASSIGNS_CASELOAD', assignmentCreated.status === 200);
const adviserParticipants = await read(adviser.token, 'programme_hub_participants', workspaceId);
check('ASSIGNED_ADVISER_READS_PARTICIPANT', hasExactRecordIds(adviserParticipants.rows, [participantId, adviserIntakeId]));
check('UNASSIGNED_MEMBER_READS_NO_PARTICIPANTS', (await read(otherMember.token, 'programme_hub_participants', workspaceId)).rows.length === 0);
check('OUTSIDER_READS_NO_PARTICIPANTS', (await read(outsider.token, 'programme_hub_participants', workspaceId)).rows.length === 0);
const ownerParticipants = await read(owner.token, 'programme_hub_participants', workspaceId);
check('OWNER_READS_PROGRAMME_WIDE_PARTICIPANTS', hasExactRecordIds(ownerParticipants.rows, [participantId, unassignedId, adviserIntakeId]));
check('ADVISER_READS_PROGRAMME_EMPLOYERS', (await read(adviser.token, 'programme_hub_employers', workspaceId)).rows.length === 1);
check('NON_ADVISER_READS_NO_EMPLOYERS', (await read(otherMember.token, 'programme_hub_employers', workspaceId)).rows.length === 0);

const noteRequestId = randomUUID();
const noteCreated = await Promise.all([
  saveNote(adviser.id, workspaceId, programmeId, participantId, 'Agreed to update the CV this week.', noteRequestId),
  saveNote(adviser.id, workspaceId, programmeId, participantId, 'Agreed to update the CV this week.', noteRequestId),
]);
check('PARTICIPANT_NOTE_REPLAY_ONE_RESULT', noteCreated.every((result) => result.status === 200) && noteCreated[0].payload?.record_id === noteCreated[1].payload?.record_id);
check('CHANGED_PARTICIPANT_NOTE_REPLAY_DENIED', (await saveNote(adviser.id, workspaceId, programmeId, participantId, 'Changed note body.', noteRequestId)).status >= 400);
const adviserNotes = await read(adviser.token, 'programme_hub_participant_notes', workspaceId);
check('ASSIGNED_ADVISER_READS_PROGRAMME_NOTE', adviserNotes.rows.length === 1 && adviserNotes.rows[0].body === 'Agreed to update the CV this week.');
check('PARTICIPANT_NOTE_SERVER_AUTHOR', adviserNotes.rows[0]?.author_user_id === adviser.id);
check('PARTICIPANT_NOTE_SERVER_TIMESTAMP', typeof adviserNotes.rows[0]?.created_at === 'string' && !Number.isNaN(Date.parse(adviserNotes.rows[0].created_at)));
check('UNASSIGNED_MEMBER_READS_NO_NOTES', (await read(otherMember.token, 'programme_hub_participant_notes', workspaceId)).rows.length === 0);
check('OUTSIDER_READS_NO_NOTES', (await read(outsider.token, 'programme_hub_participant_notes', workspaceId)).rows.length === 0);
check('UNASSIGNED_ADVISER_NOTE_DENIED', (await saveNote(adviser.id, workspaceId, programmeId, unassignedId, 'Not in this caseload.')).status >= 400);
check('CROSS_PROGRAMME_NOTE_DENIED', (await saveNote(owner.id, workspaceId, randomUUID(), participantId, 'Wrong programme.')).status >= 400);
check('CROSS_WORKSPACE_NOTE_DENIED', (await saveNote(owner.id, otherWorkspaceId, programmeId, participantId, 'Wrong workspace.')).status >= 400);
check('DIRECT_NOTE_INSERT_DENIED', (await request(owner.token, 'POST', '/rest/v1/programme_hub_participant_notes', {
  workspace_id: workspaceId,
  programme_id: programmeId,
  participant_id: participantId,
  body: 'Direct note.',
  author_user_id: owner.id,
})).status >= 400);
check('AUTHENTICATED_NOTE_RPC_DENIED', (await saveNote(owner.id, workspaceId, programmeId, participantId, 'Direct RPC.', randomUUID(), owner.token)).status >= 400);

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

// Contact details are tested against isolated local Supabase, never a hosted project.
const contactPayload = { participantId, phone: '0121 555 0100', email: 'synthetic@example.test', addressLine1: '1 Test Road', addressLine2: '', town: 'Birmingham', postcode: 'B1 1AA' };
const saveParticipantContact = (actorId, ws, programme, recordId, version, payload, requestId = randomUUID(), token = serviceKey) => rpc(token, 'save_rev_programme_hub_participant_contact', {
  target_workspace_id: ws, initiating_user_id: actorId, target_request_id: requestId, target_programme_id: programme,
  target_record_id: recordId, expected_version: version, target_payload: payload,
});
const contactRequestId = randomUUID();
const contactsCreated = await Promise.all([
  saveParticipantContact(adviser.id, workspaceId, programmeId, null, 0, contactPayload, contactRequestId),
  saveParticipantContact(adviser.id, workspaceId, programmeId, null, 0, contactPayload, contactRequestId),
]);
check('CONTACT_CONCURRENT_EXACT_REPLAY', contactsCreated.every((value) => value.status === 200) && contactsCreated[0].payload?.record_id === contactsCreated[1].payload?.record_id);
if (!contactsCreated.every((value) => value.status === 200)) throw new Error('Contact fixture save failed; inspect isolated database logs without publishing contact payloads.');
const participantContactId = id(contactsCreated[0].payload.record_id);
check('CONTACT_CHANGED_RETRY_DENIED', (await saveParticipantContact(adviser.id, workspaceId, programmeId, null, 0, { ...contactPayload, phone: '0121 555 0200' }, contactRequestId)).status >= 400);
const contactRead = await read(adviser.token, 'programme_hub_participant_contacts', workspaceId);
check('CONTACT_ASSIGNED_ADVISER_READS', contactRead.status === 200 && contactRead.rows.length === 1 && contactRead.rows[0].postcode === 'B1 1AA');
check('CONTACT_SERVER_AUTHOR_TIMESTAMP', contactRead.rows[0]?.created_by_user_id === adviser.id && Number.isFinite(Date.parse(contactRead.rows[0]?.created_at)));
check('CONTACT_OWNER_READS', (await read(owner.token, 'programme_hub_participant_contacts', workspaceId)).rows.length === 1);
check('CONTACT_UNASSIGNED_MEMBER_READS_NONE', (await read(otherMember.token, 'programme_hub_participant_contacts', workspaceId)).rows.length === 0);
check('CONTACT_OUTSIDER_READS_NONE', (await read(outsider.token, 'programme_hub_participant_contacts', workspaceId)).rows.length === 0);
check('CONTACT_UNASSIGNED_CASELOAD_WRITE_DENIED', (await saveParticipantContact(adviser.id, workspaceId, programmeId, null, 0, { ...contactPayload, participantId: unassignedId })).status >= 400);
check('CONTACT_CROSS_PROGRAMME_DENIED', (await saveParticipantContact(owner.id, workspaceId, randomUUID(), null, 0, contactPayload)).status >= 400);
check('CONTACT_CROSS_WORKSPACE_DENIED', (await saveParticipantContact(owner.id, otherWorkspaceId, programmeId, null, 0, contactPayload)).status >= 400);
check('CONTACT_AUTHENTICATED_RPC_DENIED', (await saveParticipantContact(owner.id, workspaceId, programmeId, null, 0, contactPayload, randomUUID(), owner.token)).status >= 400);
check('CONTACT_DIRECT_INSERT_DENIED', (await request(owner.token, 'POST', '/rest/v1/programme_hub_participant_contacts', { workspace_id: workspaceId, programme_id: programmeId, participant_id: participantId, created_by_user_id: owner.id, updated_by_user_id: owner.id })).status >= 400);
check('CONTACT_DIRECT_UPDATE_DENIED', (await request(owner.token, 'PATCH', `/rest/v1/programme_hub_participant_contacts?id=eq.${participantContactId}`, { phone: '0121 555 0300' })).status >= 400);
check('CONTACT_INVALID_POSTCODE_DENIED', (await saveParticipantContact(owner.id, workspaceId, programmeId, participantContactId, 1, { ...contactPayload, postcode: 'UNKNOWN' })).status >= 400);
const updatedContact = await saveParticipantContact(owner.id, workspaceId, programmeId, participantContactId, 1, { ...contactPayload, email: '', addressLine2: '' });
check('CONTACT_OWNER_UPDATE_AND_CLEAR', updatedContact.status === 200 && updatedContact.payload?.version === 2 && (await read(owner.token, 'programme_hub_participant_contacts', workspaceId)).rows[0]?.email === null);
check('CONTACT_STALE_VERSION_DENIED', (await saveParticipantContact(adviser.id, workspaceId, programmeId, participantContactId, 1, contactPayload)).status >= 400);
const contactRace = await Promise.all([
  saveParticipantContact(adviser.id, workspaceId, programmeId, participantContactId, 2, { ...contactPayload, phone: '0121 555 0400' }),
  saveParticipantContact(adviser.id, workspaceId, programmeId, participantContactId, 2, { ...contactPayload, phone: '0121 555 0500' }),
]);
check('CONTACT_CONCURRENT_DIFFERENT_UPDATE_ONCE', contactRace.filter((value) => value.status === 200).length === 1 && contactRace.filter((value) => value.status >= 400).length === 1);
await request(serviceKey, 'PATCH', `/rest/v1/programme_hub_participant_advisers?workspace_id=eq.${workspaceId}&participant_id=eq.${participantId}&adviser_user_id=eq.${adviser.id}`, { active: false });
check('CONTACT_REVOKED_CASELOAD_READ_DENIED', (await read(adviser.token, 'programme_hub_participant_contacts', workspaceId)).rows.length === 0);
check('CONTACT_REVOKED_CASELOAD_REPLAY_DENIED', (await saveParticipantContact(adviser.id, workspaceId, programmeId, null, 0, contactPayload, contactRequestId)).status >= 400);
await request(serviceKey, 'PATCH', `/rest/v1/programme_hub_participant_advisers?workspace_id=eq.${workspaceId}&participant_id=eq.${participantId}&adviser_user_id=eq.${adviser.id}`, { active: true });
const contactAudits = await request(owner.token, 'GET', `/rest/v1/audit_log?workspace_id=eq.${workspaceId}&action=eq.programme_hub.participant_contact.saved&select=metadata`);
check('CONTACT_AUDIT_EXCLUDES_CONTACT_CONTENT', contactAudits.status === 200 && contactAudits.rows.length === 3 && contactAudits.rows.every((row) => Object.keys(row.metadata).sort().join(',') === 'participant_id,programme_id,request_id,version'));

const currentParticipantPayload = { ...participantPayload, skillKeys: ['customer_service', 'stock_control'] };
check('ES_ARCHIVE_DENIED', (await save(adviser.id, workspaceId, 'participant', programmeId, participantId, 2, { ...currentParticipantPayload, active: false })).status >= 400);
const archiveRequestId = randomUUID();
const archived = await save(owner.id, workspaceId, 'participant', programmeId, participantId, 2, { ...currentParticipantPayload, active: false }, archiveRequestId);
const archivedReplay = await save(owner.id, workspaceId, 'participant', programmeId, participantId, 2, { ...currentParticipantPayload, active: false }, archiveRequestId);
check('MANAGER_ARCHIVES_WITH_EXACT_REPLAY', archived.status === 200 && archived.payload?.version === 3 && archivedReplay.status === 200 && archivedReplay.payload?.version === 3);
check('CHANGED_ARCHIVE_REPLAY_DENIED', (await save(owner.id, workspaceId, 'participant', programmeId, participantId, 2, currentParticipantPayload, archiveRequestId)).status >= 400);
check('ARCHIVED_RECORD_REMAINS_READABLE_TO_ASSIGNED_ES', hasExactRecordIds((await read(adviser.token, 'programme_hub_participants', workspaceId)).rows, [participantId, adviserIntakeId]));
check('ARCHIVED_PROFILE_WRITE_DENIED', (await save(owner.id, workspaceId, 'participant', programmeId, participantId, 3, { ...currentParticipantPayload, active: false, preferredName: 'Changed while archived' })).status >= 400);
check('ARCHIVED_NOTE_WRITE_DENIED', (await saveNote(adviser.id, workspaceId, programmeId, participantId, 'Archived write attempt.')).status >= 400);
check('ARCHIVED_CONTACT_WRITE_DENIED', (await saveParticipantContact(owner.id, workspaceId, programmeId, participantContactId, 3, contactPayload)).status >= 400);
const archivedAssignmentRemoved = await save(owner.id, workspaceId, 'participant_adviser', programmeId, id(assignmentCreated.payload?.record_id), 1, {
  participantId, adviserUserId: adviser.id, active: false,
});
check('ARCHIVED_ASSIGNMENT_CAN_BE_REMOVED', archivedAssignmentRemoved.status === 200 && archivedAssignmentRemoved.payload?.version === 2);
check('ARCHIVED_ASSIGNMENT_RESTORE_DENIED', (await save(owner.id, workspaceId, 'participant_adviser', programmeId, id(assignmentCreated.payload?.record_id), 2, {
  participantId, adviserUserId: adviser.id, active: true,
})).status >= 400);
const archivedParticipantRows = await request(serviceKey, 'GET', `/rest/v1/programme_hub_participants?workspace_id=eq.${workspaceId}&id=eq.${participantId}&select=id,active,version,preferred_name,skill_keys`);
const archivedNoteRows = await request(serviceKey, 'GET', `/rest/v1/programme_hub_participant_notes?workspace_id=eq.${workspaceId}&participant_id=eq.${participantId}&select=id`);
const archivedContactRows = await request(serviceKey, 'GET', `/rest/v1/programme_hub_participant_contacts?workspace_id=eq.${workspaceId}&participant_id=eq.${participantId}&select=id`);
const archivedAssignmentRows = await request(serviceKey, 'GET', `/rest/v1/programme_hub_participant_advisers?workspace_id=eq.${workspaceId}&participant_id=eq.${participantId}&select=id,active`);
check('ARCHIVE_PRESERVES_PROFILE_AND_HISTORY', archivedParticipantRows.rows.length === 1 && archivedParticipantRows.rows[0].active === false &&
  archivedParticipantRows.rows[0].preferred_name === 'Alex' && archivedParticipantRows.rows[0].skill_keys.includes('stock_control') &&
  archivedNoteRows.rows.length === 1 && archivedContactRows.rows.length === 1 &&
  archivedAssignmentRows.rows.length === 1 && archivedAssignmentRows.rows[0].active === false);
check('STALE_REACTIVATION_DENIED', (await save(owner.id, workspaceId, 'participant', programmeId, participantId, 2, currentParticipantPayload)).status >= 400);
const reactivated = await save(owner.id, workspaceId, 'participant', programmeId, participantId, 3, currentParticipantPayload);
check('MANAGER_REACTIVATES_PARTICIPANT', reactivated.status === 200 && reactivated.payload?.version === 4);
check('REACTIVATION_DOES_NOT_RESTORE_REMOVED_ES_ACCESS', hasExactRecordIds((await read(adviser.token, 'programme_hub_participants', workspaceId)).rows, [adviserIntakeId]));
const lifecycleAudits = await request(owner.token, 'GET', `/rest/v1/audit_log?workspace_id=eq.${workspaceId}&action=in.(programme_hub.participant.archived,programme_hub.participant.reactivated)&select=action,resource_id`);
check('ARCHIVE_REACTIVATE_AUDIT_HISTORY', lifecycleAudits.rows.length === 2 &&
  new Set(lifecycleAudits.rows.map((row) => row.action)).size === 2 &&
  lifecycleAudits.rows.every((row) => row.resource_id === participantId));

const adviserRecordId = id(adviserAdded.payload?.record_id);
const adviserRemoved = await save(owner.id, workspaceId, 'adviser', programmeId, adviserRecordId, 1, { userId: adviser.id, active: false });
check('OWNER_REMOVES_PROGRAMME_ADVISER', adviserRemoved.status === 200 && adviserRemoved.payload?.version === 2);
check('REMOVED_PROGRAMME_ADVISER_READ_DENIED', (await read(adviser.token, 'programme_hub_participants', workspaceId)).rows.length === 0);
const preservedAdviser = await request(serviceKey, 'GET', `/rest/v1/programme_hub_advisers?workspace_id=eq.${workspaceId}&id=eq.${adviserRecordId}&select=id,active,version`);
const preservedAssignments = await request(serviceKey, 'GET', `/rest/v1/programme_hub_participant_advisers?workspace_id=eq.${workspaceId}&adviser_user_id=eq.${adviser.id}&select=id,active`);
check('PROGRAMME_ADVISER_HISTORY_PRESERVED', preservedAdviser.rows.length === 1 && preservedAdviser.rows[0].active === false && preservedAdviser.rows[0].version === 2 && preservedAssignments.rows.length === 2);
check('REMOVED_PROGRAMME_ADVISER_WRITE_DENIED', (await save(adviser.id, workspaceId, 'employer', programmeId, null, 0, { ...employerPayload, employerKey: 'EMP-REMOVED' })).status >= 400);
const adviserRestored = await save(owner.id, workspaceId, 'adviser', programmeId, adviserRecordId, 2, { userId: adviser.id, active: true });
check('OWNER_RESTORES_EXISTING_PROGRAMME_ADVISER', adviserRestored.status === 200 && adviserRestored.payload?.record_id === adviserRecordId && adviserRestored.payload?.version === 3);

const contracts = await read(owner.token, 'programme_hub_contracts', workspaceId);
check('NO_FABRICATED_PROGRAMME_CONTRACTS', contracts.status === 200 && contracts.rows.length === 0);
const audits = await request(owner.token, 'GET', `/rest/v1/audit_log?workspace_id=eq.${workspaceId}&action=like.programme_hub.*&select=action,resource_type,metadata`);
const lifecycleActions = new Set(['programme_hub.participant.archived', 'programme_hub.participant.reactivated']);
const versionedRequestAudits = audits.rows.filter((row) => !lifecycleActions.has(row.action));
check('AUDIT_HISTORY_RECORDED', audits.status === 200 &&
  audits.rows.filter((row) => lifecycleActions.has(row.action)).length === 2 &&
  versionedRequestAudits.length >= 8 &&
  versionedRequestAudits.every((row) => row.metadata?.request_id && row.metadata?.version));

await request(serviceKey, 'PATCH', `/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${adviser.id}`, { status: 'suspended' });
check('SUSPENDED_ADVISER_WRITE_DENIED', (await save(adviser.id, workspaceId, 'employer', programmeId, null, 0, { ...employerPayload, employerKey: 'EMP-003' })).status >= 400);
check('SUSPENDED_ADVISER_INTAKE_REPLAY_DENIED', (await save(adviser.id, workspaceId, 'participant_intake', programmeId, null, 0, adviserIntakePayload, adviserIntakeRequestId)).status >= 400);
check('SUSPENDED_ADVISER_READ_DENIED', (await read(adviser.token, 'programme_hub_participants', workspaceId)).rows.length === 0);
check('CONTACT_SUSPENDED_ADVISER_READ_DENIED', (await read(adviser.token, 'programme_hub_participant_contacts', workspaceId)).rows.length === 0);
check('CONTACT_SUSPENDED_ADVISER_REPLAY_DENIED', (await saveParticipantContact(adviser.id, workspaceId, programmeId, null, 0, contactPayload, contactRequestId)).status >= 400);

if (failures) throw new Error(`${failures} Programme Hub validation check(s) failed.`);
console.log('PROGRAMME_HUB_LOCAL_VALIDATION=PASS');
