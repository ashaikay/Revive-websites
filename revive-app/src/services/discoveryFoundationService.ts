import { OpportunityRecord } from '@/domain/models';
import {
  CandidateConversionBoundary,
  ComplianceInput,
  ComplianceResult,
  CostDecision,
  DiscoveryCandidate,
  DiscoveryEvidence,
  DiscoveryProvider,
  DiscoveryRequest,
  DiscoveryResult,
  QualityResult,
  UsageBudget,
  UsageEvent,
} from '@/domain/discovery';
import { MockProspectDiscoveryProvider } from './prospectDiscoveryProvider';

export const FREE_PLAN_ALLOWANCE = 3;
export const PAID_PLAN_ALLOWANCE = 100;

export class InMemoryUsageLedger {
  private readonly events: UsageEvent[] = [];

  record(event: UsageEvent): UsageEvent {
    this.events.push(event);
    return event;
  }

  list(workspaceId: string): UsageEvent[] {
    return this.events.filter((event) => event.workspaceId === workspaceId);
  }

  used(workspaceId: string): number {
    return this.list(workspaceId).reduce((total, event) => total + event.units, 0);
  }
}

export class CostGovernor {
  constructor(private readonly ledger: InMemoryUsageLedger = new InMemoryUsageLedger()) {}

  budget(workspaceId: string, plan: 'free' | 'paid' = 'free'): UsageBudget {
    const allowance = plan === 'free' ? FREE_PLAN_ALLOWANCE : PAID_PLAN_ALLOWANCE;
    const used = this.ledger.used(workspaceId);
    return { plan, allowance, used, remaining: Math.max(allowance - used, 0) };
  }

  decide(workspaceId: string, units: number, budgetClass: DiscoveryRequest['budgetClass'], plan: 'free' | 'paid' = 'free'): CostDecision {
    if (budgetClass === 'premium' && plan === 'free') return 'require_upgrade';
    if (budgetClass === 'approval_required') return 'require_approval';
    return this.budget(workspaceId, plan).remaining >= units ? 'allow' : 'deny';
  }

  getUsageLedger(): InMemoryUsageLedger { return this.ledger; }
}

export class ProviderRegistry {
  constructor(private readonly providers: DiscoveryProvider[] = []) {}

  register(provider: DiscoveryProvider): void { this.providers.push(provider); }

  select(request: DiscoveryRequest): DiscoveryProvider | undefined {
    return this.providers.find((provider) =>
      provider.healthCheck() &&
      provider.supportedCountries.includes(request.countryCode.toUpperCase()) &&
      request.requiredCapabilities.every((capability) => provider.supportedCapabilities.includes(capability)),
    );
  }
}

export function normalizeCandidate(candidate: DiscoveryCandidate): DiscoveryCandidate {
  return {
    ...candidate,
    countryCode: candidate.countryCode.toUpperCase(),
    name: candidate.name.trim(),
    website: candidate.website?.trim(),
    metadata: { ...candidate.metadata },
    evidence: candidate.evidence.map((item) => ({ ...item })),
  };
}

