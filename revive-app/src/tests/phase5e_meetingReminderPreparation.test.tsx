// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MeetingProposalReviewCard } from '@/components/MeetingProposalReviewCard';
import { EmailConversationHistory } from '@/components/REVInterface';
import {
  mapMeetingReminderDraft,
  validateMeetingReminderDraftAttempt,
  type MeetingReminderDraft,
} from '@/domain/meetingReminder';
import { submitMeetingReminderDraft } from '@/services/meetingReminderService';
import {
  browserSupabasePreparedWorkGateway,
  type LivePendingAction,
} from '@/data/supabasePreparedWorkRepository';

const supabaseQueryState = vi.hoisted(() => ({
  results: {} as Record<string, {
    data: Record<string, unknown>[] | null;
    error: { message: string; code?: string } | null;
  }>,
}));

vi.mock('@/data/supabaseClient', () => ({
  supabaseClient: {
    functions: { invoke: vi.fn() },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        in: () => query,
        order: () => query,
        then: (
          resolve: (value: unknown) => unknown,
          reject: (reason: unknown) => unknown,
        ) => Promise.resolve(
          supabaseQueryState.results[table] ?? { data: [], error: null },
        ).then(resolve, reject),
      };
      return query;
    },
  },
}));

const workspaceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const proposalId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const draftId = '55555555-5555-4555-8555-555555555555';
const action: LivePendingAction = {
  id: '66666666-6666-4666-8666-666666666666',
  workspaceId,
  actionType: 'meeting_proposal',
  title: 'Discovery call',
  description: 'Meeting proposal awaiting owner approval.',
  requiresApproval: true,
  status: 'completed',
  executionStatus: 'succeeded',
  proposedAt: '2026-10-09T09:00:00.000Z',
  actionVersion: 1,
  approvalId: '77777777-7777-4777-8777-777777777777',
  approvalActionVersion: 1,
  approvalActionFingerprint: 'a'.repeat(64),
  meetingProposalId: proposalId,
  meetingProposal: {
    title: 'Discovery call',
    attendeeEmail: 'customer@example.test',
    startAt: '2099-10-10T09:00:00.000Z',
    endAt: '2099-10-10T09:30:00.000Z',
    timezone: 'Europe/London',
    meetingMethod: 'online',
    locationDetails: '',
    notes: '',
  },
  meetingDryRun: {
    status: 'event_created',
    executionId: '88888888-8888-4888-8888-888888888888',
    providerOutcome: 'accepted_by_provider',
    providerInvoked: true,
    eventCreated: true,
    invitationSent: null,
  },
};
const reminder: MeetingReminderDraft = {
  id: draftId,
  workspaceId,
  meetingProposalId: proposalId,
  body: 'Please remember our confirmed discovery call.',
  preparedByUserId: actorId,
  version: 2,
  createdAt: '2026-10-09T12:00:00.000Z',
  updatedAt: '2026-10-09T12:30:00.000Z',
};

function pendingActionQueryResults() {
  return {
    rev_actions: {
      data: [{
        id: action.id,
        workspace_id: workspaceId,
        action_type: 'meeting_proposal',
        title: action.title,
        description: action.description,
        requires_approval: true,
        status: 'completed',
        execution_status: 'succeeded',
        proposed_at: action.proposedAt,
        action_version: 1,
      }],
      error: null,
    },
    approvals: {
      data: [{
        id: action.approvalId,
        workspace_id: workspaceId,
        rev_action_id: action.id,
        action_version: 1,
        action_fingerprint: 'a'.repeat(64),
        decision: 'approved',
      }],
      error: null,
    },
    meeting_proposals: {
      data: [{
        id: proposalId,
        rev_action_id: action.id,
        proposal_payload: action.meetingProposal,
      }],
      error: null,
    },
    rev_action_executions: {
      data: [{
        id: action.meetingDryRun!.executionId,
        action_id: action.id,
        correlation_id: '99999999-9999-4999-8999-999999999999',
        status: 'succeeded',
        mode: 'live',
        provider_outcome: 'accepted_by_provider',
      }],
      error: null,
    },
    meeting_reminder_drafts: {
      data: [],
      error: null,
    },
    meeting_outcomes: {
      data: [],
      error: null,
    },
  };
}

beforeEach(() => {
  supabaseQueryState.results = pendingActionQueryResults();
});

afterEach(() => cleanup());

