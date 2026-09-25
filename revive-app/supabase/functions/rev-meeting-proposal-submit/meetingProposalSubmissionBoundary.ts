import { resolveTrustedCalendarAvailabilityConfiguration } from '../rev-calendar-availability/trustedCalendarAvailabilityResolver.ts';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const allowedKeys = new Set(['workspaceId', 'title', 'attendeeEmail', 'startAt', 'endAt', 'timezone', 'meetingMethod', 'locationDetails', 'notes']);
export type MeetingMethod = 'online' | 'phone' | 'in_person';
export interface SubmittedMeetingProposal { workspaceId: string; title: string; attendeeEmail: string; startAt: string; endAt: string; timezone: string; meetingMethod: MeetingMethod; locationDetails: string; notes: string; }
export interface MeetingProposalSubmissionResult { actionId: string; approvalId: string; actionStatus: 'proposed' | 'awaiting_approval' | 'approved' | 'rejected' | 'cancelled' | 'completed' | 'failed'; executionStatus: 'not_started' | 'not_executed' | 'in_progress' | 'succeeded' | 'failed'; created: boolean; }
export interface MeetingProposalSubmissionDependencies {
  getAuthenticatedUserId: (authorization: string) => Promise<string | null>;
  hasActiveWorkspaceMembership: (authorization: string, workspaceId: string, userId: string) => Promise<boolean>;
  resolveTrustedConfiguration: typeof resolveTrustedCalendarAvailabilityConfiguration;
  submit: (proposal: SubmittedMeetingProposal, userId: string, semanticFingerprint: string) => Promise<MeetingProposalSubmissionResult>;
  now: () => string;
}

function json(status: number, body: unknown): Response { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }); }
function validUtc(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && new Date(value).toISOString() === value; }
function validEmail(value: string): boolean { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function parsePayload(value: unknown, now: string): SubmittedMeetingProposal | null {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.workspaceId !== 'string' || typeof raw.title !== 'string' || typeof raw.attendeeEmail !== 'string' || typeof raw.timezone !== 'string' || typeof raw.locationDetails !== 'string' || typeof raw.notes !== 'string' || !validUtc(raw.startAt) || !validUtc(raw.endAt) || !['online', 'phone', 'in_person'].includes(String(raw.meetingMethod))) return null;
  const proposal = { workspaceId: raw.workspaceId.trim(), title: raw.title.trim(), attendeeEmail: raw.attendeeEmail.trim().toLowerCase(), startAt: raw.startAt, endAt: raw.endAt, timezone: raw.timezone.trim(), meetingMethod: raw.meetingMethod as MeetingMethod, locationDetails: raw.locationDetails.trim(), notes: raw.notes.trim() };
  const duration = Date.parse(proposal.endAt) - Date.parse(proposal.startAt);
  return proposal.workspaceId && proposal.title.length > 0 && proposal.title.length <= 120 && validEmail(proposal.attendeeEmail) && proposal.timezone && Date.parse(proposal.startAt) > Date.parse(now) && duration > 0 && (duration === 30 * 60_000 || duration === 60 * 60_000) && proposal.locationDetails.length <= 240 && proposal.notes.length <= 1000 ? proposal : null;
}
export async function meetingProposalSemanticFingerprint(proposal: SubmittedMeetingProposal): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(proposal))));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
export async function handleMeetingProposalSubmission(request: Request, dependencies: MeetingProposalSubmissionDependencies): Promise<Response> {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed.' });
  const authorization = request.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return json(401, { error: 'Authentication required.' });
  const userId = await dependencies.getAuthenticatedUserId(authorization).catch(() => null);
  if (!userId) return json(401, { error: 'Authentication failed.' });
  const proposal = parsePayload(await request.json().catch(() => null), dependencies.now());
  if (!proposal) return json(400, { error: 'Invalid meeting proposal.', code: 'invalid_proposal' });
  if (!await dependencies.hasActiveWorkspaceMembership(authorization, proposal.workspaceId, userId).catch(() => false)) return json(403, { error: 'Workspace access denied.' });
  try {
    const trusted = dependencies.resolveTrustedConfiguration(proposal.workspaceId, proposal.startAt, proposal.endAt, proposal.timezone);
    if (trusted.selectedCalendar.workspaceId !== proposal.workspaceId || trusted.selectedCalendar.timezone !== proposal.timezone) return json(403, { error: 'Trusted calendar binding is unavailable.' });
    const submitted = await dependencies.submit(proposal, userId, await meetingProposalSemanticFingerprint(proposal));
    return json(200, submitted);
  } catch (error) {
    console.error(JSON.stringify({ event: 'meeting_proposal_submission_failure', category: 'submission', errorName: error instanceof Error ? error.name : 'UnknownError' }));
    return json(503, { error: 'Meeting proposal submission is unavailable.', code: 'submission_unavailable' });
  }
}