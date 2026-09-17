import { describe, expect, it, vi } from 'vitest';

import {
  executeMicrosoftGraphEmail,
  type MicrosoftGraphExecutionDependencies,
} from '../../supabase/functions/rev-email-execute/microsoftGraphExecutionOrchestrator';

import {
  MicrosoftGraphOutcomeUnknownError,
  MicrosoftGraphRejectedError,
} from '../../supabase/functions/rev-email-execute/microsoftGraphProvider';

const executionId = '11111111-1111-4111-8111-111111111111';
const requestFingerprint = 'a'.repeat(64);

const email = {
  recipient: 'customer@example.com',
  subject: 'Approved follow-up',
  body: 'Approved email body.',
};

function createDependencies(): MicrosoftGraphExecutionDependencies {
  return {
    recheckSuppression: vi.fn().mockResolvedValue(undefined),

    claimProviderAttempt: vi.fn().mockResolvedValue({
      id: executionId,
      workspace_id: 'workspace-1',
      action_id: 'action-1',
      correlation_id: '22222222-2222-4222-8222-222222222222',
      request_fingerprint: requestFingerprint,
      provider_key: 'microsoft_graph',
      provider_outcome: 'provider_attempt_claimed',
      status: 'in_progress',
    }),

    sendEmail: vi.fn().mockResolvedValue({
      outcome: 'accepted_by_provider',
      acceptedAt: '2026-09-17T16:00:00.000Z',
      actualCost: 0,
    }),

    recordProviderResult: vi.fn().mockResolvedValue({}),
  };
}

