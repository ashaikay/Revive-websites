export type EmployerEngagementOperation =
  | 'discovery_employer'
  | 'outreach_settings'
  | 'engagement'
  | 'engagement_event'
  | 'draft_revision';

export type EmployerEngagementSaveInput = {
  target_operation: EmployerEngagementOperation;
  target_workspace_id: string;
  initiating_user_id: string;
  target_request_id: string;
  target_programme_id: string;
  target_record_id: string | null;
  expected_version: number;
  target_payload: Record<string, unknown>;
};

export interface EmployerEngagementSaveDependencies {
  allowedOrigin?: string;
  getUserId(authorization: string): Promise<string | null>;
  canAccessProgramme(authorization: string, workspaceId: string, programmeId: string): Promise<boolean>;
  save(input: EmployerEngagementSaveInput): Promise<unknown>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const operations: EmployerEngagementOperation[] = ['discovery_employer', 'outreach_settings', 'engagement', 'engagement_event', 'draft_revision'];
const stages = new Set(['to_review', 'ready_to_contact', 'contacted', 'conversation_underway', 'opportunity_identified', 'not_pursuing']);
const channels = new Set(['', 'email', 'phone', 'meeting', 'in_person', 'other']);
const validId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const text = (value: unknown, min: number, max: number, optional = false) =>
  typeof value === 'string' && ((optional && value === '') || (value.length >= min && value.length <= max && value.trim() === value));

function validPayload(operation: EmployerEngagementOperation, payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const raw = payload as Record<string, unknown>;
  if (operation === 'discovery_employer') {
    return exact(raw, ['searchId', 'sourceIdentity']) && validId(raw.searchId) && text(raw.sourceIdentity, 1, 120);
  }
  if (operation === 'outreach_settings') {
    return exact(raw, ['offerSummary']) && text(raw.offerSummary, 20, 2000);
  }
  if (operation === 'engagement') {
    return exact(raw, ['employerId', 'stage', 'responsibleAdviserUserId', 'nextAction', 'followUpDate']) &&
      validId(raw.employerId) && typeof raw.stage === 'string' && stages.has(raw.stage) &&
      (raw.responsibleAdviserUserId === '' || validId(raw.responsibleAdviserUserId)) &&
      text(raw.nextAction, 1, 500, true) && text(raw.followUpDate, 1, 10, true) &&
      (raw.followUpDate === '' || /^\d{4}-\d{2}-\d{2}$/.test(raw.followUpDate as string));
  }
  if (operation === 'engagement_event') {
    return exact(raw, ['employerId', 'contactId', 'eventType', 'channel', 'summary']) &&
      validId(raw.employerId) && (raw.contactId === '' || validId(raw.contactId)) &&
      ['manual_contact', 'note'].includes(raw.eventType as string) &&
      typeof raw.channel === 'string' && channels.has(raw.channel) && text(raw.summary, 1, 2000);
  }
  return exact(raw, ['subject', 'body']) && text(raw.subject, 1, 200) && text(raw.body, 20, 5000);
}

export async function handleEmployerEngagementSave(request: Request, dependencies: EmployerEngagementSaveDependencies): Promise<Response> {
  const configuredOrigin = dependencies.allowedOrigin ?? 'http://localhost:5180';
  const origin = request.headers.get('Origin');
  const headers = {
    'Access-Control-Allow-Origin': origin === configuredOrigin ? origin : configuredOrigin,
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
  if (origin !== configuredOrigin) return reply(403, { error: 'Origin unavailable.' });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...headers, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info' } });
  if (request.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
  const authorization = request.headers.get('Authorization') ?? '';
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply(401, { error: 'Authentication required.' });
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return reply(400, { error: 'Invalid employer engagement change.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    !exact(body, ['operation', 'workspaceId', 'programmeId', 'recordId', 'requestId', 'expectedVersion', 'payload']) ||
    !operations.includes(body.operation as EmployerEngagementOperation) || !validId(body.workspaceId) ||
    !validId(body.programmeId) || !validId(body.requestId) || !(body.recordId === null || validId(body.recordId)) ||
    !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 0 ||
    (body.recordId === null ? body.expectedVersion !== 0 : body.expectedVersion === 0) ||
    !validPayload(body.operation as EmployerEngagementOperation, body.payload)) {
    return reply(400, { error: 'Invalid employer engagement change.' });
  }
  const userId = await dependencies.getUserId(authorization);
  if (!validId(userId)) return reply(401, { error: 'Authentication required.' });
  if (!await dependencies.canAccessProgramme(authorization, body.workspaceId as string, body.programmeId as string)) {
    return reply(403, { error: 'Employer engagement change unavailable.' });
  }
  try {
    const result = await dependencies.save({
      target_operation: body.operation as EmployerEngagementOperation,
      target_workspace_id: body.workspaceId as string,
      initiating_user_id: userId,
      target_request_id: body.requestId as string,
      target_programme_id: body.programmeId as string,
      target_record_id: body.recordId as string | null,
      expected_version: body.expectedVersion as number,
      target_payload: body.payload as Record<string, unknown>,
    });
    return reply(200, result);
  } catch {
    return reply(409, { error: 'Employer engagement change unavailable or changed.' });
  }
}
