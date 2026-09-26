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
  const email = 'phase5w-'  + Date.now() + '-' + label + '@example.test';
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
const workspace = await rpc(owner.token, 'create_workspace_with_owner', { workspace_name: 'Phase 5W ' + stamp, workspace_slug: 'phase-5w-' + stamp });
const other = await rpc(outsider.token, 'create_workspace_with_owner', { workspace_name: 'Phase 5W Other ' + stamp, workspace_slug: 'phase-5w-other-' + stamp });
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
check('OLD_RPC_REVOKED', sql("select has_function_privilege('authenticated','public.reserve_rev_meeting_event_execution(uuid,uuid,uuid)','EXECUTE')") === 'f');
const args = { target_request_id: randomUUID(), target_workspace_id: workspaceId, target_action_id: actionId, expected_calendar_reference: 'local-test-mailbox@example.test', expected_timezone: 'Europe/London', expected_binding_version: 1 };
check('NO_POLICY_DENIED', (await rpc(owner.token, 'reserve_rev_meeting_event_execution_bound', args)).status >= 400);
sql("insert into public.workspace_execution_policies (workspace_id, execution_enabled, autonomy_mode, updated_by) values ('" + workspaceId + "'::uuid, true, 'always_ask', '" + owner.id + "'::uuid) on conflict (workspace_id) do update set execution_enabled=true, autonomy_mode='always_ask', updated_by=excluded.updated_by");
check('NO_BINDING_DENIED', (await rpc(owner.token, 'reserve_rev_meeting_event_execution_bound', args)).status >= 400);
sql("insert into public.rev_meeting_calendar_bindings (workspace_id, provider_key, calendar_reference, timezone, enabled) values ('" + workspaceId + "'::uuid, 'microsoft_graph', 'local-test-mailbox@example.test', 'Europe/London', false)");
check('DISABLED_BINDING_DENIED', (await rpc(owner.token, 'reserve_rev_meeting_event_execution_bound', args)).status >= 400);
sql("update public.rev_meeting_calendar_bindings set enabled=true where workspace_id='" + workspaceId + "'::uuid");
const memberCall = await rpc(member.token, 'reserve_rev_meeting_event_execution_bound', args);
const outsiderCall = await rpc(outsider.token, 'reserve_rev_meeting_event_execution_bound', args);
const wrongWorkspace = await rpc(owner.token, 'reserve_rev_meeting_event_execution_bound', { ...args, target_workspace_id: otherId });
check('MEMBER_AND_CROSS_TENANT_DENIED', memberCall.status >= 400 && outsiderCall.status >= 400 && wrongWorkspace.status >= 400);
const accepted = await rpc(owner.token, 'reserve_rev_meeting_event_execution_bound', args);
const execution = accepted.data;
check('OWNER_DURABLE_NO_PROVIDER', accepted.status === 200 && execution?.capability === 'CREATE_APPROVED_MEETING_EVENT' && execution?.provider_outcome === 'provider_not_invoked' && execution?.status === 'prepared' && execution?.mode === 'dry_run');

if (!execution?.id || !execution?.request_fingerprint) throw new Error('Prepared meeting execution unavailable.');
check('GATE_DEFAULTS_OFF', sql('select enabled::text from public.rev_meeting_provider_gate where singleton') === 'false');
check('GATE_REQUIRES_ONE_WORKSPACE', sqlRejectedGateBinding());
function sqlRejectedGateBinding() {
  try { sql('update public.rev_meeting_provider_gate set enabled=true where singleton'); return false; } catch { return true; }
}
check('TRUSTED_ONLY_CLAIM_AND_RESULT', sql("select has_function_privilege('authenticated','public.claim_rev_meeting_provider_attempt(uuid,text,bigint)','EXECUTE')::text || ':' || has_function_privilege('authenticated','public.record_rev_meeting_provider_result(uuid,text,text)','EXECUTE')::text") === 'false:false');
function sqlRejected(query) {
  try { sql(query); return false; } catch { return true; }
}
const claim = "select public.claim_rev_meeting_provider_attempt('" + execution.id + "'::uuid,'" + execution.request_fingerprint + "',1)";
check('DISABLED_GATE_DENIES_CLAIM', sqlRejected('begin; set local role service_role; ' + claim + '; rollback;'));
check('WRONG_WORKSPACE_GATE_DENIES_CLAIM', sqlRejected(
  "begin; update public.rev_meeting_provider_gate set enabled=true, allowed_workspace_id='" + otherId + "'::uuid where singleton; set local role service_role; " + claim + '; rollback;'));
// The postgres-only gate change and all provider-state mutations are rolled back together.
// No Graph call is made. The service_role tests use exactly the RPC grants the backend has.
function transaction(outcome, reference) {
  const ref = reference === null ? 'null' : "'" + reference + "'";
  return sql("begin; update public.rev_meeting_provider_gate set enabled=true, allowed_workspace_id='" + workspaceId + "'::uuid where singleton; " +
    "set local role service_role; " +
    "select (public.claim_rev_meeting_provider_attempt('" + execution.id + "'::uuid,'" + execution.request_fingerprint + "',1)).provider_outcome; " +
    "select (public.record_rev_meeting_provider_result('" + execution.id + "'::uuid,'" + outcome + "'," + ref + ")).provider_outcome; " +
    "select count(*)::text from public.provider_usage_events where execution_id='" + execution.id + "'::uuid; " +
    "rollback;");
}
for (const [outcome, reference] of [['accepted_by_provider','local-event-id'], ['rejected_by_provider',null], ['provider_outcome_unknown',null]]) {
  const output = transaction(outcome, reference);
  check('TRANSIENT_' + outcome.toUpperCase(), output.includes('provider_attempt_claimed') && output.includes(outcome) && output.split('\n').includes('1'));
}
check('DUPLICATE_CLAIM_DENIED', sqlRejected(
  "begin; update public.rev_meeting_provider_gate set enabled=true, allowed_workspace_id='" + workspaceId + "'::uuid where singleton; set local role service_role; " +
  claim + '; ' + claim + '; rollback;'));
check('DUPLICATE_RESULT_DENIED', sqlRejected(
  "begin; update public.rev_meeting_provider_gate set enabled=true, allowed_workspace_id='" + workspaceId + "'::uuid where singleton; set local role service_role; " +
  claim + "; select public.record_rev_meeting_provider_result('" + execution.id + "'::uuid,'accepted_by_provider','local-event-id'); " +
  "select public.record_rev_meeting_provider_result('" + execution.id + "'::uuid,'accepted_by_provider','local-event-id'); rollback;"));
check('ROLLBACK_PRESERVES_DISABLED_RESERVATION',
  sql("select provider_outcome || ':' || status from public.rev_action_executions where id='" + execution.id + "'::uuid") === 'provider_not_invoked:prepared' &&
  sql('select enabled::text || \':\' || (allowed_workspace_id is null)::text from public.rev_meeting_provider_gate where singleton') === 'false:true' &&
  sql("select count(*) from public.provider_usage_events where execution_id='" + execution.id + "'::uuid") === '0');
console.log('PHASE5W_LOCAL_CLAIM=' + (failures ? 'FAIL' : 'PASS'));
if (failures) process.exitCode = 1;
