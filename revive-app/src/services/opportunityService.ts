import { DataProvider } from '@/domain/repositories';
import {
  AttributionCategory,
  OpportunityRecord,
  OpportunitySource,
  OpportunityStage,
} from '@/domain/models';
import { recordAudit } from './auditService';

/**
 * Phase 3E Opportunity service. An Opportunity is a specific commercial pursuit tied to a
 * Contact — distinct from the Contact itself (who the person/business is). A contact may have
 * several opportunities over time. All writes remain workspace-scoped through the repository.
 */
export class OpportunityService {
  constructor(private readonly provider: DataProvider) {}

  list(workspaceId: string): OpportunityRecord[] {
    return this.provider.opportunities.list(workspaceId);
  }

  get(workspaceId: string, opportunityId: string): OpportunityRecord | undefined {
    return this.provider.opportunities.get(workspaceId, opportunityId);
  }

  markWon(workspaceId: string, opportunityId: string): OpportunityRecord {
    const opportunity = this.require(workspaceId, opportunityId);
    const updated = this.provider.opportunities.save({
      ...opportunity,
      stage: 'won',
      wonAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    recordAudit(this.provider, { workspaceId, actorType: 'user', action: 'opportunity.won', resourceType: 'opportunity', resourceId: opportunityId });
    return updated;
  }

  markLost(workspaceId: string, opportunityId: string, lostReason?: string): OpportunityRecord {
    const opportunity = this.require(workspaceId, opportunityId);
    const updated = this.provider.opportunities.save({
      ...opportunity,
      stage: 'lost',
      lostAt: new Date().toISOString(),
      lostReason,
      updatedAt: new Date().toISOString(),
    });
    recordAudit(this.provider, { workspaceId, actorType: 'user', action: 'opportunity.lost', resourceType: 'opportunity', resourceId: opportunityId, metadata: { lostReason } });
    return updated;
  }

  private require(workspaceId: string, opportunityId: string): OpportunityRecord {
    const opportunity = this.provider.opportunities.get(workspaceId, opportunityId);
    if (!opportunity) throw new Error(`Opportunity ${opportunityId} was not found in workspace ${workspaceId}`);
    return opportunity;
  }
}

export const OPPORTUNITY_STAGE_LABEL: Record<OpportunityStage, string> = {
  new: 'New',
  qualified: 'Qualified',
  contacted: 'Contacted',
  conversation: 'Conversation',
  appointment: 'Appointment',
  quote: 'Quote',
  follow_up: 'Follow-up scheduled',
  won: 'Won',
  lost: 'Lost',
  dormant: 'Dormant',
};

export const OPPORTUNITY_SOURCE_LABEL: Record<OpportunitySource, string> = {
  existing_customer: 'Existing customer',
  referral: 'Referral',
  website_enquiry: 'Website enquiry',
  manual_lead: 'Manual lead',
  rev_prospect_discovery: 'REV prospect discovery',
  rev_reactivation: 'REV reactivation',
  tender: 'Tender',
  grant: 'Grant',
  campaign: 'Campaign',
  social: 'Social',
  partner: 'Partner',
  other: 'Other',
};

const STALE_MS = 14 * 24 * 60 * 60 * 1000;

function isAtRisk(opportunity: OpportunityRecord, now: number): boolean {
  if (opportunity.stage === 'won' || opportunity.stage === 'lost' || opportunity.stage === 'dormant') return false;
  if (opportunity.nextActionAt) return false;
  const last = opportunity.lastActivityAt ? new Date(opportunity.lastActivityAt).getTime() : 0;
  return now - last > STALE_MS;
}

function sum(opportunities: OpportunityRecord[]): number {
  return opportunities.reduce((total, opportunity) => total + (opportunity.estimatedValue ?? 0), 0);
}

export interface OpportunityRevenueIntelligence {
  won: number;
  pipeline: number;
  atRisk: number;
  recoverable: number;
  revGenerated: number;
  revRecovered: number;
}

export function computeOpportunityRevenue(opportunities: OpportunityRecord[], now: number = Date.now()): OpportunityRevenueIntelligence {
  const won = opportunities.filter((o) => o.stage === 'won');
  const pipeline = opportunities.filter((o) => !['won', 'lost', 'dormant'].includes(o.stage));
  const atRisk = opportunities.filter((o) => isAtRisk(o, now));
  const recoverable = opportunities.filter((o) => o.stage === 'dormant');
  const revGenerated = won.filter((o) => o.attribution === 'rev_generated');
  const revRecovered = won.filter((o) => o.attribution === 'rev_recovered');

  return {
    won: sum(won),
    pipeline: sum(pipeline),
    atRisk: sum(atRisk),
    recoverable: sum(recoverable),
    revGenerated: sum(revGenerated),
    revRecovered: sum(revRecovered),
  };
}

export interface OpportunityAttentionItem {
  opportunityId: string;
  title: string;
  reason: string;
}

export function buildOpportunityAttentionItems(opportunities: OpportunityRecord[], now: number = Date.now()): OpportunityAttentionItem[] {
  const items: OpportunityAttentionItem[] = [];
  for (const opportunity of opportunities) {
    if (isAtRisk(opportunity, now)) {
      const last = opportunity.lastActivityAt ? new Date(opportunity.lastActivityAt).getTime() : null;
      const days = last !== null ? Math.floor((now - last) / (24 * 60 * 60 * 1000)) : null;
      items.push({
        opportunityId: opportunity.id,
        title: opportunity.title,
        reason: days !== null ? `No recorded activity for ${days} days.` : 'No recorded activity on file.',
      });
    }
    if (opportunity.stage === 'dormant') {
      items.push({ opportunityId: opportunity.id, title: opportunity.title, reason: 'Dormant opportunity with no recorded reactivation yet.' });
    }
  }
  return items;
}

export interface AttributionSummary {
  category: AttributionCategory;
  count: number;
  value: number;
}

const ATTRIBUTION_ORDER: AttributionCategory[] = ['owner_generated', 'rev_generated', 'rev_assisted', 'rev_recovered', 'unattributed'];

export function summarizeOpportunityAttribution(opportunities: OpportunityRecord[]): AttributionSummary[] {
  return ATTRIBUTION_ORDER.map((category) => {
    const matches = opportunities.filter((o) => o.attribution === category);
    return { category, count: matches.length, value: sum(matches) };
  });
}
