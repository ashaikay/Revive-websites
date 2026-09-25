import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { handleMeetingProposalSubmission, type SubmittedMeetingProposal } from './meetingProposalSubmissionBoundary.ts';
import { resolveTrustedCalendarAvailabilityConfiguration } from '../rev-calendar-availability/trustedCalendarAvailabilityResolver.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('SUPABASE_PUBLISHABLE_KEY')!;
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const caller = (authorization: string) => createClient(url, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
const service = () => createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve((request) => handleMeetingProposalSubmission(request, {
  getAuthenticatedUserId: async (authorization) => { const { data, error } = await caller(authorization).auth.getUser(); return error ? null : data.user?.id ?? null; },
  hasActiveWorkspaceMembership: async (authorization, workspaceId, userId) => { const { data, error } = await caller(authorization).from('workspace_members').select('status').eq('workspace_id', workspaceId).eq('user_id', userId).eq('status', 'active').maybeSingle(); return !error && data?.status === 'active'; },
  resolveTrustedConfiguration: resolveTrustedCalendarAvailabilityConfiguration,
  submit: async (proposal: SubmittedMeetingProposal, userId, fingerprint) => {
    const { data, error } = await service().rpc('submit_meeting_proposal', { target_workspace_id: proposal.workspaceId, target_submitted_by: userId, target_title: proposal.title, target_attendee_email: proposal.attendeeEmail, target_start_at: proposal.startAt, target_end_at: proposal.endAt, target_timezone: proposal.timezone, target_meeting_method: proposal.meetingMethod, target_location_details: proposal.locationDetails, target_notes: proposal.notes, target_semantic_fingerprint: fingerprint });
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || !['proposed', 'awaiting_approval', 'approved', 'rejected', 'cancelled', 'completed', 'failed'].includes(row.action_status) || !['not_started', 'not_executed', 'in_progress', 'succeeded', 'failed'].includes(row.execution_status) || typeof row.action_id !== 'string' || typeof row.approval_id !== 'string' || typeof row.created !== 'boolean') throw new Error('Invalid submission result.');
    return { actionId: row.action_id, approvalId: row.approval_id, actionStatus: row.action_status, executionStatus: row.execution_status, created: row.created };
  },
  now: () => new Date().toISOString(),
}));