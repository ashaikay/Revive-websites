import { describe, expect, it } from 'vitest';
import { createMockDataProvider } from '@/data/mockProvider';
import { seedData } from '@/data/seedFixtures';
import { ContactService } from '@/services/contactService';
import { REVActionService } from '@/services/revActionService';
import { ApprovalService } from '@/services/approvalService';
import { OutreachService, deriveOutreachStatus } from '@/services/outreachService';
import {
  OpportunityService,
  buildOpportunityAttentionItems,
  computeOpportunityRevenue,
  summarizeOpportunityAttribution,
} from '@/services/opportunityService';
import { MockProspectDiscoveryProvider, computeFitScoreOverall } from '@/services/prospectDiscoveryProvider';
import { OpportunityRecord } from '@/domain/models';

function createProvider() {
  return createMockDataProvider(structuredClone(seedData));
}

function opportunity(overrides: Partial<OpportunityRecord>): OpportunityRecord {
  return {
    id: 'opportunity-x',
    workspaceId: 'workspace-1',
    contactId: 'contact-1',
    title: 'Test opportunity',
    opportunityType: 'commercial_lead',
    stage: 'new',
    source: 'other',
    currency: 'GBP',
    attribution: 'unattributed',
    createdByType: 'user',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date('2024-12-20T12:00:00.000Z').getTime();

describe('Phase 3E Opportunity domain', () => {
  it('keeps opportunities strictly scoped to their own workspace', () => {
    const provider = createProvider();
    const opportunities = new OpportunityService(provider);
    expect(opportunities.list('workspace-1').every((o) => o.workspaceId === 'workspace-1')).toBe(true);
    expect(opportunities.list('workspace-2').every((o) => o.workspaceId === 'workspace-2')).toBe(true);
  });

  it('is distinct from Contact: an opportunity references a contactId but is its own record', () => {
    const provider = createProvider();
    const opportunities = new OpportunityService(provider);
    const contacts = new ContactService(provider);
    const opp = opportunities.list('workspace-1')[0];
    const contact = contacts.list('workspace-1').find((c) => c.id === opp.contactId);
    expect(contact).toBeDefined();
    expect(opp.id).not.toBe(contact?.id);
  });

  it('marks an opportunity won without inventing a value that was not already recorded', () => {
    const provider = createProvider();
    const opportunities = new OpportunityService(provider);
    const target = opportunities.list('workspace-1').find((o) => o.stage !== 'won')!;
    const updated = opportunities.markWon('workspace-1', target.id);
    expect(updated.stage).toBe('won');
    expect(updated.estimatedValue).toBe(target.estimatedValue);
    expect(updated.wonAt).toBeTruthy();
  });
});

describe('Phase 3E opportunity revenue intelligence', () => {
  it('never assigns REV credit without an explicit attribution', () => {
    const opportunities = [
      opportunity({ stage: 'won', estimatedValue: 10000, attribution: 'rev_generated' }),
      opportunity({ stage: 'won', estimatedValue: 5000 }), // unattributed
    ];
    const revenue = computeOpportunityRevenue(opportunities, NOW);
    expect(revenue.revGenerated).toBe(10000);
    expect(revenue.won).toBe(15000);
  });

  it('does not count REV-generated revenue merely because an opportunity was created with that attribution', () => {
    // Preparing outreach / creating an opportunity must never itself create counted revenue.
    const opportunities = [opportunity({ stage: 'new', estimatedValue: 12000, attribution: 'rev_generated' })];
    const revenue = computeOpportunityRevenue(opportunities, NOW);
    expect(revenue.revGenerated).toBe(0);
    expect(revenue.won).toBe(0);
    expect(revenue.pipeline).toBe(12000);
  });

  it('flags a stalled, non-terminal opportunity with no next action as at risk', () => {
    const stale = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();
    const opportunities = [opportunity({ stage: 'contacted', estimatedValue: 5000, lastActivityAt: stale })];
    expect(computeOpportunityRevenue(opportunities, NOW).atRisk).toBe(5000);
  });

  it('never flags a won, lost, or dormant opportunity as at risk', () => {
    const stale = new Date(NOW - 30 * 24 * 60 * 60 * 1000).toISOString();
    const opportunities = [
      opportunity({ stage: 'won', estimatedValue: 5000, lastActivityAt: stale }),
      opportunity({ stage: 'lost', estimatedValue: 5000, lastActivityAt: stale }),
      opportunity({ stage: 'dormant', estimatedValue: 5000, lastActivityAt: stale }),
    ];
    expect(computeOpportunityRevenue(opportunities, NOW).atRisk).toBe(0);
  });

  it('produces an attention item that explains why, not a fabricated monetary threat', () => {
    const stale = new Date(NOW - 20 * 24 * 60 * 60 * 1000).toISOString();
    const items = buildOpportunityAttentionItems([opportunity({ stage: 'contacted', lastActivityAt: stale })], NOW);
    expect(items[0].reason).toMatch(/no recorded activity for \d+ days/i);
  });

  it('never counts REV attribution for an opportunity with no attribution set', () => {
    const summary = summarizeOpportunityAttribution([opportunity({ stage: 'won', estimatedValue: 5000 })]);
    expect(summary.find((row) => row.category === 'unattributed')?.count).toBe(1);
    expect(summary.find((row) => row.category === 'rev_generated')?.count).toBe(0);
  });
});

describe('Phase 3E fit score', () => {
  it('averages named criteria rather than using a bare confidence number', () => {
    const overall = computeFitScoreOverall({
      serviceMatch: 1,
      geographicMatch: 1,
      companyTypeMatch: 1,
      opportunityTrigger: 1,
      contactability: 0,
    });
    expect(overall).toBeCloseTo(0.8);
  });

  it('only returns candidates scoped to the requested workspace', () => {
    const provider = new MockProspectDiscoveryProvider();
    expect(provider.discover('workspace-1').every((c) => c.workspaceId === 'workspace-1')).toBe(true);
    expect(provider.discover('workspace-3')).toHaveLength(0);
  });
});

describe('Phase 3E outreach preparation remains non-executing and respects suppression', () => {
  it('creates a draft outreach action and approval, without executing anything', () => {
    const provider = createProvider();
    const opportunities = new OpportunityService(provider);
    const contacts = new ContactService(provider);
    const outreach = new OutreachService(provider);
    const actions = new REVActionService(provider);
    const approvals = new ApprovalService(provider);

    const opportunity = opportunities.list('workspace-1').find((o) => o.contactId === 'contact-1')!;
    const contact = contacts.list('workspace-1').find((c) => c.id === 'contact-1')!;

    const { actionId, approvalId } = outreach.prepareDraft('workspace-1', opportunity, contact, 'Evidence-based rationale');

    const action = actions.list('workspace-1').find((a) => a.id === actionId);
    expect(action?.status).toBe('awaiting_approval');
    expect(action?.executionStatus).toBe('not_executed');
    expect(action?.opportunityId).toBe(opportunity.id);

    const approval = approvals.list('workspace-1').find((a) => a.id === approvalId);
    expect(approval?.decision).toBeUndefined();

    approvals.decide('workspace-1', approvalId, 'approved', 'user-1');
    const approvedAction = actions.list('workspace-1').find((a) => a.id === actionId);
    expect(approvedAction?.status).toBe('approved');
    expect(approvedAction?.executionStatus).toBe('not_executed');
  });

  it('refuses to prepare outreach for a suppressed contact', () => {
    const provider = createProvider();
    const opportunities = new OpportunityService(provider);
    const contacts = new ContactService(provider);
    const outreach = new OutreachService(provider);

    const opportunity = opportunities.list('workspace-1').find((o) => o.contactId === 'contact-2')!;
    const contact = contacts.list('workspace-1').find((c) => c.id === 'contact-2')!;
    expect(contact.doNotContact).toBe(true);

    expect(() => outreach.prepareDraft('workspace-1', opportunity, contact, 'rationale')).toThrow(/suppressed/i);
  });

  it('never maps an outreach status to sent/replied/converted without a real send integration', () => {
    expect(deriveOutreachStatus('proposed', false)).toBe('draft');
    expect(deriveOutreachStatus('awaiting_approval', false)).toBe('ready_for_approval');
    expect(deriveOutreachStatus('approved', false)).toBe('approved');
    expect(deriveOutreachStatus('completed', false)).toBe('closed');
    expect(deriveOutreachStatus('approved', true)).toBe('suppressed');
  });
});
