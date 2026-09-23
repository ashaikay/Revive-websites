import { describe, expect, it } from 'vitest';

import { recommendInboundAction } from '../../supabase/functions/rev-email-inbound/inboundActionRecommender';

describe('Phase 4G.4 inbound recommended actions', () => {
  const makeIntent = (
    intent:
      | 'interested'
      | 'question'
      | 'wants_contact'
      | 'not_interested'
      | 'complaint'
      | 'unknown',
  ) => ({
    intent,
    confidence: 'high' as const,
    reason: 'Test intent.',
  });

  it('recommends a call when contact is requested', () => {
    const result = recommendInboundAction(makeIntent('wants_contact'));
    expect(result.action).toBe('schedule_call');
    expect(result.requiresApproval).toBe(true);
  });

  it('recommends a follow-up for positive interest', () => {
    expect(recommendInboundAction(makeIntent('interested')).action)
      .toBe('prepare_follow_up');
  });

  it('recommends preparing an answer for a question', () => {
    expect(recommendInboundAction(makeIntent('question')).action)
      .toBe('prepare_answer');
  });

  it('recommends stopping outreach when not interested', () => {
    expect(recommendInboundAction(makeIntent('not_interested')).action)
      .toBe('stop_outreach');
  });

  it('routes complaints to human review', () => {
    expect(recommendInboundAction(makeIntent('complaint')).action)
      .toBe('human_review');
  });

  it('routes unknown intent to human review', () => {
    expect(recommendInboundAction(makeIntent('unknown')).action)
      .toBe('human_review');
  });
});
