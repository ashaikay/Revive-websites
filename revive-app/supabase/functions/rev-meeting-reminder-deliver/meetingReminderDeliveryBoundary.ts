import { resolveAnnualLeaveOrigin } from '../_shared/annualLeaveOrigins.ts';
import type { MeetingReminderEmailResult } from './meetingReminderEmailOrchestrator.ts';

export interface ReminderDeliveryRequest {
  operation: 'approve' | 'send';
  workspaceId: string;
  requestId: string;
  meetingProposalId: string;
  sendConsent?: true;
}

export interface ReminderDeliveryDependencies {
  allowedOrigin?: string;
  providerExecutionEnabled: boolean;
  getUserId(authorization: string): Promise<string | null>;
  canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
  approve(input: {
    target_workspace_id: string;
    initiating_user_id: string;
    target_request_id: string;
    target_meeting_proposal_id: string;
  }): Promise<unknown>;
  deliver(input: ReminderDeliveryRequest & { userId: string }): Promise<MeetingReminderEmailResult>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const statuses = new Set([
  'approved_not_sent',
  'provider_attempt_claimed',
  'accepted_by_provider',
  'rejected_by_provider',
  'provider_outcome_unknown',
]);

function validRequest(value: unknown): value is ReminderDeliveryRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const expectedKeys = body.operation === 'approve'
    ? 'meetingProposalId,operation,requestId,workspaceId'
    : 'meetingProposalId,operation,requestId,sendConsent,workspaceId';
  return ['approve', 'send'].includes(String(body.operation))
    && Object.keys(body).sort().join(',') === expectedKeys
    && typeof body.workspaceId === 'string' && uuid.test(body.workspaceId)
    && typeof body.requestId === 'string' && uuid.test(body.requestId)
    && typeof body.meetingProposalId === 'string' && uuid.test(body.meetingProposalId)
    && (body.operation !== 'send' || body.sendConsent === true);
}

function validDelivery(value: unknown, request: ReminderDeliveryRequest): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && uuid.test(row.id)
    && row.workspace_id === request.workspaceId
    && row.meeting_proposal_id === request.meetingProposalId
    && typeof row.reminder_draft_id === 'string' && uuid.test(row.reminder_draft_id)
    && Number.isSafeInteger(row.approved_draft_version)
    && (row.approved_draft_version as number) > 0
    && typeof row.status === 'string' && statuses.has(row.status)
    && typeof row.approved_by_user_id === 'string' && uuid.test(row.approved_by_user_id)
    && Number.isSafeInteger(row.version) && (row.version as number) > 0;
}

export async function handleMeetingReminderDelivery(
  request: Request,
  dependencies: ReminderDeliveryDependencies,
): Promise<Response> {
  const origin = resolveAnnualLeaveOrigin(request.headers.get('Origin'), dependencies.allowedOrigin);
  if (!origin) return new Response(null, { status: 403 });
  const headers = {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  };
  const reply = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers });
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...headers,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
      },
    });
  }
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, { error: 'Authentication required.' });
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return reply(415, { error: 'JSON required.' });
  }
  try {
    const raw = await request.text();
    if (raw.length > 2048) return reply(400, { error: 'Invalid meeting reminder delivery request.' });
    const body = JSON.parse(raw);
    if (!validRequest(body)) return reply(400, { error: 'Invalid meeting reminder delivery request.' });
    const userId = await dependencies.getUserId(authorization);
    if (!userId || !uuid.test(userId)) return reply(401, { error: 'Authentication required.' });
    if (!await dependencies.canManage(authorization, body.workspaceId, userId)) {
      return reply(403, { error: 'Meeting reminder delivery is unavailable.' });
    }
    if (body.operation === 'approve') {
      const delivery = await dependencies.approve({
        target_workspace_id: body.workspaceId,
        initiating_user_id: userId,
        target_request_id: body.requestId,
        target_meeting_proposal_id: body.meetingProposalId,
      });
      if (!validDelivery(delivery, body)) throw new Error('Invalid approval');
      return reply(200, {
        status: 'approved_not_sent',
        displayStatus: 'Approved — not sent',
        delivery,
        providerInvoked: false,
        acceptedByProvider: false,
        deliveryConfirmed: false,
        automaticRetryAllowed: true,
      });
    }
    if (!dependencies.providerExecutionEnabled) {
      return reply(200, {
        status: 'provider_disabled',
        displayStatus: 'Email sending disabled — nothing sent',
        providerInvoked: false,
        acceptedByProvider: false,
        deliveryConfirmed: false,
        automaticRetryAllowed: true,
      });
    }
    const result = await dependencies.deliver({ ...body, userId });
    const displayStatus = result.status === 'accepted_by_provider'
      ? 'Accepted by provider — delivery not confirmed'
      : result.status === 'rejected_by_provider'
        ? 'Rejected by provider — not sent'
        : result.status === 'provider_outcome_unknown' || result.status === 'provider_attempt_claimed'
          ? 'Send outcome unresolved — do not retry'
          : 'Approved — not sent';
    return reply(200, { ...result, displayStatus });
  } catch {
    return reply(409, {
      error: 'Meeting reminder delivery could not be confirmed.',
      providerInvoked: 'unknown',
      acceptedByProvider: false,
      deliveryConfirmed: false,
      automaticRetryAllowed: false,
    });
  }
}
