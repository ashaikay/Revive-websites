import { ContactRecord, OpportunityRecord } from '@/domain/models';
import {
  AudienceHypothesis,
  AudienceSafety,
  CommercialEvidence,
  CommercialIntelligenceContext,
  CommercialPlan,
  CommercialRecommendation,
  CommercialSignal,
} from '@/domain/commercialIntelligence';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;

function evidence(type: CommercialEvidence['type'], summary: string, source: string): CommercialEvidence {
  return { type, summary, source };
}

function ageInDays(value: string | undefined, now: number): number | undefined {
  if (!value) return undefined;
  return Math.max(0, Math.floor((now - new Date(value).getTime()) / DAY_MS));
}

function valueOf(record: ContactRecord | OpportunityRecord): number {
  return record.estimatedValue ?? 0;
}

function recoverySignals(context: CommercialIntelligenceContext): CommercialSignal[] {
  const now = context.now ?? Date.now();
  const signals: CommercialSignal[] = [];
  for (const opportunity of context.opportunities) {
    const age = ageInDays(opportunity.lastActivityAt, now);
    if (opportunity.stage === 'dormant') {
      signals.push({
        id: `recover-dormant-${opportunity.id}`, workspaceId: context.workspaceId, route: 'recover', type: 'dormant_lead',
        title: `Reactivate ${opportunity.title}`, summary: 'A dormant opportunity has recorded commercial value but no active next step.',
        potentialValue: valueOf(opportunity), confidence: 0.8, effort: 0.25, cost: 0, urgency: 0.65, relationshipWarmth: 0.75, complianceRisk: 0.1,
        evidence: [evidence('fact', `Opportunity is marked dormant with recorded value ${valueOf(opportunity)}.`, 'Opportunity record')], createdAt: new Date(now).toISOString(),
      });
    }
    const openWithoutNextAction = opportunity.stage !== 'won' && opportunity.stage !== 'lost' && opportunity.stage !== 'dormant' && !opportunity.nextActionAt;
    if (openWithoutNextAction) {
      const age = ageInDays(opportunity.lastActivityAt, now);
      signals.push({
        id: `${age && age > STALE_DAYS ? 'recover-stale' : 'recover-next-action'}-${opportunity.id}`, workspaceId: context.workspaceId, route: 'recover', type: age && age > STALE_DAYS ? 'stale_opportunity' : 'no_next_action',
        title: age && age > STALE_DAYS ? `Follow up ${opportunity.title}` : `Set a next action for ${opportunity.title}`,
        summary: age && age > STALE_DAYS ? `No recorded opportunity activity for ${age} days.` : 'An open opportunity has no recorded next action.',
        potentialValue: valueOf(opportunity), confidence: age && age > STALE_DAYS ? 0.78 : 0.72, effort: 0.2, cost: 0, urgency: age && age > STALE_DAYS ? 0.9 : 0.55, relationshipWarmth: 0.65, complianceRisk: 0.1,
        evidence: [evidence('fact', age && age > STALE_DAYS ? `Last activity is ${age} days old and no next action is recorded.` : 'Open opportunity has no next_action_at value.', 'Opportunity record')], createdAt: new Date(now).toISOString(),
      });
    }
    if (age !== undefined && age > STALE_DAYS && !openWithoutNextAction && opportunity.stage !== 'won' && opportunity.stage !== 'lost' && opportunity.stage !== 'dormant') {
      signals.push({
        id: `recover-stale-${opportunity.id}`, workspaceId: context.workspaceId, route: 'recover', type: 'stale_opportunity',
        title: `Follow up ${opportunity.title}`, summary: `No recorded opportunity activity for ${age} days.`,
        potentialValue: valueOf(opportunity), confidence: 0.78, effort: 0.3, cost: 0, urgency: 0.85, relationshipWarmth: 0.7, complianceRisk: 0.1,
        evidence: [evidence('fact', `Last activity is ${age} days old.`, 'Opportunity record')], createdAt: new Date(now).toISOString(),
      });
    }
  }
  for (const contact of context.contacts.filter((contact) => contact.lifecycle === 'former_customer')) {
    signals.push({
      id: `recover-former-${contact.id}`, workspaceId: context.workspaceId, route: 'recover', type: 'former_customer_reactivation',
      title: `Revisit ${contact.company ?? contact.name}`, summary: 'A former customer is a possible reactivation route.',
      potentialValue: valueOf(contact), confidence: 0.7, effort: 0.4, cost: 0, urgency: 0.5, relationshipWarmth: 0.9, complianceRisk: contact.doNotContact ? 0.95 : 0.1,
      evidence: [evidence('fact', 'Contact lifecycle is former_customer.', 'Contact record')], createdAt: new Date(now).toISOString(),
    });
  }
  return signals;
}

function findSignals(context: CommercialIntelligenceContext): CommercialSignal[] {
  const now = context.now ?? Date.now();
  return context.discoveryCandidates.filter((candidate) => candidate.workspaceId === context.workspaceId).map((candidate) => ({
    id: `find-${candidate.candidateId}`, workspaceId: context.workspaceId, route: 'find', type: 'new_prospect',
    title: `Review ${candidate.name}`, summary: 'A discovery candidate may represent new commercial value outside the existing relationship base.',
    potentialValue: 0, confidence: candidate.fitScore ?? 0, effort: 0.7, cost: 0, urgency: 0.35, relationshipWarmth: 0.15, complianceRisk: 0.2,
    evidence: candidate.evidence.map((item) => evidence(item.evidenceType, item.summary, item.source)), createdAt: new Date(now).toISOString(),
  }));
}

