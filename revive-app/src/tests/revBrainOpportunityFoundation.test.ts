import assert from 'node:assert/strict';
import test from 'node:test';
import { assessOpportunity, deduplicateOpportunities, type Opportunity, type OrdinaryVocationalSummary } from '../services/revBrainOpportunityFoundation.ts';
const now = new Date('2026-10-19T12:00:00Z');
const profile: OrdinaryVocationalSummary = { employmentGoals: ['warehouse'], preferredSectors: ['Logistics'], skills: ['Forklift'], qualifications: [], preferredLocations: ['Birmingham'] };
const vacancy: Opportunity = { id: 'job-1', kind: 'employment_vacancy', name: 'Forklift operator', sector: 'Logistics', location: 'Birmingham', skills: ['forklift'], expiresAt: '2026-11-01', evidence: { sourceUrl: 'https://example.org/jobs/1', retrievedAt: '2026-10-18', state: 'verified' } };
test('matches ordinary vocational skills without using restricted answers', () => { const result = assessOpportunity(profile, vacancy, now); assert.equal(result.action, 'review_vacancy'); assert.ok(result.score! > 0); assert.ok(result.reasons.some(r => r.includes('forklift'))); });
test('expired vacancy is not eligible', () => { const result = assessOpportunity(profile, { ...vacancy, expiresAt: '2026-10-01' }, now); assert.equal(result.eligibleForReview, false); });
test('employer discovery does not imply a job', () => { const result = assessOpportunity(null, { ...vacancy, kind: 'employer_prospect' }, now); assert.equal(result.score, null); assert.match(result.reasons.join(' '), /no live vacancy/); });
test('sales leads are separate and unverified website status blocks qualification', () => { const result = assessOpportunity(null, { ...vacancy, kind: 'business_sales_prospect', websiteStatus: 'unknown' }, now); assert.equal(result.eligibleForReview, false); assert.equal(result.action, 'verify_evidence'); });
test('deduplication respects lead type', () => { assert.equal(deduplicateOpportunities([vacancy, vacancy, { ...vacancy, kind: 'employer_prospect' }]).length, 2); });

test('a supplied invalid expiry blocks review for every opportunity kind', () => {
  for (const kind of ['employment_vacancy', 'employer_prospect', 'business_sales_prospect'] as const) {
    for (const expiresAt of ['not-a-date', '2026-99-99', '2026-02-30', ' ']) {
      const result = assessOpportunity(profile, { ...vacancy, kind, expiresAt, websiteStatus: 'confirmed_missing' }, now);
      assert.equal(result.eligibleForReview, false, `${kind}: ${expiresAt}`);
      assert.equal(result.action, 'verify_evidence');
      assert.equal(result.score, null);
    }
  }
});

test('malformed source URLs are not verified evidence', () => {
  for (const sourceUrl of ['https://', 'https:// bad host/jobs', 'http://example.org/jobs/1']) {
    const result = assessOpportunity(profile, { ...vacancy, evidence: { ...vacancy.evidence, sourceUrl } }, now);
    assert.equal(result.eligibleForReview, false, sourceUrl);
    assert.equal(result.action, 'verify_evidence');
  }
});

test('an impossible retrieval date cannot be normalised into valid evidence', () => {
  const result = assessOpportunity(profile, { ...vacancy, evidence: { ...vacancy.evidence, retrievedAt: '2026-02-30' } }, now);
  assert.equal(result.eligibleForReview, false);
});

test('review fails closed when the supplied current time is invalid', () => {
  assert.equal(assessOpportunity(profile, vacancy, new Date('invalid')).eligibleForReview, false);
});

test('valid timestamp evidence and optional expiry retain prospect review behavior', () => {
  const result = assessOpportunity(null, {
    ...vacancy, kind: 'employer_prospect', expiresAt: undefined,
    evidence: { ...vacancy.evidence, retrievedAt: '2026-10-18T09:30:00+01:00' },
  }, now);
  assert.equal(result.eligibleForReview, true);
  assert.equal(result.action, 'review_employer');
  assert.equal(result.score, null);
});
