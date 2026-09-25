import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  const email = 'phase5v-'  + Date.now() + '-' + label + '@example.test';
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
const workspace = await rpc(owner.token, 'create_workspace_with_owner', { workspace_name: 'Phase 5V ' + stamp, workspace_slug: 'phase-5v-' + stamp });
const other = await rpc(outsider.token, 'create_workspace_with_owner', { workspace_name: 'Phase 5V Other ' + stamp, workspace_slug: 'phase-5v-other-' + stamp });
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

const origin = 'http://localhost:5173';
const envDirectory = mkdtempSync(join(tmpdir(), 'rev-phase5v-'));
const envPath = join(envDirectory, 'local.env');
writeFileSync(envPath, [
  'REV_MEETING_EXECUTION_ALLOWED_ORIGIN=' + origin,
  'REV_CALENDAR_AVAILABILITY_WORKSPACE_ID=' + workspaceId,
  'REV_CALENDAR_AVAILABILITY_PRIMARY_MAILBOX=local-test-mailbox@example.test',
  'REV_CALENDAR_AVAILABILITY_TIMEZONE=Europe/London',
].join('\n') + '\n', { mode: 0o600 });
const runner = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', [
  '--yes', 'supabase@latest', 'functions', 'serve', 'rev-meeting-execute',
  '--no-verify-jwt', '--env-file', envPath,
], { shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
for (const stream of [runner.stdout, runner.stderr]) stream?.on('data', chunk => { logs = (logs + chunk.toString()).slice(-3000); });
async function http(token, payload) {
  const response = await fetch(base + '/functions/v1/rev-meeting-execute', {
    method: 'POST', headers: { Origin: origin, apikey: anon,
      Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
try {
  let ready = false;
  for (let i = 0; i < 60; i++) {
    if (runner.exitCode !== null) break;
    try {
      const response = await fetch(base + '/functions/v1/rev-meeting-execute', { headers: { Origin: origin } });
      if (response.status === 405) { ready = true; break; }
    } catch { /* runtime still loading */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Local function did not become ready. ' + logs);
  const input = { requestId: randomUUID(), workspaceId, actionId };
  const ownerResponse = await http(owner.token, input);
  check('HTTP_OWNER_DURABLE_DISABLED', ownerResponse.status === 200 &&
    ownerResponse.data?.status === 'provider_disabled' &&
    ownerResponse.data?.executionEnabled === false &&
    ownerResponse.data?.providerInvoked === false &&
    ownerResponse.data?.eventCreated === false &&
    ownerResponse.data?.providerOutcome === 'provider_not_invoked');
  const adminResponse = await http(admin.token, { ...input, requestId: randomUUID() });
  check('HTTP_ADMIN_SEMANTIC_REPLAY', adminResponse.status === 200 &&
    adminResponse.data?.executionId === ownerResponse.data?.executionId);
  const memberResponse = await http(member.token, input);
  const outsiderResponse = await http(outsider.token, input);
  const crossTenantResponse = await http(owner.token, { ...input, workspaceId: otherId });
  check('HTTP_MEMBER_AND_CROSS_TENANT_DENIED', memberResponse.status === 403 &&
    outsiderResponse.status === 403 && crossTenantResponse.status === 403);
  const injected = await http(owner.token, { ...input, attendeeEmail: 'injected@example.test' });
  check('HTTP_INJECTED_FIELDS_DENIED', injected.status === 403);
  const evidence = sql("select count(*)::text || ':' || coalesce(max(provider_outcome),'') from public.rev_action_executions where workspace_id='" + workspaceId + "'::uuid and action_id='" + actionId + "'::uuid and capability='CREATE_APPROVED_MEETING_EVENT'");
  check('HTTP_ONE_RESERVATION_NO_PROVIDER', evidence === '1:provider_not_invoked');
} finally {
  if (runner.exitCode === null) {
    if (process.platform === 'win32') {
      try { execFileSync('taskkill', ['/PID', String(runner.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { runner.kill(); }
    } else runner.kill('SIGTERM');
  }
  rmSync(envDirectory, { recursive: true, force: true });
}
console.log('PHASE5V_LOCAL_HTTP=' + (failures ? 'FAIL' : 'PASS'));
if (failures) process.exitCode = 1;
