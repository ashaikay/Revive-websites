import { describe, expect, it } from 'vitest';

import { detectInboundReplyIntent } from '../../supabase/functions/rev-email-inbound/inboundReplyIntent';

describe('Phase 4G.4 inbound reply intent', () => {
  it('detects positive interest', () => {
    const result = detectInboundReplyIntent({
      subject: 'REV classification test',
      bodyText: 'Hi, I am interested in FatherLegacy and would like some more information.',
    });

    expect(result.intent).toBe('interested');
    expect(result.confidence).toBe('high');
  });

  it('detects a direct question', () => {
    const result = detectInboundReplyIntent({
      subject: 'Question',
      bodyText: 'How much does the service cost?',
    });

    expect(result.intent).toBe('question');
  });

  it('detects a request for contact', () => {
    const result = detectInboundReplyIntent({
      subject: 'Can we talk?',
      bodyText: 'Please give me a call tomorrow.',
    });

    expect(result.intent).toBe('wants_contact');
    expect(result.confidence).toBe('high');
  });

  it('detects not interested', () => {
    const result = detectInboundReplyIntent({
      subject: 'Re: FatherLegacy',
      bodyText: 'Thanks, but I am not interested.',
    });

    expect(result.intent).toBe('not_interested');
    expect(result.confidence).toBe('high');
  });

  it('gives stop-contact language priority over positive words', () => {
    const result = detectInboundReplyIntent({
      subject: 'Re: More information',
      bodyText: 'I was interested before, but please do not contact me again.',
    });

    expect(result.intent).toBe('not_interested');
  });

  it('detects a complaint', () => {
    const result = detectInboundReplyIntent({
      subject: 'Problem with my account',
      bodyText: 'I am unhappy with the service.',
    });

    expect(result.intent).toBe('complaint');
    expect(result.confidence).toBe('high');
  });

  it('returns unknown when there is not enough evidence', () => {
    const result = detectInboundReplyIntent({
      subject: 'Re: FatherLegacy',
      bodyText: 'Thanks for your email.',
    });

    expect(result.intent).toBe('unknown');
    expect(result.confidence).toBe('low');
  });
});
