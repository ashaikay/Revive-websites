import { describe, expect, it } from 'vitest';
import { fingerprintApprovedEmail } from '@/services/approvedEmailFingerprint';

const base = {
  workspaceId: '22222222-2222-4222-8222-222222222222',
  actionId: '11111111-1111-4111-8111-111111111111',
  actionVersion: 1,
  recipient: 'customer@example.com',
  subject: 'Approved subject',
  body: 'Exact approved body.',
};

describe('Phase 4G.2B approved email fingerprint', () => {
  it('is deterministic and produces SHA-256 hex', async () => {
    const first = await fingerprintApprovedEmail(base);
    const second = await fingerprintApprovedEmail(base);

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each([
    ['recipient', { recipient: 'other@example.com' }],
    ['subject', { subject: 'Changed subject' }],
    ['body', { body: 'Changed body.' }],
    ['action version', { actionVersion: 2 }],
  ])('changes when %s changes', async (_name, change) => {
    const original = await fingerprintApprovedEmail(base);
    const changed = await fingerprintApprovedEmail({ ...base, ...change });

    expect(changed).not.toBe(original);
  });

  it('normalises recipient casing and surrounding whitespace', async () => {
    const original = await fingerprintApprovedEmail(base);

    const equivalent = await fingerprintApprovedEmail({
      ...base,
      recipient: '  CUSTOMER@EXAMPLE.COM  ',
    });

    expect(equivalent).toBe(original);
  });
});
