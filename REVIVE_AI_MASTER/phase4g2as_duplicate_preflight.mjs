import { randomBytes } from 'node:crypto';

const BASE_URL = 'http://127.0.0.1:55321';
const API_KEY = process.env.REV_LOCAL_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.REV_LOCAL_SUPABASE_SERVICE_ROLE_KEY;
if (!API_KEY || !SERVICE_ROLE_KEY) throw new Error('Local Supabase test keys are required');

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

const stamp = Date.now();
const email = `phase4g2as-preflight-${stamp}@example.test`;
const password = `Local-${randomBytes(18).toString('base64url')}`;
const created = await fetch(endpoint('/auth/v1/admin/users'), {
  method: 'POST',
  headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password, email_confirm: true }),
});
const user = await created.json();
const signedIn = await fetch(endpoint('/auth/v1/token?grant_type=password'), {
  method: 'POST', headers: { apikey: API_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
});
const session = await signedIn.json();
if (created.status !== 200 || signedIn.status !== 200) throw new Error('Preflight fixture identity failed');

const workspace = await rpc(session.access_token, 'create_workspace_with_owner', {
  workspace_name: `Phase 4G.2A-S Preflight ${stamp}`, workspace_slug: `phase-4g2as-preflight-${stamp}`,
});
const workspaceId = workspace.payload?.[0]?.created_workspace_id;
const action = await request(session.access_token, 'POST', '/rest/v1/rev_actions', {}, {
  workspace_id: workspaceId, action_type: 'prepare_follow_up', title: 'Preflight duplicate',
  description: 'No provider is invoked.', requires_approval: true,
});
const actionId = action.rows[0]?.id;
await request(session.access_token, 'PATCH', '/rest/v1/rev_actions', { id: `eq.${actionId}` }, { status: 'awaiting_approval' });
const approval = await request(session.access_token, 'POST', '/rest/v1/approvals', {}, {
  workspace_id: workspaceId, rev_action_id: actionId,
});
const approvalId = approval.rows[0]?.id;

const common = {
  workspace_id: workspaceId, action_id: actionId, approval_id: approvalId, requested_by: user.id,
  capability: 'SEND_APPROVED_EMAIL', risk_class: 'external_communication', mode: 'dry_run', status: 'prepared',
  request_fingerprint: 'a'.repeat(64), action_version: 1, workspace_policy_version: 1,
  jurisdiction: 'GB', estimated_provider_cost: 0, provider_key: 'microsoft-graph',
};
const first = await request(SERVICE_ROLE_KEY, 'POST', '/rest/v1/rev_action_executions', {}, {
  ...common, correlation_id: crypto.randomUUID(), idempotency_key: 'legacy-caller-key-a',
});
const second = await request(SERVICE_ROLE_KEY, 'POST', '/rest/v1/rev_action_executions', {}, {
  ...common, correlation_id: crypto.randomUUID(), idempotency_key: 'legacy-caller-key-b',
});
if (first.status !== 201 || second.status !== 201) throw new Error('Could not create controlled duplicate preflight fixtures');

console.log(`PREFLIGHT_WORKSPACE_ID=${workspaceId}`);
console.log(`PREFLIGHT_ACTION_ID=${actionId}`);
console.log('CONTROLLED_SEMANTIC_DUPLICATES=2');
console.log('PROVIDER_CALLS=0');
console.log('EMAILS_SENT=0');