export type ProgrammeHubOperation =
  | 'programme'
  | 'adviser'
  | 'employer'
  | 'contact'
  | 'vacancy'
  | 'participant'
  | 'participant_adviser'
  | 'participant_note'
  | 'participant_contact';

export interface ProgrammeHubSaveInput {
  target_operation: ProgrammeHubOperation;
  target_workspace_id: string;
  initiating_user_id: string;
  target_request_id: string;
  target_programme_id: string | null;
  target_record_id: string | null;
  expected_version: number;
  target_payload: Record<string, unknown>;
}

export interface ProgrammeHubDependencies {
  allowedOrigin?: string;
  getUserId(authorization: string): Promise<string | null>;
  canWriteWorkspace(authorization: string, workspaceId: string, userId: string): Promise<boolean>;
  save(input: ProgrammeHubSaveInput): Promise<unknown>;
}

export type ProgrammeHubSaveErrorCode =
  | 'workspace_access_denied'
  | 'programme_manager_required'
  | 'participant_contact_changed'
  | 'participant_unavailable'
  | 'active_adviser_required'
  | 'caseload_assignment_exists'
  | 'caseload_assignment_changed'
  | 'request_changed'
  | 'programme_record_invalid'
  | 'programme_record_rejected'
  | 'outcome_unknown';

export class ProgrammeHubSaveFailure extends Error {
  readonly status: number;
  readonly errorCode: ProgrammeHubSaveErrorCode;

  constructor(status: number, errorCode: ProgrammeHubSaveErrorCode) {
    super(errorCode);
    this.status = status;
    this.errorCode = errorCode;
  }
}

export function classifyProgrammeHubDatabaseError(
  operation: ProgrammeHubOperation,
  error: { code?: unknown; message?: unknown },
): ProgrammeHubSaveFailure {
  const code = typeof error.code === 'string' ? error.code : '';
  const message = typeof error.message === 'string' ? error.message : '';
  if (code === '42501') return new ProgrammeHubSaveFailure(403, 'workspace_access_denied');
  if (message.includes('Programme manager required')) return new ProgrammeHubSaveFailure(403, 'programme_manager_required');
  if (message.includes('Participant contact unavailable or changed')) return new ProgrammeHubSaveFailure(409, 'participant_contact_changed');
  if (message.includes('Participant unavailable')) return new ProgrammeHubSaveFailure(409, 'participant_unavailable');
  if (message.includes('Active adviser required')) return new ProgrammeHubSaveFailure(409, 'active_adviser_required');
  if (message.includes('Caseload assignment unavailable or changed')) return new ProgrammeHubSaveFailure(409, 'caseload_assignment_changed');
  if (message.includes('Programme request unavailable')) return new ProgrammeHubSaveFailure(409, 'request_changed');
  if (code === '23505' && operation === 'participant_adviser') return new ProgrammeHubSaveFailure(409, 'caseload_assignment_exists');
  if (['22P02', '22007', '22023', '23514'].includes(code)) return new ProgrammeHubSaveFailure(400, 'programme_record_invalid');
  if (code.startsWith('23') || code === 'P0001') return new ProgrammeHubSaveFailure(409, 'programme_record_rejected');
  return new ProgrammeHubSaveFailure(503, 'outcome_unknown');
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const email = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const operations: ProgrammeHubOperation[] = ['programme', 'adviser', 'employer', 'contact', 'vacancy', 'participant', 'participant_adviser', 'participant_note', 'participant_contact'];
const validId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const text = (value: unknown, max: number, optional = false): value is string =>
  typeof value === 'string' && ((optional && value === '') || (value.length >= 1 && value.length <= max && value.trim() === value));
const tags = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length <= 50 &&
  value.every((item) => text(item, 120)) && new Set(value).size === value.length;
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');

function validPayload(operation: ProgrammeHubOperation, payload: unknown): payload is Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false;
  const value = payload as Record<string, unknown>;
  switch (operation) {
    case 'programme':
      return exact(value, ['name', 'timezone', 'brandingName', 'senderDisplayName', 'senderReplyTo', 'active']) &&
        text(value.name, 160) && text(value.timezone, 100) && text(value.brandingName, 160, true) &&
        text(value.senderDisplayName, 160, true) && text(value.senderReplyTo, 320, true) &&
        (value.senderReplyTo === '' || email.test(value.senderReplyTo as string)) && typeof value.active === 'boolean';
    case 'adviser':
      return exact(value, ['userId', 'active']) && validId(value.userId) && typeof value.active === 'boolean';
    case 'employer':
      return exact(value, ['employerKey', 'displayName', 'sectorKey', 'primaryGeographyKey', 'active']) &&
        text(value.employerKey, 120) && text(value.displayName, 200) && text(value.sectorKey, 120, true) &&
        text(value.primaryGeographyKey, 120, true) && typeof value.active === 'boolean';
    case 'contact':
      return exact(value, ['employerId', 'contactKey', 'preferredName', 'roleTitle', 'businessEmail', 'businessPhone', 'suppressed', 'suppressionReasonKey', 'active']) &&
        validId(value.employerId) && text(value.contactKey, 120) && text(value.preferredName, 160) &&
        text(value.roleTitle, 160, true) && text(value.businessEmail, 320, true) &&
        (value.businessEmail === '' || email.test(value.businessEmail as string)) &&
        text(value.businessPhone, 40, true) && typeof value.suppressed === 'boolean' &&
        text(value.suppressionReasonKey, 120, true) &&
        (!value.suppressed || value.suppressionReasonKey !== '') && typeof value.active === 'boolean';
    case 'vacancy':
      return exact(value, ['employerId', 'employerContactId', 'vacancyKey', 'title', 'workGeographyKey', 'requiredSkillKeys', 'desiredSkillKeys', 'active']) &&
        validId(value.employerId) && (value.employerContactId === '' || validId(value.employerContactId)) &&
        text(value.vacancyKey, 120) && text(value.title, 200) && text(value.workGeographyKey, 120, true) &&
        tags(value.requiredSkillKeys) && tags(value.desiredSkillKeys) && typeof value.active === 'boolean';
    case 'participant':
      return exact(value, ['participantKey', 'preferredName', 'caseReference', 'desiredRoleKeys', 'skillKeys', 'vacancySearchGeographyKeys', 'residencyEvidenceReference', 'active']) &&
        text(value.participantKey, 120) && text(value.preferredName, 160) && text(value.caseReference, 120) &&
        tags(value.desiredRoleKeys) && tags(value.skillKeys) && tags(value.vacancySearchGeographyKeys) &&
        text(value.residencyEvidenceReference, 200, true) && typeof value.active === 'boolean';
    case 'participant_adviser':
      return exact(value, ['participantId', 'adviserUserId', 'active']) &&
        validId(value.participantId) && validId(value.adviserUserId) && typeof value.active === 'boolean';
    case 'participant_contact':
      return exact(value, ['participantId','phone','email','addressLine1','addressLine2','town','postcode']) &&
        validId(value.participantId) &&
        [['phone',40],['email',320],['addressLine1',200],['addressLine2',200],['town',120],['postcode',8]].every(([key,max]) =>
          text(value[key as string], max as number, true) && !/[\u0000-\u001f\u007f]/.test(value[key as string] as string)) &&
        (value.email === '' || email.test(value.email as string)) &&
        (value.postcode === '' || /^(?:[A-Z]{1,2}[0-9][A-Z0-9]?|GIR) [0-9][A-Z]{2}$/.test(value.postcode as string));
    case 'participant_note':
      return exact(value, ['participantId', 'body']) &&
        validId(value.participantId) && text(value.body, 2000);
  }
}

