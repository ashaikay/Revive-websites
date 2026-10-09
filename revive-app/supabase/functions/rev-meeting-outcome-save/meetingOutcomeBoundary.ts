import { resolveAnnualLeaveOrigin } from '../_shared/annualLeaveOrigins.ts';

export type MeetingOutcomeType = 'held' | 'no_show' | 'cancelled';
export interface MeetingOutcomeSaveInput {
  target_workspace_id: string;
  initiating_user_id: string;
  target_request_id: string;
  target_meeting_proposal_id: string;
  target_outcome_type: MeetingOutcomeType;
  target_summary: string;
  target_occurred_at: string;
  expected_version: number;
}
export interface MeetingOutcomeDependencies {
  allowedOrigin?: string;
  getUserId(authorization: string): Promise<string | null>;
  canManage(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
  save(input: MeetingOutcomeSaveInput): Promise<unknown>;
  now(): number;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const allowedTypes = new Set<MeetingOutcomeType>(['held', 'no_show', 'cancelled']);

function validUtc(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function storedInstant(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export async function handleMeetingOutcomeSave(
  request: Request,
  dependencies: MeetingOutcomeDependencies,
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
    if (raw.length > 8192) return reply(400, { error: 'Invalid meeting outcome.' });
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).sort().join(',') !== 'expectedVersion,meetingProposalId,occurredAt,outcomeType,requestId,summary,workspaceId'
      || typeof body.workspaceId !== 'string' || !uuid.test(body.workspaceId)
      || typeof body.requestId !== 'string' || !uuid.test(body.requestId)
      || typeof body.meetingProposalId !== 'string' || !uuid.test(body.meetingProposalId)
      || typeof body.outcomeType !== 'string' || !allowedTypes.has(body.outcomeType as MeetingOutcomeType)
      || typeof body.summary !== 'string' || body.summary !== body.summary.trim()
      || body.summary.length < 1 || body.summary.length > 1000
      || !validUtc(body.occurredAt) || Date.parse(body.occurredAt) > dependencies.now()
      || !Number.isSafeInteger(body.expectedVersion) || (body.expectedVersion as number) < 0
      || (body.expectedVersion as number) >= Number.MAX_SAFE_INTEGER) {
      return reply(400, { error: 'Invalid meeting outcome.' });
    }
    const userId = await dependencies.getUserId(authorization);
    if (!userId || !uuid.test(userId)) return reply(401, { error: 'Authentication required.' });
    if (!await dependencies.canManage(authorization, body.workspaceId, userId)) {
      return reply(403, { error: 'Meeting outcome could not be saved.' });
    }
    const saved = await dependencies.save({
      target_workspace_id: body.workspaceId,
      initiating_user_id: userId,
      target_request_id: body.requestId,
      target_meeting_proposal_id: body.meetingProposalId,
      target_outcome_type: body.outcomeType as MeetingOutcomeType,
      target_summary: body.summary,
      target_occurred_at: body.occurredAt,
      expected_version: body.expectedVersion as number,
    });
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid result');
    const row = saved as Record<string, unknown>;
    if (typeof row.id !== 'string' || !uuid.test(row.id)
      || row.workspace_id !== body.workspaceId
      || row.meeting_proposal_id !== body.meetingProposalId
      || row.outcome_type !== body.outcomeType
      || row.summary !== body.summary
      || storedInstant(row.occurred_at) !== body.occurredAt
      || row.recorded_by_user_id !== userId
      || !Number.isSafeInteger(row.version) || (row.version as number) < 1
      || storedInstant(row.created_at) === null || storedInstant(row.updated_at) === null) {
      throw new Error('Invalid result');
    }
    return reply(200, {
      id: row.id,
      workspace_id: row.workspace_id,
      meeting_proposal_id: row.meeting_proposal_id,
      outcome_type: row.outcome_type,
      summary: row.summary,
      occurred_at: storedInstant(row.occurred_at),
      recorded_by_user_id: row.recorded_by_user_id,
      version: row.version,
      created_at: storedInstant(row.created_at),
      updated_at: storedInstant(row.updated_at),
    });
  } catch {
    return reply(403, { error: 'Meeting outcome could not be saved.' });
  }
}
