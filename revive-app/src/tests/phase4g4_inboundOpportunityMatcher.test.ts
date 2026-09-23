import { describe, expect, it } from 'vitest';
import {
  matchInboundOpportunity,
  type InboundOpportunityCandidate,
} from '../../supabase/functions/rev-email-inbound/inboundOpportunityMatcher';

const workspaceId = 'workspace-1';
const contactId = 'contact-1';

function opportunity(
  overrides: Partial<InboundOpportunityCandidate> = {},
): InboundOpportunityCandidate {
  return {
    id: 'opportunity-1',
    workspaceId,
    contactId,
    stage: 'dormant',
    ...overrides,
  };
}

describe('Phase 4G.4 inbound opportunity matcher', () => {
  it('matches exactly one opportunity for the workspace contact', () => {
    expect(
      matchInboundOpportunity(workspaceId, contactId, [opportunity()]),
    ).toEqual({
      status: 'matched',
      opportunityId: 'opportunity-1',
    });
  });

  it('does not match an opportunity from another workspace', () => {
    expect(
      matchInboundOpportunity(workspaceId, contactId, [
        opportunity({ workspaceId: 'workspace-2' }),
      ]),
    ).toEqual({
      status: 'needs_review',
      reason: 'no_opportunity',
    });
  });

  it('does not match an opportunity belonging to another contact', () => {
    expect(
      matchInboundOpportunity(workspaceId, contactId, [
        opportunity({ contactId: 'contact-2' }),
      ]),
    ).toEqual({
      status: 'needs_review',
      reason: 'no_opportunity',
    });
  });

  it('requires review when multiple viable opportunities exist', () => {
    expect(
      matchInboundOpportunity(workspaceId, contactId, [
        opportunity({ id: 'opportunity-1' }),
        opportunity({ id: 'opportunity-2', stage: 'conversation' }),
      ]),
    ).toEqual({
      status: 'needs_review',
      reason: 'ambiguous_opportunity',
    });
  });

  it('ignores won and lost opportunities', () => {
    expect(
      matchInboundOpportunity(workspaceId, contactId, [
        opportunity({ id: 'won', stage: 'won' }),
        opportunity({ id: 'lost', stage: 'lost' }),
      ]),
    ).toEqual({
      status: 'needs_review',
      reason: 'no_opportunity',
    });
  });

  it('can match a dormant opportunity for reactivation', () => {
    expect(
      matchInboundOpportunity(workspaceId, contactId, [
        opportunity({ stage: 'dormant' }),
      ]),
    ).toEqual({
      status: 'matched',
      opportunityId: 'opportunity-1',
    });
  });
});
