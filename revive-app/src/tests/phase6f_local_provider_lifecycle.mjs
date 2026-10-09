import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { createTrustedMeetingExecutionReadModel } from '../../supabase/functions/_shared/trustedMeetingExecutionReadModel.ts';
import { buildTrustedMeetingGraphRequest } from '../../supabase/functions/_shared/trustedMeetingGraphRequest.ts';
import { createTrustedMeetingProviderAttempt } from '../../supabase/functions/_shared/trustedMeetingProviderAttempt.ts';
import { createMeetingProviderWorkflow } from '../../supabase/functions/_shared/meetingProviderWorkflow.ts';
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
  const email = 'phase6f-'  + Date.now() + '-' + label + '@example.test';
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
const workspace = await rpc(owner.token, 'create_workspace_with_owner', { workspace_name: 'Phase 6F ' + stamp, workspace_slug: 'phase-6f-' + stamp });
const other = await rpc(outsider.token, 'create_workspace_with_owner', { workspace_name: 'Phase 6F Other ' + stamp, workspace_slug: 'phase-6f-other-' + stamp });
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
const args = { target_request_id: randomUUID(), target_workspace_id: workspaceId, target_action_id: actionId };
check('OLD_BOUND_RPC_REVOKED', sql("select has_function_privilege('authenticated','public.reserve_rev_meeting_event_execution_bound(uuid,uuid,uuid,text,text,bigint)','EXECUTE')") === 'f');
check('NO_POLICY_DENIED', (await rpc(owner.token, 'reserve_rev_meeting_event_execution_selected', args)).status >= 400);
sql("insert into public.workspace_execution_policies (workspace_id, execution_enabled, autonomy_mode, updated_by) values ('" + workspaceId + "'::uuid, true, 'always_ask', '" + owner.id + "'::uuid) on conflict (workspace_id) do update set execution_enabled=true, autonomy_mode='always_ask', updated_by=excluded.updated_by");
check('NO_BINDING_DENIED', (await rpc(owner.token, 'reserve_rev_meeting_event_execution_selected', args)).status >= 400);
sql("insert into public.rev_meeting_calendar_bindings (workspace_id, provider_key, calendar_reference, timezone, enabled) values ('" + workspaceId + "'::uuid, 'microsoft_graph', 'local-test-mailbox@example.test', 'Europe/London', false)");
check('DISABLED_BINDING_DENIED', (await rpc(owner.token, 'reserve_rev_meeting_event_execution_selected', args)).status >= 400);
sql("update public.rev_meeting_calendar_bindings set enabled=true where workspace_id='" + workspaceId + "'::uuid");
const memberCall = await rpc(member.token, 'reserve_rev_meeting_event_execution_selected', args);
const outsiderCall = await rpc(outsider.token, 'reserve_rev_meeting_event_execution_selected', args);
const wrongWorkspace = await rpc(owner.token, 'reserve_rev_meeting_event_execution_selected', { ...args, target_workspace_id: otherId });
check('MEMBER_AND_CROSS_TENANT_DENIED', memberCall.status >= 400 && outsiderCall.status >= 400 && wrongWorkspace.status >= 400);
const connectionId = randomUUID();
const calendarId = randomUUID();
const credentialId = randomUUID();
const accountReference = 'local-test-mailbox@example.test';
const calendarReference = 'local-selected-calendar-' + stamp;
const secretId = sql("select vault.create_secret('phase6f-local-only-fake-refresh-token')");
sql("insert into public.workspace_calendar_connections (id,workspace_id,provider_key,connection_status,provider_account_reference,authorized_by_user_id) values ('" +
  connectionId + "'::uuid,'" + workspaceId + "'::uuid,'microsoft_graph','disconnected','" + accountReference + "','" + owner.id + "'::uuid)");
