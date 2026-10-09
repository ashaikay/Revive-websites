import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MeetingProposalReviewCard } from '@/components/MeetingProposalReviewCard';
import {
  SupabasePreparedWorkRepository,
  mapMeetingExecutionRow,
  type LivePendingAction,
  type LivePreparedWorkGateway,
} from '@/data/supabasePreparedWorkRepository';
import {
  MeetingExecutionClientError,
  meetingExecutionFailureMessage,
  requestMeetingExecution,
  type MeetingDryRunResult,
  type MeetingProviderResult,
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
const providerResults: MeetingProviderResult[] = [
  { status: 'event_created', executionId, providerOutcome: 'accepted_by_provider', providerInvoked: true, eventCreated: true, invitationSent: null },
  { status: 'provider_rejected', executionId, providerOutcome: 'rejected_by_provider', providerInvoked: true, eventCreated: false, invitationSent: false },
  { status: 'outcome_unknown', executionId, providerOutcome: 'provider_outcome_unknown', providerInvoked: true, eventCreated: null, invitationSent: null },
];

describe('Phase 5K supervised meeting proposal review', () => {
  it('renders the exact proposal snapshot without internal markers or mutation claims', () => {
    const markup = renderToStaticMarkup(<MeetingProposalReviewCard action={action} canReview busy={false} onDecision={vi.fn()} />);
    expect(markup).toContain('NOT BOOKED — APPROVAL NEEDED');
    expect(markup).toContain('customer@example.test');
    expect(markup).toContain('Europe/London');
    expect(markup).toContain('Online');
    expect(markup).toContain('Discuss requirements.');
    expect(markup).toContain('APPROVE PROPOSAL');
    expect(markup).toContain('REJECT PROPOSAL');
    expect(markup).toContain('Approval alone does not book the meeting.');
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

  it('keeps dry-run available but hides live booking by default after approval', () => {
    vi.stubEnv('VITE_REV_MEETING_LIVE_UI_ENABLED', undefined);
    const approved = { ...action, status: 'approved' as const };
    const ownerMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview busy={false} onDecision={vi.fn()} onRequestDryRun={vi.fn()} onRequestLive={vi.fn()} />);
    const busyMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview busy={false} onDecision={vi.fn()} executionBusy onRequestDryRun={vi.fn()} />);
    const memberMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview={false} busy={false} onDecision={vi.fn()} onRequestDryRun={vi.fn()} />);
    const completedMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview busy={false} onDecision={vi.fn()} executionResult={disabledResult} onRequestDryRun={vi.fn()} />);

    expect(ownerMarkup).toContain('CHECK BOOKING SETUP');
    expect(ownerMarkup).not.toContain('CREATE LIVE CALENDAR EVENT');
    expect(ownerMarkup).not.toContain('APPROVE PROPOSAL');
    expect(busyMarkup).toMatch(/<button[^>]*disabled=""[^>]*>CHECKING BOOKING SETUP…<\/button>/);
    expect(memberMarkup).not.toContain('CHECK BOOKING SETUP');
    expect(memberMarkup).not.toContain('CREATE LIVE CALENDAR EVENT');
    expect(completedMarkup).toContain('BOOKING CHECK — NOTHING BOOKED');
    expect(completedMarkup).toContain('no invitation was sent');
    expect(completedMarkup).not.toContain('CHECK BOOKING SETUP');

    const refreshedMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={{ ...approved, meetingDryRun: disabledResult }} canReview busy={false} onDecision={vi.fn()} onRequestDryRun={vi.fn()} />);
    expect(refreshedMarkup).toContain('BOOKING CHECK — NOTHING BOOKED');
    expect(refreshedMarkup).toContain('no invitation was sent');
    expect(refreshedMarkup).not.toContain('CHECK BOOKING SETUP');
    vi.unstubAllEnvs();
  });

  it('shows live booking only when the display flag is explicitly true', () => {
    vi.stubEnv('VITE_REV_MEETING_LIVE_UI_ENABLED', 'true');
    const approved = { ...action, status: 'approved' as const };
    const ownerMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview busy={false}
      onDecision={vi.fn()} onRequestDryRun={vi.fn()} onRequestLive={vi.fn()} />);
    const memberMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview={false} busy={false}
      onDecision={vi.fn()} onRequestDryRun={vi.fn()} onRequestLive={vi.fn()} />);

    expect(ownerMarkup).toContain('CHECK BOOKING SETUP');
    expect(ownerMarkup).toContain('CREATE LIVE CALENDAR EVENT');
    expect(memberMarkup).not.toContain('CREATE LIVE CALENDAR EVENT');
    vi.unstubAllEnvs();
  });

  it('requires a separate confirmation before live booking and describes the selected calendar and invitation risk', () => {
    const card = readFileSync(new URL('../components/MeetingProposalReviewCard.tsx', import.meta.url), 'utf8');
    expect(card).toContain("onClick={() => setConfirmLiveBooking(true)}");
    expect(card).toContain('This will create an event in the workspace’s selected Outlook calendar and may send an invitation to the approved attendee.');
    expect(card).toContain('CONFIRM LIVE BOOKING');
    expect(card).toContain('onClick={onRequestLive}');
  });

  it('sends explicit dry-run intent and accepts only the disabled envelope', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId);
    const invoke = vi.fn<MeetingExecutionInvoker>().mockResolvedValue({ data: disabledResult, error: null });

    await expect(requestMeetingExecution('workspace-1', 'action-1', { intent: 'dry_run' }, invoke)).resolves.toEqual(disabledResult);
    expect(invoke).toHaveBeenCalledWith('rev-meeting-execute', {
      body: { requestId, workspaceId: 'workspace-1', actionId: 'action-1', intent: 'dry_run' },
    });
    expect(Object.keys(invoke.mock.calls[0][1].body)).toEqual(['requestId', 'workspaceId', 'actionId', 'intent']);
    vi.restoreAllMocks();
  });

  it('sends live intent only with explicit confirmation and dry-run rejects a live response', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId);
    const liveInvoke = vi.fn<MeetingExecutionInvoker>().mockResolvedValue({ data: providerResults[0], error: null });
    await expect(requestMeetingExecution('workspace-1', 'action-1',
      { intent: 'live', confirmLiveBooking: true }, liveInvoke)).resolves.toEqual(providerResults[0]);
    expect(liveInvoke).toHaveBeenCalledWith('rev-meeting-execute', { body: {
      requestId, workspaceId: 'workspace-1', actionId: 'action-1', intent: 'live', confirmLiveBooking: true,
    } });
    await expect(requestMeetingExecution('workspace-1', 'action-1',
      { intent: 'dry_run' }, liveInvoke)).rejects.toMatchObject({ kind: 'malformed_success' });
    vi.restoreAllMocks();
  });

  it('distinguishes a definite server refusal, transport failure and malformed success without exposing technical errors', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId);
    const refused = vi.fn<MeetingExecutionInvoker>().mockResolvedValue({
      data: null, error: { message: 'private server detail', context: { status: 401 } },
    });
    await expect(requestMeetingExecution('workspace-1', 'action-1',
      { intent: 'live', confirmLiveBooking: true }, refused)).rejects.toMatchObject({
      kind: 'server_refusal', status: 401,
    });

    const disconnected = vi.fn<MeetingExecutionInvoker>().mockRejectedValue(new TypeError('Failed to fetch'));
    await expect(requestMeetingExecution('workspace-1', 'action-1',
      { intent: 'live', confirmLiveBooking: true }, disconnected)).rejects.toMatchObject({
      kind: 'transport_failure',
    });

    const malformed = vi.fn<MeetingExecutionInvoker>().mockResolvedValue({ data: { status: 'event_created' }, error: null });
    await expect(requestMeetingExecution('workspace-1', 'action-1',
      { intent: 'live', confirmLiveBooking: true }, malformed)).rejects.toMatchObject({
      kind: 'malformed_success',
    });
    expect(meetingExecutionFailureMessage(new MeetingExecutionClientError('server_refusal', 401),
      { intent: 'live', confirmLiveBooking: true })).toContain('No booking request was accepted.');
    expect(meetingExecutionFailureMessage(new MeetingExecutionClientError('transport_failure'),
      { intent: 'live', confirmLiveBooking: true })).toContain('Do not retry this attempt.');
    expect(meetingExecutionFailureMessage(new MeetingExecutionClientError('malformed_success'),
      { intent: 'live', confirmLiveBooking: true })).toContain('The event may have been created.');
    expect(meetingExecutionFailureMessage(new MeetingExecutionClientError('server_outcome_unknown', 403),
      { intent: 'live', confirmLiveBooking: true })).toContain('The server could not confirm the booking result.');
    vi.restoreAllMocks();
  });

  it('accepts a validated provider rejection from the server refusal response', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId);
    const invoke = vi.fn<MeetingExecutionInvoker>().mockResolvedValue({
      data: null,
      error: { context: new Response(JSON.stringify(providerResults[1]), { status: 409 }) },
    });
    await expect(requestMeetingExecution('workspace-1', 'action-1',
      { intent: 'live', confirmLiveBooking: true }, invoke)).resolves.toEqual(providerResults[1]);
    vi.restoreAllMocks();
  });

  it.each(providerResults)('accepts the existing server response: $status', async (result) => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue(requestId);
    const invoke = vi.fn<MeetingExecutionInvoker>().mockResolvedValue({ data: result, error: null });
    await expect(requestMeetingExecution('workspace-1', 'action-1',
      { intent: 'live', confirmLiveBooking: true }, invoke)).resolves.toEqual(result);
    vi.restoreAllMocks();
  });

  it('renders provider outcomes without claiming unproven invitation delivery', () => {
    const approved = { ...action, status: 'approved' as const };
    const createdMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview busy={false} onDecision={vi.fn()} executionResult={providerResults[0]} />);
    const rejectedMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview busy={false} onDecision={vi.fn()} executionResult={providerResults[1]} />);
    const unknownMarkup = renderToStaticMarkup(<MeetingProposalReviewCard action={approved} canReview busy={false} onDecision={vi.fn()} executionResult={providerResults[2]} />);

    expect(createdMarkup).toContain('EVENT CREATED');
    expect(createdMarkup).toContain('Invitation delivery was not confirmed.');
    expect(createdMarkup).not.toMatch(/invitation (?:was )?sent/i);
    expect(rejectedMarkup).toContain('EVENT NOT CREATED');
    expect(rejectedMarkup).toContain('no invitation was sent');
    expect(unknownMarkup).toContain('OUTCOME UNKNOWN — CHECK CALENDAR');
    expect(unknownMarkup).toContain('Event creation and invitation delivery could not be confirmed.');
    expect(unknownMarkup).toContain('Check the selected Outlook calendar');
    expect(unknownMarkup).toContain('Do not retry this attempt.');
  });

  it('keeps a completed accepted meeting visible after refresh with no booking control', async () => {
    const persistedResult = mapMeetingExecutionRow({ id: executionId, action_id: action.id,
      status: 'succeeded', mode: 'live', provider_outcome: 'accepted_by_provider' });
    const completed = { ...action, status: 'completed' as const, executionStatus: 'succeeded' as const,
      meetingDryRun: persistedResult };
    const repository = new SupabasePreparedWorkRepository({
      loadPendingActions: async (workspaceId: string) => workspaceId === action.workspaceId ? [completed] : [],
    } as unknown as LivePreparedWorkGateway);

    const refreshed = await repository.listPendingActions(action.workspaceId);
    const markup = renderToStaticMarkup(<MeetingProposalReviewCard action={refreshed[0]} canReview busy={false}
      onDecision={vi.fn()} onRequestDryRun={vi.fn()} onRequestLive={vi.fn()} />);

    expect(markup).toContain('EVENT CREATED');
    expect(markup).toContain('Invitation delivery was not confirmed');
    expect(markup).not.toContain('CHECK BOOKING SETUP');
    expect(markup).not.toContain('CREATE LIVE CALENDAR EVENT');
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
    await expect(requestMeetingExecution('workspace-1', 'action-1', { intent: 'dry_run' }, invoke)).rejects.toMatchObject({
      kind: 'malformed_success',
    });
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
    expect(card).toContain('APPROVED — NOT BOOKED');
    expect(card).toContain('REJECTED — NOT BOOKED');
    expect(`${workspace}\n${card}`).not.toMatch(/functions\.invoke\([^)]*(event|calendar)|Calendars\.ReadWrite|\/events|createEvent|sendMail/i);
  });
});
