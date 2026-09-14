import { describe, expect, it } from 'vitest';
import { DiscoveryCandidate } from '@/domain/discovery';
import { BusinessVerificationService, MockCompaniesHouseVerificationProvider, createPresenceFromCandidate } from '@/services/businessVerificationService';
import { DiscoveryQualityGate } from '@/services/discoveryFoundationService';

function candidate(overrides: Partial<DiscoveryCandidate> = {}): DiscoveryCandidate {
  return {
    candidateId: 'candidate-1', workspaceId: 'workspace-1', providerKey: 'mock-discovery', providerExternalId: 'source-1',
    name: 'Shah Consulting', website: 'https://shah.example', location: 'Birmingham B1 1AA', countryCode: 'GB',
    businessCategory: 'consulting', candidateType: 'business', source: 'rev_prospect_discovery', discoveredAt: '2026-09-14T00:00:00.000Z',
    evidence: [{ evidenceType: 'fact', source: 'mock', summary: 'Business identity supplied by discovery provider.', observedAt: '2026-09-14T00:00:00.000Z', providerKey: 'mock-discovery' }],
    qualificationStatus: 'discovered', metadata: { demo: true }, ...overrides,
  };
}

describe('Phase 3F.2B business verification foundation', () => {
  it('creates credible trading presence without requiring registry verification', () => {
    const presence = createPresenceFromCandidate(candidate());
    expect(presence.presenceStatus).toBe('credible_trading_presence');
    expect(presence.entityType).toBe('unknown');
    expect(presence.workspaceId).toBe('workspace-1');
  });

  it('returns VERIFIED for an exact Companies House mock match', async () => {
    const result = await new BusinessVerificationService(new MockCompaniesHouseVerificationProvider()).verify(candidate());
    expect(result.status).toBe('verified');
    expect(result.registryVerification).toBe('verified');
    expect(result.entityType).toBe('incorporated_company');
    expect(result.matches[0].strength).toBe('exact');
    expect(result.evidence[0].evidenceType).toBe('fact');
  });

  it('accepts an exact company-number match as the strongest deterministic signal', async () => {
    const result = await new BusinessVerificationService(new MockCompaniesHouseVerificationProvider()).verify(candidate({ name: 'Different Trading Name', providerExternalId: '01234567' }));
    expect(result.status).toBe('verified');
    expect(result.matches[0].strength).toBe('exact');
  });

  it('returns AMBIGUOUS for multiple plausible matches without selecting one', async () => {
    const result = await new BusinessVerificationService(new MockCompaniesHouseVerificationProvider()).verify(candidate({ name: 'Walsh', location: 'Birmingham B1 1AA' }));
    expect(result.status).toBe('ambiguous');
    expect(result.entityType).toBe('unknown');
    expect(result.matches).toHaveLength(2);
  });

  it('returns NOT_FOUND without calling the business fake or sole trader', async () => {
    const result = await new BusinessVerificationService(new MockCompaniesHouseVerificationProvider()).verify(candidate({ name: 'Independent Local Electrician' }));
    expect(result.status).toBe('not_found');
    expect(result.registryVerification).toBe('not_found');
    expect(result.entityType).toBe('unknown');
    expect(result.presence).toBe('credible_trading_presence');
    expect(result.evidence[0].summary).toMatch(/does not establish/);
  });

  it('keeps emerging and pre-launch entity types explicit rather than inferred', () => {
    const emerging = createPresenceFromCandidate(candidate({ candidateId: 'emerging', evidence: [{ evidenceType: 'inference', source: 'customer', summary: 'Business presence appears recent.', observedAt: '2026-09-14T00:00:00.000Z', providerKey: 'customer' }] }));
    expect(emerging.entityType).toBe('unknown');
    expect(emerging.presenceStatus).toBe('credible_trading_presence');
    const preLaunch = createPresenceFromCandidate(candidate({ candidateId: 'pre-launch', name: 'Planned Business', evidence: [] }));
    expect(preLaunch.entityType).toBe('unknown');
    expect(preLaunch.presenceStatus).toBe('insufficient_evidence');
  });

  it('does not turn verification into qualification or revenue', async () => {
    const verified = await new BusinessVerificationService(new MockCompaniesHouseVerificationProvider()).verify(candidate());
    const gate = new DiscoveryQualityGate();
    expect(gate.canConvert(candidate(), []).eligible).toBe(true);
    expect(verified.status).toBe('verified');
    expect(verified).not.toHaveProperty('estimatedValue');
  });

  it('blocks non-GB verification without provider execution', async () => {
    const provider = new MockCompaniesHouseVerificationProvider();
    const service = new BusinessVerificationService(provider);
    const result = await service.verify(candidate({ countryCode: 'US' }));
    expect(result.status).toBe('not_applicable');
    expect(result.entityType).toBe('unknown');
  });
});
