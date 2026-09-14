import { describe, expect, it } from 'vitest';
import { ContactRecord } from '@/domain/models';
import {
  buildAttentionItems,
  buildGrowthRecommendations,
  computeRevenueIntelligence,
  deriveOpportunityStage,
  summarizeAttribution,
  summarizeSources,
} from '@/services/growthIntelligenceService';

function contact(overrides: Partial<ContactRecord>): ContactRecord {
  return {
    id: 'contact-x',
    workspaceId: 'workspace-1',
    lifecycle: 'lead',
    name: 'Test Contact',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2024-12-20T12:00:00.000Z').getTime();

describe('Phase 3D revenue intelligence', () => {
  it('counts won revenue only from customer-lifecycle contacts', () => {
    const contacts = [contact({ lifecycle: 'customer', estimatedValue: 25000 }), contact({ lifecycle: 'lead', estimatedValue: 15000 })];
    expect(computeRevenueIntelligence(contacts, NOW).won).toBe(25000);
  });

  it('counts pipeline revenue from prospect and lead contacts only', () => {
    const contacts = [
      contact({ lifecycle: 'prospect', estimatedValue: 8000 }),
      contact({ lifecycle: 'lead', estimatedValue: 15000 }),
      contact({ lifecycle: 'customer', estimatedValue: 25000 }),
    ];
    expect(computeRevenueIntelligence(contacts, NOW).pipeline).toBe(23000);
  });

  it('flags a lead with no next action and a stale interaction as at risk', () => {
    const stale = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();
    const contacts = [contact({ lifecycle: 'lead', estimatedValue: 15000, lastInteractionAt: stale })];
    expect(computeRevenueIntelligence(contacts, NOW).atRisk).toBe(15000);
  });

  it('does not flag a lead with a scheduled next action as at risk even if stale', () => {
    const stale = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();
    const contacts = [contact({ lifecycle: 'lead', estimatedValue: 15000, lastInteractionAt: stale, nextActionAt: '2024-12-25T00:00:00.000Z' })];
    expect(computeRevenueIntelligence(contacts, NOW).atRisk).toBe(0);
  });

  it('counts recoverable revenue only from former-customer contacts', () => {
    const contacts = [contact({ lifecycle: 'former_customer', estimatedValue: 9000 }), contact({ lifecycle: 'customer', estimatedValue: 25000 })];
    expect(computeRevenueIntelligence(contacts, NOW).recoverable).toBe(9000);
  });

  it('never attributes REV credit without an explicit rev_generated/rev_recovered attribution', () => {
    const contacts = [
      contact({ lifecycle: 'customer', estimatedValue: 30000, attribution: 'rev_generated' }),
      contact({ lifecycle: 'customer', estimatedValue: 22000, attribution: 'rev_recovered' }),
      contact({ lifecycle: 'customer', estimatedValue: 25000, attribution: 'owner_generated' }),
      contact({ lifecycle: 'customer', estimatedValue: 5000 }), // no attribution set
    ];
    const revenue = computeRevenueIntelligence(contacts, NOW);
    expect(revenue.revGenerated).toBe(30000);
    expect(revenue.revRecovered).toBe(22000);
  });

  it('never fabricates a figure for an empty contact list', () => {
    expect(computeRevenueIntelligence([], NOW)).toEqual({ won: 0, pipeline: 0, atRisk: 0, recoverable: 0, revGenerated: 0, revRecovered: 0 });
  });
});

describe('Phase 3D opportunity stage derivation', () => {
  it('maps customer lifecycle to won and former_customer to dormant', () => {
    expect(deriveOpportunityStage(contact({ lifecycle: 'customer' }))).toBe('won');
    expect(deriveOpportunityStage(contact({ lifecycle: 'former_customer' }))).toBe('dormant');
  });

  it('maps a prospect with no interaction to new, and with interaction to qualified', () => {
    expect(deriveOpportunityStage(contact({ lifecycle: 'prospect' }))).toBe('new');
    expect(deriveOpportunityStage(contact({ lifecycle: 'prospect', lastInteractionAt: '2024-12-01T00:00:00.000Z' }))).toBe('qualified');
  });

  it('maps a lead with a scheduled next action to follow_up, otherwise contacted', () => {
    expect(deriveOpportunityStage(contact({ lifecycle: 'lead', nextActionAt: '2024-12-25T00:00:00.000Z' }))).toBe('follow_up');
    expect(deriveOpportunityStage(contact({ lifecycle: 'lead' }))).toBe('contacted');
  });
});

describe('Phase 3D attention items and recommendations', () => {
  it('produces an attention item explaining why, not a fabricated monetary threat', () => {
    const stale = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();
    const items = buildAttentionItems([contact({ lifecycle: 'lead', lastInteractionAt: stale })], NOW);
    expect(items[0].reason).toMatch(/no recorded follow-up for \d+ days/i);
  });

  it('recommends action grounded in a real count, never a fabricated revenue figure', () => {
    const stale = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();
    const recs = buildGrowthRecommendations([contact({ lifecycle: 'lead', lastInteractionAt: stale })], NOW);
    expect(recs[0].noticed).toContain('1 lead has no recorded follow-up');
    expect(recs[0].approvalRequired).toBe(true);
  });
});

describe('Phase 3D attribution and source summaries', () => {
  it('never assigns REV credit when attribution is absent', () => {
    const summary = summarizeAttribution([contact({ estimatedValue: 5000 })]);
    const unattributed = summary.find((row) => row.category === 'unattributed');
    expect(unattributed?.count).toBe(1);
    expect(summary.find((row) => row.category === 'rev_generated')?.count).toBe(0);
  });

  it('only counts sources that actually appear in the data', () => {
    const summary = summarizeSources([contact({ source: 'website' })]);
    expect(summary.find((row) => row.key === 'website')?.count).toBe(1);
    expect(summary.find((row) => row.key === 'tender')?.count).toBe(0);
  });
});
