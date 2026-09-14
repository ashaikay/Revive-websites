import { CommercialEvidence } from './commercialIntelligence';
import { Id } from './models';
import { RecoverySignalType } from './recovery';

export type PreparedFollowUpChannel = 'email' | 'phone' | 'owner_choice';
export type PreparedFollowUpApprovalState = 'pending' | 'approved_not_sent' | 'rejected';

export interface PreparedFollowUpArtifact {
  id: Id;
  workspaceId: Id;
  revActionId: Id;
  approvalId: Id;
  recoveryCandidateId: Id;
  recoveryType: RecoverySignalType;
  contactId?: Id;
  opportunityId?: Id;
  recoveryReason: string;
  objective: string;
  suggestedChannel: PreparedFollowUpChannel;
  subject?: string;
  draftMessage: string;
  evidenceContext: CommercialEvidence[];
  missingInformation: string[];
  ownerEditable: true;
  approvalState: PreparedFollowUpApprovalState;
  externalSend: false;
  providerInvoked: false;
  estimatedCost: 0;
  createdAt: string;
  updatedAt: string;
}
