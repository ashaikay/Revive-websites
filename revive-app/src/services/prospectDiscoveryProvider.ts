import { FitScoreBreakdown, ProspectCandidate } from '@/domain/models';

/**
 * Boundary for future approved prospect-discovery data sources (business directories, approved
 * search providers, imported lists, tender/grant portals, partner referrals, etc). Phase 3E adds
 * no unrestricted scraping and no live discovery — only this interface plus a mock implementation
 * that clearly demonstrates the shape of a real candidate for development/demo purposes.
 */
export interface ProspectDiscoveryProvider {
  discover(workspaceId: string): ProspectCandidate[];
}

/** Transparent 0-1 overall score averaged from named criteria; never a bare AI confidence number. */
export function computeFitScoreOverall(breakdown: FitScoreBreakdown): number {
  const values = Object.values(breakdown);
  return values.reduce((total, value) => total + value, 0) / values.length;
}

const MOCK_CANDIDATES: ProspectCandidate[] = [
  {
    id: 'candidate-1',
    workspaceId: 'workspace-1',
    name: 'Priya Shah',
    company: 'Shah Consulting',
    source: 'rev_prospect_discovery',
    whyFound: 'Matches your service area and target company size criteria in Business Brain.',
    whyRelevant: 'Recently expanded team size, a common trigger for needing your service.',
    evidence: ['Company size matches target profile', 'Service area overlaps your coverage', 'Public hiring signal recorded'],
    fitScore: { serviceMatch: 0.9, geographicMatch: 0.85, companyTypeMatch: 0.8, opportunityTrigger: 0.7, contactability: 0.6 },
    discoveredAt: '2024-12-20T09:00:00.000Z',
  },
  {
    id: 'candidate-2',
    workspaceId: 'workspace-1',
    name: 'Tom Walsh',
    company: 'Walsh & Partners',
    source: 'rev_prospect_discovery',
    whyFound: 'Matches your service category in a nearby service area.',
    whyRelevant: 'No confirmed current need yet — evidence is limited.',
    evidence: ['Service category match only'],
    fitScore: { serviceMatch: 0.6, geographicMatch: 0.5, companyTypeMatch: 0.5, opportunityTrigger: 0.2, contactability: 0.4 },
    discoveredAt: '2024-12-20T09:00:00.000Z',
  },
  {
    id: 'candidate-3',
    workspaceId: 'workspace-2',
    name: 'Helen Ortiz',
    company: 'Ortiz Family Office',
    source: 'rev_prospect_discovery',
    whyFound: 'Matches your target customer profile for estate and succession planning.',
    whyRelevant: 'Public record indicates a recent business ownership change, a common planning trigger.',
    evidence: ['Target customer profile match', 'Recent ownership-change signal recorded'],
    fitScore: { serviceMatch: 0.85, geographicMatch: 0.9, companyTypeMatch: 0.75, opportunityTrigger: 0.65, contactability: 0.55 },
    discoveredAt: '2024-12-20T09:00:00.000Z',
  },
];

/** Demo-only discovery source for mock mode. Never used in Supabase/live mode. */
export class MockProspectDiscoveryProvider implements ProspectDiscoveryProvider {
  discover(workspaceId: string): ProspectCandidate[] {
    return MOCK_CANDIDATES.filter((candidate) => candidate.workspaceId === workspaceId);
  }
}
