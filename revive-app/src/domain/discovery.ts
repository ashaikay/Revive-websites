import { Id, OpportunityRecord, OpportunitySource } from './models';

export type DiscoveryCapability =
  | 'business_discovery'
  | 'company_verification'
  | 'contact_enrichment'
  | 'web_research'
  | 'tender_discovery'
  | 'grant_discovery'
  | 'review_intelligence';

export type DiscoveryBudgetClass = 'included' | 'premium' | 'approval_required';
export type EvidenceClassification = 'fact' | 'inference' | 'evidence_required';
export type QualificationStatus = 'discovered' | 'qualified' | 'rejected' | 'converted';
export type CandidateType = 'business' | 'company' | 'tender' | 'grant' | 'partnership';

export interface DiscoveryRequest {
  workspaceId: Id;
  goalId?: Id;
  requestedBy: Id;
  objective: string;
  query?: string;
  businessType?: string;
  targetMarket?: string;
  location?: string;
  countryCode: string;
  maximumCandidates: number;
  requiredCapabilities: DiscoveryCapability[];
  budgetClass: DiscoveryBudgetClass;
  createdAt: string;
}

export interface DiscoveryEvidence {
  evidenceType: EvidenceClassification;
  source: string;
  sourceUrl?: string;
  summary: string;
  observedAt: string;
  confidence?: number;
  providerKey: string;
}

export interface DiscoveryCandidate {
  candidateId: Id;
  workspaceId: Id;
  providerKey: string;
  providerExternalId?: string;
  name: string;
  website?: string;
  location?: string;
  countryCode: string;
  businessCategory?: string;
  candidateType: CandidateType;
  source: OpportunitySource;
  sourceUrl?: string;
  discoveredAt: string;
  evidence: DiscoveryEvidence[];
  fitScore?: number;
  qualificationStatus: QualificationStatus;
  estimatedEnrichmentCost?: number;
  metadata: Record<string, unknown>;
}

export interface DiscoveryCostEstimate {
  units: number;
  estimatedCost: number;
  budgetClass: DiscoveryBudgetClass;
}

export interface DiscoveryProvider {
  key: string;
  displayName: string;
  supportedCountries: string[];
  supportedCapabilities: DiscoveryCapability[];
  estimateCost(request: DiscoveryRequest): DiscoveryCostEstimate;
  discover(request: DiscoveryRequest): DiscoveryCandidate[];
  healthCheck(): boolean;
}

export interface DiscoveryResult {
  candidates: DiscoveryCandidate[];
  providerKey?: string;
  estimatedCost: number;
  actualCost: number;
  warnings: string[];
  budgetState: UsageBudget;
}

export type CostDecision = 'allow' | 'deny' | 'require_upgrade' | 'require_approval' | 'use_cheaper_provider';

export interface UsageBudget {
  plan: 'free' | 'paid';
  allowance: number;
  used: number;
  remaining: number;
}

export interface UsageEvent {
  workspaceId: Id;
  providerKey: string;
  operation: string;
  units: number;
  estimatedCost: number;
  actualCost: number;
  timestamp: string;
  correlationId: string;
}

export interface ComplianceInput {
  workspaceId: Id;
  countryCode: string;
  candidateCountryCode?: string;
  entityType?: CandidateType;
  channel?: 'email' | 'phone' | 'other';
  suppressed?: boolean;
  consentStatus?: 'known' | 'unknown' | 'not_given';
  lawfulBasis?: string;
  provenance?: string;
}

export type ComplianceDecision = 'allowed' | 'blocked' | 'review_required' | 'insufficient_information';
export interface ComplianceResult { decision: ComplianceDecision; reason: string; }

export interface QualityResult {
  eligible: boolean;
  reasons: string[];
}

export interface CandidateConversionBoundary {
  canConvert(candidate: DiscoveryCandidate, existingOpportunities: OpportunityRecord[]): QualityResult;
}
