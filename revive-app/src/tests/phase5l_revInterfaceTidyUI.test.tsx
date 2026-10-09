// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailConversationHistory, MeetingProposalGroups, PreparedFollowUpReview } from '@/components/REVInterface';
import { AppFooter } from '@/components/AppFooter';
import type { PreparedFollowUpArtifact } from '@/domain/preparedWork';
import { MeetingProposalReviewCard } from '@/components/MeetingProposalReviewCard';
import type { LivePendingAction } from '@/data/supabasePreparedWorkRepository';
import type { MeetingDryRunResult, MeetingProviderResult } from '@/services/meetingExecutionClient';
import { focusFeedback } from '@/utils/focusFeedback';
import { OutlookConnectionPanel } from '@/components/OutlookConnectionPanel';
import { CalendarAvailabilityPanel } from '@/components/CalendarAvailabilityPanel';

vi.mock('@/data/supabaseClient', () => ({
  supabaseClient: {
    functions: { invoke: vi.fn(() => { throw new Error('Unexpected service call in layout test'); }) },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: { role: 'owner', status: 'active' }, error: null }),
        then: (resolve: (value: unknown) => unknown) => Promise.resolve({
          data: table === 'workspace_calendar_connections'
            ? [{ id: '33333333-3333-4333-8333-333333333333', connection_status: 'connected', provider_account_reference: 'business@example.test', authorized_by_user_id: '22222222-2222-4222-8222-222222222222', calendar_write_consent_at: null }]
            : table === 'workspace_calendars'
              ? [{ id: '44444444-4444-4444-8444-444444444444', connection_id: '33333333-3333-4333-8333-333333333333', display_name: 'Business calendar', timezone: 'Europe/London', is_selected: true, active: true }]
              : [],
          error: null,
        }).then(resolve),
      };
      return query;
    },
  },
}));

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

