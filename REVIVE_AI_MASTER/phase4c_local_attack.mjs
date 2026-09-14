import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const BASE_URL = 'http://127.0.0.1:55321';
const API_KEY = process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!API_KEY || !SERVICE_ROLE_KEY) {
  throw new Error('Local Supabase anon and service-role test keys are required');
}
let failures = 0;

function check(label, condition) {
  console.log(`${label}=${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures += 1;
}

function endpoint(path) {
  return new URL(path, BASE_URL);
}

async function request(token, method, path, query = {}, body) {
  const target = endpoint(path);
  Object.entries(query).forEach(([key, value]) => target.searchParams.set(key, value));
  const headers = { apikey: API_KEY, Authorization: `Bearer ${token}`, Prefer: 'return=representation' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(target, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  return { status: response.status, payload, rows: Array.isArray(payload) ? payload : [] };
}

async function rpc(token, name, body) {
  return request(token, 'POST', `/rest/v1/rpc/${name}`, {}, body);
}

async function createIdentity(label, stamp) {
  const email = `phase4c-${label}-${stamp}@example.test`;
  const password = `Local-${randomBytes(18).toString('base64url')}`;
  const created = await fetch(endpoint('/auth/v1/admin/users'), {
    method: 'POST',
    headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const user = await created.json();
  const signedIn = await fetch(endpoint('/auth/v1/token?grant_type=password'), {
    method: 'POST',
    headers: { apikey: API_KEY, 'Content-Type': 'application/json' },
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

async function serviceInsert(table, body) {
  return request(SERVICE_ROLE_KEY, 'POST', `/rest/v1/${table}`, {}, body);
}

async function addMembership(workspaceId, identity, role, status = 'active') {
  return serviceInsert('workspace_members', { workspace_id: workspaceId, user_id: identity.id, role, status });
}

async function createPendingAction(token, workspaceId, title) {
  const action = await request(token, 'POST', '/rest/v1/rev_actions', {}, {
    workspace_id: workspaceId,
    action_type: 'outreach',
    title,
    description: 'Phase 4C local security rehearsal',
    requires_approval: true,
  });
  const actionId = action.rows[0]?.id;
  if (actionId) {
    await request(token, 'PATCH', '/rest/v1/rev_actions', { id: `eq.${actionId}` }, { status: 'awaiting_approval' });
  }
  const approval = actionId
    ? await request(token, 'POST', '/rest/v1/approvals', {}, { workspace_id: workspaceId, rev_action_id: actionId })
    : { rows: [] };
  return { action, actionId, approvalId: approval.rows[0]?.id };
}

function actionFingerprint(actionId) {
  return localSql(`select public.rev_action_material_fingerprint(target) from public.rev_actions target where id = '${actionId}'::uuid`);
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
const suspended = await createIdentity('suspended', stamp);
const outsider = await createIdentity('outsider', stamp);

const ownerBootstrap = await rpc(owner.token, 'create_workspace_with_owner', {
  workspace_name: `Phase 4C ${stamp}`,
  workspace_slug: `phase-4c-${stamp}`,
});
const outsiderBootstrap = await rpc(outsider.token, 'create_workspace_with_owner', {
  workspace_name: `Phase 4C Other ${stamp}`,
  workspace_slug: `phase-4c-other-${stamp}`,
});
const workspaceId = ownerBootstrap.payload?.[0]?.created_workspace_id;
const otherWorkspaceId = outsiderBootstrap.payload?.[0]?.created_workspace_id;
check('WORKSPACES_BOOTSTRAPPED', ownerBootstrap.status === 200 && outsiderBootstrap.status === 200 && Boolean(workspaceId) && Boolean(otherWorkspaceId));

check('ADMIN_MEMBERSHIP', (await addMembership(workspaceId, admin, 'admin')).status === 201);
check('MEMBER_MEMBERSHIP', (await addMembership(workspaceId, member, 'member')).status === 201);
check('VIEWER_MEMBERSHIP', (await addMembership(workspaceId, viewer, 'viewer')).status === 201);
check('SUSPENDED_MEMBERSHIP', (await addMembership(workspaceId, suspended, 'member', 'suspended')).status === 201);

const ownerCase = await createPendingAction(member.token, workspaceId, 'Owner approval case');
check('MEMBER_PROPOSAL_ALLOWED', ownerCase.action.status === 201 && Boolean(ownerCase.approvalId));
const ownerFingerprint = actionFingerprint(ownerCase.actionId);
const memberDecision = await rpc(member.token, 'decide_rev_action_approval', {
  target_approval_id: ownerCase.approvalId,
  expected_action_version: 1,
  expected_action_fingerprint: ownerFingerprint,
  approval_decision: 'approved',
  decision_notes: 'member escalation attempt',
});
check('MEMBER_APPROVAL_DENIED', memberDecision.status >= 400);
const ownerDecision = await rpc(owner.token, 'decide_rev_action_approval', {
  target_approval_id: ownerCase.approvalId,
  expected_action_version: 1,
  expected_action_fingerprint: ownerFingerprint,
  approval_decision: 'approved',
  decision_notes: 'owner approved locally',
});
check('OWNER_APPROVAL_ALLOWED', ownerDecision.status === 200 && ownerDecision.payload?.decision === 'approved');

const adminCase = await createPendingAction(member.token, workspaceId, 'Admin approval case');
const adminFingerprint = actionFingerprint(adminCase.actionId);
const adminDecision = await rpc(admin.token, 'decide_rev_action_approval', {
  target_approval_id: adminCase.approvalId,
  expected_action_version: 1,
  expected_action_fingerprint: adminFingerprint,
  approval_decision: 'approved',
  decision_notes: 'admin approved locally',
});
check('ADMIN_APPROVAL_ALLOWED', adminDecision.status === 200 && adminDecision.payload?.decision === 'approved');

const staleCase = await createPendingAction(member.token, workspaceId, 'Stale approval case');
const staleFingerprint = actionFingerprint(staleCase.actionId);
await request(member.token, 'PATCH', '/rest/v1/rev_actions', { id: `eq.${staleCase.actionId}` }, { title: 'Materially changed after review' });
const staleDecision = await rpc(owner.token, 'decide_rev_action_approval', {
  target_approval_id: staleCase.approvalId,
  expected_action_version: 1,
  expected_action_fingerprint: staleFingerprint,
  approval_decision: 'approved',
  decision_notes: 'must fail',
});
const staleState = await request(owner.token, 'GET', '/rest/v1/approvals', { select: 'decision,action_version,action_fingerprint', id: `eq.${staleCase.approvalId}` });
check('STALE_APPROVAL_DENIED_ATOMICALLY', staleDecision.status >= 400 && staleState.rows[0]?.decision === null && staleState.rows[0]?.action_version === null);

const viewerWrite = await request(viewer.token, 'POST', '/rest/v1/rev_actions', {}, {
  workspace_id: workspaceId, action_type: 'outreach', title: 'Viewer write', description: 'must fail', requires_approval: true,
});
check('VIEWER_WRITE_DENIED', viewerWrite.status >= 400);
const viewerRead = await request(viewer.token, 'GET', '/rest/v1/rev_actions', { select: 'id', id: `eq.${ownerCase.actionId}` });
check('VIEWER_READ_ALLOWED', viewerRead.status === 200 && viewerRead.rows.length === 1);
const suspendedRead = await request(suspended.token, 'GET', '/rest/v1/rev_actions', { select: 'id', workspace_id: `eq.${workspaceId}` });
check('SUSPENDED_READ_DENIED', suspendedRead.status === 200 && suspendedRead.rows.length === 0);
const outsiderRead = await request(outsider.token, 'GET', '/rest/v1/rev_actions', { select: 'id', workspace_id: `eq.${workspaceId}` });
check('CROSS_TENANT_READ_DENIED', outsiderRead.status === 200 && outsiderRead.rows.length === 0);

const directExecution = await request(owner.token, 'POST', '/rest/v1/rev_action_executions', {}, {
  workspace_id: workspaceId,
  action_id: ownerCase.actionId,
  approval_id: ownerCase.approvalId,
  requested_by: owner.id,
  capability: 'outreach',
  risk_class: 'external_communication',
  correlation_id: crypto.randomUUID(),
  idempotency_key: 'direct-write',
  request_fingerprint: 'a'.repeat(64),
  action_version: 1,
  workspace_policy_version: 1,
});
check('DIRECT_EXECUTION_INSERT_DENIED', directExecution.status >= 400);
const directUsage = await request(owner.token, 'POST', '/rest/v1/provider_usage_events', {}, {
  workspace_id: workspaceId,
  provider_key: 'forged',
  operation: 'send',
  usage_event_key: 'forged',
  correlation_id: crypto.randomUUID(),
  status: 'succeeded',
});
check('DIRECT_PROVIDER_USAGE_INSERT_DENIED', directUsage.status >= 400);
const directAudit = await request(owner.token, 'POST', '/rest/v1/audit_log', {}, {
  workspace_id: workspaceId,
  actor_user_id: owner.id,
  actor_type: 'system',
  action: 'execution.succeeded',
  resource_type: 'rev_action_execution',
});
check('AUDIT_FORGERY_DENIED', directAudit.status >= 400);
const directActionEvidence = await request(owner.token, 'PATCH', '/rest/v1/rev_actions', { id: `eq.${ownerCase.actionId}` }, {
  status: 'completed', execution_status: 'succeeded', outcome_summary: 'forged',
});
const actionAfterForgery = await request(owner.token, 'GET', '/rest/v1/rev_actions', {
  select: 'status,execution_status,outcome_summary', id: `eq.${ownerCase.actionId}`,
});
check(
  'DIRECT_ACTION_EXECUTION_UPDATE_DENIED',
  (directActionEvidence.status >= 400 || directActionEvidence.rows.length === 0)
    && actionAfterForgery.rows[0]?.status === 'approved'
    && actionAfterForgery.rows[0]?.execution_status === 'not_executed'
    && actionAfterForgery.rows[0]?.outcome_summary === null,
);

const prepareArgs = {
  target_workspace_id: workspaceId,
  target_action_id: ownerCase.actionId,
  target_idempotency_key: 'phase4c-request-1',
  target_request_fingerprint: 'b'.repeat(64),
  target_correlation_id: crypto.randomUUID(),
  target_capability: 'outreach',
  target_risk_class: 'external_communication',
  target_jurisdiction: 'GB',
  target_estimated_provider_cost: 4,
  target_provider_key: 'local-disabled-provider',
};
const missingPolicy = await rpc(owner.token, 'prepare_rev_action_execution', prepareArgs);
check('MISSING_POLICY_MEANS_DISABLED', missingPolicy.status >= 400);
const memberPolicy = await request(member.token, 'POST', '/rest/v1/workspace_execution_policies', {}, {
  workspace_id: workspaceId, updated_by: member.id,
});
check('MEMBER_POLICY_WRITE_DENIED', memberPolicy.status >= 400);
const policy = await request(owner.token, 'POST', '/rest/v1/workspace_execution_policies', {}, {
  workspace_id: workspaceId,
  updated_by: owner.id,
  per_attempt_provider_cost_ceiling: 5,
  monthly_provider_cost_ceiling: 5,
});
check('POLICY_DEFAULT_DISABLED', policy.status === 201 && policy.rows[0]?.execution_enabled === false && policy.rows[0]?.autonomy_mode === 'always_ask');
const disabledPrepare = await rpc(owner.token, 'prepare_rev_action_execution', prepareArgs);
check('EXPLICIT_DISABLED_POLICY_DENIES', disabledPrepare.status >= 400);
await request(owner.token, 'PATCH', '/rest/v1/workspace_execution_policies', { workspace_id: `eq.${workspaceId}` }, { execution_enabled: true });

const prepared = await rpc(owner.token, 'prepare_rev_action_execution', prepareArgs);
check('DRY_RUN_PREPARATION_ALLOWED', prepared.status === 200 && prepared.payload?.mode === 'dry_run' && prepared.payload?.status === 'prepared');
const replay = await rpc(owner.token, 'prepare_rev_action_execution', prepareArgs);
check('IDEMPOTENT_REPLAY_RETURNS_SAME_ATTEMPT', replay.status === 200 && replay.payload?.id === prepared.payload?.id);
const conflict = await rpc(owner.token, 'prepare_rev_action_execution', { ...prepareArgs, target_request_fingerprint: 'c'.repeat(64) });
check('IDEMPOTENCY_CONFLICT_DENIED', conflict.status >= 400);
const perAttemptCost = await rpc(owner.token, 'prepare_rev_action_execution', {
  ...prepareArgs,
  target_idempotency_key: 'phase4c-too-expensive',
  target_request_fingerprint: 'd'.repeat(64),
  target_correlation_id: crypto.randomUUID(),
  target_estimated_provider_cost: 6,
});
check('PER_ATTEMPT_COST_CEILING_DENIED', perAttemptCost.status >= 400);
const monthlyCost = await rpc(owner.token, 'prepare_rev_action_execution', {
  ...prepareArgs,
  target_idempotency_key: 'phase4c-monthly-overflow',
  target_request_fingerprint: 'e'.repeat(64),
  target_correlation_id: crypto.randomUUID(),
  target_estimated_provider_cost: 2,
});
check('MONTHLY_COST_CEILING_DENIED', monthlyCost.status >= 400);

const directExecutionUpdate = await request(owner.token, 'PATCH', '/rest/v1/rev_action_executions', {
  id: `eq.${prepared.payload?.id}`,
}, { status: 'succeeded', completed_at: new Date().toISOString() });
const executionAfterUpdate = await request(owner.token, 'GET', '/rest/v1/rev_action_executions', {
  select: 'status', id: `eq.${prepared.payload?.id}`,
});
check(
  'DIRECT_EXECUTION_UPDATE_DENIED',
  directExecutionUpdate.status >= 400 && executionAfterUpdate.rows[0]?.status === 'prepared',
);

const usageFixture = await serviceInsert('provider_usage_events', {
  workspace_id: workspaceId,
  execution_id: prepared.payload?.id,
  provider_key: 'local-fixture-provider',
  operation: 'simulated-usage',
  usage_event_key: 'phase4c-local-fixture',
  units: 1,
  estimated_provider_cost: 0,
  actual_provider_cost: 0,
  currency: 'GBP',
  correlation_id: prepared.payload?.correlation_id,
  status: 'succeeded',
});
const usageId = usageFixture.rows[0]?.id;
check('LOCAL_PROVIDER_USAGE_FIXTURE_CREATED', usageFixture.status === 201 && Boolean(usageId));
const usageUpdate = await request(owner.token, 'PATCH', '/rest/v1/provider_usage_events', {
  id: `eq.${usageId}`,
}, { actual_provider_cost: 999 });
const usageDelete = await request(owner.token, 'DELETE', '/rest/v1/provider_usage_events', {
  id: `eq.${usageId}`,
});
const usageAfterAttacks = await request(owner.token, 'GET', '/rest/v1/provider_usage_events', {
  select: 'id,actual_provider_cost', id: `eq.${usageId}`,
});
check(
  'DIRECT_PROVIDER_USAGE_UPDATE_DENIED',
  usageUpdate.status >= 400 && Number(usageAfterAttacks.rows[0]?.actual_provider_cost) === 0,
);
check('DIRECT_PROVIDER_USAGE_DELETE_DENIED', usageDelete.status >= 400 && usageAfterAttacks.rows.length === 1);

const legacyAction = await serviceInsert('rev_actions', {
  workspace_id: workspaceId,
  action_type: 'outreach',
  title: 'Legacy unbound approval action',
  description: 'Local fixture',
  requires_approval: true,
  status: 'approved',
  execution_status: 'not_executed',
  approved_at: new Date().toISOString(),
});
const legacyActionId = legacyAction.rows[0]?.id;
await serviceInsert('approvals', {
  workspace_id: workspaceId,
  rev_action_id: legacyActionId,
  decision: 'approved',
  decided_at: new Date().toISOString(),
  decided_by: owner.id,
});
const legacyPrepare = await rpc(owner.token, 'prepare_rev_action_execution', {
  ...prepareArgs,
  target_action_id: legacyActionId,
  target_idempotency_key: 'phase4c-legacy-unbound',
  target_request_fingerprint: 'f'.repeat(64),
  target_correlation_id: crypto.randomUUID(),
  target_estimated_provider_cost: 0,
});
check('LEGACY_UNBOUND_APPROVAL_DENIED', legacyPrepare.status >= 400);

const executionRead = await request(viewer.token, 'GET', '/rest/v1/rev_action_executions', { select: 'id,mode,status', id: `eq.${prepared.payload?.id}` });
check('VIEWER_EXECUTION_READ_ALLOWED', executionRead.status === 200 && executionRead.rows[0]?.mode === 'dry_run');
const auditOwner = await request(owner.token, 'GET', '/rest/v1/audit_log', { select: 'action', workspace_id: `eq.${workspaceId}` });
const auditViewer = await request(viewer.token, 'GET', '/rest/v1/audit_log', { select: 'action', workspace_id: `eq.${workspaceId}` });
check('OWNER_AUDIT_READ_ALLOWED', auditOwner.status === 200 && auditOwner.rows.some((row) => row.action === 'execution.prepared'));
check('VIEWER_AUDIT_READ_DENIED', auditViewer.status === 200 && auditViewer.rows.length === 0);
check('QUOTE_CATALOG_UNCHANGED', quoteCatalog() === quoteBefore);

console.log(`PHASE4C_ATTACK_MATRIX=${failures === 0 ? 'PASS' : 'FAIL'}`);
if (failures > 0) process.exitCode = 1;