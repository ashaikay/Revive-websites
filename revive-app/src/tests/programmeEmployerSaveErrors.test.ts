import { describe, expect, it } from 'vitest';
import {
  EmployerEngagementSaveRejected,
  submitEmployerEngagementSave,
} from '@/services/programmeEmployerEngagementService';
import type { EmployerEngagementSaveAttempt } from '@/domain/programmeEmployerEngagement';

const attempt: EmployerEngagementSaveAttempt = {
  operation: 'outreach_settings',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  programmeId: '22222222-2222-4222-8222-222222222222',
  recordId: null,
  requestId: '44444444-4444-4444-8444-444444444444',
  expectedVersion: 0,
  payload: { offerSummary: 'We support employers with practical recruitment introductions.' },
};

describe('employer save outcome classification', () => {
  it('recognises only explicitly rejected responses', async () => {
    await expect(submitEmployerEngagementSave(attempt, {
      invoke: async () => ({ status: 409, data: { outcome: 'rejected' } }),
    })).rejects.toBeInstanceOf(EmployerEngagementSaveRejected);
  });

  it('preserves uncertainty for legacy conflicts and unknown outcomes', async () => {
    for (const response of [
      { status: 409, data: { error: 'Legacy generic conflict' } },
      { status: 503, data: { outcome: 'unknown' } },
      { status: 200, data: null },
    ]) {
      try {
        await submitEmployerEngagementSave(attempt, { invoke: async () => response });
        throw new Error('Expected failure');
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect(error).not.toBeInstanceOf(EmployerEngagementSaveRejected);
      }
    }
  });
});
