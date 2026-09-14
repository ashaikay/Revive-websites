import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const baseUrl = config.match(/window\.SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const publicKey = config.match(/window\.SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
const ids = { A: '8b2c373e-73ce-4c35-b1aa-875a5d441bb4', B: 'd288c613-84f8-4530-b988-9984008427c4', C: 'be0b5874-4264-4f36-869b-f16ab689c33b' };
const stamp = `phase2d1d-${Date.now()}`;
const created = { A: {}, B: {}, extra: [] };

function userValue(name) {
  return execFileSync('powershell.exe', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${name}', 'User')`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function makeUrl(path, query = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

async function call(session, method, path, query = {}, body, prefer = 'return=representation') {
  const headers = { apikey: publicKey };
  if (session?.token) headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(makeUrl(path, query), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { status: response.status, rows: Array.isArray(payload) ? payload : [], payload, code: payload?.code ?? '', message: payload?.message ?? payload?.msg ?? '' };
}

async function signIn(label) {
  const body = { email: userValue(`REV_RLS_USER_${label}_EMAIL`), password: userValue(`REV_RLS_USER_${label}_PASSWORD`) };
  const response = await call({ token: publicKey }, 'POST', '/auth/v1/token', { grant_type: 'password' }, body, null);
  return { token: response.payload?.access_token, verified: response.status === 200 && response.payload?.user?.id === ids[label] };
}

function one(rows, predicate) { return rows.filter(predicate)[0] ?? null; }
function rows(result) { return result.status === 200 ? result.rows : []; }
function isEmpty(result) { return result.status === 200 && result.rows.length === 0; }
function isOwnerRow(result, workspaceId, userId) { return result.status === 200 && result.rows.length === 1 && result.rows[0].workspace_id === workspaceId && result.rows[0].user_id === userId; }

async function discover(session, label, creator) {
  const result = await call(session, 'GET', '/rest/v1/workspaces', { select: 'id,name,created_by', name: `eq.REV RLS Workspace ${label}`, created_by: `eq.${creator}` }, undefined, null);
  return { result, row: result.rows.length === 1 ? result.rows[0] : null };
}

async function ownerRead(session, workspaceId, table, select = 'id,workspace_id') {
  return call(session, 'GET', `/rest/v1/${table}`, { select, workspace_id: `eq.${workspaceId}` }, undefined, null);
}

async function createPositive(label, session, workspaceId) {
  const suffix = `${label}-${stamp}`;
  const data = {};
  const service = await call(session, 'POST', '/rest/v1/business_services', {}, { workspace_id: workspaceId, name: `REV positive service ${suffix}`, description: 'synthetic Phase 2D.1D', active: true });
  if (service.status < 200 || service.status >= 300 || !service.rows[0]?.id) throw new Error(`positive business_services ${label}`);
  data.service = service.rows[0];
  const goal = await call(session, 'POST', '/rest/v1/goals', {}, { workspace_id: workspaceId, title: `REV positive goal ${suffix}`, objective: 'synthetic Phase 2D.1D', metric: 'count', target_value: 1, start_date: '2026-09-12', target_date: '2026-09-13', priority: 'low', status: 'draft' });
  if (goal.status < 200 || goal.status >= 300 || !goal.rows[0]?.id) throw new Error(`positive goals ${label}`);
  data.goal = goal.rows[0];
  const contact = await call(session, 'POST', '/rest/v1/contacts', {}, { workspace_id: workspaceId, lifecycle: 'prospect', name: `REV positive contact ${suffix}` });
  if (contact.status < 200 || contact.status >= 300 || !contact.rows[0]?.id) throw new Error(`positive contacts ${label}`);
  data.contact = contact.rows[0];
  const action = await call(session, 'POST', '/rest/v1/rev_actions', {}, { workspace_id: workspaceId, goal_id: data.goal.id, contact_id: data.contact.id, action_type: 'test', title: `REV positive action ${suffix}`, description: 'synthetic Phase 2D.1D' });
  if (action.status < 200 || action.status >= 300 || !action.rows[0]?.id) throw new Error(`positive rev_actions ${label}`);
  data.action = action.rows[0];
  const approval = await call(session, 'POST', '/rest/v1/approvals', {}, { workspace_id: workspaceId, rev_action_id: data.action.id });
  if (approval.status < 200 || approval.status >= 300 || !approval.rows[0]?.id) throw new Error(`positive approvals ${label}`);
  data.approval = approval.rows[0];
  const memory = await call(session, 'POST', '/rest/v1/business_memory_events', {}, { workspace_id: workspaceId, event_type: 'test', entity_type: 'test', title: `REV positive memory ${suffix}`, summary: 'synthetic Phase 2D.1D', occurred_at: '2026-09-12T00:00:00Z', created_by_type: 'user', created_by_id: ids[label] });
  if (memory.status < 200 || memory.status >= 300 || !memory.rows[0]?.id) throw new Error(`positive business_memory_events ${label}`);
  data.memory = memory.rows[0];
  const audit = await call(session, 'POST', '/rest/v1/audit_log', {}, { workspace_id: workspaceId, actor_user_id: ids[label], actor_type: 'user', action: `phase2d1d.${suffix}`, resource_type: 'test' });
  if (audit.status < 200 || audit.status >= 300 || !audit.rows[0]?.id) throw new Error(`positive audit_log ${label}`);
  data.audit = audit.rows[0];
  return data;
}

async function assertNoPersistedOwnerRow(session, table, marker, workspaceId) {
  const field = table === 'business_services' ? 'name' : table === 'goals' || table === 'rev_actions' || table === 'business_memory_events' ? 'title' : table === 'contacts' ? 'name' : 'action';
  const result = await call(session, 'GET', `/rest/v1/${table}`, { select: 'id,workspace_id', [field]: `eq.${marker}` }, undefined, null);
  return result.status === 200 && result.rows.filter((row) => row.workspace_id === workspaceId).length === 0;
}

async function attackInsert(attacker, targetWorkspaceId, table, body, ownerSession, marker) {
  const attempt = await call(attacker, 'POST', `/rest/v1/${table}`, {}, body);
  const persisted = await assertNoPersistedOwnerRow(ownerSession, table, marker, targetWorkspaceId);
  return persisted ? { ok: true, attempt } : { ok: false, attempt };
}

async function attackMutation(attacker, method, table, rowId, body, ownerSession, workspaceId, baseline) {
  const attempt = await call(attacker, method, `/rest/v1/${table}`, { id: `eq.${rowId}` }, body);
  const check = await call(ownerSession, 'GET', `/rest/v1/${table}`, { select: '*', id: `eq.${rowId}` }, undefined, null);
  const unchanged = check.status === 200 && check.rows.length === 1 && Object.entries(baseline).every(([key, value]) => String(check.rows[0][key]) === String(value));
  return { ok: unchanged, attempt };
}

async function run() {
  const sessions = { A: await signIn('A'), B: await signIn('B'), C: await signIn('C') };
  if (!sessions.A.verified || !sessions.B.verified || !sessions.C.verified) throw new Error('authentication gate failed');
  const discoveredA = await discover(sessions.A, 'A', ids.A);
  const discoveredB = await discover(sessions.B, 'B', ids.B);
  if (!discoveredA.row || !discoveredB.row || discoveredA.row.id === discoveredB.row.id) throw new Error('workspace discovery failed');
  const workspace = { A: discoveredA.row.id, B: discoveredB.row.id };
  created.A = await createPositive('A', sessions.A, workspace.A);
  created.B = await createPositive('B', sessions.B, workspace.B);

  const ownA = await ownerRead(sessions.A, workspace.A, 'business_services');
  const ownB = await ownerRead(sessions.B, workspace.B, 'business_services');
  if (ownA.status !== 200 || ownB.status !== 200 || ownA.rows.length === 0 || ownB.rows.length === 0) throw new Error('positive read-back failed');

  const insertPayloads = {
    business_services: (workspaceId, marker) => ({ workspace_id: workspaceId, name: marker, description: 'attack' }),
    goals: (workspaceId, marker) => ({ workspace_id: workspaceId, title: marker, objective: 'attack', metric: 'count', target_value: 1, start_date: '2026-09-12', target_date: '2026-09-13', priority: 'low', status: 'draft' }),
    contacts: (workspaceId, marker) => ({ workspace_id: workspaceId, lifecycle: 'prospect', name: marker }),
    business_memory_events: (workspaceId, marker) => ({ workspace_id: workspaceId, event_type: 'attack', entity_type: 'test', title: marker, summary: 'attack', occurred_at: '2026-09-12T00:00:00Z', created_by_type: 'user' }),
  };
  for (const [table, build] of Object.entries(insertPayloads)) {
    for (const [attacker, target, owner] of [['A', 'B', 'B'], ['B', 'A', 'A'], ['C', 'A', 'A'], ['C', 'B', 'B']]) {
      const marker = `REV ATTACK INSERT ${table} ${attacker}-${target}-${stamp}`;
      const result = await attackInsert(sessions[attacker], workspace[target], table, build(workspace[target], marker), sessions[owner], marker);
      if (!result.ok) throw new Error(`unauthorized persisted insert ${table} ${attacker}->${target}`);
    }
  }

  const representative = [
    ['business_services', 'service'], ['goals', 'goal'], ['contacts', 'contact'], ['rev_actions', 'action'], ['approvals', 'approval'],
  ];
  for (const [table, key] of representative) {
    for (const [attacker, target, owner] of [['A', 'B', 'B'], ['B', 'A', 'A'], ['C', 'A', 'A'], ['C', 'B', 'B']]) {
      const row = created[target][key];
      const baseline = table === 'business_services' ? { description: row.description } : table === 'goals' ? { current_value: row.current_value } : table === 'contacts' ? { company: row.company } : table === 'rev_actions' ? { rationale: row.rationale } : { notes: row.notes };
      const body = table === 'business_services' ? { description: 'UNAUTHORIZED' } : table === 'goals' ? { current_value: 999 } : table === 'contacts' ? { company: 'UNAUTHORIZED' } : table === 'rev_actions' ? { rationale: 'UNAUTHORIZED' } : { notes: 'UNAUTHORIZED' };
      const result = await attackMutation(sessions[attacker], 'PATCH', table, row.id, body, sessions[owner], workspace[target], baseline);
      if (!result.ok) throw new Error(`unauthorized persisted update ${table} ${attacker}->${target}`);
    }
  }

  for (const [table, key] of representative) {
    for (const [attacker, target, owner] of [['A', 'B', 'B'], ['B', 'A', 'A'], ['C', 'A', 'A'], ['C', 'B', 'B']]) {
      const row = created[target][key];
      const before = await call(sessions[owner], 'GET', `/rest/v1/${table}`, { select: 'id', id: `eq.${row.id}` }, undefined, null);
      const attempt = await call(sessions[attacker], 'DELETE', `/rest/v1/${table}`, { id: `eq.${row.id}` }, undefined);
      const after = await call(sessions[owner], 'GET', `/rest/v1/${table}`, { select: 'id', id: `eq.${row.id}` }, undefined, null);
      if (before.rows.length !== 1 || after.rows.length !== 1) throw new Error(`unauthorized persisted delete ${table} ${attacker}->${target}`);
    }
  }

  const membershipAttacks = [
    ['A', workspace.B, { workspace_id: workspace.B, user_id: ids.A, role: 'owner', status: 'active' }],
    ['B', workspace.A, { workspace_id: workspace.A, user_id: ids.B, role: 'owner', status: 'active' }],
    ['C', workspace.A, { workspace_id: workspace.A, user_id: ids.C, role: 'owner', status: 'active' }],
    ['C', workspace.B, { workspace_id: workspace.B, user_id: ids.C, role: 'owner', status: 'active' }],
  ];
  for (const [attacker, target, body] of membershipAttacks) {
    await call(sessions[attacker], 'POST', '/rest/v1/workspace_members', {}, body);
    const state = await call(sessions.A, 'GET', '/rest/v1/workspace_members', { select: 'workspace_id,user_id,role,status', workspace_id: `eq.${target}` }, undefined, null);
    if (state.rows.some((row) => row.user_id === body.user_id)) throw new Error(`membership escalation persisted ${attacker}`);
  }

  for (const label of ['A', 'B']) {
    const audit = created[label].audit;
    const before = await call(sessions[label], 'GET', '/rest/v1/audit_log', { select: 'id,action,resource_type', id: `eq.${audit.id}` }, undefined, null);
    const update = await call(sessions[label], 'PATCH', '/rest/v1/audit_log', { id: `eq.${audit.id}` }, { action: 'UNAUTHORIZED' });
    const remove = await call(sessions[label], 'DELETE', '/rest/v1/audit_log', { id: `eq.${audit.id}` }, undefined);
    const after = await call(sessions[label], 'GET', '/rest/v1/audit_log', { select: 'id,action,resource_type', id: `eq.${audit.id}` }, undefined, null);
    if (before.rows.length !== 1 || after.rows.length !== 1 || after.rows[0].action !== before.rows[0].action || update.status >= 200 && update.status < 300 && update.rows.length > 0 || remove.status >= 200 && remove.status < 300 && remove.rows.length > 0) throw new Error(`audit immutability failed ${label}`);
  }

  const bootstrapAnon = await call({ token: publicKey }, 'POST', '/rest/v1/rpc/create_workspace_with_owner', {}, { workspace_name: `REV anonymous attack ${stamp}`, workspace_slug: `rev-anon-${stamp}` });
  if (bootstrapAnon.status < 400) throw new Error('anonymous bootstrap unexpectedly succeeded');

  const foreignAction = await call(sessions.A, 'POST', '/rest/v1/rev_actions', {}, { workspace_id: workspace.A, goal_id: created.B.goal.id, contact_id: created.B.contact.id, action_type: 'fk-attack', title: `REV FK attack ${stamp}`, description: 'attack' });
  const foreignActionRows = await call(sessions.A, 'GET', '/rest/v1/rev_actions', { select: 'id,workspace_id', title: `eq.REV FK attack ${stamp}` }, undefined, null);
  if (foreignActionRows.rows.length > 0 || foreignAction.status >= 200 && foreignAction.status < 300) throw new Error('composite FK attack persisted or succeeded');

  const outsiderTables = ['business_profiles', 'business_services', 'goals', 'contacts', 'rev_actions', 'approvals', 'business_memory_events', 'audit_log'];
  for (const table of outsiderTables) {
    const result = await call(sessions.C, 'GET', `/rest/v1/${table}`, { select: 'workspace_id' }, undefined, null);
    if (result.status !== 200 || result.rows.length !== 0) throw new Error(`User C outsider failed ${table}`);
  }

  return { pass: true, bootstrapAnonStatus: bootstrapAnon.status };
}

try {
  const result = await run();
  console.log('ATTACK RUNNER: PASS');
  console.log('POSITIVE OWN-TENANT WRITES: PASS');
  console.log('CROSS-TENANT INSERTS BLOCKED: PASS');
  console.log('CROSS-TENANT UPDATES BLOCKED: PASS');
  console.log('CROSS-TENANT DELETES BLOCKED: PASS');
  console.log('MEMBERSHIP ESCALATION BLOCKED: PASS');
  console.log('BOOTSTRAP RPC ABUSE BLOCKED: PASS');
  console.log('COMPOSITE FK ATTACKS BLOCKED: PASS');
  console.log('USER C FINAL OUTSIDER TEST: PASS');
} catch (error) {
  console.log('ATTACK RUNNER: STOPPED');
  console.log('SANITIZED FAILURE: ' + error.message);
  process.exitCode = 2;
}
