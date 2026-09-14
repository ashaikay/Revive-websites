import { DiscoveryCandidate, DiscoveryEvidence } from './discovery';
import { Id } from './models';

export type BusinessEntityType =
  | 'incorporated_company'
  | 'sole_trader'
  | 'partnership'
  | 'trading_name'
  | 'emerging_business'
  | 'pre_launch'
  | 'unknown';

export type BusinessPresenceStatus =
  | 'registered_verified_business'
  | 'credible_trading_presence'
  | 'emerging_pre_launch_business'
  | 'insufficient_evidence';

export type VerificationStatus =
  | 'verified'
  | 'partially_verified'
  | 'not_found'
  | 'ambiguous'
  | 'conflicting_evidence'
  | 'evidence_required'
  | 'not_applicable';

export type MatchStrength = 'exact' | 'strong' | 'possible' | 'ambiguous' | 'no_match';

export interface BusinessIdentity {
  name: string;
  normalizedName: string;
  website?: string;
  normalizedDomain?: string;
  location?: string;
  postcode?: string;
  countryCode: string;
}

export interface BusinessPresenceRecord {
  id: Id;
  workspaceId: Id;
  identity: BusinessIdentity;
  entityType: BusinessEntityType;
  presenceStatus: BusinessPresenceStatus;
  evidence: DiscoveryEvidence[];
  createdAt: string;
  updatedAt: string;
}

export interface VerificationMatch {
  companyNumber?: string;
  registeredName?: string;
  registeredAddress?: string;
  status?: string;
  strength: MatchStrength;
  reasons: string[];
}

export interface BusinessVerificationResult {
  workspaceId: Id;
  candidateId: Id;
  providerKey: string;
  status: VerificationStatus;
  registryVerification: 'verified' | 'not_found' | 'ambiguous' | 'not_checked';
  entityType: BusinessEntityType;
  presence: BusinessPresenceStatus;
  matches: VerificationMatch[];
  evidence: DiscoveryEvidence[];
  checkedAt: string;
}

export interface BusinessVerificationProvider {
  key: string;
  displayName: string;
  supportedCountries: string[];
  verify(candidate: DiscoveryCandidate): BusinessVerificationResult | Promise<BusinessVerificationResult>;
  healthCheck(): boolean;
}

export interface VerificationRouter {
  verify(candidate: DiscoveryCandidate): BusinessVerificationResult | Promise<BusinessVerificationResult>;
}

export interface CompaniesHouseRecord {
  companyNumber: string;
  companyName: string;
  companyStatus: string;
  registeredOfficeAddress?: string;
  postcode?: string;
  sicCodes?: string[];
}

export function evidenceFact(providerKey: string, summary: string, source: string, observedAt: string, sourceUrl?: string): DiscoveryEvidence {
  return { evidenceType: 'fact', providerKey, summary, source, sourceUrl, observedAt };
}

export function normalizeBusinessName(name: string): string {
  return name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]/g, '');
}

export function normalizeDomain(website?: string): string | undefined {
  if (!website) return undefined;
  return website.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
}
