export type InboundReplyIntent =
  | 'interested'
  | 'question'
  | 'wants_contact'
  | 'not_interested'
  | 'complaint'
  | 'unknown';

export interface InboundReplyIntentInput {
  subject: string | null;
  bodyText: string | null;
}

export interface InboundReplyIntentResult {
  intent: InboundReplyIntent;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
}

function normalize(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

function containsAny(text: string, phrases: string[]): boolean {
  return phrases.some((phrase) => text.includes(phrase));
}

export function detectInboundReplyIntent(
  input: InboundReplyIntentInput,
): InboundReplyIntentResult {
  const subject = normalize(input.subject);
  const body = normalize(input.bodyText);
  const text = `${subject} ${body}`;

  if (
    containsAny(text, [
      'not interested',
      'no longer interested',
      'please stop',
      'do not contact',
      "don't contact",
      'unsubscribe',
    ])
  ) {
    return {
      intent: 'not_interested',
      confidence: 'high',
      reason: 'Reply contains an explicit negative or stop-contact signal.',
    };
  }

  if (
    containsAny(text, [
      'complaint',
      'unhappy',
      'disappointed',
      'poor service',
      'not happy',
      'problem with',
    ])
  ) {
    return {
      intent: 'complaint',
      confidence: 'high',
      reason: 'Reply contains a complaint or dissatisfaction signal.',
    };
  }

  if (
    containsAny(text, [
      'call me',
      'give me a call',
      'phone me',
      'contact me',
      'can we talk',
      'speak to me',
      'book a call',
    ])
  ) {
    return {
      intent: 'wants_contact',
      confidence: 'high',
      reason: 'Reply explicitly requests direct contact or a conversation.',
    };
  }

  if (
    containsAny(text, [
      'interested',
      'would like to know more',
      "i'd like to know more",
      'tell me more',
      'more information',
      'sounds good',
    ])
  ) {
    return {
      intent: 'interested',
      confidence: 'high',
      reason: 'Reply expresses positive interest or requests more information.',
    };
  }

  if (body.includes('?')) {
    return {
      intent: 'question',
      confidence: 'medium',
      reason: 'Reply contains a direct question.',
    };
  }

  return {
    intent: 'unknown',
    confidence: 'low',
    reason: 'REV cannot safely determine the customer intent yet.',
  };
}
