import { DiscoveryCandidate, DiscoveryCostEstimate, DiscoveryProvider, DiscoveryRequest } from '@/domain/discovery';
import { OpportunitySource } from '@/domain/models';

export interface DataForSeoConfig {
  login: string;
  password: string;
  taskCostGbp: number;
  itemCostGbp: number;
  developmentBudgetGbp: number;
  globalAllowanceGbp: number;
  requestsPerMinute: number;
}

interface DataForSeoBusinessItem {
  title?: string;
  description?: string;
  category?: string;
  cid?: string;
  place_id?: string;
  address?: string;
  url?: string;
  domain?: string;
  country_code?: string;
  city?: string;
  zip?: string;
  phone?: string;
  latitude?: number;
  longitude?: number;
}

interface DataForSeoResponse {
  status_code?: number;
  status_message?: string;
  cost?: number;
  tasks?: Array<{
    status_code?: number;
    status_message?: string;
    cost?: number;
    result?: Array<{ items?: DataForSeoBusinessItem[]; total_count?: number }>;
  }>;
}

export class DataForSeoProviderError extends Error {
  constructor(readonly code: 'configuration' | 'authentication' | 'rate_limit' | 'balance' | 'provider' | 'malformed_response', message: string) {
    super(message);
    this.name = 'DataForSeoProviderError';
  }
}

export interface TrustedDiscoveryProvider extends Omit<DiscoveryProvider, 'discover'> {
  discover(request: DiscoveryRequest): Promise<DiscoveryCandidate[]>;
}

export type ProviderFetch = (input: string, init: RequestInit) => Promise<Response>;

export class DataForSeoBusinessDiscoveryProvider implements TrustedDiscoveryProvider {
  readonly key = 'dataforseo-business-listings';
  readonly displayName = 'DataForSEO Business Listings';
  readonly supportedCountries = ['GB'];
  readonly supportedCapabilities = ['business_discovery' as const];
  private readonly config: DataForSeoConfig;
  private readonly fetchImpl: ProviderFetch;

  constructor(config: DataForSeoConfig, fetchImpl: ProviderFetch = fetch) {
    this.config = config;
    this.fetchImpl = fetchImpl;
    if (!config.login || !config.password || config.taskCostGbp < 0 || config.itemCostGbp < 0 || config.developmentBudgetGbp <= 0 || config.globalAllowanceGbp <= 0 || config.requestsPerMinute < 1) {
      throw new DataForSeoProviderError('configuration', 'DataForSEO trusted execution configuration is incomplete or invalid.');
    }
  }

  estimateCost(request: DiscoveryRequest): DiscoveryCostEstimate {
    const requestedItems = Math.min(Math.max(request.maximumCandidates, 1), 1000);
    return {
      units: 1,
      estimatedCost: this.config.taskCostGbp + requestedItems * this.config.itemCostGbp,
      budgetClass: 'approval_required',
    };
  }

