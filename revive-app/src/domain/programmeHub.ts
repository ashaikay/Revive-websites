export type ProgrammeHubOperation =
  | 'programme'
  | 'adviser'
  | 'employer'
  | 'contact'
  | 'vacancy'
  | 'participant'
  | 'participant_adviser';

export interface ProgrammeHubProgramme {
  id: string;
  workspaceId: string;
  name: string;
  timezone: string;
  brandingName: string | null;
  senderDisplayName: string | null;
  senderReplyTo: string | null;
  active: boolean;
  version: number;
}

export interface ProgrammeHubAdviser {
  id: string;
  workspaceId: string;
  programmeId: string;
  userId: string;
  active: boolean;
  version: number;
}

export interface ProgrammeHubEmployer {
  id: string;
  workspaceId: string;
  programmeId: string;
  employerKey: string;
  displayName: string;
  sectorKey: string | null;
  primaryGeographyKey: string | null;
  active: boolean;
  version: number;
}

export interface ProgrammeHubEmployerContact {
  id: string;
  workspaceId: string;
  programmeId: string;
  employerId: string;
  contactKey: string;
  preferredName: string;
  roleTitle: string | null;
  businessEmail: string | null;
  businessPhone: string | null;
  suppressed: boolean;
  suppressionReasonKey: string | null;
  active: boolean;
  version: number;
}

export interface ProgrammeHubVacancy {
  id: string;
  workspaceId: string;
  programmeId: string;
  employerId: string;
  employerContactId: string | null;
  vacancyKey: string;
  title: string;
  workGeographyKey: string | null;
  requiredSkillKeys: string[];
  desiredSkillKeys: string[];
  active: boolean;
  version: number;
}

export interface ProgrammeHubParticipant {
  id: string;
  workspaceId: string;
  programmeId: string;
  participantKey: string;
  preferredName: string;
  caseReference: string;
  desiredRoleKeys: string[];
  skillKeys: string[];
  vacancySearchGeographyKeys: string[];
  residencyEvidenceReference: string | null;
  active: boolean;
  version: number;
}

export interface ProgrammeHubParticipantAdviser {
  id: string;
  workspaceId: string;
  programmeId: string;
  participantId: string;
  adviserUserId: string;
  active: boolean;
  version: number;
}

export interface ProgrammeHubContract {
  id: string;
  workspaceId: string;
  programmeId: string;
  contractType: 'residency_eligibility' | 'vacancy_search_geography' | 'service_delivery_geography' | 'outcome_vocabulary' | 'spreadsheet_mapping';
  contractVersion: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  active: boolean;
}

export interface ProgrammeHubMember {
  userId: string;
  role: 'owner' | 'admin' | 'member' | 'viewer';
  status: 'invited' | 'active' | 'suspended';
}

export interface ProgrammeHubData {
  programmes: ProgrammeHubProgramme[];
  advisers: ProgrammeHubAdviser[];
  employers: ProgrammeHubEmployer[];
  contacts: ProgrammeHubEmployerContact[];
  vacancies: ProgrammeHubVacancy[];
  participants: ProgrammeHubParticipant[];
  participantAdvisers: ProgrammeHubParticipantAdviser[];
  contracts: ProgrammeHubContract[];
  members: ProgrammeHubMember[];
}

export interface ProgrammeHubSaveAttempt {
  operation: ProgrammeHubOperation;
  workspaceId: string;
  programmeId: string | null;
  recordId: string | null;
  requestId: string;
  expectedVersion: number;
  payload: Record<string, unknown>;
}

export const requiredProgrammeContracts: ProgrammeHubContract['contractType'][] = [
  'residency_eligibility',
  'vacancy_search_geography',
  'service_delivery_geography',
  'outcome_vocabulary',
  'spreadsheet_mapping',
];

export function programmeNeedsReview(programme: ProgrammeHubProgramme, contracts: ProgrammeHubContract[]): string[] {
  const missing: string[] = [];
  if (!programme.brandingName) missing.push('tenant branding');
  if (!programme.senderDisplayName || !programme.senderReplyTo) missing.push('sender identity');
  for (const type of requiredProgrammeContracts) {
    if (!contracts.some((contract) => contract.programmeId === programme.id && contract.contractType === type && contract.active)) {
      missing.push(type.replace(/_/g, ' '));
    }
  }
  return missing;
}