sql("insert into rev_calendar_private.credentials (id,workspace_id,connection_id,secret_id,granted_calendar_scopes) values ('" +
  credentialId + "'::uuid,'" + workspaceId + "'::uuid,'" + connectionId + "'::uuid,'" + secretId +
  "'::uuid,array['https://graph.microsoft.com/calendars.readwrite'])");
sql("update public.workspace_calendar_connections set connection_status='connected',credential_reference='" + credentialId +
  "',calendar_write_consent_at=now(),calendar_write_consent_by_user_id='" + owner.id + "'::uuid where id='" + connectionId + "'::uuid");
sql("insert into public.workspace_calendars (id,workspace_id,connection_id,provider_calendar_reference,display_name,timezone,is_selected,active) values ('" +
  calendarId + "'::uuid,'" + workspaceId + "'::uuid,'" + connectionId + "'::uuid,'" + calendarReference + "','Local calendar','Europe/London',true,true)");
const selectedArgs = { target_request_id: randomUUID(), target_workspace_id: workspaceId, target_action_id: actionId };
const deniedCrossWorkspace = await rpc(owner.token, 'reserve_rev_meeting_event_execution_selected', { ...selectedArgs, target_workspace_id: otherId });
check('SELECTED_BINDING_CROSS_WORKSPACE_DENIED', deniedCrossWorkspace.status >= 400);
const accepted = await rpc(owner.token, 'reserve_rev_meeting_event_execution_selected', selectedArgs);
const execution = accepted.data;
check('OWNER_DURABLE_NO_PROVIDER', accepted.status === 200 && execution?.capability === 'CREATE_APPROVED_MEETING_EVENT' && execution?.provider_outcome === 'provider_not_invoked' && execution?.status === 'prepared' && execution?.mode === 'dry_run');
const duplicateReservation = await rpc(owner.token, 'reserve_rev_meeting_event_execution_selected', selectedArgs);
check('EXACT_RESERVATION_RETRY_REUSES_EXECUTION', duplicateReservation.status === 200 && duplicateReservation.data?.id === execution?.id);
const alternateCalendarId = randomUUID();
const alternateCalendarReference = 'local-alternate-calendar-' + stamp;
sql("update public.workspace_calendars set is_selected=false where workspace_id='" + workspaceId + "'::uuid and is_selected");
sql("insert into public.workspace_calendars (id,workspace_id,connection_id,provider_calendar_reference,display_name,timezone,is_selected,active) values ('" +
  alternateCalendarId + "'::uuid,'" + workspaceId + "'::uuid,'" + connectionId + "'::uuid,'" + alternateCalendarReference + "','Alternate local calendar','Europe/London',true,true)");
const changedSelectionRetry = await rpc(owner.token, 'reserve_rev_meeting_event_execution_selected', selectedArgs);
check('CHANGED_SELECTION_RETRY_REFUSED', changedSelectionRetry.status >= 400);
sql("update public.workspace_calendars set is_selected=false where id='" + alternateCalendarId + "'::uuid");
sql("update public.workspace_calendars set is_selected=true where id='" + calendarId + "'::uuid");

const client = { rpc: async (name, parameters) => {
  const response = await rpc(service, name, parameters);
  return {
    data: response.status === 200
      ? Array.isArray(response.data) ? response.data : [response.data]
      : null,
    error: response.status === 200 ? null : response.data,
  };
}, from: table => ({ select: columns => ({ eq: (first, firstValue) => ({ eq: (second, secondValue) => ({ maybeSingle: async () => {
  const path = '/rest/v1/' + table + '?' + new URLSearchParams({ [first]: 'eq.' + firstValue, [second]: 'eq.' + secondValue, select: columns });
  const response = await request(service, 'GET', path);
  return { data: response.status === 200 ? response.data?.[0] ?? null : null, error: response.status === 200 ? null : response.data };
} }) }) }) }) };
const loader = createTrustedMeetingExecutionReadModel(client);
const snapshot = await loader(execution.id);
check('REAL_APPROVED_SNAPSHOT', snapshot.executionId === execution.id && snapshot.workspaceId === workspaceId &&
  snapshot.actionId === actionId && snapshot.approvalId === approvalId &&
  snapshot.requestFingerprint === execution.request_fingerprint && snapshot.proposal.title === 'Local reservation test');
