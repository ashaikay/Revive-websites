import {
  CompaniesHouseDiscoveryError,
  type DiscoveryFilters,
  type DiscoveryResult,
} from './companiesHouseEmployerDiscovery.ts';

type Claim = {
  searchId: string;
  status: 'claimed' | 'succeeded' | 'failed';
  shouldAttempt: boolean;
  results: DiscoveryResult[] | null;
  errorCode: string | null;
  retrievedAt: string | null;
};

export interface EmployerDiscoveryDependencies {
  allowedOrigin?: string;
  providerConfigured: boolean;
  getUserId(authorization: string): Promise<string | null>;
  canAccessProgramme(authorization: string, workspaceId: string, programmeId: string, userId: string): Promise<boolean>;
  claim(input: { workspaceId: string; programmeId: string; userId: string; requestId: string; filters: DiscoveryFilters }): Promise<Claim>;
  search(filters: DiscoveryFilters): Promise<DiscoveryResult[]>;
  complete(input: { workspaceId: string; userId: string; requestId: string; results: DiscoveryResult[]; retrievedAt: string }): Promise<Claim>;
  fail(input: { workspaceId: string; userId: string; requestId: string; errorCode: string }): Promise<Claim>;
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const sectors = new Set(['construction', 'retail', 'warehousing_logistics', 'traffic_management', 'rail_train', 'royal_mail_postal', 'post_office_branches']);
const exact = (value: Record<string, unknown>, keys: string[]) => Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const validId = (value: unknown): value is string => typeof value === 'string' && uuid.test(value);
const validFilters = (value: unknown): value is DiscoveryFilters => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const raw = value as Record<string, unknown>;
  return exact(raw, ['location', 'sectors', 'excludeTerms']) &&
    typeof raw.location === 'string' && raw.location.length >= 2 && raw.location.length <= 120 && raw.location.trim() === raw.location &&
    Array.isArray(raw.sectors) && raw.sectors.length >= 1 && raw.sectors.length <= 7 &&
    raw.sectors.every((item) => typeof item === 'string' && sectors.has(item)) && new Set(raw.sectors).size === raw.sectors.length &&
    Array.isArray(raw.excludeTerms) && raw.excludeTerms.length <= 20 &&
    raw.excludeTerms.every((item) => typeof item === 'string' && item.length >= 1 && item.length <= 80 && item.trim() === item);
};
const publicClaim = (claim: Claim) => ({
  searchId: claim.searchId,
  status: claim.status,
  results: claim.results,
  errorCode: claim.errorCode,
  retrievedAt: claim.retrievedAt,
});

export async function handleEmployerDiscovery(request: Request, dependencies: EmployerDiscoveryDependencies): Promise<Response> {
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
    return reply(400, { error: 'Invalid employer discovery request.' });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body) ||
    !['status', 'search'].includes(body.action as string) || !validId(body.workspaceId) || !validId(body.programmeId) ||
    (body.action === 'status' && !exact(body, ['action', 'workspaceId', 'programmeId'])) ||
    (body.action === 'search' && (!exact(body, ['action', 'workspaceId', 'programmeId', 'requestId', 'filters']) ||
      !validId(body.requestId) || !validFilters(body.filters)))) {
    return reply(400, { error: 'Invalid employer discovery request.' });
  }
  const userId = await dependencies.getUserId(authorization);
  if (!validId(userId)) return reply(401, { error: 'Authentication required.' });
  if (!await dependencies.canAccessProgramme(authorization, body.workspaceId as string, body.programmeId as string, userId)) {
    return reply(403, { error: 'Employer discovery unavailable.' });
  }
  if (body.action === 'status') return reply(200, { available: dependencies.providerConfigured, provider: 'Companies House' });
  if (!dependencies.providerConfigured) return reply(503, { error: 'Companies House discovery is not configured.' });
  const input = {
    workspaceId: body.workspaceId as string,
    programmeId: body.programmeId as string,
    userId,
    requestId: body.requestId as string,
    filters: body.filters as DiscoveryFilters,
  };
  let claim: Claim;
  try {
    claim = await dependencies.claim(input);
  } catch {
    return reply(409, { error: 'Employer discovery request unavailable.' });
  }
  if (!claim.shouldAttempt) return claim.status === 'succeeded'
    ? reply(200, publicClaim(claim))
    : reply(409, { error: claim.status === 'claimed' ? 'Employer discovery outcome is unknown.' : 'Employer discovery failed.', requestId: input.requestId });
  let results: DiscoveryResult[];
  try {
    results = await dependencies.search(input.filters);
  } catch (error) {
    const errorCode = error instanceof CompaniesHouseDiscoveryError ? error.code : 'provider_unavailable';
    try {
      await dependencies.fail({ ...input, errorCode });
    } catch {
      return reply(409, { error: 'Employer discovery outcome is unknown.', requestId: input.requestId });
    }
    return reply(errorCode === 'provider_rate_limited' ? 429 : 502, { error: 'Employer discovery provider failed.', code: errorCode, requestId: input.requestId });
  }
  try {
    const completed = await dependencies.complete({ ...input, results, retrievedAt: new Date().toISOString() });
    return reply(200, publicClaim(completed));
  } catch {
    return reply(409, { error: 'Employer discovery outcome is unknown.', requestId: input.requestId });
  }
}