function allowedOrigin(request: Request, configured?: string): string | null {
  const origin = request.headers.get('Origin');
  const allowed = configured ?? 'http://localhost:5180';
  return origin === allowed ? origin : null;
}

export async function handleProgrammeHubSave(request: Request, dependencies: ProgrammeHubDependencies): Promise<Response> {
  const origin = allowedOrigin(request, dependencies.allowedOrigin);
  if (!origin) return new Response(null, { status: 403 });
  const headers = {
    'Access-Control-Allow-Origin': origin,
    Vary: 'Origin',
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json',
  };
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers });
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
    if (raw.length > 32000) return reply(400, { error: 'Invalid programme record.' });
    const body = JSON.parse(raw) as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
      !exact(body, ['operation', 'workspaceId', 'programmeId', 'recordId', 'requestId', 'expectedVersion', 'payload']) ||
      !operations.includes(body.operation as ProgrammeHubOperation) || !validId(body.workspaceId) ||
      !validId(body.requestId) || (body.programmeId !== null && !validId(body.programmeId)) ||
      (body.recordId !== null && !validId(body.recordId)) || !Number.isSafeInteger(body.expectedVersion) ||
      (body.expectedVersion as number) < 0 || (body.expectedVersion as number) >= Number.MAX_SAFE_INTEGER ||
      (body.recordId === null ? body.expectedVersion !== 0 : body.expectedVersion === 0) ||
      (body.operation === 'participant_note' && (body.recordId !== null || body.expectedVersion !== 0)) ||
      (body.operation === 'programme' ? body.programmeId !== null : !validId(body.programmeId)) ||
      !validPayload(body.operation as ProgrammeHubOperation, body.payload)) {
      return reply(400, { error: 'Invalid programme record.' });
    }
    const userId = await dependencies.getUserId(authorization);
    if (!validId(userId)) return reply(401, { error: 'Authentication required.' });
    if (!await dependencies.canWriteWorkspace(authorization, body.workspaceId as string, userId)) {
      return reply(403, { error: 'Programme record could not be saved.', errorCode: 'workspace_access_denied' });
    }
    const result = await dependencies.save({
      target_operation: body.operation as ProgrammeHubOperation,
      target_workspace_id: body.workspaceId as string,
      initiating_user_id: userId,
      target_request_id: body.requestId as string,
      target_programme_id: body.programmeId as string | null,
      target_record_id: body.recordId as string | null,
      expected_version: body.expectedVersion as number,
      target_payload: body.payload as Record<string, unknown>,
    });
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Invalid result');
    const row = result as Record<string, unknown>;
    if (!exact(row, ['operation', 'record_id', 'workspace_id', 'programme_id', 'version']) ||
      row.operation !== body.operation || !validId(row.record_id) || row.workspace_id !== body.workspaceId ||
      !validId(row.programme_id) || !Number.isSafeInteger(row.version) ||
      row.version !== (body.expectedVersion as number) + 1) throw new Error('Invalid result');
    return reply(200, {
      operation: row.operation,
      recordId: row.record_id,
      workspaceId: row.workspace_id,
      programmeId: row.programme_id,
      version: row.version,
    });
  } catch (error) {
    if (error instanceof ProgrammeHubSaveFailure) {
      return reply(error.status, { error: 'Programme record could not be saved.', errorCode: error.errorCode });
    }
    return reply(503, { error: 'Programme save outcome is unknown.', errorCode: 'outcome_unknown' });
  }
}
