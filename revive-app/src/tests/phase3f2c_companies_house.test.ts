import { describe, expect, it, vi } from 'vitest';
import { DiscoveryCandidate } from '@/domain/discovery';
import { CompaniesHouseProviderError, CompaniesHouseVerificationProvider } from '@/server/companiesHouseVerificationProvider';

const candidate: DiscoveryCandidate = {
  candidateId: 'candidate-live-shaped', workspaceId: 'workspace-1', providerKey: 'mock-discovery', providerExternalId: 'source-1',
  name: 'Acme Services Ltd', location: 'Birmingham B1 1AA', countryCode: 'GB', candidateType: 'business', source: 'rev_prospect_discovery',
  discoveredAt: '2026-09-14T00:00:00.000Z', evidence: [{ evidenceType: 'fact', source: 'mock', summary: 'Identity supplied by discovery.', observedAt: '2026-09-14T00:00:00.000Z', providerKey: 'mock' }],
  qualificationStatus: 'discovered', metadata: {},
};

function provider(response: unknown, status = 200) {
  const fetchSpy = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status, headers: { 'Content-Type': 'application/json' } }));
  return { provider: new CompaniesHouseVerificationProvider({ apiKey: 'server-test-key', requestsPerMinute: 1 }, fetchSpy), fetchSpy };
}

describe('Phase 3F.2C Companies House provider', () => {
  it('normalizes a real-shaped company search result without officers or PSC data', async () => {
    const { provider: adapter, fetchSpy } = provider({ items: [{ company_number: '12345678', title: 'Acme Services Ltd', company_status: 'active', company_type: 'ltd', date_of_creation: '2020-01-01', address: { address_line_1: '1 High Street', locality: 'Birmingham', postal_code: 'B1 1AA' }, sic_codes: ['62020'], officers: [{ name: 'Should never be retained' }] }] });
    const result = await adapter.verify(candidate);
    expect(result.status).toBe('verified');
    expect(result.matches[0]).toEqual(expect.objectContaining({ companyNumber: '12345678', strength: 'exact' }));
    expect(JSON.stringify(result)).not.toContain('Should never be retained');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('returns NOT_APPLICABLE for non-GB before making a provider call', async () => {
    const { provider: adapter, fetchSpy } = provider({ items: [] });
    const result = await adapter.verify({ ...candidate, countryCode: 'US' });
    expect(result.status).toBe('not_applicable');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('keeps no match distinct from provider failure', async () => {
    const noMatch = await provider({ items: [] }).provider.verify(candidate);
    expect(noMatch.status).toBe('not_found');
    await expect(provider({ error: 'unauthorized' }, 401).provider.verify(candidate)).rejects.toMatchObject({ code: 'authentication' });
    await expect(provider({ error: 'busy' }, 429).provider.verify(candidate)).rejects.toMatchObject({ code: 'rate_limit' });
    await expect(provider('not-json', 200).provider.verify(candidate)).rejects.toMatchObject({ code: 'malformed_response' });
  });

  it('rejects incomplete trusted configuration', () => {
    expect(() => new CompaniesHouseVerificationProvider({ apiKey: '', requestsPerMinute: 1 })).toThrowError(CompaniesHouseProviderError);
    expect(() => new CompaniesHouseVerificationProvider({ apiKey: 'key', requestsPerMinute: 0 })).toThrowError(CompaniesHouseProviderError);
  });
});
