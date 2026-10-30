import { supabaseClient } from '@/data/supabaseClient';
import {
  mapMeetingReminderDelivery,
  validateMeetingReminderDeliveryRequest,
  type MeetingReminderDeliveryRequest,
  type MeetingReminderDeliveryResponse,
} from '@/domain/meetingReminderDelivery';

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function key(workspaceId: string, userId: string, meetingProposalId: string): string {
  if (!uuid.test(workspaceId) || !uuid.test(userId) || !uuid.test(meetingProposalId)) {
    throw new Error('Scoped reminder delivery identity required.');
  }
  return `rev-meeting-reminder-delivery:${workspaceId}:${userId}:${meetingProposalId}`;
}

export function rememberMeetingReminderSend(
  storage: StorageLike,
  userId: string,
  request: MeetingReminderDeliveryRequest,
): void {
  const valid = validateMeetingReminderDeliveryRequest(request);
  if (valid.operation !== 'send') throw new Error('A reminder send request is required.');
  storage.setItem(key(valid.workspaceId, userId, valid.meetingProposalId), JSON.stringify(valid));
}

export function restoreMeetingReminderSend(
  storage: StorageLike,
  workspaceId: string,
  userId: string,
  meetingProposalId: string,
): MeetingReminderDeliveryRequest | null {
  const raw = storage.getItem(key(workspaceId, userId, meetingProposalId));
  if (raw === null) return null;
  const request = validateMeetingReminderDeliveryRequest(JSON.parse(raw));
  if (request.operation !== 'send'
    || request.workspaceId !== workspaceId
    || request.meetingProposalId !== meetingProposalId) {
    throw new Error('Retained reminder send request is invalid.');
  }
  return request;
}

export function clearMeetingReminderSend(
  storage: StorageLike,
  workspaceId: string,
  userId: string,
  meetingProposalId: string,
): void {
  storage.removeItem(key(workspaceId, userId, meetingProposalId));
}

export async function submitMeetingReminderDelivery(
  value: MeetingReminderDeliveryRequest,
  invoke = async (name: string, body: Record<string, unknown>) => {
    if (!supabaseClient) throw new Error('Meeting reminder delivery is unavailable.');
    const { data, error } = await supabaseClient.functions.invoke(name, { body });
    if (error) {
      const context = (error as { context?: unknown }).context;
      if (context instanceof Response) {
        return { status: context.status, data: await context.clone().json().catch(() => null) };
      }
      throw new Error('Meeting reminder delivery outcome is unconfirmed.');
    }
    return { status: 200, data };
  },
): Promise<MeetingReminderDeliveryResponse> {
  const request = validateMeetingReminderDeliveryRequest(value);
  const response = await invoke('rev-meeting-reminder-deliver', { ...request });
  if (response.status !== 200 || !response.data || typeof response.data !== 'object' || Array.isArray(response.data)) {
    throw new Error('Meeting reminder delivery outcome is unconfirmed.');
  }
  const row = response.data as Record<string, unknown>;
  const allowedStatuses = [
    'approved_not_sent',
    'provider_disabled',
    'provider_attempt_claimed',
    'accepted_by_provider',
    'rejected_by_provider',
    'provider_outcome_unknown',
  ];
  if (!allowedStatuses.includes(String(row.status))
    || typeof row.displayStatus !== 'string'
    || ![true, false, 'unknown'].includes(row.providerInvoked as boolean | string)
    || typeof row.acceptedByProvider !== 'boolean'
    || row.deliveryConfirmed !== false
    || typeof row.automaticRetryAllowed !== 'boolean') {
    throw new Error('Meeting reminder delivery outcome is unconfirmed.');
  }
  const delivery = row.delivery === undefined
    ? undefined
    : mapMeetingReminderDelivery(row.delivery, request.workspaceId);
  return {
    status: row.status as MeetingReminderDeliveryResponse['status'],
    displayStatus: row.displayStatus,
    delivery,
    providerInvoked: row.providerInvoked as boolean | 'unknown',
    acceptedByProvider: row.acceptedByProvider,
    deliveryConfirmed: false,
    automaticRetryAllowed: row.automaticRetryAllowed,
  };
}
