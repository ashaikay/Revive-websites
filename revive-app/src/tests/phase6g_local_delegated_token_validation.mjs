import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

// Local Supabase only. This validator never prints secret or token values.
const base = 'http://127.0.0.1:55321';
const anon = process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const service = process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!anon || !service) throw new Error('Local Supabase test keys are required.');

let failures = 0;
let gateEnabled = false;
function check(name, ok) {
  console.log(name + '=' + (ok ? 'PASS' : 'FAIL'));
  if (!ok) failures++;
}
async function request(token, method, path, body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      apikey: anon,
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}
const rpc = (token, name, args) => request(token, 'POST', '/rest/v1/rpc/' + name, args);
function sql(query) {
  try {
    return execFileSync('docker', [
      'exec', 'supabase_db_revive-app', 'psql', '-U', 'postgres', '-d', 'postgres',
      '-v', 'ON_ERROR_STOP=1', '-Atc', query,
    ], { encoding: 'utf8' }).trim();
  } catch {
    throw new Error('Local database fixture operation failed.');
  }
}
async function identity(label, stamp) {
  const email = 'phase6g-' + stamp + '-' + label + '@example.test';
  const password = 'Local-' + randomBytes(18).toString('base64url');
  const created = await request(service, 'POST', '/auth/v1/admin/users', {
    email, password, email_confirm: true,
  });
  const logged = await request(anon, 'POST', '/auth/v1/token?grant_type=password', { email, password });
  if (created.status !== 200 || logged.status !== 200 || !logged.data?.access_token) {
    throw new Error('Local identity setup failed.');
  }
  return { id: created.data.id, token: logged.data.access_token };
}
async function proposal(workspaceId, memberId, ownerToken, title, startAt, endAt) {
  const submitted = await rpc(service, 'submit_meeting_proposal', {
    target_workspace_id: workspaceId,
    target_submitted_by: memberId,
    target_title: title,
    target_attendee_email: 'customer@example.test',
    target_start_at: startAt,
    target_end_at: endAt,
    target_timezone: 'Europe/London',
    target_meeting_method: 'online',
    target_location_details: '',
    target_notes: '',
    target_semantic_fingerprint: createHash('sha256').update(randomUUID()).digest('hex'),
  });
  const actionId = submitted.data?.[0]?.action_id;
  const approvalId = submitted.data?.[0]?.approval_id;
  if (submitted.status !== 200 || !actionId || !approvalId) throw new Error('Local proposal setup failed.');
  const approval = await request(ownerToken, 'GET',
    '/rest/v1/approvals?id=eq.' + approvalId + '&select=action_version,action_fingerprint');
  const row = approval.data?.[0];
  if (approval.status !== 200 || !row) throw new Error('Local approval lookup failed.');
  const decided = await rpc(ownerToken, 'decide_rev_action_approval', {
    target_approval_id: approvalId,
    expected_action_version: row.action_version,
    expected_action_fingerprint: row.action_fingerprint,
    approval_decision: 'approved',
  });
  if (decided.status !== 200) throw new Error('Local proposal approval failed.');
  return actionId;
}
async function reserve(ownerToken, workspaceId, actionId, requestId = randomUUID()) {
  return rpc(ownerToken, 'reserve_rev_meeting_event_execution_selected', {
    target_request_id: requestId,
    target_workspace_id: workspaceId,
    target_action_id: actionId,
  });
}
async function loadedCredential(executionId) {
  const result = await rpc(service, 'load_rev_meeting_calendar_credential', {
    target_execution_id: executionId,
  });
  return { status: result.status, row: result.data?.[0] ?? null };
}

const stamp = Date.now();
const owner = await identity('owner', stamp);
const member = await identity('member', stamp);
const outsider = await identity('outsider', stamp);
const workspaceResult = await rpc(owner.token, 'create_workspace_with_owner', {
  workspace_name: 'Phase 6G ' + stamp,
  workspace_slug: 'phase-6g-' + stamp,
});
const otherWorkspaceResult = await rpc(outsider.token, 'create_workspace_with_owner', {
  workspace_name: 'Phase 6G Other ' + stamp,
  workspace_slug: 'phase-6g-other-' + stamp,
});
const workspaceId = workspaceResult.data?.[0]?.created_workspace_id;
const otherWorkspaceId = otherWorkspaceResult.data?.[0]?.created_workspace_id;
if (!workspaceId || !otherWorkspaceId) throw new Error('Local workspace setup failed.');
const memberResult = await request(service, 'POST', '/rest/v1/workspace_members', {
  workspace_id: workspaceId, user_id: member.id, role: 'member', status: 'active',
});
if (memberResult.status !== 201) throw new Error('Local membership setup failed.');

