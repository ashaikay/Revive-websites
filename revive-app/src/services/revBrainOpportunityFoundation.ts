/** REV Stage 3: pure, review-only opportunity reasoning. No network calls, database writes or email sending. */
export type EvidenceState = 'verified' | 'unverified' | 'expired';
export type OpportunityKind = 'employment_vacancy' | 'employer_prospect' | 'business_sales_prospect';
export interface Evidence { sourceUrl: string; retrievedAt: string; state: EvidenceState; notes?: string }
export interface Opportunity {
  id: string; kind: OpportunityKind; name: string; location?: string;
  sector?: string; skills?: string[]; qualifications?: string[];
  evidence: Evidence; expiresAt?: string; websiteStatus?: 'confirmed_missing' | 'confirmed_present' | 'unknown';
}
/** Caller MUST fetch authorised ordinary-only vocational answers server-side. Never pass raw assessment records. */
export interface OrdinaryVocationalSummary {
  employmentGoals: string[]; preferredSectors: string[]; skills: string[];
  qualifications: string[]; preferredLocations: string[];
}
export interface OpportunityAssessment {
  opportunityId: string; kind: OpportunityKind; eligibleForReview: boolean;
  score: number | null; reasons: string[]; needsReview: string[];
  action: 'review_vacancy' | 'review_employer' | 'review_sales_lead' | 'verify_evidence';
}
const norm = (v: string) => v.trim().toLocaleLowerCase('en-GB');
const overlap = (a: string[], b: string[]) => {
  const available = new Set(a.map(norm).filter(Boolean));
  return [...new Set(b.map(norm).filter(Boolean))].filter(x => available.has(x));
};
const safeTime = (v: string) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
export function assessOpportunity(profile: OrdinaryVocationalSummary | null, opportunity: Opportunity, now = new Date()): OpportunityAssessment {
  const needsReview: string[] = [];
  const reasons: string[] = [];
  const retrieved = safeTime(opportunity.evidence.retrievedAt);
  const expired = opportunity.expiresAt ? safeTime(opportunity.expiresAt) : null;
  if (opportunity.evidence.state !== 'verified' || !opportunity.evidence.sourceUrl.startsWith('https://') || retrieved === null || retrieved > now.getTime() || (expired !== null && expired <= now.getTime())) {
    needsReview.push('Source evidence must be verified, dated and current.');
  }
  if (opportunity.kind === 'business_sales_prospect') {
    if (opportunity.websiteStatus !== 'confirmed_missing') needsReview.push('Website need is not independently confirmed.');
    if (needsReview.length === 0) reasons.push('Business website need has supporting evidence; human qualification remains required.');
    return { opportunityId: opportunity.id, kind: opportunity.kind, eligibleForReview: needsReview.length === 0, score: null, reasons, needsReview, action: needsReview.length ? 'verify_evidence' : 'review_sales_lead' };
  }
  if (opportunity.kind === 'employer_prospect') {
    reasons.push('Potential employer only; no live vacancy has been established.');
    return { opportunityId: opportunity.id, kind: opportunity.kind, eligibleForReview: needsReview.length === 0, score: null, reasons, needsReview, action: needsReview.length ? 'verify_evidence' : 'review_employer' };
  }
  if (!profile) needsReview.push('An authorised ordinary-only vocational summary is required.');
  if (!opportunity.expiresAt) needsReview.push('Vacancy closing/expiry date is not confirmed.');
  if (!opportunity.location) needsReview.push('Work location is not confirmed.');
  if (!profile || needsReview.length) return { opportunityId: opportunity.id, kind: opportunity.kind, eligibleForReview: false, score: null, reasons, needsReview, action: 'verify_evidence' };
  const matchedSkills = overlap(profile.skills, opportunity.skills ?? []);
  const matchedQualifications = overlap(profile.qualifications, opportunity.qualifications ?? []);
  const matchedSectors = overlap(profile.preferredSectors, opportunity.sector ? [opportunity.sector] : []);
  const matchedLocations = overlap(profile.preferredLocations, opportunity.location ? [opportunity.location] : []);
  if (matchedSkills.length) reasons.push(`Matching skills: ${matchedSkills.join(', ')}.`);
  if (matchedQualifications.length) reasons.push(`Matching qualifications: ${matchedQualifications.join(', ')}.`);
  if (matchedSectors.length) reasons.push(`Preferred sector: ${matchedSectors.join(', ')}.`);
  if (matchedLocations.length) reasons.push(`Preferred location: ${matchedLocations.join(', ')}.`);
  if (!matchedLocations.length) needsReview.push('Travel distance and contract geography need adviser verification.');
  const score = Math.min(100, matchedSkills.length * 15 + matchedQualifications.length * 15 + matchedSectors.length * 20 + matchedLocations.length * 20);
  return { opportunityId: opportunity.id, kind: opportunity.kind, eligibleForReview: true, score, reasons, needsReview, action: 'review_vacancy' };
}
export function deduplicateOpportunities(items: Opportunity[]): Opportunity[] {
  const seen = new Set<string>();
  return items.filter(item => {
    const key = `${item.kind}|${norm(item.id)}`;
    if (!item.id.trim() || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