describe('Phase 5E meeting reminder preparation', () => {
  it('keeps the authorized architecture, schema and boundary provider-free', () => {
    const architecture = readFileSync(join(process.cwd(), '..', 'REVIVE_AI_MASTER', '02_PHASES', 'PHASE_5A_CALENDAR_ARCHITECTURE.md'), 'utf8');
    const migration = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261009134000_rev_meeting_reminder_preparation.sql'), 'utf8');
    expect(architecture).toContain('one required plain-text body');
    expect(architecture).toContain('Reminder draft saved. Delivery is not enabled.');
    expect(migration).toContain('unique (workspace_id, meeting_proposal_id)');
    expect(migration).toContain("provider_outcome = 'accepted_by_provider'");
    expect(migration).toContain('meeting_reminder_draft.prepared');
    expect(migration).toContain('meeting_reminder_draft.corrected');
    expect(migration).toContain("array['owner', 'admin']");
    expect(migration).not.toMatch(/http_post|net\.http|sendmail|graph\.microsoft\.com/i);
  });

  it('validates only one trimmed plain-text body and version-bound input', () => {
    const valid = {
      workspaceId,
      requestId,
      meetingProposalId: proposalId,
      body: 'Please remember our confirmed discovery call.',
      expectedVersion: 0,
    };
    expect(validateMeetingReminderDraftAttempt(valid)).toEqual(valid);
    for (const patch of [
      { body: '' },
      { body: ' padded ' },
      { body: 'x'.repeat(2001) },
      { expectedVersion: -1 },
      { channel: 'email' },
    ]) {
      expect(() => validateMeetingReminderDraftAttempt({ ...valid, ...patch })).toThrow();
    }
  });

  it('accepts only an exact success envelope from the save client', async () => {
    const attempt = {
      workspaceId,
      requestId,
      meetingProposalId: proposalId,
      body: reminder.body,
      expectedVersion: 1,
    };
    const row = {
      id: draftId,
      workspace_id: workspaceId,
      meeting_proposal_id: proposalId,
      body: reminder.body,
      prepared_by_user_id: actorId,
      version: 2,
      created_at: reminder.createdAt,
      updated_at: reminder.updatedAt,
    };
    await expect(submitMeetingReminderDraft(attempt, vi.fn().mockResolvedValue({ status: 200, data: row })))
      .resolves.toEqual(mapMeetingReminderDraft(row, workspaceId));
    await expect(submitMeetingReminderDraft(attempt, vi.fn().mockResolvedValue({
      status: 200,
      data: { ...row, body: 'Different draft.' },
    }))).rejects.toThrow('unconfirmed');
  });

  it('prepares a manual draft and never presents sent or scheduled state', async () => {
    const onSaveReminder = vi.fn().mockResolvedValue(undefined);
    render(<MeetingProposalReviewCard action={action} canReview busy={false} onDecision={vi.fn()}
      onSaveReminder={onSaveReminder} />);
    fireEvent.click(screen.getByText('View details and actions'));
    expect(screen.getByText('No reminder draft has been prepared.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Prepare reminder draft' }));
    fireEvent.change(screen.getByLabelText('Reminder body'), {
      target: { value: '  Please remember our confirmed discovery call.  ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE REMINDER DRAFT' }));
    expect(onSaveReminder).toHaveBeenCalledWith({
      body: 'Please remember our confirmed discovery call.',
      expectedVersion: 0,
    });
    expect(screen.queryByText(/sent|scheduled/i)).not.toBeInTheDocument();
  });

  it('shows a durable saved draft and offers version-bound correction before the meeting', () => {
    const onSaveReminder = vi.fn().mockResolvedValue(undefined);
    render(<MeetingProposalReviewCard action={{ ...action, meetingReminderDraft: reminder }} canReview busy={false}
      onDecision={vi.fn()} onSaveReminder={onSaveReminder} />);
    fireEvent.click(screen.getByText('View details and actions'));
    expect(screen.getByText(reminder.body)).toBeVisible();
    expect(screen.getByText('Reminder draft saved. Delivery is not enabled.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Correct reminder draft' }));
    fireEvent.change(screen.getByLabelText('Reminder body'), { target: { value: 'Corrected reminder wording.' } });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE CORRECTION' }));
    expect(onSaveReminder).toHaveBeenCalledWith({
      body: 'Corrected reminder wording.',
      expectedVersion: 2,
    });
  });

  it('keeps email and meeting data available when reminder storage is missing', async () => {
    supabaseQueryState.results.meeting_reminder_drafts = {
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.meeting_reminder_drafts' in the schema cache",
      },
    };
    supabaseQueryState.results.meeting_outcomes = {
      data: [{
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        workspace_id: workspaceId,
        meeting_proposal_id: proposalId,
        outcome_type: 'held',
        summary: 'The meeting took place.',
        occurred_at: '2026-10-09T11:00:00.000Z',
        recorded_by_user_id: actorId,
        version: 1,
        created_at: '2026-10-09T11:05:00.000Z',
        updated_at: '2026-10-09T11:05:00.000Z',
      }],
      error: null,
    };
    const emailThreads = [{
      id: 'thread-1',
      workspaceId,
      subject: 'Project update',
      lastMessageAt: '2026-10-09T12:00:00.000Z',
      messages: [{
        id: 'message-1',
        workspaceId,
        threadId: 'thread-1',
        direction: 'inbound' as const,
        senderEmail: 'customer@example.test',
        recipientEmails: ['team@example.test'],
        subject: 'Project update',
        bodyText: 'The existing email history remains available.',
        communicationAt: '2026-10-09T12:00:00.000Z',
      }],
    }];

    const [pendingActions, loadedEmailThreads] = await Promise.all([
      browserSupabasePreparedWorkGateway.loadPendingActions!(workspaceId),
      Promise.resolve(emailThreads),
    ]);

    expect(pendingActions).toHaveLength(1);
    expect(pendingActions[0].meetingProposal).toEqual(action.meetingProposal);
    expect(pendingActions[0].meetingDryRun?.status).toBe('event_created');
    expect(pendingActions[0].meetingOutcome).toEqual(expect.objectContaining({
      outcomeType: 'held',
      summary: 'The meeting took place.',
    }));
    expect(pendingActions[0].meetingReminderUnavailable).toMatch(/has not been deployed/);
    expect(loadedEmailThreads).toEqual(emailThreads);

    render(<>
      <EmailConversationHistory threads={loadedEmailThreads} contacts={[]} opportunities={[]} />
      <MeetingProposalReviewCard action={pendingActions[0]} canReview busy={false}
        onDecision={vi.fn()} onSaveReminder={vi.fn()} />
    </>);
    expect(screen.getByText('EMAIL CONVERSATIONS')).toBeVisible();
    fireEvent.click(screen.getByText('View details and actions'));
    expect(screen.getByText(/Reminder drafts are unavailable because reminder storage has not been deployed/)).toBeVisible();
    expect(screen.queryByText('No reminder draft has been prepared.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prepare reminder draft' })).not.toBeInTheDocument();
  });

  it('keeps email and proposal data available while outcomes fail closed', async () => {
    supabaseQueryState.results.meeting_outcomes = {
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.meeting_outcomes' in the schema cache",
      },
    };

    const [loaded] = await browserSupabasePreparedWorkGateway.loadPendingActions!(workspaceId);

    expect(loaded.meetingProposal).toEqual(action.meetingProposal);
    expect(loaded.meetingDryRun?.status).toBe('event_created');
    expect(loaded.meetingReminderUnavailable).toBeUndefined();
    expect(loaded.meetingOutcomeUnavailable).toMatch(/has not been deployed/);

    render(<>
      <EmailConversationHistory threads={[]} contacts={[]} opportunities={[]} />
      <MeetingProposalReviewCard action={loaded} canReview busy={false}
        onDecision={vi.fn()} onSaveReminder={vi.fn()} onRecordOutcome={vi.fn()} />
    </>);
    expect(screen.getByText('EMAIL CONVERSATIONS')).toBeVisible();
    expect(screen.getByText('Discovery call')).toBeVisible();
    fireEvent.click(screen.getByText('View details and actions'));
    expect(screen.getByText(/Meeting outcomes are unavailable because outcome storage has not been deployed/)).toBeVisible();
    expect(screen.getByText(/Reminder preparation and correction are unavailable until meeting outcome storage can confirm/)).toBeVisible();
    expect(screen.queryByText('No meeting outcome has been recorded.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record meeting outcome' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Prepare reminder draft' })).not.toBeInTheDocument();

    cleanup();
    render(<MeetingProposalReviewCard action={{ ...loaded, meetingReminderDraft: reminder }}
      canReview busy={false} onDecision={vi.fn()} onSaveReminder={vi.fn()} onRecordOutcome={vi.fn()} />);
    fireEvent.click(screen.getByText('View details and actions'));
    expect(screen.getByText(reminder.body)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Correct reminder draft' })).not.toBeInTheDocument();
  });

  it('reports both optional stores independently when both tables are missing', async () => {
    supabaseQueryState.results.meeting_reminder_drafts = {
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.meeting_reminder_drafts' in the schema cache",
      },
    };
    supabaseQueryState.results.meeting_outcomes = {
      data: null,
      error: {
        code: 'PGRST205',
        message: "Could not find the table 'public.meeting_outcomes' in the schema cache",
      },
    };

    const [loaded] = await browserSupabasePreparedWorkGateway.loadPendingActions!(workspaceId);

    expect(loaded.meetingReminderUnavailable).toMatch(/reminder storage has not been deployed/);
    expect(loaded.meetingOutcomeUnavailable).toMatch(/outcome storage has not been deployed/);
    render(<MeetingProposalReviewCard action={loaded} canReview busy={false}
      onDecision={vi.fn()} onSaveReminder={vi.fn()} onRecordOutcome={vi.fn()} />);
    fireEvent.click(screen.getByText('View details and actions'));
    expect(screen.getByText(/Reminder drafts are unavailable because reminder storage has not been deployed/)).toBeVisible();
    expect(screen.getByText(/Meeting outcomes are unavailable because outcome storage has not been deployed/)).toBeVisible();
    expect(screen.queryByText('No reminder draft has been prepared.')).not.toBeInTheDocument();
    expect(screen.queryByText('No meeting outcome has been recorded.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reminder draft/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /meeting outcome/i })).not.toBeInTheDocument();
  });

  it('keeps email history collapsed but visibly accessible and usable', () => {
    const { container } = render(<EmailConversationHistory threads={[{
      id: 'thread-1',
      workspaceId,
      subject: 'Project update',
      lastMessageAt: '2026-10-09T12:00:00.000Z',
      messages: [{
        id: 'message-1',
        workspaceId,
        threadId: 'thread-1',
        direction: 'inbound',
        senderEmail: 'customer@example.test',
        recipientEmails: ['team@example.test'],
        subject: 'Project update',
        bodyText: 'The customer confirmed the next step.',
        communicationAt: '2026-10-09T12:00:00.000Z',
      }],
    }]} contacts={[]} opportunities={[]} />);

    const emailDisclosure = screen.getByText('EMAIL CONVERSATIONS').closest('details');
    expect(emailDisclosure).not.toHaveAttribute('open');
    expect(screen.getByText('READ-ONLY HISTORY')).toBeVisible();
    expect(container.querySelector('article h3')).not.toBeVisible();

    fireEvent.click(screen.getByText('View email history'));
    expect(emailDisclosure).toHaveAttribute('open');
    expect(container.querySelector('article h3')).toBeVisible();
    fireEvent.click(screen.getByText('View conversation (1)'));
    expect(screen.getByText('INBOUND')).toBeVisible();
  });

  it('loads saved reminder drafts when reminder storage is available', async () => {
    supabaseQueryState.results.meeting_reminder_drafts = {
      data: [{
        id: reminder.id,
        workspace_id: workspaceId,
        meeting_proposal_id: proposalId,
        body: reminder.body,
        prepared_by_user_id: actorId,
        version: reminder.version,
        created_at: reminder.createdAt,
        updated_at: reminder.updatedAt,
      }],
      error: null,
    };

    const [loaded] = await browserSupabasePreparedWorkGateway.loadPendingActions!(workspaceId);

    expect(loaded.meetingReminderDraft).toEqual(reminder);
    expect(loaded.meetingReminderUnavailable).toBeUndefined();
    expect(loaded.meetingOutcomeUnavailable).toBeUndefined();
  });

  it('retains accurate errors for unrelated pending-action query failures', async () => {
    supabaseQueryState.results.rev_actions = {
      data: null,
      error: { message: 'REV actions could not be loaded.' },
    };

    await expect(
      browserSupabasePreparedWorkGateway.loadPendingActions!(workspaceId),
    ).rejects.toThrow('REV actions could not be loaded.');
  });

  it('keeps an existing draft readable but disables editing after start or outcome', () => {
    const started = {
      ...action,
      meetingReminderDraft: reminder,
      meetingProposal: {
        ...action.meetingProposal!,
        startAt: '2026-10-08T09:00:00.000Z',
        endAt: '2026-10-08T09:30:00.000Z',
      },
    };
    const { rerender } = render(<MeetingProposalReviewCard action={started} canReview busy={false}
      onDecision={vi.fn()} onSaveReminder={vi.fn()} />);
    fireEvent.click(screen.getByText('View details and actions'));
    expect(screen.getByText(reminder.body)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Correct reminder draft' })).not.toBeInTheDocument();
    expect(screen.getByText('Editing is unavailable after the meeting starts or an explicit outcome is recorded.')).toBeVisible();

    rerender(<MeetingProposalReviewCard action={{ ...action, meetingReminderDraft: reminder, meetingOutcome: {
      id: '99999999-9999-4999-8999-999999999999',
      workspaceId,
      meetingProposalId: proposalId,
      outcomeType: 'cancelled',
      summary: 'Customer cancelled.',
      occurredAt: '2026-10-09T12:00:00.000Z',
      recordedByUserId: actorId,
      version: 1,
      createdAt: '2026-10-09T12:00:00.000Z',
      updatedAt: '2026-10-09T12:00:00.000Z',
    } }} canReview busy={false} onDecision={vi.fn()} onSaveReminder={vi.fn()} />);
    expect(screen.getByText(reminder.body)).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Correct reminder draft' })).not.toBeInTheDocument();
  });
});
