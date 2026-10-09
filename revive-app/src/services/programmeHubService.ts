import type {
  ProgrammeHubAdviser,
  ProgrammeHubContract,
  ProgrammeHubData,
  ProgrammeHubEmployer,
  ProgrammeHubEmployerContact,
  ProgrammeHubMember,
  ProgrammeHubParticipant,
  ProgrammeHubParticipantAdviser,
  ProgrammeHubProgramme,
  ProgrammeHubSaveAttempt,
  ProgrammeHubVacancy,
} from '@/domain/programmeHub';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Programme Hub data.');
  return value as Record<string, unknown>;
};
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const version = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;
const tags = (value: unknown): value is string[] => Array.isArray(value) && value.every(text);
const common = (row: Record<string, unknown>, workspaceId: string) =>
  id(row.id) && row.workspace_id === workspaceId && typeof row.active === 'boolean' && version(row.version);
const rows = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) throw new Error('Invalid Programme Hub data.');
  return value.map(object);
};

export const programmeHubColumns = {
  programmes: 'id,workspace_id,name,timezone,branding_name,sender_display_name,sender_reply_to,active,version',
  advisers: 'id,workspace_id,programme_id,user_id,active,version',
  employers: 'id,workspace_id,programme_id,employer_key,display_name,sector_key,primary_geography_key,active,version',
  contacts: 'id,workspace_id,programme_id,employer_id,contact_key,preferred_name,role_title,business_email,business_phone,suppressed,suppression_reason_key,active,version',
  vacancies: 'id,workspace_id,programme_id,employer_id,employer_contact_id,vacancy_key,title,work_geography_key,required_skill_keys,desired_skill_keys,active,version',
  participants: 'id,workspace_id,programme_id,participant_key,preferred_name,case_reference,desired_role_keys,skill_keys,vacancy_search_geography_keys,residency_evidence_reference,active,version',
  participantAdvisers: 'id,workspace_id,programme_id,participant_id,adviser_user_id,active,version',
  contracts: 'id,workspace_id,programme_id,contract_type,contract_version,effective_from,effective_to,active',
  members: 'user_id,role,status',
} as const;

export interface ProgrammeHubReadGateway {
  read(table: string, columns: string, workspaceId: string): Promise<unknown>;
}

export interface ProgrammeHubInvokeGateway {
  invoke(name: string, body: Record<string, unknown>): Promise<{ status: number; data: unknown }>;
}

