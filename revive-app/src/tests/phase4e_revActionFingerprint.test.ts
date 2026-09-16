import { describe, expect, it } from 'vitest';
import { fingerprintREVAction } from '@/services/revActionFingerprint';

describe('Phase 4E REV action fingerprint compatibility', () => {
  it('matches the Phase 4C PostgreSQL jsonb SHA-256 function exactly', async () => {
    await expect(fingerprintREVAction({
      id: '11111111-1111-4111-8111-111111111111',
      workspaceId: '22222222-2222-4222-8222-222222222222',
      contactId: '33333333-3333-4333-8333-333333333333',
      actionType: 'prepare_follow_up',
      title: 'A careful check-in',
      description: 'Hi Sam,\\n\\nChecking in.',
      rationale: 'prepared-follow-up:test | Evidence.',
      requiresApproval: true,
      actionVersion: 1,
    })).resolves.toBe('17f0b57f025af8cc65e570da95b9ccba53d29a4d2f4dc65bad91a3a06b286ae6');
  });
});