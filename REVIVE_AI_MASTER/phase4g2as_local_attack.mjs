import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const BASE_URL = 'http://127.0.0.1:55321';
const API_KEY = process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!API_KEY || !SERVICE_ROLE_KEY) throw new Error('Local Supabase test keys are required');

let failures = 0;
function check(label, condition) {
  console.log(`${label}=${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures += 1;
}

function endpoint(path) { return new URL(path, BASE_URL); }

async function request(token, method, path, query = {}, body) {
  const target = endpoint(path);
  Object.entries(query).forEach(([key, value]) => target.searchParams.set(key, value));
  const headers = { apikey: API_KEY, Authorization: `Bearer ${token}`, Prefer: 'return=representation' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(target, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, rows: Array.isArray(payload) ? payload : [] };
}

async function rpc(token, name, body) { return request(token, 'POST', `/rest/v1/rpc/${name}`, {}, body); }

async function createIdentity(label, stamp) {
  const email = `phase4g2as-${label}-${stamp}@example.test`;
  const password = `Local-${randomBytes(18).toString('base64url')}`;
  const created = await fetch(endpoint('/auth/v1/admin/users'), {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await created.json();
  const signedIn = await fetch(endpoint('/auth/v1/token?grant_type=password'), {
    method: 'POST', headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const session = await signedIn.json();
  check(`IDENTITY_${label.toUpperCase()}`, created.status === 200 && signedIn.status === 200 && Boolean(session.access_token));
  return { id: user.id, token: session.access_token };
}

function localSql(sql) {
  return execFileSync('docker', [
    'exec', 'supabase_db_revive-app', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc', sql,
  ], { encoding: 'utf8' }).trim();
}

async function serviceInsert(table, body) { return request(SERVICE_ROLE_KEY, 'POST', `/rest/v1/${table}`, {}, body); }
async function addMembership(workspaceId, identity, role) {
  return serviceInsert('workspace_members', { workspace_id: workspaceId, user_id: identity.id, role, status: 'active' });
}

async function createApprovedAction(proposerToken, approverToken, workspaceId, label) {
  const action = await request(proposerToken, 'POST', '/rest/v1/rev_actions', {}, {
    workspace_id: workspaceId, action_type: 'prepare_follow_up', title: `${label} subject`,
    description: `${label} exact approved body`, rationale: `prepared-follow-up:${label}`, requires_approval: true,
  });
  const actionId = action.rows[0]?.id;
  if (actionId) await request(proposerToken, 'PATCH', '/rest/v1/rev_actions', { id: `eq.${actionId}` }, { status: 'awaiting_approval' });
  const approval = actionId
    ? await request(proposerToken, 'POST', '/rest/v1/approvals', {}, { workspace_id: workspaceId, rev_action_id: actionId })
    : { rows: [] };
  const approvalId = approval.rows[0]?.id;
  const fingerprint = actionId
    ? localSql(`select public.rev_action_material_fingerprint(target) from public.rev_actions target where id = '${actionId}'::uuid`)
    : '';
  const decision = approvalId ? await rpc(approverToken, 'decide_rev_action_approval', {
    target_approval_id: approvalId, expected_action_version: 1, expected_action_fingerprint: fingerprint,
    approval_decision: 'approved', decision_notes: 'Phase 4G.2A-S local fixture',
  }) : { status: 0 };
  return { actionId, approvalId, fingerprint, approved: decision.status === 200 };
}

function prepareArgs(workspaceId, actionId, callerKey, requestFingerprint) {
  return {
    target_workspace_id: workspaceId, target_action_id: actionId,
    target_idempotency_key: callerKey, target_request_fingerprint: requestFingerprint,
    target_correlation_id: crypto.randomUUID(), target_capability: 'SEND_APPROVED_EMAIL',
    target_risk_class: 'external_communication', target_jurisdiction: 'GB',
    target_estimated_provider_cost: 0, target_provider_key: 'microsoft-graph',
  };
}

function usage(executionId, outcome) {
  return [{
    provider_key: 'microsoft-graph', operation: 'send_email', usage_event_key: `${executionId}:${outcome}`,
    units: 1, estimated_provider_cost: 0, actual_provider_cost: 0, currency: 'GBP',
    provider_reference: `LOCAL-${outcome.toUpperCase()}`,
  }];
}

function quoteCatalog() {
  return localSql("select coalesce(string_agg(kind || ':' || name, ',' order by kind, name), '') from (select 'table' kind, c.relname name from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname='quotes' union all select 'index', indexname from pg_indexes where schemaname='public' and tablename='quotes' union all select 'trigger', tgname from pg_trigger where tgrelid=to_regclass('public.quotes') and not tgisinternal) catalog");
}

const quoteBefore = quoteCatalog();
const stamp = Date.now();
const owner = await createIdentity('owner', stamp);
const admin = await createIdentity('admin', stamp);
const member = await createIdentity('member', stamp);
const viewer = await createIdentity('viewer', stamp);
const outsider = await createIdentity('outsider', stamp);

const ownerWorkspace = await rpc(owner.token, 'create_workspace_with_owner', {
  workspace_name: `Phase 4G.2A-S ${stamp}`, workspace_slug: `phase-4g2as-${stamp}`,
});
const outsiderWorkspace = await rpc(outsider.token, 'create_workspace_with_owner', {
  workspace_name: `Phase 4G.2A-S Other ${stamp}`, workspace_slug: `phase-4g2as-other-${stamp}`,
});
const workspaceId = ownerWorkspace.payload?.[0]?.created_workspace_id;
const otherWorkspaceId = outsiderWorkspace.payload?.[0]?.created_workspace_id;
check('WORKSPACES_BOOTSTRAPPED', ownerWorkspace.status === 200 && outsiderWorkspace.status === 200 && Boolean(workspaceId) && Boolean(otherWorkspaceId));
check('ADMIN_MEMBERSHIP', (await addMembership(workspaceId, admin, 'admin')).status === 201);
check('MEMBER_MEMBERSHIP', (await addMembership(workspaceId, member, 'member')).status === 201);
check('VIEWER_MEMBERSHIP', (await addMembership(workspaceId, viewer, 'viewer')).status === 201);

const defaultPolicy = await request(owner.token, 'POST', '/rest/v1/workspace_execution_policies', {}, {
  workspace_id: workspaceId, updated_by: owner.id,
});
check('WORKSPACE_POLICY_DEFAULT_OFF', defaultPolicy.status === 201 && defaultPolicy.rows[0]?.execution_enabled === false);
await request(owner.token, 'PATCH', '/rest/v1/workspace_execution_policies', { workspace_id: `eq.${workspaceId}` }, { execution_enabled: true });
await request(outsider.token, 'POST', '/rest/v1/workspace_execution_policies', {}, {
  workspace_id: otherWorkspaceId, updated_by: outsider.id, execution_enabled: true,
});

const semanticCase = await createApprovedAction(member.token, owner.token, workspaceId, 'semantic');
check('OWNER_APPROVAL_ALLOWED', semanticCase.approved);
const requestFingerprint = 'a'.repeat(64);
const concurrentReservations = await Promise.all([
  rpc(owner.token, 'prepare_rev_action_execution', prepareArgs(workspaceId, semanticCase.actionId, 'caller-retry-a', requestFingerprint)),
  rpc(owner.token, 'prepare_rev_action_execution', prepareArgs(workspaceId, semanticCase.actionId, 'caller-retry-b', requestFingerprint)),
]);
const executionId = concurrentReservations[0].payload?.id;
check('CONCURRENT_RESERVATION_ONE_EXECUTION',
  concurrentReservations.every((result) => result.status === 200)
    && Boolean(executionId) && concurrentReservations[1].payload?.id === executionId);
check('SERVER_DERIVED_IDEMPOTENCY_KEY', concurrentReservations[0].payload?.idempotency_key === `send-approved-email:${semanticCase.actionId}:v1`);
check('PROVIDER_NOT_INVOKED_INITIAL_STATE', concurrentReservations[0].payload?.provider_outcome === 'provider_not_invoked');
check('SEMANTIC_ROW_COUNT_ONE', localSql(`select count(*) from public.rev_action_executions where workspace_id='${workspaceId}'::uuid and action_id='${semanticCase.actionId}'::uuid and action_version=1 and capability='SEND_APPROVED_EMAIL'`) === '1');
check('DUPLICATE_PREFLIGHT_CLEAN', localSql("select count(*) from (select 1 from public.rev_action_executions where capability='SEND_APPROVED_EMAIL' group by workspace_id,action_id,action_version,capability having count(*)>1) duplicates") === '0');

const conflict = await rpc(owner.token, 'prepare_rev_action_execution', prepareArgs(workspaceId, semanticCase.actionId, 'caller-retry-c', 'b'.repeat(64)));
check('SEMANTIC_FINGERPRINT_CONFLICT_DENIED', conflict.status >= 400);
const directDuplicate = await serviceInsert('rev_action_executions', {
  workspace_id: workspaceId, action_id: semanticCase.actionId, approval_id: semanticCase.approvalId,
  requested_by: owner.id, capability: 'SEND_APPROVED_EMAIL', risk_class: 'external_communication',
  mode: 'dry_run', status: 'prepared', correlation_id: crypto.randomUUID(), idempotency_key: 'forged-second-key',
  request_fingerprint: requestFingerprint, action_version: 1, approval_fingerprint: semanticCase.fingerprint,
  workspace_policy_version: concurrentReservations[0].payload?.workspace_policy_version,
  jurisdiction: 'GB', estimated_provider_cost: 0, provider_key: 'microsoft-graph', provider_outcome: 'provider_not_invoked',
});
check('SEMANTIC_UNIQUE_INDEX_DENIES_DIRECT_DUPLICATE', directDuplicate.status >= 400);

const memberPrepare = await rpc(member.token, 'prepare_rev_action_execution', prepareArgs(workspaceId, semanticCase.actionId, 'member-attempt', requestFingerprint));
const viewerPrepare = await rpc(viewer.token, 'prepare_rev_action_execution', prepareArgs(workspaceId, semanticCase.actionId, 'viewer-attempt', requestFingerprint));
const crossTenant = await rpc(outsider.token, 'prepare_rev_action_execution', prepareArgs(otherWorkspaceId, semanticCase.actionId, 'cross-tenant', requestFingerprint));
check('MEMBER_RESERVATION_DENIED', memberPrepare.status >= 400);
check('VIEWER_RESERVATION_DENIED', viewerPrepare.status >= 400);
check('CROSS_TENANT_RESERVATION_DENIED', crossTenant.status >= 400);

const adminCase = await createApprovedAction(member.token, owner.token, workspaceId, 'admin');
const adminPrepare = await rpc(admin.token, 'prepare_rev_action_execution', prepareArgs(workspaceId, adminCase.actionId, 'admin-retry', 'c'.repeat(64)));
check('ADMIN_RESERVATION_ALLOWED', adminCase.approved && adminPrepare.status === 200);

const staleCase = await createApprovedAction(member.token, owner.token, workspaceId, 'stale');
await request(SERVICE_ROLE_KEY, 'PATCH', '/rest/v1/rev_actions', { id: `eq.${staleCase.actionId}` }, { title: 'Changed after approval' });
const stalePrepare = await rpc(owner.token, 'prepare_rev_action_execution', prepareArgs(workspaceId, staleCase.actionId, 'stale-retry', 'd'.repeat(64)));
check('STALE_APPROVAL_DENIED', stalePrepare.status >= 400);

const ownerClaim = await rpc(owner.token, 'claim_rev_action_provider_attempt', {
  target_execution_id: executionId, expected_request_fingerprint: requestFingerprint,
});
check('AUTHENTICATED_CLAIM_DENIED', ownerClaim.status >= 400);
const concurrentClaims = await Promise.all([
  rpc(SERVICE_ROLE_KEY, 'claim_rev_action_provider_attempt', { target_execution_id: executionId, expected_request_fingerprint: requestFingerprint }),
  rpc(SERVICE_ROLE_KEY, 'claim_rev_action_provider_attempt', { target_execution_id: executionId, expected_request_fingerprint: requestFingerprint }),
]);
check('CONCURRENT_CLAIM_ONE_WINNER', concurrentClaims.filter((result) => result.status === 200).length === 1
  && concurrentClaims.filter((result) => result.status >= 400).length === 1);
const claimed = concurrentClaims.find((result) => result.status === 200);
check('PROVIDER_ATTEMPT_CLAIMED', claimed?.payload?.status === 'in_progress' && claimed?.payload?.provider_outcome === 'provider_attempt_claimed');
const replayAfterClaim = await rpc(owner.token, 'prepare_rev_action_execution', prepareArgs(workspaceId, semanticCase.actionId, 'another-click', requestFingerprint));
check('RETRY_AFTER_CLAIM_RETURNS_SAME_EXECUTION', replayAfterClaim.status === 200 && replayAfterClaim.payload?.id === executionId && replayAfterClaim.payload?.provider_outcome === 'provider_attempt_claimed');

const genericResult = await rpc(SERVICE_ROLE_KEY, 'record_rev_action_execution_result', {
  target_execution_id: executionId, target_status: 'succeeded', target_result_summary: 'must fail',
  target_failure_code: null, usage_events: [],
});
check('GENERIC_RESULT_BLOCKED_FOR_EMAIL', genericResult.status >= 400);
const accepted = await rpc(SERVICE_ROLE_KEY, 'record_email_execution_result', {
  target_execution_id: executionId, target_provider_outcome: 'accepted_by_provider',
  target_result_summary: 'HTTP 202', target_failure_code: null, usage_events: usage(executionId, 'accepted'),
});
check('ACCEPTED_NOT_DELIVERED', accepted.status === 200 && accepted.payload?.provider_outcome === 'accepted_by_provider'
  && accepted.payload?.result_summary === 'Accepted by provider; delivery remains unknown.'
  && !/delivered/i.test(JSON.stringify(accepted.payload)));
const acceptedReplay = await rpc(SERVICE_ROLE_KEY, 'record_email_execution_result', {
  target_execution_id: executionId, target_provider_outcome: 'accepted_by_provider',
  target_result_summary: 'repeat', target_failure_code: null, usage_events: usage(executionId, 'accepted-repeat'),
});
check('TERMINAL_OUTCOME_IMMUTABLE', acceptedReplay.status >= 400);

async function exerciseOutcome(label, outcome, fingerprint) {
  const target = await createApprovedAction(member.token, owner.token, workspaceId, label);
  const prepared = await rpc(owner.token, 'prepare_rev_action_execution', prepareArgs(workspaceId, target.actionId, `${label}-retry`, fingerprint));
  const claimedResult = await rpc(SERVICE_ROLE_KEY, 'claim_rev_action_provider_attempt', {
    target_execution_id: prepared.payload?.id, expected_request_fingerprint: fingerprint,
  });
  const result = await rpc(SERVICE_ROLE_KEY, 'record_email_execution_result', {
    target_execution_id: prepared.payload?.id, target_provider_outcome: outcome,
    target_result_summary: `${label} local result`, target_failure_code: outcome === 'accepted_by_provider' ? null : label,
    usage_events: usage(prepared.payload?.id, label),
  });
  return { target, prepared, claimedResult, result };
}

const rejected = await exerciseOutcome('rejected', 'rejected_by_provider', 'e'.repeat(64));
check('REJECTED_OUTCOME_RECORDED', rejected.result.status === 200 && rejected.result.payload?.status === 'failed'
  && rejected.result.payload?.provider_outcome === 'rejected_by_provider');
const unknown = await exerciseOutcome('unknown', 'provider_outcome_unknown', 'f'.repeat(64));
check('UNKNOWN_OUTCOME_RECORDED', unknown.result.status === 200 && unknown.result.payload?.status === 'failed'
  && unknown.result.payload?.provider_outcome === 'provider_outcome_unknown'
  && /automatic retry prohibited/i.test(unknown.result.payload?.result_summary ?? ''));

const usageRows = await request(owner.token, 'GET', '/rest/v1/provider_usage_events', {
  select: 'id,status,actual_provider_cost,provider_key', execution_id: `eq.${executionId}`,
});
const usageId = usageRows.rows[0]?.id;
check('ACCEPTED_USAGE_EVIDENCE_RECORDED', usageRows.status === 200 && usageRows.rows.length === 1
  && usageRows.rows[0]?.status === 'succeeded' && Number(usageRows.rows[0]?.actual_provider_cost) === 0);
const usageUpdate = await request(owner.token, 'PATCH', '/rest/v1/provider_usage_events', { id: `eq.${usageId}` }, { actual_provider_cost: 99 });
const usageDelete = await request(owner.token, 'DELETE', '/rest/v1/provider_usage_events', { id: `eq.${usageId}` });
check('PROVIDER_USAGE_APPEND_ONLY', usageUpdate.status >= 400 && usageDelete.status >= 400);

check('CLAIM_ACL_SERVICE_ROLE_ONLY', localSql("select not has_function_privilege('authenticated','public.claim_rev_action_provider_attempt(uuid,text)','EXECUTE') and has_function_privilege('service_role','public.claim_rev_action_provider_attempt(uuid,text)','EXECUTE')") === 't');
check('RESULT_ACL_SERVICE_ROLE_ONLY', localSql("select not has_function_privilege('authenticated','public.record_email_execution_result(uuid,text,text,text,jsonb)','EXECUTE') and has_function_privilege('service_role','public.record_email_execution_result(uuid,text,text,text,jsonb)','EXECUTE')") === 't');
check('EXECUTION_RLS_REMAINS_ENABLED', localSql("select relrowsecurity from pg_class where oid='public.rev_action_executions'::regclass") === 't');
check('NO_EMAIL_SEMANTIC_DUPLICATES', localSql("select count(*) from (select 1 from public.rev_action_executions where capability='SEND_APPROVED_EMAIL' group by workspace_id,action_id,action_version,capability having count(*)>1) duplicates") === '0');
check('ZERO_PROVIDER_COST', localSql("select coalesce(sum(actual_provider_cost),0) from public.provider_usage_events where provider_key='microsoft-graph'") === '0.0000');
check('QUOTE_CATALOG_UNCHANGED', quoteCatalog() === quoteBefore);

console.log('REAL_PROVIDER_CALLS=0');
console.log('EMAILS_SENT=0');
console.log('PROVIDER_COST_GBP=0');
console.log(`PHASE4G2AS_LOCAL_MATRIX=${failures === 0 ? 'PASS' : 'FAIL'}`);
if (failures > 0) process.exitCode = 1;