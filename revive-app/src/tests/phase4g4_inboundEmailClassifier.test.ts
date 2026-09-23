import { describe, expect, it } from 'vitest';

import {
  classifyInboundEmail,
} from '../../supabase/functions/rev-email-inbound/inboundEmailClassifier';

describe('Phase 4G.4 inbound email classifier', () => {
  it('prioritises a confirmed workspace contact', () => {
    expect(
      classifyInboundEmail({
        senderEmail: 'mike.blackwood11@gmail.com',
        subject: 'REV inbound test',
        matchedContactId: 'contact-123',
      }),
    ).toMatchObject({
      classification: 'customer_opportunity',
      confidence: 'high',
    });
  });

  it('classifies LinkedIn noreply mail as automated', () => {
    expect(
      classifyInboundEmail({
        senderEmail: 'messages-noreply@linkedin.com',
        subject: 'Michael, add Andrea Andrews',
      }),
    ).toMatchObject({
      classification: 'automated',
      confidence: 'high',
    });
  });

  it('classifies sign-in alerts as security/system', () => {
    expect(
      classifyInboundEmail({
        senderEmail: 'donotreply@godaddy.com',
        subject: 'Email Account Activity: New Sign-In detected for your account.',
      }),
    ).toMatchObject({
      classification: 'security_system',
      confidence: 'high',
    });
  });

  it('classifies DMARC reports as security/system', () => {
    expect(
      classifyInboundEmail({
        senderEmail: 'noreply-dmarc-support@google.com',
        subject: 'Report domain: fatherslegacy.net',
      }),
    ).toMatchObject({
      classification: 'security_system',
      confidence: 'high',
    });
  });

  it('classifies identity verification as security/system', () => {
    expect(
      classifyInboundEmail({
        senderEmail: 'service@paypal.co.uk',
        subject: 'Please confirm your identity',
      }),
    ).toMatchObject({
      classification: 'security_system',
      confidence: 'high',
    });
  });

  it('does not automatically promote an unknown human sender to a customer', () => {
    expect(
      classifyInboundEmail({
        senderEmail: 'person@example.com',
        subject: 'Interested in your service',
      }),
    ).toMatchObject({
      classification: 'potential_business',
      confidence: 'low',
    });
  });

  it('fails safely when the sender cannot be identified', () => {
    expect(
      classifyInboundEmail({
        senderEmail: '',
        subject: null,
      }),
    ).toMatchObject({
      classification: 'unknown',
      confidence: 'low',
    });
  });
});
