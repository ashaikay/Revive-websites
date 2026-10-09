// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingProposalReviewCard } from '@/components/MeetingProposalReviewCard';
import {
  mapMeetingReminderDraft,
  validateMeetingReminderDraftAttempt,
  type MeetingReminderDraft,
} from '@/domain/meetingReminder';
import { submitMeetingReminderDraft } from '@/services/meetingReminderService';
import type { LivePendingAction } from '@/data/supabasePreparedWorkRepository';

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
