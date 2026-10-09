export interface MeetingReminderDraft {
  id: string;
  workspaceId: string;
  meetingProposalId: string;
  body: string;
  preparedByUserId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingReminderDraftAttempt {
  workspaceId: string;
  requestId: string;
  meetingProposalId: string;
  body: string;
  expectedVersion: number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUtcInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

export function validateMeetingReminderDraftAttempt(value: unknown): MeetingReminderDraftAttempt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid meeting reminder draft.');
  }
  const input = value as Record<string, unknown>;
  if (Object.keys(input).sort().join(',') !== 'body,expectedVersion,meetingProposalId,requestId,workspaceId'
    || typeof input.workspaceId !== 'string' || !uuid.test(input.workspaceId)
    || typeof input.requestId !== 'string' || !uuid.test(input.requestId)
    || typeof input.meetingProposalId !== 'string' || !uuid.test(input.meetingProposalId)
    || typeof input.body !== 'string' || input.body !== input.body.trim()
    || input.body.length < 1 || input.body.length > 2000
    || !Number.isSafeInteger(input.expectedVersion)
    || (input.expectedVersion as number) < 0
    || (input.expectedVersion as number) >= Number.MAX_SAFE_INTEGER) {
    throw new Error('Invalid meeting reminder draft.');
  }
  return input as unknown as MeetingReminderDraftAttempt;
}

export function mapMeetingReminderDraft(value: unknown, workspaceId?: string): MeetingReminderDraft {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid meeting reminder draft.');
  }
  const row = value as Record<string, unknown>;
  const draft = {
    id: row.id,
    workspaceId: row.workspace_id,
    meetingProposalId: row.meeting_proposal_id,
    body: row.body,
    preparedByUserId: row.prepared_by_user_id,
    version: row.version,
    createdAt: typeof row.created_at === 'string' ? new Date(row.created_at).toISOString() : row.created_at,
    updatedAt: typeof row.updated_at === 'string' ? new Date(row.updated_at).toISOString() : row.updated_at,
  };
  if (typeof draft.id !== 'string' || !uuid.test(draft.id)
    || typeof draft.workspaceId !== 'string' || !uuid.test(draft.workspaceId)
    || (workspaceId !== undefined && draft.workspaceId !== workspaceId)
    || typeof draft.meetingProposalId !== 'string' || !uuid.test(draft.meetingProposalId)
    || typeof draft.body !== 'string' || draft.body !== draft.body.trim()
    || draft.body.length < 1 || draft.body.length > 2000
    || typeof draft.preparedByUserId !== 'string' || !uuid.test(draft.preparedByUserId)
    || !Number.isSafeInteger(draft.version) || (draft.version as number) < 1
    || !isUtcInstant(draft.createdAt) || !isUtcInstant(draft.updatedAt)) {
    throw new Error('Invalid meeting reminder draft.');
  }
  return draft as MeetingReminderDraft;
}
