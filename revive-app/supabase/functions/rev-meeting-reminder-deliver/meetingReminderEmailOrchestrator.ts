import {
  MicrosoftGraphOutcomeUnknownError,
  MicrosoftGraphRejectedError,
  type MicrosoftGraphEmail,
  type MicrosoftGraphSendResult,
} from '../rev-email-execute/microsoftGraphProvider.ts';

export type ReminderProviderOutcome =
  | 'accepted_by_provider'
  | 'rejected_by_provider'
  | 'provider_outcome_unknown';

export interface ClaimedMeetingReminderEmail {
  deliveryId: string;
  requestFingerprint: string;
  status:
    | 'provider_attempt_claimed'
    | 'accepted_by_provider'
    | 'rejected_by_provider'
    | 'provider_outcome_unknown';
  replayed: boolean;
  email?: MicrosoftGraphEmail;
}

export interface MeetingReminderEmailDependencies {
  sendEmail(email: MicrosoftGraphEmail): Promise<MicrosoftGraphSendResult>;
  recordResult(input: {
    deliveryId: string;
    requestFingerprint: string;
    providerOutcome: ReminderProviderOutcome;
    resultSummary: string;
    failureCode: string | null;
  }): Promise<unknown>;
}

export interface MeetingReminderEmailResult {
  deliveryId: string;
  status: ClaimedMeetingReminderEmail['status'];
  providerInvoked: boolean | 'unknown';
  acceptedByProvider: boolean;
  deliveryConfirmed: false;
  automaticRetryAllowed: false;
  replayed: boolean;
}

function replayResult(claim: ClaimedMeetingReminderEmail): MeetingReminderEmailResult {
  return {
    deliveryId: claim.deliveryId,
    status: claim.status,
    providerInvoked: claim.status === 'provider_attempt_claimed' ? 'unknown' : true,
    acceptedByProvider: claim.status === 'accepted_by_provider',
    deliveryConfirmed: false,
    automaticRetryAllowed: false,
    replayed: true,
  };
}

export async function executeClaimedMeetingReminderEmail(
  claim: ClaimedMeetingReminderEmail,
  dependencies: MeetingReminderEmailDependencies,
): Promise<MeetingReminderEmailResult> {
  if (claim.replayed) return replayResult(claim);
  if (claim.status !== 'provider_attempt_claimed' || !claim.email) {
    throw new Error('A newly claimed reminder email is required.');
  }

  let sendResult: MicrosoftGraphSendResult;
  try {
    sendResult = await dependencies.sendEmail(claim.email);
  } catch (error) {
    if (error instanceof MicrosoftGraphRejectedError) {
      await dependencies.recordResult({
        deliveryId: claim.deliveryId,
        requestFingerprint: claim.requestFingerprint,
        providerOutcome: 'rejected_by_provider',
        resultSummary: 'Rejected by provider; no delivery recorded.',
        failureCode: `MICROSOFT_GRAPH_HTTP_${error.status}`,
      });
      return {
        deliveryId: claim.deliveryId,
        status: 'rejected_by_provider',
        providerInvoked: true,
        acceptedByProvider: false,
        deliveryConfirmed: false,
        automaticRetryAllowed: false,
        replayed: false,
      };
    }
    if (error instanceof MicrosoftGraphOutcomeUnknownError) {
      await dependencies.recordResult({
        deliveryId: claim.deliveryId,
        requestFingerprint: claim.requestFingerprint,
        providerOutcome: 'provider_outcome_unknown',
        resultSummary: 'Provider outcome unknown; automatic retry prohibited.',
        failureCode: 'MICROSOFT_GRAPH_OUTCOME_UNKNOWN',
      });
      return {
        deliveryId: claim.deliveryId,
        status: 'provider_outcome_unknown',
        providerInvoked: true,
        acceptedByProvider: false,
        deliveryConfirmed: false,
        automaticRetryAllowed: false,
        replayed: false,
      };
    }
    throw error;
  }

  if (sendResult.outcome !== 'accepted_by_provider') {
    throw new Error('Microsoft Graph returned an unexpected reminder outcome.');
  }
  await dependencies.recordResult({
    deliveryId: claim.deliveryId,
    requestFingerprint: claim.requestFingerprint,
    providerOutcome: 'accepted_by_provider',
    resultSummary: 'Accepted by provider; delivery remains unknown.',
    failureCode: null,
  });
  return {
    deliveryId: claim.deliveryId,
    status: 'accepted_by_provider',
    providerInvoked: true,
    acceptedByProvider: true,
    deliveryConfirmed: false,
    automaticRetryAllowed: false,
    replayed: false,
  };
}
