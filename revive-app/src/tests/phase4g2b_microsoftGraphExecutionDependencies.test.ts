import { describe, expect, it, vi } from 'vitest';

vi.mock(
  '../../supabase/functions/rev-email-execute/microsoftGraphAuth',
  () => ({
    acquireMicrosoftGraphAccessToken: vi.fn(),
  }),
);

vi.mock(
  '../../supabase/functions/rev-email-execute/microsoftGraphProvider',
  () => ({
    sendMicrosoftGraphEmail: vi.fn(),
  }),
);

vi.mock(
  '../../supabase/functions/rev-email-execute/trustedEmailExecution',
  () => ({
    claimEmailProviderAttempt: vi.fn(),
    recordEmailProviderResult: vi.fn(),
  }),
);

import { acquireMicrosoftGraphAccessToken } from '../../supabase/functions/rev-email-execute/microsoftGraphAuth';

import { sendMicrosoftGraphEmail } from '../../supabase/functions/rev-email-execute/microsoftGraphProvider';

import {
  claimEmailProviderAttempt,
  recordEmailProviderResult,
} from '../../supabase/functions/rev-email-execute/trustedEmailExecution';

import {
  createMicrosoftGraphExecutionDependencies,
} from '../../supabase/functions/rev-email-execute/microsoftGraphExecutionDependencies';

const workspaceId =
  '11111111-1111-4111-8111-111111111111';

const contactId =
  '22222222-2222-4222-8222-222222222222';

const executionId =
  '33333333-3333-4333-8333-333333333333';

const requestFingerprint = 'a'.repeat(64);

const config = {
  tenantId: 'tenant-id',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  senderUserId: 'sender@example.com',
};

function createServiceClient(
  suppression: unknown = null,
  suppressionError: unknown = null,
) {
  const maybeSingle = vi.fn().mockResolvedValue({
    data: suppression,
    error: suppressionError,
  });

  const contactEq = vi.fn(() => ({
    maybeSingle,
  }));

  const workspaceEq = vi.fn(() => ({
    eq: contactEq,
  }));

  const select = vi.fn(() => ({
    eq: workspaceEq,
  }));

  const from = vi.fn(() => ({
    select,
  }));

  return {
    client: {
      from,
    } as never,
    from,
    select,
    workspaceEq,
    contactEq,
    maybeSingle,
  };
}

