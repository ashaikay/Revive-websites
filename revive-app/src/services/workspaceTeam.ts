import { supabaseClient } from '@/data/supabaseClient';
export const teamId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type TeamMember = { userId: string; role: 'owner' | 'admin' | 'member' | 'viewer'; status: 'active' | 'invited' | 'suspended'; displayName: string | null; nameVersion: number };
export type StaffInvitation = { id: string; email: string; displayName: string; status: 'pending' | 'accepted' | 'revoked' | 'expired'; expiresAt: string; createdAt: string };
export type TeamDirectory = { workspaceId: string; members: TeamMember[]; invitations: StaffInvitation[] };
export type TeamAttempt = { workspaceId: string; requestId: string; operation: 'invite' | 'rename' | 'revoke_invite' | 'suspend' | 'restore'; payload: Record<string, string | number> };
export class TeamRejectedError extends Error {}
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Team data could not be verified.');
  return value as Record<string, unknown>;
};
const name = (value: unknown) => typeof value === 'string' && value.trim().length > 0 && value.length <= 120;
export function parseTeamDirectory(value: unknown, workspaceId: string): TeamDirectory {
  const result = object(value);
  if (result.workspaceId !== workspaceId || !Array.isArray(result.members) || !Array.isArray(result.invitations)) throw new Error('Team data could not be verified.');
  const members = result.members.map((value): TeamMember => {
    const row = object(value);
    if (!teamId.test(String(row.userId)) || !['owner','admin','member','viewer'].includes(String(row.role)) || !['active','invited','suspended'].includes(String(row.status)) || !(row.displayName === null || name(row.displayName)) || !Number.isSafeInteger(row.nameVersion) || Number(row.nameVersion) < 0) throw new Error('Team member could not be verified.');
    return row as TeamMember;
  });
  const invitations = result.invitations.map((value): StaffInvitation => {
    const row = object(value);
    if (!teamId.test(String(row.id)) || !name(row.displayName) || typeof row.email !== 'string' || !['pending','accepted','revoked','expired'].includes(String(row.status)) || !Number.isFinite(Date.parse(String(row.expiresAt))) || !Number.isFinite(Date.parse(String(row.createdAt)))) throw new Error('Invitation could not be verified.');
    return row as StaffInvitation;
  });
  if (new Set(members.map((member) => member.userId)).size !== members.length || new Set(invitations.map((invite) => invite.id)).size !== invitations.length) throw new Error('Duplicate team records. Reload the team.');
  return { workspaceId, members, invitations };
}
export async function loadWorkspaceTeam(workspaceId: string) {
  if (!supabaseClient || !teamId.test(workspaceId)) throw new Error('Team setup is unavailable.');
  const response = await Promise.resolve(supabaseClient.rpc('list_rev_workspace_team', { target_workspace_id: workspaceId })).catch(() => ({ data: null, error: { message: 'unavailable' } }));
  if (response.error) throw new Error('Team setup is unavailable. Reload after the team update has been deployed, or contact your organisation owner.');
  return parseTeamDirectory(response.data, workspaceId);
}
export async function loadWorkspaceStaffNames(workspaceId: string): Promise<Array<{ userId: string; displayName: string }>> {
  // Names are optional during the additive rollout. Never substitute unverified Auth metadata.
  try {
    if (!supabaseClient) return [];
    const { data, error } = await supabaseClient.rpc('list_rev_workspace_staff_names', { target_workspace_id: workspaceId });
    if (error || !Array.isArray(data)) return [];
    if (data.some((row) => !row || !teamId.test(String(row.userId)) || !name(row.displayName))) return [];
    return data;
  } catch { return []; }
}
export async function submitTeamAttempt(attempt: TeamAttempt) {
  if (!supabaseClient || !teamId.test(attempt.workspaceId) || !teamId.test(attempt.requestId)) throw new TeamRejectedError('Valid team change required.');
  const { data, error } = await Promise.resolve(supabaseClient.rpc('manage_rev_workspace_team', { target_workspace_id: attempt.workspaceId, target_operation: attempt.operation, target_request_id: attempt.requestId, target_payload: attempt.payload })).catch(() => { throw new Error('Save outcome is unknown. Retry the same change.'); });
  if (error) {
    const code = error.code;
    if (['22023','22P02','23502','23503','23505','23514','40001','42501','54000'].includes(code)) throw new TeamRejectedError(code === '40001' ? 'The team changed. Reload the team before trying again.' : code === '23505' ? 'An invitation is already pending for this email address.' : code === '42501' ? 'This team change is not permitted.' : 'This team change was not accepted. Check the details.');
    throw new Error('Save outcome is unknown. Retry the same change.');
  }
  const result = object(data);
  if (result.operation !== attempt.operation || result.workspaceId !== attempt.workspaceId || (attempt.operation === 'invite' || attempt.operation === 'revoke_invite' ? !teamId.test(String(result.invitationId)) : result.userId !== attempt.payload.userId)) throw new Error('Save outcome is unknown. Retry the same change.');
  return result;
}
export function invitationLink(invitationId: string, location: { origin: string; pathname: string }) {
  if (!teamId.test(invitationId)) throw new Error('Invitation link unavailable.');
  const origin = new URL(location.origin);
  if (origin.protocol !== 'https:' && !(origin.protocol === 'http:' && ['localhost','127.0.0.1'].includes(origin.hostname))) throw new Error('A secure REV address is required.');
  const url = new URL(location.pathname, origin.origin);
  url.searchParams.set('rev_team_invite', invitationId);
  return url.href;
}
export function invitationFromLocation(search: string) {
  const params = new URLSearchParams(search);
  if (!params.has('rev_team_invite')) return null;
  const ids = params.getAll('rev_team_invite');
  return ids.length === 1 && teamId.test(ids[0]) ? ids[0] : 'invalid';
}
export async function acceptWorkspaceInvitation(invitationId: string) {
  if (!supabaseClient || !teamId.test(invitationId)) throw new Error('Invitation unavailable.');
  const { data, error } = await supabaseClient.rpc('accept_rev_workspace_invitation', { target_invitation_id: invitationId });
  if (error || !data || !teamId.test(String(data.workspaceId)) || data.accepted !== true || !['owner','admin','member','viewer'].includes(data.role)) throw new Error('Invitation not accepted. Confirm your email and check that you are using the invited account. The invitation may also have expired or been revoked.');
  return data as { workspaceId: string; role: string; accepted: true };
}
