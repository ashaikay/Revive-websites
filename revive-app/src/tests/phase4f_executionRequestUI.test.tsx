import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PreparedFollowUpReview } from '@/components/REVInterface';
import { PreparedFollowUpArtifact } from '@/domain/preparedWork';
import { ControlledDryRunResult } from '@/services/controlledExecutionRequestService';

const artifact: PreparedFollowUpArtifact = {
  id: 'prepared-phase4f', workspaceId: 'workspace-1', revActionId: 'action-phase4f', approvalId: 'approval-phase4f',
  recoveryCandidateId: 'recovery-phase4f', recoveryType: 'stale_opportunity', recoveryReason: 'No recent activity.',
  objective: 'Reconnect helpfully.', suggestedChannel: 'email', subject: 'Reviewed follow-up', draftMessage: 'Reviewed draft.',
  evidenceContext: [{ type: 'fact', summary: 'Opportunity is stale.', source: 'Opportunity record' }], missingInformation: [],
  ownerEditable: true, approvalState: 'approved_not_sent', externalSend: false, providerInvoked: false, estimatedCost: 0,
  createdAt: '2026-09-16T00:00:00.000Z', updatedAt: '2026-09-16T01:00:00.000Z',
};

const result = {
  requestId: 'request-phase4f', workspaceId: 'workspace-1', actionId: 'action-phase4f',
  status: 'dry_run_nothing_sent', displayStatus: 'DRY RUN — NOTHING SENT', externalSend: false,
  providerInvoked: false, providerCost: 0, executionEnabled: false, replayed: false,
} as ControlledDryRunResult;

describe('Phase 4F execution request UI', () => {
  it('shows REQUEST EXECUTION only for an authorized approved artifact', () => {
    const markup = renderToStaticMarkup(
      <PreparedFollowUpReview artifact={artifact} canReview onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()}
        canRequestExecution onRequestExecution={vi.fn()} />,
    );
    expect(markup).toMatch(/<button[^>]*>REQUEST EXECUTION<\/button>/);
    expect(markup).toContain('dry-run only');
    expect(markup).not.toMatch(/<button[^>]*>[^<]*SEND/i);
  });

  it('withholds execution controls from unauthorized and live-safe usages', () => {
    const markup = renderToStaticMarkup(
      <PreparedFollowUpReview artifact={artifact} canReview={false} onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} />,
    );
    expect(markup).not.toContain('REQUEST EXECUTION');
    expect(markup).not.toMatch(/<button/);
  });

  it('shows the truthful terminal dry-run result with zero cost and provider calls', () => {
    const markup = renderToStaticMarkup(
      <PreparedFollowUpReview artifact={artifact} canReview onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()}
        canRequestExecution onRequestExecution={vi.fn()} executionResult={result} />,
    );
    expect(markup).toContain('DRY RUN — NOTHING SENT');
    expect(markup).toContain('Provider calls: 0');
    expect(markup).toContain('Cost: £0');
    expect(markup).not.toMatch(/<button[^>]*>[^<]*SEND/i);
  });
});