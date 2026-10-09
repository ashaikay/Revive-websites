// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MeetingProposalReviewCard } from '@/components/MeetingProposalReviewCard';
import {
  mapMeetingOutcome,
  validateMeetingOutcomeAttempt,
  type MeetingOutcome,
} from '@/domain/meetingOutcome';
import { submitMeetingOutcome } from '@/services/meetingOutcomeService';
import type { LivePendingAction } from '@/data/supabasePreparedWorkRepository';

const workspaceId = '11111111-1111-4111-8111-111111111111';
const actorId = '22222222-2222-4222-8222-222222222222';
const proposalId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const outcomeId = '55555555-5555-4555-8555-555555555555';
const action: LivePendingAction = {
  id: '66666666-6666-4666-8666-666666666666',
  workspaceId,
  actionType: 'meeting_proposal',
  title: 'Discovery call',
  description: 'Meeting proposal awaiting owner approval.',
  requiresApproval: true,
  status: 'approved',
  executionStatus: 'succeeded',
  proposedAt: '2026-10-08T09:00:00.000Z',
  actionVersion: 1,
  approvalId: '77777777-7777-4777-8777-777777777777',
  approvalActionVersion: 1,
  approvalActionFingerprint: 'a'.repeat(64),
  meetingProposalId: proposalId,
  meetingProposal: {
    title: 'Discovery call',
    attendeeEmail: 'customer@example.test',
    startAt: '2026-10-09T09:00:00.000Z',
    endAt: '2026-10-09T09:30:00.000Z',
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
const outcome: MeetingOutcome = {
  id: outcomeId,
  workspaceId,
  meetingProposalId: proposalId,
  outcomeType: 'no_show',
  summary: 'Customer did not attend; contact them to agree a next step.',
  occurredAt: '2026-10-09T09:30:00.000Z',
  recordedByUserId: actorId,
  version: 2,
  createdAt: '2026-10-09T10:00:00.000Z',
  updatedAt: '2026-10-09T10:30:00.000Z',
};

afterEach(() => cleanup());

describe('Phase 5E.1 explicit meeting outcomes', () => {
  it('keeps the agreed contract aligned across architecture, database, boundary and domain', () => {
    const architecture = readFileSync(join(process.cwd(), '..', 'REVIVE_AI_MASTER', '02_PHASES', 'PHASE_5A_CALENDAR_ARCHITECTURE.md'), 'utf8');
    const migration = readFileSync(join(process.cwd(), 'supabase', 'migrations', '20261009123000_rev_meeting_outcomes.sql'), 'utf8');
    const boundary = readFileSync(join(process.cwd(), 'supabase', 'functions', 'rev-meeting-outcome-save', 'meetingOutcomeBoundary.ts'), 'utf8');
    for (const value of ['held', 'no_show', 'cancelled']) {
      expect(architecture).toContain(`\`${value}\``);
      expect(migration).toContain(`'${value}'`);
      expect(boundary).toContain(`'${value}'`);
    }
    expect(migration).toContain('unique (workspace_id, meeting_proposal_id)');
    expect(migration).toContain('meeting_outcome.recorded');
    expect(migration).toContain('meeting_outcome.corrected');
    expect(migration).not.toMatch(/update public\.(opportunities|goals)|microsoft_graph|http_post|net\.http/i);
  });

  it('enforces the agreed types, trimmed summary and non-future UTC time in the domain', () => {
    const valid = {
      workspaceId,
      requestId,
      meetingProposalId: proposalId,
      outcomeType: 'held' as const,
      summary: 'Requirements confirmed; prepare the next proposal.',
      occurredAt: '2026-10-09T09:30:00.000Z',
      expectedVersion: 0,
    };
    expect(validateMeetingOutcomeAttempt(valid, Date.parse('2026-10-09T10:00:00.000Z'))).toEqual(valid);
    for (const patch of [
      { outcomeType: 'rescheduled' },
      { outcomeType: 'sale' },
      { summary: '' },
      { summary: ' padded ' },
      { occurredAt: '2026-10-09T10:00:01.000Z' },
      { expectedVersion: -1 },
    ]) {
      expect(() => validateMeetingOutcomeAttempt({ ...valid, ...patch }, Date.parse('2026-10-09T10:00:00.000Z'))).toThrow();
    }
  });

  it('accepts only an exact success envelope from the save client', async () => {
    const attempt = {
      workspaceId,
      requestId,
      meetingProposalId: proposalId,
      outcomeType: 'held' as const,
      summary: 'Requirements confirmed; prepare the next proposal.',
      occurredAt: '2026-10-09T09:30:00.000Z',
      expectedVersion: 0,
    };
    const row = {
      id: outcomeId,
      workspace_id: workspaceId,
      meeting_proposal_id: proposalId,
      outcome_type: 'held',
      summary: attempt.summary,
      occurred_at: attempt.occurredAt,
      recorded_by_user_id: actorId,
      version: 1,
      created_at: '2026-10-09T10:00:00.000Z',
      updated_at: '2026-10-09T10:00:00.000Z',
    };
    await expect(submitMeetingOutcome(attempt, vi.fn().mockResolvedValue({ status: 200, data: row })))
      .resolves.toEqual(mapMeetingOutcome(row, workspaceId));
    await expect(submitMeetingOutcome(attempt, vi.fn().mockResolvedValue({
      status: 200,
      data: { ...row, outcome_type: 'cancelled' },
    }))).rejects.toThrow('unconfirmed');
  });

  it('shows a clear empty state and records one of the agreed outcomes inside proposal details', async () => {
    const onRecordOutcome = vi.fn().mockResolvedValue(undefined);
    render(<MeetingProposalReviewCard action={action} canReview busy={false} onDecision={vi.fn()}
      onRecordOutcome={onRecordOutcome} />);
    fireEvent.click(screen.getByText('View details and actions'));
    expect(screen.getByText('No meeting outcome has been recorded.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Record meeting outcome' }));
    fireEvent.change(screen.getByLabelText('Outcome'), { target: { value: 'cancelled' } });
    expect(screen.getByText('Recording “Cancelled” here does not cancel the Outlook event or notify anyone.')).toBeVisible();
    fireEvent.change(screen.getByLabelText('When this outcome occurred'), { target: { value: '2026-10-09T10:00' } });
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Customer cancelled; contact them before proposing another time.' } });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE OUTCOME' }));
    expect(onRecordOutcome).toHaveBeenCalledWith({
      outcomeType: 'cancelled',
      summary: 'Customer cancelled; contact them before proposing another time.',
      occurredAt: new Date('2026-10-09T10:00').toISOString(),
      expectedVersion: 0,
    });
  });

  it('keeps booking status separate from a saved outcome and offers version-bound correction', () => {
    const onRecordOutcome = vi.fn().mockResolvedValue(undefined);
    render(<MeetingProposalReviewCard action={{ ...action, meetingOutcome: outcome }} canReview busy={false}
      onDecision={vi.fn()} onRecordOutcome={onRecordOutcome} />);
    expect(screen.getAllByText('EVENT CREATED')[0]).toBeVisible();
    fireEvent.click(screen.getByText('View details and actions'));
    expect(screen.getByText(/Customer did not attend/)).toBeVisible();
    expect(screen.getByText('This manually recorded outcome is separate from booking and RSVP status.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Correct meeting outcome' }));
    fireEvent.change(screen.getByLabelText('Summary'), { target: { value: 'Corrected summary.' } });
    fireEvent.click(screen.getByRole('button', { name: 'SAVE CORRECTION' }));
    expect(onRecordOutcome).toHaveBeenCalledWith(expect.objectContaining({
      outcomeType: 'no_show',
      summary: 'Corrected summary.',
      expectedVersion: 2,
    }));
  });

  it('withholds recording from non-managers while preserving the saved result', () => {
    render(<MeetingProposalReviewCard action={{ ...action, meetingOutcome: outcome }} canReview={false}
      busy={false} onDecision={vi.fn()} onRecordOutcome={vi.fn()} />);
    fireEvent.click(screen.getByText('View details and actions'));
    expect(screen.getByText(/Customer did not attend/)).toBeVisible();
    expect(screen.queryByRole('button', { name: /meeting outcome/i })).toBeNull();
  });
});
