import { describe, expect, it } from 'vitest';
import { seedData } from '@/data/seedFixtures';
import { CommercialIntelligenceContext } from '@/domain/commercialIntelligence';
import { analyzeRecovery } from '@/services/recoveryService';
import { buildCommercialPlan } from '@/services/commercialIntelligenceService';
import { computeOpportunityRevenue } from '@/services/opportunityService';

const context: CommercialIntelligenceContext = {
  workspaceId: 'workspace-1', goal: seedData.goals[0], profile: seedData.profiles[0], services: seedData.services.filter((item) => item.workspaceId === 'workspace-1'),
  contacts: seedData.contacts.filter((item) => item.workspaceId === 'workspace-1'), opportunities: seedData.opportunities.filter((item) => item.workspaceId === 'workspace-1'), discoveryCandidates: [], now: new Date('2026-09-14T00:00:00.000Z').getTime(),
};

describe('Phase 3H REV RECOVER', () => {
  it('detects supported dormant, stale, no-next-action, and former-customer signals', () => {
    const analysis = analyzeRecovery(context);
    expect(analysis.candidates.map((candidate) => candidate.signalType)).toEqual(expect.arrayContaining(['dormant_lead', 'stale_opportunity', 'former_customer_reactivation']));
    expect(analysis.supportedSignals).toEqual(expect.arrayContaining(['dormant_lead', 'stale_opportunity', 'former_customer_reactivation']));
  });

  it('does not treat won or closed opportunities as recoverable', () => {
    const analysis = analyzeRecovery(context);
    expect(analysis.candidates.some((candidate) => candidate.opportunityId === 'opportunity-5')).toBe(false);
    expect(analysis.candidates.some((candidate) => candidate.opportunityId === 'opportunity-7')).toBe(false);
  });

  it('marks quote, repeat-service, renewal, and invoice signals unsupported', () => {
    const analysis = analyzeRecovery(context);
    expect(analysis.unsupportedSignals).toEqual(expect.arrayContaining(['quote_follow_up', 'repeat_service', 'renewal_due', 'unpaid_invoice']));
  });

  it('keeps missing commercial value unknown and does not invent estimates', () => {
    const analysis = analyzeRecovery({ ...context, contacts: [{ ...context.contacts[0], id: 'unknown-value', lifecycle: 'former_customer', estimatedValue: undefined }] });
    const unknown = analysis.candidates.find((candidate) => candidate.contactId === 'unknown-value');
    expect(unknown?.estimatedRecoverableValue).toBeUndefined();
    expect(analysis.unknownValueCount).toBeGreaterThan(0);
  });

  it('calculates potential recovery value separately from won revenue', () => {
    const analysis = analyzeRecovery(context);
    const wonRevenue = computeOpportunityRevenue(context.opportunities).won;
    expect(analysis.potentialValue).toBeGreaterThan(0);
    expect(analysis.potentialValue).not.toBe(wonRevenue);
    expect(buildCommercialPlan(context).recommendations.every((recommendation) => recommendation.approvalRequired)).toBe(true);
  });

  it('keeps recovery workspace-scoped and prioritizes value with explainable evidence', () => {
    const analysis = analyzeRecovery({ ...context, opportunities: [...context.opportunities, { ...context.opportunities[0], id: 'foreign-opportunity', workspaceId: 'workspace-2', estimatedValue: 999999 }] });
    expect(analysis.candidates.every((candidate) => candidate.workspaceId === 'workspace-1')).toBe(true);
    expect(analysis.candidates[0].evidence[0].type).toBe('fact');
    expect(analysis.candidates[0].reason.length).toBeGreaterThan(0);
  });

  it('does not create actions, contacts, opportunities, or memory entries', () => {
    const before = { contacts: context.contacts.length, opportunities: context.opportunities.length };
    analyzeRecovery(context);
    expect(context.contacts).toHaveLength(before.contacts);
    expect(context.opportunities).toHaveLength(before.opportunities);
  });
});
