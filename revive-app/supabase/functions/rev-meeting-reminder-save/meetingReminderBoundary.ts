import { resolveAnnualLeaveOrigin } from '../_shared/annualLeaveOrigins.ts';

export interface MeetingReminderSaveInput {
  target_workspace_id: string;
  initiating_user_id: string;
  target_request_id: string;
  target_meeting_proposal_id: string;
  target_body: string;
  expected_version: number;
}

export interface MeetingReminderDependencies {
  allowedOrigin?: string;
  getUserId(authorization: string): Promise<string | null>;
  canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
  save(input: MeetingReminderSaveInput): Promise<unknown>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function storedInstant(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export async function handleMeetingReminderSave(
  request: Request,
  dependencies: MeetingReminderDependencies,
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
    if (raw.length > 4096) return reply(400, { error: 'Invalid meeting reminder draft.' });
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== 'body,expectedVersion,meetingProposalId,requestId,workspaceId'
      || typeof body.workspaceId !== 'string' || !uuid.test(body.workspaceId)
      || typeof body.requestId !== 'string' || !uuid.test(body.requestId)
      || typeof body.meetingProposalId !== 'string' || !uuid.test(body.meetingProposalId)
      || typeof body.body !== 'string' || body.body !== body.body.trim()
      || body.body.length < 1 || body.body.length > 2000
      || !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 0
      || (body.expectedVersion as number) >= Number.MAX_SAFE_INTEGER) {
      return reply(400, { error: 'Invalid meeting reminder draft.' });
    }
    const userId = await dependencies.getUserId(authorization);
    if (!userId || !uuid.test(userId)) return reply(401, { error: 'Authentication required.' });
    if (!await dependencies.canManage(authorization, body.workspaceId, userId)) {
      return reply(403, { error: 'Meeting reminder draft could not be saved.' });
    }
    const saved = await dependencies.save({
      target_workspace_id: body.workspaceId,
      initiating_user_id: userId,
      target_request_id: body.requestId,
      target_meeting_proposal_id: body.meetingProposalId,
      target_body: body.body,
      expected_version: body.expectedVersion as number,
    });
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid result');
    const row = saved as Record<string, unknown>;
    if (typeof row.id !== 'string' || !uuid.test(row.id)
      || row.workspace_id !== body.workspaceId
      || row.meeting_proposal_id !== body.meetingProposalId
      || row.body !== body.body
      || row.prepared_by_user_id !== userId
      || !Number.isSafeInteger(row.version) || (row.version as number) < 1
      || storedInstant(row.created_at) === null || storedInstant(row.updated_at) === null) {
      throw new Error('Invalid result');
    }
    return reply(200, {
      id: row.id,
      workspace_id: row.workspace_id,
      meeting_proposal_id: row.meeting_proposal_id,
      body: row.body,
      prepared_by_user_id: row.prepared_by_user_id,
      version: row.version,
      created_at: storedInstant(row.created_at),
      updated_at: storedInstant(row.updated_at),
    });
  } catch {
    return reply(403, { error: 'Meeting reminder draft could not be saved.' });
  }
}
