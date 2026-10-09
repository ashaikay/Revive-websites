// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailConversationHistory } from '@/components/REVInterface';
import { MeetingProposalReviewCard } from '@/components/MeetingProposalReviewCard';
import type { LivePendingAction } from '@/data/supabasePreparedWorkRepository';
import type { MeetingDryRunResult, MeetingProviderResult } from '@/services/meetingExecutionClient';
import { focusFeedback } from '@/utils/focusFeedback';

const action: LivePendingAction = {
  id: 'action-1',
  workspaceId: 'workspace-1',
  actionType: 'meeting_proposal',
  title: 'Discovery call',
  description: 'Meeting proposal awaiting owner approval.',
  rationale: 'meeting-proposal:v1',
  requiresApproval: true,
  status: 'approved',
  executionStatus: 'not_executed',
  proposedAt: '2030-09-29T00:00:00.000Z',
  actionVersion: 1,
  approvalId: 'approval-1',
  approvalActionVersion: 1,
  approvalActionFingerprint: 'a'.repeat(64),
  meetingProposal: {
    title: 'Discovery call',
    attendeeEmail: 'customer@example.test',
    startAt: '2030-09-30T09:00:00.000Z',
    endAt: '2030-09-30T09:30:00.000Z',
    timezone: 'Europe/London',
    meetingMethod: 'online',
    locationDetails: '',
    notes: '',
  },
};

const dryRunResult: MeetingDryRunResult = {
  status: 'provider_disabled',
  displayStatus: 'DRY RUN — NOTHING BOOKED',
  executionEnabled: false,
  providerInvoked: false,
  eventCreated: false,
  executionId: '22222222-2222-4222-8222-222222222222',
  correlationId: '11111111-1111-4111-8111-111111111111',
  providerOutcome: 'provider_not_invoked',
};

const unknownResult: MeetingProviderResult = {
  status: 'outcome_unknown',
  executionId: '22222222-2222-4222-8222-222222222222',
  providerOutcome: 'provider_outcome_unknown',
  providerInvoked: true,
  eventCreated: null,
  invitationSent: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}

function FeedbackCard({ onRequest }: { onRequest: () => Promise<MeetingDryRunResult> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MeetingDryRunResult>();
  const request = async () => {
    setBusy(true);
    try {
      setResult(await onRequest());
    } finally {
      setBusy(false);
    }
  };
  return <MeetingProposalReviewCard action={action} canReview busy={false} executionBusy={busy}
    executionResult={result} onDecision={vi.fn()} onRequestDryRun={request} />;
}

function DecisionFeedbackCard() {
  const [feedback, setFeedback] = useState<'approved' | 'rejected' | undefined>('approved');
  return <MeetingProposalReviewCard action={action} canReview busy={false} decisionFeedback={feedback}
    onClearDecisionFeedback={() => setFeedback(undefined)} onDecision={vi.fn()} />;
}

beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('mounted REV layout and action feedback', () => {
  it('keeps email cards compact and expands a full message only on request', () => {
    const fullMessage = `${'The customer requested an update. '.repeat(12)}END OF FULL MESSAGE`;
    const { container } = render(<EmailConversationHistory contacts={[]} opportunities={[]} threads={[{
      id: 'thread-1',
      workspaceId: 'workspace-1',
      subject: 'Project update',
      lastMessageAt: '2026-09-23T10:00:00.000Z',
      messages: [{
        id: 'message-1',
        workspaceId: 'workspace-1',
        threadId: 'thread-1',
        direction: 'inbound',
        senderEmail: 'customer@example.test',
        recipientEmails: ['team@example.test'],
        bodyText: fullMessage,
        communicationAt: '2026-09-23T10:00:00.000Z',
      }],
    }]} />);

    expect(container.querySelector('article header')).toHaveClass('p-3', 'sm:p-4');
    expect(screen.getAllByText(/The customer requested an update/)[0]).toBeInTheDocument();
    expect(screen.getByText(fullMessage)).not.toBeVisible();
    fireEvent.click(screen.getByText('Read full message'));
    expect(screen.getByText(fullMessage)).toBeInTheDocument();
  });

  it('shows immediate booking-check progress, prevents duplicate clicks and focuses the adjacent result', async () => {
    const request = deferred<MeetingDryRunResult>();
    render(<FeedbackCard onRequest={() => request.promise} />);

    const initial = screen.getByRole('button', { name: 'CHECK BOOKING SETUP' });
    fireEvent.click(initial);
    const busy = screen.getByRole('button', { name: 'CHECKING BOOKING SETUP…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(busy);
    expect(screen.getByRole('button', { name: 'CHECKING BOOKING SETUP…' })).toBeDisabled();

    await act(async () => { request.resolve(dryRunResult); });
    const result = await screen.findByRole('status');
    expect(result).toHaveFocus();
    expect(result).toHaveTextContent('BOOKING CHECK — NOTHING BOOKED');
    expect(result).toHaveTextContent('No calendar event was created');
    expect(screen.queryByRole('button', { name: 'CHECK BOOKING SETUP' })).not.toBeInTheDocument();
    expect(HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
  });

  it('keeps uncertain booking outcomes visible, focuses them and withholds another booking action', async () => {
    vi.useFakeTimers();
    render(<MeetingProposalReviewCard action={action} canReview busy={false} executionResult={unknownResult}
      onDecision={vi.fn()} onRequestLive={vi.fn()} onRequestDryRun={vi.fn()} />);
    const result = screen.getByRole('status');
    expect(result).toHaveFocus();
    expect(result).toHaveTextContent('OUTCOME UNKNOWN — CHECK CALENDAR');
    expect(result).toHaveTextContent('Do not retry this attempt.');
    expect(screen.queryByRole('button', { name: 'CHECK BOOKING SETUP' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'CREATE LIVE CALENDAR EVENT' })).not.toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(screen.getByRole('status')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('focuses persistent recovery guidance and blocks another request after an unconfirmed response', () => {
    vi.useFakeTimers();
    const message = 'REV lost contact before confirming the booking result. The event may have been created. Check the selected Outlook calendar and contact an administrator to reconcile it. Do not retry this attempt.';
    render(<MeetingProposalReviewCard action={action} canReview busy={false} executionError={message}
      onDecision={vi.fn()} onRequestLive={vi.fn()} onRequestDryRun={vi.fn()} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveFocus();
    expect(alert).toHaveTextContent('Booking status needs checking');
    expect(alert).toHaveTextContent(message);
    expect(screen.queryByRole('button', { name: 'CHECK BOOKING SETUP' })).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('clears routine approval feedback after five seconds while retaining the saved status', async () => {
    vi.useFakeTimers();
    render(<DecisionFeedbackCard />);
    const feedback = screen.getByRole('status');
    expect(feedback).toHaveFocus();
    expect(feedback).toHaveTextContent('Proposal approved. It remains not booked.');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(screen.queryByText('Proposal approved. It remains not booked.')).not.toBeInTheDocument();
    expect(screen.getByText('APPROVED — NOT BOOKED')).toBeInTheDocument();
    vi.useRealTimers();
  });

  it('focuses and scrolls feedback only when it is outside the viewport', () => {
    const element = document.createElement('p');
    element.tabIndex = -1;
    document.body.append(element);
    vi.spyOn(element, 'getBoundingClientRect').mockReturnValue({
      top: -50, bottom: -10, left: 0, right: 0, width: 0, height: 40, x: 0, y: -50, toJSON: () => ({}),
    });
    focusFeedback(element);
    expect(element).toHaveFocus();
    expect(element.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    element.remove();
  });
});
