import { Id, OpportunityRecord } from './models';
import { CommercialEvidence } from './commercialIntelligence';

export type RecoverySignalType =
  | 'dormant_lead'
  | 'stale_opportunity'
  | 'no_next_action'
  | 'former_customer_reactivation'
  | 'quote_follow_up'
  | 'repeat_service'
  | 'renewal_due'
  | 'unpaid_invoice';

export type RecoverySupportStatus = 'supported' | 'not_yet_supported';

export interface RecoveryCandidate {
  id: Id;
  workspaceId: Id;
  signalType: RecoverySignalType;
  supportStatus: RecoverySupportStatus;
  contactId?: Id;
  opportunityId?: Id;
  goalId?: Id;
  estimatedRecoverableValue?: number;
  confidence: number;
  evidence: CommercialEvidence[];
  reason: string;
  ageDays?: number;
  relationshipWarmth: number;
  recommendedCapability: 'PREPARE_FOLLOW_UP' | 'PREPARE_REACTIVATION' | 'REVIEW_DORMANT_LEAD';
  safety: 'allowed' | 'review_required';
  source: 'contact' | 'opportunity';
}

export interface RecoveryAnalysis {
  workspaceId: Id;
  goalId?: Id;
  candidates: RecoveryCandidate[];
  potentialValue: number;
  unknownValueCount: number;
  supportedSignals: RecoverySignalType[];
  unsupportedSignals: RecoverySignalType[];
}

export type RecoveryOpportunity = Pick<OpportunityRecord, 'id' | 'workspaceId' | 'estimatedValue' | 'stage' | 'nextActionAt' | 'lastActivityAt'>;
