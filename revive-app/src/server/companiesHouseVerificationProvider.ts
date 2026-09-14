import { DiscoveryCandidate, DiscoveryEvidence } from '@/domain/discovery';
import {
  BusinessVerificationProvider,
  BusinessVerificationResult,
  CompaniesHouseRecord,
  MatchStrength,
  evidenceFact,
} from '@/domain/verification';
import { identityMatches } from '@/services/businessVerificationService';

export interface CompaniesHouseConfig {
  apiKey: string;
  requestsPerMinute: number;
}

export type CompaniesHouseFetch = (input: string, init?: RequestInit) => Promise<Response>;

export class CompaniesHouseProviderError extends Error {
  constructor(readonly code: 'configuration' | 'authentication' | 'rate_limit' | 'unavailable' | 'malformed_response', message: string) {
    super(message);
    this.name = 'CompaniesHouseProviderError';
  }
}

interface CompaniesHouseSearchResponse {
  items?: Array<{
    company_number?: string;
    title?: string;
    company_status?: string;
    company_type?: string;
    date_of_creation?: string;
    address?: { address_line_1?: string; locality?: string; postal_code?: string };
    sic_codes?: string[];
  }>;
}

export class CompaniesHouseVerificationProvider implements BusinessVerificationProvider {
  readonly key = 'companies-house';
  readonly displayName = 'Companies House';
  readonly supportedCountries = ['GB'];
  private readonly config: CompaniesHouseConfig;
  private readonly fetchImpl: CompaniesHouseFetch;

  constructor(config: CompaniesHouseConfig, fetchImpl: CompaniesHouseFetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    if (!config.apiKey || config.requestsPerMinute < 1) {
      throw new CompaniesHouseProviderError('configuration', 'Companies House trusted execution configuration is incomplete.');
    }
  }

  async verify(candidate: DiscoveryCandidate): Promise<BusinessVerificationResult> {
    const checkedAt = new Date().toISOString();
    if (candidate.countryCode.toUpperCase() !== 'GB') return this.result(candidate, 'not_applicable', 'not_checked', 'unknown', 'insufficient_evidence', [], [], checkedAt);
    const query = new URLSearchParams({ q: candidate.name, items_per_page: '20' });
    if (candidate.location) query.set('location', candidate.location);
    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.company-information.service.gov.uk/search/companies?${query.toString()}`, {
        method: 'GET',
        headers: { Authorization: `Basic ${Buffer.from(`${this.config.apiKey}:`, 'utf8').toString('base64')}`, Accept: 'application/json' },
      });
    } catch {
      throw new CompaniesHouseProviderError('unavailable', 'Companies House could not be reached.');
    }
    if (response.status === 401 || response.status === 403) throw new CompaniesHouseProviderError('authentication', 'Companies House credentials were rejected.');
    if (response.status === 429) throw new CompaniesHouseProviderError('rate_limit', 'Companies House rate limit reached.');
    if (response.status === 404) return this.result(candidate, 'not_found', 'not_found', 'unknown', 'credible_trading_presence', [], [this.fact('No Companies House match was returned; this does not establish that the business is not real.', checkedAt)], checkedAt);
    if (response.status < 200 || response.status >= 300) throw new CompaniesHouseProviderError('unavailable', `Companies House returned HTTP ${response.status}.`);

    let payload: CompaniesHouseSearchResponse;
    try { payload = await response.json() as CompaniesHouseSearchResponse; } catch { throw new CompaniesHouseProviderError('malformed_response', 'Companies House returned malformed JSON.'); }
    if (!Array.isArray(payload.items)) throw new CompaniesHouseProviderError('malformed_response', 'Companies House response did not contain search items.');
    const records = payload.items.map(normalizeRecord).filter((record): record is CompaniesHouseRecord => record !== undefined);
    const matches = records.map((record) => ({ record, match: identityMatches(candidate, record) })).filter(({ match }) => match.strength !== 'no_match');
    if (matches.length === 0) return this.result(candidate, 'not_found', 'not_found', 'unknown', 'credible_trading_presence', [], [this.fact('No suitable Companies House match was found; this does not establish that the business is not real.', checkedAt)], checkedAt);
    if (matches.length > 1) return this.result(candidate, 'ambiguous', 'ambiguous', 'unknown', 'credible_trading_presence', matches.map(({ record, match }) => ({ companyNumber: record.companyNumber, registeredName: record.companyName, registeredAddress: record.registeredOfficeAddress, status: record.companyStatus, strength: 'ambiguous' as MatchStrength, reasons: match.reasons })), [this.fact('Multiple plausible Companies House matches were found; no company was selected automatically.', checkedAt)], checkedAt);
    const { record, match } = matches[0];
    const verified = match.strength === 'exact' || match.strength === 'strong';
    return this.result(candidate, verified ? 'verified' : 'partially_verified', verified ? 'verified' : 'not_checked', verified ? 'incorporated_company' : 'unknown', verified ? 'registered_verified_business' : 'credible_trading_presence', [{ companyNumber: record.companyNumber, registeredName: record.companyName, registeredAddress: record.registeredOfficeAddress, status: record.companyStatus, strength: match.strength, reasons: match.reasons }], [this.fact(`Companies House match: ${record.companyName} (${record.companyNumber}).`, checkedAt)], checkedAt);
  }

  healthCheck(): boolean { return Boolean(this.config.apiKey); }

  private fact(summary: string, observedAt: string): DiscoveryEvidence {
    return evidenceFact(this.key, summary, 'Companies House', observedAt, 'https://developer.company-information.service.gov.uk/');
  }

  private result(candidate: DiscoveryCandidate, status: BusinessVerificationResult['status'], registryVerification: BusinessVerificationResult['registryVerification'], entityType: BusinessVerificationResult['entityType'], presence: BusinessVerificationResult['presence'], matches: BusinessVerificationResult['matches'], evidence: DiscoveryEvidence[], checkedAt: string): BusinessVerificationResult {
    return { workspaceId: candidate.workspaceId, candidateId: candidate.candidateId, providerKey: this.key, status, registryVerification, entityType, presence, matches, evidence, checkedAt };
  }
}

function normalizeRecord(item: NonNullable<CompaniesHouseSearchResponse['items']>[number]): CompaniesHouseRecord | undefined {
  if (!item.company_number || !item.title || !item.company_status) return undefined;
  return {
    companyNumber: item.company_number,
    companyName: item.title,
    companyStatus: item.company_status,
    registeredOfficeAddress: [item.address?.address_line_1, item.address?.locality].filter(Boolean).join(', ') || undefined,
    postcode: item.address?.postal_code,
    sicCodes: item.sic_codes,
  };
}
