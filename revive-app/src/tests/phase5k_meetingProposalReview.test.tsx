import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MeetingProposalReviewCard } from '@/components/MeetingProposalReviewCard';
import {
  SupabasePreparedWorkRepository,
  type LivePendingAction,
  type LivePreparedWorkGateway,
} from '@/data/supabasePreparedWorkRepository';
import {
  requestMeetingDryRun,
  type MeetingDryRunResult,
  type MeetingExecutionInvoker,
} from '@/services/meetingExecutionClient';

const action: LivePendingAction = {
  id: 'action-1', workspaceId: 'workspace-1', actionType: 'meeting_proposal', title: 'Discovery call',
  description: 'Meeting proposal awaiting owner approval.', rationale: 'meeting-proposal:v1:secret-internal-fingerprint',
  requiresApproval: true, status: 'awaiting_approval', executionStatus: 'not_executed', proposedAt: '2030-09-29T00:00:00.000Z',
  actionVersion: 1, approvalId: 'approval-1', approvalActionVersion: 1, approvalActionFingerprint: 'a'.repeat(64),
  meetingProposal: {
    title: 'Discovery call', attendeeEmail: 'customer@example.test', startAt: '2030-09-30T09:00:00.000Z',
    endAt: '2030-09-30T09:30:00.000Z', timezone: 'Europe/London', meetingMethod: 'online',
    locationDetails: 'Teams details supplied after booking', notes: 'Discuss requirements.',
  },
};

const requestId = '11111111-1111-4111-8111-111111111111';
const executionId = '22222222-2222-4222-8222-222222222222';
const disabledResult: MeetingDryRunResult = {
  status: 'provider_disabled', displayStatus: 'DRY RUN — NOTHING BOOKED', executionEnabled: false,
  providerInvoked: false, eventCreated: false, executionId, correlationId: requestId,
  providerOutcome: 'provider_not_invoked',
};

