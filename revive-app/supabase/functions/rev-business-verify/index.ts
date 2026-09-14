import { createClient } from 'npm:@supabase/supabase-js@2';
import { buildCompaniesHouseRequest } from './request.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const workspaceCalls = new Map<string, number[]>();
const platformCalls: number[] = [];
const idempotency = new Map<string, { expiresAt: number; response: Response }>();
const WINDOW_MS = 5 * 60 * 1000;
const WORKSPACE_LIMIT = 5;
const PLATFORM_LIMIT = 20;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

type VerifyRequest = {
  requestId: string;
  workspaceId: string;
  countryCode: string;
  businessIdentity: { companyNumber?: string; businessName?: string; postcode?: string; locality?: string };
};
type RegistryRecord = {
  companyNumber?: string;
  companyName?: string;
  companyStatus?: string;
  companyType?: string;
  incorporationDate?: string;
  registeredOfficeAddress?: string;
  postcode?: string;
  sicCodes?: string[];
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function normalizedName(value: string): string { return value.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, ''); }
function normalizedPostcode(value?: string): string | undefined { return value?.replace(/\s/g, '').toLowerCase(); }
function trimWindow(values: number[], now: number): number[] { return values.filter((value) => now - value < WINDOW_MS); }
function errorResponse(code: string, message: string, status: number): Response { return json({ error: { code, message } }, status); }
function cloneResponse(response: Response): Response { return new Response(response.body, { status: response.status, headers: response.headers }); }
function responseForMatch(request: VerifyRequest, status: string, registryVerification: string, presence: string, entityType: string, matches: unknown[], evidence: unknown[], checkedAt: string, providerCallCount: number): Response {
  return json({ verificationStatus: status, registryVerification, presence, entityType, matches, evidence, checkedAt, provider: 'companies_house', providerCallCount, requestId: request.requestId });
}
function matchRecord(identity: VerifyRequest['businessIdentity'], record: RegistryRecord): { strength: string; reasons: string[] } {
  if (identity.companyNumber && record.companyNumber === identity.companyNumber) return { strength: 'EXACT', reasons: ['Company number matches exactly.'] };
  const inputName = normalizedName(identity.businessName ?? '');
  const recordName = normalizedName(record.companyName ?? '');
  const sameName = Boolean(inputName && inputName === recordName);
  const compatibleName = Boolean(inputName && recordName && (inputName.includes(recordName) || recordName.includes(inputName)));
  const inputPostcode = normalizedPostcode(identity.postcode);
  const samePostcode = Boolean(inputPostcode && record.postcode && inputPostcode === normalizedPostcode(record.postcode));
  if (sameName && samePostcode) return { strength: 'EXACT', reasons: ['Normalized name and postcode match.'] };
  if (sameName) return { strength: 'STRONG', reasons: ['Normalized business name matches.'] };
  if (compatibleName && samePostcode) return { strength: 'STRONG', reasons: ['Compatible name and postcode match.'] };
  if (compatibleName) return { strength: 'POSSIBLE', reasons: ['Compatible name match; location evidence is incomplete.'] };
  return { strength: 'NO_MATCH', reasons: ['No deterministic name, postcode, or company-number match.'] };
}
function normalizeRecord(item: Record<string, unknown>): RegistryRecord | undefined {
  const companyNumber = typeof item.company_number === 'string' ? item.company_number : undefined;
  const companyName = typeof item.title === 'string' ? item.title : undefined;
  const companyStatus = typeof item.company_status === 'string' ? item.company_status : undefined;
  if (!companyNumber || !companyName || !companyStatus) return undefined;
  const address = item.address as Record<string, unknown> | undefined;
  return {
    companyNumber, companyName, companyStatus,
    companyType: typeof item.company_type === 'string' ? item.company_type : undefined,
    incorporationDate: typeof item.date_of_creation === 'string' ? item.date_of_creation : undefined,
    registeredOfficeAddress: [address?.address_line_1, address?.locality].filter((value): value is string => typeof value === 'string').join(', ') || undefined,
    postcode: typeof address?.postal_code === 'string' ? address.postal_code : undefined,
    sicCodes: Array.isArray(item.sic_codes) ? item.sic_codes.filter((value): value is string => typeof value === 'string') : undefined,
  };
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const startedAt = Date.now();
  if (request.method !== 'POST') return errorResponse('METHOD_NOT_ALLOWED', 'POST is required.', 405);
  const authorization = request.headers.get('Authorization');
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? (() => { try { return JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default; } catch { return undefined; } })();
  if (!authorization || !supabaseUrl || !anonKey) return errorResponse('SERVER_CONFIGURATION', 'Verification service is not configured.', 500);
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const actorUserId = userData.user?.id;
  if (userError || !actorUserId) return errorResponse('AUTHENTICATION_REQUIRED', 'An authenticated user is required.', 401);
  let payload: VerifyRequest;
  try { payload = await request.json() as VerifyRequest; } catch { return errorResponse('INVALID_REQUEST', 'Request JSON is invalid.', 400); }
  if (!payload.requestId || !payload.workspaceId || !payload.countryCode || !payload.businessIdentity || (!payload.businessIdentity.companyNumber && !payload.businessIdentity.businessName)) return errorResponse('INVALID_REQUEST', 'requestId, workspaceId, countryCode, and a business identity are required.', 400);
  const { data: membership, error: membershipError } = await userClient.from('workspace_members').select('status,role').eq('workspace_id', payload.workspaceId).eq('user_id', actorUserId).maybeSingle();
  if (membershipError || membership?.status !== 'active') return errorResponse('WORKSPACE_ACCESS_DENIED', 'The authenticated user is not an active member of this workspace.', 403);
  if (payload.countryCode.toUpperCase() !== 'GB') return responseForMatch(payload, 'NOT_APPLICABLE', 'not_checked', 'insufficient_evidence', 'unknown', [], [], new Date().toISOString(), 0);
  const now = Date.now();
  const key = `${actorUserId}:${payload.workspaceId}:${payload.requestId}`;
  const previous = idempotency.get(key);
  if (previous && previous.expiresAt > now) return cloneResponse(previous.response);
  const workspaceWindow = trimWindow(workspaceCalls.get(payload.workspaceId) ?? [], now);
  const platformWindow = trimWindow(platformCalls, now);
  if (workspaceWindow.length >= WORKSPACE_LIMIT) return errorResponse('WORKSPACE_RATE_LIMITED', 'Workspace verification rate limit reached.', 429);
  if (platformWindow.length >= PLATFORM_LIMIT) return errorResponse('PLATFORM_RATE_LIMITED', 'Platform verification rate limit reached.', 429);
  workspaceWindow.push(now); workspaceCalls.set(payload.workspaceId, workspaceWindow); platformCalls.push(now);
  const apiKey = Deno.env.get('COMPANIES_HOUSE_API_KEY')?.trim();
  if (!apiKey) return errorResponse('SERVER_CONFIGURATION', 'Verification provider is not configured.', 503);
  const providerRequest = buildCompaniesHouseRequest(payload.businessIdentity, apiKey);
  let response: Response;
  try {
    response = await fetch(providerRequest.url, providerRequest.init);
  } catch { return errorResponse('PROVIDER_UNAVAILABLE', 'Companies House is unavailable.', 503); }
  if (response.status === 401 || response.status === 403) return errorResponse('PROVIDER_AUTH_ERROR', 'Companies House authentication failed.', 502);
  if (response.status === 429) return errorResponse('PROVIDER_RATE_LIMITED', 'Companies House rate limit reached.', 429);
  if (response.status === 404) return responseForMatch(payload, 'NOT_FOUND', 'not_found', 'credible_trading_presence', 'unknown', [], [{ evidenceType: 'fact', source: 'Companies House', summary: 'No registry match was returned; this does not establish that the business is not real.' }], new Date().toISOString(), 1);
  if (!response.ok) return errorResponse('PROVIDER_ERROR', `Companies House returned HTTP ${response.status}.`, 502);
  let raw: Record<string, unknown>;
  try { raw = await response.json() as Record<string, unknown>; } catch { return errorResponse('PROVIDER_ERROR', 'Companies House returned malformed JSON.', 502); }
  const records = payload.businessIdentity.companyNumber ? [normalizeRecord({ ...raw, company_number: payload.businessIdentity.companyNumber, title: raw.company_name, company_status: raw.company_status, company_type: raw.type, date_of_creation: raw.date_of_creation, address: raw.registered_office_address, sic_codes: raw.sic_codes })].filter((record): record is RegistryRecord => Boolean(record)) : (Array.isArray(raw.items) ? raw.items.map((item) => normalizeRecord(item as Record<string, unknown>)).filter((record): record is RegistryRecord => Boolean(record)) : null);
  if (!records) return errorResponse('PROVIDER_ERROR', 'Companies House returned an unexpected response.', 502);
  const matches = records.map((record) => ({ record, match: matchRecord(payload.businessIdentity, record) })).filter(({ match }) => match.strength !== 'NO_MATCH');
  const checkedAt = new Date().toISOString();
  let result: Response;
  if (matches.length === 0) result = responseForMatch(payload, 'NOT_FOUND', 'not_found', 'credible_trading_presence', 'unknown', [], [{ evidenceType: 'fact', source: 'Companies House', summary: 'No suitable registry match was found; this does not establish that the business is not real.' }], checkedAt, 1);
  else if (matches.length > 1) result = responseForMatch(payload, 'AMBIGUOUS', 'ambiguous', 'credible_trading_presence', 'unknown', matches.map(({ record, match }) => ({ companyNumber: record.companyNumber, companyName: record.companyName, companyStatus: record.companyStatus, strength: 'AMBIGUOUS', reasons: match.reasons })), [{ evidenceType: 'fact', source: 'Companies House', summary: 'Multiple plausible matches were found; no company was selected automatically.' }], checkedAt, 1);
  else { const { record, match } = matches[0]; result = responseForMatch(payload, match.strength === 'POSSIBLE' ? 'PARTIALLY_VERIFIED' : 'VERIFIED', 'verified', 'registered_verified_business', 'incorporated_company', [{ companyNumber: record.companyNumber, companyName: record.companyName, companyStatus: record.companyStatus, companyType: record.companyType, incorporationDate: record.incorporationDate, postcode: record.postcode, sicCodes: record.sicCodes, strength: match.strength, reasons: match.reasons }], [{ evidenceType: 'fact', source: 'Companies House', summary: `Registry match: ${record.companyName} (${record.companyNumber}).` }], checkedAt, 1); }
  console.log(JSON.stringify({ correlationId: payload.requestId, workspaceId: payload.workspaceId, actorUserId, provider: 'companies_house', operation: 'business_verification', status: result.status, durationMs: Date.now() - startedAt, providerCallCount: 1 }));
  idempotency.set(key, { expiresAt: now + IDEMPOTENCY_TTL_MS, response: result });
  return result;
});
