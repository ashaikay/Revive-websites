import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const baseUrl = 'http://127.0.0.1:55321';
const anonKey = process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceRoleKey) throw new Error('Local Supabase test keys are required.');
let failures = 0;
const check = (name, value) => { console.log(`${name}=${value ? 'PASS' : 'FAIL'}`); if (!value) failures += 1; };
const endpoint = (path) => new URL(path, baseUrl);
async function request(token, method, path, query = {}, body) {
  const url = endpoint(path);
  Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));
  const headers = { apikey: anonKey, Authorization: `Bearer ${token}`, Prefer: 'return=representation' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, rows: Array.isArray(payload) ? payload : [] };
}
const rpc = (token, name, body) => request(token, 'POST', `/rest/v1/rpc/${name}`, {}, body);
function localSql(sql) { return execFileSync('docker', ['exec', 'supabase_db_revive-app', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql], { encoding: 'utf8' }).trim(); }
async function identity(label) {
  const stamp = `${Date.now()}-${label}`;
  const email = `phase5j-${stamp}@example.test`;
  const password = `Local-${randomBytes(18).toString('base64url')}`;
  const created = await fetch(endpoint('/auth/v1/admin/users'), { method: 'POST', headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true }) });
  const user = await created.json();
  const login = await fetch(endpoint('/auth/v1/token?grant_type=password'), { method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const session = await login.json();
  check(`IDENTITY_${label.toUpperCase()}`, created.status === 200 && login.status === 200 && Boolean(session.access_token));
  return { id: user.id, token: session.access_token };
}
async function addMember(workspaceId, user, role, status = 'active') { return request(serviceRoleKey, 'POST', '/rest/v1/workspace_members', {}, { workspace_id: workspaceId, user_id: user.id, role, status }); }
const proposal = (workspaceId, title = 'Durable meeting') => ({ target_workspace_id: workspaceId, target_submitted_by: member.id, target_title: title, target_attendee_email: 'customer@example.test', target_start_at: '2040-09-30T09:00:00.000Z', target_end_at: '2040-09-30T09:30:00.000Z', target_timezone: 'Europe/London', target_meeting_method: 'online', target_location_details: 'Private location', target_notes: '', target_semantic_fingerprint: '' });
function fingerprint(value) { return execFileSync('node', ['-e', `console.log(require('crypto').createHash('sha256').update(${JSON.stringify(value)}).digest('hex'))`], { encoding: 'utf8' }).trim(); }

const owner = await identity('owner');
const member = await identity('member');
const admin = await identity('admin');
const unrelated = await identity('unrelated');
const inactive = await identity('inactive');
const outsider = await identity('outsider');
const workspace = await rpc(owner.token, 'create_workspace_with_owner', { workspace_name: `Phase 5J ${Date.now()}`, workspace_slug: `phase-5j-${Date.now()}` });
const other = await rpc(outsider.token, 'create_workspace_with_owner', { workspace_name: `Phase 5J Other ${Date.now()}`, workspace_slug: `phase-5j-other-${Date.now()}` });
const workspaceId = workspace.payload?.[0]?.created_workspace_id;
check('WORKSPACES_CREATED', workspace.status === 200 && other.status === 200 && Boolean(workspaceId));
for (const [user, role, status] of [[member, 'member', 'active'], [admin, 'admin', 'active'], [unrelated, 'member', 'active'], [inactive, 'member', 'suspended']]) check(`MEMBERSHIP_${role}_${status}`, (await addMember(workspaceId, user, role, status)).status === 201);

const draft = { ...proposal(workspaceId), target_semantic_fingerprint: fingerprint(JSON.stringify(['phase5j', workspaceId, 'Durable meeting'])) };
const browserCall = await rpc(owner.token, 'submit_meeting_proposal', draft);
const forgedAction = await request(member.token, 'POST', '/rest/v1/rev_actions', {}, {
  workspace_id: workspaceId,
  action_type: 'meeting_proposal',
  title: 'Forged browser meeting',
  description: 'Must not be accepted.',
  rationale: `meeting-proposal:v1:${fingerprint('forged-browser-meeting')}`,
  requires_approval: true,
  status: 'awaiting_approval',
  execution_status: 'not_executed',
  action_version: 1,
});
const ordinaryAction = await request(serviceRoleKey, 'POST', '/rest/v1/rev_actions', {}, {
  workspace_id: workspaceId,
  action_type: 'follow_up',
  title: 'Ordinary visible action',
  description: 'Non-meeting action used to prove legacy access is preserved.',
  rationale: 'phase5j-policy-regression',
  requires_approval: false,
  status: 'proposed',
  execution_status: 'not_executed',
  action_version: 1,
});
const ordinaryActionId = ordinaryAction.payload?.[0]?.id;
check('AUTHENTICATED_BROWSER_RPC_DENIED', browserCall.status >= 400);
check('AUTHENTICATED_BROWSER_MEETING_ACTION_INSERT_DENIED', forgedAction.status >= 400);
check('NON_MEETING_ACTION_INSERTED_FOR_POLICY_REGRESSION', ordinaryAction.status === 201 && Boolean(ordinaryActionId));
const submitted = await rpc(serviceRoleKey, 'submit_meeting_proposal', draft);
const actionId = submitted.payload?.[0]?.action_id;
const approvalId = submitted.payload?.[0]?.approval_id;
check('SERVICE_ROLE_SUBMISSION_ALLOWED', submitted.status === 200 && submitted.payload?.[0]?.action_status === 'awaiting_approval' && submitted.payload?.[0]?.execution_status === 'not_executed');
const inactiveAttempt = await rpc(serviceRoleKey, 'submit_meeting_proposal', { ...draft, target_submitted_by: inactive.id, target_semantic_fingerprint: fingerprint('inactive') });
const crossWorkspaceAttempt = await rpc(serviceRoleKey, 'submit_meeting_proposal', { ...draft, target_submitted_by: outsider.id, target_semantic_fingerprint: fingerprint('outsider') });
check('INACTIVE_SUBMITTER_DENIED', inactiveAttempt.status >= 400);
check('CROSS_WORKSPACE_SUBMITTER_DENIED', crossWorkspaceAttempt.status >= 400);

const submitterRead = await request(member.token, 'GET', '/rest/v1/meeting_proposals', { select: 'id,proposal_payload', workspace_id: `eq.${workspaceId}` });
const ownerRead = await request(owner.token, 'GET', '/rest/v1/meeting_proposals', { select: 'id,proposal_payload', workspace_id: `eq.${workspaceId}` });
const adminRead = await request(admin.token, 'GET', '/rest/v1/meeting_proposals', { select: 'id,proposal_payload', workspace_id: `eq.${workspaceId}` });
const unrelatedRead = await request(unrelated.token, 'GET', '/rest/v1/meeting_proposals', { select: 'id,proposal_payload', workspace_id: `eq.${workspaceId}` });
const outsiderRead = await request(outsider.token, 'GET', '/rest/v1/meeting_proposals', { select: 'id,proposal_payload', workspace_id: `eq.${workspaceId}` });
check('SUBMITTER_PII_READ_ALLOWED', submitterRead.status === 200 && submitterRead.rows.length === 1);
check('OWNER_ADMIN_PII_READ_ALLOWED', ownerRead.rows.length === 1 && adminRead.rows.length === 1);
check('UNRELATED_AND_CROSS_TENANT_PII_DENIED', unrelatedRead.rows.length === 0 && outsiderRead.rows.length === 0);

const submitterActionRead = await request(member.token, 'GET', '/rest/v1/rev_actions', { select: 'id,title', id: `eq.${actionId}` });
const ownerActionRead = await request(owner.token, 'GET', '/rest/v1/rev_actions', { select: 'id,title', id: `eq.${actionId}` });
const adminActionRead = await request(admin.token, 'GET', '/rest/v1/rev_actions', { select: 'id,title', id: `eq.${actionId}` });
const unrelatedActionRead = await request(unrelated.token, 'GET', '/rest/v1/rev_actions', { select: 'id,title', id: `eq.${actionId}` });
const outsiderActionRead = await request(outsider.token, 'GET', '/rest/v1/rev_actions', { select: 'id,title', id: `eq.${actionId}` });
const ordinaryMemberRead = await request(unrelated.token, 'GET', '/rest/v1/rev_actions', { select: 'id,title', id: `eq.${ordinaryActionId}` });
check('MEETING_ACTION_SUBMITTER_READ_ALLOWED', submitterActionRead.rows.length === 1);
check('MEETING_ACTION_OWNER_ADMIN_READ_ALLOWED', ownerActionRead.rows.length === 1 && adminActionRead.rows.length === 1);
check('MEETING_ACTION_UNRELATED_AND_CROSS_TENANT_READ_DENIED', unrelatedActionRead.rows.length === 0 && outsiderActionRead.rows.length === 0);
check('NON_MEETING_ACTION_EXISTING_READ_ACCESS_PRESERVED', ordinaryMemberRead.rows.length === 1);

const binding = localSql(`select (a.rationale = 'meeting-proposal:v1:${draft.target_semantic_fingerprint}')::text || ':' || (ap.action_fingerprint = public.rev_action_material_fingerprint(a))::text from public.rev_actions a join public.approvals ap on ap.workspace_id=a.workspace_id and ap.rev_action_id=a.id and ap.id='${approvalId}'::uuid where a.id='${actionId}'::uuid`);
check('SEMANTIC_FINGERPRINT_BOUND_TO_APPROVAL', binding === 'true:true');
const approval = await request(owner.token, 'GET', '/rest/v1/approvals', { select: 'action_version,action_fingerprint', id: `eq.${approvalId}` });
const blockedMemberEdit = await request(member.token, 'PATCH', '/rest/v1/rev_actions', { id: `eq.${actionId}` }, { rationale: 'meeting-proposal:v1:member-tamper' });
const actionAfterBlockedEdit = await request(serviceRoleKey, 'GET', '/rest/v1/rev_actions', { select: 'rationale', id: `eq.${actionId}` });
const blockedConversion = await request(member.token, 'PATCH', '/rest/v1/rev_actions', { id: `eq.${ordinaryActionId}` }, { action_type: 'meeting_proposal' });
const ordinaryAfterBlockedConversion = await request(serviceRoleKey, 'GET', '/rest/v1/rev_actions', { select: 'action_type', id: `eq.${ordinaryActionId}` });
check('AUTHENTICATED_BROWSER_MEETING_ACTION_UPDATE_DENIED',
  (blockedMemberEdit.status >= 400 || blockedMemberEdit.rows.length === 0)
  && actionAfterBlockedEdit.rows[0]?.rationale === `meeting-proposal:v1:${draft.target_semantic_fingerprint}`);
check('AUTHENTICATED_BROWSER_ACTION_CONVERSION_DENIED',
  (blockedConversion.status >= 400 || blockedConversion.rows.length === 0)
  && ordinaryAfterBlockedConversion.rows[0]?.action_type === 'follow_up');

const trustedTamper = await request(serviceRoleKey, 'PATCH', '/rest/v1/rev_actions', { id: `eq.${actionId}` }, { rationale: 'meeting-proposal:v1:trusted-tamper-test' });
const staleDecision = await rpc(owner.token, 'decide_rev_action_approval', { target_approval_id: approvalId, expected_action_version: approval.rows[0]?.action_version, expected_action_fingerprint: approval.rows[0]?.action_fingerprint, approval_decision: 'approved' });
check('ALTERED_MATERIAL_APPROVAL_DENIED', trustedTamper.status === 200 && staleDecision.status >= 400);

const approvedDraft = { ...proposal(workspaceId, 'Approved retry'), target_semantic_fingerprint: fingerprint('approved-retry') };
const approvedSubmission = await rpc(serviceRoleKey, 'submit_meeting_proposal', approvedDraft);
const approvedAction = approvedSubmission.payload?.[0]?.action_id;
const approvedApproval = approvedSubmission.payload?.[0]?.approval_id;
const approvalRow = await request(owner.token, 'GET', '/rest/v1/approvals', { select: 'action_version,action_fingerprint', id: `eq.${approvedApproval}` });
const decision = await rpc(owner.token, 'decide_rev_action_approval', { target_approval_id: approvedApproval, expected_action_version: approvalRow.rows[0]?.action_version, expected_action_fingerprint: approvalRow.rows[0]?.action_fingerprint, approval_decision: 'approved' });
const retry = await rpc(serviceRoleKey, 'submit_meeting_proposal', approvedDraft);
check('OWNER_APPROVAL_ALLOWED', decision.status === 200);
check('RETRY_RETURNS_ACTUAL_APPROVED_STATE', retry.status === 200 && retry.payload?.[0]?.action_id === approvedAction && retry.payload?.[0]?.action_status === 'approved' && retry.payload?.[0]?.execution_status === 'not_executed' && retry.payload?.[0]?.created === false);
console.log(`PHASE5J_LOCAL_MIGRATION=${failures === 0 ? 'PASS' : 'FAIL'}`);
if (failures) process.exitCode = 1;