import React, { useMemo, useState } from 'react';
import { WorkspaceService } from '@/services/workspaceService';
import { ContactService } from '@/services/contactService';
import { OutreachService } from '@/services/outreachService';
import { createMockDiscoveryRouter, DiscoveryQualityGate } from '@/services/discoveryFoundationService';
import { buildCommercialPlan } from '@/services/commercialIntelligenceService';
import { analyzeRecovery } from '@/services/recoveryService';
import { CommercialActionService } from '@/services/commercialActionService';
import {
  OPPORTUNITY_SOURCE_LABEL,
  OPPORTUNITY_STAGE_LABEL,
  OpportunityService,
  buildOpportunityAttentionItems,
  computeOpportunityRevenue,
  summarizeOpportunityAttribution,
} from '@/services/opportunityService';
import { dataProviderMode } from '@/data/provider';
import { ContactRecord, OpportunityRecord } from '@/domain/models';
import { DiscoveryCandidate, DiscoveryRequest } from '@/domain/discovery';

interface GrowthAreaProps {
  workspaceId: string;
}

const currency = (value: number) =>
  value.toLocaleString('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 });

const ATTRIBUTION_LABEL: Record<string, string> = {
  owner_generated: 'Owner generated',
  rev_generated: 'REV generated',
  rev_assisted: 'REV assisted',
  rev_recovered: 'REV recovered',
  unattributed: 'Unattributed',
};

export const GrowthArea: React.FC<GrowthAreaProps> = ({ workspaceId }) => {
  if (dataProviderMode === 'supabase') return <LiveGrowthArea />;
  return <MockGrowthArea workspaceId={workspaceId} />;
};

const MockGrowthArea: React.FC<GrowthAreaProps> = ({ workspaceId }) => {
  const provider = useMemo(() => WorkspaceService.getDataProvider(), []);
  const contactService = useMemo(() => new ContactService(provider), [provider]);
  const opportunityService = useMemo(() => new OpportunityService(provider), [provider]);
  const outreachService = useMemo(() => new OutreachService(provider), [provider]);
  const commercialActionService = useMemo(() => new CommercialActionService(provider), [provider]);
  const discoveryRouter = useMemo(() => createMockDiscoveryRouter(), []);
  const qualityGate = useMemo(() => new DiscoveryQualityGate(), []);
  const [, setVersion] = useState(0);
  const [engagedCandidateIds, setEngagedCandidateIds] = useState<string[]>([]);
  const [qualifiedCandidateIds, setQualifiedCandidateIds] = useState<string[]>([]);
  const [proposedRecommendationIds, setProposedRecommendationIds] = useState<string[]>([]);

  const contacts: ContactRecord[] = contactService.list(workspaceId);
  const opportunities: OpportunityRecord[] = opportunityService.list(workspaceId);
  const profile = provider.business.getProfile(workspaceId);
  const goal = provider.goals.list(workspaceId).find((item) => item.status === 'active');
  const discoveryRequest: DiscoveryRequest = {
    workspaceId,
    requestedBy: 'rev-demo',
    objective: 'Find businesses that may benefit from the active service offer.',
    businessType: 'professional services',
    location: 'United Kingdom',
    countryCode: 'GB',
    maximumCandidates: 10,
    requiredCapabilities: ['business_discovery'],
    budgetClass: 'included',
    createdAt: '2026-09-14T00:00:00.000Z',
  };
  const discoveryResult = useMemo(() => discoveryRouter.discover(discoveryRequest), [discoveryRouter, workspaceId]);
  const candidates: DiscoveryCandidate[] = discoveryResult.candidates.filter((candidate) => !engagedCandidateIds.includes(candidate.candidateId));
  const commercialPlan = buildCommercialPlan({ workspaceId, goal, profile, services: provider.business.listServices(workspaceId), contacts, opportunities, discoveryCandidates: discoveryResult.candidates });
  const recoveryAnalysis = analyzeRecovery({ workspaceId, goal, profile, services: provider.business.listServices(workspaceId), contacts, opportunities, discoveryCandidates: discoveryResult.candidates });

  const revenue = computeOpportunityRevenue(opportunities);
  const attention = buildOpportunityAttentionItems(opportunities);
  const attribution = summarizeOpportunityAttribution(opportunities);
  const sourceCounts = Object.entries(OPPORTUNITY_SOURCE_LABEL).map(([key, label]) => ({
    key,
    label,
    count: opportunities.filter((o) => o.source === key).length,
  }));

  const contactFor = (contactId: string) => contacts.find((c) => c.id === contactId);

  const handlePrepareOutreach = (candidate: DiscoveryCandidate) => {
    if (!qualifiedCandidateIds.includes(candidate.candidateId) || !qualityGate.canConvert(candidate, opportunities).eligible) return;
    const timestamp = new Date().toISOString();
    const contact = contactService.create({
      workspaceId,
      lifecycle: 'prospect',
      name: candidate.name,
      company: candidate.name,
      source: candidate.source,
      lastInteractionAt: timestamp,
    });
    const opportunity = provider.opportunities.save({
      id: `opportunity-${Date.now()}`,
      workspaceId,
      contactId: contact.id,
      title: `${candidate.name} — new opportunity`,
      description: `Discovery provenance: ${candidate.providerKey}/${candidate.providerExternalId ?? 'no external id'}; ${candidate.evidence.map((item) => `${item.evidenceType}: ${item.summary}`).join(' | ')}`,
      opportunityType: 'commercial_lead',
      stage: 'new',
      source: candidate.source,
      currency: 'GBP',
      attribution: 'rev_generated',
      createdByType: 'rev',
      createdAt: timestamp,
      updatedAt: timestamp,
      lastActivityAt: timestamp,
    });
    outreachService.prepareDraft(workspaceId, opportunity, contact, candidate.evidence.map((item) => item.summary).join(' '));
    setEngagedCandidateIds((prev) => [...prev, candidate.candidateId]);
    setVersion((v) => v + 1);
  };

  const handleReviewAction = (recommendation: (typeof commercialPlan.recommendations)[number]) => {
    commercialActionService.propose(recommendation);
    setProposedRecommendationIds((previous) => previous.includes(recommendation.id) ? previous : [...previous, recommendation.id]);
    window.location.hash = 'rev';
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
      {/* Growth summary */}
      <section className="order-2 sm:order-1 rev-motion-in">
        <h1 className="text-3xl font-bold text-neutral-900 mb-1">GROWTH</h1>
        <p className="text-neutral-600">Where your money is, what could be won, and what REV can help recover.</p>
      </section>

      <section aria-labelledby="plan-heading" className="order-1 sm:order-2 rev-motion-in">
        <h2 id="plan-heading" className="text-xl font-bold text-neutral-900 mb-4">REV'S PLAN</h2>
        <div className="card p-4 bg-primary-50 border-primary-200">
          <p className="text-sm text-primary-900"><strong>Your goal:</strong> {commercialPlan.goalSummary}</p>
          {commercialPlan.recommendations.length > 0 ? (
            <ol className="mt-3 space-y-3">
              {commercialPlan.recommendations.slice(0, 3).map((recommendation) => (
                <li key={recommendation.id} className="border-t border-primary-200 pt-3 first:border-t-0 first:pt-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium text-primary-950">{recommendation.rank}. {recommendation.title}</p>
                    <span className="badge-neutral">{recommendation.route.toUpperCase()} · {recommendation.priorityScore}/100</span>
                  </div>
                  <p className="text-sm text-primary-900 mt-1">{recommendation.whatRevFound}</p>
                  <p className="text-xs text-primary-800 mt-1"><strong>Why this order:</strong> {recommendation.whyItMatters}</p>
                  <p className="text-xs text-primary-800 mt-1">Potential value: {recommendation.potentialValue > 0 ? currency(recommendation.potentialValue) : 'Not yet assessed'} · Approval required</p>
                  <button className="btn-primary text-sm mt-2" type="button" onClick={() => handleReviewAction(recommendation)}>
                    {proposedRecommendationIds.includes(recommendation.id) ? 'Review in REV' : 'Review Action'}
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-primary-800 mt-3">REV needs more Business Brain evidence before recommending a route.</p>
          )}
          <p className="text-xs text-primary-700 mt-3">Recommendations are estimates based on recorded evidence. REV will not execute anything automatically.</p>
        </div>
      </section>

      <section aria-labelledby="money-found-heading" className="order-2 sm:order-3 rev-motion-in">
        <h2 id="money-found-heading" className="text-xl font-bold text-neutral-900 mb-4">MONEY REV FOUND</h2>
        <div className="card p-4 border-amber-200 bg-amber-50">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-bold text-amber-800">{recoveryAnalysis.potentialValue > 0 ? currency(recoveryAnalysis.potentialValue) : 'Not yet assessed'}</p>
              <p className="text-sm text-amber-900">Potential recoverable value</p>
            </div>
            <span className="badge-neutral">{recoveryAnalysis.candidates.length} supported signal{recoveryAnalysis.candidates.length === 1 ? '' : 's'}</span>
          </div>
          {recoveryAnalysis.candidates[0] ? (
            <div className="mt-3 border-t border-amber-200 pt-3">
              <p className="font-medium text-amber-950">Top priority: {recoveryAnalysis.candidates[0].reason}</p>
              <p className="text-sm text-amber-900 mt-1">Why REV flagged this: {recoveryAnalysis.candidates[0].evidence[0].summary}</p>
              <p className="text-xs text-amber-800 mt-1">Potential value is not Won Revenue and no outreach is prepared automatically.</p>
            </div>
          ) : (
            <p className="text-sm text-amber-900 mt-3">REV found no supported recovery opportunities yet.</p>
          )}
        </div>
      </section>

      {/* Revenue intelligence */}
      <section aria-labelledby="revenue-heading" className="order-3 sm:order-4 rev-motion-in">
        <h2 id="revenue-heading" className="text-xl font-bold text-neutral-900 mb-4">
          REVENUE INTELLIGENCE
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MoneyStat label="WON REVENUE" value={revenue.won} tone="success" />
          <MoneyStat label="IN PIPELINE" value={revenue.pipeline} tone="neutral" />
          <MoneyStat label="AT RISK" value={revenue.atRisk} tone="danger" />
          <MoneyStat label="RECOVERABLE" value={revenue.recoverable} tone="warning" />
          <MoneyStat label="REV GENERATED" value={revenue.revGenerated} tone="success" />
          <MoneyStat label="REV RECOVERED" value={revenue.revRecovered} tone="success" />
        </div>
      </section>

      {/* Opportunity pipeline */}
      <section aria-labelledby="pipeline-heading" className="order-5 sm:order-3 rev-motion-in">
        <h2 id="pipeline-heading" className="text-xl font-bold text-neutral-900 mb-4">
          OPPORTUNITY PIPELINE
        </h2>
        {opportunities.length > 0 ? (
          <ul className="card divide-y divide-neutral-100">
            {opportunities.map((opportunity) => {
              const contact = contactFor(opportunity.contactId);
              return (
                <li key={opportunity.id} className="p-4 flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-neutral-900">{opportunity.title}</p>
                    {contact && <p className="text-sm text-neutral-600">{contact.name}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="badge-neutral">{OPPORTUNITY_STAGE_LABEL[opportunity.stage]}</span>
                    {typeof opportunity.estimatedValue === 'number' && (
                      <span className="text-sm font-semibold text-neutral-900">{currency(opportunity.estimatedValue)}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="card p-6 text-center text-neutral-600">No opportunities recorded for this workspace yet.</div>
        )}
        <p className="text-xs text-neutral-500 mt-2">
          Opportunities are distinct from Customers records: a contact may have several opportunities over time. Conversation,
          Appointment, and Quote stages require future dedicated records — see the Phase 3E notes for the proposed schema.
        </p>
      </section>

      {/* Prospect discovery (mock only) */}
      <section aria-labelledby="discovery-heading" className="order-6 sm:order-4 rev-motion-in">
        <h2 id="discovery-heading" className="text-xl font-bold text-neutral-900 mb-4">
          PROSPECT DISCOVERY
        </h2>
        {candidates.length > 0 ? (
          <div className="space-y-3">
            {candidates.map((candidate) => {
              const overall = candidate.fitScore === undefined ? null : Math.round(candidate.fitScore * 100);
              const qualified = qualifiedCandidateIds.includes(candidate.candidateId);
              return (
                <div key={candidate.candidateId} className="card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-neutral-900">{candidate.name}</p>
                      {candidate.location && <p className="text-sm text-neutral-600">{candidate.location}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      {overall !== null && <span className="badge-neutral">Fit score: {overall}%</span>}
                      <span className="badge-neutral">{qualified ? 'Qualified' : 'Discovered'}</span>
                    </div>
                  </div>
                  <p className="text-sm text-neutral-700 mt-2">
                    <strong>Why REV found them:</strong> {candidate.metadata.demo ? 'Matches the current demo growth objective and target market.' : 'Provider evidence matched the request.'}
                  </p>
                  <p className="text-sm text-neutral-700 mt-1">
                    <strong>Why they may be relevant:</strong> {candidate.businessCategory} opportunity signal; review the evidence before creating commercial work.
                  </p>
                  <ul className="text-xs text-neutral-500 mt-2 list-disc list-inside">
                    {candidate.evidence.map((item, index) => (
                      <li key={index}>{item.evidenceType.toUpperCase()}: {item.summary}</li>
                    ))}
                  </ul>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button className="btn-secondary text-sm" type="button" onClick={() => setQualifiedCandidateIds((previous) => previous.includes(candidate.candidateId) ? previous : [...previous, candidate.candidateId])}>
                      {qualified ? 'Reviewed' : 'Review'}
                    </button>
                    <button className="btn-secondary text-sm" type="button" onClick={() => setQualifiedCandidateIds((previous) => previous.includes(candidate.candidateId) ? previous : [...previous, candidate.candidateId])}>
                      Qualify
                    </button>
                    <button className="btn-primary text-sm" type="button" disabled={!qualified || !qualityGate.canConvert(candidate, opportunities).eligible} onClick={() => handlePrepareOutreach(candidate)}>
                      Prepare outreach
                    </button>
                    <button className="btn-secondary text-sm" type="button" onClick={() => setEngagedCandidateIds((previous) => [...previous, candidate.candidateId])}>
                      Dismiss
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="card p-6 text-center text-neutral-600">No new prospects discovered right now.</div>
        )}
        <p className="text-xs text-neutral-500 mt-2">Demo provider only. Included discovery credit used: {discoveryResult.budgetState.used}; no live or unrestricted discovery is connected.</p>
      </section>

      {/* Money requiring attention */}
      <section aria-labelledby="attention-heading" className="order-1 sm:order-5 rev-motion-in">
        <h2 id="attention-heading" className="text-xl font-bold text-neutral-900 mb-4">
          MONEY REQUIRING ATTENTION
        </h2>
        {attention.length > 0 ? (
          <ul className="card divide-y divide-neutral-100">
            {attention.map((item, index) => (
              <li key={`${item.opportunityId}-${index}`} className="p-4">
                <p className="font-medium text-neutral-900">{item.title}</p>
                <p className="text-sm text-neutral-600 mt-1">{item.reason}</p>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card p-6 text-center text-neutral-600">Nothing requires attention right now.</div>
        )}
      </section>

      {/* REV growth recommendations */}
      <section aria-labelledby="recommendations-heading" className="order-3 sm:order-6 rev-motion-in">
        <h2 id="recommendations-heading" className="text-xl font-bold text-neutral-900 mb-4">
          REV GROWTH RECOMMENDATIONS
        </h2>
        {attention.length > 0 ? (
          <div className="card p-4 bg-primary-50 border-primary-200">
            <p className="text-primary-900 font-medium">
              {attention.length} opportunit{attention.length === 1 ? 'y needs' : 'ies need'} attention.
            </p>
            <p className="text-sm text-primary-800 mt-1">
              Opportunities without recent activity are more likely to stall or be lost to a competitor.
            </p>
            <p className="text-sm text-primary-800 mt-1">
              <strong>REV recommends:</strong> Ask REV to prepare a follow-up for each flagged opportunity.
            </p>
            <p className="text-xs text-primary-700 mt-1">REV will draft follow-ups for your approval; nothing is sent automatically.</p>
          </div>
        ) : (
          <div className="card p-6 text-center text-neutral-600">REV has no growth recommendations right now.</div>
        )}
      </section>

      {/* Sources / attribution */}
      <section aria-labelledby="attribution-heading" className="order-7 sm:order-7 rev-motion-in">
        <h2 id="attribution-heading" className="text-xl font-bold text-neutral-900 mb-4">
          SOURCES &amp; ATTRIBUTION
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card p-4">
            <h3 className="font-semibold text-neutral-900 mb-2">Attribution</h3>
            <ul className="space-y-2">
              {attribution.map((row) => (
                <li key={row.category} className="flex justify-between text-sm">
                  <span className="text-neutral-700">{ATTRIBUTION_LABEL[row.category]}</span>
                  <span className="text-neutral-900 font-medium">
                    {row.count} · {row.value > 0 ? currency(row.value) : '—'}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-neutral-500 mt-2">REV only receives credit where recorded evidence supports it.</p>
          </div>
          <div className="card p-4">
            <h3 className="font-semibold text-neutral-900 mb-2">Opportunity sources</h3>
            <ul className="space-y-1 text-sm">
              {sourceCounts.map((row) => (
                <li key={row.key} className="flex justify-between">
                  <span className="text-neutral-700">{row.label}</span>
                  <span className="text-neutral-900 font-medium">{row.count}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-neutral-500 mt-2">Prepared for Phase 3E+ opportunity discovery; not all sources are active yet.</p>
          </div>
        </div>
      </section>

      {/* Bid / grant opportunities */}
      <section aria-labelledby="bids-heading" className="order-8 sm:order-8 rev-motion-in">
        <h2 id="bids-heading" className="text-xl font-bold text-neutral-900 mb-4">
          BID &amp; GRANT OPPORTUNITIES
        </h2>
        <div className="card p-4 border-dashed border-2 border-neutral-300">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Example concept — not a real opportunity</p>
          <p className="font-medium text-neutral-900 mt-1">Tender opportunity</p>
          <div className="text-sm text-neutral-600 mt-1 space-y-0.5">
            <p>Potential value: Not yet assessed</p>
            <p>Fit: Not yet assessed</p>
            <p>Deadline: —</p>
            <p>Evidence status: —</p>
          </div>
          <p className="text-xs text-neutral-500 mt-2">Bid/Grant Writer discovery is not implemented yet.</p>
        </div>
      </section>

      {/* Recent commercial outcomes */}
      <section aria-labelledby="outcomes-heading" className="order-9 sm:order-9 rev-motion-in">
        <h2 id="outcomes-heading" className="text-xl font-bold text-neutral-900 mb-4">
          RECENT COMMERCIAL OUTCOMES
        </h2>
        <div className="card p-6 text-center text-neutral-600">No recent commercial outcomes recorded yet.</div>
      </section>
    </div>
  );
};

const MoneyStat: React.FC<{ label: string; value: number; tone: 'success' | 'neutral' | 'danger' | 'warning' }> = ({
  label,
  value,
  tone,
}) => {
  const toneClass =
    tone === 'success'
      ? 'text-green-700'
      : tone === 'danger'
        ? 'text-red-700'
        : tone === 'warning'
          ? 'text-amber-700'
          : 'text-neutral-900';
  return (
    <div className="card p-4">
      <div className={`text-2xl font-bold ${toneClass}`}>{value > 0 ? currency(value) : '—'}</div>
      <div className="text-sm text-neutral-600">{label}</div>
    </div>
  );
};

/**
 * Live (Supabase) mode GROWTH. Contacts/opportunities are not yet connected to live
 * workspace data per Phase 2D.2 scope, so every section shows an honest empty state.
 */
const LiveGrowthArea: React.FC = () => (
  <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex flex-col gap-8">
    <section className="rev-motion-in">
      <h1 className="text-3xl font-bold text-neutral-900 mb-1">GROWTH</h1>
      <p className="text-neutral-600">Commercial intelligence is not yet connected to live workspace data.</p>
    </section>
    <LiveEmptySection title="MONEY REQUIRING ATTENTION" message="Not connected in live mode." />
    <LiveEmptySection title="MONEY REV FOUND" message="Not connected in live mode." />
    <LiveEmptySection title="REVENUE INTELLIGENCE" message="Not connected in live mode." />
    <LiveEmptySection title="OPPORTUNITY PIPELINE" message="Not connected in live mode." />
    <LiveEmptySection title="REV GROWTH RECOMMENDATIONS" message="Not connected in live mode." />
    <LiveEmptySection title="SOURCES & ATTRIBUTION" message="Not connected in live mode." />
    <LiveEmptySection title="BID & GRANT OPPORTUNITIES" message="Not connected in live mode." />
    <LiveEmptySection title="RECENT COMMERCIAL OUTCOMES" message="Not connected in live mode." />
  </div>
);

const LiveEmptySection: React.FC<{ title: string; message: string }> = ({ title, message }) => (
  <section className="rev-motion-in">
    <h2 className="text-xl font-bold text-neutral-900 mb-4">{title}</h2>
    <div className="card p-6 text-center text-neutral-600">{message}</div>
  </section>
);
