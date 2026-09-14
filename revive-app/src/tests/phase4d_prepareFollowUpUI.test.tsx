import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PreparedFollowUpReview, userFacingRationale } from '@/components/REVInterface';
import { PreparedFollowUpArtifact } from '@/domain/preparedWork';

function artifact(overrides: Partial<PreparedFollowUpArtifact> = {}): PreparedFollowUpArtifact {
  return {
    id: 'prepared-follow-up-action-4d',
    workspaceId: 'workspace-1',
    revActionId: 'action-4d',
    approvalId: 'approval-4d',
    recoveryCandidateId: 'recovery-4d',
    recoveryType: 'stale_opportunity',
    contactId: 'contact-1',
    opportunityId: 'opportunity-1',
    recoveryReason: 'No recorded activity for 21 days.',
    objective: 'Reconnect helpfully and establish whether there is a useful next step.',
    suggestedChannel: 'email',
    subject: 'Checking in about the platform rollout',
    draftMessage: 'Hi Sarah,\n\nWould it be useful to continue the conversation?\n\nBest,\nRevive',
    evidenceContext: [{ type: 'fact', summary: 'Last activity is 21 days old.', source: 'Opportunity record' }],
    missingInformation: ['A preferred follow-up date is not recorded.'],
    ownerEditable: true,
    approvalState: 'pending',
    externalSend: false,
    providerInvoked: false,
    estimatedCost: 0,
    createdAt: '2026-09-15T10:00:00.000Z',
    updatedAt: '2026-09-15T10:00:00.000Z',
    ...overrides,
  };
}

describe('Phase 4D prepared follow-up UI', () => {
  it('keeps internal recovery linkage out of owner-facing rationale text', () => {
    expect(userFacingRationale('prepared-follow-up:recovery-4d | No recorded activity for 21 days.')).toBe('No recorded activity for 21 days.');
  });

  it('shows the draft, evidence, missing information, and owner review controls', () => {
    const markup = renderToStaticMarkup(
      <PreparedFollowUpReview artifact={artifact()} canReview onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(markup).toContain('REV PREPARED THIS FOR YOU');
    expect(markup).toContain('DRAFT — REVIEW REQUIRED');
    expect(markup).toContain('EVIDENCE USED');
    expect(markup).toContain('MISSING INFORMATION');
    expect(markup).toMatch(/<button[^>]*>Edit<\/button>/);
    expect(markup).toMatch(/<button[^>]*>Approve<\/button>/);
    expect(markup).toMatch(/<button[^>]*>Reject<\/button>/);
    expect(markup).not.toMatch(/<button[^>]*>[^<]*Send/i);
    expect(markup).toContain('No provider is invoked.');
  });

  it('shows approved but not sent and removes all review controls', () => {
    const markup = renderToStaticMarkup(
      <PreparedFollowUpReview artifact={artifact({ approvalState: 'approved_not_sent' })} canReview onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(markup).toContain('APPROVED — NOT SENT');
    expect(markup).not.toMatch(/<button/);
    expect(markup).not.toMatch(/<button[^>]*>[^<]*Send/i);
  });

  it('withholds review controls from members and viewers', () => {
    const markup = renderToStaticMarkup(
      <PreparedFollowUpReview artifact={artifact()} canReview={false} onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(markup).toContain('Owner or admin review is required.');
    expect(markup).not.toMatch(/<button/);
  });
});