export const MEETING_OUTCOME_TYPES = ['held', 'no_show', 'cancelled'] as const;

export type MeetingOutcomeType = typeof MEETING_OUTCOME_TYPES[number];

export interface MeetingOutcome {
  id: string;
  workspaceId: string;
  meetingProposalId: string;
  outcomeType: MeetingOutcomeType;
  summary: string;
  occurredAt: string;
  recordedByUserId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingOutcomeAttempt {
  workspaceId: string;
  requestId: string;
  meetingProposalId: string;
  outcomeType: MeetingOutcomeType;
  summary: string;
  occurredAt: string;
  expectedVersion: number;
}

export const MEETING_OUTCOME_LABELS: Record<MeetingOutcomeType, string> = {
  held: 'Held',
  no_show: 'No-show',
  cancelled: 'Cancelled',
};

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUtcInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

export function isMeetingOutcomeType(value: unknown): value is MeetingOutcomeType {
  return typeof value === 'string' && MEETING_OUTCOME_TYPES.includes(value as MeetingOutcomeType);
}

export function validateMeetingOutcomeAttempt(value: unknown, now = Date.now()): MeetingOutcomeAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid meeting outcome.');
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'expectedVersion,meetingProposalId,occurredAt,outcomeType,requestId,summary,workspaceId'
    || typeof input.workspaceId !== 'string' || !uuid.test(input.workspaceId)
    || typeof input.requestId !== 'string' || !uuid.test(input.requestId)
    || typeof input.meetingProposalId !== 'string' || !uuid.test(input.meetingProposalId)
    || !isMeetingOutcomeType(input.outcomeType)
    || typeof input.summary !== 'string' || input.summary !== input.summary.trim()
    || input.summary.length < 1 || input.summary.length > 1000
    || !isUtcInstant(input.occurredAt) || Date.parse(input.occurredAt) > now
    || !Number.isSafeInteger(input.expectedVersion)
    || (input.expectedVersion as number) < 0
    || (input.expectedVersion as number) >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Invalid meeting outcome.');
  }
  return input as unknown as MeetingOutcomeAttempt;
}

export function mapMeetingOutcome(value: unknown, workspaceId?: string): MeetingOutcome {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid meeting outcome.');
  const row = value as Record<string, unknown>;
  const outcome = {
    id: row.id,
    workspaceId: row.workspace_id,
    meetingProposalId: row.meeting_proposal_id,
    outcomeType: row.outcome_type,
    summary: row.summary,
    occurredAt: typeof row.occurred_at === 'string' ? new Date(row.occurred_at).toISOString() : row.occurred_at,
    recordedByUserId: row.recorded_by_user_id,
    version: row.version,
    createdAt: typeof row.created_at === 'string' ? new Date(row.created_at).toISOString() : row.created_at,
    updatedAt: typeof row.updated_at === 'string' ? new Date(row.updated_at).toISOString() : row.updated_at,
  };
  if (typeof outcome.id !== 'string' || !uuid.test(outcome.id)
    || typeof outcome.workspaceId !== 'string' || !uuid.test(outcome.workspaceId)
    || (workspaceId !== undefined && outcome.workspaceId !== workspaceId)
    || typeof outcome.meetingProposalId !== 'string' || !uuid.test(outcome.meetingProposalId)
    || !isMeetingOutcomeType(outcome.outcomeType)
    || typeof outcome.summary !== 'string' || outcome.summary !== outcome.summary.trim()
    || outcome.summary.length < 1 || outcome.summary.length > 1000
    || !isUtcInstant(outcome.occurredAt)
    || typeof outcome.recordedByUserId !== 'string' || !uuid.test(outcome.recordedByUserId)
    || !Number.isSafeInteger(outcome.version) || (outcome.version as number) < 1
    || !isUtcInstant(outcome.createdAt) || !isUtcInstant(outcome.updatedAt)) {
    throw new Error('Invalid meeting outcome.');
  }
  return outcome as MeetingOutcome;
}