export async function loadProgrammeHubData(workspaceId: string, gateway: ProgrammeHubReadGateway): Promise<ProgrammeHubData> {
  if (!id(workspaceId)) throw new Error('Workspace required.');
  const [programmeRows, adviserRows, employerRows, contactRows, vacancyRows, participantRows, assignmentRows, contractRows, memberRows] = await Promise.all([
    gateway.read('programme_hub_programmes', programmeHubColumns.programmes, workspaceId),
    gateway.read('programme_hub_advisers', programmeHubColumns.advisers, workspaceId),
    gateway.read('programme_hub_employers', programmeHubColumns.employers, workspaceId),
    gateway.read('programme_hub_employer_contacts', programmeHubColumns.contacts, workspaceId),
    gateway.read('programme_hub_vacancies', programmeHubColumns.vacancies, workspaceId),
    gateway.read('programme_hub_participants', programmeHubColumns.participants, workspaceId),
    gateway.read('programme_hub_participant_advisers', programmeHubColumns.participantAdvisers, workspaceId),
    gateway.read('programme_hub_contracts', programmeHubColumns.contracts, workspaceId),
    gateway.read('workspace_members', programmeHubColumns.members, workspaceId),
  ]);
  const programmes = rows(programmeRows).map((row): ProgrammeHubProgramme => {
    if (!common(row, workspaceId) || !text(row.name) || !text(row.timezone) ||
      !nullableText(row.branding_name) || !nullableText(row.sender_display_name) || !nullableText(row.sender_reply_to)) {
      throw new Error('Invalid Programme Hub programme.');
    }
    return { id: row.id as string, workspaceId, name: row.name, timezone: row.timezone, brandingName: row.branding_name, senderDisplayName: row.sender_display_name, senderReplyTo: row.sender_reply_to, active: row.active as boolean, version: row.version as number };
  });
  const advisers = rows(adviserRows).map((row): ProgrammeHubAdviser => {
    if (!common(row, workspaceId) || !id(row.programme_id) || !id(row.user_id)) throw new Error('Invalid Programme Hub adviser.');
    return { id: row.id as string, workspaceId, programmeId: row.programme_id, userId: row.user_id, active: row.active as boolean, version: row.version as number };
  });
  const employers = rows(employerRows).map((row): ProgrammeHubEmployer => {
    if (!common(row, workspaceId) || !id(row.programme_id) || !text(row.employer_key) || !text(row.display_name) || !nullableText(row.sector_key) || !nullableText(row.primary_geography_key)) throw new Error('Invalid Programme Hub employer.');
    return { id: row.id as string, workspaceId, programmeId: row.programme_id, employerKey: row.employer_key, displayName: row.display_name, sectorKey: row.sector_key, primaryGeographyKey: row.primary_geography_key, active: row.active as boolean, version: row.version as number };
  });
  const contacts = rows(contactRows).map((row): ProgrammeHubEmployerContact => {
    if (!common(row, workspaceId) || !id(row.programme_id) || !id(row.employer_id) || !text(row.contact_key) || !text(row.preferred_name) || !nullableText(row.role_title) || !nullableText(row.business_email) || !nullableText(row.business_phone) || typeof row.suppressed !== 'boolean' || !nullableText(row.suppression_reason_key)) throw new Error('Invalid Programme Hub contact.');
    return { id: row.id as string, workspaceId, programmeId: row.programme_id, employerId: row.employer_id, contactKey: row.contact_key, preferredName: row.preferred_name, roleTitle: row.role_title, businessEmail: row.business_email, businessPhone: row.business_phone, suppressed: row.suppressed, suppressionReasonKey: row.suppression_reason_key, active: row.active as boolean, version: row.version as number };
  });
  const vacancies = rows(vacancyRows).map((row): ProgrammeHubVacancy => {
    if (!common(row, workspaceId) || !id(row.programme_id) || !id(row.employer_id) || !(row.employer_contact_id === null || id(row.employer_contact_id)) || !text(row.vacancy_key) || !text(row.title) || !nullableText(row.work_geography_key) || !tags(row.required_skill_keys) || !tags(row.desired_skill_keys)) throw new Error('Invalid Programme Hub vacancy.');
    return { id: row.id as string, workspaceId, programmeId: row.programme_id, employerId: row.employer_id, employerContactId: row.employer_contact_id, vacancyKey: row.vacancy_key, title: row.title, workGeographyKey: row.work_geography_key, requiredSkillKeys: row.required_skill_keys, desiredSkillKeys: row.desired_skill_keys, active: row.active as boolean, version: row.version as number };
  });
  const participants = rows(participantRows).map((row): ProgrammeHubParticipant => {
    if (!common(row, workspaceId) || !id(row.programme_id) || !text(row.participant_key) || !text(row.preferred_name) || !text(row.case_reference) || !tags(row.desired_role_keys) || !tags(row.skill_keys) || !tags(row.vacancy_search_geography_keys) || !nullableText(row.residency_evidence_reference)) throw new Error('Invalid Programme Hub participant.');
    return { id: row.id as string, workspaceId, programmeId: row.programme_id, participantKey: row.participant_key, preferredName: row.preferred_name, caseReference: row.case_reference, desiredRoleKeys: row.desired_role_keys, skillKeys: row.skill_keys, vacancySearchGeographyKeys: row.vacancy_search_geography_keys, residencyEvidenceReference: row.residency_evidence_reference, active: row.active as boolean, version: row.version as number };
  });
  const participantAdvisers = rows(assignmentRows).map((row): ProgrammeHubParticipantAdviser => {
    if (!common(row, workspaceId) || !id(row.programme_id) || !id(row.participant_id) || !id(row.adviser_user_id)) throw new Error('Invalid Programme Hub caseload assignment.');
    return { id: row.id as string, workspaceId, programmeId: row.programme_id, participantId: row.participant_id, adviserUserId: row.adviser_user_id, active: row.active as boolean, version: row.version as number };
  });
  const contractTypes = ['residency_eligibility', 'vacancy_search_geography', 'service_delivery_geography', 'outcome_vocabulary', 'spreadsheet_mapping'];
  const contracts = rows(contractRows).map((row): ProgrammeHubContract => {
    if (!id(row.id) || row.workspace_id !== workspaceId || !id(row.programme_id) || !contractTypes.includes(row.contract_type as string) || !text(row.contract_version) || !text(row.effective_from) || !nullableText(row.effective_to) || typeof row.active !== 'boolean') throw new Error('Invalid Programme Hub contract.');
    return { id: row.id, workspaceId, programmeId: row.programme_id, contractType: row.contract_type as ProgrammeHubContract['contractType'], contractVersion: row.contract_version, effectiveFrom: row.effective_from, effectiveTo: row.effective_to, active: row.active };
  });
  const members = rows(memberRows).map((row): ProgrammeHubMember => {
    if (!id(row.user_id) || !['owner', 'admin', 'member', 'viewer'].includes(row.role as string) || !['invited', 'active', 'suspended'].includes(row.status as string)) throw new Error('Invalid workspace member.');
    return { userId: row.user_id, role: row.role as ProgrammeHubMember['role'], status: row.status as ProgrammeHubMember['status'] };
  });
  return { programmes, advisers, employers, contacts, vacancies, participants, participantAdvisers, contracts, members };
}

