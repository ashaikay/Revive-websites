import { Id, ContactRecord, GoalRecord, OpportunityRecord, BusinessProfileRecord, BusinessServiceRecord } from './models';
import { DiscoveryCandidate } from './discovery';

export type CommercialRoute = 'find' | 'audience' | 'recover';
export type CommercialSignalType =
  | 'new_prospect'
  | 'dormant_lead'
  | 'stale_opportunity'
  | 'former_customer_reactivation'
  | 'no_next_action'
  | 'partnership_candidate'
  | 'audience_fit';
export type AudienceSafety = 'allowed' | 'review_required' | 'prohibited';

export interface CommercialEvidence {
  type: 'fact' | 'inference' | 'evidence_required';
  summary: string;
  source: string;
}

export interface CommercialSignal {
  id: Id;
  workspaceId: Id;
  route: CommercialRoute;
  type: CommercialSignalType;
  title: string;
  summary: string;
  potentialValue: number;
  confidence: number;
  effort: number;
  cost: number;
  urgency: number;
  relationshipWarmth: number;
  complianceRisk: number;
  evidence: CommercialEvidence[];
  createdAt: string;
}

export interface CommercialHypothesis {
  id: Id;
  workspaceId: Id;
  route: CommercialRoute;
  statement: string;
  potentialValue: number;
  confidence: number;
  evidence: CommercialEvidence[];
  safety: AudienceSafety;
}

export interface AudienceHypothesis extends CommercialHypothesis {
  route: 'audience';
  segment: string;
  needOrContext: string;
  legitimateChannel: string;
}

export interface CommercialRecommendation {
  id: Id;
  workspaceId: Id;
  route: CommercialRoute;
  rank: number;
  title: string;
  whatRevFound: string;
  whyItMatters: string;
  potentialValue: number;
  confidence: number;
  priorityScore: number;
  evidence: CommercialEvidence[];
  recommendedAction: string;
  approvalRequired: boolean;
  signalIds: Id[];
  goalId?: Id;
  audienceSafety?: AudienceSafety;
}

export interface CommercialIntelligenceContext {
  workspaceId: Id;
  goal?: GoalRecord;
  profile?: BusinessProfileRecord;
  services: BusinessServiceRecord[];
  contacts: ContactRecord[];
  opportunities: OpportunityRecord[];
  discoveryCandidates: DiscoveryCandidate[];
  now?: number;
}

export interface CommercialPlan {
  workspaceId: Id;
  goalSummary: string;
  recommendations: CommercialRecommendation[];
  warnings: string[];
}
