import { supabaseClient } from '@/data/supabaseClient';
import type { PreparedMeetingProposal, SubmittedMeetingProposalState } from './meetingProposalService';

export interface MeetingProposalSubmissionClientError extends Error { status?: number; }
export interface MeetingProposalSubmissionResult extends SubmittedMeetingProposalState { created: boolean; }
export type MeetingProposalSubmitter = (proposal: PreparedMeetingProposal, workspaceId: string) => Promise<MeetingProposalSubmissionResult>;

function clientError(message: string, status?: number): MeetingProposalSubmissionClientError {
  const error = new Error(message) as MeetingProposalSubmissionClientError;
  error.name = 'MeetingProposalSubmissionClientError';
  error.status = status;
  return error;
}
function safeError(status: number | undefined): string {
  if (status === 401) return 'Sign in is required to submit this meeting proposal.';
  if (status === 403) return 'You do not have access to submit a meeting proposal for this workspace.';
  if (status === 400) return 'This meeting proposal is no longer valid. Review it and try again.';
  return 'Meeting proposal submission is unavailable. Your prepared proposal has been retained.';
}
function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const value = error as { status?: unknown; context?: { status?: unknown } };
  const status = value.status ?? value.context?.status;
  return typeof status === 'number' ? status : undefined;
}
export async function submitMeetingProposal(proposal: PreparedMeetingProposal, workspaceId: string): Promise<MeetingProposalSubmissionResult> {
  if (!supabaseClient) throw clientError('Meeting proposal submission is not configured.');
  const { data, error } = await supabaseClient.functions.invoke('rev-meeting-proposal-submit', {
    body: { workspaceId, title: proposal.title, attendeeEmail: proposal.attendeeEmail, startAt: proposal.startAt, endAt: proposal.endAt, timezone: proposal.timezone, meetingMethod: proposal.meetingMethod, locationDetails: proposal.locationDetails, notes: proposal.notes },
  });
  if (error) throw clientError(safeError(statusOf(error)), statusOf(error));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw clientError('Meeting proposal submission is unavailable. Your prepared proposal has been retained.');
  const value = data as Record<string, unknown>;
  if (!['proposed', 'awaiting_approval', 'approved', 'rejected', 'cancelled', 'completed', 'failed'].includes(String(value.actionStatus))
    || !['not_started', 'not_executed', 'in_progress', 'succeeded', 'failed'].includes(String(value.executionStatus))
    || typeof value.created !== 'boolean') throw clientError('Meeting proposal submission is unavailable. Your prepared proposal has been retained.');
  return { actionStatus: value.actionStatus as MeetingProposalSubmissionResult['actionStatus'], executionStatus: value.executionStatus as MeetingProposalSubmissionResult['executionStatus'], created: value.created };
}