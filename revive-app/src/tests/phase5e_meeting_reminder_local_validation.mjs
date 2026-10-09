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
  const email = `phase5e-reminder-${Date.now()}-${label}-${randomBytes(4).toString('hex')}@example.test`;
  const password = `Local-${randomBytes(18).toString('base64url')}`;
  const created = await request(serviceKey, 'POST', '/auth/v1/admin/users', { email, password, email_confirm: true });
  if (created.status !== 200 || typeof created.payload?.id !== 'string') {
    throw new Error(`Reminder identity creation failed: ${label}; status=${created.status} ${authErrorDetails(created.payload)}`);
  }
  const login = await request(anonKey, 'POST', '/auth/v1/token?grant_type=password', { email, password });
  if (login.status !== 200 || typeof login.payload?.access_token !== 'string') {
    throw new Error(`Reminder identity login failed: ${label}; status=${login.status} ${authErrorDetails(login.payload)}`);
  }
  return { id: created.payload.id, token: login.payload.access_token };
}

const owner = await identity('owner');
const admin = await identity('admin');
const member = await identity('member');
const outsider = await identity('outsider');

const workspace = await rpc(owner.token, 'create_workspace_with_owner', {
  workspace_name: `Phase 5E Reminder ${Date.now()}`,
  workspace_slug: `phase-5e-reminder-${Date.now()}-${randomBytes(4).toString('hex')}`,
});
const otherWorkspace = await rpc(outsider.token, 'create_workspace_with_owner', {
  workspace_name: `Phase 5E Reminder Other ${Date.now()}`,
  workspace_slug: `phase-5e-reminder-other-${Date.now()}-${randomBytes(4).toString('hex')}`,
});
const workspaceId = workspace.payload?.[0]?.created_workspace_id;
const otherWorkspaceId = otherWorkspace.payload?.[0]?.created_workspace_id;
if (!workspaceId || !otherWorkspaceId) throw new Error('Reminder workspace setup failed.');

for (const [actor, role] of [[admin, 'admin'], [member, 'member']]) {
  const saved = await request(serviceKey, 'POST', '/rest/v1/workspace_members', {
    workspace_id: workspaceId,
    user_id: actor.id,
    role,
    status: 'active',
  });
  if (saved.status !== 201) throw new Error(`Reminder membership setup failed: ${role}`);
}

