import { CommercialEvidence } from '@/domain/commercialIntelligence';
import { BusinessProfileRecord, BusinessServiceRecord, ContactRecord, GoalRecord, OpportunityRecord } from '@/domain/models';
import { PreparedFollowUpChannel } from '@/domain/preparedWork';
import { RecoveryCandidate, RecoverySignalType } from '@/domain/recovery';

export const SUPPORTED_PREPARED_FOLLOW_UP_TYPES: RecoverySignalType[] = [
  'dormant_lead',
  'stale_opportunity',
  'no_next_action',
  'former_customer_reactivation',
  'quote_follow_up',
  'repeat_service',
  'renewal_due',
];

export interface PreparedFollowUpDraftContext {
  profile?: BusinessProfileRecord;
  services: BusinessServiceRecord[];
  goal?: GoalRecord;
  contact?: ContactRecord;
  opportunity?: OpportunityRecord;
}

export interface PreparedFollowUpDraft {
  contactId?: string;
  subject: string;
  draftMessage: string;
  rationale: string;
  recoveryReason: string;
  objective: string;
  suggestedChannel: PreparedFollowUpChannel;
  evidenceContext: CommercialEvidence[];
  missingInformation: string[];
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || 'there';
}

export function buildPreparedFollowUpDraft(candidate: RecoveryCandidate, context: PreparedFollowUpDraftContext): PreparedFollowUpDraft {
  if (candidate.supportStatus !== 'supported' || !SUPPORTED_PREPARED_FOLLOW_UP_TYPES.includes(candidate.signalType)) {
    throw new Error('This recovery type is not supported by current REV data.');
  }
  if (candidate.safety !== 'allowed') throw new Error('This recovery candidate requires safety review before preparation.');
  if (context.contact?.doNotContact) throw new Error('Suppressed contacts cannot have follow-up prepared.');

  const service = context.services.find((item) => item.active);
  const missingInformation: string[] = [];
  if (!context.profile?.businessName) missingInformation.push('Business identity is not available.');
  if (!service) missingInformation.push('No active service is recorded for this workspace.');
  if (!context.contact?.email && !context.contact?.phone) missingInformation.push('No contact channel is recorded; the owner must choose how to follow up.');
  if (!context.opportunity && candidate.source === 'opportunity') missingInformation.push('Opportunity context is unavailable.');

  const businessName = context.profile?.businessName ?? 'our team';
  const recipientName = context.contact?.name ? firstName(context.contact.name) : 'there';
  const suggestedChannel: PreparedFollowUpChannel = context.contact?.email ? 'email' : context.contact?.phone ? 'phone' : 'owner_choice';
  const subject = context.opportunity ? `Checking in about ${context.opportunity.title}` : `Checking in from ${businessName}`;
  const contextLine = context.opportunity
    ? `I wanted to check in about ${context.opportunity.title}.`
    : candidate.signalType === 'former_customer_reactivation'
      ? 'I wanted to check in and see whether it would be useful to reconnect.'
      : 'I wanted to check in and see whether we can help.';
  const serviceLine = service
    ? `If ${service.name} is still relevant, we would be happy to continue the conversation.`
    : 'If this is still relevant, we would be happy to continue the conversation.';
  const evidenceContext: CommercialEvidence[] = [
    ...candidate.evidence,
    ...(context.profile?.businessName ? [{ type: 'fact' as const, summary: `Business identity: ${context.profile.businessName}.`, source: 'Business Brain' }] : []),
    ...(service ? [{ type: 'fact' as const, summary: `Active service: ${service.name}.`, source: 'Business Brain' }] : []),
  ];

  return {
    contactId: candidate.contactId ?? context.opportunity?.contactId,
    subject,
    draftMessage: `Hi ${recipientName},\n\n${contextLine} ${serviceLine} Please let us know what would be useful from us.\n\nBest,\n${businessName}`,
    rationale: `${candidate.reason} Evidence: ${candidate.evidence.map((item) => item.summary).join(' ')}`,
    recoveryReason: candidate.reason,
    objective: context.goal?.objective
      ? `Reconnect helpfully in support of: ${context.goal.objective}`
      : 'Reconnect helpfully and establish whether there is a useful next step.',
    suggestedChannel,
    evidenceContext,
    missingInformation,
  };
}