check('REAL_BINDING_AND_IDEMPOTENCY', snapshot.bindingVersion === 1 &&
  snapshot.calendarReference === accountReference && snapshot.providerCalendarReference === calendarReference &&
  snapshot.calendarId === calendarId && snapshot.connectionId === connectionId &&
  snapshot.credentialReference === credentialId && snapshot.credentialRevision === 1 &&
  snapshot.timezone === 'Europe/London' &&
  snapshot.semanticIdempotencyKey === execution.idempotency_key);
const graphRequest = buildTrustedMeetingGraphRequest(snapshot, {
  workspaceId, providerAccountReference: accountReference, accessToken: 'mapping-only-no-Graph-call',
});
check('REAL_GRAPH_SNAPSHOT_MAPPING',
  graphRequest.idempotencyKey === execution.request_fingerprint &&
  graphRequest.snapshot.title === snapshot.proposal.title &&
  graphRequest.snapshot.attendeeEmail === snapshot.proposal.attendeeEmail &&
  graphRequest.snapshot.startAt === snapshot.proposal.startAt &&
  graphRequest.snapshot.endAt === snapshot.proposal.endAt &&
  graphRequest.snapshot.timezone === snapshot.timezone &&
  graphRequest.snapshot.meetingMethod === snapshot.proposal.meetingMethod &&
  graphRequest.snapshot.locationDetails === snapshot.proposal.locationDetails &&
  graphRequest.snapshot.notes === snapshot.proposal.notes &&
  Object.keys(graphRequest.snapshot).length === 8);
let mismatchDenied = false;
try { buildTrustedMeetingGraphRequest(snapshot, { workspaceId, providerAccountReference: 'other@example.test', accessToken: 'mapping-only' }); } catch { mismatchDenied = true; }
check('MISMATCHED_TRUSTED_MAILBOX_DENIED', mismatchDenied);
// Exercise the actual service-role claim/result RPCs with a fake Graph adapter.
// This switch affects LOCAL Supabase only; it is restored even if the test fails.
const attemptClient = {
  rpc: async (name, parameters) => {
    const response = await rpc(service, name, parameters);
    return { data: response.data, error: response.status >= 400 ? response.data : null };
  },
};
const lifecycle = createTrustedMeetingProviderAttempt(attemptClient);
let graphCalls = 0;
let lifecycleResult = null;
let lifecycleError = null;
if (sql('select enabled from public.rev_meeting_provider_gate where singleton=true') !== 'f') {
  throw new Error('Local provider gate must be off before this test.');
}
try {
  sql("update public.rev_meeting_provider_gate set enabled=true, allowed_workspace_id='" + workspaceId + "'::uuid where singleton=true");
  lifecycleResult = await createMeetingProviderWorkflow({
    loadGraphRequest: async () => graphRequest,
    claim: lifecycle.claim,
    invokeGraph: async request => {
      graphCalls++;
      if (request !== graphRequest) throw new Error('Approved request changed.');
      // No fetch, HTTP, Microsoft credential or real Graph invocation.
      return { provider: 'microsoft_graph', outcome: 'created', providerEventReference: 'local-fake-event-' + stamp, actualCost: 0 };
    },
    record: lifecycle.record,
  }, true)({ executionId: execution.id, correlationId: execution.correlation_id,
    requestFingerprint: execution.request_fingerprint, bindingVersion: snapshot.bindingVersion });
} catch (error) {
  lifecycleError = error;
} finally {
  sql('update public.rev_meeting_provider_gate set enabled=false, allowed_workspace_id=null where singleton=true');
}
check('LOCAL_GATE_RESTORED_OFF', sql("select enabled::text || ':' || (allowed_workspace_id is null)::text from public.rev_meeting_provider_gate where singleton=true") === 'false:true');
check('REAL_DURABLE_CLAIM_AND_RESULT_WITH_FAKE_GRAPH',
  !lifecycleError && graphCalls === 1 && lifecycleResult?.executionId === execution.id &&
  lifecycleResult?.status === 'succeeded' && lifecycleResult?.outcome === 'accepted_by_provider');
