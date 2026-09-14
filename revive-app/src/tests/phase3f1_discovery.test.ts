import { describe, expect, it, vi } from 'vitest';
import { DiscoveryRequest } from '@/domain/discovery';
import {
  CostGovernor,
  DiscoveryRouter,
  DiscoveryQualityGate,
  InMemoryUsageLedger,
  ProviderRegistry,
  createMockDiscoveryRouter,
  deduplicateCandidates,
  evaluateCompliance,
} from '@/services/discoveryFoundationService';
import { MockBusinessDiscoveryProvider } from '@/services/discoveryFoundationService';
import { DataForSeoBusinessDiscoveryProvider } from '@/server/dataForSeoBusinessDiscoveryProvider';

const request: DiscoveryRequest = {
  workspaceId: 'workspace-1', requestedBy: 'user-1', objective: 'Find local service businesses',
  businessType: 'professional services', location: 'United Kingdom', countryCode: 'GB',
  maximumCandidates: 10, requiredCapabilities: ['business_discovery'], budgetClass: 'included', createdAt: '2026-09-14T00:00:00.000Z',
};

describe('Phase 3F.1 discovery foundation', () => {
  it('routes a GB business-discovery request to the deterministic mock provider', () => {
    const result = createMockDiscoveryRouter().discover(request);
    expect(result.providerKey).toBe('mock-business-discovery');
    expect(result.candidates.every((candidate) => candidate.workspaceId === 'workspace-1')).toBe(true);
    expect(result.candidates[0].evidence[0].evidenceType).toBe('fact');
  });

  it('handles unsupported countries without a provider call', () => {
    const result = createMockDiscoveryRouter().discover({ ...request, countryCode: 'FR' });
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/No healthy provider/);
  });

  it('does not perform external network discovery in the mock provider', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    createMockDiscoveryRouter().discover(request);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('enforces free-plan allowance and premium upgrade protection', () => {
    const governor = new CostGovernor();
    expect(governor.decide('workspace-1', 1, 'included')).toBe('allow');
    governor.getUsageLedger().record({ workspaceId: 'workspace-1', providerKey: 'mock', operation: 'discovery', units: 3, estimatedCost: 0, actualCost: 0, timestamp: request.createdAt, correlationId: 'test' });
    expect(governor.decide('workspace-1', 1, 'included')).toBe('deny');
    expect(governor.decide('workspace-1', 1, 'premium')).toBe('require_upgrade');
  });

  it('records usage and removes duplicate candidates by provider identity', () => {
    const ledger = new InMemoryUsageLedger();
    const router = createMockDiscoveryRouter();
    const result = router.discover(request);
    expect(result.actualCost).toBe(0);
    expect(result.budgetState.used).toBe(1);
    const duplicate = { ...result.candidates[0] };
    expect(deduplicateCandidates([result.candidates[0], duplicate])).toHaveLength(1);
    expect(ledger.list('workspace-1')).toHaveLength(0);
  });

  it('requires evidence for low-signal candidates and blocks duplicate opportunities', () => {
    const provider = new MockBusinessDiscoveryProvider();
    const candidate = provider.discover(request)[1];
    const gate = new DiscoveryQualityGate();
    expect(gate.canConvert(candidate, [])).toEqual(expect.objectContaining({ eligible: false }));
    expect(gate.canConvert(provider.discover(request)[0], [{ title: 'Shah Consulting opportunity' } as never])).toEqual(expect.objectContaining({ eligible: false }));
  });

  it('returns conservative compliance decisions when provenance or consent is incomplete', () => {
    expect(evaluateCompliance({ workspaceId: 'workspace-1', countryCode: 'GB' }).decision).toBe('insufficient_information');
    expect(evaluateCompliance({ workspaceId: 'workspace-1', countryCode: 'GB', candidateCountryCode: 'GB', provenance: 'mock', channel: 'email', consentStatus: 'unknown' }).decision).toBe('review_required');
    expect(evaluateCompliance({ workspaceId: 'workspace-1', countryCode: 'GB', candidateCountryCode: 'GB', provenance: 'mock', suppressed: true }).decision).toBe('blocked');
  });

  it('keeps the mock provider isolated from the live provider mode', () => {
    const provider = new MockBusinessDiscoveryProvider();
    expect(provider.displayName).toContain('demo');
    expect(provider.discover(request).every((candidate) => candidate.metadata.demo === true)).toBe(true);
  });

  it('returns a safe result when a provider is unavailable', () => {
    const provider = new MockBusinessDiscoveryProvider();
    vi.spyOn(provider, 'healthCheck').mockReturnValue(false);
    const unavailableRouter = new DiscoveryRouter(new ProviderRegistry([provider]));
    const result = unavailableRouter.discover(request);
    expect(result.candidates).toHaveLength(0);
    expect(result.warnings[0]).toMatch(/No healthy provider/);
  });

  it('blocks non-GB real-provider requests before fetch', async () => {
    const fetchSpy = vi.fn();
    const provider = new DataForSeoBusinessDiscoveryProvider({ login: 'test', password: 'test', taskCostGbp: 0.01, itemCostGbp: 0.001, developmentBudgetGbp: 10, globalAllowanceGbp: 10, requestsPerMinute: 1 }, fetchSpy);
    await expect(provider.discover({ ...request, countryCode: 'US' })).rejects.toThrow('International discovery is coming soon.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('normalizes only permitted business facts from a provider response', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.02, result: [{ items: [{ title: '  Birmingham Garage  ', place_id: 'place-1', category: 'Garage', address_info: { city: 'Birmingham' }, city: 'Birmingham', country_code: 'gb', url: ' https://garage.example ' }] }] }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const provider = new DataForSeoBusinessDiscoveryProvider({ login: 'test', password: 'test', taskCostGbp: 0.01, itemCostGbp: 0.001, developmentBudgetGbp: 10, globalAllowanceGbp: 10, requestsPerMinute: 1 }, fetchSpy);
    const [candidate] = await provider.discover({ ...request, businessType: 'garage', location: 'Birmingham, UK' });
    expect(candidate).toEqual(expect.objectContaining({ name: 'Birmingham Garage', countryCode: 'GB', providerExternalId: 'place-1', businessCategory: 'Garage' }));
    expect(candidate.metadata.rawPayloadStored).toBe(false);
    expect(candidate.evidence.every((item) => item.evidenceType === 'fact')).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