describe('Phase 5K supervised meeting proposal review', () => {
  it('renders the exact proposal snapshot without internal markers or mutation claims', () => {
    const markup = renderToStaticMarkup(<MeetingProposalReviewCard action={action} canReview busy={false} onDecision={vi.fn()} />);
    expect(markup).toContain('MEETING PROPOSAL — NOT BOOKED');
    expect(markup).toContain('customer@example.test');
    expect(markup).toContain('Europe/London');
    expect(markup).toContain('Online');
    expect(markup).toContain('Discuss requirements.');
    expect(markup).toContain('APPROVE PROPOSAL');
    expect(markup).toContain('REJECT PROPOSAL');
    expect(markup).toContain('Approval does not book an event or send an invitation.');
    expect(markup).not.toContain('secret-internal-fingerprint');
    expect(markup).not.toMatch(/BOOK MEETING|CREATE EVENT|SEND INVITATION/i);
  });

  it('submits the saved approval version and fingerprint unchanged', async () => {
    const decideApproval = vi.fn<LivePreparedWorkGateway['decideApproval']>().mockResolvedValue();
    const repository = new SupabasePreparedWorkRepository({ decideApproval } as unknown as LivePreparedWorkGateway);

    await repository.decidePendingAction(action, 'approved');

    expect(decideApproval).toHaveBeenCalledWith({
      approvalId: 'approval-1',
      actionVersion: 1,
      actionFingerprint: 'a'.repeat(64),
      decision: 'approved',
    });
  });

  it('keeps decision controls owner/admin-only and fails closed without the trusted snapshot', () => {
    const memberMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={action} canReview={false} busy={false} onDecision={vi.fn()} />);
    expect(memberMarkup).not.toContain('APPROVE PROPOSAL');
    expect(memberMarkup).not.toContain('REJECT PROPOSAL');
    const unavailableMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={{ ...action, meetingProposal: undefined }} canReview busy={false} onDecision={vi.fn()} />);
    expect(unavailableMarkup).toContain('Meeting proposal unavailable');
    expect(unavailableMarkup).not.toContain('APPROVE PROPOSAL');
  });

  it('offers an owner/admin one-shot reservation only after approval', () => {
    const approved = { ...action, status: 'approved' as const };
    const ownerMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview busy={false} onDecision={vi.fn()} onRequestDryRun={vi.fn()} />);
    const busyMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview busy={false} onDecision={vi.fn()} executionBusy onRequestDryRun={vi.fn()} />);
    const memberMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview={false} busy={false} onDecision={vi.fn()} onRequestDryRun={vi.fn()} />);
    const completedMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview busy={false} onDecision={vi.fn()} executionResult={disabledResult} onRequestDryRun={vi.fn()} />);

    expect(ownerMarkup).toContain('RECORD DRY-RUN RESERVATION');
    expect(ownerMarkup).not.toContain('APPROVE PROPOSAL');
    expect(busyMarkup).toMatch(/<button[^>]*disabled=""[^>]*>RECORDING\.\.\.<\/button>/);
    expect(memberMarkup).not.toContain('RECORD DRY-RUN RESERVATION');
    expect(completedMarkup).toContain('DRY RUN — NOTHING BOOKED');
    expect(completedMarkup).toContain('no invitation was sent');
    expect(completedMarkup).not.toContain('RECORD DRY-RUN RESERVATION');
  });

  it('sends only generated request, workspace and action IDs and accepts the disabled envelope', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId);
    const invoke = vi.fn<MeetingExecutionInvoker>().mockResolvedValue({ data: disabledResult, error: null });

    await expect(requestMeetingDryRun('workspace-1', 'action-1', invoke)).resolves.toEqual(disabledResult);
    expect(invoke).toHaveBeenCalledWith('rev-meeting-execute', {
      body: { requestId, workspaceId: 'workspace-1', actionId: 'action-1' },
    });
    expect(Object.keys(invoke.mock.calls[0][1].body)).toEqual(['requestId', 'workspaceId', 'actionId']);
    vi.restoreAllMocks();
  });

  it.each([
    { status: 'event_created' },
    { executionEnabled: true },
    { providerInvoked: true },
    { eventCreated: true },
    { providerOutcome: 'accepted_by_provider' },
    { executionId: 'invalid' },
    { correlationId: '33333333-3333-4333-8333-333333333333' },
  ])('rejects an unsafe meeting execution response: %o', async (override) => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId);
    const invoke = vi.fn<MeetingExecutionInvoker>().mockResolvedValue({ data: { ...disabledResult, ...override }, error: null });
    await expect(requestMeetingDryRun('workspace-1', 'action-1', invoke)).rejects.toThrow(/unsafe response/);
    vi.restoreAllMocks();
  });

  it('reuses the fingerprint-bound owner/admin approval RPC and introduces no provider mutation', () => {
    const repository = readFileSync(new URL('../data/supabasePreparedWorkRepository.ts', import.meta.url), 'utf8');
    const workspace = readFileSync(new URL('../components/REVInterface.tsx', import.meta.url), 'utf8');
    const card = readFileSync(new URL('../components/MeetingProposalReviewCard.tsx', import.meta.url), 'utf8');
    const migration = readFileSync(new URL('../../supabase/migrations/20260914183000_rev_execution_control_plane.sql', import.meta.url), 'utf8');
    expect(repository).toContain("rpc('decide_rev_action_approval'");
    expect(repository).toContain(".from('meeting_proposals')");
    expect(migration).toContain("array['owner', 'admin']");
    expect(migration).toContain('stale approval review');
    expect(workspace).toContain('APPROVED — NOT BOOKED');
    expect(workspace).toContain('REJECTED — NOT BOOKED');
    expect(`${workspace}\n${card}`).not.toMatch(/functions\.invoke\([^)]*(event|calendar)|Calendars\.ReadWrite|\/events|createEvent|sendMail/i);
  });
});