let duplicateAttemptDenied = false;
try {
  await createMeetingProviderWorkflow({
    loadGraphRequest: async () => graphRequest,
    claim: lifecycle.claim,
    invokeGraph: async () => {
      graphCalls++;
      return { provider: 'microsoft_graph', outcome: 'created', providerEventReference: 'duplicate-local-event', actualCost: 0 };
    },
    record: lifecycle.record,
  }, true)({ executionId: execution.id, correlationId: execution.correlation_id,
    requestFingerprint: execution.request_fingerprint, bindingVersion: snapshot.bindingVersion });
} catch { duplicateAttemptDenied = true; }
check('DUPLICATE_PROVIDER_ATTEMPT_DENIED', duplicateAttemptDenied && graphCalls === 1);
check('ONE_LOCAL_PROVIDER_USAGE_RECORD',
  sql("select count(*) from public.provider_usage_events where execution_id='" + execution.id + "'::uuid") === '1');
if (lifecycleError) console.log('LOCAL_LIFECYCLE_ERROR=' + String(lifecycleError.message).replace(/[\r\n]/g, ' '));
sql("update public.workspace_calendar_connections set connection_status='revoked',revoked_at=now() where id='" + connectionId + "'::uuid");
const secondProposal = await rpc(service, 'submit_meeting_proposal', {
  target_workspace_id: workspaceId, target_submitted_by: member.id, target_title: 'Revoked consent reservation test',
  target_attendee_email: 'customer@example.test', target_start_at: '2040-09-30T10:00:00.000Z',
  target_end_at: '2040-09-30T10:30:00.000Z', target_timezone: 'Europe/London',
  target_meeting_method: 'online', target_location_details: '', target_notes: '',
  target_semantic_fingerprint: createHash('sha256').update(randomUUID()).digest('hex'),
});
const secondActionId = secondProposal.data?.[0]?.action_id;
const secondApprovalId = secondProposal.data?.[0]?.approval_id;
if (!secondActionId || !secondApprovalId) throw new Error('Local second proposal setup failed.');
const secondApproval = await request(owner.token, 'GET', '/rest/v1/approvals?id=eq.' + secondApprovalId + '&select=action_version,action_fingerprint');
const secondApprovalRow = secondApproval.data?.[0];
const secondDecision = await rpc(owner.token, 'decide_rev_action_approval', {
  target_approval_id: secondApprovalId, expected_action_version: secondApprovalRow.action_version,
  expected_action_fingerprint: secondApprovalRow.action_fingerprint, approval_decision: 'approved',
});
const revokedReservation = await rpc(owner.token, 'reserve_rev_meeting_event_execution_selected', {
  target_request_id: randomUUID(), target_workspace_id: workspaceId, target_action_id: secondActionId,
});
check('REVOKED_WRITE_CONSENT_RESERVATION_REFUSED', secondDecision.status === 200 && revokedReservation.status >= 400);
sql("update public.rev_meeting_calendar_bindings set enabled=false where workspace_id='" + workspaceId + "'::uuid");
let disabledDenied = false;
try { await loader(execution.id); } catch { disabledDenied = true; }
check('TERMINAL_SNAPSHOT_UNAVAILABLE', disabledDenied);
console.log('PHASE6F_LOCAL_PROVIDER_LIFECYCLE=' + (failures ? 'FAIL' : 'PASS'));
if (failures) process.exitCode = 1;
