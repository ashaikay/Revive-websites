export type MeetingReminderDeliveryStatus =
  | 'approved_not_sent'
  | 'provider_attempt_claimed'
  | 'accepted_by_provider'
  | 'rejected_by_provider'
  | 'provider_outcome_unknown';

export interface MeetingReminderDelivery {
  id: string;
  workspaceId: string;
  meetingProposalId: string;
  reminderDraftId: string;
  approvedDraftVersion: number;
  status: MeetingReminderDeliveryStatus;
  approvedByUserId: string;
  approvedAt: string;
  sendAuthorizedByUserId?: string;
  sendAuthorizedAt?: string;
  providerKey?: 'microsoft_graph';
  resultSummary?: string;
  failureCode?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingReminderDeliveryRequest {
  operation: 'approve' | 'send';
  workspaceId: string;
  requestId: string;
  meetingProposalId: string;
  sendConsent?: true;
}

export interface MeetingReminderDeliveryResponse {
  status: MeetingReminderDeliveryStatus | 'provider_disabled';
  displayStatus: string;
  delivery?: MeetingReminderDelivery;
  providerInvoked: boolean | 'unknown';
  acceptedByProvider: boolean;
  deliveryConfirmed: false;
  automaticRetryAllowed: boolean;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses: MeetingReminderDeliveryStatus[] = [
  'approved_not_sent',
  'provider_attempt_claimed',
  'accepted_by_provider',
  'rejected_by_provider',
  'provider_outcome_unknown',
];

function utc(value: unknown): value is string {
  return typeof value === 'string'
    && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString() === value;
}

export function mapMeetingReminderDelivery(value: unknown, workspaceId?: string): MeetingReminderDelivery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid meeting reminder delivery.');
  }
  const row = value as Record<string, unknown>;
  const delivery: MeetingReminderDelivery = {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    meetingProposalId: String(row.meeting_proposal_id),
    reminderDraftId: String(row.reminder_draft_id),
    approvedDraftVersion: Number(row.approved_draft_version),
    status: row.status as MeetingReminderDeliveryStatus,
    approvedByUserId: String(row.approved_by_user_id),
    approvedAt: String(row.approved_at),
    sendAuthorizedByUserId: row.send_authorized_by_user_id ? String(row.send_authorized_by_user_id) : undefined,
    sendAuthorizedAt: row.send_authorized_at ? String(row.send_authorized_at) : undefined,
    providerKey: row.provider_key ? row.provider_key as 'microsoft_graph' : undefined,
    resultSummary: row.result_summary ? String(row.result_summary) : undefined,
    failureCode: row.failure_code ? String(row.failure_code) : undefined,
    version: Number(row.version),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
  if (!uuid.test(delivery.id)
    || !uuid.test(delivery.workspaceId)
    || (workspaceId !== undefined && delivery.workspaceId !== workspaceId)
    || !uuid.test(delivery.meetingProposalId)
    || !uuid.test(delivery.reminderDraftId)
    || !uuid.test(delivery.approvedByUserId)
    || !Number.isSafeInteger(delivery.approvedDraftVersion) || delivery.approvedDraftVersion < 1
    || !statuses.includes(delivery.status)
    || !Number.isSafeInteger(delivery.version) || delivery.version < 1
    || !utc(delivery.approvedAt) || !utc(delivery.createdAt) || !utc(delivery.updatedAt)
    || (delivery.sendAuthorizedByUserId !== undefined && !uuid.test(delivery.sendAuthorizedByUserId))
    || (delivery.sendAuthorizedAt !== undefined && !utc(delivery.sendAuthorizedAt))
    || (delivery.providerKey !== undefined && delivery.providerKey !== 'microsoft_graph')) {
    throw new Error('Invalid meeting reminder delivery.');
  }
  return delivery;
}

export function validateMeetingReminderDeliveryRequest(value: unknown): MeetingReminderDeliveryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid meeting reminder delivery request.');
  }
  const input = value as Record<string, unknown>;
  const approveKeys = 'meetingProposalId,operation,requestId,workspaceId';
  const sendKeys = 'meetingProposalId,operation,requestId,sendConsent,workspaceId';
  const keys = Object.keys(input).sort().join(',');
  if (!['approve', 'send'].includes(String(input.operation))
    || (input.operation === 'approve' ? keys !== approveKeys : keys !== sendKeys)
    || !uuid.test(String(input.workspaceId))
    || !uuid.test(String(input.requestId))
    || !uuid.test(String(input.meetingProposalId))
    || (input.operation === 'send' && input.sendConsent !== true)) {
    throw new Error('Invalid meeting reminder delivery request.');
  }
  return input as unknown as MeetingReminderDeliveryRequest;
}
