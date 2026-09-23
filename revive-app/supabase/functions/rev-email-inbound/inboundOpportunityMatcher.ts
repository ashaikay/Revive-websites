export interface InboundOpportunityCandidate {
  id: string;
  workspaceId: string;
  contactId: string;
  stage: string;
}

export type InboundOpportunityMatch =
  | {
      status: 'matched';
      opportunityId: string;
    }
  | {
      status: 'needs_review';
      reason: 'no_opportunity' | 'ambiguous_opportunity';
    };

export function matchInboundOpportunity(
  workspaceId: string,
  contactId: string,
  candidates: InboundOpportunityCandidate[],
): InboundOpportunityMatch {
  const matches = candidates.filter(
    (candidate) =>
      candidate.workspaceId === workspaceId &&
      candidate.contactId === contactId &&
      candidate.stage !== 'won' &&
      candidate.stage !== 'lost',
  );

  if (matches.length === 1) {
    return {
      status: 'matched',
      opportunityId: matches[0].id,
    };
  }

  return {
    status: 'needs_review',
    reason:
      matches.length === 0
        ? 'no_opportunity'
        : 'ambiguous_opportunity',
  };
}
