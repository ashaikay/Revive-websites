import { describe, expect, it, vi } from 'vitest';
import {
  claimEmailProviderAttempt,
  recordEmailProviderResult,
} from '../../supabase/functions/rev-email-execute/trustedEmailExecution';

function serviceClientWithRpc(rpc: ReturnType<typeof vi.fn>) {
  return { rpc } as never;
}

const executionId = '11111111-1111-4111-8111-111111111111';
const fingerprint = 'a'.repeat(64);

describe('Phase 4G.2B trusted email execution helper', () => {
  it('claims the provider attempt through the trusted RPC', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        id: executionId,
        workspace_id: 'workspace-1',
        action_id: 'action-1',
        correlation_id: '22222222-2222-4222-8222-222222222222',
        request_fingerprint: fingerprint,
        provider_key: 'microsoft_graph',
        provider_outcome: 'provider_attempt_claimed',
        status: 'in_progress',
      },
      error: null,
    }));

    const result = await claimEmailProviderAttempt(
      serviceClientWithRpc(rpc),
      executionId,
      fingerprint,
    );

    expect(result.provider_outcome).toBe('provider_attempt_claimed');
    expect(result.status).toBe('in_progress');

    expect(rpc).toHaveBeenCalledWith(
      'claim_rev_action_provider_attempt',
      {
        target_execution_id: executionId,
        expected_request_fingerprint: fingerprint,
      },
    );
  });

  it('rejects an invalid request fingerprint before calling the database', async () => {
    const rpc = vi.fn();

    await expect(
      claimEmailProviderAttempt(
        serviceClientWithRpc(rpc),
        executionId,
        'invalid',
      ),
    ).rejects.toThrow(/fingerprint/);

    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a claim that does not return provider_attempt_claimed', async () => {
    const rpc = vi.fn(async () => ({
      data: {
        status: 'prepared',
        provider_outcome: 'provider_not_invoked',
      },
      error: null,
    }));

    await expect(
      claimEmailProviderAttempt(
        serviceClientWithRpc(rpc),
        executionId,
        fingerprint,
      ),
    ).rejects.toThrow(/invalid state/);
  });

  it.each([
    'accepted_by_provider',
    'rejected_by_provider',
    'provider_outcome_unknown',
  ] as const)(
    'records terminal provider outcome %s with exactly one usage event',
    async (providerOutcome) => {
      const rpc = vi.fn(async () => ({
        data: {
          id: executionId,
          provider_outcome: providerOutcome,
        },
        error: null,
      }));

      await recordEmailProviderResult(
        serviceClientWithRpc(rpc),
        {
          executionId,
          providerKey: 'microsoft_graph',
          providerOutcome,
          resultSummary: null,
          failureCode: null,
          actualProviderCost: 0,
          occurredAt: '2026-09-17T16:00:00.000Z',
        },
      );

      expect(rpc).toHaveBeenCalledTimes(1);

      const [rpcName, args] = rpc.mock.calls[0] as unknown as [
  string,
  {
    target_execution_id: string;
    target_provider_outcome: string;
    usage_events: Array<{
      provider_key: string;
      operation: string;
      usage_event_key: string;
      units: number;
      estimated_provider_cost: number;
      actual_provider_cost: number;
      currency: string;
    }>;
  },
];

      expect(rpcName).toBe('record_email_execution_result');
      expect(args.target_execution_id).toBe(executionId);
      expect(args.target_provider_outcome).toBe(providerOutcome);

      expect(args.usage_events).toHaveLength(1);
      expect(args.usage_events[0]).toMatchObject({
        provider_key: 'microsoft_graph',
        operation: 'send_email',
        usage_event_key: `email:${executionId}`,
        units: 1,
        estimated_provider_cost: 0,
        actual_provider_cost: 0,
        currency: 'GBP',
      });
    },
  );

  it('rejects negative provider cost before recording a result', async () => {
    const rpc = vi.fn();

    await expect(
      recordEmailProviderResult(
        serviceClientWithRpc(rpc),
        {
          executionId,
          providerKey: 'microsoft_graph',
          providerOutcome: 'accepted_by_provider',
          resultSummary: null,
          failureCode: null,
          actualProviderCost: -1,
        },
      ),
    ).rejects.toThrow(/non-negative/);

    expect(rpc).not.toHaveBeenCalled();
  });
});