const account = 'phase6g-' + stamp + '@example.test';
const calendarId = randomUUID();
const connectionId = randomUUID();
const credentialId = randomUUID();
const selectedCalendarReference = 'calendar-primary-' + stamp;
const alternateCalendarId = randomUUID();
const alternateCalendarReference = 'calendar-alternate-' + stamp;
const initialRefresh = 'local-initial-' + randomBytes(24).toString('base64url');
const rotatedRefresh = 'local-rotated-' + randomBytes(24).toString('base64url');
const secretId = sql("select vault.create_secret('" + initialRefresh + "')");
sql("insert into public.workspace_execution_policies (workspace_id,execution_enabled,autonomy_mode,updated_by) values ('" +
  workspaceId + "'::uuid,true,'always_ask','" + owner.id + "'::uuid)");
sql("insert into public.rev_meeting_calendar_bindings (workspace_id,provider_key,calendar_reference,timezone,enabled) values ('" +
  workspaceId + "'::uuid,'microsoft_graph','" + account + "','Europe/London',true)");
sql("insert into public.workspace_calendar_connections (id,workspace_id,provider_key,connection_status,provider_account_reference,authorized_by_user_id) values ('" +
  connectionId + "'::uuid,'" + workspaceId + "'::uuid,'microsoft_graph','disconnected','" + account + "','" + owner.id + "'::uuid)");
sql("insert into rev_calendar_private.credentials (id,workspace_id,connection_id,secret_id,granted_calendar_scopes) values ('" +
  credentialId + "'::uuid,'" + workspaceId + "'::uuid,'" + connectionId + "'::uuid,'" + secretId +
  "'::uuid,array['https://graph.microsoft.com/calendars.readwrite'])");
sql("update public.workspace_calendar_connections set connection_status='connected',credential_reference='" + credentialId +
  "',calendar_write_consent_at=now(),calendar_write_consent_by_user_id='" + owner.id + "'::uuid where id='" + connectionId + "'::uuid");
sql("insert into public.workspace_calendars (id,workspace_id,connection_id,provider_calendar_reference,display_name,timezone,is_selected,active) values ('" +
  calendarId + "'::uuid,'" + workspaceId + "'::uuid,'" + connectionId + "'::uuid,'" + selectedCalendarReference +
  "','Primary local test calendar','Europe/London',true,true),('" + alternateCalendarId + "'::uuid,'" + workspaceId +
  "'::uuid,'" + connectionId + "'::uuid,'" + alternateCalendarReference +
  "','Alternate local test calendar','Europe/London',false,true)");

const actionA = await proposal(workspaceId, member.id, owner.token, 'Credential rotation A',
  '2040-09-30T09:00:00.000Z', '2040-09-30T09:30:00.000Z');
const actionB = await proposal(workspaceId, member.id, owner.token, 'Credential rotation B',
  '2040-09-30T10:00:00.000Z', '2040-09-30T10:30:00.000Z');
const actionC = await proposal(workspaceId, member.id, owner.token, 'Terminal reservation',
  '2040-09-30T11:00:00.000Z', '2040-09-30T11:30:00.000Z');
const requestA = randomUUID();
const reservedA = await reserve(owner.token, workspaceId, actionA, requestA);
const reservedB = await reserve(owner.token, workspaceId, actionB);
const reservedC = await reserve(owner.token, workspaceId, actionC);
const executionA = reservedA.data;
const executionB = reservedB.data;
const executionC = reservedC.data;
if (reservedA.status !== 200 || reservedB.status !== 200 || reservedC.status !== 200 ||
  !executionA?.id || !executionB?.id || !executionC?.id) {
  throw new Error('Local reservation setup failed.');
}