async function proposal(targetWorkspaceId, submittedBy, suffix, startAt = '2099-10-10T09:00:00.000Z') {
  const action = await request(serviceKey, 'POST', '/rest/v1/rev_actions', {
    workspace_id: targetWorkspaceId,
    action_type: 'meeting_proposal',
    title: `Reminder meeting ${suffix}`,
    description: 'Meeting proposal.',
    requires_approval: true,
    status: 'completed',
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
  const proposalPayload = {
    version: 1,
    title: `Reminder meeting ${suffix}`,
    attendeeEmail: 'customer@example.test',
    startAt,
    endAt: new Date(Date.parse(startAt) + 30 * 60_000).toISOString(),
    timezone: 'Europe/London',
    meetingMethod: 'online',
    locationDetails: '',
    notes: '',
  };
  const meeting = await request(serviceKey, 'POST', '/rest/v1/meeting_proposals', {
    workspace_id: targetWorkspaceId,
    rev_action_id: actionId,
    approval_id: approvalId,
    submitted_by: submittedBy,
    proposal_version: 1,
    semantic_fingerprint: randomBytes(32).toString('hex'),
    proposal_payload: proposalPayload,
  });
  if (meeting.status !== 201) throw new Error(`Reminder proposal setup failed: ${JSON.stringify(meeting.payload)}`);
  return { actionId, approvalId, proposalId: meeting.rows[0].id, proposalPayload };
}

async function execution(targetWorkspaceId, requestedBy, meeting, providerOutcome) {
  const accepted = providerOutcome === 'accepted_by_provider';
  const saved = await request(serviceKey, 'POST', '/rest/v1/rev_action_executions', {
    workspace_id: targetWorkspaceId,
    action_id: meeting.actionId,
    approval_id: meeting.approvalId,
    requested_by: requestedBy,
    capability: 'CREATE_APPROVED_MEETING_EVENT',
    risk_class: 'external_communication',
    mode: 'live',
    status: accepted ? 'succeeded' : 'failed',
    idempotency_key: `reminder-${randomUUID()}`,
    request_fingerprint: randomBytes(32).toString('hex'),
    action_version: 1,
    workspace_policy_version: 1,
    provider_key: 'microsoft_graph',
    started_at: '2026-10-09T09:00:00.000Z',
    completed_at: '2026-10-09T09:00:01.000Z',
    result_summary: 'Local reminder fixture.',
    failure_code: accepted ? null : providerOutcome,
    provider_outcome: providerOutcome,
  });
  if (saved.status !== 201) throw new Error(`Reminder execution setup failed: ${JSON.stringify(saved.payload)}`);
}

const eligible = await proposal(workspaceId, owner.id, 'eligible');
await execution(workspaceId, owner.id, eligible, 'accepted_by_provider');
const missing = await proposal(workspaceId, owner.id, 'missing');
const rejected = await proposal(workspaceId, owner.id, 'rejected');
await execution(workspaceId, owner.id, rejected, 'rejected_by_provider');
const unknown = await proposal(workspaceId, owner.id, 'unknown');
await execution(workspaceId, owner.id, unknown, 'provider_outcome_unknown');
const mismatched = await proposal(workspaceId, owner.id, 'mismatched');
const other = await proposal(otherWorkspaceId, outsider.id, 'other');
await execution(otherWorkspaceId, outsider.id, other, 'accepted_by_provider');
const started = await proposal(workspaceId, owner.id, 'started', '2026-10-08T09:00:00.000Z');
await execution(workspaceId, owner.id, started, 'accepted_by_provider');
const readableAfterStart = await proposal(workspaceId, owner.id, 'readable-after-start');
await execution(workspaceId, owner.id, readableAfterStart, 'accepted_by_provider');

const save = (meetingProposalId = eligible.proposalId, patch = {}) => rpc(serviceKey, 'save_rev_meeting_reminder_draft', {
  target_workspace_id: workspaceId,
  initiating_user_id: owner.id,
  target_request_id: randomUUID(),
  target_meeting_proposal_id: meetingProposalId,
  target_body: 'Please remember our confirmed meeting.',
  expected_version: 0,
  ...patch,
});

const requestId = randomUUID();
const first = await save(eligible.proposalId, { target_request_id: requestId });
check('VALID_OWNER_SAVE', first.status === 200 && first.payload?.body === 'Please remember our confirmed meeting.' && first.payload?.version === 1);
const replay = await save(eligible.proposalId, { target_request_id: requestId });
check('EXACT_REQUEST_REPLAY', replay.status === 200 && replay.payload?.id === first.payload?.id && replay.payload?.version === 1);
const semanticDuplicate = await save();
check('SEMANTIC_NO_OP', semanticDuplicate.status === 200 && semanticDuplicate.payload?.id === first.payload?.id && semanticDuplicate.payload?.version === 1);
const corrected = await save(eligible.proposalId, {
  initiating_user_id: admin.id,
  target_body: 'Corrected plain-text reminder.',
  expected_version: 1,
});
check('VERSION_BOUND_CORRECTION', corrected.status === 200 && corrected.payload?.body === 'Corrected plain-text reminder.' && corrected.payload?.version === 2);
const activeAdminRead = await request(admin.token, 'GET', `/rest/v1/meeting_reminder_drafts?meeting_proposal_id=eq.${eligible.proposalId}`);
check('ACTIVE_ADMIN_READ', activeAdminRead.status === 200 && activeAdminRead.rows[0]?.body === 'Corrected plain-text reminder.');
check('STALE_CORRECTION_DENIED', (await save(eligible.proposalId, {
  target_body: 'Stale reminder correction.',
  expected_version: 1,
})).status >= 400);

check('MISSING_PROVIDER_EVIDENCE_DENIED', (await save(missing.proposalId)).status >= 400);
check('REJECTED_PROVIDER_EVIDENCE_DENIED', (await save(rejected.proposalId)).status >= 400);
check('UNKNOWN_PROVIDER_EVIDENCE_DENIED', (await save(unknown.proposalId)).status >= 400);
check('MISMATCHED_PROVIDER_EVIDENCE_DENIED', (await save(mismatched.proposalId)).status >= 400);
check('MEETING_ALREADY_STARTED_DENIED', (await save(started.proposalId)).status >= 400);

const outcome = await request(serviceKey, 'POST', '/rest/v1/meeting_outcomes', {
  workspace_id: workspaceId,
  meeting_proposal_id: eligible.proposalId,
  outcome_type: 'cancelled',
  summary: 'Explicit outcome fixture.',
  occurred_at: '2026-10-09T12:00:00.000Z',
  recorded_by_user_id: owner.id,
});
if (outcome.status !== 201) throw new Error('Reminder outcome fixture failed.');
const readableAfterOutcome = await request(owner.token, 'GET', `/rest/v1/meeting_reminder_drafts?meeting_proposal_id=eq.${eligible.proposalId}`);
check('DRAFT_READABLE_AFTER_OUTCOME', readableAfterOutcome.status === 200
  && readableAfterOutcome.rows[0]?.body === 'Corrected plain-text reminder.');
check('EXPLICIT_OUTCOME_BLOCKS_EDIT', (await save(eligible.proposalId, {
  target_body: 'Blocked after outcome.',
  expected_version: 2,
})).status >= 400);

const readableDraft = await save(readableAfterStart.proposalId);
if (readableDraft.status !== 200) throw new Error('Readable reminder fixture failed.');
const pastPayload = {
  ...readableAfterStart.proposalPayload,
  startAt: '2026-10-08T09:00:00.000Z',
  endAt: '2026-10-08T09:30:00.000Z',
};
const movedPast = await request(serviceKey, 'PATCH', `/rest/v1/meeting_proposals?id=eq.${readableAfterStart.proposalId}`, {
  proposal_payload: pastPayload,
});
if (movedPast.status !== 200) throw new Error('Reminder start-boundary fixture failed.');
const readable = await request(owner.token, 'GET', `/rest/v1/meeting_reminder_drafts?meeting_proposal_id=eq.${readableAfterStart.proposalId}`);
check('DRAFT_READABLE_AFTER_START', readable.status === 200 && readable.rows[0]?.body === 'Please remember our confirmed meeting.');
check('EDIT_DENIED_AFTER_START', (await save(readableAfterStart.proposalId, {
  target_body: 'Blocked after start.',
  expected_version: 1,
})).status >= 400);

check('MEMBER_SAVE_DENIED', (await save(missing.proposalId, { initiating_user_id: member.id })).status >= 400);
const suspended = await request(serviceKey, 'PATCH', `/rest/v1/workspace_members?workspace_id=eq.${workspaceId}&user_id=eq.${admin.id}`, {
  status: 'suspended',
});
if (suspended.status !== 200) throw new Error('Reminder inactive fixture failed.');
check('INACTIVE_ADMIN_SAVE_DENIED', (await save(missing.proposalId, { initiating_user_id: admin.id })).status >= 400);
const inactiveAdminRead = await request(admin.token, 'GET', `/rest/v1/meeting_reminder_drafts?workspace_id=eq.${workspaceId}`);
check('INACTIVE_ADMIN_READ_DENIED', inactiveAdminRead.status === 200 && inactiveAdminRead.rows.length === 0);
check('CROSS_TENANT_SAVE_DENIED', (await save(other.proposalId, {
  target_workspace_id: otherWorkspaceId,
  target_meeting_proposal_id: other.proposalId,
})).status >= 400);

for (const targetBody of ['', ' padded ', 'x'.repeat(2001)]) {
  check('INVALID_BODY_DENIED', (await save(missing.proposalId, { target_body: targetBody })).status >= 400);
}
check('BROWSER_RPC_DENIED', (await rpc(owner.token, 'save_rev_meeting_reminder_draft', {
  target_workspace_id: workspaceId,
  initiating_user_id: owner.id,
  target_request_id: randomUUID(),
  target_meeting_proposal_id: eligible.proposalId,
  target_body: 'Denied.',
  expected_version: 2,
})).status >= 400);
check('DIRECT_INSERT_DENIED', (await request(owner.token, 'POST', '/rest/v1/meeting_reminder_drafts', {
  workspace_id: workspaceId,
  meeting_proposal_id: missing.proposalId,
  body: 'Denied.',
  prepared_by_user_id: owner.id,
})).status >= 400);

const ownerRead = await request(owner.token, 'GET', `/rest/v1/meeting_reminder_drafts?workspace_id=eq.${workspaceId}`);
const memberRead = await request(member.token, 'GET', `/rest/v1/meeting_reminder_drafts?workspace_id=eq.${workspaceId}`);
const outsiderRead = await request(outsider.token, 'GET', `/rest/v1/meeting_reminder_drafts?workspace_id=eq.${workspaceId}`);
check('OWNER_WORKSPACE_READ', ownerRead.status === 200 && ownerRead.rows.length === 2);
check('MEMBER_READ_DENIED', memberRead.status === 200 && memberRead.rows.length === 0);
check('CROSS_TENANT_READ_DENIED', outsiderRead.status === 200 && outsiderRead.rows.length === 0);

const audits = await request(serviceKey, 'GET', `/rest/v1/audit_log?workspace_id=eq.${workspaceId}&resource_type=eq.meeting_reminder_draft`);
check('AUDIT_ONCE_PER_ACCEPTED_CHANGE', audits.status === 200 && audits.rows.length === 3
  && audits.rows.filter((row) => row.action === 'meeting_reminder_draft.prepared').length === 2
  && audits.rows.filter((row) => row.action === 'meeting_reminder_draft.corrected').length === 1);

console.log('EXTERNAL_PROVIDER_REQUESTS=0');
console.log(`PHASE5E_MEETING_REMINDER_LOCAL=${failures ? 'FAIL' : 'PASS'}`);
if (failures) process.exit(1);
