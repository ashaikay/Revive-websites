import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MeetingProposalReviewCard } from '@/components/MeetingProposalReviewCard';
import {
  SupabasePreparedWorkRepository,
  type LivePendingAction,
  type LivePreparedWorkGateway,
} from '@/data/supabasePreparedWorkRepository';

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
