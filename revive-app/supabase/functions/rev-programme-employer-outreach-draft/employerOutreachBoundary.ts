import {
  EmployerOutreachProviderError,
  type EmployerOutreachSource,
} from './openAiEmployerOutreachProvider.ts';

type Draft = {
  draftId: string;
  rootDraftId: string;
  revision: number;
  subject: string;
  body: string;
  status: 'prepared_not_sent';
  createdAt: string;
};
type Claim = {
  attemptId: string;
  status: 'claimed' | 'succeeded' | 'failed';
  shouldAttempt: boolean;
  errorCode: string | null;
  draft: Draft | null;
  source?: EmployerOutreachSource;
};
type PrepareInput = {
  workspaceId: string;
  programmeId: string;
  employerId: string;
  contactId: string | null;
  requestId: string;
  employerVersion: number;
  settingsVersion: number;
  contactVersion: number | null;
};
export interface EmployerOutreachDependencies {
  allowedOrigin?: string;
  providerConfigured: boolean;
  model: string;
  dailyLimit: number;
  getUserId(authorization: string): Promise<string | null>;
  canAccessProgramme(authorization: string, workspaceId: string, programmeId: string): Promise<boolean>;
  claim(input: PrepareInput & { userId: string; dailyLimit: number }): Promise<Claim>;
  prepare(source: EmployerOutreachSource): Promise<{ subject: string; body: string; model: string; providerResponseId: string; inputTokens: number; outputTokens: number }>;
  complete(input: PrepareInput & { userId: string; subject: string; body: string; model: string; providerResponseId: string; inputTokens: number; outputTokens: number }): Promise<Claim>;
  fail(input: PrepareInput & { userId: string; errorCode: string }): Promise<Claim>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const validId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const publicClaim = (claim: Claim) => ({ attemptId: claim.attemptId, status: claim.status, errorCode: claim.errorCode, draft: claim.draft });

export async function handleEmployerOutreachDraft(request: Request, dependencies: EmployerOutreachDependencies): Promise<Response> {
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
    return reply(400, { error: 'Invalid outreach draft request.' });
  }
  const statusRequest = body?.action === 'status' && exact(body, ['action', 'workspaceId', 'programmeId']) &&
    validId(body.workspaceId) && validId(body.programmeId);
  const prepareRequest = body?.action === 'prepare' &&
    exact(body, ['action', 'workspaceId', 'programmeId', 'employerId', 'contactId', 'requestId', 'employerVersion', 'settingsVersion', 'contactVersion']) &&
    validId(body.workspaceId) && validId(body.programmeId) && validId(body.employerId) &&
    (body.contactId === null || validId(body.contactId)) && validId(body.requestId) &&
    Number.isSafeInteger(body.employerVersion) && (body.employerVersion as number) >= 1 &&
    Number.isSafeInteger(body.settingsVersion) && (body.settingsVersion as number) >= 1 &&
    (body.contactVersion === null || (Number.isSafeInteger(body.contactVersion) && (body.contactVersion as number) >= 1));
  if (!statusRequest && !prepareRequest) return reply(400, { error: 'Invalid outreach draft request.' });
  const userId = await dependencies.getUserId(authorization);
  if (!validId(userId)) return reply(401, { error: 'Authentication required.' });
  if (!await dependencies.canAccessProgramme(authorization, body.workspaceId as string, body.programmeId as string)) {
    return reply(403, { error: 'Outreach draft unavailable.' });
  }
  if (statusRequest) return reply(200, { available: dependencies.providerConfigured, model: dependencies.providerConfigured ? dependencies.model : null });
  if (!dependencies.providerConfigured) return reply(503, { error: 'Outreach draft provider is not configured.' });
  const input = {
    workspaceId: body.workspaceId as string,
    programmeId: body.programmeId as string,
    employerId: body.employerId as string,
    contactId: body.contactId as string | null,
    requestId: body.requestId as string,
    employerVersion: body.employerVersion as number,
    settingsVersion: body.settingsVersion as number,
    contactVersion: body.contactVersion as number | null,
  };
  let claim: Claim;
  try {
    claim = await dependencies.claim({ ...input, userId, dailyLimit: dependencies.dailyLimit });
  } catch {
    return reply(409, { error: 'Outreach evidence, suppression status or programme offer unavailable or changed.' });
  }
  if (!claim.shouldAttempt) return claim.status === 'succeeded'
    ? reply(200, publicClaim(claim))
    : reply(409, { error: claim.status === 'claimed' ? 'Outreach draft outcome is unknown.' : 'Outreach draft failed.', requestId: input.requestId });
  if (!claim.source) return reply(409, { error: 'Outreach evidence unavailable.' });
  let prepared: { subject: string; body: string; model: string; providerResponseId: string; inputTokens: number; outputTokens: number };
  try {
    prepared = await dependencies.prepare(claim.source);
  } catch (error) {
    const errorCode = error instanceof EmployerOutreachProviderError ? error.code : 'provider_unavailable';
    try {
      await dependencies.fail({ ...input, userId, errorCode });
    } catch {
      return reply(409, { error: 'Outreach draft outcome is unknown.', requestId: input.requestId });
    }
    return reply(502, { error: 'Outreach draft provider failed.', code: errorCode, requestId: input.requestId });
  }
  try {
    const completed = await dependencies.complete({ ...input, userId, ...prepared });
    return completed.status === 'succeeded'
      ? reply(200, publicClaim(completed))
      : reply(409, { error: 'Outreach evidence changed before the draft was saved.', requestId: input.requestId });
  } catch {
    return reply(409, { error: 'Outreach draft outcome is unknown.', requestId: input.requestId });
  }
}
