import { ContactRecord, OpportunityRecord } from '@/domain/models';
import { RecoveryAnalysis, RecoveryCandidate, RecoverySignalType } from '@/domain/recovery';
import { CommercialIntelligenceContext } from '@/domain/commercialIntelligence';

const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 14;
const ALL_SIGNALS: RecoverySignalType[] = ['dormant_lead', 'stale_opportunity', 'no_next_action', 'former_customer_reactivation', 'quote_follow_up', 'repeat_service', 'renewal_due', 'unpaid_invoice'];

function ageDays(value: string | undefined, now: number): number | undefined {
  if (!value) return undefined;
  return Math.max(0, Math.floor((now - new Date(value).getTime()) / DAY_MS));
}

function value(record: ContactRecord | OpportunityRecord): number | undefined {
  return typeof record.estimatedValue === 'number' ? record.estimatedValue : undefined;
}

function candidateBase(context: CommercialIntelligenceContext, signalType: RecoverySignalType, source: RecoveryCandidate['source'], now: number): Pick<RecoveryCandidate, 'workspaceId' | 'signalType' | 'supportStatus' | 'confidence' | 'relationshipWarmth' | 'safety' | 'source'> {
  void now;
  return { workspaceId: context.workspaceId, signalType, supportStatus: 'supported', confidence: 0.7, relationshipWarmth: 0.65, safety: 'allowed', source };
}

export function analyzeRecovery(context: CommercialIntelligenceContext): RecoveryAnalysis {
  const now = context.now ?? Date.now();
  const candidates: RecoveryCandidate[] = [];
  const openOpportunity = (opportunity: OpportunityRecord) => !['won', 'lost', 'dormant'].includes(opportunity.stage);

  for (const opportunity of context.opportunities.filter((item) => item.workspaceId === context.workspaceId)) {
    const age = ageDays(opportunity.lastActivityAt ?? opportunity.updatedAt, now);
    if (opportunity.stage === 'dormant') {
      candidates.push({ ...candidateBase(context, 'dormant_lead', 'opportunity', now), id: `recovery-dormant-${opportunity.id}`, opportunityId: opportunity.id, goalId: context.goal?.id, estimatedRecoverableValue: value(opportunity), confidence: 0.82, relationshipWarmth: 0.78, recommendedCapability: 'REVIEW_DORMANT_LEAD', reason: 'Dormant opportunity with recorded value and no active next step.', ageDays: age, evidence: [{ type: 'fact', summary: 'Opportunity stage is dormant.', source: 'Opportunity record' }] });
      continue;
    }
    if (!openOpportunity(opportunity)) continue;
    if (!opportunity.nextActionAt) {
      candidates.push({ ...candidateBase(context, age !== undefined && age > STALE_DAYS ? 'stale_opportunity' : 'no_next_action', 'opportunity', now), id: `recovery-${age !== undefined && age > STALE_DAYS ? 'stale' : 'next-action'}-${opportunity.id}`, opportunityId: opportunity.id, goalId: context.goal?.id, estimatedRecoverableValue: value(opportunity), confidence: age !== undefined && age > STALE_DAYS ? 0.8 : 0.68, relationshipWarmth: 0.7, recommendedCapability: 'PREPARE_FOLLOW_UP', reason: age !== undefined && age > STALE_DAYS ? `No recorded activity for ${age} days and no next action.` : 'Open opportunity has no recorded next action.', ageDays: age, evidence: [{ type: 'fact', summary: age !== undefined && age > STALE_DAYS ? `Last activity is ${age} days old.` : 'No next action is recorded.', source: 'Opportunity record' }] });
    } else if (age !== undefined && age > STALE_DAYS) {
      candidates.push({ ...candidateBase(context, 'stale_opportunity', 'opportunity', now), id: `recovery-stale-${opportunity.id}`, opportunityId: opportunity.id, goalId: context.goal?.id, estimatedRecoverableValue: value(opportunity), confidence: 0.76, relationshipWarmth: 0.65, recommendedCapability: 'PREPARE_FOLLOW_UP', reason: `No recorded activity for ${age} days.`, ageDays: age, evidence: [{ type: 'fact', summary: `Last activity is ${age} days old.`, source: 'Opportunity record' }] });
    }
  }

  for (const contact of context.contacts.filter((item) => item.workspaceId === context.workspaceId && item.lifecycle === 'former_customer')) {
    candidates.push({ ...candidateBase(context, 'former_customer_reactivation', 'contact', now), id: `recovery-former-${contact.id}`, contactId: contact.id, goalId: context.goal?.id, estimatedRecoverableValue: value(contact), confidence: 0.7, relationshipWarmth: 0.9, recommendedCapability: 'PREPARE_REACTIVATION', reason: 'Former customer with a recorded relationship and no assumed reactivation.', safety: contact.doNotContact ? 'review_required' : 'allowed', ageDays: ageDays(contact.lastInteractionAt ?? contact.updatedAt, now), evidence: [{ type: 'fact', summary: 'Contact lifecycle is former_customer.', source: 'Contact record' }] });
  }

  const supportedSignals = [...new Set(candidates.map((candidate) => candidate.signalType))];
  const unsupportedSignals = ALL_SIGNALS.filter((signal) => !supportedSignals.includes(signal));
  return { workspaceId: context.workspaceId, goalId: context.goal?.id, candidates: candidates.sort((a, b) => ((b.estimatedRecoverableValue ?? 0) * b.confidence) - ((a.estimatedRecoverableValue ?? 0) * a.confidence)), potentialValue: candidates.reduce((total, candidate) => total + (candidate.estimatedRecoverableValue ?? 0), 0), unknownValueCount: candidates.filter((candidate) => candidate.estimatedRecoverableValue === undefined).length, supportedSignals, unsupportedSignals };
}
