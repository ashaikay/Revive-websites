export const employerDiscoverySectors = [
  ['construction', 'Construction'],
  ['retail', 'Retail'],
  ['warehousing_logistics', 'Warehousing and logistics'],
  ['traffic_management', 'Traffic management'],
  ['rail_train', 'Rail and train-related work'],
  ['royal_mail_postal', 'Royal Mail and postal delivery'],
  ['post_office_branches', 'Post Office branch roles'],
] as const;

export type EmployerDiscoverySector = typeof employerDiscoverySectors[number][0];
export const defaultEmployerDiscoveryLocation = 'Birmingham / West Midlands';
export const defaultEmployerDiscoverySectors = employerDiscoverySectors.map(([key]) => key);
export const defaultEmployerDiscoveryExclusions = ['barbering'];

export const employerEngagementStages = [
  ['to_review', 'To review'],
  ['ready_to_contact', 'Ready to contact'],
  ['contacted', 'Contacted'],
  ['conversation_underway', 'Conversation underway'],
  ['opportunity_identified', 'Opportunity identified'],
  ['not_pursuing', 'Not pursuing'],
] as const;
export type EmployerEngagementStage = typeof employerEngagementStages[number][0];

export interface EmployerDiscoveryFilters {
  location: string;
  sectors: EmployerDiscoverySector[];
  excludeTerms: string[];
}

export interface EmployerDiscoveryEvidence {
  kind: 'verified_fact' | 'unknown' | 'ai_suggestion';
  label: string;
  value: string;
}

export interface EmployerDiscoveryResult {
  sourceIdentity: string;
  name: string;
  sector: string;
  location: string;
  address: string;
  sourceUrl: string;
  retrievedAt: string;
  evidence: EmployerDiscoveryEvidence[];
}

export interface EmployerDiscoverySearch {
  searchId: string;
  workspaceId: string;
  programmeId: string;
  filters: EmployerDiscoveryFilters;
  status: 'claimed' | 'succeeded' | 'failed';
  results: EmployerDiscoveryResult[] | null;
  errorCode: string | null;
  retrievedAt: string | null;
  createdAt: string;
}

export interface EmployerSourceEvidence {
  employerId: string;
  workspaceId: string;
  programmeId: string;
  sourceProvider: 'companies_house' | null;
  sourceIdentity: string | null;
  sourceUrl: string | null;
  sourceRetrievedAt: string | null;
  sourceAddress: string | null;
  sourceEvidence: unknown[] | null;
  version: number;
}

export interface ProgrammeOutreachSettings {
  id: string;
  workspaceId: string;
  programmeId: string;
  offerSummary: string;
  version: number;
}

export interface EmployerEngagement {
  id: string;
  workspaceId: string;
  programmeId: string;
  employerId: string;
  stage: EmployerEngagementStage;
  responsibleAdviserUserId: string | null;
  nextAction: string | null;
  followUpDate: string | null;
  version: number;
}

export interface EmployerEngagementEvent {
  id: string;
  workspaceId: string;
  programmeId: string;
  employerId: string;
  employerContactId: string | null;
  eventType: 'manual_contact' | 'note' | 'stage_change' | 'draft_prepared' | 'draft_revised';
  channel: 'email' | 'phone' | 'meeting' | 'in_person' | 'other' | null;
  summary: string;
  origin: 'manual' | 'rev_prepared_not_sent';
  actorUserId: string;
  createdAt: string;
}

export interface EmployerOutreachDraft {
  draftId: string;
  rootDraftId: string;
  workspaceId: string;
  programmeId: string;
  employerId: string;
  employerContactId: string | null;
  revision: number;
  subject: string;
  body: string;
  status: 'prepared_not_sent';
  createdAt: string;
}

export interface EmployerEngagementData {
  searches: EmployerDiscoverySearch[];
  employerSources: EmployerSourceEvidence[];
  settings: ProgrammeOutreachSettings | null;
  engagements: EmployerEngagement[];
  events: EmployerEngagementEvent[];
  drafts: EmployerOutreachDraft[];
}

export interface EmployerEngagementSaveAttempt {
  operation: 'discovery_employer' | 'outreach_settings' | 'engagement' | 'engagement_event' | 'draft_revision';
  workspaceId: string;
  programmeId: string;
  recordId: string | null;
  requestId: string;
  expectedVersion: number;
  payload: Record<string, unknown>;
}

export interface EmployerDiscoveryAttempt {
  workspaceId: string;
  programmeId: string;
  requestId: string;
  filters: EmployerDiscoveryFilters;
}

export interface EmployerOutreachAttempt {
  workspaceId: string;
  programmeId: string;
  employerId: string;
  contactId: string | null;
  requestId: string;
  employerVersion: number;
  settingsVersion: number;
  contactVersion: number | null;
}