describe('Phase 4G.2B Microsoft Graph execution orchestrator', () => {
  it('executes suppression recheck, claim, send and result recording in strict order', async () => {
    const order: string[] = [];
    const dependencies = createDependencies();

    dependencies.recheckSuppression = vi.fn(async () => {
      order.push('suppression');
    });

    dependencies.claimProviderAttempt = vi.fn(async () => {
      order.push('claim');

      return {
        id: executionId,
        workspace_id: 'workspace-1',
        action_id: 'action-1',
        correlation_id: '22222222-2222-4222-8222-222222222222',
        request_fingerprint: requestFingerprint,
        provider_key: 'microsoft_graph',
        provider_outcome: 'provider_attempt_claimed',
        status: 'in_progress',
      };
    });

    dependencies.sendEmail = vi.fn(async () => {
      order.push('send');

      return {
        outcome: 'accepted_by_provider',
        acceptedAt: '2026-09-17T16:00:00.000Z',
        actualCost: 0,
      };
    });

    dependencies.recordProviderResult = vi.fn(async () => {
      order.push('record');
      return {};
    });

    const result = await executeMicrosoftGraphEmail(
      {
        executionId,
        requestFingerprint,
        email,
      },
      dependencies,
    );

    expect(order).toEqual([
      'suppression',
      'claim',
      'send',
      'record',
    ]);

    expect(result).toEqual({
      executionId,
      providerOutcome: 'accepted_by_provider',
      acceptedByProvider: true,
      deliveryConfirmed: false,
      automaticRetryAllowed: false,
    });
  });

  it('blocks claim and provider invocation when final suppression recheck fails', async () => {
    const dependencies = createDependencies();

    dependencies.recheckSuppression = vi
      .fn()
      .mockRejectedValue(
        new Error('Contact became suppressed.'),
      );

    await expect(
      executeMicrosoftGraphEmail(
        {
          executionId,
          requestFingerprint,
          email,
        },
        dependencies,
      ),
    ).rejects.toThrow('Contact became suppressed.');

    expect(
      dependencies.claimProviderAttempt,
    ).not.toHaveBeenCalled();

    expect(dependencies.sendEmail).not.toHaveBeenCalled();

    expect(
      dependencies.recordProviderResult,
    ).not.toHaveBeenCalled();
  });

  it('does not invoke provider when the atomic claim fails', async () => {
    const dependencies = createDependencies();

    dependencies.claimProviderAttempt = vi
      .fn()
      .mockRejectedValue(
        new Error('Provider attempt claim denied.'),
      );

    await expect(
      executeMicrosoftGraphEmail(
        {
          executionId,
          requestFingerprint,
          email,
        },
        dependencies,
      ),
    ).rejects.toThrow('Provider attempt claim denied.');

    expect(dependencies.sendEmail).not.toHaveBeenCalled();

    expect(
      dependencies.recordProviderResult,
    ).not.toHaveBeenCalled();
  });

  it('records Graph rejection as rejected_by_provider without retry', async () => {
    const dependencies = createDependencies();

    dependencies.sendEmail = vi
      .fn()
      .mockRejectedValue(
        new MicrosoftGraphRejectedError(
          403,
          'Microsoft Graph rejected the request.',
        ),
      );

    const result = await executeMicrosoftGraphEmail(
      {
        executionId,
        requestFingerprint,
        email,
      },
      dependencies,
    );

    expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);

    expect(
      dependencies.recordProviderResult,
    ).toHaveBeenCalledTimes(1);

    expect(
      dependencies.recordProviderResult,
    ).toHaveBeenCalledWith({
      executionId,
      providerKey: 'microsoft_graph',
      providerOutcome: 'rejected_by_provider',
      resultSummary:
        'Rejected by provider; no delivery recorded.',
      failureCode: 'MICROSOFT_GRAPH_HTTP_403',
      actualProviderCost: 0,
    });

    expect(result.providerOutcome).toBe(
      'rejected_by_provider',
    );

    expect(result.automaticRetryAllowed).toBe(false);
  });

  it('records lost provider response as provider_outcome_unknown without retry', async () => {
    const dependencies = createDependencies();

    dependencies.sendEmail = vi
      .fn()
      .mockRejectedValue(
        new MicrosoftGraphOutcomeUnknownError(
          'Microsoft Graph provider outcome is unknown.',
        ),
      );

    const result = await executeMicrosoftGraphEmail(
      {
        executionId,
        requestFingerprint,
        email,
      },
      dependencies,
    );

    expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);

    expect(
      dependencies.recordProviderResult,
    ).toHaveBeenCalledTimes(1);

    expect(
      dependencies.recordProviderResult,
    ).toHaveBeenCalledWith({
      executionId,
      providerKey: 'microsoft_graph',
      providerOutcome: 'provider_outcome_unknown',
      resultSummary:
        'Provider outcome unknown; automatic retry prohibited.',
      failureCode: 'MICROSOFT_GRAPH_OUTCOME_UNKNOWN',
      actualProviderCost: 0,
    });

    expect(result.providerOutcome).toBe(
      'provider_outcome_unknown',
    );

    expect(result.automaticRetryAllowed).toBe(false);
  });

  it('never performs a second provider invocation when accepted-result recording fails', async () => {
    const dependencies = createDependencies();

    dependencies.recordProviderResult = vi
      .fn()
      .mockRejectedValue(
        new Error('Database result recording failed.'),
      );

    await expect(
      executeMicrosoftGraphEmail(
        {
          executionId,
          requestFingerprint,
          email,
        },
        dependencies,
      ),
    ).rejects.toThrow(
      'Database result recording failed.',
    );

    expect(dependencies.sendEmail).toHaveBeenCalledTimes(1);

    expect(
      dependencies.claimProviderAttempt,
    ).toHaveBeenCalledTimes(1);

    expect(
      dependencies.recordProviderResult,
    ).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid fingerprint before any safety or provider operation', async () => {
    const dependencies = createDependencies();

    await expect(
      executeMicrosoftGraphEmail(
        {
          executionId,
          requestFingerprint: 'invalid',
          email,
        },
        dependencies,
      ),
    ).rejects.toThrow(
      'Microsoft Graph execution requires a valid request fingerprint.',
    );

    expect(
      dependencies.recheckSuppression,
    ).not.toHaveBeenCalled();

    expect(
      dependencies.claimProviderAttempt,
    ).not.toHaveBeenCalled();

    expect(dependencies.sendEmail).not.toHaveBeenCalled();

    expect(
      dependencies.recordProviderResult,
    ).not.toHaveBeenCalled();
  });
});