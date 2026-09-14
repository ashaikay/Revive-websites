import { describe, expect, it } from 'vitest';
import { seedData } from '@/data/seedFixtures';
import { CommercialIntelligenceContext } from '@/domain/commercialIntelligence';
import { buildAudienceHypotheses, buildCommercialPlan, audienceSafety, recoverySignalsForTest } from '@/services/commercialIntelligenceService';

const baseContext: CommercialIntelligenceContext = {
  workspaceId: 'workspace-1',
  goal: seedData.goals[0],
  profile: seedData.profiles[0],
  services: seedData.services.filter((service) => service.workspaceId === 'workspace-1'),
  contacts: seedData.contacts.filter((contact) => contact.workspaceId === 'workspace-1'),
  opportunities: seedData.opportunities.filter((opportunity) => opportunity.workspaceId === 'workspace-1'),
  discoveryCandidates: [],
  now: new Date('2026-09-14T00:00:00.000Z').getTime(),
};

describe('Phase 3G commercial intelligence', () => {
  it('detects deterministic recovery signals from existing records only', () => {
    const signals = recoverySignalsForTest(baseContext);
    expect(signals.some((signal) => signal.type === 'dormant_lead')).toBe(true);
    expect(signals.some((signal) => signal.type === 'former_customer_reactivation')).toBe(true);
    expect(signals.every((signal) => signal.workspaceId === 'workspace-1')).toBe(true);
  });

  it('ranks warm recovery ahead of cold find when recoverable value exists', () => {
    const plan = buildCommercialPlan({ ...baseContext, discoveryCandidates: [{ workspaceId: 'workspace-1', candidateId: 'cold', providerKey: 'mock', name: 'Cold Prospect', countryCode: 'GB', candidateType: 'business', source: 'rev_prospect_discovery', discoveredAt: '2026-09-14T00:00:00.000Z', evidence: [], qualificationStatus: 'discovered', metadata: {}, fitScore: 0.8 }] });
    const recovery = plan.recommendations.find((recommendation) => recommendation.route === 'recover');
    const find = plan.recommendations.find((recommendation) => recommendation.route === 'find');
    expect(recovery).toBeDefined();
    expect(find).toBeDefined();
    expect(recovery!.priorityScore).toBeGreaterThan(find!.priorityScore);
    expect(recovery!.whyItMatters).toContain('Existing relationships');
  });

  it('allows generic audience routes and blocks sensitive-person profiling', () => {
    expect(audienceSafety('UK plumbing businesses in Birmingham', 'public commercial intent')).toBe('allowed');
    expect(audienceSafety('bereaved parents', 'named people')).toBe('prohibited');
    expect(audienceSafety('parents with a sensitive personal circumstance', 'context')).toBe('review_required');
    expect(buildAudienceHypotheses(baseContext)[0].safety).toBe('allowed');
  });

  it('returns an evidence-required warning when Business Brain data is incomplete', () => {
    const plan = buildCommercialPlan({ ...baseContext, profile: undefined, services: [] });
    expect(plan.warnings).toHaveLength(1);
    expect(plan.recommendations.every((recommendation) => recommendation.approvalRequired)).toBe(true);
  });

  it('keeps value estimates separate from revenue and produces no side effects', () => {
    const plan = buildCommercialPlan(baseContext);
    expect(plan.recommendations.every((recommendation) => !('revenue' in recommendation))).toBe(true);
    expect(seedData.actions).toHaveLength(2);
    expect(plan.recommendations.every((recommendation) => recommendation.approvalRequired)).toBe(true);
  });

  it('isolates commercial signals by workspace', () => {
    const plan = buildCommercialPlan({ ...baseContext, discoveryCandidates: [{ ...baseContext.discoveryCandidates, workspaceId: 'workspace-2', candidateId: 'foreign', providerKey: 'mock', name: 'Foreign', countryCode: 'GB', candidateType: 'business', source: 'rev_prospect_discovery', discoveredAt: '2026-09-14T00:00:00.000Z', evidence: [], qualificationStatus: 'discovered', metadata: {} } as never] });
    expect(plan.recommendations.every((recommendation) => recommendation.workspaceId === 'workspace-1')).toBe(true);
    expect(plan.recommendations.some((recommendation) => recommendation.title === 'Review Foreign')).toBe(false);
  });
});
