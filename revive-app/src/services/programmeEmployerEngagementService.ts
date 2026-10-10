import type {
  EmployerDiscoveryAttempt,
  EmployerDiscoveryEvidence,
  EmployerDiscoveryFilters,
  EmployerDiscoveryResult,
  EmployerDiscoverySearch,
  EmployerEngagement,
  EmployerEngagementData,
  EmployerEngagementEvent,
  EmployerEngagementSaveAttempt,
  EmployerSourceEvidence,
  EmployerOutreachAttempt,
  EmployerOutreachDraft,
  ProgrammeOutreachSettings,
} from '@/domain/programmeEmployerEngagement';
import { employerDiscoverySectors, employerEngagementStages } from '@/domain/programmeEmployerEngagement';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const id = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid employer engagement data.');
  return value as Record<string, unknown>;
};
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const nullableText = (value: unknown): value is string | null => value === null || typeof value === 'string';
const safeVersion = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 1;
const allowedSectors = new Set(employerDiscoverySectors.map(([key]) => key));
const allowedStages = new Set(employerEngagementStages.map(([key]) => key));

export const employerEngagementColumns = {
  searches: 'id,workspace_id,programme_id,filters,status,results,error_code,retrieved_at,created_at',
  employerSources: 'id,workspace_id,programme_id,source_provider,source_identity,source_url,source_retrieved_at,source_address,source_evidence,version',
  settings: 'id,workspace_id,programme_id,offer_summary,version',
  engagements: 'id,workspace_id,programme_id,employer_id,stage,responsible_adviser_user_id,next_action,follow_up_date,version',
  events: 'id,workspace_id,programme_id,employer_id,employer_contact_id,event_type,channel,summary,origin,actor_user_id,created_at',
  drafts: 'id,workspace_id,programme_id,employer_id,employer_contact_id,root_draft_id,revision,subject,body,status,created_at',
} as const;

export interface EmployerEngagementReadGateway {
  read(table: string, columns: string, workspaceId: string, programmeId: string): Promise<unknown>;
}
export interface EmployerEngagementInvokeGateway {
  invoke(name: string, body: Record<string, unknown>): Promise<{ status: number; data: unknown }>;
}

function filters(value: unknown): EmployerDiscoveryFilters {
  const raw = object(value);
  if (Object.keys(raw).sort().join(',') !== 'excludeTerms,location,sectors' || typeof raw.location !== 'string' ||
    raw.location.length < 2 || raw.location.length > 120 || raw.location.trim() !== raw.location ||
    !Array.isArray(raw.sectors) || raw.sectors.length < 1 || raw.sectors.length > 7 ||
    !raw.sectors.every((item) => typeof item === 'string' && allowedSectors.has(item as never)) ||
    new Set(raw.sectors).size !== raw.sectors.length || !Array.isArray(raw.excludeTerms) ||
    raw.excludeTerms.length > 20 || !raw.excludeTerms.every((item) => typeof item === 'string' && item.length >= 1 && item.length <= 80 && item.trim() === item)) {
    throw new Error('Choose a location and at least one supported employer sector.');
  }
  return raw as unknown as EmployerDiscoveryFilters;
}

function evidence(value: unknown): EmployerDiscoveryEvidence[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) throw new Error('Invalid discovery evidence.');
  return value.map((item) => {
    const raw = object(item);
    if (Object.keys(raw).sort().join(',') !== 'kind,label,value' ||
      !['verified_fact', 'unknown', 'ai_suggestion'].includes(raw.kind as string) ||
      !text(raw.label) || !text(raw.value)) throw new Error('Invalid discovery evidence.');
    return raw as unknown as EmployerDiscoveryEvidence;
  });
}

function result(value: unknown): EmployerDiscoveryResult {
  const raw = object(value);
  if (Object.keys(raw).sort().join(',') !== 'address,evidence,location,name,retrievedAt,sector,sourceIdentity,sourceUrl' ||
    !text(raw.sourceIdentity) || !text(raw.name) || typeof raw.sector !== 'string' || typeof raw.location !== 'string' ||
    typeof raw.address !== 'string' || !text(raw.sourceUrl) || !/^https:\/\/find-and-update\.company-information\.service\.gov\.uk\/company\//.test(raw.sourceUrl) ||
    !text(raw.retrievedAt) || Number.isNaN(Date.parse(raw.retrievedAt))) throw new Error('Invalid employer discovery result.');
  return { ...raw, evidence: evidence(raw.evidence) } as unknown as EmployerDiscoveryResult;
}

