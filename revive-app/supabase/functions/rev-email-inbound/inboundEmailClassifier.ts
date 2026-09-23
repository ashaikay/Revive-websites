export type InboundEmailClassification =
  | 'automated'
  | 'security_system'
  | 'marketing_newsletter'
  | 'potential_business'
  | 'customer_opportunity'
  | 'unknown';

export interface InboundEmailClassificationInput {
  senderEmail: string;
  subject: string | null;
  matchedContactId?: string | null;
}

export interface InboundEmailClassificationResult {
  classification: InboundEmailClassification;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function classifyInboundEmail(
  input: InboundEmailClassificationInput,
): InboundEmailClassificationResult {
  const sender = normalize(input.senderEmail);
  const subject = normalize(input.subject);

  // A confirmed workspace contact takes priority over generic sender rules.
  if (input.matchedContactId) {
    return {
      classification: 'customer_opportunity',
      confidence: 'high',
      reason: 'Sender is already matched to a workspace contact.',
    };
  }

  // Security / infrastructure messages should be surfaced, not treated as leads.
  if (
    sender.includes('dmarc') ||
    subject.includes('new sign-in') ||
    subject.includes('security alert') ||
    subject.includes('confirm your identity')
  ) {
    return {
      classification: 'security_system',
      confidence: 'high',
      reason: 'Message contains a security or infrastructure signal.',
    };
  }

  // Strong machine-generated sender signals.
  if (
    sender.includes('noreply') ||
    sender.includes('no-reply') ||
    sender.includes('donotreply') ||
    sender.includes('do-not-reply')
  ) {
    return {
      classification: 'automated',
      confidence: 'high',
      reason: 'Sender address indicates an automated message.',
    };
  }

  // Common bulk-content signals.
  if (
    subject.includes('newsletter') ||
    subject.includes('weekly update') ||
    subject.includes('recently posted') ||
    subject.includes('job openings') ||
    subject.includes('apply now')
  ) {
    return {
      classification: 'marketing_newsletter',
      confidence: 'medium',
      reason: 'Subject resembles bulk marketing or notification content.',
    };
  }

  // Unknown human/business-looking mail is not automatically promoted to a lead.
  if (sender.includes('@')) {
    return {
      classification: 'potential_business',
      confidence: 'low',
      reason: 'Sender appears valid but is not yet safely identified.',
    };
  }

  return {
    classification: 'unknown',
    confidence: 'low',
    reason: 'REV cannot safely classify this message yet.',
  };
}