const duplicateReservation = await reserve(owner.token, workspaceId, actionA, requestA);
check('EXACT_DUPLICATE_RESERVATION_REUSES_EXECUTION',
  duplicateReservation.status === 200 && duplicateReservation.data?.id === executionA.id);
const crossWorkspace = await rpc(owner.token, 'reserve_rev_meeting_event_execution_selected', {
  target_request_id: randomUUID(), target_workspace_id: otherWorkspaceId, target_action_id: actionA,
});
check('CROSS_WORKSPACE_RESERVATION_DENIED', crossWorkspace.status >= 400);
const changedSelectionLoadBefore = await loadedCredential(executionA.id);
check('RESERVED_CREDENTIAL_LOAD_VALIDATES_SELECTION',
  changedSelectionLoadBefore.status === 200 && changedSelectionLoadBefore.row?.calendar_id === calendarId);

sql("update public.workspace_calendars set is_selected=false where workspace_id='" + workspaceId + "'::uuid and is_selected");
sql("update public.workspace_calendars set is_selected=true where id='" + alternateCalendarId + "'::uuid");
const changedSelectionLoad = await loadedCredential(executionA.id);
const changedSelectionRotation = await rpc(service, 'rotate_rev_meeting_calendar_credential', {
  target_execution_id: executionA.id,
  expected_revision: 1,
  target_refresh_token: rotatedRefresh,
});
check('CHANGED_SELECTION_LOAD_AND_ROTATION_DENIED',
  changedSelectionLoad.status >= 400 && changedSelectionRotation.status >= 400);
sql("update public.workspace_calendars set is_selected=false where id='" + alternateCalendarId + "'::uuid");
sql("update public.workspace_calendars set is_selected=true where id='" + calendarId + "'::uuid");

const loadedA = await loadedCredential(executionA.id);
const loadedB = await loadedCredential(executionB.id);
check('VALID_RESERVED_CREDENTIAL_LOAD_FOR_PREPARED_RESERVATIONS',
  loadedA.status === 200 && loadedB.status === 200 &&
  loadedA.row?.refresh_token === initialRefresh && loadedB.row?.refresh_token === initialRefresh &&
  loadedA.row?.connection_id === connectionId && loadedA.row?.calendar_id === calendarId &&
  loadedA.row?.provider_calendar_reference === selectedCalendarReference &&
  loadedA.row?.consent_version === 1);

if (sql('select enabled from public.rev_meeting_provider_gate where singleton=true') !== 'f') {
  throw new Error('Local provider gate must be off before the validator.');
}
try {
  sql("update public.rev_meeting_provider_gate set enabled=true,allowed_workspace_id='" + workspaceId + "'::uuid where singleton=true");
  gateEnabled = true;
  const claimed = await rpc(service, 'claim_rev_meeting_provider_attempt', {
    target_execution_id: executionC.id,
    expected_request_fingerprint: executionC.request_fingerprint,
    expected_binding_version: 1,
  });
  const recorded = claimed.status === 200 ? await rpc(service, 'record_rev_meeting_provider_result', {
    target_execution_id: executionC.id,
    target_provider_outcome: 'provider_outcome_unknown',
    target_provider_reference: null,
  }) : { status: 500 };
  const duplicateClaim = await rpc(service, 'claim_rev_meeting_provider_attempt', {
    target_execution_id: executionC.id,
    expected_request_fingerprint: executionC.request_fingerprint,
    expected_binding_version: 1,
  });
  check('DUPLICATE_PROVIDER_ATTEMPT_REFUSED',
    claimed.status === 200 && recorded.status === 200 && duplicateClaim.status >= 400);
} finally {
  sql('update public.rev_meeting_provider_gate set enabled=false,allowed_workspace_id=null where singleton=true');
  gateEnabled = false;
}
check('PROVIDER_GATE_RESTORED_OFF',
  sql("select enabled::text || ':' || (allowed_workspace_id is null)::text from public.rev_meeting_provider_gate where singleton=true") === 'false:true');