export function audienceSafety(segment: string, context: string): AudienceSafety {
  const sensitive = /bereaved|alienated|imprisoned|mentally ill|domestic abuse|financially distressed/i;
  if (sensitive.test(`${segment} ${context}`)) return 'prohibited';
  if (/personal circumstance|health|family breakdown|vulnerable/i.test(`${segment} ${context}`)) return 'review_required';
  return 'allowed';
}

export function buildAudienceHypotheses(context: CommercialIntelligenceContext): AudienceHypothesis[] {
  const profile = context.profile;
  if (!profile || context.services.length === 0) return [];
  const service = context.services.find((item) => item.active);
  const segment = profile.targetCustomers || 'businesses matching the stated target customer profile';
  const safety = audienceSafety(segment, profile.description);
  return [{
    id: `audience-${context.workspaceId}`, workspaceId: context.workspaceId, route: 'audience',
    segment, needOrContext: `Potential fit for ${service?.name ?? 'the active service'} based on the Business Brain profile.`,
    legitimateChannel: profile.serviceAreas[0] ? `Professional and local channels in ${profile.serviceAreas[0]}` : 'Owner-approved professional and local channels',
    statement: `The stated target customer profile may be reached through legitimate professional channels.`,
    potentialValue: 0, confidence: 0.55, safety,
    evidence: [evidence('fact', `Business Brain target customers: ${segment}.`, 'Business profile'), evidence('fact', `Active service: ${service?.name ?? 'not recorded'}.`, 'Business services')],
  }];
}

function priorityScore(signal: CommercialSignal, goalMetric?: string): number {
  const goalAlignment = goalMetric && signal.route === 'recover' && /revenue|meeting|sales/i.test(goalMetric) ? 1 : signal.route === 'audience' ? 0.75 : 0.65;
  const valueScore = signal.potentialValue > 0 ? Math.min(signal.potentialValue / 25000, 1) : signal.confidence;
  return Math.round((goalAlignment * 0.2 + valueScore * 0.25 + signal.confidence * 0.2 + (1 - signal.effort) * 0.12 + (1 - signal.cost) * 0.08 + signal.urgency * 0.1 + signal.relationshipWarmth * 0.05 - signal.complianceRisk * 0.1) * 100);
}

export function buildCommercialPlan(context: CommercialIntelligenceContext): CommercialPlan {
  const signals = [...recoverySignals(context), ...findSignals(context)];
  const audiences = buildAudienceHypotheses(context);
  const audienceSignals: CommercialSignal[] = audiences.filter((hypothesis) => hypothesis.safety !== 'prohibited').map((hypothesis) => ({
    id: hypothesis.id, workspaceId: hypothesis.workspaceId, route: 'audience', type: 'audience_fit', title: `Develop ${hypothesis.segment} audience route`, summary: hypothesis.statement,
    potentialValue: hypothesis.potentialValue, confidence: hypothesis.confidence, effort: 0.55, cost: 0, urgency: 0.45, relationshipWarmth: 0.2, complianceRisk: hypothesis.safety === 'review_required' ? 0.7 : 0.1,
    evidence: hypothesis.evidence, createdAt: new Date().toISOString(),
  }));
  const allSignals = [...signals, ...audienceSignals];
  const recommendations: CommercialRecommendation[] = allSignals.map((signal) => ({
    id: `recommendation-${signal.id}`, workspaceId: context.workspaceId, route: signal.route, rank: 0, title: signal.title,
    whatRevFound: signal.summary, whyItMatters: signal.route === 'recover' ? 'Existing relationships can offer a faster route to value than starting cold.' : signal.route === 'find' ? 'A new prospect may add value outside the current relationship base.' : 'A legitimate audience route can improve where the business focuses its growth effort.',
    potentialValue: signal.potentialValue, confidence: signal.confidence, priorityScore: priorityScore(signal, context.goal?.metric), evidence: signal.evidence,
    recommendedAction: signal.route === 'recover' ? 'Prepare a follow-up recommendation for owner approval.' : signal.route === 'find' ? 'Review and qualify the candidate before creating commercial work.' : 'Research the channel and prepare an owner-approved plan.',
    approvalRequired: true, signalIds: [signal.id], goalId: context.goal?.id, audienceSafety: signal.route === 'audience' ? audiences.find((hypothesis) => hypothesis.id === signal.id)?.safety : undefined,
  })).sort((a, b) => b.priorityScore - a.priorityScore).map((recommendation, index) => ({ ...recommendation, rank: index + 1 }));
  return { workspaceId: context.workspaceId, goalSummary: context.goal?.objective ?? 'No active commercial goal is recorded.', recommendations, warnings: context.profile && context.services.length > 0 ? [] : ['Business Brain or active service information is incomplete; audience confidence is limited.'] };
}

export function recoverySignalsForTest(context: CommercialIntelligenceContext): CommercialSignal[] { return recoverySignals(context); }
