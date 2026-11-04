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
const safeTime = (v: string) => {
  const time = Date.parse(v);
  if (!Number.isFinite(time)) return null;
  // Date.parse otherwise silently rolls dates such as February 30 into March.
  const calendarDate = /^(\d{4}-\d{2}-\d{2})(?:T|$)/.exec(v)?.[1];
  if (calendarDate) {
    const midnight = Date.parse(`${calendarDate}T00:00:00.000Z`);
    if (!Number.isFinite(midnight) || new Date(midnight).toISOString().slice(0, 10) !== calendarDate) return null;
  }
  return time;
};
const isHttpsSource = (value: string) => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && Boolean(url.hostname);
  } catch { return false; }
};
export function assessOpportunity(profile: OrdinaryVocationalSummary | null, opportunity: Opportunity, now = new Date()): OpportunityAssessment {
  const needsReview: string[] = [];
  const reasons: string[] = [];
  const retrieved = safeTime(opportunity.evidence.retrievedAt);
  const expired = opportunity.expiresAt === undefined ? null : safeTime(opportunity.expiresAt);
  if (!Number.isFinite(now.getTime()) || opportunity.evidence.state !== 'verified' || !isHttpsSource(opportunity.evidence.sourceUrl)
    || retrieved === null || retrieved > now.getTime()
    || (opportunity.expiresAt !== undefined && expired === null)
    || (expired !== null && expired <= now.getTime())) {
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

/** Opportunity source: a job already recorded in the Service user's programme. External vacancy search is not implemented. */
export interface ProgrammeVacancyOpportunity {
  source: { kind: 'programme_vacancy'; vacancyId: string; recordVersion: number; updatedAt: string };
  title: string; employerName: string; employerSector: string | null; workArea: string | null;
  requiredSkills: string[]; desiredSkills: string[];
}
export type ProfileField = 'skills' | 'qualifications' | 'preferredSectors' | 'preferredLocations';
export interface SupportedMatch { requirement: string; requirementType: 'Required skill' | 'Helpful skill' | 'Sector' | 'Work area'; profileField: ProfileField }
export interface EvidenceGap { requirement: string; requirementType: 'Required skill' | 'Helpful skill' }
/** Review-only reasoning. There is deliberately no score: counts describe recorded evidence, not a likelihood of employment. */
export interface ProgrammeVacancyReview {
  vacancyId: string;
  supportedMatches: SupportedMatch[];
  missingEvidence: EvidenceGap[];
  uncertainty: string[];
  proposedNextSteps: string[];
  requiredEvidenced: number;
  requiredTotal: number;
}
export function reviewProgrammeVacancy(profile: OrdinaryVocationalSummary, vacancy: ProgrammeVacancyOpportunity): ProgrammeVacancyReview {
  const supportedMatches: SupportedMatch[] = [];
  const missingEvidence: EvidenceGap[] = [];
  const uncertainty: string[] = [];
  const evidenceFor = (term: string): ProfileField | null =>
    overlap(profile.skills, [term]).length ? 'skills' : overlap(profile.qualifications, [term]).length ? 'qualifications' : null;
  const required = [...new Set(vacancy.requiredSkills.map(v => v.trim()).filter(Boolean))];
  const desired = [...new Set(vacancy.desiredSkills.map(v => v.trim()).filter(Boolean))].filter(v => !overlap(required, [v]).length);
  let requiredEvidenced = 0;
  for (const requirement of required) {
    const field = evidenceFor(requirement);
    if (field) { requiredEvidenced += 1; supportedMatches.push({ requirement, requirementType: 'Required skill', profileField: field }); }
    else missingEvidence.push({ requirement, requirementType: 'Required skill' });
  }
  for (const requirement of desired) {
    const field = evidenceFor(requirement);
    if (field) supportedMatches.push({ requirement, requirementType: 'Helpful skill', profileField: field });
    else missingEvidence.push({ requirement, requirementType: 'Helpful skill' });
  }
  if (!required.length) uncertainty.push('No required skills are listed for this job, so it cannot be checked against them.');
  if (!vacancy.employerSector) uncertainty.push('The employer sector is not recorded.');
  else if (overlap(profile.preferredSectors, [vacancy.employerSector]).length) supportedMatches.push({ requirement: vacancy.employerSector, requirementType: 'Sector', profileField: 'preferredSectors' });
  else if (!profile.preferredSectors.length) uncertainty.push('Preferred-sector evidence is unavailable to matching.');
  else uncertainty.push(`The employer sector (${vacancy.employerSector}) is not one of the recorded preferred sectors; check the Service user's interest.`);
  if (!vacancy.workArea) uncertainty.push('The work area is not recorded for this job.');
  else if (overlap(profile.preferredLocations, [vacancy.workArea]).length) supportedMatches.push({ requirement: vacancy.workArea, requirementType: 'Work area', profileField: 'preferredLocations' });
  else uncertainty.push(`Travel to ${vacancy.workArea} has not been assessed.`);
  const missingRequired = missingEvidence.filter(gap => gap.requirementType === 'Required skill').map(gap => gap.requirement);
  const proposedNextSteps = ['Discuss this job with the Service user and confirm whether they want to pursue it.'];
  if (missingRequired.length) proposedNextSteps.push(`Check evidence for ${missingRequired.join(', ')}. It may exist but is unavailable to matching.`);
  if (vacancy.workArea && !supportedMatches.some(match => match.requirementType === 'Work area')) proposedNextSteps.push(`Check travel to ${vacancy.workArea}.`);
  proposedNextSteps.push('If the Service user chooses to pursue it, record the agreed steps in the employment action plan.');
  return { vacancyId: vacancy.source.vacancyId, supportedMatches, missingEvidence, uncertainty, proposedNextSteps, requiredEvidenced, requiredTotal: required.length };
}