const beforeTargetIdentity = sql("select string_agg(execution.id::text||':'||target.calendar_id::text||':'||target.connection_id::text||':'||target.provider_calendar_reference||':'||target.credential_revision::text,',' order by execution.id::text) from public.rev_meeting_execution_calendar_targets target join public.rev_action_executions execution on execution.id=target.execution_id where execution.workspace_id='" +
  workspaceId + "'::uuid");
const rotation = await rpc(service, 'rotate_rev_meeting_calendar_credential', {
  target_execution_id: executionA.id,
  expected_revision: 1,
  target_refresh_token: rotatedRefresh,
});
check('VALID_RESERVED_CREDENTIAL_ROTATION',
  rotation.status === 200 && rotation.data?.[0]?.credential_reference === credentialId &&
  rotation.data?.[0]?.revision === 2);
const revisionRows = sql("select string_agg(execution.id::text||':'||target.credential_revision::text,',' order by execution.id::text) from public.rev_meeting_execution_calendar_targets target join public.rev_action_executions execution on execution.id=target.execution_id where execution.workspace_id='" +
  workspaceId + "'::uuid");
const revisions = new Map(revisionRows.split(',').map(value => value.split(':')));
check('ROTATION_UPDATES_ONLY_MATCHING_PREPARED_RESERVATIONS',
  revisions.get(executionA.id) === '2' && revisions.get(executionB.id) === '2' &&
  revisions.get(executionC.id) === '1');
const afterTargetIdentity = sql("select string_agg(execution.id::text||':'||target.calendar_id::text||':'||target.connection_id::text||':'||target.provider_calendar_reference||':'||target.credential_revision::text,',' order by execution.id::text) from public.rev_meeting_execution_calendar_targets target join public.rev_action_executions execution on execution.id=target.execution_id where execution.workspace_id='" +
  workspaceId + "'::uuid");
const identityWithoutRevision = value => value.split(',').map(item => item.split(':').slice(0, 4).join(':')).sort().join(',');
check('ROTATION_PRESERVES_CALENDAR_AND_CONNECTION_IDENTITY',
  identityWithoutRevision(beforeTargetIdentity) === identityWithoutRevision(afterTargetIdentity));
const rotatedA = await loadedCredential(executionA.id);
const rotatedB = await loadedCredential(executionB.id);
check('ROTATED_VAULT_CREDENTIAL_LOADS_WITH_NEW_REVISION',
  rotatedA.status === 200 && rotatedB.status === 200 &&
  rotatedA.row?.refresh_token === rotatedRefresh && rotatedB.row?.refresh_token === rotatedRefresh &&
  rotatedA.row?.credential_revision === 2 && rotatedB.row?.credential_revision === 2);
const staleRotation = await rpc(service, 'rotate_rev_meeting_calendar_credential', {
  target_execution_id: executionA.id,
  expected_revision: 1,
  target_refresh_token: 'stale-local-refresh-' + randomBytes(16).toString('base64url'),
});
check('STALE_CREDENTIAL_REVISION_REFUSED', staleRotation.status >= 400);
const failedExecutionLoad = await loadedCredential(executionC.id);
check('TERMINAL_EXECUTION_CREDENTIAL_LOAD_DENIED', failedExecutionLoad.status >= 400);

sql("update public.workspace_calendar_connections set connection_status='revoked',revoked_at=now() where id='" + connectionId + "'::uuid");
const revokedLoad = await loadedCredential(executionA.id);
const revokedRotation = await rpc(service, 'rotate_rev_meeting_calendar_credential', {
  target_execution_id: executionB.id,
  expected_revision: 2,
  target_refresh_token: 'revoked-local-refresh-' + randomBytes(16).toString('base64url'),
});
check('REVOKED_CONSENT_LOAD_AND_ROTATION_DENIED',
  revokedLoad.status >= 400 && revokedRotation.status >= 400);
check('PROVIDER_GATE_REMAINS_OFF',
  sql('select enabled::text from public.rev_meeting_provider_gate where singleton=true') === 'false');
if (gateEnabled) throw new Error('Local provider gate was not restored.');
console.log('PHASE6G_LOCAL_DELEGATED_TOKEN=' + (failures ? 'FAIL' : 'PASS'));
if (failures) process.exitCode = 1;
