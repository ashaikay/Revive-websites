import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CalendarAvailabilityPanel } from '@/components/CalendarAvailabilityPanel';
import { submitMeetingProposal } from '@/services/meetingProposalSubmissionClient';
import type { PreparedMeetingProposal } from '@/services/meetingProposalService';
import {
  handleMeetingProposalSubmission,
  type MeetingProposalSubmissionDependencies,
} from '../../supabase/functions/rev-meeting-proposal-submit/meetingProposalSubmissionBoundary';

const proposal: PreparedMeetingProposal = {
  title: 'Discovery call', attendeeEmail: 'customer@example.test', startAt: '2030-09-30T09:00:00.000Z', endAt: '2030-09-30T09:30:00.000Z', timezone: 'Europe/London', meetingMethod: 'online', locationDetails: '', notes: '',
};
function post(body: unknown = { workspaceId: 'workspace-1', ...proposal }, authorization = 'Bearer token'): Request {
  return new Request('https://example.test/functions/v1/rev-meeting-proposal-submit', { method: 'POST', headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
function dependencies(overrides: Partial<MeetingProposalSubmissionDependencies> = {}): MeetingProposalSubmissionDependencies {
  return {
    getAuthenticatedUserId: vi.fn().mockResolvedValue('user-1'),
    hasActiveWorkspaceMembership: vi.fn().mockResolvedValue(true),
    resolveTrustedConfiguration: vi.fn().mockReturnValue({ selectedCalendar: { workspaceId: 'workspace-1', timezone: 'Europe/London' } }),
    submit: vi.fn().mockResolvedValue({ actionId: 'action-1', approvalId: 'approval-1', actionStatus: 'awaiting_approval', executionStatus: 'not_executed', created: true }),
    now: () => '2030-09-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('Phase 5J durable supervised meeting proposal submission', () => {
  it('authenticates an active member, binds trusted timezone without Graph access, and returns only state', async () => {
    const deps = dependencies();
    const response = await handleMeetingProposalSubmission(post(), deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ actionId: 'action-1', approvalId: 'approval-1', actionStatus: 'awaiting_approval', executionStatus: 'not_executed', created: true });
    expect(deps.resolveTrustedConfiguration).toHaveBeenCalledWith('workspace-1', proposal.startAt, proposal.endAt, 'Europe/London');
    expect(deps.submit).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, 401],
    [{ ...proposal, workspaceId: 'workspace-1', actionId: 'browser-action' }, 400],
    [{ ...proposal, workspaceId: 'workspace-1', provider: 'microsoft_graph' }, 400],
    [{ ...proposal, workspaceId: 'workspace-1', eventId: 'event' }, 400],
    [{ ...proposal, workspaceId: 'workspace-1', title: '   ' }, 400],
    [{ ...proposal, workspaceId: 'workspace-1', startAt: '2030-09-30T09:00:00.000Z', endAt: '2030-09-30T10:15:00.000Z' }, 400],
  ])('rejects unauthenticated, forbidden, or invalid payloads without durable submission', async (body, expectedStatus) => {
    const deps = dependencies();
    const response = await handleMeetingProposalSubmission(post(body, body === undefined ? '' : 'Bearer token'), deps);
    expect(response.status).toBe(expectedStatus);
    expect(deps.submit).not.toHaveBeenCalled();
  });

  it('denies inactive members and mismatched trusted timezones without provider or persistence calls', async () => {
    const inactive = dependencies({ hasActiveWorkspaceMembership: vi.fn().mockResolvedValue(false) });
    expect((await handleMeetingProposalSubmission(post(), inactive)).status).toBe(403);
    expect(inactive.submit).not.toHaveBeenCalled();
    const mismatch = dependencies({ resolveTrustedConfiguration: vi.fn().mockReturnValue({ selectedCalendar: { workspaceId: 'workspace-1', timezone: 'UTC' } }) });
    expect((await handleMeetingProposalSubmission(post(), mismatch)).status).toBe(403);
    expect(mismatch.submit).not.toHaveBeenCalled();
  });

  it('returns an idempotent retry with its actual current durable states', async () => {
    const deps = dependencies({ submit: vi.fn().mockResolvedValue({ actionId: 'action-1', approvalId: 'approval-1', actionStatus: 'approved', executionStatus: 'not_executed', created: false }) });
    const response = await handleMeetingProposalSubmission(post(), deps);
    expect(await response.json()).toEqual({ actionId: 'action-1', approvalId: 'approval-1', actionStatus: 'approved', executionStatus: 'not_executed', created: false });
  });

  it('has semantic retry support, atomic action/approval schema, and no provider or sensitive logging path', async () => {
    const migration = readFileSync(new URL('../../supabase/migrations/20260925000000_rev_meeting_proposal_submission.sql', import.meta.url), 'utf8');
    const controlPlaneMigration = readFileSync(new URL('../../supabase/migrations/20260914183000_rev_execution_control_plane.sql', import.meta.url), 'utf8');
    const boundary = readFileSync(new URL('../../supabase/functions/rev-meeting-proposal-submit/meetingProposalSubmissionBoundary.ts', import.meta.url), 'utf8');
    expect(migration).toContain('unique (workspace_id, semantic_fingerprint)');
    expect(migration).toContain('pg_catalog.pg_advisory_xact_lock');
    expect(migration).not.toContain("current_user <> 'service_role'");
    expect(migration).toContain("'meeting-proposal:v1:' || target_semantic_fingerprint");
    expect(migration).toContain('and user_id = target_submitted_by');
    expect(migration).toContain('submitted_by = auth.uid()');
    expect(migration).toContain("array['owner', 'admin']");
    expect(controlPlaneMigration).toContain('approvals_workspace_action_id_key unique (workspace_id, rev_action_id, id)');
    expect(migration).toContain("'awaiting_approval'");
    expect(migration).toContain("'not_executed'");
    expect(migration).toContain('insert into public.approvals');
    expect(migration).toContain('revoke all on table public.meeting_proposals from anon, authenticated');
    expect(migration).toContain('grant execute on function public.submit_meeting_proposal');
    expect(boundary).not.toMatch(/readBusyIntervals|calculateAvailability|acquireAccessToken|Calendars\.ReadWrite|\/events|createEvent|updateEvent|deleteEvent|sendMail|meetingUrl/i);
    expect(boundary).toContain("event: 'meeting_proposal_submission_failure'");

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const sensitiveFailure = dependencies({ submit: vi.fn().mockRejectedValue(new Error(`${proposal.title} ${proposal.attendeeEmail} ${proposal.notes}`)) });
    const response = await handleMeetingProposalSubmission(post(), sensitiveFailure);
    expect(response.status).toBe(503);
    expect(errorSpy).toHaveBeenCalledWith(JSON.stringify({ event: 'meeting_proposal_submission_failure', category: 'submission', errorName: 'Error' }));
    errorSpy.mockRestore();
  });

  it('uses only the Edge Function client path and keeps confirmation, duplicate guard, failure retention, and no new owner controls local', async () => {
    const source = readFileSync(new URL('../components/CalendarAvailabilityPanel.tsx', import.meta.url), 'utf8');
    const client = readFileSync(new URL('../services/meetingProposalSubmissionClient.ts', import.meta.url), 'utf8');
    const markup = renderToStaticMarkup(<CalendarAvailabilityPanel workspaceId="workspace-1" submitProposal={vi.fn()} />);
    expect(markup).not.toContain('SUBMIT FOR OWNER APPROVAL');
    expect(source).toContain('SUBMIT FOR OWNER APPROVAL');
    expect(source).toContain('Submit this meeting proposal for owner approval? No calendar event or invitation will be created.');
    expect(source).toContain("if (!preparedProposal || submitting) return;");
    expect(source).toContain('AWAITING OWNER APPROVAL — NOT BOOKED');
    expect(source).toContain('setSubmissionError');
    expect(client).toContain("functions.invoke('rev-meeting-proposal-submit'");
    expect(client).not.toMatch(/\.from\(|\.rpc\(|localStorage|sessionStorage|mailto:|window\.location|Calendars\.ReadWrite/i);
    expect(source).not.toMatch(/<button[^>]*>\s*(Approve|Execute|Book|Send|Create Event)\s*<\/button>/i);
  });

  it('maps a safe client failure without exposing proposal details', async () => {
    const original = (await import('@/data/supabaseClient')).supabaseClient;
    expect(original === null || typeof original === 'object').toBe(true);
    await expect(submitMeetingProposal(proposal, 'workspace-1')).rejects.toThrow(/not configured|unavailable|sign in is required/i);
  });
});