import { ContactRecord, AttributionCategory } from '@/domain/models';

/**
 * Phase 3D commercial intelligence derivation. Every figure here is computed only from
 * existing ContactRecord fields — nothing is invented. Where the underlying architecture
 * cannot evidence a concept (e.g. appointments/quotes as distinct records), the concept is
 * documented as a proposed future schema requirement rather than fabricated in the UI.
 */

export type OpportunityStage = 'new' | 'qualified' | 'contacted' | 'follow_up' | 'won' | 'dormant';

export const OPPORTUNITY_STAGE_LABEL: Record<OpportunityStage, string> = {
  new: 'New',
  qualified: 'Qualified',
  contacted: 'Contacted',
  follow_up: 'Follow-up scheduled',
  won: 'Won',
  dormant: 'Dormant',
};

/** Full conceptual pipeline referenced by the product spec. Only a subset is derivable from the current data model; see PHASE_3D docs. */
export const CONCEPTUAL_PIPELINE_STAGES = [
  'New',
  'Qualified',
  'Contacted',
  'Conversation',
  'Appointment',
  'Quote',
  'Follow-up',
  'Won',
  'Lost',
  'Dormant',
];

export const SOURCE_CATEGORIES: { key: string; label: string }[] = [
  { key: 'existing_customer', label: 'Existing customer' },
  { key: 'referral', label: 'Referral' },
  { key: 'website', label: 'Website enquiry' },
  { key: 'manual_lead', label: 'Manual lead' },
  { key: 'rev_prospect_discovery', label: 'REV prospect discovery' },
  { key: 'rev_reactivation', label: 'REV reactivation' },
  { key: 'tender', label: 'Tender' },
  { key: 'grant', label: 'Grant' },
  { key: 'campaign', label: 'Campaign' },
  { key: 'social', label: 'Social' },
  { key: 'partner', label: 'Partner' },
  { key: 'other', label: 'Other' },
];

const STALE_MS = 14 * 24 * 60 * 60 * 1000;

function isStale(contact: ContactRecord, now: number): boolean {
  const last = contact.lastInteractionAt ? new Date(contact.lastInteractionAt).getTime() : 0;
  return now - last > STALE_MS;
}

export function deriveOpportunityStage(contact: ContactRecord): OpportunityStage {
  if (contact.lifecycle === 'customer') return 'won';
  if (contact.lifecycle === 'former_customer') return 'dormant';
  if (contact.lifecycle === 'prospect') return contact.lastInteractionAt ? 'qualified' : 'new';
  // lifecycle === 'lead'
  if (contact.nextActionAt) return 'follow_up';
  return 'contacted';
}

export function isAtRisk(contact: ContactRecord, now: number = Date.now()): boolean {
  return contact.lifecycle === 'lead' && !contact.nextActionAt && isStale(contact, now);
}

export interface RevenueIntelligence {
  won: number;
  pipeline: number;
  atRisk: number;
  recoverable: number;
  revGenerated: number;
  revRecovered: number;
}

function sum(contacts: ContactRecord[]): number {
  return contacts.reduce((total, contact) => total + (contact.estimatedValue ?? 0), 0);
}

export function computeRevenueIntelligence(contacts: ContactRecord[], now: number = Date.now()): RevenueIntelligence {
  const won = contacts.filter((c) => c.lifecycle === 'customer');
  const pipeline = contacts.filter((c) => c.lifecycle === 'prospect' || c.lifecycle === 'lead');
  const atRisk = contacts.filter((c) => isAtRisk(c, now));
  const recoverable = contacts.filter((c) => c.lifecycle === 'former_customer');
  const revGenerated = won.filter((c) => c.attribution === 'rev_generated');
  const revRecovered = won.filter((c) => c.attribution === 'rev_recovered');

  return {
    won: sum(won),
    pipeline: sum(pipeline),
    atRisk: sum(atRisk),
    recoverable: sum(recoverable),
    revGenerated: sum(revGenerated),
    revRecovered: sum(revRecovered),
  };
}

export interface AttentionItem {
  contactId: string;
  contactName: string;
  reason: string;
}

export function buildAttentionItems(contacts: ContactRecord[], now: number = Date.now()): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const contact of contacts) {
    if (isAtRisk(contact, now)) {
      const days = contact.lastInteractionAt ? Math.floor((now - new Date(contact.lastInteractionAt).getTime()) / (24 * 60 * 60 * 1000)) : null;
      items.push({
        contactId: contact.id,
        contactName: contact.name,
        reason: days !== null ? `No recorded follow-up for ${days} days.` : 'No recorded interaction on file.',
      });
    }
    if (contact.lifecycle === 'former_customer') {
      items.push({ contactId: contact.id, contactName: contact.name, reason: 'Former customer with no recorded reactivation yet.' });
    }
  }
  return items;
}

export interface GrowthRecommendation {
  noticed: string;
  whyItMatters: string;
  recommendation: string;
  nextStep: string;
  approvalRequired: boolean;
}

export function buildGrowthRecommendations(contacts: ContactRecord[], now: number = Date.now()): GrowthRecommendation[] {
  const recommendations: GrowthRecommendation[] = [];
  const atRisk = contacts.filter((c) => isAtRisk(c, now));
  if (atRisk.length > 0) {
    recommendations.push({
      noticed: `${atRisk.length} lead${atRisk.length === 1 ? ' has' : 's have'} no recorded follow-up in over 14 days.`,
      whyItMatters: 'Opportunities without recent contact are more likely to go cold or choose a competitor.',
      recommendation: 'Ask REV to prepare a follow-up for each of these leads.',
      nextStep: 'REV will draft follow-ups for your approval; nothing is sent automatically.',
      approvalRequired: true,
    });
  }
  const dormant = contacts.filter((c) => c.lifecycle === 'former_customer');
  if (dormant.length > 0) {
    recommendations.push({
      noticed: `${dormant.length} previous customer${dormant.length === 1 ? '' : 's'} may be due for reactivation.`,
      whyItMatters: 'Past customers already know your business and can be faster to win back than new prospects.',
      recommendation: 'Ask REV to research a reactivation approach for these customers.',
      nextStep: 'REV will prepare a recommendation for your approval; nothing is contacted automatically.',
      approvalRequired: true,
    });
  }
  return recommendations;
}

export interface AttributionSummary {
  category: AttributionCategory;
  count: number;
  value: number;
}

const ATTRIBUTION_ORDER: AttributionCategory[] = ['owner_generated', 'rev_generated', 'rev_assisted', 'rev_recovered', 'unattributed'];

export function summarizeAttribution(contacts: ContactRecord[]): AttributionSummary[] {
  return ATTRIBUTION_ORDER.map((category) => {
    const matches = contacts.filter((c) => (c.attribution ?? 'unattributed') === category);
    return { category, count: matches.length, value: sum(matches) };
  });
}

export interface SourceSummary {
  key: string;
  label: string;
  count: number;
}

export function summarizeSources(contacts: ContactRecord[]): SourceSummary[] {
  return SOURCE_CATEGORIES.map(({ key, label }) => ({
    key,
    label,
    count: contacts.filter((c) => c.source === key).length,
  }));
}
