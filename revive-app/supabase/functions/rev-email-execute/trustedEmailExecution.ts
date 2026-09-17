import type { SupabaseClient } from '@supabase/supabase-js';

export type EmailProviderOutcome =
  | 'accepted_by_provider'
  | 'rejected_by_provider'
  | 'provider_outcome_unknown';

export type TrustedEmailClaim = {
  id: string;
  workspace_id: string;
  action_id: string;
  correlation_id: string;
  request_fingerprint: string;
  provider_key: string;
  provider_outcome: 'provider_attempt_claimed';
  status: 'in_progress';
};

export type EmailUsageEvent = {
  provider_key: string;
  operation: 'send_email';
  usage_event_key: string;
  units: number;
  estimated_provider_cost: number;
  actual_provider_cost: number;
  currency: 'GBP';
  provider_reference?: string | null;
  occurred_at: string;
};

export async function claimEmailProviderAttempt(
  serviceClient: SupabaseClient,
  executionId: string,
  requestFingerprint: string,
): Promise<TrustedEmailClaim> {
  if (!executionId.trim()) {
    throw new Error('Execution ID is required.');
  }

  if (!/^[0-9a-f]{64}$/.test(requestFingerprint)) {
    throw new Error('Valid request fingerprint is required.');
  }

  const { data, error } = await serviceClient.rpc(
    'claim_rev_action_provider_attempt',
    {
      target_execution_id: executionId,
      expected_request_fingerprint: requestFingerprint,
    },
  );

  if (error || !data) {
    throw new Error('Trusted email provider attempt could not be claimed.');
  }

  if (
    data.status !== 'in_progress' ||
    data.provider_outcome !== 'provider_attempt_claimed'
  ) {
    throw new Error('Trusted email provider claim returned an invalid state.');
  }

  return data as TrustedEmailClaim;
}

export async function recordEmailProviderResult(
  serviceClient: SupabaseClient,
  input: {
    executionId: string;
    providerKey: string;
    providerOutcome: EmailProviderOutcome;
    resultSummary: string | null;
    failureCode: string | null;
    actualProviderCost: number;
    providerReference?: string | null;
    occurredAt?: string;
  },
): Promise<unknown> {
  if (!input.executionId.trim()) {
    throw new Error('Execution ID is required.');
  }

  if (!input.providerKey.trim()) {
    throw new Error('Provider key is required.');
  }

  if (
    ![
      'accepted_by_provider',
      'rejected_by_provider',
      'provider_outcome_unknown',
    ].includes(input.providerOutcome)
  ) {
    throw new Error('Invalid email provider outcome.');
  }

  if (
    !Number.isFinite(input.actualProviderCost) ||
    input.actualProviderCost < 0
  ) {
    throw new Error('Actual provider cost must be non-negative.');
  }

  const occurredAt = input.occurredAt ?? new Date().toISOString();

  const usageEvent: EmailUsageEvent = {
    provider_key: input.providerKey,
    operation: 'send_email',
    usage_event_key: `email:${input.executionId}`,
    units: 1,
    estimated_provider_cost: 0,
    actual_provider_cost: input.actualProviderCost,
    currency: 'GBP',
    provider_reference: input.providerReference ?? null,
    occurred_at: occurredAt,
  };

  const { data, error } = await serviceClient.rpc(
    'record_email_execution_result',
    {
      target_execution_id: input.executionId,
      target_provider_outcome: input.providerOutcome,
      target_result_summary: input.resultSummary,
      target_failure_code: input.failureCode,
      usage_events: [usageEvent],
    },
  );

  if (error || !data) {
    throw new Error('Email provider result could not be recorded.');
  }

  return data;
}