import { createTrustedMeetingExecutionReadModel, type TrustedMeetingReadClient } from './trustedMeetingExecutionReadModel.ts';
import { buildTrustedMeetingGraphRequest } from './trustedMeetingGraphRequest.ts';
import { createTrustedMeetingProviderAttempt, type ClaimedMeetingAttempt, type MeetingProviderAttemptClient } from './trustedMeetingProviderAttempt.ts';
import { createMeetingProviderWorkflow, type MeetingProviderWorkflowDependencies } from './meetingProviderWorkflow.ts';
import { createMicrosoftGraphCalendarEvent } from './microsoftGraphCalendarEvent.ts';

/** Server-only composition. It is not imported by the HTTP boundary. */
export interface TrustedMeetingProviderCompositionDependencies {
  trustedClient: TrustedMeetingReadClient & MeetingProviderAttemptClient;
  trustedWorkspaceId: string;
  primaryMailboxUserPrincipalName: string;
  getAccessToken: () => Promise<string>;
  // A test may supply a fake transport. Production uses the existing Graph adapter.
  invokeGraph?: MeetingProviderWorkflowDependencies['invokeGraph'];
}

/** The default workflow gate is off. No caller-supplied flag can enable it. */
export function createTrustedMeetingProviderComposition(deps: TrustedMeetingProviderCompositionDependencies) {
  const loadSnapshot = createTrustedMeetingExecutionReadModel(deps.trustedClient);
  const providerAttempt = createTrustedMeetingProviderAttempt(deps.trustedClient);
  return (attempt: ClaimedMeetingAttempt) => {
    const workflow = createMeetingProviderWorkflow({
      loadGraphRequest: async () => {
        const snapshot = await loadSnapshot(attempt.executionId);
        if (snapshot.workspaceId !== deps.trustedWorkspaceId ||
          snapshot.requestFingerprint !== attempt.requestFingerprint ||
          snapshot.bindingVersion !== attempt.bindingVersion) {
          throw new Error('Trusted meeting provider snapshot mismatch.');
        }
        const accessToken = await deps.getAccessToken();
        return buildTrustedMeetingGraphRequest(snapshot, {
          workspaceId: deps.trustedWorkspaceId,
          primaryMailboxUserPrincipalName: deps.primaryMailboxUserPrincipalName,
          accessToken,
        });
      },
      claim: providerAttempt.claim,
      record: providerAttempt.record,
      invokeGraph: deps.invokeGraph ?? createMicrosoftGraphCalendarEvent,
    });
    return workflow(attempt);
  };
}
