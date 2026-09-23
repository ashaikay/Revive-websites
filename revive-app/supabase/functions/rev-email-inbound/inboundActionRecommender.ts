import type { InboundReplyIntentResult } from './inboundReplyIntent.ts';

export type RecommendedInboundAction =
  | 'schedule_call'
  | 'prepare_follow_up'
  | 'prepare_answer'
  | 'stop_outreach'
  | 'human_review';

export interface InboundRecommendedActionResult {
  action: RecommendedInboundAction;
  requiresApproval: true;
  reason: string;
}

export function recommendInboundAction(
  replyIntent: InboundReplyIntentResult,
): InboundRecommendedActionResult {
  switch (replyIntent.intent) {
    case 'wants_contact':
      return {
        action: 'schedule_call',
        requiresApproval: true,
        reason: 'Customer explicitly requested direct contact.',
      };

    case 'interested':
      return {
        action: 'prepare_follow_up',
        requiresApproval: true,
        reason: 'Customer expressed positive interest.',
      };

    case 'question':
      return {
        action: 'prepare_answer',
        requiresApproval: true,
        reason: 'Customer asked a question that requires a response.',
      };

    case 'not_interested':
      return {
        action: 'stop_outreach',
        requiresApproval: true,
        reason: 'Customer expressed that further outreach is not wanted.',
      };

    case 'complaint':
      return {
        action: 'human_review',
        requiresApproval: true,
        reason: 'Customer complaint requires human review before any response.',
      };

    default:
      return {
        action: 'human_review',
        requiresApproval: true,
        reason: 'REV does not have enough evidence to recommend an external action.',
      };
  }
}