export async function submitProgrammeHubAttempt(attempt: ProgrammeHubSaveAttempt, gateway: ProgrammeHubInvokeGateway) {
  const response = await gateway.invoke('rev-programme-hub-save', { ...attempt });
  if (response.status !== 200) throw new Error('Save not confirmed. Keep this page open and retry the same change.');
  const value = object(response.data);
  if (value.operation !== attempt.operation || !id(value.recordId) || value.workspaceId !== attempt.workspaceId ||
    !id(value.programmeId) || value.version !== attempt.expectedVersion + 1) {
    throw new Error('Save not confirmed. Keep this page open and retry the same change.');
  }
  return value as { operation: string; recordId: string; workspaceId: string; programmeId: string; version: number };
}

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const storageKey = (workspaceId: string, userId: string) => {
  if (!id(workspaceId) || !id(userId)) throw new Error('Programme identity required.');
  return `rev-programme-hub-save:${workspaceId}:${userId}`;
};
export const rememberProgrammeHubAttempt = (storage: Storage, userId: string, attempt: ProgrammeHubSaveAttempt) =>
  storage.setItem(storageKey(attempt.workspaceId, userId), JSON.stringify(attempt));
export const restoreProgrammeHubAttempt = (storage: Storage, workspaceId: string, userId: string): ProgrammeHubSaveAttempt | null => {
  const raw = storage.getItem(storageKey(workspaceId, userId));
  if (raw === null) return null;
  const value = object(JSON.parse(raw));
  if (value.workspaceId !== workspaceId || !id(value.requestId) || typeof value.operation !== 'string' ||
    !(value.programmeId === null || id(value.programmeId)) || !(value.recordId === null || id(value.recordId)) ||
    !Number.isSafeInteger(value.expectedVersion) || !value.payload || typeof value.payload !== 'object' || Array.isArray(value.payload)) {
    throw new Error('Pending Programme Hub save is invalid.');
  }
  return value as unknown as ProgrammeHubSaveAttempt;
};
export const clearProgrammeHubAttempt = (storage: Storage, workspaceId: string, userId: string) =>
  storage.removeItem(storageKey(workspaceId, userId));
