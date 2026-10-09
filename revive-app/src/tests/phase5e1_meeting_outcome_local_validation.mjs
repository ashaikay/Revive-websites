import { randomBytes, randomUUID } from 'node:crypto';

const baseUrl = 'http://127.0.0.1:55321';
const anonKey = process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const serviceKey = process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!anonKey || !serviceKey) throw new Error('Local Supabase test keys are required.');

let failures = 0;
function check(name, condition) {
  console.log(`${name}=${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures += 1;
}
async function request(token, method, path, body) {
  const response = await fetch(baseUrl + path, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, rows: Array.isArray(payload) ? payload : [] };
}
const rpc = (token, name, body) => request(token, 'POST', `/rest/v1/rpc/${name}`, body);
function authErrorDetails(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return 'code=unavailable message=unavailable';
  const code = payload.code ?? payload.error_code ?? payload.error;
  const message = payload.message ?? payload.msg ?? payload.error_description;
  const safe = (value) => typeof value === 'string'
    ? value.replace(/[\r\n\t]+/g, ' ').slice(0, 200)
    : 'unavailable';
  return `code=${safe(code)} message=${safe(message)}`;
}
async function identity(label) {
  const email = `phase5e1-${Date.now()}-${label}-${randomBytes(4).toString('hex')}@example.test`;
  const password = `Local-${randomBytes(18).toString('base64url')}`;
  const created = await request(serviceKey, 'POST', '/auth/v1/admin/users', { email, password, email_confirm: true });
  if (created.status !== 200 || typeof created.payload?.id !== 'string') {
    throw new Error(`Identity user creation failed: ${label}; status=${created.status} ${authErrorDetails(created.payload)}`);
  }
  const login = await request(anonKey, 'POST', '/auth/v1/token?grant_type=password', { email, password });
  if (login.status !== 200 || typeof login.payload?.access_token !== 'string') {
    throw new Error(`Identity login failed: ${label}; status=${login.status} ${authErrorDetails(login.payload)}`);
  }
  return { id: created.payload.id, token: login.payload.access_token };
}

const owner = await identity('owner');
const admin = await identity('admin');
const member = await identity('member');
const suspended = await identity('suspended');
const outsider = await identity('outsider');
const workspace = await rpc(owner.token, 'create_workspace_with_owner', {
  workspace_name: `Phase 5E.1 ${Date.now()}`,
  workspace_slug: `phase-5e1-${Date.now()}`,
});
const otherWorkspace = await rpc(outsider.token, 'create_workspace_with_owner', {
  workspace_name: `Phase 5E.1 Other ${Date.now()}`,
  workspace_slug: `phase-5e1-other-${Date.now()}`,
});
const workspaceId = workspace.payload?.[0]?.created_workspace_id;
const otherWorkspaceId = otherWorkspace.payload?.[0]?.created_workspace_id;
if (!workspaceId || !otherWorkspaceId) throw new Error('Workspace setup failed.');

for (const [actor, role, status] of [
  [admin, 'admin', 'active'],
  [member, 'member', 'active'],
  [suspended, 'admin', 'suspended'],
]) {
  const saved = await request(serviceKey, 'POST', '/rest/v1/workspace_members', {
    workspace_id: workspaceId,
    user_id: actor.id,
    role,
    status,
  });
  if (saved.status !== 201) throw new Error('Membership setup failed.');
}

async function proposal(targetWorkspaceId, submittedBy, suffix) {
  const action = await request(serviceKey, 'POST', '/rest/v1/rev_actions', {
    workspace_id: targetWorkspaceId,
    action_type: 'meeting_proposal',
    title: `Past meeting ${suffix}`,
    description: 'Meeting proposal.',
    requires_approval: true,
    status: 'approved',
    execution_status: 'succeeded',
    action_version: 1,
  });
  const actionId = action.rows[0]?.id;
  const approval = await request(serviceKey, 'POST', '/rest/v1/approvals', {
    workspace_id: targetWorkspaceId,
    rev_action_id: actionId,
    decision: 'approved',
  });
  const approvalId = approval.rows[0]?.id;
  const meeting = await request(serviceKey, 'POST', '/rest/v1/meeting_proposals', {
    workspace_id: targetWorkspaceId,
    rev_action_id: actionId,
    approval_id: approvalId,
    submitted_by: submittedBy,
    proposal_version: 1,
    semantic_fingerprint: suffix.padEnd(64, 'a').slice(0, 64),
    proposal_payload: {
      version: 1,
      title: `Past meeting ${suffix}`,
      attendeeEmail: 'customer@example.test',
      startAt: '2026-10-08T09:00:00.000Z',
      endAt: '2026-10-08T09:30:00.000Z',
      timezone: 'Europe/London',
      meetingMethod: 'online',
      locationDetails: '',
      notes: '',
    },
  });
  if (meeting.status !== 201) throw new Error(`Proposal setup failed: ${JSON.stringify(meeting.payload)}`);
  return meeting.rows[0].id;
}

const proposalId = await proposal(workspaceId, owner.id, '1');
const otherProposalId = await proposal(otherWorkspaceId, outsider.id, '2');
const occurredAt = '2026-10-08T09:30:00.000Z';
const save = (patch = {}) => rpc(serviceKey, 'save_rev_meeting_outcome', {
  target_workspace_id: workspaceId,
  initiating_user_id: owner.id,
  target_request_id: randomUUID(),
  target_meeting_proposal_id: proposalId,
  target_outcome_type: 'held',
  target_summary: 'Requirements confirmed; prepare the next proposal.',
  target_occurred_at: occurredAt,
  expected_version: 0,
  ...patch,
});

const requestId = randomUUID();
const first = await save({ target_request_id: requestId });
check('VALID_OWNER_SAVE', first.status === 200 && first.payload?.outcome_type === 'held' && first.payload?.version === 1);
const replay = await save({ target_request_id: requestId });
check('EXACT_REQUEST_REPLAY', replay.status === 200 && replay.payload?.id === first.payload?.id && replay.payload?.version === 1);
const semanticDuplicate = await save();
check('DUPLICATE_SAVE_NO_NEW_VERSION', semanticDuplicate.status === 200 && semanticDuplicate.payload?.id === first.payload?.id && semanticDuplicate.payload?.version === 1);

const corrected = await save({
  initiating_user_id: admin.id,
  target_outcome_type: 'no_show',
  target_summary: 'Customer did not attend; contact them before proposing another time.',
  expected_version: 1,
});
check('VERSION_BOUND_CORRECTION', corrected.status === 200 && corrected.payload?.outcome_type === 'no_show' && corrected.payload?.version === 2);
check('STALE_CORRECTION_DENIED', (await save({
  target_outcome_type: 'cancelled',
  target_summary: 'Stale correction.',
  expected_version: 1,
})).status >= 400);

for (const patch of [
  { target_outcome_type: 'rescheduled' },
  { target_outcome_type: 'sale' },
  { target_summary: '' },
  { target_summary: ' padded ' },
  { target_occurred_at: '2999-01-01T00:00:00.000Z' },
]) {
  check('INVALID_OUTCOME_DENIED', (await save({ ...patch, expected_version: 2 })).status >= 400);
}
check('MEMBER_SAVE_DENIED', (await save({ initiating_user_id: member.id, expected_version: 2 })).status >= 400);
check('SUSPENDED_ADMIN_SAVE_DENIED', (await save({ initiating_user_id: suspended.id, expected_version: 2 })).status >= 400);
check('CROSS_WORKSPACE_ACTOR_DENIED', (await save({
  target_workspace_id: otherWorkspaceId,
  target_meeting_proposal_id: otherProposalId,
  expected_version: 0,
})).status >= 400);
check('BROWSER_RPC_DENIED', (await rpc(owner.token, 'save_rev_meeting_outcome', {
  target_workspace_id: workspaceId,
  initiating_user_id: owner.id,
  target_request_id: randomUUID(),
  target_meeting_proposal_id: proposalId,
  target_outcome_type: 'held',
  target_summary: 'Denied.',
  target_occurred_at: occurredAt,
  expected_version: 2,
})).status >= 400);
check('DIRECT_INSERT_DENIED', (await request(owner.token, 'POST', '/rest/v1/meeting_outcomes', {
  workspace_id: workspaceId,
  meeting_proposal_id: proposalId,
  outcome_type: 'held',
  summary: 'Denied.',
  occurred_at: occurredAt,
  recorded_by_user_id: owner.id,
})).status >= 400);

const ownerRead = await request(owner.token, 'GET', `/rest/v1/meeting_outcomes?workspace_id=eq.${workspaceId}`);
const memberRead = await request(member.token, 'GET', `/rest/v1/meeting_outcomes?workspace_id=eq.${workspaceId}`);
const outsiderRead = await request(outsider.token, 'GET', `/rest/v1/meeting_outcomes?workspace_id=eq.${workspaceId}`);
check('OUTCOME_PERSISTS_FOR_ACTIVE_WORKSPACE', ownerRead.status === 200 && ownerRead.rows[0]?.outcome_type === 'no_show' && ownerRead.rows[0]?.version === 2);
check('ACTIVE_MEMBER_WORKSPACE_READ', memberRead.status === 200 && memberRead.rows.length === 1);
check('CROSS_WORKSPACE_READ_DENIED', outsiderRead.status === 200 && outsiderRead.rows.length === 0);

const audits = await request(serviceKey, 'GET', `/rest/v1/audit_log?workspace_id=eq.${workspaceId}&resource_type=eq.meeting_outcome`);
check('AUDIT_ONCE_PER_ACCEPTED_CHANGE', audits.status === 200 && audits.rows.length === 2
  && audits.rows.some((row) => row.action === 'meeting_outcome.recorded')
  && audits.rows.some((row) => row.action === 'meeting_outcome.corrected'));

console.log(`PHASE5E1_MEETING_OUTCOME_LOCAL=${failures ? 'FAIL' : 'PASS'}`);
if (failures) process.exit(1);