const followUp: PreparedFollowUpArtifact = {
  id: 'prepared-layout', workspaceId: 'workspace-1', revActionId: 'follow-up-action',
  approvalId: 'follow-up-approval', recoveryCandidateId: 'recovery-1', recoveryType: 'stale_opportunity',
  recoveryReason: 'No recent customer activity.', objective: 'Discuss the next step.',
  suggestedChannel: 'email', subject: 'Website follow-up', draftMessage: 'Would you like to discuss the website proposal?',
  evidenceContext: [{ type: 'fact', summary: 'The proposal was shared last month.', source: 'Opportunity record' }],
  missingInformation: [], ownerEditable: true, approvalState: 'approved_not_sent',
  externalSend: false, providerInvoked: false, estimatedCost: 0,
  createdAt: '2026-09-16T00:00:00Z', updatedAt: '2026-09-16T00:00:00Z',
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
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('mounted REV layout and action feedback', () => {
  it('collapses follow-ups while keeping title, channel, durable status and disabled-sending notice visible', () => {
    const { container } = render(<PreparedFollowUpReview artifact={followUp} canReview executionMode="live"
      onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} />);
    expect(screen.getByText('Website follow-up')).toBeVisible();
    expect(screen.getByText('Suggested channel: email')).toBeVisible();
    expect(screen.getByText('Approved — not sent')).toBeVisible();
    expect(screen.getByText('Email sending disabled — nothing sent')).toBeVisible();
    expect(container.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByText(followUp.draftMessage)).not.toBeVisible();
    fireEvent.click(screen.getByText('View draft and actions'));
    expect(screen.getByText(followUp.draftMessage)).toBeVisible();
    expect(screen.getByText('Recovery reason:').parentElement).toHaveTextContent(followUp.recoveryReason);
    expect(screen.getByText('Objective:').parentElement).toHaveTextContent(followUp.objective);
    expect(screen.getByText(/The proposal was shared last month/)).toBeVisible();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('keeps existing draft edit and approval actions behind the follow-up disclosure', () => {
    const onEdit = vi.fn(), onApprove = vi.fn(), onRefresh = vi.fn();
    render(<PreparedFollowUpReview artifact={{ ...followUp, approvalState: 'pending' }} canReview executionMode="live"
      onEdit={onEdit} onApprove={onApprove} onReject={vi.fn()} onRefreshContext={onRefresh} />);
    expect(screen.getByRole('button', { name: 'Edit' })).not.toBeVisible();
    fireEvent.click(screen.getByText('View draft and actions'));
    fireEvent.click(screen.getByRole('button', { name: 'Refresh context' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Updated draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    expect(onEdit).toHaveBeenCalledWith(followUp.subject, 'Updated draft');
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onApprove).toHaveBeenCalledOnce();
  });

  it('does not hide follow-up errors or unknown outcomes or claim nothing was sent for an uncertain request', () => {
    vi.useFakeTimers();
    render(<PreparedFollowUpReview artifact={followUp} canReview executionMode="live"
      onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} executionError="The send outcome could not be confirmed."
      liveExecutionResult={{ status: 'outcome_unknown', executionEnabled: false, providerInvoked: 'unknown' }} />);
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('status')).toBeVisible();
    expect(screen.getByRole('status')).toHaveTextContent('Do not retry automatically.');
    expect(screen.queryByText('Email sending disabled — nothing sent')).toBeNull();
    act(() => { vi.advanceTimersByTime(6000); });
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('status')).toBeVisible();
  });

  it('renders a neutral application footer without developer diagnostics or blanket action claims', () => {
    render(<AppFooter />);
    expect(within(screen.getByRole('contentinfo')).getByText(/Review saved action results for their current status/)).toBeVisible();
    expect(screen.getByRole('contentinfo')).not.toHaveTextContent(/Auth:|Data Provider:|Mocked AI|No external actions executed|Phase 2B/);
    const source = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');
    expect(source).toContain('<AppFooter />');
    expect(source).not.toContain('Mocked AI & Data');
    expect(source).not.toContain('No external actions executed');
  });
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

    expect(container.querySelector('article summary')).toHaveClass('p-3', 'sm:p-4');
    expect(container.querySelector('article details')).not.toHaveAttribute('open');
    expect(screen.getAllByText(/The customer requested an update/)[0]).toBeInTheDocument();
    expect(screen.getByText(fullMessage)).not.toBeVisible();
    fireEvent.click(screen.getByText('View conversation (1)'));
    fireEvent.click(screen.getByText('Read full message'));
    expect(screen.getByText(fullMessage)).toBeVisible();
  });

  it('shows immediate booking-check progress, prevents duplicate clicks and focuses the adjacent result', async () => {
    const request = deferred<MeetingDryRunResult>();
    render(<FeedbackCard onRequest={() => request.promise} />);

    expect(screen.getByRole('button', { name: 'CHECK BOOKING SETUP' })).not.toBeVisible();
    fireEvent.click(screen.getByText('View details and actions'));
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

  it('keeps the selected calendar visible above collapsed setup and renders a compact local page', async () => {
    vi.stubEnv('VITE_REV_CALENDAR_OAUTH_UI_ENABLED', 'true');
    const completed = { ...action, id: 'completed-layout', status: 'completed' as const,
      meetingProposal: { ...action.meetingProposal!, title: 'Completed customer meeting' },
      meetingDryRun: { ...unknownResult, status: 'event_created' as const, providerOutcome: 'accepted_by_provider' as const, eventCreated: true as const } };
    const { container } = render(<main className="mx-auto max-w-5xl space-y-5 p-4 sm:p-6">
      <h1 className="text-2xl font-bold">REV workspace</h1>
      <OutlookConnectionPanel workspaceId="11111111-1111-4111-8111-111111111111" userId="user-1" />
      <EmailConversationHistory contacts={[]} opportunities={[]} threads={[{
        id: 'layout-thread', workspaceId: 'workspace-1', subject: 'Website project update', lastMessageAt: '2026-10-09T09:00:00Z',
        messages: [{ id: 'layout-message', workspaceId: 'workspace-1', threadId: 'layout-thread', direction: 'inbound', senderEmail: 'customer@example.test',
          recipientEmails: ['business@example.test'], bodyText: 'Thank you for the proposal. We would like to discuss next steps for our new website.', communicationAt: '2026-10-09T09:00:00Z' }],
      }]} />
      <CalendarAvailabilityPanel workspaceId="workspace-1" />
      <h2 className="text-xl font-bold">Meeting proposals &amp; results</h2>
      <MeetingProposalGroups actions={[action, completed]} now={Date.parse('2026-10-09')}
        needsAttention={() => false}
        renderAction={item => <MeetingProposalReviewCard key={item.id} action={item} canReview busy={false} onDecision={vi.fn()} />} />
      <h2 className="text-xl font-bold">Prepared follow-ups</h2>
      <PreparedFollowUpReview artifact={followUp} canReview executionMode="live"
        onEdit={vi.fn()} onApprove={vi.fn()} onReject={vi.fn()} />
      <AppFooter />
    </main>);
    expect(await screen.findByText('business@example.test → Business calendar (Europe/London)')).toBeVisible();
    const setup = screen.getByText('Manage Outlook connections').closest('details')!;
    expect(setup).not.toHaveAttribute('open');
    expect(screen.getByText('Business hours setup').closest('details')).not.toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'ADD OUTLOOK CONNECTION' })).not.toBeVisible();
    expect(screen.getByText('Completed customer meeting')).not.toBeVisible();
    if (process.env.REV_UI_VISUAL_FIXTURE) {
      const assets = join(process.cwd(), 'dist', 'assets');
      const css = readFileSync(join(assets, readdirSync(assets).find(name => name.endsWith('.css'))!), 'utf8');
      writeFileSync(process.env.REV_UI_VISUAL_FIXTURE, `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>REV local layout verification</title><style>${css}</style><body class="bg-neutral-50">${container.innerHTML}</body></html>`);
    }
    fireEvent.click(screen.getByText('Manage Outlook connections'));
    expect(screen.getByRole('button', { name: 'ADD OUTLOOK CONNECTION' })).toBeVisible();
  });

  it('collapses completed and older meetings into history without hiding uncertain outcomes or errors', () => {
    const completed = { ...action, id: 'completed', title: 'Completed meeting', status: 'completed' as const,
      meetingProposal: { ...action.meetingProposal!, title: 'Completed meeting' },
      meetingDryRun: { ...unknownResult, status: 'event_created' as const, providerOutcome: 'accepted_by_provider' as const, eventCreated: true as const } };
    const older = { ...action, id: 'older', meetingProposal: { ...action.meetingProposal!, title: 'Older proposal', endAt: '2020-01-01T10:00:00Z' } };
    const uncertain = { ...action, id: 'uncertain', meetingDryRun: unknownResult };
    render(<MeetingProposalGroups actions={[completed, older, uncertain]} now={Date.parse('2026-10-09')}
      needsAttention={item => item.meetingDryRun?.status === 'outcome_unknown'}
      renderAction={item => <MeetingProposalReviewCard key={item.id} action={item} canReview busy={false} onDecision={vi.fn()} />} />);
    expect(screen.getByText('Completed meeting')).not.toBeVisible();
    expect(screen.getByText('Older proposal')).not.toBeVisible();
    expect(screen.getByText('OUTCOME UNKNOWN — CHECK CALENDAR')).toBeVisible();
    fireEvent.click(screen.getByText('Meeting history (2)'));
    expect(screen.getByText('Completed meeting')).toBeVisible();
    expect(screen.getByText('EVENT CREATED', { selector: 'span' })).toBeVisible();
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