function identityKey(candidate: DiscoveryCandidate): string {
  const website = candidate.website?.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
  return candidate.providerExternalId ? `${candidate.providerKey}:${candidate.providerExternalId}` : website ?? candidate.name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function deduplicateCandidates(candidates: DiscoveryCandidate[]): DiscoveryCandidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = identityKey(candidate);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export class DiscoveryQualityGate implements CandidateConversionBoundary {
  canConvert(candidate: DiscoveryCandidate, existingOpportunities: OpportunityRecord[]): QualityResult {
    const reasons: string[] = [];
    if (candidate.qualificationStatus === 'rejected' || candidate.qualificationStatus === 'converted') reasons.push('Candidate is not awaiting conversion.');
    if (!candidate.name || !candidate.countryCode) reasons.push('Business identity or geography is missing.');
    if (candidate.evidence.some((item) => item.evidenceType === 'evidence_required')) reasons.push('Additional evidence is required.');
    if (candidate.fitScore !== undefined && candidate.fitScore < 0.5) reasons.push('Fit score is below the review threshold.');
    if (existingOpportunities.some((opportunity) => opportunity.title.toLowerCase().includes(candidate.name.toLowerCase()))) reasons.push('A matching Opportunity already exists.');
    return { eligible: reasons.length === 0, reasons };
  }
}

export function evaluateCompliance(input: ComplianceInput): ComplianceResult {
  if (input.suppressed) return { decision: 'blocked', reason: 'Contact is suppressed.' };
  if (!input.candidateCountryCode || !input.provenance) return { decision: 'insufficient_information', reason: 'Jurisdiction or provenance evidence is incomplete.' };
  if (input.channel && input.consentStatus !== 'known') return { decision: 'review_required', reason: 'Channel consent evidence requires review.' };
  return { decision: 'allowed', reason: 'Discovery provenance and jurisdiction are present for review.' };
}

export class DiscoveryRouter {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly governor: CostGovernor = new CostGovernor(),
    private readonly plan: 'free' | 'paid' = 'free',
  ) {}

  discover(request: DiscoveryRequest): DiscoveryResult {
    if (!request.workspaceId || !request.requestedBy || !request.countryCode || request.maximumCandidates < 1) {
      throw new Error('Discovery request has an invalid workspace, actor, country, or candidate limit.');
    }
    const provider = this.registry.select(request);
    if (!provider) return { candidates: [], estimatedCost: 0, actualCost: 0, warnings: ['No healthy provider supports this capability and country.'], budgetState: this.governor.budget(request.workspaceId, this.plan) };
    const estimate = provider.estimateCost(request);
    const decision = this.governor.decide(request.workspaceId, estimate.units, estimate.budgetClass, this.plan);
    if (decision !== 'allow') return { candidates: [], estimatedCost: estimate.estimatedCost, actualCost: 0, warnings: [`Discovery ${decision.replace('_', ' ')}.`], budgetState: this.governor.budget(request.workspaceId, this.plan) };
    const candidates = deduplicateCandidates(provider.discover(request).map(normalizeCandidate)).slice(0, request.maximumCandidates);
    const event: UsageEvent = { workspaceId: request.workspaceId, providerKey: provider.key, operation: 'discovery', units: estimate.units, estimatedCost: estimate.estimatedCost, actualCost: estimate.estimatedCost, timestamp: new Date().toISOString(), correlationId: `${provider.key}-${Date.now()}` };
    this.governor.getUsageLedger().record(event);
    return { candidates, providerKey: provider.key, estimatedCost: estimate.estimatedCost, actualCost: estimate.estimatedCost, warnings: [], budgetState: this.governor.budget(request.workspaceId, this.plan) };
  }
}

export function createMockDiscoveryRouter(plan: 'free' | 'paid' = 'free'): DiscoveryRouter {
  const provider = new MockBusinessDiscoveryProvider();
  return new DiscoveryRouter(new ProviderRegistry([provider]), new CostGovernor(), plan);
}

export class MockBusinessDiscoveryProvider implements DiscoveryProvider {
  private readonly source = new MockProspectDiscoveryProvider();
  readonly key = 'mock-business-discovery';
  readonly displayName = 'REV demo discovery';
  readonly supportedCountries = ['GB'];
  readonly supportedCapabilities = ['business_discovery' as const];

  estimateCost(): { units: number; estimatedCost: number; budgetClass: 'included' } { return { units: 1, estimatedCost: 0, budgetClass: 'included' }; }

  discover(request: DiscoveryRequest): DiscoveryCandidate[] {
    return this.source.discover(request.workspaceId).map((candidate) => ({
      candidateId: candidate.id,
      workspaceId: request.workspaceId,
      providerKey: this.key,
      providerExternalId: `mock-${candidate.id}`,
      name: candidate.company ?? candidate.name,
      website: `https://${candidate.id}.example.test`,
      location: request.location ?? 'United Kingdom',
      countryCode: 'GB',
      businessCategory: request.businessType ?? 'professional services',
      candidateType: 'business',
      source: candidate.source,
      sourceUrl: 'https://example.test/demo-evidence',
      discoveredAt: candidate.discoveredAt,
      evidence: candidate.evidence.map((summary): DiscoveryEvidence => ({ evidenceType: summary.includes('only') ? 'evidence_required' : 'fact', source: 'mock-evidence', sourceUrl: 'https://example.test/demo-evidence', summary, observedAt: candidate.discoveredAt, confidence: 0.8, providerKey: this.key })),
      fitScore: Object.values(candidate.fitScore).reduce((total, value) => total + value, 0) / 5,
      qualificationStatus: 'discovered',
      estimatedEnrichmentCost: 0,
      metadata: { demo: true, retention: 'provider-demo-only' },
    }));
  }

  healthCheck(): boolean { return true; }
}
