import type { SupabaseClient } from '@supabase/supabase-js';

import {
  acquireMicrosoftGraphAccessToken,
  type MicrosoftGraphAuthConfig,
} from '../_shared/microsoftGraphAuth.ts';

import {
  sendMicrosoftGraphEmail,
  type MicrosoftGraphEmail,
} from './microsoftGraphProvider.ts';

import {
  claimEmailProviderAttempt,
  recordEmailProviderResult,
} from './trustedEmailExecution.ts';

import type {
  MicrosoftGraphExecutionDependencies,
} from './microsoftGraphExecutionOrchestrator.ts';

export interface MicrosoftGraphServerConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  senderUserId: string;
}

export interface CreateMicrosoftGraphExecutionDependenciesInput {
  serviceClient: SupabaseClient;
  workspaceId: string;
  contactId: string;
  config: MicrosoftGraphServerConfig;
}

/*
 * Creates the trusted dependencies used by the Microsoft Graph
 * execution orchestrator.
 *
 * IMPORTANT:
 * This module is server-side only.
 *
 * The service-role client and Microsoft credentials must never be
 * exposed to the browser, caller payload, logs, or response body.
 */
export async function createMicrosoftGraphExecutionDependencies(
  input: CreateMicrosoftGraphExecutionDependenciesInput,
): Promise<MicrosoftGraphExecutionDependencies> {
  const workspaceId = input.workspaceId?.trim();
  const contactId = input.contactId?.trim();

  if (!workspaceId || !contactId) {
    throw new Error(
      'Microsoft Graph trusted dependencies require workspace and contact IDs.',
    );
  }

  /*
   * Authenticate with Microsoft BEFORE the irreversible provider claim.
   *
   * If configuration or authentication fails, no provider-attempt
   * claim has been consumed and no email has been invoked.
   */
  const authConfig: MicrosoftGraphAuthConfig = {
    tenantId: input.config.tenantId,
    clientId: input.config.clientId,
    clientSecret: input.config.clientSecret,
  };

  const auth = await acquireMicrosoftGraphAccessToken(authConfig);

  if (!auth.accessToken?.trim()) {
    throw new Error(
      'Microsoft Graph authentication returned no access token.',
    );
  }

  const senderUserId = input.config.senderUserId?.trim();

  if (!senderUserId) {
    throw new Error(
      'Microsoft Graph sender mailbox is not configured.',
    );
  }

  return {
    /*
     * Final suppression recheck.
     *
     * This uses the trusted service-role client immediately before
     * the atomic provider claim. Failure to verify suppression status
     * fails closed.
     */
    recheckSuppression: async () => {
      const {
        data: suppression,
        error,
      } = await input.serviceClient
        .from('contact_suppressions')
        .select('reason')
        .eq('workspace_id', workspaceId)
        .eq('contact_id', contactId)
        .maybeSingle();

      if (error) {
        throw new Error(
          'Final suppression status could not be verified.',
        );
      }

      if (suppression) {
        throw new Error(
          'Contact became suppressed before provider execution.',
        );
      }
    },

    /*
     * Atomic irreversible provider-attempt claim.
     */
    claimProviderAttempt: async (
      executionId,
      requestFingerprint,
    ) => {
      return await claimEmailProviderAttempt(
        input.serviceClient,
        executionId,
        requestFingerprint,
      );
    },

    /*
     * Exactly one Microsoft Graph invocation is controlled by the
     * orchestrator after the atomic claim succeeds.
     */
    sendEmail: async (email: MicrosoftGraphEmail) => {
      return await sendMicrosoftGraphEmail(email, {
        accessToken: auth.accessToken,
        senderUserId,
      });
    },

    /*
     * Persist exactly one terminal provider outcome and usage event.
     */
    recordProviderResult: async (result) => {
      return await recordEmailProviderResult(
        input.serviceClient,
        result,
      );
    },
  };
}
