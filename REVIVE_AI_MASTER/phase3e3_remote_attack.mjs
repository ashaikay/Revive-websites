import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const config = readFileSync(new URL('../config.js', import.meta.url), 'utf8');
const baseUrl = config.match(/window\.SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
const publicKey = config.match(/window\.SUPABASE_ANON_KEY\s*=\s*"([^"]+)"/)?.[1];
const userIds = {
  A: '8b2c373e-73ce-4c35-b1aa-875a5d441bb4',
  B: 'd288c613-84f8-4530-b988-9984008427c4',
  C: 'be0b5874-4264-4f36-869b-f16ab689c33b',
};
const emails = {
  A: 'mike.blackwood11@gmail.com',
  B: 'natalie_atkins2000@yahoo.co.uk',
  C: 'wellnessatworkforyou@gmail.com',
};
const stamp = Date.now();
const fixtures = [];

function env(name) {
  if (process.env[name]) return process.env[name];
  try {
    return execFileSync('powershell.exe', ['-NoProfile', '-Command', `[Environment]::GetEnvironmentVariable('${name}', 'User')`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return '';
  }
}

function urlFor(path, query = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

async function request(session, method, path, query = {}, body, prefer = 'return=representation') {
  const headers = { apikey: session.key ?? publicKey };
  if (session.token) headers.Authorization = `Bearer ${session.token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (prefer) headers.Prefer = prefer;
  const response = await fetch(urlFor(path, query), { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let payload = null;
  try { payload = await response.json(); } catch {}
  return { status: response.status, rows: Array.isArray(payload) ? payload : [], payload };
}

function pass(label, condition) {
  console.log(`${label}=${condition ? 'PASS' : 'FAIL'}`);
  if (!condition) failures.push(label);
  return condition;
}

const failures = [];
const sessions = {};
for (const label of ['A', 'B', 'C']) {
  const response = await request({ key: publicKey }, 'POST', '/auth/v1/token', { grant_type: 'password' }, { email: emails[label], password: env(`REV_RLS_USER_${label}_PASSWORD`) }, null);
  sessions[label] = { token: response.payload?.access_token, userId: response.payload?.user?.id };
  pass(`USER_${label}_AUTH`, response.status === 200 && Boolean(sessions[label].token) && sessions[label].userId === userIds[label]);
}
if (failures.length) throw new Error('Authentication prerequisite failed');

async function ownedWorkspace(label, expectedName) {
  const result = await request(sessions[label], 'GET', '/rest/v1/workspaces', { select: 'id,name,created_by', name: `eq.${expectedName}`, created_by: `eq.${userIds[label]}` }, undefined, null);
  pass(`USER_${label}_WORKSPACE_DISCOVERY`, result.status === 200 && result.rows.length === 1);
  return result.rows[0]?.id;
}
const workspaceA = await ownedWorkspace('A', 'REV RLS Workspace A');
const workspaceB = await ownedWorkspace('B', 'REV RLS Workspace B');
if (!workspaceA || !workspaceB || workspaceA === workspaceB) throw new Error('Workspace prerequisite failed');

async function firstContact(label, workspaceId) {
  const result = await request(sessions[label], 'GET', '/rest/v1/contacts', { select: 'id,workspace_id', workspace_id: `eq.${workspaceId}`, limit: '1' }, undefined, null);
  pass(`USER_${label}_CONTACT_AVAILABLE`, result.status === 200 && result.rows.length === 1);
  return result.rows[0]?.id;
}
const contactA = await firstContact('A', workspaceA);
const contactB = await firstContact('B', workspaceB);
if (!contactA || !contactB) throw new Error('Contact prerequisite failed');

async function insertOpportunity(label, workspaceId, contactId, overrides = {}) {
  const marker = `Phase 3E.3 remote test ${stamp} ${label}`;
  const result = await request(sessions[label], 'POST', '/rest/v1/opportunities', {}, {
    workspace_id: workspaceId, contact_id: contactId, title: marker,
    opportunity_type: 'commercial_lead', stage: 'new', source: 'manual_lead',
    estimated_value: 10, currency: 'GBP', attribution: 'unattributed', created_by_type: 'user', ...overrides,
  });
  if (result.rows[0]?.id) fixtures.push({ label, session: sessions[label], workspaceId, id: result.rows[0].id });
  return result;
}

const oppA = await insertOpportunity('A', workspaceA, contactA);
const oppB = await insertOpportunity('B', workspaceB, contactB);
pass('USER_A_OWN_INSERT', oppA.status === 201 && oppA.rows.length === 1);
pass('USER_B_OWN_INSERT', oppB.status === 201 && oppB.rows.length === 1);
const oppAId = oppA.rows[0]?.id;
const oppBId = oppB.rows[0]?.id;

const ownA = await request(sessions.A, 'GET', '/rest/v1/opportunities', { select: 'id,workspace_id', id: `eq.${oppAId}` }, undefined, null);
const ownB = await request(sessions.B, 'GET', '/rest/v1/opportunities', { select: 'id,workspace_id', id: `eq.${oppBId}` }, undefined, null);
pass('USER_A_OWN_READ', ownA.status === 200 && ownA.rows.length === 1 && ownA.rows[0].workspace_id === workspaceA);
pass('USER_B_OWN_READ', ownB.status === 200 && ownB.rows.length === 1 && ownB.rows[0].workspace_id === workspaceB);
const updateA = await request(sessions.A, 'PATCH', '/rest/v1/opportunities', { id: `eq.${oppAId}` }, { stage: 'qualified' });
const updateB = await request(sessions.B, 'PATCH', '/rest/v1/opportunities', { id: `eq.${oppBId}` }, { stage: 'qualified' });
pass('USER_A_MUTABLE_UPDATE', updateA.status === 200 && updateA.rows[0]?.stage === 'qualified');
pass('USER_B_MUTABLE_UPDATE', updateB.status === 200 && updateB.rows[0]?.stage === 'qualified');

for (const [label, workspaceId] of [['A', workspaceB], ['B', workspaceA]]) {
  const read = await request(sessions[label], 'GET', '/rest/v1/opportunities', { select: 'id', workspace_id: `eq.${workspaceId}` }, undefined, null);
  pass(`USER_${label}_CROSS_TENANT_READ_BLOCKED`, read.status === 200 && read.rows.length === 0);
}
const outsiderA = await request(sessions.C, 'GET', '/rest/v1/opportunities', { select: 'id', workspace_id: `eq.${workspaceA}` }, undefined, null);
const outsiderB = await request(sessions.C, 'GET', '/rest/v1/opportunities', { select: 'id', workspace_id: `eq.${workspaceB}` }, undefined, null);
pass('USER_C_OUTSIDER_READ_A_BLOCKED', outsiderA.status === 200 && outsiderA.rows.length === 0);
pass('USER_C_OUTSIDER_READ_B_BLOCKED', outsiderB.status === 200 && outsiderB.rows.length === 0);
const spoofA = await insertOpportunity('A', workspaceB, contactB);
const spoofB = await insertOpportunity('B', workspaceA, contactA);
pass('USER_A_WORKSPACE_SPOOF_BLOCKED', spoofA.rows.length === 0);
pass('USER_B_WORKSPACE_SPOOF_BLOCKED', spoofB.rows.length === 0);
const fkAttack = await insertOpportunity('A', workspaceA, contactB);
pass('CROSS_TENANT_CONTACT_FK_BLOCKED', fkAttack.status >= 400 && fkAttack.rows.length === 0);

const admin = { key: env('SUPABASE_SECRET_KEY') };
const adminProbe = await request(admin, 'GET', '/rest/v1/workspace_members', { select: 'workspace_id', workspace_id: `eq.${workspaceB}`, user_id: `eq.${userIds.B}` }, undefined, null);
pass('CONTROLLED_ADMIN_CONTEXT', adminProbe.status === 200 && adminProbe.rows.length === 1);
if (adminProbe.status === 200 && adminProbe.rows.length === 1) {
  const dual = await request(admin, 'POST', '/rest/v1/workspace_members', {}, { workspace_id: workspaceB, user_id: userIds.A, role: 'member', status: 'active' });
  pass('DUAL_MEMBERSHIP_SETUP', dual.status === 201);
  if (dual.status === 201) {
    const mutations = [
      ['WORKSPACE_MUTATION_BLOCKED', { workspace_id: workspaceB }],
      ['CONTACT_MUTATION_BLOCKED', { contact_id: contactB }],
      ['CREATED_AT_MUTATION_BLOCKED', { created_at: '2000-01-01T00:00:00Z' }],
      ['CREATED_BY_MUTATION_BLOCKED', { created_by_type: 'system' }],
    ];
    for (const [label, body] of mutations) {
      const result = await request(sessions.A, 'PATCH', '/rest/v1/opportunities', { id: `eq.${oppAId}` }, body);
      pass(label, result.status >= 400 && result.rows.length === 0);
    }
    const removed = await request(admin, 'DELETE', '/rest/v1/workspace_members', { workspace_id: `eq.${workspaceB}`, user_id: `eq.${userIds.A}` }, undefined, null);
    pass('DUAL_MEMBERSHIP_RESTORED', removed.status === 204 || removed.status === 200);
  }
}
const deleteOwn = await request(sessions.A, 'DELETE', '/rest/v1/opportunities', { id: `eq.${oppAId}` }, undefined, null);
const deleteCross = await request(sessions.B, 'DELETE', '/rest/v1/opportunities', { id: `eq.${oppAId}` }, undefined, null);
const remains = await request(sessions.A, 'GET', '/rest/v1/opportunities', { select: 'id', id: `eq.${oppAId}` }, undefined, null);
pass('DELETE_OWN_DENIED', remains.rows.length === 1);
pass('DELETE_CROSS_TENANT_DENIED', deleteCross.rows.length === 0 && remains.rows.length === 1);
pass('OUTSIDER_INSERT_BLOCKED', (await insertOpportunity('C', workspaceA, contactA)).rows.length === 0);
const outsiderUpdate = await request(sessions.C, 'PATCH', '/rest/v1/opportunities', { id: `eq.${oppAId}` }, { stage: 'lost' });
const outsiderDelete = await request(sessions.C, 'DELETE', '/rest/v1/opportunities', { id: `eq.${oppAId}` }, undefined, null);
pass('OUTSIDER_UPDATE_BLOCKED', outsiderUpdate.rows.length === 0);
pass('OUTSIDER_DELETE_BLOCKED', outsiderDelete.rows.length === 0);

const suspend = await request(admin, 'PATCH', '/rest/v1/workspace_members', { workspace_id: `eq.${workspaceB}`, user_id: `eq.${userIds.B}` }, { status: 'suspended' });
pass('SUSPEND_SETUP', suspend.status === 200 || suspend.status === 204);
if (suspend.status === 200 || suspend.status === 204) {
  const suspendedRead = await request(sessions.B, 'GET', '/rest/v1/opportunities', { select: 'id', workspace_id: `eq.${workspaceB}` }, undefined, null);
  const suspendedInsert = await insertOpportunity('B', workspaceB, contactB);
  const suspendedUpdate = await request(sessions.B, 'PATCH', '/rest/v1/opportunities', { id: `eq.${oppBId}` }, { stage: 'lost' });
  pass('SUSPENDED_SELECT_DENIED', suspendedRead.status === 200 && suspendedRead.rows.length === 0);
  pass('SUSPENDED_INSERT_DENIED', suspendedInsert.rows.length === 0);
  pass('SUSPENDED_UPDATE_DENIED', suspendedUpdate.rows.length === 0);
  const restore = await request(admin, 'PATCH', '/rest/v1/workspace_members', { workspace_id: `eq.${workspaceB}`, user_id: `eq.${userIds.B}` }, { status: 'active' });
  pass('SUSPENDED_MEMBERSHIP_RESTORED', restore.status === 200 || restore.status === 204);
}

const invalids = [
  ['INVALID_STAGE_REJECTED', { stage: 'invalid' }],
  ['INVALID_SOURCE_REJECTED', { source: 'invalid' }],
  ['INVALID_ATTRIBUTION_REJECTED', { attribution: 'invalid' }],
  ['NEGATIVE_VALUE_REJECTED', { estimated_value: -1 }],
  ['INVALID_CURRENCY_REJECTED', { currency: 'gbp' }],
  ['PROBABILITY_LOW_REJECTED', { probability: -0.01 }],
  ['PROBABILITY_HIGH_REJECTED', { probability: 1.01 }],
];
for (const [label, body] of invalids) pass(label, (await insertOpportunity('A', workspaceA, contactA, body)).status >= 400);
const valid = await insertOpportunity('A', workspaceA, contactA, { stage: 'contacted', source: 'referral', attribution: 'rev_assisted', estimated_value: 1234.56, currency: 'GBP', probability: 0.5 });
pass('VALID_CONSTRAINT_VALUES_ACCEPTED', valid.status === 201);
const revenueFixture = await insertOpportunity('A', workspaceA, contactA, { stage: 'new', attribution: 'rev_generated', estimated_value: 9999 });
pass('REV_GENERATED_NEW_STAGE_ACCEPTED', revenueFixture.status === 201);
if (revenueFixture.rows[0]?.id) {
  const won = await request(sessions.A, 'PATCH', '/rest/v1/opportunities', { id: `eq.${revenueFixture.rows[0].id}` }, { stage: 'won', won_at: new Date().toISOString() });
  pass('REV_GENERATED_WON_TRANSITION_ACCEPTED', won.status === 200 && won.rows[0]?.stage === 'won');
}

const action = await request(sessions.A, 'POST', '/rest/v1/rev_actions', {}, {
  workspace_id: workspaceA, contact_id: contactA, opportunity_id: oppAId,
  action_type: 'test', title: `Phase 3E.3 remote action ${stamp}`,
  description: 'Controlled Phase 3E.3 tenant-integrity test', requires_approval: true,
});
pass('SAME_TENANT_REV_ACTION_OPPORTUNITY_LINK', action.status === 201 && action.rows[0]?.opportunity_id === oppAId);
if (action.rows[0]?.id) await request(sessions.A, 'DELETE', '/rest/v1/rev_actions', { id: `eq.${action.rows[0].id}` }, undefined, null);
const crossAction = await request(sessions.B, 'POST', '/rest/v1/rev_actions', {}, {
  workspace_id: workspaceB, contact_id: contactB, opportunity_id: oppAId,
  action_type: 'test', title: `Phase 3E.3 cross-tenant action ${stamp}`,
  description: 'Controlled Phase 3E.3 tenant-integrity test', requires_approval: true,
});
pass('CROSS_TENANT_REV_ACTION_OPPORTUNITY_LINK_BLOCKED', crossAction.status >= 400 && crossAction.rows.length === 0);

const authenticatedTriggerCall = await request(sessions.A, 'POST', '/rest/v1/rpc/prevent_opportunity_identity_mutation', {}, {}, null);
const anonymousTriggerCall = await request({ key: publicKey }, 'POST', '/rest/v1/rpc/prevent_opportunity_identity_mutation', {}, {}, null);
pass('AUTHENTICATED_TRIGGER_FUNCTION_EXECUTE_BLOCKED', authenticatedTriggerCall.status >= 400);
pass('ANON_TRIGGER_FUNCTION_EXECUTE_BLOCKED', anonymousTriggerCall.status >= 400);

const suppression = await request(sessions.A, 'POST', '/rest/v1/contact_suppressions', {}, { workspace_id: workspaceA, contact_id: contactA, reason: 'do_not_contact' });
pass('OWN_SUPPRESSION_CREATE', suppression.status === 201);
const ownSuppression = await request(sessions.A, 'GET', '/rest/v1/contact_suppressions', { select: 'workspace_id,contact_id', workspace_id: `eq.${workspaceA}`, contact_id: `eq.${contactA}` }, undefined, null);
const foreignSuppression = await request(sessions.B, 'GET', '/rest/v1/contact_suppressions', { select: 'workspace_id,contact_id', workspace_id: `eq.${workspaceA}` }, undefined, null);
pass('OWN_SUPPRESSION_READ', ownSuppression.status === 200 && ownSuppression.rows.length === 1);
pass('CROSS_TENANT_SUPPRESSION_READ_BLOCKED', foreignSuppression.status === 200 && foreignSuppression.rows.length === 0);
const foreignSuppressionMutation = await request(sessions.B, 'PATCH', '/rest/v1/contact_suppressions', { workspace_id: `eq.${workspaceA}`, contact_id: `eq.${contactA}` }, { reason: 'bounced' });
pass('CROSS_TENANT_SUPPRESSION_MUTATION_BLOCKED', foreignSuppressionMutation.rows.length === 0);
if (suppression.rows[0]) await request(sessions.A, 'DELETE', '/rest/v1/contact_suppressions', { workspace_id: `eq.${workspaceA}`, contact_id: `eq.${contactA}` }, undefined, null);

for (const fixture of fixtures) {
  await request(fixture.session, 'PATCH', '/rest/v1/opportunities', { id: `eq.${fixture.id}` }, { title: `TEST FIXTURE - ${fixture.id}`, stage: 'dormant', estimated_value: 0, attribution: 'unattributed', next_action_at: null });
}
console.log(`FIXTURE_COUNT_RETAINED=${fixtures.length}`);
console.log(`REMOTE_ATTACK_RESULT=${failures.length === 0 ? 'PASS' : 'FAIL'}`);
if (failures.length) process.exitCode = 1;
