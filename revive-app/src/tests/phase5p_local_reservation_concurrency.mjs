import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Local stack only. Requires the same two local test keys as the Phase 5J validator.
const base = 'http://127.0.0.1:55321';
const anon = process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const service = process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!anon || !service) throw new Error('Local Supabase test keys are required.');
let failures = 0;
function check(name, ok) { console.log(name + '=' + (ok ? 'PASS' : 'FAIL')); if (!ok) failures++; }
async function request(token, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: { apikey: anon, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
const rpc = (token, name, args) => request(token, 'POST', '/rest/v1/rpc/' + name, args);
function sql(query) {
  return execFileSync('docker', ['exec', 'supabase_db_revive-app', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', query], { encoding: 'utf8' }).trim();
}
async function identity(label) {
  const email = 'phase5p-' + Date.now() + '-' + label + '@example.test';
  const password = 'Local-' + randomBytes(18).toString('base64url');
  const created = await request(service, 'POST', '/auth/v1/admin/users', { email, password, email_confirm: true });
  const logged = await request(anon, 'POST', '/auth/v1/token?grant_type=password', { email, password });
  if (created.status !== 200 || logged.status !== 200 || !logged.data?.access_token) throw new Error('Local identity failed: ' + label);
  return { id: created.data.id, token: logged.data.access_token };
}
const owner = await identity('owner');
const admin = await identity('admin');
const member = await identity('member');
const outsider = await identity('outsider');
const stamp = Date.now();
const workspace = await rpc(owner.token, 'create_workspace_with_owner', { workspace_name: 'Phase 5P ' + stamp, workspace_slug: 'phase-5p-' + stamp });
const other = await rpc(outsider.token, 'create_workspace_with_owner', { workspace_name: 'Phase 5P Other ' + stamp, workspace_slug: 'phase-5p-other-' + stamp });
const workspaceId = workspace.data?.[0]?.created_workspace_id;
const otherId = other.data?.[0]?.created_workspace_id;
if (!workspaceId || !otherId) throw new Error('Local workspace setup failed.');
for (const [user, role] of [[admin, 'admin'], [member, 'member']]) {
  const added = await request(service, 'POST', '/rest/v1/workspace_members', { workspace_id: workspaceId, user_id: user.id, role, status: 'active' });
  if (added.status !== 201) throw new Error('Local membership failed: ' + role);
}
const proposed = await rpc(service, 'submit_meeting_proposal', {
  target_workspace_id: workspaceId, target_submitted_by: member.id, target_title: 'Local reservation test',
  target_attendee_email: 'customer@example.test', target_start_at: '2040-09-30T09:00:00.000Z',
  target_end_at: '2040-09-30T09:30:00.000Z', target_timezone: 'Europe/London',
  target_meeting_method: 'online', target_location_details: '', target_notes: '',
  target_semantic_fingerprint: createHash('sha256').update(randomUUID()).digest('hex'),
});
const actionId = proposed.data?.[0]?.action_id;
const approvalId = proposed.data?.[0]?.approval_id;
if (!actionId || !approvalId) throw new Error('Local proposal setup failed: ' + JSON.stringify(proposed.data));
const approval = await request(owner.token, 'GET', '/rest/v1/approvals?id=eq.' + approvalId + '&select=action_version,action_fingerprint');
const row = approval.data?.[0];
if (!row) throw new Error('Local approval lookup failed.');
const decision = await rpc(owner.token, 'decide_rev_action_approval', {
  target_approval_id: approvalId, expected_action_version: row.action_version,
  expected_action_fingerprint: row.action_fingerprint, approval_decision: 'approved',
});
check('OWNER_APPROVED', decision.status === 200);
const args = { target_request_id: randomUUID(), target_workspace_id: workspaceId, target_action_id: actionId };
check('NO_POLICY_DENIED', (await rpc(owner.token, 'reserve_rev_meeting_event_execution', args)).status >= 400);
sql("insert into public.workspace_execution_policies (workspace_id, execution_enabled, autonomy_mode, updated_by) values ('" + workspaceId + "'::uuid, true, 'always_ask', '" + owner.id + "'::uuid) on conflict (workspace_id) do update set execution_enabled=true, autonomy_mode='always_ask', updated_by=excluded.updated_by");
check('NO_BINDING_DENIED', (await rpc(owner.token, 'reserve_rev_meeting_event_execution', args)).status >= 400);
sql("insert into public.rev_meeting_calendar_bindings (workspace_id, provider_key, calendar_reference, timezone, enabled) values ('" + workspaceId + "'::uuid, 'microsoft_graph', 'local-test-mailbox@example.test', 'Europe/London', false)");
check('DISABLED_BINDING_DENIED', (await rpc(owner.token, 'reserve_rev_meeting_event_execution', args)).status >= 400);
sql("update public.rev_meeting_calendar_bindings set enabled=true where workspace_id='" + workspaceId + "'::uuid");
const memberCall = await rpc(member.token, 'reserve_rev_meeting_event_execution', args);
const outsiderCall = await rpc(outsider.token, 'reserve_rev_meeting_event_execution', args);
const wrongWorkspace = await rpc(owner.token, 'reserve_rev_meeting_event_execution', { ...args, target_workspace_id: otherId });
check('MEMBER_AND_CROSS_TENANT_DENIED', memberCall.status >= 400 && outsiderCall.status >= 400 && wrongWorkspace.status >= 400);
const accepted = await rpc(owner.token, 'reserve_rev_meeting_event_execution', args);
const execution = accepted.data;
check('OWNER_DURABLE_NO_PROVIDER', accepted.status === 200 && execution?.capability === 'CREATE_APPROVED_MEETING_EVENT' && execution?.provider_outcome === 'provider_not_invoked' && execution?.status === 'prepared' && execution?.mode === 'dry_run');
const replay = await rpc(admin.token, 'reserve_rev_meeting_event_execution', { ...args, target_request_id: randomUUID() });
check('ADMIN_SEMANTIC_REPLAY', replay.status === 200 && replay.data?.id === execution?.id && replay.data?.correlation_id === execution?.correlation_id);

// A fresh action is required: simultaneous first requests exercise the insert race.
const concurrentProposal = await rpc(service, 'submit_meeting_proposal', {
  target_workspace_id: workspaceId, target_submitted_by: member.id, target_title: 'Concurrent reservation',
  target_attendee_email: 'customer@example.test', target_start_at: '2040-10-01T09:00:00.000Z',
  target_end_at: '2040-10-01T09:30:00.000Z', target_timezone: 'Europe/London',
  target_meeting_method: 'online', target_location_details: '', target_notes: '',
  target_semantic_fingerprint: createHash('sha256').update(randomUUID()).digest('hex'),
});
const concurrentActionId = concurrentProposal.data?.[0]?.action_id;
const concurrentApprovalId = concurrentProposal.data?.[0]?.approval_id;
if (!concurrentActionId || !concurrentApprovalId) throw new Error('Concurrent proposal setup failed.');
const concurrentApproval = await request(owner.token, 'GET', '/rest/v1/approvals?id=eq.' + concurrentApprovalId + '&select=action_version,action_fingerprint');
const concurrentRow = concurrentApproval.data?.[0];
if (!concurrentRow) throw new Error('Concurrent approval lookup failed.');
const concurrentDecision = await rpc(owner.token, 'decide_rev_action_approval', {
  target_approval_id: concurrentApprovalId, expected_action_version: concurrentRow.action_version,
  expected_action_fingerprint: concurrentRow.action_fingerprint, approval_decision: 'approved',
});
check('CONCURRENT_ACTION_APPROVED', concurrentDecision.status === 200);
const concurrentCalls = await Promise.all(Array.from({ length: 12 }, (_, i) =>
  rpc(i % 2 ? admin.token : owner.token, 'reserve_rev_meeting_event_execution', {
    target_request_id: randomUUID(), target_workspace_id: workspaceId, target_action_id: concurrentActionId,
  })));
const concurrentIds = concurrentCalls.map(result => result.data?.id);
check('CONCURRENT_FIRST_REQUESTS_ONE_RESERVATION',
  concurrentCalls.every(result => result.status === 200) &&
  concurrentIds.every(value => value && value === concurrentIds[0]) &&
  sql("select count(*) from public.rev_action_executions where workspace_id='" + workspaceId + "'::uuid and action_id='" + concurrentActionId + "'::uuid and capability='CREATE_APPROVED_MEETING_EVENT'") === '1');

sql("update public.rev_meeting_calendar_bindings set calendar_reference='changed@example.test' where workspace_id='" + workspaceId + "'::uuid");
check('CHANGED_CALENDAR_CONFLICTS_WITH_REPLAY', (await rpc(owner.token, 'reserve_rev_meeting_event_execution', args)).status >= 400);
sql("update public.rev_meeting_calendar_bindings set calendar_reference='local-test-mailbox@example.test' where workspace_id='" + workspaceId + "'::uuid");
sql("update public.rev_meeting_calendar_bindings set enabled=false where workspace_id='" + workspaceId + "'::uuid");
check('REPLAY_RECHECKS_BINDING', (await rpc(owner.token, 'reserve_rev_meeting_event_execution', args)).status >= 400);
const evidence = sql("select count(*)::text || ':' || coalesce(max(provider_outcome),'') from public.rev_action_executions where workspace_id='" + workspaceId + "'::uuid and capability='CREATE_APPROVED_MEETING_EVENT'");
check('TWO_ACTIONS_ONE_RESERVATION_EACH_NO_PROVIDER', evidence === '2:provider_not_invoked');
console.log('PHASE5P_LOCAL_RESERVATION=' + (failures ? 'FAIL' : 'PASS'));
if (failures) process.exitCode = 1;