const rows = (value: unknown): Record<string, unknown>[] => {
  if (!Array.isArray(value)) throw new Error('Invalid employer engagement data.');
  return value.map(object);
};

export async function loadEmployerEngagementData(
  workspaceId: string,
  programmeId: string,
  gateway: EmployerEngagementReadGateway,
): Promise<EmployerEngagementData> {
  if (!id(workspaceId) || !id(programmeId)) throw new Error('Programme required.');
  const [searchRows, employerSourceRows, settingRows, engagementRows, eventRows, draftRows] = await Promise.all([
    gateway.read('programme_hub_employer_discovery_searches', employerEngagementColumns.searches, workspaceId, programmeId),
    gateway.read('programme_hub_employers', employerEngagementColumns.employerSources, workspaceId, programmeId),
    gateway.read('programme_hub_outreach_settings', employerEngagementColumns.settings, workspaceId, programmeId),
    gateway.read('programme_hub_employer_engagements', employerEngagementColumns.engagements, workspaceId, programmeId),
    gateway.read('programme_hub_employer_engagement_events', employerEngagementColumns.events, workspaceId, programmeId),
    gateway.read('programme_hub_employer_outreach_drafts', employerEngagementColumns.drafts, workspaceId, programmeId),
  ]);
  const searches = rows(searchRows).map((row): EmployerDiscoverySearch => {
    if (!id(row.id) || row.workspace_id !== workspaceId || row.programme_id !== programmeId ||
      !['claimed', 'succeeded', 'failed'].includes(row.status as string) ||
      !(row.results === null || Array.isArray(row.results)) || !nullableText(row.error_code) ||
      !nullableText(row.retrieved_at) || !text(row.created_at)) throw new Error('Invalid employer discovery search.');
    return {
      searchId: row.id, workspaceId, programmeId, filters: filters(row.filters),
      status: row.status as EmployerDiscoverySearch['status'],
      results: row.results === null ? null : row.results.map(result), errorCode: row.error_code,
      retrievedAt: row.retrieved_at, createdAt: row.created_at,
    };
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const employerSources = rows(employerSourceRows).map((row): EmployerSourceEvidence => {
    if (!id(row.id) || row.workspace_id !== workspaceId || row.programme_id !== programmeId ||
      !(row.source_provider === null || row.source_provider === 'companies_house') ||
      !nullableText(row.source_identity) || !nullableText(row.source_url) || !nullableText(row.source_retrieved_at) ||
      !nullableText(row.source_address) || !(row.source_evidence === null || Array.isArray(row.source_evidence)) ||
      !safeVersion(row.version)) throw new Error('Invalid employer source evidence.');
    return {
      employerId: row.id, workspaceId, programmeId, sourceProvider: row.source_provider,
      sourceIdentity: row.source_identity, sourceUrl: row.source_url, sourceRetrievedAt: row.source_retrieved_at,
      sourceAddress: row.source_address, sourceEvidence: row.source_evidence as unknown[] | null, version: row.version,
    };
  });
  const parsedSettings = rows(settingRows).map((row): ProgrammeOutreachSettings => {
    if (!id(row.id) || row.workspace_id !== workspaceId || row.programme_id !== programmeId ||
      !text(row.offer_summary) || !safeVersion(row.version)) throw new Error('Invalid programme outreach settings.');
    return { id: row.id, workspaceId, programmeId, offerSummary: row.offer_summary, version: row.version };
  });
  if (parsedSettings.length > 1) throw new Error('Invalid programme outreach settings.');
  const engagements = rows(engagementRows).map((row): EmployerEngagement => {
    if (!id(row.id) || row.workspace_id !== workspaceId || row.programme_id !== programmeId || !id(row.employer_id) ||
      !allowedStages.has(row.stage as never) || !(row.responsible_adviser_user_id === null || id(row.responsible_adviser_user_id)) ||
      !nullableText(row.next_action) || !nullableText(row.follow_up_date) || !safeVersion(row.version)) throw new Error('Invalid employer engagement.');
    return {
      id: row.id, workspaceId, programmeId, employerId: row.employer_id,
      stage: row.stage as EmployerEngagement['stage'], responsibleAdviserUserId: row.responsible_adviser_user_id,
      nextAction: row.next_action, followUpDate: row.follow_up_date, version: row.version,
    };
  });
  const events = rows(eventRows).map((row): EmployerEngagementEvent => {
    if (!id(row.id) || row.workspace_id !== workspaceId || row.programme_id !== programmeId || !id(row.employer_id) ||
      !(row.employer_contact_id === null || id(row.employer_contact_id)) ||
      !['manual_contact', 'note', 'stage_change', 'draft_prepared', 'draft_revised'].includes(row.event_type as string) ||
      !(row.channel === null || ['email', 'phone', 'meeting', 'in_person', 'other'].includes(row.channel as string)) ||
      !text(row.summary) || !['manual', 'rev_prepared_not_sent'].includes(row.origin as string) ||
      !id(row.actor_user_id) || !text(row.created_at)) throw new Error('Invalid employer engagement history.');
    return {
      id: row.id, workspaceId, programmeId, employerId: row.employer_id,
      employerContactId: row.employer_contact_id, eventType: row.event_type as EmployerEngagementEvent['eventType'],
      channel: row.channel as EmployerEngagementEvent['channel'], summary: row.summary,
      origin: row.origin as EmployerEngagementEvent['origin'], actorUserId: row.actor_user_id, createdAt: row.created_at,
    };
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  const drafts = rows(draftRows).map((row): EmployerOutreachDraft => {
    if (!id(row.id) || row.workspace_id !== workspaceId || row.programme_id !== programmeId || !id(row.employer_id) ||
      !(row.employer_contact_id === null || id(row.employer_contact_id)) || !id(row.root_draft_id) ||
      !safeVersion(row.revision) || !text(row.subject) || !text(row.body) || row.status !== 'prepared_not_sent' ||
      !text(row.created_at)) throw new Error('Invalid employer outreach draft.');
    return {
      draftId: row.id, rootDraftId: row.root_draft_id, workspaceId, programmeId, employerId: row.employer_id,
      employerContactId: row.employer_contact_id, revision: row.revision, subject: row.subject,
      body: row.body, status: 'prepared_not_sent', createdAt: row.created_at,
    };
  }).sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { searches, employerSources, settings: parsedSettings[0] ?? null, engagements, events, drafts };
}

function publicSearch(value: unknown, attempt: EmployerDiscoveryAttempt) {
  const raw = object(value);
  if (Object.keys(raw).sort().join(',') !== 'errorCode,results,retrievedAt,searchId,status' ||
    raw.searchId !== attempt.requestId || !['claimed', 'succeeded', 'failed'].includes(raw.status as string) ||
    !(raw.results === null || Array.isArray(raw.results)) || !nullableText(raw.errorCode) || !nullableText(raw.retrievedAt)) {
    throw new Error('Employer discovery outcome is unconfirmed.');
  }
  return {
    searchId: raw.searchId as string, status: raw.status as EmployerDiscoverySearch['status'],
    results: raw.results === null ? null : raw.results.map(result), errorCode: raw.errorCode as string | null,
    retrievedAt: raw.retrievedAt as string | null,
  };
}

export async function checkEmployerDiscoveryAvailability(
  workspaceId: string,
  programmeId: string,
  gateway: EmployerEngagementInvokeGateway,
) {
  const response = await gateway.invoke('rev-programme-employer-discovery', { action: 'status', workspaceId, programmeId });
  const raw = object(response.data);
  if (response.status !== 200 || Object.keys(raw).sort().join(',') !== 'available,provider' ||
    typeof raw.available !== 'boolean' || raw.provider !== 'Companies House') throw new Error('Employer discovery availability is unknown.');
  return raw as { available: boolean; provider: 'Companies House' };
}

export async function submitEmployerDiscovery(
  attempt: EmployerDiscoveryAttempt,
  gateway: EmployerEngagementInvokeGateway,
) {
  const response = await gateway.invoke('rev-programme-employer-discovery', {
    action: 'search', workspaceId: attempt.workspaceId, programmeId: attempt.programmeId,
    requestId: attempt.requestId, filters: filters(attempt.filters),
  });
  if (response.status !== 200) throw new Error(response.status === 503
    ? 'Employer discovery is unavailable until Companies House access is configured.'
    : 'Employer discovery outcome is unconfirmed. Retry the exact same search.');
  return publicSearch(response.data, attempt);
}

export async function submitEmployerEngagementSave(
  attempt: EmployerEngagementSaveAttempt,
  gateway: EmployerEngagementInvokeGateway,
) {
  const response = await gateway.invoke('rev-programme-employer-engagement-save', { ...attempt });
  if (response.status !== 200) throw new Error('Employer engagement save not confirmed. Retry the exact same change.');
  const raw = object(response.data);
  if (Object.keys(raw).sort().join(',') !== 'duplicate,operation,programmeId,recordId,version,workspaceId' ||
    raw.operation !== attempt.operation || raw.workspaceId !== attempt.workspaceId ||
    raw.programmeId !== attempt.programmeId || !id(raw.recordId) || !safeVersion(raw.version) ||
    typeof raw.duplicate !== 'boolean') throw new Error('Employer engagement save not confirmed. Retry the exact same change.');
  return raw as unknown as { duplicate: boolean; operation: string; programmeId: string; recordId: string; version: number; workspaceId: string };
}

export async function checkEmployerOutreachAvailability(
  workspaceId: string,
  programmeId: string,
  gateway: EmployerEngagementInvokeGateway,
) {
  const response = await gateway.invoke('rev-programme-employer-outreach-draft', { action: 'status', workspaceId, programmeId });
  const raw = object(response.data);
  if (response.status !== 200 || Object.keys(raw).sort().join(',') !== 'available,model' ||
    typeof raw.available !== 'boolean' || !(raw.model === null || typeof raw.model === 'string')) {
    throw new Error('Outreach draft availability is unknown.');
  }
  return raw as { available: boolean; model: string | null };
}

function publicDraft(value: unknown, attempt: EmployerOutreachAttempt) {
  const raw = object(value);
  if (Object.keys(raw).sort().join(',') !== 'attemptId,draft,errorCode,status' ||
    raw.attemptId !== attempt.requestId || !['claimed', 'succeeded', 'failed'].includes(raw.status as string) ||
    !nullableText(raw.errorCode)) throw new Error('Outreach draft outcome is unconfirmed.');
  if (raw.draft === null) return { status: raw.status as string, errorCode: raw.errorCode as string | null, draft: null };
  const draft = object(raw.draft);
  if (Object.keys(draft).sort().join(',') !== 'body,createdAt,draftId,revision,rootDraftId,status,subject' ||
    !id(draft.draftId) || !id(draft.rootDraftId) || !safeVersion(draft.revision) ||
    !text(draft.subject) || !text(draft.body) || draft.status !== 'prepared_not_sent' || !text(draft.createdAt)) {
    throw new Error('Outreach draft outcome is unconfirmed.');
  }
  return { status: raw.status as string, errorCode: raw.errorCode as string | null, draft };
}

export async function submitEmployerOutreachDraft(
  attempt: EmployerOutreachAttempt,
  gateway: EmployerEngagementInvokeGateway,
) {
  const response = await gateway.invoke('rev-programme-employer-outreach-draft', { action: 'prepare', ...attempt });
  if (response.status !== 200) throw new Error(response.status === 503
    ? 'AI draft preparation is unavailable until its separate capability is configured.'
    : 'Outreach draft outcome is unconfirmed. Retry the exact same request; do not start another draft.');
  return publicDraft(response.data, attempt);
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
const retainedKey = (kind: string, workspaceId: string, userId: string, programmeId: string) =>
  `rev-programme-employer-${kind}:${workspaceId}:${userId}:${programmeId}`;
export const rememberEmployerAttempt = (
  storage: StorageLike,
  kind: 'search' | 'save' | 'draft',
  workspaceId: string,
  userId: string,
  programmeId: string,
  value: EmployerDiscoveryAttempt | EmployerEngagementSaveAttempt | EmployerOutreachAttempt,
) => storage.setItem(retainedKey(kind, workspaceId, userId, programmeId), JSON.stringify(value));
export const clearEmployerAttempt = (storage: StorageLike, kind: 'search' | 'save' | 'draft', workspaceId: string, userId: string, programmeId: string) =>
  storage.removeItem(retainedKey(kind, workspaceId, userId, programmeId));
export const restoreEmployerAttempt = <T>(
  storage: StorageLike,
  kind: 'search' | 'save' | 'draft',
  workspaceId: string,
  userId: string,
  programmeId: string,
): T | null => {
  const raw = storage.getItem(retainedKey(kind, workspaceId, userId, programmeId));
  if (raw === null) return null;
  const value = object(JSON.parse(raw));
  if (value.workspaceId !== workspaceId || value.programmeId !== programmeId || !id(value.requestId)) {
    throw new Error('A retained employer engagement request is invalid.');
  }
  return value as T;
};