  async discover(request: DiscoveryRequest): Promise<DiscoveryCandidate[]> {
    if (request.countryCode.toUpperCase() !== 'GB') throw new DataForSeoProviderError('configuration', 'International discovery is coming soon.');
    if (!request.location?.trim()) throw new DataForSeoProviderError('configuration', 'A UK location is required for business discovery.');
    const estimate = this.estimateCost(request);
    if (estimate.estimatedCost > this.config.developmentBudgetGbp || estimate.estimatedCost > this.config.globalAllowanceGbp) {
      throw new DataForSeoProviderError('configuration', 'Provider spending ceiling would be exceeded.');
    }

    const task = {
      language_code: 'en',
      location_name: request.location.trim(),
      categories: request.businessType ? [request.businessType.trim()] : undefined,
      limit: Math.min(Math.max(request.maximumCandidates, 1), 1000),
      tag: `rev-${request.workspaceId}-${request.createdAt}`,
    };
    const authorization = Buffer.from(`${this.config.login}:${this.config.password}`, 'utf8').toString('base64');
    let response: Response;
    try {
      response = await this.fetchImpl('https://api.dataforseo.com/v3/business_data/business_listings/search/live', {
        method: 'POST',
        headers: { Authorization: `Basic ${authorization}`, 'Content-Type': 'application/json' },
        body: JSON.stringify([task]),
      });
    } catch {
      throw new DataForSeoProviderError('provider', 'DataForSEO could not be reached.');
    }
    if (response.status === 401 || response.status === 403) throw new DataForSeoProviderError('authentication', 'DataForSEO credentials were rejected.');
    if (response.status === 429) throw new DataForSeoProviderError('rate_limit', 'DataForSEO rate limit reached.');
    if (response.status < 200 || response.status >= 300) throw new DataForSeoProviderError('provider', `DataForSEO returned HTTP ${response.status}.`);

    let payload: DataForSeoResponse;
    try { payload = await response.json() as DataForSeoResponse; } catch { throw new DataForSeoProviderError('malformed_response', 'DataForSEO returned malformed JSON.'); }
    const taskResult = payload.tasks?.[0];
    if (!taskResult || taskResult.status_code === undefined || taskResult.status_code >= 40000) {
      const message = taskResult?.status_message ?? payload.status_message ?? 'DataForSEO returned an unusable task response.';
      const code = /balance|fund|credit/i.test(message) ? 'balance' : 'provider';
      throw new DataForSeoProviderError(code, message);
    }
    const items = taskResult.result?.[0]?.items;
    if (!Array.isArray(items)) throw new DataForSeoProviderError('malformed_response', 'DataForSEO response did not contain business items.');
    return items.map((item, index) => normalizeBusinessItem(item, request, index)).filter((candidate): candidate is DiscoveryCandidate => candidate !== undefined);
  }

  healthCheck(): boolean { return Boolean(this.config.login && this.config.password); }
}

function normalizeBusinessItem(item: DataForSeoBusinessItem, request: DiscoveryRequest, index: number): DiscoveryCandidate | undefined {
  const name = item.title?.trim();
  const countryCode = item.country_code?.trim().toUpperCase() || 'GB';
  if (!name || countryCode !== 'GB') return undefined;
  const externalId = item.place_id?.trim() || item.cid?.trim();
  const location = [item.city, item.zip].filter(Boolean).join(', ') || request.location;
  const observedAt = new Date().toISOString();
  return {
    candidateId: `dataforseo-${externalId ?? `${request.workspaceId}-${index}`}`,
    workspaceId: request.workspaceId,
    providerKey: 'dataforseo-business-listings',
    providerExternalId: externalId,
    name,
    website: item.url?.trim() || (item.domain ? `https://${item.domain.trim()}` : undefined),
    location,
    countryCode,
    businessCategory: item.category?.trim(),
    candidateType: 'business',
    source: 'rev_prospect_discovery' as OpportunitySource,
    sourceUrl: 'https://api.dataforseo.com/v3/business_data/business_listings/search/live',
    discoveredAt: observedAt,
    evidence: [
      { evidenceType: 'fact', source: 'DataForSEO Business Listings', sourceUrl: 'https://api.dataforseo.com/v3/business_data/business_listings/search/live', summary: `Business listing identity returned for ${name}.`, observedAt, providerKey: 'dataforseo-business-listings' },
      ...(item.category ? [{ evidenceType: 'fact' as const, source: 'DataForSEO Business Listings', summary: `Listed category: ${item.category.trim()}.`, observedAt, providerKey: 'dataforseo-business-listings' }] : []),
      ...(location ? [{ evidenceType: 'fact' as const, source: 'DataForSEO Business Listings', summary: `Listed location: ${location}.`, observedAt, providerKey: 'dataforseo-business-listings' }] : []),
    ],
    qualificationStatus: 'discovered',
    metadata: { retentionClass: 'normalized-permitted-facts-only', rawPayloadStored: false },
  };
}
