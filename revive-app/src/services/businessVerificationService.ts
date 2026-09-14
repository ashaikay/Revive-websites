import {
  BusinessPresenceRecord,
  BusinessVerificationProvider,
  BusinessVerificationResult,
  CompaniesHouseRecord,
  MatchStrength,
  VerificationRouter,
  evidenceFact,
  normalizeBusinessName,
  normalizeDomain,
} from '@/domain/verification';
import { DiscoveryCandidate } from '@/domain/discovery';

export function identityMatches(candidate: DiscoveryCandidate, record: CompaniesHouseRecord): { strength: MatchStrength; reasons: string[] } {
  const candidateName = normalizeBusinessName(candidate.name);
  const recordName = normalizeBusinessName(record.companyName);
  if (candidate.providerExternalId === record.companyNumber) return { strength: 'exact', reasons: ['Provider identifier matches the company number.'] };
  const sameName = candidateName === recordName;
  const nameContains = candidateName.includes(recordName) || recordName.includes(candidateName);
  const candidatePostcode = candidate.location?.match(/[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i)?.[0]?.replace(/\s/g, '').toLowerCase();
  const samePostcode = Boolean(candidatePostcode && record.postcode && candidatePostcode === record.postcode.replace(/\s/g, '').toLowerCase());
  if (sameName && samePostcode) return { strength: 'exact', reasons: ['Normalized name and postcode match.'] };
  if (sameName) return { strength: 'strong', reasons: ['Normalized business name matches.'] };
  if (nameContains && samePostcode) return { strength: 'strong', reasons: ['Name is a compatible variant and postcode matches.'] };
  if (nameContains) return { strength: 'possible', reasons: ['Name is a compatible variant but location evidence is incomplete.'] };
  return { strength: 'no_match', reasons: ['No deterministic name or location match.'] };
}

export function createPresenceFromCandidate(candidate: DiscoveryCandidate): BusinessPresenceRecord {
  const hasIdentity = Boolean(candidate.name && candidate.countryCode);
  const hasCredibleEvidence = candidate.evidence.some((evidence) => evidence.evidenceType !== 'evidence_required');
  const now = new Date().toISOString();
  return {
    id: `presence-${candidate.candidateId}`,
    workspaceId: candidate.workspaceId,
    identity: {
      name: candidate.name,
      normalizedName: normalizeBusinessName(candidate.name),
      website: candidate.website,
      normalizedDomain: normalizeDomain(candidate.website),
      location: candidate.location,
      countryCode: candidate.countryCode,
    },
    entityType: 'unknown',
    presenceStatus: hasIdentity && hasCredibleEvidence ? 'credible_trading_presence' : 'insufficient_evidence',
    evidence: candidate.evidence.map((evidence) => ({ ...evidence })),
    createdAt: now,
    updatedAt: now,
  };
}

export class MockCompaniesHouseVerificationProvider implements BusinessVerificationProvider {
  readonly key = 'mock-companies-house';
  readonly displayName = 'Companies House verification (demo)';
  readonly supportedCountries = ['GB'];

  constructor(private readonly records: CompaniesHouseRecord[] = [
    { companyNumber: '01234567', companyName: 'Shah Consulting', companyStatus: 'active', registeredOfficeAddress: 'Birmingham', postcode: 'B1 1AA', sicCodes: ['70229'] },
    { companyNumber: '07654321', companyName: 'Walsh Partners Limited', companyStatus: 'active', registeredOfficeAddress: 'Leeds', postcode: 'LS1 1AA', sicCodes: ['69102'] },
    { companyNumber: '09990000', companyName: 'Walsh & Partners', companyStatus: 'active', registeredOfficeAddress: 'Birmingham', postcode: 'B1 1AA' },
  ]) {}

  async verify(candidate: DiscoveryCandidate): Promise<BusinessVerificationResult> {
    const checkedAt = new Date().toISOString();
    const matches = this.records
      .map((record) => ({ record, match: identityMatches(candidate, record) }))
      .filter(({ match }) => match.strength !== 'no_match');
    if (matches.length === 0) {
      return {
        workspaceId: candidate.workspaceId, candidateId: candidate.candidateId, providerKey: this.key,
        status: 'not_found', registryVerification: 'not_found', entityType: 'unknown',
        presence: 'credible_trading_presence', matches: [], evidence: [evidenceFact(this.key, 'No Companies House match was returned; this does not establish that the business is not real.', 'Companies House demo registry', checkedAt)], checkedAt,
      };
    }
    if (matches.length > 1) {
      return {
        workspaceId: candidate.workspaceId, candidateId: candidate.candidateId, providerKey: this.key,
        status: 'ambiguous', registryVerification: 'ambiguous', entityType: 'unknown', presence: 'credible_trading_presence',
        matches: matches.map(({ record, match }) => ({ companyNumber: record.companyNumber, registeredName: record.companyName, registeredAddress: record.registeredOfficeAddress, status: record.companyStatus, strength: match.strength, reasons: match.reasons })),
        evidence: [evidenceFact(this.key, 'Multiple plausible registry matches were found; no company was selected automatically.', 'Companies House demo registry', checkedAt)], checkedAt,
      };
    }
    const selected = matches[0];
    const verified = selected.match.strength === 'exact' || selected.match.strength === 'strong';
    return {
      workspaceId: candidate.workspaceId, candidateId: candidate.candidateId, providerKey: this.key,
      status: verified ? 'verified' : 'partially_verified', registryVerification: verified ? 'verified' : 'not_checked', entityType: 'incorporated_company',
      presence: 'registered_verified_business',
      matches: [{ companyNumber: selected.record.companyNumber, registeredName: selected.record.companyName, registeredAddress: selected.record.registeredOfficeAddress, status: selected.record.companyStatus, strength: selected.match.strength, reasons: selected.match.reasons }],
      evidence: [evidenceFact(this.key, `Registry match: ${selected.record.companyName} (${selected.record.companyNumber}).`, 'Companies House demo registry', checkedAt)], checkedAt,
    };
  }

  healthCheck(): boolean { return true; }
}

export class BusinessVerificationService implements VerificationRouter {
  constructor(private readonly provider: BusinessVerificationProvider) {}

  async verify(candidate: DiscoveryCandidate): Promise<BusinessVerificationResult> {
    if (candidate.countryCode.toUpperCase() !== 'GB') {
      return { workspaceId: candidate.workspaceId, candidateId: candidate.candidateId, providerKey: this.provider.key, status: 'not_applicable', registryVerification: 'not_checked', entityType: 'unknown', presence: 'insufficient_evidence', matches: [], evidence: [], checkedAt: new Date().toISOString() };
    }
    if (!this.provider.healthCheck()) {
      return { workspaceId: candidate.workspaceId, candidateId: candidate.candidateId, providerKey: this.provider.key, status: 'evidence_required', registryVerification: 'not_checked', entityType: 'unknown', presence: 'insufficient_evidence', matches: [], evidence: [], checkedAt: new Date().toISOString() };
    }
    return await this.provider.verify(candidate);
  }
}