describe(
  'Phase 4G.2B Microsoft Graph execution dependencies',
  () => {
    it('acquires Microsoft authentication before returning provider execution dependencies', async () => {
      vi.mocked(
        acquireMicrosoftGraphAccessToken,
      ).mockResolvedValue({
        accessToken: 'server-only-access-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      });

      const service = createServiceClient();

      const dependencies =
        await createMicrosoftGraphExecutionDependencies({
          serviceClient: service.client,
          workspaceId,
          contactId,
          config,
        });

      expect(
        acquireMicrosoftGraphAccessToken,
      ).toHaveBeenCalledTimes(1);

      expect(
        acquireMicrosoftGraphAccessToken,
      ).toHaveBeenCalledWith({
        tenantId: 'tenant-id',
        clientId: 'client-id',
        clientSecret: 'client-secret',
      });

      expect(dependencies.recheckSuppression).toBeTypeOf(
        'function',
      );

      expect(dependencies.claimProviderAttempt).toBeTypeOf(
        'function',
      );

      expect(dependencies.sendEmail).toBeTypeOf(
        'function',
      );

      expect(dependencies.recordProviderResult).toBeTypeOf(
        'function',
      );

      expect(
        claimEmailProviderAttempt,
      ).not.toHaveBeenCalled();

      expect(sendMicrosoftGraphEmail).not.toHaveBeenCalled();
    });

    it('fails before provider dependencies are returned when Microsoft authentication fails', async () => {
      vi.mocked(
        acquireMicrosoftGraphAccessToken,
      ).mockRejectedValue(
        new Error('Microsoft authentication failed.'),
      );

      const service = createServiceClient();

      await expect(
        createMicrosoftGraphExecutionDependencies({
          serviceClient: service.client,
          workspaceId,
          contactId,
          config,
        }),
      ).rejects.toThrow(
        'Microsoft authentication failed.',
      );

      expect(
        claimEmailProviderAttempt,
      ).not.toHaveBeenCalled();

      expect(sendMicrosoftGraphEmail).not.toHaveBeenCalled();

      expect(
        recordEmailProviderResult,
      ).not.toHaveBeenCalled();
    });

    it('fails closed when final suppression verification cannot be completed', async () => {
      vi.mocked(
        acquireMicrosoftGraphAccessToken,
      ).mockResolvedValue({
        accessToken: 'server-only-access-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      });

      const service = createServiceClient(
        null,
        new Error('Database unavailable.'),
      );

      const dependencies =
        await createMicrosoftGraphExecutionDependencies({
          serviceClient: service.client,
          workspaceId,
          contactId,
          config,
        });

      await expect(
        dependencies.recheckSuppression(),
      ).rejects.toThrow(
        'Final suppression status could not be verified.',
      );

      expect(
        claimEmailProviderAttempt,
      ).not.toHaveBeenCalled();

      expect(sendMicrosoftGraphEmail).not.toHaveBeenCalled();
    });

    it('blocks execution when the contact became suppressed', async () => {
      vi.mocked(
        acquireMicrosoftGraphAccessToken,
      ).mockResolvedValue({
        accessToken: 'server-only-access-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      });

      const service = createServiceClient({
        id: 'suppression-id',
      });

      const dependencies =
        await createMicrosoftGraphExecutionDependencies({
          serviceClient: service.client,
          workspaceId,
          contactId,
          config,
        });

      await expect(
        dependencies.recheckSuppression(),
      ).rejects.toThrow(
        'Contact became suppressed before provider execution.',
      );

      expect(
        claimEmailProviderAttempt,
      ).not.toHaveBeenCalled();

      expect(sendMicrosoftGraphEmail).not.toHaveBeenCalled();
    });

    it('delegates the irreversible claim to the trusted database helper', async () => {
      vi.mocked(
        acquireMicrosoftGraphAccessToken,
      ).mockResolvedValue({
        accessToken: 'server-only-access-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      });

      vi.mocked(
        claimEmailProviderAttempt,
      ).mockResolvedValue({
        id: executionId,
        workspace_id: workspaceId,
        action_id:
          '44444444-4444-4444-8444-444444444444',
        correlation_id:
          '55555555-5555-4555-8555-555555555555',
        request_fingerprint: requestFingerprint,
        provider_key: 'microsoft_graph',
        provider_outcome: 'provider_attempt_claimed',
        status: 'in_progress',
      });

      const service = createServiceClient();

      const dependencies =
        await createMicrosoftGraphExecutionDependencies({
          serviceClient: service.client,
          workspaceId,
          contactId,
          config,
        });

      const claim =
        await dependencies.claimProviderAttempt(
          executionId,
          requestFingerprint,
        );

      expect(
        claimEmailProviderAttempt,
      ).toHaveBeenCalledTimes(1);

      expect(
        claimEmailProviderAttempt,
      ).toHaveBeenCalledWith(
        service.client,
        executionId,
        requestFingerprint,
      );

      expect(claim.provider_outcome).toBe(
        'provider_attempt_claimed',
      );

      expect(sendMicrosoftGraphEmail).not.toHaveBeenCalled();
    });

    it('passes only the server-acquired token and configured sender to the Graph provider', async () => {
      vi.mocked(
        acquireMicrosoftGraphAccessToken,
      ).mockResolvedValue({
        accessToken: 'server-only-access-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      });

      vi.mocked(
        sendMicrosoftGraphEmail,
      ).mockResolvedValue({
        outcome: 'accepted_by_provider',
        acceptedAt: '2026-09-17T18:00:00.000Z',
        actualCost: 0,
      });

      const service = createServiceClient();

      const dependencies =
        await createMicrosoftGraphExecutionDependencies({
          serviceClient: service.client,
          workspaceId,
          contactId,
          config,
        });

      const email = {
        recipient: 'customer@example.com',
        subject: 'Approved follow-up',
        body: 'Approved email body.',
      };

      await dependencies.sendEmail(email);

      expect(sendMicrosoftGraphEmail).toHaveBeenCalledTimes(
        1,
      );

      expect(sendMicrosoftGraphEmail).toHaveBeenCalledWith(
        email,
        {
          accessToken: 'server-only-access-token',
          senderUserId: 'sender@example.com',
        },
      );
    });

    it('delegates terminal result recording to the trusted database helper', async () => {
      vi.mocked(
        acquireMicrosoftGraphAccessToken,
      ).mockResolvedValue({
        accessToken: 'server-only-access-token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      });

      vi.mocked(
        recordEmailProviderResult,
      ).mockResolvedValue({});

      const service = createServiceClient();

      const dependencies =
        await createMicrosoftGraphExecutionDependencies({
          serviceClient: service.client,
          workspaceId,
          contactId,
          config,
        });

      const result = {
        executionId,
        providerKey: 'microsoft_graph',
        providerOutcome:
          'accepted_by_provider' as const,
        resultSummary:
          'Accepted by provider; delivery remains unknown.',
        failureCode: null,
        actualProviderCost: 0,
      };

      await dependencies.recordProviderResult(result);

      expect(
        recordEmailProviderResult,
      ).toHaveBeenCalledTimes(1);

      expect(
        recordEmailProviderResult,
      ).toHaveBeenCalledWith(
        service.client,
        result,
      );
    });
  },
);