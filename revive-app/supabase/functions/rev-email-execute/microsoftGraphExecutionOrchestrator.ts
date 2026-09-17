import {
  MicrosoftGraphOutcomeUnknownError,
  MicrosoftGraphRejectedError,
  type MicrosoftGraphEmail,
  type MicrosoftGraphSendResult,
} from './microsoftGraphProvider.ts';

import type {
  EmailProviderOutcome,
  TrustedEmailClaim,
} from './trustedEmailExecution.ts';

export interface MicrosoftGraphExecutionInput {
  executionId: string;
  requestFingerprint: string;
  email: MicrosoftGraphEmail;
}

export interface MicrosoftGraphExecutionDependencies {
  recheckSuppression: () => Promise<void>;

  claimProviderAttempt: (
    executionId: string,
    requestFingerprint: string,
  ) => Promise<TrustedEmailClaim>;

  sendEmail: (
    email: MicrosoftGraphEmail,
  ) => Promise<MicrosoftGraphSendResult>;

  recordProviderResult: (input: {
    executionId: string;
    providerKey: string;
    providerOutcome: EmailProviderOutcome;
    resultSummary: string;
    failureCode: string | null;
    actualProviderCost: number;
    providerReference?: string | null;
  }) => Promise<unknown>;
}

export interface MicrosoftGraphExecutionResult {
  executionId: string;
  providerOutcome: EmailProviderOutcome;
  acceptedByProvider: boolean;
  deliveryConfirmed: false;
  automaticRetryAllowed: false;
}

/*
 * Executes an already-authorised Microsoft Graph email attempt.
 *
 * IMPORTANT ORDER:
 *
 * 1. Recheck suppression.
 * 2. Atomically claim the irreversible provider attempt.
 * 3. Invoke Microsoft Graph exactly once.
 * 4. Record exactly one terminal provider outcome.
 *
 * Authentication/configuration should be completed BEFORE this
 * orchestrator is entered. Therefore a missing/invalid Microsoft
 * credential does not consume the provider-attempt claim.
 *
 * Once the claim succeeds, automatic retry is prohibited.
 */
export async function executeMicrosoftGraphEmail(
  input: MicrosoftGraphExecutionInput,
  dependencies: MicrosoftGraphExecutionDependencies,
): Promise<MicrosoftGraphExecutionResult> {
  const executionId = input.executionId?.trim();
  const requestFingerprint =
    input.requestFingerprint?.trim().toLowerCase();

  if (!executionId) {
    throw new Error(
      'Microsoft Graph execution requires an execution ID.',
    );
  }

  if (!/^[a-f0-9]{64}$/.test(requestFingerprint)) {
    throw new Error(
      'Microsoft Graph execution requires a valid request fingerprint.',
    );
  }

  /*
   * Final outreach safety check immediately before the irreversible
   * provider-attempt claim.
   *
   * If this fails, no claim and no provider invocation occur.
   */
  await dependencies.recheckSuppression();

  /*
   * This is the irreversible boundary.
   *
   * The database claim must move:
   * provider_not_invoked -> provider_attempt_claimed
   *
   * After this point we NEVER automatically retry the same semantic
   * email action/version.
   */
  const claim = await dependencies.claimProviderAttempt(
    executionId,
    requestFingerprint,
  );

  if (claim.id !== executionId) {
    throw new Error(
      'Trusted provider claim returned an unexpected execution.',
    );
  }

  const providerKey = claim.provider_key?.trim();

  if (providerKey !== 'microsoft_graph') {
    throw new Error(
      'Trusted provider claim is not configured for Microsoft Graph.',
    );
  }

  try {
    /*
     * Exactly one Graph sendMail invocation per claimed execution.
     */
    const sendResult = await dependencies.sendEmail(input.email);

    /*
     * Microsoft Graph 202 is represented only as accepted by provider.
     * It is NOT delivery confirmation.
     */
    await dependencies.recordProviderResult({
      executionId,
      providerKey,
      providerOutcome: 'accepted_by_provider',
      resultSummary:
        'Accepted by provider; delivery remains unknown.',
      failureCode: null,
      actualProviderCost: sendResult.actualCost,
    });

    return {
      executionId,
      providerOutcome: 'accepted_by_provider',
      acceptedByProvider: true,
      deliveryConfirmed: false,
      automaticRetryAllowed: false,
    };
  } catch (error) {
    /*
     * An explicit HTTP response from Graph means the provider rejected
     * the request. No delivery is recorded.
     */
    if (error instanceof MicrosoftGraphRejectedError) {
      await dependencies.recordProviderResult({
        executionId,
        providerKey,
        providerOutcome: 'rejected_by_provider',
        resultSummary:
          'Rejected by provider; no delivery recorded.',
        failureCode: `MICROSOFT_GRAPH_HTTP_${error.status}`,
        actualProviderCost: 0,
      });

      return {
        executionId,
        providerOutcome: 'rejected_by_provider',
        acceptedByProvider: false,
        deliveryConfirmed: false,
        automaticRetryAllowed: false,
      };
    }

    /*
     * A transport failure/lost response after invocation is ambiguous:
     * Microsoft may have accepted the email.
     *
     * Record UNKNOWN and prohibit automatic retry.
     */
    if (error instanceof MicrosoftGraphOutcomeUnknownError) {
      await dependencies.recordProviderResult({
        executionId,
        providerKey,
        providerOutcome: 'provider_outcome_unknown',
        resultSummary:
          'Provider outcome unknown; automatic retry prohibited.',
        failureCode: 'MICROSOFT_GRAPH_OUTCOME_UNKNOWN',
        actualProviderCost: 0,
      });

      return {
        executionId,
        providerOutcome: 'provider_outcome_unknown',
        acceptedByProvider: false,
        deliveryConfirmed: false,
        automaticRetryAllowed: false,
      };
    }

    /*
     * CRITICAL:
     *
     * An unexpected error after the provider-attempt claim must NOT
     * trigger another send.
     *
     * This includes failure while recording an accepted result.
     * The execution remains claimed for reconciliation rather than
     * risking a duplicate external email.
     */
    throw error;
  }
}